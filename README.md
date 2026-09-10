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
| `index.html` | The board. Semantic markup — real buttons, checkbox/label pairs, `role="progressbar"` on the meters, `aria-current` on the active tab. |
| `styles.css` | Every colour, radius and size from the design, lifted off inline styles into custom properties on `:root`. |
| `app.js` | The one behaviour the design implies: ticking a task updates the "N of 10 done" readout. |

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

## Where this could go next

The screens are the easy part. Making this real means naming the domain —
*household*, *member*, *task*, *recurrence*, *streak*, *bill*, *pantry item*,
*event* — and deciding which of those are shared state that several phones read
and write at once.

The design already implies the hard bits: "missed yesterday" needs a recurrence
schedule plus a grace window, "Nudge" needs push to someone else's device, and
the streak needs a daily rollover that knows the household's timezone.
