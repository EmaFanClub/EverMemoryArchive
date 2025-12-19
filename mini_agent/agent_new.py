"""Core Agent implementation with separated Context Manager."""

import json
from pathlib import Path

import tiktoken

from .llm import LLMClient
from .logger import AgentLogger
from .schema import LLMResponse, Message
from .tools.base import Tool, ToolResult
from .utils import calculate_display_width


# ANSI color codes
class Colors:
    """Terminal color definitions"""

    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"

    # Foreground colors
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"

    # Bright colors
    BRIGHT_BLACK = "\033[90m"
    BRIGHT_RED = "\033[91m"
    BRIGHT_GREEN = "\033[92m"
    BRIGHT_YELLOW = "\033[93m"
    BRIGHT_BLUE = "\033[94m"
    BRIGHT_MAGENTA = "\033[95m"
    BRIGHT_CYAN = "\033[96m"
    BRIGHT_WHITE = "\033[97m"


class Context:
    """Context container for LLM communication."""

    def __init__(self, messages: list[Message], tools: list[Tool]):
        """Initialize context.

        Args:
            messages: List of conversation messages
            tools: List of available tools
        """
        self.messages = messages
        self.tools = tools


class ContextManager:
    """Manages conversation context and message history for the Agent."""

    def __init__(
        self,
        system_prompt: str,
        llm_client: LLMClient,
        tools: list[Tool],
        token_limit: int = 80000,
    ):
        """Initialize context manager.

        Args:
            system_prompt: System prompt for the conversation
            llm_client: LLM client for summary generation
            tools: List of available tools
            token_limit: Maximum token count before summarization
        """
        self.system_prompt = system_prompt
        self.llm_client = llm_client
        self.token_limit = token_limit

        # Initialize message history with system prompt
        self.messages: list[Message] = [Message(role="system", content=system_prompt)]

        # Store tools
        self.tools: list[Tool] = tools

        # Token usage tracking
        self.api_total_tokens: int = 0
        self.skip_next_token_check: bool = False

    @property
    def context(self) -> Context:
        """Get current conversation context (messages and tools).

        Returns:
            Context object containing messages and tools
        """
        return Context(messages=self.messages, tools=self.tools)

    def add_user_message(self, content: str):
        """Add a user message to context.

        Args:
            content: User message content
        """
        self.messages.append(Message(role="user", content=content))

    def add_assistant_message(self, response: LLMResponse):
        """Add an assistant message to context.

        Args:
            response: LLM response object
        """
        self.messages.append(
            Message(
                role="assistant",
                content=response.content,
                thinking=response.thinking,
                tool_calls=response.tool_calls,
            )
        )

    def add_tool_message(
        self,
        result: ToolResult,
        tool_call_id: str,
        name: str,
    ):
        """Add a tool result message to context.

        Args:
            result: Tool execution result
            tool_call_id: ID of the tool call
            name: Tool name
        """
        content = result.content if result.success else f"Error: {result.error}"
        self.messages.append(
            Message(
                role="tool",
                content=content,
                tool_call_id=tool_call_id,
                name=name,
            )
        )

    def update_api_tokens(self, response: LLMResponse):
        """Update API reported token count.

        Args:
            response: LLM response object
        """
        if response.usage:
            self.api_total_tokens = response.usage.total_tokens

    def estimate_tokens(self) -> int:
        """Accurately calculate token count for message history using tiktoken.

        Uses cl100k_base encoder (GPT-4/Claude/M2 compatible)

        Returns:
            Estimated token count
        """
        try:
            # Use cl100k_base encoder (used by GPT-4 and most modern models)
            encoding = tiktoken.get_encoding("cl100k_base")
        except Exception:
            # Fallback: if tiktoken initialization fails, use simple estimation
            return self.estimate_tokens_fallback()

        total_tokens = 0

        for msg in self.messages:
            # Count text content
            if isinstance(msg.content, str):
                total_tokens += len(encoding.encode(msg.content))
            elif isinstance(msg.content, list):
                for block in msg.content:
                    if isinstance(block, dict):
                        # Convert dict to string for calculation
                        total_tokens += len(encoding.encode(str(block)))

            # Count thinking
            if msg.thinking:
                total_tokens += len(encoding.encode(msg.thinking))

            # Count tool_calls
            if msg.tool_calls:
                total_tokens += len(encoding.encode(str(msg.tool_calls)))

            # Metadata overhead per message (approximately 4 tokens)
            total_tokens += 4

        return total_tokens

    def estimate_tokens_fallback(self) -> int:
        """Fallback token estimation method (when tiktoken is unavailable).

        Returns:
            Estimated token count
        """
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

        # Rough estimation: average 2.5 characters = 1 token
        return int(total_chars / 2.5)

    async def summarize_messages(self):
        """Check and summarize message history if token limit exceeded.

        Strategy (Agent mode):
        - Keep all user messages (these are user intents)
        - Summarize content between each user-user pair (agent execution process)
        - If last round is still executing (has agent/tool messages but no next user), also summarize
        - Structure: system -> user1 -> summary1 -> user2 -> summary2 -> user3 -> summary3 (if executing)

        Summary is triggered when EITHER:
        - Local token estimation exceeds limit
        - API reported total_tokens exceeds limit
        """
        # Skip check if we just completed a summary (wait for next LLM call to update api_total_tokens)
        if self.skip_next_token_check:
            self.skip_next_token_check = False
            return

        estimated_tokens = self.estimate_tokens()

        # Check both local estimation and API reported tokens
        should_summarize = (
            estimated_tokens > self.token_limit
            or self.api_total_tokens > self.token_limit
        )

        # If neither exceeded, no summary needed
        if not should_summarize:
            return

        print(
            f"\n{Colors.BRIGHT_YELLOW}📊 Token usage - Local estimate: {estimated_tokens}, "
            f"API reported: {self.api_total_tokens}, Limit: {self.token_limit}{Colors.RESET}"
        )
        print(
            f"{Colors.BRIGHT_YELLOW}🔄 Triggering message history summarization...{Colors.RESET}"
        )

        # Find all user message indices (skip system prompt)
        user_indices = [
            i for i, msg in enumerate(self.messages) if msg.role == "user" and i > 0
        ]

        # Need at least 1 user message to perform summary
        if len(user_indices) < 1:
            print(
                f"{Colors.BRIGHT_YELLOW}⚠️  Insufficient messages, cannot summarize{Colors.RESET}"
            )
            return

        # Build new message list
        new_messages = [self.messages[0]]  # Keep system prompt
        summary_count = 0

        # Iterate through each user message and summarize the execution process after it
        for i, user_idx in enumerate(user_indices):
            # Add current user message
            new_messages.append(self.messages[user_idx])

            # Determine message range to summarize
            # If last user, go to end of message list; otherwise to before next user
            if i < len(user_indices) - 1:
                next_user_idx = user_indices[i + 1]
            else:
                next_user_idx = len(self.messages)

            # Extract execution messages for this round
            execution_messages = self.messages[user_idx + 1 : next_user_idx]

            # If there are execution messages in this round, summarize them
            if execution_messages:
                summary_text = await self.create_summary(execution_messages, i + 1)
                if summary_text:
                    summary_message = Message(
                        role="user",
                        content=f"[Assistant Execution Summary]\n\n{summary_text}",
                    )
                    new_messages.append(summary_message)
                    summary_count += 1

        # Replace message list
        self.messages = new_messages

        # Skip next token check to avoid consecutive summary triggers
        # (api_total_tokens will be updated after next LLM call)
        self.skip_next_token_check = True

        new_tokens = self.estimate_tokens()
        print(
            f"{Colors.BRIGHT_GREEN}✓ Summary completed, local tokens: "
            f"{estimated_tokens} → {new_tokens}{Colors.RESET}"
        )
        print(
            f"{Colors.DIM}  Structure: system + {len(user_indices)} user messages + "
            f"{summary_count} summaries{Colors.RESET}"
        )
        print(
            f"{Colors.DIM}  Note: API token count will update on next LLM call{Colors.RESET}"
        )

    async def create_summary(self, messages: list[Message], round_num: int) -> str:
        """Create summary for one execution round.

        Args:
            messages: List of messages to summarize
            round_num: Round number

        Returns:
            Summary text
        """
        if not messages:
            return ""

        # Build summary content
        summary_content = f"Round {round_num} execution process:\n\n"
        for msg in messages:
            if msg.role == "assistant":
                content_text = (
                    msg.content if isinstance(msg.content, str) else str(msg.content)
                )
                summary_content += f"Assistant: {content_text}\n"
                if msg.tool_calls:
                    tool_names = [tc.function.name for tc in msg.tool_calls]
                    summary_content += f"  → Called tools: {', '.join(tool_names)}\n"
            elif msg.role == "tool":
                result_preview = (
                    msg.content if isinstance(msg.content, str) else str(msg.content)
                )
                summary_content += f"  ← Tool returned: {result_preview}...\n"

        # Call LLM to generate concise summary
        try:
            summary_prompt = f"""Please provide a concise summary of the following Agent execution process:

{summary_content}

Requirements:
1. Focus on what tasks were completed and which tools were called
2. Keep key execution results and important findings
3. Be concise and clear, within 1000 words
4. Use English
5. Do not include "user" related content, only summarize the Agent's execution process"""

            summary_msg = Message(role="user", content=summary_prompt)
            response = await self.llm_client.generate(
                messages=[
                    Message(
                        role="system",
                        content="You are an assistant skilled at summarizing Agent execution processes.",
                    ),
                    summary_msg,
                ]
            )

            summary_text = response.content
            print(
                f"{Colors.BRIGHT_GREEN}✓ Summary for round {round_num} generated successfully{Colors.RESET}"
            )
            return summary_text

        except Exception as e:
            print(
                f"{Colors.BRIGHT_RED}✗ Summary generation failed for round {round_num}: {e}{Colors.RESET}"
            )
            # Use simple text summary on failure
            return summary_content

    def get_history(self) -> list[Message]:
        """Get message history.

        Returns:
            Copy of message history
        """
        return self.messages.copy()


