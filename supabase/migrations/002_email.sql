-- Outreach Console — email sending
--
-- Run after schema.sql: Dashboard → SQL Editor → New query → paste → Run.
-- Idempotent, so re-running is safe.

-- SMTP credentials, one account per user. Written from the Settings screen and
-- read only inside server functions — the browser never selects smtp_password.
create table if not exists public.email_accounts (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  provider       text not null default 'ionos',
  from_name      text not null default '',
  from_email     text not null default '',
  reply_to       text not null default '',
  smtp_host      text not null default 'smtp.ionos.com',
  smtp_port      integer not null default 587,
  -- false = STARTTLS on 587, true = implicit TLS on 465.
  smtp_secure    boolean not null default false,
  smtp_user      text not null default '',
  smtp_password  text not null default '',
  -- Pause between messages. IONOS throttles aggressive senders, so this is
  -- deliberately conservative by default.
  send_delay_ms  integer not null default 1200,
  verified_at    timestamptz,
  updated_at     timestamptz not null default now()
);

-- One row per delivery attempt: the audit trail, the daily-cap counter, and the
-- guard against sending twice to the same person in one campaign.
create table if not exists public.email_sends (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  campaign_id  text,
  prospect_id  text,
  to_email     text not null,
  subject      text not null default '',
  status       text not null check (status in ('sent', 'failed', 'skipped')),
  error        text,
  message_id   text,
  sent_at      timestamptz not null default now()
);

create index if not exists email_sends_user_id_idx  on public.email_sends (user_id);
create index if not exists email_sends_campaign_idx on public.email_sends (campaign_id);
create index if not exists email_sends_sent_at_idx  on public.email_sends (user_id, sent_at);

-- Stops a retry from double-sending to the same prospect within a campaign.
create unique index if not exists email_sends_unique_ok
  on public.email_sends (campaign_id, prospect_id)
  where status = 'sent';

alter table public.email_accounts enable row level security;
alter table public.email_sends    enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['email_accounts', 'email_sends'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (auth.uid() = user_id) with check (auth.uid() = user_id)', t
    );
  end loop;
end $$;

-- Counts today's successful sends, for enforcing the daily cap. Runs as the
-- caller, so row level security still applies.
create or replace function public.sends_today()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::integer
  from public.email_sends
  where user_id = auth.uid()
    and status = 'sent'
    and sent_at >= date_trunc('day', now());
$$;
