import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** `replied` was `opened` until open tracking was removed. */
export type CampaignPoint = { name: string; sent: number; replied: number };

export function CampaignChart({ data }: { data: CampaignPoint[] }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="h-72 w-full min-w-[520px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 22, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              interval={0}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={44}
              allowDecimals={false}
              tick={{
                fontSize: 11,
                fill: "var(--muted-foreground)",
                fontFamily: "var(--font-mono)",
              }}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-muted)" }}
              contentStyle={{
                borderRadius: 10,
                border: "1px solid var(--border)",
                fontSize: 12,
                boxShadow: "none",
              }}
            />
            <Bar
              dataKey="sent"
              name="Sent"
              fill="var(--accent-blue)"
              radius={[3, 3, 0, 0]}
              barSize={16}
              isAnimationActive={false}
              label={{ position: "top", offset: 8, fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <Bar
              dataKey="replied"
              name="Replied"
              fill="var(--success)"
              radius={[3, 3, 0, 0]}
              barSize={16}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
