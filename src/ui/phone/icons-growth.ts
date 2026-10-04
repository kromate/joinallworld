/**
 * OWNER: growth
 * Glyphs for the growth apps (Missions, Events, Bring a friend, Stay in touch, Tables), in the
 * icon set's own style: a 24×24 grid, 1.8px round strokes in currentColor, the main shape tinted
 * at 30%. Plain data: ./icons-more.js registers them with the rest of the Phone's icons (one registration, one redraw),
 * so the Phone's home screen can draw the app icons before any app has loaded; the one glyph a chip of the
 * first download needs (`tables`) is ./icon-tables.js.
 */
import { F, S, DOT } from './icons.ts';

export const GROWTH_GLYPHS = {
  missions: `<rect x="5" y="4" width="14" height="17" rx="2.5" ${F}/><path d="M9 4V3h6v1M8.5 10l1.5 1.5 3-3M8.5 16l1.5 1.5 3-3M15.5 10.5h.5M15.5 16.5h.5"/>`,
  events: `<rect x="4" y="5.5" width="16" height="15" rx="2.5" ${F}/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/><path d="m12 12.3 1 2 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3Z" ${S}/>`,
  refer: `<circle cx="9" cy="9" r="3.2" ${F}/><path d="M3 20c.4-3.4 2.9-5.5 6-5.5s5.6 2.1 6 5.5Z" ${F}/><path d="M18 7v6M15 10h6"/>`,
  touch: `<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z" ${F}/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/><path d="M12 3.2v1.3"/>`,
  share: `<circle cx="6.5" cy="12" r="2.4" ${F}/><circle cx="17" cy="6" r="2.4" ${F}/><circle cx="17" cy="18" r="2.4" ${F}/><path d="m8.7 10.8 6.1-3.5M8.7 13.2l6.1 3.5"/>`,
  stamp: `<circle cx="12" cy="12" r="8" ${F}/><path d="m8.3 12.3 2.4 2.4 5-5.2"/>`,
  circle: `<circle cx="12" cy="12" r="7.5" ${F}/>`,
  triangle: `<path d="M12 4.5 20 19H4Z" ${F}/>`,
  cross: `<path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5Z" ${F}/>`,
  square: `<rect x="5" y="5" width="14" height="14" rx="1.5" ${F}/>`,
  goal: `<path d="M3.5 19V6.5h17V19" ${F}/><path d="M3.5 19V6.5h17V19M3.5 10.5h17M8 6.5V19M12 6.5V19M16 6.5V19M2 19h20"/>`,
  dot: `<path d="M12 12h.01" ${DOT}/>`,
};
