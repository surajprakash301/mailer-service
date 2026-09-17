-- Run once in Supabase → SQL Editor (public.emailer_table)
-- Adds mailer draft/send columns + unique email for gather upserts.

alter table public.emailer_table
  add column if not exists subject text default '',
  add column if not exists body text default '',
  add column if not exists word_count integer default 0,
  add column if not exists last_error text default '',
  add column if not exists sent_at timestamptz,
  add column if not exists generated_at timestamptz,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists whatsapp jsonb;

-- Blank emails break UNIQUE(email); clear or fill them before indexing
update public.emailer_table
set email = null
where email is not null and trim(email) = '';

create unique index if not exists emailer_table_email_uidx
  on public.emailer_table (email)
  where email is not null;
