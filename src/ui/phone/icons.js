/**
 * The game's icon set: original, hand-drawn inline SVG. No image files, no icon font.
 *
 * One style everywhere — a 24×24 grid, 1.8px round strokes in currentColor, and the main shape
 * tinted with the same colour at 30% ("duotone"). App icons sit on a coloured rounded square
 * (the app's tint); the same glyphs are used bare in the HUD, the bottom nav, the needs strip,
 * toasts and app chrome.
 *
 *   glyph(name)             a bare <svg>, sized by CSS (inherits colour)
 *   appIcon(id, tint?)      the rounded-square app icon for a Phone app
 *   TINTS                   one colour per app id
 */
const F = 'fill="currentColor" fill-opacity=".3"';
const S = 'fill="currentColor" stroke="none"';
const DOT = 'stroke-width="2.7"';

const GLYPHS = {
  // ---- apps -----------------------------------------------------------------------------
  jobs: `<rect x="3" y="7.5" width="18" height="12" rx="2.5" ${F}/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 12.5h18M12 11.5v2.5"/>`,
  messages: `<path d="M5 4.5h14A2.5 2.5 0 0 1 21.5 7v7.5A2.5 2.5 0 0 1 19 17h-7l-4.5 3.5V17H5a2.5 2.5 0 0 1-2.5-2.5V7A2.5 2.5 0 0 1 5 4.5Z" ${F}/><path d="M8 10.8h.01M12 10.8h.01M16 10.8h.01" ${DOT}/>`,
  bank: `<path d="M3.5 9.5 12 4l8.5 5.5Z" ${F}/><path d="M5.5 9.5V17M10 9.5V17M14 9.5V17M18.5 9.5V17M4.5 17h15M3.5 20h17"/>`,
  statement: `<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4Z" ${F}/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>`,
  invest: `<path d="M7.5 16l3.5-4 3 2.5 5-6.5V20H7.5Z" ${F} stroke="none"/><path d="M4 4v16h16M7.5 16l3.5-4 3 2.5 5-6.5M15.5 8H19v3.5"/>`,
  groceries: `<path d="M4 10h16l-1.6 8.2a2 2 0 0 1-2 1.6H7.6a2 2 0 0 1-2-1.6Z" ${F}/><path d="M2.5 10h19M8 10l3-5.5M16 10l-3-5.5M9.5 13.5v3M12 13.5v3M14.5 13.5v3"/>`,
  ride: `<rect x="4" y="3.5" width="16" height="14" rx="3" ${F}/><path d="M4 11.5h16M12 3.5v8M6.5 17.5V20M17.5 17.5V20"/><path d="M7.5 14.5h.01M16.5 14.5h.01" ${DOT}/>`,
  houses: `<path d="M5.5 10V20h13V10L12 4.5Z" ${F}/><path d="M3 11.5 12 4l9 7.5M10 20v-5.5h4V20"/>`,
  boutique: `<path d="M8.5 4 4 6.5l1.8 3.6L8 9v11h8V9l2.2 1.1L20 6.5 15.5 4a3.5 3.5 0 0 1-7 0Z" ${F}/>`,
  cars: `<path d="M3 15.5v-2.8a2 2 0 0 1 1.5-1.9l2-.5 1.9-3.5a2 2 0 0 1 1.8-1h4.4a2 2 0 0 1 1.7.9l2.3 3.6 1.2.3a2 2 0 0 1 1.5 1.9v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" ${F}/><path d="M7 10.3h10.5"/><circle cx="7.5" cy="16.7" r="2" ${S}/><circle cx="16.5" cy="16.7" r="2" ${S}/>`,
  health: `<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.2 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" ${F}/><path d="M6.5 12h3l1.5-2.5 2 5 1.5-2.5h3"/>`,
  contacts: `<rect x="5" y="3.5" width="14.5" height="17" rx="2.5" ${F}/><circle cx="12.2" cy="10" r="2.2"/><path d="M8.5 16.5c.5-2 2-3 3.7-3s3.2 1 3.7 3M3 8h2M3 12h2M3 16h2"/>`,
  people: `<circle cx="9" cy="8.5" r="3.2" ${F}/><path d="M3 19.5c.4-3.4 2.9-5.5 6-5.5s5.6 2.1 6 5.5Z" ${F}/><circle cx="16.8" cy="9.5" r="2.5"/><path d="M17.5 14.2c2 .5 3.3 2.3 3.5 5.3"/>`,
  family: `<path d="M4 10.5 12 4l8 6.5V20H4Z" ${F}/><path d="M12 17.2s-3.5-2-3.5-4.5a1.9 1.9 0 0 1 3.5-1 1.9 1.9 0 0 1 3.5 1c0 2.5-3.5 4.5-3.5 4.5Z" ${S}/>`,
  invite: `<path d="M6.5 20.5V5A1.5 1.5 0 0 1 8 3.5h8A1.5 1.5 0 0 1 17.5 5v15.5Z" ${F}/><path d="M4 20.5h16"/><path d="M14.3 12.5h.01" ${DOT}/>`,
  governor: `<path d="M6 12a6 6 0 0 1 12 0Z" ${F}/><path d="M12 6V3.2l2.5 1-2.5 1M4.5 12h15M6.5 12v6M10.2 12v6M13.8 12v6M17.5 12v6M4 18h16M3 20.5h18"/>`,
  neighbours: `<path d="M2.5 12 8 7l5.5 5v8h-11Z" ${F}/><path d="M13.5 13.5 17 10.5l4.5 4V20h-8M6.5 20v-3.5h3V20"/>`,
  ads: `<rect x="3" y="4.5" width="18" height="10" rx="2" ${F}/><path d="M8 14.5V20M16 14.5V20M6 20h12M7 8.5h7M7 11h4"/>`,
  richlist: `<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0Z" ${F}/><path d="M7.5 5.5h-3c0 3 1.2 4.5 3.3 4.8M16.5 5.5h3c0 3-1.2 4.5-3.3 4.8M12 13.5V17M9.5 17h5v3h-5ZM8 20h8"/>`,
  hunt: `<path d="M7 4.5h10l4 5-9 10.5L3 9.5Z" ${F}/><path d="M3 9.5h18M9.5 4.5 8 9.5l4 10.5 4-10.5-1.5-5"/>`,
  radio: `<rect x="3" y="8" width="18" height="12" rx="2.5" ${F}/><path d="M7 8l9-4.5M14 12.5h4M14 15.5h4"/><circle cx="8.5" cy="14" r="2.6"/>`,
  support: `<circle cx="12" cy="12" r="8.5" ${F}/><circle cx="12" cy="12" r="3.5"/><path d="m6 6 3.5 3.5M18 6l-3.5 3.5M6 18l3.5-3.5M18 18l-3.5-3.5"/>`,
  settings: `<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2" ${F}/><circle cx="9" cy="12" r="2" ${F}/><circle cx="17" cy="17" r="2" ${F}/>`,
  goals: `<circle cx="12" cy="12" r="8.5" ${F}/><circle cx="12" cy="12" r="4.6"/><path d="M12 12l7.5-7.5M19.5 4.5v3M19.5 4.5h-3"/><circle cx="12" cy="12" r="1.2" ${S}/>`,
  help: `<circle cx="12" cy="12" r="8.5" ${F}/><path d="M9.3 9.5a2.8 2.8 0 1 1 4.2 2.4c-.9.6-1.5 1.1-1.5 2.3"/><path d="M12 17.3h.01" ${DOT}/>`,
  community: `<path d="M3 5.5h11V13H8l-3 2.5V13H3Z" ${F}/><path d="M17 9.5h4V17h-2v2.5L16 17h-5v-1.5"/>`,
  career: `<path d="M3.5 20h17V6.5H17V11h-4.5v4.5H8V20Z" ${F} stroke="none"/><path d="M3.5 20H8v-4.5h4.5V11H17V6.5h3.5"/>`,
  person: `<circle cx="12" cy="8.5" r="3.7" ${F}/><path d="M4.5 20c.6-4 3.6-6.2 7.5-6.2s6.9 2.2 7.5 6.2Z" ${F}/>`,
  // ---- navigation and chrome --------------------------------------------------------------
  home: `<path d="M5 10.5V20h14v-9.5L12 4.5Z" ${F}/><path d="M3 11.5 12 4l9 7.5M10 20v-5h4v5"/>`,
  buy: `<path d="M4 10h16v10H4Z" ${F}/><path d="M5 4.5h14l1.5 5.5h-17ZM9 20v-5.5h6V20"/>`,
  map: `<path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2Z" ${F}/><path d="M9 4v14M15 6v14"/>`,
  phone: `<rect x="6.5" y="2.5" width="11" height="19" rx="2.8" ${F}/><path d="M10.5 5.5h3M11 18.3h2"/>`,
  back: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  chevron: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  close: '<path d="m6.5 6.5 11 11M6.5 17.5l11-11"/>',
  expand: '<path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5 13.5 10.5M4.5 19.5l6-6"/>',
  shrink: '<path d="M19.5 10H14V4.5M4.5 14H10v5.5M14 10l6-6M10 14l-6 6"/>',
  bell: `<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z" ${F}/><path d="M10 20.5a2 2 0 0 0 4 0"/>`,
  globe: `<circle cx="12" cy="12" r="8.5" ${F}/><path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.1 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.1-3.8-8.5S9.5 5.8 12 3.5Z"/>`,
  pin: `<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z" ${F}/><circle cx="12" cy="10" r="2.3"/>`,
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
  // ---- needs -------------------------------------------------------------------------------
  hunger: `<path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0Z" ${F}/><path d="M9 8c0-1.5 1.2-1.8 1.2-3.5M13.5 8c0-1.5 1.2-1.8 1.2-3.5"/>`,
  energy: `<path d="M13.5 2.5 5 13.5h6l-1 8 8.5-11h-6Z" ${F}/>`,
  fun: `<circle cx="12" cy="12" r="8.5" ${F}/><path d="M8.3 13.5c.8 1.7 2.1 2.5 3.7 2.5s2.9-.8 3.7-2.5"/><path d="M9 9.5h.01M15 9.5h.01" ${DOT}/>`,
  social: `<path d="M4 5h16v11H10l-5 4v-4H4Z" ${F}/>`,
  hygiene: `<path d="M12 3s6.5 6.8 6.5 11.3a6.5 6.5 0 0 1-13 0C5.5 9.8 12 3 12 3Z" ${F}/><path d="M9 14.5a3 3 0 0 0 2.5 2.8"/>`,
  bladder: `<path d="M5 10.5h14a6 6 0 0 1-4 5.6v4.4H9v-4.4a6 6 0 0 1-4-5.6Z" ${F}/><path d="M7 10.5v-7h3.5v7"/>`,
  // ---- toasts and status -------------------------------------------------------------------
  info: `<circle cx="12" cy="12" r="8.5" ${F}/><path d="M12 11v5.5"/><path d="M12 7.7h.01" ${DOT}/>`,
  good: `<circle cx="12" cy="12" r="8.5" ${F}/><path d="m8 12.3 2.8 2.8L16.2 9.5"/>`,
  earn: `<circle cx="12" cy="12" r="8.5" ${F}/><path d="M12 16V8M8.5 11.5 12 8l3.5 3.5"/>`,
  spend: `<circle cx="12" cy="12" r="8.5" ${F}/><path d="M12 8v8M8.5 12.5 12 16l3.5-3.5"/>`,
  error: `<path d="M12 3.5 21.5 20h-19Z" ${F}/><path d="M12 10v4.5"/><path d="M12 17.2h.01" ${DOT}/>`,
  cloud: `<path d="M7 18.5a4.5 4.5 0 0 1-.6-8.960A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 .5 10Z" ${F}/>`,
  'cloud-off': `<path d="M7 18.5a4.5 4.5 0 0 1-.6-8.960A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 .5 10Z" ${F}/><path d="M4 4l16 17"/>`,
  lock: `<rect x="5" y="10.5" width="14" height="10" rx="2.5" ${F}/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>`,
};

