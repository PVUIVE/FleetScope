import { parseCanonicalEventsJsonl } from '@fleetscope/event-schema';
import { buildAgentTree, projectViewerEvents, summarizeSession } from '@fleetscope/viewer';
import type { ViewerAgent, ViewerEvent, ViewerSession } from '@fleetscope/viewer';

/**
 * Everything the landing page claims, derived from a REAL recorded run.
 *
 * The landing page is the one surface a visitor sees before the product, which
 * is exactly why nothing on it may be typed by hand: a page that overstates
 * what FleetScope captured is the one bug this product cannot ship. Every
 * figure, agent name, tool name, duration and error class below is read at
 * BUILD time out of `packages/fixtures/sessions/vendor-onboarding` — a real
 * Google ADK 1.20.0 invocation against Gemini, captured through the real
 * plugin. Change the recording and the page changes with it.
 *
 * When the recording does not contain something the page wants to say, the page
 * does not say it: the field is `null` and the component renders nothing.
 *
 * Loaded through `import.meta.glob(..., { eager: true })` rather than `fs`, the
 * same way every other fixture in this app is: the resolution happens at build
 * time, so the page needs no filesystem at render time and no network ever.
 */

/** The golden recording. One slug, so a second one is an explicit decision. */
const GOLDEN_SESSION = 'vendor-onboarding';

interface RecordedSessionMeta {
  readonly sessionId: string;
  readonly name: string;
  readonly framework: string;
  readonly frameworkVersion: string;
  readonly model: string | null;
  readonly recordedAt: string;
  readonly provenance: string;
}

const metaFiles = import.meta.glob<{ default: RecordedSessionMeta }>(
  '../../../../packages/fixtures/sessions/*/session.json',
  { eager: true },
);
const eventFiles = import.meta.glob<string>(
  '../../../../packages/fixtures/sessions/*/canonical-events.jsonl',
  { eager: true, query: '?raw', import: 'default' },
);

const bySlug = <T>(files: Record<string, T>): Map<string, T> =>
  new Map(Object.entries(files).map(([path, value]) => [path.split('/').at(-2) ?? path, value]));

export interface LandingData {
  readonly sessionId: string;
  readonly name: string;
  readonly framework: string;
  readonly frameworkVersion: string;
  readonly provenance: string;
  readonly session: ViewerSession;
  readonly agents: readonly ViewerAgent[];
  readonly rows: readonly ViewerEvent[];
  /** The raw framework event names the developer would otherwise read in a log. */
  readonly rawLogLines: readonly string[];
  /** One representative row per execution kind, for the "every call" section. */
  readonly highlights: {
    readonly model: ViewerEvent | null;
    readonly tool: ViewerEvent | null;
    readonly handoff: ViewerEvent | null;
    readonly failure: ViewerEvent | null;
  };
  /** The rows immediately around the failure — the context section. */
  readonly failureContext: readonly ViewerEvent[];
  /** A compact spine of the run, for the replay section. */
  readonly spine: readonly ViewerEvent[];
}

export function landingSession(): LandingData {
  const meta = bySlug(metaFiles).get(GOLDEN_SESSION)?.default;
  const raw = bySlug(eventFiles).get(GOLDEN_SESSION);
  if (meta === undefined || raw === undefined) {
    throw new Error(`recorded session "${GOLDEN_SESSION}" is missing from packages/fixtures`);
  }
  const { events, failures } = parseCanonicalEventsJsonl(raw);
  // A fixture that does not parse is a build break, never a page that quietly
  // prints fewer events than it recorded.
  if (failures.length > 0) {
    throw new Error(
      `recorded session "${GOLDEN_SESSION}" has ${failures.length} invalid line(s): ` +
        failures.map((f) => `line ${f.line}: ${f.problem}`).join('; '),
    );
  }
  const rows = projectViewerEvents(events);
  const agents = buildAgentTree(events, rows);
  const session = summarizeSession(meta.sessionId, meta.name, meta.framework, events, rows);

  const failureIndex = rows.findIndex((row) => row.type === 'error' || row.type === 'tool.failed');
  const failure = failureIndex === -1 ? null : (rows[failureIndex] ?? null);

  return {
    sessionId: meta.sessionId,
    name: meta.name,
    framework: meta.framework,
    frameworkVersion: meta.frameworkVersion,
    provenance: meta.provenance,
    session,
    agents,
    rows,
    // The canonical type names, which is genuinely what an unaided developer
    // would be reading. Deduplicated in order so the column stays scannable.
    rawLogLines: [...new Set(events.map((event) => event.type))],
    highlights: {
      model: rows.find((row) => row.type === 'model.completed') ?? null,
      tool: rows.find((row) => row.type === 'tool.completed') ?? null,
      handoff: rows.find((row) => row.type === 'agent.handoff') ?? null,
      failure,
    },
    failureContext:
      failureIndex === -1 ? [] : rows.slice(Math.max(0, failureIndex - 2), failureIndex + 3),
    spine: spineOf(rows),
  };
}

/**
 * The run reduced to the moments worth naming.
 *
 * Starts, handoffs, failures and the terminal event. Model and tool completions
 * are included because they are what a developer scans for; the rest are
 * bookkeeping the timeline shows in full.
 */
function spineOf(rows: readonly ViewerEvent[]): ViewerEvent[] {
  const wanted = new Set<ViewerEvent['type']>([
    'session.started',
    'model.completed',
    'tool.completed',
    'tool.failed',
    'agent.handoff',
    'error',
    'session.completed',
  ]);
  return rows.filter((row) => wanted.has(row.type));
}
