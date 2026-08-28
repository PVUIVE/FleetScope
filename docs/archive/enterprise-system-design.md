# FleetScope system design

Status: draft  

Scope: system-wide  

Last updated: 2026-08-26

## Mission

FleetScope composes Gemini Enterprise Agent Platform capabilities into a

governed, long-running business Case and a shared evidence spine. It lets users

discover a versioned agent, execute and resume it, constrain private access and

delegation, screen untrusted inputs, investigate incidents, and reconstruct the

recorded Case state without replaying side effects.

## Design principles

1. **Business Case is the root correlation.** Registry, Runtime, Memory,

   Identity, Gateway, Armor, Observability, and control records all correlate to

   one Case even when it spans several Sessions.

2. **Platform controls enforce; FleetScope explains.** Identity, Gateway, Armor,

   Runtime, and protected adapters remain authoritative. The browser never

   manufactures an allow, block, route, or success.

3. **One evidence spine, multiple views.** Case Workspace, Fleet Cockpit,

   detection, Warden, and Audit consume the same Canonical Events.

4. **Screen before context; identity before access.** External input crosses

   Armor before agent/memory/tool use; protected tools independently validate

   Agent Identity.

5. **Memory has provenance and scope.** Memory Records are evidence-bearing data

   and never executable instructions.

6. **Reducers cause no effects.** Projection and historical replay are pure;

   only authorized platform/control adapters change external state.

7. **Models advise; policy authorizes.** Model output is untrusted data passed

   through schemas and deterministic policy.

8. **Degrade to evidence.** If Warden or one expert surface fails, Case capture,

   core platform enforcement, and audit remain usable.

## System context

```text

Procurement Manager        Fleet Admin / Operator / Security Reviewer

        |                                  |

        v                                  v

 Agent Catalog -----&gt; Case Workspace / Approvals -----&gt; Fleet Cockpit / Audit

        |                       |                            ^

        v                       v                            |

  Agent Registry        FleetScope Case API                 |

        |                       |                            |

        +-----------------------+----------------------------+

                                |

                                v

                Vendor Onboarding Orchestrator

                     Agent Runtime (async)

                  /          |           \

                 v           v            v

           Memory Bank   Agent Gateway   Protected ERP adapter

                             |                 ^

                             v                 |

                       Logistics Agent    Agent Identity

                                

 Vendor email/webhook -&gt; Model Armor -&gt; screened input -&gt; Orchestrator

 All platform/runtime/tool decisions

                |

                | OTel spans + explicit domain Source Events

                v

       Scenario/Event Adapter -&gt; canonical JSONL + evidence manifest

                                     |                    |

                                     v                    v

                             Session Projector      Incident Detector

                                     |                    |

                                     |                    v

                                     |              Policy/Warden adviser

                                     |                    |

                                     |                    v

                                     +----------- Control Adapter -&gt; Runtime

```

## Ownership boundaries

| Component | Owns | Does not own |

|---|---|---|

| Agent Registry | agent publication/version/capability metadata | running Case state |

| Agent Runtime | async execution and authoritative control result | FleetScope audit projection |

| Memory Bank | persistent scoped context storage/retrieval | treating recalled data as trusted instruction |

| Agent Identity | verifiable acting identity/claims | protected-resource authorization by itself |

| Protected ERP adapter | final resource authorization and synthetic ERP data | agent routing |

| Agent Gateway | delegation routing and route policy | source-agent business intent |

| Model Armor | external-input screening decision | downstream business decision after allowed/sanitized input |

| FleetScope Case API | Case lifecycle view, correlations, approvals | platform enforcement it did not perform |

| Audit Store/Projector | canonical evidence and deterministic observable state | tool/model/side-effect re-execution |

| Warden/Policy/Control | incident recommendation and bounded Runtime action | unrestricted business operations |

## Case and Session model

```text

Case CASE-1042

  agentVersion: vendor-onboarding@1.4

  memoryScope: tenant/acme-procurement/case-1042

  milestones: review -&gt; negotiation -&gt; compliance -&gt; logistics -&gt; activation

  state: active | waiting | approval_required | completed | failed | cancelled

  sessions:

    sess-001 initial run

    sess-002 webhook resume

    sess-003 approval resume

```

