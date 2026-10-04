// Which "How it works" disclosures are open, by id, for the life of the page.
import { reactive } from 'vue'

export const openHows = reactive(new Set<string>())
