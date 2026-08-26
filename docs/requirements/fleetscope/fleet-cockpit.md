# Fleet Cockpit requirements

Status: draft  

Last updated: 2026-08-26

## User need

An Operator or security reviewer needs one surface that connects a business

Case to its live agent topology, long-running state, platform-control evidence,

incidents, approvals, and historical reconstruction. A procurement manager may

open this surface from a Case but should not need it for routine status checks.

## Placement within the product

The Fleet Cockpit is the third major product surface after Agent Catalog and

Case Workspace. It MUST preserve the selected Case and Event Cursor in the URL

or route state so users can deep-link from an approval, memory, policy, or audit

record.

## Information hierarchy

The Cockpit MUST prioritize:

1. Case identity, business milestone, and live/historical mode;

2. action required, active security finding, or incident;

3. current agent branch and waiting condition;

4. Registry, Runtime, Memory, Identity, Gateway, and Armor evidence;

5. detailed tool, policy, cost, and Intervention records.

Decorative animation MUST NOT obscure approval, denial, unknown, or failed

states.

## Layout

- **Global navigation:** Catalog, Cases, Approvals, Fleet Cockpit, Audit.

- **Case header:** vendor, Case ID, Agent Version, owner, runtime state, last

  progress, next milestone, total cost estimate, live/historical indicator.

- **Left rail:** agent tree/fleet nodes and optional Case milestones; Registry

  metadata appears as the version actually used.

- **Center canvas:** the pinned FleetScope WASM/Ratzilla Cockpit projection with

  agent branches, tool chips, animated work edges, follow camera, and

  event-indexed replay. Enterprise platform decisions appear as named tool

  events in the graph and are joined to FleetScope-native evidence by stable

  event IDs.

- **Cockpit evidence rail:** an Astro/DOM layer beside the reused canvas that

  presents Memory, Identity, Gateway, Armor, Runtime, and Warden evidence. It

  MUST remain synchronized with the selected event or scripted phase even when

  the underlying Rust renderer has no platform-specific node type.

- **Right evidence drawer:** facts and Decision Evidence for the selected node,

  edge, event, incident, approval, or platform decision.

- **Bottom timeline:** event-indexed scrubber with milestone, memory, identity,

  gateway, armor, incident, approval, and Intervention markers.

## Graph requirements

- Each agent node MUST show name/role, immutable Agent Version, lifecycle state,

  current tool or waiting reason, tool count, token output, and estimated cost

  when known.

- Unknown data MUST render as unknown, not zero.

- Protected tool nodes MUST display the identity/policy state of the current or

  selected request.

- External-input edges MUST show their Model Armor Decision.

- Delegation edges MUST show that the route passed through Agent Gateway and

  expose route-policy evidence.

- Memory reads/writes MUST be represented as provenance-bearing events or

  connections, not as unexplained context changes.

- Edge type, direction, and state MUST be distinguishable without color alone.

- Animation MAY show accepted live activity; historical mode MUST not look live.

- Tool chips MUST show pending duration live and recorded duration historically,

  with succeeded, failed, denied, blocked, and cancelled states.

- Follow camera MUST have a visible control and keyboard shortcut; it MUST pause

  when the user manually navigates or inspects history.

## Platform evidence language

The Cockpit MUST use compact chips/badges tied to actual evidence:

- `REG v1.4 approved` — the running Agent Version;

- `MEM recalled 3` — provenance-visible Memory Bank reads;

- `ID allowed` / `ID denied` — protected access decision;

- `GW routed` / `GW denied` — delegation routing decision;

- `ARMOR allowed` / `blocked` / `sanitized` — screened external input;

- `WARDEN recommended` / `acted` — incident-response state.

A badge MUST NOT appear merely because the service is configured. Selecting it

MUST open the exact corresponding evidence.

## Timeline requirements

- The primary scrubber MUST allocate position by Canonical Event sequence, not

  proportional wall-clock time.

- Case milestone separators MUST communicate simulated or real day boundaries

  while timestamps remain visible.

- New events arriving during historical inspection MUST not move the Event

  Cursor; show an unread count and explicit **Return to live**.

- Marker types MUST be independently filterable and keyboard reachable.

- Selecting a marker MUST focus the affected graph branch and open evidence

  without erasing broader Case context.

## Evidence drawer

The drawer MUST show applicable recorded facts:

- stable Case, event, agent, operation, input, decision, and policy IDs;

- Agent Registry owner, version, capabilities, risk class, and approval state;

- Agent Runtime state transition and authoritative operation result;

- Memory Bank fact, provenance, scope, and retrieval reference;

- user, agent, and service identities plus allow/deny decision;

- Gateway source/destination Agent Versions, route, policy, and outcome;

- Model Armor screened-input reference, action, and policy version;

- tool request, timing, redacted arguments, result, and error/denial summary;

- Incident Candidate, policy disposition, Warden rationale, authorization,

  Intervention request, acknowledgement, and terminal result.

The drawer MUST say **Decision Evidence**, **rationale**, or **summary**, not raw

reasoning chain or hidden chain-of-thought.

## Accessibility and performance

- All investigation, filtering, replay, and approval tasks MUST be keyboard

  usable and have visible focus.

- State and severity MUST not rely on color alone.

- Motion MUST honor reduced-motion preference.

- Desktop demo target is 1440×900 and MUST remain usable at 1280×720.

- The demo topology SHOULD sustain at least 45 frames per second on the

  presentation machine.

## Acceptance scenarios

1. From Case Workspace, open the Cockpit and identify vendor, milestone, Agent

   Version, current waiting condition, and next action without searching logs.

2. Select the ERP tool edge and distinguish a valid identity allow from an

   invalid-role denial.

3. Select the Logistics Agent edge and show Gateway source, destination, route

   policy, and result.

4. Select a blocked vendor-email marker and prove Model Armor acted before any

   memory write or tool request.

5. Scrub before and after the simulated multi-day resume and inspect the Memory

   Bank fact that persisted with provenance.

6. While paused historically, accept five new events; retain the cursor and

   return to live without gaps or duplicate animation.

7. Complete all core tasks with keyboard and reduced motion.

## Open points

- Final visual identity and whether FleetScope is the final public name.

- Whether Memory Bank appears as a graph node or only timeline/evidence events.

- Maximum graph size before branches collapse into groups.

- Whether procurement users see a simplified Cockpit mode by default.

## Links

- [Product requirements](../[fleetscope.md](http://fleetscope.md))

- [Enterprise fleet lifecycle]([enterprise-fleet.md](http://enterprise-fleet.md))

- [Audit and replay]([audit-and-replay.md](http://audit-and-replay.md))

- [Warden intervention]([warden-intervention.md](http://warden-intervention.md))

- [UI/UX plan](../../product/[ui-ux-plan.md](http://ui-ux-plan.md))

- [System design](../../design/[system.md](http://system.md))

