import { runInit } from './commands/init.js';
import { runWatch } from './commands/watch.js';
import { readConfig } from './config.js';
import { openBrowser } from './open-browser.js';
import { probePort } from './port.js';
import { blue, bold, dim, fail, line } from './ui.js';

/**
 * The `fleetscope` command surface.
 *
 * Five commands. A local viewer does not need more, and every one that is added
 * is one more thing to keep working during a demo.
 */
export const USAGE = `
${bold('fleetscope')} — a local Agent Viewer for Gemini and Google ADK

${bold('Usage')}
  fleetscope <command> [options]

${bold('Commands')}
  init                  write .fleetscope/config.json and check the environment
  watch                 start the collector and the Agent Viewer
  open                  open the Agent Viewer in a browser
  run <command>...      start the viewer, then run an agent against it
  demo                  admit the fixed no-worker dependency-onboarding demo

${bold('Options')}
  --port <n>            listen on this port (default: 4317, or config.port)
  --open                open the browser once the viewer is ready
  -h, --help            show this help
  -v, --version         show the version

${bold('Examples')}
  fleetscope watch
  fleetscope run python examples/vendor_agent.py
  fleetscope open
  fleetscope demo --open
`;

export const VERSION = '0.1.0';

interface ParsedArgs {
  readonly command: string | null;
  readonly port: number | null;
  readonly openViewer: boolean;
  readonly help: boolean;
  readonly version: boolean;
  /** Everything after the command, for `run`. */
  readonly rest: readonly string[];
  readonly problem: string | null;
}

/**
 * Parse argv.
 *
 * `run` takes the entire remainder verbatim, including flags, so
 * `fleetscope run python agent.py --verbose` passes `--verbose` to python and
 * not to FleetScope.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let command: string | null = null;
  let port: number | null = null;
  let openViewer = false;
  let help = false;
  let version = false;
  let problem: string | null = null;
  const rest: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;

    if (command === 'run') {
      rest.push(arg);
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      help = true;
      continue;
    }
    if (arg === '-v' || arg === '--version') {
      version = true;
      continue;
    }
    if (arg === '--open') {
      openViewer = true;
      continue;
    }
    if (arg === '--port') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 65535) {
        problem = `--port needs a number between 1 and 65535, got ${String(argv[index + 1])}`;
      } else {
        port = value;
      }
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      problem = `unknown option ${arg}`;
      continue;
    }
    if (command === null) command = arg;
    else rest.push(arg);
  }

  return { command, port, openViewer, help, version, rest, problem };
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.version) {
    line(VERSION);
    return 0;
  }
  if (args.help || args.command === null || args.command === 'help') {
    line(USAGE);
    return args.command === null && !args.help ? 1 : 0;
  }
  if (args.problem !== null) {
    fail(args.problem, 'Run  fleetscope --help  for usage.');
    return 2;
  }

  switch (args.command) {
    case 'init':
      return runInit();

    case 'watch':
      return runWatch({
        ...(args.port === null ? {} : { port: args.port }),
        openViewer: args.openViewer,
        command: [],
      });

    case 'demo':
      return runWatch({
        ...(args.port === null ? {} : { port: args.port }),
        openViewer: args.openViewer,
        startDemo: true,
        command: [],
      });

    case 'run': {
      if (args.rest.length === 0) {
        fail('run needs a command.', 'Example:  fleetscope run python examples/vendor_agent.py');
        return 2;
      }
      return runWatch({
        ...(args.port === null ? {} : { port: args.port }),
        openViewer: args.openViewer,
        command: args.rest,
      });
    }

    case 'open':
      return runOpen(args.port);

    default:
      fail(`unknown command "${args.command}".`, 'Run  fleetscope --help  for usage.');
      return 2;
  }
}

/**
 * `fleetscope open`
 *
 * Refuses to open a viewer that is not there. Opening a browser onto a dead
 * port teaches the developer nothing; naming the command that starts it does.
 */
async function runOpen(portOverride: number | null): Promise<number> {
  const { config } = readConfig();
  const port = portOverride ?? config.port;
  const url = `http://127.0.0.1:${port}`;

  const state = await probePort(port);
  if (state.kind !== 'fleetscope') {
    fail(`no FleetScope viewer is listening on port ${port}.`, 'Start one with:  fleetscope watch');
    return 1;
  }

  const result = openBrowser(url);
  if (!result.opened) {
    fail(`could not open a browser: ${result.reason ?? 'unknown'}`, `Open ${url} yourself.`);
    return 1;
  }
  line(`${dim('Opened')} ${blue(url)}`);
  return 0;
}
