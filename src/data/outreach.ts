// Shared types + first-run seed data for Outreach Console (frontend only).

export type Prospect = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  painPoint: string;
  groupId: string | null;
  status: "active" | "unsubscribed";
  createdAt: string;
};

export type Group = { id: string; name: string; angle: string };

export type Template = {
  id: string;
  name: string;
  subject: string;
  /** Plain text. Always the source for the text/plain part. */
  body: string;
  /** Rich HTML from the editor. Empty means the template is plain-text only. */
  bodyHtml: string;
  updatedAt: string;
};

export type Recipient = {
  prospectId: string;
  status: "sent";
  opened: boolean;
  replied: boolean;
  sentAt: string;
};

export type Campaign = {
  id: string;
  name: string;
  groupId: string | null;
  templateId: string;
  sentAt: string;
  recipients: Recipient[];
};

export type Settings = {
  senderName: string;
  fromEmail: string;
  replyTo: string;
  dailyCap: number;
  signature: string;
  /** Rich signature. Falls back to the plain one when empty. */
  signatureHtml: string;
  /** Rich unsubscribe footer. Falls back to the plain one when empty. */
  unsubscribeHtml: string;
  /** text/plain only — what keeps cold mail out of Promotions. */
  plainTextMode: boolean;
  /** Footer wording; may contain {{unsubscribe}}. */
  unsubscribeText: string;
  /** Restrict sending to working hours — mail at 03:00 reads as automated. */
  sendWindowEnabled: boolean;
  /** Hours, 0–23, in `sendTimezone`. */
  sendWindowStart: number;
  sendWindowEnd: number;
  /** ISO weekdays permitted, 1 = Monday. */
  sendDays: number[];
  /** IANA zone the window is evaluated in. */
  sendTimezone: string;
  /** Percentage of hard bounces that pauses a mailbox automatically. */
  maxBounceRate: number;
  /** Sends required before the bounce rate is trusted enough to act on. */
  minSendsBeforePause: number;
};

export type OutreachState = {
  prospects: Prospect[];
  groups: Group[];
  templates: Template[];
  campaigns: Campaign[];
  settings: Settings;
};

export const MERGE_TAGS = ["first", "last", "company", "pain", "email", "unsubscribe"] as const;
export type MergeTag = (typeof MERGE_TAGS)[number];

export function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const seedGroups: Group[] = [
  { id: "grp_law", name: "Law firms — London", angle: "Slow client intake and manual paperwork" },
  { id: "grp_acct", name: "Accountancy practices", angle: "Busy season capacity crunch" },
  { id: "grp_retail", name: "Retail and hospitality", angle: "Rota chaos and staff churn" },
];

type SeedRow = [string, string, string, string, string, string | null, "active" | "unsubscribed"];

const seedRows: SeedRow[] = [
  [
    "Daniel",
    "Osei",
    "daniel@harborviewlaw.co.uk",
    "Harborview Law",
    "intake forms still arrive by fax",
    "grp_law",
    "active",
  ],
  [
    "Amara",
    "Okonjo",
    "amara@northgatelegal.com",
    "Northgate Legal",
    "paralegals lose hours to admin",
    "grp_law",
    "active",
  ],
  [
    "Ruth",
    "Callaghan",
    "ruth@pemberton-solicitors.co.uk",
    "Pemberton Solicitors",
    "",
    "grp_law",
    "active",
  ],
  [
    "James",
    "Whitfield",
    "james@lockemarsh.co.uk",
    "Locke & Marsh",
    "new matters take a week to open",
    "grp_law",
    "unsubscribed",
  ],
  [
    "Tom",
    "Rutherford",
    "tom@brecklandaudit.com",
    "Breckland Audit",
    "January workload doubles overnight",
    "grp_acct",
    "active",
  ],
  [
    "Sara",
    "Lindqvist",
    "sara@holtandco.co.uk",
    "Holt & Co",
    "chasing clients for records",
    "grp_acct",
    "active",
  ],
  [
    "Michael",
    "Ferreira",
    "michael@quaystoneaccounts.com",
    "Quaystone Accounts",
    "",
    "grp_acct",
    "active",
  ],
  [
    "Priya",
    "Nair",
    "priya@veloretail.com",
    "Velo Retail",
    "rotas rebuilt by hand each week",
    "grp_retail",
    "active",
  ],
  [
    "Ben",
    "Ashworth",
    "ben@harrowgatecafes.co.uk",
    "Harrowgate Cafés",
    "staff turnover every quarter",
    "grp_retail",
    "active",
  ],
  [
    "Lucy",
    "Marchetti",
    "lucy@stonebridgehotels.com",
    "Stonebridge Hotels",
    "no view of shift costs",
    "grp_retail",
    "unsubscribed",
  ],
  ["Owen", "Blackwood", "owen@fairhavengroup.com", "Fairhaven Group", "", null, "active"],
  [
    "Nadia",
    "Rahman",
    "nadia@brightlaneco.com",
    "Brightlane Co",
    "manual invoicing eats a day a week",
    null,
    "active",
  ],
];

