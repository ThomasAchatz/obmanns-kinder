-- =====================================================================
-- Kategorien beim Spielstart frei wählen: Zufall oder eine/mehrere Kategorien.
-- Die 5 Fragen werden gleichmäßig auf die gewählten Kategorien verteilt.
-- =====================================================================

alter table public.games add column if not exists category_ids smallint[];

create or replace function public._pick_questions_in(
  p_seen_by uuid[], p_exclude_authors uuid[], p_categories smallint[], p_count int, p_exclude_ids bigint[] default '{}')
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
       and (p_categories is null or q.category_id = any (p_categories))
  ),
  ranked as (
    select e.*,
           row_number() over (
             partition by e.category_id
             order by (e.last_seen is not null), (e.votes <= -3), e.last_seen nulls first, e.r
           ) as rn,
           random() as cat_r
      from eligible e
  )
  select id
    from ranked
   order by rn, (last_seen is not null), (votes <= -3), cat_r
   limit p_count
$$;
revoke execute on function public._pick_questions_in(uuid[], uuid[], smallint[], int, bigint[]) from public, anon, authenticated;

drop function public.create_game(text, smallint, uuid[]);

create function public.create_game(p_mode text, p_category_id smallint default null, p_invitees uuid[] default '{}',
                                   p_category_ids smallint[] default null)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_players uuid[];
  v_game    bigint;
  v_ids     bigint[];
  v_name    text;
  v_cats    smallint[];
begin
  if v_me is null then
    raise exception 'Nicht angemeldet';
  end if;

  -- null oder leer = Zufall über alle Kategorien
  v_cats := coalesce(p_category_ids, case when p_category_id is not null then array[p_category_id] end);
  v_cats := nullif(array(select distinct c from unnest(coalesce(v_cats, '{}')) c where c is not null
                          and exists (select 1 from public.categories k where k.id = c)), '{}');

  p_invitees := coalesce(array(select distinct u from unnest(coalesce(p_invitees, '{}')) u where u <> v_me), '{}');

  if p_mode = 'solo' then
    p_invitees := '{}';
  elsif p_mode = 'duel' then
    if cardinality(p_invitees) <> 1 then
      raise exception 'Ein Duell braucht genau einen Gegner.';
    end if;
  elsif p_mode = 'challenge' then
    if cardinality(p_invitees) < 1 then
      raise exception 'Wähle mindestens eine Person für die Challenge.';
    end if;
  else
    raise exception 'Unbekannter Spielmodus: %', p_mode;
  end if;

  if (select count(*) from public.profiles where id = any (p_invitees)) <> cardinality(p_invitees) then
    raise exception 'Mindestens ein Mitspieler existiert nicht.';
  end if;

  v_players := array[v_me] || p_invitees;

  -- Zuerst Fragen, die keiner der Mitspieler geschrieben hat
  v_ids := array(select question_id from public._pick_questions_in(v_players, v_players, v_cats, 5));
  -- Reicht das nicht, dürfen auch Fragen von Mitspielern dran (deren Autor bekommt später eine Ersatzfrage)
  if p_mode <> 'solo' and cardinality(v_ids) < 5 then
    v_ids := v_ids || array(select question_id from public._pick_questions_in(v_players, '{}', v_cats, 5 - cardinality(v_ids), v_ids));
  end if;
  if cardinality(v_ids) < 5 then
    raise exception 'In den gewählten Kategorien gibt es nur % passende Fragen, für ein Spiel braucht es 5. Wähl mehr Kategorien dazu.', cardinality(v_ids);
  end if;

  insert into public.games (mode, category_id, category_ids, created_by)
  values (p_mode, case when cardinality(v_cats) = 1 then v_cats[1] end, v_cats, v_me)
  returning id into v_game;

  insert into public.game_questions (game_id, position, question_id, answer_order)
  select v_game, (row_number() over (order by random()))::smallint, id, public._shuffled_order()
    from unnest(v_ids) as id;

  insert into public.game_players (game_id, user_id)
  select v_game, unnest(v_players);

  if p_mode = 'challenge' then
    select display_name into v_name from public.profiles where id = v_me;
    perform public.send_push(p_invitees, 'Neue Gruppen-Challenge',
      v_name || ' fordert dich heraus. 5 Fragen warten auf dich.', '/#/spiel/' || v_game);
  end if;

  return v_game;
end
$$;
revoke execute on function public.create_game(text, smallint, uuid[], smallint[]) from public, anon;
grant execute on function public.create_game(text, smallint, uuid[], smallint[]) to authenticated;
