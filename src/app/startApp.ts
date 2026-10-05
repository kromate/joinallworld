// Loaded after the selected city's content. The game keeps its existing shell and diagnostics.
import App from './App.vue'
import { useApp } from './state/app.ts'
import { telemetry } from '../telemetry/index.ts'
import { warmLanding } from './features/start/warmLanding.ts'

warmLanding()
export default App

/** Runs after the game shell has mounted. */
export function ready(): void {
  telemetry.hudReady()
  // `?diagnostics`: the scene's frame counter, readable by a person and by a test harness. The count
  // is flat while the game is idle; a Vue re-render alone must never move it.
  if (new URLSearchParams(location.search).has('diagnostics')) {
    void import('./diagnostics.ts').then(({ installDiagnostics }) => installDiagnostics()).catch(() => {
      useApp().game.toast('Diagnostics could not load. Reload to try again.')
    })
  }
}
