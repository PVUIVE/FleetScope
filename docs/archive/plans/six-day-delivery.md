# FleetScope six-day delivery plan

Status: draft  

Last updated: 2026-08-26

## Delivery objective

By day 5 noon, one deterministic Recorded Vendor Onboarding Case must reliably

complete, with one optional bounded live decision appended into the same flow:

`discover version → launch → wait/resume → recall memory → authorize ERP →

route delegation → screen external input → Warden recovery → replay/audit`

Day 6 is reserved for recording, truthfulness review, submission, and buffer.

## Definition of done

- Each recommended enterprise platform capability changes the same Case and

  emits selectable evidence whose mode is explicitly real, recorded, or

  simulated.

- The Case resumes in a separate Runtime invocation without repeating a

  completed effect.

- The blocked injection produces no downstream context, memory, or tool use.

- Invalid Agent Identity and disallowed Gateway route are rejected outside UI.

- One Warden Intervention projects exactly once and has an authoritative

  recorded result; if selected for the live proof, Runtime also confirms it.

- Case Workspace and Fleet Cockpit derive from the same Canonical Events.

- Golden replay, failure fixtures, and ten consecutive recorded Cases pass;

  the optional live proof passes three consecutive bounded runs.

- Public fallback is recorded/read-only; unsupported or simulated behavior is

  labeled.

## Workstreams

| Workstream | Owns |

|---|---|

| Product/demo | track evidence map, scope cuts, scenario, script, truthfulness |

| Agent/Runtime | orchestrator, logistics agent, wait/resume, control result |

| Enterprise platform | Registry, Memory, Identity, Gateway, Armor adapters |

| Event/control | canonical events, projector, policy, Warden, evidence export |

| Frontend/UX | Astro shell, Catalog, Case Workspace, reused WASM Cockpit, evidence rail |

| Cloud/reliability | Static deployment, optional bounded live API, secrets, smoke/fallback |

One person may own several workstreams, but each must have a named owner before

day 1 work begins.

## Day 1 — verify the platform and lock the Case contract

Outcome: the pinned browser fork builds, every planned service has an

availability/schema classification, and one bounded live proof is selected.

- Verify official track, rubric, deadline, allowed services/models, and public

  demo requirements against live sources.

- Confirm exact APIs, product names, regions, quotas, credentials, and output

  schemas for Registry, Runtime, Memory Bank, Identity, Gateway, Model Armor,

  and Observability/OTel without calling all of them by default.

- Select the strongest one-call live proof. Treat all other services as

  recorded adapters until a no-cost/local proof exists.

- Represent the Vendor Onboarding Orchestrator and Logistics Agent in the

  canonical fixture; publish/resolve them live only if Registry is selected for

  the bounded proof.

- Define Case ID, Session ID, Agent Version, operation, input, memory, identity,

  route, policy, and event correlations.

- Pin the inspected MIT browser core; keep required attribution in the source

  repository's license notices, outside FleetScope product navigation.

- Install `trunk`, run upstream tests, and build the browser/WASM app locally.

- Keep cloud resources off; provision only an optional min-zero/max-one live API

  after the complete recorded path works.

- Generate `registry.version_resolved` and `case.created` fixture events;

  canonicalize and show them through the existing browser boundary.

- Scaffold FleetScope Catalog/Case/Audit routes in the existing Astro shell.

- Define the Scenario Compiler and evidence-manifest contract used to feed the

  reused browser load/append boundary.

**Gate A:** the forked browser app builds and replays upstream evidence; a saved

evidence sheet classifies each platform capability and records the selected

bounded live proof. Any unavailable service gets an honest recorded/simulated

adapter decision—never a fake integration badge.

## Day 2 — prove discovery, long-running Runtime, and Memory

Outcome: a user launches the approved Agent Version, the Case waits, resumes in

a new invocation, and recalls a required fact with provenance.

- Implement minimal Agent Catalog card/detail and Start Case flow.

- Implement the Orchestrator Case states: running, waiting, resuming, approval

  required, completed/failed/cancelled.

- Persist one approved negotiation term in the fixture's Memory Bank adapter;

  use the real service only if it is the selected live proof.

- End the first invocation; resume from a simulated vendor webhook/day boundary;

  retrieve the fact and use it in the next step.

- Maintain a completed-effect ledger so resume does not repeat completed work.

- Add Registry/Runtime/Memory events and projector states.

- Implement Case Workspace milestone, last progress, waiting reason, next

  action, and memory provenance card.

**Gate B, noon:** the recorded discovery → launch → separate-session resume →

memory recall path passes deterministically. Any real Runtime/Memory claim must

also have matching live evidence; otherwise the UI and narration say recorded.

## Day 3 — prove security posture and delegation

Outcome: Identity, Gateway, and Model Armor behavior is inspectable and

truthfully labeled; at most the selected capability must execute live.

- Implement synthetic read-only ERP adapter that independently validates Agent

  Identity and scope.

- Show one valid inventory read and one wrong-role or wrong-Case denial.

- Route the Logistics Agent delegation only through Agent Gateway; add a test

  proving direct bypass is rejected or absent.

- Show route destination Agent Version and route-policy result.

