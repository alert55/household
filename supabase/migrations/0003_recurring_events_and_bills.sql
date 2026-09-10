-- Household — recurrence for events and bills
--
-- 0001 left two gaps and called them the same gap: recurrence was a property of
-- tasks alone, so a weekly swim class and a monthly water bill both had to be
-- entered by hand. This closes both with one mechanism.
--
-- What is shared is the *logic*, not the columns. app.recurrence_dates() now
-- holds the date rules, and task, event_series and bill_series each keep their
-- own five recurrence columns. Normalising those into a shared table would add
-- a join to every generation query to save duplicating five columns across
-- three tables — the wrong trade at this size. Triplicating the date logic
-- would have been the expensive kind of duplication, and that is the kind that
-- is now gone.

-- ── The date rules, free of any one table ────────────────────────────────

create or replace function app.recurrence_dates(
  freq        recurrence_freq,
  by_weekday  smallint[],
  by_monthday smallint,
  starts_on   date,
  ends_on     date,
  from_date   date,
  to_date     date
)
returns setof date
language sql
immutable
as $$
  select g.d::date
  from generate_series(
    greatest(from_date, starts_on)::timestamp,
    least(to_date, coalesce(ends_on, to_date))::timestamp,
    interval '1 day'
  ) as g(d)
  where case freq
    when 'once'   then g.d::date = starts_on
    when 'daily'  then true
    when 'weekly' then extract(dow from g.d)::smallint = any (by_weekday)
    -- Clamped to month end: a thing due on the 31st still happens in February.
    when 'monthly' then extract(day from g.d)::int = least(
      by_monthday,
      extract(day from (date_trunc('month', g.d) + interval '1 month - 1 day'))::int
    )
  end
$$;

-- Kept as the task-shaped way in, now a one-line delegation.
create or replace function app.task_dates(t task, from_date date, to_date date)
returns setof date
language sql
stable
as $$
  select app.recurrence_dates(
    t.recurrence_freq, t.by_weekday, t.by_monthday,
    t.starts_on, t.ends_on, from_date, to_date
  );
$$;

-- ── Series ───────────────────────────────────────────────────────────────

-- A series is recurring by definition. A one-off event is just an event and a
-- one-off bill is just a bill, so 'once' is excluded rather than left to mean
-- something odd.

create table event_series (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references household(id) on delete cascade,
  title           text not null,
  subject_id      uuid references member(id) on delete set null,
  responsible_id  uuid references member(id) on delete set null,
  at_time         time not null,
  duration        interval,

  recurrence_freq recurrence_freq not null,
  by_weekday      smallint[],
  by_monthday     smallint check (by_monthday between 1 and 31),
  starts_on       date not null default current_date,
  ends_on         date,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),

  constraint series_recurs check (recurrence_freq <> 'once'),
  constraint weekly_needs_weekdays
    check (recurrence_freq <> 'weekly' or by_weekday is not null),
  constraint monthly_needs_monthday
    check (recurrence_freq <> 'monthly' or by_monthday is not null)
);

create table bill_series (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references household(id) on delete cascade,
  label           text not null,
  amount          numeric(12,2) not null check (amount > 0),

  recurrence_freq recurrence_freq not null,
  by_weekday      smallint[],
  by_monthday     smallint check (by_monthday between 1 and 31),
  starts_on       date not null default current_date,
  ends_on         date,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),

  constraint series_recurs check (recurrence_freq <> 'once'),
  constraint weekly_needs_weekdays
    check (recurrence_freq <> 'weekly' or by_weekday is not null),
  constraint monthly_needs_monthday
    check (recurrence_freq <> 'monthly' or by_monthday is not null)
);

create index event_series_household_idx on event_series (household_id) where active;
create index bill_series_household_idx  on bill_series  (household_id) where active;

-- ── Instances point back at their series ─────────────────────────────────

-- Null series_id means someone entered this one by hand. The unique
-- constraints ignore those rows, since NULL never conflicts — which is exactly
-- what we want: hand-entered instances are nobody's business but the author's.
alter table event
  add column series_id uuid references event_series(id) on delete cascade,
  -- The household-local date this instance belongs to. starts_at alone cannot
  -- serve, because deduplication has to happen per calendar day in the
  -- household's own timezone, not per instant.
  add column occurs_on date,
  add constraint event_series_once_per_day unique (series_id, occurs_on);

alter table bill
  add column series_id uuid references bill_series(id) on delete cascade,
  add constraint bill_series_once_per_day unique (series_id, due_on);

create index event_series_idx on event (series_id) where series_id is not null;
create index bill_series_idx  on bill  (series_id) where series_id is not null;

-- ── Generation ───────────────────────────────────────────────────────────

