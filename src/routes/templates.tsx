import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/app-layout";
import {
  Btn,
  ConfirmDialog,
  EmptyState,
  Field,
  PageHeader,
  Panel,
  inputClass,
} from "@/components/ui-kit";
import { RichTextEditor } from "@/components/rich-text-editor";
import { SequencesPanel } from "@/components/sequences-panel";
import { TemplateStatsPanel } from "@/components/template-stats-panel";
import { cleanRedundantLinks, footerText, htmlToText, textToHtml } from "@/lib/merge";
import { cn } from "@/lib/utils";
import { mergeCopy, useOutreach } from "@/store/outreach-store";
import { MERGE_TAGS, type Prospect } from "@/data/outreach";

export const Route = createFileRoute("/templates")({
  head: () => ({
    meta: [
      { title: "Templates — Outreach Console" },
      {
        name: "description",
        content:
          "Write cold email templates with merge tags and preview them against a real prospect before you send.",
      },
      { property: "og:title", content: "Templates — Outreach Console" },
      {
        property: "og:description",
        content: "Write cold email templates with merge tags and a live merged preview.",
      },
    ],
  }),
  component: TemplatesPage,
});

function Highlighted({ text, prospect }: { text: string; prospect: Prospect | null }) {
  const parts = text.split(/(\{\{(?:first|last|company|pain|email)\}\})/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\{\{(first|last|company|pain|email)\}\}$/.test(part) ? (
          <mark key={i} className="rounded bg-accent-tint px-1 text-accent-blue">
            {mergeCopy(part, prospect)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function TemplatesPage() {
  const { state, addTemplate, updateTemplate, deleteTemplate } = useOutreach();
  const { templates, prospects, settings } = state;

  const [activeId, setActiveId] = useState<string | null>(templates[0]?.id ?? null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const editorInsert = useRef<((text: string) => void) | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const [lastFocus, setLastFocus] = useState<"subject" | "body">("body");

  useEffect(() => {
    if (!templates.some((t) => t.id === activeId)) setActiveId(templates[0]?.id ?? null);
  }, [templates, activeId]);

  const active = templates.find((t) => t.id === activeId) ?? null;
  const sample = useMemo(() => prospects.find((p) => p.status === "active") ?? null, [prospects]);

  function insertTag(tag: string) {
    if (!active) return;
    const token = `{{${tag}}}`;
    if (lastFocus === "subject") {
      const el = subjectRef.current;
      const pos = el?.selectionStart ?? active.subject.length;
      const next = active.subject.slice(0, pos) + token + active.subject.slice(pos);
      updateTemplate(active.id, { subject: next });
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(pos + token.length, pos + token.length);
      });
    } else if (editorInsert.current) {
      editorInsert.current(token);
    }
  }

  /** Rich HTML is the source; the plain-text part is derived from it. */
  function setBody(html: string) {
    if (!active) return;
    updateTemplate(active.id, { bodyHtml: html, body: htmlToText(html) });
  }

  function createTemplate() {
    const t = addTemplate({
      name: "Untitled template",
      subject: "Quick question about {{company}}",
      body: "Hi {{first}},\n\n",
      bodyHtml: "",
    });
    setActiveId(t.id);
    toast.success("Template created");
  }

  return (
    <AppLayout>
      <PageHeader
        title="Templates"
        subtitle={`${templates.length} templates · previews merge ${sample ? sample.firstName || sample.email : "your first active prospect"}`}
        action={
          <Btn variant="primary" onClick={createTemplate}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            New template
          </Btn>
        }
      />

      {templates.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No templates yet"
            body="Write one email, use merge tags, and reuse it across every campaign."
            action={
              <Btn variant="primary" size="sm" onClick={createTemplate}>
                Create a template
              </Btn>
            }
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Panel className="h-fit">
            <ul className="space-y-1">
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(t.id)}
                    className={cn(
                      "w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      t.id === activeId
                        ? "bg-surface-muted font-medium"
                        : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                    )}
                  >
                    {t.name}
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          {active && (
            <div className="grid gap-6">
              <Panel
                title="Editor"
                action={
                  <div className="flex shrink-0 gap-1">
                    <Btn
                      size="sm"
                      variant="ghost"
                      aria-label="Duplicate"
                      onClick={() => {
                        const copy = addTemplate({
                          name: `${active.name} copy`,
                          subject: active.subject,
                          body: active.body,
                          bodyHtml: active.bodyHtml,
                        });
                        setActiveId(copy.id);
                        toast.success("Template duplicated");
                      }}
                    >
                      <Copy className="h-4 w-4" strokeWidth={1.75} />
                    </Btn>
                    <Btn
                      size="sm"
                      variant="ghost"
                      aria-label="Delete"
                      onClick={() => setConfirm(active.id)}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </Btn>
                  </div>
                }
              >
                <div className="grid gap-4">
                  <Field label="Name">
                    <input
                      className={inputClass}
                      value={active.name}
                      onChange={(e) => updateTemplate(active.id, { name: e.target.value })}
                    />
                  </Field>
                  <Field label="Subject">
                    <input
                      ref={subjectRef}
                      className={inputClass}
                      value={active.subject}
                      onFocus={() => setLastFocus("subject")}
                      onChange={(e) => updateTemplate(active.id, { subject: e.target.value })}
                    />
                  </Field>
                  <div>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {MERGE_TAGS.map((tag) => (
                        <Btn key={tag} size="sm" onClick={() => insertTag(tag)}>
                          {`{{${tag}}}`}
                        </Btn>
                      ))}
                    </div>
                    <Field label="Body" hint="Click a tag to insert it at the cursor.">
                      <div onFocus={() => setLastFocus("body")}>
                        <RichTextEditor
                          value={active.bodyHtml || textToHtml(active.body)}
                          onChange={setBody}
                          insertRef={editorInsert}
                          placeholder="Write your email…"
                        />
                      </div>
                    </Field>

                    {settings.plainTextMode && (
                      <p className="mt-2 text-xs text-warning">
                        Deliverability mode is on, so this email sends as plain text and the
                        formatting above is stripped. That is what keeps cold mail out of Gmail's
                        Promotions tab — turn it off in Settings to send formatted HTML.
                      </p>
                    )}
                  </div>
                </div>
              </Panel>

              <Panel title="Preview">
                {sample ? (
                  <div className="rounded-lg bg-surface-muted p-4">
                    <p className="text-xs text-muted-foreground">
                      To {sample.email} · from {settings.senderName} &lt;{settings.fromEmail}&gt;
                    </p>
                    <p className="mt-3 text-sm font-medium break-words">
                      <Highlighted text={active.subject} prospect={sample} />
                    </p>
                    <p className="mt-3 text-sm break-words whitespace-pre-wrap">
                      <Highlighted text={cleanRedundantLinks(active.body)} prospect={sample} />
                    </p>
                    {settings.signature && (
                      <p className="mt-4 border-t border-border pt-3 text-sm break-words whitespace-pre-wrap text-muted-foreground">
                        {cleanRedundantLinks(settings.signature)}
                      </p>
                    )}
                    <p className="mt-4 text-xs break-words whitespace-pre-wrap text-muted-foreground">
                      {footerText({
                        body: "",
                        signature: "",
                        unsubscribeText: settings.unsubscribeText,
                        unsubscribeUrl: "<unsubscribe link>",
                        replyTo: settings.replyTo,
                      })}
                    </p>
                  </div>
                ) : (
                  <EmptyState
                    title="No active prospect"
                    body="Add an active prospect to preview merged copy."
                    action={
                      <Link to="/prospects">
                        <Btn size="sm" variant="primary">
                          Add a prospect
                        </Btn>
                      </Link>
                    }
                  />
                )}
              </Panel>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6">
        <TemplateStatsPanel />
        <SequencesPanel templates={templates} />
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="Delete template?"
        description="Campaign history keeps its record, but this template will no longer be available to send."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (!confirm) return;
          deleteTemplate(confirm);
          toast.success("Template deleted");
          setConfirm(null);
        }}
      />
    </AppLayout>
  );
}
