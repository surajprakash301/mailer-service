"""
Gemini lead research → Supabase (gather / DB update stage).

Each run:
  1) Discover fresh Patna DOOH prospects (niches + companies via web search)
  2) Skip companies already in the table
  3) Deep-research each new company and upsert into emailer-table

Env:
  GEMINI_API_KEY
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_LEADS_TABLE   (default: emailer-table)
  GEMINI_MODEL           (default: gemini-3.6-flash)
  GATHER_INDUSTRIES      (default: 10)
  GATHER_COMPANIES_PER_INDUSTRY (hint only; counts may vary)
  GATHER_MAX_LEADS       (default: 25 — hard cap on researched leads)
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

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


def env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


TABLE_NAME = (os.environ.get("SUPABASE_LEADS_TABLE") or "emailer-table").strip()
DEFAULT_GEMINI_MODEL = "gemini-3.6-flash"
SCREENS = ["fraser_road", "patna_junction", "danapur_station", "rukanpura"]

FALLBACK_NICHES = [
    "multi-speciality hospitals near Bailey Road / Rukanpura Patna",
    "automobile dealers Exhibition Road or Saguna More Patna",
    "hotels and banquet halls Fraser Road / Gandhi Maidan Patna",
    "coaching institutes Boring Road Patna",
    "diagnostic labs and clinics Danapur Patna",
    "retail showrooms and lifestyle stores Fraser Road Patna",
]


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


class ProspectTarget(BaseModel):
    company: str = Field(description="Real operating business name with Patna presence")
    industry: Optional[str] = None
    nearest_screen: Optional[str] = Field(
        None,
        description="One of: fraser_road, patna_junction, danapur_station, rukanpura",
    )
    location_hint: Optional[str] = None
    website: Optional[str] = None
    why: Optional[str] = Field(None, description="Why this brand fits Loky DOOH outreach now")


class ProspectBatch(BaseModel):
    prospects: list[ProspectTarget]


gemini_client = genai.Client(api_key=require_env("GEMINI_API_KEY"))
supabase: Client = create_client(
    require_env("SUPABASE_URL"),
    require_env("SUPABASE_SERVICE_ROLE_KEY"),
)


def _gemini_model() -> str:
    return (os.environ.get("GEMINI_MODEL") or DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL


def _slug_company(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "unknown"


def _query_wave() -> str:
    today = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%Y-%m-%d")
    return f"wave-{today}"


def _normalize_screen(value: Optional[str]) -> str:
    raw = (value or "").strip().lower().replace(" ", "_").replace("-", "_")
    aliases = {
        "fraser": "fraser_road",
        "fraserroad": "fraser_road",
        "junction": "patna_junction",
        "patna_junction": "patna_junction",
        "danapur": "danapur_station",
        "danapur_station": "danapur_station",
        "rukanpura": "rukanpura",
        "bailey": "rukanpura",
    }
    if raw in SCREENS:
        return raw
    for key, screen in aliases.items():
        if key in raw:
            return screen
    return "fraser_road"


def _existing_companies() -> set[str]:
    try:
        result = supabase.table(TABLE_NAME).select("company").execute()
        rows = result.data or []
        return {str(r.get("company") or "").strip().lower() for r in rows if r.get("company")}
    except Exception as err:
        print(f"[warn] could not load existing companies: {err}", file=sys.stderr)
        return set()


def _generate_json(prompt: str, schema: type[BaseModel]) -> dict:
    model = _gemini_model()
    try:
        response = gemini_client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
                response_mime_type="application/json",
                response_schema=schema,
            ),
        )
        return json.loads(response.text)
    except Exception as first_err:
        print(f"[warn] structured+grounding failed ({model}): {first_err}", file=sys.stderr)
        response = gemini_client.models.generate_content(
            model=model,
            contents=(
                f"{prompt}\n\nReturn ONLY valid JSON matching this schema:\n"
                f"{json.dumps(schema.model_json_schema(), indent=2)}"
            ),
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
            ),
        )
        return json.loads(response.text)


def discover_prospects(limit: int) -> list[dict]:
    """Use Gemini + Google Search to pick a fresh Patna prospect set for today."""
    industries = env_int("GATHER_INDUSTRIES", 10)
    per_industry = env_int("GATHER_COMPANIES_PER_INDUSTRY", 3)
    day = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%A %d %B %Y")

    prompt = f"""You are sourcing B2B cold-outreach prospects for Loky Media, a Patna DOOH
(roadside LED) network with screens on Fraser Road, Patna Junction, Danapur Station, and Rukanpura.

Today is {day} (Asia/Kolkata).

Use web search to find REAL companies currently operating in Patna that could buy a
10-second HD spot (hospitals, auto dealers, hotels/banquets, coaching, diagnostics, retail,
jewellery, real estate, education, F&B, clinics, showrooms — local Patna presence).

Return exactly {limit} prospects spanning at least {industries} different industries/niches.
Companies per industry may vary (e.g. 1–4); do not force an even split.
Rough guide only: around {per_industry} per niche on average is fine.

