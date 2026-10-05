// The keyboard shortcuts sheet, derived from the game's own key table (src/ui/keys.ts): each row names the
// bindings it describes, its key-caps are read from them, and a test fails when a listed key has no handler.
// Touch devices get the gestures instead. Gestures are described in the words of the scene's own on-screen
// lessons (src/venue-world.ts, src/map3d/map3d.ts); they have no key and are not checked against the table.
import { SHORTCUTS } from '../../../ui/keys.ts'

export interface ShortcutRow {
  /** The key-caps, or the words of a gesture. */
  caps: string[]
  text: string
  /** The `run` values of src/ui/keys.ts this row describes (empty for a gesture or a native control). */
  runs: string[]
  /** Chosen over the table because the browser itself does it (Enter in a chat box). */
  native?: boolean
}
export interface ShortcutGroup { id: string; title: string; rows: ShortcutRow[] }

/** The label a run's key is shown with; throws for a run the table does not have, so a stale row fails at once. */
export function capOf(run: string): string {
  const found = SHORTCUTS.find((shortcut) => shortcut.run === run)
  if (!found) throw new Error(`no shortcut runs ${run}`)
  return found.label
}
const keys = (runs: string[], text: string): ShortcutRow => ({ caps: runs.map(capOf), text, runs })
const gesture = (caps: string[], text: string): ShortcutRow => ({ caps, text, runs: [] })

const SPOT_RUNS = Array.from({ length: 9 }, (_, index) => `spot:${index + 1}`)

const DESKTOP: ShortcutGroup[] = [
  { id: 'move', title: 'Move', rows: [
    keys(['walk:up', 'walk:left', 'walk:down', 'walk:right'], 'Walk, from the camera’s point of view'),
    keys(['key:move-up', 'key:move-down', 'key:move-left', 'key:move-right'], 'Walk too'),
    keys(['walk:jog'], 'Hold while walking to jog'),
    gesture(['Click'], 'The floor, a spot or a person to walk there'),
  ] },
  { id: 'camera', title: 'Camera', rows: [
    keys(['look:left', 'look:right'], 'Swing the camera'),
    keys(['look:up', 'look:down'], 'Look from higher or lower'),
    keys(['key:zoom-in', 'key:zoom-out'], 'Zoom in and out'),
    keys(['key:zoom-fit'], 'Reset the camera view'),
    gesture(['Drag'], 'Look around'),
    gesture(['Right-drag'], 'Slide the view (or hold Shift and drag)'),
    gesture(['Scroll'], 'Zoom'),
  ] },
  { id: 'map', title: 'Map', rows: [
    keys(['open:map'], 'Open or close the map'),
    keys(['world'], 'World map: every city you can travel to'),
    keys(['key:move-up', 'key:move-down', 'key:move-left', 'key:move-right'], 'Pan the map'),
    keys(['key:zoom-in', 'key:zoom-out'], 'Zoom the map'),
    keys(['key:zoom-fit'], 'Fit the whole city'),
    keys(['look:left', 'look:right'], 'Turn the map'),
    gesture(['Drag'], 'Move the map: the ground follows the pointer'),
    gesture(['Right-drag'], 'Turn and tilt the map (or hold Shift or Ctrl and drag)'),
    gesture(['Scroll'], 'Zoom towards the pointer; double-click zooms in'),
    gesture(['Compass'], 'Appears when the map is turned: one click puts north up'),
  ] },
  { id: 'panels', title: 'Phone and panels', rows: [
    keys(['open:phone'], 'Phone'),
    keys(['open:sim'], 'Your character: profile, needs, goals'),
    keys(['nav:home'], 'Go home'),
    keys(['open:buy'], 'Buy furniture'),
    keys(['open:people'], 'People here'),
    keys(['toggle:activities'], 'Show or hide activities'),
    { caps: ['1–9'], text: 'Go to a spot', runs: SPOT_RUNS },
    keys(['clean'], 'Clean screen: hide the panels'),
    keys(['key:rotate'], 'In Buy: rotate'),
    keys(['key:place'], 'In Buy: place'),
    keys(['key:sell'], 'In Buy: sell'),
    keys(['key:catalogue'], 'In Buy: catalogue'),
  ] },
  { id: 'chat', title: 'Chat and voice', rows: [
    { caps: ['Enter'], text: 'Send your message', runs: [], native: true },
    gesture(['Typing'], 'Other shortcuts wait while you type in a box'),
  ] },
  { id: 'general', title: 'General', rows: [
    keys(['close'], 'Close what is open, one step at a time'),
    keys(['help'], 'Show this list'),
  ] },
]

const TOUCH: ShortcutGroup[] = [
  { id: 'move', title: 'Move', rows: [
    gesture(['Stick'], 'Drag the stick to walk'),
    gesture(['Tap'], 'Tap the floor, a spot or a person to walk there'),
  ] },
  { id: 'camera', title: 'Camera', rows: [
    gesture(['Drag'], 'Look around'),
    gesture(['Two fingers'], 'Slide the view, turn it, and pinch to zoom'),
    gesture(['◎'], 'The button resets the view'),
  ] },
  { id: 'map', title: 'Map', rows: [
    gesture(['Drag'], 'Move the map'),
    gesture(['Pinch'], 'Zoom'),
    gesture(['Twist'], 'Turn the map with two fingers'),
    gesture(['Compass'], 'Appears when the map is turned: tap it to put north up'),
    gesture(['Double tap'], 'Zoom in'),
    gesture(['Tap'], 'A building to go there'),
    gesture(['Tap'], 'World, at the top of the map, then a city to travel there'),
  ] },
  { id: 'panels', title: 'Phone and panels', rows: [
    gesture(['Tap'], 'Home, Buy, Map and Phone at the bottom'),
    gesture(['Tap'], 'Your avatar for your character'),
    gesture(['Tap'], 'The eye to hide the panels'),
  ] },
  { id: 'chat', title: 'Chat and voice', rows: [
    gesture(['Tap'], 'The chat button to talk to people here'),
  ] },
  { id: 'general', title: 'General', rows: [
    gesture(['×'], 'Close a sheet, or swipe back'),
  ] },
]

/** The groups the sheet lists: the keys on a device with a keyboard, the gestures on one without, both on a device that has both. */
export const shortcutGroups = (touch: boolean, keys = !touch): ShortcutGroup[] => (touch && keys ? [...DESKTOP, ...TOUCH.map((group) => ({ ...group, id: `touch-${group.id}`, title: `${group.title} · touch` }))] : touch ? TOUCH : DESKTOP)

/** The `event.key` values of the bindings a row describes: what a test presses to see the row is true. */
export function keysOf(row: ShortcutRow): string[] {
  return row.runs.flatMap((run) => SHORTCUTS.filter((shortcut) => shortcut.run === run).flatMap((shortcut) => shortcut.keys))
}
