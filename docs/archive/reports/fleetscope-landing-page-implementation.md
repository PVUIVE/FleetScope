# FleetScope landing page — implementation report

Date: 2026-08-27 · Scope: the public landing route `/` and its supporting design contract.

> **Superseded 2026-08-28.** This records the first landing build: a dark surface on
> the product's own palette, animated with `motion`, with no pinned scroll scenes.
> `DESIGN.md` was then replaced with the Enterprise Blueprint contract (white ground,
> `#2448ff`, `border-radius: 0`, GSAP + ScrollTrigger, four pinned scenes) and the
> landing page was rebuilt against it — see
> `docs/reports/landing-vs-blueprint-spec-audit.md` for the gap analysis that drove
> the rewrite. Sections below that describe the palette, the animation library or the
> JS budget no longer describe the shipped page. What still holds: the audit in §A,
> the recorded CASE-1042 figures, and `lib/landing-data.ts`, which survived the
> rewrite unchanged.

Deliverables: `DESIGN.md` (root), `docs/design/landing-design-audit.md`,
`apps/web/src/pages/index.astro` + `components/landing/*` + `styles/landing.css` +
`scripts/landing.ts` + `lib/landing-data.ts`, landing coverage in
`apps/web/tests/presentation.test.ts` and `scripts/browser-qa.ts`.

---

## A. Initial UI audit

Full audit: `docs/design/landing-design-audit.md`.

Headlines: there was **no `/` route** — `astro.config.mjs` redirected `/` to `/cases`, so a
visitor landed inside an operator console with no product explanation. The app is Astro 5,
`output: 'static'`, with **zero client-side runtime dependencies** and one hand-authored,
token-driven stylesheet (`global.css`, 1552 lines) whose stated thesis is _"enterprise control
room… no gradients, no glows, and no motion that is not reporting a state change."_

That made this a **disciplined** codebase by the assessment rubric, so the landing page extends
its tokens rather than introducing a second visual language. Gaps found: no display type scale
(largest heading was 20px); the 48px operator nav is wrong over a 100vh hero; the global
`prefers-reduced-motion` rule clamps durations but **cannot stop a `requestAnimationFrame`
loop**; and the brief's example figures did not match the recorded fixture (§H).

## B. Reference research

