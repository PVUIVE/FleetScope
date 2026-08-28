# FleetScope — Landing Page Design System

> Design contract for the FleetScope public landing experience.
>
> Implementation follows this file. When the two disagree, this file is wrong
> and gets fixed first.
>
> **Scope.** This contract governs the public landing route `/` only — every
> selector under `.fs-l`. The Agent Viewer (`/sessions`, `/sessions/:id`) and the
> deferred enterprise surfaces keep the dark control-room language defined in
> `apps/web/src/styles/global.css` and `viewer.css`. The landing page is the one
> light surface.

---

# 1. Product Design Thesis

FleetScope is a **local Agent Viewer for Gemini and Google ADK**.

The landing page must communicate one idea immediately:

> **See what your agents are doing.**

Supporting line:

> FleetScope turns local Gemini/ADK sessions into a live execution graph —
> agents, tools, handoffs, errors, and timeline included.

The visitor is one developer with an agent that is behaving oddly and a terminal
full of log lines. The page has to make them recognise their own problem in the
first screen, and believe the answer is real by the second.

**Credibility is the whole design problem.** Anyone can mock up a pretty graph.
So every figure, name, duration and error class on this page is read at BUILD
time out of a real recorded Google ADK run (§30). Nothing on the page is typed by
hand, and the page says so at the bottom.

## What the page must NOT be

- an enterprise governance pitch;
- a policy, approval or compliance story;
- a fleet dashboard;
- a wall of feature cards.

Those belong to the direction documented in `docs/archive/README.md`. Above the
fold they are actively harmful: they answer a question this visitor is not asking.

---

# 2. Design Inspiration

Technical-blueprint precision, in the Sup_Contract register: white ground, 1px
rules, sharp geometry, large grotesque type, one electric blue, and motion that
only ever reports a state change.

Reference points, and what is taken from each:

| Source                 | Taken                                           |
| ---------------------- | ----------------------------------------------- |
| Engineering blueprints | 1px rules, numbered sections, measured captions |
| Terminal UIs           | monospace for anything the machine produced     |
| Sup_Contract           | pinned scroll sequences, restrained type motion |
| Instrument panels      | status as glyph + word, never colour alone      |

Explicitly rejected: gradients, glows, glass, drop shadows on flat elements,
rounded "friendly" corners, stock illustration, and any animation that exists to
be noticed.

---

# 3. Core Visual Motif — The Execution Spine

The Execution Spine is the primary visual motif of FleetScope.

It replaces the earlier **Case Spine**, which drew a governed Case resolving from
seven enterprise systems. That motif was correct for the enterprise product and
is wrong for this one: it puts governance where the developer expects execution.
The rename is not cosmetic — the shape it draws is different.

A run is one vertical line. Every node on it is a real event:

```
Session started
│
Agent
│
Model
│
Tool
│
Handoff
│
Tool
│
Error
│
Result
```

Rules:

- **The spine is vertical and 1px.** It runs down the kind column, drawn by the
  rows themselves rather than by an element per node.
- **Time reads downward.** Offsets from the session start sit in the left gutter,
  monospace, tabular numerals.
- **Kind is a word.** `MODEL`, `TOOL`, `HANDOFF`, `ERROR` — never an icon alone
  and never a colour alone.
- **A failure tints its row** (`--fs-danger-soft`) and turns its kind and label
  `--fs-danger`. It is the only row on the page allowed a fill.
- **Blue marks the machine's decisions** — model calls and handoffs. Everything
  else is black on white.

The motif appears three times, at three densities: full in the hero, compact in
§14 (Section 02), and as a live preview in §16 (Section 04). It is the same component
(`.fs-d-spine`), not three drawings of the same idea.

---

# 4. Overall Visual Style

## 4.1 Style

FleetScope uses a:

> **Enterprise Blueprint / Operational Wireframe**

visual style.

Characteristics:

- white primary canvas;
- light-gray structural grid;
- black typography;
- electric blue operational accent;
- sharp corners;
- no unnecessary shadows;
- almost no glassmorphism;
- minimal gradients;
- technical diagrams integrated into layout;
- grid borders connecting sections vertically;
- product UI treated like engineered systems.

The result should feel somewhere between:

- enterprise infrastructure;
- systems architecture;
- operating console;
- premium technical editorial design.

Avoid:

- purple AI SaaS;
- gradient blobs;
- neon cyberpunk;
- crypto dashboards;
- excessive cards;
- rounded-everything UI;
- floating glass panels;
- glowing AI brain imagery.

