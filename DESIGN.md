# FleetScope — Landing Page Design System

> Design contract for the FleetScope public landing experience.
>
> Implementation follows this file. When the two disagree, this file is wrong
> and gets fixed first.
>
> **Scope.** This contract governs the public landing route `/` only — every
> selector under `.fs-l`. The operator product (`/cases`, `/catalog`,
> `/approvals`, `/cockpit`, `/audit`) keeps its own dark control-room language
> and is out of scope here. The landing page is the one light surface.

---

# 1. Product Design Thesis

FleetScope is the control plane for long-running enterprise AI-agent operations.

The landing page must communicate one idea immediately:

> **Control every agent. Understand every decision.**

FleetScope is not:

- a chatbot;
- an AI assistant landing page;
- an observability dashboard;
- a generic workflow tool;
- a graph visualizer;
- a Gemini marketing page.

FleetScope turns distributed agent activity into one governed, inspectable, replayable business **Case**.

The landing page must visually communicate:

```text
Agent activity
    ↓
Business Case
    ↓
Persistent context
    ↓
Governance boundaries
    ↓
Incident detection
    ↓
Policy
    ↓
Intervention
    ↓
Historical replay
    ↓
Audit evidence
```

The product should feel:

- precise;
- enterprise;
- technical;
- controlled;
- intelligent;
- evidence-driven;
- alive without feeling chaotic.

---

# 2. Design Inspiration

FleetScope inherits the strongest visual principles from the Sup_Contract reference:

- strict grid-based composition;
- 1px structural borders;
- sharp corners;
- generous whitespace;
- high-contrast black-on-white typography;
- one strong electric accent color;
- very large grotesque headlines;
- minimal decorative gradients;
- strong section numbering;
- scroll-driven visual storytelling;
- sticky/pinned product sequences;
- diagrams that animate themselves;
- restrained text animation;
- one signature WebGL/interactive hero visual.

FleetScope must **not** visually copy Sup_Contract.

Its own visual language is based on:

> **The Case Spine**

A single evidence path that evolves throughout the page.

---

# 3. Core Visual Motif — The Case Spine

The Case Spine is the primary visual motif of FleetScope.

Conceptually:

```text
● Case Created
│
● Agent Started
│
● Memory
│
● Waiting
│
● Resume
│
● Identity
│
● Gateway
│
● Screening
│
● Incident
│
● Policy
│
● Intervention
│
● Runtime Result
│
● Audit
```

The same line changes meaning depending on the section.

### Hero

The Case Spine appears as a network of fragmented agent activity converging into:

```text
CASE-1042
```

### Long-running workflow

The spine becomes an event timeline spanning multiple Runtime Sessions.

### Memory

Facts travel across the spine from Session 1 to Session 2.

### Governance

The spine physically crosses:

- Identity;
- Gateway;
- Screening.

### Incident

The spine changes state after repeated failure.

### Warden

The spine becomes a governed intervention lifecycle.

### Replay

The spine becomes a historical scrubber.

### Audit

The spine resolves into an immutable-looking—but truthfully application-level—evidence trail.

This motif should make the entire page feel like one continuous system rather than a sequence of unrelated sections.

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

- Warden / policy sequence;
- technical evidence;
- runtime state;
- selected Fleet Cockpit previews.

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

Product
Case
Cockpit
Audit

Explore CASE-1042
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
Explore CASE-1042 →
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

```text
00 Navigation

01 Hero
   Control every agent.

02 One Case, Many Sessions

03 Durable Context

04 Control Boundaries

05 Governed Recovery

06 Deterministic Replay

07 Evidence Behind Every Decision

08 Fleet Cockpit

09 Audit

10 Product Surfaces

11 Final CTA

12 Footer
```

---

# 13. Hero

## Headline

```text
Control every agent.
Understand every decision.
```

Highlight:

```text
every decision.
```

in:

```css
var(--fs-blue)
```

Supporting copy:

> FleetScope gives enterprise teams one place to monitor, govern, intervene in, and replay long-running AI-agent workflows across sessions, systems, and teams.

