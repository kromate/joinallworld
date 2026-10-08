import { ESTATE, lgaOf, validPlot } from '../../src/game/content/world.ts';
import type { PlotAddress } from '../../src/types/life.ts';

export const samePlot = (a: PlotAddress | null | undefined, b: PlotAddress): boolean => a?.lga === b.lga && a.estate === b.estate && a.plot === b.plot;
export const sameStreet = (a: PlotAddress | null | undefined, b: PlotAddress): boolean => a?.lga === b.lga && a.estate === b.estate && Math.floor(a.plot / ESTATE.plots) === Math.floor(b.plot / ESTATE.plots);

export function readPlot(value: unknown, city: string): PlotAddress | null {
  if (typeof value !== 'object' || value === null || !('lga' in value) || !('estate' in value) || !('plot' in value)) return null;
  if (typeof value.lga !== 'string' || typeof value.estate !== 'number' || typeof value.plot !== 'number' || !lgaOf(city, value.lga) || !validPlot(value.estate, value.plot)) return null;
  return { lga: value.lga, estate: value.estate, plot: value.plot };
}
