-- Household — initial schema
--
-- Vocabulary follows CONTEXT.md exactly. Where a decision here is not obvious,
-- the ADR that made it is named in a comment.
--
-- Every table carries household_id, even where it could be reached by a join.
-- That denormalisation is deliberate: it keeps every row-level security policy
-- a single-table predicate instead of a join, which is both faster and much
-- harder to get subtly wrong.

create extension if not exists "pgcrypto";

create schema if not exists app;

-- ── Types ────────────────────────────────────────────────────────────────

create type member_role as enum ('adult', 'child');
create type recurrence_freq as enum ('once', 'daily', 'weekly', 'monthly');
create type budget_period as enum ('weekly', 'monthly');

-- ── Household and members ────────────────────────────────────────────────

create table household (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  -- ADR 0002: the horizon is extended per household, in its own timezone.
  -- Whether an occurrence has slipped is meaningless without this.
  timezone      text not null default 'Asia/Bangkok',
  currency      text not null default 'THB',
  week_starts_on smallint not null default 0 check (week_starts_on between 0 and 6),
  created_at    timestamptz not null default now()
);

create table member (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id) on delete cascade,
  -- Nullable on purpose: a young child is a member of the household long
  -- before they have a login of their own.
  user_id      uuid unique references auth.users(id) on delete set null,
  display_name text not null,
  role         member_role not null,
  accent       text not null default 'sage' check (accent in ('sage','clay','gold')),
  created_at   timestamptz not null default now()
);

create index member_household_idx on member (household_id);

-- ── Tasks and occurrences ────────────────────────────────────────────────

create table task (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references household(id) on delete cascade,
  title               text not null,
  -- An occurrence inherits this unless it names someone else (CONTEXT.md).
  default_assignee_id uuid references member(id) on delete set null,

  recurrence_freq     recurrence_freq not null default 'once',
  -- 0=Sunday. Used by 'weekly'; also expresses "weekdays" as {1,2,3,4,5}.
  by_weekday          smallint[],
  by_monthday         smallint check (by_monthday between 1 and 31),
  due_time            time,
  starts_on           date not null default current_date,
  ends_on             date,

  -- The "+10" in the design. What a child earns for completing an occurrence.
  points              integer not null default 0 check (points >= 0),
  -- Retire a task without deleting the occurrences that carry its history.
  active              boolean not null default true,
  created_at          timestamptz not null default now(),

  constraint weekly_needs_weekdays
    check (recurrence_freq <> 'weekly' or by_weekday is not null),
  constraint monthly_needs_monthday
    check (recurrence_freq <> 'monthly' or by_monthday is not null)
);

create index task_household_idx on task (household_id) where active;

create table occurrence (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id) on delete cascade,
  task_id      uuid not null references task(id) on delete cascade,

  due_on       date not null,
  -- Snapshotted from the task when the occurrence is materialised. ADR 0002
  -- says the past is never touched: editing a task's time tomorrow must not
  -- silently change when yesterday's occurrence was due.
  due_time     time,

  -- NULL means "inherit from task.default_assignee_id" — modelled exactly as
  -- the glossary words it, rather than copying the assignee down eagerly.
  assignee_id  uuid references member(id) on delete set null,

  completed_at timestamptz,
  completed_by uuid references member(id) on delete set null,
  -- ADR 0002: points are recorded on the occurrence that earned them, so
  -- regenerating the horizon can never double-award.
  points_awarded integer not null default 0 check (points_awarded >= 0),

  created_at   timestamptz not null default now(),

  -- The constraint that makes extending the horizon idempotent. Re-running
  -- materialisation can only ever be a no-op.
  unique (task_id, due_on),

  constraint completed_needs_who
    check ((completed_at is null) = (completed_by is null))
);

-- NOTE: there is deliberately no `slipped` column here. ADR 0002 forbids it —
-- slipped is a function of the clock, and a stored flag is wrong in the window
-- before whatever job flips it runs. See the occurrence_current view below.

create index occurrence_due_idx on occurrence (household_id, due_on);
create index occurrence_open_idx on occurrence (household_id, due_on)
  where completed_at is null;

-- ── Events ───────────────────────────────────────────────────────────────

-- ADR 0001: events are not tasks. No completed_at, because an event is never
-- ticked off — it arrives and it passes.
create table event (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references household(id) on delete cascade,
  title          text not null,
  -- The member it is about; null for a household-wide event.
  subject_id     uuid references member(id) on delete set null,
  -- Who carries it out, when that is someone else. May be none (CONTEXT.md).
  responsible_id uuid references member(id) on delete set null,
  starts_at      timestamptz not null,
  ends_at        timestamptz,
  created_at     timestamptz not null default now(),

  constraint ends_after_starts check (ends_at is null or ends_at > starts_at)
);

