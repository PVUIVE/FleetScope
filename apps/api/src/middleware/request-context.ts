import type { MiddlewareHandler } from 'hono';

/**
 * Minimal structured request logging. No request bodies are logged: a live
 * request could carry screened vendor content, and logs are not an audit store.
 */
export const requestContext =
  (logLevel: string): MiddlewareHandler =>
  async (c, next) => {
    const startedAt = Date.now();
    await next();
    if (logLevel === 'silent') return;
    console.log(
      JSON.stringify({
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - startedAt,
      }),
    );
  };
