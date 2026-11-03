---
name: SuperUser role simulation
description: Durable identity, authorization, and audit rules for pilot role simulation.
---

SuperUser role simulation may change only the effective application role. It
must never replace the authenticated identity, mutate the account's stored
role, or alter ownership checks. Admin is an intentionally supported simulated
role, but SuperUser-only capabilities must continue to check the real role.

**Why:** Pilot testers need to experience the exact UI and server permissions
of each ordinary role without creating extra accounts or making audit history
look as though another person performed the action.

**How to apply:** Validate every simulation request against the authenticated
user's live stored SuperUser role and an explicit role allowlist. Downstream
role authorization uses the effective role; identity, ownership, and audit
actor IDs use the real user. Audit records that represent role-driven actions
should retain the simulated-role context separately.