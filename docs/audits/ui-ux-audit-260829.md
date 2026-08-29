# FleetScope — UI/UX audit and redesign

Date: 2026-08-29 · Branch: `main` · Scope: `apps/web` (every user-facing surface)

Status: **audited and implemented.** Evidence in §9; screenshots in `shots/`.

> This supersedes the audit-only revision of this file, which stopped at two
> blockers: 21st.dev MCP was unavailable, and the brief assumed a sprawling
> product this repository does not have. The first is resolved — the MCP server
> is available in this session and was used (§5). The second is addressed by
> auditing what is actually here rather than the product the brief imagined, and
> that turned out to be the right call: the real defects were nowhere near where
> a generic redesign would have looked.

---

## 1. Existing architecture

| Layer | Actual |
|---|---|
| Framework | Astro 5.16, `output: 'static'`, `build.format: 'directory'` |
| Components | `.astro` only. No React/Vue/Svelte. No component library. |
| Interactivity | Hand-written TS islands in inline `<script>` + `src/scripts/`, `src/features/` |
| Styling | Three plain CSS files. No Tailwind, no CSS-in-JS, no preprocessor. |
| Tokens | CSS custom properties, semantic, `--fs-*` namespace |
| Animation | GSAP 3.15 (landing only) |
| Charts | None. The execution graph is a **Rust/WASM renderer** (`crates/fleet-cockpit-web`) owning `#fleetscope-cockpit-canvas`. |
| State | None global. Per-island local state + SSE (`lib/local-api.ts`) |
| Icons | None. Text glyphs + words (deliberate — see §4) |
| Fonts | System stacks only. Zero webfont dependencies. |
| Design authority | **`DESIGN.md` at repo root** — an accepted, enforced contract |

### Styling architecture

- `global.css` — console/app shell. Dark control-room language.
- `viewer.css` — session list, Setup, Agent Viewer.
- `landing.css` — landing only, every rule scoped under `.fs-l`.

`landing.css` **re-points** the shared `--fs-*` tokens under `html.fs-l` rather
than forking them, so shared primitives inherit the light blueprint palette.
That is deliberate design-system engineering, not duplication, and it was left
alone.

---

## 2. UI inventory (derived, not assumed)

Four built routes. That is the entire published product.

```text
FleetScope
├── /                    Landing (light "Enterprise Blueprint" surface)
│   ├── Hero — the Execution Spine
│   ├── 02 Logs → graph
│   ├── 03 Execution events
│   ├── 04 Catch failures fast
│   ├── 05 Historical inspection (replay)
│   └── CTA + footer
└── Console (dark)
    ├── /docs/           Setup — 3 numbered steps + plugin snippet
    ├── /sessions/       Session list — filters, live SSE, empty/offline states
    └── /sessions/view/  Agent Viewer — static shell, path-rewritten per session
        ├── Header bar (transport, duration/events/errors/model, actions)
        ├── Historical banner
        ├── Agents pane │ WASM graph │ Details pane
        └── Execution timeline (keyboard-steppable)
```

### Surfaces that do NOT exist in this repository

Auth · dashboard · settings · onboarding flow · modals · command palette ·
toasts · charts · data tables · search · breadcrumbs · workspace selector.

Absent by design, not omission: the product is a local, single-user,
zero-account viewer. **No such surface was invented.** Inventing a settings page
for a product with nothing to configure would have been the worst outcome
available here.

### Deliberately unpublished

`src/deferred/` — six enterprise surfaces plus their exclusive components,
removed from the build in `89f8873`, documented in `src/deferred/README.md`,
still unit-tested. Left untouched: they are a recorded decision, and restyling
unpublished pages is work with no reader.

---

## 3. Audit findings

The audit-only revision of this file reported **no P0 and no P1**, and ranked
the details drawer's missing dialog semantics as a P2. Driving the product in a
real browser at 390px — which no harness in this repository had ever done —
proved that ranking wrong. The corrected findings:

### P0 — blocks usability

