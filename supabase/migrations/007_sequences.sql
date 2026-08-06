-- Outreach Console — follow-up sequences, sending windows, bounce protection
--
-- Run after 006_unsubscribe_delete.sql. Idempotent.

-- ============================================================== sequences ====

-- A named series of emails sent to the same prospect over days. Most replies to
-- cold outreach come from the second and third message, not the first.
create table if not exists public.sequences (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  -- Stop sending later steps once the prospect replies. Off makes the sequence
  -- keep mailing someone who already answered, which is the fastest way to a
  -- spam complaint.
  stop_on_reply boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.sequence_steps (
  id           text primary key,
  sequence_id  text not null references public.sequences (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- 0-based order within the sequence.
  position     integer not null default 0,
  template_id  text references public.templates (id) on delete set null,
  -- Days to wait after the previous step. 0 for the first step.
  delay_days   integer not null default 3,
  created_at   timestamptz not null default now()
);

create index if not exists sequences_user_idx on public.sequences (user_id);
create index if not exists sequence_steps_seq_idx on public.sequence_steps (sequence_id, position);

-- A campaign either sends one template or runs a sequence.
alter table public.campaigns add column if not exists sequence_id text
  references public.sequences (id) on delete set null;

-- Queue rows remember which step produced them, so the engine can schedule the
-- next one after a successful send.
alter table public.send_queue add column if not exists sequence_id text;
alter table public.send_queue add column if not exists step_id text;
alter table public.send_queue add column if not exists step_position integer not null default 0;

-- The unique index on (campaign_id, prospect_id) would allow only one message
-- per prospect per campaign, which makes follow-ups impossible.
drop index if exists send_queue_unique;
create unique index if not exists send_queue_unique
  on public.send_queue (campaign_id, prospect_id, step_position);

-- Same for the send log: a prospect legitimately receives several messages in
-- one campaign now.
drop index if exists email_sends_unique_ok;
alter table public.email_sends add column if not exists step_position integer not null default 0;
create unique index if not exists email_sends_unique_ok
  on public.email_sends (campaign_id, prospect_id, step_position)
  where status = 'sent';

-- ========================================================= sending windows ====

-- Mail arriving at 03:00 reads as automated. Restricting sends to working hours
-- is a real deliverability signal and costs nothing.
alter table public.settings add column if not exists send_window_enabled boolean not null default true;
alter table public.settings add column if not exists send_window_start integer not null default 8;
alter table public.settings add column if not exists send_window_end integer not null default 18;
-- ISO weekdays permitted, 1 = Monday. Weekends excluded by default.
alter table public.settings add column if not exists send_days integer[] not null default '{1,2,3,4,5}';
-- IANA name, e.g. Europe/London. Windows are evaluated in this zone.
alter table public.settings add column if not exists send_timezone text not null default 'Europe/London';

-- ======================================================= bounce protection ====

-- Above roughly 2% hard bounces, providers begin throttling. Pausing the
-- mailbox automatically stops the damage before a human notices.
alter table public.settings add column if not exists max_bounce_rate numeric not null default 2.0;
alter table public.settings add column if not exists min_sends_before_pause integer not null default 20;

-- Hard-bounce rate for one mailbox today, as a percentage of its sends.
create or replace function public.mailbox_bounce_rate(p_account uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when count(*) = 0 then 0
    else round(100.0 * count(*) filter (where status = 'failed') / count(*), 2)
  end
  from public.email_sends
  where account_id = p_account
    and user_id = auth.uid()
    and sent_at >= date_trunc('day', now());
$$;

grant execute on function public.mailbox_bounce_rate(uuid) to authenticated, service_role;

-- ========================================================== stop on reply ====

-- Cancels everything still queued for an address, used when they reply or
-- unsubscribe. Replaces the per-campaign cancel, since a sequence spans steps.
create or replace function public.cancel_queued_for_email(p_email text, p_reason text)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  update public.send_queue
     set status = 'cancelled', error = p_reason
   where user_id = auth.uid()
     and lower(to_email) = lower(p_email)
     and status in ('queued', 'sending');
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.cancel_queued_for_email(text, text) to authenticated, service_role;

-- record_reply now also stops the sequence for that prospect.
create or replace function public.record_reply(p_email text, p_at timestamptz)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  s record;
begin
  select track_token, campaign_id, prospect_id into s
  from public.email_sends
  where user_id = auth.uid()
    and lower(to_email) = lower(p_email)
    and status = 'sent'
    and sent_at <= p_at
  order by sent_at desc
  limit 1;

  if not found then return false; end if;

  update public.email_sends set replied_at = coalesce(replied_at, p_at)
   where track_token = s.track_token;

  if s.campaign_id is not null and s.prospect_id is not null then
    update public.campaign_recipients
       set replied = true
     where campaign_id = s.campaign_id
       and prospect_id = s.prospect_id;
  end if;

  -- Someone who answered must not receive the rest of the sequence.
  perform public.cancel_queued_for_email(p_email, 'Prospect replied');

  return true;
end $$;

grant execute on function public.record_reply(text, timestamptz) to authenticated;

-- ================================================================ RLS ========

alter table public.sequences      enable row level security;
alter table public.sequence_steps enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['sequences', 'sequence_steps'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (auth.uid() = user_id) with check (auth.uid() = user_id)', t
    );
  end loop;
end $$;

-- =========================================================== analytics ======

-- Reply and bounce rates per template and per group, so copy and segments can
-- be compared rather than guessed at.
create or replace view public.template_performance as
select
  t.id            as template_id,
  t.user_id,
  t.name          as template_name,
  count(s.id)::integer                                              as sent,
  count(s.replied_at)::integer                                      as replied,
  case when count(s.id) = 0 then 0
       else round(100.0 * count(s.replied_at) / count(s.id), 1) end as reply_rate
from public.templates t
left join public.send_queue q on q.template_id = t.id
left join public.email_sends s
       on s.campaign_id = q.campaign_id
      and s.prospect_id = q.prospect_id
      and s.status = 'sent'
group by t.id, t.user_id, t.name;

alter view public.template_performance set (security_invoker = on);
