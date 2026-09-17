-- Household — who may touch which table at all
--
-- The project was created with "Automatically expose new tables" turned off, as
-- Supabase recommends. With it off, a new table in `public` grants nothing to the
-- API roles, so every earlier migration's tables are unreachable until this runs:
-- a signed-in member would get "permission denied for table task" on the first
-- query.
--
-- That makes privileges and row-level security two separate layers:
--
--   * A GRANT decides whether a role may attempt an operation on a table at all.
--   * A policy decides which rows that attempt may see or change.
--
-- Before this, only the second layer existed, and every table sat open to the
-- anon role behind its policies. Now `anon` — anyone holding the public key
-- without signing in — has no privileges on any table or view. Signing in is the
-- first gate, and the policies are the second.
--
-- Safe to run on a project created with the option left on: it revokes from anon
-- whatever was granted by default, and grants authenticated only what follows.

-- ── Nobody who is not signed in ──────────────────────────────────────────

revoke all on all tables in schema public from anon;

-- ── Signed-in members ────────────────────────────────────────────────────

-- Read everything; the policies narrow it to the member's own household.
grant select on
  household, member, task, occurrence, event, expense, bill, budget,
  pantry_item, shopping_list, shopping_list_item, reward, redemption,
  event_series, bill_series, nudge
to authenticated;

-- The views are security_invoker (0001), so reading one also needs select on
-- the tables beneath it — granted just above.
grant select on occurrence_current, streak_run, streak_current to authenticated;

-- Full writes where a policy decides who. Most of these are adults-only by
-- policy (task_admin, bill_admin, ...); the grant only makes the attempt possible.
grant insert, update, delete on
  member, task, event, expense, bill, budget,
  pantry_item, shopping_list, shopping_list_item, reward, redemption,
  event_series, bill_series
to authenticated;

-- A household can be renamed by an adult, never created or deleted from the
-- app. seed.sql creates one, running as the project owner.
grant update on household to authenticated;

-- Deliberately NOT granted here:
--
--   * occurrence — members may write completed_at and nothing else. That column
--     grant is in 0008 (ADR 0005); granting table-level update here would
--     quietly undo it. Occurrences are created and removed only by
--     materialisation and the edit functions, which run as their owner.
--
--   * nudge update/delete — 0005 took direct writes away; mark_nudges_seen is
--     the only way a nudge changes.
grant insert on nudge to authenticated;

-- ── Functions the policies call ──────────────────────────────────────────

-- Every policy calls these as the querying user. They would normally inherit
-- EXECUTE from PUBLIC, but that default is exactly what an "expose nothing by
-- default" project may not provide, so it is stated rather than assumed.
grant execute on function app.my_households() to authenticated;
grant execute on function app.is_adult(uuid) to authenticated;
grant execute on function app.assert_member_of(uuid, uuid) to authenticated;
