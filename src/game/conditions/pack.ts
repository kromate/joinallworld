// The kit of city conditions (type ConditionsKit, ./slot.ts), installed when this file is imported. The engine never imports it: vite.config.ts builds
// it with the grid, the go-slow and the bill words as one lazy `conditions` chunk.
//
//   servers, Worker, scripts, tests   src/game/profile.ts imports it, so any host that plays a life has the rules
//   browser                           profile.ts is a stand-in there; src/app/startExtras.ts fetches this once the page is up
import { arrearsWarning, headsUpLine, missedRentLine, weekLine, weekTotals } from './billing-words.ts'
import { gridAt } from './grid.ts'
import { refuel, settlePower } from './generator.ts'
import { slowedSeconds } from './rush.ts'
import { installConditionsKit } from './slot.ts'
import type { ConditionsKit } from './slot.ts'

// Each member is looked up when it is called, not when this file loads: profile.ts is imported from inside the engine's own import cycles.
export const CONDITIONS_KIT: ConditionsKit = {
  gridAt: (cityId, district, now) => gridAt(cityId, district, now),
  slowedSeconds: (seconds, mode, cityId, now) => slowedSeconds(seconds, mode, cityId, now),
  headsUp: (parts, total, cash) => headsUpLine(parts, total, cash),
  missedRent: (missed, amount, due, owed, fee) => missedRentLine(missed, amount, due, owed, fee),
  arrears: (owed, missed, nextDue, fee) => arrearsWarning(owed, missed, nextDue, fee),
  weekTotals: (days, billDay) => weekTotals(days, billDay),
  weekLine: (totals, endLabel) => weekLine(totals, endLabel),
  refuel: (state, payload, ctx, lent) => refuel(state, payload, ctx, lent),
  settlePower: (state, dt, ctx, district, lent) => settlePower(state, dt, ctx, district, lent),
}

installConditionsKit(CONDITIONS_KIT)
