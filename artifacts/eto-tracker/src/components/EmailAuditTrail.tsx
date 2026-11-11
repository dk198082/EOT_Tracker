import { getListEmailHistoryQueryKey, useListEmailHistory } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

const statusLabel: Record<string, string> = {
  pending: "Pending / unconfirmed",
  accepted: "Accepted by Graph",
  partial: "Partially accepted",
  failed: "Failed",
  skipped: "Skipped — no recipients",
};

export function EmailAuditTrail({ requestId }: { requestId: number }) {
  const { data, isPending, isError, isFetching, refetch } = useListEmailHistory(requestId, {
    query: { queryKey: getListEmailHistoryQueryKey(requestId), staleTime: 0, refetchInterval: 10000 },
  });

  return (
    <section aria-label="Email notification history" className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-slate-500">
          One entry per event, with all recipients grouped together. Graph acceptance does not confirm inbox delivery.
        </p>
        <Button type="button" variant="outline" size="sm" disabled={isFetching}
          onClick={() => refetch()}>Refresh</Button>
      </div>
      {isPending ? <p className="py-4 text-sm text-slate-500">Loading email history…</p>
        : isError ? <p role="alert" className="text-sm text-red-700">Email history could not be loaded. Please try Refresh.</p>
          : !data?.length ? (
            <p className="py-4 text-center text-sm text-slate-500">
              No email notifications recorded. History starts with this feature; disabled notifications are not logged.
            </p>
          ) : (
            <div className="space-y-4">
              {data.map((event) => (
                <article key={event.id} className="space-y-2 border-l-2 border-blue-200 pl-3">
                  <p className="text-sm font-medium text-slate-800">{event.eventName}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={event.status === "accepted" ? "font-medium text-green-700"
                      : event.status === "failed" || event.status === "partial" ? "font-medium text-red-700"
                        : "font-medium text-slate-600"}>{statusLabel[event.status]}</span>
                    <time dateTime={event.createdAt} className="text-slate-500">
                      {format(new Date(event.createdAt), "dd MMM yyyy, HH:mm:ss")}
                    </time>
                  </div>
                  <div className="text-xs text-slate-600">
                    <p className="font-medium">Recipients ({event.recipients.length})</p>
                    {event.recipients.length ? (
                      <ul className="space-y-0.5">
                        {event.recipients.map((recipient) => <li key={recipient} className="break-all">{recipient}</li>)}
                      </ul>
                    ) : <p>No recipients available.</p>}
                  </div>
                  {event.messages.map((message, index) => (
                    <div key={index} className="rounded bg-slate-50 p-2 text-xs text-slate-600">
                      <p className="font-medium">{message.name}</p>
                      <p className="break-words">{message.subject}</p>
                      <p>{statusLabel[message.status]}</p>
                      {event.messages.length > 1 && <p className="break-all">To: {message.recipients.join(", ") || "None"}</p>}
                    </div>
                  ))}
                </article>
              ))}
            </div>
          )}
    </section>
  );
}
