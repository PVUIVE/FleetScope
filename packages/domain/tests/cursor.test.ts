import { describe, expect, it } from 'vitest';
import {
  acceptEvents,
  canonicalUnreadFor,
  caseId,
  createCaseCursor,
  cursorMode,
  returnToLive,
  seekCursor,
} from '../src/index.js';

const CASE = caseId('CASE-1042');
const dense = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('the Event Cursor opens at the live edge', () => {
  it('parks on the highest accepted event with nothing unread', () => {
    const cursor = createCaseCursor(CASE, dense(60));
    expect(cursor.eventCursor).toBe(59);
    expect(cursor.caseHighWaterMark).toBe(59);
    expect(cursor.atEdge).toBe(true);
    expect(cursor.canonicalUnread).toBe(0);
    expect(cursorMode(cursor)).toBe('live');
  });

  it('handles a Case with no accepted events yet', () => {
    const cursor = createCaseCursor(CASE, []);
    expect(cursor.eventCursor).toBe(-1);
    expect(cursor.atEdge).toBe(true);
  });
});

describe('seeking into history', () => {
  it('leaves live mode and reports what is already ahead of the cursor', () => {
    const cursor = seekCursor(createCaseCursor(CASE, dense(60)), dense(60), 20);
    expect(cursor.eventCursor).toBe(20);
    expect(cursor.atEdge).toBe(false);
    expect(cursor.canonicalUnread).toBe(39);
    expect(cursorMode(cursor)).toBe('historical');
  });

  it('seeking to the high-water mark is the same as being live', () => {
    const cursor = seekCursor(createCaseCursor(CASE, dense(60)), dense(60), 59);
    expect(cursor.atEdge).toBe(true);
    expect(cursor.canonicalUnread).toBe(0);
  });
});

describe('events arriving during historical inspection', () => {
  const sequences = dense(60);

  it('leave the cursor exactly where the operator put it', () => {
    const parked = seekCursor(createCaseCursor(CASE, sequences), sequences, 20);
    const grown = [...sequences, 60, 61, 62];

    const after = acceptEvents(parked, grown);

    // The rule an investigator depends on: new evidence never yanks the view.
    expect(after.eventCursor).toBe(20);
    expect(after.atEdge).toBe(false);
  });

  it('raise the high-water mark and the canonical unread count', () => {
    const parked = seekCursor(createCaseCursor(CASE, sequences), sequences, 20);
    const grown = [...sequences, 60, 61, 62];

    const after = acceptEvents(parked, grown);

    expect(after.caseHighWaterMark).toBe(62);
    expect(after.canonicalUnread).toBe(42);
    expect(after.canonicalUnread).toBe(parked.canonicalUnread + 3);
  });

  it('follow the edge when the cursor is already live', () => {
    const live = createCaseCursor(CASE, sequences);
    const after = acceptEvents(live, [...sequences, 60]);

    expect(after.eventCursor).toBe(60);
    expect(after.atEdge).toBe(true);
    expect(after.canonicalUnread).toBe(0);
  });
});

describe('canonical unread is counted, never derived by subtraction', () => {
  it('counts accepted events rather than the arithmetic span', () => {
    // A sparse Case: sequences 0, 5, 9. Three events, not ten. Subtracting the
    // cursor from the high-water mark would claim nine unread after the first.
    const sparse = [0, 5, 9];
    expect(canonicalUnreadFor(sparse, 0)).toBe(2);
    expect(canonicalUnreadFor(sparse, 5)).toBe(1);
    expect(canonicalUnreadFor(sparse, 9)).toBe(0);
    expect(canonicalUnreadFor(sparse, 0)).not.toBe(9 - 0);
  });

  it('is zero at or beyond the edge', () => {
    expect(canonicalUnreadFor(dense(10), 9)).toBe(0);
    expect(canonicalUnreadFor(dense(10), 99)).toBe(0);
  });
});

describe('returning to live', () => {
  const sequences = dense(60);

  it('lands on the newest accepted event and skips nothing', () => {
    const parked = seekCursor(createCaseCursor(CASE, sequences), sequences, 20);
    const grown = [...sequences, 60, 61];
    const withUnread = acceptEvents(parked, grown);
    expect(withUnread.canonicalUnread).toBe(41);

    const live = returnToLive(withUnread, grown);

    expect(live.eventCursor).toBe(61);
    expect(live.caseHighWaterMark).toBe(61);
    expect(live.atEdge).toBe(true);
    expect(live.canonicalUnread).toBe(0);
    expect(cursorMode(live)).toBe('live');
  });

  it('is idempotent — pressing it twice does nothing the second time', () => {
    const parked = seekCursor(createCaseCursor(CASE, sequences), sequences, 20);
    const once = returnToLive(parked, sequences);
    expect(returnToLive(once, sequences)).toEqual(once);
  });
});

describe('purity', () => {
  it('never mutates the state handed to it', () => {
    const sequences = dense(10);
    const cursor = createCaseCursor(CASE, sequences);
    const snapshot = { ...cursor };

    seekCursor(cursor, sequences, 3);
    acceptEvents(cursor, [...sequences, 10]);
    returnToLive(cursor, sequences);

    expect(cursor).toEqual(snapshot);
  });
});
