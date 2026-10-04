/**
 * OWNER: foundation (design)
 * The select of the control kit (styles: ./controls.css). enhanceSelects(root) turns every native
 * <select> inside `root` into a button and a listbox popover in the game's own style, and keeps the
 * native element — hidden — as the value: choosing an option sets select.value and fires `input`
 * and `change` on it, so a panel's code and a <form> work exactly as before.
 *
 * WHEN THE NATIVE PICKER IS KEPT. On a small touch screen (coarse pointer, at most 720px wide) the
 * platform's own picker is the better control — a large wheel or sheet the player already knows,
 * with the screen reader support of the system — so there the <select> is left alone and only
 * styled like every other field (controls.css). Everywhere else it becomes the listbox.
 *
 * KEYBOARD  on the button: Enter, Space, ↓ or ↑ open (↑ on the last option). In the list: ↑ ↓ move,
 * Home / End jump, typing letters goes to the next option that starts with them, Enter or Space
 * chooses, Escape closes without choosing, Tab closes and moves on. Focus stays on the button
 * (role="combobox", aria-activedescendant names the option), which is the pattern screen readers
 * announce correctly.
 *
 * Nothing here keeps time; the list is positioned once when it opens and closed by a scroll, a
 * resize, a click elsewhere or the sheet being redrawn.
 */
const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
/** An option as the keyboard helpers see it. */
export interface ListOption { label: string; disabled?: boolean }
/** The parts of `window` keepsNative reads. */
export interface ViewportLike { matchMedia?: (query: string) => { matches: boolean }; innerWidth?: number }
interface OpenList { list: HTMLUListElement; button: HTMLButtonElement; off(): void }

let serial = 0, openList: OpenList | null = null;

/** Should this device keep the platform picker? */
export const keepsNative = (win: ViewportLike = globalThis): boolean => win.matchMedia?.('(pointer: coarse)').matches === true && (win.innerWidth || 0) <= 720;

/** The index of the next enabled option from `from` in direction `step` (no wrap). Pure. */
export function nextEnabled(options: readonly { disabled?: boolean }[], from: number, step: number): number {
  for (let i = from + step; i >= 0 && i < options.length; i += step) if (!options[i]!.disabled) return i;
  return from;
}
/** The option a typed prefix goes to: the next one after `from` whose label starts with it. Pure. */
export function typeAhead(options: readonly ListOption[], from: number, typed: string): number {
  const want = typed.toLowerCase();
  for (let n = 1; n <= options.length; n += 1) {
    const i = (from + n) % options.length;
    if (!options[i]!.disabled && options[i]!.label.toLowerCase().startsWith(want)) return i;
  }
  return from;
}

function close(focus = false): void {
  if (!openList) return;
  const { list, button, off } = openList;
  openList = null;
  off(); list.remove();
  button.setAttribute('aria-expanded', 'false'); button.removeAttribute('aria-activedescendant');
  if (focus) button.focus();
}

