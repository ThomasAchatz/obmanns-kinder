-- =====================================================================
-- 50:50 entscheidet bei Gleichstand, Wochen-Rangliste, Weekend League
-- Bei gleicher Punktzahl gewinnt, wer keinen 50:50-Joker genommen hat; erst dann zählt die Zeit.
-- Wochen-Rangliste: Montag 00:00 bis Sonntag 23:59 (deutsche Zeit).
-- =====================================================================

create or replace function public._game_ranks(p_from timestamptz default null, p_to timestamptz default null, p_kind text default 'quiz')
returns table (game_id bigint, mode text, finished_at timestamptz, user_id uuid, score smallint, total_ms integer,
               rnk bigint, raw_points integer, day_index bigint, counted boolean, points integer)
language sql stable security definer set search_path = public
as $$
  with done as (
    select g.id as game_id, g.mode, g.finished_at, gp.user_id, gp.score, gp.total_ms,
           rank() over (partition by g.id order by gp.score desc, gp.joker_used asc, gp.total_ms asc) as rnk,
           count(*) over (partition by g.id) as n_done
      from public.games g
      join public.game_players gp on gp.game_id = g.id and gp.status = 'done'
     where g.mode in ('duel', 'challenge')
       and g.kind = p_kind
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
               'joker_used', case when v_reveal and gp.status = 'done' then gp.joker_used end,
               'rank', case when v_reveal and gp.status = 'done'
                            then (select count(*) + 1 from public.game_players o
                                   where o.game_id = gp.game_id and o.status = 'done'
                                     and (o.score > gp.score
                                          or (o.score = gp.score and not o.joker_used and gp.joker_used)
                                          or (o.score = gp.score and o.joker_used = gp.joker_used and o.total_ms < gp.total_ms))) end
             ) order by (gp.status = 'done') desc, gp.score desc, gp.joker_used, gp.total_ms, p.display_name)
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

create or replace function public.my_games()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.sort_at desc), '[]'::jsonb)
    from (
      select g.id, g.mode, g.kind, g.music_hard as hard, g.status, g.created_at, g.finished_at, g.created_by,
             coalesce(g.finished_at, g.created_at) as sort_at,
             mine.status as my_status,
             (mine.status = 'pending' and g.status = 'open'
               and (g.mode <> 'duel' or g.created_by = auth.uid()
                    or exists (select 1 from public.game_players c where c.game_id = g.id and c.user_id = g.created_by and c.status = 'done'))) as my_turn,
             (mine.status = 'done' and g.status = 'open'
               and (mine.last_nudge_at is null or mine.last_nudge_at <= now() - interval '20 hours')) as can_nudge,
             (select jsonb_build_object('name', c.name, 'icon', c.icon) from public.categories c where c.id = g.category_id) as category,
             (select jsonb_agg(jsonb_build_object(
                       'user_id', gp.user_id,
                       'display_name', p.display_name,
                       'status', gp.status,
                       'score', case when mine.status = 'done' or g.status <> 'open' then gp.score end,
                       'total_ms', case when mine.status = 'done' or g.status <> 'open' then gp.total_ms end,
                       'joker_used', case when mine.status = 'done' or g.status <> 'open' then gp.joker_used end
                     ) order by gp.user_id = g.created_by desc, p.display_name)
                from public.game_players gp join public.profiles p on p.id = gp.user_id
               where gp.game_id = g.id) as players
        from public.games g
        join public.game_players mine on mine.game_id = g.id and mine.user_id = auth.uid()
       where (g.mode <> 'solo' or g.status = 'open')
         and g.mode <> 'league'
         and (g.status = 'open' or g.finished_at > now() - interval '30 days')
       order by coalesce(g.finished_at, g.created_at) desc
       limit 60
    ) x
$$;

create or replace function public.leaderboard(p_period text default 'month', p_month date default null, p_kind text default 'quiz')
returns table (user_id uuid, display_name text, points integer, wins integer, games integer, correct_rate numeric)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_from timestamptz;
  v_to   timestamptz;
