---
status: accepted
---

# Tasks and events are separate concepts

Three competing home-screen designs disagreed about what a school drop-off is:
one showed it as a tickable task assigned to an adult, another as an event about
a child that an adult carries out. We decided these are different kinds of thing
— a task is work someone must do and tick off, an event happens at its time
whether or not anyone acts — because collapsing them makes "done" meaningless
for half the items on the board, and makes counts like "6 things left today"
include things that were never anyone's work.

## Considered options

**Everything is a task.** One list, one notion of done, far less machinery. We
rejected it because an event nobody ticks sits permanently unticked, and the
home screen leads with exactly the counts that would corrupt.

**Events contain tasks** — the drop-off is an event, and "drive them there" is a
task hanging off it. This models reality most faithfully and we may still end up
here. Rejected for now as premature: it doubles the shapes on screen to buy
precision we have no evidence the household needs. Revisit if events routinely
grow their own checklists.

## Consequences

- A day view has to render two shapes on one timeline, not one shape twice.
- An event carries a subject and, optionally, a responsible member. A task
  carries an assignee. They do not share that relationship.
- Points and streaks attach to occurrences only. An event can never earn either,
  so anything that should be rewarded has to be modelled as a task.
- "Slipped" applies only to occurrences. An event that has passed is simply
  past — there is no failure state for it.
