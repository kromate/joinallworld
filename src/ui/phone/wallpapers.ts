/**
 * The in-game phone's wallpapers: original, drawn with CSS gradients only (src/ui/phone/phone.css,
 * `[data-wall="<id>"]`). The choice is a preference of this device (localStorage) and nothing else;
 * it is never sent to the server. Chosen in Settings.
 */
export const WALLPAPER_KEY = 'joinallworld-wallpaper';
export const WALLPAPERS = Object.freeze([
  { id: 'lagoon', label: 'Lagoon dusk' },
  { id: 'harmattan', label: 'Harmattan' },
  { id: 'ankara', label: 'Ankara night' },
  { id: 'palm', label: 'Palm grove' },
]);
let current = null;

function store() { try { return globalThis.localStorage ?? null; } catch { return null; } }
/** The chosen wallpaper id; anything unknown or unreadable falls back to the first. */
export function getWallpaper() {
  if (current) return current;
  let saved = null;
  try { saved = store()?.getItem(WALLPAPER_KEY); } catch { saved = null; }
  current = WALLPAPERS.some((item) => item.id === saved) ? saved : WALLPAPERS[0].id;
  return current;
}
/** Choose a wallpaper. Returns false when the browser would not save it (it still applies until the tab closes). */
export function setWallpaper(id) {
  if (!WALLPAPERS.some((item) => item.id === id)) return false;
  current = id;
  try { const target = store(); if (!target) return false; target.setItem(WALLPAPER_KEY, id); return true; } catch { return false; }
}
