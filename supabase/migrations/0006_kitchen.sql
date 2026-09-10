-- Household — the kitchen loop
--
-- The pantry, the list and the shop are three states of one story: something
-- runs low, it goes on a list, someone comes home with it, and it is no longer
-- low. 0001 gave all three somewhere to live but nothing to move between them.
--
-- Marking an item low, and ticking one off in the shop, are single writes and
-- stay ordinary updates under the policies from 0001. Only the two steps that
-- touch more than one row are functions.

-- Gathers everything currently low onto the open list, opening one if there is
-- none. Not security definer: the policies from 0001 already say a household
-- member may do this, and running as the caller keeps that the only statement
-- of the rule.
create or replace function public.add_low_to_list()
returns uuid
language plpgsql
as $$
declare
  hh      uuid;
  list_id uuid;
  low_n   integer;
begin
  select m.household_id into hh
  from member m
  where m.user_id = auth.uid()
  limit 1;

  if hh is null then
    raise exception 'not a member of any household';
  end if;

  select count(*) into low_n
  from pantry_item
  where household_id = hh and is_low;

  if low_n = 0 then
    raise exception 'nothing is running low';
  end if;

  select id into list_id
  from shopping_list
  where household_id = hh and completed_at is null
  order by created_at desc
  limit 1;

  if list_id is null then
    insert into shopping_list (household_id) values (hh) returning id into list_id;
  end if;

  -- Already on the list is not a problem, it is the normal case on a second
  -- press. The unique constraint from 0001 does the deduplicating.
  insert into shopping_list_item (household_id, shopping_list_id, pantry_item_id, label)
  select hh, list_id, p.id, p.name
  from pantry_item p
  where p.household_id = hh and p.is_low
  on conflict (shopping_list_id, pantry_item_id) do nothing;

  return list_id;
end;
$$;

-- Finishing a shop is what actually restocks the pantry. Anything ticked off is
-- no longer low; anything nobody found stays low and will be on the next list.
create or replace function public.complete_shopping_list(target_list uuid)
returns integer
language plpgsql
as $$
declare
  hh        uuid;
  restocked integer;
begin
  select household_id into hh
  from shopping_list
  where id = target_list and completed_at is null;

  if hh is null then
    raise exception 'no open list by that name';
  end if;

  update pantry_item p
     set is_low = false, marked_low_at = null
   where p.household_id = hh
     and p.id in (
       select i.pantry_item_id
       from shopping_list_item i
       where i.shopping_list_id = target_list
         and i.got
         and i.pantry_item_id is not null
     );

  get diagnostics restocked = row_count;

  update shopping_list set completed_at = now() where id = target_list;

  return restocked;
end;
$$;

grant execute on function public.add_low_to_list() to authenticated;
grant execute on function public.complete_shopping_list(uuid) to authenticated;
