import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * Landing page choreography (DESIGN.md §28–§30).
 *
 * Three motion families, and nothing else:
 *   A entrance   — a block rising into place once, on first sight
 *   B connect    — raw log lines resolving into the structured run
 *   C scroll     — a pinned scene stepped against real recorded positions
 *
 * Two rules hold everywhere:
 *   1. Under `prefers-reduced-motion: reduce` no rAF loop starts and no pin is
 *      created (DESIGN.md §35). Every control still works and the page shows
 *      its end state.
 *   2. The scroll layer never invents state. A scrubbed position maps onto a
 *      recorded event; it does not interpolate between two of them.
 */

gsap.registerPlugin(ScrollTrigger);

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduced = (): boolean => REDUCED.matches;
/** DESIGN.md §34: pinned multi-column scenes are desktop-only. */
const canPin = (): boolean => !reduced() && window.innerWidth >= 1024;

const qs = <T extends Element>(selector: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(selector);
const qsa = <T extends Element>(selector: string, root: ParentNode = document): T[] =>
  Array.from(root.querySelectorAll<T>(selector));

/** Maps scroll progress onto a discrete step index — never a fraction of one. */
const stepIndex = (progress: number, count: number): number =>
  Math.min(count - 1, Math.max(0, Math.floor(progress * count)));

// ── 00 Navigation ─────────────────────────────────────────────────────────

function nav(): void {
  const bar = qs<HTMLElement>('#fs-l-nav');
  const sentinel = qs<HTMLElement>('#fs-l-nav-sentinel');
  if (bar === null || sentinel === null) return;

  // A sentinel costs nothing per frame; a scroll listener does.
  new IntersectionObserver(
    ([entry]) => {
      bar.dataset['scrolled'] = entry?.isIntersecting === true ? 'false' : 'true';
    },
    { rootMargin: '0px' },
  ).observe(sentinel);
}

// ── Entrance reveals ──────────────────────────────────────────────────────

function reveals(): void {
  if (reduced()) return;

  gsap.from('.fs-l-reveal > span', {
    yPercent: 110,
    duration: 0.8,
    stagger: 0.08,
    ease: 'power3.out',
  });

  for (const element of qsa<HTMLElement>('[data-rise]')) {
    gsap.from(element, {
      opacity: 0,
      y: 18,
      duration: 0.62,
      ease: 'power3.out',
      scrollTrigger: { trigger: element, start: 'top 92%', once: true },
    });
  }

  // The hero spine draws itself top-down: the run, in the order it happened.
  gsap.from('[data-hero] [data-node]', {
    opacity: 0,
    x: -14,
    duration: 0.5,
    stagger: 0.07,
    ease: 'power3.out',
    delay: 0.25,
  });
}

// ── 02 Logs → graph ───────────────────────────────────────────────────────

/**
 * The page's primary story: the same events, twice.
 *
 * The left column fades back and the right column resolves as the section
 * crosses the viewport. Both are rendered from the recording at build time, so
 * the animation reveals content that was always there rather than fabricating
 * a transformation.
 */
function logsToGraph(): void {
  const section = qs<HTMLElement>('[data-logs]');
  if (section === null || reduced()) return;

  gsap
    .timeline({
      scrollTrigger: { trigger: section, start: 'top 70%', end: 'center center', scrub: 0.4 },
    })
    .to('[data-raw]', { opacity: 0.32, stagger: 0.02, duration: 0.4 }, 0)
    .to('[data-logs-arrow]', { opacity: 1, scaleX: 1, duration: 0.5 }, 0.1)
    .from('[data-structured]', { opacity: 0, x: 18, stagger: 0.06, duration: 0.5 }, 0.2);
}

// ── 04 Failure ────────────────────────────────────────────────────────────

/** Four steps, pinned, stepped discretely against scroll progress. */
function failure(): void {
  const scene = qs<HTMLElement>('[data-pin-scene]');
  const steps = qsa<HTMLElement>('[data-step]');
  if (scene === null || steps.length === 0 || !canPin()) return;

  ScrollTrigger.create({
    trigger: scene,
    start: 'top 18%',
    end: () => `+=${steps.length * 260}`,
    pin: true,
    scrub: true,
    onUpdate: (self) => {
      const index = stepIndex(self.progress, steps.length);
      for (const [position, step] of steps.entries()) {
        step.setAttribute('aria-current', position === index ? 'step' : 'false');
      }
    },
  });
}

// ── 05 Replay ─────────────────────────────────────────────────────────────

interface ReplayMark {
  readonly sequence: number;
  readonly agent: string;
  readonly label: string;
}

/**
 * Historical inspection, demonstrated honestly.
 *
 * Selecting an earlier mark reports the state AT that recorded position and
 * says, in as many words, that nothing is executing — which is the product's
 * actual behaviour, not a claim invented for the page.
 */
function replay(): void {
  const marks = qsa<HTMLButtonElement>('[data-replay-mark]');
  const state = qs<HTMLElement>('[data-replay-state]');
  const payloadNode = qs<HTMLScriptElement>('[data-replay-payload]');
  if (marks.length === 0 || state === null || payloadNode === null) return;

  let data: ReplayMark[];
  try {
    data = JSON.parse(payloadNode.textContent ?? '[]') as ReplayMark[];
  } catch {
    return;
  }

  const badge = qs<HTMLElement>('[data-replay-badge]');
  const note = qs<HTMLElement>('[data-replay-note]');
  const seq = qs<HTMLElement>('[data-replay-seq]');
  const agent = qs<HTMLElement>('[data-replay-agent]');

  const show = (index: number): void => {
    const mark = data[index];
    if (mark === undefined) return;
    const historical = index < data.length - 1;

    state.dataset['historical'] = String(historical);
    if (badge !== null) badge.textContent = historical ? 'HISTORICAL' : 'LIVE';
    if (note !== null) {
      note.textContent = historical
        ? 'Recorded session state. Nothing is executing.'
        : 'At the latest recorded event.';
    }
    if (seq !== null) seq.textContent = String(mark.sequence);
    if (agent !== null) agent.textContent = mark.agent;

    for (const [position, button] of marks.entries()) {
      button.setAttribute('aria-pressed', String(position === index));
    }
  };

  for (const [index, button] of marks.entries()) {
    button.addEventListener('click', () => show(index));
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────

document.documentElement.dataset['motion'] = reduced() ? 'off' : 'on';

nav();
reveals();
logsToGraph();
failure();
replay();