Primary CTA:

```text
Explore CASE-1042
```

Secondary:

```text
Open Fleet Cockpit
```

---

# 14. Hero Layout

Two-column grid.

```text
┌──────────────────────────┬───────────────────────────┐
│                          │                           │
│ CONTROL EVERY AGENT.     │                           │
│ UNDERSTAND EVERY         │      CASE NETWORK         │
│ DECISION.                │                           │
│                          │                           │
│ Description              │                           │
│                          │                           │
│ CTA CTA                  │                           │
│                          │                           │
├──────────────────────────┴───────────────────────────┤
│ CASE-1042 · VENDOR ONBOARDING · RECORDED EVIDENCE   │
└──────────────────────────────────────────────────────┘
```

---

# 15. Hero Signature Visual — Case Network

Sup_Contract uses a spherical particle object.

FleetScope replaces this with a:

> **Case Orbit / Evidence Sphere**

Central entity:

```text
CASE-1042
```

Orbiting/connected entities:

```text
Orchestrator

Logistics

Memory

ERP

External Input

Security

Evidence
```

Visual structure:

- hundreds of small evidence points;
- sparse blue connections;
- black structural points;
- one central Case anchor;
- slow autonomous movement;
- minimal cursor response.

This can be implemented using:

1. SVG/Canvas first;
2. PixiJS if particle count requires it;
3. Three.js only if actual 3D depth materially improves the result.

Do not add React Three Fiber only to reproduce Sup_Contract.

FleetScope remains Astro-first.

---

# 16. Hero Motion

Initial state:

```text
fragmented agents
+
unstructured evidence
```

Timeline:

```text
0.0s
Evidence points fade in

0.3s
Peripheral system nodes appear

0.7s
CASE-1042 locks into the center

1.0s
Case Spine draws

1.3s
Agent connections resolve

1.6s
Evidence begins flowing toward Case

2.0s
Stable governed system
```

Motion meaning:

> distributed activity becomes one governed Case.

No large headline animation beyond a restrained mask/fade entrance.

---

# 17. Section 01 — One Case, Many Sessions

Eyebrow:

```text
01
LONG-RUNNING OPERATIONS
```

Headline:

```text
One Case.
Weeks of agent work.
```

Highlight:

```text
one Case.
```

Visual:

```text
SESSION 01

● Case started
│
● Memory written
│
● Waiting
│
┆
┆ SIMULATED DAY 12
┆
● Session 02
│
● Memory recalled
│
● ERP check
│
● Logistics delegated
```

### Motion

Pinned scroll section.

Recommended parent:

```text
250–300vh
```

Content:

```css
position: sticky;
top: 10vh;
```

As scrolling advances:

- active session changes;
- previous steps stay visible but muted;
- Case Spine extends;
- Day 12 gap compresses visually.

Never pretend scroll distance is literal elapsed time.

---

# 18. Section 02 — Durable Context

Eyebrow:

```text
02
PERSISTENT CONTEXT
```

Headline:

```text
Context survives
the session.
```

Two-column structure.

Left:

```text
SESSION 01

<the recorded durable fact>
```

Right:

```text
SESSION 02

Memory recalled
with provenance
```

Motion:

1. memory card created;
2. card collapses into a small evidence token;
3. token travels through Case Spine;
4. Session 02 receives it;
5. provenance expands.

Hover:

```text
<fact>

Source
<recorded event id>

Written
Session 01

Recalled
Session 02
```

> **Correction to earlier drafts.** No fabricated fact appears here. The durable
> fact, its source event and its recall event are read out of the recorded Case
> at build time (§38). Any illustrative figure in an earlier version of this
> section that is not in the record is void.

---

# 19. Section 03 — Control Boundaries

Eyebrow:

```text
03
GOVERNED ACCESS
```

Headline:

```text
Every action crosses
a control boundary.
```

This section adapts Sup_Contract's scroll-moving protocol highlighter into FleetScope control gates.

Create a grid containing:

```text
01 Identity
02 Gateway
03 Screening
```