| Reference                  | What was learned                                                                                                                                                                                | What was used                                                                                                                                                                                              | What was deliberately **not** copied                                                                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Motion.dev**             | Vanilla JS API surface (`animate`, `scroll`, `inView`, `stagger`, `hover`), spring config, hardware-accelerated transforms, documented reduced-motion story. Licence verified **MIT**.            | The library itself, as an npm dependency of `@fleetscope/web`, loaded from one island on `/` only.                                                                                                          | Nothing — it is a dependency, not a copy.                                                                                                                                                                          |
| **21st.dev**               | Composition and density of cinematic heroes, orbital/timeline layouts, container-scroll reveals; registry is shadcn/React.                                                                        | Composition patterns only.                                                                                                                                                                                  | **No component code.** Adding React to a static Astro app to paste a hero is a permanent architectural cost for a one-page gain, and per-component licence terms are not stated on the site.                        |
| **OriginKit**              | Interaction families: proximity orbit, reactive lines, mask text reveal, scroll text highlight, magnetic hover, image spotlight.                                                                  | The **principles**, each re-implemented independently in ~10–20 lines (proximity orbit → the hero field's attract term; mask reveal → `.fs-l-reveal`; magnetic hover → `--pull-x/--pull-y`).                 | **No code.** The site returned **HTTP 403** to inspection, the kit is beta, and its licence could not be verified. Unverifiable licence ⇒ recreate.                                                                 |
| **Beautiful UI**           | Vocabulary for approval cards, tool chips, task rows, context cards, evidence tables — directly relevant because FleetScope has all of those as real domain objects.                              | The vocabulary, mapped onto FleetScope's existing `.fs-*` components and `lib/status.ts`.                                                                                                                    | No visuals, no code. The landing page is not turned into a chat interface and exposes no model reasoning.                                                                                                          |
| **Refero Styles**          | Its function as a design-system reference.                                                                                                                                                       | Forced the `DESIGN.md` contract (§C) to be written **before** implementation and to be specific enough to be violated.                                                                                       | No styles.                                                                                                                                                                                                         |
| **Lottielab**              | Lottie is well suited to small status/icon motion.                                                                                                                                               | **Nothing.**                                                                                                                                                                                                | **Rejected entirely.** Templates are proprietary, and every micro-motion needed here (gate open, state flip, pulse) is a few lines of CSS. **Zero Lottie assets ship and no Lottie player is bundled.**             |
| **PixiJS**                 | Fastest 2D WebGL/WebGPU renderer; the natural candidate for the hero field.                                                                                                                      | **Nothing** — rejected on measurement (§G).                                                                                                                                                                 | Not installed, not shipped.                                                                                                                                                                                        |
| **Framer "LiquidFluid"**   | The _concept_: a restrained cursor-reactive luminous field on a transparent ground with slow dissipation. Mapped onto product meaning — unstructured agent activity organising around a Case.     | The idea only.                                                                                                                                                                                              | **The component is a paid proprietary Framer marketplace item. It was not downloaded, not inspected for code, and not reproduced.** The hero field is an independently written Canvas2D drift-and-attract system.   |
| **getdesign.md**           | Its central argument: AI-built pages read as a pile of trendy components because design intent is never made explicit.                                                                            | Answered structurally, with the single **Case Spine** motif and exactly four motion families. Any section that cannot be told as a transformation of the spine is rejected.                                  | n/a                                                                                                                                                                                                                |

Licence record: `THIRD-PARTY-NOTICES.md` now carries a Motion (MIT) entry and a
reference-by-reference "inspiration only, no code reused" table.

## C. DESIGN.md decisions

The contract is at the repository root. Sections marked **[L]** scope to the landing page so the
operator product never inherits its motion. The decisions that actually constrained the build:

- **One motif — the Case Spine.** A 2px rule with event nodes on it, re-cast per section
  (hero network → session timeline → control gates → recovery chain → replay scrubber → evidence
  rail → audit trail → one closed canonical trail). A section may not introduce a second
  organising visual.
- **One accent ramp, and it means something.** `--fs-l-live-a #6b9ce0 → --fs-l-live-b #8f7fe8`
  is used _only_ for live agent activity; `--fs-l-hist #4a5f7a` for the historical/replay state.
  The colour change **is** the "nothing is executing" claim rather than decoration.
- **Product status hues are untouched and never carried by colour alone.** A timeout is
  `unknown`, not `deny`. A sanitized input is `warn`, not `deny`. This surfaced two real bugs
  during QA (§L).
- **Monospace is a semantic**: event ids, hashes, version refs, policy refs, capabilities. Never
  prose, headings or buttons.
- **Four motion families** (flow / state transition / evidence accumulation / scroll
  storytelling). Anything that fits none does not ship.
- **Transform and opacity only.** Nothing that triggers layout is animated.
- **Reduced motion preserves all content and all interaction**, and is enforced in JS as well as
  CSS because the global rule cannot stop a `rAF` loop.
- **No third-party font files** are downloaded or self-hosted — no licence to verify, no network
  request, no FOUT.

## D. Final page structure

`/` renders eleven sections, in order, all built:

| #   | Section                   | Idea it teaches                                | Spine transformation                                    | Motion family |
| --- | ------------------------- | ---------------------------------------------- | ------------------------------------------------------- | ------------- |
| 01  | Hero                      | FleetScope is one governed control plane        | connections converging on CASE-1042                     | C + A         |
| 02  | One Case, many sessions   | work outlives an invocation                     | a timeline with a compressed multi-day gap              | C + D         |
| 03  | Durable context           | knowledge and its provenance survive            | the channel facts travel down                           | B             |
| 04  | Control boundaries        | governance is behaviour, not a label            | a line through gates that can stop it                   | A + B         |
| 05  | Incident + recovery       | recovery is authorized, not improvised          | a chain that breaks then is repaired                    | C             |
| 06  | Deterministic replay      | the past is reconstructable without side effects | the scrubber track                                      | B             |
| 07  | Evidence                  | every badge has a recorded event behind it      | the rail rows anchor to                                 | B             |
| 08  | Fleet Cockpit             | one surface holds the whole Case                | the product's own timeline                              | B             |
| 09  | Audit                     | the record is permanent and verifiable          | fragments sealing into a state hash                     | C             |
| 10  | Product surfaces          | five entry points, one Case                     | a staggered showcase, each art derived from the Case    | C             |
| 11  | Final CTA                 | put every agent action on the record            | everything converges, then one closed trail             | A             |

Plus a persistent Case Spine rail (dot column at demo widths, labelled ≥1680px), a landing nav
that resolves from transparent to elevated, and a footer whose technology note is **one
sentence** — no logo wall, no Gemini/Google section, no sponsor branding anywhere on the page.

## E. Hero architecture

Three independent layers, each of which degrades without taking the others down:

1. **Content** — semantic HTML. Headline, subhead, two CTAs, four figures. Complete on its own.
2. **Scene** — inline SVG: seven peripheral nodes on a circle, curved edges, the CASE-1042 plate.
   This is real markup with a `<title>`, and every node carries the `evt-…` that proves its label
   (surfaced by the Evidence Lens on hover).
3. **Field** — one `<canvas>`, `aria-hidden`, lazily started, that fails silently.

Entrance beat sheet (DESIGN.md §6): field 0.0s → peripheral nodes 0.3s (40ms stagger) → Case
plate locks in at 0.7s (soft spring) → edges draw 1.3s → evidence travel 1.6s → stable at 2.0s.
**The headline never waits on the scene** — copy has fully resolved by ~1.1s.

Cursor: ≤8px parallax on the scene, and the field's repulsion term, both desktop-pointer only.
The system cursor is never replaced or hidden.

**One real defect found and fixed here:** node placement was on the same `<g>` that Motion
scaled. A CSS `transform` on an SVG element _replaces_ the whole transform, so every node
collapsed onto the viewBox origin. Placement now lives on an outer group and the entrance scale
on an inner one, with `transform-box: fill-box; transform-origin: center` so scaled parts scale
about themselves.

## F. Motion system

One island, `apps/web/src/scripts/landing.ts`, imported from `index.astro` only. It uses
Motion's `animate`, `scroll`, `inView` and `stagger`.

Two invariants hold throughout:

1. **Under `prefers-reduced-motion: reduce`, no animation and no `rAF` loop starts.** CSS forces
   every element that would animate in to its final value; the JS checks the media query itself
   and returns early. A change of preference mid-session reloads, so the setting never needs a
   manual refresh to take effect.
2. **Nothing animates offscreen.** Every loop is gated by `inView` or an
   `IntersectionObserver`, plus `visibilitychange`. Proven by measurement (§K).

Notable choices: the nav's scrolled state uses an IntersectionObserver **sentinel** (one callback
per crossing) rather than a scroll listener (one per frame). Scroll-linked work is bound to
`scroll()` progress rather than time. Text motion is per **line**, never per letter, via
`clip-path`/`overflow` masks over text that is already in the DOM and selectable.

