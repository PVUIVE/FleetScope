#!/usr/bin/env bash
# Typecheck every workspace package. Each package owns its own tsconfig; there is
# no project-reference graph to keep in sync.
set -euo pipefail
cd "$(dirname "$0")/.."

status=0
for dir in packages/*/ apps/api; do
  [ -f "$dir/tsconfig.json" ] || continue
  name=$(node -p "require('./$dir/package.json').name")
  printf '── typecheck %s\n' "$name"
  if ! npx tsc --noEmit -p "$dir/tsconfig.json"; then status=1; fi
done

printf '── typecheck @fleetscope/web (astro check)\n'
if ! pnpm --filter @fleetscope/web typecheck; then status=1; fi

exit $status
