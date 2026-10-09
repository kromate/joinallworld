import { reactive, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { call, social, sync, refreshLife } from '../social/useSocial.ts'
import type { WorldStreetResponse } from '../../../types/world.ts'
import type { EnterResult, VisitHomeProjection, VisitHomeResult } from '../../../types/visit.ts'
import type { NeighbourDoor } from '../../../venue-world.ts'
import { rowX, sameStreet, STREET_NETWORK_SCALE } from '../../../game/neighbourhood-space.ts'
import { cityWalk } from './cityWalkState.ts'
import type { StreetJourney } from '../../../street/types.ts'

interface NeighbourhoodState { street: WorldStreetResponse | null; home: VisitHomeProjection | null; loading: boolean; error: string; pending: string; homeError: string }
export const neighbourhood = reactive<NeighbourhoodState>({ street: null, home: null, loading: false, error: '', pending: '', homeError: '' })
let started = false, streetEpoch = 0, visitEpoch = 0
let shownVisit = ''
const acceptedVisitKey = (): string => {
  const visit = social.me?.visiting
  return visit ? `${visit.host.id}:${visit.myCapture?.visitId ?? ''}` : ''
}
let returnPosition: { x: number; z: number } | null = null
let cityClient: ReturnType<typeof import('../../../street/client.ts').createStreetClient> | null = null
let cityEpoch = 0
async function syncCityWalk(): Promise<void> {
  const { game } = useApp(), epoch = ++cityEpoch
  if (!game.connected.value || game.state.value.location === 'home') { cityWalk.value = null; return }
  const result = await call<{ ok: true; journey: StreetJourney }>('/api/street/me')
  if (epoch === cityEpoch) cityWalk.value = result.ok ? result.journey : null
}
export async function acceptCityJourney(journey: StreetJourney): Promise<void> {
  cityWalk.value = journey
  await refreshLife()
  if (journey.kind === 'estate') useApp().scene.venue.value?.restorePosition(journey.estatePosition)
}

async function cityTransition(direction: 'begin' | 'exit'): Promise<void> {
  const { game, shell, scene, reportPlace } = useApp()
  if (neighbourhood.pending || !game.connected.value || game.state.value.activeAction || social.me?.visiting) return
  neighbourhood.pending = 'city-walk'
  try {
    const { createStreetClient } = await import('../../../street/client.ts')
    cityClient ??= createStreetClient({ now: () => game.serverNow() })
    reportPlace()
    const journey = await cityClient[direction]()
    shell.close(); await acceptCityJourney(journey)
    if (journey.kind === 'estate') scene.venue.value?.restorePosition(journey.estatePosition)
    cityClient.dispose(); cityClient = null
  } catch (error) { game.toast(error instanceof Error ? error.message : 'The street is unavailable. You can still use the map.', 'error') }
  finally { neighbourhood.pending = '' }
}
export const beginCityWalk = () => cityTransition('begin')
export const leaveCityVenue = () => cityTransition('exit')

/** World reads have an HTTP payload, without the social routes' `ok` envelope. */
export async function readWorld<T>(path: string) {
  const result = await call<T>(path)
  return result.ok === false ? result : { ...result, ok: true as const }
}

export async function loadStreet(): Promise<void> {
  const { game, scene, reportPlace } = useApp(), epoch = ++streetEpoch
  if (game.state.value.location !== 'neighbourhood' || !game.connected.value) return
  neighbourhood.loading = true; neighbourhood.error = ''
  const result = await readWorld<WorldStreetResponse>(`/api/world/street?city=${encodeURIComponent(game.cityId.value)}`)
  if (epoch !== streetEpoch || game.state.value.location !== 'neighbourhood') return
  neighbourhood.loading = false
  if (!result.ok) { neighbourhood.error = result.reason; neighbourhood.street = null; scene.venue.value?.setStreet(null); return }
  const previous = neighbourhood.street?.anchor
  const changedAnchor = !previous || previous.lga !== result.anchor.lga || previous.estate !== result.anchor.estate || previous.plot !== result.anchor.plot
  neighbourhood.street = result
  if (!neighbourhood.home) {
    scene.venue.value?.setStreet(result)
    if (changedAnchor) { scene.venue.value?.restorePosition(result.position ?? { x: rowX(result.anchor.plot) * STREET_NETWORK_SCALE, z: -3.25 * STREET_NETWORK_SCALE }); reportPlace() }
  }
}

export async function enterNeighbour(door: Pick<NeighbourDoor, 'id' | 'name' | 'plot'>): Promise<void> {
  const { game, scene, shell } = useApp()
  if (neighbourhood.pending || !game.connected.value || game.state.value.activeAction) return
  neighbourhood.pending = door.id
  returnPosition = scene.venue.value?.position() ?? null
  try {
    const result = await call<Extract<EnterResult, { ok: true }>>('/api/social/visit/plot/enter', { host: door.id, city: game.cityId.value, plot: door.plot })
    if (!result.ok) { game.toast(result.reason, 'error'); void loadStreet(); return }
    if (result.code === 'knocking') {
      social.knock = { host: door.id, name: door.name, status: 'knocking', expiresAt: result.expiresAt }
      game.toast(`Knocking at ${door.name}'s door. Waiting for an answer.`)
      shell.open('invite', { host: door.id })
    }
    await sync()
  } finally { neighbourhood.pending = '' }
}

export function walkToNeighbour(id: string): void {
  const { game, scene } = useApp()
  const street = neighbourhood.street, house = street?.houses.find((item) => item.owner?.id === id)
  if (!street || !house?.owner || game.state.value.activeAction) return
  if (scene.venue.value?.walkNeighbourDoor(id)) return
  void enterNeighbour({ id, name: house.owner.name, plot: { ...street.anchor, plot: house.plot } })
}

async function showVisit(): Promise<void> {
  const { game, scene, shell } = useApp(), id = social.me?.visiting?.host.id, key = acceptedVisitKey(), epoch = ++visitEpoch
  if (!id || !game.connected.value) {
    if (!id) shownVisit = ''
    const was = neighbourhood.home
    neighbourhood.home = null; neighbourhood.homeError = ''
    scene.venue.value?.setVisitHome(null)
    if (was && returnPosition && game.state.value.location === 'neighbourhood') scene.venue.value?.restorePosition(returnPosition)
    return
  }
  const result = await call<Extract<VisitHomeResult, { ok: true }>>(`/api/social/visit/home?host=${encodeURIComponent(id)}`)
  if (epoch !== visitEpoch || acceptedVisitKey() !== key) return
  if (!result.ok) {
    neighbourhood.home = null; neighbourhood.homeError = result.reason
    scene.venue.value?.setVisitHome(null)
    return
  }
  const entering = shownVisit !== key
  if (!entering && JSON.stringify(neighbourhood.home) === JSON.stringify(result.home)) return
  neighbourhood.home = result.home; neighbourhood.homeError = ''
  if (!returnPosition && result.home.plot && game.state.value.location === 'neighbourhood' && sameStreet(game.state.value.estate.plot, result.home.plot)) returnPosition = { x: rowX(result.home.plot.plot) * STREET_NETWORK_SCALE, z: -5 * STREET_NETWORK_SCALE }
  scene.venue.value?.setVisitHome(result.home)
  if (entering) { shownVisit = key; shell.close(); shell.setMode('venue') }
}

export async function leaveNeighbour(): Promise<void> {
  const { game } = useApp(), host = social.me?.visiting?.host.id
  if (!host || neighbourhood.pending) return
  neighbourhood.pending = host
  try {
    const result = await call('/api/social/house/leave', { host })
    if (!result.ok) { game.toast(result.reason, 'error'); return }
    await sync()
    game.toast('You stepped back outside.')
  } finally { neighbourhood.pending = '' }
}

export function startNeighbourhood(): void {
  if (started) return
  started = true
  const { game, scene } = useApp()
  watch(() => `${game.connected.value}|${game.cityId.value}|${game.state.value.location}|${game.state.value.estate.plot?.lga}|${game.state.value.estate.plot?.estate}|${game.state.value.estate.plot?.plot}`, () => {
    void syncCityWalk()
    if (game.state.value.location === 'neighbourhood') void loadStreet()
    else { streetEpoch++; neighbourhood.street = null; neighbourhood.loading = false; returnPosition = null }
  }, { immediate: true })
  let refresh: ReturnType<typeof setInterval> | undefined
  watch(() => `${game.connected.value}|${acceptedVisitKey()}`, () => {
    if (refresh) clearInterval(refresh)
    void showVisit()
    if (social.me?.visiting && game.connected.value) refresh = setInterval(() => { if (!document.hidden) void showVisit() }, 5000)
  }, { immediate: true })
  watch(scene.venue, (host) => {
    if (neighbourhood.home) host?.setVisitHome(neighbourhood.home)
    else if (neighbourhood.street) host?.setStreet(neighbourhood.street)
  })
}
