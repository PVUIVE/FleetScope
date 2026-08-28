# FleetScope documentation

FleetScope is a **local Agent Viewer for Gemini and Google ADK** that turns agent
sessions into a live execution graph and inspectable timeline.

## Current

Read in this order.

1. [`architecture.md`](architecture.md) — how an ADK run becomes a graph: the two
   event models, the six rules the code enforces, package boundaries, the renderer.
2. [`local-agent-viewer.md`](local-agent-viewer.md) — the operational reference:
   the CLI, the API, the SQLite store, the SSE transport, configuration, and the
   Python plugin.
3. [`demo.md`](demo.md) — the exact three-minute demo, what is real and what is a
   stub, and what to do when something goes wrong.
4. [`../DESIGN.md`](../DESIGN.md) — the landing-page design contract: the
   Execution Spine motif, the six sections, the visual and motion systems.
5. [`decisions/`](decisions/) — architecture decision records.
   0001 tooling · 0002 renderer boundary · 0003 bounded live path ·
   0004 render manifest · 0005 redaction boundaries.
6. [`deployment/railway.md`](deployment/railway.md) — hosting the static site.

## Reports

- [`reports/fleetscope-local-agent-viewer-refactor-audit.md`](reports/fleetscope-local-agent-viewer-refactor-audit.md)
  — the pre-refactor audit: what existed, what was kept, what was deferred.
- [`reports/fleetscope-local-agent-viewer-implementation.md`](reports/fleetscope-local-agent-viewer-implementation.md)
  — what was built, with real command output and measured results.

## Archive

[`archive/`](archive/README.md) holds the earlier **enterprise agent-fleet
control plane** direction: requirements, product plans, system design, delivery
plans and reports. It is clearly labelled *Future / Enterprise Direction* and
does **not** describe the current product. A good deal of the code it specifies
is still in the repository, compiling and tested — the archive README says which,
and where.

Requirements documents there use **MUST**, **SHOULD** and **MAY** as normative
terms for that direction, not for this MVP.
