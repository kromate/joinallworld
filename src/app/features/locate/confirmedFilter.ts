// The "Location-confirmed" filter of a list of players (Neighbours): keeps only those with a standing badge. Optional and small:
// switching it on asks the badge feed about the players listed, and a player whose answer has not come yet is simply not shown.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { badgeCache } from './badgeFeed.ts'
import { useBadges } from './useBadges.ts'

export function useConfirmedOnly(ids: () => string[]) {
  const on = ref(false)
  let releases: (() => void)[] = []
  const drop = (): void => { for (const release of releases) release(); releases = [] }
  watch([on, () => ids().join(',')], () => {
    drop()
    if (on.value) releases = ids().map((id) => useBadges().want(id))
  }, { flush: 'post' })
  onBeforeUnmount(drop)
  const checking = computed(() => on.value && ids().some((id) => !(id in badgeCache)))
  return { on, checking, keep: (id: string): boolean => !on.value || Boolean(badgeCache[id]), stop: drop }
}
