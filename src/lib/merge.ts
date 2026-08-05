// Merge-tag rendering and message bodies, kept free of React imports so the send
// pipeline on the server renders exactly what the preview in the browser shows.

import type { Prospect } from "@/data/outreach";

export function mergeCopy(text: string, p: Prospect | null) {
  return text.replace(/\{\{(first|last|company|pain|email)\}\}/g, (_m, tag: string) => {
    if (!p) return `{{${tag}}}`;
    switch (tag) {
      case "first":
        return p.firstName || "there";
      case "last":
        return p.lastName;
      case "company":
        return p.company || "your team";
      case "pain":
        return p.painPoint || "the usual admin drag";
      default:
        return p.email;
    }
  });
}

/** Resolves {{unsubscribe}} wherever it appears — body, signature, or footer. */
export function applyUnsubscribe(text: string, url: string | undefined) {
  if (!text.includes("{{unsubscribe}}")) return text;
  return text.replace(/\{\{unsubscribe\}\}/g, url ?? "");
}

export const hasUnsubscribeTag = (text: string) => text.includes("{{unsubscribe}}");

export type BodyOptions = {
  /** Plain-text body, already merged. Always the source for text/plain. */
  body: string;
  /** Rich body. Ignored in plain mode. */
  bodyHtml?: string | undefined;
  signature: string;
  /** Rich signature. Ignored in plain mode; falls back to `signature`. */
  signatureHtml?: string | undefined;
  unsubscribeUrl?: string | undefined;
  /** Footer wording; may contain {{unsubscribe}}. */
  unsubscribeText?: string | undefined;
  /** Rich footer. Ignored in plain mode; falls back to `unsubscribeText`. */
  unsubscribeHtml?: string | undefined;
  replyTo?: string | undefined;
  /**
   * Sends text/plain only, with no pixel. A remote image and styled HTML are
   * two of Gmail's strongest Promotions signals, so this is what keeps cold
   * outreach in the Primary tab.
   */
  plainOnly?: boolean | undefined;
};

function footerText(o: BodyOptions) {
  if (o.unsubscribeUrl) {
    const wording = o.unsubscribeText?.trim()
      ? o.unsubscribeText
      : "If you would rather not hear from me, unsubscribe here: {{unsubscribe}}";
    // Wording without the tag still needs the link appended, or the footer
    // would promise an unsubscribe and not provide one.
    const withTag = hasUnsubscribeTag(wording) ? wording : `${wording} {{unsubscribe}}`;
    return applyUnsubscribe(withTag, o.unsubscribeUrl);
  }
  return `Don't want to hear from me again? Reply with "unsubscribe" and I'll remove you${
    o.replyTo ? ` — ${o.replyTo}` : ""
  }.`;
}

export function buildTextBody(o: BodyOptions) {
  const body = applyUnsubscribe(o.body, o.unsubscribeUrl);
  const signature = applyUnsubscribe(o.signature, o.unsubscribeUrl).trim();
  return [body, signature ? `--\n${signature}` : "", footerText(o)].filter(Boolean).join("\n\n");
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const br = (s: string) => escapeHtml(s).replace(/\n/g, "<br>");

/** Returns undefined in plain mode, so nodemailer sends no HTML part at all. */
export function buildHtmlBody(o: BodyOptions): string | undefined {
  if (o.plainOnly) return undefined;

  const rich = o.bodyHtml?.trim();
  const bodyMarkup = rich
    ? applyUnsubscribe(rich, o.unsubscribeUrl)
    : `<p style="margin:0 0 16px">${br(applyUnsubscribe(o.body, o.unsubscribeUrl))}</p>`;

  // Rich versions win when present; otherwise the plain text is marked up.
  const richSignature = o.signatureHtml?.trim();
  const signatureMarkup = richSignature
    ? applyUnsubscribe(richSignature, o.unsubscribeUrl)
    : br(applyUnsubscribe(o.signature, o.unsubscribeUrl).trim());

  const richFooter = o.unsubscribeHtml?.trim();
  const footer = richFooter
    ? applyUnsubscribe(
        hasUnsubscribeTag(richFooter)
          ? richFooter
          : `${richFooter} <a href="${escapeHtml(o.unsubscribeUrl ?? "")}">Unsubscribe</a>`,
        o.unsubscribeUrl,
      )
    : o.unsubscribeUrl
      ? `Don't want these emails? <a href="${escapeHtml(o.unsubscribeUrl)}" style="color:#8A97A5">Unsubscribe</a>.`
      : escapeHtml(footerText(o));

  return [
    `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#0B1520">`,
    bodyMarkup,
    signatureMarkup
      ? `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #E4E9EF;color:#5B6B7C;font-size:13px">${signatureMarkup}</div>`
      : "",
    `<div style="margin-top:16px;color:#8A97A5;font-size:12px">${footer}</div>`,
    // No tracking pixel. A remote image is the strongest single Promotions
    // signal there is, and most clients block it anyway.
    `</div>`,
  ]
    .filter(Boolean)
    .join("");
}

/** Seeds the rich editor from a template that only ever had plain text. */
export function textToHtml(text: string) {
  if (!text.trim()) return "";
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${br(p)}</p>`)
    .join("");
}

/** Rough plain-text fallback derived from rich HTML, for the text/plain part. */
export function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