## G. PixiJS / WebGL decision — rejected on measurement

Both candidates were prototyped. The measurement that decided it, taken in Chromium at
1440×900 against the shipped scene at its **hard cap of 220 particles**:

| Metric                            | Canvas2D (shipped)                  |
| --------------------------------- | ----------------------------------- |
| Median main-thread cost per frame | **0.10 ms**                         |
| p95                               | 0.10 ms                             |
| Max over 300 frames               | 0.30 ms                             |
| Frame rate, hero visible          | 120 fps (display refresh; no drops) |
| Bundle cost                       | **0 KB**                            |

0.10 ms is **1.2% of a 120 Hz frame budget** and 0.6% of a 60 Hz one. A GPU renderer cannot
meaningfully improve a scene that already costs a tenth of a millisecond, and PixiJS would have
added roughly 150 KB gzipped of WebGL renderer to the landing page's critical path for no visible
gain. **PixiJS is not installed and not shipped.** The rule is now written into DESIGN.md §8:
WebGL is added only when a measurement shows a materially better result.

The same reasoning killed Lottie: a ~40 KB player to avoid six lines of CSS keyframes.

## H. Product-data integration — and three corrections to the brief

`apps/web/src/lib/landing-data.ts` derives **every** figure on the page from
`packages/fixtures/cases/CASE-1042` at build time. Nothing on the landing page is typed by hand,
so the page cannot drift from what the product can prove.

