-- Household — editing one instance of a series
--
-- This month's water bill is ฿812, not the usual ฿740. That edit is to one
-- instance, and it has to survive: without a mark on it, the next change to the
-- series would regenerate the future bills and quietly put ฿740 back. Occurrences
-- never had this problem, because an occurrence carries its override in
-- assignee_id; events and bills had nothing to carry one in.

alter table event add column edited_at timestamptz;
alter table bill  add column edited_at timestamptz;

-- ── Regeneration leaves an edited instance alone ─────────────────────────

-- Same rule as a skip, same reason (ADR 0002): somebody acted on it.
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
    and e.skipped_at is null
    and e.edited_at is null;

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
    and b.skipped_at is null
    and b.edited_at is null;

  return app.materialise_household(hh);
end;
$$;

-- ── Renaming a series reaches its instances ──────────────────────────────

-- 0003's triggers watched the columns that decide which dates exist, and the
-- amount — but not the name, or who an event is about. Each instance snapshots
-- those at generation, so renaming "Water" to "Water (MWA)" changed the series
-- and left sixty days of instances saying "Water". Same shape of bug as
-- due_time, fixed in 0008.
drop trigger if exists event_series_materialise_update on event_series;

create trigger event_series_materialise_update
after update on event_series
for each row
when (
  old.recurrence_freq is distinct from new.recurrence_freq
  or old.by_weekday     is distinct from new.by_weekday
  or old.by_monthday    is distinct from new.by_monthday
  or old.starts_on      is distinct from new.starts_on
  or old.ends_on        is distinct from new.ends_on
  or old.at_time        is distinct from new.at_time
  or old.duration       is distinct from new.duration
  or old.title          is distinct from new.title
  or old.subject_id     is distinct from new.subject_id
  or old.responsible_id is distinct from new.responsible_id
  or old.active         is distinct from new.active
)
execute function app.materialise_on_event_series_change();

drop trigger if exists bill_series_materialise_update on bill_series;

create trigger bill_series_materialise_update
after update on bill_series
for each row
when (
  old.recurrence_freq is distinct from new.recurrence_freq
  or old.by_weekday  is distinct from new.by_weekday
  or old.by_monthday is distinct from new.by_monthday
  or old.starts_on   is distinct from new.starts_on
  or old.ends_on     is distinct from new.ends_on
  or old.amount      is distinct from new.amount
  or old.label       is distinct from new.label
  or old.active      is distinct from new.active
)
execute function app.materialise_on_bill_series_change();

-- ── Following ADR 0005's own rule ────────────────────────────────────────

-- ADR 0005 says: invoker when a policy already says who may do it; definer only
-- when a column privilege stands in the way. 0008 broke that in the same breath
-- it was written — remove_event and remove_bill were made definer, though
-- event_admin and bill_admin already say an adult may. Put right here. The
-- explicit checks stay for their error messages; the policies are the gate.
create or replace function public.remove_event(p_event uuid)
returns void
language plpgsql
security invoker
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
security invoker
set search_path = public, pg_temp
as $$
declare
  b bill;
begin
  select * into b from bill where id = p_bill;
  if b.id is null then raise exception 'no such bill'; end if;
  if not app.is_adult(b.household_id) then raise exception 'only an adult can remove a bill'; end if;
  if b.paid_at is not null then raise exception 'that bill is already paid'; end if;

  if b.series_id is null then
    delete from bill where id = p_bill;
  else
    update bill set skipped_at = now() where id = p_bill;
  end if;
end;
$$;

-- ── Editing an event ─────────────────────────────────────────────────────

-- A date and a wall-clock time become an instant in the household's timezone,
-- here, for the reason add_event gives in 0007.
--
-- Editing one instance of a series marks it edited, so the series leaves it be.
-- occurs_on is deliberately not moved with it: it names the series slot this
-- instance fills, and moving it would free the slot for the series to fill
-- again — two swim classes where there should be one.
--
-- Invoker, per ADR 0005: event_admin already says an adult may do this.
create or replace function public.edit_event(
  p_event       uuid,
  p_title       text,
  p_on_date     date,
  p_at_time     time,
  p_subject     uuid default null,
  p_responsible uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  e      event;
  tz     text;
  starts timestamptz;
begin
  select * into e from event where id = p_event;
  if e.id is null then raise exception 'no such event'; end if;
  if not app.is_adult(e.household_id) then raise exception 'only an adult can change an event'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'an event needs a name'; end if;

  perform app.assert_member_of(p_subject, e.household_id);
  perform app.assert_member_of(p_responsible, e.household_id);

  select h.timezone into tz from household h where h.id = e.household_id;
  starts := (p_on_date + p_at_time) at time zone tz;

  update event
     set title          = btrim(p_title),
         subject_id     = p_subject,
         responsible_id = p_responsible,
         -- Keep the same length if it had one.
         ends_at        = case when ends_at is null then null else starts + (ends_at - starts_at) end,
         starts_at      = starts,
         edited_at      = case when series_id is not null then now() else edited_at end
   where id = p_event;
end;
$$;

grant execute on function public.edit_event(uuid, text, date, time, uuid, uuid) to authenticated;
