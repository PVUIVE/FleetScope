import { describe, expect, it } from 'vitest';
import { canonicalize, streamRevisionOf } from '@fleetscope/canonicalizer';
import { project } from '@fleetscope/projector';
import {
  loadCanonicalEvents,
  loadExpectedState,
  loadSourceEvents,
} from '@fleetscope/fixtures/node';
import type { SourceEvent } from '@fleetscope/event-schema';

/**
 * The Canonicalizer, proved against the real recorded Case.
 *
 * `source-events.jsonl` holds the Source Events CASE-1042 was canonicalized
 * from, in a deliberately hostile arrival order: reversed, with one event
 * delivered twice. Canonicalizing it must reproduce the blessed canonical stream
 * byte for byte — which makes "duplicates are idempotent" and "arrival order is
 * not an input" statements about the demo, not about a synthetic fixture.
 */

const CASE_ID = 'CASE-1042';
const blessed = loadCanonicalEvents(CASE_ID);
const arriving = loadSourceEvents(CASE_ID);

/**
 * The recorded ingest lag. The Canonicalizer never reads a clock: `acceptedTime`
 * is supplied by whoever received the event, and for a recorded Case that is
 * part of the recording.
 */
const acceptedTimeFor = (event: SourceEvent): string =>
  new Date(Date.parse(event.sourceTime) + 120).toISOString().replace('Z', 'Z');

/** A recorded fixture pins its blessed event ids; live ingest derives them. */
const eventIdFor = (event: SourceEvent): string => event.dedupeKey;

const run = (inputs: readonly unknown[]) =>
  canonicalize(inputs, CASE_ID, { acceptedTimeFor, eventIdFor });

describe('the recorded Source Event stream', () => {
  it('is delivered out of order and contains a redelivery', () => {
    // If the fixture ever became tidy, everything below would still pass while
    // proving nothing. Assert the adversarial shape first.
    expect(arriving.length).toBe(blessed.length + 1);
    const keys = arriving.map((e) => (e as { dedupeKey: string }).dedupeKey);
    expect(new Set(keys).size).toBe(blessed.length);
    expect(keys).not.toEqual(blessed.map((e) => e.eventId));
  });
});

describe('canonicalizing the recorded Case', () => {
  const result = run(arriving);

  it('accepts every distinct Source Event and rejects none', () => {
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(blessed.length);
  });

  it('collapses the redelivery into a single Canonical Event', () => {
    expect(result.duplicatesCollapsed).toHaveLength(1);
  });

  it('reproduces the blessed canonical stream exactly', () => {
    expect(result.accepted).toEqual(blessed);
  });

  it('produces a well-formed stream', () => {
    expect(result.streamProblems).toEqual([]);
  });

  it('reproduces the blessed state hash through the projector', () => {
    const expected = loadExpectedState(CASE_ID);
    expect(project(result.accepted).stateHash).toBe(expected.terminalStateHash);
  });
});

describe('arrival order is not an input to the result', () => {
  it('gives the same canonical stream from three different arrival orders', () => {
    const forward = run([...arriving].reverse());
    const asRecorded = run(arriving);
    // A deterministic shuffle: interleave the two halves, keeping every element.
    // No randomness, so a failure here is always reproducible.
    const half = Math.ceil(arriving.length / 2);
    const interleaved = Array.from({ length: arriving.length }, (_, i) =>
      i % 2 === 0 ? arriving[i / 2] : arriving[half + (i - 1) / 2],
    ).filter((event): event is unknown => event !== undefined);
    expect(interleaved).toHaveLength(arriving.length);
    const shuffled = run(interleaved);

    expect(forward.accepted).toEqual(asRecorded.accepted);
    expect(shuffled.accepted).toEqual(asRecorded.accepted);
    expect(forward.streamRevision).toBe(asRecorded.streamRevision);
    expect(shuffled.streamRevision).toBe(asRecorded.streamRevision);
  });

  it('gives the same stream however many times events are redelivered', () => {
    const tripled = [...arriving, ...arriving, ...arriving];
    const result = run(tripled);
    expect(result.accepted).toEqual(blessed);
    expect(result.rejected).toEqual([]);
  });
});

describe('the stream revision identifies the evidence', () => {
  it('matches the revision computed from the blessed events', () => {
    expect(run(arriving).streamRevision).toBe(streamRevisionOf(blessed));
  });

  it('changes if a single payload changes', () => {
    const tampered = arriving.map((event, index) =>
      index === 0 ? { ...(event as Record<string, unknown>), payload: { tampered: true } } : event,
    );
    expect(run(tampered).streamRevision).not.toBe(streamRevisionOf(blessed));
  });
});

describe('redaction on the recorded Case', () => {
  it('leaves no credential, key or token in the accepted stream', () => {
    const serialized = JSON.stringify(run(arriving).accepted);
    for (const forbidden of ['-----BEGIN', 'Bearer ', 'AIza', 'sk-', 'password']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('redacts a secret injected into a recorded Source Event', () => {
    // The recorded Case carries no secret, so inject one and prove the boundary
    // holds on the real pipeline rather than on a hand-built event.
    const secret = 'AIzaSyD-fake-fixture-key-00000000000000';
    const withSecret = arriving.map((event, index) =>
      index === 0
        ? {
            ...(event as Record<string, unknown>),
            payload: {
              ...((event as { payload: Record<string, unknown> }).payload ?? {}),
              apiKey: secret,
            },
          }
        : event,
    );

    const result = run(withSecret);
    const serialized = JSON.stringify(result.accepted);

    expect(serialized).not.toContain(secret);
    expect(result.redactionCount).toBeGreaterThan(0);
    // A digest is carried precisely because the payload no longer is.
    const redactedEvent = result.accepted.find((e) => e.payloadDigest !== undefined);
    expect(redactedEvent?.payloadDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
