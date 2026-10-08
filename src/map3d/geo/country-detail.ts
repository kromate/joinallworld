import type { CountryDetailCatalogue, CountryDetailChoice, CountryDetailOutline, CountryDetailService } from './country-detail-types.ts';
import { CENTRAL_MERIDIAN, project, relLon } from './projection.ts';

export type CountryDetailState = 'closed' | 'loading-catalogue' | 'ready' | 'loading-outline' | 'catalogue-error' | 'outline-error';

export interface CountryDetailSnapshot {
  open: boolean;
  state: CountryDetailState;
  catalogue: CountryDetailCatalogue | null;
  selectedCountryId: string | null;
  outline: CountryDetailOutline | null;
  message: string;
}

const MAX_CHOICES = 258;
const MAX_POSITIONS = 100_000;
const MAX_DISPLAY_POSITIONS = 30_000;

function isProtected(choice: CountryDetailChoice): boolean {
  return choice.status === 'protected' || choice.atlasId === 'ng';
}

/**
 * Manages the explicit, lazy country-detail flow. Map state and game callbacks are intentionally
 * absent: this controller can only choose and display verified geography.
 */
export class CountryDetailPanelModel {
  private readonly getService: () => Promise<CountryDetailService>;
  private readonly changed: (state: CountryDetailSnapshot) => void;
  private generation = 0;
  private active: AbortController | null = null;
  private servicePromise: Promise<CountryDetailService> | null = null;
  private destroyed = false;
  private current: CountryDetailSnapshot = { open: false, state: 'closed', catalogue: null, selectedCountryId: null, outline: null, message: '' };

  constructor(getService: () => Promise<CountryDetailService>, changed: (state: CountryDetailSnapshot) => void = () => {}) {
    this.getService = getService; this.changed = changed;
  }

  snapshot(): CountryDetailSnapshot { return this.current; }

  private set(next: CountryDetailSnapshot): void {
    this.current = next;
    this.changed(next);
  }

  private cancel(): number {
    this.generation += 1;
    this.active?.abort();
    this.active = null;
    return this.generation;
  }

  private service(): Promise<CountryDetailService> {
    if (!this.servicePromise) {
      const loading = Promise.resolve().then(this.getService);
      const retryable = loading.catch((error: unknown) => {
        if (this.servicePromise === retryable) this.servicePromise = null;
        throw error;
      });
      this.servicePromise = retryable;
    }
    return this.servicePromise;
  }

  private validateCatalogue(value: CountryDetailCatalogue): void {
    if (!value || !Array.isArray(value.countries) || value.countries.length > MAX_CHOICES ||
        typeof value.sourceLabel !== 'string' || typeof value.sourceUrl !== 'string' || typeof value.boundaryNote !== 'string') {
      throw new TypeError('Country detail catalogue is malformed');
    }
    const ids = new Set<string>();
    for (const choice of value.countries) {
      if (!choice || typeof choice.countryId !== 'string' || !choice.countryId || choice.countryId.length > 160 ||
          typeof choice.name !== 'string' || !choice.name || choice.name.length > 160 ||
          typeof choice.continent !== 'string' || choice.continent.length > 80 ||
          !(choice.atlasId === null || (typeof choice.atlasId === 'string' && /^[a-z0-9-]{1,32}$/.test(choice.atlasId))) ||
          !['mapped', 'protected', 'missing'].includes(choice.status) || ids.has(choice.countryId)) {
        throw new TypeError('Country detail catalogue contains an invalid or duplicate country');
      }
      ids.add(choice.countryId);
      if ((choice.atlasId === 'ng' || choice.countryId === 'legacy-ng') && !isProtected(choice)) {
        throw new TypeError('Nigeria must remain protected from country-detail loading');
      }
    }
    const nigeria = value.countries.filter((choice) => choice.atlasId === 'ng' || choice.countryId === 'legacy-ng');
    if (nigeria.length !== 1 || !isProtected(nigeria[0]!)) throw new TypeError('Country detail catalogue must contain one protected Nigeria choice');
  }

