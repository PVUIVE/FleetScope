# Audit — landing implementation vs the Enterprise Blueprint contract

Date: 2026-08-28 · Scope: `apps/web/src` landing route (`/`) vs the 47-section
"FleetScope — Landing Page Design System" contract supplied in-session.
Method: read-only. No files changed.

> **Outcome, recorded same day.** This audit compared the then-shipped landing page
> against a proposed contract and found them irreconcilable. The proposed contract
> was adopted: it is now `DESIGN.md` at the repository root, and the landing page was
> rebuilt against it along path 2 of §6. Everything below is therefore written in the
> past tense of the *old* implementation — in particular, §0's "Repo DESIGN.md"
> column describes a file that no longer exists. It is kept as the reasoning behind
> the rewrite, not as a description of the current page.

---

## 0. Headline finding — there are two conflicting design contracts

The repository already contains a `DESIGN.md` at the root (354 lines, untracked).
It is **not** the document supplied in this session. They are different contracts
with incompatible fundamentals:

|               | Repo `DESIGN.md` (what the code implements)          | Pasted spec (what was audited against)            |
| ------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Scope         | Whole product, `[L]`/`[P]` split                     | Landing page only                                 |
| Ground        | Dark — `--fs-bg #0d1014`                             | White — `--fs-bg #ffffff`                         |
| Accent        | Cool blue→violet liveness ramp `#6b9ce0` → `#8f7fe8` | One electric blue `#2448ff`                       |
| Geometry      | 6px / 4px radii inherited from product tokens        | `border-radius: 0` default                        |
| Motion stack  | `motion` npm (~18 KB gz), `inView` + `scroll`        | Astro + **GSAP + ScrollTrigger**, pinned sections |
| Dark surfaces | Everything                                           | Reserved moments only (Warden, evidence, runtime) |
| Visual thesis | "Operations product, not a launch page"              | "Enterprise Blueprint / Operational Wireframe"    |

The implementation is a **faithful, disciplined execution of the repo's own
`DESIGN.md`**. Measured against the pasted spec it fails on nearly every visual
axis — not through sloppiness, but because it was built to a different contract.

**Nothing below should be read as an implementation defect until the contract
question is settled.** See §6.

---

## 1. What conforms (measured against the pasted spec)

| Spec § | Requirement                                             | Evidence                                                                                                                                                                                 |
| ------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12     | Section architecture 00–12                              | `src/pages/index.astro` renders Nav → Hero → Sessions → Context → Boundaries → Incident → Replay → Evidence → Cockpit → Audit → Surfaces → CTA → Footer. **Exact match, in order.**      |
| 13     | Hero headline + both CTAs                               | `Hero.astro:120-135` — "Control every agent. / Understand every decision.", `Explore CASE-1042` + `Open Fleet Cockpit`.                                                                  |
| 14     | Two-column hero grid                                    | `landing.css:308` `1fr 1fr` ≥1024px.                                                                                                                                                     |
| 15     | Case Orbit / Evidence Sphere, seven entities, SVG-first | `Hero.astro:145-200` inline SVG orbit + node ring; Canvas2D field, **no WebGL, no Three.js** — spec's stated preference order honoured.                                                  |
| 19     | Control gate stops the request                          | `Corridor.astro:6-10` — on a denial the downstream node is **not drawn**. Enforcement shown by behaviour, per spec §19/§45.3.                                                            |
| 20     | Five intervention states never collapsed                | `SectionIncident.astro:19-25` — proposed/authorized/requested/acknowledged/succeeded, each with its own note and event ID. Matches the spec's "never collapse Authorized and Succeeded". |
| 21     | Replay + HISTORICAL label + zero-side-effects proof     | `SectionReplay.astro:40-43` persistent flag "Historical / Recorded evidence. Nothing is executing."; `Hero.astro:141` surfaces `0 side effects on replay`.                               |
| 25     | Audit resolves to projector version + state hash        | `SectionAudit.astro` carries projector version and state hash.                                                                                                                           |
| 31     | Restrained text motion                                  | `landing.css:346` line-level mask reveal only ("per line, never per letter").                                                                                                            |
| 35     | Reduced motion                                          | `landing.css:1666-1694` restores all end states; `landing.ts:19` gates every rAF loop on `matchMedia`.                                                                                   |
| 36     | Accessibility                                           | Skip link, `aria-labelledby` on every section, real `<button>`s in `Corridor`, `<title>` textual equivalent on the hero SVG, `fs-visually-hidden` `<dt>` labels.                         |
| 37     | Performance                                             | Canvas skipped below 720px (`landing.ts:166`), DPR-capped (`:196`), started/stopped on visibility (`:271-277`), opacity ≤ 0.4.                                                           |
| 38     | **Product truth**                                       | `landing-data.ts` (620 lines) derives every figure from `packages/fixtures/cases/CASE-1042` at build time. Strongest conformance on the page — no fabricated evidence anywhere.          |
| 39     | No Gemini/Google branding                               | Confirmed absent.                                                                                                                                                                        |
| 44     | No bento, no glass, no blobs, no multi-accent wallpaper | Confirmed absent.                                                                                                                                                                        |

