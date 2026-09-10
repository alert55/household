---
status: accepted
---

# Occurrences are stored, not derived

An occurrence is a dated instance of a recurring task, and we could either
materialise a row for each one or keep only the recurrence rule plus a record of
completions and compute occurrences on demand. We store them, because deriving
them makes the past mutable: changing a task's recurrence today would silently
rewrite which days had ever slipped, and a child could lose a streak because an
adult edited a schedule.

## Considered options

**Derive from the recurrence.** Compact, nothing to backfill, and a schedule
edit takes effect everywhere at once. Rejected for two reasons. Every piece of
per-instance state the glossary already commits us to — an assignee overriding
the task's, whether it slipped, when it was completed, the points it awarded —
needs somewhere to live, so you arrive at an exceptions table that is a stored
occurrence wearing a disguise. And the streak problem is not recoverable: a
streak is a promise made to a child, and a promise that quietly recalculates
when someone edits a rule is not one worth making.

## Consequences

- Occurrences exist only up to a **horizon**. Something has to extend it as time
  passes, per household and in that household's own timezone.
- Editing a recurrence needs a rule for occurrences already materialised.
  Proposed: the past is never touched; untouched future occurrences are
  regenerated; future occurrences someone has already reassigned or completed
  are left alone.
- **Slipped stays derived.** It is a function of the clock — due moment passed,
  not completed — so it must not become a stored flag. A stored flag needs a job
  to flip it and is wrong in the window before that job runs.
- Points are recorded on the occurrence that earned them, so regenerating the
  horizon can never double-award.
- Storage grows with members × tasks × days. Old occurrences can be pruned, but
  only once no streak they contribute to can still change.
