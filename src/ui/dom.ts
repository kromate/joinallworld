// Small string-template helpers shared by the shell and every panel.
import { glyph } from './phone/icons.ts';
import { iconFor, withGlyphs, stripLeadEmoji } from './icon-map.ts';

/** Escape text for HTML content and attribute values. Use it on EVERY dynamic value. */
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
export const money = (value: unknown): string => `₦${Math.round(Number(value) || 0).toLocaleString('en-NG')}`;
// The non-null assertion keeps the original: an empty id throws a TypeError rather than returning ''.
export const cap = (id: string): string => `${id[0]!.toUpperCase()}${id.slice(1)}`;
/** A version-4 UUID that also works outside secure contexts (plain HTTP on a LAN), where crypto.randomUUID is missing. */
export function uuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  // The array is 16 long, so indexes 6 and 8 always exist.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** JSON for a data-payload / data-params attribute. */
export const json = (value: unknown): string => esc(JSON.stringify(value));

/** Small interface marks that are not part of the app icon set. Everything else comes from ./phone/icons.js. */
const ICONS: Record<string, string> = {
  chevron: '<path d="m6 9 6 6 6-6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.2C3.5 8.1 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  chat: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
};
/** An inline SVG icon by name: one of the marks above, else a glyph of the game's icon set (home, map, phone, buy, back, close, …). Sized by the CSS of where it sits. */
export const icon = (name: string): string => (ICONS[name] ? `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>` : glyph(name));

/**
 * What a screen shows while its code or its data is on the way: grey bars in the shape of the
 * content, never a spinner page. `rows` is how many list rows to hint at.
 */
export const skeleton = (rows = 3, label = 'Loading'): string => `<div class="ui-skeleton" role="status" aria-label="${esc(label)}"><i class="is-hero"></i>${'<i></i>'.repeat(rows)}</div>`;

/** A section title inside an app: small, quiet, above a card or a list. */
export const section = (title: unknown, extra = ''): string => `<h3 class="ui-section">${esc(title)}${extra}</h3>`;

/** A glyph that sizes itself to the text around it (1.2em): for a glyph inside a line, a heading, a chip or a button label. */
export const mark = (name: string): string => glyph(name, 'ui-glyph');

/**
 * The one empty state every panel uses: what is missing, and the next step.
 * `icon` is a glyph name ('search', 'messages', 'statement' …) — never an emoji.
 * `action` is ready-made HTML (a button with data-open / data-action), already escaped by the caller.
 * `compact: true` is the small, left-aligned form for an empty list inside a longer screen.
 */
export const empty = (icon: string, title: unknown, text: unknown = '', action = '', { compact = false }: { compact?: boolean } = {}): string => `<div class="ui-empty${compact ? ' is-compact' : ''}"><span aria-hidden="true">${iconFor('empty', null, icon)}</span><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;

/** Standard body for a panel that has no content yet. */
export const placeholder = (title: unknown, text: unknown = 'Coming soon.'): string => `<div class="ui-placeholder"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;

/** A labelled 0–100 meter row. */
export const meter = (label: unknown, value: number, low = 35): string => `<div class="ui-meter${value < low ? ' is-low' : ''}"><span>${esc(label)}</span><div role="meter" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value)}"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div><b>${Math.round(value)}</b></div>`;

/** A round avatar with the first letter of a name, on a colour derived from `seed` (a player id) so one person keeps one colour. `extra` is ready-made HTML (a presence dot). */
export function avatar(name: unknown, seed: unknown = name, extra = ''): string {
  let hash = 0;
  for (const char of String(seed ?? '')) hash = (hash * 31 + char.codePointAt(0)!) % 360;
  const letter = [...String(name ?? '').trim()][0] || '?';
  return `<span class="ui-avatar" aria-hidden="true" style="--hue:${hash}">${esc(letter.toUpperCase())}${extra}</span>`;
}

/** One line of a money list: what it was for, when, and the amount in green (in) or red (out). `sub` is plain text. */
export const ledgerRow = (reason: unknown, sub: unknown, amount: number): string => `<li class="ui-row"><span class="ui-row-icon is-round ${amount < 0 ? 'is-out' : 'is-in'}" aria-hidden="true">${glyph(amount < 0 ? 'spend' : 'earn')}</span><span class="ui-row-body"><b>${esc(reason)}</b><small>${esc(sub)}</small></span><span class="ui-row-end ${amount < 0 ? 'is-out' : 'is-in'}">${amount < 0 ? '−' : '+'}${money(Math.abs(amount))}</span></li>`;

/** The trailing chevron of a row that opens something. */
export const chevron = (): string => glyph('chevron');
export { glyph, iconFor, withGlyphs, stripLeadEmoji };
