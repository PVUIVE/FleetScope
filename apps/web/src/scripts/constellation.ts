/**
 * The hero field: an interactive node mesh behind the Execution Spine.
 *
 * Ported from the React `ConstellationGrid` reference in docs/ui/hero-page.md to
 * this codebase's stack — no React, no Tailwind, one canvas, zero new runtime
 * dependencies. The physics are the reference's: a spring-mass-damping lattice
 * (Hooke restoring force + velocity damping) that a fast cursor shockwaves.
 *
 * It is DECORATION and says so: `aria-hidden`, `pointer-events: none`, and it
 * draws nothing the page asserts. The evidence on this screen is the spine on
 * top of it, which is real recorded events.
 *
 * DESIGN.md §29 governs everything below the physics:
 *   - lazy initialize                → nothing runs until the hero is in view;
 *   - stop rendering off-viewport    → IntersectionObserver gates the rAF loop;
 *   - cap DPR                        → min(devicePixelRatio, 2);
 *   - fewer particles on weak devices→ spacing scales with area and DPR;
 *   - no DOM node per particle       → one canvas;
 *   - no permanent rAF below fold    → the loop is cancelled, not paused-in-place.
 *
 * DESIGN.md §35: under `prefers-reduced-motion: reduce` no loop is ever started
 * and the field stays hidden (CSS removes it), so the hero is fully legible with
 * nothing running.
 */

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly baseX: number;
  readonly baseY: number;
  readonly radius: number;
  /** Hex coordinate readout, drawn only within `LABEL_DISTANCE` of the cursor. */
  readonly label: string;
  pulse: number;
}

/** Hooke's law spring constant pulling a node back to its lattice anchor. */
const SPRING_K = 18;
/** Velocity retained per frame. Below 1 or the lattice never settles. */
const DAMPING = 0.82;
/** Cursor influence radius, in CSS pixels. */
const MOUSE_RADIUS = 220;
/** Nodes closer than this to the cursor get a radar ring and a coordinate. */
const LABEL_DISTANCE = 90;
/** Two nodes draw an edge below this separation. */
const MAX_CONN_DIST = 75;
/** Baseline lattice pitch. Scaled up on large or low-powered surfaces. */
const BASE_SPACING = 55;
/**
 * Ceiling on lattice size. A node costs a spring integration and a handful of
 * neighbour tests per frame; past this the hero stops being free.
 */
const MAX_NODES = 900;
/** Frame delta ceiling, so a backgrounded tab cannot explode the integrator. */
const MAX_DT = 0.05;

/**
 * Neighbour search radius in LATTICE CELLS, not pixels.
 *
 * The reference implementation compares every node against every other node —
 * O(n²), which is ~100k distance tests per frame at this density. The lattice is
 * regular and displacement is spring-bounded, so an edge can only form between
 * nodes within a couple of cells of each other. Two cells is comfortably beyond
 * `MAX_CONN_DIST` at any spacing this module chooses, and the cost becomes O(n).
 */
const NEIGHBOUR_CELLS = 2;

export interface ConstellationHandle {
  destroy(): void;
}

/**
 * Mount the field into `host`.
 *
 * Returns null when the field must not run at all: no 2D context, or the reader
 * asked for reduced motion. A null return is a normal outcome, not a failure —
 * the hero is designed to read correctly without it.
 */
