# FleetScope glossary

Status: accepted normative terminology for requirements, design, interfaces,

and code

Scope: FleetScope agent discovery, long-running Case orchestration, platform

security, observability, replay, and response. Related requirements are indexed

in [Requirements]([README.md](http://README.md)).

## Product and actors

### FleetScope

The product comprising Agent Catalog, Case Workspace, Approval Inbox, Fleet

Cockpit, Audit, platform adapters, Audit Store, Session Projector, Policy Engine,

and Warden. FleetScope is not merely the graph UI and is not a replacement for

Gemini Enterprise Agent Platform.

### Procurement Manager

The business user responsible for starting and progressing a Vendor Onboarding

Case. This role does not receive fleet-administration or unrestricted tool

permissions merely because it launched the Case.

### Fleet Administrator

The person responsible for agent publication, version approval, invocation

policy, and fleet containment. It is distinct from the Procurement Manager and

the service identities that execute work.

### Operator

A person supervising live Cases and investigating or approving Interventions.

An Operator is not necessarily the agent author or Fleet Administrator.

### Judge

The evaluator who must verify FleetScope in a short demonstration. Judge is a

demo persona, not an authorization role.

## Fleet lifecycle

### Gemini Enterprise Agent Platform

The external platform family providing Agent Registry, Agent Runtime, Memory

Bank, Agent Identity, Agent Gateway, Model Armor, and Agent Observability.

FleetScope composes these capabilities; it does not rename or replace them.

### Agent Registry

The platform authority for registered agent identity, publication, version, and

capability metadata. FleetScope may add clearly identified business metadata,

but MUST NOT invent a Registry approval or version result.

### Agent Catalog

The FleetScope discovery surface backed by Agent Registry metadata. It exposes

approved purpose, owner, immutable Agent Version, capabilities, risk, tools,

and launch eligibility. It is not a generic marketplace.

### Agent Version

An immutable registered version of an agent definition, capabilities, tools,

and policy-relevant metadata. A running Case remains bound to its selected

Agent Version even if a newer version is published.

### Case

The durable business record for one vendor-onboarding objective across multiple

runtime invocations, waits, approvals, and Sessions. A Case owns milestones,

business status, context scope, correlations, and the version initially

launched. A Case is not synonymous with a single trace or process.

### Session

One causally related runtime invocation or resumed execution segment within a

Case, with a stable Session ID and canonical event sequence. A Case may contain

several Sessions across days; unrelated Cases MUST NOT share a Session sequence.

### Agent Runtime

The platform authority that starts, waits, resumes, and controls agent

execution. It determines whether a requested retry, cancel, or reroute occurred;

FleetScope MUST NOT infer runtime success from request intent.

### Memory Bank

The platform service that persists and retrieves scoped context across runtime

invocations. It stores Memory Records; it does not make their contents trusted

instructions or grant access to other Cases.

### Memory Record

A provenance-bearing fact persisted or recalled through Memory Bank. It has a

source, scope, actor, time, and retrieval reference where supported. A Memory

Record is untrusted data, not executable instruction or proof of truth.

### Agent Identity

The verifiable identity and authorization context of an acting agent. It is

distinct from user identity and service identity even if one deployment

temporarily holds credentials for several roles.

### Agent Gateway

The platform routing and policy boundary for agent-to-agent delegation. It is

the authority for Gateway Decisions; it is not a visual edge or a replacement

for destination-agent authorization.

### Model Armor

The external-input screening boundary that produces Model Armor Decisions. It

acts before downstream context, memory, or tools; it is not a general approval

engine for business actions.

### Agent Observability

The audit-log and distributed-trace capability that records execution and

decision evidence across a Case. FleetScope uses its OpenTelemetry evidence but

does not equate a trace with hidden chain-of-thought or invent missing spans.

### Protected ERP Adapter

The synthetic or real private inventory-system boundary that independently

validates Agent Identity and requested scope. It is authoritative for resource

access in the demo and is not controlled by browser state.

### Gateway Decision

The recorded Agent Gateway result for a delegation: source Agent Version,

destination Agent Version, requested capability, route/policy version, and

allow/deny outcome. It is not merely an animated edge.

### Model Armor Decision

An allow, block, sanitize, or flag result for external input before that input

reaches agent context, Memory Bank, or tools. The UI badge represents a recorded

decision, not that Model Armor is configured.

## Event and replay

### Source Event

A fact emitted by Runtime, Registry, Memory Bank, Identity enforcement, Gateway,

Model Armor, tool gateway, usage meter, or control plane. Source Events may

arrive late, duplicated, or out of order and are not replay authority.

### Canonical Event

An immutable, schema-versioned event accepted into a Session's total order.

Each has a stable event ID and monotonic Session sequence and is the only input

to deterministic projection and replay.

### Audit Store

The append-only logical store of Canonical Events. Firestore may implement it,

but the term names the evidence responsibility rather than the database.

### Session Projector

A versioned pure reducer that converts a Canonical Event prefix into Observable

Case State. It does not re-execute tools, models, policies, or external effects.

### Observable Case State

The Case state derivable from Canonical Events: milestones, Session/runtime

state, topology, tools, memory references, platform decisions, metrics,

incidents, approvals, and Interventions. It is not hidden chain-of-thought or

unrecorded external reality.

### Event Cursor

The selected Canonical Event sequence position. Moving it changes the projected

view without changing evidence or causing side effects.

### Decision Evidence

The inspectable facts, identities, platform decisions, policy match, concise

rationale when available, action request, authoritative result, and

correlations explaining a decision. It MUST NOT claim to expose private or

unavailable chain-of-thought.

## Experience surfaces

### Case Workspace

The procurement-oriented surface showing business milestones, last progress,

waiting condition, next action, approvals, and trusted-context summary. It is

not the detailed telemetry canvas.

### Approval Inbox

The surface for reviewing an exact, immutable, expiring action request and its

Decision Evidence. It does not grant a reusable permission to “let the agent

continue.”

### Fleet Cockpit

The expert browser surface for live Case supervision, platform-decision

inspection, exact observable-state replay, incident response, and approval. It

is not itself the control or authorization authority.

### Audit

The Case-level evidence query and export surface. It reports recorded facts and

known gaps; it is not proof of unrecorded behavior or regulatory immutability.

## Operations and control

### Incident Detector

The deterministic rules and metrics layer that creates Incident Candidates. It

handles obvious patterns before optional model interpretation.

### Incident Candidate

A versioned finding that something may need attention. It is not proof of a

defect and does not authorize action.

### Policy Engine

The component that maps evidence, identity, severity, side-effect class, and

authorization context to observe, recommend, request approval, or auto-act. Its

result is recorded as Decision Evidence.

### Warden

The policy-constrained incident-response actor that evaluates evidence and

requests an Intervention. It may use a model for ambiguous classification, but

model output alone is never authorization.

### Intervention

A uniquely identified, policy-authorized request to change Agent Runtime, such

as retry, cancel, reroute, or escalate. Requested, acknowledged, and confirmed

states remain distinct.

### Control Adapter

The only integration that translates an authorized Intervention into a Runtime

operation and reports its authoritative result. It MUST be idempotent for an

Intervention ID.

### Kill

A demo-friendly but imprecise label. Requirements and interfaces use **cancel**

or **terminate** to distinguish graceful and forced operations.

