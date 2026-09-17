"""
Gemini lead research → Supabase (gather / DB update stage).

Maps fields to Postgres snake_case columns on the leads table.
Run locally:
  .venv/bin/python scripts/main.py

Env:
  GEMINI_API_KEY
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_LEADS_TABLE   (default: emailer_table — set to emailer-table if that is your real name)
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from typing import Optional

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


TABLE_NAME = (os.environ.get("SUPABASE_LEADS_TABLE") or "emailer-table").strip()


class LeadRecord(BaseModel):
    company: str = Field(description="Official name of the business/company")
    contact_name: Optional[str] = Field(
        None, description="Name of marketing lead, founder, or key contact if discovered"
    )
    title: Optional[str] = Field(None, description="Designation/Job title of contact_name")
    email: Optional[str] = Field(None, description="Publicly available contact or business email")
    email_source: Optional[str] = Field(
        None, description="URL or context where the email was located"
    )
    phone: Optional[str] = Field(
        None, description="Public customer care, office, or direct phone number"
    )
    industry: Optional[str] = Field(
        None, description="Industry sector, e.g. Retail, Real Estate, Healthcare, Education"
    )
    website: Optional[str] = Field(None, description="Official company homepage URL")
    location_hint: Optional[str] = Field(
        None, description="City, prominent street, landmark, or branch address"
    )
    buy_signals: Optional[str] = Field(
        None,
        description="Recent campaigns, new store launches, expansion news, or hiring trends",
    )
    priority: Optional[str] = Field(
        None, description="'High', 'Medium', or 'Low' based on ad activity and outreach fit"
    )
    confidence: Optional[float] = Field(
        None, description="Confidence score from 0.0 to 1.0 on accuracy of details"
    )
    sources: Optional[str] = Field(
        None, description="Comma-separated URLs used to verify this profile"
    )
    notes: Optional[str] = Field(
        None, description="Key strategic outreach angle or context summary"
    )


gemini_client = genai.Client(api_key=require_env("GEMINI_API_KEY"))
supabase: Client = create_client(
    require_env("SUPABASE_URL"),
    require_env("SUPABASE_SERVICE_ROLE_KEY"),
)


def _slug_company(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "unknown"


def _normalize_record(lead_data: dict, *, prompt: str, item: dict) -> dict:
    """Attach metadata, coerce list-ish fields to text, mock missing email."""
    out = dict(lead_data)

    for key in ("sources", "buy_signals"):
        val = out.get(key)
        if isinstance(val, list):
            out[key] = ", ".join(str(x).strip() for x in val if str(x).strip())

    email = (out.get("email") or "").strip().lower()
    if email and "@" in email:
        out["email"] = email
        out.setdefault("email_source", out.get("email_source") or "public")
    else:
        # Never invent personal inboxes; dry-run friendly placeholder
        out["email"] = f"{_slug_company(out.get('company') or item['company'])}@loky-mock.test"
        out["email_source"] = "missing"

    out["research_query"] = prompt
    out["query_wave"] = item.get("query_wave", "Wave-1")
    out["nearest_screen"] = item.get("nearest_screen")
    out["operator"] = item.get("operator", "Gemini-Pipeline")
    out["network"] = item.get("network")
    out["status"] = "researched"
    return out


def _generate_lead(prompt: str) -> dict:
    """Grounded structured JSON; fall back to grounded text + schema prompt."""
    try:
        response = gemini_client.models.generate_content(
            model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
            or "gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
                response_mime_type="application/json",
                response_schema=LeadRecord,
            ),
        )
        return json.loads(response.text)
    except Exception as first_err:
        print(f"[warn] structured+grounding failed: {first_err}", file=sys.stderr)
        response = gemini_client.models.generate_content(
            model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
            or "gemini-2.5-flash",
            contents=(
                f"{prompt}\n\nReturn ONLY valid JSON matching this schema:\n"
                f"{json.dumps(LeadRecord.model_json_schema(), indent=2)}"
            ),
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
            ),
        )
        return json.loads(response.text)


def process_lead_queries(queries: list[dict]) -> None:
    records: list[dict] = []

    for item in queries:
        target_company = item["company"]
        print(f"Researching: {target_company}...")

        prompt = (
            f"Perform a web search for the business '{target_company}'. "
            f"Find official business contact details, official website, operational locations, "
            f"and recent expansion or advertising signals. Prefer Patna / Bihar context when relevant."
        )

        try:
            lead_data = _generate_lead(prompt)
            if not lead_data.get("company"):
                lead_data["company"] = target_company
            # Validate / strip unknown keys via pydantic
            validated = LeadRecord.model_validate(lead_data).model_dump()
            records.append(_normalize_record(validated, prompt=prompt, item=item))
        except Exception as e:
            print(f"Error processing {target_company}: {e}", file=sys.stderr)

        time.sleep(1)

    if not records:
        print("No records to push.")
        return

    # Requires UNIQUE(company) — see scripts/supabase-emailer-table-migrate.sql
    supabase.table(TABLE_NAME).upsert(records, on_conflict="company").execute()
    print(f"Pushed {len(records)} records into {TABLE_NAME}.")


if __name__ == "__main__":
    target_list = [
        {
            "company": "Kalyan Jewellers Patna",
            "nearest_screen": "Patna Junction",
            "query_wave": "Wave-1",
            "network": "Loky Media Patna DOOH",
        },
        {
            "company": "Mediversal Hospital Patna",
            "nearest_screen": "Kankarbagh",
            "query_wave": "Wave-1",
            "network": "Loky Media Patna DOOH",
        },
    ]
    process_lead_queries(target_list)
