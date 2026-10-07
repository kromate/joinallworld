import { ESTATE, lgaOf, validPlot } from './content/world.ts'
import type { PlotAddress } from '../types/life.ts'

export const ROW_PITCH = 12
export const ROW_HALF_WIDTH = ESTATE.plots * ROW_PITCH / 2
export const STREET_NETWORK_SCALE = 20 / ROW_HALF_WIDTH
export const streetRow = (plot: number): number => Math.floor(plot / ESTATE.plots)
export const rowX = (plot: number): number => (plot % ESTATE.plots) * ROW_PITCH - (ESTATE.plots - 1) * ROW_PITCH / 2
export const sameStreet = (a: PlotAddress | null | undefined, b: PlotAddress): boolean => a?.lga === b.lga && a.estate === b.estate && streetRow(a.plot) === streetRow(b.plot)

/** A room scope comes from a validated server-held address, never a requested viewport or origin. */
export function streetRoomKey(city: string, plot: PlotAddress | null | undefined): string | null {
  if (!plot || !lgaOf(city, plot.lga) || !validPlot(plot.estate, plot.plot)) return null
  return `${city}:neighbourhood:${plot.lga}:${plot.estate}:${streetRow(plot.plot)}`
}
