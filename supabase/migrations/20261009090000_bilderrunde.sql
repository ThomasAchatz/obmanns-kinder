-- =====================================================================
-- Bilderrunde
-- Porträts bekannter Menschen (etwa zwei Drittel Frauen), Fotos von Wikimedia
-- Commons mit Urheber und Lizenz. 5 Gesichter pro Runde, je 1 Punkt.
-- Easy: 4 Namen zur Auswahl, 15 Sekunden. Hard: Namen tippen und aus der
-- Vorschlagsliste wählen, 30 Sekunden. Eigene Rangliste, eigenes Tageslimit.
-- games.music_hard gilt auch für die Bilderrunde (= Hard-Mode).
-- =====================================================================

alter table public.games drop constraint if exists games_kind_check;
alter table public.games add constraint games_kind_check check (kind in ('quiz', 'music', 'bild'));

-- Gleiche Schreibweise für Namen: klein, ohne Akzente und Satzzeichen
create or replace function public._name_norm(p text)
returns text
language sql immutable parallel safe
as $$
  select regexp_replace(
           replace(translate(lower(coalesce(p, '')),
             'äöüàáâãåāăąèéêëēėęěìíîïīįòóôõøōőùúûūůűñńňçćčšśşžźżýÿłđğřť',
             'aouaaaaaaaaeeeeeeeeiiiiiiooooooouuuuuunnncccssszzzyyldgrt'), 'ß', 'ss'),
           '[^a-z0-9]+', '', 'g')
$$;

-- ---------------------------------------------------------------------
-- Porträts (die Gesichter im Spiel)
-- ---------------------------------------------------------------------
create table public.portraits (
  id          bigint generated always as identity primary key,
  qid         text not null unique,
  name        text not null check (char_length(name) between 1 and 120),
  aliases     text[] not null default '{}',
  sex         text not null check (sex in ('w', 'm')),
  born        smallint,
  sparte      text not null,
  description text,
  image       text not null unique,
  photo_year  smallint,
  artist      text,
  license     text,
  source_url  text,
  wiki_title  text,
  level       smallint not null default 1 check (level in (1, 2)),  -- 1 = bekannt (Easy und Hard), 2 = nur Hard
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.portraits enable row level security;
-- Kein direkter Lesezugriff (sonst wäre die Lösung abrufbar); Admin darf lesen und abschalten
create policy "Porträts Admin" on public.portraits for select to authenticated using (public.is_admin());
create policy "Porträts Admin ändern" on public.portraits for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.portraits from anon, authenticated;
grant select on public.portraits to authenticated;
grant update (is_active, level) on public.portraits to authenticated;

-- Namenskatalog: alle Porträts plus weitere bekannte Personen.
-- Für die Vorschläge im Hard-Mode und die falschen Antworten im Easy-Mode.
create table public.person_names (
  id         bigint generated always as identity primary key,
  qid        text not null unique,
  name       text not null check (char_length(name) between 1 and 120),
  sub        text,
  sex        text check (sex in ('w', 'm')),
  born       smallint,
  sparte     text,
  fame       real not null default 0,
  as_option  boolean not null default false,    -- bekannt genug als falsche Antwort im Easy-Mode
  search     text not null default '',          -- Name und weitere Namen, normalisiert, mit | getrennt
  norm       text generated always as (public._name_norm(name)) stored
);
create index person_names_norm on public.person_names (norm);
create index person_names_opt on public.person_names (sex, sparte) where as_option;
alter table public.person_names enable row level security;
revoke all on public.person_names from anon, authenticated;

create table public.bild_game_items (
  game_id     bigint not null references public.games(id) on delete cascade,
  position    smallint not null check (position between 1 and 5),
  portrait_id bigint not null references public.portraits(id),
  options     text[] not null,
  correct     smallint not null,
  primary key (game_id, position)
);

create table public.bild_answers (
  game_id     bigint not null,
  user_id     uuid not null,
  position    smallint not null check (position between 1 and 5),
  choice      smallint,
  guess       text,
  ok          boolean,
  ms          integer,
  shown_at    timestamptz not null default now(),
  answered_at timestamptz,
  primary key (game_id, user_id, position),
  foreign key (game_id, user_id) references public.game_players (game_id, user_id) on delete cascade
);
alter table public.bild_game_items enable row level security;
alter table public.bild_answers enable row level security;
revoke all on public.bild_game_items, public.bild_answers from anon, authenticated;

-- ---------------------------------------------------------------------
-- Rangliste: Treffer der Bilderrunde mitzählen
-- ---------------------------------------------------------------------
create or replace function public.leaderboard(p_period text default 'month', p_month date default null, p_kind text default 'quiz')
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
    case v_game.kind when 'music' then '/#/musik/' when 'bild' then '/#/bilder/' else '/#/spiel/' end || p_game_id);
