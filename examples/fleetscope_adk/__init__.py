"""FleetScope's Google ADK adapter.

Register it once on the Runner and the whole invocation is observed::

    from fleetscope_adk import FleetScopePlugin

    runner = Runner(agent=root_agent, plugins=[FleetScopePlugin()], ...)
"""

from .plugin import DEFAULT_ENDPOINT, FleetScopePlugin

__all__ = ["FleetScopePlugin", "DEFAULT_ENDPOINT"]