-- Now covers all three. Same horizon, same clock, same idempotence: every
-- insert is ON CONFLICT DO NOTHING against a unique key.
create or replace function app.materialise_household(
  target_household uuid,
  horizon_days integer default 60
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tz     text;
  today  date;
  total  integer := 0;
  made   integer;
begin
  select timezone into tz from household where id = target_household;
  if tz is null then
    raise exception 'unknown household %', target_household;
  end if;

  today := (now() at time zone tz)::date;

  -- Occurrences
  insert into occurrence (household_id, task_id, due_on, due_time)
  select t.household_id, t.id, d, t.due_time
  from task t
  cross join lateral app.recurrence_dates(
    t.recurrence_freq, t.by_weekday, t.by_monthday, t.starts_on, t.ends_on,
    -- A one-off may land on a date already past; see 0002.
    case when t.recurrence_freq = 'once' then t.starts_on else today end,
    today + horizon_days
  ) as d
  where t.household_id = target_household and t.active
  on conflict (task_id, due_on) do nothing;

  get diagnostics made = row_count;
  total := total + made;

  -- Events. starts_at is the local date and time read in the household's
  -- timezone, so a 5:30pm class is 5:30pm there regardless of where the server
  -- happens to be.
  insert into event (household_id, series_id, occurs_on, title, subject_id,
                     responsible_id, starts_at, ends_at)
  select
    s.household_id, s.id, d, s.title, s.subject_id, s.responsible_id,
    (d + s.at_time) at time zone tz,
    case when s.duration is null then null
         else ((d + s.at_time) at time zone tz) + s.duration end
  from event_series s
  cross join lateral app.recurrence_dates(
    s.recurrence_freq, s.by_weekday, s.by_monthday, s.starts_on, s.ends_on,
    today, today + horizon_days
  ) as d
  where s.household_id = target_household and s.active
  on conflict (series_id, occurs_on) do nothing;

  get diagnostics made = row_count;
  total := total + made;

  -- Bills. The amount is snapshotted, so raising the standing amount next month
  -- does not quietly restate what September's bill said.
  insert into bill (household_id, series_id, label, amount, due_on)
  select s.household_id, s.id, s.label, s.amount, d
  from bill_series s
  cross join lateral app.recurrence_dates(
    s.recurrence_freq, s.by_weekday, s.by_monthday, s.starts_on, s.ends_on,
    today, today + horizon_days
  ) as d
  where s.household_id = target_household and s.active
  on conflict (series_id, due_on) do nothing;

  get diagnostics made = row_count;
  total := total + made;

  return total;
end;
$$;

-- ── Re-materialising after a schedule change ─────────────────────────────

-- Same rule as tasks (ADR 0002): never touch the past, drop untouched future
-- instances, leave anything someone has already acted on alone.
--
-- What counts as "acted on" differs by kind, because the kinds differ. A bill
-- has been paid or it has not. An event has no such state — ADR 0001 is explicit
-- that an event is never ticked off — so every future instance is replaceable.

create or replace function app.rematerialise_event_series(target_series uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hh uuid;
  today date;
begin
  select s.household_id, (now() at time zone h.timezone)::date
    into hh, today
  from event_series s join household h on h.id = s.household_id
  where s.id = target_series;

  if hh is null then return 0; end if;

  delete from event e
  where e.series_id = target_series and e.occurs_on > today;

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
  hh uuid;
  today date;
begin
  select s.household_id, (now() at time zone h.timezone)::date
    into hh, today
  from bill_series s join household h on h.id = s.household_id
  where s.id = target_series;

  if hh is null then return 0; end if;

  delete from bill b
  where b.series_id = target_series
    and b.due_on > today
    and b.paid_at is null;

  return app.materialise_household(hh);
end;
$$;

-- ── Keeping it current ───────────────────────────────────────────────────

create or replace function app.materialise_on_event_series_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform app.materialise_household(new.household_id);
  else
    perform app.rematerialise_event_series(new.id);
  end if;
  return null;
end;
$$;

create or replace function app.materialise_on_bill_series_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform app.materialise_household(new.household_id);
  else
    perform app.rematerialise_bill_series(new.id);
  end if;
  return null;
end;
$$;

create trigger event_series_materialise_insert
after insert on event_series
for each row execute function app.materialise_on_event_series_change();

create trigger event_series_materialise_update
after update on event_series
for each row
when (
  old.recurrence_freq is distinct from new.recurrence_freq
  or old.by_weekday  is distinct from new.by_weekday
  or old.by_monthday is distinct from new.by_monthday
  or old.starts_on   is distinct from new.starts_on
  or old.ends_on     is distinct from new.ends_on
  or old.at_time     is distinct from new.at_time
  or old.active      is distinct from new.active
)
execute function app.materialise_on_event_series_change();

create trigger bill_series_materialise_insert
after insert on bill_series
for each row execute function app.materialise_on_bill_series_change();

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
  or old.active      is distinct from new.active
)
execute function app.materialise_on_bill_series_change();

-- ── Row-level security ───────────────────────────────────────────────────

-- ADR 0004: a table without a policy is readable by anyone holding the anon
-- key. Both new tables are adults-only, matching the instances they produce.

alter table event_series enable row level security;
alter table bill_series  enable row level security;

create policy event_series_read on event_series
  for select using (household_id in (select app.my_households()));

create policy bill_series_read on bill_series
  for select using (household_id in (select app.my_households()));

create policy event_series_admin on event_series
  for all using (app.is_adult(household_id));

create policy bill_series_admin on bill_series
  for all using (app.is_adult(household_id));

revoke execute on function app.rematerialise_event_series(uuid) from public;
revoke execute on function app.rematerialise_bill_series(uuid) from public;
revoke execute on function app.materialise_on_event_series_change() from public;
revoke execute on function app.materialise_on_bill_series_change() from public;

-- ── Still to build ───────────────────────────────────────────────────────
--
-- The list from 0001 is now empty. What remains is not schema: applying these
-- migrations to a real project, and proving the generation logic against a live
-- Postgres rather than a parser.
