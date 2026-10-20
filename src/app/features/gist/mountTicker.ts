// Puts the city news strip (Ticker.vue, variant "hud") into the notice slot above the navigation (docs/GIST.md, "The ticker"). It is a small root of
// its own, started from the chatter chunk that every player fetches once the game is up (src/app/chatter/start.ts), so the first download does not
// carry a line of it: no always-loaded component changed. It waits ten seconds so the first frames are not competing with it, finds the slot (the
// bottom stack exists once there is a life), and stays for the session.
import { createApp } from 'vue'
import Ticker from './Ticker.vue'

export const MOUNT_AFTER_MS = 10000
let mounted = false

export function mountTicker(find: () => Element | null = () => globalThis.document?.querySelector('[data-slot=notice]') ?? null, wait: number = MOUNT_AFTER_MS): void {
  if (mounted) return
  mounted = true
  const attach = (tries: number): void => {
    const slot = find()
    if (!slot) { if (tries > 0) globalThis.setTimeout(() => { attach(tries - 1) }, 5000); else mounted = false; return }
    const host = globalThis.document.createElement('div')
    slot.append(host)
    createApp(Ticker, { variant: 'hud' }).mount(host)
  }
  globalThis.setTimeout(() => { attach(6) }, wait)
}
