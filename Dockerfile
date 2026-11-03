# syntax=docker/dockerfile:1
#
# Builds ONE container that runs the Express API (artifacts/api-server) and
# also serves the built frontend (artifacts/eto-tracker) as static files, so
# the whole app deploys as a single Azure App Service (Web App for
# Containers) or Azure Container Apps instance.
#
# See AZURE_DEPLOYMENT.md for the required Azure resources and environment
# variables (AZURE_PG_*, CLIENT_ID/CLIENT_SECRET/TENANT_ID,
# ADMIN_CONSOLE_URL/ADMIN_CONSOLE_API_KEY, RESEND_API_KEY, CORS_ORIGIN,
# etc.) — none of those are baked into the image; they're supplied at
# deploy time as App Settings / Container Apps secrets.
#
# ⚠️ File attachments (uploads/downloads) are NOT covered by this
# Dockerfile. See AZURE_DEPLOYMENT.md's "Object storage" section — the
# app's storage code is wired to a Replit-only sidecar and will fail at
# runtime on Azure until that's addressed separately.
#
# This is a single-stage build (not multi-stage). pnpm workspaces hoist
# dependencies via symlinks into a content-addressable store, which is fragile
# to split across build/runtime stages with a plain COPY. Building and
# running from the same image is a bit larger but reliable; shrink it later
# with a multi-stage `pnpm deploy` step if image size becomes a problem.

FROM node:24-bookworm-slim

WORKDIR /repo

RUN corepack enable

# Copy just the manifests first so `pnpm install` is cached across builds
# that only change application source.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/api-server/package.json artifacts/api-server/package.json
COPY artifacts/eto-tracker/package.json artifacts/eto-tracker/package.json
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/package.json
COPY lib/db/package.json lib/db/package.json
COPY lib/api-zod/package.json lib/api-zod/package.json
COPY lib/api-client-react/package.json lib/api-client-react/package.json
COPY lib/api-spec/package.json lib/api-spec/package.json
COPY lib/object-storage-web/package.json lib/object-storage-web/package.json
COPY lib/replit-auth-web/package.json lib/replit-auth-web/package.json
COPY scripts/package.json scripts/package.json

RUN pnpm install --frozen-lockfile

COPY . .

# vite.config.ts requires PORT and BASE_PATH to even *load* the config, for
# both `dev` and `build`. PORT is a dummy value here — only read at build
# time, doesn't affect the runtime container. BASE_PATH is real: this app
# is served from the site root, so BASE_PATH=/ here matches STATIC_DIR
# serving it from the root below.
ENV PORT=4173
RUN BASE_PATH=/ pnpm --filter @workspace/eto-tracker run build

RUN pnpm run typecheck:libs
RUN pnpm --filter @workspace/api-server run build

# --- Runtime ---------------------------------------------------------------
ENV NODE_ENV=production
# Azure App Service for Containers / Container Apps inject PORT themselves
# (App Service defaults to 8080 for custom containers); this is just the
# in-container default so `docker run -p 8080:8080` works out of the box.
ENV PORT=8080
ENV STATIC_DIR=/repo/artifacts/eto-tracker/dist/public

EXPOSE 8080

WORKDIR /repo/artifacts/api-server
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
