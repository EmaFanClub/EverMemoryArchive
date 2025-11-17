"""Plugin registry for managing loaded plugins"""

import logging
from typing import Any

from .base import Plugin, ReplyHandler

logger = logging.getLogger(__name__)


class PluginRegistry:
    """Registry for managing loaded plugins"""

    def __init__(self):
        """Initialize plugin registry"""
        self._plugins: dict[str, Plugin] = {}
        self._reply_handlers: dict[str, list[ReplyHandler]] = {}

    def register(self, plugin: Plugin) -> None:
        """Register a plugin

        Args:
            plugin: Plugin to register
        """
        plugin_id = plugin.metadata.id

        # If plugin already exists, unregister old one first
        if plugin_id in self._plugins:
            logger.info(f"Replacing existing plugin: {plugin_id}")
            self.unregister(plugin_id)

        self._plugins[plugin_id] = plugin
        logger.info(f"Registered plugin: {plugin_id} ({plugin.metadata.name})")

        # Register reply handlers if plugin has them
        if hasattr(plugin, "get_reply_handlers"):
            handlers = plugin.get_reply_handlers()
            if handlers:
                self._reply_handlers[plugin_id] = handlers
                logger.debug(f"Registered {len(handlers)} reply handlers for {plugin_id}")

    def unregister(self, plugin_id: str) -> bool:
        """Unregister a plugin

        Args:
            plugin_id: Plugin ID

        Returns:
            True if successful
        """
        if plugin_id not in self._plugins:
            return False

        del self._plugins[plugin_id]

        # Remove reply handlers
        if plugin_id in self._reply_handlers:
            del self._reply_handlers[plugin_id]

        logger.info(f"Unregistered plugin: {plugin_id}")
        return True

    def get_plugin(self, plugin_id: str) -> Plugin | None:
        """Get plugin by ID

        Args:
            plugin_id: Plugin ID

        Returns:
            Plugin or None if not found
        """
        return self._plugins.get(plugin_id)

    def get_all_plugins(self) -> list[Plugin]:
        """Get all registered plugins

        Returns:
            List of all plugins
        """
        return list(self._plugins.values())

    def get_enabled_plugins(self) -> list[Plugin]:
        """Get all enabled plugins

        Returns:
            List of enabled plugins
        """
        return [p for p in self._plugins.values() if p.metadata.enabled]

    def enable_plugin(self, plugin_id: str) -> bool:
        """Enable a plugin

        Args:
            plugin_id: Plugin ID

        Returns:
            True if successful
        """
        plugin = self.get_plugin(plugin_id)
        if not plugin:
            return False

        plugin.metadata.enabled = True
        logger.info(f"Enabled plugin: {plugin_id}")
        return True

    def disable_plugin(self, plugin_id: str) -> bool:
        """Disable a plugin

        Args:
            plugin_id: Plugin ID

        Returns:
            True if successful
        """
        plugin = self.get_plugin(plugin_id)
        if not plugin:
            return False

        plugin.metadata.enabled = False
        logger.info(f"Disabled plugin: {plugin_id}")
        return True

    def get_reply_handlers(self) -> list[ReplyHandler]:
        """Get all reply handlers from enabled plugins

        Returns:
            List of reply handlers sorted by priority
        """
        handlers = []

        for plugin_id, plugin in self._plugins.items():
            if not plugin.metadata.enabled:
                continue

            if plugin_id in self._reply_handlers:
                handlers.extend(self._reply_handlers[plugin_id])

        # Sort by priority (lower number = higher priority)
        handlers.sort(key=lambda h: h.priority)

        return handlers

    def get_plugins_by_type(self, plugin_type: str) -> list[Plugin]:
        """Get plugins by type

        Args:
            plugin_type: Plugin type

        Returns:
            List of matching plugins
        """
        return [p for p in self._plugins.values() if p.metadata.plugin_type == plugin_type]
