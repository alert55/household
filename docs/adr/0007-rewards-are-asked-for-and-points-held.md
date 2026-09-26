---
status: accepted
---

# Rewards are asked for, and the points are held until an adult decides

A child asks for a reward; an adult approves or declines it (0012). From the
moment of asking, the reward's points count against the child's balance as
held, so the same points cannot be asked for twice while an adult is busy.
Declining releases them. An adult can also give a reward outright, which is
how a child with no login gets one.

Streak rewards repeat: "movie night for 7 days of homework in a row" is earned
at 7, again at 14, and so on, and a missed day starts the count over. A lap
counts as claimed once it is asked for or given within the current run.

All of it goes through checked functions; direct inserts and updates on
`redemption` are revoked, and rewards are retired rather than deleted, because
deleting one would cascade to its redemptions and hand back every point spent
on it.

## Considered options

**Adults record rewards; children only look.** The simplest, and the policies
in 0001 already allowed it. But CONTEXT.md gives the adult the job of
*approving*, which implies someone asks, and a screen a child can only look at
gives them no reason to open it.

**Deduct points only on approval.** Nothing is held, so a child could ask for
three things with points for one, and whichever an adult approved first would
leave the others unaffordable at the moment of deciding.

**A streak reward once per run.** Easier to count, but a child who keeps a
30-day streak would get one movie night for it, and the reward would stop
doing its job exactly when it is working best.

## Consequences

- The balance is computed (`points_balance`), never stored, so unticking an
  occurrence (which zeroes its `points_awarded`) lowers it with no special case.
  That can leave a balance below what was already spent; it shows as negative
  until more is earned.
- A declined request stays in the table as a record, and counts for nothing.
