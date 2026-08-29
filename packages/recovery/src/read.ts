/**
 * The one external read the fixed demo may perform, and the one fault it injects.
 *
 * The read is GET-only against a single fixed URL. No caller — agent, UI, model
 * or CLI — can choose the method, the host or a parameter, so there is no path
 * from "the demo ran" to "arbitrary traffic left this machine".
 */

export const ALLOWLISTED_READ = {
  id: 'repository_metadata',
  method: 'GET',
  url: 'https://api.github.com/repos/PVUIVE/FleetScope',
} as const;

/** The label used everywhere this deliberate failure is reported. */
export const CONTROLLED_FAULT_CLASS = 'controlled_fault';

export interface ReadRequest {
  readonly method: 'GET';
  readonly url: string;
}

export type ReadOutcome =
  | { readonly ok: true; readonly summary: string }
  | { readonly ok: false; readonly errorClass: string; readonly controlledFault: boolean };

export interface ReadPort {
  get(request: ReadRequest): Promise<ReadOutcome>;
}

/** Refuse anything that is not exactly the allowlisted read. */
export function checkAllowlisted(request: ReadRequest): string | null {
  if (request.method !== ALLOWLISTED_READ.method) return `method ${request.method} is not allowed`;
  if (request.url !== ALLOWLISTED_READ.url)
    return 'url is not the allowlisted repository metadata read';
  return null;
}

/**
 * Fail the FIRST attempt once, deterministically, as a Controlled Fault.
 *
 * The fault is injected in FleetScope, not in the upstream service, and it is
 * labelled as such in the outcome. A demo that broke the real dependency, or
 * that dressed a genuine outage up as a scripted one, would be reporting
 * something it did not know.
 */
export class ControlledFaultRead implements ReadPort {
  #faulted = false;

  constructor(private readonly inner: ReadPort) {}

  get faultInjected(): boolean {
    return this.#faulted;
  }

  async get(request: ReadRequest): Promise<ReadOutcome> {
    const rejection = checkAllowlisted(request);
    if (rejection !== null)
      return { ok: false, errorClass: 'read_not_allowlisted', controlledFault: false };
    if (!this.#faulted) {
      this.#faulted = true;
      return { ok: false, errorClass: CONTROLLED_FAULT_CLASS, controlledFault: true };
    }
    return this.inner.get(request);
  }
}
