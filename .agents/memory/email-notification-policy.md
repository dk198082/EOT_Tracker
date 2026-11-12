---
name: Email notification policy
description: Requested notification recipients, initial opt-in rollout, final-quote contents and production-link safety.
---

Automatic email notification types must have independent Admin controls and
start disabled. Preserve explicit administrator choices when applying later
additive migrations; do not reset switches on startup or redeployment.

**Why:** The user requested per-notification toggles and explicitly asked for
all of them to start off. Existing reminders and generic updates also need
controls so they cannot bypass the disabled rollout.

**How to apply:** New notification types need an off-by-default stored setting
and a matching Admin control. Disabling sending must not prevent a workflow
action from completing or change its owner/stage.

Recipient policy: ART submissions go to ART users. ART completion and generated
quotes go to the original Submitted by user, not the entire Sales department.
Confirmation notifications go to the next assigned user; when advancing into
the shared ART Final Review queue without one owner, notify ART users.
Reassignment notifications are only for the new reviewer after an actual,
committed assignment change; failed and unchanged actions must not send.

**Why:** These implement the user's requested event/recipient list while
respecting the existing shared ART queue and avoiding duplicate submissions.

**How to apply:** ART completion includes the expected due date. Generated
quotes include Price, Lead Time, Description and Notes; their subject references
both the ETO number and Quote number. All request links use the verified
published app origin, never a development-domain fallback. Off switches are not
authorization to send live test messages.

Microsoft Graph is the outbound email provider. Use app-only Entra credentials
and send from `no-reply@tiniusolsen.com`. The Entra application needs app-only
send authorization: Graph `Mail.Send` Application permission with administrator
consent, or an explicitly configured Exchange application RBAC equivalent.
Delegated `Mail.Send` alone is insufficient; the sender must also be an
accessible Exchange mailbox.

**Why:** The user requested Graph API delivery using the existing Entra app and
specified the notification sender mailbox.
Unattended notifications have no signed-in user's mail permissions to inherit;
successful token acquisition does not establish permission to send mail.

**How to apply:** Keep notification triggers and independent Admin switches
provider-neutral; configure Graph credentials and sender mailbox in the
environment, and never put credential values in code or logs.

Permission changes do not update already-issued Graph tokens. A newly consented
permission can be present in a fresh token while a running process still uses
its older cached authorization.

**Why:** A retry after administrator consent can still be rejected until the
old token is replaced; this is distinct from mailbox access restrictions.

**How to apply:** Recheck fresh application permission claims without exposing
tokens. Refresh authorization after an explicit rejection, but never replay
accepted sends or ambiguous network failures merely to refresh credentials.

Email audit history is grouped by the originating event, not by recipient or
individual message. An action sending both Sales and assignment notifications
must still appear as one event with all recipients together.

**Why:** The user explicitly requested one entry per event rather than a
separate entry for every recipient.

**How to apply:** Retain per-message outcomes within the event when necessary.
Label Graph acceptance separately from confirmed inbox delivery, which is not
established by a successful sendMail response. Do not reconstruct historical
sends from workflow transitions or pretend disabled notifications were sent.
