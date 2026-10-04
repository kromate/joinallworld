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
 *                     `jaw:key` CustomEvent on window ({ detail: { action } }) for scenes
 * Shortcuts are ignored while typing in a field and when Ctrl/Meta/Alt is held.
 */
export const SHORTCUTS = [
  { keys: ['m'], label: 'M', description: 'Map', run: 'open:map' },
  { keys: ['h'], label: 'H', description: 'Home', run: 'nav:home' },
  { keys: ['b'], label: 'B', description: 'Buy', run: 'open:buy' },
  { keys: ['p'], label: 'P', description: 'Phone', run: 'open:phone' },
  { keys: ['s'], label: 'S', description: 'Your Sim', run: 'open:sim' },
  { keys: ['t'], label: 'T', description: 'Show or hide activities', run: 'toggle:activities' },
  ...Array.from({ length: 9 }, (_, i) => ({ keys: [String(i + 1)], label: String(i + 1), description: `Spot ${i + 1}`, run: `spot:${i + 1}`, group: 'spots' })),
  { keys: ['e'], label: 'E', description: 'People here', run: 'open:people' },
  { keys: ['x'], label: 'X', description: 'Clean screen', run: 'clean' },
  { keys: ['ArrowUp'], label: '↑', description: 'Move furniture · pan the map', run: 'key:move-up', group: 'arrows' },
  { keys: ['ArrowDown'], label: '↓', description: 'Move furniture · pan the map', run: 'key:move-down', group: 'arrows' },
  { keys: ['ArrowLeft'], label: '←', description: 'Move furniture · pan the map', run: 'key:move-left', group: 'arrows' },
  { keys: ['ArrowRight'], label: '→', description: 'Move furniture · pan the map', run: 'key:move-right', group: 'arrows' },
  { keys: ['+', '='], label: '+', description: 'Zoom the map in', run: 'key:zoom-in', group: 'zoom' },
  { keys: ['-', '_'], label: '−', description: 'Zoom the map out', run: 'key:zoom-out', group: 'zoom' },
  { keys: ['0'], label: '0', description: 'Fit the whole city on the map', run: 'key:zoom-fit', group: 'zoom' },
  { keys: ['r'], label: 'R', description: 'Rotate furniture', run: 'key:rotate' },
  { keys: ['Enter'], label: 'Enter', description: 'Place furniture', run: 'key:place' },
  { keys: ['Delete', 'Backspace'], label: 'Del', description: 'Sell selected furniture', run: 'key:sell' },
  { keys: ['c'], label: 'C', description: 'Catalogue', run: 'key:catalogue' },
  { keys: ['Escape'], label: 'Esc', description: 'Close', run: 'close' },
  { keys: ['?'], label: '?', description: 'Keyboard help', run: 'help' },
];

/** Rows for the help overlay: grouped keys (1–9, arrows) collapse into one line. */
export function shortcutRows() {
  const rows = [];
  const seen = new Set();
  for (const shortcut of SHORTCUTS) {
    if (shortcut.group) {
      if (seen.has(shortcut.group)) continue;
      seen.add(shortcut.group);
      rows.push(shortcut.group === 'spots' ? { label: '1–9', description: 'Go to a spot' }
        : shortcut.group === 'zoom' ? { label: '+ − 0', description: 'Map: zoom in, zoom out, fit the city' } : { label: '← ↑ ↓ →', description: 'Move furniture' });
    } else rows.push({ label: shortcut.label, description: shortcut.description });
  }
  return rows;
}

/** Find the shortcut for a keydown event, or undefined. */
export function shortcutFor(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return SHORTCUTS.find((shortcut) => shortcut.keys.includes(key));
}
