-- =====================================================================
-- Musikrunde
-- 30-Sekunden-Ausschnitte (iTunes), zweistufig: erst Interpret, dann Titel.
-- Pro Song 2 Punkte möglich (Interpret + Titel), 5 Songs pro Runde.
-- Eigene Rangliste, eigenes Tageslimit (3 Wertungsspiele pro Tag).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Songs
-- ---------------------------------------------------------------------
create table public.songs (
  id          bigint generated always as identity primary key,
  itunes_id   bigint unique,
  artist      text not null check (char_length(artist) between 1 and 120),
  title       text not null check (char_length(title) between 1 and 160),
  genre       text,
  decade      smallint,
  artwork_url text,
  preview_url text,
  added_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  source      text not null default 'spieler' check (source in ('startpaket', 'spieler')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index songs_active_idx on public.songs (is_active) where preview_url is not null;

alter table public.songs enable row level security;
-- Lesen nur Admin und wer den Song hinzugefügt hat (sonst wäre die Lösung abrufbar)
create policy "Eigene Songs lesen" on public.songs for select to authenticated
  using (added_by = auth.uid() or public.is_admin());
create policy "Songs hinzufügen" on public.songs for insert to authenticated
  with check (added_by = auth.uid() and source = 'spieler'
              and preview_url ~* '^https://[a-z0-9.-]*(apple|mzstatic)\.com/'
              and (artwork_url is null or artwork_url ~* '^https://[a-z0-9.-]*(apple|mzstatic)\.com/'));
create policy "Songs ändern" on public.songs for update to authenticated
  using (added_by = auth.uid() or public.is_admin()) with check (added_by = auth.uid() or public.is_admin());
create policy "Songs löschen" on public.songs for delete to authenticated
  using (public.is_admin());
revoke all on public.songs from anon, authenticated;
grant select, insert, delete on public.songs to authenticated;
grant update (artist, title, genre, decade, is_active) on public.songs to authenticated;

-- ---------------------------------------------------------------------
-- Spiele: Art (Quiz oder Musik)
-- ---------------------------------------------------------------------
alter table public.games add column kind text not null default 'quiz' check (kind in ('quiz', 'music'));

create table public.music_game_songs (
  game_id        bigint not null references public.games(id) on delete cascade,
  position       smallint not null check (position between 1 and 5),
  song_id        bigint not null references public.songs(id),
  artist_options text[] not null,
  artist_correct smallint not null,
  title_options  text[] not null,
  title_correct  smallint not null,
  primary key (game_id, position)
);

create table public.music_answers (
  game_id      bigint not null,
  user_id      uuid not null,
  position     smallint not null check (position between 1 and 5),
  artist_choice smallint,
  title_choice  smallint,
  artist_ok    boolean,
  title_ok     boolean,
  ms           integer,
  shown_at     timestamptz not null default now(),
  answered_at  timestamptz,
  primary key (game_id, user_id, position),
  foreign key (game_id, user_id) references public.game_players (game_id, user_id) on delete cascade
);

alter table public.music_game_songs enable row level security;
alter table public.music_answers enable row level security;
-- Kein direkter Zugriff, alles über Funktionen
revoke all on public.music_game_songs, public.music_answers from anon, authenticated;

-- ---------------------------------------------------------------------
-- Wertung: _game_ranks pro Art
-- ---------------------------------------------------------------------
drop function if exists public._game_ranks(timestamptz, timestamptz);

create function public._game_ranks(p_from timestamptz default null, p_to timestamptz default null, p_kind text default 'quiz')
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
revoke execute on function public._game_ranks(timestamptz, timestamptz, text) from public, anon, authenticated;

-- Rangliste mit Art
drop function if exists public.leaderboard(text, date);
create function public.leaderboard(p_period text default 'month', p_month date default null, p_kind text default 'quiz')
returns table (user_id uuid, display_name text, points integer, wins integer, games integer, correct_rate numeric)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_from timestamptz;
  v_to   timestamptz;
begin
  if p_period = 'month' then
    v_from := date_trunc('month', coalesce(p_month::timestamp, now() at time zone 'Europe/Berlin')) at time zone 'Europe/Berlin';
    v_to   := (date_trunc('month', coalesce(p_month::timestamp, now() at time zone 'Europe/Berlin')) + interval '1 month') at time zone 'Europe/Berlin';
  end if;

  return query
  with ranks as (
    select * from public._game_ranks(v_from, v_to, p_kind)
  ),
  ans as (
    -- Quiz: richtige Antworten; Musik: richtige Teile (Interpret und Titel einzeln)
    select x.user_id, sum(x.ok) as ok, sum(x.total) as total
      from (
        select a.user_id, (a.is_correct)::int as ok, 1 as total, a.answered_at
          from public.answers a join public.games g on g.id = a.game_id
         where p_kind = 'quiz' and a.answered_at is not null and g.mode <> 'solo'
        union all
        select m.user_id, coalesce(m.artist_ok::int, 0) + coalesce(m.title_ok::int, 0), 2, m.answered_at
          from public.music_answers m join public.games g on g.id = m.game_id
         where p_kind = 'music' and m.answered_at is not null and g.mode <> 'solo'
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
revoke execute on function public.leaderboard(text, date, text) from public, anon;
grant execute on function public.leaderboard(text, date, text) to authenticated;

drop function if exists public.my_day_status();
create function public.my_day_status(p_kind text default 'quiz')
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
           (date_trunc('day', now() at time zone 'Europe/Berlin') + interval '1 day') at time zone 'Europe/Berlin',
           p_kind) gr
   where gr.user_id = auth.uid()
$$;
revoke execute on function public.my_day_status(text) from public, anon;
grant execute on function public.my_day_status(text) to authenticated;

-- Übersicht für den Start-Tab, jetzt mit Art
create or replace function public.my_games()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.sort_at desc), '[]'::jsonb)
    from (
      select g.id, g.mode, g.kind, g.status, g.created_at, g.finished_at, g.created_by,
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
                       'total_ms', case when mine.status = 'done' or g.status <> 'open' then gp.total_ms end
                     ) order by gp.user_id = g.created_by desc, p.display_name)
                from public.game_players gp join public.profiles p on p.id = gp.user_id
               where gp.game_id = g.id) as players
        from public.games g
        join public.game_players mine on mine.game_id = g.id and mine.user_id = auth.uid()
       where (g.mode <> 'solo' or g.status = 'open')
         and (g.status = 'open' or g.finished_at > now() - interval '30 days')
       order by coalesce(g.finished_at, g.created_at) desc
       limit 60
    ) x
