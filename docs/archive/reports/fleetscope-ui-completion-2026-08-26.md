# FleetScope UI completion — 2026-08-26

Scope: take the FleetScope product UI from "functional" to "demo-ready enterprise product".
No architectural change. The canonical event model, projector, Render Manifest, Warden,
Scenario Compiler, vendored Zoetrope renderer and the bounded live endpoint were not
redesigned. Two backend additions were required to make the *required* UI feature work and
are described in §M.

---

## A. UI audit before changes

Every route was loaded in a real browser (Chromium, 1440×900 and 1280×720) before any edit.

### Blocking defects

| # | Defect | Evidence |
|---|--------|----------|
| 1 | **The WASM renderer never loaded in `astro dev`.** The dynamic `import('/wasm/cockpit.js')` from a Vite-transformed module is rewritten to `/wasm/cockpit.js?import`, which Vite refuses because the file lives in `public/`. The Cockpit route rendered Astro's full-screen error overlay. | `[vite] Internal server error: Failed to load url /wasm/cockpit.js … should not be imported from source code`, HTTP 500 on `/wasm/cockpit.js?import` |
| 2 | **The document was ~1900px taller than its content on the Cockpit.** `.fs-visually-hidden` is `position: absolute` with no positioned ancestor, so hidden labels inside the scrolling evidence rail laid out at their would-be document position. | `document.documentElement.scrollHeight = 4212` vs `body.scrollHeight = 2301` |
| 3 | **No control anywhere called `/live/decision`.** The required product feature did not exist in the UI. | — |

### Product-level gaps

- No status vocabulary. `caseState` was printed raw (`completed`, `activation`), so the same
  state read differently on every surface, and nothing distinguished "Needs Approval" from
  "Waiting".
- The event count was 0-based on screen (`Event 15 of 59` for a 60-event Case).
- No Decision Evidence drawer: the rail listed decisions but nothing could be opened.
- No agent topology outside the canvas — the graph was the only representation, so the
  hierarchy was unavailable to a keyboard or a screen reader.
- No incident detail, no Warden lifecycle visualisation, no demo phase navigation.
- Audit was a raw event table with no filters, no search, no execution-mode column, and the
  canonical payload was not reachable at all.
- `/cases` was a key/value card, not a queue: no attention state, no last activity, no
  priority ordering; the layout assumed a single row.
- Approvals collapsed approval, authorization, execution and result into one "approved"
  badge.
- `Decisions = 0` was shown for capabilities that issue no decision badge — a false zero for
  a Runtime that plainly made decisions.
- Cockpit `render()` dispatched a cursor event **every animation frame**, so the evidence
  rail fought the operator for the scroll position.
- Every route paid two rows of chrome for a title plus a duplicated mode badge.
- Contrast: `--fs-text-faint` was 3.66:1 on `--fs-surface-raised` — below WCAG AA, on the
  smallest captions in the product.
- `Element.scrollIntoView` in the rail moved Chrome's sequential-focus starting point, so the
  operator's **first Tab on the Cockpit landed inside the evidence list**, not on the nav.

### Not defects (verified, left alone)

- No body-level horizontal overflow existed on any route before the work, and none was
  introduced. The 64-character digest handling in `.fs-kv dd` was already correct.
- `UnknownOr` already refused to print an unknown as zero.
- Redaction already happened before persistence, not before display.

---

## B. Design decisions

**Three channels, never one.** Every status carries a word, a glyph and a tone. `lib/status.ts`
is the only place status vocabulary is defined, so a `waiting` Case reads "Waiting" on the
index, in the header and in the Cockpit. A value the table does not know resolves to
"Unknown" rather than to a plausible default.

**Mode is a property of the evidence, not of the thing.** `ModeBadge` is squared and
monospace; `StatusBadge` is a pill. They cannot be confused at a glance, which matters when
one says "Completed" and the other says "Synthetic System".

**Surfaces move one step at a time.** Four surface tokens (`bg`, `sunken`, `surface`,
`raised`); a panel two steps above its parent reads as a different product. No gradients, no
glows, no motion that is not reporting a state change.

