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
 * Put `value` on the clipboard and say so out loud.
 *
 * The single place the clipboard is touched, so the landing page's command
 * blocks and the console's copy rows cannot drift in what they announce or in
 * how they handle a refusal.
 *
 * Resolves `true` when the write succeeded. A denied clipboard permission is a
 * normal outcome, not an error to throw at the caller: it resolves `false` and
 * the caller shows the fallback.
 */
export async function copyText(value: string, label = 'command'): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(value);
    announce(`${label} copied to the clipboard`);
    return true;
  } catch {
    announce('The clipboard is not available. Select the command and copy it.');
    return false;
  }
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

      void copyText(source, label).then((ok) => {
        // A denied clipboard permission must not look like a broken button.
        if (!ok) {
          button.textContent = 'Select and copy';
          return;
        }
        button.textContent = 'Copied';
        window.setTimeout(() => (button.textContent = 'Copy'), SETTLE_MS);
      });
    });
  }
}
