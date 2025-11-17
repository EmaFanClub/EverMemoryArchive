"""Base classes for plugin system"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable


class PluginType(str, Enum):
    """Plugin type enumeration"""

    PYTHON = "python"
    SHELL = "shell"
    POWERSHELL = "powershell"


@dataclass
class PluginMetadata:
    """Plugin metadata"""

    id: str
    name: str
    version: str
    description: str
    author: str = ""
    plugin_type: PluginType = PluginType.PYTHON
    enabled: bool = True
    dependencies: list[str] = field(default_factory=list)
    config: dict[str, Any] = field(default_factory=dict)


@dataclass
class PluginContext:
    """Context passed to plugins during execution

    Attributes:
        messages: Conversation message history
        platform: Platform identifier (e.g., "cli", "web", "discord")
        user_id: User identifier
        session_id: Session identifier
        config: Runtime configuration
        extra: Additional context data
    """

    messages: list[dict[str, Any]] = field(default_factory=list)
    platform: str = "cli"
    user_id: str | None = None
    session_id: str | None = None
    config: dict[str, Any] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)

    def get_recent_messages(self, count: int = 5) -> list[dict[str, Any]]:
        """Get recent messages from history

        Args:
            count: Number of recent messages to retrieve

        Returns:
            List of recent messages
        """
        return self.messages[-count:] if len(self.messages) > count else self.messages

    def get_message_summary(self) -> str:
        """Generate a summary of recent messages

        Returns:
            Summary string
        """
        recent = self.get_recent_messages()
        summary_parts = []

        for msg in recent:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            if isinstance(content, str):
                # Truncate long messages
                content_preview = content[:100] + "..." if len(content) > 100 else content
                summary_parts.append(f"[{role}]: {content_preview}")

        return "\n".join(summary_parts)


class Plugin(ABC):
    """Base class for all plugins

    All plugins must inherit from this class and implement required methods.
    """

    def __init__(self, metadata: PluginMetadata):
        """Initialize plugin

        Args:
            metadata: Plugin metadata
        """
        self.metadata = metadata
        self._initialized = False

    @abstractmethod
    async def initialize(self) -> None:
        """Initialize plugin resources

        Called once when plugin is loaded.
        """
        pass

    @abstractmethod
    async def shutdown(self) -> None:
        """Cleanup plugin resources

        Called when plugin is unloaded or system shuts down.
        """
        pass

    @abstractmethod
    def get_prompt_extension(self, context: PluginContext) -> str:
        """Get prompt extension for this plugin

        This text will be injected into the system prompt to inform
        the LLM about the plugin's capabilities.

        Args:
            context: Current plugin context

        Returns:
            Prompt extension text
        """
        pass

    def get_context_extension(self, context: PluginContext) -> dict[str, Any]:
        """Get additional context data for this plugin

        Override this to provide extra context data that will be
        available to the LLM or other plugins.

        Args:
            context: Current plugin context

        Returns:
            Additional context dictionary
        """
        return {}

    @property
    def is_initialized(self) -> bool:
        """Check if plugin is initialized"""
        return self._initialized


class ReplyHandler(ABC):
    """Base class for reply handlers

    Reply handlers process LLM responses and can:
    - Extract special tags/markers
    - Trigger external actions
    - Modify response content
    - Request response regeneration
    """

    def __init__(self, plugin: Plugin):
        """Initialize reply handler

        Args:
            plugin: Associated plugin
        """
        self.plugin = plugin

    @abstractmethod
    async def handle_reply(
        self,
        response: str,
        context: PluginContext,
    ) -> tuple[str, bool]:
        """Handle LLM reply

        Args:
            response: LLM response text
            context: Current context

        Returns:
            Tuple of (modified_response, should_continue)
            - modified_response: Potentially modified response text
            - should_continue: True if processing should continue to next handler
        """
        pass

    @property
    def priority(self) -> int:
        """Handler priority (lower number = higher priority)

        Handlers are executed in priority order.
        """
        return 100


class PluginAPI(ABC):
    """Base class for platform-specific API plugins

    Platform API plugins expose platform capabilities to other plugins.
    """

    @abstractmethod
    def get_platform_name(self) -> str:
        """Get platform name"""
        pass

    @abstractmethod
    async def send_notification(self, title: str, message: str) -> bool:
        """Send platform notification

        Args:
            title: Notification title
            message: Notification message

        Returns:
            True if successful
        """
        pass
