-- =====================================================================
-- Musikrunde: Hard-Mode
-- Statt 4 Antworten tippt man den Song selbst und wählt ihn aus einer
-- Vorschlagsliste. Die Liste kommt aus dem Song-Pool plus einem großen Katalog
-- (weitere Songs derselben Interpreten), damit Interpret-Wissen allein nicht reicht.
-- 45 Sekunden pro Song, Punkte wie im normalen Modus (Interpret + Titel).
-- =====================================================================

-- Gleiche Schreibweise für Vergleiche: klein, ohne Akzente, ohne Klammerzusätze
create or replace function public._song_norm(p text)
returns text
language sql immutable parallel safe
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   replace(translate(lower(coalesce(p, '')), 'äöüàáâãåèéêëìíîïòóôõùúûñçýÿ', 'aouaaaaaeeeeiiiioooouuuncyy'), 'ß', 'ss'),
                   '\s*[\(\[][^\)\]]*[\)\]]', ' ', 'g'),     -- (Remastered), [Live]
                 '\s+-\s+.*$', ''),                          -- "Titel - Remastered 2011"
               '\s(feat\.?|ft\.?|featuring)\s.*$', ''),       -- feat. …
             '^the\s+', ''),
           '[^a-z0-9]+', '', 'g')
$$;

create or replace function public._artist_matches(p_guess text, p_real text)
returns boolean
language sql immutable
as $$
  select case
    when public._song_norm(p_guess) = '' then false
    when public._song_norm(p_guess) = public._song_norm(p_real) then true
    -- "Peter Fox" vs "Peter Fox & Cold Steel", "EAV" vs "EAV (Erste Allgemeine Verunsicherung)"
    when least(length(public._song_norm(p_guess)), length(public._song_norm(p_real))) >= 4
         and (strpos(public._song_norm(p_guess), public._song_norm(p_real)) = 1
              or strpos(public._song_norm(p_real), public._song_norm(p_guess)) = 1) then true
    else false
  end
$$;

create or replace function public._title_matches(p_guess text, p_real text)
returns boolean
language sql immutable
as $$
  select public._song_norm(p_guess) <> '' and public._song_norm(p_guess) = public._song_norm(p_real)
$$;

-- Katalog für die Vorschlagsliste
create table public.song_catalog (
  id          bigint generated always as identity primary key,
  itunes_id   bigint,
  artist      text not null check (char_length(artist) between 1 and 160),
  title       text not null check (char_length(title) between 1 and 200),
  norm_artist text generated always as (public._song_norm(artist)) stored,
  norm_title  text generated always as (public._song_norm(title)) stored,
  created_at  timestamptz not null default now()
);
create unique index song_catalog_key on public.song_catalog (norm_artist, norm_title);
create index song_catalog_artist on public.song_catalog (norm_artist);
alter table public.song_catalog enable row level security;
revoke all on public.song_catalog from anon, authenticated;

alter table public.games add column music_hard boolean not null default false;
alter table public.music_answers add column guess_artist text, add column guess_title text;

-- Vorschläge: Pool + Katalog, alphabetisch (damit der Hit nicht automatisch oben steht)
create or replace function public.music_search(p_query text)
returns table (artist text, title text)
language sql stable security definer set search_path = public
as $$
  with q as (select public._song_norm(p_query) as n)
  select x.artist, x.title from (
    select distinct on (u.na, u.nt) u.artist, u.title, u.na, u.nt from (
      select s.artist, s.title, public._song_norm(s.artist) na, public._song_norm(s.title) nt, 0 pref
        from public.songs s where s.is_active
      union all
      select c.artist, c.title, c.norm_artist, c.norm_title, 1 from public.song_catalog c
    ) u, q
    where length(q.n) >= 3 and (strpos(u.nt, q.n) > 0 or strpos(u.na, q.n) > 0)
    order by u.na, u.nt, u.pref
  ) x, q
  order by (strpos(x.nt, q.n) = 1) desc, (strpos(x.na, q.n) = 1) desc, lower(x.title), lower(x.artist)
  limit 8
$$;
revoke execute on function public.music_search(text) from public, anon;
grant execute on function public.music_search(text) to authenticated;

