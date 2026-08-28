# Landing page — design audit

Date: 2026-08-27 · Scope: the public landing route for FleetScope.

## 1. What exists today

| Area | State |
| --- | --- |
| `/` | No landing page. `astro.config.mjs` redirects `/` → `/cases`. |
| Stack | Astro 5, `output: 'static'`, no UI framework island, **zero client-side runtime dependencies** in `apps/web`. |
| Styles | One authored stylesheet, `src/styles/global.css` (1552 lines), token-driven, hand-written, no Tailwind. |
| Shell | `BaseLayout.astro` → `Nav.astro` (48px sticky bar) + `.fs-main` + footer. |
| Product routes | `/cases`, `/cases/[caseId]`, `/catalog`, `/approvals`, `/cockpit/[caseId]` (Rust/WASM Zoetrope renderer), `/audit/[caseId]`. |
| Data | Real recorded evidence in `packages/fixtures/cases/CASE-1042` — 60 Canonical Events, evidence manifest, expected-state with prefix state hashes. |
| QA | `scripts/browser-qa.ts` drives Playwright at 1440×900 / 1280×720 / 1180×800 and fails on console errors + body horizontal overflow. |

## 2. The existing visual language is good and must be extended, not replaced

`global.css` opens with an explicit thesis: *"Enterprise control room, not sci-fi command centre. Dense but calm… no gradients, no glows, and no motion that is not reporting a state change."* Status is never carried by colour alone — every `StatusBadge` renders glyph + word + tone.

This is a **disciplined** codebase by the assessment rubric. The landing page therefore:

- reuses `--fs-*` tokens verbatim (surfaces, borders, status hues, mono stack);
- adds a **narrow, additive** layer of landing-only tokens (display type scale, spine geometry, motion timings) rather than a second palette;
- keeps the product routes untouched.

The one deliberate deviation: the product UI bans decorative motion. A landing page's job is different — motion there *is* the explanation. DESIGN.md scopes every animation to `.fs-l` (landing) selectors so the product's calm is never contaminated.

## 3. Inconsistencies / gaps found

1. **No `/` route at all** — a visitor who types the domain lands inside an operator console with no product explanation.
2. `fs-nav` is a 48px operator bar; it is correct for the console and wrong over a 100vh cinematic hero. The landing needs its own nav that resolves *into* the product nav on navigation.
3. `global.css` has no display type scale — largest heading is `.fs-title` at ~20px. A landing hero needs 72–96px.
4. `prefers-reduced-motion` is already handled globally by clamping durations to 0.01ms. That kills CSS/WAAPI motion but **not** `requestAnimationFrame` loops — the landing's canvas and scroll islands must check the media query themselves.
5. The brief's example figures (`Acme Components`, `MOQ = 5,000`) do **not** match the recorded fixture. Real values are used instead (see §6).

## 4. Reusable primitives

`.fs-status` / `StatusBadge`, `.fs-mono`, `.fs-digest` / `CopyableDigest`, `.fs-kv`, `.fs-card`, `.fs-button`, `.fs-lifecycle` (intervention states), `.fs-metric`, `lib/status.ts` (the single status vocabulary), `lib/fixtures.ts` (`projectCase(caseId, throughCaseSequence)` — exactly the primitive the Replay section needs), `lib/evidence-view.ts`.

## 5. Proposed direction

**The Case Spine.** One 2px vertical rule with event nodes on it, running the length of the page, changing role per section: hero network → session timeline → control gates → recovery chain → replay scrubber → permanent audit trail. Every section is a state of the same object. That is the anti-generic device: no section can be lifted out and pasted elsewhere because each one only makes sense as a transformation of the previous.

Palette: the product's `--fs-bg #0d1014` ground, product status hues unchanged, plus **one** landing accent ramp — a cool spectral blue→violet used only for *live/agent activity*, so the accent literally means "an agent is doing something" and cooling to desaturated blue means "historical".

## 6. Real product data used (no fabricated proof)

Derived at build time from `packages/fixtures/cases/CASE-1042`:

