// What the Jobs app remembers while it is closed: which job's switch is being confirmed.
import { ref } from 'vue'

/** The job id whose switch is being confirmed, or 'quit'. */
export const asking = ref<string | null>(null)
