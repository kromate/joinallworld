// Paint a small loading screen before fetching the selected city and the game shell.
import { createApp } from 'vue'
import BootScreen from './BootScreen.vue'
import { loadGame } from './bootstrap.ts'
import InAppTip from './InAppTip.vue'
import { markInAppBrowser, isStandalone } from './state/inAppBrowser.ts'
import { isChunkLoadError, noteChunkFailure } from './state/updateNotice.ts'

markInAppBrowser(document.documentElement, navigator.userAgent, { standalone: isStandalone() })
const app = createApp(BootScreen, { load: loadGame })
app.config.errorHandler = (error, _instance, info) => {
  console.error(`The shell failed in ${info}:`, error)
  if (isChunkLoadError(error)) void noteChunkFailure()
}
window.addEventListener('vite:preloadError', () => { void noteChunkFailure() })
app.mount('#app')
// A separate small app, so the tip stays on screen after the loading screen hands over to the game.
const tipHost = document.createElement('div')
document.body.appendChild(tipHost)
createApp(InAppTip).mount(tipHost)
