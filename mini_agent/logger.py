"""Agent 运行日志记录器"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict


class AgentLogger:
    """Agent 运行日志记录器

    负责记录每次 agent 运行的完整交互过程，包括：
    - LLM 请求和响应
    - 工具调用和结果
    """

    def __init__(self, workspace_dir: Path):
        """初始化日志记录器

        Args:
            workspace_dir: 工作目录路径
        """
        self.workspace_dir = workspace_dir
        self.log_file = None
        self.log_index = 0

    def start_new_run(self):
        """开始新的运行，创建新的日志文件"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_filename = f"agent_run_{timestamp}.log"
        self.log_file = self.workspace_dir / log_filename
        self.log_index = 0

        # 写入日志头部
        with open(self.log_file, "w", encoding="utf-8") as f:
            f.write("=" * 80 + "\n")
            f.write(f"Agent Run Log - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write("=" * 80 + "\n\n")

    def log_request(self, messages: list, tools: list = None):
        """记录 LLM 请求

        Args:
            messages: 消息列表
            tools: 工具列表（可选）
        """
        self.log_index += 1

        content = "LLM Request:\n\n"
        content += f"Message Count: {len(messages)}\n"

        # 格式化消息
        content += "\nMessages:\n"
        for i, msg in enumerate(messages):
            content += f"\n--- Message {i + 1} ---\n"
            content += f"Role: {msg.role}\n"

            if isinstance(msg.content, str):
                content += f"Content: {msg.content}\n"
            elif isinstance(msg.content, list):
                content += f"Content (blocks): {json.dumps(msg.content, indent=2, ensure_ascii=False)}\n"

            if msg.thinking:
                content += f"Thinking: {msg.thinking}\n"

            if msg.tool_calls:
                content += f"Tool Calls: {json.dumps(msg.tool_calls, indent=2, ensure_ascii=False)}\n"

            if msg.tool_call_id:
                content += f"Tool Call ID: {msg.tool_call_id}\n"

        # 工具信息
        if tools:
            content += f"\nAvailable Tools: {len(tools)}\n"
            for tool in tools:
                content += f"  - {tool.get('function', {}).get('name', 'unknown')}\n"

        self._write_log("REQUEST", content)

    def log_response(
        self,
        content: str,
        thinking: str = None,
        tool_calls: list = None,
        finish_reason: str = None,
    ):
        """记录 LLM 响应

        Args:
            content: 响应内容
            thinking: 思考内容（可选）
            tool_calls: 工具调用列表（可选）
            finish_reason: 完成原因（可选）
        """
        self.log_index += 1

        log_content = "LLM Response:\n\n"

        if thinking:
            log_content += f"Thinking:\n{thinking}\n\n"

        log_content += f"Content:\n{content}\n\n"

        if tool_calls:
            log_content += f"Tool Calls ({len(tool_calls)}):\n"
            for i, tc in enumerate(tool_calls):
                log_content += f"\n--- Tool Call {i + 1} ---\n"
                log_content += json.dumps(tc, indent=2, ensure_ascii=False) + "\n"

        if finish_reason:
            log_content += f"\nFinish Reason: {finish_reason}\n"

        self._write_log("RESPONSE", log_content)

    def log_tool_result(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        result_success: bool,
        result_content: str = None,
        result_error: str = None,
    ):
        """记录工具执行结果

        Args:
            tool_name: 工具名称
            arguments: 工具参数
            result_success: 是否成功
            result_content: 结果内容（成功时）
            result_error: 错误信息（失败时）
        """
        self.log_index += 1

        content = f"Tool Execution: {tool_name}\n\n"
        content += (
            f"Arguments:\n{json.dumps(arguments, indent=2, ensure_ascii=False)}\n\n"
        )
        content += f"Success: {result_success}\n\n"

        if result_success:
            content += f"Result:\n{result_content}\n"
        else:
            content += f"Error:\n{result_error}\n"

        self._write_log("TOOL_RESULT", content)

    def _write_log(self, log_type: str, content: str):
        """写入日志条目

        Args:
            log_type: 日志类型（REQUEST, RESPONSE, TOOL_RESULT）
            content: 日志内容
        """
        if self.log_file is None:
            return

        with open(self.log_file, "a", encoding="utf-8") as f:
            f.write("\n" + "-" * 80 + "\n")
            f.write(f"[{self.log_index}] {log_type}\n")
            f.write(
                f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]}\n"
            )
            f.write("-" * 80 + "\n")
            f.write(content + "\n")

    def get_log_file_path(self) -> Path:
        """获取当前日志文件路径"""
        return self.log_file
