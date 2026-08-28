import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * Landing page choreography (DESIGN.md §28–§30).
 *
 * Four motion families, and nothing else:
 *   A flow            — a token travelling a drawn path
 *   B state           — allowed/denied, live/historical, step on/off
 *   C evidence        — a dot appearing and joining the Case Spine
 *   D scroll telling  — pinned scenes scrubbed against real recorded positions
 *
 * Two rules hold everywhere:
 *   1. Under `prefers-reduced-motion: reduce` no rAF loop starts and no pin is
 *      created (DESIGN.md §35). Every interactive control still works, and the
 *      page shows its end state.
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

/** Reads a `<script type="application/json">` payload rendered by a component. */
const payload = <T>(selector: string, root: ParentNode = document): T | null => {
  const node = qs<HTMLScriptElement>(selector, root);
  if (node === null || node.textContent === null) return null;
  try {
    return JSON.parse(node.textContent) as T;
  } catch {
    return null;
  }
};

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
  for (const element of qsa<HTMLElement>('[data-rise]')) {
    gsap.from(element, {
      opacity: 0,
      y: 18,
      duration: 0.62,
      ease: 'power3.out',
      scrollTrigger: { trigger: element, start: 'top 92%', once: true },
    });
  }
}

// ── 01 Hero ───────────────────────────────────────────────────────────────

function hero(): void {
  const section = qs<HTMLElement>('[data-hero]');
  if (section === null) return;

  if (!reduced()) {
    // DESIGN.md §16: distributed activity resolving into one governed Case.
    const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } });
    timeline
      .from('.fs-l-reveal > span', { yPercent: 110, duration: 0.8, stagger: 0.08 }, 0)
      .from(
        '[data-scene-part="nodes"] [data-node]',
        {
          opacity: 0,
          scale: 0.86,
          duration: 0.5,
          stagger: 0.05,
          transformOrigin: 'center',
        },
        0.3,
      )
      .from('[data-scene-part="plate"]', { opacity: 0, scale: 0.9, duration: 0.55 }, 0.7)
      .from('[data-scene-part="core"] circle', { opacity: 0, duration: 0.6 }, 0.85)
      .from('[data-edge]', { opacity: 0, duration: 0.5, stagger: 0.05 }, 1.0);
  }

  heroField(section);
}

/**
 * The evidence field (DESIGN.md §15, §37).
 *
 * One canvas, never one DOM node per particle. It runs only while the hero is on
 * screen, and never at all under reduced motion or on a phone.
 */
function heroField(section: HTMLElement): void {
  const canvas = qs<HTMLCanvasElement>('#fs-l-field', section);
  if (canvas === null || reduced() || window.innerWidth < 768) return;
  const context = canvas.getContext('2d', { alpha: true });
  if (context === null) return;

  interface Point {
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
  }

  let width = 0;
  let height = 0;
  let points: Point[] = [];
  let frame = 0;
  let running = false;

  const size = (): void => {
    const box = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(box.width));
    height = Math.max(1, Math.round(box.height));
    // DESIGN.md §37: cap DPR. A 3x buffer buys nothing at this contrast.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const seed = (): void => {
    // Fewer points on a weaker/narrower device, same visual density.
    const count = Math.round(Math.min(260, Math.max(90, (width * height) / 1500)));
    points = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.16,
      vy: (Math.random() - 0.5) * 0.16,
      r: Math.random() < 0.12 ? 1.6 : 0.9,
    }));
  };

  const tick = (): void => {
    context.clearRect(0, 0, width, height);
    const cx = width / 2;
    const cy = height / 2;

    for (const point of points) {
      // A slow bias toward the Case anchor: activity converging, not drifting.
      point.vx += (cx - point.x) * 0.0000075;
      point.vy += (cy - point.y) * 0.0000075;
      point.x += point.vx;
      point.y += point.vy;
      if (point.x < 0 || point.x > width) point.vx *= -1;
      if (point.y < 0 || point.y > height) point.vy *= -1;

      context.fillStyle = point.r > 1.2 ? 'rgba(9,9,9,0.5)' : 'rgba(9,9,9,0.26)';
      context.beginPath();
      context.arc(point.x, point.y, point.r, 0, Math.PI * 2);
      context.fill();
    }

    // Sparse blue connections only — the accent stays an accent (DESIGN.md §43).
    context.strokeStyle = 'rgba(36,72,255,0.16)';
    context.lineWidth = 1;
    for (let i = 0; i < points.length; i += 3) {
      const a = points[i];
      if (a === undefined) continue;
      for (let j = i + 3; j < points.length; j += 3) {
        const b = points[j];
        if (b === undefined) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy > 5200) continue;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
    }

    frame = requestAnimationFrame(tick);
  };

  const start = (): void => {
    if (running) return;
    running = true;
    frame = requestAnimationFrame(tick);
    canvas.dataset['on'] = 'true';
  };
  const stop = (): void => {
    if (!running) return;
    running = false;
    cancelAnimationFrame(frame);
    canvas.dataset['on'] = 'false';
  };

  size();
  seed();

  // DESIGN.md §37: no rAF loop survives the hero leaving the viewport.
  new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting === true) start();
      else stop();
    },
    { threshold: 0.01 },
  ).observe(section);

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      size();
      seed();
    });
  });
}

