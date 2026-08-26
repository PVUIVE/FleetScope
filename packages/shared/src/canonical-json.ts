/**
 * Deterministic serialization.
 *
 * Object key order in JS is insertion-ordered, so two structurally identical
 * states can serialize differently. Replay determinism (Invariant 7) depends on
 * a single canonical byte sequence, so keys are sorted recursively here and
 * this function is the ONLY serializer allowed on the hashing path.
 *
 * `undefined` object properties are dropped; `undefined` array members become
 * `null`, matching JSON.stringify so the two never disagree.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Non-finite numbers cannot be canonically serialized');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => (v === undefined ? null : canonicalize(v)));
  }
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const v = source[key];
    if (v === undefined) continue;
    out[key] = canonicalize(v);
  }
  return out;
}
