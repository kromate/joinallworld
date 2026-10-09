// The Games app on the Phone: the daily word puzzle (Oro), practice words, and a way into the
// board games against the computer. The component is fetched on first use.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import { bodyLoader } from '../../state/panelBody.ts'

export const GAMES_PANELS: readonly VuePanel[] = [
  definePanel({ id: 'games', title: 'Games', icon: 'game', placement: 'phone', order: 43.5, group: 'city', tint: '#7a4fb0', component: defineAsyncComponent(bodyLoader('games/GamesApp')) }),
]
