drop policy if exists "matches_select_public_display" on public.matches;
create policy "matches_select_public_display"
  on public.matches for select
  to anon, authenticated
  using (
    display_table in ('tisch1', 'tisch2')
    and status = 1
    and finished = false
  );
