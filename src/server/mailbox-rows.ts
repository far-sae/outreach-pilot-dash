// Row shapes for the mailbox pool and queue, plus mapping to the UI types.
// Imported by both the server functions and the standalone send worker.

import type { Mailbox } from "@/lib/email-types";

export type MailboxRow = {
  id: string;
  user_id: string;
  label: string;
  from_name: string;
  from_email: string;
  reply_to: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  send_delay_ms: number;
  daily_limit: number;
  warmup_enabled: boolean;
  warmup_started_on: string | null;
  warmup_start_volume: number;
  warmup_increment: number;
  is_active: boolean;
  paused_reason: string | null;
  consecutive_failures: number;
  last_sent_at: string | null;
  verified_at: string | null;
  last_reply_check: string | null;
  save_to_sent: boolean;
  sent_folder: string;
};

/** The mailbox_status view: a mailbox plus today's computed allowance and usage. */
export type MailboxStatusRow = {
  id: string;
  effective_limit: number;
  sent_today: number;
};

export type QueueRow = {
  id: string;
  user_id: string;
  campaign_id: string;
  prospect_id: string;
  template_id: string;
  to_email: string;
  status: string;
  attempts: number;
  max_attempts: number;
  account_id: string | null;
  error: string | null;
  sequence_id: string | null;
  step_id: string | null;
  step_position: number;
};

export type SequenceStepRow = {
  id: string;
  sequence_id: string;
  user_id: string;
  position: number;
  template_id: string | null;
  delay_days: number;
};

export function toMailbox(r: MailboxRow, status?: MailboxStatusRow): Mailbox {
  return {
    id: r.id,
    label: r.label,
    fromName: r.from_name,
    fromEmail: r.from_email,
    replyTo: r.reply_to,
    smtpHost: r.smtp_host,
    smtpPort: r.smtp_port,
    smtpSecure: r.smtp_secure,
    smtpUser: r.smtp_user,
    imapHost: r.imap_host,
    imapPort: r.imap_port,
    imapSecure: r.imap_secure,
    sendDelayMs: r.send_delay_ms,
    dailyLimit: r.daily_limit,
    warmupEnabled: r.warmup_enabled,
    warmupStartedOn: r.warmup_started_on,
    warmupStartVolume: r.warmup_start_volume,
    warmupIncrement: r.warmup_increment,
    isActive: r.is_active,
    pausedReason: r.paused_reason,
    consecutiveFailures: r.consecutive_failures,
    hasPassword: Boolean(r.smtp_password),
    verifiedAt: r.verified_at,
    lastReplyCheck: r.last_reply_check,
    effectiveLimit: status?.effective_limit ?? 0,
    sentToday: status?.sent_today ?? 0,
  };
}

/** Today's remaining allowance for a mailbox, never negative. */
export function remainingToday(m: { effectiveLimit: number; sentToday: number }) {
  return Math.max(0, m.effectiveLimit - m.sentToday);
}

export const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

/**
 * Mailboxes that may send right now, interleaved across domains.
 *
 * Reputation is tracked per domain, not per mailbox, so draining three
 * mailboxes on one domain before touching the next concentrates the day's
 * volume onto a single reputation. Round-robin over domains spreads it, and
 * within each domain the most idle mailbox goes first so usage stays even.
 */
export function sendableMailboxes<T extends Mailbox>(all: T[]): T[] {
  const usable = all
    .filter((m) => m.isActive && !m.pausedReason && m.hasPassword && remainingToday(m) > 0)
    .sort((a, b) => remainingToday(b) - remainingToday(a));

  const byDomain = new Map<string, T[]>();
  for (const m of usable) {
    const domain = domainOf(m.fromEmail);
    const list = byDomain.get(domain);
    if (list) list.push(m);
    else byDomain.set(domain, [m]);
  }

  // Domains with the most headroom lead, then one mailbox from each in turn.
  const groups = [...byDomain.values()].sort(
    (a, b) =>
      b.reduce((n, m) => n + remainingToday(m), 0) - a.reduce((n, m) => n + remainingToday(m), 0),
  );

  const out: T[] = [];
  for (let i = 0; out.length < usable.length; i += 1) {
    for (const group of groups) {
      const next = group[i];
      if (next) out.push(next);
    }
  }
  return out;
}
