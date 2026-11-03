---
name: Role snapshots and late Entra sign-ins
description: Why one-time role imports may not grant roles to new Entra-linked rows after provider migration.
---

One-time imports that target only already linked users can finish before an individual first signs in through a new identity provider. A later Entra-linked row may then receive the application's default role even while an older, same-email user record retains a privileged role.

**Why:** Provider changes preserve older identity-linked rows for history, but the new provider's object ID links to a different row; the completed import will not rerun. Broadly inheriting privileges from any same-email row at every login would create an account-takeover risk if an email address changes hands.

**How to apply:** Inspect the linked identity format and actual current row before repairing a role. Keep corrections narrowly scoped and one-time, and avoid ongoing authorization based solely on email equality. Reconcile historical record ownership separately when that is in scope.