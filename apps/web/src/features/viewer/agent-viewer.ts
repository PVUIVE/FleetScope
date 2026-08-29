import {
  acceptEvents,
  caseId as toCaseId,
  createCaseCursor,
  returnToLive,
  seekCursor,
  type CaseCursorState,
} from '@fleetscope/domain';
import type { CanonicalEvent } from '@fleetscope/event-schema';
import { compileZoetropeScene, type ZoetropeScene } from '@fleetscope/scenario-compiler';
import {
  buildAgentTree,
  projectViewerEvents,
  summarizeSession,
  type ViewerAgent,
  type ViewerEvent,
  type ViewerSession,
} from '@fleetscope/viewer';
import { createCockpit, type CockpitAdapter } from '../cockpit/lib/cockpit-adapter';
import { fetchSessionDetail, sessionIdFromLocation, subscribe } from '../../lib/local-api';
import {
  CATEGORY_LABEL,
  STATUS_GLYPH,
  STATUS_LABEL,
  formatDuration,
  formatOffset,
} from '../../lib/format';
import { mountDetailsDrawer, type DetailsDrawer } from './details-drawer';
import { renderDetails } from './details';
import { loadRendererGlue } from './renderer-glue';
import { sceneDelta } from './scene-delta';

/**
 * The Agent Viewer.
 *
 * The most important screen in the product, and the one place graph, timeline,
 * agent tree and details are kept in step. Four rules hold it together:
 *
 * 1. **The canonical stream is the state.** Everything on screen is derived
 *    from it. Nothing is stored twice, so nothing can disagree.
 * 2. **Historical inspection is side-effect free.** Moving the cursor changes
 *    only what is projected — no model call, no tool call, no request of any
 *    kind. It is pure re-derivation from a prefix that is already on the client.
 * 3. **Live never yanks the view.** New evidence arriving while the developer
 *    is parked in the past moves the high-water mark and the unread count, and
 *    leaves the cursor exactly where they put it.
 * 4. **Cursor translation always goes through the Render Manifest**, never
 *    `sequence / total`. One event may render as zero entries or as several.
 */

interface State {
  sessionId: string;
  sessionName: string;
  events: CanonicalEvent[];
  rows: ViewerEvent[];
  agents: ViewerAgent[];
  session: ViewerSession | null;
  scene: ZoetropeScene | null;
  cursor: CaseCursorState;
  selectedSequence: number | null;
  focusedAgent: string | null;
  cockpit: CockpitAdapter | null;
  /** Owns whether the details panel is a column or a dialog. See details-drawer.ts. */
  drawer: DetailsDrawer | null;
  /**
   * Timestamp until which renderer-driven cursor changes are ignored.
   *
   * The renderer settles asynchronously: a seek animates, and an append at the
   * live edge shifts its timeline. Both move `rendererEntryIndex` for reasons
   * that are NOT the developer scrubbing, and adopting those would drag the
   * cursor off the event they opened. Outside this window an index change can
   * only have come from the canvas, so it is adopted.
   */
  adoptRendererAfter: number;
}

/**
 * How long the renderer is given to settle after FleetScope moved it.
 *
 * Covers the seek animation and the timeline shift an append causes. Long
 * enough that neither is mistaken for the developer scrubbing; short enough
 * that a real scrub a moment later is still picked up.
 */
const RENDERER_SETTLE_MS = 700;

const $ = <T extends HTMLElement>(selector: string): T | null =>
  document.querySelector<T>(selector);

export async function mountAgentViewer(): Promise<void> {
  const sessionId = sessionIdFromLocation(window.location.pathname);
  const missing = $('[data-viewer-missing]');
  const shell = $('[data-viewer-shell]');

  if (sessionId === null) {
    if (missing !== null) missing.hidden = false;
    if (shell !== null) shell.hidden = true;
    return;
  }

  const state: State = {
    sessionId,
    sessionName: sessionId,
    events: [],
    rows: [],
    agents: [],
    session: null,
    scene: null,
    cursor: createCaseCursor(toCaseId(sessionId), []),
    selectedSequence: null,
    focusedAgent: null,
    cockpit: null,
    drawer: mountDetailsDrawer(),
    adoptRendererAfter: 0,
  };

  try {
    const detail = await fetchSessionDetail(sessionId);
    state.events = [...detail.events];
    state.sessionName = detail.session.name;
  } catch {
    if (missing !== null) {
      missing.hidden = false;
      missing.textContent =
        `Session ${sessionId} was not found in the local store. It may not have started yet, ` +
        'or FleetScope was restarted with a different --storage.';
    }
    if (shell !== null) shell.hidden = true;
    return;
  }

  recompute(state);
  state.cursor = createCaseCursor(toCaseId(sessionId), sequencesOf(state));
  paint(state);

  await mountRenderer(state);
  wire(state);

  const stop = subscribe(
    `/api/sessions/${encodeURIComponent(sessionId)}/events/stream?after=${lastSequence(state)}`,
    'events',
    (data) => {
      const payload = data as { events?: CanonicalEvent[] };
      if (!Array.isArray(payload.events) || payload.events.length === 0) return;
      appendEvents(state, payload.events);
    },
  );
  window.addEventListener('pagehide', stop);
}

