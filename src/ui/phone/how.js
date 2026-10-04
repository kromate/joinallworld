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
import { esc } from '../dom.js';
import { rulesList, toggled } from './logic.js';

let opened = new Set();

/** Is this disclosure open? */
export const isOpen = (id) => opened.has(id);

/**
 * @param {string} id     unique across the game, e.g. 'bank-rent'
 * @param {string} body   ready-made HTML (already escaped by the caller)
 * @param {string} label  the summary text
 * @param {boolean} page  true when it sits on the page itself rather than inside a white card
 */
export const how = (id, body, label = 'How it works', page = false) => `<details class="ph-how${page ? ' is-page' : ''}" data-how="${esc(id)}"${opened.has(id) ? ' open' : ''}><summary>${esc(label)}</summary><div class="ph-how-body">${body}</div></details>`;

/** The body of a disclosure as a list of plain-text rules (each one escaped here). */
export const rules = (lines) => { const list = rulesList(lines); return list.length ? `<ul>${list.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>` : ''; };

export function bindHow(root, api) {
  for (const node of root.querySelectorAll('details[data-how]')) {
    node.addEventListener('toggle', () => {
      const id = node.dataset.how, next = toggled(opened, id, node.open);
      if (next === opened) return; // the toggle a browser raises for markup that arrived open
      opened = next;
      const focused = node.contains(document.activeElement);
      api.refresh();
      if (focused) document.querySelector(`details[data-how="${CSS.escape(id)}"]>summary`)?.focus({ preventScroll: true });
    });
  }
}
