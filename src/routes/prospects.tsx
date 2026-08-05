import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Upload, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/app-layout";
import {
  Btn,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Panel,
  Pill,
  inputClass,
} from "@/components/ui-kit";
import { cn } from "@/lib/utils";
import { fullName, isValidEmail, useOutreach } from "@/store/outreach-store";
import type { Prospect } from "@/data/outreach";

export const Route = createFileRoute("/prospects")({
  head: () => ({
    meta: [
      { title: "Prospects — Outreach Console" },
      {
        name: "description",
        content:
          "Search, group, import and manage every cold email prospect in one list with live filters and bulk actions.",
      },
      { property: "og:title", content: "Prospects — Outreach Console" },
      {
        property: "og:description",
        content: "Search, group, import and manage every cold email prospect in one list.",
      },
    ],
  }),
  component: ProspectsPage,
});

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  painPoint: string;
  groupId: string;
};

const emptyForm: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  company: "",
  painPoint: "",
  groupId: "",
};

/** Sentinel for the "create one" entry in the target-group select. */
const NEW_GROUP = "__new__";

function ProspectsPage() {
  const {
    state,
    addProspect,
    updateProspect,
    deleteProspects,
    bulkSetGroup,
    bulkSetStatus,
    importProspects,
    addGroup,
  } = useOutreach();
  const { prospects, groups } = state;

  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupAngle, setNewGroupAngle] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Prospect | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [emailError, setEmailError] = useState("");

  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [importGroup, setImportGroup] = useState("");

  const [confirm, setConfirm] = useState<{ ids: string[]; label: string } | null>(null);

  const groupName = (id: string | null) =>
    id ? (groups.find((g) => g.id === id)?.name ?? "Unassigned") : "Unassigned";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return prospects.filter((p) => {
      const matchesQuery =
        !q ||
        fullName(p).toLowerCase().includes(q) ||
        p.company.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q);
      const matchesGroup =
        groupFilter === "all" ||
        (groupFilter === "none" ? p.groupId === null : p.groupId === groupFilter);
      return matchesQuery && matchesGroup;
    });
  }, [prospects, query, groupFilter]);

  const visibleIds = filtered.map((p) => p.id);
  const selectedVisible = selected.filter((id) => visibleIds.includes(id));
  const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setEmailError("");
    setFormOpen(true);
  }

  function openEdit(p: Prospect) {
    setEditing(p);
    setForm({
      firstName: p.firstName,
      lastName: p.lastName,
      email: p.email,
      company: p.company,
      painPoint: p.painPoint,
      groupId: p.groupId ?? "",
    });
    setEmailError("");
    setFormOpen(true);
  }

  function submitForm() {
    const email = form.email.trim();
    if (!email) return setEmailError("Email is required");
    if (!isValidEmail(email)) return setEmailError("That doesn't look like a valid email");
    const dupe = prospects.some(
      (p) => p.email.toLowerCase() === email.toLowerCase() && p.id !== editing?.id,
    );
    if (dupe) return setEmailError("A prospect with this email already exists");

    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email,
      company: form.company.trim(),
      painPoint: form.painPoint.trim(),
      groupId: form.groupId || null,
    };

    if (editing) {
      updateProspect(editing.id, payload);
      toast.success(`Updated ${payload.firstName || email}`);
    } else {
      addProspect({ ...payload, status: "active" });
      toast.success(`Added ${payload.firstName || email}`);
    }
    setFormOpen(false);
  }

  function runImport() {
    // Creating the group first means the imported rows can reference its id in
    // the same pass, rather than needing a second assignment step.
    let targetGroup = importGroup;
    if (importGroup === NEW_GROUP) {
      const name = newGroupName.trim();
      if (!name) {
        toast.error("Name the new group first");
        return;
      }
      targetGroup = addGroup(name, newGroupAngle.trim()).id;
    }

    const lines = csv
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const seen = new Set(prospects.map((p) => p.email.toLowerCase()));
    const rows: Omit<Prospect, "id" | "createdAt">[] = [];
    let skipped = 0;

    for (const line of lines) {
      const parts = line.split(",").map((c) => c.trim());
      const [first = "", last = "", email = "", company = "", pain = ""] = parts;
      if (/^first/i.test(first) && /mail/i.test(email)) continue; // header row
      if (!isValidEmail(email) || seen.has(email.toLowerCase())) {
        skipped += 1;
        continue;
      }
      seen.add(email.toLowerCase());
      rows.push({
        firstName: first,
        lastName: last,
        email,
        company,
        painPoint: pain,
        groupId: targetGroup || null,
        status: "active",
      });
    }

    if (rows.length) importProspects(rows);
    setImportOpen(false);
    setCsv("");
    setNewGroupName("");
    setNewGroupAngle("");
    toast.success(
      `Imported ${rows.length} prospect${rows.length === 1 ? "" : "s"}${
        skipped ? ` · skipped ${skipped} invalid or duplicate row${skipped === 1 ? "" : "s"}` : ""
      }`,
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="Prospects"
        subtitle={`${prospects.length} total · ${prospects.filter((p) => p.status === "active").length} contactable`}
        action={
          <div className="flex shrink-0 gap-2">
            <Btn onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" strokeWidth={1.75} />
              Import CSV
            </Btn>
            <Btn variant="primary" onClick={openCreate}>
              <Plus className="h-4 w-4" strokeWidth={2} />
              Add prospect
            </Btn>
          </div>
        }
      />

      <div className="mt-8 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          className={inputClass}
          placeholder="Search name, company or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className={cn(inputClass, "sm:w-56")}
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
        >
          <option value="all">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value="none">Unassigned</option>
        </select>
      </div>

      {selectedVisible.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-muted p-3">
          <span className="text-xs text-muted-foreground">{selectedVisible.length} selected</span>
          <select
            className={cn(inputClass, "w-auto py-1.5 text-xs")}
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              const gid = e.target.value === "none" ? null : e.target.value;
              bulkSetGroup(selectedVisible, gid);
              toast.success(`Moved ${selectedVisible.length} to ${groupName(gid)}`);
              setSelected([]);
            }}
          >
            <option value="">Move to group…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value="none">Unassigned</option>
          </select>
          <Btn
            size="sm"
            onClick={() => {
              bulkSetStatus(selectedVisible, "unsubscribed");
              toast.success(`Marked ${selectedVisible.length} unsubscribed`);
              setSelected([]);
            }}
          >
            Mark unsubscribed
          </Btn>
          <Btn
            size="sm"
            variant="danger"
            onClick={() =>
              setConfirm({
                ids: selectedVisible,
                label: `${selectedVisible.length} prospects`,
              })
            }
          >
            Delete
          </Btn>
        </div>
      )}

      <div className="mt-6">
        {filtered.length === 0 ? (
          <EmptyState
            title={prospects.length ? "No matches" : "No prospects yet"}
            body={
              prospects.length
                ? "Try a different search term or clear the group filter."
                : "Add your first prospect or paste a CSV to get started."
            }
            action={
              <Btn variant="primary" size="sm" onClick={openCreate}>
                Add prospect
              </Btn>
            }
          />
        ) : (
          <Panel>
            <div className="mb-3 flex items-center gap-3 border-b border-border pb-3">
              <input
                type="checkbox"
                aria-label="Select all"
                className="h-4 w-4 accent-[var(--accent-blue)]"
                checked={allSelected}
                onChange={(e) => setSelected(e.target.checked ? visibleIds : [])}
              />
              <span className="text-xs text-muted-foreground">
                Showing {filtered.length} of {prospects.length}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {filtered.map((p) => (
                <li key={p.id} className="flex items-start gap-3 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${fullName(p)}`}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent-blue)]"
                    checked={selected.includes(p.id)}
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked ? [...s, p.id] : s.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{fullName(p)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.email}
                      {p.company ? ` · ${p.company}` : ""}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {groupName(p.groupId)}
                      {p.painPoint ? ` · ${p.painPoint}` : " · no pain point"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const next = p.status === "active" ? "unsubscribed" : "active";
                        updateProspect(p.id, { status: next });
                        toast.success(`${fullName(p)} is now ${next}`);
                      }}
                      title="Toggle status"
                    >
                      <Pill tone={p.status}>{p.status}</Pill>
                    </button>
                    <Btn size="sm" variant="ghost" aria-label="Edit" onClick={() => openEdit(p)}>
                      <Pencil className="h-4 w-4" strokeWidth={1.75} />
                    </Btn>
                    <Btn
                      size="sm"
                      variant="ghost"
                      aria-label="Delete"
                      onClick={() => setConfirm({ ids: [p.id], label: fullName(p) })}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </Btn>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Need a new segment?{" "}
        <Link to="/groups" className="text-accent-blue hover:underline">
          Manage groups
        </Link>
      </p>

      <Modal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? "Edit prospect" : "Add prospect"}
        description="Email is required. Pain point powers the {{pain}} merge tag."
        footer={
          <>
            <Btn onClick={() => setFormOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={submitForm}>
              {editing ? "Save changes" : "Add prospect"}
            </Btn>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            <input
              className={inputClass}
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
          </Field>
          <Field label="Last name">
            <input
              className={inputClass}
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Email" error={emailError}>
              <input
                className={inputClass}
                value={form.email}
                onChange={(e) => {
                  setForm({ ...form, email: e.target.value });
                  setEmailError("");
                }}
              />
            </Field>
          </div>
          <Field label="Company">
            <input
              className={inputClass}
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />
          </Field>
          <Field label="Group">
            <select
              className={inputClass}
              value={form.groupId}
              onChange={(e) => setForm({ ...form, groupId: e.target.value })}
            >
              <option value="">Unassigned</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Pain point">
              <input
                className={inputClass}
                value={form.painPoint}
                onChange={(e) => setForm({ ...form, painPoint: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import prospects"
        description="Paste one row per line: first,last,email,company,pain point"
        footer={
          <>
            <Btn onClick={() => setImportOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={runImport} disabled={!csv.trim()}>
              Import
            </Btn>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Rows">
            <textarea
              className={cn(inputClass, "h-40 resize-y font-mono text-xs")}
              placeholder={"Ada,Byrne,ada@examplelaw.com,Example Law,contracts take days"}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
          </Field>
          <Field label="Target group">
            <select
              className={inputClass}
              value={importGroup}
              onChange={(e) => setImportGroup(e.target.value)}
            >
              <option value="">Unassigned</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
              <option value={NEW_GROUP}>+ Create a new group…</option>
            </select>
          </Field>

          {importGroup === NEW_GROUP && (
            <div className="grid gap-4 rounded-lg bg-surface-muted p-4 sm:grid-cols-2">
              <Field label="New group name">
                <input
                  className={inputClass}
                  value={newGroupName}
                  placeholder="Law firms — Manchester"
                  onChange={(e) => setNewGroupName(e.target.value)}
                />
              </Field>
              <Field label="Angle" hint="Optional. The pain this group shares.">
                <input
                  className={inputClass}
                  value={newGroupAngle}
                  placeholder="Slow client intake"
                  onChange={(e) => setNewGroupAngle(e.target.value)}
                />
              </Field>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="Delete prospects?"
        description={`This permanently removes ${confirm?.label ?? ""} from your list.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (!confirm) return;
          deleteProspects(confirm.ids);
          setSelected([]);
          toast.success(`Deleted ${confirm.label}`);
          setConfirm(null);
        }}
      />
    </AppLayout>
  );
}
