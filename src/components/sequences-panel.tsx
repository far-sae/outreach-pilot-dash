import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Btn, Field, Panel, inputClass } from "@/components/ui-kit";
import type { Template } from "@/data/outreach";
import type { Sequence, SequenceStep } from "@/lib/email-types";
import { deleteSequence, listSequences, saveSequence } from "@/server/email.functions";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const blankSequence = (templateId: string): Sequence => ({
  id: "",
  name: "New sequence",
  stopOnReply: true,
  steps: [{ id: "", position: 0, templateId, delayDays: 0 }],
});

/**
 * Follow-up sequences: several messages to the same prospect over days.
 *
 * Most replies to cold outreach come from the second and third message rather
 * than the first, so a single-send campaign leaves most of the result unclaimed.
 */
export function SequencesPanel({ templates }: { templates: Template[] }) {
  const load = useServerFn(listSequences);
  const save = useServerFn(saveSequence);
  const remove = useServerFn(deleteSequence);

  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [editing, setEditing] = useState<Sequence | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSequences(await load({ data: undefined }));
    } catch (e) {
      toast.error("Couldn't load sequences", { description: errText(e) });
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSave() {
    if (!editing) return;
    setBusy(true);
    try {
      await save({ data: editing });
      setEditing(null);
      await refresh();
      toast.success("Sequence saved");
    } catch (e) {
      toast.error("Couldn't save the sequence", { description: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  function patchStep(index: number, patch: Partial<SequenceStep>) {
    if (!editing) return;
    setEditing({
      ...editing,
      steps: editing.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });
  }

  if (loading) {
    return (
      <Panel title="Follow-up sequences">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Panel>
    );
  }

  if (templates.length === 0) {
    return (
      <Panel title="Follow-up sequences">
        <p className="text-sm text-muted-foreground">
          Write at least one template first — a sequence is built from them.
        </p>
      </Panel>
    );
  }

  return (
    <>
      <Panel
        title="Follow-up sequences"
        action={
          <Btn
            variant="primary"
            size="sm"
            onClick={() => setEditing(blankSequence(templates[0]?.id ?? ""))}
          >
            <Plus className="h-4 w-4" />
            New sequence
          </Btn>
        }
      >
        <p className="-mt-1 text-xs text-muted-foreground">
          Several messages to the same prospect over days. Most replies to cold outreach come from
          the second and third message, not the first. Anyone who replies is dropped from the rest
          automatically.
        </p>

        {sequences.length === 0 ? (
          <p className="mt-5 rounded-lg border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
            No sequences yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {sequences.map((s) => {
              const days = s.steps.reduce((n, step) => n + step.delayDays, 0);
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {s.steps.length} step{s.steps.length === 1 ? "" : "s"} over {days} day
                      {days === 1 ? "" : "s"}
                      {s.stopOnReply ? " · stops on reply" : " · keeps sending after a reply"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Btn size="sm" onClick={() => setEditing(s)}>
                      Edit
                    </Btn>
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (!confirm(`Delete "${s.name}"?`)) return;
                        void (async () => {
                          try {
                            await remove({ data: { id: s.id } });
                            await refresh();
                            toast.success("Sequence deleted");
                          } catch (e) {
                            toast.error("Couldn't delete", { description: errText(e) });
                          }
                        })();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Btn>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {editing && (
        <Panel title={editing.id ? `Edit ${editing.name}` : "New sequence"}>
          <div className="grid gap-5">
            <Field label="Name">
              <input
                className={inputClass}
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>

            <div>
              <p className="text-xs font-medium text-muted-foreground">Steps</p>
              <ul className="mt-2 space-y-3">
                {editing.steps.map((step, i) => (
                  <li key={i} className="rounded-lg bg-surface-muted p-3">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-end">
                      <Field label={`Step ${i + 1} template`}>
                        <select
                          className={inputClass}
                          value={step.templateId ?? ""}
                          onChange={(e) => patchStep(i, { templateId: e.target.value })}
                        >
                          {templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </Field>

                      <Field
                        label={i === 0 ? "Sends" : "Wait (days)"}
                        hint={i === 0 ? "Immediately" : undefined}
                      >
                        <input
                          type="number"
                          min={i === 0 ? 0 : 1}
                          disabled={i === 0}
                          className={inputClass}
                          value={i === 0 ? 0 : step.delayDays}
                          onChange={(e) => patchStep(i, { delayDays: Number(e.target.value) })}
                        />
                      </Field>

                      <Btn
                        size="sm"
                        variant="ghost"
                        disabled={editing.steps.length === 1}
                        onClick={() =>
                          setEditing({
                            ...editing,
                            steps: editing.steps.filter((_, idx) => idx !== i),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Btn>
                    </div>
                  </li>
                ))}
              </ul>

              <Btn
                size="sm"
                className="mt-3"
                disabled={editing.steps.length >= 10}
                onClick={() =>
                  setEditing({
                    ...editing,
                    steps: [
                      ...editing.steps,
                      {
                        id: "",
                        position: editing.steps.length,
                        templateId: templates[0]?.id ?? "",
                        delayDays: 3,
                      },
                    ],
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Add step
              </Btn>
            </div>

            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={editing.stopOnReply}
                onChange={(e) => setEditing({ ...editing, stopOnReply: e.target.checked })}
              />
              <span>
                <span className="text-sm font-medium">Stop when they reply</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Turning this off keeps mailing someone who has already answered, which is the
                  quickest route to a spam complaint. Leave it on.
                </span>
              </span>
            </label>

            <div className="flex gap-2">
              <Btn variant="primary" onClick={() => void onSave()} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Save sequence
              </Btn>
              <Btn onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </Btn>
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}
