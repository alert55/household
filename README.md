# Household

A home screen for tracking a household — chores, bills, groceries and who owes what.

Four screens — Home, Tasks, Kitchen and Money — built from the `Home-B-Board`
design in Claude Design, reading and writing a live Supabase project.

## Using it

It is published at **https://alert55.github.io/household/**, straight from
`main` by GitHub Pages — every push is live a minute later. On a phone, open
that address and add it to the home screen (Safari: Share → Add to Home Screen;
Chrome: ⋮ → Add to Home screen). It then opens full-screen, like an app.

Sign in with your email. The email carries a code and a link: type the code.
The link only works in the browser that opens it, and on an iPhone that is
Safari, not the home-screen app.

## Running it locally

On a new machine — a Mac included — nothing needs installing beyond Git and
Python 3, which macOS offers to install the first time either is used:

```bash
git clone https://github.com/alert55/household.git
python3 -m http.server 8792 --bind 127.0.0.1 --directory household
```

Then open **http://localhost:8792** — `localhost`, not `127.0.0.1`: sign-in
links only return to the address listed in the Supabase project. `config.js`
already points at the live project, so signing in with the household's email
shows the household. Nothing else is stored on the machine.

Opening `index.html` directly off disk does not work: sign-in needs a real
address to come back to.

To work on the SQL, the checks in [tools/](./tools) need `uv`
(`brew install uv`) and Node (`brew install node`).

## Layout

| File | What it holds |
| --- | --- |
| `index.html` | The screens, as containers the renderer fills. Semantic markup — real buttons, checkbox/label pairs, `role="progressbar"` on the meters, `aria-current` on the active tab. |
| `styles.css` | Every colour, radius and size from the design, lifted off inline styles into custom properties on `:root`. |
| `config.js` | Which project to talk to. Empty means demo mode. |
| `data.js` | One shape, two sources: in-memory demo rows, and the real Supabase queries. |
| `app.js` | Routing, rendering and the tick. |
| `manifest.json`, `icons/` | What makes it installable to a home screen. The icons are drawn by `tools/make_icons.py`. |

No build step and no dependencies of our own. Fonts come from Google Fonts and
the Supabase client from a CDN; everything else is inline SVG.

## Demo mode

With `config.js` left empty the app runs on in-memory rows that reproduce the
original design exactly. Every screen works and nothing is saved.

That is not a fallback so much as the point: both sources answer `loadBoard()`
and `loadMoney()` in the same shape, so the rendering can be exercised without a
backend, and going live is a change to `config.js` rather than to any screen.

Add `?as=alex` or `?as=sam` to see the same board as someone else. It is how the
sides of a nudge are checked without two accounts: Sam has already nudged Alex
about the trash, so Alex sees "Sam nudged you" and no buttons at all — a child
may not pay bills — while Sam sees a "Nudged" tag where the button was. Demo
state lives only for the page load, so the "Seen" tag needs a real backend.

To go live, follow [supabase/SETUP.md](./supabase/SETUP.md): create the project,
apply the migrations, sign in once, and run `supabase/seed.sql` to put your
account in a household. The anon key belongs in public client code — security
rests on the row-level security policies, not on that key being secret (ADR 0004).

No build step and no dependencies. Fonts (Newsreader, IBM Plex Sans) come from
Google Fonts; everything else is inline SVG.

## Design provenance

The source design lives in Claude Design as `Home-B-Board.dc.html`. Two sibling
variants exist — `Home-A-Ledger` and `Home-C-DaySpine` — which look like
competing home screens rather than additional pages.

Two deliberate departures from the design file:

- **The iOS device frame is not shipped.** `ios-frame.jsx` is canvas presentation
  chrome — bezel, notch, home indicator. Baking a fake status bar into a real web
  app would be wrong, so the screen is mobile-first and responsive instead, using
  `safe-area-inset` padding where the frame's 64px top gap was.
- **`support.js` is not vendored.** It is the generated `dc-runtime` that renders
  `.dc.html` on the design canvas, marked "do not edit", and has no role here.

## The domain

The vocabulary is written down in [CONTEXT.md](./CONTEXT.md) — what a task,
occurrence, event, bill and streak each mean, and which synonyms to avoid.
Decisions that were genuinely contested live in [docs/adr](./docs/adr):

- [0001](./docs/adr/0001-tasks-and-events-are-separate.md) — tasks and events
  are separate concepts
- [0002](./docs/adr/0002-occurrences-are-stored.md) — occurrences are stored,
  not derived
- [0003](./docs/adr/0003-screens-are-views-in-one-page.md) — screens are views in
  one page, not separate documents
- [0004](./docs/adr/0004-supabase-for-storage-auth-and-sync.md) — Supabase for
  storage, auth and sync
- [0005](./docs/adr/0005-occurrence-writes-go-through-column-grants.md) —
  occurrence writes go through column grants and checked functions
- [0006](./docs/adr/0006-invites-are-claimed-by-email.md) — invites are
  claimed by email address

The glossary is turned into tables in
[supabase/migrations](./supabase/migrations). Row-level security is enabled on
every table in the same migration that creates it — with the anon key shipping
in public client code, those policies are the household boundary rather than a
hardening step for later.

## Where this could go next

It runs. All eleven migrations are applied to a live Supabase project and the app
reads and writes real rows: inserting a task materialised its occurrences, the
monthly bill and weekly class generated their instances, and ticking a child's
chore as an adult recorded the adult as the one who ticked it while awarding the
points to the child — the database deciding, not the browser (ADR 0005). With
only the publishable key and no account, every table and view answers
"permission denied".

The hourly job runs unattended: fifteen consecutive successes over its first day,
each extending the horizon, with no duplicates — the unique key on
(task_id, due_on) doing the work ADR 0002 asked of it.

Nudges are the one path still unexercised against the live project, since that
needs two people signed in — which invites now make possible without SQL: an
adult invites someone from the Household sheet (your initial on Home), and
their first sign-in with that address makes them that member (ADR 0006).

Nudge and Pay work, but a nudge only waits for the other person to open the app
— push to their device is not something ADR 0004 gives us for free.

All four screens exist, and the `+` adds tasks, events, expenses, pantry items
and bills — offering only what the member opening it is allowed to create.

Events and bills can repeat — weekly, daily or monthly — and the database
generates their instances, so a weekly class is entered once.

Tasks can be edited by an adult — renamed, reassigned or retimed for just today
or from now on, skipped for a day, or stopped. Stopping retires a task rather than
deleting it, so the streaks and points it already produced survive.

Bills can be edited one at a time or from here on, skipped, or stopped repeating;
this month's bill can cost more than usual without the next change to its series
putting the old amount back. Expenses can be edited or deleted, and deleting the
one that paid a bill marks that bill unpaid again — which is how a mistaken
payment is undone.

Events work the same way: one of a series can be moved on its own and stays
moved when the series later changes, or the series can change from here on;
one can be skipped, or the series stopped. Pantry items can be renamed, marked
low or not, or deleted by any member — the pantry is shared — and deleting one
leaves it on any shopping list it is already on.
