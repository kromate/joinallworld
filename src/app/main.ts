// Paint a small loading screen before fetching the selected city and the game shell.
import { createApp } from 'vue'
import BootScreen from './BootScreen.vue'
import { loadGame } from './bootstrap.ts'
import { isChunkLoadError, noteChunkFailure } from './state/updateNotice.ts'

const app = createApp(BootScreen, { load: loadGame })
app.config.errorHandler = (error, _instance, info) => {
  console.error(`The shell failed in ${info}:`, error)
  if (isChunkLoadError(error)) void noteChunkFailure()
}
window.addEventListener('vite:preloadError', () => { void noteChunkFailure() })
app.mount('#app')