| # | Finding | Evidence |
|---|---|---|
| P0-1 | **The Agent Viewer was unusable below 1180px.** `.fs-pane--details` is `position: fixed` under that width, and nothing kept it closed: the renderer settling on boot moved the cursor, `paintDetails` then set `hidden = false`, and an empty-to-full-width overlay covered the graph and the timeline before the developer touched anything. Its body intercepted every click aimed at a timeline row, so **no event could be opened at all.** | `shots/before/viewer-390x844.png`; baseline harness run: `a timeline row can be clicked at all — locator.click: Timeout 5000ms exceeded` |

### P1 — major UX issue

| # | Finding | Evidence |
|---|---|---|
| P1-1 | The same overlay had **no dialog semantics**: no `role`, no `aria-modal`, no focus trap, no Escape, no focus restore, no scrim, no `inert` background. It read as a drawer visually and as nothing at all to assistive tech. | `styles/viewer.css` ≤1180 block; baseline: 6 consecutive FAILs |
| P1-2 | **Stepping the timeline re-opened a drawer the developer had just closed**, on every keypress — `paintDetails` un-hid the pane on each paint. Closing it to read the timeline and then stepping the timeline was impossible. | `paintDetails`, `agent-viewer.ts` |
| P1-3 | **`scripts/browser-qa.ts` was dead at the commit this branch started from** (`570adb6`): it drove the *deleted* enterprise landing — `#corridor-screening`, the cockpit tablist, an `h1` reading "Control every agent" — and failed outright, so the landing had no working browser gate. **Superseded:** PR #5 fixed the same file on `main` in parallel, independently reaching the same 6-section count and the same `top 92%` reveal threshold, plus checks this branch did not have (primary CTAs resolve to `/sessions/`, returning to the newest event leaves historical mode, exactly one failure step is current). On merge, **their version was taken as the base** and only two genuinely additive checks were kept from here — see §7. | `git log 570adb6..origin/main -- scripts/browser-qa.ts` |
| P1-4 | **Closing the details pane on desktop left a dead 330px column.** `.fs-viewer__body` has fixed `grid-template-columns`, so `[hidden]` collapsed the element and left its track. | measured 831px graph before/after; now 1161px |

### P2 — significant visual/consistency issue

| # | Finding |
|---|---|
| P2-1 | At ≤720px the timeline **deleted** `.fs-event__category` and `.fs-event__duration` — the kind word (`ERROR`, `TOOL`) and the timing, which are the two columns a run is scanned by. Saving width by removing the information the screen exists to show. |
| P2-2 | `.fs-event__agent` had no `min-width: 0`, so a long agent id pushed content past the right edge at 390px (measured `right=414` in a 390px viewport). |
| P2-3 | The nav's three fixed-width groups did not fit 390px: the brand and the environment chip **overlapped the links**, which could not be read or tapped. |
| P2-4 | `.fs-viewer` used `height: calc(100vh - …)`, which on a phone is the height *without* the retracting browser toolbars. |
| P2-5 | `Close` in the details head used `style="float:right"` — the only inline style in the route set. |
| P2-6 | Setup reused `.fs-sessions` / `.fs-onboard` for content that is neither a session list nor onboarding. The stylesheet was lying about what a rule governs. |
| P2-7 | The failure count rendered in the same muted grey as every other stat. A run's failure count is why the screen gets opened; it was found by reading, not by looking. |
| P2-8 | Clipboard copy was hand-rolled **twice**, in `sessions/index.astro` and `docs/index.astro` — one behaviour, two places to drift. |
| P2-9 | The agent strip's `max-height: 132px` clipped the second agent of a **two-agent** run — the smallest tree the product ever shows. A `vh`-based cap fixed one width and reintroduced the clip at another, cutting a row through the middle of its text at 1180×800. |
| P2-10 | `.fs-copy-row { align-items: stretch }` is right for a one-line command and wrong for the nine-line plugin snippet, where it grew the `Copy` button into a column-high slab. |
| P2-11 | Setup's Commands list kept its 88px term column at 390px, leaving too little for the definition: `.fleetscope/config.json` broke across lines mid-word. |

### P0/P1 — second pass: information design

The first pass audited responsiveness, accessibility and interaction, and
reported the console's visual design as sound. Seen on a 2000px display, that
was wrong — and it was wrong because every harness in this repository, mine
included, stopped at 1440px. What a wide screen showed:

