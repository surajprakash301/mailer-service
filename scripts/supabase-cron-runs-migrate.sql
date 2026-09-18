-- Run once in Supabase → SQL Editor
-- Durable cron status for Render (ephemeral disk cannot keep cron-runs.json)

create table if not exists public.cron_runs (
  job text primary key check (job in ('gather', 'send')),
  at timestamptz not null default now(),
  storage text default '',
  payload jsonb not null default '{}'::jsonb
);

alter table public.cron_runs enable row level security;

-- Service role bypasses RLS; no anon policies on purpose.
