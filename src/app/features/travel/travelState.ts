// What the Map and the Ride app remember between draws. The existing panels kept this in module
// variables so that closing the Map and opening it again found the same place picked, the same
// filter and the same layers; here it is one reactive object each, kept for the page's lifetime in
// the same way. Nothing in it is saved or sent.
import { reactive, ref } from 'vue'
import { initialLayers } from './travelModel.ts'
import type { LayerState, MapUiDetail } from './travelModel.ts'

export interface MapUi {
  /** The place picked on the map or in the list; its card is on screen. */
  destination: string | null
  /** The way of travelling chosen on the card (null: the default). */
  mode: string | null
  filter: string
  /** 'world' is the country map behind the panel. */
  layer: 'city' | 'world'
  /** "+N more" was tapped on the card. */
  showAll: boolean
  /** Is the list of places open? null = not chosen yet: open on a wide screen, a handle on a phone. */
  listOpen: boolean | null
  /** Is "About" on the card open? */
  aboutOpen: boolean
}
export const mapUi = reactive<MapUi>({ destination: null, mode: null, filter: 'all', layer: 'city', showAll: false, listOpen: null, aboutOpen: false })
export const layers = reactive<LayerState>(initialLayers())
/** The way of travelling picked once in the Ride app. */
export const ride = reactive<{ wanted: string | null }>({ wanted: null })
/** What the panel last acted on: the city, the params object (by identity) and the layout it told the map about. */
export const seen: { city: string | null; params: unknown; layout: string } = { city: null, params: null, layout: '' }

/** The panel talks to the city map through the window event 'jaw:map-ui' (src/app/scene/MapPane.vue replays it until the map exists). */
export const tell = (detail: MapUiDetail): void => { globalThis.window?.dispatchEvent(new CustomEvent('jaw:map-ui', { detail })) }

export const wide = (): boolean => Boolean(globalThis.matchMedia?.('(min-width: 721px)').matches)
/** The same, as something a template can depend on. */
export const wideNow = ref(wide())
/** Follow the screen width while the Map is on screen; returns the function that stops. */
export function trackWide(): () => void {
  const query = globalThis.matchMedia?.('(min-width: 721px)')
  const update = (): void => { wideNow.value = Boolean(query?.matches) }
  update()
  query?.addEventListener('change', update)
  return () => { query?.removeEventListener('change', update) }
}
export const isListOpen = (): boolean => (mapUi.listOpen === null ? wideNow.value : mapUi.listOpen)
