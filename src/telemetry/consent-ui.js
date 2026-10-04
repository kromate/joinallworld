/**
 * The consent sheet (a lazy chunk: fetched only when it has to be shown).
 *
 * A centred modal sheet, not a corner banner: it is shown once, early in play, and the game waits
 * for the answer. Accept and Reject are the same button with different words — same size, same
 * style, side by side — and there is no pre-selected or "recommended" choice. "What we collect"
 * opens the full text in place. From Settings the same sheet shows the choice in force and lets
 * the player change it.
 *
 * It is a native <dialog> opened with showModal(), so it sits above the game's own sheet and the
 * rest of the page cannot be reached with the keyboard while it is open. If the game opens its own
 * dialog afterwards (character creation does, by itself), this one is raised above it again.
 */
import { CONSENT, whatWeCollect } from './what-we-collect.js';

const STYLE = `
#jaw-consent{border:0;padding:0;border-radius:20px;width:min(460px,calc(100% - 24px));max-height:min(88dvh,720px);background:#fff;color:var(--c-ink,#14231b);font-family:var(--font,system-ui,sans-serif);box-shadow:0 24px 60px #0006;overflow:hidden}
#jaw-consent[open]{display:flex;flex-direction:column}
#jaw-consent::backdrop{background:#0c1a14a6;backdrop-filter:blur(3px)}
#jaw-consent *{box-sizing:border-box}
.jaw-consent-body{padding:20px 20px 8px;overflow-y:auto;overscroll-behavior:contain}
.jaw-consent-body h2{margin:0 0 10px;font-size:19px;line-height:1.25}
.jaw-consent-body h3{margin:14px 0 4px;font-size:13px}
.jaw-consent-body p,.jaw-consent-body li{margin:0 0 8px;font-size:14px;line-height:1.45}
.jaw-consent-body ul{margin:0 0 4px;padding-left:18px}
.jaw-consent-body [role=status]{font-weight:600}
.jaw-consent-more{border:0;background:none;padding:6px 0;min-height:44px;color:inherit;font:600 14px var(--font,system-ui,sans-serif);text-decoration:underline;cursor:pointer}
.jaw-consent-foot{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 20px 20px;border-top:1px solid #0000001a}
.jaw-consent-foot.is-single{grid-template-columns:1fr}
.jaw-consent-foot button{min-height:48px;border-radius:999px;border:2px solid var(--c-green-dark,#183b2a);background:#fff;color:var(--c-green-dark,#183b2a);font:700 15px var(--font,system-ui,sans-serif);cursor:pointer}
.jaw-consent-foot button:hover{background:#183b2a14}
#jaw-consent button:focus-visible{outline:3px solid #e39a1c;outline-offset:2px}
`;

const esc = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

/** The sheet's HTML for a given state (pure: exported for the tests). */
export function consentHtml({ source = 'sheet', state = {}, open = false, host = '' } = {}) {
  const details = whatWeCollect({ host }).map((section) => `<h3>${esc(section.heading)}</h3><ul>${section.lines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>`).join('');
  const more = `<button type="button" class="jaw-consent-more" data-consent="more" aria-expanded="${open}" aria-controls="jaw-consent-details">${esc(open ? CONSENT.less : CONSENT.more)}</button><div id="jaw-consent-details" ${open ? '' : 'hidden'}>${details}</div>`;
  const choosing = source !== 'settings';
  const blocked = state.signal ? CONSENT.signal : state.under18 ? CONSENT.under18 : !state.analytics && !state.pending ? `${CONSENT.notConfigured}${state.errors ? '' : ` ${CONSENT.noErrors}`}` : '';
  if (choosing && !blocked) {
    // Reject first in the document only because one of the two has to be; both are the same control.
    return `<div class="jaw-consent-body"><h2 id="jaw-consent-title">${esc(CONSENT.title)}</h2><p>${esc(CONSENT.ask)}</p><p>${esc(CONSENT.optional)}</p>${more}</div>
      <div class="jaw-consent-foot"><button type="button" data-consent="denied">${esc(CONSENT.reject)}</button><button type="button" data-consent="granted">${esc(CONSENT.accept)}</button></div>`;
  }
  const status = blocked || (state.consent === 'granted' ? CONSENT.on : state.consent === 'denied' ? CONSENT.off : CONSENT.unset);
  const change = blocked ? '' : state.consent === 'granted' ? `<button type="button" data-consent="denied">${esc(CONSENT.turnOff)}</button>` : `<button type="button" data-consent="granted">${esc(CONSENT.turnOn)}</button>`;
  return `<div class="jaw-consent-body"><h2 id="jaw-consent-title">${esc(CONSENT.settingsTitle)}</h2><p role="status">${esc(status)}</p>${blocked ? '' : `<p>${esc(CONSENT.optional)}</p>`}${more}</div>
    <div class="jaw-consent-foot${change ? '' : ' is-single'}">${change}<button type="button" data-consent="close">${esc(CONSENT.close)}</button></div>`;
}

/**
 * Show the sheet. Resolves with the choice ('granted' | 'denied') or null when it was only closed.
 * @param {{ document: Document, source?: 'sheet' | 'settings', state?: object, host?: string, onChoice?: (choice: string) => void }} options
 */
export function showConsent({ document: doc, source = 'sheet', state = {}, host = '', onChoice = () => {} }) {
  return new Promise((resolve) => {
    if (!doc.getElementById('jaw-consent-style')) { const style = doc.createElement('style'); style.id = 'jaw-consent-style'; style.textContent = STYLE; doc.head.append(style); }
    doc.getElementById('jaw-consent')?.remove();
    const dialog = doc.createElement('dialog');
    dialog.id = 'jaw-consent';
    dialog.setAttribute('aria-labelledby', 'jaw-consent-title');
    let open = false;
    const draw = () => { dialog.innerHTML = consentHtml({ source, state, open, host }); };
    draw();
    doc.body.append(dialog);
    const returnFocus = doc.activeElement;
    const raise = () => { if (dialog.isConnected) { dialog.close(); dialog.showModal(); } };
    // The game's own sheet opened after this one: come back to the front, so the question can be answered.
    const other = doc.getElementById('life-dialog');
    const watch = other && typeof MutationObserver === 'function' ? new MutationObserver(() => { if (other.open && dialog.open) raise(); }) : null;
    watch?.observe(other, { attributes: true, attributeFilter: ['open'] });
    const finish = (choice) => {
      watch?.disconnect();
      dialog.close(); dialog.remove();
      if (choice) onChoice(choice);
      try { returnFocus?.focus?.({ preventScroll: true }); } catch { /* the element is gone */ }
      resolve(choice);
    };
    // The first question has two answers and no way round them; from Settings, Escape simply closes.
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); if (source === 'settings') finish(null); });
    dialog.addEventListener('click', (event) => {
      const action = event.target.closest?.('[data-consent]')?.dataset.consent;
      if (!action) return;
      if (action === 'more') { open = !open; draw(); dialog.querySelector('[data-consent="more"]')?.focus(); return; }
      finish(action === 'close' ? null : action);
    });
    dialog.showModal();
    dialog.querySelector('h2')?.setAttribute('tabindex', '-1');
    dialog.querySelector('h2')?.focus();
  });
}
