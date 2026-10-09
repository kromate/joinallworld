/**
 * OWNER: foundation (design)
 * The DOM side of the attention system (the decisions are in ./attention.ts): the ring, the bubble, the pill and the
 * slide-in, and the two pure helpers that place a bubble. Apart from attention.ts on purpose: nothing is drawn before the first
 * paint, so the shell fetches this file afterwards (src/app/features/hud/useAttention.ts).
 */
import type { Box, Point, ViewSize } from './attention.ts';

/** Which way is `to` from `from`, as one of eight arrows, and how far (CSS px). Pure. */
export function wayTo(from: Point, to: Point): { far: number; arrow: string } {
  const dx = to.x - from.x, dy = to.y - from.y, far = Math.hypot(dx, dy);
  const turn = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return { far, arrow: ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][((turn % 8) + 8) % 8]! }; // the index is 0..7
}

/** A pointer is worth a bubble only when the target is off-screen or a good way from where the player is looking. Pure. */
export function needsBubble(from: Point, box: Box, view: ViewSize): boolean {
  const off = box.right < 0 || box.bottom < 0 || box.left > view.width || box.top > view.height;
  const to = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
  return off || Math.hypot(to.x - from.x, to.y - from.y) > Math.max(260, Math.min(view.width, view.height) * 0.32);
}

/** Something to ring: an element, or a selector inside the dialog or the root. */
export type AttentionTarget = string | HTMLElement | null | undefined;
export interface Attention {
  point(target: AttentionTarget, options?: { text?: string; from?: Point | null; say?: boolean }): HTMLElement | null | undefined;
  clear(): void;
  announce(text: string, options?: { at?: AttentionTarget; kind?: string }): void;
  arrive(element: HTMLElement | null | undefined, from: Point | null | undefined): void;
  destroy(): void;
}

