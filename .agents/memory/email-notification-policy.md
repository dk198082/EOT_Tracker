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
