import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { mountConstellation } from './constellation';
import { copyText } from '../lib/copy-button';

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
    /*
     * The raw log lines recede — they do not become unreadable.
     *
     * This was 0.32, which composited `--fs-terminal-text` down to rgb(58,61,70)
     * on the rgb(12,13,18) terminal ground: a contrast ratio of 1.79:1 against a
     * 4.5:1 requirement. The section's whole argument is a comparison between
     * the raw list on the left and the structured run on the right, and at that
     * opacity the left-hand side of the comparison could not be read at all.
     * 0.8 is the lowest step that still clears AA here (5.27:1), and the
     * emergence of the structured side carries the transformation anyway.
     */
    .to('[data-raw]', { opacity: 0.8, stagger: 0.02, duration: 0.4 }, 0)
    .to('[data-logs-arrow]', { opacity: 1, scaleX: 1, duration: 0.5 }, 0.1)
    .from('[data-structured]', { opacity: 0, x: 18, stagger: 0.06, duration: 0.5 }, 0.2);
}

// ── Hero commands ─────────────────────────────────────────────────────────

/**
 * The two commands in the hero copy themselves when clicked.
 *
 * They are the first thing a visitor is asked to run, and they were only
 * readable — which meant retyping them, or dragging a selection across a
 * monospace block, to do the thing the page is asking for.
 */
function heroCommands(): void {
  for (const button of qsa<HTMLButtonElement>('[data-copy-command]')) {
    const command = button.dataset['copyCommand'] ?? '';
    const hint = button.querySelector<HTMLElement>('[data-copy-hint]');
    if (command === '') continue;

    button.addEventListener('click', () => {
      void copyText(command, 'Command').then((ok) => {
        if (hint !== null) hint.textContent = ok ? 'Copied' : 'Select it';
        button.dataset['copied'] = 'true';
        window.setTimeout(() => {
          if (hint !== null) hint.textContent = 'Copy';
          delete button.dataset['copied'];
        }, 1400);
      });
    });
  }
}

// ── Fluid cursor ──────────────────────────────────────────────────────────

/**
 * Mount the pointer fluid, if this visitor should have one at all.
 *
 * Loaded on demand rather than bundled into the landing entry: it is a
 * self-contained WebGL solver that most of the conditions below will decline to
 * run, and a visitor on a phone should not pay to download a simulation that
 * will never start.
 */
function fluidCursor(): void {
  const canvas = qs<HTMLCanvasElement>('[data-fluid-cursor]');
  if (canvas === null || reduced()) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  void import('./fluid-cursor').then(({ mountFluidCursor }) => {
    const fluid = mountFluidCursor(canvas);
    if (fluid === null) {
      canvas.remove();
      return;
    }
    window.addEventListener('pagehide', () => fluid.destroy());
  });
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

// ── 01 Hero field ─────────────────────────────────────────────────────────

/**
 * The decorative node lattice behind the hero.
 *
 * `mountConstellation` returns null under reduced motion and when the canvas is
 * unavailable; in both cases `data-on` stays "false" and CSS keeps the field
 * hidden, so the hero reads exactly as it does with the field running.
 */
function heroField(): void {
  const host = qs<HTMLElement>('#fs-l-field');
  if (host === null) return;
  mountConstellation(host);
}

// ── Liquid-metal CTA ──────────────────────────────────────────────────────

/**
 * The click ripple for `.fs-l-btn--metal` (docs/ui/button.md).
 *
 * The element stays an <a>: navigation is not intercepted, and the ripple is
 * removed on animation end rather than on a timer, so a slow frame cannot leave
 * one behind.
 */
function metalButtons(): void {
  for (const button of qsa<HTMLElement>('[data-metal]')) {
    button.addEventListener('pointerdown', (event) => {
      if (reduced()) return;
      const rect = button.getBoundingClientRect();
      const ripple = document.createElement('span');
      ripple.className = 'fs-l-btn__ripple';
      ripple.style.left = `${event.clientX - rect.left}px`;
      ripple.style.top = `${event.clientY - rect.top}px`;
      ripple.addEventListener('animationend', () => ripple.remove());
      button.appendChild(ripple);
    });
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────

document.documentElement.dataset['motion'] = reduced() ? 'off' : 'on';

nav();
reveals();
heroCommands();
fluidCursor();
heroField();
metalButtons();
logsToGraph();
failure();
replay();
