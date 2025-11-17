"""Notification plugin for desktop notifications"""

import asyncio
import logging
import platform
import re
import subprocess
from dataclasses import dataclass

from ..base import Plugin, PluginContext, PluginMetadata, PluginAPI, ReplyHandler

logger = logging.getLogger(__name__)


@dataclass
class NotificationConfig:
    """Notification configuration"""

    enabled: bool = True
    use_system_notifications: bool = True
    sound_enabled: bool = True


class NotificationBackend:
    """Base class for notification backends"""

    async def send(self, title: str, message: str) -> bool:
        """Send notification

        Args:
            title: Notification title
            message: Notification message

        Returns:
            True if successful
        """
        raise NotImplementedError


class WindowsNotificationBackend(NotificationBackend):
    """Windows notification backend using PowerShell"""

    async def send(self, title: str, message: str) -> bool:
        """Send Windows notification

        Uses PowerShell to show toast notification.

        Args:
            title: Notification title
            message: Notification message

        Returns:
            True if successful
        """
        try:
            # PowerShell script to show toast notification
            ps_script = f"""
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$template = @"
<toast>
    <visual>
        <binding template="ToastText02">
            <text id="1">{title}</text>
            <text id="2">{message}</text>
        </binding>
    </visual>
</toast>
"@

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Ye Linghua")
$notifier.Show($toast)
"""

            # Execute PowerShell
            process = await asyncio.create_subprocess_exec(
                "powershell",
                "-NoProfile",
                "-Command",
                ps_script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            await process.communicate()
            return process.returncode == 0

        except Exception as e:
            logger.error(f"Windows notification error: {e}")
            return False


class LinuxNotificationBackend(NotificationBackend):
    """Linux notification backend using notify-send"""

    async def send(self, title: str, message: str) -> bool:
        """Send Linux notification

        Uses notify-send command.

        Args:
            title: Notification title
            message: Notification message

        Returns:
            True if successful
        """
        try:
            process = await asyncio.create_subprocess_exec(
                "notify-send",
                title,
                message,
                "-u",
                "normal",
                "-i",
                "dialog-information",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            await process.communicate()
            return process.returncode == 0

        except FileNotFoundError:
            logger.error("notify-send not found. Install libnotify-bin on Ubuntu/Debian")
            return False
        except Exception as e:
            logger.error(f"Linux notification error: {e}")
            return False


class MacOSNotificationBackend(NotificationBackend):
    """macOS notification backend using osascript"""

    async def send(self, title: str, message: str) -> bool:
        """Send macOS notification

        Uses osascript (AppleScript).

        Args:
            title: Notification title
            message: Notification message

        Returns:
            True if successful
        """
        try:
            script = f'display notification "{message}" with title "{title}"'

            process = await asyncio.create_subprocess_exec(
                "osascript",
                "-e",
                script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            await process.communicate()
            return process.returncode == 0

        except Exception as e:
            logger.error(f"macOS notification error: {e}")
            return False


class NotificationReplyHandler(ReplyHandler):
    """Reply handler for notification tags"""

    TAG_PATTERN = re.compile(r"<notify\s+title=[\"']([^\"']+)[\"']\s+message=[\"']([^\"']+)[\"']\s*/?>", re.IGNORECASE)

    def __init__(self, plugin: "NotificationPlugin"):
        """Initialize notification reply handler

        Args:
            plugin: Notification plugin instance
        """
        super().__init__(plugin)
        self.notification_plugin = plugin

    async def handle_reply(self, response: str, context: PluginContext) -> tuple[str, bool]:
        """Handle reply and process notification tags

        Args:
            response: LLM response
            context: Current context

        Returns:
            Tuple of (modified_response, should_continue)
        """
        modified_response = response

        # Find and process all <notify> tags
        for match in self.TAG_PATTERN.finditer(response):
            title = match.group(1)
            message = match.group(2)

            # Send notification
            success = await self.notification_plugin.send_notification(title, message)

            # Replace tag with confirmation
            if success:
                replacement = f"🔔 已发送通知"
            else:
                replacement = f"❌ 通知发送失败"

            modified_response = modified_response.replace(match.group(0), replacement)

        return modified_response, True

    @property
    def priority(self) -> int:
        """Handler priority"""
        return 60  # Lower priority than timer


class NotificationAPI(PluginAPI):
    """Notification API for platform integration"""

    def __init__(self, plugin: "NotificationPlugin"):
        """Initialize notification API

        Args:
            plugin: Notification plugin instance
        """
        self.plugin = plugin

    def get_platform_name(self) -> str:
        """Get platform name"""
        return "notification"

    async def send_notification(self, title: str, message: str) -> bool:
        """Send platform notification

        Args:
            title: Notification title
            message: Notification message

        Returns:
            True if successful
        """
        return await self.plugin.send_notification(title, message)


class NotificationPlugin(Plugin):
    """Plugin for sending desktop notifications"""

    def __init__(self, config: NotificationConfig | None = None):
        """Initialize notification plugin

        Args:
            config: Notification configuration
        """
        metadata = PluginMetadata(
            id="notification",
            name="Notification Plugin",
            version="1.0.0",
            description="Desktop notifications support",
        )
        super().__init__(metadata)

        self.config = config or NotificationConfig()
        self.backend: NotificationBackend | None = None
        self.api = NotificationAPI(self)

    async def initialize(self) -> None:
        """Initialize plugin"""
        # Detect platform and select appropriate backend
        system = platform.system()

        if system == "Windows":
            self.backend = WindowsNotificationBackend()
        elif system == "Linux":
            self.backend = LinuxNotificationBackend()
        elif system == "Darwin":  # macOS
            self.backend = MacOSNotificationBackend()
        else:
            logger.warning(f"Unsupported platform for notifications: {system}")
            self.backend = None

        self._initialized = True
        logger.info(f"Notification plugin initialized (platform: {system})")

    async def shutdown(self) -> None:
        """Shutdown plugin"""
        self._initialized = False
        logger.info("Notification plugin shutdown")

    async def send_notification(self, title: str, message: str) -> bool:
        """Send a notification

        Args:
            title: Notification title
            message: Notification message

        Returns:
            True if successful
        """
        if not self.config.enabled:
            logger.debug("Notifications disabled")
            return False

        if not self.backend:
            logger.warning("No notification backend available")
            return False

        try:
            return await self.backend.send(title, message)
        except Exception as e:
            logger.error(f"Error sending notification: {e}")
            return False

    def get_prompt_extension(self, context: PluginContext) -> str:
        """Get prompt extension

        Args:
            context: Current context

        Returns:
            Prompt extension text
        """
        if not self.config.enabled or not self.backend:
            return ""

        return """
## 通知功能

你可以使用 `<notify>` 标记来发送桌面通知：

```xml
<notify title="提醒" message="记得查看邮件" />
<notify title="任务完成" message="代码审查已完成" />
```

使用这个标记时，系统会自动发送桌面通知给用户。
"""

    def get_reply_handlers(self) -> list[ReplyHandler]:
        """Get reply handlers

        Returns:
            List of reply handlers
        """
        return [NotificationReplyHandler(self)]

    def get_api(self) -> NotificationAPI:
        """Get notification API

        Returns:
            Notification API instance
        """
        return self.api


# Export plugin class
__all__ = ["NotificationPlugin", "NotificationConfig", "NotificationAPI"]
