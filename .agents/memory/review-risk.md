---
name: Review risk semantics
description: Meaning of missing scores and conditional explanations in specialist reviews.
---

Do not treat an unscored Engineering or Production review as Low risk. Do not
preselect a score unless it was previously recorded. High requires a dedicated
risk explanation, not just general review notes.

Risk Score is required when completing or saving an Engineering or Production
review. Historical unscored records remain readable without inventing a score;
the user must choose a score when editing them.

**Why:** On 2026-10-02, the user explicitly made Risk Score mandatory. Historical
reviews were not risk-assessed, so assigning Low to their missing scores would
invent a safety assessment.

**How to apply:** Keep missing scores nullable, preserve recorded risk on ordinary
output edits that omit risk fields when a valid score exists, and validate the
required score and High explanations on the server
as well as in the form. Scores and explanations belong to each specialist's
review independently.