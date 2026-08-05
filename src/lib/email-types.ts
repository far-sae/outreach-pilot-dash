// Shapes shared between the browser, the server functions, and the send worker.

/** A connected mailbox. Never carries the password. */
export type Mailbox = {
  id: string;
  label: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  sendDelayMs: number;
  /** Ceiling once warmup completes. */
  dailyLimit: number;
  warmupEnabled: boolean;
  warmupStartedOn: string | null;
  warmupStartVolume: number;
  warmupIncrement: number;
  isActive: boolean;
  pausedReason: string | null;
  consecutiveFailures: number;
  hasPassword: boolean;
  verifiedAt: string | null;
  lastReplyCheck: string | null;
  /** Today's allowance after the warmup ramp. */
  effectiveLimit: number;
  sentToday: number;
};

export type MailboxInput = {
  /** Omitted when creating. */
  id?: string;
  label: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  /** Blank leaves the stored password untouched. */
  smtpPassword: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  sendDelayMs: number;
  dailyLimit: number;
  warmupEnabled: boolean;
  warmupStartVolume: number;
  warmupIncrement: number;
  isActive: boolean;
};

export type QueueStats = {
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  skipped: number;
  cancelled: number;
};

export type PoolСapacityUnused = never;

export type PoolSummary = {
  mailboxes: number;
  activeMailboxes: number;
  /** Sum of today's remaining allowance across active mailboxes. */
  capacityToday: number;
  sentToday: number;
  queue: QueueStats;
};

export type EnqueueResult = {
  queued: number;
  suppressed: number;
  duplicates: number;
  capacityToday: number;
  /** Days to clear the queue at current pool capacity. */
  estimatedDays: number;
};

export type SendStatus = "sent" | "failed" | "skipped";

export type ReplyCheckResult = {
  scanned: number;
  matched: number;
  bounces: number;
  since: string;
};

export const IONOS_PRESETS = {
  "smtp.ionos.com": "IONOS (US / international)",
  "smtp.ionos.co.uk": "IONOS (UK)",
  "smtp.ionos.de": "IONOS (Germany)",
  "smtp.ionos.fr": "IONOS (France)",
  "smtp.ionos.es": "IONOS (Spain)",
} as const;

/** Common providers, so the pool is not limited to IONOS. */
export const SMTP_PRESETS: Record<
  string,
  { smtp: string; port: number; secure: boolean; imap: string }
> = {
  "IONOS (UK)": { smtp: "smtp.ionos.co.uk", port: 587, secure: false, imap: "imap.ionos.co.uk" },
  "IONOS (US)": { smtp: "smtp.ionos.com", port: 587, secure: false, imap: "imap.ionos.com" },
  "IONOS (DE)": { smtp: "smtp.ionos.de", port: 587, secure: false, imap: "imap.ionos.de" },
  "Google Workspace": { smtp: "smtp.gmail.com", port: 587, secure: false, imap: "imap.gmail.com" },
  "Microsoft 365": {
    smtp: "smtp.office365.com",
    port: 587,
    secure: false,
    imap: "outlook.office365.com",
  },
  // Zoho keeps EU accounts on separate hosts; using the .com servers with an EU
  // account fails authentication in a way that reads like a wrong password.
  "Zoho (EU)": { smtp: "smtp.zoho.eu", port: 465, secure: true, imap: "imap.zoho.eu" },
  "Zoho (US)": { smtp: "smtp.zoho.com", port: 465, secure: true, imap: "imap.zoho.com" },
  "Zoho (India)": { smtp: "smtp.zoho.in", port: 465, secure: true, imap: "imap.zoho.in" },
};

export const NEW_MAILBOX: MailboxInput = {
  label: "",
  fromName: "",
  fromEmail: "",
  replyTo: "",
  smtpHost: "smtp.ionos.co.uk",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
  imapHost: "imap.ionos.co.uk",
  imapPort: 993,
  imapSecure: true,
  sendDelayMs: 1200,
  dailyLimit: 40,
  warmupEnabled: true,
  warmupStartVolume: 5,
  warmupIncrement: 3,
  isActive: true,
};
