"""Minimal Phase C worker: fixed scenario, safe callback wire events, injected tests.

`run_live` is the only path that imports/runs Google ADK. It is never invoked by
normal tests or by the local run-admission controller.
"""
from __future__ import annotations

import asyncio
import json
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Protocol
from urllib.parse import urlparse

from .contract import RunRequest


SAFE_CALLBACK_FIELDS = {"kind", "agent", "parentAgent", "callId", "tool", "model", "error", "errorClass", "finishReason"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class WorkerResult:
    state: str  # completed | incomplete | failed
    delegation: str  # delegated | unknown
    events: tuple[dict[str, object], ...]
    reason: str | None = None


class ScenarioExecutor(Protocol):
    """Test seam; a live ADK executor is used only by run_live."""
    def execute(self, request: RunRequest, metadata_read: Callable[[], object]) -> Iterable[dict[str, object]]: ...


class IngestTransport(Protocol):
    def post(self, batch: dict[str, object]) -> None: ...


class LoopbackIngestTransport:
    """The worker may send redacted evidence only to the local FleetScope collector."""
    def __init__(self, endpoint: str = "http://127.0.0.1:4317", timeout: float = 2.0) -> None:
        parsed = urlparse(endpoint)
        if parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("FleetScope ingest endpoint must be loopback-only")
        self._url = endpoint.rstrip("/") + "/api/ingest"
        self._timeout = timeout

    def post(self, batch: dict[str, object]) -> None:
        request = urllib.request.Request(
            self._url,
            data=json.dumps(batch).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=self._timeout) as response:
            response.read()


class CallbackBridge:
    """Emit only versioned, redacted ADK wire metadata for one correlated run."""
    def __init__(self, request: RunRequest, clock: Callable[[], str] = now) -> None:
        self._request = request
        self._clock = clock
        self._sequence = 0
        self.events: list[dict[str, object]] = []

    def capture(self, callback: object) -> None:
        if not isinstance(callback, dict) or not isinstance(callback.get("kind"), str):
            raise ValueError("malformed ADK callback")
        kind = callback["kind"]
        if kind not in {"session.start", "session.end", "agent.start", "agent.end", "tool.start", "tool.end", "tool.error", "model.start", "model.end", "model.error"}:
            raise ValueError("unsupported ADK callback kind")
        safe: dict[str, object] = {"kind": kind, "seq": self._sequence, "at": self._clock(), "invocationId": self._request.invocation_id}
        self._sequence += 1
        for key in SAFE_CALLBACK_FIELDS - {"kind"}:
            value = callback.get(key)
            if isinstance(value, (str, bool)):
                safe[key] = value
        # Deliberately exclude prompt, content, thought, args, result and arbitrary fields.
        self.events.append(safe)

    def batch(self) -> dict[str, object]:
        return {
            "framework": "google-adk",
            "sessionId": self._request.session_id,
            "appName": "fleetscope-adk-worker",
            "events": self.events,
        }


class _LiveExecutor:
    """Actual ADK root/sub-agent construction and execution, reachable only via --live."""
    def execute(self, request: RunRequest, metadata_read: Callable[[], object]) -> Iterable[dict[str, object]]:
        # Imports stay here so test/install workflows never require ADK or credentials.
        from google.adk.agents import LlmAgent  # type: ignore[import-not-found]
        from google.adk.runners import Runner  # type: ignore[import-not-found]
        from google.adk.sessions import InMemorySessionService  # type: ignore[import-not-found]
        from google.genai import types  # type: ignore[import-not-found]

        def read_dependency_manifest() -> dict[str, str]:
            # The worker allows exactly one fixed metadata read, with no user args.
            metadata_read()
            return {"status": "metadata_read"}

        reviewer = LlmAgent(
            name="security_review",
            model="gemini-2.5-flash",
            instruction="Review only the fixed dependency-onboarding metadata. Do not request user input.",
            tools=[read_dependency_manifest],
        )
        root = LlmAgent(
            name="dependency_onboarding",
            model="gemini-2.5-flash",
            instruction="Delegate the fixed dependency onboarding review to security_review.",
            sub_agents=[reviewer],
        )
        sessions = InMemorySessionService()
        asyncio.run(sessions.create_session(app_name="fleetscope", user_id="local", session_id=request.session_id))
        runner = Runner(agent=root, app_name="fleetscope", session_service=sessions)
        # This is fixed control text, never emitted/persisted by CallbackBridge.
        message = types.Content(role="user", parts=[types.Part(text="Run dependency onboarding review.")])
        output: list[dict[str, object]] = [{"kind": "session.start", "agent": root.name}]
        async def consume() -> None:
            async for event in runner.run_async(user_id="local", session_id=request.session_id, new_message=message):
                author = getattr(event, "author", None)
                if author in {root.name, reviewer.name}:
                    output.append({"kind": "agent.start", "agent": str(author), "parentAgent": root.name if author == reviewer.name else None})
        asyncio.run(consume())
        output.append({"kind": "session.end", "agent": root.name})
        return output


def execute(
    request: RunRequest,
    executor: ScenarioExecutor,
    metadata_read: Callable[[], object],
    clock: Callable[[], str] = now,
    sink: IngestTransport | None = None,
) -> WorkerResult:
    bridge = CallbackBridge(request, clock)

    def finish(result: WorkerResult) -> WorkerResult:
        if sink is None or not bridge.events:
            return result
        try:
            sink.post(bridge.batch())
        except (OSError, TimeoutError):
            return WorkerResult("failed", "unknown", tuple(bridge.events), "collector_unavailable")
        return result

    delegated = False
    failure: str | None = None
    try:
        for callback in executor.execute(request, metadata_read):
            bridge.capture(callback)
            if callback.get("kind") == "agent.start" and callback.get("agent") == "security_review":
                delegated = True
            if callback.get("kind") in {"tool.error", "model.error"} or callback.get("error") is True:
                failure = str(callback.get("errorClass") or "worker_failure")
    except TimeoutError:
        return finish(WorkerResult("failed", "unknown", tuple(bridge.events), "timeout"))
    except Exception as error:
        return finish(WorkerResult("failed", "unknown", tuple(bridge.events), type(error).__name__))
    if failure is not None:
        return finish(WorkerResult("failed", "unknown", tuple(bridge.events), failure))
    if not delegated:
        return finish(WorkerResult("incomplete", "unknown", tuple(bridge.events), "delegation_not_observed"))
    return finish(WorkerResult("completed", "delegated", tuple(bridge.events)))


def run_live(request: RunRequest, metadata_read: Callable[[], object]) -> WorkerResult:
    """Explicit opt-in execution of real ADK root and delegated sub-agent."""
    return execute(request, _LiveExecutor(), metadata_read, sink=LoopbackIngestTransport())
