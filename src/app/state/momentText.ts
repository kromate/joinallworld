// The local moment line the venue card shows in place of its ambient line (?models=moments). Empty unless the flag is on: the
// timer that fills it is src/app/moments.ts, fetched only then (see startExtras.ts), so this one ref is all the first download carries.
import { ref } from 'vue'

export const momentText = ref('')
