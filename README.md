# Household

A home screen for tracking a household — chores, bills, groceries and who owes what.

Currently one screen, built to match the `Home-B-Board` variant of the
"Household tracking mobile app" project in Claude Design. Every value on it is
hardcoded; this is a faithful rendering of a single state, not a working app yet.

## Running it

Any static file server will do:

```bash
python -m http.server 8792 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8792>. Opening `index.html` directly off disk also
works, but relative asset paths behave better over HTTP.

## Layout

| File | What it holds |
| --- | --- |
| `index.html` | The screens, as containers the renderer fills. Semantic markup — real buttons, checkbox/label pairs, `role="progressbar"` on the meters, `aria-current` on the active tab. |
| `styles.css` | Every colour, radius and size from the design, lifted off inline styles into custom properties on `:root`. |
| `config.js` | Which project to talk to. Empty means demo mode. |
| `data.js` | One shape, two sources: in-memory demo rows, and the real Supabase queries. |
| `app.js` | Routing, rendering and the tick. |

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

To go live, create a Supabase project, apply the migrations in
`supabase/migrations`, and fill in the URL and anon key. The anon key belongs in
public client code — security rests on the row-level security policies, not on
that key being secret (ADR 0004).

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

The glossary is turned into tables in
[supabase/migrations](./supabase/migrations). Row-level security is enabled on
every table in the same migration that creates it — with the anon key shipping
in public client code, those policies are the household boundary rather than a
hardening step for later.

## Where this could go next

The schema and its materialisation job exist but have never been applied to a
real database — treat everything under `supabase/` as unrun code until it has
met a live Postgres. The Supabase source in `data.js` is unrun for the same
reason; only the demo path has been exercised.

Nudge and Pay work, but a nudge only waits for the other person to open the app
— push to their device is not something ADR 0004 gives us for free. Kitchen is
still an empty screen.