const seedProspects: Prospect[] = seedRows.map(
  ([firstName, lastName, email, company, painPoint, groupId, status], i) => ({
    id: `pro_seed${i + 1}`,
    firstName,
    lastName,
    email,
    company,
    painPoint,
    groupId,
    status,
    createdAt: daysAgo(30 - i),
  }),
);

const seedTemplates: Template[] = [
  {
    id: "tpl_intro",
    name: "Short intro",
    subject: "Quick question about {{company}}",
    body: "Hi {{first}},\n\nI work with firms like {{company}} where {{pain}} quietly costs a few hours every week.\n\nWorth a 10 minute call to see if the same fix would work for you?",
    bodyHtml: "",
    updatedAt: daysAgo(12),
  },
  {
    id: "tpl_followup",
    name: "Follow-up nudge",
    subject: "Following up, {{first}}",
    body: "Hi {{first}},\n\nBumping this in case it slipped past — happy to send a one page summary instead of a call if that's easier.\n\nEither way, good luck with things at {{company}}.",
    bodyHtml: "",
    updatedAt: daysAgo(4),
  },
];

function seedCampaign(
  id: string,
  name: string,
  groupId: string,
  templateId: string,
  days: number,
  ids: string[],
  openEvery: number,
  replyEvery: number,
): Campaign {
  return {
    id,
    name,
    groupId,
    templateId,
    sentAt: daysAgo(days),
    recipients: ids.map((prospectId, i) => ({
      prospectId,
      status: "sent" as const,
      opened: i % openEvery === 0,
      replied: i % replyEvery === 0,
      sentAt: new Date(Date.now() - days * 86_400_000 + i * 60_000).toISOString(),
    })),
  };
}

const law = ["pro_seed1", "pro_seed2", "pro_seed3"];
const acct = ["pro_seed5", "pro_seed6", "pro_seed7"];
const retail = ["pro_seed8", "pro_seed9"];

const seedCampaigns: Campaign[] = [
  seedCampaign("cmp_1", "Law · Jun", "grp_law", "tpl_intro", 62, law, 2, 3),
  seedCampaign("cmp_2", "Retail · Jun", "grp_retail", "tpl_intro", 55, retail, 2, 5),
  seedCampaign("cmp_3", "Acct · Jul", "grp_acct", "tpl_intro", 34, acct, 2, 3),
  seedCampaign("cmp_4", "Law · Jul", "grp_law", "tpl_followup", 27, law, 1, 4),
  seedCampaign("cmp_5", "Retail · Jul", "grp_retail", "tpl_followup", 15, retail, 1, 2),
  seedCampaign("cmp_6", "Acct · Aug", "grp_acct", "tpl_followup", 3, acct, 2, 4),
];

export const seedState: OutreachState = {
  prospects: seedProspects,
  groups: seedGroups,
  templates: seedTemplates,
  campaigns: seedCampaigns,
  settings: {
    senderName: "Faraz Ahmed",
    fromEmail: "faraz@outreachconsole.io",
    replyTo: "faraz@outreachconsole.io",
    dailyCap: 60,
    signature: "Faraz Ahmed\nOutreach Console\nfaraz@outreachconsole.io",
    signatureHtml: "",
    unsubscribeHtml: "",
    plainTextMode: true,
    unsubscribeText: "If you would rather not hear from me, unsubscribe here: {{unsubscribe}}",
    sendWindowEnabled: true,
    sendWindowStart: 8,
    sendWindowEnd: 18,
    sendDays: [1, 2, 3, 4, 5],
    sendTimezone: "Europe/London",
    maxBounceRate: 2.0,
    minSendsBeforePause: 20,
  },
};