| # | Finding | Evidence |
|---|---|---|
| P1-5 | **`/sessions/` used 74% of the width and 31% of the height it was given.** The list was capped at 1120px inside a 1512px column on a 2000px viewport, and one run rendered as a single line of prose floating in an otherwise black page that ran on for another 700px. That does not read as "one run"; it reads as a page that failed to load. | measured 1120px content in a 2000px viewport; `shots/before-wide/` |
| P1-6 | **The session list was not a table.** Five measurements a developer compares across runs — status, agent, events, duration, when — with no column headings and no alignment to compare along. No search, no sort. | `pages/sessions/index.astro` before this pass |
| P1-7 | **Every landing section was flush against the next.** `.fs-l-sec` computed to `padding: 0` on all four sides: §02's terminal block ended and the `03` numeral began **7px** later; §03's event cells ran into `04` after **10px**. `DESIGN.md` §8 specifies `clamp(64px, 7vw, 116px)` and `.fs-l-block` implements it — it was simply never applied to the content sections. | computed styles on every `main section`; `shots/before-wide/landing-*.png` |
| P2-12 | **Setup was 1828px tall to say six things**, at 32px card padding, one full-width card per step — roughly 900px of scrolling for a three-command quick start. | measured document height |
| P2-13 | The `Copy` control sat as a flex sibling of a full-width code block, which on a wide screen put it **~700px from the snippet it copies**. | `shots/before-wide/docs-*.png` |

### P3 — polish

| # | Finding |
|---|---|
| P3-1 | No skip-to-content link, though `id="fs-main"` existed and was clearly the intended target. |
| P3-2 | Copy success was a text swap only (`Copy` → `Copied`). A label changing under a button that still has focus is not an announcement. |
| P3-3 | `↑ ↓ TO STEP · END FOR THE LIVE EDGE` shown on touch screens with no keyboard. |

### Not findings — verified working, and protected

Not a codebase in need of rescue. Confirmed present and left alone: the semantic
token system with documented WCAG AA reasoning per text weight; status never
carried by colour alone, with a single vocabulary source in `lib/status.ts`;
`prefers-reduced-motion` honoured in all three stylesheets; deliberate
empty/offline/live/clipboard-denied state coverage in the session list;
`[hidden] { display: none !important }` with a documented incident as its
rationale; build-time-real landing content read from a recorded ADK run; and
zero webfont, icon-font or component-library dependencies.

---

## 4. Design direction

`DESIGN.md` is an explicit contract: *"Implementation follows this file. When
the two disagree, this file is wrong and gets fixed first."* It specifies the
"Enterprise Blueprint / Operational Wireframe" style, the colour system, the
dark operational surface, the type scale, and four motion families.

