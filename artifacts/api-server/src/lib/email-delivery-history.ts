import { db, emailDeliveryEventsTable, type EmailDeliveryMessage } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export interface AuditedEmail {
  name: string;
  to: string[];
  subject: string;
  html: string;
}

export function uniqueEmailRecipients(recipients: string[]): string[] {
  const unique = new Map<string, string>();
  for (const recipient of recipients) {
    const trimmed = recipient.trim();
    if (trimmed && !unique.has(trimmed.toLowerCase())) unique.set(trimmed.toLowerCase(), trimmed);
  }
  return [...unique.values()];
}

/** One durable row per originating event, not per message or recipient. */
export async function deliverLoggedEmails(
  etoRequestId: number,
  eventName: string,
  emails: AuditedEmail[],
  sender: (email: { to: string[]; subject: string; html: string }) => Promise<boolean>,
): Promise<boolean> {
  if (!emails.length) return false;
  const normalized = emails.map((email) => ({ ...email, to: uniqueEmailRecipients(email.to) }));
  const messages: EmailDeliveryMessage[] = normalized.map((email) => ({
    name: email.name, subject: email.subject, recipients: email.to, status: "pending",
  }));
  try {
    // Do not send untracked emails if the audit record cannot be persisted.
    const [event] = await db.insert(emailDeliveryEventsTable).values({
      etoRequestId, eventName, messages,
      recipients: uniqueEmailRecipients(normalized.flatMap((email) => email.to)),
      status: "pending",
    }).returning({ id: emailDeliveryEventsTable.id });
    if (!event) throw new Error("Email audit insert did not return an event ID");
    await Promise.all(normalized.map(async (email, index) => {
      if (!email.to.length) { messages[index].status = "skipped"; return; }
      try {
        messages[index].status = await sender(email) ? "accepted" : "failed";
      } catch (error) {
        messages[index].status = "failed";
        logger.error({ err: error, etoRequestId }, "Email sender failed");
      }
    }));
    const accepted = messages.filter((message) => message.status === "accepted").length;
    const status = accepted === messages.length ? "accepted"
      : accepted > 0 ? "partial"
        : messages.every((message) => message.status === "skipped") ? "skipped" : "failed";
    try {
      await db.update(emailDeliveryEventsTable).set({
        status, messages, completedAt: new Date(),
      }).where(eq(emailDeliveryEventsTable.id, event.id));
    } catch (error) {
      logger.error({ err: error, etoRequestId }, "Email outcome is unconfirmed in history; delivery must not be retried");
    }
    return status === "accepted";
  } catch (error) {
    logger.error({ err: error, etoRequestId }, "Could not persist email event history");
    return false;
  }
}
