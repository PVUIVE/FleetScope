import { createServer, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { parseArgs, USAGE, VERSION } from '../src/main.js';
import { DEFAULT_PORT, defaultConfig } from '../src/config.js';
import { isPortFree, probePort } from '../src/port.js';

/**
 * CLI behaviour a developer depends on: the flags mean what they say, `run`
 * hands its own flags to the child, and a busy port is diagnosed rather than
 * silently worked around.
 */
describe('argument parsing', () => {
  it('parses a bare command', () => {
    expect(parseArgs(['watch'])).toMatchObject({ command: 'watch', port: null, openViewer: false });
  });

  it('parses --port and --open', () => {
    expect(parseArgs(['watch', '--port', '5000', '--open'])).toMatchObject({
      command: 'watch',
      port: 5000,
      openViewer: true,
    });
  });

  it('reports an out-of-range port instead of using it', () => {
    expect(parseArgs(['watch', '--port', '99999']).problem).toMatch(/--port/);
    expect(parseArgs(['watch', '--port', 'abc']).problem).toMatch(/--port/);
  });

  it('reports an unknown option', () => {
    expect(parseArgs(['watch', '--turbo']).problem).toBe('unknown option --turbo');
  });

  it('hands everything after `run` to the child, flags included', () => {
    const args = parseArgs(['run', 'python', 'agent.py', '--verbose', '--port', '1']);
    expect(args.command).toBe('run');
    // `--port 1` belongs to python here, not to FleetScope.
    expect(args.rest).toEqual(['python', 'agent.py', '--verbose', '--port', '1']);
    expect(args.port).toBeNull();
  });

  it('recognizes help and version', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
    expect(parseArgs([]).command).toBeNull();
  });
});

describe('help text', () => {
  it('documents every command the CLI implements', () => {
    for (const command of ['init', 'watch', 'open', 'run']) {
      expect(USAGE).toContain(command);
    }
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('configuration', () => {
  it('defaults to a fixed port, never a random one', () => {
    // A moving port would break the endpoint a developer put in their agent.
    expect(defaultConfig().port).toBe(DEFAULT_PORT);
    expect(defaultConfig().adapter).toBe('google-adk');
  });

  it('holds no credential', () => {
    expect(JSON.stringify(defaultConfig()).toLowerCase()).not.toMatch(/key|token|secret/);
  });
});

describe('port detection', () => {
  it('reports a free port as free', async () => {
    expect(await isPortFree(0)).toBe(true);
  });

  it('reports a port held by something that is not FleetScope', { timeout: 15_000 }, async () => {
    // A server that accepts and answers nothing — the shape of "some other
    // process owns this port", which the probe must diagnose rather than hang on.
    const sockets: Socket[] = [];
    const server = createServer((socket) => sockets.push(socket));
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve((server.address() as { port: number }).port);
      });
    });
    try {
      const state = await probePort(port);
      expect(state.kind).toBe('occupied');
    } finally {
      // The probe's socket is still open against this silent server; without
      // dropping it, `close` waits for a connection that will never end.
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
