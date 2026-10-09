"""Append-only declared index allowances; caller-owned private SQLite connection.

Not a filesystem opener/preallocation, acquisition budget, scheduler or geometry
admission. Caller must enforce the namespace lease and parent process/file limits.
"""
import hashlib
import re
import sqlite3

MIB = 1024 * 1024
FORMAT = "feature-index-reservations-v1"
APPLICATION_ID = 0x57495231
DATABASE_BYTES = 4*MIB
# Candidate conservative namespace overhead: registry DB/WAL/SHM/journal + margin.
# Physical worst-case acceptance is still required before production quota freeze.
REGISTRY_ALLOWANCE = 17*MIB
MAX_RESERVATIONS = 256
DEFINITIONS = {
    "meta": "CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL CHECK(length(value)<=4096)) WITHOUT ROWID",
    "reservations": "CREATE TABLE reservations(hash TEXT PRIMARY KEY CHECK(length(hash)=64),binding BLOB NOT NULL CHECK(typeof(binding)='blob' AND length(binding) BETWEEN 1 AND 4096),reserved_bytes INTEGER NOT NULL CHECK(typeof(reserved_bytes)='integer' AND reserved_bytes BETWEEN 65536 AND 536870912),record_hash TEXT NOT NULL CHECK(length(record_hash)=64)) WITHOUT ROWID",
}
SCHEMA_HASH = hashlib.sha256("\n".join(DEFINITIONS.values()).encode()).hexdigest()


def _integer(value, minimum, maximum, label):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{label} exceeds its declared allowance bound")
    return value


def _hash(value):
    if type(value) is not str or not re.fullmatch("[a-f0-9]{64}", value):
        raise ValueError("index binding requires an exact SHA-256")
    return value


def _record_hash(binding, amount):
    prefix = f"{FORMAT}\n{len(binding)}\n{amount}\n".encode("ascii")
    return hashlib.sha256(prefix+binding).hexdigest()


