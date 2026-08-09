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

/** Exported so previews can show the exact footer the send pipeline appends. */
export function footerText(o: BodyOptions) {
  const custom = o.unsubscribeText?.trim();

  // Custom wording is used exactly as written. If it contains {{unsubscribe}}
  // the link goes in; if it doesn't, no link is added.
  //
  // A URL in the footer is one of the few remaining marketing signals in an
  // otherwise plain message, and one-to-one email does not carry one. Opting
  // out by reply is still a genuine opt-out — the List-Unsubscribe mailto
  // header travels with every message regardless — so this is a real choice
  // between link-based and reply-based unsubscribe, not a way to omit one.
  if (custom) return applyUnsubscribe(custom, o.unsubscribeUrl);

  if (o.unsubscribeUrl) {
    return applyUnsubscribe(
      "If you would rather not hear from me, unsubscribe here: {{unsubscribe}}",
      o.unsubscribeUrl,
    );
  }

  return `Don't want to hear from me again? Reply with "unsubscribe" and I'll remove you${
    o.replyTo ? ` — ${o.replyTo}` : ""
  }.`;
}

export function buildTextBody(o: BodyOptions) {
  const body = cleanRedundantLinks(applyUnsubscribe(o.body, o.unsubscribeUrl));
  const signature = cleanRedundantLinks(applyUnsubscribe(o.signature, o.unsubscribeUrl)).trim();
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
    : `<p style="margin:0 0 16px">${br(cleanRedundantLinks(applyUnsubscribe(o.body, o.unsubscribeUrl)))}</p>`;

  // Rich versions win when present; otherwise the plain text is marked up.
  const richSignature = o.signatureHtml?.trim();
  const signatureMarkup = richSignature
    ? applyUnsubscribe(richSignature, o.unsubscribeUrl)
    : br(cleanRedundantLinks(applyUnsubscribe(o.signature, o.unsubscribeUrl)).trim());

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

/**
 * One link, rendered for plain text. "Book a meeting (https://…)" reads fine,
 * but when the visible text already is the address — the common case for
 * typed-out links and email addresses — repeating it in parentheses produces
 * the "www.x.com (http://www.x.com/)" noise cold-mail readers notice.
 */
const canonUrl = (s: string) =>
  s
    .toLowerCase()
    // Link text often carries the brackets the user typed around it —
    // "(https://x.com)" is still the same address as https://x.com.
    .replace(/^[(<[]+/, "")
    .replace(/[)>\]]+$/, "")
    .replace(/^mailto:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");

function plainLink(href: string, innerHtml: string) {
  const text = innerHtml
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
  // An anchor with no visible text is invisible in the editor; writing its
  // href out would conjure text the user cannot see or delete.
  if (!text) return "";
  const target = href.replace(/^mailto:/i, "").trim();
  if (canonUrl(text) === canonUrl(target)) return text;
  return `${text} (${target})`;
}

/**
 * Strips the duplicated-address forms older conversions baked into saved
 * signatures and bodies: "x (mailto:x)" / "www.x.com (http://www.x.com/)"
 * pairs, and the same address repeated back-to-back ("urlurl", "url url").
 * A pair only collapses when both sides are the same address, so real
 * parentheticals and lists of different links are left alone. Run on stored
 * plain text before showing or sending it, since old rows still carry the
 * duplicated forms.
 */
export function cleanRedundantLinks(text: string) {
  // A URL, a www. address, a mailto:, or a bare email address.
  const addr = "(?:mailto:|https?:\\/\\/|www\\.)[^)\\s]*|[^\\s()<>\\[\\]]+@[^\\s()<>\\[\\]]+";
  // "addr (addr)" — the before side may itself be wrapped in brackets.
  const parenPair = new RegExp(
    `([(<\\[]?(?:${addr})[)>\\]]?)\\s*\\(\\s*(${addr})\\s*\\)`,
    "gi",
  );
  const repeated = /((?:mailto:|https?:\/\/|www\.)\S+?)(\s*)\1(?=[\s).,]|$)/gi;
  const parenFirst = /\(\s*((?:mailto:|https?:\/\/|www\.)[^)\s]*)\s*\)\s*\1(?=[\s).,]|$)/gi;
  let out = text;
  let prev;
  do {
    prev = out;
    out = out
      .replace(parenPair, (match, before: string, inside: string) =>
        canonUrl(before) === canonUrl(inside) ? before : match,
      )
      .replace(repeated, "$1")
      .replace(parenFirst, "$1");
  } while (out !== prev);
  return out;
}

/** Rough plain-text fallback derived from rich HTML, for the text/plain part. */
export function htmlToText(html: string) {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    // \shref= keeps attributes like data-saferedirecturl= (pasted from Gmail)
    // from being read as the link target.
    .replace(/<a[^>]*\shref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) =>
      plainLink(href, inner),
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Content pasted from a received copy of an old email can carry the
  // duplicated address forms inside the HTML itself.
  return cleanRedundantLinks(text);
}
