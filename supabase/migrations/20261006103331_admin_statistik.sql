-- =====================================================================
-- Statistik für den Obmann: wer spielt wie viel, mit wem, wer gewinnt.
-- Nur für Admins (is_admin), alles in einem Aufruf.
-- p_days: Zeitraum in Tagen, null = gesamt
-- =====================================================================
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
revoke execute on function public.admin_stats(int) from public, anon;
grant execute on function public.admin_stats(int) to authenticated;
