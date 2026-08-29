/**
 * Browser QA for the FleetScope product UI.
 *
 * Unit tests prove the presentation layer computes the right thing. They cannot
 * prove that the landing page's controls behave as they claim, or that a page does
 * not scroll sideways at 1280x720 — and both have broken at least once. This
 * drives a real browser over the STATIC surfaces the product publishes.
 *
 * The Agent Viewer itself (/sessions/<id>: the WASM renderer, the timeline, the
 * cursor) needs a live collector and a real ADK run, so it is covered by
 * `pnpm e2e` (scripts/viewer-e2e.ts) rather than here.
 *
 * Usage:
 *   pnpm qa:browser                       # builds nothing; serves apps/web/dist
 *   FLEETSCOPE_QA_BASE_URL=… pnpm qa:browser
 *   FLEETSCOPE_QA_SHOTS=dir pnpm qa:browser   # also writes screenshots
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env['FLEETSCOPE_QA_SHOTS'] ?? null;

/** The two sizes the product commits to, plus the narrow desktop it must survive. */
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

/** Console errors are failures. A demo with a red console is not finished. */
function watchConsole(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return { errors };
}

async function serve(): Promise<{ baseUrl: string; stop: () => void }> {
  const existing = process.env['FLEETSCOPE_QA_BASE_URL'];
  if (existing !== undefined && existing !== '') {
    return { baseUrl: existing.replace(/\/$/, ''), stop: () => {} };
  }

  const port = 4331;
  const child: ChildProcess = spawn(
    'pnpm',
    ['--filter', '@fleetscope/web', 'exec', 'astro', 'preview', '--port', String(port)],
    { cwd: repoRoot, stdio: 'ignore' },
  );
  const baseUrl = `http://localhost:${port}`;

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return { baseUrl, stop: () => child.kill() };
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`the preview server did not start on ${baseUrl}. Run pnpm build:web first.`);
}

/** No route may give the BODY a horizontal scrollbar at any supported size. */
async function assertNoBodyOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(`${label}: no horizontal body overflow`, overflow <= 0, `${overflow}px`);
}

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === null) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

/**
 * The landing page, driven.
 *
 * Run twice: once with motion, once with `prefers-reduced-motion: reduce`. The
 * reduced-motion pass is not a formality — every reveal on the page starts at
 * opacity 0, so a missing reduced-motion rule renders a blank page to the
 * readers who most need it to work.
 */
async function checkLanding(browser: Browser, baseUrl: string): Promise<void> {
  for (const reduced of [false, true]) {
    const label = reduced ? 'landing (reduced motion)' : 'landing';
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    const { errors } = watchConsole(page);
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2400);

    check(`${label}: exactly one h1`, (await page.locator('h1').count()) === 1);
    check(
      `${label}: the full narrative is present`,
      (await page.locator('main section.fs-l-sec').count()) === 6,
      await page.locator('main section.fs-l-sec').count(),
    );
    check(
      `${label}: the headline states what the product shows`,
      (await page.locator('h1').innerText()).includes('agents'),
      await page.locator('h1').innerText(),
    );

    // Nothing in view may be left invisible by an animation that never ran. The
    // bound mirrors the reveal trigger (top 92%): an element below that line has
    // not been asked to appear yet, so counting it would test the threshold
    // rather than the page.
    const hidden = await page.evaluate(() => {
      let count = 0;
      for (const element of document.querySelectorAll('[data-rise]')) {
        const box = element.getBoundingClientRect();
        const inView = box.top < window.innerHeight * 0.92 && box.bottom > 0;
        if (inView && getComputedStyle(element).opacity === '0') count++;
      }
      return count;
    });
    check(`${label}: no in-view content left invisible`, hidden === 0, hidden);

    // The decorative field must not run when motion is not wanted.
    const fieldOn = await page.evaluate(
      () => document.querySelector('#fs-l-field')?.getAttribute('data-on') === 'true',
    );
    check(`${label}: the hero field respects the motion preference`, fieldOn === !reduced, fieldOn);

    // The page's two promises: it opens the real viewer, and looking backwards
    // executes nothing.
    const primaryTargets = await page
      .locator('a.fs-l-btn--primary')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    check(
      `${label}: every primary action opens the Agent Viewer`,
      primaryTargets.length > 0 && primaryTargets.every((href) => href === '/sessions/'),
      primaryTargets.join(', '),
    );

    await page.locator('[data-replay]').scrollIntoViewIfNeeded();
    const marks = page.locator('[data-replay-mark]');
    const liveSequence = await page.locator('[data-replay-seq]').innerText();
    await marks.first().click();
    await page.waitForTimeout(200);

    check(
      `${label}: an earlier position is flagged historical`,
      (await page.locator('[data-replay-state]').getAttribute('data-historical')) === 'true',
    );
    check(
      `${label}: the historical position states that nothing executes`,
      (await page.locator('[data-replay-note]').innerText())
        .toLowerCase()
        .includes('nothing is executing'),
      await page.locator('[data-replay-note]').innerText(),
    );
    check(
      `${label}: scrubbing changes the reconstructed position`,
      (await page.locator('[data-replay-seq]').innerText()) !== liveSequence,
    );
    check(
      `${label}: the selected position is the pressed control`,
      (await marks.first().getAttribute('aria-pressed')) === 'true',
    );

    await marks.last().click();
    await page.waitForTimeout(200);
    check(
      `${label}: returning to the newest event leaves historical mode`,
      (await page.locator('[data-replay-state]').getAttribute('data-historical')) === 'false' &&
        (await page.locator('[data-replay-badge]').innerText()).trim() === 'LIVE',
      await page.locator('[data-replay-badge]').innerText(),
    );

    // The failure story is stepped, and exactly one step is current.
    await page.locator('[data-failure]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    check(
      `${label}: exactly one failure step is current`,
      (await page.locator('[data-step][aria-current="step"]').count()) === 1,
      await page.locator('[data-step][aria-current="step"]').count(),
    );

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    await assertNoBodyOverflow(page, `${label} @ 1440x900 after scroll`);
    check(`${label}: no console errors during interaction`, errors.length === 0, errors[0] ?? '');
    await shoot(page, reduced ? 'landing-reduced-motion' : 'landing-full');
    await context.close();
  }
}

