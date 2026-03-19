"""
pages/ai_chat.py — AI Assistant full chat page.

Powered by Claude claude-sonnet-4-6 with full tool access to tasks, goals, habits,
and calendar data. Supports multiple named sessions with history browsing.
"""

import json
import os
import uuid
from typing import List

import streamlit as st

import db.crud as crud
from agent.agent import run_agent

# ---------------------------------------------------------------------------
# Session state initialisation
# ---------------------------------------------------------------------------
if "chat_session_id" not in st.session_state:
    st.session_state.chat_session_id = str(uuid.uuid4())

if "chat_turns" not in st.session_state:
    # Each turn: {"role": "user"|"assistant", "text": str, "tool_log": List[dict]}
    st.session_state.chat_turns = []

if "chat_api_messages" not in st.session_state:
    # Anthropic API-format messages for the current session context
    st.session_state.chat_api_messages = []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_session(session_id: str) -> None:
    """Reconstruct in-memory turns and API messages from DB records for a past session."""
    records = crud.get_conversation(session_id)
    turns: List[dict] = []
    api_messages: List[dict] = []
    pending_tool_log: List[dict] = []

    for rec in records:
        if rec.role == "user":
            # Flush any orphaned tool log from a prior incomplete turn
            pending_tool_log = []
            turns.append({"role": "user", "text": rec.content or ""})
            api_messages.append({"role": "user", "content": rec.content or ""})

        elif rec.role == "assistant" and rec.tool_name:
            # Tool call record — add to pending log
            try:
                call_data = json.loads(rec.content or "{}")
                args = call_data.get("args", {})
            except (json.JSONDecodeError, TypeError):
                args = {}
            pending_tool_log.append({
                "tool": rec.tool_name,
                "args": args,
                "result": None,
            })

        elif rec.role == "tool":
            # Tool result — match to the last pending entry for this tool name
            try:
                result = json.loads(rec.content or "{}")
            except (json.JSONDecodeError, TypeError):
                result = {}
            for entry in reversed(pending_tool_log):
                if entry["tool"] == rec.tool_name and entry["result"] is None:
                    entry["result"] = result
                    break

        elif rec.role == "assistant" and not rec.tool_name:
            # Final text response — flush pending tool log into this turn
            text = rec.content or ""
            turns.append({
                "role": "assistant",
                "text": text,
                "tool_log": list(pending_tool_log),
            })
            if text:
                api_messages.append({"role": "assistant", "content": text})
            pending_tool_log = []

    # Flush any leftover pending tool log (session that ended mid-tool-call)
    if pending_tool_log:
        turns.append({
            "role": "assistant",
            "text": "",
            "tool_log": list(pending_tool_log),
        })

    st.session_state.chat_session_id = session_id
    st.session_state.chat_turns = turns
    st.session_state.chat_api_messages = api_messages


def _render_tool_log(tool_log: List[dict]) -> None:
    """Render tool calls/results as collapsed expanders inside an assistant message."""
    for entry in tool_log:
        with st.expander(f"🔧 `{entry['tool']}`", expanded=False):
            if entry.get("args"):
                st.caption("Input")
                st.json(entry["args"])
            if entry.get("result") is not None:
                st.caption("Result")
                result = entry["result"]
                if isinstance(result, dict) and "error" in result:
                    st.error(result["error"])
                else:
                    st.json(result)


# ---------------------------------------------------------------------------
# Sidebar — conversation history
# ---------------------------------------------------------------------------
past_sessions = crud.get_sessions()

with st.sidebar:
    st.divider()
    st.caption("**Conversations**")

    if st.button("＋ New conversation", use_container_width=True, key="chat_new_btn"):
        st.session_state.chat_session_id = str(uuid.uuid4())
        st.session_state.chat_turns = []
        st.session_state.chat_api_messages = []
        st.rerun()

    for s_id in past_sessions[:15]:
        recs = crud.get_conversation(s_id, limit=1)
        if recs and recs[0].created_at:
            ts = recs[0].created_at.strftime("%b %d, %H:%M")
            preview = (recs[0].content or "")[:28].replace("\n", " ")
            label = f"{ts} — {preview}"
        else:
            label = s_id[:16]

        is_current = s_id == st.session_state.chat_session_id
        if st.button(
            label,
            key=f"sess_btn_{s_id}",
            use_container_width=True,
            type="primary" if is_current else "secondary",
        ):
            if not is_current:
                _load_session(s_id)
                st.rerun()


# ---------------------------------------------------------------------------
# Page header
# ---------------------------------------------------------------------------
st.title("🤖 AI Assistant")
st.caption(
    "Powered by Claude claude-sonnet-4-6 — full access to your tasks, goals, habits, and calendar."
)

if not os.environ.get("ANTHROPIC_API_KEY"):
    st.warning(
        "⚠️ **ANTHROPIC_API_KEY is not set.** "
        "Add it to your `.env` file to enable the AI assistant."
    )

# ---------------------------------------------------------------------------
# Chat display — render existing turns
# ---------------------------------------------------------------------------
for turn in st.session_state.chat_turns:
    role = turn["role"]
    text = turn.get("text", "")
    tool_log = turn.get("tool_log", [])

    with st.chat_message(role):
        if text:
            st.markdown(text)
        if tool_log:
            _render_tool_log(tool_log)

# ---------------------------------------------------------------------------
# Chat input
# ---------------------------------------------------------------------------
if prompt := st.chat_input("Ask your productivity assistant…"):
    # Display the user message immediately in this render pass
    with st.chat_message("user"):
        st.markdown(prompt)

    # Update in-memory state with the new user turn
    st.session_state.chat_turns.append({"role": "user", "text": prompt})
    st.session_state.chat_api_messages.append({"role": "user", "content": prompt})

    # Run the agent and display the response
    response_text = ""
    tool_log: List[dict] = []

    with st.chat_message("assistant"):
        try:
            with st.spinner("Thinking…"):
                response_text, tool_log = run_agent(
                    st.session_state.chat_api_messages,
                    st.session_state.chat_session_id,
                )
        except Exception as exc:
            response_text = f"⚠️ Error calling the AI: {exc}"
            st.error(response_text)
        else:
            if response_text:
                st.markdown(response_text)
            if tool_log:
                _render_tool_log(tool_log)

    # Store the assistant turn in session state
    st.session_state.chat_turns.append({
        "role": "assistant",
        "text": response_text,
        "tool_log": tool_log,
    })
    if response_text:
        st.session_state.chat_api_messages.append({
            "role": "assistant",
            "content": response_text,
        })

    # Clear cache so the overdue badge in the sidebar stays fresh
    st.cache_data.clear()
