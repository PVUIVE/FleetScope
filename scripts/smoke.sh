#!/usr/bin/env bash
# One command that exercises the whole toolchain.
#
# Every step reports PASS, FAIL, or SKIP with its reason. A missing system
# prerequisite SKIPs and names the install command; it never silently passes.
set -uo pipefail
cd "$(dirname "$0")/.."

pass=0; fail=0; skip=0
step() {
  local name="$1"; shift
  printf '\n══ %s\n' "$name"
  if "$@"; then printf '   PASS  %s\n' "$name"; pass=$((pass+1));
  else printf '   FAIL  %s\n' "$name"; fail=$((fail+1)); fi
}
skip_step() { printf '\n══ %s\n   SKIP  %s\n' "$1" "$2"; skip=$((skip+1)); }

step "workspace install"      pnpm install --frozen-lockfile
step "typescript typecheck"   pnpm run typecheck
step "unit + replay tests"    pnpm run test
step "astro static build"     pnpm run build:web
step "cargo fmt"              cargo fmt --all -- --check
step "cargo clippy"           cargo clippy --all-targets -- -D warnings
step "cargo test"             cargo test

if command -v trunk >/dev/null 2>&1; then
  step "wasm/trunk build" pnpm run build:wasm
else
  skip_step "wasm/trunk build" "trunk not installed — run: cargo install --locked trunk"
  if rustup target list --installed 2>/dev/null | grep -q wasm32-unknown-unknown; then
    step "wasm cargo build (fallback)" cargo build --target wasm32-unknown-unknown -p fleet-cockpit
  else
    skip_step "wasm cargo build (fallback)" "run: rustup target add wasm32-unknown-unknown"
  fi
fi

printf '\n─────────────────────────────\n'
printf 'PASS %d   FAIL %d   SKIP %d\n' "$pass" "$fail" "$skip"
[ "$fail" -eq 0 ]
