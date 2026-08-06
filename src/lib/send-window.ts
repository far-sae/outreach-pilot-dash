// Working-hours gate for sending.
//
// A cold email arriving at 03:00 local time reads as automated, and both the
// recipient and the filter notice. Restricting sends to working hours in the
// sender's own zone is a small change with a real effect on how mail is
// received. Pure functions so the rule can be reasoned about in one place.

export type SendWindow = {
  enabled: boolean;
  /** Hours 0–23, inclusive start, exclusive end. */
  startHour: number;
  endHour: number;
  /** ISO weekdays permitted, 1 = Monday … 7 = Sunday. */
  days: number[];
  /** IANA zone, e.g. "Europe/London". */
  timezone: string;
};

/** Hour (0–23) and ISO weekday (1–7) for an instant, in a given zone. */
function zonedParts(at: Date, timezone: string): { hour: number; isoDay: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
      weekday: "short",
    }).formatToParts(at);
  } catch {
    // An invalid zone must not stop sending altogether; fall back to UTC.
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      hour12: false,
      weekday: "short",
    }).formatToParts(at);
  }

  const hourText = parts.find((p) => p.type === "hour")?.value ?? "0";
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

  return {
    // "24" appears at midnight in some locales.
    hour: Number(hourText) % 24,
    isoDay: map[weekday] ?? 1,
  };
}

export function isWithinSendWindow(window: SendWindow, at: Date = new Date()): boolean {
  if (!window.enabled) return true;
  const { hour, isoDay } = zonedParts(at, window.timezone);
  if (!window.days.includes(isoDay)) return false;
  return hour >= window.startHour && hour < window.endHour;
}

/** Human-readable reason, for the blocked message in the UI. */
export function describeSendWindow(window: SendWindow, at: Date = new Date()): string {
  const { hour, isoDay } = zonedParts(at, window.timezone);
  const names = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  if (!window.days.includes(isoDay)) {
    return `Outside the sending window — ${names[isoDay]} is not a sending day (${window.timezone}).`;
  }
  return (
    `Outside the sending window — it is ${String(hour).padStart(2, "0")}:00 in ` +
    `${window.timezone}, and sending runs ${String(window.startHour).padStart(2, "0")}:00–` +
    `${String(window.endHour).padStart(2, "0")}:00. Queued mail resumes automatically.`
  );
}