**Density over decoration.** Nav is 48px and sticky; each route owns its header through
`PageHeader` so badges and actions share the title line. The Cockpit uses the full viewport
width (`wide`); document surfaces stay measured at 1560px.

**Two affordances on an evidence row, deliberately.** The row seeks the graph; a separate
"Details" button opens the drawer. Collapsing them would drop an overlay across the graph on
every scrub.

---

## C. Route-by-route implementation

### `/catalog` — Agent Catalog
Governed-agent discovery. Cards carry purpose, owner, risk class (labelled *FleetScope
metadata, not a Registry field*), capabilities, tools, allowed callers, protected systems,
last published, and the **version digest read off the `registry.version_resolved` canonical
event** — absent digests show "—" with the reason. Ordering is derived: a version bound to a
recorded Case sorts first, then alphabetically. Primary CTA is **Open Recorded Case ·
CASE-1042** — truthful language, with a note that FleetScope starts no new agent run in the
recorded demo. Secondary: **View version evidence**.

### `/cases` — the Case queue
A real table: Case · Vendor, State (+ attention flags), Milestone with completion count and
Session count, Last activity with timestamp and 1-based event number, mode badge, and three
route actions. Rows are ordered by `caseAttention().priority` — a Case blocking a person
outranks one that is merely running — and an attention row carries an inset marker, not just
a hue. Nothing is hard-coded to one row; a second Case adds a row and changes no component.

### `/cases/CASE-1042` — the Case Workspace
Answers six questions above the fold: what is happening, which milestone, the last control
decision, what the agent is waiting for, what trusted context survives, what happens next.
Five of the six carry an **Event N · evidence** button that opens the Decision Evidence
drawer; the sixth (the forward look) deliberately carries none, because it is a statement
about recorded state and not a prediction. Below: the milestone rail with Session boundaries
interleaved chronologically (**"Simulated Day 12"**, never "Day 12"), trusted context with
per-record source-event buttons, the operator queue, narrative recent activity in business
English, incidents, and recorded totals where an unmeasured value reads "—".

### `/approvals` — the Approval Inbox
Each decided approval renders a four-stage rail — *Operator approval → Authorization recorded
→ Execution requested → Authoritative result* — resolved separately from evidence. The
execution stage finds the `tool.requested` that cited the approval id; the result stage finds
the **subsequent resolution of the same tool**, which is a different recorded fact. A pending
approval shows the exact request, its side-effect class and consequence, and the binding
fingerprint. Approve/Reject are rendered **disabled with the reason stated** — this build
serves a static bundle and has no write path, and a button that looked like it decided
something and did not would be worse than no button.

### `/cockpit/CASE-1042` — the Fleet Cockpit
Three columns: agent topology and recorded totals on the left, the renderer in the middle,
Decision Evidence and the live-proof panel on the right; incidents and Warden interventions
in a full-width row below. Header carries the Case identity, status, attention flags and mode.
The transport strip states `Historical · recorded evidence, nothing is executing` in words,
with a static hollow ring rather than the pulsing live dot. Below 1280 the evidence rail drops
under the canvas; below 900 everything stacks.

### `/audit/CASE-1042` — the Audit view
Evidence status metrics (canonical events, Sessions, projector version, 1-based event cursor,
evidence gaps, invariant violations), copyable stream revision and state hash, a full-width
capability truth table, integrity and export, known evidence gaps behind a disclosure, Runtime
Sessions, and the canonical event log with **five filters plus full-text search**. The raw
payload is behind *View canonical payload* inside the drawer — one deliberate click, never the
default reading experience.

---

## D. Component system

Small and product-specific, not a design system:

`StatusBadge` · `ModeBadge` · `PageHeader` · `CaseHeader` · `EmptyState` · `Metric` ·
`UnknownOr` (kept) · `CopyableDigest` · `EvidenceRail` · `EvidenceDrawer` · `AgentTree` ·
`IncidentPanel` · `InterventionLifecycle` · `LiveProofPanel` · `Nav`.

Deleted as superseded: `ModeLabel`, `EvidencePanel`, `DecisionEvidence`.

