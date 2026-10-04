// The civic client of this page, wired to the application, and the helpers every civic screen
// uses: when to fetch, and why a control is off. Components import this; the badge of the
// Governor app and the registration do not (they need only civicCore.ts, which pulls in no
// application code, so the entry chunk stays small).
import { computed, onMounted, watch } from 'vue'
import type { ComputedRef } from 'vue'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import type { CivicEntry, Civic } from './civicCore.ts'
import { createCivic } from './civicCore.ts'

let shared: Civic | null = null
/** The one civic client of the page: one cache, one set of pending writes. */
export function useCivic(): Civic {
  if (!shared) {
    const { game, api } = useApp()
    shared = createCivic({
      fetchJson: game.fetchJson,
      refresh: () => game.command('civic.refresh'),
      newId: game.newId,
      toast: game.toast,
      connected: () => game.connected.value,
      cityId: () => game.cityId.value,
      linkWhy: () => linkWords(game.view.value)?.why ?? 'Not connected.',
      // The city map and the chips that are not converted yet draw the same listings.
      changed: () => api.refresh(),
    })
  }
  return shared
}

/** Why nothing can be sent right now, as a sentence for `what` ("vote", "rent"), or null when connected. */
export function useOffline(): (what: string) => string | null {
  const { game } = useApp()
  return (what) => (game.connected.value ? null : linkWords(game.view.value)?.cannot(what) ?? 'Not connected.')
}

/** One sentence saying why nothing can be changed right now ('' when connected). */
export function useLinkWhy(): () => string {
  const { game } = useApp()
  return () => (game.connected.value ? '' : linkWords(game.view.value)?.why ?? 'Not connected.')
}

export interface LoadSpec<T> {
  key: () => string
  path: () => string
  maxAge: number
  /** A screen that redraws on every state update re-checks its data then (the age limit keeps it from asking each time). */
  live?: boolean
  /** Fetch only while this is true (the radio is read only inside a club). */
  when?: () => boolean
  after?(item: CivicEntry<T>): void
}
/**
 * The cached response a screen shows, fetched when the screen opens, when what it shows changes
 * (the city) and when the connection comes back; a live screen also when the state is updated.
 * Never from a timer.
 */
export function useLoaded<T>(spec: LoadSpec<T>): { item: ComputedRef<CivicEntry<T>>; reload(): void } {
  const civic = useCivic()
  const { game } = useApp()
  const item = computed(() => civic.entry<T>(spec.key()))
  const run = (force = false): void => { if (spec.when && !spec.when()) return; void civic.load<T>(spec.key(), spec.path(), { maxAge: spec.maxAge, force, after: spec.after }) }
  onMounted(() => run())
  watch([() => spec.key(), () => spec.path(), () => game.connected.value, () => spec.when?.() ?? true], () => run())
  if (spec.live) watch(game.state, () => run())
  return { item, reload: () => run(true) }
}
