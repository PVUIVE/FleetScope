"""Offline callback-contract tests for :mod:`plugin`.

The suite deliberately installs tiny ADK import stubs instead of importing or
calling Google ADK. It verifies FleetScopePlugin against the callback shapes it
uses and intercepts ``_post`` before any HTTP request can happen. Run it with:

    python3 examples/fleetscope_adk/test_plugin_contract.py

``--emit-capture`` prints the intercepted payloads as JSON. The TypeScript
contract test consumes that output and validates it with ``parseAdkIngest``,
which keeps the Python boundary and the collector schema in lockstep.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any

PLUGIN_PATH = Path(__file__).with_name("plugin.py")
MODULE_NAME = "fleetscope_plugin_contract_subject"


def _module(name: str) -> types.ModuleType:
    module = types.ModuleType(name)
    module.__path__ = []  # type: ignore[attr-defined]
    sys.modules[name] = module
    return module


def install_adk_stubs() -> None:
    """Provide only the public ADK symbols the plugin imports.

    These are intentionally shape-only stubs. The production plugin remains a
    BasePlugin, while this test stays free of an ADK install, credentials, and
    provider traffic.
    """

    google = _module("google")
    adk = _module("google.adk")
    agents = _module("google.adk.agents")
    models = _module("google.adk.models")
    plugins = _module("google.adk.plugins")
    tools = _module("google.adk.tools")
    google.adk = adk  # type: ignore[attr-defined]
    adk.agents = agents  # type: ignore[attr-defined]
    adk.models = models  # type: ignore[attr-defined]
    adk.plugins = plugins  # type: ignore[attr-defined]
    adk.tools = tools  # type: ignore[attr-defined]

    base_agent = _module("google.adk.agents.base_agent")
    callback_context = _module("google.adk.agents.callback_context")
    invocation_context = _module("google.adk.agents.invocation_context")
    llm_request = _module("google.adk.models.llm_request")
    llm_response = _module("google.adk.models.llm_response")
    base_plugin = _module("google.adk.plugins.base_plugin")
    base_tool = _module("google.adk.tools.base_tool")
    tool_context = _module("google.adk.tools.tool_context")

    class BasePlugin:
        def __init__(self, *, name: str) -> None:
            self.name = name

    class BaseAgent: ...
    class CallbackContext: ...
    class InvocationContext: ...
    class LlmRequest: ...
    class LlmResponse: ...
    class BaseTool: ...
    class ToolContext: ...

    base_agent.BaseAgent = BaseAgent
    callback_context.CallbackContext = CallbackContext
    invocation_context.InvocationContext = InvocationContext
    llm_request.LlmRequest = LlmRequest
    llm_response.LlmResponse = LlmResponse
    base_plugin.BasePlugin = BasePlugin
    base_tool.BaseTool = BaseTool
    tool_context.ToolContext = ToolContext


def load_plugin() -> Any:
    install_adk_stubs()
    sys.modules.pop(MODULE_NAME, None)
    spec = importlib.util.spec_from_file_location(MODULE_NAME, PLUGIN_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {PLUGIN_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[MODULE_NAME] = module
    spec.loader.exec_module(module)
    return module


def context(agent: str = "orchestrator") -> SimpleNamespace:
    return SimpleNamespace(
        session=SimpleNamespace(id="ses_plugin_contract", app_name="Plugin contract"),
        invocation_id="inv-plugin-contract",
        agent_name=agent,
    )


async def capture_plugin_run() -> list[dict[str, Any]]:
    module = load_plugin()
    plugin = module.FleetScopePlugin(endpoint="http://127.0.0.1:9", app_name="Plugin contract")
    payloads: list[dict[str, Any]] = []
    plugin._post = payloads.append

    root = SimpleNamespace(name="orchestrator", parent_agent=None)
    child = SimpleNamespace(name="inventory", parent_agent=root)
    root_context = context()
    child_context = context("inventory")
    tool = SimpleNamespace(name="inventory_lookup")
    tool_context = SimpleNamespace(
        session=child_context.session,
        invocation_id=child_context.invocation_id,
        agent_name="inventory",
        function_call_id="inventory-tool-1",
    )

    await plugin.before_run_callback(
        invocation_context=SimpleNamespace(
            session=root_context.session,
            invocation_id=root_context.invocation_id,
            agent=root,
        )
    )
    await plugin.before_agent_callback(agent=root, callback_context=root_context)
    await plugin.before_agent_callback(agent=child, callback_context=child_context)
    await plugin.before_model_callback(
        callback_context=child_context,
        llm_request=SimpleNamespace(model="gemini-2.5-flash"),
    )
    await plugin.after_model_callback(
        callback_context=child_context,
        llm_response=SimpleNamespace(
            partial=False,
            model_version="gemini-2.5-flash",
            usage_metadata=None,
            finish_reason=None,
            error_code=None,
        ),
    )
    await plugin.before_tool_callback(
        tool=tool,
        tool_args={"authorization": "Bearer plugin-contract-secret-1234567890", "sku": "SKU-42"},
        tool_context=tool_context,
    )
    await plugin.after_tool_callback(
        tool=tool,
        tool_args={},
        tool_context=tool_context,
        result={
            "status": "error",
            "error_class": "timeout",
            "message": "inventory service timed out",
        },
    )
    await plugin.after_agent_callback(agent=child, callback_context=child_context)
    await plugin.after_agent_callback(agent=root, callback_context=root_context)
    await plugin.after_run_callback(
        invocation_context=SimpleNamespace(
            session=root_context.session,
            invocation_id=root_context.invocation_id,
            agent=root,
        )
    )
    return payloads


class FleetScopePluginContractTest(unittest.TestCase):
    def test_callback_capture_preserves_known_adk_shape(self) -> None:
        payloads = asyncio.run(capture_plugin_run())
        events = [payload["events"][0] for payload in payloads]

        self.assertEqual([event["seq"] for event in events], list(range(1, 11)))
        self.assertEqual(events[0]["kind"], "session.start")
        self.assertEqual(events[1]["kind"], "agent.start")
        self.assertNotIn("parentAgent", events[1])
        self.assertEqual(events[2]["parentAgent"], "orchestrator")
        self.assertEqual(events[3]["kind"], "model.start")
        self.assertEqual(events[4]["kind"], "model.end")
        self.assertNotIn("inputTokens", events[4])
        self.assertNotIn("outputTokens", events[4])
        self.assertEqual(events[5]["callId"], "inventory-tool-1")
        self.assertTrue(events[6]["error"])
        self.assertEqual(events[6]["errorClass"], "timeout")
        self.assertEqual(events[-1]["kind"], "session.end")
        for payload in payloads:
            self.assertEqual(payload["framework"], "google-adk")
            self.assertEqual(payload["sessionId"], "ses_plugin_contract")
            self.assertEqual(payload["appName"], "Plugin contract")

    def test_partial_model_response_does_not_emit_a_false_completion(self) -> None:
        module = load_plugin()
        plugin = module.FleetScopePlugin(app_name="Plugin contract")
        payloads: list[dict[str, Any]] = []
        plugin._post = payloads.append

        asyncio.run(
            plugin.after_model_callback(
                callback_context=context("inventory"),
                llm_response=SimpleNamespace(partial=True),
            )
        )
        self.assertEqual(payloads, [])


if __name__ == "__main__":
    if "--emit-capture" in sys.argv:
        print(json.dumps({"batches": asyncio.run(capture_plugin_run())}, sort_keys=True))
    else:
        unittest.main()
