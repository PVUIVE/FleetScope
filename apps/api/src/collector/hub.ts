/**
 * The live event fan-out.
 *
 * Server-Sent Events, not WebSocket. The only direction that carries data is
 * server → browser: the viewer sends nothing back except by ordinary HTTP. SSE
 * gets that with automatic reconnection, no framing protocol, and no extra
 * dependency. A bidirectional transport here would be complexity bought for a
 * capability the product does not have.
 *
 * The hub never buffers history. A subscriber that arrives late reads the store
 * first and then subscribes; the two are stitched with a sequence cursor by the
 * route, so nothing is missed and nothing is delivered twice.
 */
export type Topic = string;

export interface Subscriber {
  readonly topic: Topic;
  readonly send: (data: string) => void;
}

export class EventHub {
  private readonly subscribers = new Map<Topic, Set<Subscriber>>();

  subscribe(subscriber: Subscriber): () => void {
    const set = this.subscribers.get(subscriber.topic) ?? new Set<Subscriber>();
    set.add(subscriber);
    this.subscribers.set(subscriber.topic, set);
    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(subscriber.topic);
    };
  }

  /**
   * Publish to one topic.
   *
   * A subscriber whose socket has already gone is dropped rather than allowed to
   * throw through the publisher: an ingest must not fail because a browser tab
   * closed mid-run.
   */
  publish(topic: Topic, payload: unknown): void {
    const set = this.subscribers.get(topic);
    if (set === undefined) return;
    const data = JSON.stringify(payload);
    for (const subscriber of [...set]) {
      try {
        subscriber.send(data);
      } catch {
        set.delete(subscriber);
      }
    }
  }

  subscriberCount(topic: Topic): number {
    return this.subscribers.get(topic)?.size ?? 0;
  }
}

/** Topic for a single session's event stream. */
export const sessionTopic = (sessionId: string): Topic => `session:${sessionId}`;
/** Topic for "the set of sessions changed" — drives the live session list. */
export const SESSIONS_TOPIC: Topic = 'sessions';
