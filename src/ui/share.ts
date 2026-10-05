/**
 * OWNER: growth
 * Sharing from the browser: paint the picture card on a canvas, then hand the picture and the text
 * to the phone's own share sheet — or, where that is not available, offer WhatsApp, X, copy and
 * save. The words and the card's data come from src/game/share-model.ts (pure, tested); this file
 * is only the DOM side. Nothing is sent to anyone by the game: the player's own apps do the sending.
 *
 * The card is drawn once per share, on demand, from the game's own colours and the page's font.
 * No image is downloaded for it and no loop runs.
 */
import { shareCard, shareText, whatsappUrl, xUrl, type ShareCard } from '../game/share-model.ts';

/** What prepareShare produces. */
export interface PreparedShare { text: string; link: string; file: File | null; url: string | null; whatsapp: string; x: string }
/** The parts of `navigator` the share sheet uses; a browser may have none of them. */
export type ShareNavigator = Partial<Pick<Navigator, 'share' | 'canShare'>>;

export const CARD_SIZE = 1080;
const FONT = '"DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Greedy word wrap: the lines of `text` at the context's current font, never breaking inside a word. */
export function wordLines(measure: (text: string) => number, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (!line || measure(next) <= width) line = next; else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}
/**
 * The largest of `sizes` at which `text` fits `max` lines of `width` without a word being cut. A name too long even for the
 * smallest size is shortened with an ellipsis as a last resort. `font(size)` is the canvas font string.
 */
export function fitText(ctx: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>, text: string, width: number, max: number, sizes: readonly number[], font: (size: number) => string): { lines: string[]; size: number } {
  for (const size of sizes) {
    ctx.font = font(size);
    const lines = wordLines((value) => ctx.measureText(value).width, text, width);
    if (lines.length <= max && lines.every((line) => ctx.measureText(line).width <= width)) return { lines, size };
  }
  const size = sizes[sizes.length - 1] ?? 40;
  ctx.font = font(size);
  const lines = wordLines((value) => ctx.measureText(value).width, text, width);
  const kept = lines.slice(0, max);
  const last = kept.length === max ? lines.slice(max - 1).join(' ') : kept[kept.length - 1] ?? '';
  let cut = last;
  if (ctx.measureText(cut).width > width) {
    while (cut.length > 1 && ctx.measureText(`${cut.trimEnd()}…`).width > width) cut = cut.slice(0, -1);
    cut = `${cut.trimEnd()}…`;
  }
  if (kept.length) kept[kept.length - 1] = cut;
  return { lines: kept, size };
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/**
 * Paint a card onto a canvas and return it.
 */
export function paintCard(canvas: HTMLCanvasElement, card: ShareCard): HTMLCanvasElement {
  // A canvas without a 2D context throws here, as before (prepareShare catches it).
  const size = CARD_SIZE, ctx = canvas.getContext('2d')!;
  canvas.width = size; canvas.height = size;
  const sky = ctx.createLinearGradient(0, 0, 0, size);
  sky.addColorStop(0, '#1d4a34'); sky.addColorStop(1, '#122b1f');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, size, size);
  // A skyline of small houses along the bottom: the game's own shapes, drawn here.
  const houses: [number, number, string][] = [[60, 150, '#256b45'], [230, 210, '#2f7d52'], [420, 130, '#1f5c3b'], [570, 240, '#2b7049'], [790, 170, '#256b45'], [930, 120, '#1f5c3b']];
  for (const [x, h, colour] of houses) {
    ctx.fillStyle = colour; ctx.fillRect(x, size - 150 - h, 150, h + 150);
    ctx.beginPath(); ctx.moveTo(x - 14, size - 150 - h); ctx.lineTo(x + 75, size - 150 - h - 70); ctx.lineTo(x + 164, size - 150 - h); ctx.closePath(); ctx.fillStyle = '#e8a643'; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(x + 28, size - 110 - h, 34, 34); ctx.fillRect(x + 88, size - 110 - h, 34, 34);
  }
  ctx.fillStyle = 'rgba(12,28,20,.72)'; ctx.fillRect(0, size - 150, size, 150);
  // The panel with the words.
  ctx.fillStyle = 'rgba(255,255,255,.96)'; rounded(ctx, 70, 110, size - 140, 600, 44); ctx.fill();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#256b45'; ctx.font = `700 38px ${FONT}`; ctx.fillText(card.kicker, 120, 195);
  ctx.fillStyle = '#20232c';
  // The headline takes two lines; a long place name makes it a little smaller instead of cutting it off.
  const head = fitText(ctx, card.headline, size - 240, 2, [84, 76, 68, 60, 52, 46], (px) => `800 ${px}px ${FONT}`);
  ctx.font = `800 ${head.size}px ${FONT}`;
  let y = 300;
  for (const line of head.lines) { ctx.fillText(line, 120, y); y += Math.round(head.size * 1.14); }
  if (card.squares.length) {
    const box = Math.min(96, Math.floor((size - 240 - (card.squares.length - 1) * 18) / card.squares.length));
    card.squares.forEach((on, index) => { ctx.fillStyle = on ? '#2f9e5b' : '#dfe4e2'; rounded(ctx, 120 + index * (box + 18), y - 30, box, box, 18); ctx.fill(); });
    y += box + 40;
  }
  ctx.fillStyle = '#3c4654'; ctx.font = `500 46px ${FONT}`;
  for (const line of card.lines.slice(0, 3)) {
    const fit = fitText(ctx, line, size - 240, 1, [46, 42, 38, 34], (px) => `500 ${px}px ${FONT}`);
    ctx.font = `500 ${fit.size}px ${FONT}`; ctx.fillText(fit.lines[0] ?? '', 120, y + 20); y += 64;
  }
  ctx.fillStyle = '#ffffff'; ctx.font = `700 44px ${FONT}`; ctx.fillText(card.footer, 70, size - 62);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((resolve) => { try { canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.86); } catch { resolve(null); } });

