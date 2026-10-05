/**
 * The game's icon set: original, hand-drawn inline SVG. No image files, no icon font, no emoji.
 *
 * One style everywhere — a 24×24 grid, 1.8px round strokes in currentColor, and the main shape
 * tinted with the same colour at 30% ("duotone"). The same glyphs are used bare in the HUD, the
 * bottom nav, the needs strip, toasts, the venue panel and app chrome; the Phone puts them on a
 * coloured rounded square (./icons-more.js).
 *
 * Editable artwork is in icons-source.ts; icons-packed.ts decodes synchronously to those exact SVGs.
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
import { F } from './icon-style.ts';
export { F, S, DOT } from './icon-style.ts';
import { unpackGlyphText } from './glyph-codec.ts';
import { GLYPH_DATA, GLYPH_CODES } from './icons-packed.ts';

const GLYPHS: Record<string, string> = JSON.parse(unpackGlyphText(GLYPH_DATA, GLYPH_CODES));
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
const ALIAS: Record<string, string> = { 'hunt-sheet': 'hunt', 'state-house': 'governor', roadside: 'barrier', 'roadside-chip': 'barrier', needs: 'health', profile: 'person', skills: 'book',
  session: 'globe', city: 'globe', onboarding: 'star', account: 'key', 'goal-chip': 'goals', 'home-chip': 'home', 'social-inbox': 'messages', 'radio-banner': 'radio',
  'health-chip': 'health', 'weather-chip': 'sun' };
/** Glyphs that arrive with ./icons-more.js: known by name before they can be drawn. */
const LATER = ['contacts', 'family', 'neighbours', 'ads', 'support', 'campus'];
export const glyphFor = (id: string): string => (hasGlyph(ALIAS[id] || id) || LATER.includes(id) ? ALIAS[id] || id : 'info');
