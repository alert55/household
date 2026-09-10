# Household

Everything one home keeps track of together: the work that has to be done, the
things that happen to people, what is owed, and what is running out.

## Language

### The household

**Household**:
One home, the people in it, and everything tracked for them. The boundary of
sharing — nothing is visible across households.
_Avoid_: family, group, account, team

**Member**:
A person who belongs to a household. Every member has a role.
_Avoid_: user, family member, profile, participant

**Adult**:
A member who assigns work, approves rewards, and pays bills.
_Avoid_: parent, owner, admin

**Child**:
A member who earns points and builds streaks. The only role rewards apply to.
_Avoid_: kid, dependent, minor

### Work

**Task**:
A standing piece of work the household expects done, once or on a recurrence. A
task is never ticked off — its occurrences are.
_Avoid_: chore, todo, item, job

**Occurrence**:
A single dated instance of a task. The thing actually ticked, the thing that
slips, and the unit a streak counts.
_Avoid_: instance, entry, todo, assignment

**Recurrence**:
The rule describing how often a task comes back, and therefore which occurrences
exist.
_Avoid_: schedule, repeat, frequency, cadence

**Assignee**:
The member responsible for an occurrence — inherited from its task unless that
occurrence names someone else.
_Avoid_: owner, doer, responsible party

**Slipped**:
An occurrence whose moment passed without it being done. Describes the
occurrence, never the member.
_Avoid_: missed, overdue, late, failed

### Things that happen

**Event**:
Something that happens at a time whether or not anyone acts on it. An event is
never ticked off — it simply arrives and passes.
_Avoid_: appointment, calendar entry, meeting, activity

**Subject**:
The member an event is about.
_Avoid_: attendee, participant

**Responsible**:
The member who carries an event out, when that is someone other than the
subject. An event may have none.
_Avoid_: driver, escort, chaperone

### Rewards

**Points**:
Earned by a child for completing an occurrence, accumulating into a balance that
can be spent. Once earned they are never taken away.
_Avoid_: stars, coins, XP, credits

**Streak**:
The count of consecutive days a child completed every occurrence of one
recurring task. Breaking it resets the count to zero.
_Avoid_: run, chain, combo

**Reward**:
Something a child obtains, either by spending points or by reaching a streak.
_Avoid_: prize, treat, bonus

### Money

**Bill**:
An amount the household owes, with a due date. Paying one records an expense.
_Avoid_: invoice, payment, charge

**Expense**:
Money the household actually spent.
_Avoid_: transaction, purchase, cost, spend

**Budget**:
The household's spending ceiling for a period.
_Avoid_: limit, cap, allowance, target

### Kitchen

**Pantry item**:
Something the household keeps in stock and expects to run out of.
_Avoid_: supply, product, ingredient, inventory item

**Low**:
The state of a pantry item that needs restocking.
_Avoid_: out, empty, depleted

**Shopping list**:
Pantry items gathered together for a single trip.
_Avoid_: groceries, cart, basket, order

### Views

**Needs you**:
Everything demanding one member's attention right now — slipped occurrences and
bills falling due, gathered together. Derived, never stored.
_Avoid_: inbox, alerts, urgent, action items
