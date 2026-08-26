import { canonicalJson, sha256Hex } from '@fleetscope/shared';

/**
 * The PRIMARY redaction boundary.
 *
 * Redaction happens here — before a Source Event becomes a Canonical Event and
 * before anything is persisted. It is NOT the Scenario Compiler's job: the
 * compiler performs renderer-safe *minimization* on top of an already-redacted
 * canonical stream (defence in depth), and a stream that reached the compiler
 * still carrying a credential would already have been persisted with it.
 *
 * Two independent classifiers run over every payload leaf, because either alone
 * misses real cases:
 *
 *   - by FIELD NAME  — `apiKey`, `password`, `prompt`, … a value is sensitive
 *     because of where it sits, whatever it looks like;
 *   - by VALUE SHAPE — a bearer token pasted into `notes` is still a token.
 */

/** What a redacted leaf is replaced with. Deliberately not valid JSON-in-string. */
export const REDACTION_MARKER = '«redacted»';

export const SENSITIVITY_CLASSES = [
  'credential',
  'private_prompt',
  'model_reasoning',
  'pii',
  'filesystem_path',
  'vendor_content',
] as const;
export type SensitivityClass = (typeof SENSITIVITY_CLASSES)[number];

export interface FieldRule {
  /** Matched case-insensitively against the payload key at any depth. */
  readonly field: string;
  readonly classification: SensitivityClass;
}

export interface ValueRule {
  readonly name: string;
  readonly classification: SensitivityClass;
  /** Must be global-free: it is tested, not iterated, so `lastIndex` cannot drift. */
  readonly pattern: RegExp;
}

export interface RedactionPolicy {
  readonly policyVersion: string;
  readonly fieldRules: readonly FieldRule[];
  readonly valueRules: readonly ValueRule[];
}

/**
 * The FleetScope default policy.
 *
 * `fieldRules` names the payload keys the domain knows are sensitive.
 * `valueRules` catches the same material arriving under a key nobody predicted.
 */
export const DEFAULT_REDACTION_POLICY: RedactionPolicy = {
  policyVersion: 'redaction-1.0.0',
  fieldRules: [
    { field: 'apikey', classification: 'credential' },
    { field: 'api_key', classification: 'credential' },
    { field: 'accesstoken', classification: 'credential' },
    { field: 'access_token', classification: 'credential' },
    { field: 'authorization', classification: 'credential' },
    { field: 'bearertoken', classification: 'credential' },
    { field: 'clientsecret', classification: 'credential' },
    { field: 'client_secret', classification: 'credential' },
    { field: 'credential', classification: 'credential' },
    { field: 'credentials', classification: 'credential' },
    { field: 'password', classification: 'credential' },
    { field: 'privatekey', classification: 'credential' },
    { field: 'private_key', classification: 'credential' },
    { field: 'secret', classification: 'credential' },
    { field: 'token', classification: 'credential' },

    { field: 'prompt', classification: 'private_prompt' },
    { field: 'systemprompt', classification: 'private_prompt' },
    { field: 'system_prompt', classification: 'private_prompt' },
    { field: 'rawprompt', classification: 'private_prompt' },

    { field: 'thinking', classification: 'model_reasoning' },
    { field: 'thought', classification: 'model_reasoning' },
    { field: 'reasoning', classification: 'model_reasoning' },
    { field: 'chainofthought', classification: 'model_reasoning' },
    { field: 'chain_of_thought', classification: 'model_reasoning' },

    { field: 'email', classification: 'pii' },
    { field: 'phone', classification: 'pii' },
    { field: 'taxid', classification: 'pii' },
    { field: 'iban', classification: 'pii' },
    { field: 'bankaccount', classification: 'pii' },

    { field: 'cwd', classification: 'filesystem_path' },
    { field: 'filepath', classification: 'filesystem_path' },
    { field: 'file_path', classification: 'filesystem_path' },
    { field: 'localpath', classification: 'filesystem_path' },

    { field: 'emailbody', classification: 'vendor_content' },
    { field: 'email_body', classification: 'vendor_content' },
    { field: 'rawcontent', classification: 'vendor_content' },
    { field: 'raw_content', classification: 'vendor_content' },
    { field: 'attachmentbody', classification: 'vendor_content' },
  ],
  valueRules: [
    // Google API key: literal "AIza" prefix + 35 chars of the key alphabet.
    // The terminator is a negative lookahead, not `\b`: the key alphabet includes
    // `-` and `_`, and `\b` does not fire after a non-word character.
    {
      name: 'google_api_key',
      classification: 'credential',
      pattern: /AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/,
    },
    // "Bearer " + a token body of 20+ non-space characters.
    {
      name: 'bearer_token',
      classification: 'credential',
      pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/i,
    },
    // PEM block header — the only reliable structural marker of a private key.
    {
      name: 'pem_private_key',
      classification: 'credential',
      pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    },
    // Common provider prefixes: sk-/ghp_/gho_/xoxb- followed by a long body.
    {
      name: 'prefixed_secret',
      classification: 'credential',
      pattern:
        /(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{20,})(?![A-Za-z0-9_-])/,
    },
    // A POSIX absolute path under a real user home — the shape that leaks a
    // developer machine layout into a shipped artifact.
    {
      name: 'home_directory_path',
      classification: 'filesystem_path',
      pattern: /(?:\/Users\/|\/home\/)[A-Za-z0-9._-]+\//,
    },
  ],
};

