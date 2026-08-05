import { createServerFn } from "@tanstack/react-start";

import { toProspect, toSettings, type ProspectRow, type SettingsRow } from "@/lib/db-types";
import type {
  EnqueueResult,
  Mailbox,
  MailboxInput,
  PoolSummary,
  QueueStats,
  ReplyCheckResult,
} from "@/lib/email-types";
import { buildHtmlBody, buildTextBody } from "@/lib/merge";
import { requireUser } from "@/server/auth";
import { getAppUrl, isLocalUrl } from "@/server/config";
import {
  remainingToday,
  toMailbox,
  type MailboxRow,
  type MailboxStatusRow,
} from "@/server/mailbox-rows";

type Client = Awaited<ReturnType<typeof requireUser>>["client"];

const QUEUE_STATUSES = ["queued", "sending", "sent", "failed", "skipped", "cancelled"] as const;

async function queueStats(client: Client, userId: string): Promise<QueueStats> {
  const counts = await Promise.all(
    QUEUE_STATUSES.map((s) =>
      client
        .from("send_queue")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", s),
    ),
  );
  const out = {} as QueueStats;
  QUEUE_STATUSES.forEach((s, i) => {
    out[s] = counts[i]?.count ?? 0;
  });
  return out;
}

async function loadPool(client: Client, userId: string): Promise<Mailbox[]> {
  const [{ data: rows, error }, { data: statuses }] = await Promise.all([
    client
      .from("email_accounts")
      .select("*")
      .eq("user_id", userId)
      // Ordered by address, not creation time: the table has no created_at
      // column. Display order only — rotation picks by remaining allowance.
      .order("from_email", { ascending: true })
      .returns<MailboxRow[]>(),
    client.from("mailbox_status").select("*").returns<MailboxStatusRow[]>(),
  ]);
  if (error) throw new Error(error.message);

  const byId = new Map((statuses ?? []).map((s) => [s.id, s]));
  return (rows ?? []).map((r) => toMailbox(r, byId.get(r.id)));
}

async function loadMailboxRow(client: Client, id: string): Promise<MailboxRow> {
  const { data, error } = await client
    .from("email_accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle<MailboxRow>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That mailbox no longer exists.");
  if (!data.smtp_password) throw new Error("This mailbox has no password saved.");
  if (!data.from_email) throw new Error("This mailbox has no From address saved.");
  return data;
}

/* ---------------------------------------------------------------- schema ---- */

/**
 * One probe per migration, in order. Each names a column or table that only
 * exists once that file has run, so the first failure identifies exactly which
 * migration is outstanding.
 */
const MIGRATION_PROBES: { file: string; table: string; column: string }[] = [
  { file: "supabase/schema.sql", table: "prospects", column: "id" },
  { file: "supabase/migrations/002_email.sql", table: "email_accounts", column: "smtp_host" },
  { file: "supabase/migrations/003_tracking.sql", table: "email_accounts", column: "imap_host" },
  {
    file: "supabase/migrations/004_sending_pool.sql",
    table: "email_accounts",
    column: "daily_limit",
  },
  { file: "supabase/migrations/004_sending_pool.sql", table: "send_queue", column: "id" },
  { file: "supabase/migrations/004_sending_pool.sql", table: "suppressions", column: "id" },
  { file: "supabase/migrations/004_sending_pool.sql", table: "mailbox_status", column: "id" },
];

export type SchemaStatus = { ok: boolean; missing: string | null; detail: string | null };

/**
 * Which migration still needs running, if any. PostgREST reports a missing
 * column as an opaque "schema cache" error, which reads like an app bug rather
 * than an un-run migration.
 */
export const getSchemaStatus = createServerFn({ method: "POST" }).handler(
  async (): Promise<SchemaStatus> => {
    const { client } = await requireUser();
    for (const probe of MIGRATION_PROBES) {
      const { error } = await client.from(probe.table).select(probe.column).limit(1);
      if (error) {
        return { ok: false, missing: probe.file, detail: error.message };
      }
    }
    return { ok: true, missing: null, detail: null };
  },
);