A Case is the durable business aggregate. Each Session is a runtime invocation

or resume segment with its own ordered Canonical Event sequence. Case-level

projection folds Sessions in an explicit Case sequence so replay remains

deterministic across simulated day boundaries.

Starting a Case binds the immutable Agent Version. Publishing a new Registry

version affects future launches only. A Case upgrade is a separate, auditable

operation and is out of MVP scope.

## Platform integration contracts

### Agent Registry adapter

Queries/publishes the Vendor Onboarding Orchestrator and Logistics Agent. It

normalizes actual Registry responses into registered-version evidence containing

registry reference, immutable version/digest, owner, capabilities, tools,

allowed callers, and publication status. Supplemental demo metadata such as

risk class must be explicitly identified if Registry does not own it.

Launch flow re-resolves and verifies the selected version before creating the

Case to prevent a stale UI selection from launching another version.

### Agent Runtime adapter

Starts one operation per Session, exposes wait/resume/control capabilities, and

emits stable operation IDs plus authoritative state/result events. Runtime

acknowledgement and terminal success remain separate.

On resume, the Orchestrator receives Case ID, selected Agent Version, memory

scope, triggering webhook/approval reference, and completed-effect ledger. It

must not repeat a completed external effect merely because a process restarted.

### Memory Bank adapter

Writes only approved Case facts and retrieves only within tenant and Case scope.

Every record is wrapped with provenance: source event/document, actor, created

and updated time, scope, sensitivity classification, and retrieval reference

when supported.

Recalled content is inserted into a structured data envelope, never concatenated

into system instructions. External vendor content cannot be persisted until a

Model Armor Decision allows or sanitizes it.

### Agent Identity and protected ERP adapter

Agent Runtime obtains or presents an Agent Identity bound to Agent Version,

Case, requested role, audience, and expiry. The protected ERP adapter verifies

the identity and independently evaluates allowed inventory scope. It rejects

missing, stale, wrong-audience, wrong-role, or wrong-Case identities and emits a

specific identity-policy denial event.

The MVP ERP is read-only unless the official rules require a write. Synthetic

inventory is acceptable if the identity enforcement path is real and the UI

labels the adapter.

### Agent Gateway adapter

All Orchestrator-to-Logistics delegation passes through Gateway. The request

contains source Agent Version, Case, requested capability, policy context, and

correlation IDs. The response must identify destination Agent Version, route or

policy reference, and allow/deny outcome.

FleetScope does not draw a “Gateway routed” edge until the recorded Gateway

Decision exists.

### Model Armor adapter

Vendor email bodies, attachment text, and webhook payloads are screened before

any downstream agent context, memory write, or tool request. An input ID and

payload digest correlate the Armor Decision to later allowed/sanitized use.

For a blocked input, an invariant check asserts that no downstream agent,

memory, or tool event references that input as usable content. Raw content is

redacted from general audit views.

## Evidence pipeline

### Source events

Runtime and platform adapters emit explicit domain Source Events alongside OTel

spans. OTel alone is insufficient because spans may be delayed, duplicated,

sampled, or lack business/platform decision semantics.

Agent Observability connects spans across Case/Session/agent/tool correlations.

Permitted decision-trace fields are normalized into Decision Evidence; private

chain-of-thought is neither required nor claimed. Sampling/redaction gaps remain

explicit in the projected state.

Required families:

- `registry.version_resolved`, `case.created`;

- `runtime.started|waiting|resumed|completed|failed|controlled`;

- `memory.written|recalled|rejected`;

- `identity.allowed|denied`;

- `gateway.routed|denied`;

- `armor.allowed|blocked|sanitized|flagged`;

- agent/tool/usage events;

- incident, policy, approval, Intervention, and audit-export events.

### Canonicalizer

Validates schemas and correlations, redacts sensitive fields, deduplicates, and

assigns a monotonic Session sequence. Case-level sequence assignment orders

