# FleetScope UI/UX plan

Status: draft  

Last updated: 2026-08-26

## UX thesis

FleetScope has two altitudes:

- **Business altitude:** discover an agent, understand a Case, provide an

  approval, and see the next milestone.

- **Operations altitude:** inspect live topology, security controls, incidents,

  runtime actions, and historical evidence.

The product fails if every user lands in the graph. Fleet Cockpit uses spatial

and temporal context deliberately at operations altitude, where it materially

improves understanding.

## Information architecture

```text

FleetScope

├── Agent Catalog

│   └── Agent Detail / Start Case

├── Cases

│   └── Case Workspace

│       ├── Approval detail

│       ├── Memory detail

│       └── Open Fleet Cockpit

├── Approvals

├── Fleet Cockpit

│   └── Evidence drawer / historical replay

└── Audit

    └── Case evidence / export

```

No separate landing page is needed for the MVP. Open on Cases for procurement

users and Fleet Cockpit for operator-role demo links.

## End-to-end UX flow

### 1. Discover

The Agent Catalog answers “Is this approved and appropriate?” before “How does

it work?”

Card content:

- Vendor Onboarding Orchestrator;

- `Approved` status and immutable version;

- owner/team and last verification;

- business-purpose summary;

- capabilities: vendor verification, inventory read, logistics delegation;

- risk class and approval requirements;

- `Start case` primary action and `View evidence` secondary action.

Search and filters are limited to query, approval state, owner, and capability

for MVP.

### 2. Start Case

A short sheet/modal asks only for vendor, business objective, target completion

date, and optional known constraint. It previews:

- exact Agent Version;

- protected systems it may request;

- whether human approval may be required;

- memory scope that will be created;

- clear `Start governed case` action.

Do not expose model parameters or platform configuration to procurement users.

### 3. Operate the Case

Case Workspace answers:

- Where are we in onboarding?

- What happened most recently?

- What is the agent waiting for?

- What needs me now?

- What trusted context will carry forward?

Wireframe:

```text

┌──────────────────────────────────────────────────────────────────────┐

│ FleetScope  Catalog  Cases  Approvals  Cockpit  Audit               │

├──────────────────────────────────────────────────────────────────────┤

│ Acme Components onboarding  DAY 12  Waiting for vendor response     │

│ Agent v1.4 Approved · Owner Procurement AI · Case CASE-1042          │

├───────────────────────────────┬──────────────────────────────────────┤

│ Milestones                    │ Action required                      │

│ ✓ Initial review              │ Approve scoped ERP inventory read   │

│ ✓ Negotiation                 │ [Review approval]                    │

│ ● Compliance verification     ├──────────────────────────────────────┤

│ ○ Logistics                   │ Recent activity                      │

│ ○ Activation                  │ Email screened · Memory recalled     │

│                               │ Logistics agent delegated            │

├───────────────────────────────┴──────────────────────────────────────┤

│ Trusted case memory: MOQ 5,000 · Net 45 · source + provenance        │

│ [Open Fleet Cockpit]                              [View audit trail] │

└──────────────────────────────────────────────────────────────────────┘

```

The “DAY 12” label may represent a simulated Case day. It must be visibly

labeled in demo/test environments to avoid implying real elapsed time.

### 4. Approve safely

The Approval detail presents:

- agent and immutable version;

- exact requested action and protected resource;

- requested scope and parameters;

- business justification and triggering event;

- identity and policy to be used;

- expiration and consequence of approval/denial;

- `Deny` and `Approve once` actions.

Approval must not be a vague “let the agent continue.” Any changed action,

scope, or evidence revision requires a new approval.

### 5. Investigate in Fleet Cockpit

Wireframe:

```text

┌────────────────────────────────────────────────────────────────────────────┐

│ CASE-1042 · Acme · v1.4 · Waiting · Day 12       HISTORICAL event 184/231 │

├───────────────┬───────────────────────────────────────┬────────────────────┤

│ Agents        │ Canvas                                │ Evidence           │

│ ● Coordinator │ Vendor email ─[ARMOR blocked]─x       │ Model Armor        │

│ ● Compliance  │                  Coordinator          │ action: block      │

│ ! Logistics   │                 /     |      \         │ policy: armor-v3   │

│ ○ Warden      │         [MEM]──/  [ERP ID✓]  [GW]──Log│ input: msg-882     │

│               │                                       │ downstream: none   │

│ Milestones    │  tool chips: verify ×3  inventory ✓  │ [Open raw evidence]│

├───────────────┴───────────────────────────────────────┴────────────────────┤

│ |REG|---|MEM|------|ID✓|--|GW|---|ARMOR BLOCK|--|INCIDENT|--|WARDEN ✓|  │

│ ◀ event 1                     [Return to live]                    231 ▶    │

└────────────────────────────────────────────────────────────────────────────┘

```

The Cockpit should feel alive only when live. Historical mode desaturates live

motion, pins the event number, and replaces pulsing edges with recorded-state

styles.

### 6. Audit

The Case audit view is chronological but grouped by decision domain:

- launch and Agent Version;

- runtime transitions;

