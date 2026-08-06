import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";

import { Btn, Panel } from "@/components/ui-kit";
import type { TemplateStats } from "@/lib/email-types";
import { getTemplateStats } from "@/server/email.functions";

/**
 * Reply rate per template.
 *
 * Reply rate is the only outcome that matters for cold outreach, and comparing
 * templates is the only way to improve it deliberately rather than by feel.
 */
export function TemplateStatsPanel() {
  const load = useServerFn(getTemplateStats);
  const [rows, setRows] = useState<TemplateStats[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await load({ data: undefined }));
    } catch {
      // Non-critical: the panel simply stays empty.
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const withSends = rows.filter((r) => r.sent > 0);
  const best = withSends.reduce<TemplateStats | null>(
    (top, r) => (!top || r.replyRate > top.replyRate ? r : top),
    null,
  );

  return (
    <Panel
      title="Template performance"
      action={
        <Btn size="sm" onClick={() => void refresh()} disabled={loading}>
          Refresh
        </Btn>
      }
    >
      {loading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : withSends.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing sent yet. Once campaigns go out, reply rates appear here so templates can be
          compared.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Template</th>
                  <th className="pb-2 text-right font-medium">Sent</th>
                  <th className="pb-2 text-right font-medium">Replied</th>
                  <th className="pb-2 text-right font-medium">Reply rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {withSends.map((r) => (
                  <tr key={r.templateId}>
                    <td className="py-2 pr-3">{r.templateName}</td>
                    <td className="py-2 text-right font-mono">{r.sent}</td>
                    <td className="py-2 text-right font-mono">{r.replied}</td>
                    <td className="py-2 text-right font-mono">
                      <span className={r.replyRate >= 3 ? "text-success" : ""}>{r.replyRate}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {best && best.sent >= 20 && (
            <p className="mt-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{best.templateName}</span> is leading at{" "}
              {best.replyRate}%. Treat anything under about 30 sends as noise rather than a result.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