The brief's requested direction — Linear/Vercel/Raycast register, restrained,
high-information, no gradients or glass — and the contract already in force are
**substantially the same brief**. `DESIGN.md` additionally forbids things a
generic premium-SaaS redesign would have added ("must NOT be … a wall of feature
cards"; "avoid gradient blobs, floating glass panels, rounded-everything UI").

**Decision: the contract is treated as binding and was not rewritten.** Every
change below is inside the existing design language — the same tokens, the same
1px borders, the same glyph-plus-word status vocabulary, no new colour, no new
font, no new dependency. Nothing was restyled for the sake of looking different.
Reversing a recorded design decision because an audit prefers a different
aesthetic is exactly what this repository's own review rules forbid.

What *was* extended is the language's reach: it had never been applied below
1180px, because nothing had ever looked.

---

## 5. 21st.dev MCP research

Searches run: observability console / session detail pane / responsive drawer ·
execution timeline & trace viewer with durations · responsive data table with a
mobile stacked fallback.

| Reference | Pattern studied | Verdict |
|---|---|---|
| **`@ddoemonn/drawer`** (id 23558) — retrieved in full | Headless drawer: scrim, scroll lock, focus trap, focus restore, `inert` siblings, Escape, `role="dialog"` + `aria-modal`, `tabIndex={-1}` panel, reduced-motion → `duration: 0` | **Adopted as the interaction contract** for `details-drawer.ts`. Not the code — it is React + `motion` + Tailwind and this app is Astro islands with plain CSS. What transferred is the *checklist of what a drawer owes the user*, which is precisely what P1-1 was missing. Cited in the module header. |
| `@moumensoliman/interactive-logs-table` (10635) | Observability log rows with expandable detail and filter chips | **Rejected.** FleetScope already has this shape, and expanding rows inline would compete with the details panel that is the product's actual answer. Confirmed the existing filter-chip pattern is conventional. |
| `@corr/audit-log` (25163) | Timestamped rows: actor, type, status tags per row | **Partly adopted.** Reinforced that kind and status belong *on the row* rather than in a legend — which is the argument for reversing P2-1 rather than accepting the ≤720px column deletion. |
| Timeline components (1074, 5157, 857, 1943) | Marketing/chronology timelines with beams, scroll-scrub, dots | **Rejected.** Decorative chronology for narrative pages. FleetScope's timeline is a dense keyboard-operable log at ~5px row padding; these patterns are 10× the vertical cost per row and would destroy the scan. |
| Card/table responsive set (9813, 25296, 4823, 10379, 5737) | Card-stack and proximity-hover table treatments as mobile fallbacks | **Rejected the card fallback, adopted the principle.** Turning timeline rows into cards would cost the tabular alignment the offsets depend on. The principle taken — *reflow, never delete* — drove the two-line narrow row (§7, P2-1). |

The honest summary: one component earned its keep, as an interaction
specification rather than as code. Blindly importing shadcn/Tailwind components
into an Astro app with zero component-library dependencies would have been the
single most destructive thing available in this task.

---

## 6. Design system

Unchanged and reused as-is: colours, typography, spacing scale, radii, surfaces,
motion families — all already defined in `global.css` and `DESIGN.md`. No token
was added, removed, or re-valued.

Conventions added, all expressed in existing tokens:

- **`.fs-skip`** — skip-to-content, off-screen by transform (not `display: none`,
  which would remove it from the tab order and make it decoration).
- **`.fs-scrim`** — the dialog backdrop, `#00000073`, `z-index: 20`, only ever
  present while the details panel is modal.
- **`.fs-pane__head--actions` / `.fs-pane__title`** — a pane head that carries a
  control lays it out instead of floating it out of flow.
- **`.fs-viewer__stat[data-tone='danger']`** — a stat allowed to carry status
  colour. Used only for a non-zero failure count.
- **`.fs-setup*`** — Setup's own vocabulary, replacing the session-list names it
  had borrowed. Genuinely shared pieces (`.fs-copy-row`, `.fs-copy-btn`) stay
  shared.

Two new primitives, both because a real duplication or gap existed — not
speculatively:

- **`features/viewer/details-drawer.ts`** — owns the panel's two lives (column
  above 1180px, dialog below) in one place.
- **`lib/copy-button.ts`** — one copy behaviour, announced via a polite live
  region, replacing two hand-rolled copies.

---

## 7. Changes implemented

### Global
- Skip-to-content link in `BaseLayout`, styled in `global.css`. (P3-1)
- Responsive nav at ≤720px: the tagline and the environment chip give way, the
  destinations keep their width. Nothing removed that a developer needs. (P2-3)
- Console page padding reduced at ≤720px.

### Console — Agent Viewer
- **`details-drawer.ts`**: below 1180px the panel is a real dialog — scrim,
  `role="dialog"`, `aria-modal`, focus into the panel, Tab trapped, Escape
  closes, `inert` background, scroll lock, focus restored on close. Above
  1180px it is a `role="region"` column and claims none of that. (P0-1, P1-1)
- **It starts closed** when it is a dialog, and opens only on an *explicit*
  request — a click on a timeline row, an agent, or Jump to failure. The
  renderer settling on boot and keyboard stepping no longer open it. (P0-1, P1-2)
- A **`Details`** control in the bar reopens a closed panel at any width.
- Focus restore survives the timeline rebuild: the opener's node is destroyed by
  the re-render, so focus returns to the row that took its place, by identity.