A strong border/highlight box moves across each system as scroll progresses.

---

## State 01 — Identity

```text
ORCHESTRATOR
     │
     ▼
 [ IDENTITY ]
     │
  ALLOWED
     │
     ▼
    ERP
```

The request should physically stop before Identity.

Only after `ALLOWED` does the line continue.

---

## State 02 — Gateway

```text
ORCHESTRATOR
     │
     ▼
 [ GATEWAY ]
     │
   ROUTED
     │
     ▼
LOGISTICS AGENT
```

Logistics node should not appear before routed state.

---

## State 03 — Screening

```text
EXTERNAL INPUT
     │
     ▼
 [ SCREENING ]
     │
   BLOCKED
     ×
AGENT CONTEXT
```

Blocked path ends visibly.

Use motion to demonstrate enforcement rather than merely displaying labels.

Each gate must also be directly selectable, so a reader can compare the two
recorded outcomes of the same control without scrolling. Both outcomes are
recorded events; the control selects between them, it does not simulate.

---

# 20. Section 04 — Governed Recovery

Eyebrow:

```text
04
INCIDENT + WARDEN
```

Headline:

```text
Recovery is governed.
Not improvised.
```

This section uses Sup_Contract's pinned left-step + dark sticky terminal pattern.

Parent:

```text
300vh
```

Two columns.

### Left

```text
01 Detect
02 Evaluate
03 Authorize
04 Intervene
05 Verify
```

Inactive:

```css
color: var(--fs-fg-muted);
```

Active:

```css
color: var(--fs-fg);
```

---

## Right: Operational Console

Dark panel.

Initial:

```text
Logistics Agent

inventory.read    ✓
inventory.read    ✕
inventory.read    ✕
inventory.read    ✕
```

Then active lines progress with scroll.

### Detect

```text
incident.detected

class:
repeated_tool_failure
```

### Evaluate

```text
policy.evaluate

action:
bounded_retry
```

### Authorize

```text
intervention.authorized
```

### Intervene

```text
intervention.requested
runtime.acknowledged
```

### Verify

```text
runtime.result

SUCCEEDED
```

Never collapse:

```text
Authorized
```

and:

```text
Succeeded
```

into the same state.

---

# 21. Section 05 — Deterministic Replay

Eyebrow:

```text
05
HISTORICAL REPLAY
```

Headline:

```text
Go back in time
without running anything again.
```

Use another pinned sequence.

Left:

```text
Event 60

Event 45

Event 30

Event 16
```

Right:

FleetScope Case preview.

As scroll goes backward:

- Logistics Agent disappears;
- incident disappears;
- Warden disappears;
- memory state changes;
- status switches to Historical.

Persistent label:

```text
HISTORICAL

Recorded evidence.
Nothing is executing.
```

Large proof statement:

```text
0
SIDE EFFECTS DURING REPLAY
```

Motion should resemble a system rewinding, not a video playing backward.

The scrubber must also be operable directly — a real range input — so a position
can be chosen without scrolling, and every position must show the recorded
prefix state hash for that position.

---

# 22. Section 06 — Evidence

Eyebrow:

```text
06
DECISION EVIDENCE
```

Headline:

```text
Every badge has
evidence behind it.
```

Grid/table:

```text
IDENTITY        ALLOWED       evt-0014
GATEWAY         ROUTED        evt-0022
SCREENING       BLOCKED       evt-0016
INCIDENT        DETECTED      evt-0031
INTERVENTION    SUCCEEDED     evt-0037
```

Use 1px borders.

No rounded table card.

---

## Scroll Highlight

Adapt Sup_Contract's moving protocol highlight.

One border box moves between evidence rows.

When row becomes active, detailed evidence appears beside it.

Example:

```text
IDENTITY ALLOWED

Actor
Vendor Onboarding Orchestrator

Resource
ERP.inventory.read

Policy
enterprise-read-policy@1.3

Evidence
evt-0014
```

Rows are also directly clickable.

---

# 23. Section 07 — Fleet Cockpit

