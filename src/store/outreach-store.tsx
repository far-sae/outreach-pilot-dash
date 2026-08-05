import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import {
  makeId,
  seedState,
  type Campaign,
  type Group,
  type OutreachState,
  type Prospect,
  type Recipient,
  type Settings,
  type Template,
} from "@/data/outreach";
import {
  fromCampaign,
  fromGroup,
  fromProspect,
  fromRecipient,
  fromSettings,
  fromTemplate,
  groupPatchToRow,
  prospectPatchToRow,
  templatePatchToRow,
  toCampaign,
  toGroup,
  toProspect,
  toRecipient,
  toSettings,
  toTemplate,
  type CampaignRow,
  type GroupRow,
  type ProspectRow,
  type RecipientRow,
  type SettingsRow,
  type TemplateRow,
} from "@/lib/db-types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/store/auth-store";

type Ctx = {
  state: OutreachState;
  hydrated: boolean;
  addProspect: (p: Omit<Prospect, "id" | "createdAt">) => Prospect;
  updateProspect: (id: string, patch: Partial<Prospect>) => void;
  deleteProspects: (ids: string[]) => void;
  bulkSetGroup: (ids: string[], groupId: string | null) => void;
  bulkSetStatus: (ids: string[], status: Prospect["status"]) => void;
  importProspects: (rows: Omit<Prospect, "id" | "createdAt">[]) => void;
  addGroup: (name: string, angle: string) => Group;
  updateGroup: (id: string, patch: Partial<Group>) => void;
  deleteGroup: (id: string) => void;
  addTemplate: (t: Omit<Template, "id" | "updatedAt">) => Template;
  updateTemplate: (id: string, patch: Partial<Template>) => void;
  deleteTemplate: (id: string) => void;
  addCampaign: (c: Omit<Campaign, "id">) => Campaign;
  /** Records who actually received a campaign, once sending has finished. */
  updateCampaignRecipients: (campaignId: string, recipients: Recipient[]) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  resetAll: () => void;
};

const OutreachContext = createContext<Ctx | null>(null);

const emptyState: OutreachState = {
  prospects: [],
  groups: [],
  templates: [],
  campaigns: [],
  settings: seedState.settings,
};

/** Surface a failed write instead of letting the UI drift from the database. */
function report(error: { message: string } | null, what: string) {
  if (error) {
    console.error(error);
    toast.error(`Couldn't save ${what}`, { description: error.message });
  }
}

/** Fire-and-forget persistence for an optimistic local update. */
function persist(query: PromiseLike<{ error: { message: string } | null }>, what: string) {
  Promise.resolve(query).then(
    ({ error }) => report(error, what),
    (err: unknown) => report({ message: String(err) }, what),
  );
}

/* ----------------------------------------------------------------- load ---- */

async function loadAll(userId: string): Promise<OutreachState> {
  const [groups, templates, prospects, campaigns, recipients, settings] = await Promise.all([
    supabase.from("groups").select("*").returns<GroupRow[]>(),
    supabase.from("templates").select("*").returns<TemplateRow[]>(),
    supabase
      .from("prospects")
      .select("*")
      .order("created_at", { ascending: false })
      .returns<ProspectRow[]>(),
    supabase.from("campaigns").select("*").order("sent_at").returns<CampaignRow[]>(),
    supabase.from("campaign_recipients").select("*").returns<RecipientRow[]>(),
    supabase.from("settings").select("*").eq("user_id", userId).maybeSingle<SettingsRow>(),
  ]);

  const firstError =
    groups.error ??
    templates.error ??
    prospects.error ??
    campaigns.error ??
    recipients.error ??
    settings.error;
  if (firstError) throw new Error(firstError.message);

  // Fold the flat recipient rows back into each campaign's `recipients[]`.
  const byCampaign = new Map<string, Recipient[]>();
  for (const row of recipients.data ?? []) {
    const list = byCampaign.get(row.campaign_id);
    if (list) list.push(toRecipient(row));
    else byCampaign.set(row.campaign_id, [toRecipient(row)]);
  }

  return {
    groups: (groups.data ?? []).map(toGroup),
    templates: (templates.data ?? []).map(toTemplate),
    prospects: (prospects.data ?? []).map(toProspect),
    campaigns: (campaigns.data ?? []).map((c) => toCampaign(c, byCampaign.get(c.id) ?? [])),
    settings: settings.data ? toSettings(settings.data) : seedState.settings,
  };
}

