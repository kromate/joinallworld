/**
 * Narrow structural types for the pieces of the Workers runtime that the adapter's SQLite code touches. The real
 * `DurableObjectStorage` (from @cloudflare/workers-types) satisfies `SqliteStorage`; so does the node:sqlite
 * stand-in the store test builds, which is why the store asks for this and not for the whole storage class.
 */
export type SqlBinding = string | number | null | Uint8Array
export type SqlRow = Record<string, string | number | null | ArrayBuffer>
/** `rowsWritten`: what the runtime counted for the statement, index entries included (the stand-in of the store test has none). */
export interface SqlCursor<Row> { toArray(): Row[]; one(): Row; readonly rowsWritten?: number }
export interface SqlStorageLike { exec<Row extends SqlRow = SqlRow>(query: string, ...bindings: SqlBinding[]): SqlCursor<Row> }
export interface SqliteStorage {
  sql: SqlStorageLike
  transactionSync<T>(fn: () => T): T
  sync(): Promise<void>
}
