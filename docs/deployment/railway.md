# Railway deployment

## Scope

The initial Railway deployment is one public **static web** service in Recorded Mode. It serves the FleetScope demo without an API, database, Gemini key, or any live model call. This is the safe default described by `.env.example`.

The `railway/web.Dockerfile` build performs three stages:

1. Build the Rust Cockpit with pinned Trunk `0.21.14`, producing `/wasm/cockpit.js` and `/wasm/cockpit_bg.wasm`.
2. Build the Astro web application with `PUBLIC_LIVE_MODE=false` and no `PUBLIC_API_BASE_URL`.
3. Assert that no deferred enterprise route reached `dist/`, then serve `apps/web/dist` with Nginx on Railway's injected `$PORT`.

`railway.json` selects the Dockerfile, checks `GET /health`, and retries only failed deployments up to three times.

## Railway setup

1. Create a Railway project and a single service named `fleetscope-web`.
2. Do **not** enable Railway GitHub Autodeploy for this service: the GitHub Actions workflow uploads the repository only after all CI checks pass. If the service is already connected to GitHub, disable its automatic deploy trigger. The deploy source must remain the repository root; do not set a Root Directory because the Docker build needs `apps/`, `packages/`, `crates/`, and `vendor/` paths.
3. Railway reads `railway.json` from the repository root. If the dashboard does not detect it, set the service variable `RAILWAY_DOCKERFILE_PATH=railway/web.Dockerfile`.
4. Do **not** configure `PUBLIC_LIVE_MODE=true`, `PUBLIC_API_BASE_URL`, `LIVE_MODE=true`, `GEMINI_API_KEY`, or any Gemini credential for this initial public deployment.
5. Deploy, wait for the `/health` check, then generate a public domain.

No custom environment variables are required for this recorded-only service. Railway supplies `PORT`; the image provides `8080` only as a local default.

## GitHub Actions deployment

`.github/workflows/ci.yml` runs the full TypeScript, Rust/WASM, and fixture-determinism CI suite for pull requests and pushes to `main`. Its `Deploy to Railway` job runs only after all three CI jobs pass on `main` (or a manual dispatch from `main`).

Configure the GitHub `production` environment before enabling deployment:

1. Create a Railway **project token** scoped to the production environment for the FleetScope project.
2. Add it as the `RAILWAY_TOKEN` secret in the GitHub `production` environment, not as a repository-wide secret.
3. Optionally require reviewers on that environment to add a production approval gate.

The job deploys the documented `fleetscope-web` service with `railway up --ci`. The project token already selects the Railway project and production environment, so no project identifier is stored in the repository. The Dockerfile remains the source of truth for the static Recorded Mode build.

## Post-deploy validation

- `https://<domain>/health` returns `ok`.
- `/` serves the landing page, not a redirect.
- `/sessions/` and `/docs/` load.
- `/cases/`, `/catalog/`, `/approvals/`, `/cockpit/CASE-1042/` and `/audit/CASE-1042/` return **404**. These are the deferred enterprise surfaces: they are no longer built, and the image build fails if they reappear in `dist/`. See `apps/web/src/deferred/README.md`.
- Run the browser QA suite against the Railway domain:

  ```bash
  FLEETSCOPE_QA_BASE_URL=https://<domain> pnpm qa:browser
  ```

## Optional API service (later)

Only add an `fleetscope-api` service when a bounded live proof is explicitly required. Use the existing `apps/api/Dockerfile` with repository-root build context. Keep `LIVE_MODE=false` unless there is explicit approval to enable the live path; enabling it requires `GEMINI_MODEL`, a secret `GEMINI_API_KEY`, and a precise `WEB_ORIGINS=https://<web-domain>` allowlist.

The public web and optional API are intentionally separate: the normal product remains usable with the API unavailable.
