// What the Boutique remembers while it is closed: the item being tried on.
import { ref } from 'vue'
import type { Trying } from './boutiqueModel.ts'

export const trying = ref<Trying | null>(null)
