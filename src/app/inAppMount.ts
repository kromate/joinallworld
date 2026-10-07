// Fetched only when the user agent looks like another app's built-in browser (main.ts), so none of it is in the first download.
import { createApp } from 'vue'
import InAppTip from './InAppTip.vue'
import { isStandalone, markInAppBrowser } from './state/inAppBrowser.ts'

export function mountInAppTip(): void {
  markInAppBrowser(document.documentElement, navigator.userAgent, { standalone: isStandalone() })
  // A separate small app, so the tip stays on screen after the loading screen hands over to the game.
  const host = document.createElement('div')
  document.body.appendChild(host)
  createApp(InAppTip).mount(host)
}
