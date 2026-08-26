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

# ── FleetScope TypeScript ───────────────────────────────────────────────────
step "workspace install"        pnpm install --frozen-lockfile
step "prettier"                 pnpm run format:check
step "eslint"                   pnpm run lint
step "typescript typecheck"     pnpm run typecheck
step "unit + replay tests"      pnpm run test
step "astro static build"       pnpm run build:web

# ── FleetScope Rust (host-testable core, incl. the real Zoetrope integration) ─
step "cargo fmt"                cargo fmt --all -- --check
step "cargo clippy"             cargo clippy --all-targets -- -D warnings
step "cargo test"               cargo test

# ── The vendored renderer, on its own terms ─────────────────────────────────
# Upstream's suite must keep passing after every vendor patch, in BOTH feature
# configurations: `default` is what upstream consumers get, and
# `--no-default-features` is the portable core FleetScope actually depends on.
step "vendor: cargo test"       cargo test --manifest-path vendor/zoetrope/Cargo.toml
step "vendor: portable core"    cargo check --manifest-path vendor/zoetrope/Cargo.toml --no-default-features
step "vendor: cargo fmt"        cargo fmt --manifest-path vendor/zoetrope/Cargo.toml --all -- --check
step "vendor: cargo clippy"     cargo clippy --manifest-path vendor/zoetrope/Cargo.toml --all-targets -- -D warnings

# ── The wasm-only browser crate (its own workspace) ─────────────────────────
step "cockpit-web: cargo check" cargo check --manifest-path crates/fleet-cockpit-web/Cargo.toml --target wasm32-unknown-unknown
step "cockpit-web: cargo fmt"   cargo fmt --manifest-path crates/fleet-cockpit-web/Cargo.toml -- --check

# ── The recorded demo, end to end ───────────────────────────────────────────
step "recorded Case, one run"   pnpm run recorded:run

if command -v trunk >/dev/null 2>&1; then
  step "wasm/trunk build" pnpm run build:wasm
else
  skip_step "wasm/trunk build" "trunk not installed — run: cargo install --locked trunk"
  if rustup target list --installed 2>/dev/null | grep -q wasm32-unknown-unknown; then
    skip_step "wasm bundle" "trunk is required to emit the bundle; the crate still type-checks above"
  else
    skip_step "wasm cargo check" "run: rustup target add wasm32-unknown-unknown"
  fi
fi

printf '\n─────────────────────────────\n'
printf 'PASS %d   FAIL %d   SKIP %d\n' "$pass" "$fail" "$skip"
[ "$fail" -eq 0 ]
