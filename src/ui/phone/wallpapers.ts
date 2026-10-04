/**
 * The in-game phone's wallpapers: original, drawn with CSS gradients only (src/ui/phone/phone.css,
 * `[data-wall="<id>"]`). The choice is a preference of this device (localStorage) and nothing else;
 * it is never sent to the server. Chosen in Settings.
 */
export const WALLPAPER_KEY = 'joinallworld-wallpaper';
export interface Wallpaper { id: string; label: string }
export const WALLPAPERS: readonly Wallpaper[] = Object.freeze([
  { id: 'lagoon', label: 'Lagoon dusk' },
  { id: 'harmattan', label: 'Harmattan' },
  { id: 'ankara', label: 'Ankara night' },
  { id: 'palm', label: 'Palm grove' },
]);
let current: string | null = null;

function store(): Pick<Storage, 'getItem' | 'setItem'> | null { try { return globalThis.localStorage ?? null; } catch { return null; } }
/** The chosen wallpaper id; anything unknown or unreadable falls back to the first. */
export function getWallpaper(): string {
  if (current) return current;
  let saved: string | null | undefined = null;
  try { saved = store()?.getItem(WALLPAPER_KEY); } catch { saved = null; }
  // The list is never empty, so the first entry exists.
  current = WALLPAPERS.some((item) => item.id === saved) ? saved! : WALLPAPERS[0]!.id;
  return current;
}
/** Choose a wallpaper. Returns false when the browser would not save it (it still applies until the tab closes). */
export function setWallpaper(id: string): boolean {
  if (!WALLPAPERS.some((item) => item.id === id)) return false;
  current = id;
  try { const target = store(); if (!target) return false; target.setItem(WALLPAPER_KEY, id); return true; } catch { return false; }
}
