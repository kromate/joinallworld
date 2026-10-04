// What a civic screen keeps while its sheet is closed: what was typed, the last vote the server
// refused, the picked tab and plot. Module-level on purpose (closing the phone loses nothing),
// reactive so the fields are bound to it instead of being read back from the page.
import { reactive, ref } from 'vue'
import type { AdKind } from '../../../types/civic.ts'
import { AD_COLOURS, AD_ICONS } from './civicContent.ts'
import { requestSlot } from './civicCore.ts'

export const govDraft = reactive({ slogan: '', announcement: '' })
/** The id of the candidacy being filed, kept for a retry. */
export const govRunRequest = requestSlot()
/** The last vote the server refused — kept beside the ballot until a vote counts. */
export const govRefusal = ref<{ key: string; code: string; reason: string } | null>(null)

export const adsUi = reactive<{ tab: AdKind; row: number; col: number; text: string; colour: string; icon: string; seenParams: unknown }>({
  tab: 'billboard', row: 4, col: 4, text: '', colour: AD_COLOURS[0]?.id ?? '', icon: AD_ICONS[0]?.id ?? '', seenParams: null,
})
/** The id of the rent being asked for, kept for a retry. */
export const adsRentRequest = requestSlot()

/** `requestId` is one id per shout-out, kept for a retry and dropped when the text changes. */
export const radioDraft = reactive<{ title: string; artist: string; requestId: string | null }>({ title: '', artist: '', requestId: null })

/** Where the gem hunt chip last saw the count (a new gem raises one toast). Not shown anywhere, so not reactive. */
export const huntSeen: { last: { key: string; found: number } | null } = { last: null }