end
$$;

-- ---------------------------------------------------------------------
-- Gesichter auswählen und Antwortmöglichkeiten bauen
-- ---------------------------------------------------------------------
create or replace function public._portrait_pool(p_players uuid[], p_hard boolean, p_sparten text[])
returns table (id bigint, sex text, sparte text, seen timestamptz, r double precision)
language sql volatile security definer set search_path = public
as $$
  select p.id, p.sex, p.sparte,
         (select max(b.shown_at) from public.bild_answers b
            join public.bild_game_items i on i.game_id = b.game_id and i.position = b.position
           where i.portrait_id = p.id and b.user_id = any (p_players)),
         random()
    from public.portraits p
   where p.is_active
     and (p_hard or p.level = 1)
     and (p_sparten is null or cardinality(p_sparten) = 0 or p.sparte = any (p_sparten))
$$;

create or replace function public._pick_portraits(p_players uuid[], p_hard boolean, p_sparten text[])
returns table (portrait_id bigint)
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_women int := 3 + (random() < 0.4)::int;  -- im Schnitt gut zwei Drittel Frauen
  v_ids   bigint[];
begin
  -- Ungesehene zuerst, dann die am längsten nicht gesehenen; pro Runde möglichst verschiedene Sparten
  v_ids := array(
    select x.id from (
      select q.*, row_number() over (partition by q.sparte order by q.seen nulls first, q.r) as nth
        from public._portrait_pool(p_players, p_hard, p_sparten) q where q.sex = 'w'
    ) x order by (x.seen is not null), x.nth, x.seen nulls first, x.r limit v_women);
  v_ids := v_ids || array(
    select x.id from (
      select q.*, row_number() over (partition by q.sparte order by q.seen nulls first, q.r) as nth
        from public._portrait_pool(p_players, p_hard, p_sparten) q where q.sex = 'm'
    ) x order by (x.seen is not null), x.nth, x.seen nulls first, x.r limit 5 - cardinality(v_ids));
  if cardinality(v_ids) < 5 then
    v_ids := v_ids || array(
      select q.id from public._portrait_pool(p_players, p_hard, p_sparten) q
       where q.id <> all (v_ids) order by q.seen nulls first, q.r limit 5 - cardinality(v_ids));
  end if;
  return query select u from unnest(v_ids) u order by random();
end
$$;

create or replace function public._portrait_options(p_portrait_id bigint)
returns table (options text[], correct smallint)
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_p     public.portraits;
  v_wrong text[];
  v_order smallint[];
begin
  select * into v_p from public.portraits where id = p_portrait_id;

  -- Falsche Namen: gleiches Geschlecht, ähnliches Alter, gleiche Sparte, ähnlich bekannt
  select array_agg(n) into v_wrong from (
    select n from (
      select distinct on (c.norm) c.name as n,
             (c.sparte = v_p.sparte) as same_sparte,
             (abs(coalesce(c.born, 0) - coalesce(v_p.born, 0)) <= 8) as same_age,
             (abs(coalesce(c.born, 0) - coalesce(v_p.born, 0)) <= 15) as near_age,
             random() as r
        from public.person_names c
       where c.as_option and c.sex = v_p.sex
         and c.qid <> v_p.qid and c.norm <> public._name_norm(v_p.name)
       order by c.norm, random()
    ) t
    order by (same_sparte and same_age) desc, (same_sparte and near_age) desc, same_age desc, r
    limit 3
  ) x;

  if coalesce(cardinality(v_wrong), 0) < 3 then
    raise exception 'Zu wenige Namen für eine Bilderrunde.';
  end if;
  v_order := public._shuffled_order();
  options := array(select case o when 0 then v_p.name else v_wrong[o] end from unnest(v_order) with ordinality t(o, i) order by i);
  correct := (array_position(v_order, 0::smallint) - 1)::smallint;
  return next;
