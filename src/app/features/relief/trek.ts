// "Go there" of the help card and of the goal line under the needs bars: the way to the public place of a city (where the odd job, the bench and
// the tap are) is a free walk, so it is started at the tap, and on arrival the spot is selected, the activities are shown and the card of the
// activity asked for is marked, so nobody has to hunt for it. When the walk cannot start (something else is running, the trek is refused) the
// Map's travel card for the place is opened instead, with the reason, and the spot is still selected on arrival (the shell's own memory of it).
import { watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { pointAt } from '../kit/section.ts'

const GIVE_UP_MS = 15 * 60_000

/** What the walk needs from the game, so the routing can be tested without one. */
export interface TrekEnv {
  here(): string
  /** Start the free walk; true once the server accepted it. */
  walk(venue: string): Promise<boolean>
  /** The open Map card for the place, remembering the spot (the game's own goTo). */
  card(venue: string, spot?: string): Promise<void>
  /** Called with where the player is and whether something is still running, at every change; returns how to stop listening. */
  settle(listener: (location: string, running: boolean) => void): () => void
  arrived(spot?: string): void
  mark(): void
}

export async function trek(env: TrekEnv, venue: string, spot?: string): Promise<void> {
  if (env.here() === venue) { await env.card(venue, spot); env.mark(); return }
  if (!(await env.walk(venue))) { await env.card(venue, spot); return }
  let ran = false
  const stop = env.settle((location, running) => {
    if (running) { ran = true; return }
    if (!ran) return
    stop(); clearTimeout(timer)
    if (location !== venue) return // cancelled on the way
    env.arrived(spot); env.mark()
  })
  const timer = setTimeout(stop, GIVE_UP_MS)
}

/** `label` is the activity's card as the place shows it (its title starts the card's accessible name). */
export function trekTo(venue: string, spot?: string, label?: string): Promise<void> {
  const { game, shell, command, goTo } = useApp()
  return trek({
    here: () => game.state.value.location,
    walk: async (to) => (await command('travel', { id: to, mode: 'trek' })).ok,
    card: (to, at) => goTo(to, at),
    settle: (listener) => watch(() => [game.state.value.location, game.state.value.activeAction] as const, ([location, running]) => listener(location, Boolean(running))),
    arrived: (at) => { shell.ui.expanded = true; if (at && game.state.value.spot !== at) void command('spot', { id: at }) },
    mark: () => { if (label) pointAt(() => [...document.querySelectorAll<HTMLElement>('.life-actions > [aria-label]')].find((card) => card.getAttribute('aria-label')?.startsWith(label))) },
  }, venue, spot)
}