/** Populate a brand-new account with the demo data, mirroring first-run behaviour. */
async function seedDatabase(userId: string): Promise<OutreachState> {
  const { groups, templates, prospects, campaigns, settings } = seedState;

  // Ordered by foreign key dependency: groups and templates before the rows
  // that reference them.
  // `upsert` rather than `insert`: the seed ids are fixed, so two tabs racing
  // through first sign-in overwrite each other harmlessly instead of colliding
  // on the primary key.
  const steps: { error: { message: string } | null }[] = [];
  steps.push(await supabase.from("groups").upsert(groups.map((g) => fromGroup(g, userId))));
  steps.push(
    await supabase.from("templates").upsert(templates.map((t) => fromTemplate(t, userId))),
  );
  steps.push(
    await supabase.from("prospects").upsert(prospects.map((p) => fromProspect(p, userId))),
  );
  steps.push(
    await supabase.from("campaigns").upsert(campaigns.map((c) => fromCampaign(c, userId))),
  );
  steps.push(
    await supabase
      .from("campaign_recipients")
      .upsert(campaigns.flatMap((c) => c.recipients.map((r) => fromRecipient(r, c.id, userId)))),
  );
  steps.push(await supabase.from("settings").upsert(fromSettings(settings, userId)));

  const failed = steps.find((s) => s.error);
  if (failed?.error) throw new Error(failed.error.message);

  return { groups, templates, prospects, campaigns, settings };
}

/** Remove every row belonging to this user, children first. */
async function wipeDatabase(userId: string) {
  for (const table of ["campaign_recipients", "campaigns", "prospects", "templates", "groups"]) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);
    if (error) throw new Error(error.message);
  }
}

/* ------------------------------------------------------------- provider ---- */

