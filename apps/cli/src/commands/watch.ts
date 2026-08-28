import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { readConfig } from '../config.js';
import { openBrowser } from '../open-browser.js';
import { viewerRoot } from '../paths.js';
import { probePort } from '../port.js';
import { startRuntime, type Runtime } from '../runtime.js';
import { blue, bold, dim, fail, line, ready, yellow } from '../ui.js';

export interface WatchOptions {
  readonly port?: number;
  readonly openViewer: boolean;
  /** `fleetscope run <command>` — started once the collector is listening. */
  readonly command: readonly string[];
}

/**
 * `fleetscope watch`
 *
 * Starts the collector and the viewer on ONE port, in ONE process, and holds
 * the terminal until interrupted. It is the only long-running thing FleetScope
 * asks a developer to run.
 */
export async function runWatch(options: WatchOptions): Promise<number> {
  const { config: local, problem } = readConfig();
  const port = options.port ?? local.port;
  const config = { ...local, port };

  if (problem !== null) {
    fail(`.fleetscope/config.json could not be parsed: ${problem}`, 'Using defaults.');
  }

  const state = await probePort(port);
  if (state.kind === 'fleetscope') {
    // Already running is not an error. Point the developer at it and stop,
    // rather than starting a second collector that cannot bind anyway.
    line();
    line(bold('FleetScope is already running'));
    line();
    line(`  ${blue(`http://127.0.0.1:${port}`)}   ${dim(`${state.sessions} session(s)`)}`);
    line();
    line(dim('  Stop it with Ctrl-C in its terminal, or use --port to run a second one.'));
    line();
    if (options.openViewer) openBrowser(`http://127.0.0.1:${port}`);
    return 0;
  }
  if (state.kind === 'occupied') {
    fail(
      `port ${port} is not available — ${state.detail}.`,
      `Free it, or run:  fleetscope watch --port ${port + 1}`,
    );
    return 1;
  }

  const root = viewerRoot();
  const built = existsSync(root);
  if (!built) {
    fail(
      'the Agent Viewer has not been built.',
      'Run  pnpm build  first. The collector will still start, API-only.',
    );
  }

  let runtime: Runtime;
  try {
    runtime = await startRuntime({ local: config, viewerRoot: built ? root : null });
  } catch (error) {
    fail(`could not start FleetScope: ${(error as Error).message}`);
    return 1;
  }

  line();
  line(bold('FleetScope'));
  line();
  line(dim('Watching local Gemini / ADK sessions...'));
  line();
  ready('Collector ready');
  if (built) ready('Viewer ready');
  else line(`  ${yellow('○')} Viewer not built ${dim('(pnpm build)')}`);
  line();
  line('Viewer:');
  line(`  ${blue(runtime.url)}`);
  line();
  line(dim('Point your agent at:'));
  line(`  ${dim(`FLEETSCOPE_ENDPOINT=${runtime.url}`)}`);
  line();

  const existing = runtime.store.listSessions();
  if (existing.length > 0) {
    line(dim(`${existing.length} recorded session(s) already stored.`));
    line();
  }
  line(dim('Waiting for agent activity...'));
  line();

  // Announce each session ONCE, when it first appears. A running session
  // publishes on every batch; re-printing the banner would bury the URL.
  const announced = new Set(existing.map((session) => session.id));
  runtime.onSessions((sessions) => {
    for (const session of sessions) {
      if (announced.has(session.id)) continue;
      announced.add(session.id);
      line(bold('Session detected'));
      line();
      line(`  ${session.name}`);
      line(`  ${dim(`session: ${session.id}`)}`);
      line();
      line('  Open:');
      line(`  ${blue(`${runtime.url}/sessions/${session.id}`)}`);
      line();
    }
  });

  if (options.openViewer) openBrowser(runtime.url);

  let child: ChildProcess | null = null;
  let childExit: number | null = null;
  if (options.command.length > 0) {
    child = spawn(options.command[0]!, options.command.slice(1), {
      stdio: 'inherit',
      env: { ...process.env, FLEETSCOPE_ENDPOINT: runtime.url },
    });
    child.on('error', (error) => {
      fail(`could not run ${options.command.join(' ')}: ${error.message}`);
      childExit = 127;
    });
    child.on('exit', (code) => {
      childExit = code ?? 0;
      child = null;
      line();
      line(
        dim(`agent exited with code ${childExit}. The viewer is still running — Ctrl-C to stop.`),
      );
      line();
    });
  }

  await holdUntilInterrupted(async () => {
    // Anything this process started, this process stops. An orphaned agent
    // holding a model connection is exactly the ghost the CLI must not leave.
    if (child !== null && child.exitCode === null) child.kill('SIGTERM');
    await runtime.stop();
  });

  return childExit ?? 0;
}

/** Block until SIGINT/SIGTERM, then run `cleanup` before resolving. */
function holdUntilInterrupted(cleanup: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve) => {
    let stopping = false;
    const stop = (signal: NodeJS.Signals): void => {
      if (stopping) return;
      stopping = true;
      line();
      line(dim(`${signal} — shutting down.`));
      void cleanup().then(resolve, resolve);
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
  });
}