// ── 02 Sessions: a pinned scene (DESIGN.md §17) ───────────────────────────

function sessions(): void {
  const scene = qs<HTMLElement>('[data-pin-scene="sessions"]');
  if (scene === null) return;
  const panels = qsa<HTMLElement>('[data-session]', scene);
  if (panels.length === 0) return;

  const activate = (index: number): void => {
    panels.forEach((panel, i) => {
      panel.dataset['on'] = i <= index ? 'true' : 'false';
    });
  };
  activate(0);

  if (!canPin()) {
    activate(panels.length - 1);
    return;
  }

  ScrollTrigger.create({
    trigger: scene,
    start: 'top top',
    end: `+=${panels.length * 90}%`,
    pin: true,
    pinSpacing: true,
    anticipatePin: 1,
    scrub: true,
    onUpdate: (self) => activate(stepIndex(self.progress, panels.length)),
  });

  // The gap compresses as the scene advances; it never claims to be elapsed time.
  for (const gap of qsa<HTMLElement>('[data-gap]', scene)) {
    gsap.to(gap, {
      paddingTop: 8,
      paddingBottom: 8,
      ease: 'none',
      scrollTrigger: { trigger: scene, start: 'top top', end: '+=180%', scrub: true },
    });
  }

  spineFills(scene);
}

/** Family C: the spine fills as its events are reached. */
function spineFills(root: ParentNode): void {
  for (const fill of qsa<HTMLElement>('[data-spine-fill]', root)) {
    const parent = fill.parentElement;
    if (parent === null) continue;
    if (reduced()) {
      gsap.set(fill, { scaleY: 1 });
      continue;
    }
    gsap.fromTo(
      fill,
      { scaleY: 0 },
      {
        scaleY: 1,
        ease: 'none',
        scrollTrigger: { trigger: parent, start: 'top 78%', end: 'bottom 62%', scrub: true },
      },
    );
  }
}

// ── 03 Durable context: family A, one token crossing the wire ─────────────

function context(): void {
  const block = qs<HTMLElement>('[data-context]');
  const token = qs<HTMLElement>('[data-token]', block ?? document);
  if (block === null || token === null) return;
  const wire = token.parentElement;
  if (wire === null) return;

  if (reduced()) {
    gsap.set(token, { xPercent: 0, left: 'calc(100% - 22px)' });
    return;
  }

  gsap.fromTo(
    token,
    { x: 0, opacity: 0 },
    {
      x: () => wire.clientWidth - 34,
      opacity: 1,
      ease: 'power2.inOut',
      duration: 0.9,
      scrollTrigger: { trigger: block, start: 'top 70%', once: true },
    },
  );
}

// ── 04 Control boundaries (DESIGN.md §19) ─────────────────────────────────

interface GateState {
  key: string;
  passes: boolean;
}

function boundaries(): void {
  const grid = qs<HTMLElement>('[data-gates]');
  if (grid === null) return;
  const gates = qsa<HTMLElement>('[data-gate]', grid);
  if (gates.length === 0) return;

  for (const gate of gates) wireGate(gate);

  // One highlight box travels across the gates as scroll progresses.
  const highlight = (index: number): void => {
    gates.forEach((gate, i) => {
      gate.dataset['active'] = i === index ? 'true' : 'false';
    });
  };
  highlight(0);

  if (reduced()) return;
  ScrollTrigger.create({
    trigger: grid,
    start: 'top 78%',
    end: 'bottom 42%',
    scrub: true,
    onUpdate: (self) => highlight(stepIndex(self.progress, gates.length)),
  });
}

