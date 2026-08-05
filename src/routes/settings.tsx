import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppLayout } from "@/components/app-layout";
import { DeliverabilityCheck } from "@/components/deliverability-check";
import { MailboxPoolPanel } from "@/components/mailbox-pool-panel";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Btn, Field, PageHeader, Panel, inputClass } from "@/components/ui-kit";
import { htmlToText, textToHtml } from "@/lib/merge";
import { cn } from "@/lib/utils";
import { isValidEmail, useOutreach } from "@/store/outreach-store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Outreach Console" },
      {
        name: "description",
        content:
          "Set your sender name, from address, reply-to, daily send cap and email signature for every campaign.",
      },
      { property: "og:title", content: "Settings — Outreach Console" },
      {
        property: "og:description",
        content: "Sender identity, daily send cap and signature for your cold email campaigns.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { state, updateSettings, hydrated } = useOutreach();
  const [form, setForm] = useState(state.settings);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setForm(state.settings);
  }, [hydrated, state.settings]);

  function save() {
    const next: Record<string, string> = {};
    if (!form.senderName.trim()) next["senderName"] = "Sender name is required";
    if (!isValidEmail(form.fromEmail)) next["fromEmail"] = "Enter a valid from address";
    if (!isValidEmail(form.replyTo)) next["replyTo"] = "Enter a valid reply-to address";
    if (!Number.isFinite(form.dailyCap) || form.dailyCap < 1)
      next["dailyCap"] = "Cap must be at least 1";
    setErrors(next);
    if (Object.keys(next).length) return;
    updateSettings({ ...form, senderName: form.senderName.trim() });
    toast.success("Settings saved");
  }

  return (
    <AppLayout>
      <PageHeader
        title="Settings"
        subtitle="Used in every template preview and campaign send."
        action={
          <Btn variant="primary" onClick={save}>
            Save settings
          </Btn>
        }
      />

      <div className="mt-8 grid max-w-2xl gap-6">
        <Panel>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Sender name" error={errors["senderName"]}>
              <input
                className={inputClass}
                value={form.senderName}
                onChange={(e) => setForm({ ...form, senderName: e.target.value })}
              />
            </Field>
            <Field label="Daily send cap" error={errors["dailyCap"]}>
              <input
                type="number"
                min={1}
                className={inputClass}
                value={form.dailyCap}
                onChange={(e) => setForm({ ...form, dailyCap: Number(e.target.value) })}
              />
            </Field>
            <Field label="From email" error={errors["fromEmail"]}>
              <input
                className={inputClass}
                value={form.fromEmail}
                onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
              />
            </Field>
            <Field label="Reply-to" error={errors["replyTo"]}>
              <input
                className={inputClass}
                value={form.replyTo}
                onChange={(e) => setForm({ ...form, replyTo: e.target.value })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field
                label="Signature"
                hint="Appended below every email. Plain text mode strips formatting."
              >
                <RichTextEditor
                  value={form.signatureHtml || textToHtml(form.signature)}
                  onChange={(html) =>
                    setForm({ ...form, signatureHtml: html, signature: htmlToText(html) })
                  }
                  placeholder="Your name, role, company…"
                />
              </Field>
            </div>
          </div>
        </Panel>

        <DeliverabilityCheck />

        <Panel title="Deliverability">
          <p className="-mt-1 text-xs text-muted-foreground">
            Gmail sorts on signals, not on how good the email is. These two settings are the
            difference between the Primary tab and Promotions.
          </p>

          <label className="mt-5 flex items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.plainTextMode}
              onChange={(e) => setForm({ ...form, plainTextMode: e.target.checked })}
            />
            <span>
              <span className="text-sm font-medium">Send as plain text</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                No HTML, no images, no one-click unsubscribe header — the biggest Promotions
                triggers. Template formatting is stripped. Recommended for cold outreach.
              </span>
            </span>
          </label>

          <p className="mt-4 rounded-lg bg-surface-muted p-3 text-xs text-muted-foreground">
            Open tracking has been removed. The 1×1 pixel it required was a remote image, which is
            the strongest Promotions signal a message can carry — and most clients block it anyway,
            so it never measured much. Replies are still detected, over IMAP, which adds nothing to
            the outgoing message.
          </p>

          <div className="mt-5">
            <Field
              label="Unsubscribe footer"
              hint="Added to every email. Put {{unsubscribe}} where the link should go — one is appended automatically if you leave it out."
            >
              <RichTextEditor
                value={form.unsubscribeHtml || textToHtml(form.unsubscribeText)}
                onChange={(html) =>
                  setForm({ ...form, unsubscribeHtml: html, unsubscribeText: htmlToText(html) })
                }
                placeholder="If you would rather not hear from me, unsubscribe here: {{unsubscribe}}"
              />
            </Field>
          </div>
        </Panel>

        <MailboxPoolPanel />
      </div>
    </AppLayout>
  );
}
