import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { defaultConfig, readConfig, writeConfig } from '../config.js';
import { configPath, projectDir, viewerRoot } from '../paths.js';
import { blue, bold, dim, line, pending, ready, yellow } from '../ui.js';

/**
 * `fleetscope init`
 *
 * Writes the local config and REPORTS the environment. It installs nothing and
 * changes nothing outside `.fleetscope/`: a tool that quietly installs a Python
 * package or a toolchain is how a demo becomes unreproducible. What is missing
 * is named, with the exact command to fix it.
 */
export function runInit(): number {
  const existing = existsSync(configPath());
  const { config: current } = readConfig();
  const config = existing ? current : defaultConfig();
  const path = writeConfig(config);

  line();
  line(bold('FleetScope'));
  line(dim(existing ? 'Configuration refreshed.' : 'Configuration created.'));
  line();
  line(`  ${dim('project')}  ${projectDir()}`);
  line(`  ${dim('config')}   ${path}`);
  line(`  ${dim('storage')}  ${config.storage}`);
  line(`  ${dim('port')}     ${config.port}`);
  line();

  line(bold('Environment'));
  const checks = environmentChecks();
  for (const check of checks) {
    if (check.ok) ready(`${check.label}  ${dim(check.detail)}`);
    else pending(`${yellow(check.label)}  ${dim(check.detail)}`);
  }
  line();

  const missing = checks.filter((check) => !check.ok);
  if (missing.length > 0) {
    line(bold('To finish setup'));
    for (const check of missing) line(`  ${check.remedy}`);
    line();
  }

  line(bold('Next'));
  line(`  ${blue('fleetscope watch')}   ${dim('start the collector and the viewer')}`);
  line(`  ${dim('then run your Gemini / ADK agent in another terminal')}`);
  line();

  // Missing optional tooling is not a failure of `init`: the config is written
  // and the report is the deliverable.
  return 0;
}

interface Check {
  readonly label: string;
  readonly detail: string;
  readonly ok: boolean;
  readonly remedy: string;
}

function probe(command: string, args: readonly string[]): string | null {
  try {
    return execFileSync(command, [...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function environmentChecks(): Check[] {
  const checks: Check[] = [
    {
      label: 'Node',
      detail: process.version,
      ok: Number(process.versions.node.split('.')[0]) >= 22,
      remedy: 'Install Node 22 or newer (node:sqlite is required).',
    },
  ];

  const built = existsSync(viewerRoot());
  checks.push({
    label: 'Agent Viewer build',
    detail: built ? viewerRoot() : 'not built',
    ok: built,
    remedy: 'pnpm build',
  });

  const python = probe('python3', ['--version']);
  checks.push({
    label: 'Python',
    detail: python ?? 'not found',
    ok: python !== null,
    remedy: 'Install Python 3.10+ to run Google ADK agents.',
  });

  const adk =
    python === null
      ? null
      : probe('python3', ['-c', 'import importlib.metadata as m; print(m.version("google-adk"))']);
  checks.push({
    label: 'google-adk',
    detail: adk === null ? 'not installed' : `v${adk}`,
    ok: adk !== null,
    remedy: 'pip install google-adk',
  });

  // Reported as PRESENT or ABSENT only. The value is never read, never echoed,
  // and never written to the FleetScope config.
  const keyed =
    process.env['GOOGLE_API_KEY'] !== undefined || process.env['GEMINI_API_KEY'] !== undefined;
  checks.push({
    label: 'Gemini credential',
    detail: keyed ? 'present in the environment' : 'not set',
    ok: keyed,
    remedy: 'export GOOGLE_API_KEY=... (your agent needs it; FleetScope never reads it)',
  });

  return checks;
}