Eyebrow:

```text
07
FLEET COCKPIT
```

Headline:

```text
See the entire Case.
At once.
```

Show a high-fidelity product preview.

Structure:

```text
┌─────────────┬────────────────────┬───────────────┐
│ AGENTS      │                    │ EVIDENCE      │
│             │                    │               │
│ Orchestrator│      GRAPH         │ Identity ✓    │
│ └ Logistics │                    │ Gateway ✓     │
│             │                    │ Screening ×   │
├─────────────┴────────────────────┴───────────────┤
│                 TIMELINE                         │
└─────────────────────────────────────────────────┘
```

Do not embed full heavy WASM if unnecessary.

Use:

- recorded screenshot;
- lightweight SVG recreation;
- deterministic preview.

---

# 24. Cockpit Showcase Motion

Adapt Sup_Contract's cross-platform pinned mockup sequence.

Left:

```text
Memory

Gateway

Screening

Incident

Warden
```

Right:

one persistent product frame.

The internal UI state changes as the left active item changes.

Transition:

```text
old:
opacity 1 → 0
translateY 0 → -16px

new:
opacity 0 → 1
translateY 16px → 0
```

Duration:

```text
250–350ms
```

No exaggerated animation.

The left rail is a real tablist, keyboard operable.

---

# 25. Section 08 — Audit

Eyebrow:

```text
08
AUDIT
```

Headline:

```text
Every Case
leaves a record.
```

Evidence dots from previous sections enter the section and align vertically.

They become:

```text
Agent Version
Session
Memory
Identity
Gateway
Screening
Incident
Policy
Intervention
Runtime Result
```

Then resolve to:

```text
STREAM REVISION

PROJECTOR VERSION

STATE HASH
```

CTA:

```text
View CASE-1042 Audit →
```

---

# 26. Product Surfaces

Eyebrow:

```text
09
THE CONTROL PLANE
```

Headline:

```text
One operating layer
for the entire fleet.
```

Five structural cells:

```text
AGENT CATALOG

Discover approved agents.
```

```text
CASE WORKSPACE

Follow long-running business work.
```

```text
APPROVALS

Authorize sensitive actions.
```

```text
FLEET COCKPIT

Investigate and intervene.
```

```text
AUDIT

Reconstruct every decision.
```

No generic icon feature cards.

Use actual product UI fragments.

---

# 27. Final CTA

Headline:

```text
Put every agent action
on the record.
```

Alternative:

```text
Your agents move fast.
Your control plane should keep up.
```

Sub:

> FleetScope turns distributed agent activity into governed, inspectable, replayable business Cases.

Primary:

```text
Explore CASE-1042
```

Secondary:

```text
Enter Fleet Cockpit
```

Final animation:

Evidence particles from the entire page converge into:

```text
CASE-1042
```

then resolve into one straight Case Spine.

---

# 28. Motion System

FleetScope motion has exactly four semantic families.

---

## 28.1 Flow

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

## 28.2 State

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

## 28.3 Evidence

Used when canonical evidence appears.

Example:

```text
event accepted
    ↓
small dot appears
    ↓
joins Case Spine
```

Do not make every dot pulse forever.

---

## 28.4 Scroll Storytelling

Used for:

- Sessions;
- Control Boundaries;
- Warden;
- Replay;
- Cockpit states.

Scrub should feel deterministic and precise.

Avoid overly elastic physics.

---

# 29. Motion Tokens

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

# 30. Scroll Architecture

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
- evidence highlighter;
- Case Spine progression;
- active-step state.

Use plain CSS for:

- hover;
- buttons;
- simple transitions;
- static grid.

Optional smooth scrolling may be added only if native scrolling produces visible jitter.

Do not make Lenis mandatory without benchmarking.

---

# 31. Text Motion

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

# 32. Background

Primary:

```text
WHITE
```

No global gradient.

No permanent noise layer unless extremely subtle.

Blue should derive visual strength from contrast, not glow.

A subtle grid extension may appear outside the main content container on large screens.

---

# 33. Hover Language

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

