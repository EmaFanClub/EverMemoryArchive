"""Plugin loader and manager"""

import asyncio
import importlib
import importlib.util
import logging
import sys
from pathlib import Path
from typing import Any

from .base import Plugin, PluginContext, PluginMetadata, PluginType, ReplyHandler
from .registry import PluginRegistry

logger = logging.getLogger(__name__)


class PluginLoader:
    """Plugin loader supporting Python and script-based plugins"""

    def __init__(self, plugins_dir: Path | str):
        """Initialize plugin loader

        Args:
            plugins_dir: Directory containing plugins
        """
        self.plugins_dir = Path(plugins_dir)
        self.loaded_modules: dict[str, Any] = {}

    async def load_plugin(self, plugin_path: Path) -> Plugin | None:
        """Load a single plugin

        Args:
            plugin_path: Path to plugin directory or script

        Returns:
            Loaded plugin instance or None if failed
        """
        try:
            if plugin_path.is_dir():
                return await self._load_python_plugin(plugin_path)
            elif plugin_path.suffix == ".py":
                return await self._load_python_script(plugin_path)
            elif plugin_path.suffix in [".ps1", ".sh"]:
                return await self._load_shell_plugin(plugin_path)
            else:
                logger.warning(f"Unsupported plugin type: {plugin_path}")
                return None

        except Exception as e:
            logger.error(f"Failed to load plugin {plugin_path}: {e}", exc_info=True)
            return None

    async def _load_python_plugin(self, plugin_dir: Path) -> Plugin | None:
        """Load Python plugin from directory

        Expected structure:
        plugin_dir/
            __init__.py  (contains Plugin subclass)
            metadata.yaml (optional)

        Args:
            plugin_dir: Plugin directory

        Returns:
            Plugin instance
        """
        init_file = plugin_dir / "__init__.py"
        if not init_file.exists():
            logger.error(f"Plugin directory missing __init__.py: {plugin_dir}")
            return None

        # Import module
        module_name = f"ye_linghua.plugins.{plugin_dir.name}"
        try:
            spec = importlib.util.spec_from_file_location(module_name, init_file)
            if spec is None or spec.loader is None:
                logger.error(f"Failed to create spec for {plugin_dir}")
                return None

            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)

            # Store module for hot reload
            self.loaded_modules[module_name] = module

            # Find Plugin subclass
            plugin_class = None
            for item_name in dir(module):
                item = getattr(module, item_name)
                if (
                    isinstance(item, type)
                    and issubclass(item, Plugin)
                    and item is not Plugin
                ):
                    plugin_class = item
                    break

            if plugin_class is None:
                logger.error(f"No Plugin subclass found in {plugin_dir}")
                return None

            # Instantiate plugin
            plugin = plugin_class()
            await plugin.initialize()

            logger.info(f"Loaded Python plugin: {plugin.metadata.name}")
            return plugin

        except Exception as e:
            logger.error(f"Error loading Python plugin {plugin_dir}: {e}", exc_info=True)
            return None

    async def _load_python_script(self, script_path: Path) -> Plugin | None:
        """Load standalone Python plugin script

        Args:
            script_path: Path to Python script

        Returns:
            Plugin instance
        """
        # Similar to _load_python_plugin but for single file
        module_name = f"ye_linghua.plugins.{script_path.stem}"

        try:
            spec = importlib.util.spec_from_file_location(module_name, script_path)
            if spec is None or spec.loader is None:
                return None

            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)

            self.loaded_modules[module_name] = module

            # Find Plugin subclass
            for item_name in dir(module):
                item = getattr(module, item_name)
                if (
                    isinstance(item, type)
                    and issubclass(item, Plugin)
                    and item is not Plugin
                ):
                    plugin = item()
                    await plugin.initialize()
                    logger.info(f"Loaded Python script plugin: {plugin.metadata.name}")
                    return plugin

            return None

        except Exception as e:
            logger.error(f"Error loading Python script {script_path}: {e}", exc_info=True)
            return None

    async def _load_shell_plugin(self, script_path: Path) -> Plugin | None:
        """Load shell/PowerShell plugin

        Shell plugins are wrapped in a Python plugin that executes the script.

        Args:
            script_path: Path to shell script

        Returns:
            Plugin instance
        """
        from .shell_wrapper import ShellPlugin

        try:
            plugin = ShellPlugin(script_path)
            await plugin.initialize()
            logger.info(f"Loaded shell plugin: {plugin.metadata.name}")
            return plugin
        except Exception as e:
            logger.error(f"Error loading shell plugin {script_path}: {e}", exc_info=True)
            return None

    async def reload_plugin(self, plugin: Plugin) -> Plugin | None:
        """Reload a plugin (hot reload)

        Args:
            plugin: Plugin to reload

        Returns:
            New plugin instance or None if failed
        """
        try:
            # Shutdown old plugin
            await plugin.shutdown()

            # Reload module
            module_name = plugin.__class__.__module__
            if module_name in self.loaded_modules:
                importlib.reload(self.loaded_modules[module_name])

            # Get new class and instantiate
            module = self.loaded_modules[module_name]
            for item_name in dir(module):
                item = getattr(module, item_name)
                if (
                    isinstance(item, type)
                    and issubclass(item, Plugin)
                    and item is not Plugin
                ):
                    new_plugin = item()
                    await new_plugin.initialize()
                    logger.info(f"Reloaded plugin: {new_plugin.metadata.name}")
                    return new_plugin

            return None

        except Exception as e:
            logger.error(f"Error reloading plugin: {e}", exc_info=True)
            return None


