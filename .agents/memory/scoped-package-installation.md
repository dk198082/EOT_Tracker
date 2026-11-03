---
name: Scoped package installation
description: Workspace-specific limitation observed in the Replit language package installer
---

The Node language package installer runs `pnpm add` at the workspace root, where pnpm refuses implicit root additions. It also rejects `--filter` as an invalid package token, so it cannot directly add dependencies to a particular workspace package.

**Why:** Both the plain package request and a filtered request failed before installation; this is a tool limitation, not an unavailable package.

**How to apply:** For a monorepo package addition, first look for an existing dependency or a way to use the owning library's public API. Do not interpret a failed root install as evidence that the package itself cannot be used.