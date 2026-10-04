// Small string-template helpers shared by the shell and every panel.

/** Escape text for HTML content and attribute values. Use it on EVERY dynamic value. */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (value) => `₦${Math.round(Number(value) || 0).toLocaleString('en-NG')}`;
export const cap = (id) => `${id[0].toUpperCase()}${id.slice(1)}`;
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
};
export const icon = (name) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.home}</svg>`;

/** Standard body for a panel that has no content yet. */
export const placeholder = (title, text = 'Coming soon.') => `<div class="ui-placeholder"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;

/** A labelled 0–100 meter row. */
export const meter = (label, value, low = 35) => `<div class="ui-meter${value < low ? ' is-low' : ''}"><span>${esc(label)}</span><div role="meter" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value)}"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div><b>${Math.round(value)}</b></div>`;
