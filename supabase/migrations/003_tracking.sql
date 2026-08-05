-- Outreach Console — open tracking, one-click unsubscribe, reply detection
--
-- Run after 002_email.sql. Idempotent, so re-running is safe.

-- ------------------------------------------------------------- send rows ----

-- The token is the only thing that appears in a public URL. It is random and
-- unguessable, so it identifies one delivery without exposing user or
-- prospect ids to the outside world.
alter table public.email_sends
  add column if not exists track_token uuid not null default gen_random_uuid();
alter table public.email_sends add column if not exists opened_at       timestamptz;
alter table public.email_sends add column if not exists open_count      integer not null default 0;
alter table public.email_sends add column if not exists replied_at      timestamptz;
alter table public.email_sends add column if not exists unsubscribed_at timestamptz;

create unique index if not exists email_sends_track_token_idx on public.email_sends (track_token);
create index if not exists email_sends_to_email_idx on public.email_sends (user_id, to_email);

-- --------------------------------------------------------- imap settings ----

alter table public.email_accounts add column if not exists imap_host text not null default 'imap.ionos.com';
alter table public.email_accounts add column if not exists imap_port integer not null default 993;
alter table public.email_accounts add column if not exists imap_secure boolean not null default true;
alter table public.email_accounts add column if not exists last_reply_check timestamptz;

-- ------------------------------------------------------ public callbacks ----

-- These two run as the definer so an anonymous recipient — who has no session
-- and no row level security context — can still register an open or an
-- unsubscribe. Both are scoped strictly by the random token, and neither
-- returns any user data.

create or replace function public.record_open(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
begin
  select user_id, campaign_id, prospect_id into s
  from public.email_sends where track_token = p_token;

  if not found then return; end if;

  update public.email_sends
     set opened_at  = coalesce(opened_at, now()),
         open_count = open_count + 1
   where track_token = p_token;

  -- Mirror onto the row the dashboard reads.
  if s.campaign_id is not null and s.prospect_id is not null then
    update public.campaign_recipients
       set opened = true
     where campaign_id = s.campaign_id
       and prospect_id = s.prospect_id;
  end if;
end $$;

create or replace function public.record_unsubscribe(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
begin
  select user_id, prospect_id into s
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

  return true;
end $$;

-- Anonymous recipients clicking a link in an email have no session.
revoke all on function public.record_open(uuid) from public;
revoke all on function public.record_unsubscribe(uuid) from public;
grant execute on function public.record_open(uuid) to anon, authenticated;
grant execute on function public.record_unsubscribe(uuid) to anon, authenticated;

-- ------------------------------------------------------------ reply sync ----

-- Called after an IMAP scan finds a reply from `p_email`. Marks the most recent
-- delivery to that address as replied and mirrors it onto the campaign row.
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

  return true;
end $$;

grant execute on function public.record_reply(text, timestamptz) to authenticated;
