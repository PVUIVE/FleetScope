# Archive — Future / Enterprise Direction

**Nothing in this directory describes the current product.**

FleetScope is a **local Agent Viewer for Gemini and Google ADK**. The documents
here describe an earlier direction: an enterprise agent-fleet control plane with
Cases, Warden intervention, Approvals, Agent Identity, Gateway and Model Armor.

They are kept because that direction is still where the product is going, and
because a good deal of the code they specify is still in the repository, still
compiling and still tested — see "What survives" below. They are **not** a
description of what FleetScope does today, and they should not be read as one.

## Why the reset

The enterprise story needed a fleet, a governance team and a policy owner before
any of it was useful. The product now starts with the smallest real user:

> one developer, running one Gemini / Google ADK agent, on their own machine.

Everything in `docs/architecture.md`, `docs/local-agent-viewer.md` and
`docs/demo.md` is about that product. This directory is about the one after it.

## What survives, and where

| Enterprise concept | Status today | Where |
|---|---|---|
| Canonical Event spine | **Active.** Every local session is canonical evidence. | `packages/event-schema`, `packages/canonicalizer` |
| Redaction before persistence | **Active.** The security control for local capture. | `packages/canonicalizer/src/redaction.ts` |
| Render Manifest | **Active.** Bridges the Event Cursor and the renderer. | `packages/scenario-compiler`, `crates/fleet-cockpit` |
| Event Cursor / live vs historical | **Active.** Drives the viewer's HISTORICAL mode. | `packages/domain/src/cursor.ts` |
| Deterministic projection | **Internal.** Proves replay determinism; no UI depends on it. | `packages/projector` |
| Warden, policy, approvals, intervention | **Deferred.** Compiles, tested, off the golden path. | `packages/warden` |
| Registry / Identity / Gateway / Model Armor / Memory | **Deferred.** Capability stubs only. | `packages/platform-adapters` |
| CASE-1042 and its surfaces | **Deferred.** A regression fixture and an enterprise preview. | `packages/fixtures/cases/CASE-1042`, `/cases`, `/audit`, `/cockpit`, `/approvals`, `/catalog` |

The deferred routes still resolve and still render. They are not in the primary
navigation, they are labelled *Enterprise preview* in the shell, and no part of
the local Agent Viewer calls them. `POST /live/decision` and `GET /capability`
in `apps/api` belong to the same group: superseded by real ADK capture, kept
because they work and are covered.

## Extension points the MVP deliberately preserved

- **A second framework is a second adapter**, not a second spine. `packages/adk-adapter`
  is the only module that knows ADK exists.
- **Remote sessions** need a transport in front of `POST /api/ingest`, not a new model.
- **Persistent Cases** are already the canonical shape: a session IS a Case with
  one `caseId`. Grouping several under one Case needs no schema change.
- **Governance** re-enters as canonical event families that already exist
  (`policy.evaluated`, `intervention.*`, `human_escalation.*`) and a projector
  that already handles them.
