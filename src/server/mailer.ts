// Nodemailer wrapper. Server-only — SMTP speaks raw TCP, which a browser cannot.

import nodemailer, { type Transporter } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type Mail from "nodemailer/lib/mailer";

/**
 * Compiles a message to its raw MIME source.
 *
 * Sending this exact buffer and appending the same buffer to Sent guarantees
 * the copy in the mailbox is byte-identical to what the recipient received —
 * same Message-ID, same headers. Building it twice would not.
 */
export function buildRaw(mail: Mail.Options): Promise<Buffer> {
  return new MailComposer(mail).compile().build();
}

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

export function createTransport(cfg: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    // true = implicit TLS (465). false = plain connect then STARTTLS (587),
    // which `requireTLS` makes mandatory rather than opportunistic.
    secure: cfg.secure,
    requireTLS: !cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

const status = (err: unknown) => (err as { responseCode?: number })?.responseCode ?? 0;

/**
 * True when retrying cannot help. 5xx is permanent per RFC 5321; 4xx (including
 * IONOS throttling at 421/450/451) is worth another attempt later.
 */
export function isPermanentSmtpError(err: unknown): boolean {
  const code = status(err);
  return code >= 500 && code < 600;
}

/**
 * True when the *recipient* is bad, so the address belongs on the suppression
 * list. Deliberately narrower than `isPermanentSmtpError`: 535 is also a 5xx,
 * but it means our own credentials were rejected — suppressing the recipient
 * for that would blame the wrong party and quietly destroy the list.
 */
export function isHardBounce(err: unknown): boolean {
  const code = status(err);
  return code === 550 || code === 551 || code === 553;
}

type Provider = "zoho" | "ionos" | "google" | "microsoft" | "other";

/** The pool spans providers, so error advice has to follow the host. */
export function providerOf(host = ""): Provider {
  const h = host.toLowerCase();
  if (h.includes("zoho")) return "zoho";
  if (h.includes("ionos") || h.includes("1and1")) return "ionos";
  if (h.includes("gmail") || h.includes("google")) return "google";
  if (h.includes("office365") || h.includes("outlook")) return "microsoft";
  return "other";
}

const LABEL: Record<Provider, string> = {
  zoho: "Zoho",
  ionos: "IONOS",
  google: "Google",
  microsoft: "Microsoft",
  other: "The mail server",
};

/** What to do about a rejected login, which differs sharply by provider. */
const AUTH_HELP: Record<Provider, string> = {
  zoho:
    "Zoho requires an app-specific password for SMTP — your normal password will not work. " +
    "Create one at accounts.zoho.eu → Security → App Passwords, and paste that here. " +
    "Also confirm IMAP/SMTP access is enabled for this mailbox.",
  ionos:
    "Use the full email address as the username. IONOS requires an app password if " +
    "two-factor authentication is enabled on the account.",
  google:
    "Google needs an App Password, which requires 2-Step Verification to be on. " +
    "Your normal account password is always rejected for SMTP.",
  microsoft:
    "Microsoft has disabled SMTP basic authentication on most tenants. An admin must " +
    "re-enable SMTP AUTH for this mailbox, or the account cannot send this way.",
  other:
    "Use the full email address as the username. Many providers also require an " +
    "app-specific password rather than your normal one.",
};

/**
 * SMTP failures arrive as terse codes. Translate the ones a user can act on,
 * naming the provider actually being contacted — an error blaming the wrong
 * host sends people to the wrong control panel.
 */
export function friendlySmtpError(err: unknown, host?: string): string {
  const e = err as { code?: string; responseCode?: number; message?: string };
  const code = e?.code ?? "";
  const status = e?.responseCode ?? 0;
  const msg = e?.message ?? String(err);
  const provider = providerOf(host);
  const name = LABEL[provider];

  if (code === "EAUTH" || status === 535) {
    return `${name} rejected the username or password. ${AUTH_HELP[provider]}`;
  }
  if (code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ESOCKET") {
    return (
      `Could not reach ${host || "the SMTP server"}. Check the host and port — ` +
      "465 needs SSL/TLS, 587 needs STARTTLS. Some networks block outbound SMTP entirely."
    );
  }
  if (status === 550 || status === 551 || status === 553) {
    return (
      `${name} refused the sender address. The From address must be a mailbox that ` +
      "belongs to the account you authenticated with."
    );
  }
  if (status === 421 || status === 450 || status === 451 || /rate|too many/i.test(msg)) {
    return (
      `${name} is throttling this account — too many messages too quickly. ` +
      "Increase the delay between messages, or lower the daily limit, and try again later."
    );
  }
  return msg;
}
