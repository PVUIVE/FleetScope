"""The FleetScope golden demo: a real two-agent Google ADK run.

    Main Agent (vendor_onboarding)
        ├─ Gemini
        ├─ vendor_lookup                 succeeds
        └─ transfer_to_agent  ─────────► Logistics Agent (logistics)
                                             ├─ Gemini
                                             └─ inventory_lookup   fails: timeout

What is real and what is fixed
------------------------------
The **agent execution is real**: real Google ADK, real Gemini, real model
decisions about which tool to call and when to delegate. Nothing about the
model call is simulated.

The **business tools are local fixtures**. `vendor_lookup` answers from an
in-file table and `inventory_lookup` fails deterministically for the demo
vendor. That is a demo-reliability decision, stated plainly: the failure the
viewer is meant to show must happen every time, and it must not depend on an
external ERP being up. A fake "Gemini call" would be dishonest; a fake ERP is
just a stub, which every integration test in the world uses.

Run it with FleetScope watching::

    fleetscope watch                       # terminal 1
    python examples/vendor_agent.py        # terminal 2
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from google.adk.agents import LlmAgent  # noqa: E402
from google.adk.runners import Runner  # noqa: E402
from google.adk.sessions import InMemorySessionService  # noqa: E402
from google.genai import types  # noqa: E402

from fleetscope_adk import FleetScopePlugin  # noqa: E402

APP_NAME = "Vendor Onboarding Agent"
USER_ID = "local-developer"
MODEL = os.environ.get("FLEETSCOPE_DEMO_MODEL", "gemini-3.5-flash")

PROMPT = "Check whether Acme Components can be onboarded as a supplier."

#: The one vendor the demo asks about. `inventory_lookup` is defined to fail for
#: this code, which is what makes the error-inspection part of the demo repeat.
DEMO_VENDOR_CODE = "ACME-DEMO"

_VENDORS = {
    "acme components": {
        "vendor_code": DEMO_VENDOR_CODE,
        "legal_name": "Acme Components Ltd",
        "country": "IE",
        "risk_tier": "standard",
        "sanctions_screened": True,
    },
}


def vendor_lookup(vendor_name: str) -> dict:
    """Look up a supplier in the vendor master.

    Args:
        vendor_name: The supplier's trading name, e.g. "Acme Components".

    Returns:
        The vendor record, including the vendor_code needed to check inventory.
    """
    record = _VENDORS.get(vendor_name.strip().lower())
    if record is None:
        return {
            "status": "not_found",
            "summary": f"no vendor master record for {vendor_name}",
        }
    return {"status": "ok", "summary": f"{record['legal_name']} found", **record}


def inventory_lookup(vendor_code: str) -> dict:
    """Check current inventory commitments for a vendor in the logistics system.

    Args:
        vendor_code: The vendor code returned by vendor_lookup.

    Returns:
        Inventory commitments, or an error when the logistics system does not
        answer in time.
    """
    if vendor_code.strip().upper() == DEMO_VENDOR_CODE:
        # Deterministic, and deliberately shaped like the real thing: an
        # upstream system that accepted the request and never answered.
        return {
            "status": "error",
            "error_class": "timeout",
            "summary": "logistics inventory service did not respond within 5000 ms",
        }
    return {"status": "ok", "summary": "no open commitments", "open_commitments": 0}


#: Sampling is switched off for both agents.
#:
#: The model still decides which tool to call and when to delegate — that is the
#: part of the demo that must stay real. Temperature 0 only removes sampling
#: noise, so a run that took the golden path once takes it again. Without it the
#: root agent occasionally answers from the vendor record alone and never
#: delegates, and a demo that works four times in five is not a demo.
DETERMINISTIC = types.GenerateContentConfig(temperature=0.0)

logistics_agent = LlmAgent(
    name="logistics",
    model=MODEL,
    generate_content_config=DETERMINISTIC,
    description="Checks inventory and logistics commitments for a known vendor code.",
    instruction=(
        "You are the logistics specialist. Call inventory_lookup exactly once with the "
        "vendor_code you were given. If it returns an error, do not retry it: report "
        "clearly which check failed and why, and say that onboarding cannot be confirmed."
    ),
    tools=[inventory_lookup],
)

root_agent = LlmAgent(
    name="vendor_onboarding",
    model=MODEL,
    generate_content_config=DETERMINISTIC,
    description="Decides whether a supplier can be onboarded.",
    instruction=(
        "You decide whether a supplier can be onboarded. Follow both steps, always, "
        "in order, and never skip step 2.\n"
        "Step 1: call vendor_lookup with the supplier's name.\n"
        "Step 2: transfer to the 'logistics' agent so it can check inventory "
        "commitments for the vendor_code you found. You cannot check inventory "
        "yourself and you must not answer before logistics has reported.\n"
        "Keep every reply to two sentences."
    ),
    tools=[vendor_lookup],
    sub_agents=[logistics_agent],
)


async def main() -> int:
    if os.environ.get("GOOGLE_API_KEY") is None and os.environ.get("GEMINI_API_KEY") is None:
        print("Set GOOGLE_API_KEY (or GEMINI_API_KEY) before running the demo agent.")
        return 2
    # ADK reads GOOGLE_API_KEY; accept the FleetScope repo's own variable too.
    os.environ.setdefault("GOOGLE_API_KEY", os.environ.get("GEMINI_API_KEY", ""))

    session_id = f"ses_{uuid.uuid4().hex[:12]}"
    sessions = InMemorySessionService()
    await sessions.create_session(app_name=APP_NAME, user_id=USER_ID, session_id=session_id)

    runner = Runner(
        app_name=APP_NAME,
        agent=root_agent,
        session_service=sessions,
        plugins=[FleetScopePlugin(app_name=APP_NAME)],
    )

    print(f"session: {session_id}")
    print(f"viewer:  {os.environ.get('FLEETSCOPE_ENDPOINT', 'http://127.0.0.1:4317')}/sessions/{session_id}")
    print()

    async for event in runner.run_async(
        user_id=USER_ID,
        session_id=session_id,
        new_message=types.Content(role="user", parts=[types.Part(text=PROMPT)]),
    ):
        if event.content is not None and event.content.parts:
            for part in event.content.parts:
                if part.text:
                    print(f"[{event.author}] {part.text.strip()}")

    await runner.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
