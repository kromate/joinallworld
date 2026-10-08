/**
 * The game's icon set: original, hand-drawn inline SVG. No image files, no icon font, no emoji.
 *
 * One style everywhere — a 24×24 grid, 1.8px round strokes in currentColor, and the main shape
 * tinted with the same colour at 30% ("duotone"). The same glyphs are used bare in the HUD, the
 * bottom nav, the needs strip, toasts, the venue panel and app chrome; the Phone puts them on a
 * coloured rounded square (./icons-more.js).
 *
 * THIS FILE IS IN THE FIRST DOWNLOAD, so it holds only what the first paint can show: navigation
 * and chrome, the needs, toasts and status, and the content glyphs a venue panel, a HUD chip, the
 * map or a travel tile can ask for. Glyphs only an app needs (and the app-icon squares) live in
 * ./icons-more.js, which the Phone and every lazy panel group import; it adds its glyphs with
 * registerGlyphs(). A name that is not here yet draws a quiet placeholder dot — never an emoji,
 * never nothing — and onGlyphs() tells the shell to redraw once the rest has arrived.
 *
 *   glyph(name, className?)  a bare <svg>, sized by CSS (inherits colour)
 *   hasGlyph(name)           is this name drawable right now
 *   glyphFor(panelId)        the glyph name of a panel / app id
 *   registerGlyphs(set)      add glyphs (called by ./icons-more.js on import)
 *   onGlyphs(listener)       called after glyphs were added
 * Which glyph a piece of game content gets (a venue, an activity, a food, a travel mode …) is
 * decided in ../icon-map.js.
 */
export const F = 'fill="currentColor" fill-opacity=".3"';
export const S = 'fill="currentColor" stroke="none"';
export const DOT = 'stroke-width="2.7"';
const FACE = `<circle cx="12" cy="12" r="8.5" ${F}/><path d="M9 9.5h.01M15 9.5h.01" ${DOT}/>`;

