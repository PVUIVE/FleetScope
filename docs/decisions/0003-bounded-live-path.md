# 0003 — Static-first, with one bounded live path

Status: accepted · 2026-08-26

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
  `GCP_PROJECT_ID` at boot.
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
