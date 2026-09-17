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

Skim leads between the two jobs via the UI or `data/leads.json`. Keep the Node process alive (Railway) so both crons fire. When `CRON_SECRET` is set, ops routes require header `x-cron-secret`.

## Deploy on Railway

Repo: [surajprakash301/mailer-service](https://github.com/surajprakash301/mailer-service)

1. In [Railway](https://railway.app): **New Project** → **Deploy from GitHub** → select `mailer-service`.
2. Build uses the included `Dockerfile` / `railway.toml`.
3. **Variables** (Variables tab) — paste secrets in the Railway UI only, never commit them:

| Variable | Notes |
| --- | --- |
| `OPENAI_API_KEY` | Live key for market pick + drafts |
| `RESEND_API_KEY` | Live Resend key |
| `FROM_EMAIL` | e.g. `Loky Media <outreach@lokymedia.com>` |
| `REPLY_TO` | e.g. `support@lokymedia.com` |
| `DRY_RUN` | `true` first; `false` when ready to send live |
| `WHATSAPP_DRY_RUN` | `true` until Meta Cloud API is ready |
| `DATA_DIR` | `/data` |
| `CRON_SECRET` | Long random string |
| `GATHER_CRON` / `SEND_CRON` | defaults `0 7 * * *` / `45 8 * * *` |
| `MAX_EMAILS_PER_DAY` | e.g. `25` |
| `PORT` | Railway sets this automatically |

4. **Volume**: add a volume mounted at `/data` so `leads.json` and `cron-runs.json` survive redeploys.
5. **Settings**: keep the service always on (no sleep) so in-process `node-cron` fires at 7:00 / 8:45 IST.
6. Generate a public domain, then check:

```bash
curl -s https://YOUR-APP.up.railway.app/api/health
```

You should see `gatherCron`, `sendCron`, and `lastCronRuns`. Trigger gather manually:

```bash
curl -s -X POST https://YOUR-APP.up.railway.app/api/pipeline/gather \
  -H 'Content-Type: application/json' \
  -H "x-cron-secret: YOUR_CRON_SECRET" \
  -d '{}'
```

## Pitch rules baked into the prompt

- In-house 2D/3D motion graphics (no production barrier)
- Fraser Road, Patna Junction, Danapur Station, Rukanpura
- Signed by Suraj Prakash, founder
- 10-second HD spot on a 2-minute loop, 450+ daily impressions
- CTA: complimentary 10-second animated screen mock-up
- Under 120 words, peer-to-peer tone
