// What the rest of the shell may know about the companion without loading it: whether its sheet is wanted, and a counter for the
// Messages pin to redraw on. The companion itself (CompanionHost.vue, the 3D model, the brain) is fetched after the first frame.
import { reactive } from 'vue'

export const companionUi = reactive({ /** The chat sheet is open (or being asked for). */ open: false, /** Bumped when the conversation log changes. */ tick: 0, /** Lines the player has not read. */ unread: 0 })
