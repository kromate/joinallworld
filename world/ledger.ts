import { DatabaseSync } from 'node:sqlite';
import { closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readSync, rmSync, writeSync, type Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface EnqueueInput {
  id: string; kind: string; inputHash: string; payload: unknown; maxAttempts: number; priority?: number;
}
export interface ClaimedJob {
  id: string; kind: string; inputHash: string; payload: unknown;
  attempt: number; token: string; leaseUntil: number;
}
export interface ClaimFilter { kind: string }
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
function claimKind(filter: ClaimFilter | undefined): string | undefined {
  if (filter === undefined) return undefined;
  if (!filter || typeof filter !== 'object' || Array.isArray(filter) || Object.getPrototypeOf(filter) !== Object.prototype
      || Reflect.ownKeys(filter).length !== 1) throw new TypeError('claim filter must be a plain object with only kind');
  const descriptor = Object.getOwnPropertyDescriptor(filter, 'kind');
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
    throw new TypeError('claim filter kind must be an enumerable data property');
  }
  const value: unknown = descriptor.value;
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    throw new TypeError('claim filter kind must be bounded control-free text');
  }
  return value;
}
function assertJsonValue(value: unknown, stack = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('payload numbers must be finite'); return; }
  if (typeof value !== 'object') throw new TypeError('payload must be JSON-serializable');
  if (stack.has(value)) throw new TypeError('payload must not contain cycles');
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (!(index in value)) throw new TypeError('payload arrays must not contain holes');
        assertJsonValue(value[index], stack);
      }
    } else {
      for (const key of Object.keys(value)) assertJsonValue((value as Record<string, unknown>)[key], stack);
    }
  } finally { stack.delete(value); }
}