export function mountConstellation(host: HTMLElement): ConstellationHandle | null {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  // The field sits under the headline and the CTAs. It must never take a click.
  canvas.style.cssText = 'position:absolute;inset:0;display:block;pointer-events:none';
  // `alpha: true` on purpose: the blueprint page paints its own background and
  // the field composites onto it. The reference filled an opaque colour because
  // it owned the whole screen; this one does not.
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  host.appendChild(canvas);

  const styles = getComputedStyle(document.documentElement);
  const readVar = (name: string, fallback: string): string => {
    const value = styles.getPropertyValue(name).trim();
    return value === '' ? fallback : value;
  };
  /** The lattice takes the page's own ink and accent, never its own palette. */
  const nodeRgb = hexToRgb(readVar('--fs-fg', '#090909'), '9, 9, 9');
  const accentRgb = hexToRgb(readVar('--fs-blue', '#2448ff'), '36, 72, 255');

  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let nodes: Node[] = [];
  let frame: number | null = null;
  let lastTime = 0;

  const mouse = { x: -1e4, y: -1e4, prevX: -1e4, prevY: -1e4, vx: 0, vy: 0 };

  const build = (): void => {
    const rect = host.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Widen the pitch until the lattice fits the budget, so a 4K hero costs the
    // same per frame as a laptop one (DESIGN.md §29).
    let spacing = BASE_SPACING;
    for (let guard = 0; guard < 8; guard += 1) {
      cols = Math.ceil(width / spacing) + 1;
      rows = Math.ceil(height / spacing) + 1;
      if (cols * rows <= MAX_NODES) break;
      spacing *= 1.25;
    }

    nodes = [];
    for (let i = 0; i < cols; i += 1) {
      for (let j = 0; j < rows; j += 1) {
        const x = i * spacing;
        const y = j * spacing;
        nodes.push({
          x,
          y,
          vx: 0,
          vy: 0,
          baseX: x,
          baseY: y,
          radius: 1.2 + ((i * 7 + j * 13) % 10) / 10,
          label: `${(i * 7).toString(16).toUpperCase()}:${(j * 11).toString(16).toUpperCase()}`,
          // Deterministic phase offset. Math.random() here would make two loads
          // of the same page differ, and this repo takes determinism seriously.
          pulse: ((i * 3 + j * 5) % 12) * ((Math.PI * 2) / 12),
        });
      }
    }
  };

  /** Column-major index, matching the build order above. */
  const at = (i: number, j: number): Node | undefined =>
    i < 0 || j < 0 || i >= cols || j >= rows ? undefined : nodes[i * rows + j];

  const render = (now: number): void => {
    const dt = Math.min((now - lastTime) / 1000, MAX_DT);
    lastTime = now;

    mouse.vx = (mouse.x - mouse.prevX) / (dt * 1000 || 1);
    mouse.vy = (mouse.y - mouse.prevY) / (dt * 1000 || 1);
    mouse.prevX = mouse.x;
    mouse.prevY = mouse.y;
    const speed = Math.hypot(mouse.vx, mouse.vy);

    ctx.clearRect(0, 0, width, height);

    for (const n of nodes) {
      n.pulse += dt * 3;

      const dx = mouse.x - n.x;
      const dy = mouse.y - n.y;
      const dist = Math.hypot(dx, dy);

      // Shockwave: impulse away from the cursor, scaled by how fast it moved.
      if (dist < MOUSE_RADIUS && dist > 0) {
        const force = (1 - dist / MOUSE_RADIUS) * (1500 + speed * 150);
        n.vx -= (dx / dist) * force * dt;
        n.vy -= (dy / dist) * force * dt;
      }

      n.vx += (n.baseX - n.x) * SPRING_K * dt;
      n.vy += (n.baseY - n.y) * SPRING_K * dt;
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx * dt * 60;
      n.y += n.vy * dt * 60;
    }

    // Edges. Forward-only neighbour walk, so each pair is considered once.
    ctx.lineWidth = 0.7;
    for (let i = 0; i < cols; i += 1) {
      for (let j = 0; j < rows; j += 1) {
        const n = at(i, j);
        if (n === undefined) continue;
        for (let di = 0; di <= NEIGHBOUR_CELLS; di += 1) {
          for (let dj = -NEIGHBOUR_CELLS; dj <= NEIGHBOUR_CELLS; dj += 1) {
            if (di === 0 && dj <= 0) continue;
            const other = at(i + di, j + dj);
            if (other === undefined) continue;
            const d = Math.hypot(n.x - other.x, n.y - other.y);
            if (d >= MAX_CONN_DIST) continue;
            ctx.strokeStyle = `rgba(${nodeRgb}, ${(1 - d / MAX_CONN_DIST) * 0.16})`;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(other.x, other.y);
            ctx.stroke();
          }
        }
      }
    }

    // Nodes, plus the radar ring and coordinate readout near the cursor.
    ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    for (const n of nodes) {
      const dist = Math.hypot(mouse.x - n.x, mouse.y - n.y);
      const near = dist < MOUSE_RADIUS;
      const alpha = near ? 0.9 : 0.22 + Math.sin(n.pulse) * 0.08;

      ctx.fillStyle = near ? `rgba(${accentRgb}, ${alpha})` : `rgba(${nodeRgb}, ${alpha})`;
      const radius = near ? n.radius * 2.2 : n.radius + Math.sin(n.pulse) * 0.3;
      ctx.beginPath();
      ctx.arc(n.x, n.y, Math.max(0.5, radius), 0, Math.PI * 2);
      ctx.fill();

      if (dist < LABEL_DISTANCE) {
        const ring = ((n.pulse * 20) % 30) + 4;
        ctx.strokeStyle = `rgba(${accentRgb}, ${(1 - ring / 34) * 0.4})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, ring, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(${accentRgb}, 0.85)`;
        ctx.fillText(n.label, n.x + 10, n.y - 10);
        ctx.lineWidth = 0.7;
      }
    }

    frame = requestAnimationFrame(render);
  };

  const start = (): void => {
    if (frame !== null) return;
    lastTime = performance.now();
    frame = requestAnimationFrame(render);
    host.dataset['on'] = 'true';
  };

  const stop = (): void => {
    if (frame === null) return;
    cancelAnimationFrame(frame);
    frame = null;
  };

  const onPointerMove = (event: PointerEvent): void => {
    const rect = host.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
  };
  const onPointerLeave = (): void => {
    mouse.x = -1e4;
    mouse.y = -1e4;
  };

  build();

  // Lazy init and off-viewport stop, together: the loop exists only while the
  // hero is on screen (DESIGN.md §29).
  const visibility = new IntersectionObserver(
    ([entry]) => (entry?.isIntersecting === true ? start() : stop()),
    { rootMargin: '120px' },
  );
  visibility.observe(host);

  const resize = new ResizeObserver(() => build());
  resize.observe(host);

  // The cursor is tracked on the window, not the canvas: the canvas takes no
  // pointer events, and the shockwave should still follow a cursor crossing the
  // headline or the spine.
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerleave', onPointerLeave);

  return {
    destroy(): void {
      stop();
      visibility.disconnect();
      resize.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      canvas.remove();
    },
  };
}

/** `#rrggbb` → `"r, g, b"`. Falls back rather than drawing an invisible field. */
function hexToRgb(hex: string, fallback: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) return fallback;
  const value = Number.parseInt(match[1]!, 16);
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}