Presentation logic lives in `apps/web/src/lib/`: `status.ts` (the one vocabulary),
`evidence-view.ts` (Decision Evidence records, narrative activity, incident views),
`case-summary.ts` (queue summary, milestone rail, next action), `case-view.ts` (the six
questions), `agent-tree.ts`, `demo-phases.ts`, `live-proof.ts`.

---

## E. Cockpit integration

The vendored Zoetrope renderer is untouched. `CockpitMount` changed in four ways:

1. **The glue loads through an injected `<script type="module">`** rather than a direct
   `import()`. This is the fix for audit defect 1: a runtime-created script element is
   outside the bundler's module graph, so the request is not rewritten to `?import` and the
   `public/` file is served as-is. The ABI is still verified export-by-export afterwards, so a
   partial load fails by name rather than at the first call site.
2. **Controls are delegated from `document`.** The bounded live proof appends evidence rows
   after mount; per-element listeners bound at mount time would have left those rows inert.
3. **`render()` deduplicates.** It builds a signature from the cursor, transport and current
   entry and returns early when unchanged, instead of dispatching 60 identical events a second.
4. **`fleetscopeAppend` grows the shell's manifest too**, not only the renderer's — otherwise
   a cursor lookup for newly appended evidence would silently miss it.

The canvas is `52vh` with a 460px floor, `overflow: hidden`, and the renderer owns its DOM
subtree entirely.

---

## F. Render Manifest synchronisation

Every seek in the product resolves through the manifest. There is no `caseSequence /
lastCaseSequence` anywhere in `apps/web`. Verified in the browser, not just by reading:

```
PASS  cockpit: selecting evidence moves the Event Cursor  ::  Event 16 of 60
PASS  cockpit: the renderer seeked to the manifest range for that event  ::  renderer 14, manifest 14
```

The check reads the renderer's own `fleetscope_snapshot().rendererEntryIndex` and compares it
against `rendererEntryStart` for that `caseSequence` in the inlined manifest. Event 16
(`caseSequence 15`, `armor.blocked`) maps to renderer entry 14 — the two units differ by one
here precisely because `case.milestone_changed` compiled to zero renderer entries, which is
the drift a ratio would have hidden.

**Human-facing numbering is 1-based.** `Event 60 of 60` for a 60-event Case; the internal
`caseSequence` stays 0-based.

**Canonical unread is FleetScope's.** `+44 new` after seeking to Event 16 is
`canonicalUnreadFor(caseSequences, 15)` — accepted Canonical Events after the cursor, never a
renderer item count.

**Demo phase navigation** is predicate-driven (`lib/demo-phases.ts`): each phase asks a
question of the recorded evidence ("where was incoming content first blocked?") rather than
storing a percentage or a sequence number. A phase whose evidence is absent, or whose event
compiled to nothing drawable, is dropped rather than pointed somewhere plausible. CASE-1042
resolves 13 phases: Start · Memory · Waiting · Simulated Day Resume · Armor · Gateway ·
Failure · Incident · Policy · Warden · Approval · Identity · Result.

---

## G. Live Proof UI — **works from the real UI**

Placement: a panel in the Cockpit evidence rail. Not a chat box — there is no text input on
this path at all; the operator picks a pre-approved step and the server owns the prompt.

**Capability is read from the API, never inferred from frontend config.** `GET /capability`
must report `liveMode: true` *and* list the `(caseId, stepId)` pair before the button is
enabled. A build with `PUBLIC_LIVE_MODE=true` pointed at a server with live mode off shows
"Unavailable" — because that is the truth.

Flow, and the ordering that matters:

```
click → POST /live/decision → Source Events
      → canonicalizeAppend onto the existing stream
      → project → compileZoetropeScene → validate
      → globalThis.fleetscopeAppend(mainTail, subagents, manifestDelta)
      → evidence rail + Case header update
```

`planAppend()` re-runs the same checks `scripts/verify-live-append.ts` runs server-side, and
**refuses** the append if any fails: rejected events, stream problems, a recorded prefix that
recompiled differently, an inconsistent extended manifest, or any invariant violation. The raw
model response is never rendered.

States: `unavailable` · `ready` · `running` · `succeeded` · `failed` · `fallback`. Double
submit is prevented by an in-flight flag *and* a spent flag, on top of the server's own
budget. Usage and the model reference sit behind a disclosure; **estimated cost shows
"Unknown"**, because the API reports no cost figure and inventing one would be the same class
of error as a false zero.

