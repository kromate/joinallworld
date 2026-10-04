// What the Profile tab remembers while it is closed: the draft of the form.
import { reactive, ref } from 'vue'
import type { Look } from '../../../types/life.ts'

export interface Draft { name: string; look: Look }
/** The form as the player is editing it; null until the first time the tab is drawn. */
export const draft = ref<Draft | null>(null)
/** The saved name and look the draft was made from, as a key: when they change underneath, the draft is rebuilt. */
export const saved = ref('')
export const form = reactive({ error: '', pending: false })
