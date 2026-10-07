import type { SqliteStorage } from './cf-types.ts'

export const SQLITE_SCHEMA_VERSION = 2

export interface MainStoreAuthority { epoch: number; writable: boolean; retiredFromEpoch: number | null; walletEffectWatermark: number | null }
export interface RetireMainStoreResult { epoch: number; walletEffectWatermark: number; duplicate?: true }
interface Migration { from: number; to: number; name: string; apply(storage: SqliteStorage): void }

const table = (storage: SqliteStorage, name: string): boolean => storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=?", name).toArray().length === 1
const index = (storage: SqliteStorage, name: string): boolean => storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index' AND name=?", name).toArray().length === 1
const columns = (storage: SqliteStorage, name: string): Set<string> => new Set(storage.sql.exec<{ name: string }>(`PRAGMA table_info(${name})`).toArray().map(column => column.name))

const currentFoundation = (storage: SqliteStorage): void => {
  const { sql } = storage
  sql.exec('CREATE TABLE IF NOT EXISTS sessions (secret TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, value TEXT NOT NULL)')
  sql.exec('CREATE TABLE IF NOT EXISTS archived_lives (public_id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  sql.exec('CREATE TABLE IF NOT EXISTS action_receipts (sender TEXT NOT NULL, action_id TEXT NOT NULL, action_at INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(sender,action_id))')
  sql.exec('DROP INDEX IF EXISTS action_expiry')
  sql.exec('CREATE TABLE IF NOT EXISTS once_receipts (sender TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(sender,id))')
  sql.exec('CREATE INDEX IF NOT EXISTS once_expiry ON once_receipts(at)')
  sql.exec('CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, public_id TEXT, value TEXT NOT NULL)')
  sql.exec('CREATE TABLE IF NOT EXISTS account_devices (secret TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at INTEGER NOT NULL, value TEXT NOT NULL)')
  sql.exec('CREATE INDEX IF NOT EXISTS account_devices_account ON account_devices(account_id)')
  sql.exec('CREATE TABLE IF NOT EXISTS collections (name TEXT PRIMARY KEY, value TEXT NOT NULL)')
  sql.exec('CREATE TABLE IF NOT EXISTS collection_parts (name TEXT NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(name,part))')
  sql.exec('CREATE TABLE IF NOT EXISTS entries (coll TEXT NOT NULL, map TEXT NOT NULL, key TEXT NOT NULL, ord INTEGER NOT NULL, ix INTEGER, tx TEXT, jx TEXT, value TEXT NOT NULL, PRIMARY KEY(coll,map,key)) WITHOUT ROWID')
  const entryColumns = columns(storage, 'entries')
  for (const [name, type] of [['ix', 'INTEGER'], ['tx', 'TEXT'], ['jx', 'TEXT']] as const) if (!entryColumns.has(name)) sql.exec(`ALTER TABLE entries ADD COLUMN ${name} ${type}`)
  sql.exec('CREATE INDEX IF NOT EXISTS entries_order ON entries(coll,map,ord)')
  sql.exec('CREATE TABLE IF NOT EXISTS store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  sql.exec('CREATE TABLE IF NOT EXISTS wallet_effects (seq INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL, city_id TEXT NOT NULL, operation_id TEXT, ordinal INTEGER NOT NULL, at INTEGER NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER NOT NULL, reason TEXT NOT NULL, transfer_id TEXT)')
  if (!sql.exec<{ name: string }>('PRAGMA table_info(wallet_effects)').toArray().some(column => column.name === 'transfer_id')) sql.exec('ALTER TABLE wallet_effects ADD COLUMN transfer_id TEXT')
  sql.exec('CREATE INDEX IF NOT EXISTS wallet_effects_player ON wallet_effects(public_id,seq)')
  sql.exec('CREATE INDEX IF NOT EXISTS wallet_effects_operation ON wallet_effects(operation_id)')
  sql.exec('CREATE INDEX IF NOT EXISTS wallet_effects_transfer ON wallet_effects(transfer_id)')
}

const MIGRATIONS: readonly Migration[] = [{ from: 0, to: 1, name: 'current-main-store-foundation', apply: currentFoundation }, {
  from: 1, to: 2, name: 'main-store-write-authority', apply(storage) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS main_store_authority (singleton INTEGER PRIMARY KEY CHECK(singleton=1), epoch INTEGER NOT NULL, writable INTEGER NOT NULL CHECK(writable IN (0,1)), retired_from_epoch INTEGER, wallet_effect_watermark INTEGER)')
    storage.sql.exec('INSERT INTO main_store_authority(singleton,epoch,writable,retired_from_epoch,wallet_effect_watermark) VALUES(1,1,1,NULL,NULL) ON CONFLICT(singleton) DO NOTHING')
  },
}]

function storedVersion(storage: SqliteStorage): number {
  if (!table(storage, 'app_schema')) return 0
  const rows = storage.sql.exec<{ version: number }>('SELECT version FROM app_schema WHERE singleton=1').toArray()
  const row = rows[0]
  if (rows.length !== 1 || !row || !Number.isSafeInteger(row.version) || row.version < 0) throw new Error('Invalid application schema version record')
  return row.version
}

function assertCurrent(storage: SqliteStorage): void {
  const requiredTables = ['sessions', 'archived_lives', 'action_receipts', 'once_receipts', 'accounts', 'account_devices', 'collections', 'collection_parts', 'entries', 'store_meta', 'wallet_effects', 'main_store_authority', 'app_schema', 'app_schema_migrations']
  const requiredIndexes = ['once_expiry', 'account_devices_account', 'entries_order', 'wallet_effects_player', 'wallet_effects_operation', 'wallet_effects_transfer']
  const missing = [...requiredTables.filter(name => !table(storage, name)), ...requiredIndexes.filter(name => !index(storage, name))]
  if (missing.length) throw new Error(`Application schema ${SQLITE_SCHEMA_VERSION} is incomplete: missing ${missing.join(', ')}`)
  const shapes: Record<string, readonly string[]> = {
    sessions: ['secret', 'public_id', 'expires_at', 'value'], archived_lives: ['public_id', 'value'], action_receipts: ['sender', 'action_id', 'action_at', 'value'], once_receipts: ['sender', 'id', 'at', 'kind', 'value'],
    accounts: ['id', 'public_id', 'value'], account_devices: ['secret', 'account_id', 'expires_at', 'value'], collections: ['name', 'value'], collection_parts: ['name', 'part', 'value'],
    entries: ['coll', 'map', 'key', 'ord', 'ix', 'tx', 'jx', 'value'], store_meta: ['key', 'value'], wallet_effects: ['seq', 'public_id', 'city_id', 'operation_id', 'ordinal', 'at', 'amount', 'balance_after', 'reason', 'transfer_id'],
    main_store_authority: ['singleton', 'epoch', 'writable', 'retired_from_epoch', 'wallet_effect_watermark'], app_schema: ['singleton', 'version'], app_schema_migrations: ['version', 'name'],
  }
  for (const [name, wanted] of Object.entries(shapes)) { const held = columns(storage, name), absent = wanted.filter(column => !held.has(column)); if (absent.length) throw new Error(`Application schema ${SQLITE_SCHEMA_VERSION} is incomplete: ${name} missing ${absent.join(', ')}`) }
  const records = storage.sql.exec<{ version: number; name: string }>('SELECT version,name FROM app_schema_migrations ORDER BY version').toArray()
  for (const migration of MIGRATIONS) if (!records.some(record => record.version === migration.to && record.name === migration.name)) throw new Error(`Application schema ${SQLITE_SCHEMA_VERSION} has no matching migration record for ${migration.to}`)
}

export function migrateSqliteSchema(storage: SqliteStorage): number {
  const initial = storedVersion(storage)
  if (initial > SQLITE_SCHEMA_VERSION) throw new Error(`Application schema ${initial} is newer than supported version ${SQLITE_SCHEMA_VERSION}`)
  if (initial === SQLITE_SCHEMA_VERSION) {
    assertCurrent(storage)
    // A pre-gate binary may recreate this obsolete index. It carries no state and no query reads it.
    // A retired store remains byte-for-byte inspectable, so only the still-writable authority cleans it up.
    const authority = mainStoreAuthority(storage)
    if (authority.writable && index(storage, 'action_expiry')) storage.transactionSync(() => { assertMainStoreWritable(storage, authority.epoch); storage.sql.exec('DROP INDEX action_expiry') })
    return initial
  }
  storage.transactionSync(() => {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS app_schema (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL)')
    storage.sql.exec('CREATE TABLE IF NOT EXISTS app_schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    storage.sql.exec('INSERT INTO app_schema(singleton,version) VALUES(1,?) ON CONFLICT(singleton) DO NOTHING', initial)
    let version = initial
    while (version < SQLITE_SCHEMA_VERSION) {
      const migration = MIGRATIONS.find(item => item.from === version)
      if (!migration) throw new Error(`No application schema migration from version ${version}`)
      migration.apply(storage)
      storage.sql.exec('INSERT INTO app_schema_migrations(version,name) VALUES(?,?)', migration.to, migration.name)
      storage.sql.exec('UPDATE app_schema SET version=? WHERE singleton=1', migration.to)
      version = migration.to
    }
    if (version !== SQLITE_SCHEMA_VERSION) throw new Error(`Application schema migration stopped at version ${version}`)
    assertCurrent(storage)
  })
  if (storedVersion(storage) !== SQLITE_SCHEMA_VERSION) throw new Error('Application schema migration did not complete')
  return SQLITE_SCHEMA_VERSION
}

export function mainStoreAuthority(storage: SqliteStorage): MainStoreAuthority {
  const rows = storage.sql.exec<{ epoch: number; writable: number; retired_from_epoch: number | null; wallet_effect_watermark: number | null }>('SELECT epoch,writable,retired_from_epoch,wallet_effect_watermark FROM main_store_authority WHERE singleton=1').toArray()
  const row = rows[0]
  if (rows.length !== 1 || !Number.isSafeInteger(row?.epoch) || row!.epoch < 1 || (row?.writable !== 0 && row?.writable !== 1)
    || (row.retired_from_epoch !== null && (!Number.isSafeInteger(row.retired_from_epoch) || row.retired_from_epoch < 1))
    || (row.wallet_effect_watermark !== null && (!Number.isSafeInteger(row.wallet_effect_watermark) || row.wallet_effect_watermark < 0))) throw new Error('Invalid main store write authority')
  return { epoch: row.epoch, writable: row.writable === 1, retiredFromEpoch: row.retired_from_epoch, walletEffectWatermark: row.wallet_effect_watermark }
}

const authorityError = (code: 'write_authority_retired' | 'authority_epoch_conflict', reason: string): Error => Object.assign(new Error(code), { status: 409, code, reason })
export function assertMainStoreWritable(storage: SqliteStorage, expectedEpoch: number): void {
  const authority = mainStoreAuthority(storage)
  if (!authority.writable) throw authorityError('write_authority_retired', `Main store epoch ${authority.epoch} is retired and read-only.`)
  if (authority.epoch !== expectedEpoch) throw authorityError('authority_epoch_conflict', `Expected main store epoch ${expectedEpoch}; current epoch is ${authority.epoch}.`)
}

export function retireMainStore(storage: SqliteStorage, expectedEpoch: number): RetireMainStoreResult {
  if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 1) throw authorityError('authority_epoch_conflict', 'A valid expected main store epoch is required.')
  let result: RetireMainStoreResult | undefined
  storage.transactionSync(() => {
    const authority = mainStoreAuthority(storage)
    if (!authority.writable) {
      if (authority.retiredFromEpoch === expectedEpoch && authority.walletEffectWatermark !== null) { result = { epoch: authority.epoch, walletEffectWatermark: authority.walletEffectWatermark, duplicate: true }; return }
      throw authorityError('authority_epoch_conflict', `Main store was retired from epoch ${authority.retiredFromEpoch ?? 'unknown'}; expected ${expectedEpoch}.`)
    }
    if (authority.epoch !== expectedEpoch) throw authorityError('authority_epoch_conflict', `Expected main store epoch ${expectedEpoch}; current epoch is ${authority.epoch}.`)
    const watermark = Number(storage.sql.exec<{ seq: number }>('SELECT COALESCE(MAX(seq),0) AS seq FROM wallet_effects').toArray()[0]?.seq ?? 0)
    if (!Number.isSafeInteger(watermark) || watermark < 0) throw new Error('Invalid wallet effect watermark')
    const next = expectedEpoch + 1
    storage.sql.exec('UPDATE main_store_authority SET epoch=?,writable=0,retired_from_epoch=?,wallet_effect_watermark=? WHERE singleton=1 AND epoch=? AND writable=1', next, expectedEpoch, watermark, expectedEpoch)
    result = { epoch: next, walletEffectWatermark: watermark }
  })
  if (!result) throw new Error('Main store retirement produced no result')
  return result
}