/**
 * Enforcement is drawn, not labelled: on a denial the downstream leg of the
 * corridor is removed and a stop mark takes its place.
 */
function wireGate(gate: HTMLElement): void {
  const buttons = qsa<HTMLButtonElement>('[data-corridor-state]', gate);
  const out = qs<SVGPathElement>('[data-flow="out"]', gate);
  const outHead = qs<SVGPathElement>('[data-flow="out-head"]', gate);
  const stop = qs<SVGGElement>('[data-flow="stop"]', gate);
  const target = qs<SVGRectElement>('[data-flow="target"]', gate);
  const targetText = qs<SVGTextElement>('[data-flow-target]', gate);
  const outcomeText = qs<SVGTextElement>('[data-flow-outcome]', gate);
  const pulse = qs<SVGCircleElement>('[data-flow-pulse]', gate);
  const evt = qs<HTMLElement>('[data-corridor-evt]', gate);
  const detail = qs<HTMLElement>('[data-corridor-detail]', gate);
  const policy = qs<HTMLElement>('[data-corridor-policy]', gate);

  const states = new Map<string, GateState>();
  for (const button of buttons) {
    const key = button.dataset['corridorState'];
    if (key === undefined) continue;
    states.set(key, { key, passes: key === 'allowed' || key === 'routed' });
  }

  const apply = (key: string): void => {
    const state = states.get(key);
    if (state === undefined) return;

    for (const button of buttons) {
      button.setAttribute(
        'aria-pressed',
        button.dataset['corridorState'] === key ? 'true' : 'false',
      );
    }
    for (const badge of qsa<HTMLElement>('[data-corridor-badge]', gate)) {
      badge.hidden = badge.dataset['corridorBadge'] !== key;
    }

    // The QA harness reads this inline opacity: a denial must visibly not pass.
    if (out !== null) out.style.opacity = state.passes ? '1' : '0';
    if (outHead !== null) outHead.style.opacity = state.passes ? '1' : '0';
    if (stop !== null) stop.style.opacity = state.passes ? '0' : '1';
    if (target !== null) target.style.opacity = state.passes ? '1' : '0.3';
    if (targetText !== null) targetText.style.opacity = state.passes ? '1' : '0.3';
    if (outcomeText !== null) outcomeText.textContent = key.toUpperCase();

    const source = gate.querySelector<HTMLScriptElement>(`[data-gate-state="${key}"]`);
    if (source !== null && source.textContent !== null) {
      const parsed = JSON.parse(source.textContent) as {
        eventId: string;
        detail: string;
        policy: string | null;
        target: string;
      };
      if (evt !== null) evt.textContent = parsed.eventId;
      if (detail !== null) detail.textContent = parsed.detail;
      if (policy !== null) policy.textContent = parsed.policy ?? '';
      if (targetText !== null) targetText.textContent = parsed.target.toUpperCase();
    }

    if (!reduced() && pulse !== null && state.passes) {
      gsap.fromTo(
        pulse,
        { attr: { cy: 34 }, opacity: 1 },
        { attr: { cy: 176 }, opacity: 0, duration: 0.6, ease: 'power2.out' },
      );
    }
  };

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const key = button.dataset['corridorState'];
      if (key !== undefined) apply(key);
    });
  }

  // Draw the initial outcome through the same path, so a gate whose only
  // recorded outcome is a denial never renders as a corridor that passes.
  const firstKey = buttons[0]?.dataset['corridorState'];
  if (firstKey !== undefined) apply(firstKey);
}

// ── 05 Governed recovery: a pinned scene (DESIGN.md §20) ──────────────────

function incident(): void {
  const scene = qs<HTMLElement>('[data-pin-scene="incident"]');
  if (scene === null) return;
  const steps = qsa<HTMLElement>('[data-warden-step]', scene);
  const groups = qsa<HTMLElement>('[data-term-group]', scene);
  if (steps.length === 0) return;

  const activate = (index: number): void => {
    steps.forEach((step, i) => {
      step.dataset['on'] = i <= index ? 'true' : 'false';
    });
    for (const group of groups) {
      const at = Number(group.dataset['termGroup'] ?? '0');
      group.dataset['on'] = at <= index ? 'true' : 'false';
    }
  };
  activate(0);

  if (!canPin()) {
    activate(steps.length - 1);
    return;
  }

  ScrollTrigger.create({
    trigger: scene,
    start: 'top top',
    end: `+=${steps.length * 60}%`,
    pin: true,
    pinSpacing: true,
    anticipatePin: 1,
    scrub: true,
    onUpdate: (self) => activate(stepIndex(self.progress, steps.length)),
  });
}

