# Warden intervention requirements

Status: draft  

Last updated: 2026-08-26

## User need

An Operator needs common, bounded agent failures detected quickly and handled

consistently inside a long-running Case, without granting a probabilistic model

unrestricted control over Runtime, memory, protected data, budget, or side

effects. Identity, Gateway, and Model Armor denials remain authoritative

platform decisions and MUST NOT be bypassed by Warden.

## Incident classes

The MVP MUST detect:

1. **Repeated tool failure:** the same normalized tool/error class exceeds a

   configured count in a configured event window.

2. **No-progress loop:** a repeating normalized action signature occurs without

   a recorded progress event beyond a configured threshold.

3. **Usage threshold breach:** cumulative usage or estimated cost crosses a

   configured per-agent or per-Session threshold.

The MVP SHOULD surface **context drift** as an advisory Incident Candidate only.

It MUST NOT auto-act on context drift until the team defines measurable ground

truth and demonstrates acceptable false-positive performance.

## Control model

- Incident detection MUST be separable from authorization and execution.

- Each Incident Candidate MUST include detector ID/version, evidence event IDs,

  severity, confidence where relevant, and suggested action class.

- The Policy Engine MUST choose exactly one disposition: observe, recommend,

  approval-required, or auto-act.

- A model classification MUST be treated as untrusted advisory input to the

  Policy Engine.

- Automatic actions MUST come from an allowlist of bounded action templates

  with parameter constraints.

- Destructive, externally visible, high-cost, or ambiguous actions MUST require

  Operator approval in the MVP.

- The Control Adapter MUST enforce authorization independently; UI or Warden

  claims are insufficient.

## MVP action matrix

| Incident | Default response | Auto-action eligibility |

|---|---|---|

| First isolated tool failure | Observe | Never |

| Repeated idempotent read-tool failure | Retry once with bounded backoff and corrected instruction | Allowed only in demo policy |

| No-progress loop | Cancel affected child agent and recommend reroute | Cancel may auto-act if the child has no external side effect in flight; reroute requires approval |

| Usage threshold breach | Pause/cancel affected agent and escalate | Approval-required by default |

| Context drift advisory | Explain evidence and recommend review | Never in MVP |

| Injection blocked by Model Armor | Prevent input propagation and record incident | Screening layer enforces; Warden observes/escalates |

Warden MUST NOT retry around an Identity denial, Gateway denial, or Model Armor

block with altered credentials, routes, or input unless an Operator approves a

separately governed policy change outside the incident action.

## Intervention lifecycle

Every Intervention MUST transition through recorded states:

`proposed → authorized | rejected → requested → acknowledged → succeeded | failed | timed_out`

- The same Intervention ID MUST NOT execute more than once even under message

  redelivery or Warden restart.

- Retry of a failed Intervention MUST create a new Intervention ID linked to the

  original.

- An action shown as succeeded MUST be backed by an authoritative Agent Runtime

  result, followed when possible by a health/progress event.

- The Warden MUST stop after configured attempts and escalate rather than loop

  indefinitely on its own remediation.

- Human approval MUST bind the exact action template, target, parameters,

  evidence revision, and expiry.

## Decision Evidence

For every recommendation or action, FleetScope MUST record:

- evidence event IDs and current Session sequence;

- detector and policy versions;

- severity and relevant thresholds;

- concise rationale safe for operator display;

- model name and response reference if model classification was used;

- authorization source and approver when applicable;

- Control Adapter request and authoritative result;

- follow-up state indicating recovered, unresolved, or escalated.

## Safety and operational constraints

- Warden service credentials MUST use least privilege and MUST NOT include

  broader cloud administrative permissions.

- Warden MUST NOT write recalled content into Memory Bank as trusted fact

  without the normal provenance and approval path.

- Tool arguments, prompt contents, and model output MUST be treated as untrusted

  data and MUST NOT be interpolated into control commands.

- Policy versions MUST be immutable once used by an Intervention.

- A global demo kill switch MUST disable new automatic actions while preserving

  event capture and recommendations.

- Rate and budget limits MUST apply to Warden model calls and actions.

- Warden unavailability MUST not stop Source Event ingestion or human

  investigation.

## Acceptance scenarios

1. A fixture produces three identical idempotent tool failures. One incident is

   opened; policy authorizes one retry; duplicate delivery does not cause a

   second retry; the runtime result closes or escalates the incident.

2. A repeating no-progress signature triggers cancellation. If an external

   write is marked in flight, policy changes to approval-required.

3. A cost threshold is breached. The Warden records a recommendation, but no

   control call occurs without approval under the default policy.

4. The Warden model returns malicious or malformed action text. The Policy

   Engine rejects it because it is not a valid allowlisted action template.

5. Disable the Warden. Live capture, replay, incident inspection, and manual

   escalation remain usable.

6. Click an Intervention marker after completion. Every lifecycle transition

   and linked evidence item is inspectable.

## Open points

- The one action safe and reliable enough to auto-act in the live demo.

- The source of side-effect classification for tools.

- Threshold defaults and whether the demo exposes them as policy configuration.

- Human approval channel: Cockpit only or an external enterprise channel.

## Links

- [Product requirements](../[fleetscope.md](http://fleetscope.md))

- [Enterprise fleet lifecycle]([enterprise-fleet.md](http://enterprise-fleet.md))

- [Audit and replay]([audit-and-replay.md](http://audit-and-replay.md))

- [Fleet Cockpit]([fleet-cockpit.md](http://fleet-cockpit.md))

- [System design](../../design/[system.md](http://system.md))