- Screen one benign and one adversarial vendor email/webhook before context,

  Memory Bank, or tool use.

- Assert the blocked input has no downstream-use event.

- Add Approval Inbox for one protected action if required by the chosen policy.

- Add platform badges/markers and evidence drawer records.

**Gate C:** Identity allow/deny, Gateway route/deny, and Armor allow/block each

pass in the deterministic scenario with stable Case correlations; the selected

live proof also passes within its call and token caps.

## Day 4 — complete observability, replay, and Warden

Outcome: the full Case becomes understandable and controllable through Fleet

Cockpit.

- Complete Canonical Event deduplication, Session/Case ordering, redaction,

  correction events, and golden Case projection hashes.

- Build Fleet Cockpit graph, tool chips, platform-control edges/badges, event

  scrubber, milestone/day separators, incident markers, follow camera, live/

  historical modes, and Return to live.

- Add repeated read-tool-failure detector, versioned policy, one allowlisted

  recovery, idempotent Control Adapter, attempt budget, and global switch.

- Show requested, acknowledged, and Runtime-confirmed result separately.

- Add Case audit view/export linking all seven platform proofs.

- Test Warden-down, reconnect, duplicate delivery, stale approval, secret

  redaction, and malformed model advice.

**Gate D:** five consecutive recorded governed Cases pass; replay performs zero

side effects; every badge opens evidence and states its execution mode.

## Day 5 — freeze, harden, validate, and rehearse

Outcome: stable submission candidate by noon.

### Before noon

- Fix P0 defects and measured readability/performance failures.

- Run five procurement UX tests and five operator investigation tests.

- Cut P1 before weakening the golden path.

- Feature freeze at noon.

### After noon

- Run 10 consecutive recorded Cases and capture event IDs, state hashes,

  platform decisions, Warden result, and evidence-export result. Run no more

  than three final live rehearsals unless billing proves headroom.

- Rehearse the three-minute segment with a non-builder.

- Record live and prerecorded Case paths.

- Verify captions, viewport, no secrets/PII, simulated-day labeling, and public

  read-only controls.

- Prepare architecture, README, limitations, and rubric-evidence matrix.

**Gate E:** 10/10 run sheet, script within official time, fallback assets, and

one submission owner.

## Day 6 — record and submit with buffer

- Record the strongest take early.

- Edit for comprehension: discover → resume/memory → identity → gateway → armor

  → Cockpit/Warden → replay/audit.

- Remove unsupported “enterprise-scale,” “immutable,” “reasoning chain,”

  “autonomous,” or “production-ready” claims.

- Test every public link logged out and on the presentation machine.

- Submit early enough to recover from upload/form failures.

- Preserve the exact Case fixture, evidence manifest, deployed version IDs,

  captions, and final video checksum.

## Dependency chain

```text

official services + Case correlations

                |

                v

Registry launch -&gt; Runtime wait/resume -&gt; Memory provenance

                |                         |

                v                         v

       Identity-protected ERP      Armor-screened input

                |                         |

                +---- Gateway delegation-+

                            |

                            v

                   Canonical event spine

                       /           \

                      v             v

             Case/Cockpit replay  Detector/Policy/Warden

                                      |

                                      v

                              Runtime-confirmed result

```

## Cut order

1. minimap and decorative motion beyond what the reused Cockpit already gives;

2. fleet-wide dashboard and advanced Catalog filters;

3. policy editor and wall-clock alternate timeline;

4. context-drift advisory and extra incident classes;

5. approval inbox only if the chosen golden action is safe/automatic and the

   product still shows a protected-action denial;

6. Warden model adviser while retaining deterministic detector/policy;

7. optional supplemental metadata not provided by Registry.

Do not cut discovery/version binding, separate-session resume, memory

provenance, Identity enforcement semantics, Gateway routing, Armor screening,

canonical replay, authoritative Warden result evidence, or unified Case

evidence. Those are the track thesis; their execution mode must remain visible.

## Release checklist

- [ ] Official rules and exact platform/model names verified.

- [ ] One schema/reference fixture saved for every platform adapter; one actual

      live response saved for the selected proof.

- [ ] Running Case bound to immutable Agent Version.

- [ ] Separate-invocation resume and no repeated effect proven.

- [ ] Memory provenance and cross-scope rejection proven.

- [ ] Identity allow plus invalid-role/Case denial proven.

- [ ] Gateway route plus no direct bypass proven.

- [ ] Armor benign plus injection block/no-downstream-use proven.

- [ ] Golden replay, duplicate, reconnect, and redaction tests pass.

- [ ] Warden idempotency, attempt budget, global switch, and Runtime result pass.

- [ ] Private live and public read-only modes tested.

- [ ] Ten-run sheet and evidence export complete.

- [ ] Submission acknowledgment captured.

## Links

- [Product plan](../product/[product-plan.md](http://product-plan.md))

- [UI/UX plan](../product/[ui-ux-plan.md](http://ui-ux-plan.md))

- [Product requirements](../requirements/[fleetscope.md](http://fleetscope.md))

- [System design](../design/[system.md](http://system.md))

- [Budget-constrained demo design](../design/[budget-demo.md](http://budget-demo.md))

- [Demo and validation plan]([demo-validation.md](http://demo-validation.md))

