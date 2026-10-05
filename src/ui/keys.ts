/**
 * Keyboard shortcuts — the single data file for every key the game handles.
 * The shell (src/ui/shell.js) interprets `run`:
 *   'nav:<mode>'      bottom-nav behaviour: home | venue
 *   'open:<panelId>'  open (or toggle) a registered panel; 'open:phone' and 'open:sim' are shell sheets
 *   'toggle:activities'  expand/collapse the activity cards
 *   'spot:<n>'        select the n-th spot of the current venue (1-based)
 *   'world'           the Map on the atlas at the world level: every city that can be travelled to
 *   'clean'           toggle Clean screen (hide the panels, keep the top bar and the nav)
 *   'close'           close the open sheet, or leave a nav panel
 *   'help'            the shortcut overlay
 *   'key:<action>'    forwarded to the open panel's keys(action, api), and broadcast as a
 *                     `jaw:key` CustomEvent on window ({ detail: { action, mode, jog } }) for scenes
 *   'walk:<dir>'      up | down | left | right | jog — held to walk the avatar in the venue or home
 *                     scene (broadcast as `jaw:key` 'walk-<dir>'; the release as `jaw:key-up`)
 *   'look:<dir>'      left | right | up | down — held to turn or tilt the scene camera
 * The words of each row (what the help sheet reads) are in ./keys-text.ts, which is fetched with the sheet.
 * Shortcuts are ignored while typing in a field and when Ctrl/Meta/Alt is held.
 *
 * WHO GETS THE ARROWS, + AND −. ([ ] PgUp PgDn turn and tilt the camera in a scene and the map alike.) One key never does two things at once; the view decides:
 *   venue / home scene (no sheet open)   arrows and W A S D walk; + − zoom the scene; 0 recentres it
 *   Buy mode (placing furniture)         arrows move the furniture (W A S D do nothing); + − 0 zoom the room
 *   Map                                  arrows pan; + − 0 zoom the map; [ ] turn it; PgUp PgDn tip it
 *   a sheet is open                      none of them reach the scene
 * S used to open the Sim sheet; it is a walking key now, and the Sim sheet is on I.
 */
/** One key binding. `run` is interpreted by the shell (see above); `group` collapses several keys into one help row. */
export interface Shortcut { keys: string[]; label: string; run: string; group?: string }
/** What shortcutFor reads of a keydown event. */
export interface KeyLike { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }

export const SHORTCUTS: Shortcut[] = [
  { keys: ['m'], label: 'M', run: 'open:map' },
  { keys: ['g'], label: 'G', run: 'world' },
  { keys: ['h'], label: 'H', run: 'nav:home' },
  { keys: ['b'], label: 'B', run: 'open:buy' },
  { keys: ['p'], label: 'P', run: 'open:phone' },
  { keys: ['i'], label: 'I', run: 'open:sim' },
  { keys: ['t'], label: 'T', run: 'toggle:activities' },
  ...Array.from({ length: 9 }, (_, i) => ({ keys: [String(i + 1)], label: String(i + 1), run: `spot:${i + 1}`, group: 'spots' })),
  { keys: ['e'], label: 'E', run: 'open:people' },
  { keys: ['x'], label: 'X', run: 'clean' },
  { keys: ['w'], label: 'W', run: 'walk:up', group: 'walk' },
  { keys: ['a'], label: 'A', run: 'walk:left', group: 'walk' },
  { keys: ['s'], label: 'S', run: 'walk:down', group: 'walk' },
  { keys: ['d'], label: 'D', run: 'walk:right', group: 'walk' },
  { keys: ['Shift'], label: 'Shift', run: 'walk:jog' },
  { keys: ['ArrowUp'], label: '↑', run: 'key:move-up', group: 'arrows' },
  { keys: ['ArrowDown'], label: '↓', run: 'key:move-down', group: 'arrows' },
  { keys: ['ArrowLeft'], label: '←', run: 'key:move-left', group: 'arrows' },
  { keys: ['ArrowRight'], label: '→', run: 'key:move-right', group: 'arrows' },
  { keys: ['['], label: '[', run: 'look:left', group: 'look' },
  { keys: [']'], label: ']', run: 'look:right', group: 'look' },
  { keys: ['PageUp'], label: 'PgUp', run: 'look:up', group: 'look' },
  { keys: ['PageDown'], label: 'PgDn', run: 'look:down', group: 'look' },
  { keys: ['+', '='], label: '+', run: 'key:zoom-in', group: 'zoom' },
  { keys: ['-', '_'], label: '−', run: 'key:zoom-out', group: 'zoom' },
  { keys: ['0'], label: '0', run: 'key:zoom-fit', group: 'zoom' },
  { keys: ['r'], label: 'R', run: 'key:rotate' },
  { keys: ['Enter'], label: 'Enter', run: 'key:place' },
  { keys: ['Delete', 'Backspace'], label: 'Del', run: 'key:sell' },
  { keys: ['c'], label: 'C', run: 'key:catalogue' },
  { keys: ['Escape'], label: 'Esc', run: 'close' },
  { keys: ['?'], label: '?', run: 'help' },
];

/** Find the shortcut for a keydown event, or undefined. */
export function shortcutFor(event: KeyLike): Shortcut | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return SHORTCUTS.find((shortcut) => shortcut.keys.includes(key));
}

/**
 * The held action a key stands for (walking, turning the camera), whatever modifiers are down —
 * so a key released with Ctrl held is still released. → 'walk-up' | 'move-left' | 'look-up' | … | undefined
 */
export function heldActionFor(event?: { key?: unknown } | null): string | undefined {
  const raw = event?.key;
  const key = typeof raw === 'string' && raw.length === 1 ? raw.toLowerCase() : raw;
  const shortcut = SHORTCUTS.find((item) => typeof key === 'string' && item.keys.includes(key));
  if (!shortcut) return undefined;
  const [verb, arg] = shortcut.run.split(':');
  if (verb === 'walk' || verb === 'look') return `${verb}-${arg}`;
  return verb === 'key' && arg?.startsWith('move-') ? arg : undefined;
}