class Agent:
    """Single agent with basic tools and MCP support."""

    def __init__(
        self,
        llm_client: LLMClient,
        system_prompt: str,
        tools: list[Tool],
        max_steps: int = 50,
        workspace_dir: str = "./workspace",
        token_limit: int = 80000,
    ):
        """Initialize agent.

        Args:
            llm_client: LLM client for generating responses
            system_prompt: System prompt for the agent
            tools: List of available tools
            max_steps: Maximum execution steps
            workspace_dir: Workspace directory path
            token_limit: Token limit for context management
        """
        self.llm = llm_client
        self.tool_dict = {tool.name: tool for tool in tools}
        self.max_steps = max_steps
        self.workspace_dir = Path(workspace_dir)

        # Ensure workspace exists
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

        # Inject workspace information into system prompt if not already present
        if "Current Workspace" not in system_prompt:
            workspace_info = (
                f"\n\n## Current Workspace\n"
                f"You are currently working in: `{self.workspace_dir.absolute()}`\n"
                f"All relative paths will be resolved relative to this directory."
            )
            system_prompt = system_prompt + workspace_info

        # Initialize context manager with tools
        self.context_manager = ContextManager(
            system_prompt=system_prompt,
            llm_client=llm_client,
            tools=list(self.tool_dict.values()),
            token_limit=token_limit,
        )

        # Initialize logger
        self.logger = AgentLogger()

    def add_user_message(self, content: str):
        """Add a user message to context.

        Args:
            content: User message content
        """
        self.context_manager.add_user_message(content)

    async def run(self) -> str:
        """Execute agent loop until task is complete or max steps reached.

        Returns:
            Final response content or error message
        """
        # Start new run, initialize log file
        self.logger.start_new_run()
        print(
            f"{Colors.DIM}📝 Log file: {self.logger.get_log_file_path()}{Colors.RESET}"
        )

        step = 0

        while step < self.max_steps:
            # Check and summarize message history to prevent context overflow
            await self.context_manager.summarize_messages()

            # Step header with proper width calculation
            BOX_WIDTH = 58
            step_text = f"{Colors.BOLD}{Colors.BRIGHT_CYAN}💭 Step {step + 1}/{self.max_steps}{Colors.RESET}"
            step_display_width = calculate_display_width(step_text)
            padding = max(0, BOX_WIDTH - 1 - step_display_width)  # -1 for leading space

            print(f"\n{Colors.DIM}╭{'─' * BOX_WIDTH}╮{Colors.RESET}")
            print(
                f"{Colors.DIM}│{Colors.RESET} {step_text}{' ' * padding}{Colors.DIM}│{Colors.RESET}"
            )
            print(f"{Colors.DIM}╰{'─' * BOX_WIDTH}╯{Colors.RESET}")

            # Log LLM request
            self.logger.log_request(
                messages=self.context_manager.context.messages,
                tools=self.context_manager.context.tools,
            )

            # Call LLM with context from context manager
            try:
                response = await self.llm.generate(
                    messages=self.context_manager.context.messages,
                    tools=self.context_manager.context.tools,
                )
            except Exception as e:
                # Check if it's a retry exhausted error
                from .retry import RetryExhaustedError

                if isinstance(e, RetryExhaustedError):
                    error_msg = (
                        f"LLM call failed after {e.attempts} retries\n"
                        f"Last error: {str(e.last_exception)}"
                    )
                    print(
                        f"\n{Colors.BRIGHT_RED}❌ Retry failed:{Colors.RESET} {error_msg}"
                    )
                else:
                    error_msg = f"LLM call failed: {str(e)}"
                    print(f"\n{Colors.BRIGHT_RED}❌ Error:{Colors.RESET} {error_msg}")
                return error_msg

            # Update API reported token usage in context manager
            self.context_manager.update_api_tokens(response)

            # Log LLM response
            self.logger.log_response(
                content=response.content,
                thinking=response.thinking,
                tool_calls=response.tool_calls,
                finish_reason=response.finish_reason,
            )

            # Add assistant message to context
            self.context_manager.add_assistant_message(response)

            # Print thinking if present
            if response.thinking:
                print(f"\n{Colors.BOLD}{Colors.MAGENTA}🧠 Thinking:{Colors.RESET}")
                print(f"{Colors.DIM}{response.thinking}{Colors.RESET}")

            # Print assistant response
            if response.content:
                print(f"\n{Colors.BOLD}{Colors.BRIGHT_BLUE}🤖 Assistant:{Colors.RESET}")
                print(f"{response.content}")

            # Check if task is complete (no tool calls)
            if not response.tool_calls:
                return response.content

            # Execute tool calls
            for tool_call in response.tool_calls:
                tool_call_id = tool_call.id
                function_name = tool_call.function.name
                arguments = tool_call.function.arguments

                # Tool call header
                print(
                    f"\n{Colors.BRIGHT_YELLOW}🔧 Tool Call:{Colors.RESET} "
                    f"{Colors.BOLD}{Colors.CYAN}{function_name}{Colors.RESET}"
                )

                # Arguments (formatted display)
                print(f"{Colors.DIM}   Arguments:{Colors.RESET}")
                # Truncate each argument value to avoid overly long output
                truncated_args = {}
                for key, value in arguments.items():
                    value_str = str(value)
                    if len(value_str) > 200:
                        truncated_args[key] = value_str[:200] + "..."
                    else:
                        truncated_args[key] = value
                args_json = json.dumps(truncated_args, indent=2, ensure_ascii=False)
                for line in args_json.split("\n"):
                    print(f"   {Colors.DIM}{line}{Colors.RESET}")

                # Execute tool
                if function_name not in self.tool_dict:
                    result = ToolResult(
                        success=False,
                        content="",
                        error=f"Unknown tool: {function_name}",
                    )
                else:
                    try:
                        tool = self.tool_dict[function_name]
                        result = await tool.execute(**arguments)
                    except Exception as e:
                        # Catch all exceptions during tool execution, convert to failed ToolResult
                        import traceback

                        error_detail = f"{type(e).__name__}: {str(e)}"
                        error_trace = traceback.format_exc()
                        result = ToolResult(
                            success=False,
                            content="",
                            error=f"Tool execution failed: {error_detail}\n\nTraceback:\n{error_trace}",
                        )

                # Log tool execution result
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
                        f"{Colors.BRIGHT_RED}✗ Error:{Colors.RESET} "
                        f"{Colors.RED}{result.error}{Colors.RESET}"
                    )

                # Add tool result message to context
                self.context_manager.add_tool_message(
                    result=result,
                    tool_call_id=tool_call_id,
                    name=function_name,
                )

            step += 1

        # Max steps reached
        error_msg = f"Task couldn't be completed after {self.max_steps} steps."
        print(f"\n{Colors.BRIGHT_YELLOW}⚠️  {error_msg}{Colors.RESET}")
        return error_msg

    def get_history(self) -> list[Message]:
        """Get message history.

        Returns:
            Copy of message history
        """
        return self.context_manager.get_history()
