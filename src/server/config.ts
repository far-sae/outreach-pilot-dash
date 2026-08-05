import { getRequestHeader } from "@tanstack/react-start/server";

/**
 * Public base URL used to build tracking and unsubscribe links.
 *
 * Set APP_URL in .env once the app is deployed — links are opened from a
 * recipient's mail client, which cannot resolve localhost. Falls back to the
 * origin of the request that triggered the send, which is right for local
 * testing but not for real recipients.
 */
export function getAppUrl(): string {
  const configured = typeof process !== "undefined" ? process.env["APP_URL"] : undefined;
  if (configured) return configured.replace(/\/+$/, "");

  const origin = getRequestHeader("origin");
  if (origin) return origin.replace(/\/+$/, "");

  const host = getRequestHeader("host");
  if (host) {
    const local = host.startsWith("localhost") || host.startsWith("127.0.0.1");
    return `${local ? "http" : "https"}://${host}`;
  }

  return "http://localhost:5173";
}

/** True when links point at a host only this machine can reach. */
export function isLocalUrl(url: string) {
  return url.includes("localhost") || url.includes("127.0.0.1");
}
