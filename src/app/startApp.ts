// Loaded after the selected city's content. The game keeps its existing shell and diagnostics.
import App from './App.vue'
import { useApp } from './state/app.ts'
import { telemetry } from '../telemetry/index.ts'
import { landingCodeSettled } from './features/start/warmLanding.ts'
import { preloadNext } from './state/idlePreload.ts'
import { watch } from 'vue'

export default App

/** Runs after the game shell has mounted. */
export function ready(): void {
  telemetry.hudReady()
  // Then, when the browser is idle, what is opened next (the phone, the map, Jobs, Groceries, Buy mode, the Boutique).
  // The scene is what the first screen waits for: nothing is fetched beside it (or after ten seconds, when it never comes).
  const sceneShown = new Promise<void>((resolve) => {
    const { scene } = useApp()
    if (scene.venue.value) { resolve(); return }
    const stop = watch(scene.venue, (venue) => { if (venue) { stop(); resolve() } })
    globalThis.setTimeout(resolve, 10000)
  })
  preloadNext(Promise.all([landingCodeSettled(), sceneShown]))
  // `?diagnostics`: the scene's frame counter, readable by a person and by a test harness; a short address (/games, /abuja, …): its chunk. Fetched only then (./startExtras.ts).
  // `?models=…`: the model flags (src/models/integration/flags.ts) that start something after ready; startExtras reads which.
  const search = new URLSearchParams(location.search)
  const diagnostics = search.has('diagnostics')
  if (diagnostics || search.has('models') || location.pathname !== '/') void import('./startExtras.ts').then(({ startExtras }) => { startExtras(diagnostics) })
}
