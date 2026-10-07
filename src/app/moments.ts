// ?models=moments: now and then a line of local colour replaces the venue card's ambient line. Fetched only with the flag (startExtras.ts),
// together with src/moments/, so nothing extra loads, and the first download carries nothing of it, while the flag is off.
import { watch } from 'vue'
import { momentLine, MOMENT_POLL_MS } from '../moments/live.ts'
import { momentText } from './state/momentText.ts'
import { useApp } from './state/app.ts'

export function startMoments(): void {
  const { game } = useApp()
  const ask = (): void => { momentText.value = momentLine(game.view.value.cityId, game.state.value.location) }
  watch(() => [game.view.value.cityId, game.state.value.location], () => { momentText.value = ''; ask() })
  ask()
  setInterval(ask, MOMENT_POLL_MS)
}
