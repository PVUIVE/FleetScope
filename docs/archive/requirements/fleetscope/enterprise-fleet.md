# Enterprise fleet lifecycle requirements

Status: draft  

Last updated: 2026-08-26

## User need

A procurement manager needs to discover, trust, launch, resume, and supervise an

approved agent without understanding the underlying platform services. A fleet

administrator and security reviewer need the same Case to prove version,

identity, routing, memory, screening, and runtime enforcement.

## Agent discovery and versioning

- The Agent Catalog MUST show the approved Vendor Onboarding Orchestrator with

  display name, business purpose, owner, version, publication/approval state,

  risk class, capabilities, required tools, allowed callers, and last update.

- Launch MUST bind the Case to the selected immutable Agent Version.

- A later registry update MUST NOT silently change a running Case.

- Deprecated or unapproved versions MUST not be launchable by an unauthorized

  procurement manager.

- The Case and audit view MUST show the version actually used, not only the

  latest catalog version.

## Long-running Case execution

- Starting the agent MUST create a stable Case ID and runtime operation ID.

- The Case MUST support running, waiting-for-event, waiting-for-approval,

  paused, resuming, completed, failed, and cancelled states.

- The runtime MUST resume from persisted Case state after a simulated multi-day

  boundary or process restart without replaying completed external effects.

- Vendor webhooks, approvals, and scheduled checks MUST correlate to the Case.

- The user MUST see the next required action, last meaningful progress, and

  expected waiting condition without opening the telemetry graph.

## Memory Bank

- Approved negotiation facts, vendor identifiers, decisions, and constraints

  MUST persist across separate runtime invocations of the same Case.

- Every recalled memory shown or used MUST expose source, author/actor, Case or

  tenant scope, created/updated time, and retrieval reference when available.

- Recalled memory MUST be treated as data, not executable instruction.

- A Case MUST NOT retrieve memory outside its authorized scope.

- The demo MUST prove one required fact survives the simulated multi-day pause

  and influences a later step.

## Agent Identity and private ERP access

- Each agent and protected tool request MUST carry a verifiable Agent Identity

  tied to the Case, Agent Version, and permitted role.

- The synthetic ERP adapter MUST independently authorize the identity and

  requested inventory scope.

- Missing, expired, wrong-role, or wrong-Case identity MUST produce a denial and

  Canonical Event; the UI MUST not report it as a tool failure alone.

- User identity, agent identity, and service identity MUST remain distinct in

  Decision Evidence even if one deployment process holds several roles.

## Agent Gateway delegation

- Delegation to the Logistics Agent MUST traverse Agent Gateway rather than a

  direct internal call.

- Gateway evidence MUST record source Agent Version, destination Agent Version,

  Case, route/policy version, requested capability, and allow/deny outcome.

- Gateway denial MUST return a safe error to the coordinator and open an

  inspectable policy finding.

- Destination selection MUST be explainable by registered capability and route

  policy, not an opaque UI edge.

## Model Armor

- Vendor email bodies, attachment text, and webhook payloads MUST be screened

  before entering agent context, Memory Bank, or tool arguments.

- The screening result MUST distinguish allow, block, sanitize, and flag when

  supported and record the policy/version used.

- A prompt-injection fixture attempting to change tools or disclose ERP data

  MUST be blocked or sanitized before downstream use.

- The Fleet Cockpit badge MUST link to the exact screened input and decision;

  presence of an integration alone MUST not produce a badge.

## Agent Observability

- OpenTelemetry spans and explicit domain events MUST correlate to stable Case,

  Session, Agent Version, agent, tool, input, memory, policy, and operation IDs.

- Long-running waits and resumed Sessions MUST remain connected in the Case

  trace without pretending one process stayed alive continuously.

- Audit logs MUST include platform allow/deny decisions and authoritative

  Runtime results, not only model/tool timings.

- When the platform exposes reasoning or decision traces, FleetScope MUST store

  and display only permitted structured Decision Evidence: objective, referenced

  inputs, concise decision summary, model/version, policy, action, and result.

  It MUST NOT promise unavailable private chain-of-thought.

- Sampling, missing spans, or redacted evidence MUST be shown as gaps/unknowns;

  FleetScope MUST NOT infer absent reasoning or enforcement.

## Cross-capability audit

- One Case evidence view MUST answer: who launched which Agent Version; which

  identities were used; what memory was recalled; which gateway route was

  allowed; which content was screened; which agents/tools acted; and what

  runtime result followed.

- Correlation across platform services MUST use stable Case, agent, operation,

  tool, input, and decision identifiers.

- Missing evidence from a platform capability MUST render as missing/unknown,

  never assumed allowed.

## Acceptance scenarios

1. Discover and launch the approved orchestrator; attempt to launch a deprecated

   version and observe a policy denial.

2. Pause the Case after negotiation terms are saved; resume in a new runtime

   invocation; show the same approved term with provenance and no repeated ERP

   write.

3. Read allowed inventory with valid Agent Identity; repeat with wrong role and

   show a distinct identity-policy denial.

4. Delegate a logistics check through Gateway; show selected destination and

   route policy in both Case activity and Cockpit evidence.

5. Process a benign vendor message and an injection fixture; show allow and

   block/sanitize decisions before any memory or tool call.

6. Export a single Case audit view containing all seven platform proofs with

   stable correlations.

7. Follow the Case across its wait/resume boundary and show one continuous

   logical trace with separate Runtime Sessions and explicit evidence gaps.

## Open points

- Exact service APIs, schemas, and availability in the target project.

- Whether Agent Registry supports approval/risk metadata directly or FleetScope

  must maintain supplemental catalog metadata.

- How simulated days are represented without misleading the Judge.

- Whether the ERP adapter is read-only or includes one approval-gated write.

## Links

- [Product requirements](../[fleetscope.md](http://fleetscope.md))

- [Fleet Cockpit]([fleet-cockpit.md](http://fleet-cockpit.md))

- [Audit and replay]([audit-and-replay.md](http://audit-and-replay.md))

- [System design](../../design/[system.md](http://system.md))