const GLYPHS: Record<string, string> = {
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
  people: `<circle cx="9" cy="8.5" r="3.2" ${F}/><path d="M3 19.5c.4-3.4 2.9-5.5 6-5.5s5.6 2.1 6 5.5Z" ${F}/><circle cx="16.8" cy="9.5" r="2.5"/><path d="M17.5 14.2c2 .5 3.3 2.3 3.5 5.3"/>`,
  invite: `<path d="M6.5 20.5V5A1.5 1.5 0 0 1 8 3.5h8A1.5 1.5 0 0 1 17.5 5v15.5Z" ${F}/><path d="M4 20.5h16"/><path d="M14.3 12.5h.01" ${DOT}/>`,
  governor: `<path d="M6 12a6 6 0 0 1 12 0Z" ${F}/><path d="M12 6V3.2l2.5 1-2.5 1M4.5 12h15M6.5 12v6M10.2 12v6M13.8 12v6M17.5 12v6M4 18h16M3 20.5h18"/>`,
  richlist: `<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0Z" ${F}/><path d="M7.5 5.5h-3c0 3 1.2 4.5 3.3 4.8M16.5 5.5h3c0 3-1.2 4.5-3.3 4.8M12 13.5V17M9.5 17h5v3h-5ZM8 20h8"/>`,
  hunt: `<path d="M7 4.5h10l4 5-9 10.5L3 9.5Z" ${F}/><path d="M3 9.5h18M9.5 4.5 8 9.5l4 10.5 4-10.5-1.5-5"/>`,
  radio: `<rect x="3" y="8" width="18" height="12" rx="2.5" ${F}/><path d="M7 8l9-4.5M14 12.5h4M14 15.5h4"/><circle cx="8.5" cy="14" r="2.6"/>`,
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
  // ---- content: people and feelings ----------------------------------------------------------
  heart: `<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.2 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" ${F}/>`,
  hand: `<path d="M7.5 12.5V6.8a1.4 1.4 0 0 1 2.8 0V5.2a1.4 1.4 0 0 1 2.8 0v1a1.4 1.4 0 0 1 2.8 0v6.3l1.3-1.8a1.4 1.4 0 0 1 2.4 1.5l-2.8 5A6.3 6.3 0 0 1 5.8 16l-.9-3a1.4 1.4 0 0 1 2.6-.5Z" ${F}/><path d="M10.3 6.8V11M13.1 6.2V11"/>`,
  handshake: `<path d="m2.5 8.5 4-1.5 5.5 2 5.5-2 4 1.5V15l-3 .5-5.2 4.2a1.6 1.6 0 0 1-2 0L6 15.5 2.5 15Z" ${F}/><path d="m12 9-3.3 2.8a1.5 1.5 0 0 0 1.9 2.3l2-1.5 4 3.7"/>`,
  meh: `${FACE}<path d="M8.5 15h7"/>`,
  sad: `${FACE}<path d="M8.3 16c.8-1.7 2.1-2.5 3.7-2.5s2.9.8 3.7 2.5"/>`,
  sick: `${FACE}<path d="m8 15.5 1.3-1 1.4 1 1.3-1 1.3 1 1.4-1 1.3 1"/>`,
  pray: `<path d="M12 3.5c-1.6 2.2-3 5.5-3 9l-3 4 2.5 4 3.5-3.5 3.5 3.5 2.5-4-3-4c0-3.5-1.4-6.8-3-9Z" ${F}/><path d="M12 4v13"/>`,
  crown: `<path d="M4.5 18.5h15l1.5-10-5 4-4-7-4 7-5-4Z" ${F}/>`,
  // ---- content: food and drink ---------------------------------------------------------------
  drink: `<path d="M6.5 8.5h11l-1.3 10.7a1.5 1.5 0 0 1-1.5 1.3H9.3a1.5 1.5 0 0 1-1.5-1.3Z" ${F}/><path d="M5 8.5h14M12 8.5 14 3h3"/>`,
  bottle: `<path d="M10 3h4v4.5l2 3v9A1.5 1.5 0 0 1 14.5 21h-5A1.5 1.5 0 0 1 8 19.5v-9l2-3Z" ${F}/><path d="M8 14h8"/>`,
  grill: `<path d="M4 20 20 4"/><rect x="6.8" y="11.2" width="5" height="5" rx="1.2" transform="rotate(-45 9.3 13.7)" ${F}/><rect x="12.2" y="5.8" width="5" height="5" rx="1.2" transform="rotate(-45 14.7 8.3)" ${F}/>`,
  snack: `<circle cx="12" cy="12" r="8.5" ${F}/><circle cx="12" cy="12" r="2.8"/><path d="m7 8.5 1 .8M15.5 6.5l-.5 1.2M17.5 13.5l-1.2-.3M8 16.5l.9-.9"/>`,
  leaf: `<path d="M5 19C5 10 10 5 20 5c0 10-5 15-14 15Z" ${F}/><path d="m4 20.5 9-9"/>`,
  fish: `<path d="M3 12c2.5-4 5.5-6 9-6s6 2.5 7 6c-1 3.5-3.5 6-7 6s-6.5-2-9-6Z" ${F}/><path d="m19 12 2.5-3v6Z"/><path d="M7.5 11h.01" ${DOT}/>`,
  pan: `<circle cx="10" cy="13.5" r="6.5" ${F}/><circle cx="10" cy="13.5" r="2.2"/><path d="m15 9 6.5-5"/>`,
  fire: `<path d="M12 21a6.5 6.5 0 0 1-6.5-6.5c0-3 2-4.5 3-7 2 .5 2.5 2.5 2.5 2.5s1-3.5-.5-7c4 1.5 8 6 8 11.5A6.5 6.5 0 0 1 12 21Z" ${F}/>`,
  box: `<path d="m12 3.5 7.5 4v9l-7.5 4-7.5-4v-9Z" ${F}/><path d="m4.5 7.5 7.5 4 7.5-4M12 11.5v9"/>`,
  // ---- content: home ---------------------------------------------------------------------------
  bed: `<path d="M3 17.5v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5Z" ${F}/><path d="M3 6v13.5M21 17.5v2M3 17.5h18M6.5 10.5v-2h5v2"/>`,
  sofa: `<path d="M3 12.5a1.8 1.8 0 0 1 3.6 0v2h10.8v-2a1.8 1.8 0 0 1 3.6 0V18H3Z" ${F}/><path d="M5.5 10.5v-2a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v2M5.5 18v2M18.5 18v2"/>`,
  chair: `<path d="M7 3.5h10V12H7Z" ${F}/><path d="M5.5 12h13v3h-13ZM7 15v5.5M17 15v5.5"/>`,
  bath: `<path d="M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5Z" ${F}/><path d="M6 12V6a2.2 2.2 0 0 1 4.3-.6M7.5 19l-1 2M16.5 19l1 2"/>`,
  shower: `<path d="M9.5 10a3.5 3.5 0 0 1 7 0Z" ${F}/><path d="M5 20.5V7a4 4 0 0 1 8 0M10.5 13v1M13 13v1.5M15.5 13v1M11.7 16.5v1M14.3 16.5v1"/>`,
  light: `<path d="M8.5 15.5a6 6 0 1 1 7 0v2h-7Z" ${F}/><path d="M9.5 20.5h5M12 12v5.5"/>`,
  screen: `<rect x="3" y="4.5" width="18" height="12" rx="2" ${F}/><path d="M9 20.5h6M12 16.5v4"/>`,
  frame: `<rect x="3.5" y="4.5" width="17" height="15" rx="1.5" ${F}/><path d="m6.5 16 3.5-4.5 3 3 2-2 2.5 3.5"/><circle cx="15.5" cy="9" r="1.2"/>`,
  book: `<path d="M4 5.5c3-1 5.5-.8 8 .8v13c-2.5-1.6-5-1.8-8-.8Z" ${F}/><path d="M20 5.5c-3-1-5.5-.8-8 .8v13c2.5-1.6 5-1.8 8-.8Z"/>`,
  paw: `<path d="M12 12.5c-2.5 0-4.5 2.5-4.5 4.8 0 1.5 1.2 2.2 2.5 2.2.8 0 1.3-.4 2-.4s1.2.4 2 .4c1.3 0 2.5-.7 2.5-2.2 0-2.3-2-4.8-4.5-4.8Z" ${F}/><path d="M6 10.5h.01M9.5 6.5h.01M14.5 6.5h.01M18 10.5h.01" stroke-width="3.2"/>`,
  fan: `<path d="M12 10.5c-2-2-2-5 0-7 2 2 2 5 0 7ZM13.3 12.8c2.7-.7 5.3.8 6 3.5-2.7.7-5.3-.8-6-3.5ZM10.7 12.8c-.7 2.7-3.3 4.2-6 3.5.7-2.7 3.3-4.2 6-3.5Z" ${F}/><path d="M12 12h.01" ${DOT}/>`,
  // ---- content: fun, culture and sport ------------------------------------------------------
  dumbbell: `<rect x="5.5" y="7" width="3.5" height="10" rx="1.2" ${F}/><rect x="15" y="7" width="3.5" height="10" rx="1.2" ${F}/><path d="M9 12h6M3 9.5v5M21 9.5v5"/>`,
  note: `<circle cx="6.5" cy="17.5" r="2.5" ${F}/><circle cx="16.5" cy="15.5" r="2.5" ${F}/><path d="M9 17.5v-12l10-2v12"/>`,
  mic: `<rect x="9" y="3" width="6" height="11" rx="3" ${F}/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6"/>`,
  camera: `<path d="M3.5 8.5a2 2 0 0 1 2-2H8l1.5-2h5l1.5 2h2.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" ${F}/><circle cx="12" cy="13" r="3.2"/>`,
  game: `<rect x="4" y="4" width="16" height="16" rx="3.5" ${F}/><path d="M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01" ${DOT}/>`,
  dance: `<circle cx="12" cy="4.8" r="2.2" ${F}/><path d="m5 6.5 4.5 4h5l4.5-4M9.5 10.5V15L7 20.5M14.5 10.5V15l2.5 5.5M9.5 15h5"/>`,
  headphones: `<rect x="3.5" y="14" width="4" height="6" rx="1.5" ${F}/><rect x="16.5" y="14" width="4" height="6" rx="1.5" ${F}/><path d="M4.5 14v-1.5a7.5 7.5 0 0 1 15 0V14"/>`,
  ball: `<circle cx="12" cy="12" r="8.5" ${F}/><path d="m12 8.5 3.3 2.4-1.3 3.9h-4l-1.3-3.9ZM12 8.5v-5M15.3 10.9l4.7-1.5M14 14.8l3 4M10 14.8l-3 4M8.7 10.9 4 9.4"/>`,
  mask: `<path d="M4.5 4.5h15V12a7.5 7.5 0 0 1-15 0Z" ${F}/><path d="M8 9.5h2M14 9.5h2M8.5 14c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2"/>`,
  film: `<rect x="3.5" y="10" width="17" height="10.5" rx="2" ${F}/><path d="m3.5 10 15.8-4.8.8 2.6-15.8 4.8M8 8.6l1.8 2.4M12.8 7.2l1.8 2.4"/>`,
  star: `<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.8-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8Z" ${F}/>`,
  // ---- content: work, money and the city ----------------------------------------------------
  calendar: `<rect x="4" y="5.5" width="16" height="15" rx="2.5" ${F}/><path d="M4 10.5h16M8 3.5v4M16 3.5v4"/>`,
  clock: `<circle cx="12" cy="12" r="8.5" ${F}/><path d="M12 7.5V12l3 2"/>`,
  pen: `<path d="m4 20 1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8.5 19Z" ${F}/><path d="m14.5 6 3.5 3.5"/>`,
  megaphone: `<path d="M4 10v4h3l8 4.5v-13L7 10Z" ${F}/><path d="M18 9.5a3.5 3.5 0 0 1 0 5M7.5 14v4.5H10"/>`,
  wifi: `<path d="M3 9.5a13 13 0 0 1 18 0M6 13a8.5 8.5 0 0 1 12 0M9 16.5a4.2 4.2 0 0 1 6 0"/><path d="M12 19.8h.01" ${DOT}/>`,
  coin: `<circle cx="12" cy="12" r="8.5" ${F}/><path d="M9.5 16V8l5 8V8M7.5 11h9M7.5 13.5h9"/>`,
  gift: `<rect x="4" y="10.5" width="16" height="10" rx="1.5" ${F}/><path d="M3 7.5h18v3H3ZM12 7.5v13M12 7.5c-1.5-3-5-3.5-5-1.5s3 1.5 5 1.5 5 .5 5-1.5-3.5-1.5-5 1.5Z"/>`,
  ship: `<path d="M3.5 14.5h17l-2 5.5h-13Z" ${F}/><path d="M7 14.5V9h10v5.5M10 9V5.5h4V9"/>`,
  scissors: `<circle cx="6.5" cy="7" r="2.5" ${F}/><circle cx="6.5" cy="17" r="2.5" ${F}/><path d="M8.5 8.5 20 18M8.5 15.5 20 6"/>`,
  broom: `<path d="m11 12 3 3-3.5 5.5h-6l-1-5.5Z" ${F}/><path d="M19.5 3.5 12.5 10.5M8 20.5v-3"/>`,
  pill: `<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)" ${F}/><path d="m9.5 9.5 5 5"/>`,
  search: `<circle cx="10.5" cy="10.5" r="6" ${F}/><path d="m15 15 5.5 5.5"/>`,
  ballot: `<path d="M4 12.5h16v8H4Z" ${F}/><path d="M8 12.5v-8h8v8M9.5 16.5h5M10.3 7.8l1.2 1.2 2.2-2.4"/>`,
  scales: `<path d="M2.5 14 5 7l2.5 7a2.5 2.5 0 0 1-5 0ZM16.5 14 19 7l2.5 7a2.5 2.5 0 0 1-5 0Z" ${F}/><path d="M12 4v16.5M7.5 20.5h9M5 7h14"/>`,
  shield: `<path d="m12 3 7.5 3v5.5c0 4.5-3 7.8-7.5 9.5-4.5-1.7-7.5-5-7.5-9.5V6Z" ${F}/><path d="m8.5 12 2.5 2.5 4.5-5"/>`,
  boot: `<path d="M8 3.5h6v9l5.5 2.5a2 2 0 0 1 1 1.8v2.7H8Z" ${F}/><path d="M11.5 8.5H14"/>`,
  building: `<rect x="5" y="3.5" width="14" height="17" rx="1.5" ${F}/><path d="M3 20.5h18M9 7.5h.01M12 7.5h.01M15 7.5h.01M9 11.5h.01M12 11.5h.01M15 11.5h.01M10.5 20.5v-4h3v4"/>`,
  church: `<path d="M6 20.5V12l6-4.5 6 4.5v8.5Z" ${F}/><path d="M12 7.5v-5M10 4.5h4M10.5 20.5v-4a1.5 1.5 0 0 1 3 0v4"/>`,
  mosque: `<path d="M6 20.5v-7a6 6 0 0 1 12 0v7Z" ${F}/><path d="M12 7.5V4M3.5 20.5v-10M20.5 20.5v-10M10.5 20.5v-3a1.5 1.5 0 0 1 3 0v3"/>`,
  barrier: `<rect x="3" y="8" width="18" height="6" rx="1.2" ${F}/><path d="M6 14v6.5M18 14v6.5M7.5 8 5 14M13 8l-2.5 6M18.5 8 16 14M6 8V5.5M18 8V5.5"/>`,
  // ---- content: outdoors and getting around -------------------------------------------------
  tree: `<path d="M12 3a5.2 5.2 0 0 1 5 6.5 4.7 4.7 0 0 1-1.5 9.2h-7A4.7 4.7 0 0 1 7 9.5 5.2 5.2 0 0 1 12 3Z" ${F}/><path d="M12 11.5v10M12 15.5l2.5-2.5"/>`,
  umbrella: `<path d="M3 12a9 9 0 0 1 18 0Z" ${F}/><path d="M12 3v16a2 2 0 0 1-4 0"/>`,
  wave: '<path d="M2.5 9c2-2.5 4-2.5 6.3 0s4.4 2.5 6.4 0 4-2.5 6.3 0M2.5 15.5c2-2.5 4-2.5 6.3 0s4.4 2.5 6.4 0 4-2.5 6.3 0"/>',
  sunset: `<path d="M5.5 17a6.5 6.5 0 0 1 13 0Z" ${F}/><path d="M2.5 17h19M6 20.5h12M12 4v3M4.5 9l1.8 1.8M19.5 9l-1.8 1.8"/>`,
  bridge: '<path d="M2.5 16h19M5 20V7M19 20V7M5 8c2.5 5.3 11.5 5.3 14 0M9 16v-4.4M12 16v-4M15 16v-4.4"/>',
  compass: `<circle cx="12" cy="12" r="8.5" ${F}/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>`,
  walk: `<circle cx="13" cy="4.5" r="2" ${F}/><path d="m9 12 1.5-3.5 3-.5 1.5 3.5 3 1.5M13 8l-1 6 3 3 .5 4M12 14l-1.5 3.5-3 3"/>`,
  keke: `<path d="M4 16.5v-7a4 4 0 0 1 4-4h6l5.5 6v5Z" ${F}/><path d="M9.5 5.5v6h10M2.5 16.5h19"/><circle cx="7.5" cy="17.5" r="1.9" ${S}/><circle cx="16.5" cy="17.5" r="1.9" ${S}/>`,
  bus: `<rect x="2.5" y="6" width="19" height="11" rx="2.5" ${F}/><path d="M2.5 11.5h19M8 6v5.5M13.5 6v5.5"/><circle cx="7" cy="17.5" r="1.9" ${S}/><circle cx="17" cy="17.5" r="1.9" ${S}/>`,
  bike: `<circle cx="5.5" cy="16" r="3" ${F}/><circle cx="18.5" cy="16" r="3" ${F}/><path d="m5.5 16 4-6h5.5l3.5 6M9.5 10 8 7.5H5.5M15 10l1-3h2.5M10 16h4l1-6"/>`,
  plane: `<path d="M21 3.5 3 10.5l6.5 3L12 20.5Z" ${F}/><path d="M9.5 13.5 21 3.5"/>`,
  sun: `<circle cx="12" cy="12" r="4" ${F}/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>`,
  rain: `<path d="M7 15a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 6.5 4.3 4.3 0 0 1 17.5 15Z" ${F}/><path d="m8 18-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/>`,
  moon: `<path d="M19.5 14.5a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z" ${F}/>`,
  // ---- small marks -----------------------------------------------------------------------------
  key: `<circle cx="8" cy="15.5" r="4.5" ${F}/><path d="m11.2 12.3 8.3-8.3M16.5 7l2.5 2.5"/>`,
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  pointer: `<circle cx="12" cy="12" r="8.5" ${F}/><path d="M7.5 12h9M13 8.5l3.5 3.5-3.5 3.5"/>`,
};
/** Drawn for a name that is not registered (yet): a quiet dot in the same box. */
const PENDING = `<circle cx="12" cy="12" r="3" ${F}/>`;
const listeners = new Set<() => void>();

