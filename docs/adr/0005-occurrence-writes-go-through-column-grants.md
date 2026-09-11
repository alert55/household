---
status: accepted
---

# Occurrence writes go through column grants and checked functions

Row-level security decides which rows a member may touch, but not which
columns: a `WITH CHECK` clause sees only the new row, so it cannot say "this
column did not change". The original `occurrence_tick` policy was meant for
ticking a box and in practice let any member rewrite any column — a child could
reassign their own chore, move it to next week, or set `points_awarded` to
anything. We restricted direct writes with column privileges instead: a member
may update `completed_at` and nothing else. Points and `completed_by` are worked
out by a trigger. Reassigning, rescheduling, skipping and retiring go through
functions that check the caller is an adult.

## Why this reverses the pattern elsewhere

`pay_bill`, `add_low_to_list` and `add_event` run as the caller
(`security invoker`) on purpose: the policies already state who may do those
things, and running as the caller keeps each policy the only copy of its rule.

The editing functions cannot do the same. Column privileges apply to a function
running as its caller exactly as they apply to a direct update, so an invoker
function could not write `assignee_id` either. They have to run as their owner
(`security definer`), which means they bypass row-level security. That in turn
makes the adult check at the top of each one the whole of its authorisation —
so it has to be there, first, every time.

The rule for the next function, then: **invoker when a policy already says who
may do it; definer only when a column privilege stands in the way, and then
with an explicit check.**

## Considered options

**A trigger that rejects changes to protected columns.** It keeps a single
update path, but it has to guess the caller's intent from which columns moved,
and it would also block the functions that legitimately change them unless they
set some flag to switch it off — a second, quieter authorisation system.

**Policies per role.** Different `UPDATE` policies for adults and children still
cannot limit columns, so a child's policy would still be all-or-nothing on the
row.

## Consequences

- The browser sends only `completed_at` when a box is ticked. Anything else it
  sent would be refused, which is the point.
- Points go to the child an occurrence belongs to, whoever ticked it. An adult
  ticking "Alex fed the dog" still earns Alex the points.
- Every new column on `occurrence` is unwritable by members until someone
  decides otherwise and grants it.
