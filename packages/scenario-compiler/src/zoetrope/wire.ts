/**
 * The Zoetrope wire shapes.
 *
 * Zoetrope's parser is a serde model for Claude Code's JSONL transcript format
 * (`vendor/zoetrope/src/transcript.rs`). Speaking that format is what lets
 * FleetScope reuse its fold, its timeline engine and its 182 upstream tests
 * unmodified — the alternative would be forking the parser, which is the one
 * thing the vendoring strategy exists to avoid.
 *
 * ONLY the fields Zoetrope actually reads are emitted. In particular there is
 * deliberately no `thinking` block builder and no `prompt` field on a spawn:
 * `vendor/zoetrope/src/ui/panel.rs` renders `↳ prompt` and `↳ thought` rows from
 * exactly those, and FleetScope must never put private reasoning where a
 * renderer can draw it. This is the primary fix for that finding; the vendored
 * panel patch is defence in depth, not the control.
 */

/** Fractional-second digits used to force a strict global timeline order. */
const NANO_DIGITS = 6;

/**
 * Stamp a renderer line with a timestamp that is strictly greater than every
 * line emitted before it, without moving it out of its Canonical Event's second.
 *
 * Zoetrope sorts timeline items by timestamp (stably, metas before entries at a
 * tie). Several Canonical Events legitimately share a `sourceTime`, and a
 * subagent's lines live in a different file from the main transcript, so a plain
 * copy of `sourceTime` would leave the merge order up to the sort's stability
 * across files — which is not something FleetScope should depend on.
 *
 * Appending the global emission index as sub-millisecond precision makes the
 * order total and explicit. The offset is at most 999,999 nanoseconds, so a line
 * never crosses into the next millisecond and the multi-week gap structure the
 * scrubber renders is untouched.
 */
export function orderedTimestamp(sourceTime: string, globalIndex: number): string {
  if (globalIndex >= 10 ** NANO_DIGITS) {
    throw new RangeError(
      `renderer line ${globalIndex} exceeds the ${10 ** NANO_DIGITS}-line ordering budget`,
    );
  }
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(sourceTime);
  if (match === null) throw new TypeError(`not an ISO-8601 instant: ${sourceTime}`);
  const millis = (match[2] ?? '').padEnd(3, '0').slice(0, 3);
  const nanos = String(globalIndex).padStart(NANO_DIGITS, '0');
  return `${match[1]}.${millis}${nanos}Z`;
}

/** Zoetrope treats `Agent` as a spawn tool. The name is load-bearing. */
export const SPAWN_TOOL = 'Agent';

export interface AssistantLineInput {
  readonly uuid: string;
  readonly parentUuid: string | null;
  readonly timestamp: string;
  readonly sessionId: string;
  readonly agentId?: string;
  readonly model?: string;
  readonly outputTokens?: number;
  readonly content: readonly AssistantBlock[];
}

export type AssistantBlock =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool_use';
      readonly id: string;
      readonly name: string;
      readonly input: Record<string, unknown>;
    };

export function assistantLine(input: AssistantLineInput): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid: input.uuid,
    parentUuid: input.parentUuid,
    timestamp: input.timestamp,
    sessionId: input.sessionId,
    ...(input.agentId !== undefined ? { agentId: input.agentId, isSidechain: true } : {}),
    message: {
      role: 'assistant',
      ...(input.model !== undefined ? { model: input.model } : {}),
      content: input.content,
      // Usage is omitted entirely when unrecorded. Emitting `output_tokens: 0`
      // would make the renderer draw "0 tok" for an agent whose usage FleetScope
      // simply never observed — unknown rendered as zero, which is forbidden.
      ...(input.outputTokens !== undefined ? { usage: { output_tokens: input.outputTokens } } : {}),
    },
  };
}

export interface UserResultLineInput {
  readonly uuid: string;
  readonly parentUuid: string | null;
  readonly timestamp: string;
  readonly sessionId: string;
  readonly agentId?: string;
  readonly toolUseId: string;
  readonly summary: string;
  readonly isError: boolean;
}

/**
 * A tool result. Zoetrope pairs it with its `tool_use` by `tool_use_id`, which
 * is what resolves a pending chip; an unpaired `tool_use` stays pending forever.
 */
export function userResultLine(input: UserResultLineInput): Record<string, unknown> {
  return {
    type: 'user',
    uuid: input.uuid,
    parentUuid: input.parentUuid,
    timestamp: input.timestamp,
    sessionId: input.sessionId,
    ...(input.agentId !== undefined ? { agentId: input.agentId, isSidechain: true } : {}),
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: input.toolUseId,
          content: input.summary,
          is_error: input.isError,
        },
      ],
    },
  };
}

export interface SubagentMetaInput {
  readonly agentType: string;
  readonly description: string;
  readonly toolUseId: string;
}

/** The `meta.json` sidecar. Sets the child node's type, label and parentage. */
export function subagentMeta(input: SubagentMetaInput): Record<string, unknown> {
  return {
    agentType: input.agentType,
    description: input.description,
    toolUseId: input.toolUseId,
  };
}

export const serializeJsonl = (lines: readonly Record<string, unknown>[]): string =>
  lines.map((line) => JSON.stringify(line)).join('\n') + (lines.length > 0 ? '\n' : '');
