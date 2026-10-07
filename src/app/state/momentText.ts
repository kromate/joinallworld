// The local moment line the venue card shows in place of its ambient line. Empty until the game is ready: the timer that fills it
// is src/app/moments.ts, fetched after that (see startExtras.ts), so this one ref is all the first download carries.
import { ref } from 'vue'

export const momentText = ref('')
/** What is going on at this venue that the player should know (the light is off, a match is on). Filled by the same timer, so it adds nothing to the first download. */
export const noticeText = ref('')