  async open(atlasId: string | null = null): Promise<void> {
    if (this.destroyed) return;
    const token = this.cancel();
    this.set({ ...this.current, open: true, state: 'loading-catalogue', message: 'Loading country list…', outline: null });
    if (this.current.catalogue) {
      const match = atlasId ? this.current.catalogue.countries.find((choice) => choice.atlasId === atlasId) : undefined;
      this.set({ ...this.current, open: true, state: 'ready', selectedCountryId: atlasId ? match?.countryId ?? null : this.current.selectedCountryId,
        message: match ? isProtected(match) ? 'Nigeria uses its existing map.' : match.status === 'missing' ? 'No outline is available for this country yet.' : `${match.name} selected. Show its outline to load geographic detail.` : '' });
      return;
    }
    const controller = new AbortController(); this.active = controller;
    try {
      const service = await this.service();
      if (this.destroyed || token !== this.generation || controller.signal.aborted) return;
      const catalogue = await service.catalogue(controller.signal);
      this.validateCatalogue(catalogue);
      if (this.destroyed || token !== this.generation || controller.signal.aborted) return;
      const match = atlasId ? catalogue.countries.find((choice) => choice.atlasId === atlasId) : undefined;
      this.active = null;
      this.set({ open: true, state: 'ready', catalogue, selectedCountryId: atlasId ? match?.countryId ?? null : null, outline: null,
        message: match ? isProtected(match) ? 'Nigeria uses its existing map.' : match.status === 'missing' ? 'No outline is available for this country yet.' : `${match.name} selected. Show its outline to load geographic detail.` : '' });
    } catch (error) {
      if (this.destroyed || token !== this.generation || controller.signal.aborted) return;
      this.active = null;
      this.set({ ...this.current, open: true, state: 'catalogue-error', message: error instanceof Error ? error.message : 'Country list unavailable. Try again.', outline: null });
    }
  }

  close(): void {
    if (this.destroyed) return;
    this.cancel();
    this.set({ ...this.current, open: false, state: 'closed', outline: null, message: '' });
  }

  mapSelectionChanged(): void {
    if (this.current.open) this.close();
    else if (this.active) this.cancel();
  }

  choose(countryId: string): void {
    if (!this.current.open || !this.current.catalogue) return;
    const choice = this.current.catalogue.countries.find((country) => country.countryId === countryId);
    if (!choice) return;
    this.cancel();
    this.set({ ...this.current, state: 'ready', selectedCountryId: countryId, outline: null,
      message: isProtected(choice) ? 'Nigeria uses its existing map.' : choice.status === 'missing' ? 'No outline is available for this country yet.' : `${choice.name} selected. Show its outline to load geographic detail.` });
  }

  async showOutline(): Promise<void> {
    if (this.destroyed || !this.current.open || !this.current.catalogue || !this.current.selectedCountryId) return;
    const choice = this.current.catalogue.countries.find((country) => country.countryId === this.current.selectedCountryId);
    if (!choice || isProtected(choice) || choice.status !== 'mapped') return;
    const token = this.cancel(), countryId = choice.countryId, controller = new AbortController();
    this.active = controller;
    this.set({ ...this.current, state: 'loading-outline', outline: null, message: `Loading ${choice.name} outline…` });
    try {
      const service = await this.service();
      if (this.destroyed || token !== this.generation || controller.signal.aborted) return;
      const outline = await service.load(countryId, controller.signal);
      if (this.destroyed || token !== this.generation || controller.signal.aborted || this.current.selectedCountryId !== countryId || !this.current.open) return;
      if (!outline || outline.country.countryId !== countryId || outline.country.status !== 'mapped' || outline.country.atlasId !== choice.atlasId || outline.country.name !== choice.name) throw new TypeError('Country outline does not match the selection');
      countryOutlineSvg(outline);
      this.active = null;
      this.set({ ...this.current, state: 'ready', outline, message: `${choice.name} outline loaded.` });
    } catch (error) {
      if (this.destroyed || token !== this.generation || controller.signal.aborted || this.current.selectedCountryId !== countryId) return;
      this.active = null;
      this.set({ ...this.current, state: 'outline-error', outline: null, message: error instanceof Error ? error.message : 'Outline unavailable. Try again.' });
    }
  }

  retry(): void {
    if (this.current.state === 'catalogue-error') void this.open();
    else if (this.current.state === 'outline-error') void this.showOutline();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.cancel(); this.destroyed = true;
    this.current = { open: false, state: 'closed', catalogue: null, selectedCountryId: null, outline: null, message: '' };
  }
}

interface Point { x: number; y: number }

