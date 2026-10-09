import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, sha256 } from './pack.ts';
import {
  CAMPAIGN_INDEX_AUDIT_KIND, CAMPAIGN_INDEX_AUDIT_JOB_FORMAT, FEATURE_INDEX_AUDIT_FORMAT,
  campaignIndexAuditJob, buildCampaignIndexAuditCompletion, validateCampaignIndexAuditCompletion,
  type CampaignIndexAuditFrozenInput,
} from './campaign-index-audit-state.ts';

const h = (letter: string) => letter.repeat(64);
const frozen: CampaignIndexAuditFrozenInput = {
  campaignId: 'campaign-2026-10', campaignHash: h('a'), inventoryHash: h('b'), planHash: h('c'),
  indexHash: h('d'), configurationHash: h('e'), captureControllerRecord: { sha256: h('f'), bytes: 1200 },
  completeCaptureSetSha256: h('1'), requiredObservationSetSha256: h('2'), auditInputSha256: h('3'),
  auditFormat: FEATURE_INDEX_AUDIT_FORMAT,
};

function syntheticReport(input = frozen, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    audit: {
      format: 'feature-index-audit-worker-v1', indexHash: input.indexHash,
      inputSha256: input.auditInputSha256, captureRecordSha256: input.captureControllerRecord.sha256,
      nodeVersion: 'v22.19.0', sqliteVersion: '3.50.4',
      result: {
        format: input.auditFormat, scope: 'raw-feature-conservation-and-required-observations',
        qualifications: { rawIndexConservation: 'complete', requiredObservations: 'complete' },
        counts: { captures: 2, rawFeatures: 7, admitted: 7, exceptions: 0, occurrences: 7,
          versions: 7, keys: 7, conflicts: 0, crossOwnerConflictKeys: 0, observations: 3, requiredObservations: 3 },
        dispositionsSha256: h('4'),
      },
      databaseBytes: 4096, maximumRssKiB: 1024,
    },
    auditController: { attempts: 2, inputSha256: input.auditInputSha256, recordSha256: h('5'), replayed: false,
      scope: 'raw-feature-conservation-and-required-observations; global campaign membership is not established by pins alone' },
    ...overrides,
  };
}

test('audit scheduler fixes one campaign/index ID while frozen membership changes conflict through inputHash', () => {
  const first = campaignIndexAuditJob(frozen, 4);
  const changed = campaignIndexAuditJob({ ...frozen, completeCaptureSetSha256: h('6') }, 4);
  assert.equal(first.id, `${frozen.campaignId}:feature-index-audit:${frozen.indexHash}`);
  assert.equal(first.kind, CAMPAIGN_INDEX_AUDIT_KIND);
  assert.equal(first.payload && (first.payload as { format: string }).format, CAMPAIGN_INDEX_AUDIT_JOB_FORMAT);
  assert.equal(first.maxAttempts, 4);
  assert.equal(first.inputHash, sha256(canonicalJson(first.payload)));
  assert.equal(changed.id, first.id);
  assert.notEqual(changed.inputHash, first.inputHash);
  assert.ok(Object.isFrozen(first.payload));
  assert.ok(Object.isFrozen((first.payload as { captureControllerRecord: object }).captureControllerRecord));
  assert.throws(() => { (first.payload as { campaignHash: string }).campaignHash = h('9'); }, TypeError);
});

test('audit attempts stay within the frozen campaign ceiling and the fixed eight-attempt cap', () => {
  assert.equal(campaignIndexAuditJob(frozen, 8, 3).maxAttempts, 3);
  assert.throws(() => campaignIndexAuditJob(frozen, 2, 3), /frozen campaign retry limit/i);
  assert.throws(() => campaignIndexAuditJob(frozen, 9), /fixed bound/i);
  assert.throws(() => campaignIndexAuditJob(frozen, 3, 9), /fixed bound/i);
  assert.throws(() => campaignIndexAuditJob(frozen, 0), /fixed bound/i);
});

