// What the Campus app keeps between openings and what it asks the shell for. Game state stays on the
// server; this holds the tab and the form choices, and the shared board (the Student Union election,
// the leaderboards, the weekly goal), which is read over HTTP and written by two POSTs.
import { computed, reactive } from 'vue'
import type { CampusActionType, HostelHallId, HostelStorageItemId, ProgrammeId, ShuttleStopId } from '../../../types/campus.ts'
import type { CommandArgs, CommandResult } from '../../types/client.ts'
import type { PlayerActionType } from '../../../types/actions.ts'
import { uuid } from '../../../ui/dom.ts'
import { useApp } from '../../state/app.ts'
import type { Game } from '../../state/game.ts'
import type { SharedData, TabId } from './campusModel.ts'
import { activeReason, normalizeShared, sharedKey } from './campusModel.ts'
import { HOSTEL_HALLS, HOSTEL_STORAGE_ITEMS, SHUTTLE_STOPS } from './campusContent.ts'
import { campusWalkReason } from './campusWalkability.ts'

export interface Choices {
  tab: TabId
  programme: ProgrammeId
  hall: HostelHallId
  storageItem: HostelStorageItemId
  storageCount: number
  shuttle: ShuttleStopId | ''
  confirmDrop: boolean
  /** The programme the choice was last matched to, so a changed one is taken over once. */
  studentProgramme: string
}
export const choices: Choices = reactive({
  tab: 'overview', programme: 'computer', hall: HOSTEL_HALLS[0] ?? 'moremi', storageItem: HOSTEL_STORAGE_ITEMS[0] ?? 'rice', storageCount: 1,
  shuttle: SHUTTLE_STOPS[1]?.id ?? '', confirmDrop: false, studentProgramme: '',
})

export interface Board {
  key: string
  generation: number
  data: SharedData | null
  loading: boolean
  error: string
  at: number
  pending: Set<string>
  nominated: Set<number>
  voted: Set<number>
}
export const board: Board = reactive({ key: '', generation: 0, data: null, loading: false, error: '', at: 0, pending: new Set<string>(), nominated: new Set<number>(), voted: new Set<number>() })

/** A different person or city starts a clean board; the generation tells answers that are late. */
function bindIdentity(game: Game): { key: string; generation: number } {
  const key = sharedKey(game.view.value)
  if (board.key !== key) {
    board.key = key; board.generation += 1
    board.data = null; board.loading = false; board.error = ''; board.at = 0
    board.pending = new Set(); board.nominated = new Set(); board.voted = new Set()
  }
  return { key, generation: board.generation }
}
const current = (request: { key: string; generation: number }): boolean => board.key === request.key && board.generation === request.generation

export const REFRESH_AFTER = 20000
/** Read the shared board. Again only after 20 seconds, unless forced. */
export function loadShared(game: Game, force = false, now: () => number = Date.now): void {
  const view = game.view.value, city = view.cityId
  if (!view.connected || !city) return
  const request = bindIdentity(game)
  if (board.loading) return
  if (!force && board.at && (board.data || board.error) && now() - board.at < REFRESH_AFTER) return
  board.loading = true; board.error = ''
  game.fetchJson(`/api/campus?city=${encodeURIComponent(city)}`).then((result) => {
    const data = normalizeShared(result)
    if (!data) throw new Error('The campus server returned an incomplete board.')
    if (current(request)) board.data = data
  }).catch((error: unknown) => {
    if (current(request)) board.error = (error as { message?: string } | null)?.message || 'The campus board could not be reached.'
  }).finally(() => {
    if (!current(request)) return
    board.loading = false; board.at = now()
  })
}

/** Nominate yourself, or vote for a candidate: one POST at a time per button, and the board is read again after. */
export async function postShared(game: Game, kind: 'nominate' | 'vote', candidateId = ''): Promise<void> {
  const tag = candidateId ? `${kind}:${candidateId}` : kind
  const view = game.view.value
  if (!view.connected) return
  const request = bindIdentity(game), pending = board.pending
  if (pending.has(tag)) return
  pending.add(tag)
  try {
    const randomId = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : uuid()
    const body = { cityId: view.cityId, actionId: `${Date.now()}:${randomId}`, ...(candidateId ? { candidateId } : {}) }
    const result = await game.fetchJson<Record<string, unknown>>(`/api/campus/${kind}`, { method: 'POST', body })
    if (!current(request)) return
    if (result['ok'] === false) { game.toast(typeof result['reason'] === 'string' && result['reason'] ? result['reason'] : 'The campus server refused that request.', 'error'); return }
    const data = normalizeShared(result)
    if (data) board.data = data
    const week = data?.election?.week ?? board.data?.election?.week
    if (week !== undefined && week !== null && kind === 'nominate') board.nominated.add(week)
    if (week !== undefined && week !== null && kind === 'vote') board.voted.add(week)
    game.toast(kind === 'nominate' ? 'Your nomination is on the ballot.' : 'Your vote was counted.', 'good')
  } catch (error) {
    if (!current(request)) return
    board.error = (error as { message?: string } | null)?.message || 'The campus server could not be reached.'
    game.toast(`${board.error} Nothing was changed.`, 'error')
  } finally {
    pending.delete(tag)
    if (current(request)) { board.at = 0; loadShared(game, true) }
  }
}

/** What every part of the app reads: the life, the view, the student, and the shell's way of acting and walking. */
export function useCampus() {
  const { game, shell, goTo } = useApp()
  const state = game.state
  const view = game.view
  const connected = computed(() => view.value.connected)
  const student = computed(() => view.value.unilagStudent ?? null)
  const community = computed(() => view.value.unilagCommunity ?? null)
  /** Why nothing can be started right now, or ''. */
  const blocked = computed(() => activeReason(state.value, connected.value))

  /** One server action. A refusal is toasted by the game; the result is returned for those that care. */
  function act<T extends PlayerActionType & (CampusActionType | 'activity')>(type: T, ...args: CommandArgs<T>): Promise<CommandResult<T>> {
    return game.command(type, ...args)
  }
  /** Leave the Phone and walk only when the authored campus layout has an anchor for the destination. */
  function go(spot: string): void {
    const reason = campusWalkReason(spot)
    if (reason) { game.toast(reason, 'error'); return }
    shell.close(); void goTo('unilag', spot)
  }
  return { game, state, view, connected, student, community, blocked, act, go, walkReason: campusWalkReason }
}
