"""Unified LLM client supporting Anthropic-compatible (MiniMax) and
OpenAI-compatible (e.g., LM Studio) APIs.

This client keeps the Mini-Agent internal schema stable while enabling
different backends via a simple `provider` switch.

Providers:
- "anthropic" (default): MiniMax M2 via Anthropic-compatible endpoint
- "openai-compatible": e.g., LM Studio local server (http://localhost:1234/v1)
"""

import logging
from typing import Any

import httpx
import json

from .retry import RetryConfig as RetryConfigBase
from .retry import async_retry
from .schema import FunctionCall, LLMResponse, Message, ToolCall

logger = logging.getLogger(__name__)


class LLMClient:
    """LLM Client with pluggable providers (Anthropic or OpenAI-compatible)."""

    def __init__(
        self,
        api_key: str,
        api_base: str = "https://api.minimax.io/anthropic",
        model: str = "MiniMax-M2",
        provider: str = "anthropic",
        retry_config: RetryConfigBase | None = None,
    ):
        self.api_key = api_key
        self.api_base = api_base
        self.model = model
        self.provider = provider or "anthropic"
        self.retry_config = retry_config or RetryConfigBase()

        # Callback for tracking retry count
        self.retry_callback = None

    async def _make_api_request_anthropic(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Execute Anthropic-compatible API request (core method that can be retried)

        Args:
            payload: Request payload

        Returns:
            API response result

        Raises:
            Exception: API call failed
        """
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self.api_base}/v1/messages",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "anthropic-version": "2023-06-01",
                },
                json=payload,
            )

            result = response.json()

        # Check for errors (Anthropic format)
        if result.get("type") == "error":
            error_info = result.get("error", {})
            error_msg = f"API Error ({error_info.get('type')}): {error_info.get('message')}"
            raise Exception(error_msg)

        # Check for MiniMax base_resp errors
        if "base_resp" in result:
            base_resp = result["base_resp"]
            status_code = base_resp.get("status_code")
            status_msg = base_resp.get("status_msg")

            if status_code not in [0, 1000, None]:
                error_msg = f"MiniMax API Error (code {status_code}): {status_msg}"
                if status_code == 1008:
                    error_msg += "\n\n⚠️  Insufficient account balance, please recharge on MiniMax platform"
                elif status_code == 2013:
                    error_msg += f"\n\n⚠️  Model '{self.model}' is not supported"
                raise Exception(error_msg)

        return result

    async def _make_api_request_openai(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Execute OpenAI-compatible API request (e.g., LM Studio)."""
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self.api_base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )

            # Try to provide rich error information on non-2xx
            status = response.status_code
            try:
                result = response.json()
            except Exception:
                result = {"raw": response.text}

            if status >= 400:
                # Extract error message from common OpenAI-compatible formats
                err = None
                if isinstance(result, dict):
                    if "error" in result:
                        err = result.get("error")
                        if isinstance(err, dict):
                            err = err.get("message") or err.get("type")
                    if not err and "message" in result:
                        err = result.get("message")
                if not err:
                    err = response.text
                raise Exception(f"OpenAI-compatible API Error {status}: {err}")

            return result

    def _convert_messages_to_openai(self, messages: list[Message]) -> list[dict[str, Any]]:
        """Convert internal messages to OpenAI Chat Completions format."""
        oa_messages: list[dict[str, Any]] = []

        for msg in messages:
            if msg.role == "system":
                oa_messages.append({"role": "system", "content": msg.content})
            elif msg.role == "user":
                oa_messages.append({"role": "user", "content": msg.content})
            elif msg.role == "assistant":
                entry: dict[str, Any] = {"role": "assistant"}
                # OpenAI format doesn't support separate "thinking" blocks; omit.
                entry["content"] = msg.content or ""

                # Translate tool_calls if present
                if msg.tool_calls:
                    tool_calls = []
                    for tc in msg.tool_calls:
                        func_args = tc.function.arguments
                        # OpenAI expects function.arguments as a JSON string
                        if isinstance(func_args, str):
                            args_str = func_args
                        else:
                            args_str = json.dumps(func_args, ensure_ascii=False)

                        tool_calls.append(
                            {
                                "id": tc.id,
                                "type": tc.type,
                                "function": {
                                    "name": tc.function.name,
                                    "arguments": args_str,
                                },
                            }
                        )
                    entry["tool_calls"] = tool_calls

                oa_messages.append(entry)
            elif msg.role == "tool":
                # OpenAI uses role "tool" with tool_call_id and content
                entry = {
                    "role": "tool",
                    "tool_call_id": msg.tool_call_id,
                    "content": msg.content,
                }
                # Name is optional in OpenAI schema for tool role
                if msg.name:
                    entry["name"] = msg.name
                oa_messages.append(entry)

        return oa_messages

    def _convert_tools_to_openai(self, tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Convert Anthropic-style tool schemas to OpenAI tools schema.

        Input (Anthropic-like):
            {"name": str, "description": str, "input_schema": {...}}

        Output (OpenAI):
            {"type": "function", "function": {"name": str, "description": str, "parameters": {...}}}
        """
        converted: list[dict[str, Any]] = []
        for t in tools:
            name = t.get("name")
            desc = t.get("description")
            params = t.get("input_schema") or {}
            converted.append(
                {
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": desc,
                        "parameters": params,
                    },
                }
            )
        return converted

    def _parse_anthropic_response(self, result: dict[str, Any]) -> LLMResponse:
        """Parse Anthropic-compatible response into internal schema."""
        content_blocks = result.get("content", [])
        stop_reason = result.get("stop_reason", "stop")

        # Extract text content, thinking, and tool calls
        text_content = ""
        thinking_content = ""
        tool_calls: list[ToolCall] = []

        for block in content_blocks:
            if block.get("type") == "text":
                text_content += block.get("text", "")
            elif block.get("type") == "thinking":
                thinking_content += block.get("thinking", "")
            elif block.get("type") == "tool_use":
                tool_calls.append(
                    ToolCall(
                        id=block.get("id"),
                        type="function",
                        function=FunctionCall(
                            name=block.get("name"),
                            arguments=block.get("input", {}),
                        ),
                    )
                )

        return LLMResponse(
            content=text_content,
            thinking=thinking_content if thinking_content else None,
            tool_calls=tool_calls if tool_calls else None,
            finish_reason=stop_reason,
        )

    def _parse_openai_response(self, result: dict[str, Any]) -> LLMResponse:
        """Parse OpenAI-compatible Chat Completions response."""
        choices = result.get("choices", [])
        if not choices:
            raise Exception("OpenAI-compatible response missing 'choices'")

        choice = choices[0]
        msg = choice.get("message", {})
        finish_reason = choice.get("finish_reason", "stop")

        text_content = msg.get("content") or ""
        tool_calls_raw = msg.get("tool_calls") or []
        tool_calls: list[ToolCall] = []
        for tc in tool_calls_raw:
            func = tc.get("function", {})
            args_raw = func.get("arguments")
            # Convert JSON string to dict if needed
            try:
                args_parsed = json.loads(args_raw) if isinstance(args_raw, str) else (args_raw or {})
            except Exception:
                # If not valid JSON, pass-through as string under a reserved key
                args_parsed = {"_raw": args_raw}

            tool_calls.append(
                ToolCall(
                    id=tc.get("id"),
                    type=tc.get("type", "function"),
                    function=FunctionCall(
                        name=func.get("name"),
                        arguments=args_parsed,
                    ),
                )
            )

        return LLMResponse(
            content=text_content,
            thinking=None,  # OpenAI-compatible APIs don't return structured "thinking"
            tool_calls=tool_calls if tool_calls else None,
            finish_reason=finish_reason,
        )

    async def generate(
        self,
        messages: list[Message],
        tools: list[dict[str, Any]] | None = None,
    ) -> LLMResponse:
        """Generate response from LLM."""
        provider = (self.provider or "anthropic").lower()

        if provider == "anthropic":
            # Extract system message (Anthropic requires it separately)
            system_message = None
            api_messages: list[dict[str, Any]] = []

            for msg in messages:
                if msg.role == "system":
                    system_message = msg.content
                    continue

                if msg.role in ["user", "assistant"]:
                    if msg.role == "assistant" and (msg.thinking or msg.tool_calls):
                        content_blocks = []
                        if msg.thinking:
                            content_blocks.append({"type": "thinking", "thinking": msg.thinking})
                        if msg.content:
                            content_blocks.append({"type": "text", "text": msg.content})
                        if msg.tool_calls:
                            for tool_call in msg.tool_calls:
                                content_blocks.append(
                                    {
                                        "type": "tool_use",
                                        "id": tool_call.id,
                                        "name": tool_call.function.name,
                                        "input": tool_call.function.arguments,
                                    }
                                )
                        api_messages.append({"role": "assistant", "content": content_blocks})
                    else:
                        api_messages.append({"role": msg.role, "content": msg.content})
                elif msg.role == "tool":
                    api_messages.append(
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "tool_result",
                                    "tool_use_id": msg.tool_call_id,
                                    "content": msg.content,
                                }
                            ],
                        }
                    )

            payload = {
                "model": self.model,
                "messages": api_messages,
                "max_tokens": 16384,
            }

            if system_message:
                payload["system"] = system_message
            if tools:
                payload["tools"] = tools

            # Make API request with retry logic
            if self.retry_config.enabled:
                retry_decorator = async_retry(config=self.retry_config, on_retry=self.retry_callback)
                api_call = retry_decorator(self._make_api_request_anthropic)
                result = await api_call(payload)
            else:
                result = await self._make_api_request_anthropic(payload)

            return self._parse_anthropic_response(result)

        # OpenAI-compatible (e.g., LM Studio)
        oa_messages = self._convert_messages_to_openai(messages)
        payload = {
            "model": self.model,
            "messages": oa_messages,
            # Keep a reasonable default for local models
            "max_tokens": 2048,
        }
        if tools:
            payload["tools"] = self._convert_tools_to_openai(tools)
            payload["tool_choice"] = "auto"

        if self.retry_config.enabled:
            retry_decorator = async_retry(config=self.retry_config, on_retry=self.retry_callback)
            api_call = retry_decorator(self._make_api_request_openai)
            result = await api_call(payload)
        else:
            result = await self._make_api_request_openai(payload)

        return self._parse_openai_response(result)