Real values used: 60 Canonical Events; 3 Runtime Sessions; `identity.allowed evt-0008`,
`identity.denied evt-0051` (`role_not_granted_to_agent_version`), `identity.allowed evt-0053`
(the recovery); `gateway.routed evt-0022`, `gateway.denied evt-0049`; `armor.blocked evt-0016`
(`prompt_injection`, channel `vendor_email`), `armor.allowed evt-0019`; `memory.rejected evt-0018`
(`source_input_blocked_by_armor`); incidents `inc-001 context_drift` (advisory) and
`inc-002 repeated_tool_failure` (critical, threshold 3, after `evt-0025/0027/0029`); intervention
`itv-001 retry_idempotent_read` across all five lifecycle states `evt-0032…evt-0037`;
approval `evt-0045`→`evt-0047`; projector `1.0.0`; terminal state hash `cb99db39…59735a`;
**18** blessed prefix hashes.

Three places where the brief's example figures do not match the recorded evidence. The evidence
won in each case — the page shows the recorded value, and this is flagged rather than silently
resolved:

| Brief says                    | Record says                                                                                                                                | Shown                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Vendor "Acme Components"      | Vendor is **Northwind Components GmbH**; `acme` is the _tenant_ (`procurement@acme.example`, scope `tenant/acme-procurement/case-1042`)      | Northwind Components GmbH |
| Memory "MOQ = 5,000"          | No MOQ exists in the record. `mem-001` is _"Agreed unit price EUR 12.40 with 45-day payment terms"_                                          | the real fact             |
| "Simulated Day 12"            | `evt-0015` carries `simulatedDayBoundary: 12` ✓ (deriving it from session timestamps would floor to 11 and contradict the evidence)          | **12**, read from the event |

The replay scrubber offers exactly the 18 positions the fixture blessed a prefix state hash for,
and each frame's counts are `project(events, { throughCaseSequence })` at that prefix — asserted
in the unit tests, not merely rendered.

## I. Responsive design

| Width                          | Behaviour                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| ≥1680px                        | Case Spine rail shows its labels                                                                                    |
| **1440×900** (primary demo)    | full experience; spine rail is a dot column in the gutter                                                            |
| **1280×720** (secondary demo)  | full experience, verified                                                                                           |
| 1180×800                       | verified by the repo's existing viewport sweep                                                                      |
| 1024–1279                      | two-column splits collapse; corridors keep their full width                                                          |
| <900px                         | Cockpit miniature stacks its three panes                                                                            |
| <720px                         | single column, **no canvas field**, no custom cursor/lens, simpler hero, surfaces un-stagger, evidence rows reflow    |

`html`/`body` keep `overflow-x: hidden` and every wide child scrolls inside its own container.
**Body-level horizontal overflow is asserted to be 0** at every tested viewport, before and after
a full-page scroll.

## J. Accessibility

Automated audit against the rendered page (contrast computed against each element's real painted
ancestor background):

```
contrast failures (WCAG AA)  0
heading skips                0        (h1,h2,h2,h2,h3,h3,h3,h2,…,h2 — no level skipped)
landmarks                    1 nav, 1 main, 1 footer
images without alt           0
controls without a name      0
canvas aria-hidden           true
range input labelled         true
```

Also: single `h1`; all controls are real `<button>`/`<a>`; the global 2px focus ring is never
removed; the Cockpit tablist supports roving arrow keys; the replay scrubber is a native
`<input type="range">` with an `aria-live` announcement of the reconstructed state; decorative
SVG and the canvas are `aria-hidden`; **no scroll hijacking** — pinned behaviour uses ordinary
sticky positioning and the page always scrolls at the native rate; keyboard traversal reaches
every control (verified by 25 sequential Tab presses in the browser).

## K. Performance results

Measured on `/` at 1440×900 in Chromium against the production build:

