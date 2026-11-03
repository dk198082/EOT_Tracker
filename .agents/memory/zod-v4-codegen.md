---
name: Zod v4 codegen fix
description: Orval v8.23+ generates Zod v4-only APIs (zod.int(), zod.email()) but the workspace catalog uses Zod v3 (^3.25.76). Post-process the generated api-zod file after every codegen run.
---

## The Rule
After running `orval --config ./orval.config.ts`, run a sed/node script on `lib/api-zod/src/generated/api.ts` to replace:
- `zod.int()` → `zod.number().int()`
- `zod.email()` → `zod.string().email()`
- `zod.url()` → `zod.string().url()`

## Why
Orval v8.23.0 added Zod v4 API output (zod.int(), zod.email() as standalone primitives). The pnpm workspace catalog pins `zod: ^3.25.76` (v3). In Zod v3, `z.int()` does not exist — only `z.number().int()`. Upgrading to Zod v4 would require updating all drizzle-zod and drizzle-orm peer dependencies, which is a larger change.

## How to Apply
The fixup is already baked into the `codegen` script in `lib/api-spec/package.json`. When adding new integer/email fields to the OpenAPI spec and regenerating, run `pnpm --filter @workspace/api-spec run codegen` — the fixup runs automatically.

If you ever see `Property 'int' does not exist on type 'typeof import(…zod…)'` TypeScript errors after codegen, this is the cause.
