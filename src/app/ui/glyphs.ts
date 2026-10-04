// The icon set grows after the first paint (src/ui/phone/icons.js registerGlyphs). This counter
// moves when it does, so every GameIcon on screen is drawn again with the real mark.
import { ref } from 'vue'
import { onGlyphs } from '../../ui/phone/icons.ts'

export const glyphTick = ref(0)
onGlyphs(() => { glyphTick.value += 1 })
