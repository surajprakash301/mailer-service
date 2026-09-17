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
  GATHER_FOCUS_INDUSTRIES  optional comma list; default = data/durga-puja-industries.json
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from supabase import Client, create_client

load_dotenv()

ROOT = Path(__file__).resolve().parents[1]
FOCUS_INDUSTRIES_PATH = ROOT / "data" / "durga-puja-industries.json"


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
SCREENS = [
    "dakbangla_chauraha",
    "boring_road",
    "rukanpura_jagdeo_path",
    "mithapur_bypass",
]


def load_focus_industries() -> list[dict]:
    """Durga Puja focus niches. Override labels via GATHER_FOCUS_INDUSTRIES."""
    override = (os.environ.get("GATHER_FOCUS_INDUSTRIES") or "").strip()
    if override:
        return [
            {
                "industry": label.strip(),
                "why": f"Durga Puja visibility for {label.strip()} in Patna",
                "query": f"{label.strip()} Patna showroom OR store OR office",
            }
            for label in override.split(",")
            if label.strip()
        ]
    try:
        raw = json.loads(FOCUS_INDUSTRIES_PATH.read_text(encoding="utf-8"))
        rows = raw.get("industries") if isinstance(raw, dict) else raw
        out = []
        for row in rows or []:
            industry = str(row.get("industry") or "").strip()
            if not industry:
                continue
            out.append(
                {
                    "industry": industry,
                    "why": str(row.get("why") or "").strip(),
                    "query": str(row.get("query") or f"{industry} Patna").strip(),
                }
            )
        if out:
            return out
    except Exception as err:
        print(f"[warn] could not load {FOCUS_INDUSTRIES_PATH}: {err}", file=sys.stderr)
    return [
        {
            "industry": "Jewellery",
            "why": "Peak Durga Puja jewellery purchase window in Patna",
            "query": "jewellery gold showroom Patna",
        }
    ]


FOCUS_INDUSTRIES = load_focus_industries()
FALLBACK_NICHES = [f"{row['industry']} — {row['query']}" for row in FOCUS_INDUSTRIES]


def pick_focus_slice(count: int) -> list[dict]:
    """Rotate through the focus list each IST day so all niches get coverage."""
    if not FOCUS_INDUSTRIES:
        return []
    n = max(1, min(count, len(FOCUS_INDUSTRIES)))
    start = datetime.now(ZoneInfo("Asia/Kolkata")).timetuple().tm_yday % len(FOCUS_INDUSTRIES)
    return [FOCUS_INDUSTRIES[(start + i) % len(FOCUS_INDUSTRIES)] for i in range(n)]



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
        description="One of: dakbangla_chauraha, boring_road, rukanpura_jagdeo_path, mithapur_bypass",
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
        "dakbangla": "dakbangla_chauraha",
        "dakbangla_chauraha": "dakbangla_chauraha",
        "dak_bungalow": "dakbangla_chauraha",
        "dakbungla": "dakbangla_chauraha",
        "boring": "boring_road",
        "boring_road": "boring_road",
        "jagdeo": "rukanpura_jagdeo_path",
        "rukanpura_jagdeo_path": "rukanpura_jagdeo_path",
        "rukanpura": "rukanpura_jagdeo_path",
        "mithapur": "mithapur_bypass",
        "mithapur_bypass": "mithapur_bypass",
        # legacy ids from older waves
        "fraser": "dakbangla_chauraha",
        "fraser_road": "dakbangla_chauraha",
        "junction": "boring_road",
        "patna_junction": "boring_road",
        "danapur": "mithapur_bypass",
        "danapur_station": "mithapur_bypass",
    }
    if raw in SCREENS:
        return raw
    for key, screen in aliases.items():
        if key in raw:
            return screen
    return "dakbangla_chauraha"


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
    focus = pick_focus_slice(industries)
    focus_labels = [row["industry"] for row in focus]
    focus_block = "\n".join(
        f"- {row['industry']}: search hint «{row['query']}» ({row['why']})"
        for row in focus
    )
    all_labels = ", ".join(row["industry"] for row in FOCUS_INDUSTRIES)

    prompt = f"""You are sourcing B2B cold-outreach prospects for Loky Media, a Patna DOOH
(roadside LED) network with screens on Dakbangla Chauraha (2 screens), Boring Road (3 screens),
Rukanpura Jagdeo Path, and Mithapur Bypass.

Today is {day} (Asia/Kolkata). Durga Puja is approaching — prioritize festive-budget buyers.

ALLOWED industries only (do not invent other categories). Today's focus slice:
{focus_block}

Full operator allowlist (stay inside this set): {all_labels}

Use web search to find REAL companies currently operating in Patna (or clear Patna branches)
that could buy a 20 seconds / 30 seconds HD spot for Durga Puja / festive visibility.

Return exactly {limit} prospects spanning the {len(focus_labels)} focus industries above
({", ".join(focus_labels)}).
Companies per industry may vary (e.g. 1–4); do not force an even split.
Rough guide only: around {per_industry} per niche on average is fine.

Rules:
- industry field MUST be one of the allowed labels (exact spelling when possible)
- Must be real named businesses with Patna / Bihar presence (not invented)
- Prefer local operators or clear Patna branches of regional / national brands
- Cover as many of today's focus industries as possible; diversify
- Do not repeat the same company
- nearest_screen must be one of: dakbangla_chauraha, boring_road, rukanpura_jagdeo_path, mithapur_bypass
- Include website when found
- Prefer brands likely to run Puja-season offers, launches, or footfall drives
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
        industry = FOCUS_INDUSTRIES[(start + i) % len(FOCUS_INDUSTRIES)]["industry"]
        fallback.append(
            {
                "company": f"Patna prospect — {niche}",
                "industry": industry,
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
    focus = pick_focus_slice(industries)

    print(
        f"Discovering up to {max_leads} Patna prospects "
        f"(focus {len(focus)}/{len(FOCUS_INDUSTRIES)} Durga Puja categories, "
        f"hint≈{per_industry}/niche)..."
    )
    print("Today's industry focus: " + ", ".join(row["industry"] for row in focus))
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
