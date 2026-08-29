import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAdkIngest } from '@fleetscope/adk-adapter';

const pluginContract = fileURLToPath(
  new URL('../../../examples/fleetscope_adk/test_plugin_contract.py', import.meta.url),
);

function capturePluginBatches(): unknown[] {
  const output = execFileSync('python3', [pluginContract, '--emit-capture'], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  return (JSON.parse(output) as { batches: unknown[] }).batches;
}

describe('FleetScopePlugin callback contract', () => {
  it('passes its real intercepted callback payloads through the collector wire schema', () => {
    const batches = capturePluginBatches();
    expect(batches).toHaveLength(10);

    const parsed = batches.map((batch) => parseAdkIngest(batch));
    expect(parsed.every((batch) => batch.success)).toBe(true);

    const events = parsed.flatMap((batch) => (batch.success ? batch.data.events : []));
    expect(events.map((event) => event.seq)).toEqual(
      Array.from({ length: 10 }, (_, index) => index + 1),
    );
    expect(
      events.find((event) => event.kind === 'agent.start' && event.agent === 'inventory'),
    ).toMatchObject({
      parentAgent: 'orchestrator',
    });
    expect(events.find((event) => event.kind === 'tool.end')).toMatchObject({
      error: true,
      errorClass: 'timeout',
      tool: 'inventory_lookup',
    });

    const modelEnd = events.find((event) => event.kind === 'model.end');
    expect(modelEnd).toBeDefined();
    expect(modelEnd).not.toHaveProperty('inputTokens');
    expect(modelEnd).not.toHaveProperty('outputTokens');
  });

  it('passes the Python callback assertions without an ADK install or HTTP request', () => {
    expect(() =>
      execFileSync('python3', [pluginContract], {
        encoding: 'utf8',
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      }),
    ).not.toThrow();
  });
});
