/**
 * End-to-end proof of the golden path, in a real browser, against a real agent.
 *
 * Unit tests prove the projections compute the right thing. They cannot prove
 * that the WASM renderer instantiated, that a session appeared without a
 * reload, that clicking a failure showed the right details, or that seeking
 * backwards executed nothing. Every one of those is the product. This drives
 * the whole stack:
 *
 *     fleetscope watch  →  real Google ADK + Gemini run  →  Chromium
 *
 * It costs a few Gemini Flash calls per run, which is the point: a demo proved
 * against synthetic events is not proved.
 *
 * Usage:
 *   pnpm e2e                 # one run
 *   FLEETSCOPE_E2E_RUNS=3 pnpm e2e
 *   FLEETSCOPE_E2E_PORT=4321 pnpm e2e
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env['FLEETSCOPE_E2E_PORT'] ?? 4318);
const RUNS = Number(process.env['FLEETSCOPE_E2E_RUNS'] ?? 1);
const BASE = `http://127.0.0.1:${PORT}`;

/** The sizes the product commits to, plus the narrow desktop it must survive. */
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1180x800', width: 1180, height: 800 },
];

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail: unknown = ''): void => {
  checks.push({ name, ok, detail: String(detail) });
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Console errors are failures. A demo with a red console is not finished. */
function watchConsole(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return { errors };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(250);
  }
  process.stderr.write(`timed out waiting for ${label}\n`);
  return false;
}

