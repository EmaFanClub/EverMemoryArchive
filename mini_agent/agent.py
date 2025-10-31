"""Core Agent implementation."""

import json
from pathlib import Path
from typing import List

import tiktoken

from .llm import LLMClient, Message
from .logger import AgentLogger
from .tools.base import Tool, ToolResult


# ANSI 颜色代码
class Colors:
    """终端颜色定义"""

    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"

    # 前景色
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"

    # 亮色
    BRIGHT_BLACK = "\033[90m"
    BRIGHT_RED = "\033[91m"
    BRIGHT_GREEN = "\033[92m"
    BRIGHT_YELLOW = "\033[93m"
    BRIGHT_BLUE = "\033[94m"
    BRIGHT_MAGENTA = "\033[95m"
    BRIGHT_CYAN = "\033[96m"
    BRIGHT_WHITE = "\033[97m"


class Agent:
    """Single agent with basic tools and MCP support."""

    def __init__(
        self,
        llm_client: LLMClient,
        system_prompt: str,
        tools: List[Tool],
        max_steps: int = 50,
        workspace_dir: str = "./workspace",
        token_limit: int = 80000,  # Token 超过此值时触发 summary
    ):
        self.llm = llm_client
        self.system_prompt = system_prompt
        self.tools = {tool.name: tool for tool in tools}
        self.max_steps = max_steps
        self.token_limit = token_limit
        self.workspace_dir = Path(workspace_dir)

        # Ensure workspace exists
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

        # Initialize message history
        self.messages: List[Message] = [Message(role="system", content=system_prompt)]

        # 初始化日志记录器
        self.logger = AgentLogger(self.workspace_dir)

    def add_user_message(self, content: str):
        """Add a user message to history."""
        self.messages.append(Message(role="user", content=content))

    def _estimate_tokens(self) -> int:
        """使用 tiktoken 精确计算消息历史的 token 数量

        使用 cl100k_base 编码器（GPT-4/Claude 兼容）
        """
        try:
            # 使用 cl100k_base 编码器（GPT-4 和大多数现代模型使用）
            encoding = tiktoken.get_encoding("cl100k_base")
        except Exception:
            # Fallback: 如果 tiktoken 初始化失败，使用简单估算
            return self._estimate_tokens_fallback()

        total_tokens = 0

        for msg in self.messages:
            # 统计文本内容
            if isinstance(msg.content, str):
                total_tokens += len(encoding.encode(msg.content))
            elif isinstance(msg.content, list):
                for block in msg.content:
                    if isinstance(block, dict):
                        # 将字典转为字符串计算
                        total_tokens += len(encoding.encode(str(block)))

            # 统计 thinking
            if msg.thinking:
                total_tokens += len(encoding.encode(msg.thinking))

            # 统计 tool_calls
            if msg.tool_calls:
                total_tokens += len(encoding.encode(str(msg.tool_calls)))

            # 每条消息的元数据开销（约 4 tokens）
            total_tokens += 4

        return total_tokens

    def _estimate_tokens_fallback(self) -> int:
        """Fallback token 估算方法（当 tiktoken 不可用时）"""
        total_chars = 0
        for msg in self.messages:
            if isinstance(msg.content, str):
                total_chars += len(msg.content)
            elif isinstance(msg.content, list):
                for block in msg.content:
                    if isinstance(block, dict):
                        total_chars += len(str(block))

            if msg.thinking:
                total_chars += len(msg.thinking)

            if msg.tool_calls:
                total_chars += len(str(msg.tool_calls))

        # 粗略估算：平均 2.5 个字符 = 1 token
        return int(total_chars / 2.5)

    async def _summarize_messages(self):
        """消息历史摘要：当 token 超限时，对每一轮 user-user 之间的对话进行摘要

        策略 (Agent 模式)：
        - 保留所有 user 消息（这是用户的意图）
        - 对每一轮 user-user 之间的内容（agent 执行过程）进行 summary
        - 最后一轮如果还在执行中（有 agent/tool 消息但没有下一个 user），也要 summary
        - 结构：system -> user1 -> summary1 -> user2 -> summary2 -> user3 -> summary3(如果执行中)
        """
        estimated_tokens = self._estimate_tokens()

        # 如果未超限，不需要 summary
        if estimated_tokens <= self.token_limit:
            return

        print(
            f"\n{Colors.BRIGHT_YELLOW}📊 Token 估算值: {estimated_tokens}/{self.token_limit}{Colors.RESET}"
        )
        print(f"{Colors.BRIGHT_YELLOW}🔄 触发消息历史摘要...{Colors.RESET}")

        # 找到所有 user 消息的索引（跳过 system prompt）
        user_indices = [
            i for i, msg in enumerate(self.messages) if msg.role == "user" and i > 0
        ]

        # 至少需要 1 个 user 消息才能进行 summary
        if len(user_indices) < 1:
            print(f"{Colors.BRIGHT_YELLOW}⚠️  消息不足，无法进行摘要{Colors.RESET}")
            return

        # 构建新的消息列表
        new_messages = [self.messages[0]]  # 保留 system prompt
        summary_count = 0

        # 遍历每个 user 消息，对其后面的执行过程进行 summary
        for i, user_idx in enumerate(user_indices):
            # 添加当前 user 消息
            new_messages.append(self.messages[user_idx])

            # 确定要 summary 的消息范围
            # 如果是最后一个 user，则到消息列表末尾；否则到下一个 user 之前
            if i < len(user_indices) - 1:
                next_user_idx = user_indices[i + 1]
            else:
                next_user_idx = len(self.messages)

            # 提取这一轮的执行消息
            execution_messages = self.messages[user_idx + 1 : next_user_idx]

            # 如果这一轮有执行消息，进行 summary
            if execution_messages:
                summary_text = await self._create_summary(
                    execution_messages, user_idx, i + 1
                )
                if summary_text:
                    summary_message = Message(
                        role="user", content=f"[执行摘要]\n\n{summary_text}"
                    )
                    new_messages.append(summary_message)
                    summary_count += 1

        # 替换消息列表
        self.messages = new_messages

        new_tokens = self._estimate_tokens()
        print(
            f"{Colors.BRIGHT_GREEN}✓ 摘要完成，Token 从 {estimated_tokens} 降至 {new_tokens}{Colors.RESET}"
        )
        print(
            f"{Colors.DIM}  结构: system + {len(user_indices)} 个 user 消息 + {summary_count} 个 summary{Colors.RESET}"
        )

    async def _create_summary(
        self, messages: List[Message], user_idx: int, round_num: int
    ) -> str:
        """为一轮执行创建摘要

        Args:
            messages: 要总结的消息列表
            user_idx: 用户消息的索引
            round_num: 轮次编号

        Returns:
            摘要文本
        """
        if not messages:
            return ""

        # 构建摘要内容
        summary_content = f"第 {round_num} 轮执行过程：\n\n"
        for msg in messages:
            if msg.role == "assistant":
                content_text = (
                    msg.content if isinstance(msg.content, str) else str(msg.content)
                )
                summary_content += f"助手: {content_text[:200]}\n"
                if msg.tool_calls:
                    tool_names = [tc["function"]["name"] for tc in msg.tool_calls]
                    summary_content += f"  → 调用工具: {', '.join(tool_names)}\n"
            elif msg.role == "tool":
                result_preview = (
                    msg.content[:100]
                    if isinstance(msg.content, str)
                    else str(msg.content)[:100]
                )
                summary_content += f"  ← 工具返回: {result_preview}...\n"

        # 调用 LLM 生成简洁的摘要
        try:
            summary_prompt = f"""请将以下 Agent 执行过程进行简洁总结：

{summary_content}

要求：
1. 重点记录完成了什么任务、调用了哪些工具
2. 保留关键的执行结果和重要发现
3. 简洁明了，控制在 300 字以内
4. 使用中文
5. 不要包含"用户"相关内容，只总结 Agent 的执行过程"""

            summary_msg = Message(role="user", content=summary_prompt)
            response = await self.llm.generate(
                messages=[
                    Message(
                        role="system",
                        content="你是一个擅长总结 Agent 执行过程的助手。",
                    ),
                    summary_msg,
                ]
            )

            summary_text = response.content
            print(f"{Colors.BRIGHT_GREEN}✓ 第 {round_num} 轮摘要生成完成{Colors.RESET}")
            return summary_text

        except Exception as e:
            print(
                f"{Colors.BRIGHT_RED}✗ 第 {round_num} 轮摘要生成失败: {e}{Colors.RESET}"
            )
            # 失败时使用简单的文本摘要
            return summary_content

    async def run(self) -> str:
        """Execute agent loop until task is complete or max steps reached."""
        # 开始新的运行，初始化日志文件
        self.logger.start_new_run()
        print(
            f"{Colors.DIM}📝 日志文件: {self.logger.get_log_file_path()}{Colors.RESET}"
        )

        step = 0

        while step < self.max_steps:
            # 检查并摘要消息历史，防止 context 超限
            await self._summarize_messages()

            # 步骤标题
            print(f"\n{Colors.DIM}╭{'─' * 58}╮{Colors.RESET}")
            print(
                f"{Colors.DIM}│{Colors.RESET} {Colors.BOLD}{Colors.BRIGHT_CYAN}💭 Step {step + 1}/{self.max_steps}{Colors.RESET}{' ' * (49 - len(f'Step {step + 1}/{self.max_steps}'))}{Colors.DIM}│{Colors.RESET}"
            )
            print(f"{Colors.DIM}╰{'─' * 58}╯{Colors.RESET}")

            # Get tool schemas
            tool_schemas = [tool.to_schema() for tool in self.tools.values()]

            # 记录 LLM 请求日志
            self.logger.log_request(messages=self.messages, tools=tool_schemas)

            # Call LLM
            try:
                response = await self.llm.generate(
                    messages=self.messages, tools=tool_schemas
                )
            except Exception as e:
                # 检查是否是重试耗尽错误
                from .retry import RetryExhaustedError

                if isinstance(e, RetryExhaustedError):
                    error_msg = (
                        f"LLM 调用失败，已重试 {e.attempts} 次\n"
                        f"最后的错误: {str(e.last_exception)}"
                    )
                    print(
                        f"\n{Colors.BRIGHT_RED}❌ 重试失败:{Colors.RESET} {error_msg}"
                    )
                else:
                    error_msg = f"LLM call failed: {str(e)}"
                    print(f"\n{Colors.BRIGHT_RED}❌ Error:{Colors.RESET} {error_msg}")
                return error_msg

            # 记录 LLM 响应日志
            self.logger.log_response(
                content=response.content,
                thinking=response.thinking,
                tool_calls=response.tool_calls,
                finish_reason=response.finish_reason,
            )

            # Add assistant message
            assistant_msg = Message(
                role="assistant",
                content=response.content,
                thinking=response.thinking,
                tool_calls=response.tool_calls,
            )
            self.messages.append(assistant_msg)

            # Print thinking if present
            if response.thinking:
                print(f"\n{Colors.BOLD}{Colors.MAGENTA}🧠 Thinking:{Colors.RESET}")
                print(f"{Colors.DIM}{response.thinking}{Colors.RESET}")

            # Print assistant response
            if response.content:
                print(f"\n{Colors.BOLD}{Colors.BRIGHT_BLUE}🤖 Assistant:{Colors.RESET}")
                print(f"{Colors.BRIGHT_WHITE}{response.content}{Colors.RESET}")

            # Check if task is complete (no tool calls)
            if not response.tool_calls:
                print(f"\n{Colors.BOLD}{Colors.BRIGHT_GREEN}{'─' * 60}{Colors.RESET}")
                print(
                    f"{Colors.BOLD}{Colors.BRIGHT_GREEN}✨ Task Complete!{Colors.RESET}"
                )
                print(f"{Colors.BOLD}{Colors.BRIGHT_GREEN}{'─' * 60}{Colors.RESET}")
                return response.content

            # Execute tool calls
            for tool_call in response.tool_calls:
                tool_call_id = tool_call["id"]
                function_name = tool_call["function"]["name"]
                arguments = json.loads(tool_call["function"]["arguments"])

                # Tool call header
                print(
                    f"\n{Colors.BRIGHT_YELLOW}🔧 Tool Call:{Colors.RESET} {Colors.BOLD}{Colors.CYAN}{function_name}{Colors.RESET}"
                )

                # Arguments (格式化显示)
                print(f"{Colors.DIM}   Arguments:{Colors.RESET}")
                args_json = json.dumps(arguments, indent=2, ensure_ascii=False)
                for line in args_json.split("\n"):
                    print(f"   {Colors.DIM}{line}{Colors.RESET}")

                # Execute tool
                if function_name not in self.tools:
                    result = ToolResult(
                        success=False,
                        content="",
                        error=f"Unknown tool: {function_name}",
                    )
                else:
                    try:
                        tool = self.tools[function_name]
                        result = await tool.execute(**arguments)
                    except Exception as e:
                        # 捕获工具执行中的所有异常，转换为失败的 ToolResult
                        import traceback

                        error_detail = f"{type(e).__name__}: {str(e)}"
                        error_trace = traceback.format_exc()
                        result = ToolResult(
                            success=False,
                            content="",
                            error=f"Tool execution failed: {error_detail}\n\nTraceback:\n{error_trace}",
                        )

                # 记录工具执行结果日志
                self.logger.log_tool_result(
                    tool_name=function_name,
                    arguments=arguments,
                    result_success=result.success,
                    result_content=result.content if result.success else None,
                    result_error=result.error if not result.success else None,
                )

                # Print result
                if result.success:
                    result_text = result.content
                    if len(result_text) > 300:
                        result_text = (
                            result_text[:300] + f"{Colors.DIM}...{Colors.RESET}"
                        )
                    print(f"{Colors.BRIGHT_GREEN}✓ Result:{Colors.RESET} {result_text}")
                else:
                    print(
                        f"{Colors.BRIGHT_RED}✗ Error:{Colors.RESET} {Colors.RED}{result.error}{Colors.RESET}"
                    )

                # Add tool result message
                tool_msg = Message(
                    role="tool",
                    content=result.content
                    if result.success
                    else f"Error: {result.error}",
                    tool_call_id=tool_call_id,
                    name=function_name,
                )
                self.messages.append(tool_msg)

            step += 1

        # Max steps reached
        error_msg = f"Task couldn't be completed after {self.max_steps} steps."
        print(f"\n{Colors.BRIGHT_YELLOW}⚠️  {error_msg}{Colors.RESET}")
        return error_msg

    def get_history(self) -> List[Message]:
        """Get message history."""
        return self.messages.copy()
