# FleetScope demo and validation plan

Status: draft  

Last updated: 2026-08-26

## Demo promise

One Vendor Onboarding Case proves that an organization can discover an approved

agent, run it asynchronously across simulated weeks, preserve scoped context,

secure private access and delegation, screen untrusted vendor input, observe and

recover a failure, and audit the recorded decisions.

The demo distinguishes real platform behavior, synthetic enterprise data,

simulated time, recorded fallback, and any unsupported capability.

## Golden scenario

**Acme Components onboarding, Case CASE-1042**

- Vendor Onboarding Orchestrator `v1.4` is approved in Agent Registry.

- Procurement manager launches it from Agent Catalog.

- It records negotiated `Net 45` and MOQ `5,000` through Memory Bank.

- Runtime waits for a vendor response; a “Simulated Day 12” webhook resumes a

  new invocation and recalls those facts with provenance.

- A scoped inventory read succeeds under Agent Identity; an invalid-role fixture

  demonstrates denial in evidence or an alternate recorded branch.

- Orchestrator delegates shipping verification through Agent Gateway to the

  registered Logistics Agent.

- A vendor email containing an injection attempt is blocked or sanitized by

  Model Armor before context, memory, or tools.

- The Logistics Agent's read-only carrier tool repeats a deterministic failure;

  Warden policy performs one bounded retry or approved cancellation/reroute.

- Agent Runtime confirms the outcome; the incident resolves or escalates.

- Event scrubber and Case audit reconstruct every platform decision.

## Recommended three-minute segment

Adjust timing to official rules.

### 0:00–0:20 — discover and trust

Show Agent Catalog card: approved status, owner, immutable `v1.4`, capabilities,

risk, protected systems. Click **Start governed case**.

Voiceover: “FleetScope starts before execution: employees discover the approved

agent version and understand what it may access.”

### 0:20–0:50 — long-running state and Memory Bank

Cut to Case Workspace at `Simulated Day 12`. Show waiting → resuming transition,

then the recalled `Net 45`/MOQ fact with source, scope, and timestamp.

Voiceover: “This is a separate runtime invocation using persisted Case context,

not a timer animation or prompt copied from the browser.”

### 0:50–1:15 — zero-trust access and routing

Show ERP inventory read with `ID allowed`, then delegation to Logistics Agent

with `GW routed`. Evidence drawer shows identity role/scope and Gateway source,

destination Agent Versions, route policy, and result.

Mention that invalid identity or disallowed route is rejected by the protected

adapter/Gateway, not by UI convention.

### 1:15–1:40 — Model Armor

Vendor injection fixture arrives. Show `ARMOR blocked` or `sanitized` on the

external-input edge. Evidence states policy/version and `downstream use: none`.

Voiceover: “Untrusted email is screened before agent context, Memory Bank, or

tool arguments.”

### 1:40–2:20 — Fleet Cockpit and Warden

The Logistics Agent repeats a read-tool failure. Incident marker appears and

follow camera focuses the branch. Evidence shows detector threshold, policy,

bounded action, and attempt limit. Show `requested`, `acknowledged`, then

Runtime-confirmed result.

Voiceover: “The model may advise. Versioned policy grants authority, and the

Control Adapter executes one idempotent Runtime operation.”

### 2:20–2:50 — event replay and unified audit

Scrub across Memory recall, Identity allow, Gateway route, Armor block, incident,

and Intervention. Then open the Case audit summary.

Voiceover: “Given the same canonical event prefix and projector version,

FleetScope reconstructs the same observable Case state and hash. It does not

re-run side effects or claim hidden chain-of-thought.”

### 2:50–3:00 — close

“FleetScope makes enterprise agents discoverable, durable, zero-trust,

policy-routed, guarded, observable, and recoverable—inside one real workflow.”

## Judge objection handling

| Question | Evidence-backed answer |

|---|---|

| Is this just a trace viewer? | No. Show Catalog, Case Workspace, Runtime resume, Memory, Identity, Gateway, and Armor behavior before the graph. |

| Are these seven integration logos? | Select each badge and show the authoritative decision/event that changed the same Case. |

| Did weeks really pass? | Explicitly say simulated Case day; prove separate Runtime invocation and persistent Memory reference. |

| Is the ERP real? | Describe synthetic ERP data accurately; show the deterministic identity validation/denial and state whether it is local recorded enforcement or the selected live proof. |

| Can the agent bypass Gateway? | Show the only delegation adapter and a denied/direct-bypass contract test. |

| Can injection reach memory before Armor? | Show event ordering and invariant: blocked input ID has no downstream context/memory/tool event. |

| Does it expose reasoning chain? | No. It exposes Decision Evidence: facts, identities, platform/policy versions, concise rationale, request, result. |

| Is replay exact? | State the bounded observable-state guarantee and show golden prefix/state hashes. |

| Did Warden really act? | Show Intervention ID, Runtime operation ID, idempotency test, acknowledgement, and terminal result. |

| What if Warden fails? | Core platform enforcement, capture, Case Workspace, replay, and manual response remain. |

