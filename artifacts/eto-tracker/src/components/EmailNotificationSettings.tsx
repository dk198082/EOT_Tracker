import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEmailNotificationsQueryKey,
  useGetEmailNotifications,
  useUpdateEmailNotification,
  useUpdateAllEmailNotifications,
  type EmailNotifications,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

export function EmailNotificationSettings() {
  const queryKey = getGetEmailNotificationsQueryKey();
  const { data, isPending, isError, refetch } = useGetEmailNotifications({
    query: { queryKey, refetchInterval: 30_000 },
  });
  const update = useUpdateEmailNotification();
  const updateAll = useUpdateAllEmailNotifications();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [savingType, setSavingType] = useState<string | null>(null);

  async function setAll(enabled: boolean) {
    setSavingType(enabled ? "all-yes" : "all-no");
    try {
      const saved = await updateAll.mutateAsync({ data: { enabled } });
      qc.setQueryData<EmailNotifications>(queryKey, (previous) => previous ? {
        ...previous,
        notifications: previous.notifications.map((item) => ({ ...item, enabled: saved.enabled })),
      } : previous);
      await qc.invalidateQueries({ queryKey });
      toast({ title: saved.enabled ? "All email notifications enabled" : "All email notifications disabled" });
    } catch {
      await qc.invalidateQueries({ queryKey });
      toast({ title: "Could not confirm the bulk update", description: "Refresh to check the saved settings, then try again.", variant: "destructive" });
    } finally {
      setSavingType(null);
    }
  }

  async function toggle(type: string, enabled: boolean) {
    setSavingType(type);
    try {
      const saved = await update.mutateAsync({ notificationType: type, data: { enabled } });
      qc.setQueryData<EmailNotifications>(queryKey, (previous) => previous ? {
        ...previous,
        notifications: previous.notifications.map((item) =>
          item.type === type ? { ...item, enabled: saved.enabled } : item),
      } : previous);
      await qc.invalidateQueries({ queryKey });
      toast({ title: saved.enabled ? "Email notification enabled" : "Email notification disabled" });
    } catch {
      toast({ title: "Could not save notification setting", description: "Your previous setting is unchanged. Please try again.", variant: "destructive" });
    } finally {
      setSavingType(null);
    }
  }

  if (isPending) return <p className="text-sm text-slate-500">Loading email settings…</p>;
  if (isError || !data) return (
    <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      Could not load email settings. <button className="underline" onClick={() => refetch()}>Try again</button>
    </p>
  );

  return (
    <section aria-label="Email notification settings" className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Email Notifications</h2>
        <p className="mt-1 text-sm text-slate-500">
          Control each notification independently. All switches start off. Changes apply to future events only,
          and are shared by the preview and published app.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={savingType !== null} onClick={() => setAll(true)}
          className="bg-[#1E3A5F] text-white hover:bg-[#162d4a]">
          {savingType === "all-yes" ? "Saving…" : "Set all to Yes"}
        </Button>
        <Button type="button" variant="outline" disabled={savingType !== null} onClick={() => setAll(false)}
          className="border-slate-300 bg-white text-slate-900 hover:bg-slate-100">
          {savingType === "all-no" ? "Saving…" : "Set all to No"}
        </Button>
        <span className="text-xs text-slate-500">Applies to all notification types and saves immediately.</span>
      </div>
      {!data.deliveryConfigured && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Email delivery is not configured. Microsoft Entra credentials and a sender mailbox with Graph Mail.Send permission must be configured before emails can be delivered.
          Switching a notification on does not configure the email provider.
        </p>
      )}
      {!data.linksConfigured && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The published app URL must be configured before request links can be included in emails.
        </p>
      )}
      <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {data.notifications.map((item) => (
          <div key={item.type} className="flex items-center justify-between gap-5 p-5">
            <div className="min-w-0">
              <h3 id={`notification-${item.type}`} className="text-sm font-semibold text-slate-900">{item.name}</h3>
              <p className="mt-1 text-sm text-slate-500">{item.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="min-w-8 text-xs text-slate-500" aria-hidden="true">
                {savingType === item.type ? "Saving…" : item.enabled ? "On" : "Off"}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={item.enabled}
                aria-labelledby={`notification-${item.type}`}
                disabled={savingType !== null}
                onClick={() => toggle(item.type, !item.enabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:opacity-50 ${item.enabled ? "bg-[#1E3A5F]" : "bg-slate-300"}`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${item.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
