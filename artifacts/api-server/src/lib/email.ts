/**
 * Email helpers — powered by Resend.
 *
 * All sends are fire-and-forget; a failed email must never surface as an API
 * error to the caller.  Errors are logged and swallowed so the workflow
 * continues even when Resend is misconfigured or temporarily unavailable.
 *
 * Required env vars:
 *   RESEND_API_KEY   — API key from resend.com
 *   RESEND_FROM      — verified sender address, e.g. "ETO Tracker <eto@yourdomain.com>"
 *
 * APP_BASE_URL must identify the published app, never the development preview.
 */

import { Resend } from "resend";
import { logger } from "./logger";
import { getEmailNotificationSettings, type NotificationType } from "./notification-settings";

// ---------- configuration ----------

/**
 * Logs a WARNING for every missing email env var.
 * Call this once at startup so misconfiguration is visible immediately in logs.
 * Returns true when both vars are present and email sending is enabled.
 */
export function checkEmailConfig(): boolean {
  const key = process.env["RESEND_API_KEY"];
  const from = process.env["RESEND_FROM"];
  if (!key) {
    logger.warn("RESEND_API_KEY is not set — email notifications are disabled");
  }
  if (!from) {
    logger.warn("RESEND_FROM is not set — email notifications are disabled");
  }
  return Boolean(key && from);
}

function getResend(): Resend | null {
  const key = process.env["RESEND_API_KEY"];
  if (!key) return null;
  const from = process.env["RESEND_FROM"];
  if (!from) return null;
  return new Resend(key);
}

// Lazily initialised so the server starts even without the key configured.
let _resend: Resend | null | undefined = undefined;
function resend(): Resend | null {
  if (_resend === undefined) _resend = getResend();
  return _resend;
}

function fromAddress(): string {
  return process.env["RESEND_FROM"]!;
}

function appBaseUrl(): string {
  const explicit = process.env["APP_BASE_URL"];
  if (!explicit) throw new Error("APP_BASE_URL is required for email request links");
  const url = new URL(explicit);
  if (url.protocol !== "https:") throw new Error("APP_BASE_URL must use HTTPS");
  return explicit.replace(/\/$/, "");
}

function etoUrl(id: number): string {
  const base = appBaseUrl();
  return `${base}/eto-requests/${id}`;
}

// ---------- HTML escaping ----------

