---
name: ETO due dates
description: Due-date baseline, inclusion semantics, calendar handling, and return policy.
---

The user chose ART acceptance, not request creation, as the Due Date baseline.
Add Engineering and Production durations only when their reviews are included,
and always add ART Final Review duration (default one week each). Keep the
recorded schedule fixed when the request returns to ART.

Retain a skipped review's entered duration so rechecking restores it, but
exclude it from the preview and the server-calculated deadline.

**Why:** On 2026-10-02, the user explicitly changed the original all-three
calculation to omit unchecked Engineering and Production reviews. The
ART-acceptance baseline remains confirmed. Returns are rework, not a fresh
initial review, and must not silently postpone the deadline.

**How to apply:** Record the acceptance calendar day using the reviewer's time
zone, calculate date-only values without DST offsets, and round any combined
partial day upward. Do not fabricate deadlines for historical requests that
have no recorded schedule or reinterpret the existing inactivity-based overdue
alerts as deadline-based without a separate request.

Display the Engineering, Production, and ART Final Review planned due dates as
cumulative deadlines from the original ART acceptance date, in addition to the
existing overall Due Date. They supplement it; they do not replace it or become
rolling deadlines when a request enters or returns to a review.

**Why:** On 2026-10-05, the user explicitly requested a due date for each review
step as a complement to the final deadline calculated from the sum.

**How to apply:** Use the initially accepted review selection and recorded
durations for the planned step deadlines. Keep the saved overall deadline
authoritative, including for ART Final Review; do not infer missing historical
schedules or overwrite dates when displaying them.