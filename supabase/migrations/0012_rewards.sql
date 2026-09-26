-- Household — rewards: points to spend, streaks to reach, an adult to approve
--
-- 0001 made the tables and left them unused. CONTEXT.md already had the rules:
-- a reward is obtained by spending points or by reaching a streak, only a child
-- earns either, and an adult approves. This adds what those rules need.
--
--   * A balance. Points were awarded per occurrence and never added up.
--   * Asking. A child asks; the points are held from that moment, so they
--     cannot be asked for twice; an adult approves or declines. An adult may
--     also give a reward outright — how a child with no login gets one.
--   * Repeating streaks. "Movie night for 7 days of homework in a row" is
--     earned again at 14 and 21. A break starts the count over.
--
-- Rewards are retired rather than deleted: deleting one would cascade to its
-- redemptions and quietly hand back every point ever spent on it.

-- ── Rewards ──────────────────────────────────────────────────────────────

alter table reward add column active boolean not null default true;

-- Adults still add and edit rewards directly (reward_admin, 0001). Removing is
-- retiring, an update; the delete that would erase history is taken away.
revoke delete on reward from authenticated;

-- ── Redemptions: asked for, then decided ─────────────────────────────────

-- Existing rows, if any, were written by an adult directly: already approved.
alter table redemption
  add column status       text not null default 'approved'
    check (status in ('requested', 'approved', 'declined')),
  add column requested_by uuid references member(id) on delete set null,
  add column decided_by   uuid references member(id) on delete set null,
  add column decided_at   timestamptz;

comment on column redemption.redeemed_at is
  'When it was asked for, or given. decided_at is when an adult approved or declined it.';

-- Every write goes through the functions below, which check the balance and
-- who is asking. A direct insert could spend points a child does not have.
revoke insert, update on redemption from authenticated;

-- ── What each child has ──────────────────────────────────────────────────

-- Earned is every point awarded on a child's occurrences; points_awarded is
-- already zeroed when an occurrence is unticked (0008), so that needs no
-- special case. Held is what is asked for and not yet decided.
create view points_balance with (security_invoker = true) as
select
  m.household_id,
  m.id as member_id,
  coalesce(e.earned, 0) as earned,
  coalesce(s.spent, 0)  as spent,
  coalesce(s.held, 0)   as held,
  coalesce(e.earned, 0) - coalesce(s.spent, 0) - coalesce(s.held, 0) as available
from member m
left join (
  select coalesce(o.assignee_id, t.default_assignee_id) as member_id,
         sum(o.points_awarded) as earned
  from occurrence o
  join task t on t.id = o.task_id
  group by 1
) e on e.member_id = m.id
left join (
  select member_id,
         sum(points_spent) filter (where status = 'approved')  as spent,
         sum(points_spent) filter (where status = 'requested') as held
  from redemption
  group by member_id
) s on s.member_id = m.id
where m.role = 'child';

-- Each streak reward against each child's current run of its task. `earned` is
-- how many times the run has reached the reward (7 days: once; 14: twice);
-- `claimed` is how many of those were asked for or given since the run began.
create view streak_reward_status with (security_invoker = true) as
select
  r.id as reward_id,
  r.household_id,
  sc.member_id,
  sc.length,
  sc.started_on,
  r.streak_days,
  (sc.length / r.streak_days)::int as earned,
  (
    select count(*)::int
    from redemption d
    where d.reward_id = r.id
      and d.member_id = sc.member_id
      and d.status in ('requested', 'approved')
      and (d.redeemed_at at time zone h.timezone)::date >= sc.started_on
  ) as claimed
from reward r
join household h      on h.id = r.household_id
join streak_current sc on sc.task_id = r.streak_task_id
join member m         on m.id = sc.member_id and m.role = 'child'
where r.streak_task_id is not null
  and r.active;

grant select on points_balance, streak_reward_status to authenticated;

-- ── The checks every way of getting a reward shares ──────────────────────

