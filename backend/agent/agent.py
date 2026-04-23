"""
agent/agent.py — Claude client and agentic tool-use loop.

Usage:
    from agent.agent import run_agent, run_agent_stream
    response_text, tool_calls_log = run_agent(messages, session_id)
    # or for streaming:
    for sse_chunk in run_agent_stream(messages, session_id):
        yield sse_chunk
"""

import json
import os
from datetime import date, datetime, timezone
from typing import Generator, List, Optional, Tuple

import anthropic

import db.crud as crud
from agent.tools import ALL_TOOLS, execute_tool
from utils.tz import user_tz, utc_now_naive, to_local_date

_MAX_ITERATIONS = 20


# ---------------------------------------------------------------------------
#  System prompt — static personality + live context block
# ---------------------------------------------------------------------------

def _build_system_prompt() -> str:
    """
    Build the system prompt with a live context block fetched from the DB.
    Contains: today's date/day, overdue task count, today's tasks,
    next 3 calendar events, and habits due today with streaks.
    """
    import json as _json

    now = datetime.now()
    today = now.date()
    today_str = now.strftime("%A, %B %d, %Y")
    today_weekday = now.weekday()  # 0=Mon, 6=Sun

    # --- Overdue tasks ---
    try:
        all_active_tasks = crud.get_tasks()
        overdue_tasks = [
            t for t in all_active_tasks
            if t.due_date and t.due_date < today
            and t.status != "done"
        ]
        overdue_count = len(overdue_tasks)
    except Exception:
        overdue_count = 0
        all_active_tasks = []

    # --- Today's tasks (due today OR scheduled today — both in user-local time) ---
    try:
        today_tasks = [
            t for t in all_active_tasks
            if (t.due_date and t.due_date == today)
            or (t.scheduled_at and to_local_date(t.scheduled_at) == today)
        ]
    except Exception:
        today_tasks = []

    # --- Next 3 calendar events (filter in naive UTC to match DB storage) ---
    try:
        upcoming_events = crud.get_events(start=utc_now_naive())[:3]
    except Exception:
        upcoming_events = []

    # --- Habits due today with streaks ---
    try:
        all_habits = crud.get_habits()
        habit_ids = [h.id for h in all_habits]
        completed_today_ids = crud.get_habit_completions_bulk(
            habit_ids, for_date=today
        ) if habit_ids else []

        habits_due_today = []
        for h in all_habits:
            freq = h.frequency or "daily"
            if freq == "daily":
                is_due = True
            elif freq == "weekdays":
                is_due = today_weekday < 5
            elif freq in ("weekly", "custom"):
                target_days: List[int] = []
                if h.target_days:
                    try:
                        target_days = _json.loads(h.target_days)
                    except Exception:
                        target_days = []
                is_due = today_weekday in target_days
            else:
                is_due = True

            if is_due:
                habits_due_today.append({
                    "title": h.title,
                    "streak": h.streak_current or 0,
                    "done_today": h.id in completed_today_ids,
                })
    except Exception:
        habits_due_today = []

    # --- Build live context block ---
    lines = [
        f"--- LIVE CONTEXT (as of {today_str}) ---",
        f"Overdue tasks: {overdue_count}",
        "",
        "Today's tasks:",
    ]
    if today_tasks:
        for t in today_tasks[:10]:
            lines.append(f"  - [{t.priority}] {t.title} ({t.status})")
    else:
        lines.append("  (none)")

    lines.append("")
    lines.append("Next 3 calendar events:")
    if upcoming_events:
        tz = user_tz()
        for e in upcoming_events:
            try:
                # Naive UTC in the DB → user-local for display.
                local_dt = e.start_datetime.replace(tzinfo=timezone.utc).astimezone(tz)
                dt_label = local_dt.strftime("%a %b %d %H:%M")
            except Exception:
                dt_label = "?"
            lines.append(f"  - {e.title} @ {dt_label}")
    else:
        lines.append("  (none)")

    lines.append("")
    lines.append("Habits due today:")
    if habits_due_today:
        for h in habits_due_today:
            status_label = "done" if h["done_today"] else "pending"
            lines.append(
                f"  - {h['title']} ({status_label}, streak: {h['streak']})"
            )
    else:
        lines.append("  (none)")

    lines.append("--- END LIVE CONTEXT ---")
    context_block = "\n".join(lines)

    tz = user_tz()
    tz_offset_str = datetime.now(tz).strftime("%z")  # e.g. "+0200"
    tz_offset_pretty = f"UTC{tz_offset_str[:3]}:{tz_offset_str[3:]}" if tz_offset_str else "UTC"

    return (
        f"You are a personal productivity assistant with full read/write access to the "
        f"user's tasks, goals, habits, and calendar. Today is {today_str}.\n\n"
        f"TIMEZONE: The user's local timezone is {tz.key} ({tz_offset_pretty}). "
        f"All datetimes in this prompt, in tool results, and in the parameters you pass "
        f"to tools are in the user's local timezone. You do NOT need to convert times — "
        f"just read what you see and emit times the user would recognise. "
        f"Naive ISO strings (no offset) are accepted and interpreted as local time.\n\n"
        "You can help the user:\n"
        "- Create, update, prioritise, and delete tasks and projects\n"
        "- Track goals and sub-goals with progress percentages\n"
        "- Log and monitor daily habits and streaks\n"
        "- Schedule and manage calendar events — ALWAYS create a calendar event "
        "(event_type='task_block') whenever you schedule a task, so it appears on "
        "the calendar and future scheduling calls avoid double-booking\n"
        "- Summarise today's agenda, review weekly progress, and suggest a daily schedule\n\n"
        "You have tools available covering tasks, goals, habits, calendar events, "
        "aggregate overviews, and Google Calendar sync. "
        "Use them proactively whenever the user asks about their data. "
        "Always fetch fresh information rather than relying on conversation history alone. "
        "Be concise, practical, and action-oriented in your responses.\n\n"
        + context_block
    )


