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
      (await page.locator('main section').count()) === 6,
      await page.locator('main section').count(),
    );
    check(
      `${label}: the headline states what the product shows`,
      (await page.locator('h1').innerText()).includes('See what your'),
      await page.locator('h1').innerText(),
    );

    /*
     * Nothing in reading position may be left invisible by an animation that
     * never ran.
     *
     * "Reading position" is the animation's own threshold, not the edge of the
     * viewport: `[data-rise]` reveals at `top 92%`, so an element that has only
     * peeked into the bottom 8% is not late, it is simply not up yet. Testing
     * against the viewport edge instead fails on that sliver and says nothing
     * about whether a reader ever sees a blank block.
     */
    const REVEAL_LINE = 0.92;
    const hidden = await page.evaluate((line: number) => {
      const names: string[] = [];
      for (const element of document.querySelectorAll('[data-rise]')) {
        const box = element.getBoundingClientRect();
        const inView = box.top < window.innerHeight * line && box.bottom > 0;
        if (inView && getComputedStyle(element).opacity === '0') {
          names.push(`${element.tagName.toLowerCase()}.${element.className}`);
        }
      }
      return names;
    }, REVEAL_LINE);
    check(
      `${label}: no content in reading position left invisible`,
      hidden.length === 0,
      hidden.join(' | '),
    );

    // The decorative field must not run when motion is not wanted.
    const fieldOn = await page.evaluate(
      () => document.querySelector('#fs-l-field')?.getAttribute('data-on') === 'true',
    );
    check(`${label}: the hero field respects the motion preference`, fieldOn === !reduced, fieldOn);

    /*
     * Replay is the page's central claim — "move backwards and nothing
     * executes" — so it is checked by behaviour rather than by copy: an earlier
     * position must change the reconstructed state, must be flagged historical,
     * and must keep saying that nothing is running.
     */
    await page.locator('[data-replay]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const marks = page.locator('[data-replay-mark]');
    const markCount = await marks.count();
    check(`${label}: the replay offers recorded positions`, markCount > 1, markCount);

    const liveSeq = await page.locator('[data-replay-seq]').innerText();
    await marks.first().click();
    await page.waitForTimeout(300);

    check(
      `${label}: an earlier position changes the reconstructed state`,
      (await page.locator('[data-replay-seq]').innerText()) !== liveSeq,
      `${liveSeq} → ${await page.locator('[data-replay-seq]').innerText()}`,
    );
    check(
      `${label}: an earlier position is flagged historical`,
      (await page.locator('[data-replay-state]').getAttribute('data-historical')) === 'true',
    );
    check(
      `${label}: the replay says nothing is executing`,
      (await page.locator('[data-replay-exec]').innerText()).toLowerCase().includes('nothing'),
      await page.locator('[data-replay-exec]').innerText(),
    );
    check(
      `${label}: the chosen position is the pressed one`,
      (await marks.first().getAttribute('aria-pressed')) === 'true',
    );

    // A failure is what the page promises to make findable, so the section that
    // claims it has to name a real error class rather than the word "error".
    await page.locator('[data-failure]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    check(
      `${label}: the failure section shows a recorded ERROR row`,
      (await page.locator('[data-failure] [data-kind="ERROR"]').count()) > 0,
      await page.locator('[data-failure] [data-kind="ERROR"]').count(),
    );

    /*
     * Walk the whole page, not just the first screen.
     *
     * `[data-rise]` reveals on a scroll trigger, so a section below the fold is
     * legitimately at opacity 0 until it is reached — a full-page screenshot of
     * an unscrolled landing shows blanks for that reason and proves nothing.
     * Scrolling through in steps fires every trigger; anything still invisible
     * at the end is a section a reader would arrive at and find empty.
     */
    await page.evaluate(async () => {
      const step = window.innerHeight * 0.75;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 160));
      }
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(900);

    const stillHidden = await page.evaluate(() => {
      const names: string[] = [];
      for (const element of document.querySelectorAll('[data-rise]')) {
        if (getComputedStyle(element).opacity === '0') {
          names.push(`${element.tagName.toLowerCase()}.${element.className}`);
        }
      }
      return names;
    });
    check(
      `${label}: every section reveals once scrolled to`,
      stillHidden.length === 0,
      stillHidden.join(' | '),
    );

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
        // `/sessions/` asks the local collector for the session list. This
        // harness serves the static build with no collector behind it, so that
        // request is MEANT to fail — and how the page handles it is the thing
        // worth checking, below. The probe's own 404 is not a defect.
        if (name === 'sessions') {
          for (let index = errors.length - 1; index >= 0; index -= 1) {
            if (/404|Failed to load resource/.test(errors[index] ?? '')) errors.splice(index, 1);
          }
        }
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
        check(
          `${name} @ ${viewport.name}: no console errors`,
          errors.length === 0,
          errors[0] ?? '',
        );
        // With no collector answering, the session list must SAY so rather than
        // sit on an empty page that looks like "you have no sessions".
        if (name === 'sessions') {
          await page.waitForTimeout(300);
          check(
            `${name} @ ${viewport.name}: says the collector is not answering`,
            await page.locator('[data-offline]').isVisible(),
          );
          check(
            `${name} @ ${viewport.name}: does not also claim there are no sessions`,
            !(await page.locator('[data-empty]').isVisible()),
          );
        }

        await shoot(page, `${name}-${viewport.name}`);
      }
      await context.close();
    }

    // ── The landing page, in depth ──────────────────────────────────────────
    // The landing page is the only surface a visitor sees before the evidence,
    // so what it claims has to be as testable as what the console shows. These
    // checks are behavioural: seeking to an earlier position must change the
    // reconstructed state and say that nothing re-executed.
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