## Validation matrix

| ID | Claim | Test | Pass condition |

|---|---|---|---|

| V1 | Registry discovery/version binding | Launch approved version, then publish newer fixture | Running Case remains bound to original immutable version |

| V2 | Runtime persistence | Wait, end invocation, resume separately | Same Case continues; no completed effect repeats |

| V3 | Memory persistence/provenance | Store negotiation fact and resume | Required fact recalled with source/scope/time |

| V4 | Memory isolation | Attempt cross-Case/tenant recall | Retrieval denied or empty with evidence |

| V5 | Agent Identity enforcement | Valid and wrong-role/wrong-Case ERP requests | Valid allowed; invalid denied by adapter |

| V6 | Gateway enforcement | Delegation and direct-bypass fixture | Delegation routed with evidence; bypass absent/rejected |

| V7 | Armor ordering | Benign and injection inputs | Benign handled; injection blocked/sanitized before downstream use |

| V8 | Platform correlation | Query one Case | All platform records share stable correlations |

| V9 | Replay conformance | Replay every golden prefix twice | Expected and repeated Observable Case State hashes match |

| V10 | Duplicate safety | Redeliver Source Event and Intervention | One Canonical Event and one Runtime action |

| V11 | Live reconnect | Disconnect for five events and reconnect | No gaps/duplicates; converges to Case high-water mark |

| V12 | Request/result truth | Delay/fail Runtime control | UI stays pending/failed, never fabricates success |

| V13 | Policy/model boundary | Malicious or malformed model action | No Control call; rejection event recorded |

| V14 | Approval binding | Change scope after approval | Stale approval rejected |

| V15 | Warden degradation | Disable Warden | Platform controls, capture, replay, and manual response work |

| V16 | Secret/PII redaction | Emit configured secret/PII fixture | Raw value absent from general Audit Store/export |

| V17 | Procurement comprehension | Five fresh users | Discover/start &lt;60 s; identify next Case action |

| V18 | Operator comprehension | Five fresh technical users | Locate branch/decision/result &lt;30 s |

| V19 | Accessibility | Keyboard + reduced-motion walkthrough | All core journeys usable |

| V20 | End-to-end reliability | 10 recorded golden Cases; 3 bounded live proofs if enabled | 10 complete recorded evidence packages and 3/3 selected live proofs |

## User-test prompts

### Procurement test

“Find an approved agent for onboarding Acme Components, tell me what it can

access, start the Case, and explain what the Case needs from you now.”

Measure time, mistaken version/risk interpretation, whether the user opens the

Cockpit unnecessarily, and comprehension of simulated day/memory provenance.

### Operator/security test

“Find the risky or failing branch. Tell me what protected control acted, what

evidence justified it, what FleetScope requested, and whether Runtime confirmed

the outcome.”

Measure time and confusion between Armor block, Identity denial, Gateway denial,

approval, Intervention request, and confirmed result.

## Environment modes

### Private live

- Dedicated demo project/data and authenticated controls.

- Automatic action enabled only for the one allowlisted idempotent action.

- Global switch visible and tested.

- Fresh golden Case per take with deterministic input/failure seeds.

### Public read-only

- Recorded Canonical Event fixture, projected Case, Catalog, Workspace, Cockpit,

  and Audit interactions.

- Active approval/control endpoints absent.

- Labeled **Recorded Case** and **Simulated Day**.

### Offline/video

- Local/static projection of the final Case.

- Captioned video independent of live cloud services.

- Architecture and evidence report available independently.

## Recording and evidence checklist

- [ ] Exact platform product/API names and official rubric citations verified.

- [ ] Synthetic ERP and simulated-day labels visible.

- [ ] No secrets, PII, raw vendor email, private prompts, or credentials.

- [ ] Version, memory provenance, identity, Gateway, Armor, Warden, and Runtime

  result remain readable after video compression.

- [ ] Voiceover says “observable Case state” and “Decision Evidence.”

- [ ] No unsupported “immutable,” “weeks elapsed,” “enterprise scale,” or

  “reasoning chain” claim.

- [ ] Architecture diagram matches the static deployment and any optional live

      component actually enabled.

- [ ] Evidence package contains platform response fixtures, event schemas,

  projector hash report, Intervention JSON, fault-test results, and ten-run sheet.

- [ ] All public links work logged out and controls are read-only.

## Open points

1. Official video duration and whether a technical appendix is allowed.

2. Exact platform service availability and what must be visibly demonstrated.

3. Whether invalid Identity/Gateway branches fit the core video or appendix.

4. Who narrates and who operates.

5. Whether OpenTelemetry export must follow a specified audit-log format.

## Links

- [Product plan](../product/[product-plan.md](http://product-plan.md))

- [UI/UX plan](../product/[ui-ux-plan.md](http://ui-ux-plan.md))

- [Product requirements](../requirements/[fleetscope.md](http://fleetscope.md))

- [System design](../design/[system.md](http://system.md))

- [Six-day delivery plan]([six-day-delivery.md](http://six-day-delivery.md))