---

# 5. Color System

## 5.1 Core

```css
:root {
  --fs-bg: #ffffff;
  --fs-bg-subtle: #fafafa;
  --fs-bg-muted: #f6f7f8;

  --fs-fg: #090909;
  --fs-fg-secondary: #44464c;
  --fs-fg-muted: #858991;

  --fs-border: #e5e7eb;
  --fs-border-strong: #111111;

  --fs-blue: #2448ff;
  --fs-blue-hover: #1738e8;
  --fs-blue-soft: #eef1ff;

  --fs-black: #090909;
  --fs-white: #ffffff;
}
```

---

## 5.2 Operational States

```css
:root {
  --fs-success: #168653;
  --fs-success-soft: #edf8f2;

  --fs-warning: #b76b08;
  --fs-warning-soft: #fff8e8;

  --fs-danger: #d13636;
  --fs-danger-soft: #fff0f0;

  --fs-historical: #4f67a5;
  --fs-historical-soft: #eef2fa;

  --fs-live: #2448ff;
}
```

Meaning must never rely on color alone.

Always combine:

```text
icon
+
text
+
state label
+
color
```

---

# 6. Dark Operational Surface

Most of the landing stays light.

Dark surfaces are reserved for important operational moments.

Primary dark surface:

```css
--fs-terminal-bg: #0c0d12;
--fs-terminal-surface: #12141b;
--fs-terminal-border: #262933;
--fs-terminal-text: #9da3b5;
--fs-terminal-text-active: #ffffff;
--fs-terminal-blue: #4965ff;
```

Use dark panels for:

- the terminal column in §14;
- the two commands under the hero CTAs;
- anything the machine printed rather than the page wrote.

Do not turn the whole landing page dark.

Darkness should signal:

> deeper operational detail.

---

# 7. Typography

## 7.1 Primary Typeface

Use an existing licensed grotesque sans already available in the repository when possible.

Preferred visual character:

- Geist;
- Inter;
- Suisse-like grotesque;
- clean neutral neo-grotesque.

Do not introduce a new font dependency unless necessary.

---

## 7.2 Type Scale

### Hero H1

```css
font-size: clamp(4rem, 7vw, 6.5rem);
font-weight: 750-800;
line-height: 0.94;
letter-spacing: -0.055em;
```

Example:

```text
Control every agent.
Understand every decision.
```

Selected phrase may use FleetScope blue.

---

### Section H2

```css
font-size: clamp(3rem, 5vw, 4.5rem);
font-weight: 700;
line-height: 0.98;
letter-spacing: -0.045em;
```

---

### Section Number

Example:

```text
03
CONTROL BOUNDARIES
```

Number:

```css
font-size: 40-52px;
font-weight: 600;
```

Label:

```css
font-size: 11-12px;
font-weight: 600;
letter-spacing: 0.08em;
text-transform: uppercase;
```

---

### Body Large

```css
font-size: 18-21px;
line-height: 1.45;
```

---

### Operational Labels

```css
font-size: 11-13px;
font-weight: 550;
letter-spacing: 0.04em;
```

Use uppercase selectively.

---

## 7.3 Monospace

Use monospace only for:

- Event IDs;
- hashes;
- versions;
- policy IDs;
- case sequences;
- code-like evidence.

Do not make the entire website monospace.

---

# 8. Grid System

FleetScope should visually feel constructed on one continuous blueprint.

## Desktop

Maximum content width:

```css
max-width: 1440px;
```

Main content grid:

```text
12 columns
```

Typical outer gutters:

```text
24–32px
```

All major sections sit inside structural boundaries.

Example:

```text
┌────────────────────────────────────────────┐
│                                            │
│                 SECTION                    │
│                                            │
├────────────────────────────────────────────┤
│                 SECTION                    │
│                                            │
└────────────────────────────────────────────┘
```

Use:

```css
border-left: 1px solid var(--fs-border);
border-right: 1px solid var(--fs-border);
border-bottom: 1px solid var(--fs-border);
```

Internal columns should generally share borders rather than each cell drawing all four independently.

---

# 9. Structural Geometry

## Default

```css
border-radius: 0;
```

Primary structural containers should be rectangular.

Rounded corners may be used only inside:

- product screenshot frames;
- selected device/browser preview;
- small status pills.

Avoid rounded cards as the dominant design language.

---

# 10. Navigation

Navigation:

```text
FleetScope

How it works
Failures
Replay
Setup

Open Agent Viewer
```

