/**
 * Responsive and accessibility QA for the Agent Viewer, down to a phone.
 *
 * `browser-qa.ts` drives the static routes and stops at 1180px; `viewer-e2e.ts`
 * proves the golden path but needs a real Gemini run and also stops at 1180px.
 * Neither can answer the question this script exists for: does the Agent Viewer
 * — three panes, a WASM canvas and a timeline — actually work on a narrow
 * screen, and is the details drawer a real dialog when it becomes one?
 *
 * It seeds the RECORDED Google ADK session into a throwaway store and boots the
 * real collector against it, so the page under test is the product, not a mock.
 * No Gemini key, no spend, no network.
 *
 * Usage:
 *   pnpm qa:viewer
 *   FLEETSCOPE_QA_SHOTS=dir pnpm qa:viewer     # also write screenshots
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright';
import { SessionStore } from '@fleetscope/session-store';
import { loadRecordedSessionEvents, loadRecordedSessionMeta } from '@fleetscope/fixtures/node';
import { projectViewerEvents, summarizeSession } from '@fleetscope/viewer';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env['FLEETSCOPE_QA_PORT'] ?? 4319);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env['FLEETSCOPE_QA_SHOTS'] ?? null;
const RECORDED = 'vendor-onboarding';

/**
 * Every width the product is claimed to work at, phone included.
 *
 * 1180 and 720 are the two breakpoints themselves — a layout is most likely to
 * be wrong on the pixel where it changes, so both are driven directly.
 */
const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1180x800', width: 1180, height: 800 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
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

/**
 * Run one drawer step, recording a failure rather than aborting the suite.
 *
 * A broken drawer makes the steps after it throw — a covered timeline cannot be
 * clicked at all. Reporting only the first of those tells you far less than
 * reporting every one, so a step that throws is a FAIL and the run continues.
 */
async function step(name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    check(name, false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  }
}

function watchConsole(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return { errors };
}

/** Put the recorded session into a fresh store the collector will then serve. */
function seed(storage: string): string {
  const meta = loadRecordedSessionMeta(RECORDED);
  const events = loadRecordedSessionEvents(RECORDED);
  const summary = summarizeSession(
    meta.sessionId,
    meta.name,
    meta.framework,
    events,
    projectViewerEvents(events),
  );

  mkdirSync(join(storage, '.fleetscope'), { recursive: true });
  const store = SessionStore.open(join(storage, '.fleetscope', 'fleetscope.db'));
  store.upsertSession({
    id: meta.sessionId,
    caseId: meta.sessionId,
    name: meta.name,
    framework: meta.framework,
    frameworkVersion: meta.frameworkVersion,
    rootAgent: summary.rootAgent,
    status: summary.status,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    eventCount: events.length,
    createdAt: meta.recordedAt,
  });
  store.appendEvents(meta.sessionId, events);
  store.close();
  return meta.sessionId;
}

async function startCollector(storage: string): Promise<ChildProcess> {
  const child = spawn(
    'node',
    [join(repoRoot, 'apps/cli/bin/fleetscope.js'), 'watch', '--port', String(PORT)],
    { cwd: storage, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } },
  );
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return child;
    } catch {
      // Not listening yet.
    }
    await sleep(250);
  }
  throw new Error('the collector did not come up');
}

/** Nothing may scroll the page sideways at any width. */
async function noSidewaysScroll(page: Page): Promise<{ ok: boolean; detail: string }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return {
      ok: doc.scrollWidth <= doc.clientWidth + 1,
      detail: `scrollWidth ${doc.scrollWidth} vs client ${doc.clientWidth}`,
    };
  });
}

/**
 * Anything clipped out of the viewport on the right is a layout failure —
 * unless it sits inside a container that scrolls sideways on purpose, which is
 * the intended narrow-screen fallback for the agent strip and for a wide
 * command block. Content reachable by scrolling that container is not lost.
 */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    const limit = document.documentElement.clientWidth + 1;

    for (const node of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (node.offsetParent === null && node.tagName !== 'BODY') continue;
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right <= limit) continue;

      // Walk inline rather than in a helper: this body is serialised into the
      // page, where tsx's name-preserving wrapper for a nested function is not
      // defined.
      let scrollable = false;
      for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll') {
          scrollable = true;
          break;
        }
      }
      if (scrollable) continue;

      bad.push(
        `${node.tagName.toLowerCase()}.${node.className || '(no class)'} right=${Math.round(box.right)}`,
      );
    }
    return bad.slice(0, 6);
  });
}

