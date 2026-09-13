# Going live on Supabase

About twenty minutes, all in a browser. Nothing to install beyond the Python
already used to serve the app. Supabase moves its dashboard around from time to
time, so if a menu name below differs slightly, look for the nearest match.

## 1. Create the project

Sign in at [supabase.com](https://supabase.com) and create a new project.

- **Region:** Southeast Asia (Singapore) is the nearest to Bangkok.
- **Database password:** keep it somewhere safe. None of the steps below need it.

## 2. Turn on pg_cron — before the migrations

**Database → Extensions**, search for `pg_cron`, enable it.

Migration `0002` schedules the hourly job that keeps occurrences generated (ADR
0002), and fails if the extension is not there yet.

## 3. Apply the migrations, one at a time, in order

**SQL Editor → New query.** Paste `migrations/0001_initial_schema.sql`, run it.
Then `0002`, `0003`, and so on up to `0009`.

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
- **Redirect URLs:** add `http://localhost:8792`

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

In `household-app/`:

```bash
python -m http.server 8792 --bind 127.0.0.1
```

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

## If something goes wrong

- **The sign-in email never arrives.** Supabase's built-in email is rate-limited
  to a handful an hour. Wait, and check spam, before trying again.
- **The link opens a page that is not the app.** Step 4 — the redirect list.
- **A migration fails.** Stop, and bring back the file name and the full error
  message.
- **"permission denied for schema app".** `0001` did not finish; its grant on
  the `app` schema is what every policy relies on.

## Adding the second adult

They sign in to the app once, then run the snippet at the bottom of `seed.sql`
with their address.