function boundedRings(outline: CountryDetailOutline): { rings: Point[][]; sourcePositions: number } {
  const geometry = outline.geometry;
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) throw new TypeError('Unsupported country outline geometry');
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || polygons.length < 1 || polygons.length > MAX_POSITIONS) throw new TypeError('Country outline polygon count is invalid');
  let sourcePositions = 0;
  const rawRings: [number, number][][] = [], longitudes: number[] = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length < 1) throw new TypeError('Country outline polygon has no rings');
    for (const rawRing of polygon) {
      if (!Array.isArray(rawRing) || rawRing.length < 4) throw new TypeError('Country outline ring is too short');
      sourcePositions += rawRing.length;
      if (sourcePositions > MAX_POSITIONS) throw new TypeError('Country outline exceeds the display input cap');
      const ring: [number, number][] = [];
      for (const raw of rawRing) {
        if (!Array.isArray(raw) || raw.length < 2 || raw.length > 4 ||
            typeof raw[0] !== 'number' || typeof raw[1] !== 'number' || !Number.isFinite(raw[0]) || !Number.isFinite(raw[1]) ||
            raw[0] < -180 || raw[0] > 180 || raw[1] < -90 || raw[1] > 90) throw new TypeError('Country outline has an invalid WGS84 position');
        ring.push([raw[0], raw[1]]);
        longitudes.push(raw[0] < 0 ? raw[0] + 360 : raw[0]);
      }
      const first = rawPoint(rawRing[0]!), last = rawPoint(rawRing.at(-1)!);
      if (first[0] !== last[0] || first[1] !== last[1]) throw new TypeError('Country outline ring is not closed');
      rawRings.push(ring);
    }
  }
  const sorted = longitudes.sort((a, b) => a - b);
  let largestGap = -1, afterGap = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + 360;
    const gap = next - sorted[i]!;
    if (gap > largestGap) { largestGap = gap; afterGap = next % 360; }
  }
  const span = 360 - largestGap;
  const center360 = (afterGap + span / 2) % 360;
  const center = center360 > 180 ? center360 - 360 : center360;
  const rings = rawRings.map((ring) => ring.map(([lon, lat]) => {
    const [x, y] = project(relLon(lon - center + CENTRAL_MERIDIAN), lat);
    return { x, y };
  }));
  return { rings, sourcePositions };
}

function rawPoint(value: unknown): [number, number] {
  if (!Array.isArray(value) || typeof value[0] !== 'number' || typeof value[1] !== 'number') throw new TypeError('Country outline position is malformed');
  return [value[0], value[1]];
}

function number(value: number): string { return Number(value.toFixed(2)).toString(); }

/** Build safe SVG path data for a bounded display copy; source geometry is never changed. */
export function countryOutlineSvg(outline: CountryDetailOutline): { path: string; viewBox: string; sourcePositions: number; displayPositions: number; simplified: boolean } {
  const { rings, sourcePositions } = boundedRings(outline);
  const openRings = rings.map((ring) => ring.slice(0, -1));
  const totalOpen = openRings.reduce((sum, ring) => sum + ring.length, 0);
  const basePerRing = openRings.length * 3 <= MAX_DISPLAY_POSITIONS ? 3 : 1;
  const base = openRings.map((ring) => Math.min(basePerRing, ring.length));
  const baseTotal = base.reduce((sum, count) => sum + count, 0);
  const remaining = Math.max(0, Math.min(MAX_DISPLAY_POSITIONS, totalOpen) - baseTotal);
  const weights = openRings.map((ring, index) => Math.max(0, ring.length - base[index]!));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const quotas = base.map((count, index) => count + (weightTotal ? Math.floor(remaining * weights[index]! / weightTotal) : 0));
  let slots = Math.min(MAX_DISPLAY_POSITIONS, totalOpen) - quotas.reduce((sum, count) => sum + count, 0);
  const remainderOrder = openRings.map((_, index) => index).sort((a, b) => {
    const fractionA = weightTotal ? remaining * weights[a]! / weightTotal - Math.floor(remaining * weights[a]! / weightTotal) : 0;
    const fractionB = weightTotal ? remaining * weights[b]! / weightTotal - Math.floor(remaining * weights[b]! / weightTotal) : 0;
    return fractionB - fractionA || a - b;
  });
  for (const index of remainderOrder) { if (slots <= 0) break; if (quotas[index]! < openRings[index]!.length) { quotas[index]! += 1; slots -= 1; } }
  const sampled = openRings.map((ring, index) => {
    const count = quotas[index]!;
    if (!count) return [];
    return Array.from({ length: count }, (_, i) => ring[Math.floor(i * ring.length / count)]!);
  });
  const all = sampled.flat();
  if (all.length < 3) throw new TypeError('Country outline has too few display positions');
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of all) { minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
  const spanX = maxX - minX || 1e-8, spanY = maxY - minY || 1e-8;
  const scale = Math.min(272 / spanX, 144 / spanY);
  const width = spanX * scale, height = spanY * scale;
  const left = (280 - width) / 2, top = (152 - height) / 2;
  const display = (point: Point) => [left + (point.x - minX) * scale + 4, top + (maxY - point.y) * scale + 4] as const;
  const path = sampled.map((ring) => {
    const pts = ring.map(display);
    return `M${number(pts[0]![0])},${number(pts[0]![1])}${pts.slice(1).map((point) => `L${number(point[0])},${number(point[1])}`).join('')}Z`;
  }).join('');
  const displayPositions = sampled.reduce((sum, ring) => sum + ring.length, 0);
  return { path, viewBox: '0 0 288 160', sourcePositions, displayPositions, simplified: displayPositions < sourcePositions - rings.length };
}
