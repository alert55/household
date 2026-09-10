-- Household — materialising occurrences
--
-- ADR 0002 says occurrences are stored, which means something has to create
-- them. This is that something.
--
-- Everything here leans on the unique (task_id, due_on) constraint from 0001:
-- generation is an INSERT ... ON CONFLICT DO NOTHING, so running it twice, or a
-- hundred times, can only ever be a no-op. That is what makes it safe to run on
-- a schedule, from a trigger, and by hand.

-- ── Generating the dates ─────────────────────────────────────────────────

-- Which calendar dates a task falls on, between two bounds. Split out on its
-- own because it is the part most likely to be wrong, and the part worth
-- reading in isolation.
create or replace function app.task_dates(
  t task,
  from_date date,
  to_date date
)
returns setof date
language sql
stable
as $$
  select g.d::date
  from generate_series(
    greatest(from_date, t.starts_on)::timestamp,
    least(to_date, coalesce(t.ends_on, to_date))::timestamp,
    interval '1 day'
  ) as g(d)
  where case t.recurrence_freq
    when 'once'   then g.d::date = t.starts_on
    when 'daily'  then true
    when 'weekly' then extract(dow from g.d)::smallint = any (t.by_weekday)
    -- A task due on the 31st still happens in February. The day is clamped to
    -- the end of the month rather than skipping the month entirely, because a
    -- chore that silently vanishes eleven times a year is worse than one that
    -- lands a day or three early.
    when 'monthly' then extract(day from g.d)::int = least(
      t.by_monthday,
      extract(day from (date_trunc('month', g.d) + interval '1 month - 1 day'))::int
    )
  end
$$;

-- ── Materialising ────────────────────────────────────────────────────────

-- Occurrences for one household, out to the horizon.
--
-- The horizon is measured from *that household's* today, not from UTC. A
-- household in Bangkok rolls over seven hours before one in London, and an
-- occurrence's whole meaning — whether it has slipped — depends on which day it
-- belongs to.
--
-- Generation never starts before today: back-filling the past would conjure
-- occurrences that are instantly slipped, for days nobody was ever asked about.
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
  made   integer;
begin
  select timezone into tz from household where id = target_household;
  if tz is null then
    raise exception 'unknown household %', target_household;
  end if;

  today := (now() at time zone tz)::date;

  insert into occurrence (household_id, task_id, due_on, due_time)
  select t.household_id, t.id, d, t.due_time
  from task t
  cross join lateral app.task_dates(
    t,
    -- A one-off is allowed to land on its stated date even if that date has
    -- already passed: it is a single row the user just typed, and showing it as
    -- overdue is right. The no-backfill rule exists to stop a *recurring* task
    -- conjuring weeks of instantly-slipped history, which this does not.
    --
    -- It also covers a timezone trap: task.starts_on defaults to current_date,
    -- which is the server's date, not the household's. For a household east of
    -- UTC late in the evening those differ by a day, and a one-off created then
    -- would otherwise never materialise at all.
    case when t.recurrence_freq = 'once' then t.starts_on else today end,
    today + horizon_days
  ) as d
  where t.household_id = target_household
    and t.active
  on conflict (task_id, due_on) do nothing;

  get diagnostics made = row_count;
  return made;
end;
$$;

create or replace function app.materialise_all(horizon_days integer default 60)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  h     record;
  total integer := 0;
begin
  for h in select id from household loop
    total := total + app.materialise_household(h.id, horizon_days);
  end loop;
  return total;
end;
$$;

-- ── Re-materialising after a schedule change ─────────────────────────────

-- ADR 0002's rule, made real: the past is never touched, untouched future
-- occurrences are regenerated, and future occurrences someone has already
-- reassigned or completed are left alone.
--
-- "Untouched" means nobody has completed it and nobody has overridden its
-- assignee. Today is treated as settled too — it is already on someone's board.
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

  if tz is null then
    return 0;
  end if;

  today := (now() at time zone tz)::date;

  delete from occurrence o
  where o.task_id = target_task
    and o.due_on > today
    and o.completed_at is null
    and o.assignee_id is null;

  return app.materialise_household(
    (select household_id from task where id = target_task)
  );
end;
$$;

-- ── Keeping it current ───────────────────────────────────────────────────

-- A task created at 9am should appear on today's board at 9am, not whenever the
-- schedule next runs.
create or replace function app.materialise_on_task_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform app.materialise_household(new.household_id);
  else
    perform app.rematerialise_task(new.id);
  end if;
  return null;
end;
$$;

create trigger task_materialise_insert
after insert on task
for each row execute function app.materialise_on_task_change();

-- Only when something that changes *which dates exist* has changed. Renaming a
-- task must not disturb its occurrences.
create trigger task_materialise_update
after update on task
for each row
when (
  old.recurrence_freq is distinct from new.recurrence_freq
  or old.by_weekday    is distinct from new.by_weekday
  or old.by_monthday   is distinct from new.by_monthday
  or old.starts_on     is distinct from new.starts_on
  or old.ends_on       is distinct from new.ends_on
  or old.active        is distinct from new.active
)
execute function app.materialise_on_task_change();

-- ── Schedule ─────────────────────────────────────────────────────────────

-- On Supabase, pg_cron may need enabling for the project before this will run.
create extension if not exists pg_cron;

-- Hourly, not daily. Households keep their own clocks, so there is no single
-- moment that is "midnight" for all of them — and since generation is
-- idempotent, an hourly run is a cheap no-op twenty-three times out of
-- twenty-four. Twenty past the hour to stay clear of whatever else runs on it.
select cron.schedule(
  'materialise-occurrences',
  '20 * * * *',
  $cron$ select app.materialise_all(); $cron$
);

-- ── Who may run this ─────────────────────────────────────────────────────

-- These are security definer, so they bypass row-level security by design —
-- which is exactly why nobody holding the anon key should be able to call them.
-- Left to postgres and the service role.
revoke execute on function app.materialise_household(uuid, integer) from public;
revoke execute on function app.materialise_all(integer) from public;
revoke execute on function app.rematerialise_task(uuid) from public;
revoke execute on function app.materialise_on_task_change() from public;
