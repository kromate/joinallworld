// What brings the companion in, fetched after the first frame (App.vue). It waits until the game is on screen and settled (connected, past
// character creation, a venue drawn), gives the browser a quiet moment, and then mounts the companion's own small app: a separate Vue app on
// its own element, since everything it shows is teleported to the body and everything it reads is the shell's shared state. Asked for out
// loud (the chat), it comes at once. Nothing of the companion is in the first download but the one line in App.vue that fetches this.
import { createApp, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { companionUi } from './companionState.ts'

let started = false
export function startCompanion(): void {
  if (started) return
  started = true
  const { game, scene } = useApp()
  let mounted = false
  const mount = (): void => {
    if (mounted) return
    mounted = true
    void import('./CompanionHost.vue').then(({ default: host }) => {
      const element = document.createElement('div')
      document.body.append(element)
      createApp(host).mount(element)
    }).catch(() => { mounted = false })
  }
  watch(() => game.connected.value && game.view.value.onboarding?.required !== true && Boolean(scene.venue.value), (ready) => { if (ready) setTimeout(mount, 2500) }, { immediate: true })
  watch(() => companionUi.open, (open) => { if (open) mount() })
}
