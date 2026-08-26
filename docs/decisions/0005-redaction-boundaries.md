# 0005 — Two redaction boundaries, and which one is the control

Status: accepted · 2026-08-26

## Context

FleetScope persists Canonical Events and compiles them into a renderer
transcript. Sensitive material could leak at either step, and the two steps
protect against different things.

An earlier reading placed redaction at the Scenario Compiler. That is too late:
by the time the compiler runs, the event has already been **persisted** — and
persisted with the secret in it.

## Decision

Two boundaries, with different jobs.

### 1. The Canonicalizer — the PRIMARY boundary

`packages/canonicalizer` redacts before a Source Event becomes a Canonical Event
and before anything is written:

```text
Source Event → schema validation → sensitive-field classification
             → REDACTION / DIGEST → dedup → ordering → Canonical Event
```

Two independent classifiers run, because either alone misses real cases:

- **by field name** — `apiKey`, `password`, `prompt`, `thinking`, `cwd`, … a
  value is sensitive because of where it sits, whatever it looks like;
- **by value shape** — a bearer token pasted into a `notes` field is still a
  token.

A field-rule hit redacts the whole subtree: a value named `credentials` may be an
object, and redacting only its string leaves would still disclose its structure
and key names.

`payloadDigest` is carried **only when something was actually redacted**. A
digest exists to correlate a redacted payload with the original that can no
longer be shown; for a payload published in full it discloses nothing and proves
nothing the payload does not.

### 2. The Scenario Compiler — renderer minimization, defence in depth

`redactedSummary()` is the only path by which a payload value reaches an emitted
renderer line. Everything else is a label the compiler wrote. It admits only
short, already-redacted summary fields, truncates them, and drops anything
carrying a redaction marker rather than rendering `«redacted»` as noise.

The compiler emits **no `prompt` field on a spawn and no `thinking` block
anywhere** — which matters because the vendored renderer's detail panel draws
`↳ prompt` and `↳ thought` rows from exactly those.

### 3. The vendored panel patch — the last line, not the control

`vendor/zoetrope` gains a `render-provenance` Cargo feature, on by default so
upstream is unchanged, off for FleetScope. See `vendor/VENDOR-PATCHES.md`.

It is defence in depth. The control is (2): there is nothing for the panel to
draw because nothing was ever emitted.

## Verification

- `packages/canonicalizer/tests` — a configured secret injected into a Source
  Event does not appear in the accepted Canonical Event; a digest is present; a
  bearer token under an innocuous key is caught by shape; a sensitive subtree is
  redacted whole; array leaves are reached.
- `packages/fixtures/tests/canonicalization.test.ts` — the same, on the real
  recorded Case, through the real pipeline.
- `packages/scenario-compiler/tests` and `crates/fleet-cockpit/tests/scene.rs` —
  the compiled artifacts contain no `"thinking"`, `"prompt"`, `"reasoning"`,
  `chain_of_thought`, PEM header, bearer token, or home-directory path.
- `scanForSensitiveMaterial()` returns the rules that fired, **never the matched
  text**, so a leak-detection failure cannot itself become the leak.

## Tradeoff

Redacting before persistence means a payload FleetScope later decides was safe
cannot be recovered from the canonical store — only its digest survives. That is
the correct direction to fail: an unrecoverable redaction is an inconvenience, an
unrecoverable disclosure is not.
