import { spawn } from 'node:child_process';

/**
 * Open a URL in the developer's browser.
 *
 * `open` on macOS, `xdg-open` on Linux. The child is detached and its streams
 * are discarded so the browser never becomes a child this process has to wait
 * on or clean up. Failure is reported, never thrown: not being able to open a
 * browser must not take down a running collector.
 */
export function openBrowser(url: string): { opened: boolean; reason: string | null } {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null;

  if (command === null) {
    return { opened: false, reason: `no known opener for platform ${process.platform}` };
  }

  try {
    const child = spawn(command, [url], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return { opened: true, reason: null };
  } catch (error) {
    return { opened: false, reason: (error as Error).message };
  }
}
