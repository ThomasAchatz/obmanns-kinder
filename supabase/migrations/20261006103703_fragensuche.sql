-- =====================================================================
-- Fragensuche: Suchbegriff in Frage, Antworten und Erklärung.
-- Der Obmann findet alle Fragen. Alle anderen nur Fragen, die sie schon
-- beantwortet haben, und ihre eigenen – sonst könnte man im Duell spicken.
-- =====================================================================
create or replace function public.search_questions(p_query text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_admin boolean := public.is_admin();
  v_q     text := btrim(coalesce(p_query, ''));
  v_like  text;
begin
  if v_me is null then raise exception 'Nicht angemeldet'; end if;
  if char_length(v_q) < 2 then
    return jsonb_build_object('results', '[]'::jsonb, 'total', 0, 'scope', case when v_admin then 'all' else 'seen' end);
  end if;
  v_like := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return (
    with hits as (
      select q.*
        from public.questions q
       where q.deleted_at is null
         and (v_admin or q.author_id = v_me
              or exists (select 1 from public.answers a where a.question_id = q.id and a.user_id = v_me and a.answered_at is not null))
         and (lower(q.text) like v_like or lower(q.correct) like v_like
              or lower(q.wrong_1) like v_like or lower(q.wrong_2) like v_like or lower(q.wrong_3) like v_like
              or lower(coalesce(q.explanation, '')) like v_like)
    )
    select jsonb_build_object(
      'scope', case when v_admin then 'all' else 'seen' end,
      'total', (select count(*) from hits),
      'results', coalesce((
        select jsonb_agg(r order by r.rank, r.created_at desc) from (
          select h.id, h.text, h.correct, h.wrong_1, h.wrong_2, h.wrong_3, h.explanation, h.source_url, h.is_active, h.created_at,
                 jsonb_build_object('name', c.name, 'icon', c.icon) as category,
                 coalesce(p.display_name, h.source_label, 'Startpaket') as author,
                 (h.author_id = v_me) as mine,
                 (select count(*) from public.answers a where a.question_id = h.id and a.answered_at is not null) as plays,
                 (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(*), 0))
                    from public.answers a where a.question_id = h.id and a.answered_at is not null) as correct_rate,
                 case when lower(h.text) like v_like then 0 when lower(h.correct) like v_like then 1 else 2 end as rank
            from hits h
            join public.categories c on c.id = h.category_id
            left join public.profiles p on p.id = h.author_id
           order by case when lower(h.text) like v_like then 0 when lower(h.correct) like v_like then 1 else 2 end, h.created_at desc
           limit 60
        ) r
      ), '[]'::jsonb)
    )
  );
end
$$;
revoke execute on function public.search_questions(text) from public, anon;
grant execute on function public.search_questions(text) to authenticated;