// ── state derivation ─────────────────────────────────────────────────────────

const sequencesOf = (state: State): number[] => state.events.map((event) => event.caseSequence);

const lastSequence = (state: State): number =>
  state.events.length === 0 ? -1 : state.events[state.events.length - 1]!.caseSequence;

/** Re-derive every projection from the canonical stream. */
function recompute(state: State): void {
  state.rows = projectViewerEvents(state.events);
  state.agents = buildAgentTree(state.events, state.rows);
  state.session = summarizeSession(
    state.sessionId,
    state.sessionName,
    'google-adk',
    state.events,
    state.rows,
  );
}

function appendEvents(state: State, incoming: readonly CanonicalEvent[]): void {
  const known = new Set(state.events.map((event) => event.eventId));
  const fresh = incoming.filter((event) => !known.has(event.eventId));
  if (fresh.length === 0) return;

  state.events = [...state.events, ...fresh].sort((a, b) => a.caseSequence - b.caseSequence);
  recompute(state);

  // The cursor's own rule: at the edge it follows; parked in the past it does
  // not move, and the unread count grows instead.
  state.cursor = acceptEvents(state.cursor, sequencesOf(state));

  growScene(state);
  paint(state);
}

// ── renderer ─────────────────────────────────────────────────────────────────

async function mountRenderer(state: State): Promise<void> {
  const fallback = $('[data-graph-fallback]');
  if (state.events.length === 0) {
    if (fallback !== null) fallback.textContent = 'Waiting for the first event…';
    return;
  }

  try {
    await loadRendererGlue();
  } catch (error) {
    degrade(fallback, error instanceof Error ? error.message : 'unknown error');
    return;
  }

  const cockpit = createCockpit();
  if (!cockpit.available) {
    degrade(fallback, cockpit.unavailableReason ?? 'the renderer is unavailable');
    return;
  }

  const scene = compileZoetropeScene(state.events);
  try {
    cockpit.load(scene.main, JSON.stringify(scene.subagents), JSON.stringify(scene.manifest));
  } catch (error) {
    // A load that the Rust side refuses is a real inconsistency, not something
    // to paper over: say so, and leave the timeline — which is independent of
    // the renderer — fully usable.
    degrade(fallback, error instanceof Error ? error.message : 'the scene could not be loaded');
    return;
  }

  state.cockpit = cockpit;
  state.scene = scene;
  fallback?.remove();

  // The renderer has its own transport: the developer can scrub inside the
  // canvas. Follow it rather than assuming the DOM is the only thing that moves
  // — but only outside the settling window, so the renderer's own animation and
  // its live appends cannot drag the cursor off a deliberately opened event.
  let lastRendererIndex = -1;
  const follow = (): void => {
    // A hidden tab has nobody to keep in step. `requestAnimationFrame` already
    // throttles hard when backgrounded, but reading a wasm snapshot and parsing
    // its JSON on every one of those frames is work with no reader.
    if (document.hidden) {
      requestAnimationFrame(follow);
      return;
    }
    const snapshot = cockpit.snapshot();
    if (snapshot !== null && snapshot.rendererEntryIndex !== lastRendererIndex) {
      lastRendererIndex = snapshot.rendererEntryIndex;
      if (performance.now() >= state.adoptRendererAfter) {
        const entry = cockpit.currentEvent();
        if (entry !== null) select(state, entry.caseSequence, { seekRenderer: false });
      }
    }
    requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
}

function degrade(fallback: HTMLElement | null, reason: string): void {
  if (fallback === null) return;
  fallback.textContent =
    `The execution graph could not be rendered (${reason}). ` +
    'The timeline and the event details below are complete and unaffected.';
}

/** Append the newly compiled tail to the renderer, manifest delta included. */
function growScene(state: State): void {
  if (state.cockpit === null) return;
  const next = compileZoetropeScene(state.events);
  const delta = sceneDelta(state.scene, next);
  state.scene = next;
  if (delta.isEmpty) return;
  try {
    state.adoptRendererAfter = performance.now() + RENDERER_SETTLE_MS;
    state.cockpit.append(
      delta.mainTail,
      JSON.stringify(delta.subagents),
      JSON.stringify(delta.entries),
    );
    // An append grows the timeline the seek fraction was resolved against, so a
    // held position has to be re-asserted or the graph drifts off the row the
    // timeline is highlighting.
    if (state.selectedSequence !== null) {
      state.cockpit.seekToCaseSequence(state.selectedSequence);
    }
  } catch {
    // A refused append means the renderer and the manifest would have gone out
    // of step. Stop feeding it rather than let it drift; the timeline is intact.
    state.cockpit = null;
  }
}

// ── interaction ──────────────────────────────────────────────────────────────

function wire(state: State): void {
  $('[data-timeline-rows]')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-sequence]');
    if (button === null) return;
    select(state, Number(button.dataset['sequence']), { explicit: true });
  });

  $('[data-agent-tree]')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-agent-id]');
    if (button === null) return;
    const id = button.dataset['agentId'] ?? null;
    state.focusedAgent = state.focusedAgent === id ? null : id;
    if (state.focusedAgent !== null) {
      // Move the cursor to that agent's last recorded action. Selecting a node
      // inside the renderer is optional in the ABI; the cursor move is real.
      const last = [...state.rows].reverse().find((row) => row.agentId === state.focusedAgent);
      state.cockpit?.select(state.focusedAgent);
      if (last !== undefined) select(state, last.sequence, { explicit: true });
    }
    paint(state);
  });

  $('[data-return-live]')?.addEventListener('click', () => {
    state.cursor = returnToLive(state.cursor, sequencesOf(state));
    state.selectedSequence = null;
    state.cockpit?.goLive();
    paint(state);
  });

  $('[data-jump-failure]')?.addEventListener('click', () => {
    const failure = state.rows.find((row) => row.type === 'error' || row.type === 'tool.failed');
    if (failure !== undefined) select(state, failure.sequence, { explicit: true });
  });

  document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return;
    // While the panel is a dialog it owns its own keys, Escape included.
    if (event.target instanceof HTMLElement && event.target.closest('[data-details-pane]') !== null)
      return;
    const ordered = visibleRows(state);
    if (ordered.length === 0) return;
    const index = ordered.findIndex((row) => row.sequence === state.selectedSequence);
    if (event.key === 'ArrowDown' || event.key === 'j') {
      event.preventDefault();
      select(state, ordered[Math.min(ordered.length - 1, index + 1)]!.sequence);
    } else if (event.key === 'ArrowUp' || event.key === 'k') {
      event.preventDefault();
      select(state, ordered[Math.max(0, index <= 0 ? 0 : index - 1)]!.sequence);
    } else if (event.key === 'End') {
      event.preventDefault();
      state.cursor = returnToLive(state.cursor, sequencesOf(state));
      state.selectedSequence = null;
      state.cockpit?.goLive();
      paint(state);
    }
  });
}

