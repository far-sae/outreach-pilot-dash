import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Btn, Field, Panel, Pill, inputClass } from "@/components/ui-kit";
import {
  NEW_MAILBOX,
  SMTP_PRESETS,
  type Mailbox,
  type MailboxInput,
  type PoolSummary,
} from "@/lib/email-types";
import { cn } from "@/lib/utils";
import {
  checkReplies,
  deleteMailbox,
  getSchemaStatus,
  listMailboxes,
  resumeMailbox,
  saveMailbox,
  sendTestEmail,
  verifyMailbox,
  type SchemaStatus,
} from "@/server/email.functions";
import { isValidEmail } from "@/store/outreach-store";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function MailboxPoolPanel() {
  const load = useServerFn(listMailboxes);
  const save = useServerFn(saveMailbox);
  const remove = useServerFn(deleteMailbox);
  const resume = useServerFn(resumeMailbox);
  const verify = useServerFn(verifyMailbox);
  const test = useServerFn(sendTestEmail);
  const scan = useServerFn(checkReplies);
  const schemaCheck = useServerFn(getSchemaStatus);

  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [summary, setSummary] = useState<PoolSummary | null>(null);
  const [localLinks, setLocalLinks] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MailboxInput | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [schema, setSchema] = useState<SchemaStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      // Checked first: a missing migration otherwise surfaces as an opaque
      // "schema cache" error that reads like an application bug.
      const status = await schemaCheck({ data: undefined });
      setSchema(status);
      if (!status.ok) return;

      const res = await load({ data: undefined });
      setMailboxes(res.mailboxes);
      setSummary(res.summary);
      setLocalLinks(res.appUrlIsLocal);
    } catch (e) {
      toast.error("Couldn't load your mailboxes", { description: errText(e) });
    } finally {
      setLoading(false);
    }
  }, [load, schemaCheck]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function edit(m: Mailbox) {
    setEditing({
      id: m.id,
      label: m.label,
      fromName: m.fromName,
      fromEmail: m.fromEmail,
      replyTo: m.replyTo,
      smtpHost: m.smtpHost,
      smtpPort: m.smtpPort,
      smtpSecure: m.smtpSecure,
      smtpUser: m.smtpUser,
      smtpPassword: "",
      imapHost: m.imapHost,
      imapPort: m.imapPort,
      imapSecure: m.imapSecure,
      sendDelayMs: m.sendDelayMs,
      dailyLimit: m.dailyLimit,
      warmupEnabled: m.warmupEnabled,
      warmupStartVolume: m.warmupStartVolume,
      warmupIncrement: m.warmupIncrement,
      isActive: m.isActive,
    });
  }

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      await refresh();
      toast.success(ok);
    } catch (e) {
      toast.error("That didn't work", { description: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  async function onScan() {
    setBusy("scan");
    try {
      const r = await scan({ data: undefined });
      await refresh();
      toast.success(
        r.matched || r.bounces
          ? `${r.matched} repl${r.matched === 1 ? "y" : "ies"}, ${r.bounces} bounce${r.bounces === 1 ? "" : "s"}`
          : "Nothing new found",
        { description: `Scanned ${r.scanned} message${r.scanned === 1 ? "" : "s"}.` },
      );
    } catch (e) {
      toast.error("Couldn't check replies", { description: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <Panel title="Sending mailboxes">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Panel>
    );
  }

  if (schema && !schema.ok) {
    return <MigrationNotice status={schema} onRetry={() => void refresh()} />;
  }

  return (
    <>
      <Panel
        title="Sending mailboxes"
        action={
          <Btn variant="primary" size="sm" onClick={() => setEditing({ ...NEW_MAILBOX })}>
            <Plus className="h-4 w-4" />
            Add mailbox
          </Btn>
        }
      >
        <p className="-mt-1 text-xs text-muted-foreground">
          Campaigns rotate across every active mailbox, respecting each one's daily allowance.
          Around 40/day per mailbox keeps cold outreach deliverable — add more mailboxes to send
          more, rather than raising one mailbox's limit.
        </p>

        {summary && (
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Mailboxes", value: `${summary.activeMailboxes}/${summary.mailboxes}` },
              { label: "Capacity left today", value: summary.capacityToday },
              { label: "Sent today", value: summary.sentToday },
              { label: "Queued", value: summary.queue.queued },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-surface-muted p-3">
                <dt className="text-xs text-muted-foreground">{s.label}</dt>
                <dd className="mt-1 font-mono text-xl font-medium">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {localLinks && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-warning-tint p-3 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Tracking and unsubscribe links point at localhost, which recipients cannot open. Set{" "}
              <code className="font-mono">APP_URL</code> in <code className="font-mono">.env</code>{" "}
              before sending to real prospects.
            </span>
          </p>
        )}

        {mailboxes.length === 0 ? (
          <p className="mt-5 rounded-lg border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
            No mailboxes yet. Add one to start sending.
          </p>
        ) : (
          <ul className="mt-5 divide-y divide-border">
            {mailboxes.map((m) => {
              const remaining = Math.max(0, m.effectiveLimit - m.sentToday);
              const state = !m.hasPassword
                ? { tone: "unsubscribed" as const, text: "no password" }
                : m.pausedReason
                  ? { tone: "replied" as const, text: "paused" }
                  : !m.isActive
                    ? { tone: "muted" as const, text: "inactive" }
                    : remaining === 0
                      ? { tone: "muted" as const, text: "cap reached" }
                      : { tone: "active" as const, text: "ready" };

              return (
                <li key={m.id} className="py-3 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{m.label || m.fromEmail}</p>
                        <Pill tone={state.tone}>{state.text}</Pill>
                        {m.verifiedAt && (
                          <CheckCircle2
                            className="h-3.5 w-3.5 text-success"
                            aria-label="verified"
                          />
                        )}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {m.fromEmail} · {m.sentToday}/{m.effectiveLimit} today
                        {m.warmupEnabled && m.effectiveLimit < m.dailyLimit
                          ? ` · warming up to ${m.dailyLimit}`
                          : ""}
                      </p>
                      {m.pausedReason && (
                        <p className="mt-1 text-xs text-warning">{m.pausedReason}</p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <Btn
                        size="sm"
                        disabled={busy !== null || !m.hasPassword}
                        onClick={() =>
                          void act(m.id, () => verify({ data: { id: m.id } }), "Connection OK")
                        }
                      >
                        {busy === m.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Test
                      </Btn>
                      <Btn
                        size="sm"
                        disabled={busy !== null || !m.hasPassword}
                        onClick={() =>
                          void act(
                            `t-${m.id}`,
                            () => test({ data: { id: m.id, to: m.fromEmail } }),
                            `Test sent to ${m.fromEmail}`,
                          )
                        }
                      >
                        Send test
                      </Btn>
                      {m.pausedReason && (
                        <Btn
                          size="sm"
                          disabled={busy !== null}
                          onClick={() =>
                            void act(`r-${m.id}`, () => resume({ data: { id: m.id } }), "Resumed")
                          }
                        >
                          Resume
                        </Btn>
                      )}
                      <Btn size="sm" disabled={busy !== null} onClick={() => edit(m)}>
                        Edit
                      </Btn>
                      <Btn
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => {
                          if (!confirm(`Remove ${m.fromEmail} from the pool?`)) return;
                          void act(`d-${m.id}`, () => remove({ data: { id: m.id } }), "Removed");
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Btn>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Btn onClick={() => void onScan()} disabled={busy !== null || mailboxes.length === 0}>
            {busy === "scan" && <Loader2 className="h-4 w-4 animate-spin" />}
            Check replies and bounces
          </Btn>
          <span className="text-xs text-muted-foreground">
            Scans every active mailbox over IMAP. Bounced addresses are suppressed automatically.
          </span>
        </div>
      </Panel>

      {editing && (
        <MailboxForm
          value={editing}
          onCancel={() => setEditing(null)}
          onSave={async (v) => {
            await save({ data: v });
            setEditing(null);
            await refresh();
            toast.success("Mailbox saved");
          }}
        />
      )}
    </>
  );
}

/**
 * Shown instead of the pool when the database is behind the code. Names the
 * exact file to run rather than echoing PostgREST's "schema cache" wording.
 */
function MigrationNotice({ status, onRetry }: { status: SchemaStatus; onRetry: () => void }) {
  return (
    <Panel title="Database update needed">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0">
          <p className="text-sm">
            Your database is missing a migration, so the mailbox pool can't load yet.
          </p>
          <p className="mt-3 text-sm font-medium">Run this file:</p>
          <pre className="mt-1.5 overflow-x-auto rounded-lg bg-surface-muted p-3 font-mono text-xs">
            {status.missing}
          </pre>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Open your Supabase dashboard → SQL Editor → New query</li>
            <li>Paste the whole file — it must run in one go</li>
            <li>Run it, then come back and reload</li>
          </ol>
          {status.detail && (
            <p className="mt-3 font-mono text-[11px] text-muted-foreground">{status.detail}</p>
          )}
          <Btn className="mt-4" onClick={onRetry}>
            I've run it — check again
          </Btn>
        </div>
      </div>
    </Panel>
  );
}

function MailboxForm({
  value,
  onSave,
  onCancel,
}: {
  value: MailboxInput;
  onSave: (v: MailboxInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<MailboxInput>(value);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const isNew = !form.id;

  function applyPreset(name: string) {
    const p = SMTP_PRESETS[name];
    if (!p) return;
    setForm((f) => ({
      ...f,
      smtpHost: p.smtp,
      smtpPort: p.port,
      smtpSecure: p.secure,
      imapHost: p.imap,
      imapPort: 993,
      imapSecure: true,
    }));
  }

  async function submit() {
    const next: Record<string, string> = {};
    if (!isValidEmail(form.fromEmail)) next["fromEmail"] = "Enter a valid From address";
    if (form.replyTo && !isValidEmail(form.replyTo)) next["replyTo"] = "Enter a valid reply-to";
    if (!form.smtpHost.trim()) next["smtpHost"] = "Required";
    // The server name here is the single most common cause of a 535 that reads
    // like a wrong password.
    if (form.smtpUser.trim() && !isValidEmail(form.smtpUser)) {
      next["smtpUser"] = "Use the full email address, not the server name";
    }
    if (isNew && !form.smtpPassword) next["smtpPassword"] = "Required";
    if (form.dailyLimit > 100) {
      next["dailyLimit"] = "Above ~50/day per mailbox risks spam filtering on cold outreach";
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      await onSave(form);
    } catch (e) {
      toast.error("Couldn't save the mailbox", { description: errText(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title={isNew ? "Add mailbox" : `Edit ${form.fromEmail || "mailbox"}`}>
      <Field label="Provider preset" hint="Fills in the server settings below.">
        <select
          className={inputClass}
          defaultValue=""
          onChange={(e) => applyPreset(e.target.value)}
        >
          <option value="">Choose a provider…</option>
          {Object.keys(SMTP_PRESETS).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </Field>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Field label="Label" hint="How this mailbox appears in the pool.">
          <input
            className={inputClass}
            value={form.label}
            placeholder={form.fromEmail || "Sales inbox"}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </Field>
        <Field label="From name">
          <input
            className={inputClass}
            value={form.fromName}
            onChange={(e) => setForm({ ...form, fromName: e.target.value })}
          />
        </Field>
        <Field label="From email" error={errors["fromEmail"]}>
          <input
            className={inputClass}
            value={form.fromEmail}
            placeholder="you@yourdomain.com"
            onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
          />
        </Field>
        <Field label="Reply-to" error={errors["replyTo"]} hint="Blank uses the From address.">
          <input
            className={inputClass}
            value={form.replyTo}
            onChange={(e) => setForm({ ...form, replyTo: e.target.value })}
          />
        </Field>

        <Field label="SMTP host" error={errors["smtpHost"]}>
          <input
            className={inputClass}
            value={form.smtpHost}
            onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
          />
        </Field>
        <Field label="Security">
          <select
            className={inputClass}
            value={form.smtpSecure ? "ssl" : "starttls"}
            onChange={(e) => {
              const ssl = e.target.value === "ssl";
              setForm({ ...form, smtpSecure: ssl, smtpPort: ssl ? 465 : 587 });
            }}
          >
            <option value="starttls">STARTTLS (587)</option>
            <option value="ssl">SSL/TLS (465)</option>
          </select>
        </Field>
        <Field label="SMTP username" error={errors["smtpUser"]} hint="Full email address.">
          <input
            className={inputClass}
            value={form.smtpUser}
            placeholder={form.fromEmail || "you@yourdomain.com"}
            onChange={(e) => setForm({ ...form, smtpUser: e.target.value })}
          />
        </Field>
        <Field
          label="SMTP password"
          error={errors["smtpPassword"]}
          hint={
            isNew ? "Mailbox password, or app password if 2FA is on." : "Blank keeps the saved one."
          }
        >
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={form.smtpPassword}
            placeholder={isNew ? "" : "••••••••"}
            onChange={(e) => setForm({ ...form, smtpPassword: e.target.value })}
          />
        </Field>

        <Field label="IMAP host" hint="For reply and bounce detection.">
          <input
            className={inputClass}
            value={form.imapHost}
            onChange={(e) => setForm({ ...form, imapHost: e.target.value })}
          />
        </Field>
        <Field label="IMAP port">
          <input
            type="number"
            className={inputClass}
            value={form.imapPort}
            onChange={(e) => setForm({ ...form, imapPort: Number(e.target.value) })}
          />
        </Field>

        <Field label="Daily limit" error={errors["dailyLimit"]} hint="40 is a safe ceiling.">
          <input
            type="number"
            min={1}
            className={inputClass}
            value={form.dailyLimit}
            onChange={(e) => setForm({ ...form, dailyLimit: Number(e.target.value) })}
          />
        </Field>
        <Field label="Delay between messages (ms)">
          <input
            type="number"
            min={0}
            step={100}
            className={inputClass}
            value={form.sendDelayMs}
            onChange={(e) => setForm({ ...form, sendDelayMs: Number(e.target.value) })}
          />
        </Field>
      </div>

      <div className="mt-5 rounded-lg bg-surface-muted p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.warmupEnabled}
            onChange={(e) => setForm({ ...form, warmupEnabled: e.target.checked })}
          />
          Warm this mailbox up gradually
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          A new address sending at full volume on day one is the fastest way into spam folders.
          Starts at {form.warmupStartVolume}/day and adds {form.warmupIncrement}/day until it
          reaches {form.dailyLimit}.
        </p>
        {form.warmupEnabled && (
          <div className={cn("mt-3 grid gap-4 sm:grid-cols-2")}>
            <Field label="Start volume">
              <input
                type="number"
                min={1}
                className={inputClass}
                value={form.warmupStartVolume}
                onChange={(e) => setForm({ ...form, warmupStartVolume: Number(e.target.value) })}
              />
            </Field>
            <Field label="Daily increase">
              <input
                type="number"
                min={1}
                className={inputClass}
                value={form.warmupIncrement}
                onChange={(e) => setForm({ ...form, warmupIncrement: Number(e.target.value) })}
              />
            </Field>
          </div>
        )}
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
        />
        Include in the sending rotation
      </label>

      <div className="mt-5 flex gap-2">
        <Btn variant="primary" onClick={() => void submit()} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save mailbox
        </Btn>
        <Btn onClick={onCancel} disabled={saving}>
          Cancel
        </Btn>
      </div>
    </Panel>
  );
}