// ── 06 Replay: a pinned scene over recorded positions (DESIGN.md §21) ─────

interface ReplayPoint {
  seq: number;
  eventId: string;
  label: string;
  caseState: string;
  agents: number;
  memory: number;
  incidents: number;
  interventions: number;
  hash: string;
}

function replay(): void {
  const block = qs<HTMLElement>('[data-replay]');
  if (block === null) return;
  const frames = payload<ReplayPoint[]>('[data-replay-payload]', block);
  if (frames === null || frames.length === 0) return;

  const stage = qs<HTMLElement>('[data-replay-stage]', block);
  const input = qs<HTMLInputElement>('[data-replay-input]', block);
  const meta = qs<HTMLElement>('[data-replay-meta]', block);
  const hash = qs<HTMLElement>('[data-replay-hash]', block);
  const marks = qsa<HTMLButtonElement>('[data-replay-mark]', block);
  const last = frames.length - 1;
  let locked = false;

  const show = (index: number): void => {
    const point = frames[Math.min(last, Math.max(0, index))];
    if (point === undefined || stage === null) return;

    stage.dataset['historical'] = index < last ? 'true' : 'false';
    if (meta !== null) meta.textContent = `${point.eventId} · seq ${point.seq} · ${point.label}`;
    if (hash !== null) hash.textContent = point.hash;

    const counts: Record<string, number> = {
      agents: point.agents,
      memory: point.memory,
      incidents: point.incidents,
      interventions: point.interventions,
    };
    for (const node of qsa<HTMLElement>('[data-replay-count]', block)) {
      const key = node.dataset['replayCount'];
      const value = key === undefined ? undefined : counts[key];
      if (value !== undefined) node.textContent = String(value);
    }
    for (const badge of qsa<HTMLElement>('[data-replay-badge]', block)) {
      badge.hidden = badge.dataset['replayBadge'] !== point.caseState;
    }
    for (const mark of marks) {
      mark.dataset['on'] = Number(mark.dataset['replayMark'] ?? '-1') === index ? 'true' : 'false';
    }
    if (input !== null && input.valueAsNumber !== index) input.value = String(index);
  };

  input?.addEventListener('input', () => {
    locked = true;
    show(input.valueAsNumber);
  });
  for (const mark of marks) {
    mark.addEventListener('click', () => {
      locked = true;
      show(Number(mark.dataset['replayMark'] ?? last));
    });
  }

  show(last);

  const scene = qs<HTMLElement>('[data-pin-scene="replay"]');
  if (scene === null || !canPin()) return;

  ScrollTrigger.create({
    trigger: scene,
    start: 'top top',
    end: '+=220%',
    pin: true,
    pinSpacing: true,
    anticipatePin: 1,
    scrub: true,
    onUpdate: (self) => {
      // Scrolling rewinds: progress 0 is the terminal state, 1 is the earliest
      // recorded position. A direct selection wins and is never overridden.
      if (locked) return;
      show(last - stepIndex(self.progress, frames.length));
    },
  });
}

// ── 07 Evidence: one highlight travelling the rows (DESIGN.md §22) ────────

interface EvidencePoint {
  control: string;
  badge: string;
  decision: string;
  resource: string;
  policy: string;
  session: string;
  eventId: string;
  seq: number;
}

function evidence(): void {
  const block = qs<HTMLElement>('[data-evidence]');
  if (block === null) return;
  const rows = payload<EvidencePoint[]>('[data-ev-payload]', block);
  const buttons = qsa<HTMLButtonElement>('[data-ev-row]', block);
  if (rows === null || buttons.length === 0) return;
  let locked = false;

  const show = (index: number): void => {
    const row = rows[index];
    if (row === undefined) return;
    buttons.forEach((button, i) => {
      button.dataset['on'] = i === index ? 'true' : 'false';
    });
    const fields: Record<string, string> = {
      control: row.control,
      decision: row.decision,
      resource: row.resource,
      policy: row.policy,
      session: row.session,
      evt: row.eventId,
      seq: String(row.seq),
    };
    for (const node of qsa<HTMLElement>('[data-ev]', block)) {
      const key = node.dataset['ev'];
      const value = key === undefined ? undefined : fields[key];
      if (value !== undefined) node.textContent = value;
    }
    for (const badge of qsa<HTMLElement>('[data-ev-badge]', block)) {
      badge.hidden = badge.dataset['evBadge'] !== row.badge;
    }
  };

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => {
      locked = true;
      show(index);
    });
  });

  show(0);
  if (reduced()) return;

  ScrollTrigger.create({
    trigger: block,
    start: 'top 74%',
    end: 'bottom 48%',
    scrub: true,
    onUpdate: (self) => {
      if (locked) return;
      show(stepIndex(self.progress, buttons.length));
    },
  });
}