/**
 * Park the cursor on one Canonical Event.
 *
 * This is the ONLY function that moves the cursor, so "graph, timeline and
 * details agree" is a property of one code path rather than of three that must
 * be kept in sync. It performs no I/O whatsoever.
 */
function select(
  state: State,
  sequence: number,
  options: { seekRenderer?: boolean; explicit?: boolean } = {},
): void {
  if (!Number.isFinite(sequence)) return;
  state.selectedSequence = sequence;
  state.cursor = seekCursor(state.cursor, sequencesOf(state), sequence);
  if (options.seekRenderer !== false) {
    state.adoptRendererAfter = performance.now() + RENDERER_SETTLE_MS;
    state.cockpit?.seekToCaseSequence(sequence);
  }
  // Asking for an event is what reveals the panel. Merely stepping past one is
  // not: on a narrow screen the panel covers the timeline being stepped.
  state.drawer?.show(options.explicit === true);
  paint(state);
}

const visibleRows = (state: State): ViewerEvent[] =>
  state.focusedAgent === null
    ? state.rows
    : state.rows.filter((row) => row.agentId === state.focusedAgent);

// ── painting ─────────────────────────────────────────────────────────────────

function paint(state: State): void {
  paintHeader(state);
  paintAgents(state);
  paintTimeline(state);
  paintDetails(state);
}

