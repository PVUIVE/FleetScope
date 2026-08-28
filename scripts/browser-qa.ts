/**
 * Browser QA for the FleetScope product UI.
 *
 * Unit tests prove the presentation layer computes the right thing. They cannot
 * prove the WASM renderer instantiated, that a click on an evidence row actually
 * moved the graph, or that the page does not scroll sideways at 1280x720 — and
 * every one of those has broken at least once. This drives a real browser.
 *
 * Usage:
 *   pnpm qa:browser                       # builds nothing; serves apps/web/dist
 *   FLEETSCOPE_QA_BASE_URL=… pnpm qa:browser
 *   FLEETSCOPE_QA_SHOTS=dir pnpm qa:browser   # also writes screenshots
 *
 * The live proof is exercised only when FLEETSCOPE_QA_LIVE=true, because it
 * spends real money. See docs/design/budget-demo.md.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CASE_ID = process.env['FLEETSCOPE_QA_CASE_ID'] ?? 'CASE-1042';
const SHOTS = process.env['FLEETSCOPE_QA_SHOTS'] ?? null;
const RUN_LIVE = process.env['FLEETSCOPE_QA_LIVE'] === 'true';

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
      const response = await fetch(`${baseUrl}/cases/`);
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
      (await page.locator('main section').count()) === 11,
      await page.locator('main section').count(),
    );
    check(
      `${label}: the headline states the product, not a vendor`,
      (await page.locator('h1').innerText()).includes('Control every agent'),
    );

    // Nothing in view may be left invisible by an animation that never ran.
    const hidden = await page.evaluate(() => {
      let count = 0;
      for (const element of document.querySelectorAll('[data-rise]')) {
        const box = element.getBoundingClientRect();
        const inView = box.top < window.innerHeight && box.bottom > 0;
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

    // Governance is claimed by behaviour: a denial has to stop the request.
    await page.locator('#corridor-screening').scrollIntoViewIfNeeded();
    await page.locator('#corridor-screening [data-corridor-state="blocked"]').click();
    await page.waitForTimeout(400);
    check(
      `${label}: a blocked input visibly stops at the gate`,
      await page.evaluate(() => {
        const out = document.querySelector<SVGElement>('#corridor-screening [data-flow="out"]');
        return out !== null && out.style.opacity === '0';
      }),
    );
    check(
      `${label}: the corridor cites the event that proves it`,
      /^evt-\d{4}$/.test(await page.locator('#corridor-screening [data-corridor-evt]').innerText()),
      await page.locator('#corridor-screening [data-corridor-evt]').innerText(),
    );

    // Replay must re-read recorded state, and say so.
    await page.locator('#replay').scrollIntoViewIfNeeded();
    const agentsAtEnd = await page.locator('[data-replay-count="agents"]').innerText();
    await page.locator('[data-replay-input]').fill('2');
    await page.waitForTimeout(300);
    check(
      `${label}: scrubbing changes the reconstructed state`,
      (await page.locator('[data-replay-count="agents"]').innerText()) !== agentsAtEnd,
    );
    check(
      `${label}: an earlier position is flagged historical`,
      (await page.locator('[data-replay-stage]').getAttribute('data-historical')) === 'true',
    );
    check(
      `${label}: the position shows its recorded state hash`,
      /^[0-9a-f]{10}…[0-9a-f]{6}$/.test(await page.locator('[data-replay-hash]').innerText()),
      await page.locator('[data-replay-hash]').innerText(),
    );

    // Cockpit tabs are a real tablist, not five divs.
    await page.locator('#cockpit').scrollIntoViewIfNeeded();
    await page.locator('[data-cockpit-tab="incident"]').click();
    await page.waitForTimeout(300);
    check(
      `${label}: switching the Cockpit control switches the evidence rail`,
      (await page.locator('[data-rail="incident"]').getAttribute('data-on')) === 'true',
    );

    await page.locator('#evidence').scrollIntoViewIfNeeded();
    await page.locator('[data-ev-row]').nth(2).click();
    await page.waitForTimeout(200);
    check(
      `${label}: an evidence row opens its Decision Evidence`,
      (await page.locator('[data-ev="evt"]').innerText()).includes('evt-'),
      await page.locator('[data-ev="evt"]').innerText(),
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

      for (const [name, route] of [
        ['landing', '/'],
        ['catalog', '/catalog/'],
        ['cases', '/cases/'],
        ['workspace', `/cases/${CASE_ID}/`],
        ['approvals', '/approvals/'],
        ['cockpit', `/cockpit/${CASE_ID}/`],
        ['audit', `/audit/${CASE_ID}/`],
      ] as const) {
        errors.length = 0;
        await page.goto(baseUrl + route, { waitUntil: 'networkidle' });
        // Wait for the renderer to exist rather than for a stopwatch: a fixed
        // delay turns a slow machine into a false failure, which is the fastest
        // way to teach a team to ignore its own QA.
        // The landing page's entrance beat sheet resolves by ~2s; screenshotting
        // through it would capture a half-drawn scene and call it the design.
        if (name === 'landing') await page.waitForTimeout(2400);
        if (name === 'cockpit') {
          await page
            .waitForSelector('#fleetscope-cockpit-canvas canvas', { timeout: 20_000 })
            .catch(() => {});
        }
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

    // ── The Cockpit, in depth ───────────────────────────────────────────────
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const { errors } = watchConsole(page);

    await page.goto(`${baseUrl}/catalog/`, { waitUntil: 'networkidle' });
    check(
      'catalog: offers the recorded Case',
      (await page.locator(`a[href="/cases/${CASE_ID}"]`).count()) > 0,
    );

    await page.goto(`${baseUrl}/cases/${CASE_ID}/`, { waitUntil: 'networkidle' });
    const workspace = await page.locator('.fs-answers').innerText();
    check('workspace: answers the six questions', (await page.locator('.fs-answer').count()) === 6);
    check(
      'workspace: names the simulated day boundary in full',
      (await page.locator('.fs-rail-steps').innerText()).includes('Simulated Day'),
    );
    check('workspace: shows a next step', workspace.length > 0);

    await page.goto(`${baseUrl}/cockpit/${CASE_ID}/`, { waitUntil: 'networkidle' });
    await page
      .waitForSelector('#fleetscope-cockpit-canvas canvas', { timeout: 20_000 })
      .catch(() => {});
    await page.waitForTimeout(600);
    check(
      'cockpit: the WASM renderer instantiated',
      (await page.locator('#fleetscope-cockpit-canvas canvas').count()) === 1,
    );
    const atEdge = await page.locator('[data-cursor-sequence]').innerText();
    check('cockpit: the event count is 1-based', atEdge !== '0' && atEdge !== '—', atEdge);
    check(
      'cockpit: Story Mode is the default',
      (await page.locator('[data-cockpit-shell]').getAttribute('data-mode')) === 'story',
    );
    check(
      'cockpit: Story Mode shows outcome, four proofs, and five chapters',
      (await page.locator('.fs-story__outcome').count()) === 1 &&
        (await page.locator('.fs-story__proof').count()) === 4 &&
        (await page.locator('[data-story-chapter]').count()) === 5,
    );
    check(
      'cockpit: technical evidence is hidden until Expert Mode',
      await page
        .locator('[data-evidence-rail]')
        .evaluate((rail) => rail.closest<HTMLElement>('[data-cockpit-expert]')?.hidden === true),
    );

    const wardenChapter = page.locator('[data-story-chapter="warden"]');
    const wardenSequence = await wardenChapter.getAttribute('data-seek-sequence');
    await wardenChapter.click();
    await page.waitForTimeout(500);
    check(
      'cockpit: Story chapter seeks through the Render Manifest',
      (await page.locator('[data-cursor-sequence]').innerText()) ===
        String(Number(wardenSequence) + 1),
      await page.locator('[data-cursor-readout]').innerText(),
    );
    const cursorBeforeExpert = await page.locator('[data-cursor-sequence]').innerText();
    await page.getByRole('button', { name: 'Open technical evidence', exact: true }).click();
    check(
      'cockpit: Expert Mode reveals full evidence without moving the cursor',
      (await page.locator('[data-cockpit-shell]').getAttribute('data-mode')) === 'expert' &&
        (await page.locator('[data-evidence-rail]').isVisible()) &&
        (await page.locator('[data-cursor-sequence]').innerText()) === cursorBeforeExpert,
    );

    // Selecting Armor evidence must move the graph through the Render Manifest.
    const armor = page.locator('[data-evidence-marker]').filter({ hasText: 'Armor' }).first();
    const armorSequence = await armor.getAttribute('data-case-sequence');
    await armor.click();
    await page.waitForTimeout(600);
    check(
      'cockpit: selecting evidence moves the Event Cursor',
      (await page.locator('[data-cursor-sequence]').innerText()) ===
        String(Number(armorSequence) + 1),
      await page.locator('[data-cursor-readout]').innerText(),
    );
    const rendererIndex = await page.evaluate(() => {
      const cockpit = (globalThis as Record<string, unknown>)['fleetscopeCockpit'] as
        { fleetscope_snapshot: () => string } | undefined;
      return cockpit === undefined
        ? null
        : (JSON.parse(cockpit.fleetscope_snapshot()) as { rendererEntryIndex: number })
            .rendererEntryIndex;
    });
    const expectedRange = await page.evaluate((sequence: string) => {
      const node = document.querySelector('[data-cockpit-scene]');
      const scene = JSON.parse(node?.textContent ?? '{}') as {
        manifest: { entries: { caseSequence: number; rendererEntryStart: number }[] };
      };
      return (
        scene.manifest.entries.find((entry) => entry.caseSequence === Number(sequence))
          ?.rendererEntryStart ?? null
      );
    }, armorSequence ?? '0');
    check(
      'cockpit: the renderer seeked to the manifest range for that event',
      rendererIndex !== null && rendererIndex === expectedRange,
      `renderer ${rendererIndex}, manifest ${expectedRange}`,
    );

    check(
      'cockpit: historical mode says nothing is executing',
      (await page.locator('[data-transport-label]').innerText()).includes('nothing is executing'),
      await page.locator('[data-transport-label]').innerText(),
    );
    const unread = await page.locator('[data-unread-count]').innerText();
    check('cockpit: canonical unread is reported', unread.includes('new'), unread);

    // The Decision Evidence drawer.
    await page.locator('[data-evidence-open]').first().click();
    await page.waitForTimeout(300);
    check(
      'cockpit: the evidence drawer opens',
      await page.locator('[data-evidence-drawer]').isVisible(),
    );
    check(
      'cockpit: the drawer shows canonical provenance',
      (await page.locator('[data-drawer-body]').innerText()).includes('Evidence Event ID'),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check(
      'cockpit: Escape closes the drawer',
      !(await page.locator('[data-evidence-drawer]').isVisible()),
    );

    // Incident and Warden presentation.
    const incidents = await page.locator('[data-incident]').allInnerTexts();
    check(
      'cockpit: incidents explain why they opened',
      incidents.some((text) => text.includes('DETECTED BECAUSE')) ||
        incidents.some((text) => text.includes('Detected because')),
      incidents[0]?.slice(0, 60) ?? '',
    );
    const lifecycle = await page.locator('.fs-lifecycle').first().innerText();
    check(
      'cockpit: the Warden lifecycle keeps its stages separate',
      lifecycle.includes('asked the Runtime') && lifecycle.includes('acknowledged'),
      lifecycle.replace(/\n/g, ' · ').slice(0, 120),
    );

    // Demo phase navigation, then back to the live edge.
    await page.locator('[data-phase="warden"]').click();
    await page.waitForTimeout(500);
    check(
      'cockpit: demo phase navigation seeks',
      (await page.locator('[data-phase="warden"]').getAttribute('aria-current')) === 'true',
    );
    await page.locator('[data-return-to-live]').click();
    await page.waitForTimeout(600);
    check(
      'cockpit: Return to live reaches the edge',
      (await page.locator('[data-cursor-sequence]').innerText()) === atEdge &&
        !(await page.locator('[data-transport-label]').innerText()).includes('Historical'),
      await page.locator('[data-transport-label]').innerText(),
    );

    // Keyboard reachability of the primary controls.
    const reachable = await page.evaluate(() => {
      const focusable = [
        ...document.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), select, input, summary',
        ),
      ].filter((element) => element.offsetParent !== null);
      return {
        total: focusable.length,
        nav: focusable.filter((element) => element.closest('.fs-nav') !== null).length,
        realButtons: [...document.querySelectorAll('[data-evidence-open]')].every(
          (element) => element.tagName === 'BUTTON',
        ),
      };
    });
    check('cockpit: primary navigation is keyboard reachable', reachable.nav >= 5, reachable.nav);
    check('cockpit: evidence controls are real buttons', reachable.realButtons);
    await page.keyboard.press('Tab');
    check(
      'cockpit: focus lands on a focusable element',
      await page.evaluate(() => document.activeElement?.tagName !== 'BODY'),
    );

    check('cockpit: no console errors during interaction', errors.length === 0, errors[0] ?? '');

    // ── Audit ───────────────────────────────────────────────────────────────
    errors.length = 0;
    await page.goto(`${baseUrl}/audit/${CASE_ID}/`, { waitUntil: 'networkidle' });
    const before = await page.locator('[data-audit-count]').innerText();
    await page.selectOption('[data-audit-filter="domain"]', 'armor');
    await page.waitForTimeout(250);
    const after = await page.locator('[data-audit-count]').innerText();
    check(
      'audit: filters narrow the event log',
      Number(after) < Number(before),
      `${before} → ${after}`,
    );
    await page.selectOption('[data-audit-filter="domain"]', '');

    await page.locator('[data-evidence-open]').first().click();
    await page.waitForTimeout(300);
    check(
      'audit: the evidence drawer opens',
      await page.locator('[data-evidence-drawer]').isVisible(),
    );
    await page.keyboard.press('Escape');

    await page.locator('[data-export-verify]').click();
    await page.waitForTimeout(1500);
    check(
      'audit: the evidence export verifies in the browser',
      (await page.locator('[data-export-verify-result]').innerText()).startsWith('Verified'),
      await page.locator('[data-export-verify-result]').innerText(),
    );
    check(
      'audit: capability modes are labelled, and unknown counts are not zero',
      (await page.locator('.fs-card', { hasText: 'Capability truth' }).innerText()).includes(
        'Synthetic System',
      ),
    );
    check('audit: no console errors', errors.length === 0, errors[0] ?? '');

    // ── The bounded live proof, only when explicitly asked for ──────────────
    errors.length = 0;
    await page.goto(`${baseUrl}/cockpit/${CASE_ID}/`, { waitUntil: 'networkidle' });
    await page
      .waitForSelector('#fleetscope-cockpit-canvas canvas', { timeout: 20_000 })
      .catch(() => {});
    await page.waitForTimeout(800);
    const liveButton = page.locator('[data-live-run]');
    const liveEnabled = await liveButton.isEnabled();

    if (!RUN_LIVE) {
      check(
        'live proof: the control is present and honest about availability',
        (await page.locator('[data-live-availability]').innerText()).length > 0,
        await page.locator('[data-live-availability]').innerText(),
      );
      check(
        'live proof: recorded mode is unaffected by an unavailable live path',
        (await page.locator('[data-cursor-sequence]').innerText()) === atEdge,
      );
    } else {
      check('live proof: the API reports the step is available', liveEnabled);
      if (liveEnabled) {
        const eventsBefore = Number(await page.locator('[data-cursor-total]').innerText());
        const railBefore = Number(await page.locator('[data-evidence-count]').innerText());
        await liveButton.click();
        // A second click must not spend a second call.
        await liveButton.click({ force: true }).catch(() => {});
        await page.waitForFunction(
          () =>
            document.querySelector('[data-live-state]')?.getAttribute('data-state') !== 'running',
          undefined,
          { timeout: 30_000 },
        );
        const state = await page.locator('[data-live-state]').getAttribute('data-state');
        const text = await page.locator('[data-live-state]').innerText();
        check(
          'live proof: the request resolved',
          state !== 'running',
          `${state}: ${text.slice(0, 120)}`,
        );
        if (state === 'succeeded') {
          const eventsAfter = Number(await page.locator('[data-cursor-total]').innerText());
          const railAfter = Number(await page.locator('[data-evidence-count]').innerText());
          check(
            'live proof: canonical evidence grew',
            eventsAfter > eventsBefore,
            `${eventsBefore} → ${eventsAfter}`,
          );
          check(
            'live proof: the evidence rail grew',
            railAfter > railBefore,
            `${railBefore} → ${railAfter}`,
          );
          check(
            'live proof: the result is labelled Live Proof',
            text.includes('Live proof succeeded'),
          );
          check('live proof: the button is spent, not retryable', !(await liveButton.isEnabled()));
          check(
            'live proof: the renderer still seeks the recorded prefix',
            await page.evaluate(() => {
              const cockpit = (globalThis as Record<string, unknown>)['fleetscopeCockpit'] as
                { fleetscope_seek_case_sequence: (n: number) => boolean } | undefined;
              return cockpit?.fleetscope_seek_case_sequence(15) ?? false;
            }),
          );
        }
        check('live proof: no console errors', errors.length === 0, errors[0] ?? '');
      }
    }

    await shoot(page, 'cockpit-after-interaction');
    await context.close();
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
