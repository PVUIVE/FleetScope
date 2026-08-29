"""Closed, display-safe contract for the fixed local demo worker."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

SCENARIO = "dependency_onboarding"
VERSION = 1


@dataclass(frozen=True)
class RunRequest:
    run_id: str
    session_id: str
    correlation_id: str
    scenario: str

    @property
    def invocation_id(self) -> str:
        return f"{self.run_id}:{self.correlation_id}"


def parse_request(value: object) -> RunRequest:
    if not isinstance(value, dict) or set(value) != {"version", "runId", "sessionId", "correlationId", "scenario"}:
        raise ValueError("request must contain only version, runId, sessionId, correlationId, scenario")
    if value.get("version") != VERSION or value.get("scenario") != SCENARIO:
        raise ValueError("only version 1 dependency_onboarding is supported")
    fields: dict[str, Any] = value
    for key in ("runId", "sessionId", "correlationId"):
        if not isinstance(fields[key], str) or not fields[key]:
            raise ValueError(f"{key} must be a non-empty string")
    return RunRequest(fields["runId"], fields["sessionId"], fields["correlationId"], fields["scenario"])
