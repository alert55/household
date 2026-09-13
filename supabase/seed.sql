-- Household — first household
--
-- Run once, in the Supabase SQL editor, AFTER you have signed in to the app at
-- least once. Signing in is what creates your account; this links it to a new
-- household and gives that household something to show.
--
-- Change the lines marked EDIT before running. The names are placeholders on
-- purpose — this file lives in a public repository.
--
-- It runs as the project owner, so row-level security does not apply to it.
-- Nothing here should ever be run from the app.

do $$
declare
  -- EDIT: the address you signed in to the app with.
  my_email   text := 'you@example.com';

  -- EDIT: what the household and its people are called.
  home_name  text := 'Our home';
  my_name    text := 'Jamie';
  other_name text := 'Sam';    -- a second adult, who can sign in later
  child_name text := 'Alex';

  uid     uuid;
  hh      uuid;
  me      uuid;
  other   uuid;
  child   uuid;
  today_n int := extract(day from current_date)::int;
begin
  select id into uid from auth.users where lower(email) = lower(my_email);
  if uid is null then
    raise exception 'No account for %. Sign in to the app with that address first, then run this again.', my_email;
  end if;

  if exists (select 1 from member where user_id = uid) then
    raise exception '% is already in a household. Nothing was changed.', my_email;
  end if;

  -- ── The household and its people ──────────────────────────────────────

  insert into household (name) values (home_name) returning id into hh;

  insert into member (household_id, user_id, display_name, role, accent)
  values (hh, uid, my_name, 'adult', 'sage') returning id into me;

  -- No user_id: a member does not need a login to be assigned chores.
  insert into member (household_id, display_name, role, accent)
  values (hh, other_name, 'adult', 'clay') returning id into other;

  insert into member (household_id, display_name, role, accent)
  values (hh, child_name, 'child', 'gold') returning id into child;

  insert into budget (household_id, period, amount) values (hh, 'weekly', 6000);

  -- ── Things to show on the first day ───────────────────────────────────

  -- Inserting a task is enough: the trigger from 0002 materialises today's
  -- occurrence and the sixty days after it.
  insert into task (household_id, title, default_assignee_id, recurrence_freq, by_weekday, due_time, points) values
    (hh, 'Dishes after dinner', me,    'daily',  null,        '19:00', 0),
    (hh, 'Laundry',             other, 'weekly', '{6}',       null,    0),
    (hh, 'Feed the dog',        child, 'daily',  null,        null,    5),
    (hh, 'Homework',            child, 'weekly', '{1,2,3,4,5}', null,  10),
    (hh, 'Tidy toys',           child, 'daily',  null,        null,    10);

  insert into pantry_item (household_id, name, is_low, marked_low_at) values
    (hh, 'Milk',      true,  now()),
    (hh, 'Rice',      true,  now()),
    (hh, 'Eggs',      false, null),
    (hh, 'Coffee',    false, null),
    (hh, 'Dish soap', false, null);

  -- A series each, so repeating things are there from the start. 0003's
  -- triggers generate the instances.
  insert into bill_series (household_id, label, amount, recurrence_freq, by_monthday, starts_on)
  values (hh, 'Water bill', 740, 'monthly', least(today_n, 28), current_date);

  insert into event_series (household_id, title, subject_id, responsible_id, at_time, recurrence_freq, by_weekday, starts_on)
  values (hh, 'Swim class', child, other, '17:30', 'weekly', '{5}', current_date);

  raise notice 'Created "%" with % as its first adult. Reload the app.', home_name, my_email;
end
$$;

-- ── Later: letting the second adult sign in ─────────────────────────────
--
-- Once they have signed in to the app once, link their account to the member
-- that was made for them above:
--
--   update member
--      set user_id = (select id from auth.users where lower(email) = lower('them@example.com'))
--    where display_name = 'Sam'
--      and user_id is null;