begin
  if p_period = 'week' then
    -- Woche: Montag 00:00 bis Sonntag 23:59 (deutsche Zeit)
    v_from := date_trunc('week', coalesce(p_month::timestamp, now() at time zone 'Europe/Berlin')) at time zone 'Europe/Berlin';
    v_to   := (date_trunc('week', coalesce(p_month::timestamp, now() at time zone 'Europe/Berlin')) + interval '7 days') at time zone 'Europe/Berlin';
  elsif p_period = 'month' then
    v_from := date_trunc('month', coalesce(p_month::timestamp, now() at time zone 'Europe/Berlin')) at time zone 'Europe/Berlin';
    v_to   := (date_trunc('month', coalesce(p_month::timestamp, now() at time zone 'Europe/Berlin')) + interval '1 month') at time zone 'Europe/Berlin';
  end if;

  return query
  with ranks as (
    select * from public._game_ranks(v_from, v_to, p_kind)
  ),
  ans as (
    -- Quiz: richtige Antworten; Musik: richtige Teile (Interpret und Titel einzeln); Bilder: erkannte Gesichter
    select x.user_id, sum(x.ok) as ok, sum(x.total) as total
      from (
        select a.user_id, (a.is_correct)::int as ok, 1 as total, a.answered_at
          from public.answers a join public.games g on g.id = a.game_id
         where p_kind = 'quiz' and a.answered_at is not null and g.mode <> 'solo'
        union all
        select m.user_id, coalesce(m.artist_ok::int, 0) + coalesce(m.title_ok::int, 0), 2, m.answered_at
          from public.music_answers m join public.games g on g.id = m.game_id
         where p_kind = 'music' and m.answered_at is not null and g.mode <> 'solo'
        union all
        select b.user_id, coalesce(b.ok::int, 0), 1, b.answered_at
          from public.bild_answers b join public.games g on g.id = b.game_id
         where p_kind = 'bild' and b.answered_at is not null and g.mode <> 'solo'
      ) x
     where (v_from is null or x.answered_at >= v_from)
       and (v_to is null or x.answered_at < v_to)
     group by x.user_id
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

-- =====================================================================
-- Weekend League
-- Anmeldung Montag bis Freitag 23:59, gespielt wird Samstag 00:00 bis Sonntag 23:59.
-- Alle gegen alle: 3 Quizrunden, 2 Bilderrunden (Easy + Hard), 2 Musikrunden (Normal + Hard).
-- Jede Runde zählt höchstens 5 Punkte (Musik wird halbiert), also maximal 35.
-- Bei Gleichstand entscheidet die Gesamtzeit. Die Runden zählen nicht für die normale Rangliste.
-- Erste League: Wochenende 17./18. Oktober 2026.
-- =====================================================================

alter table public.games drop constraint if exists games_mode_check;
alter table public.games add constraint games_mode_check check (mode in ('solo', 'duel', 'challenge', 'league'));

create table public.leagues (
  id            bigint generated always as identity primary key,
  week_start    date not null unique,              -- Montag der League-Woche
  signup_until  timestamptz not null,              -- Samstag 00:00 (exklusiv)
  starts_at     timestamptz not null,              -- Samstag 00:00
  ends_at       timestamptz not null,              -- Montag 00:00 (exklusiv), also Sonntag 23:59
  started       boolean not null default false,
  closed        boolean not null default false,
  reminder_sent boolean not null default false,
  created_at    timestamptz not null default now()
);
create table public.league_members (
  league_id bigint not null references public.leagues(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create table public.league_rounds (
  league_id bigint not null references public.leagues(id) on delete cascade,
  position  smallint not null check (position between 1 and 7),
  kind      text not null check (kind in ('quiz', 'music', 'bild')),
  hard      boolean not null default false,
  game_id   bigint references public.games(id) on delete set null,
  primary key (league_id, position)
);
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.league_rounds enable row level security;
revoke all on public.leagues, public.league_members, public.league_rounds from anon, authenticated;

create or replace function public._league_first_week()
returns date language sql immutable as $$ select date '2026-10-12' $$;

-- League einer Woche anlegen (falls noch nicht da)
create or replace function public._league_for(p_week date)
returns public.leagues
language plpgsql security definer set search_path = public
as $$
declare
  v public.leagues;
begin
  insert into public.leagues (week_start, signup_until, starts_at, ends_at)
  values (p_week,
          (p_week + 5)::timestamp at time zone 'Europe/Berlin',
          (p_week + 5)::timestamp at time zone 'Europe/Berlin',
          (p_week + 7)::timestamp at time zone 'Europe/Berlin')
  on conflict (week_start) do nothing;
  select * into v from public.leagues where week_start = p_week;
  return v;
end
$$;

-- Die League, um die es gerade geht: Mo–Fr die kommende (Anmeldung), Sa/So die laufende
create or replace function public._league_week()
returns date
language sql stable
as $$
  select greatest(date_trunc('week', now() at time zone 'Europe/Berlin')::date, public._league_first_week())
$$;

-- Punkte je Mitglied und Runde (nur Antworten bis Sonntag 23:59)
create or replace function public._league_scores(p_league bigint)
returns table (user_id uuid, pos smallint, points numeric, ms bigint, done boolean)
language sql stable security definer set search_path = public
as $$
  with l as (select * from public.leagues where id = p_league),
  r as (select lr.* from public.league_rounds lr where lr.league_id = p_league and lr.game_id is not null)
  select m.user_id, r.position,
         coalesce(case r.kind
           when 'quiz' then (select count(*) filter (where a.is_correct)::numeric from public.answers a, l
                              where a.game_id = r.game_id and a.user_id = m.user_id and a.answered_at < l.ends_at)
           when 'bild' then (select count(*) filter (where b.ok)::numeric from public.bild_answers b, l
                              where b.game_id = r.game_id and b.user_id = m.user_id and b.answered_at < l.ends_at)
           else (select sum(coalesce(x.artist_ok::int, 0) + coalesce(x.title_ok::int, 0))::numeric / 2 from public.music_answers x, l
                  where x.game_id = r.game_id and x.user_id = m.user_id and x.answered_at < l.ends_at)
         end, 0)::numeric(4,1) as points,
         coalesce(case r.kind
           when 'quiz' then (select sum(a.ms) from public.answers a, l where a.game_id = r.game_id and a.user_id = m.user_id and a.answered_at < l.ends_at)
           when 'bild' then (select sum(b.ms) from public.bild_answers b, l where b.game_id = r.game_id and b.user_id = m.user_id and b.answered_at < l.ends_at)
           else (select sum(x.ms) from public.music_answers x, l where x.game_id = r.game_id and x.user_id = m.user_id and x.answered_at < l.ends_at)
         end, 0)::bigint as ms,
         exists (select 1 from public.game_players gp where gp.game_id = r.game_id and gp.user_id = m.user_id and gp.status = 'done') as done
    from public.league_members m cross join r
   where m.league_id = p_league
$$;

create or replace function public._league_standings(p_league bigint)
returns table (user_id uuid, display_name text, points numeric, rounds integer, total_ms bigint, rnk bigint)
language sql stable security definer set search_path = public
as $$
  select m.user_id, p.display_name,
         round(coalesce(sum(s.points), 0), 1), coalesce(count(*) filter (where s.done), 0)::int, coalesce(sum(s.ms), 0)::bigint,
         rank() over (order by coalesce(sum(s.points), 0) desc, coalesce(sum(s.ms), 0) asc)
    from public.league_members m
    join public.profiles p on p.id = m.user_id
    left join public._league_scores(p_league) s on s.user_id = m.user_id
   where m.league_id = p_league
   group by m.user_id, p.display_name
$$;

-- Eine Runde für alle Mitglieder anlegen
create or replace function public._league_make_round(p_members uuid[], p_kind text, p_hard boolean)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_game bigint;
  v_ids  bigint[];
  i      int;
  o      record;
begin
  if p_kind = 'quiz' then
    v_ids := array(select question_id from public._pick_questions_in(p_members, p_members, null, 5));
    if cardinality(v_ids) < 5 then
      v_ids := v_ids || array(select question_id from public._pick_questions_in(p_members, '{}', null, 5 - cardinality(v_ids), v_ids));
    end if;
    insert into public.games (mode, kind, created_by) values ('league', 'quiz', p_members[1]) returning id into v_game;
    insert into public.game_questions (game_id, position, question_id, answer_order)
    select v_game, (row_number() over (order by random()))::smallint, id, public._shuffled_order() from unnest(v_ids) as id;
  elsif p_kind = 'music' then
    v_ids := array(select song_id from public._pick_songs(p_members, 5));
    insert into public.games (mode, kind, music_hard, created_by) values ('league', 'music', p_hard, p_members[1]) returning id into v_game;
    for i in 1..5 loop
      select * into o from public._song_options(v_ids[i], '{}');
      insert into public.music_game_songs (game_id, position, song_id, artist_options, artist_correct, title_options, title_correct)
      values (v_game, i, v_ids[i], o.artist_options, o.artist_correct, o.title_options, o.title_correct);
    end loop;
  else
    v_ids := array(select portrait_id from public._pick_portraits(p_members, p_hard, null));
    insert into public.games (mode, kind, music_hard, created_by) values ('league', 'bild', p_hard, p_members[1]) returning id into v_game;
    for i in 1..5 loop
      select * into o from public._portrait_options(v_ids[i]);
      insert into public.bild_game_items (game_id, position, portrait_id, options, correct)
      values (v_game, i, v_ids[i], o.options, o.correct);
    end loop;
  end if;
  insert into public.game_players (game_id, user_id) select v_game, unnest(p_members);
  return v_game;
end
$$;

-- Zeitgesteuerte Schritte: Erinnerung Freitag, Start Samstag, Abschluss Montag.
-- Wird bei jedem Aufruf der League-Ansicht und zusätzlich per GitHub-Zeitplan angestoßen.
create or replace function public._league_tick()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  l       public.leagues;
  v_mem   uuid[];
  v_out   jsonb := '[]'::jsonb;
  v_win   record;
  v_plan  jsonb := '[{"k":"quiz","h":false},{"k":"bild","h":false},{"k":"music","h":false},{"k":"quiz","h":false},{"k":"bild","h":true},{"k":"music","h":true},{"k":"quiz","h":false}]';
  i       int;
begin
  perform public._league_for(public._league_week());

  -- Freitag ab 17 Uhr: Erinnerung an alle, die noch nicht angemeldet sind
  for l in select * from public.leagues
            where not reminder_sent and not started and now() >= signup_until - interval '7 hours' and now() < signup_until
            for update skip locked loop
    perform public.send_push(
      array(select p.id from public.profiles p where not exists (select 1 from public.league_members m where m.league_id = l.id and m.user_id = p.id)),
      'Weekend League', 'Anmeldung nur noch bis heute 23:59. Am Wochenende: 7 Runden, alle gegen alle.', '/#/liga');
    update public.leagues set reminder_sent = true where id = l.id;
    v_out := v_out || jsonb_build_object('erinnert', l.week_start);
  end loop;

  -- Samstag 00:00: Runden anlegen
  for l in select * from public.leagues where not started and now() >= starts_at for update skip locked loop
    v_mem := array(select user_id from public.league_members where league_id = l.id order by joined_at);
    if cardinality(v_mem) >= 2 then
      for i in 0..6 loop
        insert into public.league_rounds (league_id, position, kind, hard, game_id)
        values (l.id, i + 1, v_plan->i->>'k', (v_plan->i->>'h')::boolean,
                public._league_make_round(v_mem, v_plan->i->>'k', (v_plan->i->>'h')::boolean));
      end loop;
      perform public.send_push(v_mem, 'Die Weekend League läuft',
        cardinality(v_mem) || ' Leute, 7 Runden, Zeit bis Sonntag 23:59. Viel Glück!', '/#/liga');
    end if;
    update public.leagues set started = true where id = l.id;
    v_out := v_out || jsonb_build_object('gestartet', l.week_start, 'mitglieder', cardinality(v_mem));
  end loop;

  -- Montag 00:00: offene Runden schließen, Ergebnis verschicken
  for l in select * from public.leagues where started and not closed and now() >= ends_at for update skip locked loop
    update public.games g set status = 'closed', finished_at = coalesce(g.finished_at, l.ends_at)
     where g.id in (select game_id from public.league_rounds where league_id = l.id) and g.status = 'open';
    update public.leagues set closed = true where id = l.id;
    select * into v_win from public._league_standings(l.id) order by rnk limit 1;
    if v_win.user_id is not null then
      v_mem := array(select user_id from public.league_members where league_id = l.id);
      perform public.send_push(v_mem, 'Weekend League beendet',
        v_win.display_name || ' gewinnt mit ' || trim(to_char(v_win.points, 'FM990.0')) || ' Punkten.', '/#/liga');
    end if;
    v_out := v_out || jsonb_build_object('beendet', l.week_start);
  end loop;
  return v_out;
end
$$;
revoke execute on function public._league_tick() from public, anon, authenticated;
revoke execute on function public._league_make_round(uuid[], text, boolean) from public, anon, authenticated;
revoke execute on function public._league_for(date) from public, anon, authenticated;

-- Für den Zeitplan (GitHub): macht nur die fälligen Schritte, gibt nichts preis
create or replace function public.league_tick()
returns jsonb
language sql security definer set search_path = public
as $$ select public._league_tick() $$;
grant execute on function public.league_tick() to anon, authenticated;

create or replace function public._league_json(p_league bigint, p_me uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', l.id,
    'week_start', l.week_start,
    'signup_until', l.signup_until,
    'starts_at', l.starts_at,
    'ends_at', l.ends_at,
    'phase', case when now() < l.starts_at then 'signup' when now() < l.ends_at then 'running' else 'done' end,
    'started', l.started,
    'joined', exists (select 1 from public.league_members m where m.league_id = l.id and m.user_id = p_me),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', p.display_name) order by m.joined_at), '[]'::jsonb)
                  from public.league_members m join public.profiles p on p.id = m.user_id where m.league_id = l.id),
    'rounds', (select coalesce(jsonb_agg(jsonb_build_object(
                  'position', r.position, 'kind', r.kind, 'hard', r.hard, 'game_id', r.game_id,
                  'my_status', (select gp.status from public.game_players gp where gp.game_id = r.game_id and gp.user_id = p_me),
                  'my_points', (select s.points from public._league_scores(l.id) s where s.user_id = p_me and s.pos = r.position),
                  'done_count', (select count(*) from public.game_players gp where gp.game_id = r.game_id and gp.status = 'done')
                ) order by r.position), '[]'::jsonb)
                 from public.league_rounds r where r.league_id = l.id),
    'standings', (select coalesce(jsonb_agg(jsonb_build_object(
                     'user_id', s.user_id, 'display_name', s.display_name, 'points', s.points,
                     'rounds', s.rounds, 'total_ms', s.total_ms, 'rank', s.rnk) order by s.rnk, s.display_name), '[]'::jsonb)
                    from public._league_standings(l.id) s)
  )
    from public.leagues l where l.id = p_league
$$;
revoke execute on function public._league_json(bigint, uuid) from public, anon, authenticated;

create or replace function public.league_status()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_cur  public.leagues;
  v_last bigint;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  perform public._league_tick();
  v_cur := public._league_for(public._league_week());
  select id into v_last from public.leagues where closed and id <> v_cur.id order by week_start desc limit 1;
  return jsonb_build_object(
    'current', public._league_json(v_cur.id, auth.uid()),
    'last', case when v_last is not null then public._league_json(v_last, auth.uid()) end
  );
end
$$;

create or replace function public.league_join(p_join boolean default true)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v public.leagues;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  v := public._league_for(public._league_week());
  if now() >= v.signup_until then
    raise exception 'Die Anmeldung ist geschlossen. Nächste Woche geht es wieder.';
  end if;
  if p_join then
    insert into public.league_members (league_id, user_id) values (v.id, auth.uid()) on conflict do nothing;
  else
    delete from public.league_members where league_id = v.id and user_id = auth.uid();
  end if;
  return public.league_status();
end
$$;

revoke execute on function public.league_status() from public, anon;
revoke execute on function public.league_join(boolean) from public, anon;
grant execute on function public.league_status() to authenticated;
grant execute on function public.league_join(boolean) to authenticated;
