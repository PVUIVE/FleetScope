# FleetScope isolated ADK worker

This is the Phase C boundary for one fixed scenario: `dependency_onboarding`.
It accepts a versioned JSON request on stdin and emits only redacted ADK wire
metadata when explicitly live-enabled. It never accepts prompts, URLs, shell
commands, target repositories, or tool arguments.

## No-cost contract check

```bash
PYTHONPATH=workers/adk-worker/src python3 -m fleetscope_adk_worker <<'JSON'
{"version":1,"runId":"run-local","sessionId":"session-local","correlationId":"call-local","scenario":"dependency_onboarding"}
JSON
```

The default result is `unavailable`; it does not import ADK or contact a model.
Run the dependency-free tests with:

```bash
PYTHONPATH=workers/adk-worker/src python3 workers/adk-worker/tests/test_worker.py
```

## Explicit live opt-in

`--live` constructs an actual ADK `dependency_onboarding` root agent with an
actual delegated `security_review` sub-agent. It is intentionally not run by
CI or normal validation because it may use Gemini credentials/credits:

```bash
PYTHONPATH=workers/adk-worker/src python3 -m fleetscope_adk_worker --live < request.json
```

Callbacks are emitted only as safe wire metadata: event kind, agent names,
parent, call IDs, model/tool names, low-cardinality error class, and finish
reason. Raw prompts, completions, hidden reasoning, tool arguments/results,
and credentials are excluded before persistence. The only tool is a fixed
allowlisted repository metadata read with no caller-controlled arguments.