end
$$;
revoke execute on function public._pick_portraits(uuid[], boolean, text[]) from public, anon, authenticated;
revoke execute on function public._portrait_pool(uuid[], boolean, text[]) from public, anon, authenticated;
revoke execute on function public._portrait_options(bigint) from public, anon, authenticated;

create or replace function public.create_bild_game(p_mode text, p_invitees uuid[] default '{}', p_hard boolean default false,
                                                   p_sparten text[] default null)
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
  v_ids := array(select portrait_id from public._pick_portraits(v_players, coalesce(p_hard, false), p_sparten));
  if cardinality(v_ids) < 5 then
    raise exception 'Es gibt nur % passende Gesichter, für eine Bilderrunde braucht es 5.', cardinality(v_ids);
  end if;

  insert into public.games (mode, kind, music_hard, created_by) values (p_mode, 'bild', coalesce(p_hard, false), v_me) returning id into v_game;
  for i in 1..5 loop
    select * into o from public._portrait_options(v_ids[i]);
    insert into public.bild_game_items (game_id, position, portrait_id, options, correct)
    values (v_game, i, v_ids[i], o.options, o.correct);
  end loop;
  insert into public.game_players (game_id, user_id) select v_game, unnest(v_players);

  if p_mode = 'challenge' then
    select display_name into v_name from public.profiles where id = v_me;
    perform public.send_push(p_invitees, case when p_hard then 'Neue Bilder-Challenge (Hard)' else 'Neue Bilder-Challenge' end,
      v_name || ' fordert dich heraus. 5 Gesichter warten auf dich.', '/#/bilder/' || v_game);
  end if;
  return v_game;
end
$$;

create or replace function public._finish_bild_player(p_game_id bigint, p_user uuid)
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
         score = (select count(*) filter (where b.ok) from public.bild_answers b where b.game_id = p_game_id and b.user_id = p_user),
         total_ms = (select coalesce(sum(b.ms), 0) from public.bild_answers b where b.game_id = p_game_id and b.user_id = p_user)
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
      'Neues Bilder-Duell', v_name || ' hat dich zum Bilder-Duell herausgefordert.', '/#/bilder/' || p_game_id);
  end if;

  if v_pending = 0 then
    update public.games set status = 'finished', finished_at = now() where id = p_game_id and status = 'open';
    select count(*) into v_total from public.game_players where game_id = p_game_id;
    for r in select gr.user_id, gr.rnk, gr.score from public._game_ranks(null, null, 'bild') gr where gr.game_id = p_game_id loop
      continue when r.user_id = p_user;
      if v_game.mode = 'duel' then
        perform public.send_push(array[r.user_id], 'Bilder-Duell gegen ' || v_name || ' ist fertig',
          case when r.rnk = 1 then 'Gewonnen! ' else 'Verloren. ' end || 'Du hast ' || r.score || ' von 5 Gesichtern erkannt.',
          '/#/bilder/' || p_game_id);
      else
        perform public.send_push(array[r.user_id], 'Bilder-Challenge ist fertig',
          'Du bist auf Platz ' || r.rnk || ' von ' || v_total || '.', '/#/bilder/' || p_game_id);
      end if;
    end loop;
  end if;
end
$$;
revoke execute on function public._finish_bild_player(bigint, uuid) from public, anon, authenticated;

create or replace function public._bild_name_ok(p_guess text, p_portrait public.portraits)
returns boolean
language sql immutable
as $$
  select public._name_norm(p_guess) <> ''
     and (public._name_norm(p_guess) = public._name_norm(p_portrait.name)
          or public._name_norm(p_guess) = any (array(select public._name_norm(a) from unnest(p_portrait.aliases) a)))