drop function public.create_music_game(text, uuid[]);
drop function public._record_music_answer(bigint, uuid, smallint, smallint, smallint);

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

  -- Falsche Titel: andere Songs desselben Interpreten (auch aus dem Katalog), dann gleiches Genre/Jahrzehnt
  select array_agg(t) into v_titles from (
    select t from (
      select distinct on (public._song_norm(u.t)) u.t, u.same_artist, u.same_genre, u.same_decade
        from (
          select s.title as t,
                 (public._song_norm(s.artist) = public._song_norm(v_song.artist)) as same_artist,
                 (s.genre is not distinct from v_song.genre) as same_genre,
                 (s.decade is not distinct from v_song.decade) as same_decade
            from public.songs s
           where s.is_active
          union all
          select c.title, true, true, true
            from public.song_catalog c
           where c.norm_artist = public._song_norm(v_song.artist)
        ) u
       where public._song_norm(u.t) <> public._song_norm(v_song.title) and public._song_norm(u.t) <> ''
       order by public._song_norm(u.t), random()
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

create function public.create_music_game(p_mode text, p_invitees uuid[] default '{}', p_hard boolean default false)
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

  insert into public.games (mode, kind, music_hard, created_by) values (p_mode, 'music', coalesce(p_hard, false), v_me) returning id into v_game;
  for i in 1..5 loop
    select * into o from public._song_options(v_ids[i], '{}');
    insert into public.music_game_songs (game_id, position, song_id, artist_options, artist_correct, title_options, title_correct)
    values (v_game, i, v_ids[i], o.artist_options, o.artist_correct, o.title_options, o.title_correct);
  end loop;
  insert into public.game_players (game_id, user_id) select v_game, unnest(v_players);

  if p_mode = 'challenge' then
    select display_name into v_name from public.profiles where id = v_me;
    perform public.send_push(p_invitees, case when p_hard then 'Neue Musik-Challenge (Hard)' else 'Neue Musik-Challenge' end,
      v_name || ' fordert dich heraus. 5 Songs warten auf dich.', '/#/musik/' || v_game);
  end if;
  return v_game;
end
$$;

create function public._record_music_answer(p_game_id bigint, p_user uuid, p_position smallint, p_artist smallint, p_title smallint,
                                              p_guess_artist text default null, p_guess_title text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ans  public.music_answers;
  v_gs   public.music_game_songs;
  v_song public.songs;
  v_ms   int;
  v_late boolean;
  v_hard boolean;
  v_secs int;
  v_aok  boolean;
  v_tok  boolean;
begin
  select * into v_ans from public.music_answers
   where game_id = p_game_id and user_id = p_user and position = p_position for update;
  if not found or v_ans.answered_at is not null then
    raise exception 'Dieser Song ist nicht offen.';
  end if;
  select * into v_gs from public.music_game_songs where game_id = p_game_id and position = p_position;
  select * into v_song from public.songs where id = v_gs.song_id;

  v_hard := coalesce((select music_hard from public.games where id = p_game_id), false);
  v_secs := case when v_hard then 45 else 30 end;
  v_late := now() - v_ans.shown_at > make_interval(secs => v_secs + 2);
  if v_hard then
    p_artist := null;
    p_title := null;
  else
    p_guess_artist := null;
    p_guess_title := null;
  end if;
  if v_late then
    p_artist := null;
    p_title := null;
    p_guess_artist := null;
    p_guess_title := null;
  end if;
  v_ms := case when v_late then v_secs * 1000 else least(v_secs * 1000, (extract(epoch from (now() - v_ans.shown_at)) * 1000)::int) end;
  if v_hard then
    v_aok := public._artist_matches(p_guess_artist, v_song.artist);
    v_tok := public._title_matches(p_guess_title, v_song.title);
  else
    v_aok := coalesce(p_artist = v_gs.artist_correct, false);
    v_tok := coalesce(p_title = v_gs.title_correct, false);
  end if;

  update public.music_answers
     set artist_choice = p_artist, title_choice = p_title,
         guess_artist = left(p_guess_artist, 160), guess_title = left(p_guess_title, 200),
         artist_ok = v_aok,
         title_ok = v_tok,
         ms = v_ms, answered_at = now()
   where game_id = p_game_id and user_id = p_user and position = p_position;

  if p_position = 5 then
    perform public._finish_music_player(p_game_id, p_user);
  end if;

  return jsonb_build_object(
    'position', p_position,
    'artist_correct', v_gs.artist_correct,
    'title_correct', v_gs.title_correct,
    'artist_ok', v_aok,
    'title_ok', v_tok,
    'timed_out', v_late or (p_artist is null and p_title is null and p_guess_artist is null and p_guess_title is null),
    'artist', v_song.artist,
    'title', v_song.title,
    'artwork_url', v_song.artwork_url,
    'itunes_id', v_song.itunes_id,
    'finished', p_position = 5
  );
end
$$;

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
  v_secs   int;
begin
  perform public._assert_kind(p_game_id, 'music');
  select * into v_game from public.games where id = p_game_id;
  v_secs := case when v_game.music_hard then 45 else 30 end;
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
    if now() - v_ans.shown_at > make_interval(secs => v_secs + 2) then
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
    'hard', v_game.music_hard,
    'seconds', v_secs,
    'artist_options', case when v_game.music_hard then '[]'::jsonb else to_jsonb(v_gs.artist_options) end,
    'title_options', case when v_game.music_hard then '[]'::jsonb else to_jsonb(v_gs.title_options) end,
    'seconds_left', greatest(0, v_secs - extract(epoch from (now() - v_ans.shown_at)))
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
    'hard', v_game.music_hard,
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
                          'guess_artist', m.guess_artist, 'guess_title', m.guess_title,
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

create or replace function public.music_answer_hard(p_game_id bigint, p_position smallint, p_artist text, p_title text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  perform public._assert_kind(p_game_id, 'music');
  if not exists (select 1 from public.game_players where game_id = p_game_id and user_id = auth.uid() and status = 'pending') then
    raise exception 'Du kannst in diesem Spiel nicht (mehr) antworten.';
  end if;
  return public._record_music_answer(p_game_id, auth.uid(), p_position, null, null, p_artist, p_title);
end
$$;

revoke execute on function public._record_music_answer(bigint, uuid, smallint, smallint, smallint, text, text) from public, anon, authenticated;
revoke execute on function public.create_music_game(text, uuid[], boolean) from public, anon;
grant execute on function public.create_music_game(text, uuid[], boolean) to authenticated;
revoke execute on function public.music_answer_hard(bigint, smallint, text, text) from public, anon;
grant execute on function public.music_answer_hard(bigint, smallint, text, text) to authenticated;
