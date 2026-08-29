/**
 * Accessibility QA for the landing page and the Agent Viewer.
 *
 * These are the claims that cannot be checked by reading CSS: that the page is
 * complete with motion off, that the timeline is operable from the keyboard,
 * that state changes are announced, and that status survives a monochrome
 * screen. They run against a REAL collector holding at least one session.
 *
 * Usage:
 *   fleetscope watch --port 4401        # in another terminal, with a session stored
 *   FLEETSCOPE_QA_BASE_URL=http://127.0.0.1:4401 pnpm qa:a11y
 */
import { chromium, type Page } from 'playwright';

const BASE = (process.env['FLEETSCOPE_QA_BASE_URL'] ?? 'http://127.0.0.1:4317').replace(/\/$/, '');

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: unknown = ''): void => {
  results.push({ name, ok, detail: String(detail) });
};

async function firstSessionId(): Promise<string | null> {
  const response = await fetch(`${BASE}/api/sessions`);
  if (!response.ok) return null;
  const body = (await response.json()) as { sessions: { id: string }[] };
  return body.sessions[0]?.id ?? null;
}

/** The page must present its whole story with no animation running. */
async function landing(page: Page): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForTimeout(800);

  const revealed = await page.evaluate(() => {
    const span = document.querySelector('.fs-l-reveal > span');
    return span === null ? '0' : getComputedStyle(span).opacity;
  });
  check(
    'the headline is visible under reduced motion',
    (await page.locator('#fs-l-hero-title').isVisible()) && revealed === '1',
  );
  check('exactly one h1', (await page.locator('h1').count()) === 1);

  const labelled = await page.locator('section[aria-labelledby]').count();
  check('every section is labelled for a screen reader', labelled >= 5, `${labelled} sections`);
}

/**
 * The landing page WITH motion running.
 *
 * `landing()` above runs in a reduced-motion context, where the scroll
 * animations return early — so anything an animation does to legibility is
 * invisible to it. That blind spot let the §02 terminal fade its log lines to
 * opacity 0.32, compositing them to 1.79:1 against their own background: the
 * evidence the section argues from, unreadable for everyone who has motion on.
 */
async function landingInMotion(page: Page): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  // Drive the scroll triggers to their settled state.
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 700) {
    await page.evaluate((value: number) => window.scrollTo(0, value), y);
    await page.waitForTimeout(180);
  }
  await page.evaluate(() => window.scrollTo(0, 1300));
  await page.waitForTimeout(1200);

  const contrast = await page.evaluate(() => {
    const line = document.querySelector<HTMLElement>('[data-raw]');
    const panel = line?.parentElement;
    if (line == null || panel == null) return null;

    const style = getComputedStyle(line);
    const alpha = Number(style.opacity);
    const foreground = (style.color.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const background = (getComputedStyle(panel).backgroundColor.match(/\d+(\.\d+)?/g) ?? [])
      .slice(0, 3)
      .map(Number);

    // Opacity is not a colour: composite it before measuring, or the ratio
    // reported is one no reader ever sees. Written inline because this body is
    // serialised into the page, where tsx's wrapper for a named nested function
    // is not defined.
    const luminance: number[] = [];
    for (const rgb of [
      foreground.map((v, i) => v * alpha + (background[i] ?? 0) * (1 - alpha)),
      background,
    ]) {
      let total = 0;
      const weights = [0.2126, 0.7152, 0.0722];
      for (let i = 0; i < 3; i += 1) {
        const s = (rgb[i] ?? 0) / 255;
        total += (weights[i] ?? 0) * (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
      }
      luminance.push(total);
    }

    const [a = 0, b = 0] = luminance;
    return {
      ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      opacity: alpha,
    };
  });

  check(
    'the raw log lines stay readable once the animation settles',
    contrast !== null && contrast.ratio >= 4.5,
    `${contrast?.ratio.toFixed(2) ?? '?'}:1 at opacity ${contrast?.opacity ?? '?'}`,
  );
}

async function viewer(page: Page, sessionId: string): Promise<void> {
  await page.goto(`${BASE}/sessions/${sessionId}`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const transport = page.locator('[data-transport]');
  check(
    'live/historical is announced, not merely coloured',
    (await transport.getAttribute('role')) === 'status' &&
      (await transport.getAttribute('aria-live')) === 'polite',
  );
  check(
    'the details pane announces the selected event',
    (await page.locator('[data-details]').getAttribute('aria-live')) === 'polite',
  );
  check(
    'the graph has a text alternative',
    (await page.locator('#fleetscope-cockpit-canvas').getAttribute('aria-label')) !== null,
  );
  check(
    'the timeline and the agent tree are labelled',
    (await page.locator('[data-timeline-rows][aria-label]').count()) === 1 &&
      (await page.locator('[data-agent-tree][aria-label]').count()) === 1,
  );
  check(
    'every timeline row is a real button, not a clickable div',
    (await page.locator('.fs-event').count()) === (await page.locator('button.fs-event').count()),
  );
  check(
    'selection is exposed as aria-current',
    (await page.locator('.fs-event[aria-current]').count()) > 0,
  );
  check(
    'agent focus is exposed as aria-pressed',
    (await page.locator('.fs-agent[aria-pressed]').count()) > 0,
  );

  await page.locator('.fs-event').nth(3).focus();
  const focused = await page.evaluate(() => document.activeElement?.className ?? '');
  check('a timeline row can take focus', focused.includes('fs-event'), focused);

  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check(
    'activating a row from the keyboard shows its details',
    ((await page.locator('[data-details]').textContent()) ?? '').length > 30,
  );

  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  check(
    'arrow keys step the cursor into history',
    (await page.locator('[data-transport-label]').textContent()) === 'HISTORICAL',
  );

  await page.keyboard.press('End');
  await page.waitForTimeout(300);
  check(
    'End returns to the live edge',
    (await page.locator('[data-transport-label]').textContent()) !== 'HISTORICAL',
  );

  const lastAction = (await page.locator('.fs-agent__last').first().textContent()) ?? '';
  check(
    'status is a word as well as a colour',
    /Running|Completed|Failed/.test(lastAction),
    lastAction.slice(0, 40),
  );
}

const sessionId = await firstSessionId();
if (sessionId === null) {
  process.stderr.write(
    `No session found at ${BASE}. Start FleetScope and capture one run first.\n`,
  );
  process.exit(2);
}

const browser = await chromium.launch();
try {
  // Reduced motion is a separate context: it is a browser-level preference.
  const reduced = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
  });
  await landing(await reduced.newPage());
  await reduced.close();

  const normal = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await landingInMotion(await normal.newPage());
  await viewer(await normal.newPage(), sessionId);
  await normal.close();
} finally {
  await browser.close();
}

let failed = 0;
for (const item of results) {
  if (!item.ok) failed += 1;
  process.stdout.write(
    `${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail === '' ? '' : `  — ${item.detail}`}\n`,
  );
}
process.stdout.write(
  `\n${results.length - failed}/${results.length} accessibility checks passed\n`,
);
process.exit(failed === 0 ? 0 : 1);
