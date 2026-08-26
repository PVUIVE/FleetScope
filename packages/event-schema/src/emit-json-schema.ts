/**
 * Generates `schemas/*.json` from the Zod definitions.
 * Run with `pnpm schema:emit`. Do not hand-edit the output.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { canonicalEventSchema } from './canonical-event.js';
import { sourceEventSchema } from './source-event.js';

const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');

const targets = [
  { file: 'canonical-event.schema.json', schema: canonicalEventSchema, id: 'CanonicalEvent' },
  { file: 'source-event.schema.json', schema: sourceEventSchema, id: 'SourceEvent' },
] as const;

for (const target of targets) {
  const json = z.toJSONSchema(target.schema, { io: 'input' });
  const document = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://fleetscope.dev/schemas/${target.file}`,
    title: target.id,
    ...json,
  };
  const path = join(schemasDir, target.file);
  writeFileSync(path, JSON.stringify(document, null, 2) + '\n', 'utf8');
  console.log(`wrote ${path}`);
}