-- Raises unless `target_member` is a child who can have this reward now.
-- Returns the points it will cost them (zero for a streak reward).
create or replace function app.reward_cost_for(target_reward uuid, target_member uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r     record;
  kid   record;
  have  integer;
  left_ integer;
begin
  select id, household_id, cost_points, streak_task_id, active into r
  from reward where id = target_reward;
  if r.id is null or not r.active then
    raise exception 'that reward is not on offer';
  end if;

  select id, role into kid
  from member where id = target_member and household_id = r.household_id;
  if kid.id is null then
    raise exception 'that person is not in this household';
  end if;
  if kid.role <> 'child' then
    raise exception 'rewards are for children';
  end if;

  if r.cost_points is not null then
    select available into have from points_balance where member_id = target_member;
    if coalesce(have, 0) < r.cost_points then
      raise exception 'not enough points yet: % of %', coalesce(have, 0), r.cost_points;
    end if;
    return r.cost_points;
  end if;

  select earned - claimed into left_
  from streak_reward_status
  where reward_id = target_reward and member_id = target_member;
  if coalesce(left_, 0) < 1 then
    raise exception 'the streak has not reached it yet';
  end if;
  return 0;
end;
$$;

revoke execute on function app.reward_cost_for(uuid, uuid) from public;

-- ── Asking, giving, deciding ─────────────────────────────────────────────

-- A child asks for a reward for themselves. The points are held at once.
create or replace function public.request_reward(target_reward uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me     uuid;
  cost   integer;
  new_id uuid;
begin
  select m.id into me
  from member m join reward r on r.household_id = m.household_id
  where m.user_id = auth.uid() and r.id = target_reward;
  if me is null then
    raise exception 'not a member of that household';
  end if;

  cost := app.reward_cost_for(target_reward, me);

  insert into redemption (household_id, reward_id, member_id, points_spent, status, requested_by)
  select household_id, id, me, cost, 'requested', me from reward where id = target_reward
  returning id into new_id;
  return new_id;
end;
$$;

-- An adult gives a reward outright: asked and approved in one step.
create or replace function public.give_reward(target_reward uuid, target_member uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hh     uuid;
  me     uuid;
  cost   integer;
  new_id uuid;
begin
  select household_id into hh from reward where id = target_reward;
  if hh is null or not app.is_adult(hh) then
    raise exception 'only an adult can give a reward';
  end if;
  select id into me from member where user_id = auth.uid() and household_id = hh;

  cost := app.reward_cost_for(target_reward, target_member);

  insert into redemption (household_id, reward_id, member_id, points_spent, status,
                          requested_by, decided_by, decided_at)
  values (hh, target_reward, target_member, cost, 'approved', me, me, now())
  returning id into new_id;
  return new_id;
end;
$$;

-- An adult approves or declines what a child asked for. Declining releases the
-- held points and, for a streak, lets it be asked for again.
create or replace function public.decide_redemption(target_redemption uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d  record;
  me uuid;
begin
  select id, household_id, status into d from redemption where id = target_redemption;
  if d.id is null or not app.is_adult(d.household_id) then
    raise exception 'only an adult can decide that';
  end if;
  if d.status <> 'requested' then
    raise exception 'that has already been decided';
  end if;
  select id into me from member where user_id = auth.uid() and household_id = d.household_id;

  update redemption
     set status     = case when approve then 'approved' else 'declined' end,
         decided_by = me,
         decided_at = now()
   where id = target_redemption;
end;
$$;

revoke execute on function public.request_reward(uuid) from public;
revoke execute on function public.give_reward(uuid, uuid) from public;
revoke execute on function public.decide_redemption(uuid, boolean) from public;

grant execute on function public.request_reward(uuid) to authenticated;
grant execute on function public.give_reward(uuid, uuid) to authenticated;
grant execute on function public.decide_redemption(uuid, boolean) to authenticated;
