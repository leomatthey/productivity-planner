"""
backend/routers/ai.py — AI agent chat endpoint.

Reconstructs full conversation history (including tool_use / tool_result pairs)
from the DB before calling run_agent_stream.

Sprint 2: /chat now returns a StreamingResponse (SSE).
  - Tool-use loop completes fully before streaming begins.
  - Each SSE event: "data: <token>\\n\\n"
  - Final sentinel: "data: [DONE]\\n\\n"
"""

from __future__ import annotations

import json
from typing import Generator, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import db.crud as crud
from agent.agent import run_agent, run_agent_stream

router = APIRouter()


# ---------------------------------------------------------------------------
#  Pydantic models
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    message:    str
    session_id: str


class MessageOut(BaseModel):
    id:         int
    role:       str
    content:    Optional[str]
    tool_name:  Optional[str]
    created_at: str

    class Config:
        from_attributes = True


class ChatResponse(BaseModel):
    response:   str
    tool_calls: List[dict]
    session_id: str


# ---------------------------------------------------------------------------
#  Session loader — rebuilds Anthropic API message format from DB records
# ---------------------------------------------------------------------------

def _load_session(session_id: str) -> List[dict]:
    """
    Load stored conversation records and reconstruct the Anthropic API
    messages list, correctly pairing tool_use / tool_result blocks.

    Storage schema (per record):
      role="user"      → plain user text
      role="assistant" + tool_name=None  → plain assistant text
      role="assistant" + tool_name=name  → a tool call (args in content JSON)
      role="tool"      + tool_name=name  → the tool result

    The Anthropic API requires:
      [{"role": "assistant", "content": [{"type": "tool_use", "id": "...", ...}]},
       {"role": "user",      "content": [{"type": "tool_result", "tool_use_id": "...", ...}]}]

    Consecutive assistant(tool_call) + tool pairs are grouped into a single
    assistant message + a single user message (handles parallel tool use).
    """
    records = crud.get_conversation(session_id)
    messages: List[dict] = []
    i = 0

    while i < len(records):
        rec = records[i]

        if rec.role == "user":
            # Plain user text message
            messages.append({"role": "user", "content": rec.content or ""})
            i += 1

        elif rec.role == "assistant" and not rec.tool_name:
            # Plain assistant text
            messages.append({"role": "assistant", "content": rec.content or ""})
            i += 1

        elif rec.role == "assistant" and rec.tool_name:
            # Collect all consecutive (assistant tool_call + tool result) pairs
            # from the same agent iteration into one message pair.
            tool_use_blocks:    List[dict] = []
            tool_result_blocks: List[dict] = []

            while i < len(records) and records[i].role == "assistant" and records[i].tool_name:
                call_rec    = records[i]
                tool_use_id = f"toolu_{call_rec.id}"

                try:
                    parsed = json.loads(call_rec.content or "{}")
                    args   = parsed.get("args", {})
                except (json.JSONDecodeError, AttributeError, TypeError):
                    args = {}

                tool_use_blocks.append({
                    "type":  "tool_use",
                    "id":    tool_use_id,
                    "name":  call_rec.tool_name,
                    "input": args,
                })
                i += 1

                # The very next record should be the corresponding tool result
                if i < len(records) and records[i].role == "tool":
                    result_rec = records[i]
                    tool_result_blocks.append({
                        "type":        "tool_result",
                        "tool_use_id": tool_use_id,
                        "content":     result_rec.content or "{}",
                    })
                    i += 1

            messages.append({"role": "assistant", "content": tool_use_blocks})
            if tool_result_blocks:
                messages.append({"role": "user", "content": tool_result_blocks})

        elif rec.role == "tool":
            # Orphaned tool result (no preceding tool_call record) — skip
            i += 1

        else:
            i += 1

    return messages


# ---------------------------------------------------------------------------
#  Endpoints
# ---------------------------------------------------------------------------

@router.post("/chat")
def chat(body: ChatRequest):
    """
    Send a user message to the AI agent and receive a streaming SSE response.

    The agent tool-use loop completes fully before streaming begins.
    Tokens are emitted as: data: <token>\\n\\n
    A final sentinel is emitted: data: [DONE]\\n\\n

    Sprint 2: returns StreamingResponse (text/event-stream).
    """
    history = _load_session(body.session_id)
    history.append({"role": "user", "content": body.message})

    def event_stream() -> Generator[str, None, None]:
        try:
            for chunk in run_agent_stream(
                messages=history,
                session_id=body.session_id,
            ):
                yield chunk
        except Exception as exc:
            yield f"data: [ERROR] {exc}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/sessions")
def list_sessions():
    return crud.get_sessions()


@router.get("/sessions/{session_id}")
def get_session_messages(session_id: str):
    records = crud.get_conversation(session_id)
    return [
        {
            "id":         r.id,
            "role":       r.role,
            "content":    r.content,
            "tool_name":  r.tool_name,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in records
    ]


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    # TODO: Sprint 2 — add crud.delete_session() for hard-delete
    return {"ok": True, "message": "Session deletion not yet implemented"}
