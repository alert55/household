-- Household — editing, and the holes it exposed
--
-- Designing edit and delete forced a careful look at what an update may do, and
-- three things were wrong before a single edit screen existed:
--
--   1. The views ran as their owner and read straight past row-level security.
--      Fixed in 0001 itself, since nothing had been applied; recreated here
--      with security_invoker for anyone who applied the first draft.
--   2. occurrence_tick let any member update any column, so a child could hand
--      their chore to someone else or move it to next week.
--   3. points_awarded arrived from the browser, so a child with devtools could
--      award themselves whatever they liked.
--
-- And one thing editing needs that did not exist: a way to remove an instance
-- that stays removed. Deleting an occurrence does not work — the hourly job in
-- 0002 sees the gap and puts it back. So an instance is *skipped*: the row stays,
-- marked, and the unique key that makes generation idempotent keeps it from
-- being regenerated.

-- ── Skipping ─────────────────────────────────────────────────────────────

alter table occurrence add column skipped_at timestamptz;
alter table event      add column skipped_at timestamptz;
alter table bill       add column skipped_at timestamptz;

alter table occurrence
  add constraint not_both_done_and_skipped
  check (completed_at is null or skipped_at is null);

-- ── Views, recreated ─────────────────────────────────────────────────────

-- They must be dropped rather than replaced: occurrence gained a column, and
-- CREATE OR REPLACE VIEW refuses to change the position of an existing column,
-- which `o.*` now would. Dropped in dependency order.
drop view if exists streak_current;
drop view if exists streak_run;
drop view if exists occurrence_current;

-- A skipped occurrence never slips. Skipping is a decision, slipping is a lapse,
-- and conflating them would put a planned day off in someone's "Needs you".
create view occurrence_current with (security_invoker = true) as
select
  o.*,
  coalesce(o.assignee_id, t.default_assignee_id) as effective_assignee_id,
  t.title,
  t.points as points_on_offer,
  ((o.due_on + coalesce(o.due_time, time '23:59:59')) at time zone h.timezone) as due_at,
  (o.skipped_at is not null) as skipped,
  (
    o.completed_at is null
    and o.skipped_at is null
    and ((o.due_on + coalesce(o.due_time, time '23:59:59')) at time zone h.timezone) < now()
  ) as slipped
from occurrence o
join task t      on t.id = o.task_id
join household h on h.id = o.household_id;

-- Skipped occurrences are left out of the sequence entirely, so they are not a
-- gap in it. Skipping homework on a holiday does not break a child's streak;
-- only letting it slip does.
create view streak_run with (security_invoker = true) as
with seq as (
  select
    o.task_id,
    coalesce(o.assignee_id, t.default_assignee_id) as member_id,
    o.due_on,
    o.completed_at,
    row_number() over (partition by o.task_id order by o.due_on) as n,
    o.household_id
  from occurrence o
  join task t on t.id = o.task_id
  where o.skipped_at is null
),
kept as (
  select * from seq where completed_at is not null and member_id is not null
),
grouped as (
  select
    *,
    n - row_number() over (partition by task_id, member_id order by n) as run_id
  from kept
)
select
  household_id,
  task_id,
  member_id,
  count(*)    as length,
  min(due_on) as started_on,
  max(due_on) as last_on
from grouped
group by household_id, task_id, member_id, run_id;

create view streak_current with (security_invoker = true) as
select distinct on (r.task_id, r.member_id) r.*
from streak_run r
where not exists (
  select 1
  from occurrence_current oc
  where oc.task_id = r.task_id
    and oc.due_on > r.last_on
    and oc.slipped
)
order by r.task_id, r.member_id, r.last_on desc;

-- ── What a member may write to an occurrence ─────────────────────────────

-- Row-level security decides which rows; it cannot say which columns, because
-- WITH CHECK has no view of the old row. Column privileges can. Ticking a box
-- is the only direct write a member makes to an occurrence now — reassigning,
-- rescheduling and skipping go through the functions below, which check that
-- the caller is an adult.
revoke update on occurrence from anon, authenticated;
grant update (completed_at) on occurrence to authenticated;

-- Points are worked out here, not sent by the browser. They go to the child the
-- occurrence belongs to, whoever ticked it — an adult ticking "Alex fed the dog"
-- still earns Alex the points. completed_by records who actually ticked.
drop trigger if exists occurrence_child_points on occurrence;
drop function if exists app.enforce_child_points();

create or replace function app.award_on_completion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  holder      uuid;
  holder_role member_role;
  offer       integer;
  ticker      uuid;
begin
  if new.completed_at is not distinct from old.completed_at then
    return new;
  end if;

  if new.completed_at is null then
    new.completed_by   := null;
    new.points_awarded := 0;
    return new;
  end if;

  if new.skipped_at is not null then
    raise exception 'that one was skipped';
  end if;

  select coalesce(new.assignee_id, t.default_assignee_id), t.points
    into holder, offer
  from task t
  where t.id = new.task_id;

  select role into holder_role from member where id = holder;

  select m.id into ticker
  from member m
  where m.user_id = auth.uid() and m.household_id = new.household_id;

  new.completed_by   := coalesce(ticker, holder);
  new.points_awarded := case when holder_role = 'child' then coalesce(offer, 0) else 0 end;
  return new;
