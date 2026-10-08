import { DatabaseSync } from 'node:sqlite';

export interface EnqueueInput {
  id: string; kind: string; inputHash: string; payload: unknown; maxAttempts: number; priority?: number;
}
export interface ClaimedJob {
  id: string; kind: string; inputHash: string; payload: unknown;
  attempt: number; token: string; leaseUntil: number;
}
type JobRow = {
  id: string; kind: string; input_hash: string; payload: string; max_attempts: number;
  attempt: number; token_seq: number; status: string; available_at: number;
  lease_until: number | null; lease_token: string | null;
};

function canonical(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError('payload must be JSON-serializable');
  }
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('payload numbers must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${canonical(obj[key])}`).join(',')}}`;
}
function requiredText(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
}
function finiteTime(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

/** A local, crash-resumable job ledger. All mutations use short IMMEDIATE transactions. */
export class Ledger {
  #db: DatabaseSync;
  #bounded = false;
  constructor(path: string, storageLimits?: { databaseBytes: number }) {
    requiredText(path, 'path');
    if (storageLimits && (!Number.isSafeInteger(storageLimits.databaseBytes) || storageLimits.databaseBytes < 64 * 1024 || storageLimits.databaseBytes > 64 * 1024 * 1024)) throw new RangeError('ledger databaseBytes must be 64 KiB..64 MiB');
    this.#db = new DatabaseSync(path);
    try {
      if (storageLimits) {
        const page = this.#db.prepare('PRAGMA page_size').get() as { page_size: number };
        const maximum = Math.floor(storageLimits.databaseBytes / page.page_size);
        const applied = this.#db.prepare(`PRAGMA max_page_count=${maximum}`).get() as { max_page_count: number };
        if (applied.max_page_count !== maximum) throw new RangeError('existing ledger database exceeds its page quota');
        this.#db.exec('PRAGMA wal_autocheckpoint=1; PRAGMA journal_size_limit=0;');
        this.#bounded = true;
      }
      this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, input_hash TEXT NOT NULL, payload TEXT NOT NULL,
          max_attempts INTEGER NOT NULL CHECK(max_attempts > 0), attempt INTEGER NOT NULL DEFAULT 0,
          token_seq INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('queued','leased','completed','failed')),
          available_at REAL NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 0, lease_until REAL, lease_token TEXT,
          result TEXT, error TEXT
        );
        CREATE INDEX IF NOT EXISTS jobs_claim ON jobs(status, available_at, id);`);
      // Backward-compatible migration for ledgers created before durable priorities.
      // Serialize schema inspection and ALTER so concurrent constructors cannot race.
      this.#db.exec('BEGIN IMMEDIATE');
      try {
        const columns = this.#db.prepare('PRAGMA table_info(jobs)').all() as Array<{name:string}>;
        if (!columns.some((column) => column.name === 'priority')) this.#db.exec('ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0');
        this.#db.exec('CREATE INDEX IF NOT EXISTS jobs_claim_priority ON jobs(status, priority, available_at, id)');
        this.#db.exec('COMMIT');
      } catch (error) {
        this.#db.exec('ROLLBACK');
        throw error;
      }
      this.#checkpoint();
    } catch (error) { this.#db.close(); throw error; }
  }
  #checkpoint(): void {
    if (!this.#bounded) return;
    const row = this.#db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number };
    if (row.busy !== 0) throw new Error('bounded ledger cannot truncate its WAL while another connection holds a snapshot');
  }
  #write<T>(fn: () => T): T {
    return this.#bounded ? this.#transaction(fn) : fn();
  }
  #transaction<T>(fn: () => T): T {
    this.#checkpoint();
    this.#db.exec('BEGIN IMMEDIATE');
    let result: T;
    try { result = fn(); this.#db.exec('COMMIT'); }
    catch (error) { try { this.#db.exec('ROLLBACK'); } catch { /* SQLITE_FULL may already have rolled back the transaction. */ } throw error; }
    this.#checkpoint();
    return result;
  }
  enqueue(input: EnqueueInput): void {
    requiredText(input.id, 'id'); requiredText(input.kind, 'kind'); requiredText(input.inputHash, 'inputHash');
    if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1) throw new RangeError('maxAttempts must be a positive safe integer');
    const priority = input.priority ?? 0;
    if (!Number.isSafeInteger(priority) || priority < 0) throw new RangeError('priority must be a non-negative safe integer');
    const payload = canonical(input.payload);
    this.#transaction(() => {
      const existing = this.#db.prepare('SELECT kind,input_hash,payload,max_attempts,priority,status FROM jobs WHERE id=?').get(input.id) as (Pick<JobRow,'kind'|'input_hash'|'payload'|'max_attempts'|'status'> & {priority:number}) | undefined;
      if (existing) {
        if (existing.kind !== input.kind || existing.input_hash !== input.inputHash || existing.payload !== payload || existing.max_attempts !== input.maxAttempts) {
          throw new Error(`job ${input.id} already exists with a different payload`);
        }
        // Scheduling metadata can be refreshed on resume while the job identity and payload stay pinned.
        // A leased job must retain its current scheduling metadata until its worker releases the lease.
        if (existing.priority !== priority) {
          if (existing.status === 'leased') throw new Error(`job ${input.id} priority cannot change while leased`);
          this.#db.prepare('UPDATE jobs SET priority=? WHERE id=?').run(priority, input.id);
        }
        return;
      }
      this.#db.prepare(`INSERT INTO jobs(id,kind,input_hash,payload,max_attempts,priority,status) VALUES(?,?,?,?,?,?,'queued')`)
        .run(input.id, input.kind, input.inputHash, payload, input.maxAttempts, priority);
    });
  }
  claim(worker: string, now: number, leaseMs: number): ClaimedJob | null {
    requiredText(worker, 'worker'); finiteTime(now, 'now');
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new RangeError('leaseMs must be positive and finite');
    return this.#transaction(() => {
      this.#db.prepare(`UPDATE jobs SET status=CASE WHEN attempt>=max_attempts THEN 'failed' ELSE 'queued' END,
        lease_until=NULL, lease_token=NULL, available_at=? WHERE status='leased' AND lease_until<=?`).run(now, now);
      const row = this.#db.prepare(`SELECT * FROM jobs WHERE status='queued' AND available_at<=? AND attempt<max_attempts ORDER BY priority,available_at,id LIMIT 1`).get(now) as JobRow | undefined;
      if (!row) return null;
      const attempt = row.attempt + 1, seq = row.token_seq + 1;
      const token = `${seq}:${worker}`;
      const leaseUntil = now + leaseMs;
      this.#db.prepare(`UPDATE jobs SET status='leased',attempt=?,token_seq=?,lease_until=?,lease_token=? WHERE id=?`)
        .run(attempt, seq, leaseUntil, token, row.id);
      return { id: row.id, kind: row.kind, inputHash: row.input_hash, payload: JSON.parse(row.payload), attempt, token, leaseUntil };
    });
  }
  heartbeat(id: string, token: string, now: number, leaseMs: number): boolean {
    requiredText(id, 'id'); requiredText(token, 'token'); finiteTime(now, 'now');
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new RangeError('leaseMs must be positive and finite');
    return this.#write(() => Number(this.#db.prepare(`UPDATE jobs SET lease_until=? WHERE id=? AND status='leased' AND lease_token=? AND lease_until>?`)
      .run(now + leaseMs, id, token, now).changes) === 1);
  }
  complete(id: string, token: string, now: number, result: unknown): boolean {
    requiredText(id, 'id'); requiredText(token, 'token'); finiteTime(now, 'now');
    const encoded = canonical(result);
    return this.#write(() => Number(this.#db.prepare(`UPDATE jobs SET status='completed',result=?,lease_until=NULL,lease_token=NULL
      WHERE id=? AND status='leased' AND lease_token=? AND lease_until>?`).run(encoded, id, token, now).changes) === 1);
  }
  fail(id: string, token: string, now: number, error: unknown, retryDelayMs: number): boolean {
    requiredText(id, 'id'); requiredText(token, 'token'); finiteTime(now, 'now');
    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) throw new RangeError('retryDelayMs must be non-negative and finite');
    const message = error instanceof Error ? error.message : String(error);
    return this.#transaction(() => Number(this.#db.prepare(`UPDATE jobs SET status=CASE WHEN attempt>=max_attempts THEN 'failed' ELSE 'queued' END,
      error=?,available_at=?,lease_until=NULL,lease_token=NULL WHERE id=? AND status='leased' AND lease_token=? AND lease_until>?`)
      .run(message, now + retryDelayMs, id, token, now).changes) === 1);
  }
  /** Requeue a completed record only after its owning pipeline quarantines verified corrupt output. */
  requeueCompleted(id: string): boolean {
    requiredText(id, 'id');
    return this.#write(() => Number(this.#db.prepare(`UPDATE jobs SET status='queued',attempt=0,available_at=0,result=NULL,error='verified output quarantined',lease_until=NULL,lease_token=NULL WHERE id=? AND status='completed'`).run(id).changes) === 1);
  }
  list(): Array<Record<string, unknown>> {
    return (this.#db.prepare(`SELECT id,kind,input_hash AS inputHash,payload,max_attempts AS maxAttempts,priority,attempt,status,
      available_at AS availableAt,lease_until AS leaseUntil,result,error FROM jobs ORDER BY id`).all() as Array<Record<string, unknown>>)
      .map((row) => ({ ...row, payload: JSON.parse(String(row.payload)), result: row.result === null ? null : JSON.parse(String(row.result)) }));
  }
  close(): void { this.#db.close(); }
}
