// Row shapes as they exist in Postgres (snake_case), plus mappers to and from
// the camelCase types the UI uses. Keeping the translation in one file means
// `outreach-store.tsx` never deals with column names directly.

import type { Campaign, Group, Prospect, Recipient, Settings, Template } from "@/data/outreach";

export type GroupRow = {
  id: string;
  user_id: string;
  name: string;
  angle: string;
};

export type TemplateRow = {
  id: string;
  user_id: string;
  name: string;
  subject: string;
  body: string;
  body_html: string;
  updated_at: string;
};

export type ProspectRow = {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  company: string;
  pain_point: string;
  group_id: string | null;
  status: "active" | "unsubscribed";
  created_at: string;
};

export type CampaignRow = {
  id: string;
  user_id: string;
  name: string;
  group_id: string | null;
  template_id: string | null;
  sent_at: string;
};

export type RecipientRow = {
  campaign_id: string;
  prospect_id: string;
  user_id: string;
  status: string;
  opened: boolean;
  replied: boolean;
  sent_at: string;
};

export type SettingsRow = {
  user_id: string;
  sender_name: string;
  from_email: string;
  reply_to: string;
  daily_cap: number;
  signature: string;
  signature_html: string;
  unsubscribe_html: string;
  plain_text_mode: boolean;
  unsubscribe_text: string;
};

/* ------------------------------------------------------------ row -> app ---- */

export const toGroup = (r: GroupRow): Group => ({
  id: r.id,
  name: r.name,
  angle: r.angle,
});

export const toTemplate = (r: TemplateRow): Template => ({
  id: r.id,
  name: r.name,
  subject: r.subject,
  body: r.body,
  bodyHtml: r.body_html ?? "",
  updatedAt: r.updated_at,
});

export const toProspect = (r: ProspectRow): Prospect => ({
  id: r.id,
  firstName: r.first_name,
  lastName: r.last_name,
  email: r.email,
  company: r.company,
  painPoint: r.pain_point,
  groupId: r.group_id,
  status: r.status,
  createdAt: r.created_at,
});

export const toRecipient = (r: RecipientRow): Recipient => ({
  prospectId: r.prospect_id,
  status: "sent",
  opened: r.opened,
  replied: r.replied,
  sentAt: r.sent_at,
});

// `template_id` is nullable in the database (a deleted template must not delete
// the campaign), but the UI type is a plain string.
export const toCampaign = (r: CampaignRow, recipients: Recipient[]): Campaign => ({
  id: r.id,
  name: r.name,
  groupId: r.group_id,
  templateId: r.template_id ?? "",
  sentAt: r.sent_at,
  recipients,
});

export const toSettings = (r: SettingsRow): Settings => ({
  senderName: r.sender_name,
  fromEmail: r.from_email,
  replyTo: r.reply_to,
  dailyCap: r.daily_cap,
  signature: r.signature,
  signatureHtml: r.signature_html ?? "",
  unsubscribeHtml: r.unsubscribe_html ?? "",
  plainTextMode: r.plain_text_mode ?? true,
  unsubscribeText: r.unsubscribe_text ?? "",
});

/* ------------------------------------------------------------ app -> row ---- */

export const fromGroup = (g: Group, userId: string): GroupRow => ({
  id: g.id,
  user_id: userId,
  name: g.name,
  angle: g.angle,
});

export const fromTemplate = (t: Template, userId: string): TemplateRow => ({
  id: t.id,
  user_id: userId,
  name: t.name,
  subject: t.subject,
  body: t.body,
  body_html: t.bodyHtml ?? "",
  updated_at: t.updatedAt,
});

export const fromProspect = (p: Prospect, userId: string): ProspectRow => ({
  id: p.id,
  user_id: userId,
  first_name: p.firstName,
  last_name: p.lastName,
  email: p.email,
  company: p.company,
  pain_point: p.painPoint,
  group_id: p.groupId,
  status: p.status,
  created_at: p.createdAt,
});

export const fromCampaign = (c: Campaign, userId: string): CampaignRow => ({
  id: c.id,
  user_id: userId,
  name: c.name,
  group_id: c.groupId,
  template_id: c.templateId || null,
  sent_at: c.sentAt,
});

export const fromRecipient = (r: Recipient, campaignId: string, userId: string): RecipientRow => ({
  campaign_id: campaignId,
  prospect_id: r.prospectId,
  user_id: userId,
  status: r.status,
  opened: r.opened,
  replied: r.replied,
  sent_at: r.sentAt,
});

export const fromSettings = (s: Settings, userId: string): SettingsRow => ({
  user_id: userId,
  sender_name: s.senderName,
  from_email: s.fromEmail,
  reply_to: s.replyTo,
  daily_cap: s.dailyCap,
  signature: s.signature,
  signature_html: s.signatureHtml ?? "",
  unsubscribe_html: s.unsubscribeHtml ?? "",
  plain_text_mode: s.plainTextMode,
  unsubscribe_text: s.unsubscribeText,
});

// Partial patches need column-by-column translation so `update()` only touches
// the fields the caller actually changed.
export function prospectPatchToRow(patch: Partial<Prospect>): Partial<ProspectRow> {
  const row: Partial<ProspectRow> = {};
  if (patch.firstName !== undefined) row.first_name = patch.firstName;
  if (patch.lastName !== undefined) row.last_name = patch.lastName;
  if (patch.email !== undefined) row.email = patch.email;
  if (patch.company !== undefined) row.company = patch.company;
  if (patch.painPoint !== undefined) row.pain_point = patch.painPoint;
  if (patch.groupId !== undefined) row.group_id = patch.groupId;
  if (patch.status !== undefined) row.status = patch.status;
  return row;
}

export function groupPatchToRow(patch: Partial<Group>): Partial<GroupRow> {
  const row: Partial<GroupRow> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.angle !== undefined) row.angle = patch.angle;
  return row;
}

export function templatePatchToRow(patch: Partial<Template>, updatedAt: string) {
  const row: Partial<TemplateRow> = { updated_at: updatedAt };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.subject !== undefined) row.subject = patch.subject;
  if (patch.body !== undefined) row.body = patch.body;
  if (patch.bodyHtml !== undefined) row.body_html = patch.bodyHtml;
  return row;
}