end;
$$;

create trigger occurrence_award
before update on occurrence
for each row execute function app.award_on_completion();

-- ── Regeneration must leave a skip alone ─────────────────────────────────

-- A skip is someone acting on an instance, exactly like a completion or a
-- reassignment, so ADR 0002's rule applies: regeneration leaves it be. Without
-- this, changing a series' time would delete a skipped instance and put it back
-- unskipped.
create or replace function app.rematerialise_task(target_task uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tz    text;
  today date;
begin
  select h.timezone into tz
  from task t join household h on h.id = t.household_id
  where t.id = target_task;

  if tz is null then return 0; end if;
  today := (now() at time zone tz)::date;

  delete from occurrence o
  where o.task_id = target_task
    and o.due_on > today
    and o.completed_at is null
    and o.assignee_id is null
    and o.skipped_at is null;

  return app.materialise_household((select household_id from task where id = target_task));
end;
$$;

create or replace function app.rematerialise_event_series(target_series uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hh    uuid;
  today date;
begin
  select s.household_id, (now() at time zone h.timezone)::date into hh, today
  from event_series s join household h on h.id = s.household_id
  where s.id = target_series;

  if hh is null then return 0; end if;

  delete from event e
  where e.series_id = target_series
    and e.occurs_on > today
    and e.skipped_at is null;

  return app.materialise_household(hh);
end;
$$;

create or replace function app.rematerialise_bill_series(target_series uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hh    uuid;
  today date;
begin
  select s.household_id, (now() at time zone h.timezone)::date into hh, today
  from bill_series s join household h on h.id = s.household_id
  where s.id = target_series;

  if hh is null then return 0; end if;

  delete from bill b
  where b.series_id = target_series
    and b.due_on > today
    and b.paid_at is null
    and b.skipped_at is null;

  return app.materialise_household(hh);
end;
$$;

-- Moving a task's time never regenerated anything: 0002's trigger watched the
-- columns that decide *which* dates exist, and due_time decides *when* on them.
-- So "every day at 5 from now on" left sixty days of occurrences at the old
-- time. Now it regenerates the untouched ones.
drop trigger if exists task_materialise_update on task;

create trigger task_materialise_update
after update on task
for each row
when (
  old.recurrence_freq is distinct from new.recurrence_freq
  or old.by_weekday  is distinct from new.by_weekday
  or old.by_monthday is distinct from new.by_monthday
  or old.starts_on   is distinct from new.starts_on
  or old.ends_on     is distinct from new.ends_on
  or old.due_time    is distinct from new.due_time
  or old.active      is distinct from new.active
)
execute function app.materialise_on_task_change();

-- ── Editing tasks ────────────────────────────────────────────────────────

-- These are security definer because the column privileges above take direct
-- writes away from everyone, callers included. Each one therefore checks for
-- itself that the caller is an adult in the right household — that check is the
-- whole of their authorisation, so it is the first thing each one does.

create or replace function app.assert_member_of(target_member uuid, target_household uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- A foreign key only proves the member exists somewhere. Assigning a chore to
  -- someone in another household would otherwise be accepted.
  if target_member is not null and not exists (
    select 1 from member where id = target_member and household_id = target_household
  ) then
    raise exception 'that person is not in this household';
  end if;
end;
$$;

-- Change one day, or change it from here on.
--
-- A rename always applies to the whole task: titles live on the task, and a
-- corrected typo that only fixed today would be a strange thing to want.
create or replace function public.edit_occurrence(
  p_occurrence uuid,
  p_title      text,
  p_assignee   uuid,
  p_due_time   time,
  p_scope      text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o occurrence;
begin
  select * into o from occurrence where id = p_occurrence;
  if o.id is null then raise exception 'no such task'; end if;
  if not app.is_adult(o.household_id) then raise exception 'only an adult can change a task'; end if;
  if p_scope not in ('this', 'forward') then raise exception 'choose this one or from now on'; end if;

  perform app.assert_member_of(p_assignee, o.household_id);

  if coalesce(btrim(p_title), '') <> '' then
    update task set title = btrim(p_title) where id = o.task_id;
  end if;

  if p_scope = 'this' then
    update occurrence
       set assignee_id = p_assignee, due_time = p_due_time
     where id = p_occurrence;
  else
    -- The trigger regenerates untouched future occurrences with the new time;
    -- ones someone already changed keep their changes (ADR 0002).
    update task
       set default_assignee_id = p_assignee, due_time = p_due_time
     where id = o.task_id;

    -- This one follows the task from now on rather than keeping an override.
    update occurrence
       set assignee_id = null, due_time = p_due_time
     where id = p_occurrence;
  end if;
end;
$$;

-- Adults only: a child who could skip their own chores would never need to do
-- one, and the streak would never notice.
create or replace function public.skip_occurrence(p_occurrence uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o occurrence;
begin
  select * into o from occurrence where id = p_occurrence;
  if o.id is null then raise exception 'no such task'; end if;
  if not app.is_adult(o.household_id) then raise exception 'only an adult can skip a task'; end if;
  if o.completed_at is not null then raise exception 'that one is already done'; end if;

  update occurrence set skipped_at = now() where id = p_occurrence;
end;
$$;

-- Stopping a task. It is never deleted: its occurrences carry streaks and
-- points that were genuinely earned, and a cascade would take them with it.
create or replace function public.retire_task(p_task uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t     task;
  today date;
begin
  select * into t from task where id = p_task;
  if t.id is null then raise exception 'no such task'; end if;
  if not app.is_adult(t.household_id) then raise exception 'only an adult can stop a task'; end if;

  select (now() at time zone h.timezone)::date into today
  from household h where h.id = t.household_id;

  -- Flipping active is enough for the future: the trigger clears untouched
  -- occurrences and regeneration skips inactive tasks.
  update task set active = false where id = p_task;

  -- Today's, if not done, would otherwise sit on the board and then slip —
  -- for a task somebody has just stopped.
  update occurrence
     set skipped_at = now()
   where task_id = p_task
     and due_on = today
     and completed_at is null
     and skipped_at is null;
end;
$$;

-- ── Removing events and bills ────────────────────────────────────────────

-- The caller should not have to know whether a thing came from a series. A
-- one-off is simply deleted. An instance of a series is skipped, because
-- deleting it would only have the series generate it again within the hour.

create or replace function public.remove_event(p_event uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e event;
begin
  select * into e from event where id = p_event;
  if e.id is null then raise exception 'no such event'; end if;
  if not app.is_adult(e.household_id) then raise exception 'only an adult can remove an event'; end if;

  if e.series_id is null then
    delete from event where id = p_event;
  else
    update event set skipped_at = now() where id = p_event;
  end if;
end;
$$;

create or replace function public.remove_bill(p_bill uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b bill;
begin
  select * into b from bill where id = p_bill;
  if b.id is null then raise exception 'no such bill'; end if;
  if not app.is_adult(b.household_id) then raise exception 'only an adult can remove a bill'; end if;
  -- A paid bill is a record of money that moved. Undo the payment instead —
  -- delete its expense — and the bill becomes removable again.
  if b.paid_at is not null then raise exception 'that bill is already paid'; end if;

  if b.series_id is null then
    delete from bill where id = p_bill;
  else
    update bill set skipped_at = now() where id = p_bill;
  end if;
end;
$$;

-- Paying a skipped bill makes no sense; pay_bill from 0004 predates skipping.
create or replace function public.pay_bill(target_bill uuid)
returns uuid
language plpgsql
as $$
declare
  b           bill;
  me_id       uuid;
  tz          text;
  new_expense uuid;
begin
  select * into b from bill where id = target_bill;
  if b.id is null then raise exception 'no such bill'; end if;
  if b.paid_at is not null then raise exception 'that bill is already paid'; end if;
  if b.skipped_at is not null then raise exception 'that bill was skipped'; end if;

  select m.id into me_id
  from member m
  where m.user_id = auth.uid() and m.household_id = b.household_id;
  if me_id is null then raise exception 'not a member of that household'; end if;

  select h.timezone into tz from household h where h.id = b.household_id;

  insert into expense (household_id, label, amount, spent_on, spent_by)
  values (b.household_id, b.label, b.amount, (now() at time zone tz)::date, me_id)
  returning id into new_expense;

  update bill
     set paid_at = now(), paid_by = me_id, expense_id = new_expense
   where id = target_bill;

  if not found then raise exception 'only an adult can pay a bill'; end if;

  return new_expense;
end;
$$;

-- ── Deleting an expense that paid a bill ─────────────────────────────────

-- The foreign key would null out bill.expense_id and leave a bill marked paid
-- with no record of the money. Instead, deleting the expense un-pays the bill:
-- which is also, conveniently, how a mistaken payment is undone.
create or replace function app.unpay_on_expense_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update bill
     set paid_at = null, paid_by = null, expense_id = null
   where expense_id = old.id;
  return old;
end;
$$;

create trigger expense_unpays_bill
before delete on expense
for each row execute function app.unpay_on_expense_delete();

-- ── Who may call what ────────────────────────────────────────────────────

revoke execute on function public.edit_occurrence(uuid, text, uuid, time, text) from public;
revoke execute on function public.skip_occurrence(uuid) from public;
revoke execute on function public.retire_task(uuid) from public;
revoke execute on function public.remove_event(uuid) from public;
revoke execute on function public.remove_bill(uuid) from public;

grant execute on function public.edit_occurrence(uuid, text, uuid, time, text) to authenticated;
grant execute on function public.skip_occurrence(uuid) to authenticated;
grant execute on function public.retire_task(uuid) to authenticated;
grant execute on function public.remove_event(uuid) to authenticated;
grant execute on function public.remove_bill(uuid) to authenticated;
