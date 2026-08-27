/**
 * @fleetscope/warden — detection, policy, and the Intervention lifecycle.
 *
 * Three responsibilities, deliberately separated so none can borrow another's
 * authority:
 *
 *   detector.ts     finds patterns in recorded evidence. Grants nothing.
 *   policy.ts       decides what may be done. Versioned and deterministic.
 *   intervention.ts does it, at most once, and reports only what the Runtime said.
 *
 * The detector and the policy are pure. Only `Warden` in intervention.ts touches
 * the outside world, and only through the `ControlAdapter` port — which is what
 * makes "historical replay performs zero control-plane calls" a testable claim
 * rather than an assurance.
 */
export * from './detector.js';
export * from './approval.js';
export * from './policy.js';
export * from './intervention.js';
