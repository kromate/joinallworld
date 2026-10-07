// Now and then a line of local colour replaces the venue card's ambient line. Fetched once the game is ready (startExtras.ts),
// together with src/moments/, so the first download carries nothing of it.
import { watch } from 'vue'
import { momentLine, noticeAt, MOMENT_POLL_MS } from '../moments/live.ts'
import { momentText, noticeText } from './state/momentText.ts'
import { useApp } from './state/app.ts'

export function startMoments(): void {
  const { game } = useApp()
  const ask = (): void => {
    const city = game.view.value.cityId, where = game.state.value.location
    momentText.value = momentLine(city, where)
    noticeText.value = noticeAt(city, where)
  }
  watch(() => [game.view.value.cityId, game.state.value.location], () => { momentText.value = ''; noticeText.value = ''; ask() })
  ask()
  setInterval(ask, MOMENT_POLL_MS)
}
