-- =====================================================================
-- Startpaket: Fragen ohne Spieler als Autor (author_id = null).
-- Die bekommt jeder gestellt; angezeigt wird „Startpaket“.
-- =====================================================================

alter table public.questions alter column author_id drop not null;
alter table public.questions add column if not exists source_label text;

create or replace function public._pick_questions(
  p_seen_by uuid[], p_exclude_authors uuid[], p_category smallint, p_count int, p_exclude_ids bigint[] default '{}')
returns table (question_id bigint)
language sql volatile security definer set search_path = public
as $$
  with eligible as (
    select q.id,
           q.category_id,
           (select max(a.shown_at) from public.answers a
             where a.question_id = q.id and a.user_id = any (p_seen_by)) as last_seen,
           coalesce((select sum(v.vote) from public.question_votes v where v.question_id = q.id), 0) as votes,
           random() as r
      from public.questions q
     where q.is_active
       and q.deleted_at is null
       and (q.author_id is null or q.author_id <> all (coalesce(p_exclude_authors, '{}')))
       and q.id <> all (coalesce(p_exclude_ids, '{}'))
       and (p_category is null or q.category_id = p_category)
  ),
  ranked as (
    select e.*,
           row_number() over (
             partition by e.category_id
             order by (e.last_seen is not null), (e.votes <= -3), e.last_seen nulls first, e.r
           ) as rn
      from eligible e
  )
  select id
    from ranked
   order by rn, (last_seen is not null), (votes <= -3), r
   limit p_count
$$;