- memory reads/writes;

- identity-protected access;

- gateway delegations;

- screened external inputs;

- approvals, Warden actions, and runtime results.

It supports `Copy evidence link` and an integrity-manifest export. Raw sensitive

payloads remain redacted or access controlled.

## Fleet Cockpit interaction model

| Interaction | FleetScope use | Required behavior |

|---|---|---|

| Node per agent | Agent and protected-system topology | Add business role, Agent Version, identity and policy state |

| Tool chips | Current/recent tools under each agent | Add denied/blocked/cancelled states and protected-resource semantics |

| Animated edges | Accepted live agent/delegation/tool activity | Separate spawn, Gateway, external input, memory, identity, and control edges |

| Event-indexed scrubber | Exact Observable Case State replay | Add Case milestone/day separators and platform-control markers |

| Incident markers | Security, approval, runtime, and Warden events | Filter by Registry/Memory/Identity/Gateway/Armor/Incident/Approval |

| Follow camera | Focus the latest meaningful Case change | Pause on manual navigation and respect reduced motion |

| Detail panel | Decision Evidence drawer | Never claim hidden reasoning chain; show facts/policy/request/result |

## Visual system

### Direction

Enterprise control room, not sci-fi command center. Dense but calm; evidence

states must read faster than decorative detail.

- Background: near-black navy `#0B0F14`.

- Raised surfaces: `#111821` and `#18212C`.

- Primary text: `#E8EDF2`; secondary: `#9AA8B7`.

- Action/brand: amber `#D7AF00` or a final accessible equivalent.

- Healthy/allowed: `#3CCB7F` plus check/icon.

- Waiting: `#58A6FF` plus pause/clock icon.

- Warning/approval: `#F0A64A` plus triangle.

- Blocked/incident: `#F05D5E` plus stop/error icon.

- Historical: violet `#A78BFA` plus explicit label.

JetBrains Mono may be used for IDs, timestamps, event counts, policy versions,

and tool chips. Use a legible sans-serif for navigation, business summaries,

and long evidence text. All palette choices require contrast verification.

### State language

Use verbs and results, not vague colors:

- `Running`, `Waiting for vendor`, `Approval required`, `Resuming`, `Completed`;

- `Identity allowed`, `Identity denied`;

- `Armor blocked`, `Armor sanitized`;

- `Gateway routed`, `Gateway denied`;

- `Intervention requested`, `Runtime confirmed`, `Timed out`.

Never collapse requested/acknowledged/succeeded into a single “done” state.

## Interaction rules

- A selected platform badge focuses both its timeline marker and evidence.

- Scrubbing never invokes tools, models, policies, or runtime controls.

- Returning to live fetches every event after the last received sequence before

  moving the cursor.

- Follow camera reacts to meaningful domain events, not every token or span.

- Hover is supplementary; all content is click/focus accessible.

- Destructive controls require confirmation and exact scope; the public replay

  never renders active controls.

- Missing evidence is shown as `Unknown` with cause where possible.

## Demo choreography

For a three-minute product segment:

1. **15 s:** Catalog—approved Agent Version and Start case.

2. **35 s:** Case Workspace—simulated Day 12 resume and Memory provenance.

3. **25 s:** protected ERP read—Agent Identity allow.

4. **20 s:** delegation—Gateway route to Logistics Agent.

5. **30 s:** malicious vendor email—Model Armor block before downstream use.

6. **45 s:** Fleet Cockpit—incident, Warden action, runtime-confirmed recovery.

7. **30 s:** scrubber and unified Case audit.

The graph gets roughly one minute; this prevents the product from reading as a

viewer while preserving the strongest Fleet Cockpit shot.

## Validation

- Five procurement-oriented users should find/start the approved agent in under

  60 seconds and identify the current Case action without opening the Cockpit.

- Five technical users should identify the affected branch, platform decision,

  and authoritative result in under 30 seconds.

- All core journeys must work with keyboard and reduced motion.

- A comprehension test must confirm users distinguish Agent Version, runtime

  state, identity denial, Armor block, approval request, and confirmed result.

- The selected demo viewport must remain readable after video compression.

## Cut order

Cut minimap, policy editor, fleet dashboard, advanced filters, wall-clock view,

and decorative motion before cutting Catalog, Case Workspace, platform-evidence

badges, event scrubber, evidence drawer, or approval clarity.

## Open points

1. Final brand/name and visual identity.

2. Whether the demo video limit permits all seven platform proofs at readable

   pace.

3. Whether Memory Bank should be a graph node, timeline marker, or both.

4. Whether procurement manager and operator roles require separate default

   navigation in the MVP.

## Links

- [USD 35 static-first demo design](../design/[budget-demo.md](http://budget-demo.md))

- [Product plan]([product-plan.md](http://product-plan.md))

- [Product requirements](../requirements/[fleetscope.md](http://fleetscope.md))

- [Fleet Cockpit requirements](../requirements/fleetscope/[fleet-cockpit.md](http://fleet-cockpit.md))

- [Demo and validation plan](../plans/[demo-validation.md](http://demo-validation.md))

