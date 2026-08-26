import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADAPTER_MODES,
  UnsupportedAdapterModeError,
  type AdapterDescriptor,
} from '../src/index.js';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('adapter modes', () => {
  it('declares exactly the three documented modes', () => {
    expect([...ADAPTER_MODES]).toEqual(['recorded', 'synthetic', 'live']);
  });

  it('forces a descriptor to state its upstream, even when there is none', () => {
    const descriptor: AdapterDescriptor = {
      service: 'agent-registry',
      mode: 'recorded',
      displayLabel: 'Recorded Case',
      upstream: null,
    };
    expect(descriptor.upstream).toBeNull();
    expect(descriptor.mode).toBe('recorded');
  });

  it('names the service and mode when an implementation is missing', () => {
    const error = new UnsupportedAdapterModeError('agent-runtime', 'live');
    expect(error.message).toContain('agent-runtime');
    expect(error.message).toContain('live');
  });
});

describe('adapter boundaries contain no live implementation yet', () => {
  const dirs = readdirSync(srcDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  it('covers all seven platform capabilities', () => {
    expect(dirs.sort()).toEqual([
      'armor',
      'gateway',
      'identity',
      'memory',
      'observability',
      'registry',
      'runtime',
    ]);
  });

  it.each(dirs)('%s declares interfaces without fabricating responses', (dir) => {
    const source = readFileSync(join(srcDir, dir, 'index.ts'), 'utf8');
    // No adapter may reach the network from this package. Implementations live
    // in apps/api behind the live-mode guard.
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('axios');
    expect(source).not.toContain('googleapis');
    expect(source).toContain('export interface');
  });
});
