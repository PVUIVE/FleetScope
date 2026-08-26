#!/usr/bin/env bash
# Three consecutive bounded live proof runs (docs/plans/demo-validation.md).
#
# Each run restarts the API, because the per-Case call budget is in-memory by
# design and two calls is the ceiling. Every run captures what the plan asks
# for: model, request id, token usage, duration, result, the canonical event ids
# the result became, and the spend.
#
# `set -a; . ./.env` makes the file win over any ambient export for the API
# process only — a stale GEMINI_API_KEY in a shell profile otherwise shadows it,
# because Node's --env-file does not override an already-set variable.
set -uo pipefail
cd "$(dirname "$0")/.."

RUNS="${1:-3}"
STEP="${2:-orchestrator-compliance-decision}"
CASE_ID=CASE-1042
AFTER=2026-09-08T10:28:00.000Z

# Published Gemini 2.5 Flash rates, USD per 1M tokens. Override if they change.
IN_RATE="${IN_RATE:-0.30}"
OUT_RATE="${OUT_RATE:-2.50}"

pass=0
printf 'FleetScope bounded live proof — %s consecutive runs of %s\n\n' "$RUNS" "$STEP"

for run in $(seq 1 "$RUNS"); do
  pkill -f 'src/server.ts' >/dev/null 2>&1
  sleep 1
  ( set -a; . ./.env; set +a; pnpm dev:api > /tmp/fs-api-run.log 2>&1 & )
  for _ in $(seq 1 20); do
    curl -sf localhost:8080/health >/dev/null 2>&1 && break
    sleep 1
  done

  out="/tmp/fs-live-run${run}.json"
  curl -sX POST localhost:8080/live/decision -H 'content-type: application/json' \
    -d "{\"caseId\":\"${CASE_ID}\",\"stepId\":\"${STEP}\",\"sessionId\":\"sess-003\",\"afterSourceTime\":\"${AFTER}\"}" \
    > "$out"

  verify=$(npx tsx scripts/verify-live-append.ts "$out" 2>/dev/null)
  vpass=$(printf '%s' "$verify" | python3 -c 'import json,sys;print(json.load(sys.stdin)["pass"])' 2>/dev/null || echo False)

  RUN="$run" VPASS="$vpass" IN_RATE="$IN_RATE" OUT_RATE="$OUT_RATE" \
  python3 - "$out" <<'PY'
import json, os, sys
d = json.load(open(sys.argv[1]))
run, vpass = os.environ['RUN'], os.environ['VPASS'] == 'True'
live = d.get('mode') == 'live'
u = d.get('usage') or {}
i, o = u.get('inputTokens') or 0, u.get('outputTokens') or 0
cost = i * float(os.environ['IN_RATE'])/1e6 + o * float(os.environ['OUT_RATE'])/1e6
ok = live and vpass
succ = next((e for e in d['sourceEvents'] if e['type'] == 'tool.succeeded'), None)
print(f"run {run} {'PASS' if ok else 'FAIL'}  mode={d.get('mode')} "
      f"model={(d.get('modelReference') or {}).get('model','—')} "
      f"requestId={(d.get('modelReference') or {}).get('responseRef','—')} "
      f"in={i} out={o} {round(d.get('durationMs') or 0)}ms "
      f"canonicalized={'yes' if vpass else 'NO'} ~${cost:.5f}")
if succ:
    print(f"        result: {succ['payload']['classification']} "
          f"(confidence {succ['payload']['confidence']})")
if d.get('failure'):
    print(f"        failure: {json.dumps(d['failure'])}")
open('/tmp/fs-live-costs','a').write(f"{cost}\n")
sys.exit(0 if ok else 1)
PY
  [ $? -eq 0 ] && pass=$((pass+1))
done

pkill -f 'src/server.ts' >/dev/null 2>&1
total=$(python3 -c "print('%.5f' % sum(float(l) for l in open('/tmp/fs-live-costs')))" 2>/dev/null || echo '0')
printf '\n─────────────────────────────────────────────\n'
printf '%s/%s runs passed   ·   spend this session ~USD %s\n' "$pass" "$RUNS" "$total"
[ "$pass" -eq "$RUNS" ]