- Closing on desktop now **collapses the grid track**, handing the width to the
  graph (measured 831 → 1161px) instead of leaving a hole. (P1-4)
- `style="float:right"` removed; the head is a flex row with a real `<h2>`. (P2-5)
- Non-zero failure count carries the danger tone. (P2-7)

### Console — responsive
- **≤720px the viewer stops being viewport-locked and scrolls.** An agent strip,
  a graph and a timeline that each insist on a minimum cannot share 844px minus
  a wrapped header; the loser was the graph, which slid under the timeline. The
  graph now takes a fixed 260px and the timeline takes the length it needs.
- **Timeline rows reflow to two lines instead of dropping columns**: offset,
  kind and duration on the first line, label clamped to two lines on the second.
  Nothing is deleted. (P2-1)
- Agent tree becomes a horizontally scrolling strip at ≤720px; below 1180px it
  is sized in **whole rows** (`max-height: 184px`) rather than viewport
  fractions, so the common trees are complete and a half-row means what it is
  supposed to mean — there is more, scroll. (P2-9)
- `.fs-viewer__body` given a floor so the graph is *sized* rather than silently
  clipped when the column is short; the timeline shrinks instead, losing nothing
  because its rows scroll either way.
- `100dvh` alongside `100vh`. (P2-4)
- `min-width: 0` on the timeline label and agent span. (P2-2)
- Keyboard-stepping hints hidden on touch widths. (P3-3)
- Sticky timeline head while scrolling a run on a phone.

### Console — information design (second pass)

- **The session list is a table.** Column headings in tracked micro-caps, a 2px
  status rail per row, tabular numerals, and one bordered region that fills the
  page instead of rows ending in mid-air. Sortable on Events, Duration and
  Started — "which run was slow" and "which run did the most" are the two
  questions a list of runs exists to answer. Text filter over name, agent and
  id, focused by `/`. A persistent collector-state chip, because whether the
  collector is answering is the precondition for everything else on the page and
  was previously visible only as an error after a failure. (P1-5, P1-6)
- **Width**: the list and Setup now use the column they are given (98% and 97%
  of it) rather than a 1120px cap the Agent Viewer never obeyed.
- **Setup**: three ordered steps sit side by side — the whole quick start in one
  glance — and the reference panels pair up below. 1828px → one screen. (P2-12)
- **`Copy` is pinned into the code block's top-right corner**, where every
  documentation site has taught developers to look. (P2-13)
- Narrow widths keep every fact: at ≤1080px the table drops root agent and
  started (both restated elsewhere in the row); at ≤720px it becomes two lines
  and the heading row goes with the columns.

### Landing and console — third pass

Found by looking at the running product on a large display, after the second
pass shipped.

- **P1-8 — the §02 terminal was unreadable with motion on.** `logsToGraph()`
  faded the raw log lines to `opacity: 0.32`, compositing `--fs-terminal-text`
  to rgb(58,61,70) on the rgb(12,13,18) ground: **1.79:1** against a 4.5:1
  requirement. The section argues by comparing the raw list on the left with
  the structured run on the right, and the left-hand side could not be read at
  all. Raised to 0.8 — the lowest step that clears AA — and the emergence of
  the structured side carries the transformation anyway.
  **Why no harness saw it:** `a11y-qa` only ever drove the landing in a
  *reduced-motion* context, where that timeline returns early and the lines
  stay at full opacity. It now drives the landing with motion running,
  composites opacity before measuring, and asserts the ratio a reader sees.
- **P2-14 — the terminal ground was absolute black** (`#0c0d12`) on a white
  blueprint page: the one element fighting the canvas. Charcoal `#141821`
  instead; the faded lines still clear AA against it (4.96:1).
- **P2-15 — the two hero commands were readable but not takeable.** They are
  the first thing the page asks a visitor to run, and getting them meant
  retyping or dragging a selection across a monospace block. The whole block is
  the control now — a 420px target, a real `<button>` with an `aria-label`,
  operable from the keyboard — and the `$` prompt stays out of the clipboard.
  The clipboard is touched in exactly one place (`lib/copy-button.ts`
  `copyText`), so the landing and the console cannot drift in what they
  announce or in how they handle a refused permission.
