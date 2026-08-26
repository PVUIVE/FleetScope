/** Case IDs shipped as recorded evidence. CASE-1042 is the golden scenario. */
export const FIXTURE_CASE_IDS = ['CASE-1042'] as const;
export type FixtureCaseId = (typeof FIXTURE_CASE_IDS)[number];

export const DEFAULT_FIXTURE_CASE_ID: FixtureCaseId = 'CASE-1042';

export function isFixtureCaseId(value: string): value is FixtureCaseId {
  return (FIXTURE_CASE_IDS as readonly string[]).includes(value);
}
