---
name: Production output units
description: Why historical production lead-time values remain separate from procurement and assembly estimates.
---

Keep historical manufacturing and production lead times separate from the newer
procurement lead time, procurement cost, and assembly time.

**Why:** Older production lead times were recorded in weeks. Relabeling them as
assembly hours would silently change their meaning. The old manufacturing lead
time also should not be presented as a confirmed procurement estimate.

**How to apply:** New Production completions record the new fields. Display
historical values under their original labels when present, without migrating
or converting them unless the user explicitly requests a data migration.

Calculated assembly cost and lead time are saved snapshots, not live formulas.
Admin updates to the assembly hourly rate, working hours per week, or capacity
factor affect future Production completions only. An explicit edit to saved
assembly hours recalculates with that ETO's original formula constants.

**Why:** This matches the Design formula's historical-stability behavior;
otherwise a settings change would silently rewrite previously quoted results.

**How to apply:** Keep saved assembly results and their formula inputs together.
Do not retroactively recalculate old Production outputs solely because an
Admin changed the formula.