# 34. Responsive

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

# 35. Reduced Motion

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

# 36. Accessibility

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

# 37. Performance Rules

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

# 38. Product Truth

Landing visuals must never invent evidence.

If UI shows:

```text
Identity Allowed
```

there must be actual CASE-1042 evidence supporting it.

Same for:

```text
Gateway Routed
Screening Blocked
Incident Detected
Intervention Succeeded
```

Technical values must come from real product fixture data, derived at build time
from `packages/fixtures/cases/CASE-1042` through
`apps/web/src/lib/landing-data.ts`. No figure on this page is typed by hand.

Simplifying visuals is allowed.

Inventing proof is not.

---

# 39. Technology Branding

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

# 40. Core UI Primitives

Create/reuse only a small number of primitives.

```text
BlueprintGrid
BlueprintCell

SectionHeader
SectionEyebrow

CaseSpine
CaseEvent

StatusLabel
EvidenceRow
EvidenceDetail

ControlGate

OperationalConsole

ProductFrame

PrimaryButton
SecondaryButton
```

Avoid a generic 50-component landing design system.

`StatusLabel` resolves its word and glyph through `apps/web/src/lib/status.ts`,
which is the single status vocabulary for the whole product. The landing page
restyles that vocabulary; it never redefines it.

---

# 41. Section Rhythm

Follow a deliberate rhythm:

```text
HERO
high visual impact

↓

SESSIONS
large narrative

↓

MEMORY
lighter / explanatory

↓

CONTROL
interactive

↓

WARDEN
dark operational peak

↓

REPLAY
interactive peak

↓

EVIDENCE
structured / calm

↓

COCKPIT
product reveal

↓

AUDIT
proof

↓

CTA
minimal closure
```

Do not make every section equally visually loud.

---

# 42. Z-Index System

```text
z-0
base canvas

z-5
hero visualization

z-10
Case Spine overlays

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

# 43. Design Do

Do:

- let grid lines align between sections;
- use blue sparingly;
- use product state as animation;
- use one strong focal visual per section;
- maintain large whitespace;
- let diagrams draw themselves;
- use actual FleetScope evidence;
- create continuity through the Case Spine;
- preserve crisp sharp geometry.

---

# 44. Design Don't

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

# 45. Signature FleetScope Moments

The final page must contain at least these five memorable moments.

## 1. Case Formation

Fragmented agent activity converges around:

```text
CASE-1042
```

---

## 2. Session Jump

Scroll compresses:

```text
Session 01
→ Simulated Day 12
→ Session 02
```

while memory survives.

---

## 3. Control Gate

A request physically cannot pass until the control decision allows it.

---

## 4. Governed Recovery

Repeated failure becomes:

```text
Incident
→ Policy
→ Intervention
→ Runtime Result
```

---

## 5. Replay

The entire Case visibly rewinds while displaying:

```text
HISTORICAL

Recorded evidence.
Nothing is executing.
```

These moments should define FleetScope's identity.

---

# 46. Quality Bar

The landing page is visually complete only when:

- every section feels like part of one grid system;
- the Case Spine remains visually coherent;
- typography is consistently large and disciplined;
- motion explains FleetScope behavior;
- blue remains an accent rather than wallpaper;
- no section looks like an unrelated component pasted from a library;
- FleetScope remains understandable without animation;
- CASE-1042 tells one coherent story;
- desktop experience is excellent at 1440×900 and 1280×720;
- mobile retains the story without heavy animation;
- reduced motion retains all information;
- there is zero body-level horizontal overflow;
- there are no persistent console errors;
- scroll motion remains smooth;
- hero visualization does not hurt interaction performance;
- all operational claims remain grounded in actual FleetScope evidence.

---

# 47. Final Design Statement

FleetScope should not look like an AI startup trying to appear futuristic.

It should look like:

> **the operating system that enterprises would actually trust to control autonomous agents.**

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
the Case Spine
```

The visual experience starts with distributed agent activity and ends with one auditable Case.

That transformation is the FleetScope brand story.