Fallback and budget copy are distinct and honest: *"Live proof unavailable — showing recorded
evidence instead"* and *"Live proof limit reached for this Case"*. FleetScope never retries
automatically.

**No credential reaches the browser.** The bundle talks to the FleetScope API only. See §M.

---

## H. Approval → Intervention UI

The four states are never collapsed. `InterventionLifecycle` renders the Warden spine —
*proposed → authorized → requested → acknowledged → result* — with unreached steps drawn as
unreached, and a terminal `timed_out` toned as a warning rather than a failure because the
outcome is **unknown, not failed** (Invariant 10). Each reached step carries a *Jump to Event
N* control anchored from the evidence manifest's recorded lifecycle.

The misleading metric named in the brief is fixed: the Cockpit now shows
**Control requests = 1** and **Runtime observations = 1**, not "Warden control calls = 2".

---

## I. Evidence / Incident / Warden UI

`EvidenceRail` lists all 60 decisions with a capability tag, the manifest's **semantic**
outcome (so a policy denial says "Denied", never "Tool failed"), the Session, and a marker
where an event produced nothing drawable. It has a capability filter and a search; filtering
is presentation only and never touches the cursor, the unread count or the renderer.

`EvidenceDrawer` renders domain-specific groups — Registry, Identity, Gateway, Armor, Memory,
Tool, Incident, Policy, Intervention, Approval, Runtime, Usage, Agent, Case — plus provenance
(canonical type, event id, 1-based position, Session, actor, observed/accepted times,
execution mode), related event ids, an optional model-contribution group labelled *advice,
never authority*, and the redacted canonical payload behind a disclosure. It has focus
trapping, Escape-to-close and focus restoration. Runtime-appended evidence registers itself
through `globalThis.fleetscopeRegisterEvidence`, so a live event is inspectable exactly like a
recorded one.

`IncidentPanel` states *detected because* in English, the detector and version, the evidence
event ids as buttons, the policy disposition with its rationale, and the recovery — or says
plainly that no intervention was requested. *Jump to First failure* / *Jump to Incident
opened* both route through the manifest.

`AgentTree` gives the hierarchy as DOM: depth from the recorded `parent` link (never spawn
order), state, version, Session, tool-call count, recorded failure count, and last action.
Selecting a node calls the optional `fleetscope_select` where the ABI has it and always moves
the Event Cursor to that agent's last recorded action — a real capability rather than a
pretended one.

---

## J. Audit UI

- Evidence status, integrity manifest, capability truth, evidence gaps, Sessions, event log.
- **Filters**: Session, Capability, Event type, Outcome, Execution mode, plus full-text search
  over event id, type, label, actor and the redacted payload.
- **Verify export** runs the repository's own `verifyAuditExport` in the browser: it
  recomputes the export digest and the stream revision *and re-projects the exported events to
  confirm the state hash*. The wording states exactly what that proves and nothing more —
  "application-level integrity manifest … not cryptographically non-repudiable".
- Capability rows that issue no decision badge show **"—", not 0** (audit defect: a Runtime
  that made decisions was reading as having made none).
- A "Gemini live proof" row states plainly that this export contains no live model evidence.

---

## K. Responsive and accessibility

Verified at **1440×900**, **1280×720** and **1180×800**: zero body-level horizontal overflow
on all six routes at all three sizes (18/18 checks).

- Contrast: `--fs-text-faint` raised `#6d7787 → #858fa0`, `--fs-deny` `#d06060 → #e07878`,
  `--fs-info`/`--fs-accent` `#5b90d8 → #6b9ce0`. Every text token now clears WCAG AA (≥4.5:1)
  against every surface it is used on, **including status chips read against their own tinted
  backgrounds** (ok 4.77, warn 5.76, deny 4.72, info 4.87) and captions on tinted milestone
  chips (worst case 4.69).
- Tab order fixed: the first Tab on the Cockpit now lands on the brand link and walks the
  primary navigation. The rail follows the cursor by setting the container's `scrollTop`
  instead of `Element.scrollIntoView`, which had been moving Chrome's sequential-focus
  starting point into the evidence list.
