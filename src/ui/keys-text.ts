/**
 * The words of the keyboard help: one description for each key binding of ./keys.ts, and the rows the help overlay lists.
 * Only the help sheet reads them, so they are fetched with it and not with the first page.
 */
import { SHORTCUTS } from './keys.ts';

/** One line of the help overlay. */
export interface ShortcutRow { label: string; description: string }

/** What each binding that is not in a group does, by its `run` (a grouped binding is described by its group's row). */
const DESCRIPTIONS: Record<string, string> = {
  'open:map': 'Map',
  'world': 'World map',
  'nav:home': 'Home',
  'open:buy': 'Buy',
  'open:phone': 'Phone',
  'open:sim': 'Your character',
  'toggle:activities': 'Show or hide activities',
  'open:people': 'People here',
  'clean': 'Clean screen',
  'walk:jog': 'Hold while walking to jog',
  'key:rotate': 'Rotate furniture (Buy)',
  'key:place': 'Place furniture',
  'key:sell': 'Sell selected furniture',
  'key:catalogue': 'Catalogue',
  'close': 'Close',
  'help': 'Keyboard help',
};

const GROUP_ROWS: Record<string, ShortcutRow> = {
  spots: { label: '1–9', description: 'Go to a spot' },
  walk: { label: 'W A S D', description: 'Walk (relative to the camera) · hold Shift to jog' },
  arrows: { label: '← ↑ ↓ →', description: 'Walk · in Buy: move furniture · on the map: pan' },
  look: { label: '[ ] PgUp PgDn', description: 'Camera: swing left / right, raise / lower' },
  zoom: { label: '+ − 0', description: 'Zoom in, zoom out, recentre (on the map: fit the city)' },
};

/** The description of a binding (a spot key is "Spot 3"). */
export const describe = (run: string): string => DESCRIPTIONS[run] ?? (run.startsWith('spot:') ? `Spot ${run.slice(5)}` : '');

/** Rows for the help overlay: grouped keys (1–9, W A S D, arrows, camera, zoom) collapse into one line. */
export function shortcutRows(): ShortcutRow[] {
  const rows: ShortcutRow[] = [];
  const seen = new Set<string>();
  for (const shortcut of SHORTCUTS) {
    if (shortcut.group) {
      if (seen.has(shortcut.group)) continue;
      seen.add(shortcut.group);
      rows.push({ ...GROUP_ROWS[shortcut.group]! }); // every group used in SHORTCUTS has a row
    } else rows.push({ label: shortcut.label, description: describe(shortcut.run) });
  }
  return rows;
}
