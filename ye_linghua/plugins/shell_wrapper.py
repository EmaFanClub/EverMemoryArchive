"""Shell script plugin wrapper"""

import asyncio
import json
import logging
import platform
import subprocess
from pathlib import Path

from .base import Plugin, PluginContext, PluginMetadata, PluginType

logger = logging.getLogger(__name__)


class ShellPlugin(Plugin):
    """Wrapper for shell/PowerShell plugins

    Shell plugins are scripts that can be called with JSON input/output.

    Script interface:
        Input (stdin): JSON with context data
        Output (stdout): JSON with result
    """

    def __init__(self, script_path: Path):
        """Initialize shell plugin

        Args:
            script_path: Path to shell script
        """
        self.script_path = script_path

        # Determine script type
        if script_path.suffix == ".ps1":
            plugin_type = PluginType.POWERSHELL
            interpreter = "powershell" if platform.system() == "Windows" else "pwsh"
        elif script_path.suffix == ".sh":
            plugin_type = PluginType.SHELL
            interpreter = "bash"
        else:
            raise ValueError(f"Unsupported script type: {script_path.suffix}")

        self.interpreter = interpreter

        # Create metadata from script
        metadata = PluginMetadata(
            id=f"shell_{script_path.stem}",
            name=script_path.stem.replace("_", " ").title(),
            version="1.0.0",
            description=f"Shell plugin: {script_path.name}",
            plugin_type=plugin_type,
        )

        super().__init__(metadata)

    async def initialize(self) -> None:
        """Initialize plugin"""
        # Verify script exists and is executable
        if not self.script_path.exists():
            raise FileNotFoundError(f"Script not found: {self.script_path}")

        # Try to read metadata from script comments
        try:
            await self._read_script_metadata()
        except Exception as e:
            logger.warning(f"Could not read metadata from {self.script_path}: {e}")

        self._initialized = True

    async def shutdown(self) -> None:
        """Shutdown plugin"""
        self._initialized = False

    async def _read_script_metadata(self) -> None:
        """Read metadata from script comments

        Looks for special comment blocks like:
            # PLUGIN_NAME: My Plugin
            # PLUGIN_VERSION: 1.0.0
            # PLUGIN_DESCRIPTION: Does something cool
        """
        with open(self.script_path, encoding="utf-8") as f:
            content = f.read()

        lines = content.split("\n")
        for line in lines:
            line = line.strip()
            if line.startswith("#") and ":" in line:
                key_value = line[1:].strip()
                if key_value.startswith("PLUGIN_"):
                    key, value = key_value.split(":", 1)
                    key = key.replace("PLUGIN_", "").lower()
                    value = value.strip()

                    if key == "name":
                        self.metadata.name = value
                    elif key == "version":
                        self.metadata.version = value
                    elif key == "description":
                        self.metadata.description = value
                    elif key == "id":
                        self.metadata.id = value

    async def execute_script(
        self,
        action: str,
        data: dict[str, any] | None = None,
    ) -> dict[str, any]:
        """Execute shell script with data

        Args:
            action: Action to perform
            data: Input data

        Returns:
            Script output as dictionary
        """
        input_data = {
            "action": action,
            "data": data or {},
        }

        try:
            # Execute script
            cmd = [self.interpreter, str(self.script_path)]

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            # Send input data
            input_json = json.dumps(input_data).encode("utf-8")
            stdout, stderr = await process.communicate(input=input_json)

            if process.returncode != 0:
                error_msg = stderr.decode("utf-8")
                logger.error(f"Script error: {error_msg}")
                return {"success": False, "error": error_msg}

            # Parse output
            output_str = stdout.decode("utf-8")
            try:
                result = json.loads(output_str)
                return result
            except json.JSONDecodeError:
                # If output is not JSON, wrap it
                return {"success": True, "output": output_str}

        except Exception as e:
            logger.error(f"Error executing script {self.script_path}: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    def get_prompt_extension(self, context: PluginContext) -> str:
        """Get prompt extension

        Args:
            context: Current context

        Returns:
            Prompt extension text
        """
        # Execute script with "get_prompt" action
        try:
            loop = asyncio.get_event_loop()
            result = loop.run_until_complete(self.execute_script("get_prompt", {"context": context.__dict__}))

            if result.get("success"):
                return result.get("prompt", "")
            return ""
        except Exception as e:
            logger.error(f"Error getting prompt extension from shell plugin: {e}")
            return ""

    def get_context_extension(self, context: PluginContext) -> dict[str, any]:
        """Get context extension

        Args:
            context: Current context

        Returns:
            Context extension dictionary
        """
        try:
            loop = asyncio.get_event_loop()
            result = loop.run_until_complete(self.execute_script("get_context", {"context": context.__dict__}))

            if result.get("success"):
                return result.get("context", {})
            return {}
        except Exception as e:
            logger.error(f"Error getting context extension from shell plugin: {e}")
            return {}
