---
name: ETO workflow state machine
description: Configurable stage/decision/role matrix for the ETO Tracker workflow, including optional specialist reviews and terminal outcomes.
---

## Stages
draft → art-review → [engineering-review] → [production-review] → art-final-review → quoted → won | lost

Engineering Review and Production Review are independently optional. ART chooses
which to include when approving ART Review; both default to included.

ART Review and ART Final Review may end in declined. Any active stage may be abandoned and later re-opened by ART/SuperUser.

## Decision → Stage Map
| From Stage         | Decision                  | To Stage          | Role           |
|--------------------|---------------------------|-------------------|----------------|
| draft              | submit                    | art-review        | sales, art     |
| art-review         | approve-engineering       | first included specialist stage, otherwise art-final-review | art |
| art-review         | return-draft              | draft             | art            |
| art-review         | decline                   | declined          | art            |
| engineering-review | engineering-quote-ready   | production-review if included, otherwise art-final-review | engineering |
| engineering-review | engineering-return-art    | art-review        | engineering    |
| production-review  | production-approve        | art-final-review  | production     |
| production-review  | production-return-engineering | engineering-review if included, otherwise art-review | production |
| art-final-review   | art-final-quote           | quoted            | art            |
| art-final-review   | art-final-return-production | latest included specialist stage, otherwise art-review | art |
| art-final-review   | art-final-return-engineering | engineering-review, only after Engineering was completed | art |
| art-final-review   | decline                   | declined          | art            |
| quoted             | mark-won                  | won               | sales, art     |
| quoted             | mark-lost                 | lost              | sales, art     |
| quoted             | quoted-return-art-final   | art-final-review  | sales, art     |

## Critical Rules
**Why:** Some requests do not need one or both specialist reviews. ART owns that
choice, while the tracker must preserve each stage icon and visibly mark stages
that were not included.

1. **Every active transition changes stage** — no same-stage More Info decisions. Backward work moves to the latest included preceding stage and requires a reason.
2. **ART selects specialist reviews** — Engineering and Production default to included but can be independently skipped; both may be skipped.
3. **Sticky engineer** — set when ART includes and assigns Engineering, then reused whenever backward routing targets Engineering. An explicit reassignment during Engineering Review changes both the active assignee and sticky engineer.
4. **Outputs are upserted** — returning and advancing again updates the one output row for each specialist stage rather than creating duplicates.
5. **Lost and Declined are distinct** — Lost is a post-quote sales outcome; Declined is an internal ART rejection. Production cannot decline a request.
6. **Closed is legacy-only** — older Closed rows and historical transition decisions remain readable without rewriting audit history.
7. **Direct ART Final return to Engineering** — offer this only when Engineering has a committed completion transition; re-include Engineering and restore the sticky engineer.
8. **Returned-stage output reuse** — when a completed output stage is revisited, prefill its Workflow Actions form from the latest saved output so users edit rather than re-enter values.

## Default reviewer policy
Engineering and Production reviewers may use Re-Assign within their current
review stage to choose another user in that same department. This is assignment
maintenance, not review completion or a stage transition; preserve saved work
and existing deadlines, and keep the deliberately selected reviewer on later
returns.

**Why:** The user requested departmental reassignment without moving the ETO
or repeating review work on 2026-10-20.

**How to apply:** Keep Engineering's sticky reviewer and Production's retained
reviewer aligned with explicit reassignment. Do not use stage-transition
history to represent an assignment-only change.

Default Engineering and Production reviewers apply when a request enters the respective review stage unless ART has chosen a per-request reviewer. ART may override either specialist default. A Production choice made during ART acceptance must survive the intervening Engineering stage and later backward returns, just as Engineering keeps its sticky reviewer.

**Why:** Changing an admin-wide default must not silently overwrite deliberate assignments or rewrite the ownership of work already in progress. Production selection occurs before that stage may begin, so keeping only the currently active assignee would lose ART's choice.

**How to apply:** Use the current defaults for newly entered stages, but treat existing assignees and sticky reviewers as intentional. Any backfill of already-open unassigned reviews is a separate, explicit action.

**How to apply:** Persist both inclusion choices on each request, use them for
forward and backward routing, and keep skipped stage icons visible. If ART
excludes a previously visited specialist stage after a return, its current
progress icon and timestamp are replaced by the skipped visual; historical
transitions and saved outputs remain available in the audit trail.

## ART entity and quoted-part description

ART Review starts with an Entity selection offering TOUS or TOUK. ART Final
Review's Generate Quote form has a Description for the quoted part immediately
after Market Lead Time, separate from general Notes; it is required and cannot
be blank when generating or editing a final quote.

**Why:** On 2026-10-08, the user requested these fields at these workflow stages.

**How to apply:** Keep Entity entry in ART Review and preserve the choice on the
request. Keep the part description with the final quote, including later edits
and quote regeneration; reject missing or whitespace-only descriptions for
new quote writes. Do not repurpose customer requirements or Notes as the part
description, or silently assign an entity to historical requests.

## Entity-specific reviewer defaults

The pre-existing Engineering and Production defaults belong to TOUS. TOUK has
its own independently configured pair; do not initialize it by copying TOUS
reviewers or silently fall back to TOUS for an explicitly TOUK request.

**Why:** The user requested that the current two default assignments become the
TOUS defaults, with two additional choices for TOUK. Copying the old choices
would assign staff without the admin choosing the UK reviewers.

**How to apply:** Resolve defaults using the Entity selected during ART
acceptance and the saved Entity on subsequent stage entries. Preserve explicit
request assignments and sticky reviewers. For historical requests with no
Entity, keep the previous default behavior without populating their Entity.
Changing admin defaults must not retroactively reassign existing requests.
