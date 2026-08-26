import { parseCanonicalEvent, type CanonicalEvent } from './canonical-event.js';

/**
 * JSONL is the on-disk fixture format: one Canonical Event per line, in
 * canonical Case order. It stays diffable in review and streams without a parser
 * holding the whole Case in memory.
 */
export interface JsonlParseFailure {
  readonly line: number;
  readonly problem: string;
}

export function parseCanonicalEventsJsonl(text: string): {
  events: CanonicalEvent[];
  failures: JsonlParseFailure[];
} {
  const events: CanonicalEvent[] = [];
  const failures: JsonlParseFailure[] = [];

  const lines = text.split('\n');
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//')) continue;

    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (error) {
      failures.push({ line: index + 1, problem: `invalid JSON: ${(error as Error).message}` });
      continue;
    }

    const parsed = parseCanonicalEvent(json);
    if (!parsed.success) {
      failures.push({
        line: index + 1,
        problem: parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
          .join('; '),
      });
      continue;
    }
    events.push(parsed.data);
  }

  return { events, failures };
}

export function serializeCanonicalEventsJsonl(events: readonly CanonicalEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n') + '\n';
}
