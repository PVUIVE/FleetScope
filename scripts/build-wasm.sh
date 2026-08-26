#!/usr/bin/env bash
# Build the Fleet Cockpit WASM bundle and stage it for the Astro static build.
#
# `trunk` is an explicit prerequisite and is NOT auto-installed: silently
# installing a toolchain during a build is how a "works on my machine" demo
# happens. If it is missing this fails loudly with the exact install command.
#
# The crate is crates/fleet-cockpit-web — its own workspace, wasm32-only. Its
# Trunk.toml and .cargo/config.toml live beside it, and trunk runs from there, so
# cargo's config discovery picks up the wasm32 default target with one copy.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v trunk >/dev/null 2>&1; then
  echo "ERROR: 'trunk' is not installed." >&2
  echo "Install it with:  cargo install --locked trunk" >&2
  echo "Then re-run:      pnpm build:wasm" >&2
  exit 127
fi

if ! rustup target list --installed | grep -q wasm32-unknown-unknown; then
  echo "ERROR: the wasm32-unknown-unknown target is not installed." >&2
  echo "Install it with:  rustup target add wasm32-unknown-unknown" >&2
  exit 127
fi

out="apps/web/public/wasm"
( cd crates/fleet-cockpit-web && trunk build )

# Trunk emits its own index.html next to the artifacts. The Cockpit route is
# Astro's, so drop the stray page — it would otherwise ship at /wasm/.
rm -f "$out/index.html"

echo "Fleet Cockpit WASM staged in $out"
ls -la "$out"
