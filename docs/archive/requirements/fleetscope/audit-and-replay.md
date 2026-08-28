# Audit and replay requirements

Status: draft  

Last updated: 2026-08-26

## User need

An Operator investigating a live or completed Case needs to move to any

recorded causal point and see the same Observable Case State every time,

even when telemetry was duplicated, delayed, or received out of order.

## Required behavior

### Canonicalization

- Every Source Event MUST be validated against a versioned schema before

  canonical acceptance.

- Canonical acceptance MUST assign or verify a stable event ID, Case ID, Session

  ID, monotonic Session sequence, and deterministic Case-level order.

- Redelivery of the same logical Source Event MUST be idempotent.

- Source time, ingestion time, and canonical acceptance time MUST remain

  distinguishable.

- Late Source Events MUST be either inserted through an explicit

  re-canonicalization procedure that creates a new stream revision, or

  represented by a later correction event. The system MUST NOT silently mutate

  a previously certified sequence.

- The system MUST record correlations for Agent Version, runtime operation,

  Memory Record, identity decision, Gateway Decision, Model Armor Decision,

  parent/child agent, tool call, incident, policy, and Intervention where

  applicable.

- Sensitive prompts, credentials, and tool payloads MUST be redacted or

  referenced by access-controlled digest before persistence.

### Replay

- The Session Projector MUST be a versioned deterministic function of a Case

  canonical stream revision, Event Cursor, and projector version.

- Replaying a prefix MUST NOT execute a model, tool, network call, or control

  action.

- The projected-state hash for a fixed fixture and Event Cursor MUST be stable

  across repeated runs of the same projector version.

- The UI MUST disclose the stream revision and projector version used for a

  replayed state.

- Returning from historical state to live mode MUST not skip accepted events.

- The replay claim MUST be described as exact reconstruction of Observable

  Case State. Copy and demos MUST NOT describe it as exact replay of hidden

  thought or external reality.

### Evidence

- Canonical Events MUST be append-only to application actors.

- Privileged corrections MUST produce auditable correction events rather than

  overwrite evidence.

- Each Intervention MUST link its trigger evidence, detector version, policy

  version, request, runtime acknowledgement, and terminal result.

- An exported demo evidence bundle MUST include the canonical events, schema

  versions, projector version, projected terminal-state hash, and an integrity

  manifest.

- If full cryptographic tamper evidence is not implemented, the UI and demo

  MUST label the guarantee accurately as application-level immutability.

### Timeline

- The primary scrubber MUST allocate position by Canonical Event sequence.

- The timeline MUST show wall-clock timestamps and visibly represent long idle

  gaps without allocating proportional horizontal space.

- Milestone, Registry, Memory, Identity, Gateway, Armor, Incident, Approval, and

  Intervention markers MUST be independently filterable and keyboard reachable.

- Selecting a marker MUST move the Event Cursor to the relevant event and open

  its Decision Evidence.

## Event types required for the demo

At minimum: Case created/milestone changed; Agent Version resolved; Session and

Runtime started/waiting/resumed/completed; Memory Record written/recalled;

identity allowed/denied; Gateway routed/denied; Model Armor

allowed/blocked/sanitized; agent spawned/started/completed/failed; tool

requested/succeeded/failed; usage recorded;

incident opened/updated/resolved; policy evaluated; intervention proposed,

approved/rejected, requested, acknowledged, succeeded/failed; and human

escalation opened/resolved.

## Acceptance scenarios

1. Ingest a fixture with duplicate and out-of-order Source Events. The

   resulting canonical sequence contains no duplicates and replay produces the

   expected state hash.

2. Move the Event Cursor before and after a multi-day resume, memory recall,

   identity decision, Armor block, and agent failure. Case Workspace, graph,

   tools, platform badges, incidents, and evidence all match each prefix.

3. Disconnect the live client, accept additional events, and reconnect. The

   client resumes from its last canonical sequence and converges without

   duplicate visual actions.

4. Request an Intervention, then replay the Case. Historical replay shows

   the request and outcome but does not invoke the Control Adapter again.

5. Attempt to persist a payload containing a configured secret fixture. The

   stored event contains a redaction marker/digest and no raw secret.

## Open points

- Whether stream revisioning is required for MVP or all late facts can be

  represented as correction events.

- The integrity mechanism for the demo bundle: manifest hashes only, signed

  manifest, or managed immutable archive.

- Retention and deletion behavior beyond the short-lived demo environment.

## Links

- [Product requirements](../[fleetscope.md](http://fleetscope.md))

- [Enterprise fleet lifecycle]([enterprise-fleet.md](http://enterprise-fleet.md))

- [Glossary](../[glossary.md](http://glossary.md))

- [System design](../../design/[system.md](http://system.md))

