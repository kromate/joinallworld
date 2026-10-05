// Who is at each place of this city right now, as words: friends by name, other players as a number
// ("Bola here", "Bola +2 here", "3 here"). From the live frames the social client keeps (src/game/live-model.ts);
// the list of places and the venue card both read it, so they can never disagree with the map's pins.
import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { mapPeople } from '../../../game/live-model.ts'
import { crowdWords } from '../../../game/live-lines.ts'
import { isDeparting } from '../../../life.ts'
import { useApp } from '../../state/app.ts'
import { liveNow, social, useSocial } from '../social/useSocial.ts'

export function useCrowd(): ComputedRef<Record<string, string>> {
  const { game } = useApp()
  const revision = useSocial().revision
  return computed(() => {
    void revision.value // the social client counts every change, also one that is only the clock (a friend reaching a door)
    const state = game.state.value, now = liveNow()
    return crowdWords(mapPeople({ table: social.live, friends: social.me?.friends ?? [], cityId: game.cityId.value, here: isDeparting(state) ? null : state.location, now, look: () => ({ initial: '', hue: 0 }) }), now)
  })
}