Desktop height:

```text
64px
```

Initial state:

- white or transparent over white hero;
- minimal boundary.

Scrolled state:

```css
background: rgba(255, 255, 255, 0.96);
border-bottom: 1px solid var(--fs-border);
```

Use:

```css
position: sticky;
top: 0;
z-index: 50;
```

Primary CTA:

```text
Open Agent Viewer →
```

Filled blue.

No oversized SaaS mega-navigation.

---

# 11. Buttons

## Primary

```css
background: var(--fs-blue);
color: white;
border: 1px solid var(--fs-blue);
border-radius: 0;
```

Hover:

- slight brightness shift;
- max 1–2px directional movement;
- optional subtle magnetic pointer response.

Press:

```css
transform: scale(0.985);
```

---

## Secondary

```css
background: white;
color: var(--fs-fg);
border: 1px solid var(--fs-border-strong);
```

No gradient button.

---

# 12. Landing Page Architecture

Six sections. Not eight, not twelve.

```
01  Hero                    See what your agents are doing
02  From logs to graph      Your agent is more than a log stream
03  Execution events        Every model call. Every tool. Every handoff.
04  Catch failures fast     See exactly where the run broke
05  Historical inspection   Replay the run without rerunning it
06  Final CTA               Debug your next agent visually
```

Each earns its place by answering one question in order: _what is this_, _why do
I need it_, _what does it capture_, _what is it like when things break_, _can I
go back_, _how do I start_. A seventh section would be a section that answers a
question nobody asked.

**Every section is numbered.** The numeral is display-sized and sits above a
monospace label above the headline (§7.2). That numbering is what makes the page
read as one blueprint rather than a stack of marketing blocks.

---

# 13. Section 01 — Hero

## Headline

```
See what your
agents are doing.
```

Two lines. `agents` is the one blue word above the fold. Each line is a
`.fs-l-reveal` masked span so it rises into place once, on load (§23).

## Sub

```
FleetScope turns local Gemini/ADK sessions into a live execution graph —
agents, tools, handoffs, errors, and timeline included.
```

## CTAs

```
[ Open Agent Viewer → ]   [ Setup in two commands ]
```

Primary is blue and goes to `/sessions`. Secondary is a 1px ghost and goes to
`/docs`. No third CTA.

## The two commands

Directly under the CTAs, on the dark operational surface (§6):

```
$ fleetscope watch
$ python examples/vendor_agent.py
```

This is a deliberate risk taken on purpose: showing a command line in the hero
tells a developer in one glance that this is a local tool they run, not a service
they sign up for.

## Right column

The Execution Spine at full density: time, kind, label, agent — seven rows from
the recorded run. It draws itself top-down on load, one row at a time, in the
order the events happened (§20.1).

## Strip

A 1px-ruled row under the hero carrying only measured facts: session name,
framework and version, event count, agent count, tool-call count, failure count,
duration. Every number is read from the recording.

---

# 14. Section 02 — From logs to graph

## Headline

```
Your agent is more than a log stream.
```

## Layout

Three columns: terminal, connector, structured.

```
┌───────────────────┐        ┌─────────────────────────┐
│ TERMINAL          │  ───►  │ AGENT VIEWER            │
│ runtime.started   │        │ SESSION  Session started│
│ agent.spawned     │        │ MODEL    gemini-…       │
│ model.requested   │        │ TOOL     vendor_lookup  │
│ tool.requested    │        │ HANDOFF  main → logistics│
│ tool.failed       │        │ ERROR    inventory_lookup│
└───────────────────┘        └─────────────────────────┘
```

Left is the dark operational surface, monospace, `--fs-terminal-text`. Right is
the compact Execution Spine on white.

**Both columns are the same events.** The left column is the distinct canonical
type names the recording actually contains; it is not a fabricated log.

## Motion — the page's primary story

Scrubbed against the section crossing the viewport (§20.4):

1. the terminal column fades back to 32% opacity, line by line;
2. the connector rule draws left to right;
3. the structured rows resolve in, staggered.

Nothing new appears — the animation reveals content that was already rendered, so
the section is complete and readable with motion off.

---

# 15. Section 03 — Execution events

## Headline

```
Every model call. Every tool. Every handoff.
```

## Lede

Names the mechanism, because the mechanism is the credibility:

> FleetScope captures Google ADK's own callbacks — not terminal output — so every
> model request, tool invocation, delegation and failure is a first-class event
> with an agent, a timestamp and a duration.

