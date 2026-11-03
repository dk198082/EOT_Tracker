#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Azure CRM is a shared external database. Schema changes require an explicit,
# reviewed migration; task merges must not automatically issue remote DDL.
pnpm run typecheck:libs
