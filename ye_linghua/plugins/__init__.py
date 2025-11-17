"""Plugin system for Ye Linghua

This module provides a flexible plugin architecture supporting:
- Python-based plugins
- PowerShell/Shell script plugins
- Hot reloading
- Reply handlers chain
- Context injection
"""

from .base import Plugin, PluginContext, PluginMetadata, ReplyHandler
from .loader import PluginLoader, PluginManager
from .registry import PluginRegistry

__all__ = [
    "Plugin",
    "PluginContext",
    "PluginMetadata",
    "ReplyHandler",
    "PluginLoader",
    "PluginManager",
    "PluginRegistry",
]