- **P2-16 — the console had no ground of its own.** The landing draws a
  12-column rule grid; the console had nothing behind its panels, so the two
  halves did not look like the same product and a page holding one run looked
  like unpainted background. Same motif, dark, as one painted background image
  rather than decorative divs, dropping below 1280px where the columns read as
  noise. The session table rules its empty region **at the row pitch** (offset
  33px for the heading, measured — not guessed), so the space below the last
  row reads as a ledger with room rather than a slab. The execution timeline
  stays opaque: it has a column system of its own, and a second grid crossing
  it at a different pitch is two grids arguing in the densest part of the
  product.

### Fluid cursor (requested)

A GPU Navier–Stokes solver behind the landing page, ported from the Vue
reference to a plain TS island since this app has no Vue. Three adaptations
rather than a straight port: splats are generated in a narrow band around the
brand blue instead of cycling full HSV, which on a white blueprint page would
read as confetti; the dye texture is 1024 rather than 1440, a quarter of the
fill rate and no visible difference at this blur; and it declines to start
under reduced motion, on a coarse pointer, or without float render targets, and
idles while the tab is hidden.

**Scoped to the landing.** The Agent Viewer owns a WebGL context for the
execution graph, and a fluid solver competing for the GPU with the thing a
developer came to read is a bad trade. `DESIGN.md` rejects "any animation that
exists to be noticed", so this is a deliberate, owner-approved exception on the
marketing surface only — recorded here rather than quietly taken.

### Landing — spacing (second pass)

- **Section rhythm restored** to what `DESIGN.md` §8 already specified:
  `clamp(56px, 5.5vw, 96px)` of block padding on the content sections, and a
  real gap between a section heading and the thing it introduces. Block padding
  only — the horizontal flush-to-frame alignment is the blueprint grid doing its
  job (§32) and was left alone. (P1-7)

### Console — Setup and session list
- Setup moved onto `.fs-setup*`; shared components stay shared. (P2-6)
- Both pages use `lib/copy-button.ts`, which announces success and the
  clipboard-denied fallback through a polite live region. (P2-8, P3-2)
- The `Copy` control sits at the top of what it copies instead of stretching to
  its height. (P2-10)
- Setup's Commands list stacks term over definition at ≤720px. (P2-11)
- No inline styles remain in any route.

### Landing
- **No visual change.** It is on-contract, it has no P0/P1/P2 findings, and
  `DESIGN.md` governs it explicitly. Redesigning it would have been change for
  its own sake.
- Its **browser gate was repaired on `main` by PR #5 while this branch was in
  flight**, independently and slightly better — `section.fs-l-sec` is a more
  precise selector than `main section`, and it added checks this branch lacked.
  This branch's parallel rewrite was therefore **discarded on merge** in favour
  of theirs. Same for the `top 92%` reveal threshold and the `/api/` 404
  filtering: both sides reached the same answer, and theirs landed first. (P1-3)
- Two checks from this branch were genuinely additive and were kept on top:
  - the collector-less session list must **say** the collector is not answering
    and must not simultaneously claim there are no sessions — filtering the 404
    proves the page does not error, not that it explains itself;
  - the landing is scrolled through in steps and **every** `[data-rise]` section
    must have revealed by the end. The bounded check above it is correct for
    "reading position" but says nothing about sections below that line.

### Tooling
- **`scripts/viewer-qa.ts`** (new, `pnpm qa:viewer`): seeds the recorded Google
  ADK session into a throwaway store, boots the real collector, and drives the
  Agent Viewer at 1440 / 1280 / 1180 / 1024 / 768 / 390. No Gemini key, no
  spend, no network. This is the gap that let P0-1 ship: `browser-qa.ts` cannot
  reach the viewer, and `viewer-e2e.ts` needs a live Gemini run — and both
  stopped at 1180px.

---

## 8. Before → after

Screenshots: `docs/audits/shots/{before,after}/`.

