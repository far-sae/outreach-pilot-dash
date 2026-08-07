import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Send, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { toRecipient, type RecipientRow } from "@/lib/db-types";
import { supabase } from "@/lib/supabase";
import {
  enqueueCampaign,
  getCampaignProgress,
  listMailboxes,
  listSequences,
  processQueue,
  type CampaignProgress,
} from "@/server/email.functions";
import type { PoolSummary, Sequence } from "@/lib/email-types";
import { AppLayout } from "@/components/app-layout";
import {
  Btn,
  ConfirmDialog,
  EmptyState,
  Field,
  PageHeader,
  Panel,
  Pill,
  inputClass,
} from "@/components/ui-kit";
import { cn } from "@/lib/utils";
import { cleanRedundantLinks, footerText } from "@/lib/merge";
import { campaignStats, fullName, mergeCopy, useOutreach } from "@/store/outreach-store";
import type { Recipient } from "@/data/outreach";

type CampaignSearch = { group?: string | undefined };

export const Route = createFileRoute("/campaigns")({
  validateSearch: (search: Record<string, unknown>): CampaignSearch => ({
    group: typeof search["group"] === "string" ? (search["group"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Campaigns — Outreach Console" },
      {
        name: "description",
        content:
          "Build a cold email campaign from a group and template, review recipients, send, and track opens and replies.",
      },
      { property: "og:title", content: "Campaigns — Outreach Console" },
      {
        property: "og:description",
        content: "Build, send and track cold email campaigns from your groups and templates.",
      },
    ],
  }),
  component: CampaignsPage,
});

type SendReport = {
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
  notes: string[];
};

/** Messages per drain call while the browser is pushing the queue along. */
const DRAIN_BATCH = 20;

function CampaignsPage() {
  const { state, addCampaign, updateCampaignRecipients } = useOutreach();
  const { prospects, groups, templates, campaigns, settings } = state;
  const search = Route.useSearch();
  const enqueue = useServerFn(enqueueCampaign);
  const drain = useServerFn(processQueue);
  const loadSequences = useServerFn(listSequences);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  /** Empty means a single email from the selected template. */
  const [sequenceId, setSequenceId] = useState("");
  const loadPool = useServerFn(listMailboxes);
  const loadProgress = useServerFn(getCampaignProgress);

  const [pool, setPool] = useState<PoolSummary | null>(null);
  const [progressById, setProgressById] = useState<Map<string, CampaignProgress>>(new Map());
  const [draining, setDraining] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const [poolRes, prog, seqs] = await Promise.all([
        loadPool({ data: undefined }),
        loadProgress({ data: undefined }),
        loadSequences({ data: undefined }),
      ]);
      setPool(poolRes.summary);
      setProgressById(new Map(prog.map((p) => [p.campaignId, p])));
      setSequences(seqs);
    } catch {
      /* the page still works without live counts */
    }
  }, [loadPool, loadProgress, loadSequences]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  /** Pushes the queue along for campaigns that stopped at the daily cap. */
  async function resumeSending() {
    setDraining(true);
    let sent = 0;
    try {
      for (;;) {
        const r = await drain({ data: { max: DRAIN_BATCH } });
        if (r.blocked) {
          toast.error("Sending is blocked", { description: r.blocked });
          break;
        }
        if (r.errors?.length) {
          toast.error("Some messages failed", { description: r.errors[0] ?? "" });
        }
        if (r.claimed === 0) break;
        sent += r.sent;
      }
      if (sent > 0) toast.success(`Sent ${sent} more email${sent === 1 ? "" : "s"}`);
      else if (sent === 0) toast.message("Nothing left to send right now");
    } catch (e) {
      toast.error("Couldn't resume", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDraining(false);
      void refreshStatus();
    }
  }

  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState<string | null>(search.group ?? null);
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? "");
  const [confirmSend, setConfirmSend] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<SendReport | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Campaign history filters.
  const [historyGroup, setHistoryGroup] = useState("all");
  const [historyDays, setHistoryDays] = useState<"7" | "30" | "90" | "all">("all");
  const [historyStatus, setHistoryStatus] = useState<"all" | "sending" | "failed" | "done">("all");
  const [historySort, setHistorySort] = useState<"newest" | "oldest" | "name" | "size">("newest");
  const [historyQuery, setHistoryQuery] = useState("");

  const members = useMemo(
    () => prospects.filter((p) => (groupId ? p.groupId === groupId : p.groupId === null)),
    [prospects, groupId],
  );
  const recipients = members.filter((p) => p.status === "active");
  const skipped = members.length - recipients.length;
  const template = templates.find((t) => t.id === templateId) ?? null;
  const first = recipients[0] ?? null;
  const canSend = Boolean(template) && recipients.length > 0 && !progress;

  const nameById = new Map(prospects.map((p) => [p.id, p]));

  async function send() {
    if (!template) return;
    const list = recipients;
    setProgress({ done: 0, total: list.length });
    setReport(null);

    // The campaign row has to exist before the first message goes out: the
    // server logs every send against its id, which is also what stops a retry
    // from mailing the same person twice.
    const campaign = addCampaign({
      name:
        name.trim() ||
        `${groups.find((g) => g.id === groupId)?.name ?? "Unassigned"} · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      groupId,
      templateId: template.id,
      sentAt: new Date().toISOString(),
      recipients: [],
    });

    const notes: string[] = [];
    let queued = 0;
    let sent = 0;
    let failed = 0;
    let skippedCount = 0;

    try {
      // Everything goes on the queue first, so nothing is lost if this tab is
      // closed — the worker picks up whatever is left.
      const q = await enqueue({
        data: {
          campaignId: campaign.id,
          templateId: template.id,
          prospectIds: list.map((p) => p.id),
          ...(sequenceId ? { sequenceId } : {}),
        },
      });

      queued = q.queued;
      setProgress({ done: 0, total: queued });

      if (q.suppressed > 0) {
        notes.push(`${q.suppressed} recipient(s) skipped: unsubscribed or previously bounced.`);
      }
      if (q.capacityToday === 0) {
        notes.push(
          "No sending capacity left today. The queue is saved and resumes when allowances reset, or as soon as you add mailboxes.",
        );
      } else if (q.estimatedDays > 1) {
        notes.push(
          `Pool capacity is ${q.capacityToday}/day, so this campaign will take about ${q.estimatedDays} days. Run "npm run worker" to send unattended.`,
        );
      }

      // Drain as much as today's capacity allows while the tab is open.
      for (;;) {
        const r = await drain({ data: { max: DRAIN_BATCH } });
        if (r.blocked) {
          notes.push(r.blocked);
          break;
        }
        // Surface why messages failed, not just how many.
        for (const e of r.errors ?? []) if (!notes.includes(e)) notes.push(e);
        if (r.claimed === 0) break;
        sent += r.sent;
        failed += r.failed;
        skippedCount += r.skipped;
        setProgress({ done: sent + failed + skippedCount, total: queued });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error("Sending stopped", { description: message });
      notes.push(message);
    }

    // The engine writes recipients server-side, so pull them back to keep the
    // dashboard consistent without a page reload.
    try {
      const { data } = await supabase
        .from("campaign_recipients")
        .select("*")
        .eq("campaign_id", campaign.id)
        .returns<RecipientRow[]>();
      if (data?.length) updateCampaignRecipients(campaign.id, data.map(toRecipient));
    } catch {
      /* cosmetic only — the rows are already saved */
    }

    setProgress(null);
    setName("");
    setReport({
      queued,
      sent,
      failed,
      skipped: skippedCount,
      remaining: Math.max(0, queued - sent - failed - skippedCount),
      notes,
    });

    void refreshStatus();

    if (sent > 0) toast.success(`Sent ${sent} email${sent === 1 ? "" : "s"}`);
    else if (failed > 0) toast.error("No emails went out — check the report below.");
    else if (queued > 0) {
      toast.message(`${queued} queued, nothing sent yet`, {
        description: "Check the capacity panel at the top of this page.",
      });
    }
  }

  const history = useMemo(() => {
    const cutoff = historyDays === "all" ? 0 : Date.now() - Number(historyDays) * 86_400_000;

    return [...campaigns]
      .filter((c) => {
        if (historyGroup !== "all" && (c.groupId ?? "none") !== historyGroup) return false;
        if (cutoff && new Date(c.sentAt).getTime() < cutoff) return false;
        if (historyQuery && !c.name.toLowerCase().includes(historyQuery.toLowerCase()))
          return false;
        if (historyStatus !== "all") {
          const p = progressById.get(c.id);
          const queued = p?.queued ?? 0;
          const failed = p?.failed ?? 0;
          if (historyStatus === "sending" && queued === 0) return false;
          if (historyStatus === "failed" && failed === 0) return false;
          if (historyStatus === "done" && (queued > 0 || failed > 0)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (historySort === "oldest") return a.sentAt.localeCompare(b.sentAt);
        if (historySort === "name") return a.name.localeCompare(b.name);
        if (historySort === "size") {
          return (progressById.get(b.id)?.sent ?? 0) - (progressById.get(a.id)?.sent ?? 0);
        }
        return b.sentAt.localeCompare(a.sentAt);
      });
  }, [
    campaigns,
    historyGroup,
    historyDays,
    historyQuery,
    historyStatus,
    historySort,
    progressById,
  ]);

  return (
    <AppLayout>
      <PageHeader
        title="Campaigns"
        subtitle={`${campaigns.length} sent · daily cap ${settings.dailyCap}`}
      />

      {pool && (
        <div className="mt-4 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <dl className="flex flex-wrap gap-x-8 gap-y-3">
              {[
                { label: "Capacity left today", value: pool.capacityToday },
                { label: "Waiting in queue", value: pool.queue.queued },
                { label: "Sent today", value: pool.sentToday },
                { label: "Active mailboxes", value: `${pool.activeMailboxes}/${pool.mailboxes}` },
              ].map((s) => (
                <div key={s.label}>
                  <dt className="text-xs text-muted-foreground">{s.label}</dt>
                  <dd className="mt-0.5 font-mono text-lg font-medium">{s.value}</dd>
                </div>
              ))}
            </dl>
            {pool.queue.queued > 0 && (
              <Btn variant="primary" onClick={() => void resumeSending()} disabled={draining}>
                {draining ? "Sending…" : "Resume sending"}
              </Btn>
            )}
          </div>

          {pool.mailboxes === 0 ? (
            <p className="mt-3 text-xs text-warning">
              No mailboxes connected.{" "}
              <Link to="/settings" className="underline">
                Add one in Settings
              </Link>{" "}
              before sending.
            </p>
          ) : pool.capacityToday === 0 ? (
            <p className="mt-3 text-xs text-warning">
              Every mailbox has used its allowance for today, so nothing more will send until
              tomorrow. New mailboxes start at a low warmup volume by design — raise it, turn warmup
              off, or add more mailboxes in{" "}
              <Link to="/settings" className="underline">
                Settings
              </Link>
              .
            </p>
          ) : pool.queue.queued > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {pool.queue.queued} message{pool.queue.queued === 1 ? "" : "s"} waiting. Press Resume
              sending, or run <code className="font-mono">npm run worker</code> to drain the queue
              unattended.
            </p>
          ) : null}
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="New campaign">
          <div className="grid gap-5">
            <Field label="Campaign name" hint="Leave blank to auto-name from the group and date.">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Law · Aug"
              />
            </Field>

            <div>
              <span className="text-xs font-medium text-muted-foreground">Group</span>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {[
                  ...groups.map((g) => ({ id: g.id as string | null, name: g.name })),
                  { id: null, name: "Unassigned" },
                ].map((g) => {
                  const all = prospects.filter((p) => p.groupId === g.id);
                  const active = all.filter((p) => p.status === "active").length;
                  const selected = groupId === g.id;
                  return (
                    <button
                      key={g.id ?? "none"}
                      type="button"
                      onClick={() => setGroupId(g.id)}
                      className={cn(
                        "rounded-lg border p-3 text-left transition-colors",
                        selected
                          ? "border-accent-blue bg-accent-tint"
                          : "border-border hover:bg-surface-muted",
                      )}
                    >
                      <p className="truncate text-sm font-medium">{g.name}</p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {active} contactable / {all.length}
                      </p>
                    </button>
                  );
                })}
              </div>
              {groups.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  <Link to="/groups" className="text-accent-blue hover:underline">
                    Create a group
                  </Link>{" "}
                  to segment your list.
                </p>
              )}
            </div>

            <Field
              label="Follow-up sequence"
              hint="A sequence sends several messages over days and stops when they reply."
            >
              <select
                className={inputClass}
                value={sequenceId}
                onChange={(e) => setSequenceId(e.target.value)}
              >
                <option value="">Single email (use the template below)</option>
                {sequences.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.steps.length} step{s.steps.length === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Template">
              {templates.length ? (
                <select
                  className={inputClass}
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Link to="/templates" className="text-sm text-accent-blue hover:underline">
                  Create a template first
                </Link>
              )}
            </Field>
          </div>
        </Panel>

        <Panel title="Review and send" className="h-fit">
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-surface-muted p-3">
              <dt className="text-xs text-muted-foreground">Recipients</dt>
              <dd className="mt-1 font-mono text-2xl font-medium">{recipients.length}</dd>
            </div>
            <div className="rounded-lg bg-surface-muted p-3">
              <dt className="text-xs text-muted-foreground">Skipped</dt>
              <dd className="mt-1 font-mono text-2xl font-medium">{skipped}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            Unsubscribed prospects are never sent to.
          </p>

          {template && first ? (
            <div className="mt-4 rounded-lg bg-surface-muted p-4">
              <p className="text-xs text-muted-foreground">
                To {first.email} · from {settings.senderName} &lt;{settings.fromEmail}&gt; ·
                reply-to {settings.replyTo}
              </p>
              <p className="mt-3 text-sm font-medium break-words">
                {mergeCopy(template.subject, first)}
              </p>
              <p className="mt-2 text-sm break-words whitespace-pre-wrap">
                {cleanRedundantLinks(mergeCopy(template.body, first))}
              </p>
              {settings.signature && (
                <p className="mt-4 border-t border-border pt-3 text-sm break-words whitespace-pre-wrap text-muted-foreground">
                  {cleanRedundantLinks(settings.signature)}
                </p>
              )}
              <p className="mt-4 text-xs break-words whitespace-pre-wrap text-muted-foreground">
                {footerText({
                  body: "",
                  signature: "",
                  unsubscribeText: settings.unsubscribeText,
                  unsubscribeUrl: "<unsubscribe link>",
                  replyTo: settings.replyTo,
                })}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">
              Pick a group with contactable prospects and a template to see the preview.
            </p>
          )}

          {progress && (
            <div className="mt-4">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full bg-accent-blue transition-all"
                  style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                />
              </div>
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                Sending {progress.done} / {progress.total}
              </p>
            </div>
          )}

          {report && (
            <div className="mt-4 rounded-lg border border-border p-3">
              <p className="text-xs font-medium">Send report</p>
              <dl className="mt-2 grid grid-cols-4 gap-2 text-center">
                <div>
                  <dt className="text-[11px] text-muted-foreground">Sent</dt>
                  <dd className="font-mono text-lg text-success">{report.sent}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Failed</dt>
                  <dd className="font-mono text-lg text-danger">{report.failed}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Skipped</dt>
                  <dd className="font-mono text-lg text-muted-foreground">{report.skipped}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Still queued</dt>
                  <dd className="font-mono text-lg text-accent-blue">{report.remaining}</dd>
                </div>
              </dl>
              {report.remaining > 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  The rest is saved and will send as capacity frees up. Closing this tab is safe.
                </p>
              )}
              {report.notes.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-border pt-2">
                  {report.notes.map((n, i) => (
                    <li key={i} className="text-[11px] leading-relaxed text-muted-foreground">
                      {n}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Btn
            variant="primary"
            className="mt-4 w-full"
            disabled={!canSend}
            onClick={() => setConfirmSend(true)}
          >
            <Send className="h-4 w-4" strokeWidth={1.75} />
            {progress ? "Sending…" : "Send campaign"}
          </Btn>
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title="Campaign history">
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <input
              className={inputClass}
              placeholder="Search by name…"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
            />
            <select
              className={inputClass}
              value={historyGroup}
              onChange={(e) => setHistoryGroup(e.target.value)}
            >
              <option value="all">All groups</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
              <option value="none">Unassigned</option>
            </select>
            <select
              className={inputClass}
              value={historyDays}
              onChange={(e) => setHistoryDays(e.target.value as typeof historyDays)}
            >
              <option value="all">Any date</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
            <select
              className={inputClass}
              value={historyStatus}
              onChange={(e) => setHistoryStatus(e.target.value as typeof historyStatus)}
            >
              <option value="all">Any status</option>
              <option value="sending">Still sending</option>
              <option value="failed">Has failures</option>
              <option value="done">Complete</option>
            </select>
            <select
              className={inputClass}
              value={historySort}
              onChange={(e) => setHistorySort(e.target.value as typeof historySort)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Name A–Z</option>
              <option value="size">Most sent</option>
            </select>
          </div>

          {history.length !== campaigns.length && (
            <p className="mb-3 text-xs text-muted-foreground">
              Showing {history.length} of {campaigns.length} campaigns.{" "}
              <button
                type="button"
                className="text-accent-blue hover:underline"
                onClick={() => {
                  setHistoryQuery("");
                  setHistoryGroup("all");
                  setHistoryDays("all");
                  setHistoryStatus("all");
                }}
              >
                Clear filters
              </button>
            </p>
          )}

          {history.length === 0 ? (
            <EmptyState
              title="No campaigns sent yet"
              body="Pick a group and a template above to send your first one."
            />
          ) : (
            <ul className="divide-y divide-border">
              {history.map((c) => {
                const s = campaignStats(c);
                const open = expanded === c.id;
                return (
                  <li key={c.id} className="py-3 first:pt-0 last:pb-0">
                    <button
                      type="button"
                      className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 text-left"
                      onClick={() => setExpanded(open ? null : c.id)}
                    >
                      {open ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {new Date(c.sentAt).toLocaleDateString()} ·{" "}
                          {groups.find((g) => g.id === c.groupId)?.name ?? "Unassigned"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right font-mono text-xs text-muted-foreground">
                        {(() => {
                          // Counts come from the send log and the queue, so a
                          // campaign still waiting on capacity reads as queued
                          // rather than as zero delivered.
                          const p = progressById.get(c.id);
                          const delivered = p ? p.sent : s.delivered;
                          return (
                            <>
                              <div>
                                <span className="text-success">{delivered} sent</span>
                                {p && p.queued > 0 && (
                                  <span className="text-accent-blue"> · {p.queued} queued</span>
                                )}
                                {p && p.failed > 0 && (
                                  <span className="text-danger"> · {p.failed} failed</span>
                                )}
                              </div>
                              <div>
                                {s.replied} replied ({Math.round(s.replyRate * 10) / 10}%)
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </button>
                    {open && (
                      <ul className="mt-3 space-y-2 rounded-lg bg-surface-muted p-3">
                        {c.recipients.map((r, i) => {
                          const p = nameById.get(r.prospectId);
                          // Opens are no longer tracked, so a recipient is
                          // either sent or has replied.
                          const status = r.replied ? "replied" : "sent";
                          return (
                            <li
                              key={`${r.prospectId}-${i}`}
                              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
                            >
                              <span className="truncate text-xs">
                                {p ? `${fullName(p)} · ${p.email}` : "Removed prospect"}
                              </span>
                              <Pill tone={status}>{status}</Pill>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <ConfirmDialog
        open={confirmSend}
        onOpenChange={setConfirmSend}
        title="Send this campaign?"
        description={`This sends real email. ${recipients.length} recipient${recipients.length === 1 ? "" : "s"} will receive "${template?.name ?? ""}" from ${settings.fromEmail || "your configured account"}. ${skipped} unsubscribed prospect${skipped === 1 ? "" : "s"} will be skipped.`}
        confirmLabel="Send now"
        onConfirm={() => {
          void send();
        }}
      />
    </AppLayout>
  );
}
