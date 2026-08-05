// Reply detection. IONOS offers no inbound webhook, so the only way to know a
// prospect replied is to read the mailbox over IMAP and match senders against
// what was sent. Server-only.

import { ImapFlow } from "imapflow";

export type ImapConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

export type IncomingMessage = { email: string; at: Date };

/**
 * Builds a client with an `error` listener already attached.
 *
 * ImapFlow is an EventEmitter, and Node terminates the process on an 'error'
 * event that nobody is listening for. Those arrive asynchronously — a socket
 * timeout, a dropped TLS connection — so the try/catch around `connect()` never
 * sees them. Without this listener a stalled IMAP connection kills the server.
 *
 * The listener only records: the awaited calls still reject, and the callers
 * turn that into a normal error.
 */
function createImapClient(cfg: ImapConfig): ImapFlow {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
    socketTimeout: 30_000,
    greetingTimeout: 15_000,
  });

  client.on("error", (err: unknown) => {
    console.error(`imap connection error (${cfg.host}):`, err instanceof Error ? err.message : err);
  });

  return client;
}

/**
 * Envelope senders of INBOX messages received since `since`. Envelopes only —
 * bodies are never downloaded, which keeps this fast and avoids pulling message
 * content into the app.
 */
export async function fetchRecentSenders(
  cfg: ImapConfig,
  since: Date,
  limit = 500,
): Promise<IncomingMessage[]> {
  const client = createImapClient(cfg);

  const out: IncomingMessage[] = [];
  await client.connect();

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const msg of client.fetch({ since }, { envelope: true })) {
        const from = msg.envelope?.from?.[0]?.address;
        if (!from) continue;
        out.push({
          email: from.toLowerCase(),
          at: msg.envelope?.date ?? new Date(),
        });
        if (out.length >= limit) break;
      }
    } finally {
      lock.release();
    }
  } finally {
    // logout() can throw on an already-dropped socket; the scan still succeeded.
    await client.logout().catch(() => client.close());
  }

  return out;
}

/**
 * Files copies of sent messages into the mailbox's Sent folder.
 *
 * SMTP only hands a message to the server for delivery — it never puts a copy
 * anywhere. Mail clients do this themselves, which is why messages sent by an
 * app appear nowhere in webmail unless it appends them explicitly.
 *
 * One connection for the whole batch: opening an IMAP session per message would
 * cost more than the send itself.
 */
export async function appendToSent(
  cfg: ImapConfig,
  preferredFolder: string,
  messages: Buffer[],
): Promise<number> {
  if (messages.length === 0) return 0;

  const client = createImapClient(cfg);

  let saved = 0;
  await client.connect();

  try {
    // Providers disagree on the name — IONOS uses "Sent", Gmail
    // "[Gmail]/Sent Mail". The \Sent special-use flag is the reliable answer.
    let folder = preferredFolder || "Sent";
    try {
      for (const box of await client.list()) {
        if (box.specialUse === "\\Sent") {
          folder = box.path;
          break;
        }
      }
    } catch {
      /* fall back to the configured name */
    }

    for (const raw of messages) {
      try {
        await client.append(folder, raw, ["\\Seen"]);
        saved += 1;
      } catch (err) {
        console.error("could not append to", folder, err);
        break; // A folder-level failure will repeat for every message.
      }
    }
  } finally {
    await client.logout().catch(() => client.close());
  }

  return saved;
}

const BOUNCE_SENDERS = /(mailer-daemon|postmaster|no-?reply.*bounce)/i;

/** `Final-Recipient: rfc822; someone@example.com` in a delivery status notification. */
const FINAL_RECIPIENT = /final-recipient:\s*rfc822;\s*<?([^\s<>;]+@[^\s<>;]+)>?/i;
/** Fallback: `<someone@example.com>: ... 550 ...` in a human-readable bounce. */
const INLINE_FAILURE = /<([^\s<>]+@[^\s<>]+)>[^\n]{0,120}?\b5\d\d\b/i;

/**
 * Addresses that permanently failed, read from bounce messages in the INBOX.
 *
 * A relay like IONOS accepts a message and only later discovers the recipient
 * does not exist, so those failures arrive as a separate email rather than as
 * an SMTP error. Only messages that look like bounces are downloaded.
 */
export async function fetchBouncedAddresses(
  cfg: ImapConfig,
  since: Date,
  limit = 200,
): Promise<string[]> {
  const client = createImapClient(cfg);

  const found = new Set<string>();
  await client.connect();

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      let seen = 0;
      for await (const msg of client.fetch({ since }, { envelope: true, source: true })) {
        if (seen >= limit) break;
        const from = msg.envelope?.from?.[0]?.address ?? "";
        const subject = msg.envelope?.subject ?? "";
        const looksLikeBounce =
          BOUNCE_SENDERS.test(from) || /undeliverable|delivery status|returned mail/i.test(subject);
        if (!looksLikeBounce) continue;

        seen += 1;
        const source = msg.source?.toString("utf8") ?? "";
        const hit = FINAL_RECIPIENT.exec(source) ?? INLINE_FAILURE.exec(source);
        if (hit?.[1]) found.add(hit[1].toLowerCase());
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }

  return [...found];
}

export function friendlyImapError(err: unknown, host?: string): string {
  const e = err as { code?: string; authenticationFailed?: boolean; message?: string };
  const msg = e?.message ?? String(err);
  const h = (host ?? "").toLowerCase();
  const name = h.includes("zoho")
    ? "Zoho"
    : h.includes("ionos")
      ? "IONOS"
      : h.includes("google") || h.includes("gmail")
        ? "Google"
        : "The IMAP server";

  if (e?.authenticationFailed || /auth/i.test(msg)) {
    const extra = h.includes("zoho")
      ? "Zoho needs an app-specific password and IMAP access enabled for the mailbox."
      : "Use the full email address as the username, and an app password if two-factor is on.";
    return `${name} rejected the IMAP login. ${extra}`;
  }
  if (/timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(msg) || e?.code === "ETIMEDOUT") {
    return (
      `Could not reach ${host || "the IMAP server"} — port 993 with SSL/TLS is standard. ` +
      "Some networks block IMAP."
    );
  }
  return msg;
}