// `root` is needed whenever there is a document; without a document nothing here touches it.
export function createAttention({ root, dialog }: { root?: ParentNode; dialog?: HTMLDialogElement | null } = {}): Attention {
  const doc = globalThis.document;
  if (!doc?.createElement) return { point() { return undefined; }, clear() {}, announce() {}, arrive() {}, destroy() {} };
  const layer = doc.createElement('div');
  layer.className = 'attn';
  // What is said for screen readers: polite, and separate from the toasts so neither swallows the other.
  const live = doc.createElement('p');
  live.className = 'ui-sr'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  layer.append(live);
  doc.body.append(layer);
  const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const view = (): ViewSize => ({ width: globalThis.innerWidth || 0, height: globalThis.innerHeight || 0 });
  const middle = (): Point => ({ x: view().width / 2, y: view().height * 0.56 });
  const clampTo = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
  const find = (target: AttentionTarget): HTMLElement | null => (typeof target === 'string' ? (dialog?.open && dialog.querySelector<HTMLElement>(target)) || root!.querySelector<HTMLElement>(target) : target) || null;
  const home = () => (dialog?.open ? dialog : doc.body);
  let ringed: HTMLElement | null = null, bubble: HTMLParagraphElement | null = null, said = '';

  function clear(): void {
    ringed?.classList.remove('is-coach');
    ringed = null;
    bubble?.remove(); bubble = null;
  }
  function point(target: AttentionTarget, { text = '', from = null, say = true }: { text?: string; from?: Point | null; say?: boolean } = {}): HTMLElement | null {
    const node = find(target);
    if (node !== ringed) { ringed?.classList.remove('is-coach'); ringed = node; node?.classList.add('is-coach'); }
    if (!node || !text) { bubble?.remove(); bubble = null; if (!node) said = ''; return node; }
    if (say && text !== said) { said = text; live.textContent = text; }
    const box = node.getBoundingClientRect(), at = from || middle();
    if (!needsBubble(at, box, view())) { bubble?.remove(); bubble = null; return node; }
    const to = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }, way = wayTo(at, to), words = `${text} ${way.arrow}`;
    // The same pointer again (the HUD redraws every second): leave the bubble as it is, so it does not start over.
    if (bubble?.textContent === words) return node;
    bubble?.remove();
    bubble = doc.createElement('p');
    bubble.className = 'attn-bubble'; bubble.setAttribute('aria-hidden', 'true');
    bubble.textContent = words;
    // Beside where the player is looking, a step towards the target, and always fully on screen.
    const step = Math.min(120, way.far * 0.25), size = view();
    bubble.style.left = `${Math.round(clampTo(at.x + ((to.x - at.x) / (way.far || 1)) * step, 120, size.width - 120))}px`;
    bubble.style.top = `${Math.round(clampTo(at.y + ((to.y - at.y) / (way.far || 1)) * step, 70, size.height - 110))}px`;
    if (layer.parentNode !== home()) home().append(layer);
    layer.append(bubble);
    return node;
  }
  function announce(text: string, { at = null, kind = 'info' }: { at?: AttentionTarget; kind?: string } = {}): void {
    if (!text) return;
    live.textContent = text;
    const node = find(at), size = view();
    const pill = doc.createElement('p');
    pill.className = `attn-cue is-${kind}`; pill.setAttribute('aria-hidden', 'true');
    pill.textContent = node ? `${text} →` : text;
    layer.querySelector('.attn-cue')?.remove();
    if (layer.parentNode !== home()) home().append(layer);
    layer.append(pill);
    if (node) {
      const box = node.getBoundingClientRect(), gap = 12, frame = layer.getBoundingClientRect();
      const scale = frame.width / layer.offsetWidth || 1;
      const left = box.left - gap * 2, right = size.width - box.right - gap * 2;
      const beside = Math.max(left, right) >= 120;
      pill.style.width = `${Math.min(380, beside ? Math.max(left, right) : size.width - gap * 2) / scale}px`;
      const bounds = { width: pill.offsetWidth * scale, height: pill.offsetHeight * scale };
      let x = (box.left + box.right) / 2, y = box.top - gap - bounds.height / 2;
      if (beside) { x = left >= right ? box.left - gap - bounds.width / 2 : box.right + gap + bounds.width / 2; y = (box.top + box.bottom) / 2; }
      else if (y < gap + bounds.height / 2) y = box.bottom + gap + bounds.height / 2;
      x = clampTo(x, gap + bounds.width / 2, size.width - gap - bounds.width / 2);
      y = clampTo(y, gap + bounds.height / 2, size.height - gap - bounds.height / 2);
      pill.style.left = `${Math.round((x - frame.left) / scale)}px`; pill.style.top = `${Math.round((y - frame.top) / scale)}px`;
      pill.textContent = `${text} ${wayTo({ x, y }, { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }).arrow}`;
    }
    pill.addEventListener('animationend', (event) => { if (event.animationName === 'attn-cue' || event.animationName === 'attn-cue-still') pill.remove(); });
    // The place it happened answers too: one flash of its outline.
    if (node && !reduced()) { node.classList.remove('is-noted'); void node.offsetWidth; node.classList.add('is-noted'); node.addEventListener('animationend', () => node.classList.remove('is-noted'), { once: true }); }
  }
  function arrive(element: HTMLElement | null | undefined, from: Point | null | undefined): void {
    if (!element || !from || reduced()) return;
    const box = element.getBoundingClientRect();
    if (!box.width) return;
    element.style.setProperty('--attn-x', `${Math.round(from.x - (box.left + box.width / 2))}px`);
    element.style.setProperty('--attn-y', `${Math.round(from.y - (box.top + box.height / 2))}px`);
    element.classList.remove('attn-arrive'); void element.offsetWidth; element.classList.add('attn-arrive');
    element.addEventListener('animationend', () => element.classList.remove('attn-arrive'), { once: true });
  }
  return { point, clear, announce, arrive, destroy() { clear(); layer.remove(); } };
}
