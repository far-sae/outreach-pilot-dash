-- Outreach Console — rich signature/footer, unsubscribe removes the prospect
--
-- Run after 005_editor_deliverability.sql. Idempotent.

-- ===================================================== rich signature/footer ====

alter table public.settings add column if not exists signature_html text not null default '';
alter table public.settings add column if not exists unsubscribe_html text not null default '';

-- ======================================================== unsubscribe = delete ==

-- Deletes the prospect outright rather than flagging them.
--
-- The suppression row is what actually protects the recipient, and it must
-- survive: deleting the prospect alone would let the same address back in
-- through the next CSV import and be mailed again. Suppressions are checked at
-- enqueue and again at send, so the address stays permanently unreachable even
-- with no prospect record.
--
-- campaign_recipients deliberately has no foreign key to prospects, so sent
-- history survives the delete and reporting stays accurate.
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

  -- Suppress first: if anything below fails, the address is still protected.
  insert into public.suppressions (user_id, email, reason, detail)
  values (s.user_id, lower(s.to_email), 'unsubscribed', 'Removed via unsubscribe link')
  on conflict do nothing;

  update public.send_queue
     set status = 'cancelled', error = 'Recipient unsubscribed'
   where user_id = s.user_id
     and lower(to_email) = lower(s.to_email)
     and status in ('queued', 'sending');

  -- Every prospect row with that address, not just the one mailed — the same
  -- person can appear more than once across imports.
  delete from public.prospects
   where user_id = s.user_id
     and lower(email) = lower(s.to_email);

  return true;
end $$;

grant execute on function public.record_unsubscribe(uuid) to anon, authenticated;

-- Removes anyone already on the suppression list from prospects, so the rule
-- applies to people who unsubscribed before this change.
delete from public.prospects p
 using public.suppressions s
 where s.user_id = p.user_id
   and lower(s.email) = lower(p.email);