Session boundaries and business milestones. Canonical acceptance is atomic for

deduplication key, next sequence, event append, and high-water mark.

For the budget MVP, the Scenario Compiler canonicalizes the recorded fixture and

the optional live backend canonicalizes its bounded append. No Pub/Sub is

required. A later production transport may use ordering keys, but transport is

never replay authority. Late facts append as correction or late-observation

events rather than mutating certified history.

### Logical event model

The MVP serializes this model as bundled JSON/NDJSON plus an evidence manifest;

the optional live backend may hold one Case in memory for the duration of a

request. Firestore is a post-MVP storage adapter, not a six-day dependency.

```text

cases/{caseId}

  agentVersionRef, runtimeState, memoryScope, currentMilestone

  caseHighWaterMark, createdAt, updatedAt

cases/{caseId}/sessions/{sessionId}

  runtimeOperationId, streamRevision, highWaterMark, status

cases/{caseId}/events/{zeroPaddedCaseSequence}

  eventId, sessionId, sessionSequence, caseSequence

  schemaVersion, type, sourceTime, acceptedTime

  actor, correlations, payloadRedacted, payloadDigest

cases/{caseId}/snapshots/{caseSequence-projectorVersion}

  projectorVersion, stateHash, observableCaseState

interventions/{interventionId}

  caseId, incidentId, policyVersion, actionTemplate, target

  authorization, state, runtimeOperationId

```

Application actors append accepted events but cannot edit them. Corrections are

new events. In a bundled fixture this is deterministic recorded evidence, not a

claim of a remotely immutable database or regulatory WORM storage.

### Session Projector

A versioned pure reducer produces Observable Case State: Case milestones,

runtime state, topology, tools, platform decisions, memory references, usage,

incidents, approvals, and Interventions. Snapshots are performance hints and are

accepted only when projector version and state hash match.

Exactness guarantee:

&gt; Given the same Case stream revision, canonical prefix, and projector version,

&gt; FleetScope produces the same Observable Case State and state hash.

This does not reproduce external side effects, physical causality, or hidden

model chain-of-thought.

### API and live updates

The API provides Catalog entries, Case summary, exact Agent Version used,

milestones, approvals, ordered events after a Case sequence, compatible

snapshot/state for an Event Cursor, evidence details, and integrity export.

SSE is the MVP live transport because server-to-client updates and resume by

canonical sequence match the problem. Approval/control uses authenticated HTTP.

WebSocket is not required absent a measured bidirectional streaming need.

## Experience projection

Case Workspace consumes the same Observable Case State but exposes a business

projection: milestone, last meaningful progress, waiting condition, next

action, approvals, and trusted Memory Records.

Fleet Cockpit uses a pinned portable Rust core and WASM/Ratzilla frontend for

expert topology, timeline, camera, and tool chips. An Astro/DOM shell supplies

Case/product surfaces and Decision Evidence. Neither layer computes an

authoritative platform/security decision. A Scenario Compiler bridges

FleetScope canonical evidence into the transcript shape expected by the reused

projector for the hackathon only.

## Incident and control loop

1. Incident Detector emits a versioned Incident Candidate from Canonical Events.

2. Optional Warden model adviser receives a minimized redacted evidence

   envelope and returns schema-constrained advice.

3. Policy Engine chooses observe, recommend, approval-required, or auto-act.

4. Human approval, if needed, binds exact Case, evidence sequence, action,

   target, parameters, expiry, and approver.

5. Control Adapter idempotently claims the Intervention ID and invokes Runtime.

6. Runtime acknowledgement and terminal result become separate events.

7. Detector observes subsequent progress or escalates after the attempt budget.

Historical replay does not execute this loop.

## Security and privacy

### Trust boundaries

- External vendor content, tool output, Memory Records, model advice, and Source

  Event payloads are untrusted.

- User, agent, service, Canonicalizer, and Control Adapter identities remain

  distinct.

- Browser UI cannot authorize protected access or alter accepted evidence.

- Identity, Gateway, Armor, protected ERP, and Runtime decisions are accepted

  only from their authoritative adapters.