| Metric                                    | Budget   | Measured                                 |
| ----------------------------------------- | -------- | ---------------------------------------- |
| JS on `/` (gzipped)                       | ≤ 40 KB  | **28.4 KB** (one chunk, Motion included) |
| CSS on `/` (gzipped)                      | —        | **5.7 KB**                               |
| WASM on `/`                               | 0        | **0**                                    |
| Font requests                             | 0        | **0**                                    |
| LCP                                       | —        | **96–120 ms**                            |
| CLS                                       | < 0.02   | **0**                                    |
| Frame rate, hero visible                  | 60 fps   | **120 fps**, no drops                    |
| Hero field cost/frame @220 particles      | —        | **0.10 ms** median, 0.30 ms max          |
| Canvas frames drawn while offscreen (1.2s) | 0        | **0**                                    |

The offscreen figure is a direct read of the canvas's own draw counter, not an inference from
frame rate — the loop provably stops. DPR is capped at 2 and particle count scales with viewport
area (floor 40, cap 220).

## L. Browser QA

The landing checks are **integrated into the repository's own `pnpm qa:browser`**, not left in a
scratch script, so they run with everything else and cannot rot. The landing page is added to the
existing three-viewport route sweep and gets a dedicated block that runs **twice — once with
motion and once with `prefers-reduced-motion: reduce`**.

```
119/119 browser checks passed
```

Covering, per motion mode: exactly one `h1`; all 11 sections present; the headline states the
product; **no in-view content left invisible by an animation that never ran**; the hero field
respects the motion preference; a blocked input **visibly stops at the gate** and cites
`evt-0016`; scrubbing changes the reconstructed state, flags it historical, and shows a real
64-hex state hash; a Cockpit tab switches the evidence rail; an evidence row opens its Decision
Evidence; no body overflow after a full-page scroll; **zero console errors**. Mobile (390×844)
was additionally driven through the same interaction set.

Defects found in the browser and fixed:

1. **Hero scene collapsed to the origin** — Motion's `scale` replaced the SVG `translate` (§E).
2. **`h2` rendered uppercase** — `global.css` styles `h2` as a small uppercase section label,
   correct for the console and wrong for a display headline. Overridden under `.fs-l`.
3. **Three SVGs magnified ~2.75×** by being stretched to their containers, blowing their labels
   past the page's type scale. viewBoxes re-authored to render near 1:1 (corridors), and the
   Cockpit graph and surface miniatures capped.
4. **Session 03 wrapped to a second row** — a fixed 3-column grid could not hold N sessions plus
   the gap element. Now flex, so a fourth recorded session does not need a CSS change.
5. **Spine rail collided with the content column at 1440px** — the gutter is ~120px, not enough
   for a labelled rail. It is a dot column at demo widths and earns its labels only ≥1680px.
6. **Day gap read 11, evidence says 12** — the derived value floored a 11.99-day span. Now read
   from `simulatedDayBoundary` on the resume event.
7. **Status-vocabulary misuse (two)** — a tool timeout was badged `denied` (policy refusal) when
   it is `failed` (execution failure); the memory-rejection row and two Cockpit rail rows used
   keys the vocabulary does not define, rendering as "Unknown". `EvidenceRow` now carries a
   `badge` (vocabulary key) separate from its display label, and a test asserts no landing badge
   resolves to Unknown.
8. **Status chips stretched full-width** as grid items in the evidence rows.
9. **`vendor-onboarding@1.4` was being uppercased** in the audit fragments — an identifier whose
   case is not ours to change.
10. **Canvas `data-on` was not cleared when the loop stopped**, leaving a stale attribute.
11. **A converge SVG lacked an explicit `aria-hidden`** (its wrapper had one).

## M. Tests

```
pnpm run format:check   PASS
pnpm run lint           PASS
pnpm run typecheck      PASS   (astro check: 0 errors, 56 files)
pnpm run test           PASS   242 tests, 12 files
pnpm run build:web      PASS   7 pages
pnpm qa:browser         PASS   119/119
pnpm smoke              PASS   17 steps, 0 FAIL, 0 SKIP
```