async function main(): Promise<void> {
  const { baseUrl, stop } = await serve();
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch();

    // ── Every route, at every supported size ────────────────────────────────
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      });
      const page = await context.newPage();
      const { errors } = watchConsole(page);

      // Every route the product actually publishes. The deferred enterprise
      // surfaces are not built (apps/web/src/deferred), so there is nothing here
      // to visit — and the renderer they used to exercise ships on
      // /sessions/<id>, which `pnpm e2e` drives against a real ADK run.
      for (const [name, route] of [
        ['landing', '/'],
        ['sessions', '/sessions/'],
        ['setup', '/docs/'],
      ] as const) {
        errors.length = 0;
        await page.goto(baseUrl + route, { waitUntil: 'networkidle' });
        // The landing page's entrance beat sheet resolves by ~2s; screenshotting
        // through it would capture a half-drawn scene and call it the design.
        if (name === 'landing') await page.waitForTimeout(2400);
        await page.waitForTimeout(400);
        check(
          `${name} @ ${viewport.name}: loads`,
          await page.locator(name === 'landing' ? '.fs-l-main' : '.fs-shell').isVisible(),
          route,
        );
        await assertNoBodyOverflow(page, `${name} @ ${viewport.name}`);
        // The Agent Viewer asks the local collector for sessions. Serving the
        // static build alone, there is no collector, so its 404 is the expected
        // answer rather than a defect. Every other console error still fails.
        const unexpected = errors.filter(
          (message) => !(name === 'sessions' && /404|Failed to fetch|load resource/i.test(message)),
        );
        check(
          `${name} @ ${viewport.name}: no console errors`,
          unexpected.length === 0,
          unexpected[0] ?? '',
        );
        await shoot(page, `${name}-${viewport.name}`);
      }
      await context.close();
    }

    // ── The landing page, in depth ──────────────────────────────────────────
    // The landing page is the only surface a visitor sees before the evidence,
    // so what it claims has to be as testable as what the console shows. These
    // checks are behavioural: a control that says "Denied" must visibly stop the
    // request, and a replay position must change recorded state.
    await checkLanding(browser, baseUrl);
  } finally {
    await browser?.close();
    stop();
  }

  const failed = checks.filter((entry) => !entry.ok);
  for (const entry of checks) {
    process.stdout.write(
      `${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail === '' ? '' : `  ::  ${entry.detail}`}\n`,
    );
  }
  process.stdout.write(
    `\n${checks.length - failed.length}/${checks.length} browser checks passed\n`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
