import { SETTLEMENT_PREVIEW_LIMITS, type SettlementAtlasFrame, type SettlementMarkerPlan } from './settlement-client-types.ts';
import type { SettlementPointRecord } from '../settlement-product-types.ts';

const MAX_COUNTRY_POINTS = 100_000;

/** Project an unchanged source point into the existing SVG longitude/latitude atlas. */
export function projectSettlementPoint(point: SettlementPointRecord, wraps: boolean): { x: number; y: number } {
  if (!point || !Array.isArray(point.coordinates) || point.coordinates.length !== 2) {
    throw new TypeError('settlement point must have a longitude/latitude pair');
  }
  if (typeof wraps !== 'boolean') throw new TypeError('atlas wrap flag must be boolean');
  const [longitude, latitude] = point.coordinates;
  if (typeof longitude !== 'number' || typeof latitude !== 'number' ||
      !Number.isFinite(longitude) || !Number.isFinite(latitude) ||
      longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new RangeError('settlement coordinates must be finite WGS84 longitude/latitude');
  }
  const displayedLongitude = wraps && longitude < 0 ? longitude + 360 : longitude;
  return { x: (displayedLongitude + 180) * 2, y: (90 - latitude) * 2 };
}

function parseViewBox(frame: SettlementAtlasFrame): [number, number, number, number] {
  if (!frame || typeof frame !== 'object' || typeof frame.viewBox !== 'string' || typeof frame.wraps !== 'boolean') {
    throw new TypeError('atlas frame must include a viewBox and boolean wraps flag');
  }
  const fields = frame.viewBox.trim().split(/\s+/);
  if (fields.length !== 4 || fields.some(field => field.length === 0)) {
    throw new TypeError('atlas viewBox must contain four numbers');
  }
  const values = fields.map(Number);
  const [x, y, width, height] = values;
  if (values.some(value => !Number.isFinite(value)) || width! <= 0 || height! <= 0 ||
      !Number.isFinite(x! + width!) || !Number.isFinite(y! + height!)) {
    throw new RangeError('atlas viewBox must be finite with positive size');
  }
  return [x!, y!, width!, height!];
}

/** Plan a bounded display layer; all input source rows remain available to the caller. */
export function planSettlementMarkers(
  rows: readonly SettlementPointRecord[],
  frame: SettlementAtlasFrame,
  selectedId?: string,
): SettlementMarkerPlan {
  const [left, top, width, height] = parseViewBox(frame);
  if (!Array.isArray(rows) || rows.length > MAX_COUNTRY_POINTS) {
    throw new RangeError(`settlement point rows must not exceed ${MAX_COUNTRY_POINTS}`);
  }
  if (selectedId !== undefined && typeof selectedId !== 'string') throw new TypeError('selected point ID must be text');

  const ids = new Set<string>();
  const keys = new Set<string>();
  const visible: Array<{ point: SettlementPointRecord; x: number; y: number }> = [];
  let outsideView = 0;
  for (const point of rows) {
    if (!point || typeof point.id !== 'string' || point.id.length === 0 ||
        typeof point.sourceKey !== 'string' || point.sourceKey.length === 0 ||
        !Number.isInteger(point.scaleRank) || point.scaleRank < 0 || point.scaleRank > 10) {
      throw new TypeError('settlement marker requires a point ID, source key, and bounded scale rank');
    }
    if (ids.has(point.id) || keys.has(point.sourceKey)) throw new TypeError('settlement marker IDs and source keys must be unique');
    ids.add(point.id);
    keys.add(point.sourceKey);
    const { x, y } = projectSettlementPoint(point, frame.wraps);
    if (x >= left && x <= left + width && y >= top && y <= top + height) visible.push({ point, x, y });
    else outsideView += 1;
  }

  visible.sort((a, b) => {
    const selectedOrder = Number(b.point.id === selectedId) - Number(a.point.id === selectedId);
    if (selectedOrder !== 0) return selectedOrder;
    if (a.point.scaleRank !== b.point.scaleRank) return a.point.scaleRank - b.point.scaleRank;
    return a.point.sourceKey < b.point.sourceKey ? -1 : a.point.sourceKey > b.point.sourceKey ? 1 : 0;
  });
  const eligible = visible.length;
  const markers = visible.slice(0, SETTLEMENT_PREVIEW_LIMITS.markers);
  return { markers, eligible, outsideView, deferred: eligible - markers.length };
}
