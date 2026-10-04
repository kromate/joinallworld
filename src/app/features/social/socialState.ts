// The social screens' own UI state. It lives outside the components so it survives closing and
// reopening the sheet or the phone, as the module-level `ui` objects of the existing panels do.
import { reactive } from 'vue'
import type { HouseView, SearchResult } from '../../../types/social.ts'

/** The Sim sheet's People tab: the place and action it last read the listing for. */
export const peopleUi: { loadedFor: string | null } = { loadedFor: null }

/** Find a player (Contacts). */
export const contactsUi = reactive<{ find: string; results: SearchResult[] | { error: string } | null; finding: boolean }>({ find: '', results: null, finding: false })

/** The person card's forms. `clientId` is made when a form opens and reused by every send from it. */
export const personUi = reactive<{
  form: 'money' | 'report' | null
  amount: string
  reason: string
  text: string
  clientId: string | null
  busy: boolean
  /** The player the card was last opened for. */
  player: string | null
}>({ form: null, amount: '', reason: 'harassment', text: '', clientId: null, busy: false, player: null })

/** A house looked up by link: what the server said, or why it could not. */
export type LookedUp = { house: HouseView; knock: { status: 'pending' | 'accepted' | 'declined'; expiresAt: number } | null } | { error: string }
export const inviteUi = reactive<{ paste: string; host: string | null; house: LookedUp | null; loading: boolean; params: unknown; pending: string | null }>({ paste: '', host: null, house: null, loading: false, params: null, pending: null })
