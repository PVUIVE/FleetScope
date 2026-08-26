# FleetScope product plan

Status: draft  

Planning horizon: six-day hackathon MVP plus post-hackathon pilot  

Last updated: 2026-08-26

## Executive brief

FleetScope is an enterprise agent-fleet control plane demonstrated through a

multi-week Vendor Onboarding Case. It lets an employee discover an approved

agent, launch and resume it, govern access and delegation, screen untrusted

inputs, inspect durable context, respond to incidents, and audit the complete

decision trail.

FleetScope combines a live flow graph, tool chips, event-indexed time travel,

incident markers, and follow camera inside the Fleet Cockpit. The complete

product maps directly to The Fortified Enterprise Fleet.

## Product framing

### What the customer sees

```text

Agent Catalog -&gt; Case Workspace -&gt; Approval Inbox

                       |

                       v

                 Fleet Cockpit -&gt; Audit Export

```

### What proves the track

| Track capability | Product behavior | Visible proof |

|---|---|---|

| Agent Registry | Discover and launch an approved immutable Agent Version | Catalog card and version-used evidence |

| Agent Runtime | Run, wait, pause, resume, and control a multi-week Case | Runtime state and operation result |

| Memory Bank | Preserve approved negotiation context across invocations | Memory provenance card before/after resume |

| Agent Identity | Authorize private ERP access under zero trust | ID allow and invalid-role denial |

| Agent Gateway | Route delegation to a registered Logistics Agent under policy | Gateway decision on delegation edge |

| Model Armor | Screen vendor email/attachments before context, memory, or tools | Allowed and blocked/sanitized input markers |

| Agent Observability | Reconstruct state, investigate, intervene, and export evidence | Live graph, scrubber, Decision Evidence |

The table is a product acceptance map. A logo or configured service without the

listed behavior and evidence does not count.

## Positioning

For enterprise teams deploying long-running multi-agent workflows, FleetScope

is the governed case-and-operations layer that makes agents discoverable,

resumable, policy-enforced, and auditable. Unlike a trace viewer, FleetScope

starts with the employee's business Case and closes the loop through runtime

action. Unlike an opaque autonomous workflow, it exposes the version, memory,

identity, route, screening decision, policy, and confirmed result.

## Users and value

| Persona | Job | FleetScope outcome |

|---|---|---|

| Procurement manager | Complete vendor onboarding without rebuilding context | Discover approved agent, follow milestones, handle only needed approvals |

| Fleet administrator | Govern which agents and versions may run | Registry policy, runtime control, fleet state, containment |

| Security/compliance reviewer | Prove safe data and tool handling | Correlated identity, memory, gateway, armor, and action evidence |

| Agent operations engineer | Diagnose and recover a stuck branch | Event-indexed graph, incident focus, bounded Warden recovery |

| Judge | Verify full track fit quickly | One Case visibly uses every required capability |

## Core journeys

### Discover and start

1. Procurement manager searches Agent Catalog for “vendor onboarding”.

2. Reviews approved version, owner, capabilities, risk class, tools, and allowed

   access.

3. Starts a Case with vendor name and onboarding objective.

4. FleetScope binds the Case to the exact Agent Version and Runtime operation.

### Resume a long-running Case

1. The Case waits for a vendor webhook or approval across a simulated day gap.

2. The manager returns to Case Workspace and sees last progress, next milestone,

   and required action.

3. Runtime resumes in a new invocation.

4. Memory Bank recalls an approved negotiation term with provenance; completed

   effects are not repeated.

### Use protected systems and delegate safely

1. Orchestrator requests a scoped inventory read from the ERP adapter.

2. ERP validates Agent Identity and policy; allow or deny is recorded.

3. Orchestrator delegates logistics verification through Agent Gateway.

4. Gateway selects/authorizes the registered Logistics Agent and records route

   evidence.

### Handle untrusted vendor input

1. Vendor email or webhook enters an external-input boundary.

2. Model Armor allows, sanitizes, flags, or blocks it before agent context,

   Memory Bank, or tool arguments.

3. The user sees the business consequence in Case Workspace and the full

   decision in Fleet Cockpit.

### Investigate and recover

1. A read-only logistics tool repeats a deterministic failure.

2. Incident Detector raises a finding; policy permits one bounded retry or asks

   for approval.

3. Control Adapter invokes the real Runtime operation once and records its

   authoritative result.

4. Operator scrubs across the incident and sees the same observable state and

   evidence for each event prefix.

## Experience strategy

### Agent Catalog

Optimized for trust before launch: approved/deprecated state, immutable version,

owner, purpose, risk, required systems, allowed callers, last verification, and

clear **Start case** action.

### Case Workspace

The procurement home screen. It prioritizes business milestone, elapsed days,

last progress, next action, approvals, trusted memory summary, and activity. It

does not show a complex graph unless the user chooses **Open Fleet Cockpit**.

### Approval Inbox

Shows exact subject, action, protected resource, justification, policy, expiry,

and consequence. Approval binds to an immutable request; changed parameters

invalidate it.

### Fleet Cockpit

The expert surface: live graph, platform-control evidence, event scrubber,

incident markers, follow camera, and evidence drawer. It is opened from a Case,

approval, security finding, or audit record.

### Audit

Case-level query/export answering who ran which version, which context was

recalled, what accessed private systems, how delegation was routed, what input

was screened, why an action was authorized, and what the Runtime confirmed.

## MVP priorities

Budget constraint: total cloud/model credits are capped at **USD 35**. UI,

fixture generation, replay, testing, public judging, and normal rehearsal MUST

cost zero credits. The demo uses a pinned browser/WASM visualization core and

one optional bounded live proof; recorded evidence remains a complete fallback.