## 2. Structural divergences (spec-level, not fixable by tuning)

### 2.1 The page is dark; the spec is a white blueprint — spec §4, §5, §6, §32

`LandingLayout.astro` sets `color-scheme: dark`; `landing.css:44-46` paints
`--fs-bg #0d1014`. The spec's entire compositional logic — white canvas, light-gray
structural grid, black type, dark panels **reserved** for operational peaks — is
inverted. Consequence: the spec's §6 device ("darkness signals deeper operational
detail") cannot function, because the Warden console in `SectionIncident.astro`
sits on the same ground as everything else and reads as one more panel.

### 2.2 No pinned scroll sequences — spec §17, §20, §21, §24, §28.4

`grep -n "sticky" apps/web/src/styles/landing.css` returns **zero matches**. The
spec asks for four pinned scenes with 250–300vh parents and `position: sticky`
content (Sessions, Warden, Replay, Cockpit). The implementation uses `inView`
reveal-on-enter plus a `scroll()`-bound spine progress instead. The five
"signature moments" (§45) therefore exist as _content_ but not as _choreography_:
Session Jump does not compress on scrub, Replay does not rewind under scroll, the
Cockpit frame does not swap state from a pinned left rail.

### 2.3 Motion stack — spec §30

Spec names GSAP + ScrollTrigger. `package.json:22` has `motion@^13.1.1`; there is
no GSAP dependency. `landing.ts:1` imports `animate, inView, scroll, stagger`.
The repo `DESIGN.md` documents this as a deliberate, benchmarked choice
(bundle-budget ≤40 KB gz). Reconcilable either way, but it is a direct conflict.

### 2.4 Interaction model of the Control Gates — spec §19

Spec: one highlight box moves across Identity → Gateway → Screening **as scroll
progresses**. Implementation: three independent `Corridor` cards, each with
user-clicked outcome toggles (`Corridor.astro:31-36`). Arguably better for
evidence integrity (both outcomes are real recorded events, user-selectable), but
it is not the scroll-driven highlighter the spec specifies, and the same applies
to the Evidence row highlighter (§22).

## 3. Token-level divergences

| Spec                | Spec value                                                                                | Implementation                                                                                                    | File                                        |
| ------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| §7.2 Hero H1        | `clamp(4rem,7vw,6.5rem)` (64–104px), weight 750–800, lh 0.94, ls −0.055em                 | `clamp(44px,6.4vw,88px)`, weight **620**, lh **1.02**, ls **−0.03em**                                             | `landing.css:19,337-343`                    |
| §7.2 H2             | `clamp(3rem,5vw,4.5rem)` (48–72px), w700, lh 0.98, ls −0.045em                            | `clamp(32px,4vw,60px)`, w**600**, lh **1.06**, ls **−0.025em**                                                    | `landing.css:20,94-100`                     |
| §7.2 Section number | 40–52px numeral **stacked above** an 11–12px label                                        | single 11px inline eyebrow, `"01 · Long-running work"`                                                            | `landing.css:78-88`, all `Section*.astro`   |
| §5.1 Accent         | `--fs-blue #2448ff`, `--fs-blue-soft #eef1ff`                                             | `--fs-l-live-a #6b9ce0`, `--fs-l-live-b #8f7fe8` (violet), `--fs-l-hist #4a5f7a`                                  | `landing.css:34-36`                         |
| §9 Geometry         | `border-radius: 0` on structural containers                                               | `--fs-radius: 6px` / `--fs-radius-sm: 4px`, ~30 uses                                                              | `global.css:55-56`; `landing.css` passim    |
| §8 Grid             | `max-width: 1440px`, 12 columns, `border-left`+`border-right`+`border-bottom` on sections | `--fs-l-max: 1200px` / `1360px` wide, no 12-col system, `border-top` only                                         | `landing.css:27-28,66-71`                   |
| §10 Nav             | 64px, links `Product / Case / Cockpit / Audit`                                            | 60px, links `Product / **Replay** / Cockpit / Audit`                                                              | `LandingNav.astro:14-18`, `landing.css:216` |
| §11 Buttons         | `border-radius: 0`, filled `--fs-blue`                                                    | inherit product radius, filled `--fs-l-live-a`                                                                    | `landing.css`                               |
| §13 Hero highlight  | `every decision.` painted in `--fs-blue`                                                  | no highlight span; both lines in `--fs-text`                                                                      | `Hero.astro:120-123`                        |
| §29 Motion tokens   | `--fs-ease-out`, `--fs-ease-in-out`, `--fs-duration-fast/medium/long`                     | eases match exactly (`0.16,1,0.3,1` / `0.65,0,0.35,1`); **duration tokens absent**, durations are inline per call | `landing.css:41-42`; `landing.ts`           |
| §42 Z-index         | 9-step scale, nav at z-50                                                                 | nav z-40, rail z-15, lens layer — 3 informal levels                                                               | `landing.css:212,1760`                      |