test('audit input rejects missing, extraneous, malformed, and accessor-backed fields without invoking getters', () => {
  assert.throws(() => campaignIndexAuditJob({ ...frozen, surprise: true } as never, 2), /exact|invalid/i);
  assert.throws(() => campaignIndexAuditJob({ ...frozen, indexHash: 'D'.repeat(64) }, 2), /lowercase SHA/i);
  assert.throws(() => campaignIndexAuditJob({ ...frozen,
    captureControllerRecord: { sha256: h('f'), bytes: 512_001 } }, 2), /fixed bound/i);
  assert.throws(() => campaignIndexAuditJob({ ...frozen, auditFormat: 'feature-index-raw-audit-v2' as never }, 2), /fixed raw-index/i);
  let invoked = false;
  const accessor = { ...frozen } as Record<string, unknown>;
  Object.defineProperty(accessor, 'campaignId', { enumerable: true, get() { invoked = true; return 'bad'; } });
  assert.throws(() => campaignIndexAuditJob(accessor as never, 2), /accessor/i);
  assert.equal(invoked, false);
});

test('completion records raw audit evidence but leaves unavailable read-only and campaign qualifications incomplete', () => {
  const report = syntheticReport();
  const draft = buildCampaignIndexAuditCompletion(frozen, report, 4);
  assert.equal(draft.status, 'audit-incomplete');
  assert.equal(draft.qualifications.rawIndexConservation, 'complete');
  assert.equal(draft.qualifications.readOnlyStatePreserved, 'incomplete');
  assert.equal(draft.qualifications.campaignObservationCompleteness, undefined);
  assert.ok(draft.reasons.includes('read-only-state-evidence-unavailable'));
  assert.ok(draft.reasons.includes('campaign-observation-membership-not-supplied'));
  assert.equal(draft.reportSha256, sha256(canonicalJson(report)));
  assert.deepEqual(validateCampaignIndexAuditCompletion(draft, frozen, report, 4), draft);
});

test('known observation membership still cannot promote an absent campaign qualification', () => {
  const report = syntheticReport();
  const draft = buildCampaignIndexAuditCompletion(frozen, report, 4,
    { knownCanonicalObservationSetSha256: frozen.requiredObservationSetSha256 });
  assert.equal(draft.status, 'audit-incomplete');
  assert.equal(draft.qualifications.campaignObservationCompleteness, 'incomplete');
  assert.ok(draft.reasons.includes('campaign-observation-membership-not-qualified'));
  assert.throws(() => buildCampaignIndexAuditCompletion(frozen, report, 4,
    { knownCanonicalObservationSetSha256: h('8') }), /membership differs/i);
});

test('failed raw qualification or altered report identities cannot produce a complete receipt', () => {
  const failed = syntheticReport(frozen, { audit: {
    ...(syntheticReport().audit as object),
    result: { ...((syntheticReport().audit as { result: object }).result),
      qualifications: { rawIndexConservation: 'failed', requiredObservations: 'failed' } },
  } });
  const draft = buildCampaignIndexAuditCompletion(frozen, failed, 4);
  assert.equal(draft.status, 'audit-failed');
  assert.equal(draft.qualifications.rawIndexConservation, 'failed');
  const forged = { ...draft, status: 'audit-complete' as const,
    qualifications: { ...draft.qualifications, readOnlyStatePreserved: 'complete' as const,
      campaignObservationCompleteness: 'complete' as const }, reasons: [] };
  assert.throws(() => validateCampaignIndexAuditCompletion(forged, frozen, failed, 4), /differs/i);
  assert.throws(() => buildCampaignIndexAuditCompletion(frozen,
    syntheticReport(frozen, { auditController: { attempts: 1, inputSha256: h('8'), recordSha256: h('5'), replayed: false, scope: 'x' } }), 4), /logical input/i);
  assert.throws(() => buildCampaignIndexAuditCompletion(frozen,
    syntheticReport(frozen, { audit: { ...(syntheticReport().audit as object), captureRecordSha256: h('9') } }), 4), /durable capture record/i);
  assert.throws(() => buildCampaignIndexAuditCompletion(frozen,
    syntheticReport(frozen, { audit: { ...(syntheticReport().audit as object), result: {
      ...((syntheticReport().audit as { result: object }).result), qualifications: {
        rawIndexConservation: 'complete', requiredObservations: 'complete',
        readOnlyStatePreserved: 'complete', campaignObservationCompleteness: 'complete',
      },
    } } }), 4), /exact enumerable data fields|invalid fields/i);
  assert.throws(() => buildCampaignIndexAuditCompletion(frozen,
    syntheticReport(frozen, { auditController: { attempts: 1, inputSha256: frozen.auditInputSha256,
      recordSha256: h('5'), replayed: false, scope: 'raw-feature-conservation-and-required-observations',
      requiredObservationSetSha256: frozen.requiredObservationSetSha256 } }), 4), /invalid fields/i);
  assert.throws(() => buildCampaignIndexAuditCompletion(frozen, null, 4), /object/i);
});