## Layout

Four blueprint cells in one 1px-bordered row, divided by 1px rules:

```
MODEL              TOOL               HANDOFF            ERROR
gemini-3.5-flash   vendor_lookup      main → logistics   inventory_lookup
2.06 sec           290 ms             sub-agent          timeout
```

Each cell is rendered from **one real event** of the recording. A cell whose
event the recording does not contain is not rendered at all — the row is
`auto-fit`, so three cells fill the width correctly.

The ERROR cell is filled `--fs-danger-soft` with `--fs-danger` text. It is the
only filled cell.

## Motion

Entrance only: each cell rises 18px on first sight, staggered. No loop.

---

# 16. Section 04 — Catch failures fast

## Headline

```
See exactly where the run broke.
```

## Layout — pinned

Left: four steps. Right: a persistent Agent Viewer preview.

```
01  AGENT      logistics
02  TOOL       inventory_lookup
03  FAILURE    timeout
04  CONTEXT    5 surrounding events
```

The steps are the questions a developer asks, in the order they ask them. Each
value is read from the recorded failure.

The preview is the Execution Spine showing the failure **in context**: two rows
before, the failure, two rows after. The failing row is tinted and carries a 2px
`--fs-danger` inset marker on its leading edge.

## Motion

`ScrollTrigger` pins the scene and steps `aria-current` discretely against scroll
progress — `Math.floor(progress * count)`, never a fraction of a step. Inactive
steps sit at 40% opacity.

Desktop only (≥1024px). Below that the pin is not created and all four steps
render at full opacity.

---

# 17. Section 05 — Historical inspection

## Headline

```
Replay the run without rerunning it.
```

## Layout

Left: the recorded positions as a 1px-ruled list of buttons. Right: a state
panel.

```
01  gemini-3.5-flash          ┌──────────────────────────┐
02  vendor_lookup             │ HISTORICAL               │
03  main → logistics          │ Recorded session state.  │
04  inventory_lookup          │ Nothing is executing.    │
05  Session completed         │                          │
                              │ Event      15            │
                              │ Agent      logistics     │
                              │ Executing  nothing       │
                              └──────────────────────────┘
```

## The rule this section exists to state

Selecting an earlier mark reports the state **at that recorded position** and says,
in as many words, that nothing is executing. That is the product's actual
behaviour (`docs/architecture.md` §5), not a claim invented for the page.

- At the last mark: `LIVE`, `--fs-live`.
- At any earlier mark: `HISTORICAL`, `--fs-historical`, panel filled
  `--fs-historical-soft`.

Historical must never look live. No pulse, no marching ants, no motion of any
kind in that state.

## Motion

Click only. This section is interactive rather than scrubbed, because the claim
is about a control the visitor can operate.

---

# 18. Section 06 — Final CTA

## Headline

```
Debug your next agent visually.
```

Centred, one masked reveal.

## CTAs

```
[ Open FleetScope → ]   [ Read the setup ]
```

## Provenance line

Below the CTAs, `--fs-fg-muted`, 12px, centred, max 62ch:

> A real Google ADK 1.20.0 run against Gemini, captured by
> `examples/fleetscope_adk`. The business tools are local fixtures; the agent
> execution is not.

**This line is required.** It is the page's single most credible sentence: it
tells the reader precisely which part of what they just saw was real, and it is
read from the recording's own metadata rather than written here.

---

# 19. Footer

Three columns: wordmark and one line, product links, the recorded session id in
monospace.

The enterprise surfaces are linked from the footer, and only from the footer,
labelled _Enterprise preview_. They are a future direction; the footer is where a
future direction belongs.

---

# 20. Motion System

FleetScope motion has exactly four semantic families.

---

## 20.1 Flow

Used for:

```text
Agent → Identity → ERP
Agent → Gateway → Agent
External Input → Screening
```

Recommended behavior:

- SVG path progress;
- small moving evidence token;
- 400–700ms;
- ease-out-expo.

---

## 20.2 State

Used for:

```text
Running → Waiting

Allowed → Denied

Live → Historical

Proposed → Authorized → Requested
```

Behavior:

- color;
- border emphasis;
- small position changes;
- opacity.

Duration:

```text
250–400ms
```

---

## 20.3 Evidence

Used when canonical evidence appears.

Example:

```text
event captured
    ↓
a row appears
    ↓
joins the Execution Spine
```

Do not make every dot pulse forever.

---

## 20.4 Scroll Storytelling

Used for:

