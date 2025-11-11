"""ACP (Agent Client Protocol) integration for Mini-Agent.

This module provides ACP support, allowing Mini-Agent to communicate
with ACP-compatible clients (like Zed) over stdin/stdout using JSON-RPC.
"""

from mini_agent.acp.agent import MiniMaxACPAgent
from mini_agent.acp.server import run_acp_server

__all__ = ["MiniMaxACPAgent", "run_acp_server"]
