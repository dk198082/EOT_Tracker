# Task 77 — ART acceptance due-date persistence

## Result

Authenticated browser journey completed with isolated synthetic ART, Engineering,
Production, and Sales users and one synthetic ETO. No real users, ETOs, reviewer
defaults, or workflow rules were modified.

## Checks

- Opened the synthetic ETO in ART Review and selected synthetic Engineering and
  Production reviewers.
- Entered Engineering `0.5`, Production `1.25`, and ART Final `0.25` weeks.
- Toggled Engineering off: its duration and assignment controls hid; Production
  remained visible; preview stayed **October 16, 2026**.
- Toggled Production off: both review sections hid while ART Final remained and
  preview stayed **October 16, 2026**.
- Re-enabled Engineering and Production; their values and reviewer selections
  were restored (0.5 / synthetic Engineer; 1.25 / synthetic Production).
- Initial acceptance POST `/api/eto-requests/<synthetic-id>/transitions` returned
  HTTP 200. It included `approve-engineering`, both inclusion flags, the chosen
  synthetic reviewers, all three durations, and browser timezone `UTC`.
- API response and database both recorded stage `engineering-review`, accepted
  date `2026-10-02`, and due date `2026-10-16` (14 calendar days from the
  browser-local acceptance date, October 2, 2026). The persisted assignments
  were the selected synthetic Engineer in `assigneeId` and `stickyEngineerUserId`
  and the synthetic Production reviewer in `productionAssigneeId`.
- Reload showed Due Date **October 16, 2026**.
- Signed in as the synthetic Engineer and used the browser “Back to ART Review”
  action with reason `Synthetic task 77 test return to ART`. The return POST
  returned HTTP 200 and preserved the deadline, accepted date, durations,
  sticky Engineer, and Production assignment.
- Reloaded as synthetic ART. The acceptance form showed the unchanged
  **October 16, 2026** deadline, disabled duration controls at 0.5 / 1.25 /
  0.25 weeks, and the retained synthetic Production reviewer.
- Optional reacceptance returned HTTP 200 and exercised the existing deadline
  guard: API and DB still showed due date `2026-10-16`, accepted date
  `2026-10-02`, all durations, and the synthetic reviewer assignments.
- No comments were submitted and notifications were not observed.

## Cleanup

Deleted the synthetic ETO, its dependent stage transitions, comments, outputs,
detail changes and attachments, all four synthetic users, and all four local
sessions. Post-cleanup verification returned zero ETO, user, session, or
ETO-dependent rows for these fixtures. Browser cookies were cleared. No
temporary fixture files or application-code changes were made.

## Notes and evidence

- After the Engineering return, the reopened ART form initially displayed the
  existing Engineering reviewer default rather than the stored sticky Engineer.
  The sticky Engineer remained persisted; the synthetic Engineer was explicitly
  reselected before optional reacceptance, so no reviewer default was changed.
- Browser screenshots were captured by the test platform and are referenced by
  their observation IDs below. This browser interface does not expose those
  screenshot bytes as local files; therefore image files could not be written
  into this directory. The screenshot references are also attached to the test
  report.
- Initial acceptance form and preview: `191ux8`, `lglmwn`.
- Open reviewer options and selected synthetic reviewers: `9k5ath`, `bgpdvf`,
  `xl5ans`.
- Engineering hidden / both review sections hidden: `9f47lb`, `krmkpb`.
- Re-enabled reviewer selections and retained values: `ggisye`, `kyt4ty`.
- Initial acceptance, response, and persisted Due Date: `g8iocx`, `446ay8`.
- Engineering return action and return result: `xx274s`, `mpmnko`, `3ok496`.
- Returned ART form with stored deadline / disabled durations and retained
  Production: `rjml1r`, `8mnr6x`, `khxmsd`.
- Reacceptance and final persistence: `bq9lpt`.