async function startCollector(storage: string): Promise<ChildProcess> {
  const child = spawn(
    'node',
    [join(repoRoot, 'apps/cli/bin/fleetscope.js'), 'watch', '--port', String(PORT)],
    { cwd: storage, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } },
  );
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[collector] ${chunk}`));

  const up = await waitFor(
    async () => {
      try {
        const response = await fetch(`${BASE}/api/health`);
        return response.ok;
      } catch {
        return false;
      }
    },
    15_000,
    'the collector to answer /api/health',
  );
  if (!up) throw new Error('the collector never came up');
  return child;
}

function runAgent(): ChildProcess {
  return spawn('python3', [join(repoRoot, 'examples/vendor_agent.py')], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FLEETSCOPE_ENDPOINT: BASE },
  });
}

async function main(): Promise<number> {
  if (process.env['GOOGLE_API_KEY'] === undefined && process.env['GEMINI_API_KEY'] === undefined) {
    process.stderr.write(
      'GOOGLE_API_KEY (or GEMINI_API_KEY) must be set: this suite runs a REAL agent.\n',
    );
    return 2;
  }

  const storage = mkdtempSync(join(tmpdir(), 'fleetscope-e2e-'));
  let collector: ChildProcess | null = null;
  let browser: Browser | null = null;
  let agent: ChildProcess | null = null;

  try {
    collector = await startCollector(storage);
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: VIEWPORTS[0]! });
    const page = await context.newPage();
    const console = watchConsole(page);

    // ── 1-3. The viewer loads, and the empty state is what a new user sees ──
    await page.goto(`${BASE}/sessions/`, { waitUntil: 'networkidle' });
    check(
      'empty state is visible before any agent runs',
      await page.locator('[data-empty]').isVisible(),
    );
    check(
      'the empty state shows the command that starts a session',
      (await page.locator('[data-empty]').textContent())?.includes('fleetscope watch') === true,
    );

    // ── 4-5. A real ADK run appears WITHOUT a reload ────────────────────────
    agent = runAgent();
    let agentOutput = '';
    agent.stdout?.on('data', (chunk: Buffer) => (agentOutput += chunk.toString()));
    agent.stderr?.on('data', (chunk: Buffer) => (agentOutput += chunk.toString()));

    const appeared = await waitFor(
      async () => (await page.locator('.fs-session').count()) > 0,
      60_000,
      'a session row to appear over SSE',
    );
    check('a live session appears with no reload', appeared);
    if (!appeared) return report();

    const sessionId = await page.locator('.fs-session').first().getAttribute('data-session-id');
    check('the session row carries an id', sessionId !== null, sessionId);

    // ── 6-7. Open it. It is LIVE. ──────────────────────────────────────────
    await page.locator('.fs-session__link').first().click();
    await page.waitForURL(/\/sessions\/ses_/);
    check('the viewer opens on a clean per-session URL', page.url().includes(sessionId ?? '!'));

    await waitFor(
      async () => (await page.locator('[data-timeline-rows] .fs-event').count()) > 0,
      30_000,
      'the timeline to fill',
    );
    check(
      'the session reports LIVE while it runs',
      (await page.locator('[data-transport-label]').textContent()) === 'LIVE',
    );

    // ── 8-12. Agents, model, tool, handoff, failure ────────────────────────
    check(
      'the root agent is in the tree',
      (await page.locator('[data-agent-id="vendor_onboarding"]').count()) === 1,
    );

    const sawModel = await waitFor(
      async () => (await page.locator('.fs-event[data-category="model"]').count()) > 0,
      60_000,
      'a model event',
    );
    check('model calls appear', sawModel);

    const sawTool = await waitFor(
      async () => (await page.locator('.fs-event[data-category="tool"]').count()) > 0,
      60_000,
      'a tool event',
    );
    check('tool calls appear', sawTool);

    const sawHandoff = await waitFor(
      async () => (await page.locator('[data-agent-id="logistics"]').count()) === 1,
      90_000,
      'the sub-agent to appear after the handoff',
    );
    check('the sub-agent appears after the handoff', sawHandoff);
    if (!sawHandoff) {
      // The run did not take the golden path. Report the agent's own output —
      // guessing from a locator timeout would waste the next hour.
      process.stderr.write(`agent output:\n${agentOutput}\n`);
      return report();
    }
    check(
      'the handoff is a timeline row of its own',
      (await page.locator('.fs-event[data-category="handoff"]').count()) > 0,
    );

    const sawFailure = await waitFor(
      async () => (await page.locator('[data-jump-failure]').isVisible()) === true,
      90_000,
      'the failure to be detected',
    );
    check('the failure is surfaced in the header', sawFailure);
    if (!sawFailure) {
      process.stderr.write(`agent output:\n${agentOutput}\n`);
      return report();
    }

    // ── 13-14. Click the failure; the details are the right ones ───────────
    await page.locator('[data-jump-failure]').click();
    await sleep(400);
    const detailText = (await page.locator('[data-details]').textContent()) ?? '';
    check(
      'the failure details name the tool',
      detailText.includes('inventory_lookup'),
      detailText.slice(0, 90),
    );
    check('the failure details name the error class', detailText.includes('timeout'));
    check('the failure details name the agent that ran it', detailText.includes('logistics'));
    check(
      'a duration is reported as a real value, never as a bare 0',
      /Duration/.test(detailText) && !/Duration\s*0\s*ms/.test(detailText),
    );

    // ── 15-16. Select the sub-agent; its branch is focused ─────────────────
    await page.locator('[data-agent-id="logistics"]').click();
    await sleep(300);
    const dimmed = await page.locator('.fs-event[data-dimmed="true"]').count();
    check('selecting an agent focuses its branch in the timeline', dimmed > 0, `${dimmed} dimmed`);
    await page.locator('[data-agent-id="logistics"]').click();

    // ── 17-19. Seek backwards. Historical, and side-effect free. ───────────
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.locator('.fs-event').first().click();
    await sleep(500);

    check(
      'seeking backwards enters HISTORICAL',
      (await page.locator('[data-transport-label]').textContent()) === 'HISTORICAL',
    );
    check(
      'the historical banner says nothing is executing',
      ((await page.locator('[data-historical-banner]').textContent()) ?? '').includes(
        'Nothing is executing',
      ),
    );
    check(
      'historical inspection issues no ingest and no mutation',
      requests.every((url) => !url.includes('/api/ingest')),
      requests.filter((url) => url.includes('/api/')).join(' '),
    );

    // ── 20. Return to live ─────────────────────────────────────────────────
    await page.locator('[data-return-live]').click();
    await sleep(400);
    check(
      'Return to live leaves historical mode',
      (await page.locator('[data-transport-label]').textContent()) !== 'HISTORICAL',
    );

    // ── 21. The session completes ──────────────────────────────────────────
    // `exitCode` first: a process that has ALREADY exited will never emit
    // 'exit' again, and waiting for it would hang here forever.
    const exitCode = await new Promise<number>((resolve) => {
      if (agent === null) return resolve(0);
      if (agent.exitCode !== null) return resolve(agent.exitCode);
      agent.on('exit', (code) => resolve(code ?? 0));
    });
    check('the real ADK agent exits cleanly', exitCode === 0, `exit ${exitCode}`);

    const completed = await waitFor(
      async () => (await page.locator('[data-transport-label]').textContent()) === 'Completed',
      30_000,
      'the session to report Completed',
    );
    check('the finished session reports Completed', completed);

    // ── 22-23. Reopen from the list; the history is still there ────────────
    await page.goto(`${BASE}/sessions/`, { waitUntil: 'networkidle' });
    check('the finished session is in the list', (await page.locator('.fs-session').count()) >= 1);
    await page.locator('.fs-session__link').first().click();
    await page.waitForURL(/\/sessions\/ses_/);
    const reopened = await waitFor(
      async () => (await page.locator('.fs-event').count()) > 10,
      20_000,
      'the stored session to re-render',
    );
    check('a reopened session still has its whole timeline', reopened);
    check(
      'the graph renderer instantiated',
      await waitFor(
        async () => (await page.locator('#fleetscope-cockpit-canvas canvas').count()) > 0,
        20_000,
        'the WebGL canvas to mount',
      ),
    );

    // ── Layout, at every committed size ────────────────────────────────────
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await sleep(350);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      check(`no horizontal overflow at ${viewport.name}`, !overflow);
    }

    check('no console errors', console.errors.length === 0, console.errors.slice(0, 3).join(' | '));

    return report();
  } finally {
    // Everything this script started, this script stops.
    agent?.kill('SIGTERM');
    await browser?.close();
    collector?.kill('SIGTERM');
    await sleep(500);
    rmSync(storage, { recursive: true, force: true });
  }
}

function report(): number {
  let failed = 0;
  for (const item of checks) {
    if (!item.ok) failed += 1;
    process.stdout.write(
      `${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail === '' ? '' : `  — ${item.detail}`}\n`,
    );
  }
  process.stdout.write(`\n${checks.length - failed}/${checks.length} checks passed\n`);
  return failed === 0 ? 0 : 1;
}

let status = 0;
for (let run = 1; run <= RUNS; run += 1) {
  if (RUNS > 1) process.stdout.write(`\n═══ run ${run} of ${RUNS} ═══\n`);
  checks.length = 0;
  status = Math.max(status, await main());
}
process.exit(status);
