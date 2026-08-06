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

        <Panel title="Sending schedule">
          <p className="-mt-1 text-xs text-muted-foreground">
            Mail arriving at 03:00 reads as automated. Restricting sends to working hours costs
            nothing and is one of the few content-independent signals you control.
          </p>

          <label className="mt-5 flex items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.sendWindowEnabled}
              onChange={(e) => setForm({ ...form, sendWindowEnabled: e.target.checked })}
            />
            <span className="text-sm font-medium">Only send during working hours</span>
          </label>

          {form.sendWindowEnabled && (
            <>
              <div className="mt-4 grid gap-5 sm:grid-cols-3">
                <Field label="From (hour)">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    className={inputClass}
                    value={form.sendWindowStart}
                    onChange={(e) => setForm({ ...form, sendWindowStart: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Until (hour)">
                  <input
                    type="number"
                    min={1}
                    max={24}
                    className={inputClass}
                    value={form.sendWindowEnd}
                    onChange={(e) => setForm({ ...form, sendWindowEnd: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Timezone" hint="IANA name.">
                  <input
                    className={inputClass}
                    value={form.sendTimezone}
                    placeholder="Europe/London"
                    onChange={(e) => setForm({ ...form, sendTimezone: e.target.value })}
                  />
                </Field>
              </div>

              <div className="mt-4">
                <span className="text-xs font-medium text-muted-foreground">Sending days</span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[
                    [1, "Mon"],
                    [2, "Tue"],
                    [3, "Wed"],
                    [4, "Thu"],
                    [5, "Fri"],
                    [6, "Sat"],
                    [7, "Sun"],
                  ].map(([day, label]) => {
                    const on = form.sendDays.includes(day as number);
                    return (
                      <button
                        key={label as string}
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            sendDays: on
                              ? form.sendDays.filter((d) => d !== day)
                              : [...form.sendDays, day as number].sort(),
                          })
                        }
                        className={cn(
                          "rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                          on
                            ? "border-accent-blue bg-accent-tint text-accent-blue"
                            : "border-border text-muted-foreground hover:bg-surface-muted",
                        )}
                      >
                        {label as string}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          <div className="mt-6 border-t border-border pt-5">
            <p className="text-sm font-medium">Bounce protection</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Above roughly 2% hard bounces, providers start throttling. A mailbox that crosses this
              pauses itself rather than carrying on damaging its own reputation.
            </p>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <Field label="Max bounce rate (%)">
                <input
                  type="number"
                  min={0.5}
                  max={50}
                  step={0.5}
                  className={inputClass}
                  value={form.maxBounceRate}
                  onChange={(e) => setForm({ ...form, maxBounceRate: Number(e.target.value) })}
                />
              </Field>
              <Field label="Minimum sends first" hint="Before the rate is acted on.">
                <input
                  type="number"
                  min={1}
                  className={inputClass}
                  value={form.minSendsBeforePause}
                  onChange={(e) =>
                    setForm({ ...form, minSendsBeforePause: Number(e.target.value) })
                  }
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
