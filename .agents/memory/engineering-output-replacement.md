---
name: Engineering output replacement
description: How to preserve historical engineering estimates after the workflow starts collecting design hours.
---

Record estimated design hours separately. Do not reinterpret historical cost
estimates or document lead times as hours, or erase them when an older request
returns to Engineering Review.

**Why:** Money and week-based lead times cannot be converted into design hours.
Keeping historical values readable avoids losing the meaning of previous work.

**How to apply:** New Engineering Review completions collect design hours. Preserve
and display older cost/lead-time values where they already exist; update legacy
fields only if the user explicitly requests a historical-data change.

Calculated Design Cost and Design Lead Time are snapshots, not live formulas.
Admin changes to the hourly rate, working hours per week, or capacity factor
must not recalculate results already saved on older ETOs.

**Why:** The user explicitly chose to keep older ETO results unchanged when
Admin formula values are adjusted. Past estimates should not shift silently.

**How to apply:** Apply the current formula to future Engineering completions.
If someone explicitly edits an existing ETO's design hours, recalculate using
that ETO's saved formula constants rather than today's Admin settings.