$$;

create or replace function public._record_bild_answer(p_game_id bigint, p_user uuid, p_position smallint, p_choice smallint, p_guess text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ans  public.bild_answers;
  v_item public.bild_game_items;
  v_p    public.portraits;
  v_hard boolean;
  v_secs int;
  v_late boolean;
  v_ms   int;
  v_ok   boolean;
begin
  select * into v_ans from public.bild_answers
   where game_id = p_game_id and user_id = p_user and position = p_position for update;
  if not found or v_ans.answered_at is not null then
    raise exception 'Dieses Gesicht ist nicht offen.';
  end if;
  select * into v_item from public.bild_game_items where game_id = p_game_id and position = p_position;
  select * into v_p from public.portraits where id = v_item.portrait_id;

  v_hard := coalesce((select music_hard from public.games where id = p_game_id), false);
  v_secs := case when v_hard then 30 else 15 end;
  v_late := now() - v_ans.shown_at > make_interval(secs => v_secs + 2);
  if v_hard then p_choice := null; else p_guess := null; end if;
  if v_late then p_choice := null; p_guess := null; end if;
  v_ms := case when v_late then v_secs * 1000 else least(v_secs * 1000, (extract(epoch from (now() - v_ans.shown_at)) * 1000)::int) end;
  v_ok := case when v_hard then public._bild_name_ok(p_guess, v_p) else coalesce(p_choice = v_item.correct, false) end;

  update public.bild_answers
     set choice = p_choice, guess = left(p_guess, 120), ok = v_ok, ms = v_ms, answered_at = now()
   where game_id = p_game_id and user_id = p_user and position = p_position;

  if p_position = 5 then
    perform public._finish_bild_player(p_game_id, p_user);
  end if;

  return jsonb_build_object(
    'position', p_position,
    'correct', v_item.correct,
    'ok', v_ok,
    'ms', v_ms,
    'timed_out', v_late or (p_choice is null and p_guess is null),
    'name', v_p.name,
    'description', v_p.description,
    'photo_year', v_p.photo_year,
    'artist', v_p.artist,
    'license', v_p.license,
    'source_url', v_p.source_url,
    'wiki_title', v_p.wiki_title,
    'finished', p_position = 5
  );
end
$$;
revoke execute on function public._record_bild_answer(bigint, uuid, smallint, smallint, text) from public, anon, authenticated;

-- Nächstes Gesicht (ohne Lösung). Startet die Zeit.
create or replace function public.bild_next(p_game_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_game   public.games;
  v_player public.game_players;
  v_ans    public.bild_answers;
  v_pos    smallint;
  v_item   public.bild_game_items;
  v_p      public.portraits;
  v_secs   int;
begin
  perform public._assert_kind(p_game_id, 'bild');
  select * into v_game from public.games where id = p_game_id;
  v_secs := case when v_game.music_hard then 30 else 15 end;
  select * into v_player from public.game_players where game_id = p_game_id and user_id = v_me for update;
  if not found then raise exception 'Du spielst in diesem Spiel nicht mit.'; end if;
  if v_player.status = 'done' then return jsonb_build_object('done', true); end if;
  if v_game.status = 'closed' then raise exception 'Diese Challenge wurde schon geschlossen.'; end if;
  if v_game.mode = 'duel' and v_game.created_by <> v_me and exists (
       select 1 from public.game_players where game_id = p_game_id and user_id = v_game.created_by and status <> 'done') then
    raise exception 'Dein Gegner rät seine Gesichter noch. Du bekommst einen Push, sobald du dran bist.';
  end if;

  select * into v_ans from public.bild_answers where game_id = p_game_id and user_id = v_me and answered_at is null;
  if found then
    if now() - v_ans.shown_at > make_interval(secs => v_secs + 2) then
      perform public._record_bild_answer(p_game_id, v_me, v_ans.position, null, null);
      if v_ans.position = 5 then return jsonb_build_object('done', true); end if;
    else
      v_pos := v_ans.position;
    end if;
  end if;
  if v_pos is null then
    select (coalesce(max(position), 0) + 1)::smallint into v_pos from public.bild_answers where game_id = p_game_id and user_id = v_me;
    if v_pos > 5 then return jsonb_build_object('done', true); end if;
    insert into public.bild_answers (game_id, user_id, position) values (p_game_id, v_me, v_pos) returning * into v_ans;
  end if;

  select * into v_item from public.bild_game_items where game_id = p_game_id and position = v_pos;
  select * into v_p from public.portraits where id = v_item.portrait_id;
  return jsonb_build_object(
    'done', false,
    'position', v_pos,
    'total', 5,
    'image', v_p.image,
    'photo_year', v_p.photo_year,
    'hard', v_game.music_hard,
    'seconds', v_secs,
    'options', case when v_game.music_hard then '[]'::jsonb else to_jsonb(v_item.options) end,
    'seconds_left', greatest(0, v_secs - extract(epoch from (now() - v_ans.shown_at)))
  );
end
$$;

create or replace function public.bild_answer(p_game_id bigint, p_position smallint, p_choice smallint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  perform public._assert_kind(p_game_id, 'bild');
  if not exists (select 1 from public.game_players where game_id = p_game_id and user_id = auth.uid() and status = 'pending') then
    raise exception 'Du kannst in diesem Spiel nicht (mehr) antworten.';
  end if;
  return public._record_bild_answer(p_game_id, auth.uid(), p_position, p_choice, null);
end
$$;

create or replace function public.bild_answer_hard(p_game_id bigint, p_position smallint, p_guess text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  perform public._assert_kind(p_game_id, 'bild');
  if not exists (select 1 from public.game_players where game_id = p_game_id and user_id = auth.uid() and status = 'pending') then
    raise exception 'Du kannst in diesem Spiel nicht (mehr) antworten.';
  end if;
  return public._record_bild_answer(p_game_id, auth.uid(), p_position, null, p_guess);
end
$$;

-- Vorschläge im Hard-Mode: ganzer Katalog, alphabetisch
create or replace function public.bild_search(p_query text)
returns table (name text, sub text)
language sql stable security definer set search_path = public
as $$
  with q as (select public._name_norm(p_query) as n)
  select c.name, c.sub
    from public.person_names c, q
   where length(q.n) >= 3 and strpos(c.search, q.n) > 0
   order by (strpos(c.norm, q.n) = 1) desc, c.name
   limit 8
$$;

create or replace function public.bild_game_details(p_game_id bigint)
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
  perform public._assert_kind(p_game_id, 'bild');
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
    'started', exists (select 1 from public.bild_answers where game_id = p_game_id and user_id = v_me),
    'can_nudge', v_mine.status = 'done' and v_game.status = 'open'
                 and (v_mine.last_nudge_at is null or v_mine.last_nudge_at <= now() - interval '20 hours')
                 and exists (select 1 from public.game_players where game_id = p_game_id and status = 'pending'),
    'can_close', v_game.mode = 'challenge' and v_game.status = 'open' and (v_game.created_by = v_me or public.is_admin()),
    'my_points', (select jsonb_build_object('points', gr.points, 'raw_points', gr.raw_points, 'counted', gr.counted, 'day_index', gr.day_index)
                    from public._game_ranks(null, null, 'bild') gr where gr.game_id = p_game_id and gr.user_id = v_me),
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
    'items', case when not v_reveal then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object(
               'position', i.position,
               'image', pt.image, 'photo_year', pt.photo_year,
               'name', pt.name, 'description', pt.description,
               'artist', pt.artist, 'license', pt.license, 'source_url', pt.source_url, 'wiki_title', pt.wiki_title,
               'options', to_jsonb(i.options), 'correct', i.correct,
               'answers', (
                 select coalesce(jsonb_object_agg(b.user_id, jsonb_build_object(
                          'choice', b.choice, 'guess', b.guess, 'ok', b.ok, 'ms', b.ms)), '{}'::jsonb)
                   from public.bild_answers b
                   join public.game_players gp2 on gp2.game_id = b.game_id and gp2.user_id = b.user_id and gp2.status = 'done'
                  where b.game_id = i.game_id and b.position = i.position
               )
             ) order by i.position), '[]'::jsonb)
        from public.bild_game_items i join public.portraits pt on pt.id = i.portrait_id
       where i.game_id = p_game_id
    ) end
  );
