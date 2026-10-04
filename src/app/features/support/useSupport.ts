// The one Report a problem form of the page: the draft outlives the component (closing the phone
// does not lose the text), and what loads is told to the Phone, whose red badge counts replies
// not read yet (src/ui/phone/reports.js).
import { markReportsRead, noteFiled, noteReports } from '../../legacy/modules.ts'
import { useApp } from '../../state/app.ts'
import { createSupport } from './supportModel.ts'
import type { Support } from './supportModel.ts'

let shared: Support | null = null
export function useSupport(): Support {
  const { game, shell } = useApp()
  shared ??= createSupport({
    fetchJson: game.fetchJson,
    newId: game.newId,
    cityId: () => game.cityId.value,
    // The player is reading the replies now: they are read.
    onLoaded(reports) { noteReports(reports); if (reports.length) noteFiled(); markReportsRead(); shell.bump() },
    onFiled: noteFiled,
  })
  return shared
}
