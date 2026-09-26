# Going live on Supabase

About twenty minutes, all in a browser. Nothing to install beyond the Python
already used to serve the app. Supabase moves its dashboard around from time to
time, so if a menu name below differs slightly, look for the nearest match.

## 1. Create the project

Sign in at [supabase.com](https://supabase.com) and create a new project.

- **Plan:** Free.
- **Region:** Southeast Asia (Singapore) is the nearest to Bangkok.
- **Database password:** keep it somewhere safe. None of the steps below need it.
- **Security:**
  - *Enable Data API* — **on**. The app talks to it.
  - *Automatically expose new tables* — **off**, as Supabase recommends.
    Migration `0010` grants exactly what the app needs instead, and gives
    visitors who are not signed in nothing at all.
  - *Enable automatic RLS* — **on**. The migrations enable it on every table
    already; this catches any table added later that forgets to.

## 2. Turn on pg_cron — before the migrations

**Database → Extensions**, search for `pg_cron`, enable it.

Migration `0002` schedules the hourly job that keeps occurrences generated (ADR
0002), and fails if the extension is not there yet.

## 3. Apply the migrations, one at a time, in order

**SQL Editor → New query.** Paste `migrations/0001_initial_schema.sql`, run it.
Then `0002`, `0003`, and so on up to `0011`.

Do not skip `0010`. With automatic exposure off, the tables are unreachable
until it grants access, and every query from the app fails with
"permission denied for table".

One file per run, so that if one fails you know which. **If a file fails, stop
there** — do not run the next one. Copy the error; later files build on earlier
ones, and running past a failure only adds more errors on top of the real one.

These files have been parsed with PostgreSQL's own grammar, including every
function body, and checked so that no table or view escapes row-level security.
They have never been run against a live database, so the first run here is
their first real test.

## 4. Tell sign-in where the app lives

**Authentication → URL Configuration**

- **Site URL:** `http://localhost:8792`
- **Redirect URLs:** add `http://localhost:8792` and `http://localhost:8792/**`.
  The app asks to come back to `http://localhost:8792/` — trailing slash — and
  without the wildcard entry that is not an exact match.

Use `localhost`, not `127.0.0.1`. They are different origins to a browser, and a
magic link sent back to the one that is not on this list is refused.

## 5. Connect the app

**Project Settings → API** (sometimes **API Keys**). Copy two values into
`config.js`:

```js
window.HOUSEHOLD_CONFIG = {
  supabaseUrl: 'https://<your-project>.supabase.co',
  supabaseAnonKey: '<the publishable / anon key>'
};
```

**Only the publishable (anon) key.** Never the *secret* or *service_role* key:
that one bypasses every policy in this repository and must not reach a browser.

The publishable key is designed to be public, so committing `config.js` is safe
— the row-level security policies are the protection, not the key (ADR 0004).

## 6. Serve the app and sign in once

Name the folder with `--directory`, so the command works whichever folder the
terminal is in:

```bash
python -m http.server 8792 --bind 127.0.0.1 --directory path/to/household-app
```

If the page shows "Directory listing for /" instead of the app, the server is
serving whatever folder the terminal was in — often your home folder, dotfiles
and all. Stop it with Ctrl+C and run the line above. Keep `--bind 127.0.0.1`: it
is what keeps the rest of the network from seeing it.

Open `http://localhost:8792`, enter your email, open the link it sends.

You should then see a message saying you are signed in **but not in a household
yet**. That is expected: signing in created your account, and nothing links it to
a household until the next step.

## 7. Create your household

Open `seed.sql`. Change the lines marked `EDIT` — at least `my_email`, to the
address you just signed in with — then run it in the SQL editor and reload the
app.

It refuses to run if that address has not signed in yet, or is already in a
household, so running it twice does no harm.

## 8. Check it is working

The board should show today's tasks, the water bill under *Needs you*, and the
swim class under *Coming up* on the Tasks screen.

The hourly job, in the SQL editor:

```sql
select jobname, schedule, active from cron.job;
```

One row, `materialise-occurrences`, `20 * * * *`, active.

## 9. Put it online

So the household can use it from their phones, not just from the computer
serving it.

**Publish.** On GitHub, the repository's **Settings → Pages**: source *Deploy
from a branch*, branch `main`, folder `/ (root)`. The app appears at
`https://<user>.github.io/<repository>/` a minute later, and every push to
`main` updates it. There is no build step, so nothing else is needed.

**Let sign-in return there.** Back in Supabase, **Authentication → URL
Configuration**:

- **Site URL:** the published address, e.g. `https://alert55.github.io/household/`.
- **Redirect URLs:** add that address, and the same with `**` on the end. Keep
  the two `localhost` entries, so running it locally still works.

**Send email through Gmail.** Supabase only lets a project edit its email
templates once it sends through its own mail server, and the built-in one
manages a handful of emails an hour anyway. A Gmail account will do for one
household:

1. With 2-Step Verification on, create an app password at
   <https://myaccount.google.com/apppasswords>. Google shows 16 letters, once.
2. **Authentication → Emails → SMTP Settings**, turn on *Enable custom SMTP*:
   sender email and username both the Gmail address, sender name `Household`,
   host `smtp.gmail.com`, port `465`, password the app password. Save.

Chrome may autofill a saved login into the username and password boxes. Clear
both before typing — Supabase would otherwise try to send with it. Supabase
also warns that Gmail is meant for personal mail; for a few sign-ins a day
that does not matter.

**Put the code in the email.** **Authentication → Emails → Templates**. Two
are used: *Magic link or OTP* for someone who has signed in before, *Confirm
sign up* for their first time. In both, set the subject to `Your Household
sign-in code` and replace the body with:

```html
<h2>Sign in to Household</h2>
<p>Your code is <strong>{{ .Token }}</strong></p>
<p>Or <a href="{{ .ConfirmationURL }}">sign in with this link</a> in a browser.</p>
```

The code is what makes a home-screen app work on an iPhone. A home-screen app
keeps its own sign-in, separate from Safari's, and a link in an email always
opens Safari — so the link signs in Safari and the app stays signed out. A code
typed into the app signs in the app itself.

## If something goes wrong

- **The sign-in email never arrives.** Supabase's built-in email is rate-limited
  to a handful an hour. Wait, and check spam, before trying again. Once step 9
  sends through Gmail, the limit is 30 an hour and one a minute per person; if
  nothing arrives at all, **Logs → Auth** shows whether Gmail refused the app
  password.
- **The email has a link but no code.** Step 9 — both templates need
  `{{ .Token }}`.
- **The link opens a page that is not the app.** Step 4, or step 9 for the
  published address — the redirect list.
- **A migration fails.** Stop, and bring back the file name and the full error
  message.
- **"permission denied for schema app".** `0001` did not finish; its grant on
  the `app` schema is what every policy relies on.
- **"permission denied for table …".** `0010` has not been run.

## Adding everyone else

From the app, not the SQL editor. On Home, tap your initial (top right): the
Household sheet lists everyone. **Invite** beside a member names the address
they will sign in with, and **Send the invite** passes them the link through
the phone's share sheet. Their first sign-in with that address makes them that
member (ADR 0006). **Add someone** adds a person who is not there yet.
