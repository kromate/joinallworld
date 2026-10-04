/**
 * "How it works" — the one disclosure every app uses for its longer rules.
 *
 * An app shows ONE short line of what matters now and folds the rest away behind a native
 * <details>. Costs and deadlines never go in here: they stay on the card itself.
 *
 *   how('bank-rent', '<p>…</p>')                     the markup (id is unique per disclosure)
 *   bindHow(root, api)                               call from the panel's bind()
 *
 * Panels are redrawn by replacing innerHTML whenever their HTML string changes, which would close
 * a <details> the player had opened. So the open ids are kept here, `open` is written into the
 * markup, and bindHow() records every toggle (mouse, touch, Enter and Space all raise it) and
 * redraws at once so the keyboard stays on the summary.
 */
import './how.css';
import { esc } from '../dom.ts';
import { rulesList, toggled } from './logic.ts';

let opened = new Set<string>();

/** Is this disclosure open? */
export const isOpen = (id: string): boolean => opened.has(id);

/**
 * @param {string} id     unique across the game, e.g. 'bank-rent'
 * @param {string} body   ready-made HTML (already escaped by the caller)
 * @param {string} label  the summary text
 * @param {boolean} page  true when it sits on the page itself rather than inside a white card
 */
export const how = (id: string, body: string, label = 'How it works', page = false): string => `<details class="ph-how${page ? ' is-page' : ''}" data-how="${esc(id)}"${opened.has(id) ? ' open' : ''}><summary>${esc(label)}</summary><div class="ph-how-body">${body}</div></details>`;

/** The body of a disclosure as a list of plain-text rules (each one escaped here). */
export const rules = (lines: unknown): string => { const list = rulesList(lines); return list.length ? `<ul>${list.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>` : ''; };

/** The one thing bindHow needs of a panel's api. */
export interface HowApi { refresh(): void }

export function bindHow(root: ParentNode, api: HowApi): void {
  for (const node of root.querySelectorAll<HTMLDetailsElement>('details[data-how]')) {
    node.addEventListener('toggle', () => {
      const id = node.dataset.how ?? '', next = toggled(opened, id, node.open);
      if (next === opened) return; // the toggle a browser raises for markup that arrived open
      opened = next;
      const focused = node.contains(document.activeElement);
      api.refresh();
      if (focused) document.querySelector<HTMLElement>(`details[data-how="${CSS.escape(id)}"]>summary`)?.focus({ preventScroll: true });
    });
  }
}
