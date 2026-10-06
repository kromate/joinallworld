// Buy mode's and the home chip's side of the conversation with the home scene (window events), and
// the actions that change the room. Components call these; the pure decisions are in buyModel.ts.
//
//   sends     'jaw:home-ui'     { selected, ghost, buy, retry? } — what the scene draws
//   receives  'jaw:home-pick'   { id, cell } — a tapped object or floor tile
//             'jaw:home-scene'  { status, placed } — ready / empty / error
import { watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { KINDS } from '../../../game/content/furniture.ts'
import { houseOf } from './houseOf.ts'
import { nudge, turn } from '../../../game/home-layout.ts'
import { MOVES, defOf, homeUi, objectOf, startGhost, whyNot } from './buyModel.ts'
import type { Ghost, GhostSource } from './buyModel.ts'
import { H, scene } from './homeState.ts'
import type { SceneStatus } from './homeState.ts'

let sent = ''
let started = false

/** Tell the scene what to draw, then ask the host for one frame of it. */
export function show(redraw = true): void {
  const { game, api } = useApp()
  const detail = homeUi(game.state.value, H)
  const next = JSON.stringify(detail)
  if (next !== sent) { sent = next; window.dispatchEvent(new CustomEvent('jaw:home-ui', { detail })) }
  if (redraw) api.redrawScene()
}

function onPick(event: Event): void {
  const { game, command, goTo } = useApp()
  const state = game.state.value
  if (state.location !== 'home') return
  const { id, cell } = ((event as CustomEvent<{ id?: string | null; cell?: { x: number; y: number } | null }>).detail ?? {})
  if (H.inBuy) {
    if (H.ghost) {
      const def = defOf(H.ghost.itemId)
      if (cell && def && !def.wall) { Object.assign(H.ghost, nudge(houseOf(state).grid, def, { x: cell.x, y: cell.y, rot: H.ghost.rot }, 0, 0)); show() }
      return
    }
    if ((id || null) !== H.selected) { H.selected = id || null; show() }
    return
  }
  const def = defOf(objectOf(state, id ?? null)?.itemId)
  if (!def || !id) return
  H.selected = id
  show(false)
  const spot = KINDS[def.kind]?.spot
  // Selecting the spot goes through the server; the accepted state redraws the scene with the marker.
  if (spot) void goTo('home', spot)
  else {
    // The line about the piece is fetched with this screen's first use of it (game/content/furniture-blurbs.ts).
    void import('../../../game/content/furniture-blurbs.ts').then(({ FURNITURE_BLURBS }) => game.toast(`${def.label} — ${FURNITURE_BLURBS[def.id]}`))
    if (state.spot) void command('spot', { id: state.spot })
  }
}

function onScene(event: Event): void {
  const detail = (event as CustomEvent<{ status?: SceneStatus; placed?: number }>).detail
  scene.status = detail?.status ?? 'ready'
  scene.placed = detail?.placed ?? 0
}

/**
 * Listen to the scene and keep the shared state honest: leaving Buy mode or the house cancels a
 * placement and clears the marker. Called once, from the home chip, which is in the HUD from the first paint.
 */
export function startHome(): void {
  if (started) return
  started = true
  const { game } = useApp()
  window.addEventListener('jaw:home-pick', onPick)
  window.addEventListener('jaw:home-scene', onScene)
  watch([game.state, () => game.mode.value], ([state, mode]) => {
    const buying = mode === 'buy'
    const left = H.inBuy && !buying
    H.inBuy = buying
    // A ghost whose piece is gone is dropped.
    if (H.ghost && (!defOf(H.ghost.itemId) || (H.ghost.objectId && !objectOf(state, H.ghost.objectId)))) H.ghost = null
    const chosen = H.selected ? objectOf(state, H.selected) : null
    if (left || (state.location !== 'home' && (H.ghost || H.selected)) || (H.selected && !chosen)) { H.ghost = null; H.selected = null; show(false) }
  }, { immediate: true })
}

/** "Try again" on a room that could not be drawn. */
export function retryRoom(): void {
  const { game, command } = useApp()
  sent = ''
  scene.status = 'loading'; scene.placed = 0
  window.dispatchEvent(new CustomEvent('jaw:home-ui', { detail: { selected: H.selected, buy: H.inBuy, ghost: null, retry: true } }))
  const state = game.state.value
  if (state.spot) void command('spot', { id: state.spot })
}

export function pickItem(source: GhostSource, itemId: string, objectId?: string): void {
  const { game } = useApp()
  const ghost = startGhost(game.state.value, source, itemId, objectId)
  if (!ghost) return
  H.ghost = ghost
  H.hidden = false
  show()
}

export function cancelGhost(): void { H.ghost = null; show() }
export function deselect(): void { H.selected = null; show() }

/** Move or turn the ghost; with a piece selected and no ghost, start moving that piece first. */
export function moveGhost(action: string): void {
  const { game } = useApp()
  const state = game.state.value
  const selected = H.selected ? objectOf(state, H.selected) : undefined
  if (!H.ghost && selected && H.selected) { const ghost = startGhost(state, 'move', selected.itemId, H.selected); if (ghost) { H.ghost = ghost; H.hidden = false } }
  const ghost = H.ghost
  if (!ghost) return
  const def = defOf(ghost.itemId)
  if (!def) return
  const grid = houseOf(state).grid
  const step = MOVES[action]
  const here = { x: ghost.x, y: ghost.y, rot: ghost.rot }
  Object.assign(ghost, action === 'rotate' ? turn(grid, def, here) : step ? nudge(grid, def, here, step[0], step[1]) : here)
  show()
}

export async function placeGhost(): Promise<void> {
  const { game, command } = useApp()
  const state = game.state.value
  const ghost: Ghost | null = H.ghost
  if (!ghost || whyNot(state, ghost)) return
  const at = { x: ghost.x, y: ghost.y, rot: ghost.rot }
  const result = ghost.source === 'move' && ghost.objectId ? await command('home.furniture-move', { id: ghost.objectId, ...at })
    : ghost.source === 'storage' ? await command('home.furniture-place', { item: ghost.itemId, ...at }) : await command('home.furniture-buy', { item: ghost.itemId, ...at })
  if (!result.ok) return
  game.toast(game.state.value.message, 'good')
  H.ghost = null; H.selected = null
  show()
}

export async function sellSelected(): Promise<void> {
  const { game, command } = useApp()
  const placed = objectOf(game.state.value, H.selected)
  if (!placed || H.ghost) return
  const result = await command('home.furniture-sell', { id: placed.id })
  if (!result.ok) return
  game.toast(game.state.value.message, 'good')
  H.selected = null
  show()
}

export async function storeSelected(): Promise<void> {
  const { command } = useApp()
  const id = H.selected
  if (!id) return
  H.selected = null
  await command('home.furniture-store', { id })
  show()
}

/** Esc, and the catalogue shortcut: what Buy mode does with a key the shell offers it. */
export function buyKey(action: string): boolean {
  if (action === 'cancel') {
    if (!H.ghost) return false // nothing being placed: let the shell leave Buy mode
    cancelGhost()
    return true
  }
  if (action in MOVES || action === 'rotate') moveGhost(action)
  else if (action === 'place') void placeGhost()
  else if (action === 'sell') void sellSelected()
  else if (action === 'catalogue') { H.ghost = null; H.hidden = !H.hidden; show() }
  return false
}