export function OutreachProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [state, setState] = useState<OutreachState>(emptyState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!userId) {
      setState(emptyState);
      setHydrated(false);
      return;
    }

    let active = true;
    setHydrated(false);

    (async () => {
      let next = await loadAll(userId);
      // An account with nothing in it gets the demo data, so the dashboard is
      // never empty on first sign-in.
      const isEmpty =
        next.groups.length === 0 &&
        next.templates.length === 0 &&
        next.prospects.length === 0 &&
        next.campaigns.length === 0;
      if (isEmpty) next = await seedDatabase(userId);
      if (!active) return;
      setState(next);
      setHydrated(true);
    })().catch((err: unknown) => {
      if (!active) return;
      console.error(err);
      toast.error("Couldn't load your data", { description: String(err) });
      setHydrated(true);
    });

    return () => {
      active = false;
    };
  }, [userId]);

  const addProspect = useCallback(
    (p: Omit<Prospect, "id" | "createdAt">) => {
      const prospect: Prospect = { ...p, id: makeId("pro"), createdAt: new Date().toISOString() };
      setState((s) => ({ ...s, prospects: [prospect, ...s.prospects] }));
      if (userId) {
        persist(supabase.from("prospects").insert(fromProspect(prospect, userId)), "prospect");
      }
      return prospect;
    },
    [userId],
  );

  const updateProspect = useCallback((id: string, patch: Partial<Prospect>) => {
    setState((s) => ({
      ...s,
      prospects: s.prospects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
    persist(supabase.from("prospects").update(prospectPatchToRow(patch)).eq("id", id), "prospect");
  }, []);

  // Each bulk helper bails on an empty selection: PostgREST rejects `in.()`.
  const deleteProspects = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const set = new Set(ids);
    setState((s) => ({ ...s, prospects: s.prospects.filter((p) => !set.has(p.id)) }));
    persist(supabase.from("prospects").delete().in("id", ids), "prospects");
  }, []);

  const bulkSetGroup = useCallback((ids: string[], groupId: string | null) => {
    if (!ids.length) return;
    const set = new Set(ids);
    setState((s) => ({
      ...s,
      prospects: s.prospects.map((p) => (set.has(p.id) ? { ...p, groupId } : p)),
    }));
    persist(supabase.from("prospects").update({ group_id: groupId }).in("id", ids), "prospects");
  }, []);

  const bulkSetStatus = useCallback((ids: string[], status: Prospect["status"]) => {
    if (!ids.length) return;
    const set = new Set(ids);
    setState((s) => ({
      ...s,
      prospects: s.prospects.map((p) => (set.has(p.id) ? { ...p, status } : p)),
    }));
    persist(supabase.from("prospects").update({ status }).in("id", ids), "prospects");
  }, []);

  const importProspects = useCallback(
    (rows: Omit<Prospect, "id" | "createdAt">[]) => {
      const now = Date.now();
      const created: Prospect[] = rows.map((r, i) => ({
        ...r,
        id: makeId("pro"),
        createdAt: new Date(now + i).toISOString(),
      }));
      setState((s) => ({ ...s, prospects: [...created, ...s.prospects] }));
      if (userId && created.length) {
        persist(
          supabase.from("prospects").insert(created.map((p) => fromProspect(p, userId))),
          "imported prospects",
        );
      }
    },
    [userId],
  );

  const addGroup = useCallback(
    (name: string, angle: string) => {
      const group: Group = { id: makeId("grp"), name, angle };
      setState((s) => ({ ...s, groups: [...s.groups, group] }));
      if (userId) persist(supabase.from("groups").insert(fromGroup(group, userId)), "group");
      return group;
    },
    [userId],
  );

  const updateGroup = useCallback((id: string, patch: Partial<Group>) => {
    setState((s) => ({
      ...s,
      groups: s.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }));
    persist(supabase.from("groups").update(groupPatchToRow(patch)).eq("id", id), "group");
  }, []);

  const deleteGroup = useCallback((id: string) => {
    // The prospects.group_id foreign key is ON DELETE SET NULL, so the database
    // detaches the prospects on its own — this mirrors it in local state.
    setState((s) => ({
      ...s,
      groups: s.groups.filter((g) => g.id !== id),
      prospects: s.prospects.map((p) => (p.groupId === id ? { ...p, groupId: null } : p)),
    }));
    persist(supabase.from("groups").delete().eq("id", id), "group");
  }, []);

  const addTemplate = useCallback(
    (t: Omit<Template, "id" | "updatedAt">) => {
      const template: Template = { ...t, id: makeId("tpl"), updatedAt: new Date().toISOString() };
      setState((s) => ({ ...s, templates: [...s.templates, template] }));
      if (userId) {
        persist(supabase.from("templates").insert(fromTemplate(template, userId)), "template");
      }
      return template;
    },
    [userId],
  );

  const updateTemplate = useCallback((id: string, patch: Partial<Template>) => {
    const updatedAt = new Date().toISOString();
    setState((s) => ({
      ...s,
      templates: s.templates.map((t) => (t.id === id ? { ...t, ...patch, updatedAt } : t)),
    }));
    persist(
      supabase.from("templates").update(templatePatchToRow(patch, updatedAt)).eq("id", id),
      "template",
    );
  }, []);

  const deleteTemplate = useCallback((id: string) => {
    setState((s) => ({ ...s, templates: s.templates.filter((t) => t.id !== id) }));
    persist(supabase.from("templates").delete().eq("id", id), "template");
  }, []);

  const addCampaign = useCallback(
    (c: Omit<Campaign, "id">) => {
      const campaign: Campaign = { ...c, id: makeId("cmp") };
      setState((s) => ({ ...s, campaigns: [...s.campaigns, campaign] }));

      if (userId) {
        // Recipients carry a foreign key to the campaign, so the parent row has
        // to land first.
        (async () => {
          const { error } = await supabase.from("campaigns").insert(fromCampaign(campaign, userId));
          if (error) {
            report(error, "campaign");
            return;
          }
          if (!campaign.recipients.length) return;
          const { error: recipientError } = await supabase
            .from("campaign_recipients")
            .insert(campaign.recipients.map((r) => fromRecipient(r, campaign.id, userId)));
          report(recipientError, "campaign recipients");
        })().catch((err: unknown) => report({ message: String(err) }, "campaign"));
      }

      return campaign;
    },
    [userId],
  );

  const updateCampaignRecipients = useCallback(
    (campaignId: string, recipients: Recipient[]) => {
      setState((s) => ({
        ...s,
        campaigns: s.campaigns.map((c) => (c.id === campaignId ? { ...c, recipients } : c)),
      }));
      if (userId && recipients.length) {
        persist(
          supabase
            .from("campaign_recipients")
            .upsert(recipients.map((r) => fromRecipient(r, campaignId, userId))),
          "campaign recipients",
        );
      }
    },
    [userId],
  );

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      // Computed outside the updater: React may invoke a state updater more than
      // once, and a database write must not ride along with it.
      const next = { ...state.settings, ...patch };
      setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
      if (userId) {
        persist(supabase.from("settings").upsert(fromSettings(next, userId)), "settings");
      }
    },
    [state.settings, userId],
  );

  const resetAll = useCallback(() => {
    if (!userId) return;
    setHydrated(false);
    (async () => {
      await wipeDatabase(userId);
      const next = await seedDatabase(userId);
      setState(next);
      setHydrated(true);
      toast.success("Data reset to the sample set");
    })().catch((err: unknown) => {
      console.error(err);
      toast.error("Couldn't reset your data", { description: String(err) });
      setHydrated(true);
    });
  }, [userId]);

  const value = useMemo<Ctx>(
    () => ({
      state,
      hydrated,
      addProspect,
      updateProspect,
      deleteProspects,
      bulkSetGroup,
      bulkSetStatus,
      importProspects,
      addGroup,
      updateGroup,
      deleteGroup,
      addTemplate,
      updateTemplate,
      deleteTemplate,
      addCampaign,
      updateCampaignRecipients,
      updateSettings,
      resetAll,
    }),
    [
      state,
      hydrated,
      addProspect,
      updateProspect,
      deleteProspects,
      bulkSetGroup,
      bulkSetStatus,
      importProspects,
      addGroup,
      updateGroup,
      deleteGroup,
      addTemplate,
      updateTemplate,
      deleteTemplate,
      addCampaign,
      updateCampaignRecipients,
      updateSettings,
      resetAll,
    ],
  );

  return <OutreachContext.Provider value={value}>{children}</OutreachContext.Provider>;
}

export function useOutreach() {
  const ctx = useContext(OutreachContext);
  if (!ctx) throw new Error("useOutreach must be used inside OutreachProvider");
  return ctx;
}

/* ---------- shared helpers ---------- */

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function fullName(p: Prospect) {
  return `${p.firstName} ${p.lastName}`.trim() || p.email;
}

// Re-exported so existing screens keep importing it from here, while the send
// pipeline on the server pulls the same implementation from @/lib/merge.
export { mergeCopy } from "@/lib/merge";

export function campaignStats(c: Campaign) {
  const delivered = c.recipients.length;
  const opened = c.recipients.filter((r) => r.opened).length;
  const replied = c.recipients.filter((r) => r.replied).length;
  return {
    delivered,
    opened,
    replied,
    openRate: delivered ? (opened / delivered) * 100 : 0,
    replyRate: delivered ? (replied / delivered) * 100 : 0,
  };
}

export function simulateOutcomes(recipients: Omit<Recipient, "opened" | "replied">[]): Recipient[] {
  return recipients.map((r) => {
    const opened = Math.random() < 0.45;
    return { ...r, opened, replied: opened && Math.random() < 0.22 };
  });
}
