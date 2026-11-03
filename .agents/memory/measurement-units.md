---
name: Measurement units
description: Unit storage and display rules for expected force and displacement values.
---

Expected force and displacement keep their entered range text separate from the
selected unit. Force supports `kN`, `lbs`, and `N`; displacement supports `mm` and
`in`. New requests default to `N` and `mm`.

**Why:** Users need explicit, constrained units without embedding unit text in
otherwise free-form range values, and split requests must preserve the original
measurement context.

**How to apply:** Persist units as separate fields, validate them at the API
boundary, copy them during request splits, and show the unit beside the value
in create, edit, and read-only views. Avoid duplicating a suffix on legacy
values that already contain a written unit.