Rules:
- Must be real named businesses with Patna / Bihar presence (not invented)
- Prefer local operators or clear Patna branches of regional brands
- Cover at least {industries} distinct industries; diversify
- Do not repeat the same company
- nearest_screen must be one of: fraser_road, patna_junction, danapur_station, rukanpura
- Include website when found
"""

    try:
        raw = _generate_json(prompt, ProspectBatch)
        batch = ProspectBatch.model_validate(raw)
        prospects = []
        for p in batch.prospects:
            company = (p.company or "").strip()
            if not company:
                continue
            prospects.append(
                {
                    "company": company,
                    "industry": (p.industry or "").strip(),
                    "nearest_screen": _normalize_screen(p.nearest_screen),
                    "location_hint": (p.location_hint or "").strip(),
                    "website": (p.website or "").strip(),
                    "why": (p.why or "").strip(),
                    "query_wave": _query_wave(),
                    "operator": "Gemini-Pipeline",
                    "network": "Loky Media Patna DOOH",
                }
            )
        if prospects:
            return prospects[:limit]
    except Exception as err:
        print(f"[warn] prospect discovery failed: {err}", file=sys.stderr)

    # Fallback: rotate niche seeds so mornings still vary without inventing firms
    start = datetime.now(ZoneInfo("Asia/Kolkata")).timetuple().tm_yday % len(FALLBACK_NICHES)
    fallback = []
    for i in range(min(limit, len(FALLBACK_NICHES))):
        niche = FALLBACK_NICHES[(start + i) % len(FALLBACK_NICHES)]
        fallback.append(
            {
                "company": f"Patna prospect — {niche}",
                "industry": niche.split(" near ")[0].split(" ")[0],
                "nearest_screen": SCREENS[i % len(SCREENS)],
                "location_hint": "Patna",
                "website": "",
                "why": niche,
                "query_wave": _query_wave(),
                "operator": "Gemini-Pipeline",
                "network": "Loky Media Patna DOOH",
                "_fallback_search": niche,
            }
        )
    return fallback


def _normalize_record(lead_data: dict, *, prompt: str, item: dict) -> dict:
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
        out["email"] = f"{_slug_company(out.get('company') or item['company'])}@loky-mock.test"
        out["email_source"] = "missing"

    if item.get("industry") and not out.get("industry"):
        out["industry"] = item["industry"]
    if item.get("location_hint") and not out.get("location_hint"):
        out["location_hint"] = item["location_hint"]
    if item.get("website") and not out.get("website"):
        out["website"] = item["website"]
    if item.get("why") and not out.get("notes"):
        out["notes"] = item["why"]

    out["research_query"] = prompt
    out["query_wave"] = item.get("query_wave", _query_wave())
    out["nearest_screen"] = _normalize_screen(item.get("nearest_screen"))
    out["operator"] = item.get("operator", "Gemini-Pipeline")
    out["network"] = item.get("network", "Loky Media Patna DOOH")
    out["status"] = "researched"
    return out


def _generate_lead(prompt: str) -> dict:
    return _generate_json(prompt, LeadRecord)


def process_lead_queries(queries: list[dict]) -> None:
    records: list[dict] = []

    for item in queries:
        target_company = item["company"]
        search_name = item.get("_fallback_search") or target_company
        print(f"Researching: {search_name}...")

        prompt = (
            f"Perform a web search for the business '{search_name}' in Patna / Bihar. "
            f"Find one concrete operating company matching this niche if the name is a niche label. "
            f"Find official business contact details, official website, operational locations, "
            f"and recent expansion or advertising signals. Prefer Patna context."
        )

        try:
            lead_data = _generate_lead(prompt)
            if not (lead_data.get("company") or "").strip():
                lead_data["company"] = target_company.replace("Patna prospect — ", "").strip() or target_company
            validated = LeadRecord.model_validate(lead_data).model_dump()
            records.append(_normalize_record(validated, prompt=prompt, item=item))
            print(f"  → {validated.get('company')} / {validated.get('email')}")
        except Exception as e:
            print(f"Error processing {target_company}: {e}", file=sys.stderr)

        time.sleep(1)

    if not records:
        print("No records to push.")
        return

    supabase.table(TABLE_NAME).upsert(records, on_conflict="company").execute()
    print(f"Pushed {len(records)} records into {TABLE_NAME}.")


def build_daily_target_list() -> list[dict]:
    industries = env_int("GATHER_INDUSTRIES", 10)
    per_industry = env_int("GATHER_COMPANIES_PER_INDUSTRY", 3)
    max_leads = env_int("GATHER_MAX_LEADS", 25)

    print(
        f"Discovering up to {max_leads} Patna prospects "
        f"(≥{industries} industries, flexible companies/niche, hint≈{per_industry}/niche)..."
    )
    discovered = discover_prospects(max_leads)
    known = _existing_companies()

    fresh = []
    seen = set()
    for item in discovered:
        key = item["company"].strip().lower()
        if not key or key in seen:
            continue
        if key in known and not item.get("_fallback_search"):
            print(f"Skip existing: {item['company']}")
            continue
        seen.add(key)
        fresh.append(item)

    if not fresh and discovered:
        # All known — still research discovered set so waves refresh buy_signals
        print("All discovered companies already in DB; refreshing research on new discovery batch.")
        fresh = discovered[:max_leads]

    print(f"Queued {len(fresh)} companies for deep research:")
    for item in fresh:
        print(f"  - {item['company']} [{item.get('nearest_screen')}]")
    return fresh[:max_leads]


if __name__ == "__main__":
    # Optional override: TARGETS_JSON='[{"company":"...","nearest_screen":"fraser_road"}]'
    override = (os.environ.get("TARGETS_JSON") or "").strip()
    if override:
        target_list = json.loads(override)
        print(f"Using TARGETS_JSON override ({len(target_list)} companies)")
    else:
        target_list = build_daily_target_list()

    if not target_list:
        print("No targets to research.")
        raise SystemExit(0)

    process_lead_queries(target_list)