`pnpm smoke` covers, in addition: `cargo fmt`/`clippy`/`test`, the vendored Zoetrope suite in
both feature configurations, the wasm-only browser crate, the recorded-Case reliability run
(`invariantViolations: 0`, `replayControlAdapterCalls: 0`, `auditExportVerified: true`) and the
`trunk` WASM build.

**8 new unit tests** were added to `apps/web/tests/presentation.test.ts` — the file whose stated
purpose is "the claims the UI makes on screen":

- the landing reports the recorded Case, not a rewritten one;
- the multi-day gap comes from the resume event, not from arithmetic;
- the durable fact carries both ends of its provenance and crosses a session boundary;
- **no evidence row or spine node references an event id the fixture does not contain**;
- every landing badge resolves to a defined status word;
- the five intervention states stay distinct and ordered;
- every replay position has a 64-hex blessed hash **and** its counts equal the projection at that
  prefix;
- the last replay position is the blessed terminal hash.

No existing test was changed. **No product route regressed** — `/catalog`, `/cases`,
`/cases/CASE-1042`, `/approvals`, `/cockpit/CASE-1042` (WASM renderer instantiates) and
`/audit/CASE-1042` all pass their existing browser checks unchanged.

## N. Third-party code and licences actually used

| Item             | Licence  | Status                                                                                                                             |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `motion` (npm)   | **MIT**  | Added as a dependency of `@fleetscope/web`. Loaded only on `/`. Not vendored, not modified.                                          |
| Everything else  | —        | **Nothing else was added.** No React, no Pixi, no Lottie, no Tailwind, no icon pack, no font files, no CDN request, no copied component. |

The hero field, the Evidence Lens, the magnetic buttons, the mask reveals, the corridors, the
scrubber and every miniature are original code in this repository. `THIRD-PARTY-NOTICES.md`
records the Motion entry and a per-reference "inspiration only, no code reused" table.

## O. Remaining limitations

1. **One recorded Case.** The page is written generically against `landingData()` and adding a
   second fixture adds rows rather than requiring component changes, but only CASE-1042 has been
   exercised.
2. **The Cockpit section is a deterministic SVG miniature, not the WASM renderer.** Loading a
   1.9 MB WASM module on a landing page to show a still frame is the wrong trade; the CTA opens
   the real surface. This is a deliberate decision, recorded in DESIGN.md §8.
3. **No page-transition morph** from the hero Case object into the Case Workspace. Astro view
   transitions would give a cross-fade, but a genuine shared-element morph between an SVG plate
   and a product header needs more machinery than the effect justifies; the CTAs navigate
   cleanly instead.
4. **Frame rate measured on the demo machine only** (120 Hz display). The 0.10 ms/frame figure
   implies large headroom on slower hardware but that has not been measured on a low-end device.
5. **No automated axe-core run.** The accessibility audit above is a hand-written check of
   contrast, heading order, landmarks, control naming and keyboard traversal; adding `axe-core`
   would mean a new dev dependency for the QA path.
6. **Screenshots were inspected, not committed.** The repository does not maintain visual QA
   artifacts, so per the brief's §47 they were reviewed during QA at 1440×900, 1280×720 and
   390×844 and written to the run's screenshot directory rather than added to the repo. Set
   `FLEETSCOPE_QA_SHOTS=<dir>` to regenerate them.
7. **The live-proof path was not exercised** (`FLEETSCOPE_QA_LIVE` unset) because it spends real
   money; the landing page does not touch it.

## P. Exact commands

```bash
# install (once)
pnpm install --frozen-lockfile

# develop the landing page
pnpm dev                      # http://localhost:4321/

# production build + preview
pnpm run build:web
pnpm --filter @fleetscope/web exec astro preview --port 4333
#   landing   http://localhost:4333/
#   cockpit   http://localhost:4333/cockpit/CASE-1042/

# validation
pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test
pnpm run build:web
pnpm qa:browser                              # 119 checks, incl. landing + reduced motion
FLEETSCOPE_QA_SHOTS=./shots pnpm qa:browser  # also writes full-page screenshots
pnpm smoke                                   # the whole toolchain, TS + Rust + WASM
```
