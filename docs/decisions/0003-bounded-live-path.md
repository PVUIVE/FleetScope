# 0003 — Static-first, with one bounded live path

Status: accepted · 2026-08-26 · **the live call is now implemented — see the
amendment at the foot of this file**

## Context

A USD 35 credit ceiling, a public demo that must survive with no backend, and a
hard product rule that no synthetic result may be presented as a live platform
response.

## Decision

- `apps/web` is `output: 'static'`. Recorded fixtures are inlined at build time
  via eager `import.meta.glob`, so the demo renders with the network disabled.
- `apps/api` is **one** small Hono service on Node 22, scoped to exactly three
  things: `/health`, `/capability`, `/live/decision`.
- `LIVE_MODE` defaults to false and **fails closed**: only the literal string
  `"true"` enables it, and live mode additionally requires `GEMINI_MODEL` and
  `GEMINI_API_KEY` at boot.
- `/live/decision` accepts an allowlisted `(caseId, stepId)` pair. There is no
  free-form prompt endpoint anywhere in the service.
- `admitLiveRequest` is the single admission gate: live-mode check → allowlist
  check → per-Case call budget, in that order.
- The Gemini call itself is **not implemented**. With live mode on, an
  allowlisted step returns `501 not_implemented` rather than a fabricated result.

## Reason

Hono is small, Web-standard, and boots in milliseconds on Cloud Run with
`min-instances=0`. Returning 501 is the honest state: the exact platform APIs are
still an open point in the requirements, and a plausible-looking stub is worse
than an explicit gap.

## Tradeoff

The live proof is unfinished until the platform APIs are confirmed. The recorded
path — which is the demo — is complete and unaffected.

---

## Amendment — 2026-08-26, the call is implemented

`/live/decision` no longer returns 501. What changed, and what did not:

**Unchanged, and still the point.** No free-form prompt endpoint exists. The
prompts are server constants selected by allowlisted step id; a `prompt` field in
the request body is simply not read, and a test asserts it never reaches the
outbound request.

**The bounded call.** One `fetch`, `temperature: 0`, `candidateCount: 1`,
`maxOutputTokens: 300`, a `responseSchema`, one hard timeout, and **no retry** —
a retry doubles the spend for evidence the recorded path already has. The
credential travels in a header, never in the URL, because a URL reaches proxy
logs, browser history and error reports.

**The response must satisfy a schema or the call FAILED.** A model that returns
prose where FleetScope asked for a classification has not succeeded
inconveniently; it has not succeeded. Validation failures name the offending
FIELDS, never the values, so a rejected response cannot become the leak.

**A live result becomes canonical evidence before it affects anything.** The
endpoint returns **Source Events**, not a rendered result. The client
canonicalizes them onto its existing stream (`canonicalizeAppend`, which
continues sequences rather than renumbering settled evidence), projects, compiles
and appends to the renderer. The pipeline is the one recorded evidence goes
through; nothing about a live result skips it.

**Two clocks, kept apart.** `sourceTime` places the event in the CASE's own
frame — a Recorded Case runs a simulated timeline that may sit ahead of wall
time — and `ingestionTime` records when the edge actually took delivery.
Collapsing them would either misdate the evidence inside the Case or misreport
when FleetScope received it.

**Failure is evidence.** A failed live proof returns `200` with
`mode: "recorded"`, `fellBackToRecorded: true`, and a `tool.requested` +
`tool.failed` pair. "The live proof was attempted and did not succeed" is a fact
worth keeping; serving the recorded result with no trace would leave the demo
unable to tell the two apart afterwards.

**Still not run against a real endpoint.** Every test uses an injected `fetch`
that never leaves the process — which is what lets the bounded path run in CI on
every commit at zero cost. **USD 0.00 has been spent.** The three-run live
reliability check in `docs/plans/demo-validation.md` has not been performed, and
recorded mode remains the official demo path.
