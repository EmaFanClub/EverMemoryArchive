"""Session management for ACP multi-session support.

Manages concurrent sessions, each with its own:
- Message history
- Working directory
- Agent instance
- MCP server configuration
"""

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mini_agent.agent import Agent
from mini_agent.llm import LLMClient
from mini_agent.schema.schema import Message
from mini_agent.tools.file_tools import ReadTool, WriteTool, EditTool


@dataclass
class SessionState:
    """State for a single ACP session.

    Attributes:
        session_id: Unique session identifier
        cwd: Working directory for this session
        agent: Mini-Agent instance for this session
        messages: Message history
        mcp_servers: MCP server configurations
        cancel_event: Event to signal cancellation
    """

    session_id: str
    cwd: str
    agent: Agent
    messages: list[Message]
    mcp_servers: list[dict[str, Any]]
    cancel_event: asyncio.Event


class SessionManager:
    """Manages multiple concurrent ACP sessions.

    Each session has its own agent instance and message history,
    allowing true concurrent session support as required by ACP.
    """

    def __init__(self, llm_client: LLMClient, tools: list[Any], system_prompt: str):
        """Initialize session manager.

        Args:
            llm_client: LLM client instance (shared across sessions)
            tools: List of available tools (shared across sessions)
            system_prompt: System prompt (shared across sessions)
        """
        self._llm_client = llm_client
        self._tools = tools
        self._system_prompt = system_prompt
        self._sessions: dict[str, SessionState] = {}
        self._lock = asyncio.Lock()

    async def create_session(
        self, session_id: str, cwd: str, mcp_servers: list[dict[str, Any]]
    ) -> SessionState:
        """Create a new session.

        Args:
            session_id: Unique session identifier
            cwd: Working directory for this session
            mcp_servers: MCP server configurations

        Returns:
            New session state
        """
        async with self._lock:
            if session_id in self._sessions:
                raise ValueError(f"Session {session_id} already exists")

            # Rebind file tools to the session's working directory
            session_tools = []
            for tool in self._tools:
                if isinstance(tool, (ReadTool, WriteTool, EditTool)):
                    # Create a fresh instance bound to session cwd
                    session_tools.append(tool.__class__(workspace_dir=cwd))
                else:
                    # Reuse non-filesystem tools as-is
                    session_tools.append(tool)

            # Create session-specific agent (workspace set to cwd)
            agent = Agent(
                llm_client=self._llm_client,
                tools=session_tools,
                system_prompt=self._system_prompt,
                workspace_dir=Path(cwd),
            )

            session = SessionState(
                session_id=session_id,
                cwd=cwd,
                agent=agent,
                messages=[],
                mcp_servers=mcp_servers,
                cancel_event=asyncio.Event(),
            )

            self._sessions[session_id] = session
            return session

    async def get_session(self, session_id: str) -> SessionState | None:
        """Get session by ID.

        Args:
            session_id: Session identifier

        Returns:
            Session state or None if not found
        """
        async with self._lock:
            return self._sessions.get(session_id)

    async def remove_session(self, session_id: str) -> None:
        """Remove a session.

        Args:
            session_id: Session identifier
        """
        async with self._lock:
            if session_id in self._sessions:
                # Signal cancellation
                self._sessions[session_id].cancel_event.set()
                del self._sessions[session_id]

    async def cancel_session(self, session_id: str) -> None:
        """Cancel ongoing operations for a session.

        Args:
            session_id: Session identifier
        """
        async with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id].cancel_event.set()
