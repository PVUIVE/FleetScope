/**
 * Zero-cost Agent Viewer proof.
 *
 * Unlike scripts/viewer-e2e.ts this never starts Gemini or Google ADK. It posts
 * a deterministic captured ADK wire stream into the SAME local runtime the CLI
 * starts, then drives Chromium through the session-list and viewer SSE flow.
 *
 *   pnpm e2e:offline
 */
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright';
import { startRuntime, type Runtime } from '../apps/cli/src/runtime.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const viewerRoot = join(repoRoot, 'apps/web/dist');
const capturePath = join(
  repoRoot,
  'packages/fixtures/sessions/offline-adk-capture/wire-batches.json',
);
const capture = JSON.parse(readFileSync(capturePath, 'utf8')) as { batches: unknown[] };
const secret = 'offline-capture-secret-token-1234567890';

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

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(100);
  }
  process.stderr.write(`timed out waiting for ${label}\n`);
  return false;
}

async function freePort(): Promise<number> {
  const server = createServer();
  return await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('could not determine an ephemeral port'));
        return;
      }
      server.close((error) => (error === undefined ? resolve(address.port) : reject(error)));
    });
  });
}

function watchConsole(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return { errors };
}

async function ingest(base: string, batch: unknown): Promise<Response> {
  return fetch(`${base}/api/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(batch),
  });
}

async function start(port: number, storage: string): Promise<Runtime> {
  return startRuntime({ local: { port, storage }, viewerRoot });
}

async function main(): Promise<number> {
  if (!existsSync(viewerRoot)) {
    throw new Error(
      'apps/web/dist is missing. Run pnpm e2e:offline so the static viewer is built first.',
    );
  }
  if (capture.batches.length !== 2) throw new Error('offline ADK capture must contain two batches');

  const storageDir = mkdtempSync(join(tmpdir(), 'fleetscope-offline-e2e-'));
  const storage = join(storageDir, 'fleetscope.db');
  const port = await freePort();
  let runtime: Runtime | null = null;
  let browser: Browser | null = null;

  try {
    runtime = await start(port, storage);
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const console = watchConsole(page);
    const base = runtime.url;

    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });

    await page.goto(`${base}/sessions/`, { waitUntil: 'domcontentloaded' });
    const navigationsBeforeIngest = navigations;
    check(
      'empty local session state is visible before the capture',
      await page.locator('[data-empty]').isVisible(),
    );

    const first = await ingest(base, capture.batches[0]);
    check('first captured ADK batch is accepted', first.status === 201, first.status);
    const appeared = await waitFor(
      async () =>
        (await page.locator('.fs-session[data-session-id="ses_offline_adk_capture"]').count()) ===
        1,
      10_000,
      'the session list SSE append',
    );
    check(
      'session appears through SSE without a browser reload',
      appeared && navigations === navigationsBeforeIngest,
      `${navigationsBeforeIngest} → ${navigations}`,
    );

    await Promise.all([
      page.waitForURL(/\/sessions\/ses_offline_adk_capture/),
      page.locator('.fs-session__link').click(),
    ]);
    const timelineReady = await waitFor(
      async () => (await page.locator('[data-timeline-rows] .fs-event').count()) > 0,
      10_000,
      'the initial viewer timeline',
    );
    check('viewer receives the running captured prefix', timelineReady);
    check(
      'captured prefix is live before session.end',
      (await page.locator('[data-transport-label]').textContent()) === 'LIVE',
    );

    const requestsDuringInspection: { method: string; url: string }[] = [];
    page.on('request', (request) => {
      requestsDuringInspection.push({ method: request.method(), url: request.url() });
    });
    await page.locator('.fs-event').first().click();
    await page.waitForTimeout(150);
    const selectedBeforeAppend = await page
      .locator('.fs-event[aria-current="true"]')
      .getAttribute('data-sequence');
    check(
      'timeline seek enters historical mode',
      (await page.locator('[data-transport-label]').textContent()) === 'HISTORICAL',
    );
    check(
      'historical seek makes no ingest, model, tool, or control request',
      requestsDuringInspection.every(
        (request) =>
          !request.url.includes('/api/ingest') &&
          !/gemini|generativelanguage|tool|control/i.test(request.url),
      ),
      requestsDuringInspection.map((request) => `${request.method} ${request.url}`).join(' | '),
    );

    const second = await ingest(base, capture.batches[1]);
    check('second captured ADK batch is accepted', second.status === 200, second.status);
    const completed = await waitFor(
      async () => (await page.locator('[data-jump-failure]').isVisible()) === true,
      10_000,
      'the captured tool failure to reach the viewer',
    );
    const selectedAfterAppend = await page
      .locator('.fs-event[aria-current="true"]')
      .getAttribute('data-sequence');
    check(
      'live append does not move the parked historical cursor',
      selectedAfterAppend === selectedBeforeAppend,
      `${selectedBeforeAppend} → ${selectedAfterAppend}`,
    );
    check(
      'historical view reports unread live evidence',
      ((await page.locator('[data-unread]').textContent()) ?? '').includes('new events'),
    );

    const root = page.locator('[data-agent-id="orchestrator"]');
    const child = page.locator('[data-agent-id="inventory"]');
    check(
      'root and delegated child both appear in the agent topology',
      (await root.count()) === 1 && (await child.count()) === 1,
    );
    check(
      'delegated child remains visibly nested below its parent',
      Number.parseInt(
        (await child.evaluate((node) => node.style.paddingLeft)).replace('px', ''),
        10,
      ) >
        Number.parseInt(
          (await root.evaluate((node) => node.style.paddingLeft)).replace('px', ''),
          10,
        ),
    );

    check('captured failure is exposed as an actionable jump', completed);
    await page.locator('[data-jump-failure]').click();
    const failureDetails = (await page.locator('[data-details]').textContent()) ?? '';
    check(
      'failure details name the tool and error class',
      failureDetails.includes('inventory_lookup') && failureDetails.includes('timeout'),
      failureDetails,
    );

    await page.locator('.fs-event[data-category="model"]').first().click();
    const missingDetails = (await page.locator('[data-details]').textContent()) ?? '';
    check(
      'unobserved captured values remain Unknown rather than fabricated',
      missingDetails.includes('Unknown'),
      missingDetails,
    );

    const stored = await (await fetch(`${base}/api/sessions/ses_offline_adk_capture`)).json();
    const storedText = JSON.stringify(stored);
    check(
      'redaction happens before stored data reaches the browser API',
      !storedText.includes(secret) && storedText.includes('«redacted»'),
    );

    await page.locator('[data-return-live]').click();
    check(
      'Return to live reaches the failed terminal live edge',
      (await page.locator('[data-transport-label]').textContent()) === 'Failed',
    );

    // The page owns two EventSource connections. Close them before stopping the
    // collector: Node's server.close correctly waits for open loopback streams,
    // so stopping first would deadlock this persistence/reopen proof.
    await page.goto('about:blank');
    await runtime.stop();
    runtime = await start(port, storage);
    await page.goto(`${runtime.url}/sessions/ses_offline_adk_capture`, {
      waitUntil: 'domcontentloaded',
    });
    const reopened = await waitFor(
      async () => (await page.locator('.fs-event').count()) >= 12,
      10_000,
      'the persisted timeline after collector reopen',
    );
    check('SQLite persistence survives collector close and reopen', reopened);
    check(
      'reopened session remains failed',
      (await page.locator('[data-transport-label]').textContent()) === 'Failed',
    );
    check(
      'browser interaction produces no console errors',
      console.errors.length === 0,
      console.errors.join(' | '),
    );

    await context.close();
  } finally {
    await browser?.close();
    if (runtime !== null) await runtime.stop();
    rmSync(storageDir, { recursive: true, force: true });
  }

  const failures = checks.filter((entry) => !entry.ok);
  for (const entry of checks) {
    process.stdout.write(
      `${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail === '' ? '' : ` — ${entry.detail}`}\n`,
    );
  }
  process.stdout.write(
    `\n${checks.length - failures.length}/${checks.length} offline checks passed\n`,
  );
  return failures.length === 0 ? 0 : 1;
}

process.exitCode = await main();