function paintHeader(state: State): void {
  const summary = state.session;
  if (summary === null) return;

  setText('[data-session-name]', summary.name);

  const historical = !state.cursor.atEdge;
  const live = summary.status === 'running' && !historical;

  const transport = $('[data-transport]');
  if (transport !== null) {
    transport.dataset['historical'] = String(historical);
    transport.dataset['live'] = String(live);
    const label = transport.querySelector('[data-transport-label]');
    if (label !== null) {
      label.textContent = historical
        ? 'HISTORICAL'
        : summary.status === 'running'
          ? 'LIVE'
          : (STATUS_LABEL[summary.status] ?? summary.status);
    }
  }

  const banner = $('[data-historical-banner]');
  if (banner !== null) banner.hidden = !historical;
  const unread = $('[data-unread]');
  if (unread !== null) {
    unread.textContent =
      state.cursor.canonicalUnread > 0 ? `+${state.cursor.canonicalUnread} new events` : '';
  }
  const returnLive = $('[data-return-live]');
  if (returnLive !== null) returnLive.hidden = !historical;

  setText('[data-stat-duration]', formatDuration(elapsed(summary)));
  setText('[data-stat-events]', `${summary.eventCount} events`);
  const errors = $('[data-stat-errors]');
  if (errors !== null) {
    errors.textContent =
      summary.errorCount === 0
        ? 'No failures'
        : `${summary.errorCount} failure${summary.errorCount === 1 ? '' : 's'}`;
    // The failure count is why this screen gets opened. It reads as a failure
    // count, not as one more grey number in a row of grey numbers.
    if (summary.errorCount === 0) delete errors.dataset['tone'];
    else errors.dataset['tone'] = 'danger';
  }
  const jump = $('[data-jump-failure]');
  if (jump !== null) jump.hidden = summary.errorCount === 0;
  setText(
    '[data-stat-model]',
    summary.models.length === 0 ? 'Model unknown' : summary.models.join(', '),
  );
}

function elapsed(summary: ViewerSession): number | null {
  if (summary.startedAt === null) return null;
  if (summary.endedAt !== null) return summary.durationMs;
  return Date.now() - Date.parse(summary.startedAt);
}

function setText(selector: string, value: string): void {
  const node = $(selector);
  if (node !== null) node.textContent = value;
}

function paintAgents(state: State): void {
  const list = $('[data-agent-tree]');
  if (list === null) return;
  list.replaceChildren();

  for (const agent of state.agents) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fs-agent';
    button.dataset['agentId'] = agent.id;
    button.dataset['status'] = agent.status;
    button.setAttribute('aria-pressed', String(state.focusedAgent === agent.id));
    button.style.paddingLeft = `${12 + agent.depth * 14}px`;

    const name = document.createElement('span');
    name.className = 'fs-agent__name';
    const glyph = document.createElement('span');
    glyph.className = 'fs-agent__status';
    glyph.textContent = STATUS_GLYPH[agent.status] ?? '?';
    glyph.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = agent.name;
    name.append(glyph, label);
    if (agent.errorCount > 0) {
      const errors = document.createElement('span');
      errors.className = 'fs-agent__errors';
      errors.textContent = `${agent.errorCount} failed`;
      name.append(errors);
    }

    const last = document.createElement('span');
    last.className = 'fs-agent__last';
    // The status word accompanies the glyph so the tree survives monochrome.
    last.textContent = `${STATUS_LABEL[agent.status] ?? agent.status} · ${agent.lastAction ?? 'no action recorded'}`;

    button.append(name, last);
    item.append(button);
    list.append(item);
  }
}

function paintTimeline(state: State): void {
  const rows = $('[data-timeline-rows]');
  if (rows === null) return;

  const start = state.session?.startedAt ?? null;
  const selected = state.selectedSequence ?? state.cursor.eventCursor;
  rows.replaceChildren();

  for (const row of state.rows) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fs-event';
    button.dataset['sequence'] = String(row.sequence);
    button.dataset['category'] = row.category;
    // Focusing an agent DIMS the rest rather than hiding it: the developer
    // still needs to see what happened around the branch they are reading.
    button.dataset['dimmed'] = String(
      state.focusedAgent !== null && row.agentId !== state.focusedAgent,
    );
    button.setAttribute('aria-current', String(row.sequence === selected));

    const time = document.createElement('span');
    time.className = 'fs-event__time';
    time.textContent = formatOffset(row.timestamp, start);

    const category = document.createElement('span');
    category.className = 'fs-event__category';
    category.textContent = CATEGORY_LABEL[row.category] ?? row.category.toUpperCase();

    const label = document.createElement('span');
    label.className = 'fs-event__label';
    label.textContent = row.label;
    if (row.agentId !== null) {
      const agent = document.createElement('span');
      agent.className = 'fs-event__agent';
      agent.textContent = `  ${row.agentId}`;
      label.append(agent);
    }

    const duration = document.createElement('span');
    duration.className = 'fs-event__duration';
    duration.textContent = row.durationMs === null ? '' : formatDuration(row.durationMs);

    button.append(time, category, label, duration);
    item.append(button);
    rows.append(item);
  }

  // Follow the live edge only while the developer is actually at it.
  if (state.cursor.atEdge) rows.scrollTop = rows.scrollHeight;
  else rows.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
}

function paintDetails(state: State): void {
  const pane = $('[data-details]');
  if (pane === null) return;
  const sequence = state.selectedSequence;
  const row = sequence === null ? null : (state.rows.find((r) => r.sequence === sequence) ?? null);
  const event =
    sequence === null ? null : (state.events.find((e) => e.caseSequence === sequence) ?? null);
  renderDetails(pane, row, event);
}
