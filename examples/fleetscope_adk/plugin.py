"""FleetScope's Google ADK integration.

This is a ``BasePlugin`` — the mechanism ADK itself documents for observing a
run. It is used in preference to every alternative for concrete reasons:

* **Not terminal scraping.** ADK's log lines are a human-facing format with no
  compatibility promise, they carry no invocation or call ids, and they cannot
  express a tool failure distinctly from a tool result that mentions an error.
* **Not per-agent callbacks** (``LlmAgent(before_tool_callback=...)``). Those
  must be attached to every agent individually, so a sub-agent someone adds
  later is silently unobserved. A plugin is registered once on the ``Runner``
  and sees the whole invocation, including agents created at runtime.
* **Not a custom Runner subclass.** That is private surface and would break.

What it sends, and what it deliberately does not
------------------------------------------------
It reports *shape*: which agent, which model, which tool, when, how long, and
whether it failed. It never sends a prompt, a completion, or model reasoning —
those are not read from the request or the response at all. Tool arguments and
results ARE sent, because the developer needs to see them, and they pass
through FleetScope's redaction boundary before anything is written to disk.

Failure policy
--------------
Fail-open, always. FleetScope is an observer; if the collector is not running,
or stops mid-run, the agent must be completely unaffected. Errors are counted,
reported once, and then the plugin goes quiet for the rest of the process.
"""

from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Optional

from google.adk.agents.base_agent import BaseAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.invocation_context import InvocationContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.plugins.base_plugin import BasePlugin
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext

DEFAULT_ENDPOINT = "http://127.0.0.1:4317"

#: Tool arguments and results are business data, not blobs. Anything longer is
#: truncated here rather than posted: the viewer shows a summary, and a
#: megabyte of payload would slow the live stream for no added understanding.
MAX_VALUE_CHARS = 400

#: After this many consecutive transport failures the plugin stops trying. The
#: agent keeps running; only the observation stops.
MAX_FAILURES = 3


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _framework_version() -> Optional[str]:
    try:
        import importlib.metadata as metadata

        return metadata.version("google-adk")
    except Exception:  # pragma: no cover - version metadata is best-effort
        return None


def _safe(value: Any, depth: int = 0) -> Any:
    """Reduce an arbitrary Python value to something JSON-serializable.

    Unknown objects become a short ``repr``; they are never dropped silently,
    because "the tool was called with something FleetScope could not render" is
    itself information the developer wants.
    """
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value if len(value) <= MAX_VALUE_CHARS else value[: MAX_VALUE_CHARS - 1] + "…"
    if depth >= 3:
        return _safe(repr(value), depth + 1)
    if isinstance(value, dict):
        return {str(k): _safe(v, depth + 1) for k, v in list(value.items())[:24]}
    if isinstance(value, (list, tuple, set)):
        return [_safe(v, depth + 1) for v in list(value)[:24]]
    return _safe(repr(value), depth + 1)


def _error_class(error: BaseException) -> str:
    """A stable, low-cardinality label. The message may carry user data."""
    return type(error).__name__


