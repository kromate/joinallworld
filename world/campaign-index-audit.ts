import { canonicalJson, sha256 } from './pack.ts';
import { CAMPAIGN_INDEX_AUDIT_KIND, CAMPAIGN_INDEX_AUDIT_JOB_FORMAT, FEATURE_INDEX_AUDIT_FORMAT,
  buildQualifiedCampaignIndexAuditCompletion, campaignIndexAuditJob, validateQualifiedCampaignIndexAuditCompletion,
  type CampaignIndexAuditFrozenInput } from './campaign-index-audit-state.ts';
import { openFeatureIndexSession, FeatureIndexSessionTerminated, FeatureIndexSessionUnreaped,
  type FeatureIndexSession, type FeatureIndexSessionAuditInput, type FeatureIndexSessionAuditSnapshot,
  type FeatureIndexSessionAuditProof, type FeatureIndexSessionConfiguration } from './feature-index-session.ts';
import type { CampaignIndexBinding } from './campaign-index-state.ts';
import type { GridQueryCampaign } from './grid-query-types.ts';
import { Ledger, type ClaimedJob } from './ledger.ts';

const ID_PREFIX = ':feature-index-audit:';
const MAX_FAILURE_BYTES = 1024;

class AuditPhaseRefusal extends Error {
  constructor(message: string) { super(message); this.name = 'AuditPhaseRefusal'; }
}

function boundedError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  message = message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
  if (!message) message = 'campaign index audit failed';
  message = message.slice(0, MAX_FAILURE_BYTES);
  while (Buffer.byteLength(message, 'utf8') > MAX_FAILURE_BYTES) message = message.slice(0, -1);
  return message;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function priorAuditRow(ledger: Ledger, campaignId: string, indexHash: string, campaignHash: string,
    inventoryHash: string, planHash: string, configurationHash: string, attemptLimit: number): Record<string, unknown> | null {
  const expectedId = `${campaignId}${ID_PREFIX}${indexHash}`;
  const rows = ledger.list().filter(row => row.kind === CAMPAIGN_INDEX_AUDIT_KIND
    || (typeof row.id === 'string' && row.id.startsWith(`${campaignId}${ID_PREFIX}`)));
  if (rows.length > 1) throw new Error('Campaign Ledger contains more than one feature-index audit row.');
  const row = rows[0];
  if (!row) return null;
  if (row.id !== expectedId || row.kind !== CAMPAIGN_INDEX_AUDIT_KIND) throw new Error('Campaign audit row has an unexpected fixed ID or kind.');
  const payload = record(row.payload, 'Stored campaign audit payload');
  const expectedFields = ['format', 'campaignId', 'campaignHash', 'inventoryHash', 'planHash', 'indexHash',
    'configurationHash', 'captureControllerRecord', 'completeCaptureSetSha256', 'requiredObservationSetSha256',
    'auditInputSha256', 'auditFormat', 'campaignMaxAttempts', 'attemptLimit'];
  if (Object.getPrototypeOf(payload) !== Object.prototype || Reflect.ownKeys(payload).length !== expectedFields.length
      || expectedFields.some(key => !Object.hasOwn(payload, key))) throw new Error('Stored campaign audit payload has an unexpected shape.');
  if (payload.format !== CAMPAIGN_INDEX_AUDIT_JOB_FORMAT || payload.campaignId !== campaignId
      || payload.campaignHash !== campaignHash || payload.inventoryHash !== inventoryHash || payload.planHash !== planHash
      || payload.indexHash !== indexHash || payload.configurationHash !== configurationHash
      || payload.auditFormat !== FEATURE_INDEX_AUDIT_FORMAT || payload.campaignMaxAttempts !== attemptLimit
      || payload.attemptLimit !== attemptLimit || row.maxAttempts !== attemptLimit
      || typeof row.inputHash !== 'string' || row.inputHash !== sha256(canonicalJson(payload))) {
    throw new Error('Stored campaign audit row differs from its immutable campaign/index binding.');
  }
  if (row.status === 'completed') {
    const result = record(row.result, 'Completed campaign audit result');
    if (result.status !== 'audit-complete' || result.format !== 'campaign-index-audit-completion-v1'
        || result.campaignId !== campaignId || result.campaignHash !== campaignHash
        || result.inventoryHash !== inventoryHash || result.planHash !== planHash
        || result.indexHash !== indexHash || result.configurationHash !== configurationHash
        || result.auditFormat !== FEATURE_INDEX_AUDIT_FORMAT) {
      throw new Error('Completed campaign audit receipt differs from the fixed campaign/index binding.');
    }
    return row;
  }
  if (!['queued', 'leased', 'failed'].includes(String(row.status))) throw new Error('Stored campaign audit row has an invalid status.');
  return row;
}