### Controls

- Screen external input before context/memory/tool use.

- Redact secrets, PII, prompts, email bodies, and tool arguments before general

  Audit Store access; retain digests/references as policy permits.

- Validate platform responses, events, and model advice against closed schemas.

- Use least-privilege service accounts and separate Canonicalizer/Control keys.

- Bind approvals and Interventions to immutable evidence/action parameters.

- Apply model/action budgets, attempt limits, and a global automatic-action

  switch.

- Keep public replay read-only; private live controls require authentication.

### MVP gaps

Full SSO/RBAC lifecycle, tenant isolation, retention, legal hold, data residency,

key rotation, and regulatory immutability are designed boundaries, not six-day

implementation claims.

## Resilience

| Failure | Required behavior |

|---|---|

| Registry unavailable at launch | Do not launch an unverified version; show retryable error |

| Runtime process restarts | Resume from Case/Memory/completed-effect state; do not repeat completed effect |

| Memory unavailable | Pause affected step; show missing context; never fabricate memory |

| Invalid Agent Identity | Protected ERP denies; record identity denial |

| Gateway denies or fails | Coordinator receives safe failure; no direct bypass |

| Armor unavailable | Fail closed for untrusted external input in the golden path |

| Duplicate Source Event | Deduplicate and return prior canonical identity |

| SSE disconnect | Resume after last Case sequence without gap/duplicate animation |

| Model adviser fails | Deterministic policy continues without model advice |

| Warden unavailable | Capture, platform enforcement, replay, and manual response remain |

| Control timeout | Mark unknown; reconcile by Runtime operation ID; do not blind retry |

## MVP performance envelope

- One recorded Case with up to 5 agents, 5 Sessions, 2,000 Canonical Events, and

  a simulated burst of 10 events/second; the optional live path appends one

  bounded decision/result pair.

- p95 canonical acceptance to visible UI under 2 seconds.

- Event Cursor seek under 500 ms after initial load for the golden fixture.

- These are demo acceptance limits, not enterprise-scale claims.

## Test strategy

- Schema/contract fixture for each platform adapter; an actual response/error

  contract test for the selected live proof.

- Golden Case fixture and state hashes at every significant event prefix.

- Resume test in a separate Runtime invocation with no repeated effect.

- Cross-scope Memory rejection and provenance display test.

- Agent Identity allow plus wrong-role/wrong-Case denial tests.

- Gateway route plus direct-bypass rejection test.

- Armor benign plus injection block/sanitize and no-downstream-use invariant.

- Duplicate, late-event, reconnect, poison payload, stale approval, duplicate

  Intervention, model timeout, and unknown Runtime result fault tests.

- Ten consecutive recorded governed-Case runs before recording; three

  consecutive bounded runs for the selected live proof if enabled.

## Open points

1. Exact platform APIs, event schemas, quotas, and regional availability.

2. Agent Runtime wait/resume/control and authoritative result semantics.

3. Case-level sequence allocator implementation across Sessions.

4. Memory provenance/scoping fields supplied natively versus by FleetScope.

5. Agent Gateway route-policy evidence shape.

6. Authentication for private live demo and evidence export signing.

7. Protected ERP side-effect classification and approval policy.

## Links

- [Product requirements](../requirements/[fleetscope.md](http://fleetscope.md))

- [Budget-constrained demo design]([budget-demo.md](http://budget-demo.md))

- [Enterprise fleet lifecycle](../requirements/fleetscope/[enterprise-fleet.md](http://enterprise-fleet.md))

- [Audit and replay](../requirements/fleetscope/[audit-and-replay.md](http://audit-and-replay.md))

- [Fleet Cockpit](../requirements/fleetscope/[fleet-cockpit.md](http://fleet-cockpit.md))

- [Warden intervention](../requirements/fleetscope/[warden-intervention.md](http://warden-intervention.md))

- [UI/UX plan](../product/[ui-ux-plan.md](http://ui-ux-plan.md))

- [Glossary](../requirements/[glossary.md](http://glossary.md))

