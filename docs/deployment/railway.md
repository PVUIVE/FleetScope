# Railway deployment

## Scope

The initial Railway deployment is one public **static web** service in Recorded Mode. It serves the FleetScope demo without an API, database, Gemini key, or any live model call. This is the safe default described by `.env.example`.

The `railway/web.Dockerfile` build performs three stages:

1. Build the Rust Cockpit with pinned Trunk `0.21.14`, producing `/wasm/cockpit.js` and `/wasm/cockpit_bg.wasm`.
2. Build the Astro web application with `PUBLIC_LIVE_MODE=false` and no `PUBLIC_API_BASE_URL`.
3. Serve `apps/web/dist` with Nginx on Railway's injected `$PORT`.

`railway.json` selects the Dockerfile, checks `GET /health`, and retries only failed deployments up to three times.

## Railway setup

1. Create a Railway project and a single service named `fleetscope-web`.
2. Connect the FleetScope GitHub repository. Keep the service **Root Directory empty**: this is a shared pnpm workspace and the Docker build needs repository-root `apps/`, `packages/`, `crates/`, and `vendor/` paths.
3. Railway reads `railway.json` from the repository root. If the dashboard does not detect it, set the service variable `RAILWAY_DOCKERFILE_PATH=railway/web.Dockerfile`.
4. Do **not** configure `PUBLIC_LIVE_MODE=true`, `PUBLIC_API_BASE_URL`, `LIVE_MODE=true`, `GEMINI_API_KEY`, or any Gemini credential for this initial public deployment.
5. Deploy, wait for the `/health` check, then generate a public domain.

No custom environment variables are required for this recorded-only service. Railway supplies `PORT`; the image provides `8080` only as a local default.

## Post-deploy validation

- `https://<domain>/health` returns `ok`.
- `/catalog/`, `/cases/`, `/cases/CASE-1042/`, `/approvals/`, `/cockpit/CASE-1042/`, and `/audit/CASE-1042/` load.
- Browser Network confirms `/wasm/cockpit.js` and `/wasm/cockpit_bg.wasm` return 200.
- Cockpit renders without a console error and evidence selection/Return to live work.
- Run the browser E2E suite against the Railway domain:

  ```bash
  FLEETSCOPE_QA_BASE_URL=https://<domain> pnpm qa:browser
  ```

## Optional API service (later)

Only add an `fleetscope-api` service when a bounded live proof is explicitly required. Use the existing `apps/api/Dockerfile` with repository-root build context. Keep `LIVE_MODE=false` unless there is explicit approval to enable the live path; enabling it requires `GEMINI_MODEL`, a secret `GEMINI_API_KEY`, and a precise `WEB_ORIGINS=https://<web-domain>` allowlist.

The public web and optional API are intentionally separate: the normal product remains usable with the API unavailable.
