from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fleetscope_adk_worker import CallbackBridge, execute, parse_request


REQUEST = {"version": 1, "runId": "run-1", "sessionId": "session-1", "correlationId": "call-1", "scenario": "dependency_onboarding"}


class FakeExecutor:
    def __init__(self, callbacks: list[dict[str, object]] | Exception) -> None:
        self.callbacks = callbacks
    def execute(self, request, metadata_read):
        if isinstance(self.callbacks, Exception):
            raise self.callbacks
        metadata_read()
        return self.callbacks


class FakeSink:
    def __init__(self) -> None:
        self.batches: list[dict[str, object]] = []
    def post(self, batch: dict[str, object]) -> None:
        self.batches.append(batch)


class WorkerContractTests(unittest.TestCase):
    def test_happy_path_uses_stable_correlation_and_redacts_payloads(self) -> None:
        sink = FakeSink()
        result = execute(parse_request(REQUEST), FakeExecutor([
            {"kind": "session.start", "agent": "dependency_onboarding", "prompt": "secret prompt"},
            {"kind": "agent.start", "agent": "security_review", "parentAgent": "dependency_onboarding", "thought": "hidden"},
            {"kind": "session.end", "agent": "dependency_onboarding", "result": {"token": "secret"}},
        ]), lambda: {"repository": "metadata"}, clock=lambda: "2026-08-29T00:00:00.000Z", sink=sink)
        self.assertEqual((result.state, result.delegation), ("completed", "delegated"))
        self.assertEqual([event["seq"] for event in result.events], [0, 1, 2])
        self.assertTrue(all(event["invocationId"] == "run-1:call-1" for event in result.events))
        self.assertEqual(len(sink.batches), 1)
        self.assertEqual(sink.batches[0]["sessionId"], "session-1")
        rendered = repr(sink.batches)
        self.assertNotIn("secret prompt", rendered)
        self.assertNotIn("hidden", rendered)
        self.assertNotIn("token", rendered)

    def test_missing_delegation_is_incomplete_unknown(self) -> None:
        result = execute(parse_request(REQUEST), FakeExecutor([{"kind": "agent.start", "agent": "dependency_onboarding"}]), lambda: None)
        self.assertEqual((result.state, result.delegation, result.reason), ("incomplete", "unknown", "delegation_not_observed"))

    def test_malformed_callback_is_rejected(self) -> None:
        bridge = CallbackBridge(parse_request(REQUEST))
        with self.assertRaisesRegex(ValueError, "malformed"):
            bridge.capture({"prompt": "not a callback"})

    def test_timeout_is_truthful_failure(self) -> None:
        result = execute(parse_request(REQUEST), FakeExecutor(TimeoutError()), lambda: None)
        self.assertEqual((result.state, result.delegation, result.reason), ("failed", "unknown", "timeout"))

    def test_tool_failure_is_truthful_failure(self) -> None:
        result = execute(parse_request(REQUEST), FakeExecutor([
            {"kind": "agent.start", "agent": "security_review"},
            {"kind": "tool.error", "tool": "read_dependency_metadata", "errorClass": "ReadTimeout", "result": {"sensitive": "never emitted"}},
        ]), lambda: None)
        self.assertEqual((result.state, result.delegation, result.reason), ("failed", "unknown", "ReadTimeout"))
        self.assertNotIn("sensitive", repr(result.events))

    def test_contract_rejects_arbitrary_scenario_and_fields(self) -> None:
        with self.assertRaises(ValueError): parse_request({**REQUEST, "scenario": "arbitrary"})
        with self.assertRaises(ValueError): parse_request({**REQUEST, "prompt": "inject"})


if __name__ == "__main__":
    unittest.main()
