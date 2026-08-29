import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseRunRecord, type RunRecord } from './record.js';

export type LoadResult =
  | { readonly ok: true; readonly records: readonly RunRecord[] }
  | { readonly ok: false; readonly reason: string };
export type AppendResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface RunStore {
  load(): LoadResult;
  append(record: RunRecord): AppendResult;
}

/**
 * Local, append-only JSONL durability. This deliberately has a single-process
 * boundary; a future multi-process worker must introduce a real lock/DB.
 */
export class FileRunStore implements RunStore {
  constructor(private readonly path: string) {}

  load(): LoadResult {
    try {
      if (!existsSync(this.path)) return { ok: true, records: [] };
      const text = readFileSync(this.path, 'utf8');
      const records: RunRecord[] = [];
      for (const [index, line] of text.split('\n').entries()) {
        if (line.trim() === '') continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return { ok: false, reason: `invalid JSONL at line ${index + 1}` };
        }
        const record = parseRunRecord(parsed);
        if (record === null)
          return { ok: false, reason: `invalid run record at line ${index + 1}` };
        records.push(record);
      }
      return { ok: true, records };
    } catch (error) {
      return { ok: false, reason: `could not read run ledger: ${(error as Error).message}` };
    }
  }

  append(record: RunRecord): AppendResult {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, `${JSON.stringify(record)}\n`, 'utf8');
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: `durability lost: ${(error as Error).message}` };
    }
  }
}

export class MemoryRunStore implements RunStore {
  readonly records: RunRecord[];
  constructor(
    records: RunRecord[] = [],
    private readonly failAppend = false,
  ) {
    this.records = [...records];
  }
  load(): LoadResult {
    return { ok: true, records: this.records };
  }
  append(record: RunRecord): AppendResult {
    if (this.failAppend) return { ok: false, reason: 'durability lost: injected append failure' };
    this.records.push(record);
    return { ok: true };
  }
}
