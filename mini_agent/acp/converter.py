"""Message format converter between ACP and Mini-Agent formats.

Handles conversion between:
- ACP content blocks (text, image, resource, etc.) ↔ Mini-Agent messages
- ACP tool calls ↔ Mini-Agent tool calls
- Streaming updates for real-time communication
"""

from typing import Any

from acp import text_block
from acp.schema import TextContentBlock, ImageContentBlock, ResourceContentBlock

from mini_agent.schema.schema import Message, ToolCall, FunctionCall


def acp_content_to_text(content: list[dict[str, Any]] | list[Any]) -> str:
    """Convert ACP content blocks to plain text.

    Args:
        content: List of ACP content blocks (can be dicts or pydantic models)

    Returns:
        Concatenated text content
    """
    parts = []
    for block in content:
        if isinstance(block, dict):
            if block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif block.get("type") == "image":
                # Include image metadata in text
                source = block.get("source", {})
                if isinstance(source, dict) and source.get("type") == "uri":
                    parts.append(f"[Image: {source.get('uri', 'unknown')}]")
                else:
                    parts.append("[Image]")
            elif block.get("type") == "resource":
                # Include resource link
                resource = block.get("resource", {})
                if isinstance(resource, dict):
                    uri = resource.get("uri", "")
                    parts.append(f"[Resource: {uri}]")
        else:
            # Pydantic models
            if isinstance(block, TextContentBlock):
                parts.append(block.text)
            elif isinstance(block, ImageContentBlock):
                if hasattr(block, "uri") and block.uri:
                    parts.append(f"[Image: {block.uri}]")
                else:
                    parts.append("[Image]")
            elif isinstance(block, ResourceContentBlock):
                if hasattr(block.resource, "uri"):
                    parts.append(f"[Resource: {block.resource.uri}]")
            elif hasattr(block, "text"):
                # Fallback for text-like objects
                parts.append(str(block.text))

    return "\n".join(parts)


def message_to_acp_content(message: Message) -> list[dict[str, Any]]:
    """Convert Mini-Agent message to ACP content blocks.

    Args:
        message: Mini-Agent message

    Returns:
        List of ACP content blocks
    """
    blocks = []

    # Handle string content
    if isinstance(message.content, str):
        if message.content:
            blocks.append(text_block(message.content))
    # Handle list of content blocks (already in block format)
    elif isinstance(message.content, list):
        blocks.extend(message.content)

    return blocks


def tool_call_to_acp_format(tool_call: ToolCall) -> dict[str, Any]:
    """Convert Mini-Agent tool call to ACP format.

    Args:
        tool_call: Mini-Agent tool call

    Returns:
        ACP-compatible tool call dict
    """
    return {
        "id": tool_call.id,
        "type": tool_call.type,
        "function": {
            "name": tool_call.function.name,
            "arguments": tool_call.function.arguments,
        },
    }


def acp_tool_result_to_message(
    tool_call_id: str, tool_name: str, content: str
) -> Message:
    """Convert ACP tool result to Mini-Agent message format.

    Args:
        tool_call_id: ID of the tool call
        tool_name: Name of the tool
        content: Tool execution result

    Returns:
        Mini-Agent message with tool result
    """
    return Message(
        role="tool",
        content=content,
        tool_call_id=tool_call_id,
        name=tool_name,
    )
