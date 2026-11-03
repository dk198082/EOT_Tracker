---
name: Portal color safety
description: Why reassignment popups use explicit colors and how to avoid repeating their contrast failure.
---

Use opaque, high-contrast surfaces for portals and verify their computed browser
colors, not just the presence of background classes.

**Why:** A user reported an unreadable reassignment dialog on 2026-10-20. Invalid
shared theme values left the dialog transparent over a dark backdrop. The fix
was deliberately scoped to reassignment rather than silently restyling the app.

**How to apply:** When adding dialogs or dropdowns, check the shared palette
before trusting semantic theme utilities. Until that palette has been repaired
and verified, give the entire portal—including its dropdown and action
buttons—explicit colors consistent with the existing light interface.