$$;

-- Quiz-Funktionen dürfen keine Musikspiele anfassen
create or replace function public._assert_kind(p_game_id bigint, p_kind text)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.games where id = p_game_id and kind = p_kind) then
    raise exception 'Falsche Spielart.';
  end if;
end
$$;
revoke execute on function public._assert_kind(bigint, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Songs auswählen und Antwortmöglichkeiten bauen
-- ---------------------------------------------------------------------
create or replace function public._pick_songs(p_players uuid[], p_count int)
returns table (song_id bigint)
language sql volatile security definer set search_path = public
as $$
  with eligible as (
    select s.id,
           (select max(m.shown_at) from public.music_answers m
              join public.music_game_songs mg on mg.game_id = m.game_id and mg.position = m.position
             where mg.song_id = s.id and m.user_id = any (p_players)) as last_seen,
           random() as r
      from public.songs s
     where s.is_active and s.preview_url is not null
       and (s.added_by is null or s.added_by <> all (p_players))
  )
  -- Pro Runde möglichst verschiedene Interpreten
  select id from (
    select e.*, row_number() over (partition by lower(s.artist) order by (e.last_seen is not null), e.last_seen nulls first, e.r) as nth
      from eligible e join public.songs s on s.id = e.id
  ) x
   order by nth, (last_seen is not null), last_seen nulls first, r
   limit p_count
$$;

create or replace function public._song_options(p_song_id bigint, p_used_artists text[])
returns table (artist_options text[], artist_correct smallint, title_options text[], title_correct smallint)
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_song    public.songs;
  v_artists text[];
  v_titles  text[];
  v_order   smallint[];
begin
  select * into v_song from public.songs where id = p_song_id;

  -- Falsche Interpreten: gleiches Genre bevorzugt, dann gleiches Jahrzehnt, dann beliebig
  select array_agg(a) into v_artists from (
    select a from (
      select distinct on (lower(s.artist)) s.artist as a,
             (s.genre is not distinct from v_song.genre) as same_genre,
             (s.decade is not distinct from v_song.decade) as same_decade
        from public.songs s
       where s.is_active and lower(s.artist) <> lower(v_song.artist)
       order by lower(s.artist), random()
    ) t
    order by same_genre desc, same_decade desc, random()
    limit 3
  ) x;

  -- Falsche Titel: andere Songs desselben Interpreten, dann gleiches Genre/Jahrzehnt
  select array_agg(t) into v_titles from (
    select t from (
      select distinct on (lower(s.title)) s.title as t,
             (lower(s.artist) = lower(v_song.artist)) as same_artist,
             (s.genre is not distinct from v_song.genre) as same_genre,
             (s.decade is not distinct from v_song.decade) as same_decade
        from public.songs s
       where s.is_active and lower(s.title) <> lower(v_song.title)
       order by lower(s.title), random()
    ) y
    order by same_artist desc, same_genre desc, same_decade desc, random()
    limit 3
  ) x;

  if coalesce(cardinality(v_artists), 0) < 3 or coalesce(cardinality(v_titles), 0) < 3 then
    raise exception 'Zu wenige Songs für eine Musikrunde.';
  end if;

  v_order := public._shuffled_order();
  artist_options := array(select case o when 0 then v_song.artist else v_artists[o] end from unnest(v_order) with ordinality t(o, i) order by i);
  artist_correct := (array_position(v_order, 0::smallint) - 1)::smallint;
  v_order := public._shuffled_order();
  title_options := array(select case o when 0 then v_song.title else v_titles[o] end from unnest(v_order) with ordinality t(o, i) order by i);
  title_correct := (array_position(v_order, 0::smallint) - 1)::smallint;
  return next;
end
$$;
revoke execute on function public._pick_songs(uuid[], int) from public, anon, authenticated;
revoke execute on function public._song_options(bigint, text[]) from public, anon, authenticated;

create or replace function public.create_music_game(p_mode text, p_invitees uuid[] default '{}')
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_players uuid[];
  v_game    bigint;
  v_ids     bigint[];
  v_name    text;
  i         int;
  o         record;
begin
  if v_me is null then
    raise exception 'Nicht angemeldet';
  end if;
  p_invitees := coalesce(array(select distinct u from unnest(coalesce(p_invitees, '{}')) u where u <> v_me), '{}');
  if p_mode = 'solo' then
    p_invitees := '{}';
  elsif p_mode = 'duel' then
    if cardinality(p_invitees) <> 1 then raise exception 'Ein Duell braucht genau einen Gegner.'; end if;
  elsif p_mode = 'challenge' then
    if cardinality(p_invitees) < 1 then raise exception 'Wähle mindestens eine Person für die Challenge.'; end if;
  else
    raise exception 'Unbekannter Spielmodus: %', p_mode;
  end if;
  if (select count(*) from public.profiles where id = any (p_invitees)) <> cardinality(p_invitees) then
    raise exception 'Mindestens ein Mitspieler existiert nicht.';
  end if;

  v_players := array[v_me] || p_invitees;
  v_ids := array(select song_id from public._pick_songs(v_players, 5));
  if cardinality(v_ids) < 5 then
    raise exception 'Es gibt nur % passende Songs, für eine Musikrunde braucht es 5.', cardinality(v_ids);
  end if;

  insert into public.games (mode, kind, created_by) values (p_mode, 'music', v_me) returning id into v_game;
  for i in 1..5 loop
    select * into o from public._song_options(v_ids[i], '{}');
    insert into public.music_game_songs (game_id, position, song_id, artist_options, artist_correct, title_options, title_correct)
    values (v_game, i, v_ids[i], o.artist_options, o.artist_correct, o.title_options, o.title_correct);
  end loop;
  insert into public.game_players (game_id, user_id) select v_game, unnest(v_players);

  if p_mode = 'challenge' then
    select display_name into v_name from public.profiles where id = v_me;
    perform public.send_push(p_invitees, 'Neue Musik-Challenge',
      v_name || ' fordert dich heraus. 5 Songs warten auf dich.', '/#/musik/' || v_game);
  end if;
  return v_game;
end
$$;

create or replace function public._finish_music_player(p_game_id bigint, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_game    public.games;
  v_name    text;
  v_pending int;
  v_total   int;
  r         record;
begin
  update public.game_players gp
     set status = 'done',
         finished_at = now(),
         score = (select coalesce(sum(coalesce(m.artist_ok::int, 0) + coalesce(m.title_ok::int, 0)), 0)
                    from public.music_answers m where m.game_id = p_game_id and m.user_id = p_user),
         total_ms = (select coalesce(sum(m.ms), 0) from public.music_answers m where m.game_id = p_game_id and m.user_id = p_user)
   where gp.game_id = p_game_id and gp.user_id = p_user;

  select * into v_game from public.games where id = p_game_id;
  select display_name into v_name from public.profiles where id = p_user;
  select count(*) into v_pending from public.game_players where game_id = p_game_id and status = 'pending';

  if v_game.mode = 'solo' then
    update public.games set status = 'finished', finished_at = now() where id = p_game_id;
    return;
  end if;

  if v_game.mode = 'duel' and p_user = v_game.created_by and v_pending > 0 then
    perform public.send_push(
      array(select user_id from public.game_players where game_id = p_game_id and user_id <> p_user),
      'Neues Musik-Duell', v_name || ' hat dich zum Musik-Duell herausgefordert.', '/#/musik/' || p_game_id);
  end if;

  if v_pending = 0 then
    update public.games set status = 'finished', finished_at = now() where id = p_game_id and status = 'open';
    select count(*) into v_total from public.game_players where game_id = p_game_id;
    for r in select gr.user_id, gr.rnk, gr.score from public._game_ranks(null, null, 'music') gr where gr.game_id = p_game_id loop
      continue when r.user_id = p_user;
      if v_game.mode = 'duel' then
        perform public.send_push(array[r.user_id], 'Musik-Duell gegen ' || v_name || ' ist fertig',
          case when r.rnk = 1 then 'Gewonnen! ' else 'Verloren. ' end || 'Du hattest ' || r.score || ' von 10 Punkten.',
          '/#/musik/' || p_game_id);
      else
        perform public.send_push(array[r.user_id], 'Musik-Challenge ist fertig',
          'Du bist auf Platz ' || r.rnk || ' von ' || v_total || '.', '/#/musik/' || p_game_id);
      end if;
    end loop;
  end if;
end
$$;
revoke execute on function public._finish_music_player(bigint, uuid) from public, anon, authenticated;

create or replace function public._record_music_answer(p_game_id bigint, p_user uuid, p_position smallint, p_artist smallint, p_title smallint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ans  public.music_answers;
  v_gs   public.music_game_songs;
  v_song public.songs;
  v_ms   int;
  v_late boolean;
begin
  select * into v_ans from public.music_answers
   where game_id = p_game_id and user_id = p_user and position = p_position for update;
  if not found or v_ans.answered_at is not null then
    raise exception 'Dieser Song ist nicht offen.';
  end if;
  select * into v_gs from public.music_game_songs where game_id = p_game_id and position = p_position;
  select * into v_song from public.songs where id = v_gs.song_id;

  v_late := now() - v_ans.shown_at > interval '32 seconds';
  if v_late then
    p_artist := null;
    p_title := null;
  end if;
  v_ms := case when v_late then 30000 else least(30000, (extract(epoch from (now() - v_ans.shown_at)) * 1000)::int) end;

  update public.music_answers
     set artist_choice = p_artist, title_choice = p_title,
         artist_ok = coalesce(p_artist = v_gs.artist_correct, false),
         title_ok = coalesce(p_title = v_gs.title_correct, false),
         ms = v_ms, answered_at = now()
   where game_id = p_game_id and user_id = p_user and position = p_position;

  if p_position = 5 then
    perform public._finish_music_player(p_game_id, p_user);
  end if;

  return jsonb_build_object(
    'position', p_position,
    'artist_correct', v_gs.artist_correct,
    'title_correct', v_gs.title_correct,
    'artist_ok', coalesce(p_artist = v_gs.artist_correct, false),
    'title_ok', coalesce(p_title = v_gs.title_correct, false),
    'timed_out', v_late or (p_artist is null and p_title is null),
    'artist', v_song.artist,
    'title', v_song.title,
    'artwork_url', v_song.artwork_url,
    'itunes_id', v_song.itunes_id,
    'finished', p_position = 5
  );
end
$$;
revoke execute on function public._record_music_answer(bigint, uuid, smallint, smallint, smallint) from public, anon, authenticated;

-- Nächster Song (ohne Lösung). Startet die 30 Sekunden.
create or replace function public.music_next(p_game_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_game   public.games;
  v_player public.game_players;
  v_ans    public.music_answers;
  v_pos    smallint;
  v_gs     public.music_game_songs;
  v_song   public.songs;
begin
  perform public._assert_kind(p_game_id, 'music');
  select * into v_game from public.games where id = p_game_id;
  select * into v_player from public.game_players where game_id = p_game_id and user_id = v_me for update;
  if not found then raise exception 'Du spielst in diesem Spiel nicht mit.'; end if;
  if v_player.status = 'done' then return jsonb_build_object('done', true); end if;
  if v_game.status = 'closed' then raise exception 'Diese Challenge wurde schon geschlossen.'; end if;
  if v_game.mode = 'duel' and v_game.created_by <> v_me and exists (
       select 1 from public.game_players where game_id = p_game_id and user_id = v_game.created_by and status <> 'done') then
    raise exception 'Dein Gegner spielt seine Songs noch. Du bekommst einen Push, sobald du dran bist.';
  end if;

  select * into v_ans from public.music_answers where game_id = p_game_id and user_id = v_me and answered_at is null;
  if found then
    if now() - v_ans.shown_at > interval '32 seconds' then
      perform public._record_music_answer(p_game_id, v_me, v_ans.position, null, null);
      if v_ans.position = 5 then return jsonb_build_object('done', true); end if;
    else
      v_pos := v_ans.position;
    end if;
  end if;
  if v_pos is null then
    select (coalesce(max(position), 0) + 1)::smallint into v_pos from public.music_answers where game_id = p_game_id and user_id = v_me;
    if v_pos > 5 then return jsonb_build_object('done', true); end if;
    insert into public.music_answers (game_id, user_id, position) values (p_game_id, v_me, v_pos) returning * into v_ans;
  end if;

  select * into v_gs from public.music_game_songs where game_id = p_game_id and position = v_pos;
  select * into v_song from public.songs where id = v_gs.song_id;
  return jsonb_build_object(
    'done', false,
    'position', v_pos,
    'total', 5,
    'preview_url', v_song.preview_url,
    'song_ref', v_song.id,
    'artist_options', to_jsonb(v_gs.artist_options),
    'title_options', to_jsonb(v_gs.title_options),
    'seconds_left', greatest(0, 30 - extract(epoch from (now() - v_ans.shown_at)))
  );
end
$$;

create or replace function public.music_answer(p_game_id bigint, p_position smallint, p_artist smallint, p_title smallint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  perform public._assert_kind(p_game_id, 'music');
  if not exists (select 1 from public.game_players where game_id = p_game_id and user_id = auth.uid() and status = 'pending') then
    raise exception 'Du kannst in diesem Spiel nicht (mehr) antworten.';
  end if;
  return public._record_music_answer(p_game_id, auth.uid(), p_position, p_artist, p_title);
end
$$;

create or replace function public.music_game_details(p_game_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_game   public.games;
  v_mine   public.game_players;
  v_reveal boolean;
  v_creator_done boolean;
begin
  perform public._assert_kind(p_game_id, 'music');
  select * into v_game from public.games where id = p_game_id;
  select * into v_mine from public.game_players where game_id = p_game_id and user_id = v_me;
  if v_mine.user_id is null then raise exception 'Spiel nicht gefunden.'; end if;
  v_reveal := v_mine.status = 'done' or v_game.status <> 'open';
  select status = 'done' into v_creator_done from public.game_players where game_id = p_game_id and user_id = v_game.created_by;

  return jsonb_build_object(
    'id', v_game.id,
    'mode', v_game.mode,
    'status', v_game.status,
    'created_by', v_game.created_by,
    'my_status', v_mine.status,
    'can_play', v_mine.status = 'pending' and v_game.status = 'open'
                and (v_game.mode <> 'duel' or v_game.created_by = v_me or v_creator_done),
    'started', exists (select 1 from public.music_answers where game_id = p_game_id and user_id = v_me),
    'can_nudge', v_mine.status = 'done' and v_game.status = 'open'
                 and (v_mine.last_nudge_at is null or v_mine.last_nudge_at <= now() - interval '20 hours')
                 and exists (select 1 from public.game_players where game_id = p_game_id and status = 'pending'),
    'can_close', v_game.mode = 'challenge' and v_game.status = 'open' and (v_game.created_by = v_me or public.is_admin()),
    'my_points', (select jsonb_build_object('points', gr.points, 'raw_points', gr.raw_points, 'counted', gr.counted, 'day_index', gr.day_index)
                    from public._game_ranks(null, null, 'music') gr where gr.game_id = p_game_id and gr.user_id = v_me),
    'players', (
      select jsonb_agg(jsonb_build_object(
               'user_id', gp.user_id, 'display_name', p.display_name, 'status', gp.status,
               'score', case when v_reveal and gp.status = 'done' then gp.score end,
               'total_ms', case when v_reveal and gp.status = 'done' then gp.total_ms end,
               'rank', case when v_reveal and gp.status = 'done'
                            then (select count(*) + 1 from public.game_players o
                                   where o.game_id = gp.game_id and o.status = 'done'
                                     and (o.score > gp.score or (o.score = gp.score and o.total_ms < gp.total_ms))) end
             ) order by (gp.status = 'done') desc, gp.score desc, gp.total_ms, p.display_name)
        from public.game_players gp join public.profiles p on p.id = gp.user_id
       where gp.game_id = p_game_id
    ),
    'songs', case when not v_reveal then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object(
               'position', mg.position,
               'artist', s.artist, 'title', s.title, 'artwork_url', s.artwork_url, 'itunes_id', s.itunes_id,
               'preview_url', s.preview_url,
               'artist_options', to_jsonb(mg.artist_options), 'artist_correct', mg.artist_correct,
               'title_options', to_jsonb(mg.title_options), 'title_correct', mg.title_correct,
               'added_by', (select display_name from public.profiles where id = s.added_by),
               'answers', (
                 select coalesce(jsonb_object_agg(m.user_id, jsonb_build_object(
                          'artist_choice', m.artist_choice, 'title_choice', m.title_choice,
                          'artist_ok', m.artist_ok, 'title_ok', m.title_ok, 'ms', m.ms)), '{}'::jsonb)
                   from public.music_answers m
                   join public.game_players gp2 on gp2.game_id = m.game_id and gp2.user_id = m.user_id and gp2.status = 'done'
                  where m.game_id = mg.game_id and m.position = mg.position
               )
             ) order by mg.position), '[]'::jsonb)
        from public.music_game_songs mg join public.songs s on s.id = mg.song_id
       where mg.game_id = p_game_id
    ) end
  );
end
$$;

-- Wie viele Songs gibt es (für Fragen-Tab und Admin)
create or replace function public.song_counts()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'total', count(*) filter (where is_active and preview_url is not null),
    'mine', count(*) filter (where added_by = auth.uid()),
    'by_genre', (select coalesce(jsonb_object_agg(g, n), '{}'::jsonb) from (
        select coalesce(genre, 'Sonstiges') g, count(*) n from public.songs
         where is_active and preview_url is not null group by 1) x)
  ) from public.songs
$$;

-- Gibt es den Song schon? (für die Suche beim Hinzufügen)
create or replace function public.songs_known(p_itunes_ids bigint[])
returns bigint[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(itunes_id), '{}') from public.songs where itunes_id = any (p_itunes_ids)
$$;


revoke execute on function public.create_music_game(text, uuid[]) from public, anon;
revoke execute on function public.music_next(bigint) from public, anon;
revoke execute on function public.music_answer(bigint, smallint, smallint, smallint) from public, anon;
revoke execute on function public.music_game_details(bigint) from public, anon;
revoke execute on function public.song_counts() from public, anon;
revoke execute on function public.songs_known(bigint[]) from public, anon;
grant execute on function public.create_music_game(text, uuid[]) to authenticated;
grant execute on function public.music_next(bigint) to authenticated;
grant execute on function public.music_answer(bigint, smallint, smallint, smallint) to authenticated;
grant execute on function public.music_game_details(bigint) to authenticated;
grant execute on function public.song_counts() to authenticated;
grant execute on function public.songs_known(bigint[]) to authenticated;

-- Anstupsen verlinkt je nach Spielart
create or replace function public.nudge(p_game_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_player  public.game_players;
  v_game    public.games;
  v_pending uuid[];
  v_name    text;
begin
  select * into v_game from public.games where id = p_game_id;
  select * into v_player from public.game_players where game_id = p_game_id and user_id = v_me for update;
  if not found or v_game.status <> 'open' then
    raise exception 'Dieses Spiel ist nicht mehr offen.';
  end if;
  if v_player.status <> 'done' then
    raise exception 'Spiel erst deine eigenen Fragen.';
  end if;
  if v_player.last_nudge_at is not null and v_player.last_nudge_at > now() - interval '20 hours' then
    raise exception 'Du hast heute schon angestupst. Morgen geht es wieder.';
  end if;

  select array_agg(user_id) into v_pending from public.game_players where game_id = p_game_id and status = 'pending';
  if v_pending is null then
    raise exception 'Alle haben schon gespielt.';
  end if;

  update public.game_players set last_nudge_at = now() where game_id = p_game_id and user_id = v_me;
  select display_name into v_name from public.profiles where id = v_me;
  perform public.send_push(v_pending, 'Anstupser', v_name || ' wartet auf deinen Zug.',
    case when v_game.kind = 'music' then '/#/musik/' else '/#/spiel/' end || p_game_id);
end
$$;
