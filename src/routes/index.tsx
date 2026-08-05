import { createFileRoute, Link } from "@tanstack/react-router";
import {
  MessageSquareReply,
  AlertTriangle,
  MailX,
  Clock,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { AppLayout } from "@/components/app-layout";
import { CampaignChart, type CampaignPoint } from "@/components/campaign-chart";
import { Btn, EmptyState, Panel, PageHeader, Pill } from "@/components/ui-kit";
import { cn } from "@/lib/utils";
import { campaignStats, fullName, useOutreach } from "@/store/outreach-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Outreach Console" },
      {
        name: "description",
        content:
          "Cold email dashboard for solo founders: prospects, open and reply rates, campaign performance and replies that need attention.",
      },
      { property: "og:title", content: "Dashboard — Outreach Console" },
      {
        property: "og:description",
        content:
          "Track prospects, campaign performance and replies waiting on you in one clean cold email console.",
      },
    ],
  }),
  component: Dashboard,
});

const actionIcons: Record<
  "reply" | "warning" | "bounce" | "clock",
  { icon: LucideIcon; className: string; bg: string }
> = {
  reply: { icon: MessageSquareReply, className: "text-success", bg: "bg-success-tint" },
  warning: { icon: AlertTriangle, className: "text-warning", bg: "bg-warning-tint" },
  bounce: { icon: MailX, className: "text-danger", bg: "bg-danger-tint" },
  clock: { icon: Clock, className: "text-muted-foreground", bg: "bg-surface-muted" },
};

