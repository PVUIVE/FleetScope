#!/usr/bin/env node
/**
 * The `fleetscope` entry point.
 *
 * Workspace packages are consumed as TypeScript SOURCE — there is no per-package
 * build step anywhere in this repo — so the CLI registers tsx's loader and then
 * imports its own TypeScript. Doing it in-process keeps `fleetscope` a single
 * PID: `watch` owns child processes and signal handling, and an extra wrapper
 * process between the terminal and that logic is exactly how orphaned servers
 * happen.
 */
import { register } from 'tsx/esm/api';

/**
 * `node:sqlite` is stable enough for a local, single-writer store but still
 * prints an ExperimentalWarning on first use. Printing it above the viewer URL
 * makes the CLI look broken to a developer who did nothing wrong, so this one
 * warning is filtered — and only this one. Everything else still reaches stderr.
 */
const emit = process.emit;
process.emit = function filterSqliteWarning(name, data, ...rest) {
  if (
    name === 'warning' &&
    data instanceof Error &&
    data.name === 'ExperimentalWarning' &&
    data.message.includes('SQLite')
  ) {
    return false;
  }
  return emit.call(this, name, data, ...rest);
};

register();
const { main } = await import('../src/main.ts');
process.exitCode = await main(process.argv.slice(2));