/* ------------------------------------------------------------------ pool ---- */

export const listMailboxes = createServerFn({ method: "POST" }).handler(async () => {
  const { client, user } = await requireUser();
  const mailboxes = await loadPool(client, user.id);
  const queue = await queueStats(client, user.id);

  const active = mailboxes.filter((m) => m.isActive && !m.pausedReason && m.hasPassword);
  const summary: PoolSummary = {
    mailboxes: mailboxes.length,
    activeMailboxes: active.length,
    capacityToday: active.reduce((n, m) => n + remainingToday(m), 0),
    sentToday: mailboxes.reduce((n, m) => n + m.sentToday, 0),
    queue,
  };

  return { mailboxes, summary, appUrlIsLocal: isLocalUrl(getAppUrl()) };
});

export const saveMailbox = createServerFn({ method: "POST" })
  .validator((d: MailboxInput) => {
    if (!d || typeof d !== "object") throw new Error("Invalid payload");
    const port = Number(d.smtpPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid SMTP port");
    const imapPort = Number(d.imapPort);
    if (!Number.isInteger(imapPort) || imapPort < 1 || imapPort > 65535) {
      throw new Error("Invalid IMAP port");
    }
    const limit = Number(d.dailyLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 2000) {
      throw new Error("Daily limit must be between 1 and 2000");
    }
    const delay = Number(d.sendDelayMs);
    if (!Number.isFinite(delay) || delay < 0 || delay > 60_000) throw new Error("Invalid delay");
    return { ...d, smtpPort: port, imapPort, dailyLimit: limit, sendDelayMs: Math.round(delay) };
  })
  .handler(async ({ data }) => {
    const { client, user } = await requireUser();

    const row: Record<string, unknown> = {
      user_id: user.id,
      provider: "smtp",
      label: data.label.trim() || data.fromEmail.trim(),
      from_name: data.fromName.trim(),
      from_email: data.fromEmail.trim(),
      reply_to: (data.replyTo || data.fromEmail).trim(),
      smtp_host: data.smtpHost.trim(),
      smtp_port: data.smtpPort,
      smtp_secure: data.smtpSecure,
      smtp_user: (data.smtpUser || data.fromEmail).trim(),
      imap_host: data.imapHost.trim(),
      imap_port: data.imapPort,
      imap_secure: data.imapSecure,
      send_delay_ms: data.sendDelayMs,
      daily_limit: data.dailyLimit,
      warmup_enabled: data.warmupEnabled,
      warmup_start_volume: data.warmupStartVolume,
      warmup_increment: data.warmupIncrement,
      is_active: data.isActive,
      updated_at: new Date().toISOString(),
    };
    // Blank means "keep what is stored", so host or port can be edited without
    // retyping the password.
    //
    // Trimmed because app passwords are almost always pasted, and a trailing
    // space or newline picked up from the clipboard is invisible in a password
    // field while failing authentication exactly like a wrong password.
    const pasted = data.smtpPassword.trim();
    if (pasted) row["smtp_password"] = pasted;

    if (data.id) {
      const { error } = await client
        .from("email_accounts")
        .update(row)
        .eq("id", data.id)
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    // Warmup starts the day the mailbox is added.
    row["warmup_started_on"] = new Date().toISOString().slice(0, 10);
    const { data: created, error } = await client
      .from("email_accounts")
      .insert(row)
      .select("id")
      .single<{ id: string }>();
    if (error) throw new Error(error.message);
    return { id: created.id };
  });

export const deleteMailbox = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => {
    if (!d?.id) throw new Error("Missing mailbox id");
    return d;
  })
  .handler(async ({ data }) => {
    const { client, user } = await requireUser();
    const { error } = await client
      .from("email_accounts")
      .delete()
      .eq("id", data.id)
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Clears a pause set automatically after repeated failures. */
export const resumeMailbox = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => {
    if (!d?.id) throw new Error("Missing mailbox id");
    return d;
  })
  .handler(async ({ data }) => {
    const { client, user } = await requireUser();
    const { error } = await client
      .from("email_accounts")
      .update({ paused_reason: null, consecutive_failures: 0 })
      .eq("id", data.id)
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const verifyMailbox = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => {
    if (!d?.id) throw new Error("Missing mailbox id");
    return d;
  })
  .handler(async ({ data }) => {
    const { client } = await requireUser();
    const row = await loadMailboxRow(client, data.id);

    const { createTransport, friendlySmtpError } = await import("@/server/mailer");
    const transport = createTransport({
      host: row.smtp_host,
      port: row.smtp_port,
      secure: row.smtp_secure,
      user: row.smtp_user,
      password: row.smtp_password,
    });

    try {
      await transport.verify();
      await client
        .from("email_accounts")
        .update({ verified_at: new Date().toISOString(), paused_reason: null })
        .eq("id", row.id);
      return { ok: true as const };
    } catch (err) {
      // Name the mailbox and server: with a pool, an error that says only
      // "rejected" leaves you unable to tell which mailbox was even tested.
      throw new Error(
        `${row.smtp_user} via ${row.smtp_host}:${row.smtp_port} — ${friendlySmtpError(err, row.smtp_host)}`,
      );
    } finally {
      transport.close();
    }
  });

export const sendTestEmail = createServerFn({ method: "POST" })
  .validator((d: { id: string; to: string }) => {
    if (!d?.id) throw new Error("Missing mailbox id");
    if (!d?.to || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.to.trim())) {
      throw new Error("Enter a valid destination address");
    }
    return { id: d.id, to: d.to.trim() };
  })
  .handler(async ({ data }) => {
    const { client } = await requireUser();
    const row = await loadMailboxRow(client, data.id);

    const { data: settingsRow } = await client
      .from("settings")
      .select("*")
      .maybeSingle<SettingsRow>();
    const settings = settingsRow ? toSettings(settingsRow) : null;

    const { createTransport, friendlySmtpError } = await import("@/server/mailer");
    const transport = createTransport({
      host: row.smtp_host,
      port: row.smtp_port,
      secure: row.smtp_secure,
      user: row.smtp_user,
      password: row.smtp_password,
    });

    const opts = {
      body:
        `This is a test from Outreach Console, sent through ${row.from_email}.\n\n` +
        "If it arrived, this mailbox is ready to join the sending pool.",
      signature: settings?.signature ?? "",
      replyTo: row.reply_to || row.from_email,
    };

    try {
      const info = await transport.sendMail({
        from: `"${row.from_name || "Outreach Console"}" <${row.from_email}>`,
        replyTo: row.reply_to || row.from_email,
        to: data.to,
        subject: "Outreach Console — test message",
        text: buildTextBody(opts),
        html: buildHtmlBody(opts),
      });
      return { ok: true as const, messageId: info.messageId };
    } catch (err) {
      throw new Error(friendlySmtpError(err, row.smtp_host));
    } finally {
      transport.close();
    }
  });

/* ----------------------------------------------------------------- queue ---- */

export const enqueueCampaign = createServerFn({ method: "POST" })
  .validator((d: { campaignId: string; templateId: string; prospectIds: string[] }) => {
    if (!d?.campaignId || !d?.templateId) throw new Error("Missing campaign or template");
    if (!Array.isArray(d.prospectIds) || d.prospectIds.length === 0) {
      throw new Error("No recipients supplied");
    }
    if (d.prospectIds.length > 100_000) throw new Error("Too many recipients in one campaign");
    return d;
  })
  .handler(async ({ data }): Promise<EnqueueResult> => {
    const { client, user } = await requireUser();

    const { data: prospectRows, error } = await client
      .from("prospects")
      .select("*")
      .in("id", data.prospectIds)
      .returns<ProspectRow[]>();
    if (error) throw new Error(error.message);

    const prospects = (prospectRows ?? []).map(toProspect);
    const emails = prospects.map((p) => p.email.toLowerCase());

    const { data: suppressedRows } = await client
      .from("suppressions")
      .select("email")
      .eq("user_id", user.id)
      .in("email", emails)
      .returns<{ email: string }[]>();
    const suppressed = new Set((suppressedRows ?? []).map((s) => s.email.toLowerCase()));

    let suppressedCount = 0;
    const rows = prospects
      .filter((p) => {
        if (p.status === "unsubscribed" || suppressed.has(p.email.toLowerCase())) {
          suppressedCount += 1;
          return false;
        }
        return true;
      })
      .map((p) => ({
        user_id: user.id,
        campaign_id: data.campaignId,
        prospect_id: p.id,
        template_id: data.templateId,
        to_email: p.email,
      }));

    let queued = 0;
    // Chunked so a large list does not exceed the request size limit.
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { data: inserted, error: insertError } = await client
        .from("send_queue")
        .upsert(chunk, { onConflict: "campaign_id,prospect_id", ignoreDuplicates: true })
        .select("id");
      if (insertError) throw new Error(insertError.message);
      queued += inserted?.length ?? 0;
    }

    const pool = await loadPool(client, user.id);
    const capacityToday = pool
      .filter((m) => m.isActive && !m.pausedReason && m.hasPassword)
      .reduce((n, m) => n + remainingToday(m), 0);

    return {
      queued,
      suppressed: suppressedCount,
      duplicates: rows.length - queued,
      capacityToday,
      estimatedDays: capacityToday > 0 ? Math.ceil(queued / capacityToday) : 0,
    };
  });

/**
 * Sends one slice of the queue. The browser calls this in a loop for immediate
 * sends; the worker calls the same engine unattended for large runs.
 */
export const processQueue = createServerFn({ method: "POST" })
  .validator((d: { max?: number } | undefined) => ({
    max: Math.min(Math.max(Number(d?.max ?? 20), 1), 50),
  }))
  .handler(async ({ data }) => {
    const { client, user } = await requireUser();
    const { drainQueue } = await import("@/server/send-engine");
    return drainQueue(client, user.id, { max: data.max, appUrl: getAppUrl() });
  });

export const cancelCampaign = createServerFn({ method: "POST" })
  .validator((d: { campaignId: string }) => {
    if (!d?.campaignId) throw new Error("Missing campaign id");
    return d;
  })
  .handler(async ({ data }) => {
    const { client, user } = await requireUser();
    const { error, count } = await client
      .from("send_queue")
      .update({ status: "cancelled", error: "Cancelled" }, { count: "exact" })
      .eq("user_id", user.id)
      .eq("campaign_id", data.campaignId)
      .in("status", ["queued", "sending"]);
    if (error) throw new Error(error.message);
    return { cancelled: count ?? 0 };
  });

export const getQueueStatus = createServerFn({ method: "POST" }).handler(async () => {
  const { client, user } = await requireUser();
  return queueStats(client, user.id);
});

export type CampaignProgress = {
  campaignId: string;
  sent: number;
  failed: number;
  queued: number;
  skipped: number;
};

/**
 * Real per-campaign progress, from the send log and the queue rather than from
 * campaign_recipients — which only gains rows as messages actually go out, so a
 * campaign waiting on capacity would otherwise read as a total failure.
 */
export const getCampaignProgress = createServerFn({ method: "POST" }).handler(async () => {
  const { client, user } = await requireUser();

  const [sends, queue] = await Promise.all([
    client
      .from("email_sends")
      .select("campaign_id,status")
      .eq("user_id", user.id)
      .returns<{ campaign_id: string | null; status: string }[]>(),
    client
      .from("send_queue")
      .select("campaign_id,status")
      .eq("user_id", user.id)
      .returns<{ campaign_id: string; status: string }[]>(),
  ]);

  const byId = new Map<string, CampaignProgress>();
  const row = (id: string) => {
    let r = byId.get(id);
    if (!r) {
      r = { campaignId: id, sent: 0, failed: 0, queued: 0, skipped: 0 };
      byId.set(id, r);
    }
    return r;
  };

  for (const s of sends.data ?? []) {
    if (!s.campaign_id) continue;
    const r = row(s.campaign_id);
    if (s.status === "sent") r.sent += 1;
    else if (s.status === "failed") r.failed += 1;
  }

  // Anything still waiting or mid-flight counts as outstanding work.
  for (const q of queue.data ?? []) {
    const r = row(q.campaign_id);
    if (q.status === "queued" || q.status === "sending") r.queued += 1;
    else if (q.status === "skipped" || q.status === "cancelled") r.skipped += 1;
  }

  return [...byId.values()];
});

/* -------------------------------------------------------- deliverability ---- */

export type { DomainAuthReport } from "@/server/dns-check";

/**
 * Checks SPF, DKIM and DMARC for the sending domain. These decide whether a
 * message is trusted at all, and a misconfiguration is otherwise invisible from
 * inside the app.
 */
export const checkDeliverability = createServerFn({ method: "POST" })
  .validator((d: { domain?: string } | undefined) => ({ domain: d?.domain?.trim() ?? "" }))
  .handler(async ({ data }) => {
    const { client, user } = await requireUser();

    let domain = data.domain;
    if (!domain) {
      const { data: rows } = await client
        .from("email_accounts")
        .select("from_email")
        .eq("user_id", user.id)
        .limit(1)
        .returns<{ from_email: string }[]>();
      domain = rows?.[0]?.from_email?.split("@")[1] ?? "";
    }
    if (!domain) throw new Error("Add a mailbox first so there is a domain to check.");

    const { checkDomainAuth } = await import("@/server/dns-check");
    return checkDomainAuth(domain);
  });

/* --------------------------------------------------------------- replies ---- */

/**
 * Scans every active mailbox for replies and bounces. IONOS has no inbound
 * webhook, so this is a manual pull rather than a push.
 */
export const checkReplies = createServerFn({ method: "POST" }).handler(
  async (): Promise<ReplyCheckResult> => {
    const { client, user } = await requireUser();
    const { data: rows } = await client
      .from("email_accounts")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .returns<MailboxRow[]>();

    const mailboxes = (rows ?? []).filter((r) => r.smtp_password && r.imap_host);
    if (mailboxes.length === 0) throw new Error("No active mailbox with credentials to scan.");

    const { fetchRecentSenders, fetchBouncedAddresses, friendlyImapError } =
      await import("@/server/imap");

    let oldest = new Date();
    let scanned = 0;
    const senders = new Map<string, Date>();
    const bounced = new Set<string>();

    for (const row of mailboxes) {
      const since = row.last_reply_check
        ? new Date(row.last_reply_check)
        : new Date(Date.now() - 30 * 86_400_000);
      if (since < oldest) oldest = since;

      const cfg = {
        host: row.imap_host,
        port: row.imap_port,
        secure: row.imap_secure,
        user: row.smtp_user,
        password: row.smtp_password,
      };

      try {
        const incoming = await fetchRecentSenders(cfg, since);
        scanned += incoming.length;
        for (const m of incoming) {
          const prev = senders.get(m.email);
          if (!prev || m.at < prev) senders.set(m.email, m.at);
        }
        for (const addr of await fetchBouncedAddresses(cfg, since)) bounced.add(addr);
      } catch (err) {
        throw new Error(`${row.from_email}: ${friendlyImapError(err, row.imap_host)}`);
      }

      await client
        .from("email_accounts")
        .update({ last_reply_check: new Date().toISOString() })
        .eq("id", row.id);
    }

    let matched = 0;
    for (const [email, at] of senders) {
      if (bounced.has(email)) continue;
      const { data: hit } = await client.rpc("record_reply", {
        p_email: email,
        p_at: at.toISOString(),
      });
      if (hit === true) matched += 1;
    }

    // A bounced address never receives anything again.
    for (const email of bounced) {
      await client
        .from("suppressions")
        .insert({ user_id: user.id, email, reason: "hard_bounce", detail: "Bounce message" })
        .then(
          () => undefined,
          () => undefined,
        );
      await client
        .from("send_queue")
        .update({ status: "cancelled", error: "Address bounced" })
        .eq("user_id", user.id)
        .eq("to_email", email)
        .in("status", ["queued", "sending"]);
    }

    return { scanned, matched, bounces: bounced.size, since: oldest.toISOString() };
  },
);
