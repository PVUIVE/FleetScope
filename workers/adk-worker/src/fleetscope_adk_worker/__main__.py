from __future__ import annotations

import argparse
import json
import sys

from .contract import parse_request
from .worker import run_live


def main() -> int:
    parser = argparse.ArgumentParser(description="FleetScope fixed-scenario ADK worker")
    parser.add_argument("--live", action="store_true", help="explicitly execute ADK; may consume model credits")
    args = parser.parse_args()
    try:
        request = parse_request(json.load(sys.stdin))
    except (ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"error": "invalid_request", "detail": str(error)}))
        return 2
    if not args.live:
        print(json.dumps({"state": "unavailable", "reason": "pass --live to execute ADK"}))
        return 0
    result = run_live(request, lambda: {"status": "allowlisted_metadata_read"})
    print(json.dumps({"state": result.state, "delegation": result.delegation, "reason": result.reason, "events": list(result.events)}))
    return 0 if result.state == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
