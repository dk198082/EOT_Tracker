---
name: PostgreSQL catalog array parsing
description: A node-postgres type-parsing trap during schema introspection.
---

When building catalog queries for migrations, cast catalog identifier values to
`text` inside `ARRAY(...)`; do not assume a PostgreSQL `name[]` result is a
JavaScript array.

**Why:** node-postgres returned `name[]` catalog results as raw strings such as
`{id}`, while `text[]` returned actual arrays. TypeScript result annotations do
not validate or convert these values, so a correctly typed introspection query
can still fail when constructing constraints.

**How to apply:** Use `ARRAY(SELECT attname::text ...)` and validate array shapes
before constructing SQL from introspected catalog metadata.
