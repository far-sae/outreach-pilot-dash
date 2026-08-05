import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Btn, Panel } from "@/components/ui-kit";
import { checkDeliverability, type DomainAuthReport } from "@/server/email.functions";

/**
 * SPF / DKIM / DMARC status for the sending domain.
 *
 * These three decide whether a mailbox provider trusts the message at all. They
 * live in DNS, not in this app, so nothing here can fix them — but leaving them
 * broken and unseen is how mail silently ends up in Promotions.
 */
export function DeliverabilityCheck() {
  const check = useServerFn(checkDeliverability);
  const [report, setReport] = useState<DomainAuthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await check({ data: {} }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [check]);

  useEffect(() => {
    void run();
  }, [run]);

  const rows = report
    ? [
        { key: "SPF", label: "Sender authorised", ...report.spf },
        { key: "DKIM", label: "Messages signed", ...report.dkim },
        { key: "DMARC", label: "Policy published", ...report.dmarc },
      ]
    : [];

  const failing = rows.filter((r) => !r.ok).length;

  return (
    <Panel
      title="Domain authentication"
      action={
        <Btn size="sm" onClick={() => void run()} disabled={loading}>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Re-check
        </Btn>
      }
    >
      {loading && !report ? (
        <p className="text-sm text-muted-foreground">Checking DNS…</p>
      ) : error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : report ? (
        <>
          <p className="-mt-1 text-xs text-muted-foreground">
            Checked <span className="font-mono">{report.domain}</span>
            {report.mx.length > 0 && <> · mail hosted at {report.mx[0]}</>}
          </p>

          <ul className="mt-4 space-y-3">
            {rows.map((r) => (
              <li key={r.key} className="flex items-start gap-2.5">
                {r.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {r.key} <span className="font-normal text-muted-foreground">— {r.label}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{r.detail}</p>
                  {r.value && (
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {r.value}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {failing > 0 && (
            <div className="mt-5 rounded-lg bg-warning-tint p-4">
              <p className="text-xs font-medium text-warning">
                {failing} of 3 failing — this is the main reason mail lands in Promotions.
              </p>
              <p className="mt-2 text-xs text-warning">
                Fix both in your DNS host, then re-check here. DNS can take an hour or two to
                propagate.
              </p>
              <ul className="mt-3 space-y-2 text-xs text-warning">
                {!report.dkim.ok && (
                  <li>
                    <strong>DKIM:</strong> turn on DKIM signing for this domain in your mail host's
                    control panel. If the host also runs your DNS, it publishes the keys itself.
                  </li>
                )}
                {!report.dmarc.ok && (
                  <li>
                    <strong>DMARC:</strong> add a TXT record at{" "}
                    <span className="font-mono">_dmarc</span> with the value{" "}
                    <span className="font-mono">
                      v=DMARC1; p=none; rua=mailto:postmaster@{report.domain}
                    </span>
                    . Start at <span className="font-mono">p=none</span> so nothing is rejected
                    while you watch the reports.
                  </li>
                )}
              </ul>
            </div>
          )}

          {failing === 0 && (
            <p className="mt-4 text-xs text-success">
              All three pass. Remaining Promotions placement comes down to content and recipient
              engagement rather than authentication.
            </p>
          )}
        </>
      ) : null}
    </Panel>
  );
}
