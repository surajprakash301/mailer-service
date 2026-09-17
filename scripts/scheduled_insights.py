"""
Scheduled market insights: Gemini (Google Search grounding) → Supabase.

Requires env:
  GEMINI_API_KEY
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Table: scheduled_insights
  (query_topic, headline, summary, key_takeaways, source_domains)
"""

from __future__ import annotations

import json
import os
import sys

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from supabase import Client, create_client

load_dotenv()


def require_env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise SystemExit(f"Missing required env var: {name}")
    return value


gemini_client = genai.Client(api_key=require_env("GEMINI_API_KEY"))
supabase: Client = create_client(
    require_env("SUPABASE_URL"),
    require_env("SUPABASE_SERVICE_ROLE_KEY"),
)


class MarketUpdate(BaseModel):
    query_topic: str
    headline: str = Field(description="One-sentence headline summary")
    summary: str = Field(description="Detailed 2-3 sentence overview")
    key_takeaways: list[str]
    source_domains: list[str]


def run_scheduled_job(queries: list[str]) -> None:
    records: list[dict] = []

    for query in queries:
        prompt = f"Perform a web search and extract current developments for: {query}"

        # Grounding + JSON schema together is flaky on some models; try grounded
        # structured output first, then fall back to grounded text → parse.
        try:
            response = gemini_client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                    response_mime_type="application/json",
                    response_schema=MarketUpdate,
                ),
            )
            data = json.loads(response.text)
        except Exception as first_err:
            print(f"[warn] structured+grounding failed for {query!r}: {first_err}", file=sys.stderr)
            response = gemini_client.models.generate_content(
                model="gemini-2.5-flash",
                contents=(
                    f"{prompt}\n\n"
                    "Return ONLY valid JSON matching this schema:\n"
                    f"{json.dumps(MarketUpdate.model_json_schema(), indent=2)}"
                ),
                config=types.GenerateContentConfig(
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                ),
            )
            data = json.loads(response.text)

        # Ensure the originating query is stored even if the model omits it
        data.setdefault("query_topic", query)
        records.append(MarketUpdate.model_validate(data).model_dump())

    supabase.table("scheduled_insights").insert(records).execute()
    print(f"Successfully inserted {len(records)} records into Supabase.")


if __name__ == "__main__":
    search_sequence = [
        "Latest developments in digital out-of-home programmatic advertising 2026",
        "Recent breakthroughs in edge computing for traffic analytics",
    ]
    run_scheduled_job(search_sequence)
