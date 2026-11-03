---
name: Shared cutover client safety
description: Why open ETO forms must retain their pre-cutover identity rather than adopting refreshed mappings.
---

After request/user IDs are remapped, require users to reload and reopen the intended
record. Never silently replace an open form's record identity or migration epoch
with values from a background list/detail refresh.

**Why:** A refreshed numeric ID can now identify a different source request. Giving
an old form that new identity would authorize saving its old contents onto the
wrong record. Pinning the old context causes a safe rejection instead.

**How to apply:** Preserve this rejection behavior when changing query-cache,
autosave, navigation, role-management or upload flows. New drafts may use the
trusted identity returned by their own creation response for immediate uploads;
this is not permission to upgrade an older open form.