- §14 logs → graph;
- §16 the pinned failure sequence.

Nowhere else. Two scrubbed scenes is the budget for a six-section page.

Scrub should feel deterministic and precise.

Avoid overly elastic physics.

---

# 21. Motion Tokens

```css
:root {
  --fs-ease-out: cubic-bezier(0.16, 1, 0.3, 1);

  --fs-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);

  --fs-duration-fast: 250ms;
  --fs-duration-medium: 500ms;
  --fs-duration-long: 800ms;
}
```

---

# 22. Scroll Architecture

Preferred implementation in FleetScope:

```text
Astro
+
GSAP
+
ScrollTrigger
```

Do not migrate to React/Next.js.

Use GSAP for:

- pinned sections;
- scrubbed timelines;
- Execution Spine progression;
- active-step state.

Use plain CSS for:

- hover;
- buttons;
- simple transitions;
- static grid.

Optional smooth scrolling may be added only if native scrolling produces visible jitter.

Do not make Lenis mandatory without benchmarking.

---

# 23. Text Motion

Text animation must remain restrained.

Do:

- simple mask reveal on Hero;
- section keyword color transitions;
- small terminal typing/highlight;
- selective number counting.

Do not:

- animate every word;
- split every headline;
- wave every letter;
- repeatedly fade body text.

Content should remain readable even with animations disabled.

---

# 24. Background

Primary:

```text
WHITE
```

No global gradient.

No permanent noise layer unless extremely subtle.

Blue should derive visual strength from contrast, not glow.

A subtle grid extension may appear outside the main content container on large screens.

---

# 25. Hover Language

Interactions should feel engineered.

Navigation:

```text
background: rgba(0,0,0,.035)
```

Grid cell:

```text
border-color:
var(--fs-border-strong)
```

Evidence row:

- highlighter moves;
- detail becomes visible.

Buttons:

- small directional shift;
- no excessive glow.

---

# 26. Responsive

## Desktop

```text
> 1024px
```

Full 12-column system.

Pinned sequences enabled.

---

## Tablet

```text
768px–1024px
```

Reduce hero visual scale.

Three-column sequences may become two-column.

Pinned sequences remain only if readable.

---

## Mobile

```text
< 768px
```

Stack all major content.

Disable:

- complex cursor effects;
- aggressive scrub;
- WebGL-heavy background;
- fixed multi-column pinned scenes.

Instead display sequences as vertical states:

```text
STEP 01
↓
STEP 02
↓
STEP 03
```

Hero Case Network becomes a simplified static/SVG version.

---

# 27. Reduced Motion

Mandatory.

When:

```css
@media (prefers-reduced-motion: reduce);
```

Disable:

- automatic hero rotation;
- parallax;
- scroll scrub;
- particle travel;
- continuous animation.

Show final states immediately.

The entire content narrative must remain understandable.

No `requestAnimationFrame` loop may run and no ScrollTrigger pin may be created.
A media query alone does not stop a script — the script must check.

---

# 28. Accessibility

Required:

- semantic HTML;
- real buttons;
- real links;
- keyboard navigation;
- visible focus;
- WCAG-friendly contrast;
- state not represented only by color;
- no interaction available only on hover;
- canvas visuals have textual equivalents;
- pinned scenes do not trap keyboard scrolling.

---

# 29. Performance Rules

Hero WebGL/canvas is the primary performance risk.

Rules:

- lazy initialize;
- stop rendering when hero leaves viewport;
- cap DPR;
- reduce particle count on weaker devices;
- no individual DOM node per particle;
- no permanent requestAnimationFrame loops below fold.

Pinned sections:

- animate transform and opacity;
- avoid layout-triggering properties;
- use `will-change` only on actively animated elements.

Grid:

- CSS borders;
- no hundreds of decorative divs.

---

# 30. Product Truth

Landing visuals must never invent evidence.

If the page shows:

```text
inventory_lookup   timeout   480 ms
```

there must be a recorded event that says exactly that.

Same for every agent name, model name, tool name, duration, token count, event
count and error class on the page.

Technical values come from a real recorded Google ADK run, derived at BUILD time
from `packages/fixtures/sessions/vendor-onboarding` through
`apps/web/src/lib/landing-session.ts`. No figure on this page is typed by hand,
and `apps/web/tests/landing.test.ts` fails the build if one ever is.

When the recording does not contain something the page wants to say, the page
does not say it: the field is `null` and the component renders nothing.

Simplifying visuals is allowed.

