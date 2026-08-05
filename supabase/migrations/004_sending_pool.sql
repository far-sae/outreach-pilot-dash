-- Outreach Console — mailbox pool, send queue, suppression list
--
-- Turns the single mailbox into a rotating pool with per-mailbox daily caps and
-- warmup, and moves sending onto a queue a background worker drains. Run after
-- 003_tracking.sql. Idempotent.

-- ====================================================== mailboxes as a pool ====

-- email_accounts was one row per user, keyed by user_id. It becomes many rows
-- per user, keyed by its own id.
alter table public.email_accounts add column if not exists id uuid not null default gen_random_uuid();

do $$
begin
  -- Only swap the primary key if it is still the original one on user_id.
  if exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.email_accounts'::regclass
      and c.contype = 'p' and a.attname = 'user_id'
  ) then
    alter table public.email_accounts drop constraint email_accounts_pkey;
    alter table public.email_accounts add constraint email_accounts_pkey primary key (id);
  end if;
end $$;

create index if not exists email_accounts_user_idx on public.email_accounts (user_id);

alter table public.email_accounts add column if not exists label text not null default '';
-- The ceiling once warmup finishes. 40/day/mailbox is a conservative cold-
-- outreach figure; provider limits are usually higher but reputation is not.
alter table public.email_accounts add column if not exists daily_limit integer not null default 40;
alter table public.email_accounts add column if not exists warmup_enabled boolean not null default true;
alter table public.email_accounts add column if not exists warmup_started_on date;
alter table public.email_accounts add column if not exists warmup_start_volume integer not null default 5;
alter table public.email_accounts add column if not exists warmup_increment integer not null default 3;
alter table public.email_accounts add column if not exists is_active boolean not null default true;
-- Set automatically when a mailbox trips the failure threshold.
alter table public.email_accounts add column if not exists paused_reason text;
alter table public.email_accounts add column if not exists consecutive_failures integer not null default 0;
alter table public.email_accounts add column if not exists last_sent_at timestamptz;

alter table public.email_sends add column if not exists account_id uuid
  references public.email_accounts (id) on delete set null;
create index if not exists email_sends_account_idx on public.email_sends (account_id, sent_at);

-- ============================================================= suppressions ====

-- Never mail these addresses again, whatever a campaign says.
create table if not exists public.suppressions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  email       text not null,
  reason      text not null check (reason in ('unsubscribed', 'hard_bounce', 'complaint', 'manual')),
  detail      text,
  created_at  timestamptz not null default now()
);

create unique index if not exists suppressions_unique
  on public.suppressions (user_id, lower(email));

-- ================================================================ the queue ====

create table if not exists public.send_queue (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  campaign_id   text not null,
  prospect_id   text not null,
  template_id   text not null,
  to_email      text not null,
  status        text not null default 'queued'
                check (status in ('queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled')),
  attempts      integer not null default 0,
  max_attempts  integer not null default 3,
  account_id    uuid references public.email_accounts (id) on delete set null,
  error         text,
  scheduled_at  timestamptz not null default now(),
  locked_at     timestamptz,
  created_at    timestamptz not null default now()
);

-- One queue entry per prospect per campaign, so enqueueing twice is harmless.
create unique index if not exists send_queue_unique on public.send_queue (campaign_id, prospect_id);
create index if not exists send_queue_ready_idx
  on public.send_queue (user_id, status, scheduled_at);

-- ============================================================ mailbox state ====

-- Effective limit today, accounting for warmup ramp, alongside what has already
-- gone out. The worker picks mailboxes from here.
create or replace view public.mailbox_status as
select
  a.id,
  a.user_id,
  a.label,
  a.from_email,
  a.is_active,
  a.paused_reason,
  a.consecutive_failures,
  a.last_sent_at,
  a.daily_limit,
  a.warmup_enabled,
  a.warmup_started_on,
  case
    when not a.warmup_enabled then a.daily_limit
    when a.warmup_started_on is null then a.warmup_start_volume
    else least(
      a.daily_limit,
      a.warmup_start_volume + a.warmup_increment * (current_date - a.warmup_started_on)
    )
  end as effective_limit,
  (
    select count(*)::integer from public.email_sends s
    where s.account_id = a.id
      and s.status = 'sent'
      and s.sent_at >= date_trunc('day', now())
  ) as sent_today
from public.email_accounts a;

-- Without this the view would run as its owner and bypass row level security.
alter view public.mailbox_status set (security_invoker = on);

