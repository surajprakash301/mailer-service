# Loky Media Cold Outreach Engine

Hyper-personalized B2B pitches for Loky Media's Patna DOOH screens. Copy is generated with `gpt-4o-mini` (JSON mode) and dispatched through Resend at **8:45 AM IST**.

## Setup

```bash
cp .env.example .env
npm install
npm start
```

Open [http://localhost:8787](http://localhost:8787). Keep `DRY_RUN=true` until the from-address is verified in Resend.

## Automated research mockup

Enter a company, URL, or niche (for example `Kia dealer Exhibition Road`). The engine:

1. Searches public web results and known Patna corridor businesses
2. Fills company, contact, industry, location, notes (mock `@loky-mock.test` email if no public inbox is found)
3. Drafts the pitch (`gpt-4o-mini` when a real key is set, otherwise a template)
4. Mock-sends through Resend while `DRY_RUN=true`

## WhatsApp (Meta Cloud API)

Mock-enabled by default (`WHATSAPP_DRY_RUN=true`). On import/send the engine:

1. Normalizes Indian phones to `+91…`
2. Checks messaging readiness (mock when dry-run; optional contacts probe when live)
3. Sends the same pitch text as WhatsApp (template mode when `WHATSAPP_TEMPLATE_NAME` is set)

```bash
curl -s -X POST http://localhost:8787/api/whatsapp/check \
  -H 'Content-Type: application/json' \
  -d '{"phones":["+918291048324"],"businessLikely":true}'
```

## Branded email HTML

Preview Loky-themed HTML (coral `#FE6545`, live green, logo from lokymedia.com):

[http://localhost:8787/api/preview/email](http://localhost:8787/api/preview/email)


## Daily gather + dispatch

`node-cron` (timezone `Asia/Kolkata`) runs two jobs while the server is up:

1. **7:00 AM** (`GATHER_CRON`) — AI picks booming Patna industries, discovers companies, drafts pitches into `ready` leads (**no send**)
2. **8:45 AM** (`SEND_CRON`) — sends up to `MAX_EMAILS_PER_DAY` (preferring `ready` leads)

Manual triggers:

```bash
# Research + draft only (no Resend)
curl -s -X POST http://localhost:8787/api/pipeline/gather \
  -H 'Content-Type: application/json' \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{"industryLimit":2,"companiesPerIndustry":1}'

# Send ready leads now
curl -s -X POST http://localhost:8787/api/campaigns/run \
  -H "x-cron-secret: $CRON_SECRET"
```

Skim leads between the two jobs via the UI or `data/leads.json`. When `CRON_SECRET` is set, ops routes require header `x-cron-secret`.

## Free deploy (Render + GitHub Actions cron)

Free web hosts **sleep when idle**, so in-process `node-cron` will miss 7:00 / 8:45. This repo uses:

1. `DISABLE_INTERNAL_CRON=true` on Render
2. **GitHub Actions** as the external scheduler:
   - `Gather leads to Supabase` — 07:00 IST (`30 1 * * *` UTC) → `scripts/main.py`
   - `Send campaign via Render` — 08:45 IST (`15 3 * * *` UTC) → `POST /api/campaigns/run`
3. Durable `lastCronRuns` in Supabase (meta row or `cron_runs` table) so `/api/health` survives sleep

### Required GitHub repository secrets

| Secret | Value |
| --- | --- |
| `GEMINI_API_KEY` | Google AI key |
| `SUPABASE_URL` | `https://YOUR_PROJECT.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key |
| `CRON_SECRET` | same as Render `CRON_SECRET` |
| `APP_URL` | optional; defaults to `https://mailer-service-dhq1.onrender.com` |

Optional: run `scripts/supabase-cron-runs-migrate.sql` once for a dedicated `cron_runs` table (otherwise a `__loky_cron_meta__` row is used).

Manual catch-up:

```bash
# Gather (Python locally or Actions → Run workflow)
# Send:
curl -s -X POST https://mailer-service-dhq1.onrender.com/api/campaigns/run \
  -H 'Content-Type: application/json' \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{}'
```

You can still use [cron-job.org](https://cron-job.org) instead of (or in addition to) Actions:

| When | Method | URL | Header |
| --- | --- | --- | --- |
| Every day **07:00** | `POST` | `https://YOUR-APP.onrender.com/api/pipeline/gather` | `x-cron-secret: YOUR_CRON_SECRET` |
| Every day **08:45** | `POST` | `https://YOUR-APP.onrender.com/api/campaigns/run` | `x-cron-secret: YOUR_CRON_SECRET` |

**cron-job.org setup (fixes 401 + timeout):**
1. Request method: **POST**
2. Enable **Custom headers** → add:
   - `x-cron-secret` = same value as Render env `CRON_SECRET`
   - `Content-Type` = `application/json`
3. Request body: `{}`
4. **Advanced → Timeout: at least 60s** (app now returns **202 Accepted** fast; gather finishes in background)
5. Schedule gather **before** send (07:00 gather, 08:45 send), timezone Asia/Kolkata

Alternate auth if custom headers are awkward: `Authorization: Bearer YOUR_CRON_SECRET`

Responses are compact by default (avoids “output too large”). Add `?verbose=1` only when debugging.

### 1. Render

1. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint** (or Web Service) → connect [mailer-service](https://github.com/surajprakash301/mailer-service)
2. Uses `render.yaml` + `Dockerfile`
3. Set secret env vars in the Render UI:

| Variable | Value |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio / Generative Language key |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` (lite = less 503 than `*-latest`) |
| `GEMINI_MODEL_FALLBACKS` | optional comma list of backup models |
| `GATHER_INDUSTRIES` | `1` (keep small on free Render / 30–90s cron) |
| `GATHER_COMPANIES_PER_INDUSTRY` | `1` |
| `RESEND_API_KEY` | your key |
| `FROM_EMAIL` | `Loky Media <outreach@lokymedia.com>` |
| `REPLY_TO` | `support@lokymedia.com` |
| `CRON_SECRET` | long random string |
| `DRY_RUN` | `true` first, then `false` when ready |
| `DISABLE_INTERNAL_CRON` | `true` (required on free tier) |
| `DATA_DIR` | `data` |

4. After deploy, open `https://YOUR-APP.onrender.com/api/health` — expect `disableInternalCron: true`.

**Note:** Free Render disk is **ephemeral** (redeploys can wipe `data/`). Fine for testing; for durable leads later, add a paid disk or move storage off-box.

### 2. External cron (cron-job.org)

Create **two** jobs (timezone **Asia/Kolkata**):

| When | Method | URL | Header |
| --- | --- | --- | --- |
| Every day **07:00** | `POST` | `https://YOUR-APP.onrender.com/api/pipeline/gather` | `x-cron-secret: YOUR_CRON_SECRET` |
| Every day **08:45** | `POST` | `https://YOUR-APP.onrender.com/api/campaigns/run` | `x-cron-secret: YOUR_CRON_SECRET` |

Also set `Content-Type: application/json` and body `{}`. Enable “catch up” / retries if the free instance is cold-starting (first request can take ~30–60s).

Manual test:

```bash
curl -s -X POST https://YOUR-APP.onrender.com/api/pipeline/gather \
  -H 'Content-Type: application/json' \
  -H "x-cron-secret: YOUR_CRON_SECRET" \
  -d '{}'
```

## Optional: Railway (always-on, not free forever)

Repo: [surajprakash301/mailer-service](https://github.com/surajprakash301/mailer-service)

Prefer this only if you pay for always-on compute. Leave `DISABLE_INTERNAL_CRON` unset so built-in 7:00 / 8:45 crons run, and mount a volume at `DATA_DIR=/data`.

1. [Railway](https://railway.app) → **New Project** → **Deploy from GitHub** → `mailer-service`
2. Set the same secrets as Render (`GEMINI_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`, `REPLY_TO`, `CRON_SECRET`, `DRY_RUN`)
3. Attach a volume at `/data`
4. Check `GET /api/health` then optional manual gather with `x-cron-secret`

## Pitch rules baked into the prompt

- In-house 2D/3D motion graphics (no production barrier)
- Fraser Road, Patna Junction, Danapur Station, Rukanpura
- Signed by Suraj Prakash, founder
- 10-second HD spot on a 2-minute loop, 450+ daily impressions
- CTA: complimentary 10-second animated screen mock-up
- Under 120 words, peer-to-peer tone
