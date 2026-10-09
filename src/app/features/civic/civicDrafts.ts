// What a civic screen keeps while its sheet is closed: what was typed, the last vote the server
// refused, the picked tab and plot. Module-level on purpose (closing the phone loses nothing),
// reactive so the fields are bound to it instead of being read back from the page.
import { effectScope, getCurrentScope, onScopeDispose, reactive, shallowReactive, toRaw, toRef, watch } from 'vue'
import type { AdKind } from '../../../types/civic.ts'
import { AD_COLOURS, AD_ICONS } from './civicContent.ts'
import { requestSlot, sharedStore } from './civicCore.ts'

const drafts = new Set<(actor: string | null) => void>()
effectScope(true).run(() => watch(() => sharedStore.actor.id, (actor) => { for (const change of drafts) change(actor) }, { flush: 'sync' }))

/** Keep each character's unfinished form and retry id together while another character is active. */
export function actorDraft<T extends object>(fresh: () => T): T {
  let owner = sharedStore.actor.id
  const kept = new Map<string | null, T>(), draft = shallowReactive(fresh())
  const change = (actor: string | null): void => {
    kept.set(owner, { ...toRaw(draft) })
    owner = actor
    const next = kept.get(actor) ?? fresh()
    for (const key of Reflect.ownKeys(draft)) if (!Reflect.has(next, key)) Reflect.deleteProperty(draft, key)
    Object.assign(draft, next)
  }
  drafts.add(change)
  if (getCurrentScope()) onScopeDispose(() => drafts.delete(change))
  return draft
}

export const govDraft = actorDraft(() => reactive({ slogan: '', announcement: '' }))
/** The id of the candidacy being filed, kept for a retry. */
export const govRunRequest = actorDraft(requestSlot)
/** The last vote the server refused — kept beside the ballot until a vote counts. */
const refusals = actorDraft<{ value: { key: string; code: string; reason: string } | null }>(() => ({ value: null }))
export const govRefusal = toRef(refusals, 'value')

export const adsUi = actorDraft(() => reactive<{ tab: AdKind; row: number; col: number; text: string; colour: string; icon: string; seenParams: unknown }>({
  tab: 'billboard', row: 4, col: 4, text: '', colour: AD_COLOURS[0]?.id ?? '', icon: AD_ICONS[0]?.id ?? '', seenParams: null,
}))
/** The id of the rent being asked for, kept for a retry. */
export const adsRentRequest = actorDraft(requestSlot)

/** `requestId` is one id per shout-out, kept for a retry and dropped when the text changes. */
export const radioDraft = actorDraft(() => reactive<{ title: string; artist: string; requestId: string | null }>({ title: '', artist: '', requestId: null }))

/** Where the gem hunt chip last saw the count (a new gem raises one toast). Not shown anywhere, so not reactive. */
export const huntSeen = actorDraft<{ last: { key: string; found: number } | null }>(() => ({ last: null }))
