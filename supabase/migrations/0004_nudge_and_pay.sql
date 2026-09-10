-- Household — the two actions the board offers
--
-- "Pay" was already described by the glossary: paying a bill records an expense.
-- "Nudge" was not described by anything, which is why it needed a table before
-- it could need a button.
--
-- Both functions live in `public`, not `app`, because PostgREST only exposes the
-- public schema — a function in `app` cannot be called over the API at all. That
-- split is the useful one: everything in `app` (materialisation, the RLS
-- helpers) is deliberately unreachable from a browser holding the anon key.

-- ── Paying a bill ────────────────────────────────────────────────────────

-- Two writes that must not half-happen: the expense is recorded and the bill is
-- marked paid, or neither is. A function body is one transaction, so this is
-- the cheapest way to get that.
--
-- Deliberately NOT security definer. The adults-only rule already exists as the
-- bill_admin policy from 0001, and running as the caller keeps that the only
-- copy of the rule. A child calling this gets zero rows from the update, which
-- is turned into a plain error below rather than a silent no-op.
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
  -- Also the answer when row-level security simply hides it.
  if b.id is null then
    raise exception 'no such bill';
  end if;

  if b.paid_at is not null then
    raise exception 'that bill is already paid';
  end if;

  select m.id into me_id
  from member m
  where m.user_id = auth.uid() and m.household_id = b.household_id;

  if me_id is null then
    raise exception 'not a member of that household';
  end if;

  select h.timezone into tz from household h where h.id = b.household_id;

  insert into expense (household_id, label, amount, spent_on, spent_by)
  values (b.household_id, b.label, b.amount, (now() at time zone tz)::date, me_id)
  returning id into new_expense;

  update bill
     set paid_at = now(), paid_by = me_id, expense_id = new_expense
   where id = target_bill;

  if not found then
    raise exception 'only an adult can pay a bill';
  end if;

  return new_expense;
end;
$$;

-- ── Nudging ──────────────────────────────────────────────────────────────

-- A reminder one member sends another about a slipped occurrence. Until there
-- is push (ADR 0004 is explicit that Supabase does not hand us that), a nudge is
-- something the other person finds waiting next time they open the app.
create table nudge (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references household(id) on delete cascade,
  occurrence_id  uuid not null references occurrence(id) on delete cascade,
  from_member_id uuid not null references member(id) on delete cascade,
  to_member_id   uuid not null references member(id) on delete cascade,
  -- The household's date, not the server's — same reason as everywhere else.
  nudged_on      date not null,
  created_at     timestamptz not null default now(),
  seen_at        timestamptz,

  constraint no_self_nudge check (from_member_id <> to_member_id),

  -- One nudge per person, per occurrence, per day. Nagging is not a feature,
  -- and a button that can be pressed twenty times is a way to make a child
  -- dread the app.
  unique (occurrence_id, from_member_id, nudged_on)
);

create index nudge_inbox_idx on nudge (to_member_id, seen_at) where seen_at is null;

-- Resolves the household, the recipient and the date itself, so the client
-- cannot get any of them wrong or claim to be somebody else.
create or replace function public.send_nudge(target_occurrence uuid)
returns uuid
language plpgsql
as $$
declare
  o        record;
  me_id    uuid;
  tz       text;
  new_id   uuid;
begin
  select oc.id, oc.household_id, oc.effective_assignee_id, oc.completed_at
    into o
  from occurrence_current oc
  where oc.id = target_occurrence;

  if o.id is null then
    raise exception 'no such occurrence';
  end if;

  if o.completed_at is not null then
    raise exception 'that one is already done';
  end if;

  if o.effective_assignee_id is null then
    raise exception 'nobody is assigned to that';
  end if;

  select m.id into me_id
  from member m
  where m.user_id = auth.uid() and m.household_id = o.household_id;

  if me_id is null then
    raise exception 'not a member of that household';
  end if;

  if me_id = o.effective_assignee_id then
    raise exception 'that one is yours';
  end if;

  select h.timezone into tz from household h where h.id = o.household_id;

  insert into nudge (household_id, occurrence_id, from_member_id, to_member_id, nudged_on)
  values (o.household_id, target_occurrence, me_id, o.effective_assignee_id,
          (now() at time zone tz)::date)
  on conflict (occurrence_id, from_member_id, nudged_on) do nothing
  returning id into new_id;

  if new_id is null then
    raise exception 'already nudged about that today';
  end if;

  return new_id;
end;
$$;

-- ── Row-level security ───────────────────────────────────────────────────

alter table nudge enable row level security;

create policy nudge_read on nudge
  for select using (household_id in (select app.my_households()));

-- You may only send as yourself.
create policy nudge_send on nudge
  for insert with check (
    household_id in (select app.my_households())
    and from_member_id in (select id from member where user_id = auth.uid())
  );

-- Only the person nudged can mark it seen.
create policy nudge_seen on nudge
  for update using (
    to_member_id in (select id from member where user_id = auth.uid())
  );

grant execute on function public.pay_bill(uuid) to authenticated;
grant execute on function public.send_nudge(uuid) to authenticated;
