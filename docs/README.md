# FleetScope product documentation

Status: draft working set

FleetScope is an enterprise agent-fleet control plane for discovering approved

agents and operating durable, policy-enforced business Cases. Its Fleet Cockpit

makes Registry, Runtime, Memory, Identity, Gateway, Model Armor, observability,

and bounded Warden actions visible and auditable.

## Read this set

1. [Product plan](product/[product-plan.md](http://product-plan.md)) — positioning, users, outcomes,

   assumptions, competition, launch, and product decisions.

2. [UI/UX plan](product/[ui-ux-plan.md](http://ui-ux-plan.md)) — Agent Catalog, Case Workspace,

   approvals, Fleet Cockpit, visual system, and demo flow.

3. [Context intake](product/[context-intake.md](http://context-intake.md)) — the facts and artifacts still

   needed to turn the draft into an evidence-backed active plan.

4. [Requirements entry point](requirements/[fleetscope.md](http://fleetscope.md)) — product contract,

   scope, success criteria, and capability map.

5. [Glossary](requirements/[glossary.md](http://glossary.md)) — normative names and boundaries.

6. [System design](design/[system.md](http://system.md)) — components, event protocol, Warden

   control loop, security, and failure handling.

7. [USD 35 demo design](design/[budget-demo.md](http://budget-demo.md)) — browser visualization reuse,

   static-first architecture, scenario compiler, credit guardrails, and slices.

8. [Six-day delivery plan](plans/[six-day-delivery.md](http://six-day-delivery.md)) — work breakdown,

   milestones, owners, gates, and cuts.

9. [Demo and validation plan](plans/[demo-validation.md](http://demo-validation.md)) — the proof the team

   must capture for judges and for internal acceptance.

10. [Zoetrope audit and implementation plan](plans/zoetrope-audit-and-implementation-plan.md) —

    the renderer decision, and the four points where the plan was wrong.

11. [Implementation report, 2026-08-26](reports/fleetscope-end-to-end-implementation-2026-08-26.md) —

    **what was actually built, with real command output.** Read this before

    trusting any status claim in the plans above.

12. [Decisions](decisions/) — 0001 tooling · 0002 renderer boundary (resolved) ·

    0003 bounded live path · 0004 render manifest · 0005 redaction boundaries.

The requirements use **MUST**, **SHOULD**, and **MAY** as normative terms.

MUST is required for the MVP to conform; SHOULD is the default unless a

documented tradeoff is accepted; MAY is optional.

