/**
 * The details panel's two lives.
 *
 * Above 1180px it is the third column of the viewer grid: always there, never
 * modal, closable only to hand its width back to the graph. Below 1180px there
 * is no room for a third column, so it becomes an overlay — and an overlay that
 * covers the timeline is a dialog whether or not it was built as one. It used
 * to be built as one only visually, which cost the developer three things:
 *
 *   - it opened over the graph before anything was selected, and its own body
 *     swallowed every click aimed at a timeline row underneath it, so on a phone
 *     no event could be opened at all;
 *   - Escape did nothing, focus never entered it and never came back;
 *   - stepping the timeline re-opened it on every keypress, so a developer who
 *     closed it to read the timeline could not then step through the timeline.
 *
 * This module owns that behaviour in one place. The viewer asks it to `show`
 * a selection and it decides what that means at the current width; a developer
 * who closes it is not overruled until they ask for it again.
 *
 * The modal contract — scrim, focus trap, focus restore, `inert` siblings,
 * scroll lock, Escape — follows the pattern in 21st.dev's headless drawer
 * (@ddoemonn/drawer), adapted from React to this island and to the fact that
 * here the dialog only EXISTS below a breakpoint.
 */

/** The width at which the third column stops fitting, per viewer.css. */
const DRAWER_QUERY = '(max-width: 1180px)';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DetailsDrawer {
  /**
   * Reveal the panel because a selection was made.
   *
   * `explicit` marks a deliberate request for details — a click on a row, an
   * agent, or Jump to failure. Keyboard stepping is not explicit: it moves the
   * cursor, and on a narrow screen re-covering the timeline the developer is
   * stepping through is the opposite of what they asked for.
   */
  show(explicit: boolean): void;
  close(): void;
  /** True while the panel is on screen. */
  readonly isOpen: boolean;
}

export function mountDetailsDrawer(): DetailsDrawer | null {
  const paneNode = document.querySelector<HTMLElement>('[data-details-pane]');
  const scrimNode = document.querySelector<HTMLElement>('[data-details-scrim]');
  if (paneNode === null || scrimNode === null) return null;

  // Re-bound as non-nullable: the hoisted handlers below close over these, and
  // a narrowing from an early return does not reach into a function
  // declaration that the compiler must assume could run before it.
  const pane: HTMLElement = paneNode;
  const scrim: HTMLElement = scrimNode;

  const closeButton = document.querySelector<HTMLElement>('[data-close-details]');
  const openButton = document.querySelector<HTMLElement>('[data-open-details]');

  const media = window.matchMedia(DRAWER_QUERY);
  let open = !media.matches;
  /** Set when the developer closes it, cleared when they ask for it again. */
  let dismissed = false;
  let returnTo: HTMLElement | null = null;
  /**
   * How to find the opener again once the timeline has been rebuilt.
   *
   * Selecting an event re-renders every timeline row, so the button that opened
   * the dialog is gone by the time the dialog closes and focus cannot simply be
   * handed back to the node. Its identity survives the rebuild even though the
   * node does not.
   */
  let returnToSelector: string | null = null;
  let muted: HTMLElement[] = [];

  const isModal = (): boolean => media.matches;

  function trapFocus(event: KeyboardEvent): void {
    if (!isModal() || !open) return;

    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;

    const nodes = [...pane.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => node.offsetParent !== null,
    );
    if (nodes.length === 0) {
      event.preventDefault();
      pane.focus({ preventScroll: true });
      return;
    }
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === pane)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * Take the rest of the page out of the accessibility tree and out of reach.
   *
   * `inert` is what stops a screen reader wandering into the graph behind an
   * open dialog, and what stops the timeline underneath receiving the click
   * that was aimed at the dialog.
   */
  function muteBackground(): void {
    for (const node of document.body.querySelectorAll<HTMLElement>(':scope > *')) {
      if (node.contains(pane) || node.inert) continue;
      node.inert = true;
      muted.push(node);
    }
    document.documentElement.style.overflow = 'hidden';
  }

  function unmuteBackground(): void {
    for (const node of muted) node.inert = false;
    muted = [];
    document.documentElement.style.overflow = '';
  }

  /** Apply the state the current width implies. Idempotent. */
  function apply(): void {
    const modal = isModal();
    pane.hidden = !open;
    scrim.hidden = !(modal && open);

    if (modal && open) {
      pane.setAttribute('role', 'dialog');
      pane.setAttribute('aria-modal', 'true');
      pane.setAttribute('tabindex', '-1');
    } else {
      // Above the breakpoint it is a region of the page, not a dialog. Claiming
      // otherwise would tell a screen reader the rest of the app is unavailable.
      pane.removeAttribute('aria-modal');
      pane.setAttribute('role', 'region');
      pane.removeAttribute('tabindex');
    }

    // Reopening is only offered when it is actually closed. Closing stays
    // available at every width: above the breakpoint it hands the column's
    // width back to the graph, which is a real thing to want.
    if (openButton !== null) openButton.hidden = open;
  }

  function focusIntoPane(): void {
    const active = document.activeElement;
    returnTo = active instanceof HTMLElement ? active : null;

    const sequence = returnTo?.dataset['sequence'];
    const agent = returnTo?.dataset['agentId'];
    returnToSelector =
      sequence !== undefined
        ? `[data-sequence="${CSS.escape(sequence)}"]`
        : agent !== undefined
          ? `[data-agent-id="${CSS.escape(agent)}"]`
          : null;

    const first = pane.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? pane).focus({ preventScroll: true });
  }

  function restoreFocus(): void {
    const target = returnTo;
    const selector = returnToSelector;
    returnTo = null;
    returnToSelector = null;

    if (target !== null && target.isConnected) {
      target.focus({ preventScroll: true });
      return;
    }
    // The opener was re-rendered while the dialog was open. Focus the row that
    // took its place rather than dropping the developer back on <body>.
    if (selector === null) return;
    document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  }

  function show(explicit: boolean): void {
    if (open) return;
    const modal = isModal();
    // As a dialog it opens only when it was actually asked for. The cursor
    // lands on an event for reasons that are not a request to read it — the
    // renderer settling on boot, a keyboard step — and covering the timeline
    // for those is how the panel came to be unusable on a phone in the first
    // place. As a column it has no such cost, so any selection reveals it.
    if (modal && !explicit) return;
    // A developer who closed the panel keeps it closed until they ask again.
    if (dismissed && !explicit) return;
    dismissed = false;

    open = true;
    apply();
    if (modal) {
      muteBackground();
      focusIntoPane();
    }
  }

  function close(): void {
    if (!open) return;
    const wasModal = isModal();
    open = false;
    dismissed = true;
    apply();
    if (wasModal) {
      unmuteBackground();
      restoreFocus();
    }
  }

  closeButton?.addEventListener('click', close);
  openButton?.addEventListener('click', () => show(true));
  scrim.addEventListener('click', close);
  pane.addEventListener('keydown', trapFocus);

  /**
   * Crossing the breakpoint changes what the panel IS, so its state has to be
   * re-decided rather than carried across. Widening reveals a column that has
   * room to exist; narrowing must not leave a modal's background muted.
   */
  media.addEventListener('change', () => {
    if (isModal()) {
      if (open) {
        // It was a column a moment ago; becoming a modal without being asked
        // would cover the graph the developer is looking at.
        open = false;
        apply();
      }
    } else {
      unmuteBackground();
      returnTo = null;
      if (!dismissed) open = true;
      apply();
    }
  });

  apply();

  return {
    show,
    close,
    get isOpen(): boolean {
      return open;
    },
  };
}
