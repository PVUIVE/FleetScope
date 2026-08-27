# syntax=docker/dockerfile:1

# Build the Cockpit WASM artifact first. The static web bundle imports the
# stable, unhashed /wasm/cockpit.js output produced by Trunk.
FROM rust:1.90.0-bookworm AS cockpit-wasm
ARG TRUNK_VERSION=0.21.14
WORKDIR /repo

RUN rustup target add wasm32-unknown-unknown \
  && cargo install --locked trunk --version "${TRUNK_VERSION}"

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY vendor ./vendor

RUN mkdir -p apps/web/public/wasm \
  && cd crates/fleet-cockpit-web \
  && trunk build --release

# Build the Astro static application. Recorded Mode is deliberately baked into
# this public/demo image: no API URL and no model credentials are present.
FROM node:22.18.0-bookworm-slim AS web-build
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
WORKDIR /repo

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY --from=cockpit-wasm /repo/apps/web/public/wasm ./apps/web/public/wasm

RUN pnpm install --frozen-lockfile

ENV PUBLIC_DEFAULT_CASE_ID=CASE-1042
ENV PUBLIC_LIVE_MODE=false
ENV PUBLIC_API_BASE_URL=""
RUN pnpm build:web

# Nginx's official entrypoint expands ${PORT} in template files, so Railway's
# injected port is honored while local Docker runs default to 8080.
FROM nginx:1.27.5-alpine AS runtime
ENV PORT=8080
COPY railway/nginx.default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=web-build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
