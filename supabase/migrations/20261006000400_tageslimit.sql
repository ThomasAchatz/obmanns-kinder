-- =====================================================================
-- Tageslimit für die Rangliste
-- Pro Spieler und Tag (deutsche Zeit) zählen nur die ersten 3 beendeten
-- Duelle/Challenges. Danach darf man weiterspielen, bekommt aber keine Punkte.
-- Maximal also 9 Punkte pro Tag. Maßgeblich ist der Zeitpunkt, an dem das
-- Spiel fertig wurde (bei Challenges: geschlossen oder alle haben gespielt).
-- =====================================================================

drop function if exists public._game_ranks(timestamptz, timestamptz);

create function public._game_ranks(p_from timestamptz default null, p_to timestamptz default null)
returns table (game_id bigint, mode text, finished_at timestamptz, user_id uuid, score smallint, total_ms integer,
               rnk bigint, raw_points integer, day_index bigint, counted boolean, points integer)
language sql stable security definer set search_path = public
as $$
  with done as (
    select g.id as game_id, g.mode, g.finished_at, gp.user_id, gp.score, gp.total_ms,
           rank() over (partition by g.id order by gp.score desc, gp.total_ms asc) as rnk,
           count(*) over (partition by g.id) as n_done
      from public.games g
      join public.game_players gp on gp.game_id = g.id and gp.status = 'done'
     where g.mode in ('duel', 'challenge')
       and g.status in ('finished', 'closed')
       and (p_from is null or g.finished_at >= p_from)
       and (p_to is null or g.finished_at < p_to)
  ),
  tied as (
    select d.*, count(*) over (partition by d.game_id, d.rnk) as n_same
      from done d
  ),
  scored as (
    select t.*,
           case
             when n_done < 2 then 0
             when mode = 'duel' and rnk = 1 and n_same = 1 then 3
             when mode = 'duel' and rnk = 1 then 1
             when mode = 'challenge' and rnk = 1 then 3
             when mode = 'challenge' and rnk = 2 then 2
             when mode = 'challenge' and rnk = 3 then 1
             else 0
           end::integer as raw_points,
           -- Spiele mit nur einem fertigen Teilnehmer zählen nicht als Wertungsspiel
           case when n_done >= 2 then
             row_number() over (
               partition by t.user_id, (t.n_done >= 2), (t.finished_at at time zone 'Europe/Berlin')::date
               order by t.finished_at, t.game_id)
           end as day_index
      from tied t
  )
  select game_id, mode, finished_at, user_id, score, total_ms, rnk, raw_points,
         day_index,
         coalesce(day_index <= 3, false) as counted,
         case when day_index <= 3 then raw_points else 0 end as points
    from scored
$$;

