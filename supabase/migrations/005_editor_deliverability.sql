-- Outreach Console — rich templates, deliverability mode, Sent-folder copies
--
-- Run after 004_sending_pool.sql. Idempotent.

-- ========================================================== rich templates ====

-- Rich body. `body` stays the plain-text version and remains the source of
-- truth for the text/plain part, so a template still works with no HTML at all.
alter table public.templates add column if not exists body_html text not null default '';

-- ======================================================= deliverability ====

-- Gmail sorts on signals, not content quality. A remote image, an
-- https List-Unsubscribe with One-Click, and styled HTML are three of the
-- strongest Promotions signals there are. Plain mode drops all three, at the
-- cost of open tracking.
alter table public.settings add column if not exists plain_text_mode boolean not null default true;
-- Off by default: the pixel is the single biggest Promotions trigger.
alter table public.settings add column if not exists track_opens boolean not null default false;
-- Appended to the text body when set, so recipients always have a way out.
alter table public.settings add column if not exists unsubscribe_text text not null default
  'If you would rather not hear from me, unsubscribe here: {{unsubscribe}}';

-- ===================================================== sent folder copies ====

-- SMTP only hands a message to the server for delivery; it never files a copy
-- in the mailbox. Without an explicit IMAP APPEND, nothing appears in Sent.
alter table public.email_accounts add column if not exists save_to_sent boolean not null default true;
-- IONOS uses "Sent", Gmail uses "[Gmail]/Sent Mail", others vary.
alter table public.email_accounts add column if not exists sent_folder text not null default 'Sent';

-- ============================================================ send history ====

-- Lets the UI show what actually left, independent of campaign_recipients.
create index if not exists email_sends_user_sent_idx on public.email_sends (user_id, sent_at desc);