/**
 * Everything a share needs, prepared once: the text, the link and the picture.
 * `facts` is the server's facts for this share; `link` the absolute URL of the share page.
 */
export async function prepareShare(facts: unknown, link: string, doc: Document = globalThis.document): Promise<PreparedShare> {
  const text = shareText(facts, link);
  let file: File | null = null, url: string | null = null;
  try {
    const blob = await toBlob(paintCard(doc.createElement('canvas'), shareCard(facts)));
    if (blob) { file = new File([blob], 'allworld.jpg', { type: 'image/jpeg' }); url = URL.createObjectURL(blob); }
  } catch { /* no canvas: the text alone is still a share */ }
  return { text, link, file, url, whatsapp: whatsappUrl(text), x: xUrl(text) };
}

/** Can this browser hand a picture to the share sheet? */
export const canShareFiles = (file: File | null | undefined, nav: ShareNavigator = globalThis.navigator): boolean => Boolean(file && typeof nav?.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files: [file] }));

/**
 * Open the phone's share sheet. Must be called from a tap. Resolves 'shared', 'cancelled' (the
 * player closed the sheet) or 'unavailable' (use the fallback buttons).
 */
export async function systemShare(prepared: Pick<PreparedShare, 'file' | 'text'>, nav: ShareNavigator = globalThis.navigator): Promise<'shared' | 'cancelled' | 'unavailable'> {
  if (typeof nav?.share !== 'function') return 'unavailable';
  try {
    await nav.share(prepared.file && canShareFiles(prepared.file, nav) ? { files: [prepared.file], text: prepared.text } : { text: prepared.text });
    return 'shared';
  } catch (error) { return (error as { name?: unknown } | null)?.name === 'AbortError' ? 'cancelled' : 'unavailable'; }
}

/** The old way: select the text of a hidden field and ask the document to copy it. Works inside a click where the clipboard API is refused. */
export function legacyCopy(text: string, doc: Pick<Document, 'createElement' | 'body' | 'execCommand'> & Partial<Pick<Document, 'querySelector'>> | undefined = globalThis.document): boolean {
  if (!doc?.body || typeof doc.execCommand !== 'function') return false;
  const field = doc.createElement('textarea');
  field.value = text; field.setAttribute('readonly', ''); field.setAttribute('aria-hidden', 'true'); field.tabIndex = -1;
  Object.assign(field.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
  // Inside the open modal sheet when there is one: everything outside a modal dialog is inert, and an inert field cannot be selected.
  (doc.querySelector?.('dialog[open]') ?? doc.body).append(field);
  try { field.select(); field.setSelectionRange?.(0, text.length); return doc.execCommand('copy'); } catch { return false; } finally { field.remove(); }
}

/** Copy `text`. Called from a click: the clipboard API first, then the hidden-field fallback when the browser refuses it (a permission, an insecure page). */
export async function copyText(text: string, nav: { clipboard?: Pick<Clipboard, 'writeText'> } | undefined = globalThis.navigator, doc?: Pick<Document, 'createElement' | 'body' | 'execCommand'> & Partial<Pick<Document, 'querySelector'>>): Promise<boolean> {
  try { if (nav?.clipboard?.writeText) { await nav.clipboard.writeText(text); return true; } } catch { /* refused: try the old way */ }
  return legacyCopy(text, doc ?? globalThis.document);
}