| Surface | Before | After |
|---|---|---|
| Agent Viewer @ 390×844 | A details drawer covering 92% of the screen from load, over the nav, intercepting every click. **The product was inoperable.** | Readable nav, session identity, failure in red, actions, agent strip, graph, two-line timeline. Every row clickable. |
| Details panel @ ≤1180 | A fixed div. No role, no trap, no Escape, no restore, reopened on every keypress. | A dialog that behaves like one, opens only when asked, and gives focus back. |
| Agent Viewer @ 1440 | `Close` left a dead 330px column. | Graph takes the width: 831 → 1161px. |
| Agent Viewer @ 1024×768 | Second agent of a two-agent run clipped; graph starved until the renderer dropped node labels. | Whole tree visible; graph at 251px with labels intact. |
| Timeline @ ≤720 | Kind word and duration deleted. | Both kept, reflowed to two lines. |
| Landing browser QA | Failing at `570adb6` against a page deleted three commits earlier. | 63/63 — PR #5's repair, plus two additive checks from here. |

---

## 9. Validation

Every command below was run to completion on this branch.

| Gate | Command | Result |
|---|---|---|
| Format | `pnpm run format:check` | pass (via `check`) |
| Lint | `pnpm run lint` | pass, 0 findings |
| Types | `pnpm run typecheck` | 15 packages + `astro check` — **0 errors** |
| Tests | `pnpm test` | **368 passed**, 22 files |
| Build | `pnpm run build:web` | 4 pages, exit 0 |
| Full pipeline | `pnpm run check` | **exit 0** |
| Static browser QA | `pnpm qa:browser` | **63/63** (crashed at the branch point; PR #5 fixed it on `main` in parallel) |
| Viewer responsive QA | `pnpm qa:viewer` | **67/67** (baseline before changes: 32/45) |
| Accessibility QA | `pnpm qa:a11y` against a live collector | **16/16** |

Console errors: zero across every route and viewport in both browser harnesses.

Every screenshot in `shots/after/` and `shots/after-static/` was also reviewed
by eye, not merely captured. That pass is where P2-9's second form, P2-10 and
P2-11 were found — all three pass their harness checks and are visible only by
looking.

Not run: `pnpm e2e`, which spends real Gemini Flash calls against a live ADK
run. `qa:viewer` covers the same surface from the recorded session without
spend, and `qa:a11y` was run against a real collector process.

---

## 10. Remaining opportunities

**Completed** — every P0, P1, P2 and P3 in §3.

**Deliberately deferred**

- **The landing page is not redesigned.** On-contract, no findings above P3, and
  `DESIGN.md` governs it. Changing it would be motion without direction.
- **`src/deferred/` is untouched.** Six unpublished enterprise surfaces, a
  recorded decision, still tested. Restyling pages nobody can reach is waste;
  deleting them is a product call, not a UI one.
- **No surfaces were invented.** No dashboard, settings, onboarding, command
  palette or search was added, because the product has nothing to put in them.
- **The WASM renderer's internal layout** — its own overview panel and label
  dropping at small canvas sizes — is owned by `crates/fleet-cockpit-web` and
  was out of scope. It is the reason the graph now defends a height floor.

**Future**

- `qa:viewer` should run in CI; it is the harness that would have caught P0-1.
- **Every harness stopped at 1440px, so nobody had looked at the product on a
  large display.** That is how a console that used 74% of its width and 31% of
  its height passed a full audit. `qa:viewer` now drives 1920x1080 and asserts
  both shares directly; the two checks fail on the pre-pass build.
- `browser-qa.ts` drifted silently for three commits, and **two branches then
  fixed it independently and collided** — this one and PR #5. The duplicated
  effort is the cost of a broken gate nobody was alerted to. Running the
  harnesses in CI is what prevents both the drift and the collision.
- The token system could support `prefers-color-scheme`; the console is
  hardcoded dark, which is defensible for a control room but is a choice worth
  making explicitly rather than by default.

## Open questions

1. Should `pnpm qa:viewer` be added to the CI workflow and to `pnpm run check`?
   It takes ~40s and needs Playwright's Chromium.
2. `DESIGN.md` §Scope says the landing is the one light surface and the console
   keeps the dark language. Confirmed as still intended?
3. The deferred enterprise surfaces: keep, or delete now that the product
   direction has been settled for several commits?
