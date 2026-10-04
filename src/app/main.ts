// Entry of the game: index.html → this file. The shell is a Vue 3 application over the client model
// (src/client.ts), the rules (src/game), the scenes (src/scene, src/campus, src/map3d) and the server.
import { createApp } from 'vue'
import App from './App.vue'
import { useApp } from './state/app.ts'
import { telemetry } from '../telemetry/index.ts'
import { isChunkLoadError, noteChunkFailure } from './state/updateNotice.ts'
import { warmLanding } from './features/start/warmLanding.ts'

warmLanding() // a device that has never played opens on the landing: fetch its code now, not after the first paint
const app = createApp(App)
app.config.errorHandler = (error, _instance, info) => { console.error(`The shell failed in ${info}:`, error); if (isChunkLoadError(error)) void noteChunkFailure() }
// A lazy chunk that no longer exists (the app was updated while this tab was open): see state/updateNotice.ts.
window.addEventListener('vite:preloadError', () => { void noteChunkFailure() })
app.mount('#app')
// The HUD is on screen: the first telemetry mark (the facade keeps it until, and unless, telemetry is configured).
telemetry.hudReady()

// `?diagnostics`: the scene's frame counter, readable by a person and by a test harness. The count
// is flat while the game is idle; a Vue re-render alone must never move it.
if (new URLSearchParams(location.search).has('diagnostics')) {
  const { game, scene, panels, shell, community } = useApp()
  const panel = document.createElement('aside')
  panel.style.cssText = 'position:fixed;left:10px;bottom:90px;z-index:60;background:white;color:black;padding:8px;max-width:340px;font:12px monospace'
  const button = document.createElement('button'); button.textContent = 'Read renderer diagnostics'
  const output = document.createElement('pre'); output.id = 'render-diagnostics'
  const read = (): Record<string, unknown> => ({ ...(scene.venue.value ? scene.venue.value.diagnostics() : { renderCount: 0, scene: 'not loaded yet' }), map: scene.city.value ? scene.city.value.diagnostics() : 'not loaded yet', visibility: document.visibilityState, shell: 'vue', lazyPanelsWaiting: panels.filter((item) => 'pending' in item && item.pending).map((item) => item.id) })
  button.onclick = () => { output.textContent = JSON.stringify(read(), null, 2) }
  Object.assign(window, { __jaw: { get map() { return scene.city.value }, get client() { return game.client }, get mode() { return game.mode.value }, get venue() { return scene.venue.value }, get shell() { return shell }, get community() { return community }, read } })
  panel.append(button, output); document.body.append(panel)
}
