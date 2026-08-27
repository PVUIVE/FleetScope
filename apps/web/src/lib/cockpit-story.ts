import type { RenderManifest } from '@fleetscope/scenario-compiler';
import type { EvidenceRecord } from './evidence-view';

export interface StoryEvidence {
  readonly eventId: string;
  readonly caseSequence: number;
  readonly humanIndex: number;
  readonly label: string;
  readonly summary: string;
  readonly rendererEntryStart: number | null;
  readonly rendererEntryEnd: number | null;
}

export interface StoryClaim {
  readonly available: boolean;
  readonly label: string;
  readonly summary: string;
  readonly evidence: readonly StoryEvidence[];
}

export interface StoryChapter extends StoryClaim {
  readonly id: 'start' | 'security' | 'failure' | 'warden' | 'result';
  readonly title: string;
  readonly problem: string;
  readonly action: string;
  readonly result: string;
}

export interface CockpitStory {
  readonly outcome: StoryClaim;
  readonly proofs: readonly StoryClaim[];
  readonly chapters: readonly StoryChapter[];
}

function evidenceFor(record: EvidenceRecord, manifest: RenderManifest): StoryEvidence {
  const entry = manifest.entries.find((candidate) => candidate.eventId === record.eventId);
  const count = entry?.rendererEntryCount ?? 0;
  return {
    eventId: record.eventId,
    caseSequence: record.caseSequence,
    humanIndex: record.humanIndex,
    label: record.label,
    summary: record.summary,
    rendererEntryStart: count > 0 ? entry!.rendererEntryStart : null,
    rendererEntryEnd: count > 0 ? entry!.rendererEntryStart + count - 1 : null,
  };
}

function claim(
  label: string,
  summary: string,
  records: readonly EvidenceRecord[],
  manifest: RenderManifest,
): StoryClaim {
  const evidence = records.map((record) => evidenceFor(record, manifest));
  return {
    available: evidence.length > 0,
    label,
    summary: evidence.length > 0 ? summary : 'Not recorded in this Case evidence.',
    evidence,
  };
}

function byType(records: readonly EvidenceRecord[], ...types: string[]): EvidenceRecord[] {
  return records.filter((record) => types.includes(record.type));
}

/**
 * Project the recorded Case into a short operator story.
 *
 * Every positive statement is paired with one or more exact Canonical Events.
 * Missing evidence remains explicitly unavailable rather than becoming a
 * plausible-sounding success summary.
 */
export function cockpitStory(
  records: readonly EvidenceRecord[],
  manifest: RenderManifest,
): CockpitStory {
  const caseOpened = byType(records, 'case.created', 'registry.version_resolved').slice(0, 2);
  const armorBlocked = byType(records, 'armor.blocked').slice(0, 1);
  const failures = byType(records, 'tool.failed').slice(0, 3);
  const warden = byType(
    records,
    'intervention.proposed',
    'intervention.authorized',
    'intervention.succeeded',
  ).slice(0, 3);
  const completed = byType(records, 'runtime.completed').slice(-1);
  const activated = byType(records, 'case.milestone_changed')
    .filter((record) => record.summary.toLowerCase().includes('activation'))
    .slice(-1);

  const outcome = claim(
    'Case completed',
    'Runtime recorded the Case as complete after the recovery path finished.',
    completed,
    manifest,
  );

  const proofs = [
    claim(
      'Input blocked',
      'Model Armor blocked the unsafe vendor input before downstream use.',
      armorBlocked,
      manifest,
    ),
    claim(
      'Failure detected',
      `The Logistics path recorded ${String(failures.length)} failure${failures.length === 1 ? '' : 's'} before recovery.`,
      failures,
      manifest,
    ),
    claim(
      'Warden recovered',
      'Warden proposed one bounded retry and Runtime confirmed its result.',
      warden,
      manifest,
    ),
    claim(
      'Vendor activated',
      'The recorded Case advanced to vendor activation.',
      activated,
      manifest,
    ),
  ] as const;

  const chapters: readonly StoryChapter[] = [
    {
      id: 'start',
      title: 'Start',
      problem: 'A vendor onboarding Case needed an approved agent workflow.',
      action: 'FleetScope opened the Case and resolved the recorded Agent Version.',
      result: 'The governed onboarding path started with recorded provenance.',
      ...claim(
        'Case started',
        'The Case and approved Agent Version were recorded.',
        caseOpened,
        manifest,
      ),
    },
    {
      id: 'security',
      title: 'Security',
      problem: 'Vendor input contained unsafe content.',
      action: 'Model Armor screened the input before it could reach context, memory, or tools.',
      result: 'The unsafe input was blocked; no downstream use is recorded.',
      ...claim(
        'Unsafe input blocked',
        'Model Armor recorded a block before downstream use.',
        armorBlocked,
        manifest,
      ),
    },
    {
      id: 'failure',
      title: 'Failure',
      problem: 'The Logistics Agent could not complete its carrier read.',
      action: 'FleetScope retained the repeated failures as Canonical Evidence.',
      result: `The recorded Case shows ${String(failures.length)} failures, not an inferred outage.`,
      ...claim(
        'Logistics failures',
        'The same recorded Logistics tool failure repeated three times.',
        failures,
        manifest,
      ),
    },
    {
      id: 'warden',
      title: 'Warden Fix',
      problem: 'The repeated failure required a bounded recovery action.',
      action:
        'Versioned policy authorized one Warden intervention and FleetScope requested it from Runtime.',
      result: 'Runtime recorded the intervention lifecycle separately from the request.',
      ...claim(
        'Bounded recovery',
        'Warden evidence records proposal, authorization, and Runtime-confirmed result.',
        warden,
        manifest,
      ),
    },
    {
      id: 'result',
      title: 'Result',
      problem: 'Recovery is not a claim until Runtime records its outcome.',
      action: 'FleetScope waited for the authoritative Runtime completion event.',
      result:
        'The Case completed; the activation milestone is available as separate evidence when recorded.',
      ...claim(
        'Runtime-confirmed result',
        'Runtime recorded that the Case completed.',
        completed,
        manifest,
      ),
    },
  ];

  return { outcome, proofs, chapters };
}
