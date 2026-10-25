-- =====================================================================
-- Tempo: Musikauswahl und Weekend League
-- Die Prüfung „gleiches Lied?“ lief bei jeder Auswahl über alle bisherigen
-- Antworten. Mit wachsender Spielhistorie dauerte das so lange, dass der Start
-- der Weekend League in die Zeitbegrenzung lief und jedes Mal abbrach.
-- Jetzt stehen Lied-Kern und Hauptinterpret fest in der Tabelle.
-- =====================================================================
alter table public.songs
  add column if not exists core_title text generated always as (public._title_core(title)) stored,
  add column if not exists primary_artist text generated always as (public._artist_primary(artist)) stored;
create index if not exists songs_core_title on public.songs (core_title);
create index if not exists music_game_songs_song on public.music_game_songs (song_id);
create index if not exists music_answers_user on public.music_answers (user_id);
create index if not exists bild_game_items_portrait on public.bild_game_items (portrait_id);
create index if not exists bild_answers_user on public.bild_answers (user_id);
create index if not exists answers_user on public.answers (user_id);

create or replace function public._pick_songs(p_players uuid[], p_count int)
returns table (song_id bigint)
language sql volatile security definer set search_path = public
as $$
  with seen as (
    select s2.core_title as core, max(m.shown_at) as last_seen
      from public.music_answers m
      join public.music_game_songs mg on mg.game_id = m.game_id and mg.position = m.position
      join public.songs s2 on s2.id = mg.song_id
     where m.user_id = any (p_players)
     group by 1
  ),
  eligible as (
    select s.id, s.primary_artist as pa, s.core_title as core, seen.last_seen, random() as r
      from public.songs s
      left join seen on seen.core = s.core_title
     where s.is_active and s.preview_url is not null
       and (s.added_by is null or s.added_by <> all (p_players))
  ),
  one_per_song as (
    select distinct on (core) * from eligible order by core, r
  )
  select id from (
    select o.*, row_number() over (partition by o.pa order by (o.last_seen is not null), o.last_seen nulls first, o.r) as nth
      from one_per_song o
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
  v_pa      text;
  v_core    text;
begin
  select * into v_song from public.songs where id = p_song_id;
  v_pa := public._artist_primary(v_song.artist);
  v_core := public._title_core(v_song.title);

  -- Falsche Interpreten: anderer Hauptinterpret; gleiches Genre bevorzugt, dann gleiches Jahrzehnt
  select array_agg(a) into v_artists from (
    select a from (
      select distinct on (s.primary_artist) s.artist as a,
             (s.genre is not distinct from v_song.genre) as same_genre,
             (s.decade is not distinct from v_song.decade) as same_decade
        from public.songs s
       where s.is_active and s.primary_artist <> v_pa and s.primary_artist <> ''
       order by s.primary_artist, (s.artist ~ '[,&]') , random()
    ) t
    order by same_genre desc, same_decade desc, random()
    limit 3
  ) x;

  -- Falsche Titel: andere Lieder desselben Interpreten (auch aus dem Katalog), dann gleiches Genre/Jahrzehnt
  select array_agg(t) into v_titles from (
    select t from (
      select distinct on (u.core) public._title_display(u.t) as t, u.same_artist, u.same_genre, u.same_decade
        from (
          select s.title as t, s.core_title as core,
                 (s.primary_artist = v_pa) as same_artist,
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

create or replace function public.music_search(p_query text)
returns table (artist text, title text)
language sql stable security definer set search_path = public
as $$
  with q as (select public._song_norm(p_query) as n),
  pool as (
    select s.artist, s.title, s.primary_artist as pa, s.core_title as core,
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
  -- Verpasste Wochenenden (Start nie geklappt) still abhaken, nicht nachträglich starten
  update public.leagues set started = true, closed = true where not started and now() >= ends_at;

  for l in select * from public.leagues where not started and now() >= starts_at and now() < ends_at for update skip locked loop
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

-- Die League-Schritte dürfen etwas länger dauern als normale Anfragen
alter function public._league_tick() set statement_timeout = '60s';
alter function public.league_tick() set statement_timeout = '60s';
