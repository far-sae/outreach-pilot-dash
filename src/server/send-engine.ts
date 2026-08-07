// The queue drain. Called two ways: by a server function when the browser
// pushes a campaign along, and by the standalone worker on a loop. Both share
// this so rotation, caps, warmup, and suppression can only be implemented once.

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toProspect, toSettings, toTemplate } from "@/lib/db-types";
import type { ProspectRow, SettingsRow, TemplateRow } from "@/lib/db-types";
import type { Options as MailOptions } from "nodemailer/lib/mailer";

import { buildHtmlBody, buildTextBody, mergeCopy, type BodyOptions } from "@/lib/merge";
import { describeSendWindow, isWithinSendWindow } from "@/lib/send-window";
import {
  remainingToday,
  sendableMailboxes,
  toMailbox,
  type MailboxRow,
  type MailboxStatusRow,
  type QueueRow,
  type SequenceStepRow,
} from "@/server/mailbox-rows";

export type DrainResult = {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Set when nothing could be sent, explaining why. */
  blocked?: string;
  /**
   * Distinct failure reasons from this pass, each tagged with the mailbox that
   * produced it. Without these a caller only sees a count, and "2 failed" with
   * no reason is unactionable.
   */
  errors: string[];
};

/** Messages taken by one mailbox in a single pass, so rotation stays even. */
const PER_MAILBOX_SLICE = 10;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A mailbox that fails this many times in a row is almost always misconfigured
 * or blocked, and continuing would burn the whole queue against it.
 */
const FAILURE_PAUSE_THRESHOLD = 5;

