// Keep this module small: core may retain the opaque envelope without importing geometry.
import type { BuildingDraft, BuildingEnvelope } from '../../types/building.ts';

export const BUILDING_BYTES = 65536;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const fitsBytes = (text: string): boolean => {
  let bytes = 0;
  for (const char of text) { const point = char.codePointAt(0)!; bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4; if (bytes > BUILDING_BYTES) return false; }
  return true;
};
export function cleanBuildingEnvelope(value: unknown): BuildingEnvelope | undefined {
  if (!record(value) || value.v !== 1 || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.data !== 'string' || value.data.length > BUILDING_BYTES || !fitsBytes(value.data)) return undefined;
  return { v: 1, revision: value.revision, data: value.data };
}
export function decodeBuildingEnvelope(value: unknown): { ok: true; revision: number; draft: unknown } | { ok: false; code: 'invalid_envelope' | 'invalid_json' } {
  const envelope = cleanBuildingEnvelope(value);
  if (!envelope) return { ok: false, code: 'invalid_envelope' };
  try { return { ok: true, revision: envelope.revision, draft: JSON.parse(envelope.data) }; }
  catch { return { ok: false, code: 'invalid_json' }; }
}
export function encodeBuildingEnvelope(draft: BuildingDraft, revision: number): BuildingEnvelope | undefined {
  return cleanBuildingEnvelope({ v: 1, revision, data: JSON.stringify(draft) });
}
