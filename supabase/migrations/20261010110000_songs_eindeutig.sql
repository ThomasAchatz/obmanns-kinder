-- =====================================================================
-- Musik: jedes Lied nur einmal
-- Remaster, Remixe, Live-, Radio- und Jahres-Versionen („Lucky Love 2009“,
-- „One Moment In Time (2000 Remaster)“) zählen als dasselbe Lied. In der
-- Auswahl, in der Vorschlagsliste und pro Runde taucht jedes Lied nur einmal auf,
-- angezeigt ohne Versions-Zusatz. Bei Interpreten zählt der Hauptinterpret
-- („Peter Fox & Cold Steel“ = „Peter Fox“).
-- =====================================================================

-- Kern eines Titels zum Vergleichen
create or replace function public._title_core(p text)
returns text
language sql immutable parallel safe
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(
                     replace(translate(lower(coalesce(p, '')), 'äöüàáâãåèéêëìíîïòóôõùúûñçýÿ’`´', 'aouaaaaaeeeeiiiioooouuuncyy'''''), 'ß', 'ss'),
                     '\s*[\(\[\{][^\)\]\}]*[\)\]\}]', ' ', 'g'),                            -- (Remastered), [Live], (feat. …)
                   '\s+[-–—]\s+.*$', ''),                                                   -- „Titel - Remastered 2011“
                 '\s(feat\.?|ft\.?|featuring)\s.*$', ''),                                  -- feat. …
               '(\s+(19|20)\d\d)?\s+(re-?master(ed)?|remix(ed)?|radio edit|single edit|edit|version|live|mono|stereo|demo|acoustic|unplugged|extended( mix)?|club mix|mix|deluxe)(\s+(19|20)\d\d)?\s*$', ''),
             '\s+(19|20)\d\d\s*$', ''),                                                     -- „Wheel of Fortune 2009“
           '[^a-z0-9]+', '', 'g')
$$;

-- Hauptinterpret zum Vergleichen
create or replace function public._artist_primary(p text)
returns text
language sql immutable parallel safe
as $$
  select public._song_norm(
           (regexp_split_to_array(coalesce(p, ''), '\s*(,|&|\+|\s(feat\.?|ft\.?|featuring|x|und|and|with|vs\.?|mit)\s)\s*', 'i'))[1])
$$;

-- Titel ohne Versions-Zusatz für die Anzeige
create or replace function public._title_display(p text)
returns text
language sql immutable parallel safe
as $$
  select coalesce(nullif(btrim(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 coalesce(p, ''),
                 '\s*[\(\[][^\)\]]*(remaster|remix|mix|edit|version|live|mono|stereo|demo|acoustic|unplugged|deluxe|bonus|re-record|single|album|extended|instrumental|anniversary|from |soundtrack|feat|ft\.|with |duet|original|radio|mtv|session)[^\)\]]*[\)\]]', '', 'gi'),
               '\s+[-–—]\s+.*(remaster|remix|mix|edit|version|live|mono|stereo|demo|acoustic|unplugged|deluxe|bonus|single|album|extended|instrumental|anniversary|from |soundtrack|radio|session).*$', '', 'i'),
             '\s+(19|20)\d\d$', '')), ''), p)
$$;

alter table public.song_catalog
  add column if not exists core_title text generated always as (public._title_core(title)) stored,
  add column if not exists primary_artist text generated always as (public._artist_primary(artist)) stored;
create index if not exists song_catalog_core on public.song_catalog (primary_artist, core_title);

-- Vergleich im Hard-Mode: gleicher Kern zählt als richtig
create or replace function public._title_matches(p_guess text, p_real text)
returns boolean
language sql immutable
as $$
  select public._title_core(p_guess) <> '' and public._title_core(p_guess) = public._title_core(p_real)
$$;

create or replace function public._artist_matches(p_guess text, p_real text)
returns boolean
language sql immutable
as $$
  select case
    when public._song_norm(p_guess) = '' then false
    when public._song_norm(p_guess) = public._song_norm(p_real) then true
    when public._artist_primary(p_guess) <> '' and public._artist_primary(p_guess) = public._artist_primary(p_real) then true
    when least(length(public._song_norm(p_guess)), length(public._song_norm(p_real))) >= 4
         and (strpos(public._song_norm(p_guess), public._song_norm(p_real)) = 1
              or strpos(public._song_norm(p_real), public._song_norm(p_guess)) = 1) then true
    else false
  end
$$;

-- Songs pro Runde: jedes Lied (Kern + Hauptinterpret) nur einmal, möglichst verschiedene Interpreten
create or replace function public._pick_songs(p_players uuid[], p_count int)
returns table (song_id bigint)
language sql volatile security definer set search_path = public
as $$
  with eligible as (
    select s.id, public._artist_primary(s.artist) as pa, public._title_core(s.title) as core,
           (select max(m.shown_at) from public.music_answers m
              join public.music_game_songs mg on mg.game_id = m.game_id and mg.position = m.position
             where public._title_core((select s2.title from public.songs s2 where s2.id = mg.song_id)) = public._title_core(s.title)
               and m.user_id = any (p_players)) as last_seen,
           random() as r
      from public.songs s
     where s.is_active and s.preview_url is not null
       and (s.added_by is null or s.added_by <> all (p_players))
  ),
  one_per_song as (
    select distinct on (core) * from eligible order by core, (last_seen is not null), last_seen nulls first, r
  )
  select id from (
    select o.*, row_number() over (partition by o.pa order by (o.last_seen is not null), o.last_seen nulls first, o.r) as nth
      from one_per_song o
  ) x
   order by nth, (last_seen is not null), last_seen nulls first, r
   limit p_count
$$;

-- Antwortmöglichkeiten ohne doppelte Lieder und Interpreten
create or replace function public._song_options(p_song_id bigint, p_used_artists text[])
returns table (artist_options text[], artist_correct smallint, title_options text[], title_correct smallint)
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_song    public.songs;
  v_artists text[];
  v_titles  text[];
  v_order   smallint[];
  v_pa      text;
  v_core    text;
begin
  select * into v_song from public.songs where id = p_song_id;
  v_pa := public._artist_primary(v_song.artist);
  v_core := public._title_core(v_song.title);

  -- Falsche Interpreten: anderer Hauptinterpret; gleiches Genre bevorzugt, dann gleiches Jahrzehnt
  select array_agg(a) into v_artists from (
    select a from (
      select distinct on (public._artist_primary(s.artist)) s.artist as a,
             (s.genre is not distinct from v_song.genre) as same_genre,
             (s.decade is not distinct from v_song.decade) as same_decade
        from public.songs s
       where s.is_active and public._artist_primary(s.artist) <> v_pa and public._artist_primary(s.artist) <> ''
       order by public._artist_primary(s.artist), (s.artist ~ '[,&]') , random()
    ) t
    order by same_genre desc, same_decade desc, random()
    limit 3
  ) x;

  -- Falsche Titel: andere Lieder desselben Interpreten (auch aus dem Katalog), dann gleiches Genre/Jahrzehnt
  select array_agg(t) into v_titles from (
    select t from (
      select distinct on (u.core) public._title_display(u.t) as t, u.same_artist, u.same_genre, u.same_decade
        from (
          select s.title as t, public._title_core(s.title) as core,
                 (public._artist_primary(s.artist) = v_pa) as same_artist,
                 (s.genre is not distinct from v_song.genre) as same_genre,
                 (s.decade is not distinct from v_song.decade) as same_decade
            from public.songs s
           where s.is_active
          union all
          select c.title, c.core_title, true, true, true
            from public.song_catalog c
           where c.primary_artist = v_pa
        ) u
       where u.core <> v_core and u.core <> ''
       order by u.core, u.same_artist desc, (u.t ~* '(remaster|remix|live|edit|version|mix)'), length(u.t), random()
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
  title_options := array(select case o when 0 then public._title_display(v_song.title) else v_titles[o] end from unnest(v_order) with ordinality t(o, i) order by i);
  title_correct := (array_position(v_order, 0::smallint) - 1)::smallint;
  return next;
end
$$;

-- Vorschläge im Hard-Mode: jedes Lied einmal, ohne Versions-Zusatz
create or replace function public.music_search(p_query text)
returns table (artist text, title text)
language sql stable security definer set search_path = public
as $$
  with q as (select public._song_norm(p_query) as n),
  pool as (
    select s.artist, s.title, public._artist_primary(s.artist) as pa, public._title_core(s.title) as core,
           public._song_norm(s.artist) as na, 0 as pref
      from public.songs s where s.is_active
  ),
  cat as (
    select c.artist, c.title, c.primary_artist as pa, c.core_title as core, c.norm_artist as na, 1 as pref
      from public.song_catalog c
     -- Cover und Kollaborationen eines Pool-Songs („Calum Scott & Whitney Houston“) nicht extra zeigen
     where not exists (select 1 from pool p where p.core = c.core_title and strpos(c.norm_artist, p.pa) > 0)
  ),
  hits as (
    select distinct on (u.pa, u.core) u.artist, public._title_display(u.title) as title, u.core, u.na
      from (select * from pool union all select * from cat) u, q
     where length(q.n) >= 3 and u.core <> ''
       and (strpos(u.core, q.n) > 0 or strpos(u.na, q.n) > 0 or strpos(public._song_norm(u.title), q.n) > 0)
     order by u.pa, u.core, u.pref, (u.na <> u.pa), length(u.title)
  )
  select h.artist, h.title from hits h, q
   order by (strpos(h.core, q.n) = 1) desc, (strpos(h.na, q.n) = 1) desc, lower(h.title), lower(h.artist)
   limit 8
$$;

-- Anzeige ohne Versions-Zusatz bei der Auflösung und im Ergebnis
create or replace function public._record_music_answer(p_game_id bigint, p_user uuid, p_position smallint, p_artist smallint, p_title smallint,
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
    'title', public._title_display(v_song.title),
    'artwork_url', v_song.artwork_url,
    'itunes_id', v_song.itunes_id,
    'finished', p_position = 5
  );
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
               'artist', s.artist, 'title', public._title_display(s.title), 'artwork_url', s.artwork_url, 'itunes_id', s.itunes_id,
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