function esc(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- send wrapper ----------

/**
 * Returns true when Resend accepted the message, false on skip or failure.
 * Errors are always logged; they are never re-thrown so callers can treat
 * email as fire-and-forget for responses, but CAN inspect the return value
 * to decide whether to persist a "sent" record.
 */
export async function send(opts: {
  to: string[];
  subject: string;
  html: string;
}): Promise<boolean> {
  const client = resend();
  if (!client) {
    // Configuration absent — log at warn level (already warned at startup)
    // so callers know the message was NOT sent.
    logger.warn({ subject: opts.subject }, "Email skipped: Resend not configured");
    return false;
  }

  const deduplicated = [...new Set(opts.to.filter(Boolean))];
  if (!deduplicated.length) {
    logger.warn({ subject: opts.subject }, "Email skipped: no recipients");
    return false;
  }

  try {
    const { data, error } = await client.emails.send({
      from: fromAddress(),
      to: deduplicated,
      subject: opts.subject,
      html: opts.html,
    });
    if (error) {
      logger.error({ error, subject: opts.subject }, "Resend returned an error — email not delivered");
      return false;
    }
    logger.info({ id: data?.id, subject: opts.subject }, "Email accepted by Resend");
    return true;
  } catch (err) {
    logger.error({ err, subject: opts.subject }, "Failed to send email via Resend");
    return false;
  }
}

// ---------- HTML template helpers ----------

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${esc(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 6px; overflow: hidden; }
    .header  { background: #1a3a5c; padding: 24px 32px; }
    .header h1 { color: #ffffff; font-size: 20px; margin: 0; }
    .body    { padding: 28px 32px; color: #333333; font-size: 15px; line-height: 1.6; }
    .footer  { background: #f0f0f0; padding: 16px 32px; font-size: 12px; color: #888888; }
    .btn     { display: inline-block; margin-top: 20px; padding: 11px 22px; background: #1a3a5c; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 14px; }
    .label   { font-weight: bold; color: #555555; }
    .tag     { display: inline-block; background: #e8f0fe; color: #1a3a5c; padding: 2px 8px; border-radius: 3px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header"><h1>ETO Tracker</h1></div>
    <div class="body">${body}</div>
    <div class="footer">This message was generated automatically by ETO Tracker. Do not reply to this email.</div>
  </div>
</body>
</html>`;
}

function stageLabel(stage: string): string {
  const map: Record<string, string> = {
    draft: "Draft",
    "art-review": "ART Review",
    "engineering-review": "Engineering Review",
    "production-review": "Production Review",
    "art-final-review": "ART Final Review",
    quoted: "Quoted",
    won: "Won",
    declined: "Declined",
    lost: "Lost",
    closed: "Lost",
    abandoned: "Abandoned",
  };
  return map[stage] ?? stage;
}

// ---------- public API ----------

export interface EtoEmailContext {
  etoId: number;
  etoNumber: string;
  customerName: string;
  toStage: string;
  fromStage: string;
  /** Email of the new assignee (may be null/undefined if no single owner). */
  assigneeEmail?: string | null;
  /** Name of the new assignee. */
  assigneeName?: string | null;
  /**
   * Email of the assignee *before* this transition (used for Won notification
   * where assigneeId is cleared as part of the transition).
   */
  prevAssigneeEmail?: string | null;
  /** Emails of ART team members (for "submitted" notifications). */
  artEmails?: string[];
  /** Email of the original submitter (Sales rep). */
  submitterEmail: string;
  submitterName: string;
  decision?: string;
  dueDate?: string | null;
  quoteNumber?: string;
  finalReview?: {
    price?: string | null;
    currency?: string | null;
    leadTime?: string | null;
    description?: string | null;
    notes?: string | null;
  };
}

/**
 * Sends stage-transition notification emails.
 *
 * Each notification is controlled by its own persisted Admin switch.
 */
export type NotificationEmail = { type: NotificationType; to: string[]; subject: string; html: string };

export function buildTransitionEmails(ctx: EtoEmailContext): NotificationEmail[] {
  const link = etoUrl(ctx.etoId);
  const etoTag = `<span class="tag">${esc(ctx.etoNumber)}</span>`;
  const btnHtml = `<a href="${esc(link)}" class="btn">View Request →</a>`;
  const messages: NotificationEmail[] = [];
  const add = (type: NotificationType, to: string[], title: string, body: string) =>
    messages.push({
      type, to,
      subject: `[ETO Tracker] ${title}`.replace(/[\r\n]+/g, " "),
      html: layout(title, `${body}${btnHtml}`),
    });
  if (ctx.toStage === "art-review" && ctx.fromStage !== "art-review") {
    add("art_submission", ctx.artEmails ?? [], `${ctx.etoNumber} — submitted to ART Review`,
      `<p>ETO request ${etoTag} has been submitted to ART Review.</p>
       <p>Customer: ${esc(ctx.customerName)}</p><p>Submitted by: ${esc(ctx.submitterName)}</p>`);
  }
  if (ctx.decision === "approve-engineering") {
    add("sales_art_complete", [ctx.submitterEmail], `${ctx.etoNumber} — ART Review complete`,
      `<p>ART Review is complete for ${etoTag}.</p>
       <p><span class="label">Expected Due Date:</span> ${esc(ctx.dueDate ?? "Not set")}</p>`);
  }
  const assignmentType: NotificationType | undefined =
    ctx.decision === "approve-engineering" ? "art_assignment"
      : ctx.decision === "engineering-quote-ready" ? "engineering_assignment"
        : ctx.decision === "production-approve" ? "production_assignment" : undefined;
  if (assignmentType) {
    const recipients = ctx.assigneeEmail ? [ctx.assigneeEmail]
      : ctx.toStage === "art-final-review" ? ctx.artEmails ?? [] : [];
    add(assignmentType, recipients, `You have been assigned ${ctx.etoNumber}`,
      `<p>You have been assigned ETO ${etoTag}.</p><p>Review stage: ${esc(stageLabel(ctx.toStage))}</p>`);
  }
  if (ctx.decision === "art-final-quote") {
    const output = ctx.finalReview;
    add("quote_generated", [ctx.submitterEmail],
      `${ctx.etoNumber} — Quote ${ctx.quoteNumber ?? "Not provided"} generated`,
      `<p>The final quote for ETO ${etoTag} is ready.</p>
       <p><span class="label">Quote #:</span> ${esc(ctx.quoteNumber)}</p>
       <p><span class="label">Price:</span> ${esc(output?.currency ?? "USD")} ${esc(output?.price ?? "Not provided")}</p>
       <p><span class="label">Lead Time (weeks):</span> ${esc(output?.leadTime ?? "Not provided")}</p>
       <p><span class="label">Description:</span> ${esc(output?.description ?? "Not provided")}</p>
       <p><span class="label">Notes:</span> ${esc(output?.notes ?? "None").replace(/\r?\n/g, "<br>")}</p>`);
  }
  // Preserve the older generic notifications, but make them opt-in too.
  if (!messages.length) {
    const ownerEmail = ctx.toStage === "won" ? ctx.prevAssigneeEmail : ctx.assigneeEmail;
    const recipients = [ctx.submitterEmail, ownerEmail].filter((email): email is string => Boolean(email));
    add("other_workflow_updates", recipients, `${ctx.etoNumber} — ${stageLabel(ctx.toStage)}`,
      `<p>ETO request ${etoTag} has moved to ${esc(stageLabel(ctx.toStage))}.</p>
       <p>Customer: ${esc(ctx.customerName)}</p>`);
  }
  return messages;
}

async function deliverNotifications(messages: NotificationEmail[]): Promise<boolean> {
  const settings = await getEmailNotificationSettings();
  const enabled = messages.filter((message) => settings.some((item) => item.type === message.type && item.enabled));
  if (!enabled.length) return false;
  const results = await Promise.all(enabled.map((message) => send(message)));
  return results.every(Boolean);
}

export async function sendTransitionEmails(ctx: EtoEmailContext): Promise<boolean> {
  return deliverNotifications(buildTransitionEmails(ctx));
}

export async function sendReassignmentEmail(ctx: {
  etoId: number; etoNumber: string; department: "engineering" | "production"; email: string;
}): Promise<boolean> {
  return deliverNotifications([{
    type: ctx.department === "engineering" ? "engineering_reassignment" : "production_reassignment",
    to: [ctx.email],
    subject: `[ETO Tracker] You have been assigned ${ctx.etoNumber}`.replace(/[\r\n]+/g, " "),
    html: layout(`You have been assigned ${ctx.etoNumber}`,
      `<p>You have been assigned ETO <strong>${esc(ctx.etoNumber)}</strong>.</p>
       <p>This ${esc(ctx.department)} review has been re-assigned to you.</p>
       <a href="${esc(etoUrl(ctx.etoId))}" class="btn">View Request →</a>`),
  }]);
}

/**
 * Sends an inactivity reminder to the current owner of an ETO.
 */
/**
 * Returns true when Resend accepted the message, false on skip or failure.
 * Callers MUST check the return value before persisting a "reminded" record.
 */
export async function sendInactivityReminder(opts: {
  etoId: number;
  etoNumber: string;
  customerName: string;
  stage: string;
  daysInactive: number;
  ownerEmail: string;
  ownerName: string;
}): Promise<boolean> {
  const settings = await getEmailNotificationSettings();
  if (!settings.some((item) => item.type === "inactivity_reminder" && item.enabled)) return false;
  const link = etoUrl(opts.etoId);
  const etoTag = `<span class="tag">${esc(opts.etoNumber)}</span>`;
  const subject = `[ETO Tracker] Reminder: ${esc(opts.etoNumber)} waiting ${opts.daysInactive} days`;

  const html = layout(
    `Reminder: ${opts.etoNumber}`,
    `<p>ETO request ${etoTag} has been waiting for your action for <strong>${opts.daysInactive} day${opts.daysInactive !== 1 ? "s" : ""}</strong>.</p>
     <p><span class="label">Customer:</span> ${esc(opts.customerName)}</p>
     <p><span class="label">Current stage:</span> ${esc(stageLabel(opts.stage))}</p>
     <p>Please log in and take action so this request can move forward.</p>
     <a href="${esc(link)}" class="btn">Open Request →</a>`,
  );

  return send({ to: [opts.ownerEmail], subject, html });
}