/** A bare glyph, sized by CSS. `className` (optional) is one of our own class names, never player text. */
export const glyph = (name: string, className?: string): string => `<svg${className ? ` class="${className}"` : ''} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name] || PENDING}</svg>`;
export const hasGlyph = (name: unknown): boolean => typeof name === 'string' && Object.hasOwn(GLYPHS, name);
/** Add glyphs to the set (./icons-more.js does, when the Phone or a lazy panel group is fetched). */
export function registerGlyphs(set: Record<string, string>): void {
  Object.assign(GLYPHS, set);
  for (const listener of listeners) { try { listener(); } catch (error) { console.error(error); } }
}
/** Be told when glyphs were added, to redraw anything that showed a placeholder. Returns the unsubscribe. */
export function onGlyphs(listener: () => void): () => boolean { listeners.add(listener); return () => listeners.delete(listener); }

/** Panel ids whose glyph has another name. */
const ALIAS: Record<string, string> = { commerce: 'business', 'hunt-sheet': 'hunt', 'state-house': 'governor', roadside: 'barrier', 'roadside-chip': 'barrier', needs: 'health', profile: 'person', skills: 'book',
  session: 'globe', city: 'globe', onboarding: 'star', account: 'key', 'goal-chip': 'goals', 'home-chip': 'home', 'social-inbox': 'messages', 'radio-banner': 'radio',
  'health-chip': 'health', 'weather-chip': 'sun' };
/** Glyphs that arrive with ./icons-more.js: known by name before they can be drawn. */
const LATER = ['contacts', 'family', 'neighbours', 'ads', 'support', 'campus'];
export const glyphFor = (id: string): string => (hasGlyph(ALIAS[id] || id) || LATER.includes(id) ? ALIAS[id] || id : 'info');
