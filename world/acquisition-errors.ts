export const ACQUISITION_BUDGET_REASONS = [
  'selected-item-count',
  'feature-row-budget',
  'geojson-output-bytes',
] as const;

export type AcquisitionBudgetReason = typeof ACQUISITION_BUDGET_REASONS[number];

export interface AcquisitionBudgetEnvelope {
  schemaVersion: 1;
  kind: 'budget-exceeded';
  reason: AcquisitionBudgetReason;
  networkBytesMeasured: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Parse only the exact, bounded failure protocol emitted by the pinned adapter. */
export function parseAcquisitionBudgetEnvelope(value: unknown): AcquisitionBudgetEnvelope | null {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'kind,networkBytesMeasured,reason,schemaVersion') return null;
  if (typeof value.schemaVersion !== 'number' || value.schemaVersion !== 1 || value.kind !== 'budget-exceeded') return null;
  if (typeof value.reason !== 'string' || !ACQUISITION_BUDGET_REASONS.includes(value.reason as AcquisitionBudgetReason)) return null;
  if (typeof value.networkBytesMeasured !== 'number' || !Number.isSafeInteger(value.networkBytesMeasured) || value.networkBytesMeasured < 0) return null;
  return {
    schemaVersion: 1,
    kind: 'budget-exceeded',
    reason: value.reason as AcquisitionBudgetReason,
    networkBytesMeasured: value.networkBytesMeasured,
  };
}

export class AcquisitionBudgetError extends Error {
  readonly reason: AcquisitionBudgetReason;
  readonly networkBytesMeasured: number;

  constructor(reason: AcquisitionBudgetReason, networkBytesMeasured: number, evidencePath?: string, cause?: unknown) {
    const envelope = parseAcquisitionBudgetEnvelope({
      schemaVersion: 1,
      kind: 'budget-exceeded',
      reason,
      networkBytesMeasured,
    });
    if (!envelope) throw new TypeError('invalid acquisition budget failure evidence');
    super(evidencePath
      ? `acquisition budget exceeded (${reason}); failure evidence: ${evidencePath}`
      : `acquisition budget exceeded (${reason})`,
    cause === undefined ? undefined : { cause });
    this.name = 'AcquisitionBudgetError';
    this.reason = envelope.reason;
    this.networkBytesMeasured = envelope.networkBytesMeasured;
  }
}
