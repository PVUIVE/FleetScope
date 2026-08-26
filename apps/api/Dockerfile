# FleetScope bounded API — Cloud Run target.
#
# Constraints this image honors:
#   - production dependencies only
#   - non-root runtime user
#   - listens on $PORT, defaults to 8080
#   - NO baked secrets: credentials come from the Cloud Run service account
#   - NO worker, cron, or background process; the container idles at zero cost
#     with min-instances=0
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/domain/package.json ./packages/domain/
COPY packages/event-schema/package.json ./packages/event-schema/
COPY packages/platform-adapters/package.json ./packages/platform-adapters/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter @fleetscope/api...

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM base AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV APP_ENV=production
# Recorded-only unless the deployment explicitly overrides it.
ENV LIVE_MODE=false
ENV PORT=8080

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY apps/api ./apps/api
COPY packages/domain ./packages/domain
COPY packages/event-schema ./packages/event-schema
COPY packages/platform-adapters ./packages/platform-adapters
COPY packages/shared ./packages/shared

USER node
EXPOSE 8080
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
