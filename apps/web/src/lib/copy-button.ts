/**
 * Copy-to-clipboard for the `.fs-copy-row` command blocks.
 *
 * Two routes had their own copy of this — Setup and the session list's empty
 * state — which is two places for one behaviour to drift. It is one place now,
 * and it announces its result: swapping a button's label from `Copy` to
 * `Copied` is invisible to a screen reader, because a label changing under a
 * button that still has focus is not an announcement. A polite live region is.
 */

/** How long the confirmation stands before the button reads `Copy` again. */
const SETTLE_MS = 1400;

const ANNOUNCER_ID = 'fs-copy-announcer';

function announcer(): HTMLElement {
  const existing = document.getElementById(ANNOUNCER_ID);
  if (existing !== null) return existing;

  const node = document.createElement('p');
  node.id = ANNOUNCER_ID;
  node.className = 'fs-visually-hidden';
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  document.body.append(node);
  return node;
}

function announce(message: string): void {
  const node = announcer();
  // Re-announce an identical message: assistive tech ignores a live region
  // whose text did not change, and copying twice deserves two confirmations.
  node.textContent = '';
  window.setTimeout(() => (node.textContent = message), 40);
}

/**
 * Wire every `[data-copy]` button on the page.
 *
 * The source is the `<code>` immediately before the button, which is what the
 * `.fs-copy-row` markup guarantees.
 */
export function mountCopyButtons(root: ParentNode = document): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    button.addEventListener('click', () => {
      const source = button.previousElementSibling?.textContent ?? '';
      const label = button.dataset['copyLabel'] ?? 'command';

      void navigator.clipboard?.writeText(source).then(
        () => {
          button.textContent = 'Copied';
          announce(`${label} copied to the clipboard`);
          window.setTimeout(() => (button.textContent = 'Copy'), SETTLE_MS);
        },
        // A denied clipboard permission must not look like a broken button.
        () => {
          button.textContent = 'Select and copy';
          announce('The clipboard is not available. Select the command and copy it.');
        },
      );
    });
  }
}