-- ============================================================ claim + queue ====

-- Atomically reserve queue rows for one mailbox. `skip locked` lets several
-- workers drain the same queue without handing the same row to two of them.
create or replace function public.claim_queue_items(p_account uuid, p_limit integer)
returns setof public.send_queue
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  update public.send_queue q
     set status = 'sending',
         locked_at = now(),
         account_id = p_account,
         attempts = q.attempts + 1
   where q.id in (
     select inner_q.id
       from public.send_queue inner_q
      where inner_q.user_id = auth.uid()
        and inner_q.status = 'queued'
        and inner_q.scheduled_at <= now()
      order by inner_q.created_at
      limit p_limit
      for update skip locked
   )
  returning q.*;
end $$;

-- Releases rows a worker claimed but never finished — a crash mid-batch would
-- otherwise strand them in 'sending' forever.
create or replace function public.requeue_stale(p_older_than_minutes integer default 15)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  update public.send_queue
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         locked_at = null
   where user_id = auth.uid()
     and status = 'sending'
     and locked_at < now() - make_interval(mins => p_older_than_minutes);
  get diagnostics n = row_count;
  return n;
end $$;

-- ====================================================== row level security ====

alter table public.suppressions enable row level security;
alter table public.send_queue   enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['suppressions', 'send_queue'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (auth.uid() = user_id) with check (auth.uid() = user_id)', t
    );
  end loop;
end $$;

grant execute on function public.claim_queue_items(uuid, integer) to authenticated, service_role;
grant execute on function public.requeue_stale(integer) to authenticated, service_role;

-- The background worker has no session, so auth.uid() is null for it. This is
-- the same claim keyed by an explicit user id, reachable only by service_role.
create or replace function public.claim_queue_for_user(
  p_user uuid, p_account uuid, p_limit integer
)
returns setof public.send_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.send_queue q
     set status = 'sending',
         locked_at = now(),
         account_id = p_account,
         attempts = q.attempts + 1
   where q.id in (
     select inner_q.id
       from public.send_queue inner_q
      where inner_q.user_id = p_user
        and inner_q.status = 'queued'
        and inner_q.scheduled_at <= now()
      order by inner_q.created_at
      limit p_limit
      for update skip locked
   )
  returning q.*;
end $$;

revoke all on function public.claim_queue_for_user(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_queue_for_user(uuid, uuid, integer) to service_role;

-- Users with work waiting, so the worker knows whose queues to drain.
create or replace function public.users_with_queued()
returns table (user_id uuid)
language sql
security definer
set search_path = public
as $$
  select distinct q.user_id from public.send_queue q
  where q.status = 'queued' and q.scheduled_at <= now();
$$;

revoke all on function public.users_with_queued() from public, anon, authenticated;
grant execute on function public.users_with_queued() to service_role;

-- Worker-side recovery for rows stranded in 'sending' by a crashed run.
create or replace function public.requeue_stale_all(p_older_than_minutes integer default 15)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.send_queue
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         locked_at = null
   where status = 'sending'
     and locked_at < now() - make_interval(mins => p_older_than_minutes);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.requeue_stale_all(integer) from public, anon, authenticated;
grant execute on function public.requeue_stale_all(integer) to service_role;

-- ------------------------------------------------- unsubscribe -> suppression --

-- Recipients who unsubscribe must land on the suppression list, not only have
-- their prospect row flipped: the same address can appear more than once.
create or replace function public.record_unsubscribe(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
begin
  select user_id, prospect_id, to_email into s
  from public.email_sends where track_token = p_token;

  if not found then return false; end if;

  update public.email_sends set unsubscribed_at = coalesce(unsubscribed_at, now())
   where track_token = p_token;

  if s.prospect_id is not null then
    update public.prospects
       set status = 'unsubscribed'
     where id = s.prospect_id
       and user_id = s.user_id;
  end if;

  insert into public.suppressions (user_id, email, reason)
  values (s.user_id, lower(s.to_email), 'unsubscribed')
  on conflict do nothing;

  -- Stop anything already queued for that address.
  update public.send_queue
     set status = 'cancelled', error = 'Recipient unsubscribed'
   where user_id = s.user_id
     and lower(to_email) = lower(s.to_email)
     and status in ('queued', 'sending');

  return true;
end $$;

grant execute on function public.record_unsubscribe(uuid) to anon, authenticated;
