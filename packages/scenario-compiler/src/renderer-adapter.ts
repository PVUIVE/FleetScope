import type { CockpitTranscript } from './transcript.js';

/**
 * The seam between FleetScope's canonical domain and whatever the Fleet Cockpit
 * renderer actually consumes.
 *
 * Renderer-specific requirements live BEHIND this interface. Adding a renderer
 * field to a Canonical Event, a domain type, or a fixture is a design error —
 * put it in an adapter here instead.
 */
export interface RendererAdapter {
  readonly id: string;
  readonly description: string;
  /** Serialize the interim transcript into the bytes the renderer loads. */
  render(transcript: CockpitTranscript): string;
  /** File extension for the emitted artifact, without the dot. */
  readonly extension: string;
}

/**
 * The only adapter that exists today: it emits FleetScope's own interim JSONL.
 * It is honest about being interim rather than claiming upstream compatibility
 * that has not been verified against real upstream source.
 */
export const interimJsonlAdapter: RendererAdapter = {
  id: 'fleetscope-interim-jsonl',
  description:
    'FleetScope interim transcript JSONL. Not verified against any upstream renderer schema.',
  extension: 'jsonl',
  render: (transcript) => {
    const header = JSON.stringify({
      type: 'header',
      transcriptVersion: transcript.transcriptVersion,
      caseId: transcript.caseId,
      agents: transcript.agents,
    });
    return (
      [header, ...transcript.entries.map((e) => JSON.stringify({ type: 'entry', ...e }))].join(
        '\n',
      ) + '\n'
    );
  },
};