# ---------------------------------------------------------------------------
#  Context truncation
# ---------------------------------------------------------------------------

def _truncate_history(
    messages: List[dict],
    max_tokens: int = 40000,
) -> List[dict]:
    """
    Trim oldest non-system messages when the estimated token count exceeds max_tokens.

    Uses a character-based estimate: 4 chars ≈ 1 token.
    Always preserves the most recent 4 messages regardless of token count.
    """
    if not messages:
        return messages

    ALWAYS_KEEP = 4

    def _estimate_tokens(msg: dict) -> int:
        content = msg.get("content", "")
        if isinstance(content, list):
            text = " ".join(
                b.get("text", "") if isinstance(b, dict) else str(b)
                for b in content
            )
        else:
            text = str(content)
        return max(1, len(text) // 4)

    result = list(messages)
    while len(result) > ALWAYS_KEEP:
        total = sum(_estimate_tokens(m) for m in result)
        if total <= max_tokens:
            break
        result = result[1:]

    return result


# ---------------------------------------------------------------------------
#  Shared helpers
# ---------------------------------------------------------------------------

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


def _persist_user_message(messages: List[dict], session_id: str) -> None:
    """Persist the last user message to the DB (if it is a user message)."""
    if messages and messages[-1]["role"] == "user":
        raw_content = messages[-1]["content"]
        if isinstance(raw_content, list):
            user_text = " ".join(
                b.get("text", "") for b in raw_content if isinstance(b, dict)
            )
        else:
            user_text = str(raw_content)
        crud.add_message(session_id=session_id, role="user", content=user_text)


def _process_tool_use_response(
    response_content: list,
    response_content_dicts: List[dict],
    working_messages: List[dict],
    tool_calls_log: List[dict],
    session_id: str,
) -> None:
    """
    Process tool_use blocks from a Claude response:
    - Appends assistant message to working_messages
    - Executes each tool
    - Persists tool call and result records
    - Appends tool results to working_messages
    Mutates working_messages and tool_calls_log in place.
    """
    working_messages.append({
        "role": "assistant",
        "content": response_content_dicts,
    })

    tool_results: List[dict] = []
    for block in response_content:
        if block.type != "tool_use":
            continue

        result = execute_tool(block.name, dict(block.input))
        tool_calls_log.append({
            "tool": block.name,
            "args": dict(block.input),
            "result": result,
        })

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

    working_messages.append({
        "role": "user",
        "content": tool_results,
    })


# ---------------------------------------------------------------------------
#  Non-streaming agent loop (used by run_agent)
# ---------------------------------------------------------------------------

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
    system_prompt = _build_system_prompt()

    _persist_user_message(messages, session_id)

    working_messages: List[dict] = _truncate_history(list(messages))
    tool_calls_log: List[dict] = []
    response_text = ""

    for _iteration in range(_MAX_ITERATIONS):
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=system_prompt,
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
            for block in response.content:
                if block.type == "text":
                    response_text += block.text

            _process_tool_use_response(
                response_content=response.content,
                response_content_dicts=[_block_to_dict(b) for b in response.content],
                working_messages=working_messages,
                tool_calls_log=tool_calls_log,
                session_id=session_id,
            )

        else:
            response_text += f" [Stopped: {response.stop_reason}]"
            crud.add_message(
                session_id=session_id,
                role="assistant",
                content=response_text,
            )
            break

    else:
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


# ---------------------------------------------------------------------------
#  Streaming agent loop — yields SSE events for the final text response
# ---------------------------------------------------------------------------

def run_agent_stream(
    messages: List[dict],
    session_id: str,
) -> Generator[str, None, None]:
    """
    Run the Claude agent and yield SSE-formatted tokens for the final response.

    Tool-use iterations complete fully (non-streaming) before the final
    assistant text response is streamed token-by-token.

    Each yielded string is a complete SSE event: "data: <token>\\n\\n".
    A final "data: [DONE]\\n\\n" sentinel is always emitted.

    Args:
        messages: Full conversation history, last item must be the new user message.
        session_id: DB session ID.
    """
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
    system_prompt = _build_system_prompt()

    _persist_user_message(messages, session_id)

    working_messages: List[dict] = _truncate_history(list(messages))
    tool_calls_log: List[dict] = []

    for _iteration in range(_MAX_ITERATIONS):
        # Use client.messages.stream() for every call.
        # For tool_use iterations: collect the full message (no text emitted to client).
        # For end_turn iteration: emit the text tokens as SSE events.
        with client.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=system_prompt,
            tools=ALL_TOOLS,
            messages=working_messages,
        ) as stream:
            final_message = stream.get_final_message()

        stop_reason = final_message.stop_reason

        if stop_reason == "end_turn":
            # Extract final text
            response_text = "".join(
                block.text
                for block in final_message.content
                if block.type == "text"
            )
            crud.add_message(
                session_id=session_id,
                role="assistant",
                content=response_text,
                token_count=final_message.usage.output_tokens,
            )
            # Stream word-by-word so the client renders progressively
            words = response_text.split()
            for i, word in enumerate(words):
                separator = " " if i < len(words) - 1 else ""
                yield f"data: {word}{separator}\n\n"
            yield "data: [DONE]\n\n"
            return

        elif stop_reason == "tool_use":
            _process_tool_use_response(
                response_content=final_message.content,
                response_content_dicts=[_block_to_dict(b) for b in final_message.content],
                working_messages=working_messages,
                tool_calls_log=tool_calls_log,
                session_id=session_id,
            )

        else:
            msg = f"[Stopped: {stop_reason}]"
            crud.add_message(
                session_id=session_id,
                role="assistant",
                content=msg,
            )
            yield f"data: {msg}\n\n"
            yield "data: [DONE]\n\n"
            return

    # Max iterations exhausted
    msg = (
        "I reached the maximum number of tool-call rounds without finishing. "
        "Please try a simpler request or break it into smaller steps."
    )
    crud.add_message(session_id=session_id, role="assistant", content=msg)
    yield f"data: {msg}\n\n"
    yield "data: [DONE]\n\n"