// ── 08 Cockpit: a pinned tablist over one persistent frame (§23, §24) ─────

function cockpit(): void {
  const block = qs<HTMLElement>('[data-cockpit]');
  if (block === null) return;
  const tabs = qsa<HTMLButtonElement>('[data-cockpit-tab]', block);
  if (tabs.length === 0) return;
  const cursor = qs<HTMLElement>('[data-ck-cursor]', block);
  const maxSeq = Math.max(1, ...tabs.map((tab) => Number(tab.dataset['seq'] ?? '0')));
  let locked = false;

  const show = (index: number): void => {
    const active = tabs[index];
    if (active === undefined) return;
    const key = active.dataset['cockpitTab'];

    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', i === index ? 'true' : 'false');
      tab.tabIndex = i === index ? 0 : -1;
    });
    for (const rail of qsa<HTMLElement>('[data-rail]', block)) {
      rail.dataset['on'] = rail.dataset['rail'] === key ? 'true' : 'false';
    }
    for (const state of qsa<HTMLElement>('[data-ck-state]', block)) {
      const on = state.dataset['ckState'] === key;
      state.hidden = !on;
      if (on && !reduced()) {
        gsap.fromTo(
          state,
          { opacity: 0, y: 16 },
          { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' },
        );
      }
    }
    if (cursor !== null) {
      cursor.style.left = `${Math.round((Number(active.dataset['seq'] ?? '0') / maxSeq) * 100)}%`;
    }
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      locked = true;
      show(index);
    });
    // A tablist that only responds to the pointer is not a tablist.
    tab.addEventListener('keydown', (event) => {
      const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (delta === 0) return;
      event.preventDefault();
      locked = true;
      const next = (index + delta + tabs.length) % tabs.length;
      show(next);
      tabs[next]?.focus();
    });
  });

  show(0);

  const scene = qs<HTMLElement>('[data-pin-scene="cockpit"]');
  if (scene === null || !canPin()) return;

  ScrollTrigger.create({
    trigger: scene,
    start: 'top top',
    end: `+=${tabs.length * 55}%`,
    pin: true,
    pinSpacing: true,
    anticipatePin: 1,
    scrub: true,
    onUpdate: (self) => {
      if (locked) return;
      show(stepIndex(self.progress, tabs.length));
    },
  });
}

// ── 09 Audit and 11 Final ─────────────────────────────────────────────────

function audit(): void {
  const spine = qs<HTMLElement>('[data-audit-spine]');
  if (spine === null) return;
  spineFills(spine.parentElement ?? document);
  if (reduced()) return;

  // Family C: each dot arrives, then stops. Nothing pulses forever (§28.3).
  gsap.from(qsa<HTMLElement>('[data-audit-node]', spine), {
    opacity: 0,
    x: -10,
    duration: 0.4,
    stagger: 0.045,
    ease: 'power2.out',
    scrollTrigger: { trigger: spine, start: 'top 80%', once: true },
  });
}

function final(): void {
  const section = qs<HTMLElement>('[data-final]');
  if (section === null || reduced()) return;
  gsap.from(qsa<SVGPathElement>('[data-ray]', section), {
    opacity: 0,
    duration: 0.5,
    stagger: 0.05,
    ease: 'power2.out',
    scrollTrigger: { trigger: section, start: 'top 76%', once: true },
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────

function boot(): void {
  // One flag the stylesheet can read, so CSS and script can never disagree
  // about whether the page is animating (DESIGN.md §35).
  document.documentElement.dataset['motion'] = reduced() ? 'off' : 'on';

  nav();
  hero();
  reveals();
  sessions();
  context();
  boundaries();
  incident();
  replay();
  evidence();
  cockpit();
  audit();
  final();

  ScrollTrigger.refresh();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