/** A local, crash-resumable job ledger. All mutations use short IMMEDIATE transactions. */
export class Ledger {
  /** Inspection opens an existing ledger without schema, journal or lease writes. */
  static readOnlyList(filename: string): Array<Record<string, unknown>> {
    requiredText(filename,'path');
    // SQLite may create WAL/SHM sidecars even with readOnly:true. Query a private
    // stable copy instead; never mark a live source immutable or ignore its WAL.
    const before=new Map<string,string|null>(),limit=64*1024*1024;
    const signature=(info:Stats)=>[info.dev,info.ino,info.size,info.mtimeMs,info.ctimeMs].join(':');
    const inspect=(file:string,optional:boolean)=>{
      try{const info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>limit)throw new Error('read-only ledger snapshot refuses unsafe or oversized state');return signature(info);}
      catch(error){if(optional&&(error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
    };
    const sources=[filename,`${filename}-wal`];
    for(const file of sources)before.set(file,inspect(file,file!==filename));
    const scratch=mkdtempSync(path.join(tmpdir(),'world-ledger-status-')),copy=path.join(scratch,'ledger.sqlite');
    let db:DatabaseSync|undefined;
    try {
      for(const file of sources){
        if(before.get(file)===null)continue;
        const descriptor=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
        try{
          if(signature(fstatSync(descriptor))!==before.get(file))throw new Error('ledger changed during read-only snapshot');
          const size=fstatSync(descriptor).size;
          const output=openSync(file===filename?copy:`${copy}-wal`,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
          try{
            // Copy only the prechecked length, with fixed memory, even if a
            // concurrent writer keeps appending. Changed files refuse below.
            const buffer=Buffer.allocUnsafe(65536);
            for(let offset=0;offset<size;){
              const count=readSync(descriptor,buffer,0,Math.min(buffer.length,size-offset),offset);
              if(count===0)throw new Error('ledger changed during read-only snapshot');
              for(let written=0;written<count;){
                const countWritten=writeSync(output,buffer,written,count-written,offset+written);
                if(countWritten===0)throw new Error('ledger snapshot write did not advance');
                written+=countWritten;
              }
              offset+=count;
            }
            if(signature(fstatSync(descriptor))!==before.get(file))throw new Error('ledger changed during read-only snapshot');
          }finally{closeSync(output);}
        }finally{closeSync(descriptor);}
      }
      for(const file of sources)if(inspect(file,file!==filename)!==before.get(file))throw new Error('ledger changed during read-only snapshot; retry status');
      db=new DatabaseSync(copy,{readOnly:true});
      return (db.prepare(`SELECT id,kind,input_hash AS inputHash,payload,max_attempts AS maxAttempts,priority,attempt,status,
        available_at AS availableAt,lease_until AS leaseUntil,result,error FROM jobs ORDER BY id`).all() as Array<Record<string,unknown>>)
        .map(row=>({...row,payload:JSON.parse(String(row.payload)),result:row.result===null?null:JSON.parse(String(row.result))}));
    } finally { try{db?.close();}finally{rmSync(scratch,{recursive:true});} }
  }
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
  claim(worker: string, now: number, leaseMs: number, filter?: ClaimFilter): ClaimedJob | null {
    requiredText(worker, 'worker'); finiteTime(now, 'now');
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new RangeError('leaseMs must be positive and finite');
    // Validate before opening a transaction: malformed filters cannot expire
    // leases or otherwise mutate jobs as a side effect of a failed claim.
    const kind = claimKind(filter);
    return this.#transaction(() => {
      this.#db.prepare(`UPDATE jobs SET status=CASE WHEN attempt>=max_attempts THEN 'failed' ELSE 'queued' END,
        lease_until=NULL, lease_token=NULL, available_at=? WHERE status='leased' AND lease_until<=?`).run(now, now);
      const row = (kind === undefined
        ? this.#db.prepare(`SELECT * FROM jobs WHERE status='queued' AND available_at<=? AND attempt<max_attempts ORDER BY priority,available_at,id LIMIT 1`).get(now)
        : this.#db.prepare(`SELECT * FROM jobs WHERE status='queued' AND available_at<=? AND attempt<max_attempts AND kind=? ORDER BY priority,available_at,id LIMIT 1`).get(now, kind)) as JobRow | undefined;
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
  /** Atomically complete a live parent and enqueue up to four deterministic children. */
  completeAndEnqueue(id: string, token: string, now: number, result: unknown, children: readonly EnqueueInput[]): boolean {
    requiredText(id, 'id'); requiredText(token, 'token'); finiteTime(now, 'now');
    if (!Array.isArray(children) || children.length > 4) throw new RangeError('completeAndEnqueue accepts at most four children');
    assertJsonValue(result);
    const encodedResult = canonical(result);
    const ids = new Set<string>();
    const prepared = children.map((child, index) => {
      if (!child || typeof child !== 'object' || Array.isArray(child)) throw new TypeError(`child ${index} must be an enqueue record`);
      requiredText(child.id, `child ${index} id`); requiredText(child.kind, `child ${index} kind`); requiredText(child.inputHash, `child ${index} inputHash`);
      if (child.id === id || ids.has(child.id)) throw new Error('child IDs must be unique and different from the parent ID');
      ids.add(child.id);
      if (!Number.isSafeInteger(child.maxAttempts) || child.maxAttempts < 1) throw new RangeError(`child ${index} maxAttempts must be a positive safe integer`);
      const priority = child.priority ?? 0;
      if (!Number.isSafeInteger(priority) || priority < 0) throw new RangeError(`child ${index} priority must be a non-negative safe integer`);
      assertJsonValue(child.payload);
      return { id: child.id, kind: child.kind, inputHash: child.inputHash, payload: canonical(child.payload), maxAttempts: child.maxAttempts, priority };
    });

    return this.#transaction(() => {
      const parent = this.#db.prepare(`SELECT 1 AS live FROM jobs WHERE id=? AND status='leased' AND lease_token=? AND lease_until>?`).get(id, token, now);
      if (!parent) return false;
      for (const child of prepared) {
        const existing = this.#db.prepare('SELECT kind,input_hash,payload,max_attempts,priority FROM jobs WHERE id=?').get(child.id) as
          { kind: string; input_hash: string; payload: string; max_attempts: number; priority: number } | undefined;
        if (existing) {
          if (existing.kind !== child.kind || existing.input_hash !== child.inputHash || existing.payload !== child.payload || existing.max_attempts !== child.maxAttempts || existing.priority !== child.priority) {
            throw new Error(`child job ${child.id} already exists with a different payload`);
          }
        } else {
          this.#db.prepare(`INSERT INTO jobs(id,kind,input_hash,payload,max_attempts,priority,status) VALUES(?,?,?,?,?,?,'queued')`)
            .run(child.id, child.kind, child.inputHash, child.payload, child.maxAttempts, child.priority);
        }
      }
      const updated = this.#db.prepare(`UPDATE jobs SET status='completed',result=?,lease_until=NULL,lease_token=NULL
        WHERE id=? AND status='leased' AND lease_token=? AND lease_until>?`).run(encodedResult, id, token, now);
      if (Number(updated.changes) !== 1) throw new Error('parent lease changed during atomic child enqueue');
      return true;
    });
  }
  fail(id: string, token: string, now: number, error: unknown, retryDelayMs: number): boolean {
    requiredText(id, 'id'); requiredText(token, 'token'); finiteTime(now, 'now');
    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) throw new RangeError('retryDelayMs must be non-negative and finite');
    const message = error instanceof Error ? error.message : String(error);
    return this.#transaction(() => Number(this.#db.prepare(`UPDATE jobs SET status=CASE WHEN attempt>=max_attempts THEN 'failed' ELSE 'queued' END,
      error=?,available_at=?,lease_until=NULL,lease_token=NULL WHERE id=? AND status='leased' AND lease_token=? AND lease_until>?`)
      .run(message, now + retryDelayMs, id, token, now).changes) === 1);
  }
  /** Terminalize verified immutable input failures without pretending every allowed attempt ran. */
  failPermanently(id: string, token: string, now: number, error: unknown): boolean {
    requiredText(id, 'id'); requiredText(token, 'token'); finiteTime(now, 'now');
    const message = error instanceof Error ? error.message : String(error);
    return this.#write(() => Number(this.#db.prepare(`UPDATE jobs SET status='failed',error=?,lease_until=NULL,lease_token=NULL
      WHERE id=? AND status='leased' AND lease_token=? AND lease_until>?`).run(message, id, token, now).changes) === 1);
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