async function viewerAt(
  page: Page,
  sessionId: string,
  size: (typeof VIEWPORTS)[number],
): Promise<void> {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(`${BASE}/sessions/${sessionId}`, { waitUntil: 'load' });
  await page.waitForSelector('.fs-event', { timeout: 15_000 });
  await sleep(1200);

  const scroll = await noSidewaysScroll(page);
  check(`${size.name} · the viewer does not scroll sideways`, scroll.ok, scroll.detail);

  const clipped = await overflowing(page);
  check(
    `${size.name} · nothing is clipped past the right edge`,
    clipped.length === 0,
    clipped.join(' | '),
  );

  // The timeline is the fallback when the graph cannot be read: it must never
  // be the thing that disappears.
  const timeline = await page.locator('.fs-timeline').boundingBox();
  check(
    `${size.name} · the timeline has usable height`,
    timeline !== null && timeline.height >= 120,
    `height ${timeline?.height ?? 0}`,
  );

  // A graph too short to carry its own node labels has stopped being a graph;
  // the renderer drops them well before this floor.
  const graph = await page.locator('.fs-graph').boundingBox();
  check(
    `${size.name} · the graph has usable height`,
    graph !== null && graph.height >= 200,
    `height ${Math.round(graph?.height ?? 0)}`,
  );

  // Kind and duration are what a developer scans a run for. Dropping them to
  // save width is dropping the information the screen exists to show.
  const firstRow = page.locator('.fs-event').first();
  const kind = await firstRow.locator('.fs-event__category').isVisible();
  const duration = await firstRow.locator('.fs-event__duration').count();
  check(`${size.name} · timeline rows keep their kind word`, kind);
  check(`${size.name} · timeline rows keep a duration slot`, duration === 1);

  if (SHOTS !== null) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `viewer-${size.name}.png`), fullPage: false });
  }
}

/** Below 1180px the details pane becomes an overlay, so it must be a dialog. */
async function detailsDrawer(page: Page, sessionId: string): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/sessions/${sessionId}`, { waitUntil: 'load' });
  await page.waitForSelector('.fs-event', { timeout: 15_000 });
  await sleep(1000);

  const pane = page.locator('[data-details-pane]');
  check(
    'the drawer does not cover the graph before anything is selected',
    !(await pane.isVisible()),
  );

  await step('a timeline row can be clicked at all', async () => {
    await page.locator('.fs-event').nth(3).click({ timeout: 5000 });
    await sleep(400);
    check('a timeline row can be clicked at all', true);
  });

  await step('selecting an event opens the drawer', async () => {
    check('selecting an event opens the drawer', await pane.isVisible());
    check('the drawer is a modal dialog', (await pane.getAttribute('aria-modal')) === 'true');
    check('the drawer names itself', (await pane.getAttribute('aria-labelledby')) !== null);

    const focusInside = await page.evaluate(() => {
      const node = document.querySelector('[data-details-pane]');
      return node !== null && node.contains(document.activeElement);
    });
    check('focus moves into the drawer', focusInside);
  });

  await step('Escape closes the drawer', async () => {
    await page.keyboard.press('Escape');
    await sleep(400);
    check('Escape closes the drawer', !(await pane.isVisible()));
    const restored = await page.evaluate(
      () => document.activeElement?.classList.contains('fs-event') === true,
    );
    check('focus returns to the row that opened it', restored);
  });

  // The bug this guards: stepping the timeline used to re-open a drawer the
  // developer had just closed, on every single keypress.
  await step('stepping the timeline does not re-open a closed drawer', async () => {
    await page.keyboard.press('ArrowDown');
    await sleep(300);
    check('stepping the timeline does not re-open a closed drawer', !(await pane.isVisible()));
  });

  await step('a closed drawer can be reopened from the bar', async () => {
    const reopen = page.locator('[data-open-details]');
    check('a closed drawer can be reopened from the bar', await reopen.isVisible());
    await reopen.click({ timeout: 5000 });
    await sleep(400);
    check('the reopen control opens the drawer', await pane.isVisible());
  });

  if (SHOTS !== null) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'viewer-390x844-drawer.png') });
  }
}

/**
 * Above the breakpoint the panel is a column, not a dialog — and closing it has
 * to hand its width to the graph. It used to leave a 330px hole instead.
 */
async function detailsColumn(page: Page, sessionId: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/sessions/${sessionId}`, { waitUntil: 'load' });
  await page.waitForSelector('.fs-event', { timeout: 15_000 });
  await sleep(1200);

  const pane = page.locator('[data-details-pane]');
  check('1440x900 · the details column is present', await pane.isVisible());
  check(
    '1440x900 · the column is not announced as a dialog',
    (await pane.getAttribute('aria-modal')) === null,
  );

  const before = await page.locator('.fs-graph').boundingBox();
  await page.locator('[data-close-details]').click();
  await sleep(300);
  const after = await page.locator('.fs-graph').boundingBox();

  check('1440x900 · closing hides the column', !(await pane.isVisible()));
  check(
    '1440x900 · closing gives the width to the graph rather than leaving a hole',
    before !== null && after !== null && after.width > before.width + 200,
    `${Math.round(before?.width ?? 0)} → ${Math.round(after?.width ?? 0)}`,
  );

  const reopen = page.locator('[data-open-details]');
  check('1440x900 · the column can be brought back', await reopen.isVisible());
  await reopen.click();
  await sleep(300);
  check('1440x900 · reopening restores the column', await pane.isVisible());
}

