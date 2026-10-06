// Brings the launch bonus's chip and moment onto the page: a small app of its own in the guest slot of the bottom stack, fetched a few seconds after the
// page is up (hud/olderPointer.ts calls it). Nothing of the bonus is in the first download.
import { createApp } from 'vue'

let mounted = false
export function mountBonus(): void {
  const slot = document.querySelector('[data-slot="guest"]')
  if (mounted || !slot) return
  mounted = true
  const element = document.createElement('div')
  element.className = 'bonus-slot'
  slot.prepend(element)
  void import('./BonusHost.vue').then(({ default: host }) => { createApp(host).mount(element) }).catch(() => { mounted = false; element.remove() })
}