class IndexReservations:
    """One immutable namespace budget, charged once per exact opaque binding.

    No release, refund, resizing, deleting or quota-reset API. This primitive
    verifies byte identity only: a later opener validates binding semantics.
    """
    def __init__(self, connection, aggregate_bytes):
        if type(connection) is not sqlite3.Connection or connection.isolation_level is not None or connection.in_transaction:
            raise TypeError("reservation engine requires its idle autocommit SQLite connection")
        self._aggregate_bytes = _integer(aggregate_bytes, REGISTRY_ALLOWANCE+65536, 512*MIB, "namespace budget")
        self.db = connection
        self.failed = False
        if (self.db.execute("PRAGMA page_size").fetchone()[0] != 4096
                or self.db.execute("PRAGMA page_count").fetchone()[0] > DATABASE_BYTES//4096):
            raise ValueError("reservation registry exceeds its fixed page/size bound")
        app = self.db.execute("PRAGMA application_id").fetchone()[0]
        version = self.db.execute("PRAGMA user_version").fetchone()[0]
        objects = self.db.execute("SELECT count(*) FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").fetchone()[0]
        if (objects and app != APPLICATION_ID) or (not objects and (app != 0 or version != 0)):
            raise ValueError("connection is not an empty or recognized reservation registry")
        if objects:
            self._verify_schema()
            self._verify_rows()
        if self.db.execute("PRAGMA page_size").fetchone()[0] != 4096:
            raise ValueError("reservation registry requires fixed 4096-byte pages")
        if self.db.execute(f"PRAGMA max_page_count={DATABASE_BYTES//4096}").fetchone()[0] != DATABASE_BYTES//4096:
            raise ValueError("existing reservation registry exceeds its page quota")
        if self.db.execute("PRAGMA journal_mode=WAL").fetchone()[0] != "wal":
            raise ValueError("reservation registry requires actual file-backed WAL")
        self.db.executescript("PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=250; PRAGMA cache_size=-1024; PRAGMA temp_store=MEMORY; PRAGMA wal_autocheckpoint=0; PRAGMA journal_size_limit=0;")
        if self.db.execute("PRAGMA synchronous").fetchone()[0] != 2 or self.db.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
            raise ValueError("reservation durability settings were not applied")
        if not objects:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                for sql in DEFINITIONS.values():
                    self.db.execute(sql)
                self.db.executemany("INSERT INTO meta VALUES(?,?)", [
                    ("format", FORMAT), ("aggregate_bytes", str(self.aggregate_bytes)), ("schema", SCHEMA_HASH),
                    ("held_bytes", "0"), ("reservation_count", "0"),
                    ("records_digest", hashlib.sha256(f"{FORMAT}\n".encode("ascii")).hexdigest())])
                self.db.execute(f"PRAGMA application_id={APPLICATION_ID}")
                self.db.execute("PRAGMA user_version=1")
                self.db.execute("COMMIT")
            except BaseException:
                self._rollback()
                raise
        self._verify_schema()
        self._verify_rows()
        self._checkpoint()

    @property
    def aggregate_bytes(self):
        return self._aggregate_bytes

    def _verify_schema(self):
        if self.db.execute("PRAGMA application_id").fetchone()[0] != APPLICATION_ID:
            raise ValueError("reservation registry application binding differs")
        if self.db.execute("PRAGMA user_version").fetchone()[0] != 1:
            raise ValueError("unsupported reservation registry version")
        if self.db.execute("SELECT count(*) FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").fetchone()[0] != len(DEFINITIONS):
            raise ValueError("unexpected reservation registry schema")
        if self.db.execute("SELECT count(*) FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' AND length(sql)>4096").fetchone()[0]:
            raise ValueError("reservation schema exceeds its bound")
        for name, sql in self.db.execute("SELECT name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'"):
            if name not in DEFINITIONS or sql != DEFINITIONS[name]:
                raise ValueError("reservation registry schema differs")
        if self.db.execute("SELECT count(*) FROM meta").fetchone()[0] != 6:
            raise ValueError("reservation registry metadata differs")
        if self.db.execute("SELECT count(*) FROM meta WHERE typeof(key)<>'text' OR length(key)>64 OR typeof(value)<>'text' OR length(value)>4096").fetchone()[0]:
            raise ValueError("reservation metadata exceeds its field bound")
        for key, value in [("format", FORMAT), ("aggregate_bytes", str(self.aggregate_bytes)), ("schema", SCHEMA_HASH)]:
            stored = self.db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
            if stored is None or stored[0] != value:
                raise ValueError("reservation namespace binding/budget differs; no quota reset")

    def _read_rows(self):
        count = self.db.execute("SELECT count(*) FROM reservations").fetchone()[0]
        _integer(count, 0, MAX_RESERVATIONS, "reservation rows")
        if self.db.execute("SELECT count(*) FROM reservations WHERE typeof(binding)<>'blob' OR length(binding) NOT BETWEEN 1 AND 4096 OR typeof(hash)<>'text' OR length(hash)<>64 OR typeof(record_hash)<>'text' OR length(record_hash)<>64 OR typeof(reserved_bytes)<>'integer'").fetchone()[0]:
            raise ValueError("reservation record exceeds its byte/type bound")
        charged = REGISTRY_ALLOWANCE
        digest = hashlib.sha256(f"{FORMAT}\n".encode("ascii"))
        for key, binding, amount, record_hash in self.db.execute("SELECT hash,binding,reserved_bytes,record_hash FROM reservations ORDER BY hash"):
            _hash(key)
            if hashlib.sha256(binding).hexdigest() != key:
                raise ValueError("reservation binding bytes are contradictory")
            _integer(amount, 65536, 512*MIB, "held allowance")
            if _hash(record_hash) != _record_hash(binding, amount):
                raise ValueError("reservation amount/binding stamp is contradictory")
            charged += amount
            digest.update((key+record_hash).encode("ascii"))
        if charged > self.aggregate_bytes:
            raise ValueError("held namespace allowances exceed their immutable budget")
        return {"reservations": count, "heldBytes": charged-REGISTRY_ALLOWANCE,
                "registryAllowanceBytes": REGISTRY_ALLOWANCE, "chargedBytes": charged,
                "aggregateLimitBytes": self.aggregate_bytes}, digest.hexdigest()

    @staticmethod
    def _totals(state, digest):
        return [("held_bytes", str(state["heldBytes"])),
                ("reservation_count", str(state["reservations"])), ("records_digest", digest)]

    def _verify_rows(self):
        state, digest = self._read_rows()
        for key, value in self._totals(state, digest):
            stored = self.db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
            if stored is None or stored[0] != value:
                raise ValueError("reservation charge ledger differs; no implicit release or refund")
        return state

    def _write_totals(self):
        state, digest = self._read_rows()
        for key, value in self._totals(state, digest):
            if self.db.execute("UPDATE meta SET value=? WHERE key=?", (value, key)).rowcount != 1:
                raise ValueError("reservation charge ledger entry is missing")

    def _rollback(self):
        try:
            self.db.execute("ROLLBACK")
        except sqlite3.Error:
            pass  # SQLITE_FULL/IOERR may already roll back; preserve original failure.

    def _checkpoint(self):
        if self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone() != (0, 0, 0):
            raise RuntimeError("reservation checkpoint incomplete; preserve registry and WAL together")

    def snapshot(self):
        self._verify_schema()
        return self._verify_rows()

    def reserve(self, index_hash, binding_bytes, reserved_bytes):
        if self.failed:
            raise RuntimeError("failed reservation writer must reopen before retry")
        if self.db.in_transaction:
            raise RuntimeError("reservation writer requires an idle connection; caller transaction is preserved")
        _hash(index_hash)
        if type(binding_bytes) is not bytes or not 1 <= len(binding_bytes) <= 4096:
            raise ValueError("reservation requires bounded immutable binding bytes")
        if hashlib.sha256(binding_bytes).hexdigest() != index_hash:
            raise ValueError("reservation binding SHA-256 differs")
        _integer(reserved_bytes, 65536, 512*MIB, "declared reservation")
        began = False
        try:
            self._verify_schema()
            self._checkpoint()
            self.db.execute("BEGIN IMMEDIATE")
            began = True
            self._verify_schema()
            before = self._verify_rows()
            old = self.db.execute("SELECT binding,reserved_bytes FROM reservations WHERE hash=?", (index_hash,)).fetchone()
            if old:
                if old != (binding_bytes, reserved_bytes):
                    raise ValueError("existing reservation differs; resizing/refunds are forbidden")
            else:
                _integer(before["reservations"]+1, 0, MAX_RESERVATIONS, "reservation rows")
                if before["chargedBytes"]+reserved_bytes > self.aggregate_bytes:
                    raise ValueError("new index allowance exceeds the immutable namespace budget")
                self.db.execute("INSERT INTO reservations VALUES(?,?,?,?)", (index_hash, binding_bytes, reserved_bytes, _record_hash(binding_bytes, reserved_bytes)))
                self._write_totals()
            self.db.execute("COMMIT")
        except BaseException:
            if began:
                self._rollback()
            self.failed = True
            raise
        try:
            self._checkpoint()
        except BaseException:
            self.failed = True
            raise
        return {"indexHash": index_hash, "reservedBytes": reserved_bytes, "replayed": old is not None}