export interface Redaction {
  /** Dotted path to the redacted leaf, array indices included. */
  readonly path: string;
  readonly classification: SensitivityClass;
  /** Which rule fired — a field name, or a value-rule name. */
  readonly rule: string;
}

export interface RedactionResult {
  /** Safe to persist. Every sensitive leaf is replaced by REDACTION_MARKER. */
  readonly payloadRedacted: Record<string, unknown>;
  /** `sha256:<hex>` over the canonically serialized PRE-redaction payload. */
  readonly payloadDigest: string;
  readonly redactions: readonly Redaction[];
  readonly policyVersion: string;
}

const normalizeField = (key: string): string => key.toLowerCase().replace(/[\s-]/g, '');

/**
 * Redact one payload.
 *
 * A field-rule hit redacts the whole subtree under that key: a value named
 * `credentials` may be an object, and redacting only its string leaves would
 * still disclose its structure and key names.
 */
export function redactPayload(
  payload: Record<string, unknown>,
  policy: RedactionPolicy = DEFAULT_REDACTION_POLICY,
): RedactionResult {
  const fieldIndex = new Map<string, FieldRule>();
  for (const rule of policy.fieldRules) fieldIndex.set(normalizeField(rule.field), rule);

  const redactions: Redaction[] = [];

  const walk = (value: unknown, path: string): unknown => {
    if (typeof value === 'string') {
      for (const rule of policy.valueRules) {
        if (rule.pattern.test(value)) {
          redactions.push({ path, classification: rule.classification, rule: rule.name });
          return REDACTION_MARKER;
        }
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => walk(item, `${path}[${index}]`));
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const childPath = path === '' ? key : `${path}.${key}`;
        const fieldRule = fieldIndex.get(normalizeField(key));
        if (fieldRule !== undefined) {
          redactions.push({
            path: childPath,
            classification: fieldRule.classification,
            rule: fieldRule.field,
          });
          out[key] = REDACTION_MARKER;
          continue;
        }
        out[key] = walk(child, childPath);
      }
      return out;
    }
    return value;
  };

  const payloadRedacted = walk(payload, '') as Record<string, unknown>;

  return {
    payloadRedacted,
    payloadDigest: `sha256:${sha256Hex(canonicalJson(payload))}`,
    redactions,
    policyVersion: policy.policyVersion,
  };
}

/**
 * Scan an arbitrary artifact for material that must never have been written.
 *
 * Used by the compiler's renderer-minimization tests and by the audit export, so
 * "no secret reached this file" is a machine-checked claim rather than a review
 * habit. Returns the rules that fired, never the matched text.
 */
export function scanForSensitiveMaterial(
  text: string,
  policy: RedactionPolicy = DEFAULT_REDACTION_POLICY,
): readonly { readonly rule: string; readonly classification: SensitivityClass }[] {
  const found: { rule: string; classification: SensitivityClass }[] = [];
  for (const rule of policy.valueRules) {
    if (rule.pattern.test(text))
      found.push({ rule: rule.name, classification: rule.classification });
  }
  return found;
}