revoke execute on function public._game_ranks(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.leaderboard(p_period text default 'month', p_month date default null)
returns table (user_id uuid, display_name text, points integer, wins integer, games integer, correct_rate numeric)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_from timestamptz;
  v_to   timestamptz;
begin
  if p_period = 'month' then
    -- Monatsgrenzen nach deutscher Zeit
    v_from := date_trunc('month', coalesce(p_month::timestamp, now() at time zone 'Europe/Berlin')) at time zone 'Europe/Berlin';
    v_to   := (date_trunc('month', coalesce(p_month::timestamp, now() at time zone 'Europe/Berlin')) + interval '1 month') at time zone 'Europe/Berlin';
  end if;

  return query
  with ranks as (
    select * from public._game_ranks(v_from, v_to)
  ),
  ans as (
    select a.user_id, count(*) filter (where a.is_correct) as ok, count(*) as total
      from public.answers a
      join public.games g on g.id = a.game_id
     where a.answered_at is not null
       and g.mode <> 'solo'
       and (v_from is null or a.answered_at >= v_from)
       and (v_to is null or a.answered_at < v_to)
     group by a.user_id
  )
  select p.id,
         p.display_name,
         coalesce(sum(r.points), 0)::integer,
         coalesce(count(*) filter (where r.rnk = 1 and r.raw_points >= 3), 0)::integer,
         coalesce(count(r.game_id), 0)::integer,
         round(coalesce(max(ans.ok)::numeric / nullif(max(ans.total), 0), 0) * 100, 0)
    from public.profiles p
    left join ranks r on r.user_id = p.id
    left join ans on ans.user_id = p.id
   group by p.id, p.display_name
   order by 3 desc, 4 desc, 6 desc, 2;
end
$$;

create or replace function public.game_details(p_game_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me       uuid := auth.uid();
  v_game     public.games;
  v_mine     public.game_players;
  v_reveal   boolean;
  v_creator_done boolean;
begin
  select * into v_game from public.games where id = p_game_id;
  select * into v_mine from public.game_players where game_id = p_game_id and user_id = v_me;
  if v_game.id is null or v_mine.user_id is null then
    raise exception 'Spiel nicht gefunden.';
  end if;

  v_reveal := v_mine.status = 'done' or v_game.status <> 'open';
  select status = 'done' into v_creator_done from public.game_players where game_id = p_game_id and user_id = v_game.created_by;

  return jsonb_build_object(
    'id', v_game.id,
    'mode', v_game.mode,
    'status', v_game.status,
    'created_at', v_game.created_at,
    'finished_at', v_game.finished_at,
    'created_by', v_game.created_by,
    'category', (select jsonb_build_object('name', c.name, 'icon', c.icon) from public.categories c where c.id = v_game.category_id),
    'my_status', v_mine.status,
    'can_play', v_mine.status = 'pending' and v_game.status = 'open'
                and (v_game.mode <> 'duel' or v_game.created_by = v_me or v_creator_done),
    'started', exists (select 1 from public.answers where game_id = p_game_id and user_id = v_me),
    'joker_used', v_mine.joker_used,
    'can_nudge', v_mine.status = 'done' and v_game.status = 'open'
                 and (v_mine.last_nudge_at is null or v_mine.last_nudge_at <= now() - interval '20 hours')
                 and exists (select 1 from public.game_players where game_id = p_game_id and status = 'pending'),
    'my_points', (select jsonb_build_object('points', gr.points, 'raw_points', gr.raw_points, 'counted', gr.counted, 'day_index', gr.day_index)
                    from public._game_ranks() gr where gr.game_id = p_game_id and gr.user_id = v_me),
    'can_close', v_game.mode = 'challenge' and v_game.status = 'open' and (v_game.created_by = v_me or public.is_admin()),
    'players', (
      select jsonb_agg(jsonb_build_object(
               'user_id', gp.user_id,
               'display_name', p.display_name,
               'status', gp.status,
               'score', case when v_reveal and gp.status = 'done' then gp.score end,
               'total_ms', case when v_reveal and gp.status = 'done' then gp.total_ms end,
               'rank', case when v_reveal and gp.status = 'done'
                            then (select count(*) + 1 from public.game_players o
                                   where o.game_id = gp.game_id and o.status = 'done'
                                     and (o.score > gp.score or (o.score = gp.score and o.total_ms < gp.total_ms))) end
             ) order by (gp.status = 'done') desc, gp.score desc, gp.total_ms, p.display_name)
        from public.game_players gp
        join public.profiles p on p.id = gp.user_id
       where gp.game_id = p_game_id
    ),
    -- Pro Position die Frage, die ICH bekommen habe (ggf. Ersatzfrage); Antworten der anderen
    -- nur dort, wo sie dieselbe Frage hatten.
    'questions', case when not v_reveal then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object(
               'position', x.position,
               'question_id', q.id,
               'substitute', x.substitute,
               'text', q.text,
               'image_path', q.image_path,
               'category', jsonb_build_object('name', c.name, 'icon', c.icon),
               'author', coalesce(au.display_name, q.source_label, 'Startpaket'),
               'explanation', q.explanation,
               'source_url', q.source_url,
               'options', (select jsonb_agg(case o when 0 then q.correct when 1 then q.wrong_1 when 2 then q.wrong_2 else q.wrong_3 end order by ord)
                             from unnest(x.answer_order) with ordinality as t(o, ord)),
               'correct_index', array_position(x.answer_order, 0::smallint) - 1,
               'my_vote', (select vote from public.question_votes v where v.question_id = q.id and v.user_id = v_me),
               'answers', (
                 select coalesce(jsonb_object_agg(a.user_id, jsonb_build_object(
                          'chosen', a.chosen, 'is_correct', a.is_correct, 'ms', a.ms, 'joker', a.joker,
                          'chosen_text', case when a.chosen is null then null else
                            (case a.answer_order[a.chosen + 1] when 0 then q.correct when 1 then q.wrong_1 when 2 then q.wrong_2 else q.wrong_3 end) end
                        )), '{}'::jsonb)
                   from public.answers a
                   join public.game_players gp2 on gp2.game_id = a.game_id and gp2.user_id = a.user_id and gp2.status = 'done'
                  where a.game_id = x.game_id and a.position = x.position and a.question_id = q.id
               )
             ) order by x.position), '[]'::jsonb)
        from (
          select gq.game_id, gq.position,
                 coalesce(ma.question_id, gq.question_id) as qid,
                 coalesce(ma.answer_order, gq.answer_order) as answer_order,
                 coalesce(ma.question_id <> gq.question_id, false) as substitute
            from public.game_questions gq
            left join public.answers ma on ma.game_id = gq.game_id and ma.position = gq.position and ma.user_id = v_me
           where gq.game_id = p_game_id
        ) x
        join public.questions q on q.id = x.qid
        join public.categories c on c.id = q.category_id
        left join public.profiles au on au.id = q.author_id
    ) end
  );
end
$$;

-- Wie viele Wertungsspiele hat man heute schon?
create or replace function public.my_day_status()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'counted_games', count(*) filter (where gr.counted),
    'points', coalesce(sum(gr.points), 0),
    'limit_games', 3,
    'limit_points', 9
  )
    from public._game_ranks(
           (date_trunc('day', now() at time zone 'Europe/Berlin')) at time zone 'Europe/Berlin',
           (date_trunc('day', now() at time zone 'Europe/Berlin') + interval '1 day') at time zone 'Europe/Berlin') gr
   where gr.user_id = auth.uid()
$$;

revoke execute on function public.my_day_status() from public, anon;
grant execute on function public.my_day_status() to authenticated;