- 60 Canonical Events, `caseSequence` 0–59, 3 Runtime Sessions (`sess-001/2/3`).
- Vendor is **Northwind Components GmbH**; the tenant is `acme-procurement`. The brief's "Acme Components" is the *tenant*, not the vendor.
- Durable memory fact `mem-001`: *"Agreed unit price EUR 12.40 with 45-day payment terms"* — written `evt-0011` (sess-001), recalled `evt-0020` (sess-002). The brief's "MOQ = 5,000" does not exist in the record and is not shown.
- Session gap: `evt-0015 runtime.resumed` carries `simulatedDayBoundary: 12` — the "Day 12" claim is real.
- Controls: `identity.allowed evt-0008`, `identity.denied evt-0051`, `gateway.routed evt-0022`, `gateway.denied evt-0049`, `armor.blocked evt-0016` (`prompt_injection`, channel `vendor_email`), `armor.allowed evt-0019`, `memory.rejected evt-0018`.
- Incidents `inc-001 context_drift` (advisory) and `inc-002 repeated_tool_failure` (critical, threshold 3, after `evt-0025/0027/0029`).
- Intervention `itv-001 retry_idempotent_read`: proposed `evt-0032` → authorized `evt-0033` (source `policy`) → requested `evt-0034` → acknowledged `evt-0035` → succeeded `evt-0037`.
- Terminal state hash `cb99db39…735a`, projector version `1.0.0`, 18 recorded prefix hashes.

## 7. Performance constraints

The landing must not regress the demo. Budget: **≤ 40 KB gzipped JS** on `/`, no WASM, no font downloads (system stack), all scene work paused when offscreen, `rAF` loops off entirely under reduced motion.

## 8. Animation strategy chosen

`motion` (npm, **MIT**) for `animate`/`scroll`/`inView`/`stagger`/`hover` — hardware-accelerated transforms and spring physics with a documented reduced-motion story, ~18 KB gzipped for the subset used, loaded from **one** island. Everything else is CSS + inline SVG + a single `<canvas>` 2D particle field in the hero.

> **Superseded 2026-08-28.** `DESIGN.md` was replaced with the Enterprise
> Blueprint contract, which specifies GSAP + ScrollTrigger and four pinned
> scroll scenes (§30, §17/20/21/24). The landing page now ships `gsap` instead
> of `motion`, and the ≤ 40 KB JS budget in §7 above no longer holds. The rest
> of this document — the reusable primitives, the recorded CASE-1042 figures in
> §6, and the reference audit in §9 — is unchanged and still applies.

## 9. References — used vs rejected

| Reference | Taken | Not taken |
| --- | --- | --- |
| **Motion.dev** | The library itself (MIT) + its motion vocabulary: scroll-linked progress, spring config, gesture callbacks. | Nothing; it is a dependency, not a copy. |
| **21st.dev** | Composition patterns only — cinematic hero density, orbital/timeline layout, container-scroll reveal. | No component code. Registry is shadcn/React; this app has no React and will not gain it for a landing page. Per-component licences are not stated on the site. |
| **OriginKit** | Interaction *principles* — proximity orbit, mask text reveal, scroll text highlight, magnetic button, reactive lines. Each independently re-implemented in ~15 lines of CSS/JS. | No code. Site returned HTTP 403 to inspection, the kit is beta, and licence terms were not verifiable. Unverifiable licence ⇒ recreate. |
| **Beautiful UI** | Product-fragment vocabulary — approval card, tool chip, task row, context card, evidence table. Mapped onto the existing `.fs-*` components. | No visuals, no code. |
| **Refero Styles** | Its role as a design-system reference: forced the DESIGN.md contract below. | No styles. |
| **Lottielab** | Considered for status-transition micro-motion. | **Rejected entirely.** Templates are proprietary, and every micro-motion needed here (gate open, state flip, pulse) is 6 lines of CSS. Adding a ~40 KB Lottie player to avoid 6 lines of CSS is a bad trade. Zero Lottie assets ship. |
| **PixiJS** | Benchmarked as the hero-field candidate. | **Rejected on measurement** — see `docs/reports/fleetscope-landing-page-implementation.md` §G. Canvas2D holds 60fps for the particle count this scene needs at 0 KB; Pixi's WebGL bundle is ~150 KB gz for no visible gain. |
| **Framer LiquidFluid** | The *idea* only: cursor-reactive luminous field, transparent ground, slow dissipation, meaning "unstructured agent activity". | The component is a paid proprietary Framer marketplace item. Not downloaded, not inspected for code, not reproduced pixel-wise. The hero field is an independently written Canvas2D drift-and-attract field. |
| **getdesign.md** | Its central warning — that AI-built pages read as a pile of trendy components. Answered with the single Case Spine motif and one motion language. | n/a |

## 10. Deliberate non-goals

No Gemini/Google-branded section. No sponsor logo wall. No React. No bento grid. No glassmorphism. No stock imagery. No fabricated metric.