class FleetScopePlugin(BasePlugin):
    """Report a Google ADK run to a local FleetScope collector."""

    def __init__(
        self,
        endpoint: Optional[str] = None,
        *,
        app_name: Optional[str] = None,
        name: str = "fleetscope",
        timeout: float = 2.0,
    ) -> None:
        super().__init__(name=name)
        self.endpoint = (endpoint or os.environ.get("FLEETSCOPE_ENDPOINT") or DEFAULT_ENDPOINT).rstrip("/")
        self.app_name = app_name
        self.timeout = timeout
        self._seq = 0
        self._failures = 0
        self._session_id: Optional[str] = None
        self._framework_version = _framework_version()
        self._model_calls: dict[str, str] = {}

    # ── transport ────────────────────────────────────────────────────────────

    @property
    def disabled(self) -> bool:
        return self._failures >= MAX_FAILURES

    def _post(self, body: dict[str, Any]) -> None:
        request = urllib.request.Request(
            f"{self.endpoint}/api/ingest",
            data=json.dumps(body).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            response.read()

    async def _emit(self, session_id: Optional[str], event: dict[str, Any]) -> None:
        if self.disabled or session_id is None:
            return

        self._seq += 1
        payload = {
            "framework": "google-adk",
            "sessionId": session_id,
            "events": [{"seq": self._seq, "at": _now(), **event}],
        }
        if self._framework_version is not None:
            payload["frameworkVersion"] = self._framework_version
        if self.app_name is not None:
            payload["appName"] = self.app_name

        try:
            # Off the event loop: a blocking POST inside a callback would add
            # its latency to the agent's own critical path.
            await asyncio.to_thread(self._post, payload)
            self._failures = 0
        except (urllib.error.URLError, OSError, TimeoutError) as error:
            self._failures += 1
            if self._failures == MAX_FAILURES:
                print(
                    f"[fleetscope] collector unreachable at {self.endpoint} "
                    f"({_error_class(error)}); observation disabled for this run.",
                    flush=True,
                )

    @staticmethod
    def _session_of(context: Any) -> Optional[str]:
        session = getattr(context, "session", None)
        return getattr(session, "id", None)

    # ── run lifecycle ────────────────────────────────────────────────────────

    async def before_run_callback(
        self, *, invocation_context: InvocationContext
    ) -> None:
        self._session_id = invocation_context.session.id
        if self.app_name is None:
            self.app_name = getattr(invocation_context.session, "app_name", None)
        await self._emit(
            self._session_id,
            {
                "kind": "session.start",
                "agent": invocation_context.agent.name,
                "invocationId": invocation_context.invocation_id,
            },
        )
        return None

    async def after_run_callback(self, *, invocation_context: InvocationContext) -> None:
        await self._emit(
            invocation_context.session.id,
            {
                "kind": "session.end",
                "agent": invocation_context.agent.name,
                "invocationId": invocation_context.invocation_id,
            },
        )
        return None

    # ── agents ───────────────────────────────────────────────────────────────

    async def before_agent_callback(
        self, *, agent: BaseAgent, callback_context: CallbackContext
    ) -> None:
        parent = getattr(agent, "parent_agent", None)
        await self._emit(
            self._session_of(callback_context),
            {
                "kind": "agent.start",
                "agent": agent.name,
                "invocationId": callback_context.invocation_id,
                # Absent when ADK reports no parent. A root agent must not be
                # given a fabricated one just to make the tree look complete.
                **({"parentAgent": parent.name} if parent is not None else {}),
            },
        )
        return None

    async def after_agent_callback(
        self, *, agent: BaseAgent, callback_context: CallbackContext
    ) -> None:
        await self._emit(
            self._session_of(callback_context),
            {
                "kind": "agent.end",
                "agent": agent.name,
                "invocationId": callback_context.invocation_id,
            },
        )
        return None

    # ── model ────────────────────────────────────────────────────────────────

    async def before_model_callback(
        self, *, callback_context: CallbackContext, llm_request: LlmRequest
    ) -> None:
        call_id = f"{callback_context.invocation_id}:{callback_context.agent_name}:{self._seq + 1}"
        # Remembered per agent so the matching response can reuse the id and the
        # viewer can pair a start with its end. ADK does not supply one.
        self._model_calls[callback_context.agent_name] = call_id
        await self._emit(
            self._session_of(callback_context),
            {
                "kind": "model.start",
                "agent": callback_context.agent_name,
                "invocationId": callback_context.invocation_id,
                "model": llm_request.model,
                "callId": call_id,
            },
        )
        return None

    async def after_model_callback(
        self, *, callback_context: CallbackContext, llm_response: LlmResponse
    ) -> None:
        # A streamed run delivers many partial responses for one call. Emitting
        # each would report a dozen model calls where one happened.
        if getattr(llm_response, "partial", None):
            return None

        usage = getattr(llm_response, "usage_metadata", None)
        finish = getattr(llm_response, "finish_reason", None)
        event: dict[str, Any] = {
            "kind": "model.end",
            "agent": callback_context.agent_name,
            "invocationId": callback_context.invocation_id,
            "model": getattr(llm_response, "model_version", None),
            "callId": self._model_calls.get(callback_context.agent_name),
        }
        if finish is not None:
            event["finishReason"] = str(getattr(finish, "name", finish))
        # Token counts are reported ONLY when the model reported them. An
        # unobserved count stays absent and renders as "Unknown", never as 0.
        if usage is not None:
            if getattr(usage, "prompt_token_count", None) is not None:
                event["inputTokens"] = int(usage.prompt_token_count)
            if getattr(usage, "candidates_token_count", None) is not None:
                event["outputTokens"] = int(usage.candidates_token_count)
        if getattr(llm_response, "error_code", None) is not None:
            event["kind"] = "model.error"
            event["error"] = True
            event["errorClass"] = str(llm_response.error_code)

        await self._emit(
            self._session_of(callback_context),
            {k: v for k, v in event.items() if v is not None},
        )
        return None

    async def on_model_error_callback(
        self,
        *,
        callback_context: CallbackContext,
        llm_request: LlmRequest,
        error: Exception,
    ) -> None:
        await self._emit(
            self._session_of(callback_context),
            {
                "kind": "model.error",
                "agent": callback_context.agent_name,
                "invocationId": callback_context.invocation_id,
                "model": llm_request.model,
                "callId": self._model_calls.get(callback_context.agent_name),
                "error": True,
                "errorClass": _error_class(error),
            },
        )
        return None

    # ── tools ────────────────────────────────────────────────────────────────

    @staticmethod
    def _call_id(tool_context: ToolContext, tool: BaseTool) -> str:
        # ADK's own function-call id where it exists; otherwise a stable
        # per-invocation fallback so a start and its end still pair up.
        return (
            getattr(tool_context, "function_call_id", None)
            or f"{tool_context.invocation_id}:{tool.name}"
        )

    async def before_tool_callback(
        self, *, tool: BaseTool, tool_args: dict[str, Any], tool_context: ToolContext
    ) -> None:
        await self._emit(
            self._session_of(tool_context),
            {
                "kind": "tool.start",
                "agent": tool_context.agent_name,
                "invocationId": tool_context.invocation_id,
                "tool": tool.name,
                "callId": self._call_id(tool_context, tool),
                "args": _safe(tool_args),
            },
        )
        return None

    async def after_tool_callback(
        self,
        *,
        tool: BaseTool,
        tool_args: dict[str, Any],
        tool_context: ToolContext,
        result: dict,
    ) -> None:
        # A tool that returns `{"status": "error", ...}` has FAILED, even though
        # it did not raise. Reporting that as a success is the single most
        # misleading thing this plugin could do.
        failed = isinstance(result, dict) and str(result.get("status", "")).lower() in {
            "error",
            "failed",
            "failure",
        }
        summary = None
        if isinstance(result, dict):
            for key in ("summary", "message", "error", "status"):
                value = result.get(key)
                if isinstance(value, str) and value:
                    summary = value[:MAX_VALUE_CHARS]
                    break

        event: dict[str, Any] = {
            "kind": "tool.end",
            "agent": tool_context.agent_name,
            "invocationId": tool_context.invocation_id,
            "tool": tool.name,
            "callId": self._call_id(tool_context, tool),
            "result": _safe(result) if isinstance(result, dict) else {"value": _safe(result)},
        }
        if summary is not None:
            event["summary"] = summary
        if failed:
            event["error"] = True
            event["errorClass"] = str(result.get("error_class") or result.get("status") or "error")

        await self._emit(self._session_of(tool_context), event)
        return None

    async def on_tool_error_callback(
        self,
        *,
        tool: BaseTool,
        tool_args: dict[str, Any],
        tool_context: ToolContext,
        error: Exception,
    ) -> None:
        await self._emit(
            self._session_of(tool_context),
            {
                "kind": "tool.error",
                "agent": tool_context.agent_name,
                "invocationId": tool_context.invocation_id,
                "tool": tool.name,
                "callId": self._call_id(tool_context, tool),
                "error": True,
                "errorClass": _error_class(error),
            },
        )
        return None
