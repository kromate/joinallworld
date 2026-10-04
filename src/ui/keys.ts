/**
 * Keyboard shortcuts — the single data file for every key the game handles.
 * The shell (src/ui/shell.js) interprets `run`:
 *   'nav:<mode>'      bottom-nav behaviour: home | venue
 *   'open:<panelId>'  open (or toggle) a registered panel; 'open:phone' and 'open:sim' are shell sheets
 *   'toggle:activities'  expand/collapse the activity cards
 *   'spot:<n>'        select the n-th spot of the current venue (1-based)
 *   'clean'           toggle Clean screen (hide the panels, keep the top bar and the nav)
 *   'close'           close the open sheet, or leave a nav panel
 *   'help'            the shortcut overlay
 *   'key:<action>'    forwarded to the open panel's keys(action, api), and broadcast as a
 *                     `jaw:key` CustomEvent on window ({ detail: { action, mode, jog } }) for scenes
 *   'walk:<dir>'      up | down | left | right | jog — held to walk the avatar in the venue or home
 *                     scene (broadcast as `jaw:key` 'walk-<dir>'; the release as `jaw:key-up`)
 *   'look:<dir>'      left | right | up | down — held to turn or tilt the scene camera
 * Shortcuts are ignored while typing in a field and when Ctrl/Meta/Alt is held.
 *
 * WHO GETS THE ARROWS, + AND −. One key never does two things at once; the view decides:
 *   venue / home scene (no sheet open)   arrows and W A S D walk; + − zoom the scene; 0 recentres it
 *   Buy mode (placing furniture)         arrows move the furniture (W A S D do nothing); + − 0 zoom the room
 *   Map                                  arrows pan; + − 0 zoom the map
 *   a sheet is open                      none of them reach the scene
 * S used to open the Sim sheet; it is a walking key now, and the Sim sheet is on I.
 */
/** One key binding. `run` is interpreted by the shell (see above); `group` collapses several keys into one help row. */
export interface Shortcut { keys: string[]; label: string; description: string; run: string; group?: string }
/** One line of the help overlay. */
export interface ShortcutRow { label: string; description: string }
/** What shortcutFor reads of a keydown event. */
export interface KeyLike { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }

export const SHORTCUTS: Shortcut[] = [
  { keys: ['m'], label: 'M', description: 'Map', run: 'open:map' },
  { keys: ['h'], label: 'H', description: 'Home', run: 'nav:home' },
  { keys: ['b'], label: 'B', description: 'Buy', run: 'open:buy' },
  { keys: ['p'], label: 'P', description: 'Phone', run: 'open:phone' },
  { keys: ['i'], label: 'I', description: 'Your Sim', run: 'open:sim' },
  { keys: ['t'], label: 'T', description: 'Show or hide activities', run: 'toggle:activities' },
  ...Array.from({ length: 9 }, (_, i) => ({ keys: [String(i + 1)], label: String(i + 1), description: `Spot ${i + 1}`, run: `spot:${i + 1}`, group: 'spots' })),
  { keys: ['e'], label: 'E', description: 'People here', run: 'open:people' },
  { keys: ['x'], label: 'X', description: 'Clean screen', run: 'clean' },
  { keys: ['w'], label: 'W', description: 'Walk away from the camera', run: 'walk:up', group: 'walk' },
  { keys: ['a'], label: 'A', description: 'Walk left', run: 'walk:left', group: 'walk' },
  { keys: ['s'], label: 'S', description: 'Walk towards the camera', run: 'walk:down', group: 'walk' },
  { keys: ['d'], label: 'D', description: 'Walk right', run: 'walk:right', group: 'walk' },
  { keys: ['Shift'], label: 'Shift', description: 'Hold while walking to jog', run: 'walk:jog' },
  { keys: ['ArrowUp'], label: '↑', description: 'Walk · move furniture in Buy · pan the map', run: 'key:move-up', group: 'arrows' },
  { keys: ['ArrowDown'], label: '↓', description: 'Walk · move furniture in Buy · pan the map', run: 'key:move-down', group: 'arrows' },
  { keys: ['ArrowLeft'], label: '←', description: 'Walk · move furniture in Buy · pan the map', run: 'key:move-left', group: 'arrows' },
  { keys: ['ArrowRight'], label: '→', description: 'Walk · move furniture in Buy · pan the map', run: 'key:move-right', group: 'arrows' },
  { keys: ['['], label: '[', description: 'Swing the camera left', run: 'look:left', group: 'look' },
  { keys: [']'], label: ']', description: 'Swing the camera right', run: 'look:right', group: 'look' },
  { keys: ['PageUp'], label: 'PgUp', description: 'Raise the camera (look from above)', run: 'look:up', group: 'look' },
  { keys: ['PageDown'], label: 'PgDn', description: 'Lower the camera (look along the ground)', run: 'look:down', group: 'look' },
  { keys: ['+', '='], label: '+', description: 'Zoom in (the scene, or the map)', run: 'key:zoom-in', group: 'zoom' },
  { keys: ['-', '_'], label: '−', description: 'Zoom out (the scene, or the map)', run: 'key:zoom-out', group: 'zoom' },
  { keys: ['0'], label: '0', description: 'Recentre the camera · fit the whole city on the map', run: 'key:zoom-fit', group: 'zoom' },
  { keys: ['r'], label: 'R', description: 'Rotate furniture (Buy)', run: 'key:rotate' },
  { keys: ['Enter'], label: 'Enter', description: 'Place furniture', run: 'key:place' },
  { keys: ['Delete', 'Backspace'], label: 'Del', description: 'Sell selected furniture', run: 'key:sell' },
  { keys: ['c'], label: 'C', description: 'Catalogue', run: 'key:catalogue' },
  { keys: ['Escape'], label: 'Esc', description: 'Close', run: 'close' },
  { keys: ['?'], label: '?', description: 'Keyboard help', run: 'help' },
];

const GROUP_ROWS: Record<string, ShortcutRow> = {
  spots: { label: '1–9', description: 'Go to a spot' },
  walk: { label: 'W A S D', description: 'Walk (relative to the camera) · hold Shift to jog' },
  arrows: { label: '← ↑ ↓ →', description: 'Walk · in Buy: move furniture · on the map: pan' },
  look: { label: '[ ] PgUp PgDn', description: 'Camera: swing left / right, raise / lower' },
  zoom: { label: '+ − 0', description: 'Zoom in, zoom out, recentre (on the map: fit the city)' },
};

/** Rows for the help overlay: grouped keys (1–9, W A S D, arrows, camera, zoom) collapse into one line. */
export function shortcutRows(): ShortcutRow[] {
  const rows: ShortcutRow[] = [];
  const seen = new Set<string>();
  for (const shortcut of SHORTCUTS) {
    if (shortcut.group) {
      if (seen.has(shortcut.group)) continue;
      seen.add(shortcut.group);
      rows.push({ ...GROUP_ROWS[shortcut.group]! }); // every group used in SHORTCUTS has a row
    } else rows.push({ label: shortcut.label, description: shortcut.description });
  }
  return rows;
}

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
