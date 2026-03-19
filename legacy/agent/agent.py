"""
agent/agent.py — Claude client and agentic tool-use loop.

Usage:
    from agent.agent import run_agent
    response_text, tool_calls_log = run_agent(messages, session_id)
"""

import json
import os
from datetime import datetime
from typing import List, Tuple

import anthropic

import db.crud as crud
from agent.tools import ALL_TOOLS, execute_tool

_MAX_ITERATIONS = 10


def _build_system_prompt() -> str:
    today_str = datetime.now().strftime("%A, %B %d, %Y")
    return (
        f"You are a personal productivity assistant with full read/write access to the "
        f"user's tasks, goals, habits, and calendar. Today is {today_str}.\n\n"
        "You can help the user:\n"
        "- Create, update, prioritise, and delete tasks and projects\n"
        "- Track goals and sub-goals with progress percentages\n"
        "- Log and monitor daily habits and streaks\n"
        "- Schedule and manage calendar events\n"
        "- Summarise today's agenda, review weekly progress, and suggest a daily schedule\n\n"
        "You have 19 tools available covering tasks, goals, habits, calendar events, "
        "aggregate overviews, and Google Calendar sync. "
        "Use them proactively whenever the user asks about their data. "
        "Always fetch fresh information rather than relying on conversation history alone. "
        "Be concise, practical, and action-oriented in your responses."
    )


def _block_to_dict(block) -> dict:
    """Convert an Anthropic response content block to a plain dict."""
    if block.type == "text":
        return {"type": "text", "text": block.text}
    elif block.type == "tool_use":
        return {
            "type": "tool_use",
            "id": block.id,
            "name": block.name,
            "input": dict(block.input),
        }
    else:
        try:
            return block.model_dump()
        except Exception:
            return {"type": block.type}


def run_agent(
    messages: List[dict],
    session_id: str,
) -> Tuple[str, List[dict]]:
    """
    Run the Claude agent with tool-use support until end_turn or max iterations.

    Args:
        messages: Full conversation history in Anthropic API format.
                  The last message must be the new user message to process.
        session_id: DB session ID for persisting all conversation records.

    Returns:
        (response_text, tool_calls_log) where:
        - response_text is the final assistant text (may be empty if only tool calls)
        - tool_calls_log is a list of {"tool": name, "args": {...}, "result": {...}}
    """
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

    # Persist the new user message (last item in the messages list)
    if messages and messages[-1]["role"] == "user":
        raw_content = messages[-1]["content"]
        if isinstance(raw_content, list):
            user_text = " ".join(
                b.get("text", "") for b in raw_content if isinstance(b, dict)
            )
        else:
            user_text = str(raw_content)
        crud.add_message(session_id=session_id, role="user", content=user_text)

    working_messages: List[dict] = list(messages)
    tool_calls_log: List[dict] = []
    response_text = ""

    for _iteration in range(_MAX_ITERATIONS):
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=_build_system_prompt(),
            tools=ALL_TOOLS,
            messages=working_messages,
        )

        if response.stop_reason == "end_turn":
            for block in response.content:
                if block.type == "text":
                    response_text += block.text
            crud.add_message(
                session_id=session_id,
                role="assistant",
                content=response_text,
                token_count=response.usage.output_tokens,
            )
            break

        elif response.stop_reason == "tool_use":
            # Collect any inline text from this partial response
            for block in response.content:
                if block.type == "text":
                    response_text += block.text

            # Append assistant message (with tool_use blocks) to working context
            working_messages.append({
                "role": "assistant",
                "content": [_block_to_dict(b) for b in response.content],
            })

            # Execute each tool call, collect results, persist to DB
            tool_results: List[dict] = []
            for block in response.content:
                if block.type != "tool_use":
                    continue

                result = execute_tool(block.name, dict(block.input))
                tool_calls_log.append({
                    "tool": block.name,
                    "args": dict(block.input),
                    "result": result,
                })

                # Persist tool call record (as assistant) and result record (as tool)
                crud.add_message(
                    session_id=session_id,
                    role="assistant",
                    content=json.dumps({"tool": block.name, "args": dict(block.input)}),
                    tool_name=block.name,
                )
                crud.add_message(
                    session_id=session_id,
                    role="tool",
                    content=json.dumps(result),
                    tool_name=block.name,
                )

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result),
                })

            # Append tool results to working context for next iteration
            working_messages.append({
                "role": "user",
                "content": tool_results,
            })

        else:
            # Unexpected stop reason (e.g., "max_tokens")
            response_text += f" [Stopped: {response.stop_reason}]"
            crud.add_message(
                session_id=session_id,
                role="assistant",
                content=response_text,
            )
            break

    else:
        # Loop exhausted: too many tool-call rounds
        response_text = (
            "I reached the maximum number of tool-call rounds without finishing. "
            "Please try a simpler request or break it into smaller steps."
        )
        crud.add_message(
            session_id=session_id,
            role="assistant",
            content=response_text,
        )

    return response_text, tool_calls_log
