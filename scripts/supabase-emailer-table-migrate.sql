-- Run once in Supabase → SQL Editor
-- Table name uses hyphen: public."emailer-table"

alter table public."emailer-table"
  add column if not exists subject text default '',
  add column if not exists body text default '',
  add column if not exists word_count integer default 0,
  add column if not exists last_error text default '',
  add column if not exists sent_at timestamptz,
  add column if not exists generated_at timestamptz,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists whatsapp jsonb;

update public."emailer-table"
set email = null
where email is not null and trim(email) = '';

create unique index if not exists emailer_table_email_uidx
  on public."emailer-table" (email)
  where email is not null;

create unique index if not exists emailer_table_company_uidx
  on public."emailer-table" (company)
  where company is not null;