end
$$;

-- Wie viele Gesichter gibt es (für die Spielauswahl)
create or replace function public.bild_counts()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'total', count(*) filter (where is_active),
    'easy', count(*) filter (where is_active and level = 1),
    'women', count(*) filter (where is_active and sex = 'w'),
    'by_sparte', (select coalesce(jsonb_object_agg(sparte, n), '{}'::jsonb) from (
        select sparte, count(*) n from public.portraits where is_active group by 1) x)
  ) from public.portraits
$$;

-- Am häufigsten verwechselt: nur Gesichter, die man selbst schon gesehen hat (sonst wäre es ein Spoiler)
create or replace function public.bild_confusions(p_limit int default 5)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with seen as (
    select distinct i.portrait_id
      from public.bild_answers b join public.bild_game_items i on i.game_id = b.game_id and i.position = b.position
     where b.user_id = auth.uid() and b.answered_at is not null
  ),
  wrong as (
    select i.portrait_id,
           coalesce(case when b.choice is not null then i.options[b.choice + 1] end, b.guess) as taken
      from public.bild_answers b
      join public.bild_game_items i on i.game_id = b.game_id and i.position = b.position
      join public.game_players gp on gp.game_id = b.game_id and gp.user_id = b.user_id and gp.status = 'done'
     where b.ok = false and i.portrait_id in (select portrait_id from seen)
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'image', p.image, 'taken', w.taken, 'n', w.n) order by w.n desc, p.name), '[]'::jsonb)
    from (
      select portrait_id, taken, count(*) n from wrong where taken is not null
       group by 1, 2 order by 3 desc limit greatest(1, least(p_limit, 20))
    ) w join public.portraits p on p.id = w.portrait_id
