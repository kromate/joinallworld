// What the Invest app remembers while it is closed: the amount chosen and the deposit whose early close is being confirmed.
import { ref } from 'vue'

export const chosen = ref(5000)
export const closing = ref<string | null>(null)