class PluginManager:
    """Plugin manager for loading, managing, and coordinating plugins"""

    def __init__(self, plugins_dir: Path | str | None = None):
        """Initialize plugin manager

        Args:
            plugins_dir: Directory containing plugins
        """
        self.plugins_dir = Path(plugins_dir) if plugins_dir else Path("./plugins")
        self.loader = PluginLoader(self.plugins_dir)
        self.registry = PluginRegistry()
        self._watch_task: asyncio.Task | None = None

    async def discover_and_load_plugins(self) -> None:
        """Discover and load all plugins from plugins directory"""
        if not self.plugins_dir.exists():
            logger.warning(f"Plugins directory not found: {self.plugins_dir}")
            self.plugins_dir.mkdir(parents=True, exist_ok=True)
            return

        logger.info(f"Discovering plugins in: {self.plugins_dir}")

        # Scan for plugin directories and scripts
        for item in self.plugins_dir.iterdir():
            if item.name.startswith("_") or item.name.startswith("."):
                continue

            if item.is_dir() or item.suffix in [".py", ".ps1", ".sh"]:
                plugin = await self.loader.load_plugin(item)
                if plugin:
                    self.registry.register(plugin)

        logger.info(f"Loaded {len(self.registry.get_all_plugins())} plugins")

    async def enable_plugin(self, plugin_id: str) -> bool:
        """Enable a plugin

        Args:
            plugin_id: Plugin ID

        Returns:
            True if successful
        """
        return self.registry.enable_plugin(plugin_id)

    async def disable_plugin(self, plugin_id: str) -> bool:
        """Disable a plugin

        Args:
            plugin_id: Plugin ID

        Returns:
            True if successful
        """
        return self.registry.disable_plugin(plugin_id)

    async def reload_plugin(self, plugin_id: str) -> bool:
        """Reload a plugin (hot reload)

        Args:
            plugin_id: Plugin ID

        Returns:
            True if successful
        """
        plugin = self.registry.get_plugin(plugin_id)
        if not plugin:
            return False

        new_plugin = await self.loader.reload_plugin(plugin)
        if new_plugin:
            self.registry.register(new_plugin)
            return True

        return False

    def get_enabled_plugins(self) -> list[Plugin]:
        """Get all enabled plugins

        Returns:
            List of enabled plugins
        """
        return self.registry.get_enabled_plugins()

    def get_reply_handlers(self) -> list[ReplyHandler]:
        """Get all reply handlers from enabled plugins

        Returns:
            List of reply handlers sorted by priority
        """
        return self.registry.get_reply_handlers()

    def build_prompt_extensions(self, context: PluginContext) -> str:
        """Build combined prompt extensions from all enabled plugins

        Args:
            context: Current context

        Returns:
            Combined prompt extension text
        """
        extensions = []
        for plugin in self.get_enabled_plugins():
            try:
                ext = plugin.get_prompt_extension(context)
                if ext:
                    extensions.append(ext)
            except Exception as e:
                logger.error(f"Error getting prompt extension from {plugin.metadata.id}: {e}")

        return "\n\n".join(extensions) if extensions else ""

    def build_context_extensions(self, context: PluginContext) -> dict[str, Any]:
        """Build combined context extensions from all enabled plugins

        Args:
            context: Current context

        Returns:
            Combined context dictionary
        """
        combined = {}
        for plugin in self.get_enabled_plugins():
            try:
                ext = plugin.get_context_extension(context)
                if ext:
                    combined.update(ext)
            except Exception as e:
                logger.error(f"Error getting context extension from {plugin.metadata.id}: {e}")

        return combined

    async def shutdown_all(self) -> None:
        """Shutdown all plugins"""
        for plugin in self.registry.get_all_plugins():
            try:
                await plugin.shutdown()
            except Exception as e:
                logger.error(f"Error shutting down plugin {plugin.metadata.id}: {e}")

    def start_watch(self, interval: float = 5.0) -> None:
        """Start watching for plugin changes (for hot reload)

        Args:
            interval: Check interval in seconds
        """
        if self._watch_task is not None:
            return

        async def watch_loop():
            while True:
                await asyncio.sleep(interval)
                # TODO: Implement file change detection and auto-reload
                pass

        self._watch_task = asyncio.create_task(watch_loop())

    def stop_watch(self) -> None:
        """Stop watching for changes"""
        if self._watch_task:
            self._watch_task.cancel()
            self._watch_task = None