create index event_household_starts_idx on event (household_id, starts_at);

-- KNOWN GAP: events are single instances. A weekly swim class must currently be
-- entered week by week. Giving events a recurrence means giving them a horizon
-- and a materialisation job too — the same machinery task/occurrence already
-- has. See the note at the foot of this file.

-- ── Money ────────────────────────────────────────────────────────────────

create table expense (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id) on delete cascade,
  label        text not null,
  amount       numeric(12,2) not null check (amount > 0),
  spent_on     date not null default current_date,
  spent_by     uuid references member(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index expense_household_spent_idx on expense (household_id, spent_on desc);

create table bill (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id) on delete cascade,
  label        text not null,
  amount       numeric(12,2) not null check (amount > 0),
  due_on       date not null,
  paid_at      timestamptz,
  paid_by      uuid references member(id) on delete set null,
  -- CONTEXT.md: paying a bill records an expense. The link keeps the two facts
  -- from drifting apart.
  expense_id   uuid unique references expense(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint paid_needs_who check ((paid_at is null) = (paid_by is null))
);

create index bill_due_idx on bill (household_id, due_on) where paid_at is null;

-- KNOWN GAP: bills are single rows. A monthly water bill is the same recurrence
-- problem as a weekly swim class.

create table budget (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references household(id) on delete cascade,
  period         budget_period not null default 'weekly',
  amount         numeric(12,2) not null check (amount > 0),
  -- Ceilings change. Keeping them dated means last month's figures still make
  -- sense against last month's ceiling.
  effective_from date not null default current_date,
  created_at     timestamptz not null default now(),

  unique (household_id, period, effective_from)
);

-- ── Kitchen ──────────────────────────────────────────────────────────────

create table pantry_item (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references household(id) on delete cascade,
  name           text not null,
  -- Unlike `slipped`, low IS stored: someone decides a thing is running out.
  -- It is a judgement, not a function of the clock.
  is_low         boolean not null default false,
  marked_low_at  timestamptz,
  created_at     timestamptz not null default now(),

  unique (household_id, name)
);

create table shopping_list (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id) on delete cascade,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

create table shopping_list_item (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references household(id) on delete cascade,
  shopping_list_id uuid not null references shopping_list(id) on delete cascade,
  pantry_item_id  uuid references pantry_item(id) on delete set null,
  -- Free text so you can add something you do not keep in stock.
  label           text not null,
  got             boolean not null default false,

  unique (shopping_list_id, pantry_item_id)
);

-- ── Rewards ──────────────────────────────────────────────────────────────

create table reward (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references household(id) on delete cascade,
  label           text not null,
  -- A reward is obtained either by spending points or by reaching a streak.
  cost_points     integer check (cost_points > 0),
  streak_task_id  uuid references task(id) on delete cascade,
  streak_days     integer check (streak_days > 0),
  created_at      timestamptz not null default now(),

  constraint one_way_to_earn check (
    (cost_points is not null and streak_task_id is null and streak_days is null)
    or
    (cost_points is null and streak_task_id is not null and streak_days is not null)
  )
);

create table redemption (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id) on delete cascade,
  reward_id    uuid not null references reward(id) on delete cascade,
  member_id    uuid not null references member(id) on delete cascade,
  points_spent integer not null default 0 check (points_spent >= 0),
  redeemed_at  timestamptz not null default now()
);

-- ── Derived reads ────────────────────────────────────────────────────────

-- Slipped, computed rather than stored. The due moment is the occurrence's own
-- date and time read in the household's timezone; with no time, it is the end
-- of that day.
create view occurrence_current as
select
  o.*,
  coalesce(o.assignee_id, t.default_assignee_id) as effective_assignee_id,
  t.title,
  t.points as points_on_offer,
  ((o.due_on + coalesce(o.due_time, time '23:59:59')) at time zone h.timezone) as due_at,
  (
    o.completed_at is null
    and ((o.due_on + coalesce(o.due_time, time '23:59:59')) at time zone h.timezone) < now()
  ) as slipped
from occurrence o
join task t      on t.id = o.task_id
join household h on h.id = o.household_id;

-- Streaks, per CONTEXT.md: consecutive days a child completed every occurrence
-- of one recurring task.
--
-- The runs are built over each task's own occurrence sequence, NOT over
-- calendar dates. That matters: a weekdays-only task has a two-day gap every
-- weekend, and counting calendar days would break the streak every Friday.
create view streak_run as
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
  count(*)      as length,
  min(due_on)   as started_on,
  max(due_on)   as last_on
from grouped
group by household_id, task_id, member_id, run_id;