### P0 — submission does not ship without it

- One Agent Registry discovery/launch flow with immutable version evidence.

- One long-running Case that waits and resumes across separate invocations.

- One Memory Bank fact persisted, recalled, and shown with provenance.

- One allowed and one denied protected ERP read under Agent Identity.

- One Logistics Agent delegation through Agent Gateway.

- One benign and one adversarial external input through Model Armor.

- One canonical event spine powering the Case Workspace and Fleet Cockpit.

- One policy-gated Warden recovery with a confirmed recorded result; the same

  step becomes the preferred live proof only if the Runtime API is available

  and stays inside the live budget.

- Event-indexed replay and one Case audit view containing all platform proofs.

- Optional private live proof plus a complete public/recorded read-only demo.

- Hard model-call/token/run limits and billing checks after the first live call.

### P1 — score-strengthening polish

- Approval Inbox for one protected action.

- Catalog search/filter and deprecated-version state.

- Case milestone rail and simulated-day separators.

- Follow camera, rich tool chips, security markers, keyboard flow, reduced motion.

- Signed or integrity-manifest evidence export.

### P2 — only after P0 passes ten times

- Fleet-wide dashboard, policy editor, minimap, wall-clock alternate timeline.

- Context-drift advisory and additional Warden incident classes.

- Multiple workflows, runtimes, tenants, or production enterprise adapters.

## Product metrics

### North-star MVP proof

**Complete governed Case rate:** percentage of scripted Cases that complete the

full discovery, persistence, access, delegation, screening, intervention, and

audit journey with complete correlated evidence.

Target: 10/10 consecutive recorded Cases before recording, plus 3/3 bounded

live-proof runs if live mode is enabled.

| Metric | Target |

|---|---:|

| Time to discover and launch approved agent | &lt;60 seconds |

| Required memory facts present after resume | 100% |

| Protected requests carrying valid identity decision | 100% |

| Delegations traversing Gateway | 100% |

| External inputs screened before downstream use | 100% |

| Time to locate failing/blocked branch | &lt;30 seconds |

| Replay conformance | 100% of golden prefixes |

| Duplicate Interventions | 0 |

| Complete Case evidence package | 100% of demo runs |

## Demo narrative

&gt; “FleetScope lets a procurement manager discover an approved agent and trust

&gt; it across weeks—not because the agent says it is safe, but because every

&gt; version, memory, identity, route, screened input, action, and result is

&gt; enforced and replayable.”

Proof order:

1. business Case and discovery;

2. long-running resume plus durable memory;

3. identity-protected ERP access;

4. gateway-routed delegation;

5. armor-blocked injection;

6. Fleet Cockpit live investigation and bounded recovery;

7. event replay and unified audit evidence.

## Risks and mitigation

| Risk | Impact | Mitigation / decision trigger |

|---|---|---|

| Platform capability unavailable or differently named | A live track claim becomes unsupported | Review all seven API/schema surfaces on day 1, choose one bounded live proof, and label every recorded or simulated adapter honestly |

| Workflow feels like staged logos | Judge rejects integration depth | Every capability changes Case behavior and emits selectable evidence |

| Too much UX surface for six days | Vertical slice incomplete | One golden path per surface; no generic admin settings |

| Long-term state is only a timer animation | Runtime/persistence claim weak | Resume in a separate invocation and show stable Case/Memory references |

| Identity/Gateway controls are enforced only in UI | Security claim fails | Protected adapter and delegation path independently reject invalid requests |

| Armor badge is decorative | Security posture claim fails | Assert no downstream event exists before allow/sanitize decision |

| Cockpit overwhelms business user | Product feels like developer tooling | Case Workspace is default; Cockpit is expert drill-down |

| “Reasoning audit” overclaims chain-of-thought | Trust issue | Use Decision Evidence: facts, versions, policy, concise rationale, request, result |

## Six-day scope gates

- **Day 1:** verify rules/services, build the pinned browser fork, inspect all

  platform API/schema surfaces, and choose only one bounded live proof; lock the

  Case event/correlation model.

- **Day 2 noon:** discovery → Runtime start/wait/resume → Memory recall passes;

  Identity/Gateway/Armor each emit real decision evidence.

- **Day 3:** Case Workspace plus canonical projector and replay fixtures pass.

- **Day 4:** complete governed Case including Warden recovery passes five times.

- **Day 5 noon:** feature freeze after 10/10 reliability target or cut P1.

- **Day 6:** record, audit claims, and submit with fallback.

## Post-hackathon pilot

Validate with 3–5 procurement/agent-platform/security practitioners. Replace

synthetic adapters with one real ERP/email integration; add SSO/RBAC, tenant

isolation, retention, policy authoring/review, alert/approval channels, and

fleet-level analytics only after validating the core Case jobs.

## Open product decisions

1. Is FleetScope the final brand or only the working name?

2. Which exact platform services/APIs are available in the target project?

3. What is the safest credible protected ERP operation?

4. How will the demo represent multiple days without implying real elapsed time?

5. Which Warden action is real and reliable enough for the golden path?

6. Is the public artifact read-only while live controls remain private?

## Links

- [Context intake]([context-intake.md](http://context-intake.md))

- [UI/UX plan]([ui-ux-plan.md](http://ui-ux-plan.md))

- [Product requirements](../requirements/[fleetscope.md](http://fleetscope.md))

- [System design](../design/[system.md](http://system.md))

- [Budget-constrained demo design](../design/[budget-demo.md](http://budget-demo.md))

- [Six-day delivery plan](../plans/[six-day-delivery.md](http://six-day-delivery.md))

- [Demo and validation plan](../plans/[demo-validation.md](http://demo-validation.md))

