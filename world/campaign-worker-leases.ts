/** Explicit fd-6/fd-7 inheritance for already-open campaign and acquisition leases. */
import type { StdioOptions } from 'node:child_process';
import { Stream } from 'node:stream';
import { campaignLeaseWorkerStdio, type CampaignLease } from './campaign-lease.ts';

type StdioEntry = Extract<StdioOptions, unknown[]>[number];
const FRAME_NAME = 'WORLD_CAMPAIGN_LEASE_FRAME';
const MAX_FRAME_BYTES = 32_000;

interface LeaseFrameRole {
  descriptor: 6 | 7;
  root: string;
  rootDevice: number;
  rootInode: number;
  lockDevice: number;
  lockInode: number;
}
interface LeaseFrame {
  format: 'world-campaign-worker-leases-v1';
  campaign: LeaseFrameRole;
  acquisition: LeaseFrameRole | null;
}
export interface CampaignWorkerLeaseOptions {
  readonly stdio: StdioOptions;
  readonly environment: NodeJS.ProcessEnv;
}

function plainSix(values: readonly StdioEntry[]): StdioEntry[] {
  if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype || values.length !== 6
      || Reflect.ownKeys(values).length !== 7) throw new TypeError('worker stdio must contain exactly slots 0 through 5');
  const copy: StdioEntry[] = [];
  for (let index = 0; index < 6; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('worker stdio must have six dense data slots without accessors');
    }
    const item = descriptor.value;
    if (item !== undefined && item !== null && item !== 'pipe' && item !== 'ignore' && item !== 'inherit'
        && !(typeof item === 'number' && Number.isSafeInteger(item) && item >= 0 && item <= 2_147_483_647)
        && !(item instanceof Stream)) throw new TypeError('worker stdio contains an unsupported entry');
    copy.push(item as StdioEntry);
  }
  return copy;
}

function identity(role: CampaignLease, descriptor: 6 | 7): LeaseFrameRole {
  const { root, rootIdentity, lockIdentity } = role;
  if (typeof root !== 'string' || !root.startsWith('/') || !root.length || root.length > 16_000
      || !Number.isSafeInteger(rootIdentity.device) || rootIdentity.device < 0
      || !Number.isSafeInteger(rootIdentity.inode) || rootIdentity.inode < 1
      || !Number.isSafeInteger(lockIdentity.device) || lockIdentity.device < 0
      || !Number.isSafeInteger(lockIdentity.inode) || lockIdentity.inode < 1) {
    throw new TypeError('campaign lease identity is not safely serializable');
  }
  return { descriptor, root, rootDevice: rootIdentity.device, rootInode: rootIdentity.inode,
    lockDevice: lockIdentity.device, lockInode: lockIdentity.inode };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('campaign lease frame contains a non-JSON value');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function sameRootLock(left: LeaseFrameRole, right: LeaseFrameRole): boolean {
  return left.root === right.root && left.rootDevice === right.rootDevice && left.rootInode === right.rootInode
    && left.lockDevice === right.lockDevice && left.lockInode === right.lockInode;
}

/**
 * Freeze explicit lease inheritance for one mutating worker. This transports
 * verified lock identities only; it does not admit campaign work or add quota.
 */
export async function prepareCampaignWorkerLeases(campaignLease: CampaignLease,
    acquisitionLease: CampaignLease | null, existingStdio: readonly StdioEntry[]): Promise<CampaignWorkerLeaseOptions> {
  if (!campaignLease || typeof campaignLease !== 'object') throw new TypeError('campaign lease handle is required');
  if (acquisitionLease !== null && (!acquisitionLease || typeof acquisitionLease !== 'object')) {
    throw new TypeError('acquisition lease must be an actual lease handle or null');
  }
  if (acquisitionLease === campaignLease) throw new TypeError('campaign and acquisition leases must be distinct handles');
  const base = plainSix(existingStdio);
  const campaignStd = await campaignLeaseWorkerStdio(campaignLease, base);
  const campaignMapped = campaignStd as StdioEntry[];
  if (!Array.isArray(campaignMapped) || campaignMapped.length !== 7 || !Number.isSafeInteger(campaignMapped[6])
      || campaignMapped[6] <= 2) throw new Error('campaign lease did not map to dedicated child descriptor 6');
  let acquisitionMapped: number | undefined;
  if (acquisitionLease) {
    const result = await campaignLeaseWorkerStdio(acquisitionLease, base);
    const mapped = result as StdioEntry[];
    if (!Array.isArray(mapped) || mapped.length !== 7 || !Number.isSafeInteger(mapped[6]) || mapped[6] <= 2) {
      throw new Error('acquisition lease did not map to a dedicated descriptor');
    }
    acquisitionMapped = mapped[6] as number;
  }
  const originalFds = base.filter((item): item is number => typeof item === 'number');
  if (new Set(originalFds).size !== originalFds.length || originalFds.includes(campaignMapped[6] as number)
      || (acquisitionMapped !== undefined && (originalFds.includes(acquisitionMapped)
        || acquisitionMapped === campaignMapped[6]))) {
    throw new TypeError('worker stdio reuses a source descriptor reserved for a lease');
  }
  const campaign = identity(campaignLease, 6);
  const acquisition = acquisitionLease ? identity(acquisitionLease, 7) : null;
  if (acquisition && sameRootLock(campaign, acquisition)) throw new TypeError('campaign and acquisition leases cannot name the same root and lock inode');
  await campaignLease.assertIdentity();
  if (acquisitionLease) await acquisitionLease.assertIdentity();

  const frame: LeaseFrame = { format: 'world-campaign-worker-leases-v1', campaign, acquisition };
  const serialized = canonical(frame);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_FRAME_BYTES) throw new RangeError('campaign lease transport frame exceeds 32000 bytes');
  const stdio = [...base, campaignMapped[6] as number];
  if (acquisitionMapped !== undefined) stdio.push(acquisitionMapped);
  const environment = { [FRAME_NAME]: serialized };
  const frozenStdio = Object.freeze(stdio) as unknown as StdioOptions;
  const frozenEnvironment = Object.freeze(environment) as NodeJS.ProcessEnv;
  return Object.freeze({ stdio: frozenStdio, environment: frozenEnvironment });
}