-- The run still alive: the most recent one, provided nothing has slipped since.
create view streak_current as
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

-- ── Guards the interface must not be trusted to keep ──────────────────────

-- ADR 0004 promised that "only children earn points" stops being a UI
-- convention. This is where that promise is kept.
create or replace function app.enforce_child_points()
returns trigger
language plpgsql
as $$
declare
  earner_role member_role;
begin
  if new.points_awarded > 0 then
    select role into earner_role
    from member
    where id = coalesce(new.completed_by, new.assignee_id);

    if earner_role is distinct from 'child' then
      raise exception 'points may only be awarded to a child (member %)',
        coalesce(new.completed_by, new.assignee_id);
    end if;
  end if;
  return new;
end;
$$;

create trigger occurrence_child_points
before insert or update on occurrence
for each row execute function app.enforce_child_points();

-- ── Row-level security ───────────────────────────────────────────────────

-- ADR 0004: the anon key ships in public client code, so these policies ARE the
-- household boundary. A table reachable without one is readable by anyone who
-- views source.

-- security definer so the lookup itself is not subject to member's own policy,
-- which would otherwise recurse.
create or replace function app.my_households()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select household_id from member where user_id = auth.uid();
$$;

create or replace function app.is_adult(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from member
    where user_id = auth.uid()
      and household_id = target_household
      and role = 'adult'
  );
$$;

alter table household           enable row level security;
alter table member              enable row level security;
alter table task                enable row level security;
alter table occurrence          enable row level security;
alter table event               enable row level security;
alter table expense             enable row level security;
alter table bill                enable row level security;
alter table budget              enable row level security;
alter table pantry_item         enable row level security;
alter table shopping_list       enable row level security;
alter table shopping_list_item  enable row level security;
alter table reward              enable row level security;
alter table redemption          enable row level security;

create policy household_read on household
  for select using (id in (select app.my_households()));

create policy household_write on household
  for update using (app.is_adult(id));

-- Everything else keys off household_id, which is why every table has one.
do $$
declare t text;
begin
  foreach t in array array[
    'member','task','occurrence','event','expense','bill','budget',
    'pantry_item','shopping_list','shopping_list_item','reward','redemption'
  ]
  loop
    execute format(
      'create policy %1$s_read on %1$s for select
         using (household_id in (select app.my_households()))', t);
  end loop;
end $$;

-- Writes that are anyone's: ticking off your own work, adding an expense,
-- flagging the milk as low, starting a shopping list.
--
-- Note there is no insert policy on occurrence. Occurrences are created only by
-- the materialisation job, which runs privileged and bypasses RLS — including
-- for a 'once' task. That absence is deliberate, not an oversight.
create policy occurrence_tick on occurrence
  for update using (household_id in (select app.my_households()));

create policy expense_add on expense
  for insert with check (household_id in (select app.my_households()));

-- Someone will mistype an amount. Correcting it is an adult's job.
create policy expense_amend on expense
  for update using (app.is_adult(household_id));

create policy expense_remove on expense
  for delete using (app.is_adult(household_id));

create policy pantry_touch on pantry_item
  for all using (household_id in (select app.my_households()));

create policy shopping_list_touch on shopping_list
  for all using (household_id in (select app.my_households()));

create policy shopping_item_touch on shopping_list_item
  for all using (household_id in (select app.my_households()));

-- Writes reserved to adults: CONTEXT.md says an adult assigns work, approves
-- rewards and pays bills.
create policy task_admin on task
  for all using (app.is_adult(household_id));

create policy member_admin on member
  for all using (app.is_adult(household_id));

create policy bill_admin on bill
  for all using (app.is_adult(household_id));

create policy budget_admin on budget
  for all using (app.is_adult(household_id));

create policy reward_admin on reward
  for all using (app.is_adult(household_id));

create policy redemption_admin on redemption
  for all using (app.is_adult(household_id));

create policy event_admin on event
  for all using (app.is_adult(household_id));

-- ── Still to build ───────────────────────────────────────────────────────
--
-- 1. Materialisation. Something must create occurrences out to the horizon and
--    extend it daily, per household and in that household's timezone. pg_cron
--    is the intended home (ADR 0004). The unique (task_id, due_on) above makes
--    it safe to run as often as we like.
--
-- 2. Recurrence for events and bills. Both gaps noted above are the same gap:
--    recurrence is currently a property of tasks alone. Whatever generates
--    occurrences should probably grow to serve all three rather than being
--    copied twice.
--
-- 3. What happens to materialised occurrences when a task's recurrence is
--    edited. ADR 0002 proposes: never touch the past, regenerate untouched
--    future occurrences, leave altered or completed ones alone.