function enhance(select: HTMLSelectElement): void {
  const doc = select.ownerDocument, id = `ui-select-${serial += 1}`;
  const button = doc.createElement('button');
  button.type = 'button'; button.className = 'ui-select';
  button.setAttribute('role', 'combobox'); button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', id);
  const name = select.getAttribute('aria-label') || select.closest('label')?.firstChild?.textContent?.trim();
  if (name) button.setAttribute('aria-label', name);
  button.innerHTML = `<span></span>${CHEVRON}`;
  button.disabled = select.disabled;
  const options = () => [...select.options].map((option) => ({ value: option.value, label: option.textContent ?? '', disabled: option.disabled }));
  const show = () => { const chosen = select.options[select.selectedIndex]; button.firstChild!.textContent = chosen ? chosen.textContent : ''; button.classList.toggle('is-empty', !chosen || chosen.value === ''); };
  show();
  select.classList.add('ui-select-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
  select.dataset.enhanced = '1';
  select.after(button);
  select.addEventListener('change', show);
  // A label around the select would otherwise send its click to the hidden native control.
  select.closest('label')?.addEventListener('click', (event) => { const target = event.target as Element; if (target.closest('.ui-select') !== button && !target.closest('.ui-listbox')) { event.preventDefault(); button.focus(); } });

  let active = -1, typed = '', typedAt = 0;
  function choose(index: number): void {
    const all = options();
    if (index < 0 || all[index]?.disabled) return;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    close(true);
    show();
    if (changed) { select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  function mark(list: HTMLUListElement, index: number): void {
    active = index;
    for (const item of list.children as HTMLCollectionOf<HTMLElement>) item.classList.toggle('is-active', Number(item.dataset.index) === index);
    const item = list.children[index] as HTMLElement | undefined;
    if (item) { button.setAttribute('aria-activedescendant', item.id); item.scrollIntoView({ block: 'nearest' }); }
  }
  function open(start?: number): void {
    if (button.disabled) return;
    close();
    const all = options(), list = doc.createElement('ul');
    list.className = 'ui-listbox'; list.id = id; list.setAttribute('role', 'listbox');
    if (name) list.setAttribute('aria-label', name);
    all.forEach((option, index) => {
      const item = doc.createElement('li');
      item.id = `${id}-${index}`; item.dataset.index = String(index); item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === select.selectedIndex));
      if (option.disabled) item.setAttribute('aria-disabled', 'true');
      item.textContent = option.label;
      list.append(item);
    });
    // In a modal sheet the list must live inside the dialog to be above it.
    (button.closest('dialog') || doc.body).append(list);
    const box = button.getBoundingClientRect(), tall = Math.min(list.scrollHeight + 2, 320, globalThis.innerHeight * 0.46);
    const below = globalThis.innerHeight - box.bottom - 12, up = below < Math.min(tall, 180) && box.top > below;
    list.style.left = `${Math.round(box.left)}px`; list.style.width = `${Math.round(box.width)}px`;
    list.style.maxHeight = `${Math.round(Math.max(120, Math.min(tall, up ? box.top - 12 : below)))}px`;
    if (up) list.style.bottom = `${Math.round(globalThis.innerHeight - box.top + 6)}px`; else list.style.top = `${Math.round(box.bottom + 6)}px`;
    list.addEventListener('pointerdown', (event) => event.preventDefault()); // keep focus on the button
    list.addEventListener('click', (event) => { const item = (event.target as Element).closest<HTMLElement>('[role=option]'); if (item) choose(Number(item.dataset.index)); });
    list.addEventListener('pointermove', (event) => { const item = (event.target as Element).closest<HTMLElement>('[role=option]'); if (item && Number(item.dataset.index) !== active) mark(list, Number(item.dataset.index)); });
    const outside = (event: Event) => { if (!list.contains(event.target as Node) && !button.contains(event.target as Node)) close(); };
    const away = (event: Event) => { if (!list.contains(event.target as Node)) close(); };
    doc.addEventListener('pointerdown', outside, true); globalThis.addEventListener('scroll', away, true); globalThis.addEventListener('resize', away);
    openList = { list, button, off() { doc.removeEventListener('pointerdown', outside, true); globalThis.removeEventListener('scroll', away, true); globalThis.removeEventListener('resize', away); } };
    button.setAttribute('aria-expanded', 'true');
    mark(list, start ?? Math.max(0, select.selectedIndex));
  }
  button.addEventListener('click', () => { if (openList?.button === button) close(); else open(); });
  button.addEventListener('blur', () => { if (openList?.button === button) close(); });
  button.addEventListener('keydown', (event) => {
    const all = options(), current = openList, isOpen = current?.button === button;
    const key = event.key;
    if (!isOpen) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') { event.preventDefault(); open(); }
      return;
    }
    const list = current!.list; // isOpen: there is a list
    // While the list is open its keys are its own: they never reach the game's shortcuts.
    event.stopPropagation();
    if (key === 'Escape') { event.preventDefault(); close(true); }
    else if (key === 'ArrowDown') { event.preventDefault(); mark(list, nextEnabled(all, active, 1)); }
    else if (key === 'ArrowUp') { event.preventDefault(); mark(list, nextEnabled(all, active, -1)); }
    else if (key === 'Home') { event.preventDefault(); mark(list, nextEnabled(all, -1, 1)); }
    else if (key === 'End') { event.preventDefault(); mark(list, nextEnabled(all, all.length, -1)); }
    else if (key === 'Enter' || key === ' ') { event.preventDefault(); choose(active); }
    else if (key === 'Tab') close();
    else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const at = Date.now();
      typed = at - typedAt > 700 ? key : typed + key; typedAt = at;
      mark(list, typeAhead(all, typed.length > 1 ? active - 1 : active, typed));
    }
  });
}

/** Enhance every native select under `root` that has not been yet. A redraw that removed an open list's button closes it. */
export function enhanceSelects(root: ParentNode | null | undefined): void {
  if (openList && !openList.button.isConnected) close();
  if (!root?.querySelectorAll || keepsNative()) return;
  for (const select of root.querySelectorAll<HTMLSelectElement>('select:not([data-enhanced]):not([multiple])')) enhance(select);
}