function Dashboard() {
  const { state } = useOutreach();
  const { prospects, groups, campaigns, settings } = state;

  const contactable = prospects.filter((p) => p.status === "active");
  const unsubscribed = prospects.length - contactable.length;

  const allRecipients = campaigns.flatMap((c) => c.recipients);
  const delivered = allRecipients.length;
  const replied = allRecipients.filter((r) => r.replied).length;
  const replyRate = delivered ? Math.round((replied / delivered) * 1000) / 10 : 0;

  const chartData: CampaignPoint[] = [...campaigns]
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    .slice(-6)
    .map((c) => {
      const s = campaignStats(c);
      // Opens are no longer tracked; replies are the real engagement signal.
      return { name: c.name, sent: s.delivered, replied: s.replied };
    });

  const groupRows = [
    ...groups.map((g) => ({
      id: g.id,
      name: g.name,
      count: prospects.filter((p) => p.groupId === g.id).length,
      unassigned: false,
    })),
    {
      id: "__unassigned",
      name: "Unassigned",
      count: prospects.filter((p) => p.groupId === null).length,
      unassigned: true,
    },
  ].filter((r) => !r.unassigned || r.count > 0);
  const maxGroup = Math.max(1, ...groupRows.map((g) => g.count));

  const missingPain = prospects.filter((p) => p.status === "active" && !p.painPoint.trim()).length;
  const lastCampaign = [...campaigns].sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
  const needsYou = [
    replied > 0 && {
      id: "replies",
      icon: "reply" as const,
      title: `${replied} ${replied === 1 ? "reply" : "replies"} waiting`,
      subtitle: "Across all campaign history",
      to: "/campaigns" as const,
    },
    missingPain > 0 && {
      id: "pain",
      icon: "warning" as const,
      title: `${missingPain} prospects missing a pain point`,
      subtitle: "Their emails fall back to generic copy",
      to: "/prospects" as const,
    },
    unsubscribed > 0 && {
      id: "unsub",
      icon: "bounce" as const,
      title: `${unsubscribed} unsubscribed`,
      subtitle: "Excluded from every send",
      to: "/prospects" as const,
    },
    lastCampaign && {
      id: "last",
      icon: "clock" as const,
      title: `${lastCampaign.name} was your last send`,
      subtitle: `${lastCampaign.recipients.length} recipients · daily cap ${settings.dailyCap}`,
      to: "/campaigns" as const,
    },
  ].filter(Boolean) as {
    id: string;
    icon: "reply" | "warning" | "bounce" | "clock";
    title: string;
    subtitle: string;
    to: "/prospects" | "/campaigns";
  }[];

  const byId = new Map(prospects.map((p) => [p.id, p]));
  const recentSends = campaigns
    .flatMap((c) => c.recipients.map((r) => ({ ...r, campaign: c.name })))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
    .slice(0, 8);

  const metrics = [
    {
      id: "prospects",
      label: "Prospects",
      value: String(prospects.length),
      delta: `${groups.length} groups`,
      to: "/prospects" as const,
    },
    {
      id: "contactable",
      label: "Contactable",
      value: String(contactable.length),
      delta: `${unsubscribed} unsubscribed`,
      to: "/prospects" as const,
    },
    {
      id: "delivered",
      label: "Emails sent",
      value: String(delivered),
      delta: `${campaigns.length} campaigns`,
      to: "/campaigns" as const,
    },
    {
      id: "reply",
      label: "Reply rate",
      value: `${replyRate}%`,
      delta: `${replied} replies`,
      to: "/campaigns" as const,
    },
  ];

  return (
    <AppLayout>
      <PageHeader
        title={`Good morning, ${settings.senderName.split(" ")[0] || "there"}`}
        subtitle={`${campaigns.length} campaigns sent · ${contactable.length} contactable prospects`}
        action={
          <Link to="/campaigns">
            <Btn variant="primary">
              <Plus className="h-4 w-4" strokeWidth={2} />
              New campaign
            </Btn>
          </Link>
        }
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => (
          <Link
            key={m.id}
            to={m.to}
            className="rounded-xl bg-surface-muted p-5 transition-colors hover:bg-muted"
          >
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p className="mt-2 font-mono text-3xl font-medium tracking-tight">{m.value}</p>
            <p className="mt-2 text-xs text-muted-foreground">{m.delta}</p>
          </Link>
        ))}
      </div>

      <div className="mt-6">
        <Panel
          title="Last six campaigns"
          action={
            <div className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-accent-blue" />
                Sent
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-success" />
                Opened
              </span>
            </div>
          }
        >
          {chartData.length ? (
            <CampaignChart data={chartData} />
          ) : (
            <EmptyState
              title="No campaigns yet"
              body="Send your first campaign to see performance here."
              action={
                <Link to="/campaigns">
                  <Btn variant="primary" size="sm">
                    New campaign
                  </Btn>
                </Link>
              }
            />
          )}
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel
          title="By group"
          action={
            <Link to="/groups" className="shrink-0 text-xs text-accent-blue hover:underline">
              Manage
            </Link>
          }
        >
          {groupRows.length ? (
            <ul className="space-y-4">
              {groupRows.map((g) => (
                <li key={g.id}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                    <span className="truncate text-sm">{g.name}</span>
                    <span className="font-mono text-sm text-muted-foreground">{g.count}</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        g.unassigned ? "bg-muted-foreground/40" : "bg-accent-blue",
                      )}
                      style={{ width: `${(g.count / maxGroup) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No groups yet"
              body="Group prospects by the angle you pitch them."
              action={
                <Link to="/groups">
                  <Btn size="sm" variant="primary">
                    Create a group
                  </Btn>
                </Link>
              }
            />
          )}
        </Panel>

        <Panel title="Needs you">
          {needsYou.length ? (
            <ul className="space-y-4">
              {needsYou.map((item) => {
                const conf = actionIcons[item.icon];
                const Icon = conf.icon;
                return (
                  <li key={item.id}>
                    <Link to={item.to} className="flex items-start gap-3 hover:opacity-80">
                      <span
                        className={cn(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                          conf.bg,
                        )}
                      >
                        <Icon className={cn("h-4 w-4", conf.className)} strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm">{item.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{item.subtitle}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="All clear" body="Nothing needs your attention right now." />
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel
          title="Recent sends"
          action={
            <Link to="/campaigns" className="shrink-0 text-xs text-accent-blue hover:underline">
              All campaigns
            </Link>
          }
        >
          {recentSends.length ? (
            <ul className="divide-y divide-border">
              {recentSends.map((s, i) => {
                const p = byId.get(s.prospectId);
                const status = s.replied ? "replied" : "sent";
                return (
                  <li
                    key={`${s.prospectId}-${i}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">{p ? fullName(p) : "Removed prospect"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p?.company || s.campaign}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        {new Date(s.sentAt).toLocaleDateString(undefined, {
                          day: "2-digit",
                          month: "short",
                        })}
                      </span>
                      <Pill tone={status}>{status}</Pill>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              title="No sends yet"
              body="Once you send a campaign, every delivery shows up here."
              action={
                <Link to="/campaigns">
                  <Btn size="sm" variant="primary">
                    Send a campaign
                  </Btn>
                </Link>
              }
            />
          )}
        </Panel>
      </div>
    </AppLayout>
  );
}
