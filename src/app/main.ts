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
// A quick guess from the user agent; the real detection, the page marker and the tip are fetched only inside another app's browser.
if (/Instagram|FBA[NV]|FB_IAB|FBIOS|musical_ly|Bytedance|TikTok|Snapchat|LinkedInApp|Twitter|; wv\)|(iPhone|iPad|iPod)(?!.*Safari\/)/i.test(navigator.userAgent)) {
  void import('./inAppMount.ts').then((m) => { m.mountInAppTip() }, () => undefined)
}
