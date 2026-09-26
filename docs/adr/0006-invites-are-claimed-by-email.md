---
status: accepted
---

# Invites are claimed by email address

A member gets a login by being invited under an email address. The first time
someone signs in with that address, `claim_invite` (0011) links their account to
that member. The app calls it whenever a signed-in account belongs to no
household.

This rests on sign-in already proving the address. Every sign-in is a code or
link sent to it, so by the time `claim_invite` runs, `auth.users.email_confirmed_at`
is set and the address is the caller's. The function checks that, and only ever
writes the caller's own id.

The same migration took `user_id` out of reach of the browser. 0010 granted
adults full writes on `member`, so linking an account had been one `UPDATE`
away for any adult who knew its id — the snippet in `seed.sql` did exactly that.
Now the only path is the claim, which cannot attach anyone but yourself.

## Considered options

**An invite code or link.** The adult shares a one-off code; whoever enters it
becomes the member. It needs no email address and suits a child without one,
but anyone who sees the message can claim it, so it needs expiry and single use
on top — and sign-in still needs an email address anyway, so the code proves
nothing an address does not.

**Supabase's own invite email.** `auth.admin.inviteUserByEmail` sends a link
that creates the account. It needs the service-role key, which must never reach
a browser, so it would mean an Edge Function to hold it. The share sheet reaches
people where the household already talks (LINE, Messages) with no server at all.

**Linking by name on first sign-in.** Asking "which of these are you?" is
friendlier but lets anyone who signs in pick any member without a login.

## Consequences

- A member without an email address — a young child — cannot be invited. They
  stay a member without a login, as before, until they have one.
- An address can be invited once across all households; the unique index is
  what makes "the member for this address" a single answer.
- Changing someone's address after they have signed in is a Supabase account
  change, not an invite; the invite is spent once claimed.
