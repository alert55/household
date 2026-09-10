---
status: accepted
---

# Screens are views in one page, not separate documents

Adding the Money screen forced a choice between one HTML document per screen and
one document holding every screen as a section routed by the URL hash. We chose
views in a single page, because the tab bar, header and card system are shared
chrome and there is no build step to share them with — separate documents would
mean copy-pasting the tab bar into every file, and copy-pasted chrome drifts.

## Considered options

**A document per screen** (`money.html`, `tasks.html`…). Real URLs, browser
history for free, no routing code, and each page loads independently. Rejected
on maintenance: five hand-maintained copies of the tab bar is a guarantee that
one of them ends up with a stale label or a missing tab. Full page reloads
between tabs also read as a website rather than an app.

**A framework with a router.** Rejected as disproportionate: the app has no
build step and no dependencies, and routing four static screens does not justify
introducing either.

## Consequences

- `index.html` grows with every screen. When it becomes unwieldy, that is the
  signal to introduce a build step and templating — not to split it into
  hand-maintained documents after all.
- The hash is the route, so a screen is linkable and the back button works.
- **The hash can no longer be used for in-page anchors.** Any `href="#thing"`
  that is not a route now navigates instead of scrolling, and falls back to the
  home view.
- Hidden views stay in the DOM. Page weight grows with every screen even when
  unseen, which is fine at four and would not be at forty.
- An unrecognised hash shows home rather than a blank screen.
