# FleetScope context intake

Status: required inputs before requirements become active  

Last updated: 2026-08-26

The current product and design set is complete enough to start a day-1 vertical

slice, but it intentionally does not guess the following facts. The product

lead should collect the artifacts below, make decisions in priority order, and

update the linked open points.

## P0 context — required before day 1 ends

### Official competition facts

Provide source links or files for:

- hackathon name and organizer;

- official track descriptions and eligibility rules;

- full judging rubric and weights;

- submission deadline with timezone;

- team-size, cloud/service, and model eligibility;

- demo/video duration, format, public-link, and repository requirements;

- prize stacking rules and whether one project may win multiple categories;

- any required Google Cloud/ADK/GEAP/OpenTelemetry evidence.

Decision enabled: confirm Fortified Enterprise Fleet as the primary track and

validate the secondary prize strategy. The quoted rubric is treated as supplied

context, not live-verified fact.

### Team and delivery capacity

Provide:

- member names, available hours per day, and timezones;

- demonstrated strengths: frontend, ADK/agents, GCP, observability, design,

  video/pitch;

- who owns product/cut decisions and who can approve cloud spend;

- existing repository, current code, licenses, reusable assets, and deployment

  project;

- fixed unavailable periods and the actual six-day calendar.

Decision enabled: replace role placeholders with owners and size P1 scope.

### Enterprise platform and control reality

Provide authoritative documentation or one minimal executable proof for the

**single live capability selected for the demo**. For all other capabilities,

capture their confirmed API/schema availability or explicitly classify the

demo evidence as recorded/simulated:

- exact APIs, SDK versions, quotas, and output schemas for Agent Registry,

  Runtime, Memory Bank, Agent Identity, Agent Gateway, Model Armor, and OTel;

- supported Runtime wait/resume semantics and proof of a separate invocation;

- Memory Bank scoping and provenance fields;

- Agent Identity claims and protected-resource verification path;

- Gateway route-policy request/response and bypass behavior;

- Model Armor placement relative to agent context, memory, and tools;

- child-agent identity and lifecycle APIs;

- supported cancel, terminate, retry, reroute, and pause operations;

- whether those operations return acknowledgement, terminal result, and stable

  operation IDs;

- tool side-effect metadata and idempotency guarantees;

- event hooks already emitted versus events FleetScope must instrument;

- one candidate failure that can be injected deterministically.

Decision enabled: choose the strongest reliable live proof, compile the full

enterprise Case into truthful recorded evidence, and choose one bounded

recovery action. Missing enforcement MUST change the label and spoken claim; it

does not justify spending the credit contingency to force seven live services.

### Build, cloud, and credit availability

Provide current environment/project evidence for:

- exact Gemini model IDs and quotas;

- the hard **USD 35 total credit ceiling**, current spend, pricing visibility,

  and who may enable live mode;

- Rust/Cargo, `wasm32-unknown-unknown`, pnpm, and `trunk` versions needed to

  build the pinned browser/WASM visualization core;

- static-hosting eligibility and whether the submission rules require Cloud

  Run specifically;

- if a live endpoint is used, the ADK/Cloud Run deployment method, region,

  cold-start tolerance, `min-instances=0`, and `max-instances=1`;

- Firestore and Pub/Sub availability only as post-MVP options, not day-1

  dependencies;

- Agent Registry, Agent Runtime, Memory Bank, Agent Identity, Agent Gateway,

  Model Armor, and Observability/OTel availability;

- billing alerts or equivalent manual stop checks at $5, $15, $25, and $32.

Decision enabled: prove the fork builds, select static hosting, select at most

one bounded live backend proof, and keep recorded replay fully functional with

live mode disabled.

## P1 context — required before day 2 ends

### Data and security

Provide:

- prompt/tool fields that may contain credentials, personal data, customer

  data, source code, or regulated content;

- data classification and retention expectations;

- who may view traces, approve interventions, or enable auto-action;

- public demo exposure and authentication constraints;

- secrets management and service-account ownership;

- whether event exports require signatures, deletion, or legal immutability.

Decision enabled: redaction schema, public/private demo split, least-privilege

roles, approval boundary, and accurate immutability language.

