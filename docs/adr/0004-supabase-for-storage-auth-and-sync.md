---
status: accepted
---

# Supabase for storage, auth and sync

The app needs shared state that several phones read and write, accounts with
adult and child roles, and somewhere for occurrences to actually live. We chose
Supabase — hosted Postgres with auth, row-level security, realtime and
`pg_cron` — because this domain is relational and its hardest rules are ones a
database can enforce, rather than ones the application must remember to.

Three things decided it:

- **The household boundary is a security policy, not application code.** The
  glossary says nothing is visible across households. As a row-level security
  policy that is enforced once, at the data, for every query — instead of a
  `where household_id = ?` that some future endpoint forgets.
- **Streaks are a consecutive-days question**, which is a SQL window function
  and not much else. A document store would mean reading a member's history into
  the client and counting there.
- **The occurrence horizon from ADR 0002 needs a scheduled job**, and `pg_cron`
  runs it inside the database that owns the rows.

The client loads from a CDN as a plain script tag, so the app keeps its no-build-step
constraint (verified against `@supabase/supabase-js` v2).

## Considered options

**Firebase.** The better push story by some distance — Nudge would come almost
free with FCM. Rejected because the data here is plainly relational: every
screen is a join, the household boundary wants to be a policy, and streaks want
windows. Buying push at the cost of the model is the wrong trade.

**A self-hosted Python API over Postgres.** Matches the Python and SQL skills
already in this repo's neighbourhood, and keeps family data on hardware we
control. Rejected on operations, not on taste: a household app has to answer
from a phone on mobile data at 7am, which means TLS, uptime, backups and an
always-on host — a standing burden out of proportion to three users.

**Browser storage only.** Fails outright. Several phones sharing one household's
state is the point.

## Consequences

- **Security rests entirely on RLS.** The anon key ships inside public client
  code, which is by design — but it means a table without a row-level security
  policy is readable by anyone who views source. Enabling RLS on every table is
  not a hardening step to do later; it is the boundary itself.
- **Family data sits on a third-party service** in another jurisdiction. This is
  the assumption most likely to be revisited, and the one that would flip the
  decision back to self-hosting.
- **Push is not included.** Nudge can start as realtime plus an in-app
  notification; genuine push later needs Web Push and a function. Firebase would
  have handed us this.
- Free-tier projects pause after about a week of inactivity. Harmless for daily
  use, a nuisance if the app is left alone.
- Roles stop being a UI convention: "only children earn points" becomes a
  constraint next to the data rather than a rule the interface politely follows.
- Lock-in is moderate rather than severe. It is ordinary Postgres, so schema and
  rows are portable; auth and the RLS policies are the parts that would have to
  be rewritten.
