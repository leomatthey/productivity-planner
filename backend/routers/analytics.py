"""
backend/routers/analytics.py — Analytics, statistics, and LLM insights endpoints.

Assignment compliance:
  Feature 1 (agent.py): multi-call tool-use loop with 20 tools ✓ (unchanged from Sprint 2)
  Feature 2 (analytics.py + Analytics.tsx):
    data aggregation → LLM structured JSON → chart visual highlighting ✓
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import db.crud as crud

router = APIRouter()

# ---------------------------------------------------------------------------
# System prompt for Claude — instructs strict JSON-only output.
# The "metric" enum values are mapped to specific chart elements in the
# frontend so the LLM output directly drives visual highlighting state.
# ---------------------------------------------------------------------------
_SYSTEM_PROMPT = """You are a productivity analytics assistant. Analyse the provided statistics and return ONLY a valid JSON object. No markdown, no code fences, no explanation outside the JSON.

Return this exact schema:
{
  "highlights": [
    {
      "metric": "task_completion_rate | habit_completion_rate | goal_progress | overdue_tasks | tasks_this_week | top_habit_streak",
      "value": "the key figure as a string (e.g. '73%' or '12 tasks')",
      "trend": "up | down | neutral",
      "insight": "one-sentence insight about this metric"
    }
  ],
  "patterns": [
    {
      "title": "short pattern name",
      "description": "2-3 sentences describing the pattern",
      "severity": "positive | neutral | warning"
    }
  ],
  "recommendations": [
    {
      "action": "specific actionable step",
      "rationale": "why this will help",
      "priority": "high | medium | low"
    }
  ],
  "focus_suggestion": {
    "area": "one concrete area to focus on this week",
    "reason": "why this area is most impactful right now"
  }
}

Rules:
- highlights: 3-5 items. Use actual numbers from the data. The metric field must be one of the enum values listed.
- patterns: 2-4 items. Surface trends, correlations, anomalies.
- recommendations: 3-5 items. Be concrete and actionable.
- focus_suggestion: exactly 1 object.
"""


@router.get("/stats")
def get_stats() -> Dict[str, Any]:
    """Return rich aggregated analytics payload for all entities."""
    return crud.get_analytics_stats()


class InsightsRequest(BaseModel):
    stats: Dict[str, Any]


@router.post("/insights")
def generate_insights(body: InsightsRequest) -> Dict[str, Any]:
    """
    Send aggregated stats to Claude and return structured JSON insights.

    The LLM returns highlights, patterns, recommendations, and a focus
    suggestion. The metric field in each highlight maps to a specific chart
    in the frontend — the frontend uses this to add a visual ring highlight
    to the corresponding chart card (LLM output drives visual state).

    On JSON parse failure returns HTTP 422 with the raw LLM text so the
    caller can debug without losing the response.
    """
    import anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    client = anthropic.Anthropic(api_key=api_key)

    user_content = (
        "Analyse these productivity statistics and return the JSON insights object:\n\n"
        + json.dumps(body.stats, indent=2)
    )

    raw = ""
    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )
        raw = response.content[0].text.strip()

        # Strip markdown code fences if Claude wraps the JSON
        if raw.startswith("```"):
            lines = raw.split("\n")
            # Drop opening fence line (```json or ```)
            raw = "\n".join(lines[1:])
            if raw.endswith("```"):
                raw = raw[: raw.rfind("```")].strip()

        insights = json.loads(raw)
        return insights

    except json.JSONDecodeError:
        raise HTTPException(
            status_code=422,
            detail={"error": "LLM returned invalid JSON", "raw": raw},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
