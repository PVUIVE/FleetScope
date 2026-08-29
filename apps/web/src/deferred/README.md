# Deferred enterprise surfaces

These pages belong to the earlier enterprise product direction that
[`docs/archive/README.md`](../../../../docs/archive/README.md) records. They are
kept verbatim because they work and are covered — but they are **not part of the
local Agent Viewer**, and they are no longer built or published.

## Why they live here and not in `src/pages/`

Astro's `output: 'static'` prerenders every file under `src/pages/` and offers no
route-level exclusion. While these files sat there they were emitted into `dist/`
and served by the public deployment: unlinked from the primary nav, but reachable
by URL, so a visitor who landed on `/cases/` saw an enterprise case-management
product instead of the Agent Viewer.

`deferred/` mirrors `pages/` at the same directory depth, so every relative import
in these files still resolves. Moving a page back into `src/pages/` is all it takes
to build it again — nothing else needs to change.

## What they render

Bundled recorded fixture evidence (CASE-1042) through `src/lib/fixtures`. They hold
no credential and call no API.

| File                     | Former route        |
| ------------------------ | ------------------- |
| `catalog.astro`          | `/catalog`          |
| `cases/index.astro`      | `/cases`            |
| `cases/[caseId].astro`   | `/cases/<caseId>`   |
| `approvals.astro`        | `/approvals`        |
| `cockpit/[caseId].astro` | `/cockpit/<caseId>` |
| `audit/[caseId].astro`   | `/audit/<caseId>`   |

## Their dependencies are now deferred too

The components these pages import — `CockpitMount`, `LiveProofPanel`,
`EvidenceRail`, `EvidenceDrawer`, `CaseHeader`, `CockpitStory`, `IncidentPanel`,
`InterventionLifecycle` — have **no other caller**. The live surfaces
(`pages/index.astro`, `pages/sessions/**`, `pages/docs/**`) import only
`components/landing/*` and `features/viewer/*`; the Agent Viewer's own renderer
mount lives in `pages/sessions/view/index.astro`, not in `CockpitMount`.

They are left in place, unbuilt and still unit-tested, on the same reasoning as the
pages: they work and they are covered. Anyone deleting the deferred pages for real
should take this component set — and the `lib/` modules only they use — with them.