export async function drainQueue(
  client: SupabaseClient,
  userId: string,
  opts: { max: number; appUrl: string; useServiceRole?: boolean },
): Promise<DrainResult> {
  const out: DrainResult = { claimed: 0, sent: 0, failed: 0, skipped: 0, errors: [] };
  // Deduplicated: 500 recipients failing on one bad password is one problem,
  // not 500.
  const seenErrors = new Set<string>();
  const noteError = (mailbox: string, message: string) => {
    const line = `${mailbox}: ${message}`;
    if (!seenErrors.has(line)) {
      seenErrors.add(line);
      out.errors.push(line);
    }
  };

  const [{ data: mailboxRows }, { data: statusRows }, { data: settingsRow }] = await Promise.all([
    client.from("email_accounts").select("*").eq("user_id", userId).returns<MailboxRow[]>(),
    client.from("mailbox_status").select("*").returns<MailboxStatusRow[]>(),
    client.from("settings").select("*").eq("user_id", userId).maybeSingle<SettingsRow>(),
  ]);

  const statusById = new Map((statusRows ?? []).map((s) => [s.id, s]));
  const mailboxes = (mailboxRows ?? []).map((r) => toMailbox(r, statusById.get(r.id)));
  const rowById = new Map((mailboxRows ?? []).map((r) => [r.id, r]));
  const settings = settingsRow ? toSettings(settingsRow) : null;

  if (mailboxes.length === 0) {
    return { ...out, errors: out.errors, blocked: "No mailboxes connected. Add one in Settings." };
  }

  // Checked before any mailbox is touched: outside working hours nothing should
  // go out, and the queue simply waits.
  const window = {
    enabled: settings?.sendWindowEnabled ?? true,
    startHour: settings?.sendWindowStart ?? 8,
    endHour: settings?.sendWindowEnd ?? 18,
    days: settings?.sendDays ?? [1, 2, 3, 4, 5],
    timezone: settings?.sendTimezone ?? "Europe/London",
  };
  if (!isWithinSendWindow(window)) {
    return { ...out, blocked: describeSendWindow(window) };
  }

  const usable = sendableMailboxes(mailboxes);
  if (usable.length === 0) {
    const paused = mailboxes.filter((m) => m.pausedReason).length;
    return {
      ...out,
      blocked: paused
        ? `Every mailbox is paused or out of allowance today (${paused} paused).`
        : "Every mailbox has hit its daily allowance. Sending resumes tomorrow.",
    };
  }

  const { createTransport, friendlySmtpError, isPermanentSmtpError, isHardBounce, buildRaw } =
    await import("@/server/mailer");

  let budget = opts.max;

  for (const mailbox of usable) {
    if (budget <= 0) break;

    const row = rowById.get(mailbox.id);
    if (!row) continue;

    const take = Math.min(budget, remainingToday(mailbox), PER_MAILBOX_SLICE);
    if (take <= 0) continue;

    // Atomically reserve work so two workers never grab the same rows.
    const { data: claimed, error: claimError } = opts.useServiceRole
      ? await client.rpc("claim_queue_for_user", {
          p_user: userId,
          p_account: mailbox.id,
          p_limit: take,
        })
      : await client.rpc("claim_queue_items", { p_account: mailbox.id, p_limit: take });

    if (claimError) throw new Error(claimError.message);
    const items = (claimed ?? []) as QueueRow[];
    if (items.length === 0) break; // Queue is empty; other mailboxes gain nothing.

    out.claimed += items.length;

    // Everything the batch needs, fetched once.
    const prospectIds = [...new Set(items.map((i) => i.prospect_id))];
    const templateIds = [...new Set(items.map((i) => i.template_id))];
    const emails = [...new Set(items.map((i) => i.to_email.toLowerCase()))];

    const sequenceIds = [...new Set(items.map((i) => i.sequence_id).filter(Boolean))] as string[];

    const [prospectsRes, templatesRes, suppressedRes, stepsRes] = await Promise.all([
      client.from("prospects").select("*").in("id", prospectIds).returns<ProspectRow[]>(),
      client.from("templates").select("*").in("id", templateIds).returns<TemplateRow[]>(),
      client
        .from("suppressions")
        .select("email")
        .eq("user_id", userId)
        .in("email", emails)
        .returns<{ email: string }[]>(),
      sequenceIds.length
        ? client
            .from("sequence_steps")
            .select("*")
            .in("sequence_id", sequenceIds)
            .order("position")
            .returns<SequenceStepRow[]>()
        : Promise.resolve({ data: [] as SequenceStepRow[] }),
    ]);

    const prospects = new Map((prospectsRes.data ?? []).map((r) => [r.id, toProspect(r)]));
    const templates = new Map((templatesRes.data ?? []).map((r) => [r.id, toTemplate(r)]));
    const suppressed = new Set((suppressedRes.data ?? []).map((s) => s.email.toLowerCase()));

    // Steps grouped by sequence, so a completed send can look up what follows.
    const stepsBySequence = new Map<string, SequenceStepRow[]>();
    for (const step of stepsRes.data ?? []) {
      const list = stepsBySequence.get(step.sequence_id);
      if (list) list.push(step);
      else stepsBySequence.set(step.sequence_id, [step]);
    }

    // Follow-ups queued after this batch, in one insert.
    const followUps: Record<string, unknown>[] = [];

    const transport = createTransport({
      host: row.smtp_host,
      port: row.smtp_port,
      secure: row.smtp_secure,
      user: row.smtp_user,
      password: row.smtp_password,
    });

    let failuresThisPass = 0;
    // Filed into the Sent folder in one IMAP session after the batch.
    const sentCopies: Buffer[] = [];

    try {
      for (const item of items) {
        const prospect = prospects.get(item.prospect_id);
        const template = templates.get(item.template_id);

        const skip = (reason: string) =>
          client
            .from("send_queue")
            .update({ status: "skipped", error: reason, locked_at: null })
            .eq("id", item.id);

        // Re-checked at send time: the list was built earlier and can be stale.
        if (suppressed.has(item.to_email.toLowerCase())) {
          await skip("Address is suppressed");
          out.skipped += 1;
          continue;
        }
        if (!prospect) {
          await skip("Prospect no longer exists");
          out.skipped += 1;
          continue;
        }
        if (prospect.status === "unsubscribed") {
          await skip("Unsubscribed");
          out.skipped += 1;
          continue;
        }
        if (!template) {
          await skip("Template no longer exists");
          out.skipped += 1;
          continue;
        }

        // A domain that cannot receive mail produces a hard bounce, and bounce
        // rate is what gets a sender throttled. Cheaper to check than to send.
        const { domainAcceptsMail, domainOfEmail } = await import("@/server/verify-address");
        if (!(await domainAcceptsMail(domainOfEmail(prospect.email)))) {
          await skip("Domain does not accept mail");
          await client
            .from("suppressions")
            .insert({
              user_id: userId,
              email: prospect.email.toLowerCase(),
              reason: "hard_bounce",
              detail: "No MX or A record for the domain",
            })
            .then(
              () => undefined,
              () => undefined,
            );
          out.skipped += 1;
          continue;
        }

        const token = randomUUID();
        const unsubscribeUrl = `${opts.appUrl}/u/${token}`;
        const subject = mergeCopy(template.subject, prospect);
        const plainOnly = settings?.plainTextMode ?? true;

        const bodyOpts: BodyOptions = {
          body: mergeCopy(template.body, prospect),
          bodyHtml: template.bodyHtml ? mergeCopy(template.bodyHtml, prospect) : undefined,
          signature: settings?.signature ?? "",
          signatureHtml: settings?.signatureHtml,
          unsubscribeUrl,
          unsubscribeText: settings?.unsubscribeText,
          unsubscribeHtml: settings?.unsubscribeHtml,
          plainOnly,
        };

        const html = buildHtmlBody(bodyOpts);
        const mailOptions: MailOptions = {
          from: `"${row.from_name || settings?.senderName || ""}" <${row.from_email}>`,
          replyTo: row.reply_to || row.from_email,
          to: prospect.email,
          subject,
          text: buildTextBody(bodyOpts),
          // Locally added images arrive as data: URLs; this turns them into
          // proper cid: inline attachments, which mail clients display.
          ...(html ? { html, attachDataUrls: true } : {}),
          headers: plainOnly
            ? // mailto only: the https + One-Click pairing reads as bulk mail
              // and is a large part of what lands a message in Promotions.
              {
                "List-Unsubscribe": `<mailto:${row.reply_to || row.from_email}?subject=unsubscribe>`,
              }
            : {
                "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:${row.reply_to || row.from_email}?subject=unsubscribe>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
        };

        try {
          // Compiled once, then both sent and filed, so the copy in Sent is
          // byte-identical to what the recipient received.
          const raw = await buildRaw(mailOptions);
          const info = await transport.sendMail({
            envelope: { from: row.from_email, to: [prospect.email] },
            raw,
          });
          if (row.save_to_sent) sentCopies.push(raw);

          await Promise.all([
            client.from("send_queue").update({ status: "sent", locked_at: null }).eq("id", item.id),
            client.from("email_sends").insert({
              user_id: userId,
              account_id: mailbox.id,
              campaign_id: item.campaign_id,
              prospect_id: item.prospect_id,
              step_position: item.step_position,
              to_email: prospect.email,
              subject,
              status: "sent",
              track_token: token,
              message_id: info.messageId ?? null,
            }),
            client.from("campaign_recipients").upsert({
              campaign_id: item.campaign_id,
              prospect_id: item.prospect_id,
              user_id: userId,
              status: "sent",
              opened: false,
              replied: false,
              sent_at: new Date().toISOString(),
            }),
          ]);

          out.sent += 1;
          budget -= 1;
          failuresThisPass = 0;

          // Queue the next step of the sequence, if there is one. Scheduling it
          // here rather than up front means a follow-up only exists once the
          // message before it actually went out.
          if (item.sequence_id) {
            const steps = stepsBySequence.get(item.sequence_id) ?? [];
            const next = steps.find((s) => s.position === item.step_position + 1);
            if (next?.template_id) {
              followUps.push({
                user_id: userId,
                campaign_id: item.campaign_id,
                prospect_id: item.prospect_id,
                template_id: next.template_id,
                to_email: prospect.email,
                sequence_id: item.sequence_id,
                step_id: next.id,
                step_position: next.position,
                scheduled_at: new Date(
                  Date.now() + Math.max(0, next.delay_days) * 86_400_000,
                ).toISOString(),
              });
            }
          }
        } catch (err) {
          const message = friendlySmtpError(err, row.smtp_host);
          const permanent = isPermanentSmtpError(err);
          failuresThisPass += 1;
          noteError(row.from_email, message);

          // A permanent rejection will never succeed on retry — a bad address,
          // a refused sender. Retrying only burns allowance.
          const giveUp = permanent || item.attempts >= item.max_attempts;

          await client
            .from("send_queue")
            .update({
              status: giveUp ? "failed" : "queued",
              error: message.slice(0, 500),
              locked_at: null,
              // Back off before the next attempt.
              scheduled_at: giveUp
                ? new Date().toISOString()
                : new Date(Date.now() + 5 * 60_000).toISOString(),
            })
            .eq("id", item.id);

          await client.from("email_sends").insert({
            user_id: userId,
            account_id: mailbox.id,
            campaign_id: item.campaign_id,
            prospect_id: item.prospect_id,
            step_position: item.step_position,
            to_email: item.to_email,
            subject,
            status: "failed",
            error: message.slice(0, 500),
            track_token: token,
          });

          // Only a rejected *recipient* suppresses the address. An auth failure
          // is also 5xx but means our credentials are wrong, not their address.
          if (isHardBounce(err)) {
            const { error: supErr } = await client.from("suppressions").insert({
              user_id: userId,
              email: item.to_email.toLowerCase(),
              reason: "hard_bounce",
              detail: message.slice(0, 500),
            });
            // Duplicate just means it was already suppressed.
            if (supErr && !supErr.message.includes("duplicate")) console.error(supErr.message);
          }

          out.failed += 1;

          // Stop hammering a mailbox that is clearly not working.
          if (failuresThisPass >= FAILURE_PAUSE_THRESHOLD) {
            await client
              .from("email_accounts")
              .update({
                paused_reason: `Paused after ${failuresThisPass} consecutive failures: ${message.slice(0, 200)}`,
                consecutive_failures: failuresThisPass,
              })
              .eq("id", mailbox.id);
            break;
          }
        }

        if (row.send_delay_ms > 0) await sleep(row.send_delay_ms);
      }
    } finally {
      transport.close();
    }

    // Follow-ups in one insert. ignoreDuplicates so a retry of this batch
    // cannot queue the same step twice.
    if (followUps.length) {
      const { error } = await client.from("send_queue").upsert(followUps, {
        onConflict: "campaign_id,prospect_id,step_position",
        ignoreDuplicates: true,
      });
      if (error) console.error("could not queue follow-ups:", error.message);
    }

    // Bounce circuit breaker. Above the threshold a mailbox is damaging its own
    // reputation with every further send, so it pauses itself rather than
    // waiting for someone to notice.
    if (mailbox.sentToday >= (settings?.minSendsBeforePause ?? 20)) {
      const { data: rate } = await client.rpc("mailbox_bounce_rate", { p_account: mailbox.id });
      const limit = settings?.maxBounceRate ?? 2;
      if (typeof rate === "number" && rate > limit) {
        await client
          .from("email_accounts")
          .update({
            paused_reason:
              `Paused automatically: ${rate}% of today's sends bounced, above the ` +
              `${limit}% limit. Clean the list before resuming.`,
          })
          .eq("id", mailbox.id);
        noteError(row.from_email, `paused — bounce rate ${rate}% exceeds ${limit}%`);
      }
    }

    // File the batch into Sent. Failing here must never fail the send — the
    // mail has already gone out, and a missing copy is cosmetic.
    if (sentCopies.length > 0 && row.imap_host) {
      try {
        const { appendToSent } = await import("@/server/imap");
        await appendToSent(
          {
            host: row.imap_host,
            port: row.imap_port,
            secure: row.imap_secure,
            user: row.smtp_user,
            password: row.smtp_password,
          },
          row.sent_folder,
          sentCopies,
        );
      } catch (err) {
        console.error("could not save copies to Sent:", err);
      }
    }

    await client
      .from("email_accounts")
      .update({ last_sent_at: new Date().toISOString(), consecutive_failures: failuresThisPass })
      .eq("id", mailbox.id);
  }

  return out;
}
