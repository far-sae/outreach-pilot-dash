import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, Pencil, Trash2, Send } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/app-layout";
import {
  Btn,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  inputClass,
} from "@/components/ui-kit";
import { useOutreach } from "@/store/outreach-store";
import type { Group } from "@/data/outreach";

export const Route = createFileRoute("/groups")({
  head: () => ({
    meta: [
      { title: "Groups — Outreach Console" },
      {
        name: "description",
        content:
          "Segment prospects into groups with their own pitch angle and see contactable counts at a glance.",
      },
      { property: "og:title", content: "Groups — Outreach Console" },
      {
        property: "og:description",
        content: "Segment prospects into groups with their own pitch angle and contactable counts.",
      },
    ],
  }),
  component: GroupsPage,
});

function GroupsPage() {
  const { state, addGroup, updateGroup, deleteGroup } = useOutreach();
  const { groups, prospects } = state;
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [name, setName] = useState("");
  const [angle, setAngle] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<Group | null>(null);

  function openCreate() {
    setEditing(null);
    setName("");
    setAngle("");
    setError("");
    setOpen(true);
  }

  function openEdit(g: Group) {
    setEditing(g);
    setName(g.name);
    setAngle(g.angle);
    setError("");
    setOpen(true);
  }

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return setError("Give the group a name");
    if (editing) {
      updateGroup(editing.id, { name: trimmed, angle: angle.trim() });
      toast.success(`Renamed to ${trimmed}`);
    } else {
      addGroup(trimmed, angle.trim());
      toast.success(`Created ${trimmed}`);
    }
    setOpen(false);
  }

  const ungrouped = prospects.filter((p) => p.groupId === null);

  return (
    <AppLayout>
      <PageHeader
        title="Groups"
        subtitle={`${groups.length} groups · ${ungrouped.length} prospects unassigned`}
        action={
          <Btn variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            New group
          </Btn>
        }
      />

      <div className="mt-8">
        {groups.length === 0 ? (
          <EmptyState
            title="No groups yet"
            body="Groups let you pitch a specific angle to a specific type of business."
            action={
              <Btn variant="primary" size="sm" onClick={openCreate}>
                Create your first group
              </Btn>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map((g) => {
              const members = prospects.filter((p) => p.groupId === g.id);
              const contactable = members.filter((p) => p.status === "active").length;
              return (
                <section
                  key={g.id}
                  className="flex flex-col rounded-xl border border-border bg-card p-5"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                    <h2 className="truncate text-sm font-semibold tracking-tight">{g.name}</h2>
                    <div className="flex shrink-0 gap-1">
                      <Btn
                        size="sm"
                        variant="ghost"
                        aria-label="Rename"
                        onClick={() => openEdit(g)}
                      >
                        <Pencil className="h-4 w-4" strokeWidth={1.75} />
                      </Btn>
                      <Btn
                        size="sm"
                        variant="ghost"
                        aria-label="Delete group"
                        onClick={() => setConfirm(g)}
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                      </Btn>
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {g.angle || "No angle set"}
                  </p>
                  <p className="mt-4 font-mono text-2xl font-medium tracking-tight">
                    {contactable}
                    <span className="text-sm text-muted-foreground"> / {members.length}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">contactable of total</p>
                  <div className="mt-4 flex gap-2">
                    <Btn
                      size="sm"
                      variant="primary"
                      disabled={contactable === 0}
                      onClick={() =>
                        navigate({ to: "/campaigns", search: { group: g.id } as never })
                      }
                    >
                      <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Email this group
                    </Btn>
                    <Link to="/prospects">
                      <Btn size="sm">View people</Btn>
                    </Link>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Rename group" : "New group"}
        description="The angle is a reminder of what you pitch this segment."
        footer={
          <>
            <Btn onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={submit}>
              {editing ? "Save" : "Create group"}
            </Btn>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Name" error={error}>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
            />
          </Field>
          <Field label="Angle">
            <input
              className={inputClass}
              value={angle}
              onChange={(e) => setAngle(e.target.value)}
              placeholder="Busy season capacity crunch"
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="Delete group?"
        description={`${confirm?.name ?? ""} will be removed. Its prospects stay in your list and become unassigned.`}
        confirmLabel="Delete group"
        destructive
        onConfirm={() => {
          if (!confirm) return;
          deleteGroup(confirm.id);
          toast.success(`Deleted ${confirm.name} · prospects kept`);
          setConfirm(null);
        }}
      />
    </AppLayout>
  );
}
