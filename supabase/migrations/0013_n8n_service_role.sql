-- Household — let the n8n automations read and add household data
--
-- 0010 granted the app's tables to `authenticated` only, so the service_role
-- key had no privileges at all and every request from n8n failed with 42501.
-- n8n (LINE bot, morning message, nudge alerts) uses that key from the
-- server, never in the browser.
--
-- Read and add only: no delete, so a mistake in an automation cannot erase
-- history. service_role bypasses RLS, so these grants are the whole limit.
-- Applied by hand in the SQL Editor on 2026-10-30.

grant usage on schema app to service_role;

grant select, insert, update on
  household, member, task, occurrence, event, expense, bill, budget,
  pantry_item, shopping_list, shopping_list_item, event_series, bill_series,
  nudge
to service_role;

grant select on occurrence_current to service_role;

-- Inserting a task, bill series or event series fires the materialise
-- triggers from 0002/0003, which call functions in `app`.
grant execute on all functions in schema app to service_role;
