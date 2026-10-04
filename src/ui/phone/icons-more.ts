/**
 * The rest of the icon set: what only the Phone and the lazily loaded apps draw. Importing this
 * module adds its glyphs to ./icons.js (registerGlyphs), so `glyph(name)` knows them everywhere
 * from then on. The Phone (./phone.js) and every lazy panel group (../panels/groups/*) import it;
 * nothing in the first download does.
 *
 *   appIcon(id, tint?)      the rounded-square app icon for a Phone app
 *   TINTS, tintOf(panel)    one colour per app id: the icon's square and the app bar
 * Same style as ./icons.js: 24×24, 1.8px round strokes in currentColor, the main shape at 30%.
 */
import { F, S, glyph, glyphFor, registerGlyphs } from './icons.ts';
import { GROWTH_GLYPHS } from './icons-growth.ts';

registerGlyphs({
  ...GROWTH_GLYPHS,
  contacts: `<rect x="5" y="3.5" width="14.5" height="17" rx="2.5" ${F}/><circle cx="12.2" cy="10" r="2.2"/><path d="M8.5 16.5c.5-2 2-3 3.7-3s3.2 1 3.7 3M3 8h2M3 12h2M3 16h2"/>`,
  family: `<path d="M4 10.5 12 4l8 6.5V20H4Z" ${F}/><path d="M12 17.2s-3.5-2-3.5-4.5a1.9 1.9 0 0 1 3.5-1 1.9 1.9 0 0 1 3.5 1c0 2.5-3.5 4.5-3.5 4.5Z" ${S}/>`,
  neighbours: `<path d="M2.5 12 8 7l5.5 5v8h-11Z" ${F}/><path d="M13.5 13.5 17 10.5l4.5 4V20h-8M6.5 20v-3.5h3V20"/>`,
  ads: `<rect x="3" y="4.5" width="18" height="10" rx="2" ${F}/><path d="M8 14.5V20M16 14.5V20M6 20h12M7 8.5h7M7 11h4"/>`,
  support: `<circle cx="12" cy="12" r="8.5" ${F}/><circle cx="12" cy="12" r="3.5"/><path d="m6 6 3.5 3.5M18 6l-3.5 3.5M6 18l3.5-3.5M18 18l-3.5-3.5"/>`,
  expand: '<path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5 13.5 10.5M4.5 19.5l6-6"/>',
  shrink: '<path d="M19.5 10H14V4.5M4.5 14H10v5.5M14 10l6-6M10 14l-6 6"/>',
  id: `<rect x="3" y="5" width="18" height="14" rx="2.5" ${F}/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16c.4-1.5 1.5-2.2 3-2.2s2.6.7 3 2.2M14.5 10h4M14.5 13.5h3"/>`,
  'heart-off': `<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.2 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" ${F}/><path d="m12 7.5-1.5 3.5 3 2-1.5 3.5"/>`,
  trash: `<path d="M6 7.5h12l-1 12a1.5 1.5 0 0 1-1.5 1.3h-7A1.5 1.5 0 0 1 7 19.5Z" ${F}/><path d="M4 7.5h16M9.5 7.5v-3h5v3M10 11.5v5M14 11.5v5"/>`,
});

/** One colour per app: the icon's rounded square and the app bar. */
export const TINTS: Record<string, string> = {
  jobs: '#2563eb', messages: '#16a34a', bank: '#0f766e', ride: '#d97706',
  statement: '#475569', invest: '#7c3aed', career: '#0284c7', richlist: '#b7791f',
  goals: '#ea580c', health: '#e11d48', groceries: '#4d9a1a', boutique: '#db2777', houses: '#b45309', cars: '#334155', settings: '#6b7280', help: '#0e8fd6',
  contacts: '#0d9488', people: '#4f46e5', family: '#c026d3', invite: '#d98200', community: '#0891b2',
  governor: '#166534', neighbours: '#059669', ads: '#9333ea', 'hunt-sheet': '#0aa5c2', radio: '#1e293b', support: '#dc5a0c',
};
/** The part of a panel the Phone reads for colour: its own `tint` or its id. */
export interface Tinted { id?: string; tint?: string }
export const tintOf = (panel?: Tinted | null): string => panel?.tint || (panel?.id !== undefined ? TINTS[panel.id] : undefined) || '#3f4a5a';

/** The rounded-square app icon. `tint` is a CSS colour from our own table, never player text. */
export const appIcon = (id: string, tint: string = TINTS[id] || '#3f4a5a'): string => `<span class="ph-icon" style="--tint:${tint}">${glyph(glyphFor(id))}</span>`;
