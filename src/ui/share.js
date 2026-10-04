/**
 * OWNER: growth
 * Sharing from the browser: paint the picture card on a canvas, then hand the picture and the text
 * to the phone's own share sheet — or, where that is not available, offer WhatsApp, X, copy and
 * save. The words and the card's data come from src/game/share-model.js (pure, tested); this file
 * is only the DOM side. Nothing is sent to anyone by the game: the player's own apps do the sending.
 *
 * The card is drawn once per share, on demand, from the game's own colours and the page's font.
 * No image is downloaded for it and no loop runs.
 */
import { shareCard, shareText, whatsappUrl, xUrl } from '../game/share-model.ts';

export const CARD_SIZE = 1080;
const FONT = '"DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Break `text` into at most `max` lines that fit `width`. */
function wrap(ctx, text, width, max = 2) {
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) { line = next; continue; }
    lines.push(line); line = word;
    if (lines.length === max - 1) break;
  }
  const rest = words.slice(lines.join(' ').split(/\s+/).filter(Boolean).length).join(' ');
  if (rest) { let last = rest; while (last.length > 1 && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1); lines.push(last === rest ? rest : `${last}…`); }
  return lines.slice(0, max);
}

function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/**
 * Paint a card. @param {HTMLCanvasElement} canvas  @param {ReturnType<typeof shareCard>} card
 */
export function paintCard(canvas, card) {
  const size = CARD_SIZE, ctx = canvas.getContext('2d');
  canvas.width = size; canvas.height = size;
  const sky = ctx.createLinearGradient(0, 0, 0, size);
  sky.addColorStop(0, '#1d4a34'); sky.addColorStop(1, '#122b1f');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, size, size);
  // A skyline of small houses along the bottom: the game's own shapes, drawn here.
  const houses = [[60, 150, '#256b45'], [230, 210, '#2f7d52'], [420, 130, '#1f5c3b'], [570, 240, '#2b7049'], [790, 170, '#256b45'], [930, 120, '#1f5c3b']];
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
  ctx.fillStyle = '#20232c'; ctx.font = `800 84px ${FONT}`;
  let y = 300;
  for (const line of wrap(ctx, card.headline, size - 240, 2)) { ctx.fillText(line, 120, y); y += 96; }
  if (card.squares.length) {
    const box = Math.min(96, Math.floor((size - 240 - (card.squares.length - 1) * 18) / card.squares.length));
    card.squares.forEach((on, index) => { ctx.fillStyle = on ? '#2f9e5b' : '#dfe4e2'; rounded(ctx, 120 + index * (box + 18), y - 30, box, box, 18); ctx.fill(); });
    y += box + 40;
  }
  ctx.fillStyle = '#3c4654'; ctx.font = `500 46px ${FONT}`;
  for (const line of card.lines.slice(0, 3)) { ctx.fillText(wrap(ctx, line, size - 240, 1)[0] ?? '', 120, y + 20); y += 64; }
  ctx.fillStyle = '#ffffff'; ctx.font = `700 44px ${FONT}`; ctx.fillText(card.footer, 70, size - 62);
  return canvas;
}

const toBlob = (canvas) => new Promise((resolve) => { try { canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.86); } catch { resolve(null); } });

/**
 * Everything a share needs, prepared once: the text, the link and the picture.
 * @param {object} facts  the server's facts for this share  @param {string} link  absolute URL of the share page
 * @returns {Promise<{ text: string, link: string, file: File | null, url: string | null, whatsapp: string, x: string }>}
 */
export async function prepareShare(facts, link, doc = globalThis.document) {
  const text = shareText(facts, link);
  let file = null, url = null;
  try {
    const blob = await toBlob(paintCard(doc.createElement('canvas'), shareCard(facts)));
    if (blob) { file = new File([blob], 'allworld.jpg', { type: 'image/jpeg' }); url = URL.createObjectURL(blob); }
  } catch { /* no canvas: the text alone is still a share */ }
  return { text, link, file, url, whatsapp: whatsappUrl(text), x: xUrl(text) };
}

/** Can this browser hand a picture to the share sheet? */
export const canShareFiles = (file, nav = globalThis.navigator) => Boolean(file && typeof nav?.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files: [file] }));

/**
 * Open the phone's share sheet. Must be called from a tap. Resolves 'shared', 'cancelled' (the
 * player closed the sheet) or 'unavailable' (use the fallback buttons).
 */
export async function systemShare(prepared, nav = globalThis.navigator) {
  if (typeof nav?.share !== 'function') return 'unavailable';
  try {
    await nav.share(canShareFiles(prepared.file, nav) ? { files: [prepared.file], text: prepared.text } : { text: prepared.text });
    return 'shared';
  } catch (error) { return error?.name === 'AbortError' ? 'cancelled' : 'unavailable'; }
}

export async function copyText(text, nav = globalThis.navigator) {
  try { await nav.clipboard.writeText(text); return true; } catch { return false; }
}