/**
 * The console must use the screen it was given.
 *
 * On a 2000px display the session list was capped at 1120px and drew a single
 * run in an otherwise empty page — 44% of the viewport unused horizontally and
 * most of it unused vertically. Neither reads as "nothing to show"; both read
 * as a page that failed to finish loading. These are the two measurements that
 * distinguish the two.
 */
async function widescreen(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1920, height: 1080 });

  for (const route of ['/sessions/', '/docs/'] as const) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'load' });
    await sleep(700);

    const used = await page.evaluate(() => {
      const main = document.querySelector('.fs-main');
      const content = document.querySelector('.fs-table, .fs-setup');
      if (main === null || content === null) return null;
      const mainBox = main.getBoundingClientRect();
      const box = content.getBoundingClientRect();
      return {
        widthShare: box.width / mainBox.width,
        heightShare: box.height / window.innerHeight,
      };
    });

    check(
      `1920x1080 · ${route} fills the width it was given`,
      used !== null && used.widthShare > 0.9,
      `${Math.round((used?.widthShare ?? 0) * 100)}% of the main column`,
    );
    check(
      `1920x1080 · ${route} does not leave the page mostly empty`,
      used !== null && used.heightShare > 0.5,
      `${Math.round((used?.heightShare ?? 0) * 100)}% of the viewport height`,
    );
  }
}

/** The session list and Setup at a phone width. */
async function staticRoutes(page: Page): Promise<void> {
  for (const route of ['/sessions/', '/docs/']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}${route}`, { waitUntil: 'load' });
    await sleep(500);
    const scroll = await noSidewaysScroll(page);
    check(`390x844 · ${route} does not scroll sideways`, scroll.ok, scroll.detail);
    if (SHOTS !== null) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({
        path: join(SHOTS, `${route.replaceAll('/', '_')}390x844.png`),
        fullPage: true,
      });
    }
  }

  // Skip-to-content is only real if the first Tab actually reaches it.
  await page.goto(`${BASE}/sessions/`, { waitUntil: 'load' });
  await page.keyboard.press('Tab');
  const skip = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active === null) return { ok: false, detail: 'nothing focused' };
    const box = active.getBoundingClientRect();
    return {
      ok: active.classList.contains('fs-skip'),
      detail: `${active.className} at ${Math.round(box.top)}px`,
    };
  });
  check('the first Tab stop is skip-to-content, and it is visible', skip.ok, skip.detail);
}

async function main(): Promise<void> {
  const storage = mkdtempSync(join(tmpdir(), 'fleetscope-qa-'));
  const sessionId = seed(storage);

  let collector: ChildProcess | null = null;
  let browser: Browser | null = null;
  try {
    collector = await startCollector(storage);
    browser = await chromium.launch();
    const page = await browser.newPage();
    const console_ = watchConsole(page);

    for (const size of VIEWPORTS) await viewerAt(page, sessionId, size);
    await detailsDrawer(page, sessionId);
    await detailsColumn(page, sessionId);
    await widescreen(page);
    await staticRoutes(page);

    check('no console errors anywhere', console_.errors.length === 0, console_.errors.join(' | '));
  } finally {
    await browser?.close();
    collector?.kill('SIGTERM');
    rmSync(storage, { recursive: true, force: true });
  }

  let failed = 0;
  for (const result of checks) {
    if (!result.ok) failed += 1;
    const detail = result.detail === '' ? '' : `  — ${result.detail}`;
    process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${detail}\n`);
  }
  process.stdout.write(`\n${checks.length - failed}/${checks.length} passed\n`);
  if (failed > 0) process.exitCode = 1;
}

await main();
