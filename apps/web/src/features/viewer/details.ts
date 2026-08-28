import type { CanonicalEvent } from '@fleetscope/event-schema';
import type { ViewerEvent } from '@fleetscope/viewer';
import { UNKNOWN, formatClock, formatDuration } from '../../lib/format';

/**
 * The event details panel.
 *
 * Built as DOM rather than an HTML string, because every value here comes from
 * a developer's own agent run: a tool argument containing `<script>` must be
 * shown, and `textContent` shows it without ever parsing it as markup.
 *
 * Only ALREADY-REDACTED payload fields reach this function — the Canonicalizer
 * replaced anything sensitive with a marker before it was written. What is
 * rendered is what was stored.
 */
const KIND_LABEL: Readonly<Record<string, string>> = {
  'session.started': 'SESSION',
  'session.completed': 'SESSION',
  'agent.started': 'AGENT',
  'agent.completed': 'AGENT',
  'agent.handoff': 'AGENT HANDOFF',
  'model.started': 'MODEL CALL',
  'model.completed': 'MODEL CALL',
  'tool.started': 'TOOL CALL',
  'tool.completed': 'TOOL CALL',
  'tool.failed': 'TOOL CALL',
  error: 'ERROR',
};

const text = (tag: string, className: string, value: string): HTMLElement => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
};

function definitions(rows: readonly (readonly [string, string])[]): HTMLElement {
  const list = document.createElement('dl');
  list.className = 'fs-detail__grid';
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    list.append(dt, dd);
  }
  return list;
}

function section(label: string, payload: unknown): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'fs-detail__section';
  wrapper.append(text('div', 'fs-detail__label', label));
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(payload, null, 2);
  wrapper.append(pre);
  return wrapper;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function renderDetails(
  container: HTMLElement,
  row: ViewerEvent | null,
  event: CanonicalEvent | null,
): void {
  container.replaceChildren();

  if (row === null) {
    container.append(
      text('p', 'fs-detail__empty', 'Select an event in the timeline to see what happened.'),
    );
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'fs-detail';
  panel.append(text('div', 'fs-detail__kind', KIND_LABEL[row.type] ?? row.type.toUpperCase()));
  panel.append(text('h2', 'fs-detail__title', row.toolName ?? row.model ?? row.label));

  if (row.errorClass !== null) {
    const error = document.createElement('div');
    error.className = 'fs-detail__error';
    error.append(text('div', 'fs-detail__label', 'Error'));
    error.append(text('div', '', row.errorClass));
    if (row.summary !== null) error.append(text('div', 'fs-event__agent', row.summary));
    panel.append(error);
  }

  const payload = event?.payloadRedacted ?? {};
  const rows: [string, string][] = [
    ['Agent', row.agentId ?? UNKNOWN],
    ['Status', row.status === null ? UNKNOWN : row.status[0]!.toUpperCase() + row.status.slice(1)],
    ['Started', formatClock(row.timestamp)],
    // A duration FleetScope never observed says so. It is never shown as 0 ms.
    ['Duration', formatDuration(row.durationMs)],
  ];
  if (row.model !== null) rows.push(['Model', row.model]);
  if (row.type === 'agent.handoff') {
    rows.push(['From', row.parentAgentId ?? UNKNOWN], ['To', row.agentId ?? UNKNOWN]);
  }
  const inputTokens = payload['inputTokens'];
  const outputTokens = payload['outputTokens'];
  // Token counts appear ONLY when the framework supplied them.
  if (typeof inputTokens === 'number') rows.push(['Input tokens', String(inputTokens)]);
  if (typeof outputTokens === 'number') rows.push(['Output tokens', String(outputTokens)]);
  rows.push(['Event', String(row.sequence)]);

  panel.append(definitions(rows));

  const args = record(payload['args']);
  if (args !== null) panel.append(section('Input', args));

  const result = record(payload['result']);
  if (result !== null) panel.append(section('Result', result));

  if (row.summary !== null && row.errorClass === null) {
    panel.append(section('Summary', row.summary));
  }

  const provenance = document.createElement('div');
  provenance.className = 'fs-detail__section';
  provenance.append(text('div', 'fs-detail__label', 'Recorded as'));
  provenance.append(text('div', 'fs-viewer__id', `${row.canonicalType} · ${row.sourceEventId}`));
  panel.append(provenance);

  container.append(panel);
}
