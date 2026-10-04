// Small string-template helpers shared by the shell and every panel.

/** Escape text for HTML content and attribute values. Use it on EVERY dynamic value. */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (value) => `₦${Math.round(Number(value) || 0).toLocaleString('en-NG')}`;
export const cap = (id) => `${id[0].toUpperCase()}${id.slice(1)}`;
/** A version-4 UUID that also works outside secure contexts (plain HTTP on a LAN), where crypto.randomUUID is missing. */
export function uuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** JSON for a data-payload / data-params attribute. */
export const json = (value) => esc(JSON.stringify(value));

const ICONS = {
  home: '<path d="m3 10 9-7 9 7v10H6V10m3 10v-7h6v7"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  buy: '<path d="M5 9V5h14v4m-16 1h18v10H3V10Zm5 0v10m8-10v10"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.2C3.5 8.1 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  chat: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
};
export const icon = (name) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.home}</svg>`;

/**
 * The one empty state every panel uses: what is missing, and the next step.
 * `action` is ready-made HTML (a button with data-open / data-action), already escaped by the caller.
 * `compact: true` is the small, left-aligned form for an empty list inside a longer screen.
 */
export const empty = (emoji, title, text = '', action = '', { compact = false } = {}) => `<div class="ui-empty${compact ? ' is-compact' : ''}"><span aria-hidden="true">${esc(emoji)}</span><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;

/** Standard body for a panel that has no content yet. */
export const placeholder = (title, text = 'Coming soon.') => `<div class="ui-placeholder"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;

/** A labelled 0–100 meter row. */
export const meter = (label, value, low = 35) => `<div class="ui-meter${value < low ? ' is-low' : ''}"><span>${esc(label)}</span><div role="meter" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value)}"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div><b>${Math.round(value)}</b></div>`;
