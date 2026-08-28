import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { MiddlewareHandler } from 'hono';

/**
 * Serve the built Agent Viewer beside the local API, from one process and one
 * port. `fleetscope watch` therefore starts exactly one thing, and the browser
 * never makes a cross-origin request — which is why the local path needs no
 * CORS grant at all.
 *
 * Hand-written rather than delegated, for two reasons that both matter here:
 * the clean-URL rewrite (`/sessions/<id>` → the viewer shell) and an explicit
 * containment check. A path is resolved and then verified to still sit inside
 * the root, so `..` in a request cannot read the developer's filesystem.
 */
const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  // Load-bearing: a browser refuses to stream-instantiate a wasm module served
  // as anything else, and the renderer is the whole point of the page.
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * `/sessions/<anything>` is one page. The Astro build is static, so the id
 * cannot be a build-time route; the shell reads it from `location.pathname`.
 * This keeps the URL a developer copies out of the terminal working.
 */
function rewrite(pathname: string): string {
  if (pathname === '/' || pathname === '') return '/index.html';
  const session = /^\/sessions\/([^/]+)\/?$/.exec(pathname);
  if (session !== null && session[1] !== 'view') return '/sessions/view/index.html';
  if (pathname.endsWith('/')) return `${pathname}index.html`;
  return pathname;
}

export function staticViewer(root: string): MiddlewareHandler {
  const base = resolve(root);

  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();

    const pathname = decodeURIComponent(new URL(c.req.url).pathname);
    // API paths are never files; falling through keeps a 404 honest.
    if (pathname.startsWith('/api/')) return next();

    const candidates = [rewrite(pathname)];
    // Astro's `directory` build format writes `/sessions/index.html`; a request
    // for the extensionless `/sessions` must find it.
    if (extname(pathname) === '' && !pathname.endsWith('/')) {
      candidates.push(`${pathname}/index.html`);
    }

    for (const candidate of candidates) {
      const target = resolve(join(base, normalize(candidate)));
      if (target !== base && !target.startsWith(base + sep)) continue;

      const info = await stat(target).catch(() => null);
      if (info === null || !info.isFile()) continue;

      c.header('Content-Type', MIME[extname(target).toLowerCase()] ?? 'application/octet-stream');
      c.header('Content-Length', String(info.size));
      // A local viewer is rebuilt constantly; a cached shell would show the
      // developer yesterday's UI after an upgrade.
      c.header('Cache-Control', 'no-cache');
      if (c.req.method === 'HEAD') return c.body(null, 200);
      return c.body(Readable.toWeb(createReadStream(target)) as ReadableStream, 200);
    }

    return next();
  };
}
