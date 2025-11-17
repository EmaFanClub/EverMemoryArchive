"""Timer plugin for scheduled tasks and reminders"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Any

from ..base import Plugin, PluginContext, PluginMetadata, ReplyHandler

logger = logging.getLogger(__name__)


class RepeatStrategy(str, Enum):
    """Timer repeat strategy"""

    ONCE = "once"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


@dataclass
class TimerTask:
    """Timer task data"""

    id: str
    trigger_time: datetime
    reason: str
    repeat: RepeatStrategy
    context_summary: str
    platform: str
    user_id: str | None
    created_at: datetime
    enabled: bool = True


class TimerStorage:
    """Storage for timer tasks"""

    def __init__(self, storage_file: Path | str):
        """Initialize timer storage

        Args:
            storage_file: Path to JSON storage file
        """
        self.storage_file = Path(storage_file)
        self.timers: dict[str, TimerTask] = {}
        self._load()

    def _load(self) -> None:
        """Load timers from storage file"""
        if not self.storage_file.exists():
            return

        try:
            with open(self.storage_file, encoding="utf-8") as f:
                data = json.load(f)

            for timer_id, timer_data in data.items():
                try:
                    timer = TimerTask(
                        id=timer_id,
                        trigger_time=datetime.fromisoformat(timer_data["trigger_time"]),
                        reason=timer_data["reason"],
                        repeat=RepeatStrategy(timer_data["repeat"]),
                        context_summary=timer_data["context_summary"],
                        platform=timer_data["platform"],
                        user_id=timer_data.get("user_id"),
                        created_at=datetime.fromisoformat(timer_data["created_at"]),
                        enabled=timer_data.get("enabled", True),
                    )
                    self.timers[timer_id] = timer
                except Exception as e:
                    logger.error(f"Error loading timer {timer_id}: {e}")

        except Exception as e:
            logger.error(f"Error loading timer storage: {e}")

    def _save(self) -> None:
        """Save timers to storage file"""
        try:
            # Ensure directory exists
            self.storage_file.parent.mkdir(parents=True, exist_ok=True)

            data = {}
            for timer_id, timer in self.timers.items():
                data[timer_id] = {
                    "trigger_time": timer.trigger_time.isoformat(),
                    "reason": timer.reason,
                    "repeat": timer.repeat.value,
                    "context_summary": timer.context_summary,
                    "platform": timer.platform,
                    "user_id": timer.user_id,
                    "created_at": timer.created_at.isoformat(),
                    "enabled": timer.enabled,
                }

            with open(self.storage_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

        except Exception as e:
            logger.error(f"Error saving timer storage: {e}")

    def add_timer(self, timer: TimerTask) -> None:
        """Add a timer

        Args:
            timer: Timer task
        """
        self.timers[timer.id] = timer
        self._save()

    def remove_timer(self, timer_id: str) -> bool:
        """Remove a timer

        Args:
            timer_id: Timer ID

        Returns:
            True if successful
        """
        if timer_id in self.timers:
            del self.timers[timer_id]
            self._save()
            return True
        return False

    def get_timer(self, timer_id: str) -> TimerTask | None:
        """Get timer by ID

        Args:
            timer_id: Timer ID

        Returns:
            Timer task or None
        """
        return self.timers.get(timer_id)

    def get_all_timers(self) -> list[TimerTask]:
        """Get all timers

        Returns:
            List of timer tasks
        """
        return list(self.timers.values())

    def get_due_timers(self) -> list[TimerTask]:
        """Get timers that are due

        Returns:
            List of due timer tasks
        """
        now = datetime.now()
        due_timers = []

        for timer in self.timers.values():
            if timer.enabled and timer.trigger_time <= now:
                due_timers.append(timer)

        return due_timers


class TimerReplyHandler(ReplyHandler):
    """Reply handler for timer tags"""

    TAG_PATTERNS = {
        "set": re.compile(r"<set-timer\s+time=[\"']([^\"']+)[\"']\s+reason=[\"']([^\"']+)[\"'](?:\s+repeat=[\"']([^\"']+)[\"'])?\s*/?>", re.IGNORECASE),
        "list": re.compile(r"<list-timers\s*/?>", re.IGNORECASE),
        "remove": re.compile(r"<remove-timer\s+id=[\"']([^\"']+)[\"']\s*/?>", re.IGNORECASE),
    }

    def __init__(self, plugin: "TimerPlugin"):
        """Initialize timer reply handler

        Args:
            plugin: Timer plugin instance
        """
        super().__init__(plugin)
        self.timer_plugin = plugin

    async def handle_reply(self, response: str, context: PluginContext) -> tuple[str, bool]:
        """Handle reply and process timer tags

        Args:
            response: LLM response
            context: Current context

        Returns:
            Tuple of (modified_response, should_continue)
        """
        modified_response = response
        found_tags = False

        # Check for set-timer tags
        for match in self.TAG_PATTERNS["set"].finditer(response):
            found_tags = True
            time_str = match.group(1)
            reason = match.group(2)
            repeat = match.group(3) or "once"

            # Parse time and create timer
            timer_id = await self.timer_plugin.set_timer(
                time_str=time_str,
                reason=reason,
                repeat=RepeatStrategy(repeat.lower()),
                context=context,
            )

            # Replace tag with confirmation message
            replacement = f"✅ 已设置定时器 (ID: {timer_id[:8]})"
            modified_response = modified_response.replace(match.group(0), replacement)

        # Check for list-timers tags
        for match in self.TAG_PATTERNS["list"].finditer(response):
            found_tags = True
            timers_list = self.timer_plugin.list_timers()

            # Replace tag with timers list
            modified_response = modified_response.replace(match.group(0), timers_list)

        # Check for remove-timer tags
        for match in self.TAG_PATTERNS["remove"].finditer(response):
            found_tags = True
            timer_id = match.group(1)

            success = self.timer_plugin.remove_timer(timer_id)
            replacement = f"✅ 已删除定时器 {timer_id}" if success else f"❌ 找不到定时器 {timer_id}"
            modified_response = modified_response.replace(match.group(0), replacement)

        return modified_response, True

    @property
    def priority(self) -> int:
        """Handler priority"""
        return 50  # Medium priority


class TimerPlugin(Plugin):
    """Timer plugin for scheduled reminders"""

    def __init__(self, storage_file: Path | str | None = None):
        """Initialize timer plugin

        Args:
            storage_file: Path to timer storage file
        """
        metadata = PluginMetadata(
            id="timer",
            name="Timer Plugin",
            version="1.0.0",
            description="Scheduled tasks and reminders",
        )
        super().__init__(metadata)

        if storage_file is None:
            storage_file = Path.home() / ".ye-linghua" / "timers.json"

        self.storage = TimerStorage(storage_file)
        self._scheduler_task: asyncio.Task | None = None
        self._callback: callable | None = None

    async def initialize(self) -> None:
        """Initialize plugin"""
        # Start scheduler
        self._start_scheduler()
        self._initialized = True
        logger.info("Timer plugin initialized")

    async def shutdown(self) -> None:
        """Shutdown plugin"""
        if self._scheduler_task:
            self._scheduler_task.cancel()
            try:
                await self._scheduler_task
            except asyncio.CancelledError:
                pass

        self._initialized = False
        logger.info("Timer plugin shutdown")

    def set_callback(self, callback: callable) -> None:
        """Set callback for timer triggers

        Args:
            callback: Async callback function(timer: TimerTask) -> None
        """
        self._callback = callback

    async def set_timer(
        self,
        time_str: str,
        reason: str,
        repeat: RepeatStrategy,
        context: PluginContext,
    ) -> str:
        """Set a timer

        Args:
            time_str: Time string (e.g., "in 5 minutes", "2024-12-25 10:00")
            reason: Reason for timer
            repeat: Repeat strategy
            context: Current context

        Returns:
            Timer ID
        """
        # Parse time string
        trigger_time = self._parse_time_string(time_str)

        # Generate timer ID
        import uuid

        timer_id = str(uuid.uuid4())

        # Create timer task
        timer = TimerTask(
            id=timer_id,
            trigger_time=trigger_time,
            reason=reason,
            repeat=repeat,
            context_summary=context.get_message_summary(),
            platform=context.platform,
            user_id=context.user_id,
            created_at=datetime.now(),
        )

        # Store timer
        self.storage.add_timer(timer)

        logger.info(f"Set timer: {timer_id} for {trigger_time}")
        return timer_id

    def remove_timer(self, timer_id: str) -> bool:
        """Remove a timer

        Args:
            timer_id: Timer ID (can be partial match)

        Returns:
            True if successful
        """
        # Find matching timer
        for tid in self.storage.timers.keys():
            if tid.startswith(timer_id):
                return self.storage.remove_timer(tid)

        return False

    def list_timers(self) -> str:
        """List all timers

        Returns:
            Formatted string of all timers
        """
        timers = self.storage.get_all_timers()

        if not timers:
            return "📋 没有活动的定时器"

        lines = ["📋 活动定时器列表：\n"]
        for timer in timers:
            status = "✅" if timer.enabled else "❌"
            time_str = timer.trigger_time.strftime("%Y-%m-%d %H:%M:%S")
            lines.append(f"{status} [{timer.id[:8]}] {time_str} - {timer.reason} ({timer.repeat.value})")

        return "\n".join(lines)

    def _parse_time_string(self, time_str: str) -> datetime:
        """Parse time string to datetime

        Args:
            time_str: Time string

        Returns:
            Datetime object
        """
        time_str = time_str.lower().strip()

        # Try relative time (e.g., "in 5 minutes")
        if time_str.startswith("in "):
            parts = time_str[3:].strip().split()
            if len(parts) >= 2:
                try:
                    amount = int(parts[0])
                    unit = parts[1]

                    now = datetime.now()
                    if "minute" in unit:
                        return now + timedelta(minutes=amount)
                    elif "hour" in unit:
                        return now + timedelta(hours=amount)
                    elif "day" in unit:
                        return now + timedelta(days=amount)
                    elif "week" in unit:
                        return now + timedelta(weeks=amount)
                except ValueError:
                    pass

        # Try absolute time (ISO format)
        try:
            return datetime.fromisoformat(time_str)
        except ValueError:
            pass

        # Try common formats
        common_formats = [
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%m/%d/%Y %H:%M",
            "%d/%m/%Y %H:%M",
        ]

        for fmt in common_formats:
            try:
                return datetime.strptime(time_str, fmt)
            except ValueError:
                continue

        # Default: 1 hour from now
        logger.warning(f"Could not parse time string '{time_str}', defaulting to 1 hour")
        return datetime.now() + timedelta(hours=1)

    def _start_scheduler(self) -> None:
        """Start timer scheduler"""
        async def scheduler_loop():
            while True:
                try:
                    # Check for due timers
                    due_timers = self.storage.get_due_timers()

                    for timer in due_timers:
                        # Trigger callback
                        if self._callback:
                            try:
                                await self._callback(timer)
                            except Exception as e:
                                logger.error(f"Error in timer callback: {e}")

                        # Handle repeat
                        if timer.repeat == RepeatStrategy.ONCE:
                            self.storage.remove_timer(timer.id)
                        else:
                            # Calculate next trigger time
                            if timer.repeat == RepeatStrategy.DAILY:
                                timer.trigger_time += timedelta(days=1)
                            elif timer.repeat == RepeatStrategy.WEEKLY:
                                timer.trigger_time += timedelta(weeks=1)
                            elif timer.repeat == RepeatStrategy.MONTHLY:
                                # Approximate month as 30 days
                                timer.trigger_time += timedelta(days=30)

                            self.storage.add_timer(timer)

                    # Sleep before next check
                    await asyncio.sleep(30)  # Check every 30 seconds

                except asyncio.CancelledError:
                    break
                except Exception as e:
                    logger.error(f"Error in timer scheduler: {e}")
                    await asyncio.sleep(60)

        self._scheduler_task = asyncio.create_task(scheduler_loop())

    def get_prompt_extension(self, context: PluginContext) -> str:
        """Get prompt extension

        Args:
            context: Current context

        Returns:
            Prompt extension text
        """
        return """
## 定时器功能

你可以使用以下标记来管理定时器：

1. **设置定时器**:
   ```xml
   <set-timer time="in 5 minutes" reason="查看邮件" repeat="once" />
   <set-timer time="2024-12-25 10:00" reason="圣诞节提醒" repeat="daily" />
   ```

   - `time`: 时间（可以是 "in X minutes/hours/days" 或具体时间）
   - `reason`: 提醒原因
   - `repeat`: 重复策略（once, daily, weekly, monthly）

2. **列出所有定时器**:
   ```xml
   <list-timers />
   ```

3. **删除定时器**:
   ```xml
   <remove-timer id="timer-id-here" />
   ```

使用这些标记时，我会自动处理并显示结果。
"""

    def get_reply_handlers(self) -> list[ReplyHandler]:
        """Get reply handlers

        Returns:
            List of reply handlers
        """
        return [TimerReplyHandler(self)]


# Export plugin class
__all__ = ["TimerPlugin", "TimerTask", "RepeatStrategy"]
