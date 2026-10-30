-- Household — "Clear all": skip every chore that has slipped
--
-- Home's Needs you card had a "Clear all" link that only opened Tasks, so
-- pressing it left every slipped chore where it was. This is what it now does.
--
-- Clearing is skipping, as skip_occurrence (0008) does for one: the chores
-- leave Carried over and Needs you, nothing is deleted, points already earned
-- stay, and a skipped day never breaks a streak. Today's chores are left
-- alone — they have not slipped yet. Adults only, like skipping one.

create or replace function public.clear_slipped()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hh      uuid;
  today   date;
  cleared integer;
begin
  select m.household_id into hh
  from member m
  where m.user_id = auth.uid()
  limit 1;

  if hh is null then raise exception 'not a member of any household'; end if;
  if not app.is_adult(hh) then raise exception 'only an adult can clear slipped tasks'; end if;

  select (now() at time zone h.timezone)::date into today
  from household h where h.id = hh;

  update occurrence
     set skipped_at = now()
   where household_id = hh
     and due_on < today
     and completed_at is null
     and skipped_at is null;

  get diagnostics cleared = row_count;
  return cleared;
end;
$$;

grant execute on function public.clear_slipped() to authenticated;
