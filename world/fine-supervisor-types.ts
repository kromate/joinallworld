/** Independent local runner; never game writes, cloud scheduling, or distribution. */
export const FINE_SUPERVISOR_LIMITS = Object.freeze({
  lifetimeDurationMs: 2 * 24 * 60 * 60 * 1000,
  cycles: 64,
  stageDurationMs: 120_000,
  waitMs: 60_000,
  stateBytes: 2 * 1024 * 1024,
  stateEntries: 128,
  stateDepth: 4,
  configBytes: 64 * 1024,
  freeBytes: 100 * 1024 * 1024,
  rssBytes: 512 * 1024 * 1024,
});

/** Paths are explicitly named world/*.json; hashes bind their exact original bytes. */
export interface FineSupervisorConfig {
  schemaVersion: 1;
  purpose: 'local-fine-preparation-and-compilation';
  preparationConfig: { path: string; sha256: string };
  /** Existing explicitly reviewed inputs, e.g. Rwanda; no discovery or fallback source. */
  seedCampaignConfig: { path: string; sha256: string };
  lifetimeDurationMs: number;
  maxCycles: number;
  stageDurationMs: number;
  preparationMaxJobs: number;
  compilationMaxJobs: number;
  retryWaitMs: number;
  cacheOnly: boolean;
}

export type FineSupervisorStatus = 'terminal' | 'terminal-with-exceptions' | 'pending' | 'budget-exhausted';
export interface FineSupervisorReport {
  schemaVersion: 1;
  purpose: 'local-fine-preparation-and-compilation';
  configHash: string;
  status: FineSupervisorStatus;
  /** False means budget denial prevented fresh verification; no cached success is implied. */
  currentVerification: boolean;
  lifetimeCycles: number;
  /** Interrupted stages keep a full reserved charge; sleep/session absence does not dispatch work. */
  lifetimeChargedMs: number;
  preparedCountries: string[];
  preparationPending: number;
  preparationFailures: Array<{ countryId: string; reason: string }>;
  preparationLifetimeAttempts: number;
  campaign: null | { planHash: string; reportHash: string; total: number; compiled: number; exceptions: number; protected: number; pending: number };
  measuredNetworkBytes: number;
  unknownNetworkTransfers: number;
  /** Interrupted cycles can lack result measurements; acquisition audits retain authoritative reservations. */
  unobservedCycles: number;
  /** Terminal means the frozen supplied queue is exhausted; never worldwide/playable completion. */
  scope: 'frozen-administrative-inputs-only';
}