Inventing proof is not.

---

# 31. Technology Branding

Do not make Gemini/Google a major visual element.

FleetScope is the brand.

Technology may appear only as small credibility information near the bottom/footer.

No:

```text
BUILT WITH GEMINI
```

hero.

No Google-colored design system.

No technology-first narrative.

---

# 32. Core UI Primitives

Create/reuse only a small number of primitives.

```text
BlueprintGrid
BlueprintCell

SectionHeader
SectionEyebrow

ExecutionSpine
SpineRow

SectionHeader
EventCell

ViewerPreview
TerminalBlock

ReplayMark
ReplayState

PrimaryButton
SecondaryButton
```

Avoid a generic 50-component landing design system.

`StatusLabel` resolves its word and glyph through `apps/web/src/lib/status.ts`,
which is the single status vocabulary for the whole product. The landing page
restyles that vocabulary; it never redefines it.

---

# 33. Section Rhythm

Six sections cannot all be loud. The page has one peak and one close:

```text
01  HERO
    large narrative + the two commands

↓

02  LOGS → GRAPH
    the argument, scrubbed

↓

03  EVENTS
    structured / calm

↓

04  FAILURE
    pinned operational peak

↓

05  REPLAY
    interactive, quiet

↓

06  CTA
    minimal closure
```

§04 is the only pinned scene. §05 is the only interactive one. Everything else
rises once and then holds still.

Do not make every section equally visually loud.

---

# 34. Z-Index System

```text
z-0
base canvas

z-5
hero visualization

z-10
Execution Spine overlays

z-20
scroll highlight

z-30
sticky operational panels

z-40
drawers / preview overlays

z-50
navigation
```

Avoid arbitrary `z-index: 9999`.

---

# 35. Design Do

Do:

- let grid lines align between sections;
- use blue sparingly;
- use product state as animation;
- use one strong focal visual per section;
- maintain large whitespace;
- let diagrams draw themselves;
- use actual FleetScope evidence;
- create continuity through the Execution Spine;
- preserve crisp sharp geometry.

---

# 36. Design Don't

Do not:

- create generic bento sections;
- use 20 rounded cards;
- add random gradient blobs;
- use multiple competing accent colors;
- use floating glass panels;
- add particles without semantic purpose;
- animate all text;
- use excessive WebGL;
- copy Sup_Contract wallet visuals;
- build a Gemini marketing page;
- turn FleetScope into a cyberpunk dashboard.

---

# 37. Signature FleetScope Moments

The final page must contain at least these five memorable moments.

## 1. The Spine draws itself

On load, the hero's run appears one row at a time, in the order the events
happened — the shape of the product in three seconds.

---

## 2. Logs become a graph

The terminal column fades back and the same events resolve into structure. One
scroll, and the visitor has understood the entire value proposition.

---

## 3. The failure in context

A tinted row with two events before it and two after. Not "we detect errors" —
_here is the error, here is what surrounded it_.

---

## 4. Historical

Selecting an earlier position and having the panel say, plainly:

```text
HISTORICAL

Recorded session state.
Nothing is executing.
```

---

## 5. The provenance line

The last sentence on the page names exactly which part of what you just saw was
real. Almost nothing else on the internet does this.

These moments should define FleetScope's identity.

---

# 38. Quality Bar

The landing page is visually complete only when:

- every section feels like part of one grid system;
- the Execution Spine remains visually coherent;
- typography is consistently large and disciplined;
- motion explains FleetScope behavior;
- blue remains an accent rather than wallpaper;
- no section looks like an unrelated component pasted from a library;
- FleetScope remains understandable without animation;
- the recorded run tells one coherent story;
- desktop experience is excellent at 1440×900 and 1280×720;
- mobile retains the story without heavy animation;
- reduced motion retains all information;
- there is zero body-level horizontal overflow;
- there are no persistent console errors;
- scroll motion remains smooth;
- hero visualization does not hurt interaction performance;
- all operational claims remain grounded in actual FleetScope evidence.

---

# 39. Final Design Statement

FleetScope should not look like an AI startup trying to appear futuristic.

It should look like:

> **an instrument a working engineer would keep open next to their terminal.**

The landing page achieves this through:

```text
strict geometry
+
large typography
+
high contrast
+
one electric accent
+
real operational evidence
+
precise scroll choreography
+
the Execution Spine
```

The visual experience starts with an unreadable log stream and ends with one run
a developer can see, click and rewind.

That transformation is the FleetScope brand story.