/** A bare glyph, sized by CSS. Unknown names fall back to the info mark, never to nothing. */
export const glyph = (name) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name] || GLYPHS.info}</svg>`;
export const hasGlyph = (name) => Object.hasOwn(GLYPHS, name);

/** One colour per app: the icon's rounded square and the app bar. */
export const TINTS = {
  jobs: '#2563eb', messages: '#16a34a', bank: '#0f766e', ride: '#d97706',
  statement: '#475569', invest: '#7c3aed', career: '#0284c7', richlist: '#b7791f',
  goals: '#ea580c', health: '#e11d48', groceries: '#4d9a1a', boutique: '#db2777', houses: '#b45309', cars: '#334155', settings: '#6b7280', help: '#0e8fd6',
  contacts: '#0d9488', people: '#4f46e5', family: '#c026d3', invite: '#d98200', community: '#0891b2',
  governor: '#166534', neighbours: '#059669', ads: '#9333ea', 'hunt-sheet': '#0aa5c2', radio: '#1e293b', support: '#dc5a0c',
};
/** Panel ids whose glyph has another name. */
const ALIAS = { 'hunt-sheet': 'hunt', person: 'person', 'state-house': 'governor', roadside: 'ride', needs: 'health', profile: 'person', skills: 'career' };
export const glyphFor = (id) => (hasGlyph(ALIAS[id] || id) ? ALIAS[id] || id : 'info');
export const tintOf = (panel) => panel?.tint || TINTS[panel?.id] || '#3f4a5a';

/** The rounded-square app icon. `tint` is a CSS colour from our own table, never player text. */
export const appIcon = (id, tint = TINTS[id] || '#3f4a5a') => `<span class="ph-icon" style="--tint:${tint}">${glyph(glyphFor(id))}</span>`;
