-- Household — inviting members
--
-- Until now a member got a login by hand: they signed in once, then an adult
-- ran an UPDATE in the SQL editor putting the new account's id on their member
-- row. This replaces that with an invite. An adult names the address a member
-- will sign in with; the first time that address signs in, it is linked to
-- that member. See ADR 0006.
--
-- It also closes a gap the hand-written UPDATE depended on. 0010 granted full
-- insert and update on member, so an adult's browser could write any account's
-- id into member.user_id — attaching someone else's login to this household.
-- user_id is now written only by claim_invite, and only ever with the caller's
-- own id.

-- ── The invite ───────────────────────────────────────────────────────────

-- Stored lower-cased and trimmed, the form auth.users is compared in.
alter table member add column invite_email text
  check (invite_email is null or invite_email = lower(btrim(invite_email)));

-- An invite is for a member who has no login yet, and is spent by claiming it.
alter table member add constraint invite_only_without_login
  check (invite_email is null or user_id is null);

-- Signing in must name exactly one member, so an address is invited once.
create unique index member_open_invite_idx on member (invite_email)
  where invite_email is not null;

-- ── Writing members ──────────────────────────────────────────────────────

-- Names, roles and colours stay writable by an adult (member_admin in 0001
-- still decides who). Who signs in as whom, and who is invited, are not:
-- those go through the functions below.
revoke insert, update on member from authenticated;
grant update (display_name, role, accent) on member to authenticated;

-- An adult invites a member of their own household who has no login yet. An
-- empty address cancels the invite.
--
-- Security definer because the caller has no grant on invite_email; every
-- check a policy would have made is made here instead.
create or replace function public.invite_member(target_member uuid, email text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m    record;
  addr text := lower(btrim(coalesce(email, '')));
begin
  select id, household_id, user_id into m from member where id = target_member;

  if m.id is null or not app.is_adult(m.household_id) then
    raise exception 'only an adult in that household can invite them';
  end if;

  if m.user_id is not null then
    raise exception 'they already sign in';
  end if;

  if addr = '' then
    update member set invite_email = null where id = target_member;
    return;
  end if;

  if addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'that does not look like an email address';
  end if;

  if exists (
    select 1 from member mm join auth.users u on u.id = mm.user_id
    where mm.household_id = m.household_id and lower(u.email) = addr
  ) then
    raise exception 'someone in this household already signs in with that address';
  end if;

  if exists (select 1 from member where invite_email = addr and id <> target_member) then
    raise exception 'that address is already invited';
  end if;

  update member set invite_email = addr where id = target_member;
end;
$$;

-- An adult adds someone to their own household, optionally inviting them in
-- the same step. The colour is whichever of the three is least used, so a new
-- member does not look like an existing one when it can be helped.
create or replace function public.add_member(member_name text, member_role member_role, email text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hh     uuid;
  colour text;
  new_id uuid;
begin
  select household_id into hh from member where user_id = auth.uid();

  if hh is null or not app.is_adult(hh) then
    raise exception 'only an adult can add someone';
  end if;

  if coalesce(btrim(member_name), '') = '' then
    raise exception 'give them a name';
  end if;

  select c into colour
  from unnest(array['sage', 'clay', 'gold']) with ordinality as a(c, n)
  order by (select count(*) from member where household_id = hh and accent = a.c), n
  limit 1;

  insert into member (household_id, display_name, role, accent)
  values (hh, btrim(member_name), member_role, colour)
  returning id into new_id;

  if coalesce(btrim(email), '') <> '' then
    perform public.invite_member(new_id, email);
  end if;

  return new_id;
end;
$$;

-- ── Claiming ─────────────────────────────────────────────────────────────

-- Called by the app when someone signs in and is in no household. If a member
-- was invited under their address, they become that member. Returns the
-- household joined, or null when there was nothing to claim.
--
-- Only ever writes the caller's own id, and only for an address the caller has
-- proven: email_confirmed_at is set once a sign-in code or link is used.
create or replace function public.claim_invite()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  addr text;
  hh   uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  -- Already in a household: nothing to claim, and a login belongs to one member.
  if exists (select 1 from member where user_id = auth.uid()) then
    return null;
  end if;

  select lower(u.email) into addr
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;

  if addr is null then
    return null;
  end if;

  update member
     set user_id = auth.uid(), invite_email = null
   where invite_email = addr and user_id is null
  returning household_id into hh;

  return hh;
end;
$$;

revoke execute on function public.invite_member(uuid, text) from public;
revoke execute on function public.add_member(text, member_role, text) from public;
revoke execute on function public.claim_invite() from public;

grant execute on function public.invite_member(uuid, text) to authenticated;
grant execute on function public.add_member(text, member_role, text) to authenticated;
grant execute on function public.claim_invite() to authenticated;