- Visible 2px focus ring on every focusable element; drawers trap focus, close on Escape and
  restore focus to the opener; all interactive controls are real `<button>`/`<a>`; zero
  icon-only buttons without an `aria-label`.
- Status is never colour-only: glyph + word + tone, with a screen-reader-only clause on
  milestone and lifecycle steps ("(complete)", "— not reached").
- Reduced motion verified under emulation: transport dot animation `none`, drawer transition
  `1e-05s`, zero infinite animations.

---

## L. Browser bugs found and fixed

| Bug | Fix |
|-----|-----|
| WASM renderer 500 in dev (`?import` rewrite of a `public/` file) | load the glue via an injected `<script type="module">` |
| Document ~1900px taller than content (absolute hidden labels escaping scroll containers) | `position: relative` on every scroll container, documented at the rule |
| Evidence rail scroll fought the operator (cursor event every animation frame) | dedupe `render()` by signature; highlight only on change |
| First Tab landed inside the evidence list | scroll the container, not the element |
| Header kept claiming the pre-append event count after a live proof | header updates on `fleetscope:evidence-appended`, and gains a Live Proof badge |
| Live-proof duration rendered as `1691.8788330000025 ms` | rounded to whole milliseconds |
| Approval "Authoritative result" read as unrecorded although the tool had succeeded | resolve request and result as two separate recorded facts |
| Capability truth showed `0` decisions for capabilities that issue no badges | `zeroMeans="unknown"` → "—", with the reason stated |
| Capability truth column clipped by horizontal scroll at 1280 | table moved to its own full-width row |
| Catalog listed the orchestrator second (alphabetical) | order by Case binding, derived from evidence |

---

## M. Security and secret review

**Two backend additions were required.** Both are narrow and fail closed:

1. `WEB_ORIGINS` (config) + `apps/api/src/middleware/cors.ts`. The static site and the API are
   separate origins, so the browser live proof needs an explicit CORS grant. The allowlist is
   **exact-match and empty by default** — with no configured origin the service sends no CORS
   header at all. The `Origin` header is never reflected unless it appears in the allowlist;
   reflecting an arbitrary origin would let any page on the internet spend this deployment's
   model budget. No `Access-Control-Allow-Credentials` (the API takes no cookie). Four tests
   cover it, including a near-miss origin (`localhost:4331.evil.example`) and an unknown
   preflight.
2. `vitest.config.ts` now includes `apps/web/tests/**`.

**Bundle scan** (performed against the *live-configured* build, the worst case):

- No `AIza…` key, no `Bearer …` token, no `-----BEGIN` private key, no `GEMINI_API_KEY`
  string, no `sk-`/`ghp_` token in `apps/web/dist`.
- No home-directory or filesystem paths in the emitted JS or HTML.
- The one `-----BEGIN` match is the **canonicalizer's redaction pattern list**, bundled
  because the client canonicalizes live results — that is the redaction boundary running in
  the browser, not a secret.
- No reference to `generativelanguage.googleapis.com` in the bundle: the browser calls the
  FleetScope API, and only the server calls the model vendor.
- The default recorded build emits `apiBaseUrl: null` and the nav reads "Recorded mode".

**Error handling**: every client-visible failure is a classified, pre-written string
(`api_unreachable`, `call_budget_exhausted`, `live_mode_disabled`, `step_not_allowlisted`).
No raw vendor error body, stack trace, filesystem path or environment value reaches the UI.

**What the UI will not render**: raw prompts, credentials, unredacted tool input, or model
reasoning. A presentation test asserts the serialized evidence records contain no `AIza`,
`Bearer ` or `-----BEGIN`.

---

## N. Test results

