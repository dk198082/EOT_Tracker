---
name: Request Details editing permissions
description: Only ART and SuperUser may edit existing Request Details.
---

Only the ART and SuperUser groups may edit existing Request Details. Sales,
Engineering, Production, and Admin are read-only for this section; ownership
does not grant an exception.

**Why:** On 2026-10-02, the user explicitly restricted Request Details editing
to ART and SuperUser.

**How to apply:** Enforce this in both the UI and the edit API, using effective
roles during simulation. Remove open edit controls when permissions change.
Keep this restriction scoped to existing Request Details: do not extend it
to request creation or change other sections' permissions without a request.