import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where FleetScope keeps its things.
 *
 * The repository root is found by walking up for `pnpm-workspace.yaml`, so the
 * CLI works from any subdirectory. The developer's own project directory —
 * where `.fleetscope/` lives — is the current working directory, which is where
 * they ran the command and where they expect to find the store.
 */
export const FLEETSCOPE_DIR = '.fleetscope';
export const CONFIG_FILE = 'config.json';
export const STORE_FILE = 'fleetscope.db';

/** Where `pnpm build` writes the static viewer, relative to the repo root. */
const VIEWER_BUILD_DIR = 'apps/web/' + 'dist';

export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const projectDir = (): string => process.cwd();
export const fleetscopeDir = (): string => join(projectDir(), FLEETSCOPE_DIR);
export const configPath = (): string => join(fleetscopeDir(), CONFIG_FILE);
export const defaultStorePath = (): string => join(fleetscopeDir(), STORE_FILE);

/** The built static viewer. Absent until `pnpm build` has run. */
export const viewerRoot = (): string => resolve(repoRoot(), VIEWER_BUILD_DIR);