| Suite | Result |
|-------|--------|
| `pnpm format:check` (prettier) | clean |
| `pnpm lint` (eslint) | clean |
| `pnpm typecheck` (9 packages + `astro check`) | 0 errors across 37 Astro files |
| `pnpm test` (vitest) | **271 passed**, 15 files — up from 238; **+29 presentation tests**, **+4 CORS tests** |
| `cargo test` (FleetScope) | **53 passed** (9 + 12 + 23 + 9) |
| `cargo test` (vendored Zoetrope) | **190 passed** (182 + 8) |
| `pnpm build:web` | 6 pages |
| `pnpm build:wasm` | trunk build succeeded, 1.9MB `cockpit_bg.wasm` staged |
| `pnpm smoke` | **17 PASS / 0 FAIL / 0 SKIP** |
| `pnpm reliability` | **10/10 runs passed**, terminal state hash `cb99db39d200…` identical across every run |

New tests worth naming (`apps/web/tests/presentation.test.ts`): the status table never invents
a state; `sanitized`/`flagged` are not toned as failures; a timeout is not toned as a failure;
records never contain a credential pattern; a policy denial reads as a denial; synthetic
control decisions are labelled synthetic and never live; demo phases anchor only to drawable
recorded events and drop rather than guess; agent depth comes from the parent link; unmeasured
tokens stay `null`; `planAppend` continues sequences without renumbering settled evidence,
grows the renderer timeline, marks the append as Live Proof, and **refuses a late arrival**.

---

## O. Browser QA results

`pnpm qa:browser` — new, `scripts/browser-qa.ts`, driving real Chromium via `playwright`
(added as the single new devDependency; browsers were already present, so no framework was
introduced for one test).

**Recorded mode: 82/82 checks passed**, stable across three consecutive runs.

Coverage: all six routes at three viewports (loads · no body overflow · no console errors);
catalog offers the recorded Case; the workspace answers six questions and names the simulated
day boundary; the WASM renderer instantiates; the event count is 1-based; selecting evidence
moves the Event Cursor **and the renderer to the manifest range**; historical mode says nothing
is executing; canonical unread is reported; the drawer opens, shows provenance and closes on
Escape; incidents explain why they opened; the Warden lifecycle keeps its stages separate;
demo phase navigation seeks; Return to live reaches the edge; primary navigation is keyboard
reachable; evidence controls are real buttons; audit filters narrow the log; the evidence
export verifies in the browser; capability modes are labelled.

Screenshots are written when `FLEETSCOPE_QA_SHOTS=<dir>` is set (18 route screenshots plus one
post-interaction Cockpit capture).

---

## P. Live UI proof result — executed

Run through the actual UI, against `generativelanguage.googleapis.com` / `gemini-2.5-flash`,
with `LIVE_MODE=true`, `WEB_ORIGINS=http://localhost:4331`, and the site built with
`PUBLIC_API_BASE_URL=http://localhost:8080`.

**88/88 checks passed**, including:

```
PASS  live proof: the API reports the step is available
PASS  live proof: the request resolved
PASS  live proof: canonical evidence grew        ::  60 → 63
PASS  live proof: the evidence rail grew         ::  60 → 63
PASS  live proof: the result is labelled Live Proof
PASS  live proof: the button is spent, not retryable
PASS  live proof: the renderer still seeks the recorded prefix
PASS  live proof: no console errors
```

On-screen result: **Live proof succeeded** · Decision `compliant` · Confidence `0.95` ·
New canonical evidence `+3 events` · Renderer `+2 entries` · Duration `2012 ms` · new stream
revision and state hash shown in full. The Case header updated `60 → 63` and gained a **Live
Proof** badge next to Recorded Case. No page refresh, no duplicate call, no raw model response
rendered, and the recorded prefix still seeks correctly afterwards.

**One transient failure was also observed and handled correctly.** An earlier attempt returned
`HTTP 503 (UNAVAILABLE)` from the model API. The UI showed *"Live proof unavailable — showing
recorded evidence instead"*, recorded the attempt as canonical evidence, and did **not** retry.
That is the designed behaviour and it is worth keeping in the record.

**Spend this session: 4 real calls.** Three succeeded, one returned 503. At the recorded rate
(~USD 0.00022/call) that is approximately **USD 0.0009**, against a USD 35 ceiling.

`LIVE_MODE` is back to `false` and the shipped build emits `apiBaseUrl: null`.

---

## Q. Known remaining limitations

1. **Approvals cannot be decided from the UI.** This build serves a static bundle with no
   write path. The controls are rendered disabled with the reason stated rather than faked.