### User evidence

Provide access to procurement, agent-platform, operations, and security users,

plus examples of:

- real vendor onboarding milestones, waiting periods, systems, and approvals;

- what procurement needs to know before launching an agent;

- context that must survive across weeks and its provenance requirements;

- real multi-agent incidents they diagnose today;

- logs/traces and steps used to locate the affected branch;

- decisions they would permit automatically versus require approval;

- evidence required after an automated action;

- the vocabulary they use for session, run, incident, retry, cancel, and

  escalation.

Decision enabled: validate persona/JTBD assumptions, detector priority, and

time-to-locate success target.

### Demo constraints

Provide:

- presentation machine, browser, viewport, and network reliability;

- whether the judge can interact with a live demo;

- narrator/operator assignments;

- brand assets, font licenses, and required event branding;

- recording/editing tools and caption requirements.

- whether the presentation network is reliable enough for the optional live

  proof; the public/default path remains static and recorded either way.

Decision enabled: final layout, motion budget, live versus recorded path, and

asset production schedule.

## P2 context — useful for post-hackathon direction

- Buyer and deployment owner: internal agent platform team, runtime provider,

  observability vendor, or security organization.

- Existing alternatives actually used: raw JSONL, cloud trace explorer,

  LangSmith/Langfuse-style tracing, vendor agent observability, custom consoles.

- Expected Sessions/day, agents/Session, events/second, retention, tenants, and

  regions.

- Alert and approval channels, ticketing/incident systems, and compliance needs.

- Willingness to pay and budget owner.

- Whether the product must support runtimes beyond ADK.

Decision enabled: pilot ICP, packaging, runtime adapter strategy, enterprise

roadmap, and credible scale requirements.

## Decision log to complete

| ID | Decision | Required evidence | Owner | Deadline | Status |

|---|---|---|---|---|---|

| C1 | Primary track and prize categories | Official rules/rubric | Product lead | Day 1 morning | Open |

| C2 | Enterprise platform APIs and evidence | API/schema review for all; one selected bounded live proof | Platform lead | Day 1 | Open |

| C3 | Long-running Case and memory proof | Separate Runtime invocation + Memory provenance | Runtime lead | Day 2 noon | Open |

| C4 | Public/live demo boundary | Rules + security review | Cloud lead | Day 2 | Open |

| C5 | Auto-action policy | Side-effect class + fault tests | Product + runtime | Day 3 | Open |

| C6 | Primary incident and recovery action | Deployed Runtime control proof | Runtime lead | Day 3 | Open |

| C7 | Evidence integrity level | Security need + implementation proof | Event lead | Day 4 | Open |

| C8 | Feature-freeze scope | Gate D results | Product lead | Day 5 noon | Open |

| C9 | Credit safety and live-mode owner | Billing snapshot, hard caps, kill switch | Cloud lead | Before first live call | Open |

| C10 | Browser fork build | Pinned revision, MIT notice, tests, Trunk/WASM build | Frontend lead | Day 1 noon | Open |

## Fast kickoff questionnaire

If the team can answer only ten questions, answer these in order:

1. What is the official competition URL and exact deadline?

2. Who is on the team and how many hours do they actually have?

3. What repo/code/deployment already exists?

4. Which exact enterprise platform APIs are available, and which single one is

   the strongest reliable live proof?

5. Can Runtime resume a Case in a separate invocation with Memory provenance?

6. How will Identity, Gateway, and Armor independently enforce the golden path?

7. What deterministic failure and Runtime action will prove Warden?

8. Which action is safe to auto-execute; which requires approval?

9. What data must never enter the event store/video, and is public replay only?

10. Who has final authority to enable live mode, stop spend, and cut features

    at each gate?

## Links to update after intake

- [Product requirements open points](../requirements/[fleetscope.md](http://fleetscope.md)#open-points)

- [System design open points](../design/[system.md](http://system.md)#open-points)

- [Product plan decisions]([product-plan.md](http://product-plan.md)#open-product-decisions)

- [Six-day delivery gates](../plans/[six-day-delivery.md](http://six-day-delivery.md))

- [Demo plan open points](../plans/[demo-validation.md](http://demo-validation.md)#open-points)