create or replace function public._record_answer(p_game_id bigint, p_user uuid, p_position smallint, p_choice smallint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ans     public.answers;
  v_q       public.questions;
  v_correct smallint;
  v_ms      int;
  v_ok      boolean;
begin
  select * into v_ans from public.answers
   where game_id = p_game_id and user_id = p_user and position = p_position
   for update;
  if not found or v_ans.answered_at is not null then
    raise exception 'Diese Frage ist nicht offen.';
  end if;

  select * into v_q from public.questions where id = v_ans.question_id;

  v_correct := (array_position(v_ans.answer_order, 0::smallint) - 1)::smallint;
  v_ms := least(30000, (extract(epoch from (now() - v_ans.shown_at)) * 1000)::int);

  -- 30 Sekunden + 2 Sekunden Toleranz für das Netz
  if p_choice is null or now() - v_ans.shown_at > interval '32 seconds' then
    p_choice := null;
    v_ms := 30000;
  end if;
  if p_choice is not null and v_ans.hidden is not null and p_choice = any (v_ans.hidden) then
    raise exception 'Diese Antwort wurde vom Joker ausgeblendet.';
  end if;
  v_ok := p_choice is not null and p_choice = v_correct;

  update public.answers
     set chosen = p_choice, is_correct = v_ok, ms = v_ms, answered_at = now()
   where game_id = p_game_id and user_id = p_user and position = p_position;

  if p_position = 5 then
    perform public._finish_player(p_game_id, p_user);
  end if;

  return jsonb_build_object(
    'position', p_position,
    'chosen', p_choice,
    'correct_index', v_correct,
    'is_correct', v_ok,
    'timed_out', p_choice is null,
    'explanation', v_q.explanation,
    'source_url', v_q.source_url,
    'question_id', v_q.id,
    'author', coalesce((select display_name from public.profiles where id = v_q.author_id), v_q.source_label, 'Startpaket'),
    'my_vote', (select vote from public.question_votes where question_id = v_q.id and user_id = p_user),
    'finished', p_position = 5
  );
end
$$;

create or replace function public.next_question(p_game_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_game   public.games;
  v_player public.game_players;
  v_ans    public.answers;
  v_pos    smallint;
  v_gq     public.game_questions;
  v_q      public.questions;
  v_order  smallint[];
  v_sub    bigint;
begin
  select * into v_game from public.games where id = p_game_id;
  if not found then
    raise exception 'Spiel nicht gefunden.';
  end if;

  select * into v_player from public.game_players
   where game_id = p_game_id and user_id = v_me
   for update;
  if not found then
    raise exception 'Du spielst in diesem Spiel nicht mit.';
  end if;
  if v_player.status = 'done' then
    return jsonb_build_object('done', true);
  end if;
  if v_game.status = 'closed' then
    raise exception 'Diese Challenge wurde schon geschlossen.';
  end if;
  if v_game.mode = 'duel' and v_game.created_by <> v_me and exists (
       select 1 from public.game_players
        where game_id = p_game_id and user_id = v_game.created_by and status <> 'done') then
    raise exception 'Dein Gegner spielt seine Fragen noch. Du bekommst einen Push, sobald du dran bist.';
  end if;

  -- Gibt es eine angezeigte, aber noch nicht beantwortete Frage?
  select * into v_ans from public.answers
   where game_id = p_game_id and user_id = v_me and answered_at is null;
  if found then
    if now() - v_ans.shown_at > interval '32 seconds' then
      perform public._record_answer(p_game_id, v_me, v_ans.position, null);
      if v_ans.position = 5 then
        return jsonb_build_object('done', true);
      end if;
    else
      v_pos := v_ans.position;
    end if;
  end if;

  if v_pos is null then
    select (coalesce(max(position), 0) + 1)::smallint into v_pos
      from public.answers where game_id = p_game_id and user_id = v_me;
    if v_pos > 5 then
      return jsonb_build_object('done', true);
    end if;

    select * into v_gq from public.game_questions where game_id = p_game_id and position = v_pos;
    select * into v_q from public.questions where id = v_gq.question_id;
    v_order := v_gq.answer_order;

    -- Eigene Frage? Dann Ersatzfrage aus derselben Kategorie (notfalls aus einer anderen)
    if v_q.author_id is not null and v_q.author_id = v_me then
      select question_id into v_sub
        from public._pick_questions(array[v_me], array[v_me], v_q.category_id, 1,
               array(select question_id from public.game_questions where game_id = p_game_id)
               || array(select question_id from public.answers where game_id = p_game_id));
      if v_sub is null then
        select question_id into v_sub
          from public._pick_questions(array[v_me], array[v_me], null, 1,
                 array(select question_id from public.game_questions where game_id = p_game_id)
                 || array(select question_id from public.answers where game_id = p_game_id));
      end if;
      if v_sub is null then
        raise exception 'Für deine eigene Frage gibt es keine Ersatzfrage. Ladet mehr Fragen hoch!';
      end if;
      select * into v_q from public.questions where id = v_sub;
      v_order := public._shuffled_order();
    end if;

    insert into public.answers (game_id, user_id, position, question_id, answer_order)
    values (p_game_id, v_me, v_pos, v_q.id, v_order)
    returning * into v_ans;
  end if;

  select * into v_q from public.questions where id = v_ans.question_id;
  select * into v_gq from public.game_questions where game_id = p_game_id and position = v_pos;

  return jsonb_build_object(
    'done', false,
    'position', v_pos,
    'total', 5,
    'question_id', v_q.id,
    'text', v_q.text,
    'image_path', v_q.image_path,
    'category', (select jsonb_build_object('name', c.name, 'icon', c.icon) from public.categories c where c.id = v_q.category_id),
    'author', coalesce((select display_name from public.profiles where id = v_q.author_id), v_q.source_label, 'Startpaket'),
    'substitute', v_ans.question_id <> v_gq.question_id,
    'options', (
      select jsonb_agg(case o when 0 then v_q.correct when 1 then v_q.wrong_1 when 2 then v_q.wrong_2 else v_q.wrong_3 end order by ord)
        from unnest(v_ans.answer_order) with ordinality as t(o, ord)
    ),
    'seconds_left', greatest(0, 30 - extract(epoch from (now() - v_ans.shown_at))),
    'joker_available', not v_player.joker_used,
    'hidden', coalesce(to_jsonb(v_ans.hidden), '[]'::jsonb)
  );
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