2. **`estimatedCostUsd` for a live proof is Unknown.** The API returns token counts but no
   cost figure; the UI shows "Unknown" rather than computing a price from a rate card it does
   not have.
3. **Only CASE-1042 exists.** Every surface is written against `listCaseIds()` and no
   component is hard-coded to it, but "supports a second Case" is an argument from
   construction, not a demonstration — no CASE-1043 fixture was invented to prove it.
4. **The per-Case live call counter is in-memory** (pre-existing). It resets when the API
   restarts. Documented in `apps/api/src/live/guard.ts`.
5. **`intervention.state` anchors on the approval page** are resolved by action template, not
   by an explicit approval→intervention link, because the canonical model does not carry one.
   Correct for CASE-1042; would need a real correlation for a Case with two interventions of
   the same template.
6. **Cockpit bundle is ~111KB gzipped ~31KB** for the live-proof path (canonicalizer +
   compiler + projector, needed because the browser canonicalizes). It loads on
   `/cockpit/[caseId]` only; no other route pulls WASM or the compiler.
7. **`context_drift` shows as an open incident on a completed Case.** This is what the
   evidence says — the advisory incident was never resolved — so the header carries an
   "Incident" flag next to "Completed". Truthful, and slightly surprising on first read.

---

## R. Demo instructions

```bash
pnpm install --frozen-lockfile
pnpm build:wasm          # requires: cargo install --locked trunk
pnpm build:web
pnpm --filter @fleetscope/web exec astro preview --port 4321
```

Open `http://localhost:4321/`. `LIVE_MODE=false` is the default and the whole demo below works
with the network disabled after first load.

**Three minutes:**

| Time | Screen | Beat |
|------|--------|------|
| 00:00–00:20 | `/catalog` | Vendor Onboarding Orchestrator v1.4, Approved, protected systems, version digest. **Open Recorded Case · CASE-1042.** |
| 00:20–00:45 | `/cases/CASE-1042` | Six answers. Trusted context with provenance. Milestone rail — point at **Simulated Day 12**. |
| 00:45–01:15 | `/cockpit/CASE-1042` | Phase **5 Armor**, then **6 Gateway**, then **12 Identity**. Agent topology on the left shows the delegated Logistics Agent with 3 failures. |
| 01:15–01:35 | Cockpit | Click the Armor row, then **Details** — Blocked, `prompt_injection`, "reaches no context, memory or tool". |
| 01:35–02:00 | Cockpit | Phases **7 Failure → 8 Incident → 9 Policy → 10 Warden**. The lifecycle rail: proposed, authorized, requested, acknowledged, **Runtime confirmed it succeeded**. Control requests 1, Runtime observations 1. |
| 02:00–02:25 | Cockpit | Any evidence row → *Historical · nothing is executing*, `+44 new` → **Return to live**. |
| 02:25–02:45 | Cockpit | **Run Live Proof** (live setup below), or leave it showing "Unavailable" — recorded mode is complete without it. |
| 02:45–03:00 | `/audit/CASE-1042` | State hash, capability truth (Synthetic System where synthetic), **Verify export**, **Download Case evidence**. |

**To enable the live proof for the demo** (spends ~USD 0.0002 per call):

```bash
# terminal 1 — the bounded API
LIVE_MODE=true \
WEB_ORIGINS=http://localhost:4321 \
GEMINI_MODEL=gemini-2.5-flash \
GEMINI_API_KEY=…            # from your secret store; never commit it
npx tsx apps/api/src/server.ts

# terminal 2 — the site, pointed at it
PUBLIC_API_BASE_URL=http://localhost:8080 PUBLIC_LIVE_MODE=true pnpm build:web
pnpm --filter @fleetscope/web exec astro preview --port 4321
```

**Verification commands:**

```bash
pnpm check          # format + lint + typecheck + test + build
pnpm smoke          # 17/17, including cargo and the vendored renderer
pnpm reliability    # 10/10 recorded runs, identical state hash
pnpm qa:browser     # 82/82 browser checks
FLEETSCOPE_QA_LIVE=true pnpm qa:browser   # 88/88, spends one real call
```
