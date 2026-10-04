// The typed boundary to the cache of the existing civic client (src/ui/panels/civic-ui.js). The
// city map (map.js) still draws the ads, neighbours and election it caches there, so what a write
// returns is copied into it; and the existing gem hunt chip, until it is replaced, is what loads
// the pulse the Governor badge reads. Both go away when map.js and the chips are converted.
// Imported by register.ts only: civic-ui.js is already in the first download of the shell.
import { entry as entryJs, put as putJs } from '../../../ui/panels/civic-ui.js'
import type { CivicNotice } from '../../../types/civic.ts'
import { setLegacyBridge } from './civicCore.ts'

const legacyEntry = entryJs as unknown as (key: string) => { data: { notices?: readonly CivicNotice[] } | null }
const legacyPut = putJs as unknown as (key: string, data: unknown) => void

export function installLegacyCivicBridge(): void {
  setLegacyBridge({ pulse: (cityId) => legacyEntry(`pulse:${cityId}`).data, put: legacyPut })
}
