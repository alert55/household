-- Household — adding a one-off event
--
-- A client has a date and a wall-clock time. Turning those into an instant needs
-- the household's timezone, and the household's timezone lives here. Letting the
-- browser do the conversion would mean a phone roaming abroad filing a swim
-- class at the wrong hour.
--
-- Not security definer: event_admin from 0001 already says events are an adult's
-- to create, and running as the caller keeps that the only copy of the rule.
create or replace function public.add_event(
  p_title       text,
  p_on_date     date,
  p_at_time     time,
  p_subject     uuid default null,
  p_responsible uuid default null,
  p_duration    interval default null
)
returns uuid
language plpgsql
as $$
declare
  hh       uuid;
  tz       text;
  new_id   uuid;
  starts   timestamptz;
begin
  select m.household_id into hh
  from member m
  where m.user_id = auth.uid()
  limit 1;

  if hh is null then
    raise exception 'not a member of any household';
  end if;

  if coalesce(btrim(p_title), '') = '' then
    raise exception 'an event needs a name';
  end if;

  select h.timezone into tz from household h where h.id = hh;

  starts := (p_on_date + p_at_time) at time zone tz;

  insert into event (household_id, title, subject_id, responsible_id, starts_at, ends_at)
  values (
    hh, btrim(p_title), p_subject, p_responsible, starts,
    case when p_duration is null then null else starts + p_duration end
  )
  returning id into new_id;

  -- Zero rows would have raised already; a null here means the insert was
  -- refused by row-level security, which is the adults-only rule doing its job.
  if new_id is null then
    raise exception 'only an adult can add an event';
  end if;

  return new_id;
end;
$$;

grant execute on function public.add_event(text, date, time, uuid, uuid, interval) to authenticated;
