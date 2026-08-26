#!/usr/bin/env bash
# Build the Fleet Cockpit WASM bundle and stage it for the Astro static build.
#
# `trunk` is an explicit prerequisite and is NOT auto-installed: silently
# installing a toolchain during a build is how a "works on my machine" demo
# happens. If it is missing this fails loudly with the exact install command.
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
trunk build crates/fleet-cockpit/index.html --dist "$out"
echo "Fleet Cockpit WASM staged in $out"
