/**
 * Presentation helpers shared by the session list and the Agent Viewer.
 *
 * The rule every function here enforces: an UNKNOWN value renders as the word
 * "Unknown", never as `0`, never as an empty string, and never as a guess. A
 * developer reading "0 ms" believes something took no time; reading "Unknown"
 * they know FleetScope never observed it.
 */
export const UNKNOWN = 'Unknown';

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return UNKNOWN;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} sec`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} min ${Math.round((ms % 60_000) / 1000)} sec`;
}

export function formatCount(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return UNKNOWN;
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

/** Wall-clock time of day, to milliseconds. The timeline's left column. */
export function formatClock(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return UNKNOWN;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return UNKNOWN;
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`;
}

/** Offset from the session start, which is what makes a run readable. */
export function formatOffset(iso: string, startIso: string | null): string {
  if (startIso === null) return formatClock(iso);
  const delta = Date.parse(iso) - Date.parse(startIso);
  if (!Number.isFinite(delta) || delta < 0) return formatClock(iso);
  const totalSeconds = Math.floor(delta / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = delta % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** Relative age for the session list. */
export function formatAgo(iso: string | null, now = Date.now()): string {
  if (iso === null) return UNKNOWN;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return UNKNOWN;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

/** Status vocabulary. Never colour alone: each pairs a glyph with a word. */
export const STATUS_GLYPH: Readonly<Record<string, string>> = {
  running: '●',
  completed: '✓',
  failed: '!',
};

export const STATUS_LABEL: Readonly<Record<string, string>> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

/** The timeline category shown in the gutter. */
export const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  session: 'SESSION',
  agent: 'AGENT',
  model: 'MODEL',
  tool: 'TOOL',
  handoff: 'HANDOFF',
  error: 'ERROR',
};
