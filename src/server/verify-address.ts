// Pre-send address checks.
//
// Bought and scraped lists routinely contain 10–30% dead addresses. Sending to
// them produces hard bounces, and a bounce rate above roughly 2% gets a sender
// throttled — so a dead address costs far more than the one wasted message.
//
// A full mailbox check needs a paid verification API. A domain check is free,
// catches the largest single category (typo'd and defunct domains), and never
// produces a false negative on a live domain.

import { promises as dns } from "node:dns";

/** Per-process cache: one lookup per domain, not per recipient. */
const cache = new Map<string, boolean>();

export function domainOfEmail(email: string): string {
  return email.split("@")[1]?.trim().toLowerCase() ?? "";
}

/**
 * Whether a domain can receive mail at all.
 *
 * MX is the usual answer. A domain with no MX but an A record still accepts
 * mail per RFC 5321 §5.1, so that counts too — treating those as dead would
 * wrongly suppress valid recipients.
 */
export async function domainAcceptsMail(domain: string): Promise<boolean> {
  const key = domain.toLowerCase();
  if (!key || !key.includes(".")) return false;

  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let ok = false;
  try {
    ok = (await dns.resolveMx(key)).length > 0;
  } catch {
    try {
      ok = (await dns.resolve4(key)).length > 0;
    } catch {
      ok = false;
    }
  }

  cache.set(key, ok);
  return ok;
}