$$;

revoke execute on function public.create_bild_game(text, uuid[], boolean, text[]) from public, anon;
revoke execute on function public.bild_next(bigint) from public, anon;
revoke execute on function public.bild_answer(bigint, smallint, smallint) from public, anon;
revoke execute on function public.bild_answer_hard(bigint, smallint, text) from public, anon;
revoke execute on function public.bild_search(text) from public, anon;
revoke execute on function public.bild_game_details(bigint) from public, anon;
revoke execute on function public.bild_counts() from public, anon;
revoke execute on function public.bild_confusions(int) from public, anon;
grant execute on function public.create_bild_game(text, uuid[], boolean, text[]) to authenticated;
grant execute on function public.bild_next(bigint) to authenticated;
grant execute on function public.bild_answer(bigint, smallint, smallint) to authenticated;
grant execute on function public.bild_answer_hard(bigint, smallint, text) to authenticated;
grant execute on function public.bild_search(text) to authenticated;
grant execute on function public.bild_game_details(bigint) to authenticated;
grant execute on function public.bild_counts() to authenticated;
grant execute on function public.bild_confusions(int) to authenticated;

-- ---------------------------------------------------------------------
-- Admin-Statistik: Bilderrunde mitzählen
-- ---------------------------------------------------------------------
create or replace function public.admin_stats(p_days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_from timestamptz := case when p_days is null then '-infinity'::timestamptz else now() - make_interval(days => p_days) end;
  v_weeks_start timestamptz := date_trunc('week', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin' - interval '7 weeks';
begin
  if not public.is_admin() then
    raise exception 'Nur für den Obmann.';
  end if;

  return jsonb_build_object(
    'days', p_days,
    'totals', (
      select jsonb_build_object(
        'games', count(distinct g.id),
        'quiz', count(distinct g.id) filter (where g.kind = 'quiz'),
        'music', count(distinct g.id) filter (where g.kind = 'music'),
        'bild', count(distinct g.id) filter (where g.kind = 'bild'),
        'active_players', count(distinct gp.user_id)
      )
        from public.game_players gp join public.games g on g.id = gp.game_id
       where gp.status = 'done' and gp.finished_at >= v_from
    ),
    'players', (
      select coalesce(jsonb_agg(x order by x.games desc, x.last_played_at desc nulls last, x.display_name), '[]'::jsonb) from (
        select p.id as user_id, p.display_name,
               u.last_sign_in_at,
               (select max(gp.finished_at) from public.game_players gp where gp.user_id = p.id and gp.status = 'done') as last_played_at,
               count(gp.game_id) as games,
               count(gp.game_id) filter (where g.kind = 'quiz') as quiz,
               count(gp.game_id) filter (where g.kind = 'music') as music,
               count(gp.game_id) filter (where g.kind = 'bild') as bild,
               count(gp.game_id) filter (where g.mode = 'duel') as duels,
               count(gp.game_id) filter (where g.mode = 'challenge') as challenges,
               count(gp.game_id) filter (where g.mode = 'solo') as solo,
               count(*) filter (where d.result = 1) as duel_wins,
               count(*) filter (where d.result = 0) as duel_draws,
               count(*) filter (where d.result = -1) as duel_losses,
               (select count(*) from public.game_players o where o.user_id = p.id and o.status = 'pending'
                   and exists (select 1 from public.games og where og.id = o.game_id and og.status = 'open')) as open_games,
               (select count(*) from public.questions q where q.author_id = p.id and q.deleted_at is null) as questions,
               (select count(*) from public.facts f where f.author_id = p.id) as facts,
               (select count(*) from public.songs s where s.added_by = p.id and s.is_active) as songs,
               (select jsonb_agg(coalesce(w.n, 0) order by wk.i)
                  from generate_series(0, 7) wk(i)
                  left join lateral (
                    select count(*) n from public.game_players w2
                     where w2.user_id = p.id and w2.status = 'done'
                       and w2.finished_at >= v_weeks_start + make_interval(weeks => wk.i)
                       and w2.finished_at <  v_weeks_start + make_interval(weeks => wk.i + 1)
                  ) w on true) as weeks
          from public.profiles p
          left join auth.users u on u.id = p.id
          left join public.game_players gp on gp.user_id = p.id and gp.status = 'done' and gp.finished_at >= v_from
          left join public.games g on g.id = gp.game_id
          left join lateral (
            select case
                     when gp.score > o.score or (gp.score = o.score and gp.total_ms < o.total_ms) then 1
                     when gp.score = o.score and gp.total_ms = o.total_ms then 0
                     else -1 end as result
              from public.game_players o
             where g.mode = 'duel' and g.status <> 'open'
               and o.game_id = gp.game_id and o.user_id <> gp.user_id and o.status = 'done'
          ) d on true
         group by p.id, p.display_name, u.last_sign_in_at
      ) x
    ),
    'pairs', (
      select coalesce(jsonb_agg(y order by y.games desc, y.a_name, y.b_name), '[]'::jsonb) from (
        select a.user_id as a_id, pa.display_name as a_name, b.user_id as b_id, pb.display_name as b_name,
               count(*) as games,
               count(*) filter (where g.mode = 'duel') as duels,
               count(*) filter (where g.mode = 'duel' and (a.score > b.score or (a.score = b.score and a.total_ms < b.total_ms))) as a_wins,
               count(*) filter (where g.mode = 'duel' and (b.score > a.score or (a.score = b.score and b.total_ms < a.total_ms))) as b_wins,
               max(greatest(a.finished_at, b.finished_at)) as last_at
          from public.game_players a
          join public.game_players b on b.game_id = a.game_id and a.user_id < b.user_id
          join public.games g on g.id = a.game_id
          join public.profiles pa on pa.id = a.user_id
          join public.profiles pb on pb.id = b.user_id
         where g.mode <> 'solo' and a.status = 'done' and b.status = 'done'
           and greatest(a.finished_at, b.finished_at) >= v_from
         group by a.user_id, pa.display_name, b.user_id, pb.display_name
      ) y
    )
  );
end
$$;