function frozenInput(campaignId: string, campaignHash: string, inventoryHash: string, planHash: string,
    indexHash: string, configurationHash: string, snapshot: FeatureIndexSessionAuditSnapshot): CampaignIndexAuditFrozenInput {
  return {
    campaignId, campaignHash, inventoryHash, planHash, indexHash, configurationHash,
    captureControllerRecord: { sha256: snapshot.captureControllerRecord.sha256, bytes: snapshot.captureControllerRecord.bytes },
    completeCaptureSetSha256: snapshot.captureSetSha256,
    requiredObservationSetSha256: snapshot.requiredObservationsSha256,
    auditInputSha256: snapshot.auditInputSha256,
    auditFormat: FEATURE_INDEX_AUDIT_FORMAT,
  };
}

/**
 * Run a raw-index audit as one immutable campaign child job in the same Ledger.
 * The caller must hold the campaign lock and keep the index namespace/configuration
 * binding fixed for this call. The SDK holds the real namespace and child leases
 * from beforeAudit through worker completion; no phase label or digest is treated
 * as proof of worker success.
 */
export async function runCampaignIndexAuditPhase(context: {
  campaign: GridQueryCampaign;
  campaignHash: string;
  binding: CampaignIndexBinding;
  config?: FeatureIndexSessionConfiguration;
  inputs: readonly FeatureIndexSessionAuditInput[];
  eligible: boolean;
  deadline: number;
  signal?: AbortSignal;
}, ledger: Ledger, failures: string[]): Promise<string | null> {
  if (!context.eligible) return null;

  const campaignId = context.campaign.id;
  const campaignHash = context.campaignHash;
  const inventoryHash = context.campaign.inventoryHash;
  const planHash = context.campaign.gridQuery.planHash;
  const indexHash = context.binding.indexHash;
  const configurationHash = sha256(canonicalJson(context.binding.configuration));
  const attemptLimit = context.campaign.limits.maxAttempts;
  if (!Number.isSafeInteger(attemptLimit) || attemptLimit < 1 || attemptLimit > 8) {
    throw new RangeError('Campaign index audit requires the original retry limit to fit the fixed eight-attempt controller cap.');
  }

  const prior = priorAuditRow(ledger, campaignId, indexHash, campaignHash, inventoryHash, planHash,
    configurationHash, attemptLimit);
  if (prior?.status === 'completed') return null;
  if (!context.config) return 'campaign index audit work remains; supply the original immutable feature index configuration to resume';
  const durationMs = Math.min(600_000, context.deadline - Date.now());
  if (!Number.isFinite(context.deadline) || durationMs <= 0) return 'campaign duration limit reached before feature index audit';

  let session: FeatureIndexSession | undefined;
  let claim: ClaimedJob | undefined;
  let live = false;
  let unreaped = false;
  let heartbeat: NodeJS.Timeout | undefined;
  let phaseStop: string | null = null;
  let fatal: unknown;
  let frozen: CampaignIndexAuditFrozenInput | undefined;
  const leaseMs = Math.min(context.campaign.limits.jobDurationMs, 60_000);
  const worker = `campaign-index-audit-${process.pid}`;
  const inputs = context.inputs;

  const currentLease = (): boolean => {
    if (!live || !claim || context.signal?.aborted || Date.now() >= context.deadline) { live = false; return false; }
    try {
      const retained = ledger.heartbeat(claim.id, claim.token, Date.now(), leaseMs);
      if (!retained) live = false;
      return retained && live;
    } catch { live = false; return false; }
  };

  try {
    session = await openFeatureIndexSession(context.config, { signal: context.signal, durationMs });
    if (session.indexHash !== indexHash) throw new Error('Held audit session differs from the immutable campaign index binding.');
    const report = await session.auditCaptures(inputs, attemptLimit, {
      async beforeAudit(snapshot) {
        if (context.signal?.aborted) throw new AuditPhaseRefusal('campaign index audit stopped by signal before worker launch');
        if (Date.now() >= context.deadline) throw new AuditPhaseRefusal('campaign duration limit reached before feature index audit');
        const input = frozenInput(campaignId, campaignHash, inventoryHash, planHash, indexHash, configurationHash, snapshot);
        frozen = input;
        const descriptor = campaignIndexAuditJob(input, attemptLimit, attemptLimit);
        ledger.enqueue(descriptor);
        claim = ledger.claim(worker, Date.now(), leaseMs, { kind: CAMPAIGN_INDEX_AUDIT_KIND }) ?? undefined;
        if (!claim) {
          throw new AuditPhaseRefusal('campaign index audit is leased, exhausted, or unavailable; no audit worker was launched');
        }
        const row = ledger.list().find(item => item.id === claim!.id);
        if (claim.id !== descriptor.id || claim.kind !== CAMPAIGN_INDEX_AUDIT_KIND
            || claim.inputHash !== descriptor.inputHash || canonicalJson(claim.payload) !== canonicalJson(descriptor.payload)
            || !row || row.kind !== CAMPAIGN_INDEX_AUDIT_KIND || row.status !== 'leased'
            || row.inputHash !== descriptor.inputHash || row.maxAttempts !== descriptor.maxAttempts
            || row.attempt !== claim.attempt || claim.attempt < 1 || claim.attempt > descriptor.maxAttempts
            || descriptor.maxAttempts !== attemptLimit || descriptor.maxAttempts > 8) {
          throw new Error('Claimed campaign audit descriptor or charged retry limit differs from the frozen job.');
        }
        live = true;
        if (!currentLease()) throw new AuditPhaseRefusal('campaign index audit claim is no longer live; no worker was launched');
        const cadence = Math.min(15_000, Math.max(1, Math.floor(leaseMs / 3)));
        heartbeat = setInterval(() => {
          if (!live || !claim || Date.now() >= context.deadline) { live = false; return; }
          try { if (!ledger.heartbeat(claim.id, claim.token, Date.now(), leaseMs)) live = false; }
          catch { live = false; }
        }, cadence);
        heartbeat.unref();
      },
    });

    const proof = report.campaignProof;
    const audit = record(report.audit, 'Actual raw index audit report');
    const controller = record(report.auditController, 'Actual audit controller report');
    if (!claim || !currentLease()) {
      phaseStop = 'campaign index audit lease was lost; a later live claim must replay the raw audit';
    } else {
      if (!frozen) throw new Error('Campaign audit completed without its immutable pre-worker snapshot.');
      if (typeof controller.attempts !== 'number' || !Number.isSafeInteger(controller.attempts)) {
        throw new Error('Actual audit controller did not report a bounded charged attempt count.');
      }
      const proposed = buildQualifiedCampaignIndexAuditCompletion(frozen, proof as FeatureIndexSessionAuditProof, audit,
        controller.attempts, attemptLimit);
      const completion = validateQualifiedCampaignIndexAuditCompletion(proposed, frozen, proof as FeatureIndexSessionAuditProof, audit,
        controller.attempts, attemptLimit);
      if (!live || Date.now() >= context.deadline
          || !ledger.complete(claim.id, claim.token, Date.now(), completion)) {
        live = false;
        phaseStop = 'campaign index audit lease or deadline was lost after the raw audit; a later live claim must replay';
      }
    }
  } catch (error) {
    if (error instanceof FeatureIndexSessionUnreaped) {
      unreaped = true; session = undefined; fatal = error;
    } else if (error instanceof FeatureIndexSessionTerminated) {
      session = undefined;
      phaseStop = 'feature index audit worker was gracefully interrupted after confirmed cleanup';
    } else if (error instanceof AuditPhaseRefusal) {
      phaseStop = error.message;
    } else {
      phaseStop = `campaign index audit stopped after a failed attempt: ${boundedError(error)}`;
    }
    if (claim && live && Date.now() < context.deadline) {
      try {
        const message = boundedError(error);
        if (ledger.fail(claim.id, claim.token, Date.now(), message, 0)) failures.push(`${claim.id}: ${message}`);
      } catch { /* A lost token is left for a later actual lease-gap recovery. */ }
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (session && !unreaped) {
      try { await session.close(); }
      catch (error) {
        if (error instanceof FeatureIndexSessionUnreaped) fatal = error;
        else if (!(error instanceof FeatureIndexSessionTerminated)) fatal ??= error;
      }
    }
  }
  if (fatal) throw fatal;
  return phaseStop;
}
