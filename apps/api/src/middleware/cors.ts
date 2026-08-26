import type { MiddlewareHandler } from 'hono';
import type { FleetScopeConfig } from '@fleetscope/shared';

/**
 * Cross-origin access for the browser live proof.
 *
 * The static FleetScope site and this API are separate deployments, so the
 * browser's live-proof call is cross-origin and needs an explicit grant. The
 * grant is an EXACT-MATCH allowlist read from configuration and is empty by
 * default: with no configured origin the service sends no CORS header, which is
 * the correct behaviour both for a same-origin deployment and for one that has
 * not considered the question.
 *
 * The Origin header is never reflected back unless it appears in the allowlist —
 * reflecting an arbitrary origin would let any page on the internet spend this
 * deployment's model budget.
 *
 * No credentials are involved: the API takes no cookie and issues no session, so
 * `Access-Control-Allow-Credentials` is deliberately absent.
 */
export function cors(config: FleetScopeConfig): MiddlewareHandler {
  const allowed = new Set(config.webOrigins);

  return async (c, next) => {
    const origin = c.req.header('origin');
    const permitted = origin !== undefined && allowed.has(origin);

    if (permitted) {
      c.header('Access-Control-Allow-Origin', origin);
      // Caches must not serve one origin's response to another.
      c.header('Vary', 'Origin');
    }

    if (c.req.method === 'OPTIONS') {
      if (!permitted) return c.body(null, 403);
      c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'content-type');
      c.header('Access-Control-Max-Age', '600');
      return c.body(null, 204);
    }

    await next();
  };
}
