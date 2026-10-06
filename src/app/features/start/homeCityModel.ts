import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { cachedCityContent, cityCatalogueEntry, loadCityContent } from '../../../game/cities/registry.ts'
import { lgasOf } from '../../../game/content/world.ts'
import type { LgaDefinition } from '../../../types/content.ts'
import type { AreaChoice } from './onboardingModel.ts'

export interface HomeCityModel {
  cityId: Ref<string>
  readyCityId: Ref<string | null>
  loading: Ref<boolean>
  error: Ref<string>
  units: ComputedRef<readonly LgaDefinition[]>
  select: (id: string) => Promise<boolean>
  cancel: () => void
}

/** Keep a saved area only when it belongs to the city whose rules are ready. */
export function areaForCity(area: AreaChoice | undefined, units: readonly { id: string }[]): AreaChoice | undefined {
  return area && units.some((unit) => unit.id === area.lga) ? area : undefined
}

/** The reactive boundary between the lazy city registry and the Home step. */
export function useHomeCity(initialCity: string, onReady: (ready: boolean) => void, onLoaded: (id: string) => void): HomeCityModel {
  const cityId = ref(initialCity)
  const readyCityId = ref<string | null>(cachedCityContent(initialCity) ? initialCity : null)
  const loading = ref(false)
  const error = ref('')
  let latestLoad = 0
  const units = computed(() => readyCityId.value === cityId.value ? lgasOf(cityId.value) : [])

  async function select(id: string): Promise<boolean> {
    cityId.value = id
    const load = ++latestLoad
    loading.value = true
    error.value = ''
    onReady(false)
    try {
      await loadCityContent(id)
      if (load !== latestLoad) return false
      readyCityId.value = id
      onLoaded(id)
      onReady(true)
      return true
    } catch {
      if (load !== latestLoad) return false
      readyCityId.value = null
      error.value = `We could not load ${cityCatalogueEntry(id)?.name ?? 'that city'}. Check your connection and try again.`
      return false
    } finally {
      if (load === latestLoad) loading.value = false
    }
  }

  return { cityId, readyCityId, loading, error, units, select, cancel: () => { latestLoad += 1 } }
}