## 4. Content divergences

- §17 Sessions visual asks for an explicit `SESSION 01 / SIMULATED DAY 12 /
SESSION 02` ladder with a compressing gap. The data exists (`evt-0015
runtime.resumed`, `simulatedDayBoundary: 12`, per `docs/design/landing-design-audit.md` §6)
  but is not rendered as the spec's compressing gap.
- §18 Memory hover card asks for `MOQ 5,000`. That value **does not exist in
  CASE-1042** — the real durable fact is `mem-001` "Agreed unit price EUR 12.40
  with 45-day payment terms". The implementation correctly uses the real value.
  The spec's own §38 ("inventing proof is not allowed") beats its §18 example
  here; the spec example is wrong, not the code.
- §26 Product Surfaces headline "One operating layer for the entire fleet." vs
  implemented "Five surfaces, one Case." (`SectionSurfaces.astro:23`).
- §23 Cockpit headline "See the entire Case. At once." — implemented as one line
  (`SectionCockpit.astro:85`); trivial.
- §25 Audit asks the evidence dots to _travel in_ from previous sections and
  align; implemented as a static aligned list.

## 5. Quality bar (§46) — status

| Criterion                                         | Status                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| One grid system across sections                   | **Partial** — consistent wrap/section rhythm, but not the spec's bordered 12-column blueprint      |
| Case Spine coherent                               | ✅ `SpineRail.astro` + `scroll()`-bound progress, fixed rail ≥1240×680                             |
| Typography large and disciplined                  | **No** — one full step below the spec at every level                                               |
| Motion explains behaviour                         | ✅ but via reveal/toggle, not scrub                                                                |
| Blue is accent not wallpaper                      | ✅ (different blue)                                                                                |
| Understandable without animation                  | ✅ verified by the reduced-motion block                                                            |
| CASE-1042 tells one coherent story                | ✅ single fixture, build-time derived                                                              |
| Zero body horizontal overflow / no console errors | Enforced by `scripts/browser-qa.ts` at 1440×900, 1280×720, 1180×800 — **not re-run in this audit** |
| Mobile retains story without heavy animation      | ✅ `landing.css:1697-1723`, canvas disabled <720px                                                 |

## 6. Decision required before any remediation

The two contracts cannot both hold. Three coherent paths:

1. **Keep the repo `DESIGN.md`.** Discard the pasted spec, or fold in only its
   non-conflicting asks (larger type scale, stacked section numerals, duration
   tokens, formal z-index scale, `every decision.` accent highlight, pinned
   scroll for the four narrative sections). ~1–2 days. Preserves the audited
   product-truth work and the ≤40 KB JS budget.
2. **Adopt the pasted spec.** This is a re-skin, not a patch: light ground,
   new accent, radius 0, 12-column bordered grid, GSAP + ScrollTrigger, four
   pinned scenes. `landing.css` (1868 lines) is largely rewritten and
   `landing.ts` (845 lines) is ported off `motion`. The dark product routes then
   sit behind a light landing page — a deliberate seam that needs its own
   decision. ~1–2 weeks, and the JS budget in `docs/design/landing-design-audit.md` §7
   no longer holds (GSAP + ScrollTrigger ≈ 45–60 KB gz).
3. **Merge into one contract.** Rewrite the root `DESIGN.md` so `[L]` rules state
   the landing's ground explicitly, then re-audit against that single file.

## Unresolved questions

1. Which `DESIGN.md` is authoritative — the root file or the pasted document?
2. Is the light/white ground a firm requirement, given the product console is dark
   and the landing links straight into it?
3. Is GSAP + ScrollTrigger a requirement, or was it a recommendation the `motion`
   benchmark already satisfies?
4. Is the ≤40 KB gzipped JS budget on `/` still binding?
