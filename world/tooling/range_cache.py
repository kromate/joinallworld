"""Bounded immutable cache for validated exact HTTP byte ranges.

The caller remains responsible for HTTP admission, fresh HEAD validation and
network accounting. This module stores only bodies whose response has already
passed those checks.
"""
from __future__ import annotations

from contextlib import contextmanager
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import threading
import time
from typing import Iterator
from urllib.parse import urlsplit
import weakref


class RangeCacheError(RuntimeError):
    """Unsafe or corrupt local range-cache state; callers must fail closed."""


class _RootState:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.flights: dict[tuple[object, ...], list[object]] = {}
        self.overflow_lock = threading.Lock()
        self.overflow_refs = 0


class ExactRangeCache:
    """An immutable, bounded cache rooted at ``root/acquisition-index``.

    `allowed_root` and `root` must be canonical absolute paths, with root equal
    to allowed_root or a descendant. The release-specific cache lives at
    `root/acquisition-index/<release>/ranges`.
    """

    _states_guard = threading.Lock()
    _states: weakref.WeakValueDictionary[str, _RootState] = weakref.WeakValueDictionary()
    _max_root_states = 64

    def __init__(self, root: Path, allowed_root: Path, release: str, *, max_bytes: int = 32_000_000,
                 max_entries: int = 256, max_entry_bytes: int = 8_000_000,
                 max_growth_bytes: int = 8_000_000, minimum_free_bytes: int = 32_000_000):
        self.allowed_root = Path(os.path.abspath(os.fspath(allowed_root)))
        self.root = Path(os.path.abspath(os.fspath(root)))
        if not Path(allowed_root).is_absolute() or self.root != Path(root) or self.allowed_root != Path(allowed_root):
            raise ValueError("range cache roots must be canonical absolute paths")
        try:
            common = Path(os.path.commonpath((self.allowed_root, self.root)))
        except ValueError as error:
            raise ValueError("range cache root is outside allowed_root") from error
        if common != self.allowed_root:
            raise ValueError("range cache root is outside allowed_root")
        if not isinstance(release, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", release):
            raise ValueError("range cache release is unsafe")
        for name, value, minimum in (("max_bytes", max_bytes, 1), ("max_entries", max_entries, 1),
                                     ("max_entry_bytes", max_entry_bytes, 1), ("max_growth_bytes", max_growth_bytes, 1),
                                     ("minimum_free_bytes", minimum_free_bytes, 0)):
            if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
                raise ValueError(f"range cache {name} is invalid")
        if max_bytes > 32_000_000 or max_entries > 256 or max_entry_bytes > 8_000_000 or max_growth_bytes > 8_000_000:
            raise ValueError("range cache limits may only shrink the frozen hard caps")
        if max_entry_bytes > max_bytes or max_growth_bytes > max_bytes:
            raise ValueError("range cache per-entry/growth cap exceeds aggregate cap")
        self.release = release
        self.max_bytes = max_bytes
        self.max_entries = max_entries
        self.max_entry_bytes = max_entry_bytes
        self.max_growth_bytes = max_growth_bytes
        self.minimum_free_bytes = minimum_free_bytes
        self.cache_root = self.root / "acquisition-index" / release / "ranges"
        self._written = 0
        self._state = self._shared_state(str(self.cache_root))
        self._check_ancestors(self.allowed_root, allow_missing=False)
        self._check_ancestors(self.root, allow_missing=True)

    @classmethod
    def _shared_state(cls, key: str) -> _RootState:
        with cls._states_guard:
            state = cls._states.get(key)
            if state is not None:
                return state
            if len(cls._states) >= cls._max_root_states:
                # Root states are weakly held. Refuse pathological live roots
                # instead of growing a process-wide lock table without bound.
                raise RangeCacheError("too many active range-cache roots")
            state = _RootState()
            cls._states[key] = state
            return state

    @property
    def written(self) -> int:
        with self._state.lock:
            return self._written

    @staticmethod
    def _check_ancestors(target: Path, *, allow_missing: bool) -> None:
        absolute = Path(os.path.abspath(target))
        current = Path(absolute.anchor)
        missing = False
        for part in absolute.parts[1:]:
            current = current / part
            try:
                info = os.lstat(current)
            except FileNotFoundError:
                if not allow_missing:
                    raise RangeCacheError(f"range cache path ancestor is missing: {current}")
                missing = True
                continue
            except OSError as error:
                raise RangeCacheError(f"cannot inspect range cache path: {current}") from error
            if missing:
                raise RangeCacheError(f"range cache path has an unexpected object after a missing ancestor: {current}")
            if stat.S_ISLNK(info.st_mode):
                raise RangeCacheError(f"range cache path contains a symlink: {current}")
            if current != absolute and not stat.S_ISDIR(info.st_mode):
                raise RangeCacheError(f"range cache ancestor is not a directory: {current}")
        if not allow_missing and not stat.S_ISDIR(os.lstat(absolute).st_mode):
            raise RangeCacheError(f"range cache root is not a directory: {absolute}")

    @staticmethod
    def _strong_etag(etag: str) -> bool:
        return isinstance(etag, str) and len(etag) <= 512 and re.fullmatch(r'"[\x21\x23-\x7e\x80-\xff]*"', etag) is not None

    def _identity(self, url: str, file_bytes: int, etag: str, first: int, last: int) -> dict[str, object]:
        if not isinstance(url, str) or not 1 <= len(url) <= 2048 or any(ord(ch) < 0x21 or ord(ch) == 0x7f for ch in url):
            raise ValueError("range cache URL is invalid")
        try:
            parsed = urlsplit(url)
        except ValueError as error:
            raise ValueError("range cache URL is invalid") from error
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or self.release not in parsed.path:
            raise ValueError("range cache URL is not an exact pinned HTTPS release URL")
        for name, value in (("file_bytes", file_bytes), ("first", first), ("last", last)):
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(f"range cache {name} must be an integer")
        if not 1 <= file_bytes <= 2_000_000_000 or not 0 <= first <= last < file_bytes:
            raise ValueError("range cache byte span is outside its pinned file")
        if last - first + 1 > self.max_entry_bytes:
            raise ValueError("range cache span exceeds per-entry byte cap")
        if not self._strong_etag(etag):
            raise ValueError("range cache requires a bounded strong ETag")
        return {"schemaVersion": 1, "release": self.release, "url": url, "fileBytes": file_bytes,
                "etag": etag, "first": first, "last": last}

    @staticmethod
    def _canonical(value: object) -> bytes:
        return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")

    def _entry_name(self, identity: dict[str, object]) -> str:
        return hashlib.sha256(self._canonical(identity).rstrip(b"\n")).hexdigest()

    def _ensure_cache_dir(self) -> None:
        self._check_ancestors(self.allowed_root, allow_missing=False)
        current = self.allowed_root
        for part in self.root.relative_to(self.allowed_root).parts:
            current = current / part
            try:
                os.mkdir(current, 0o700)
            except FileExistsError:
                pass
            self._check_ancestors(current, allow_missing=False)
        for part in ("acquisition-index", self.release, "ranges"):
            current = current / part
            try:
                os.mkdir(current, 0o700)
            except FileExistsError:
                pass
            self._check_ancestors(current, allow_missing=False)

    def _scan(self) -> tuple[int, int]:
        """Return byte/node counts, rejecting links, special files and overflow."""
        self._check_ancestors(self.cache_root, allow_missing=True)
        if not self.cache_root.exists():
            return 0, 0
        total = 0
        entry_count = 0
        node_count = 0
        try:
            with os.scandir(self.cache_root) as iterator:
                entries = []
                for entry in iterator:
                    entries.append(entry)
                    if len(entries) > self.max_entries:
                        raise RangeCacheError("range cache exceeds its bounded entry count")
            for entry in entries:
                entry_count += 1
                node_count += 1
                if entry_count > self.max_entries or node_count > self.max_entries * 3 + 8:
                    raise RangeCacheError("range cache exceeds its bounded entry count")
                info = entry.stat(follow_symlinks=False)
                if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                    raise RangeCacheError("range cache contains a symlink or non-directory entry")
                if not (re.fullmatch(r"[a-f0-9]{64}", entry.name) or entry.name.startswith(".range-")):
                    raise RangeCacheError("range cache contains an unexpected entry name")
                child_names: set[str] = set()
                with os.scandir(entry.path) as children_iter:
                    children = []
                    for child in children_iter:
                        children.append(child)
                        if len(children) > 2:
                            raise RangeCacheError("range cache entry contains too many files")
                for child in children:
                    node_count += 1
                    if node_count > self.max_entries * 3 + 8:
                        raise RangeCacheError("range cache exceeds its bounded node count")
                    if child.name not in ("body.bin", "metadata.json") or child.name in child_names:
                        raise RangeCacheError("range cache entry contains an unexpected file")
                    child_names.add(child.name)
                    child_info = child.stat(follow_symlinks=False)
                    if stat.S_ISLNK(child_info.st_mode) or not stat.S_ISREG(child_info.st_mode):
                        raise RangeCacheError("range cache contains a symlink or special file")
                    if child_info.st_size < 0:
                        raise RangeCacheError("range cache entry has an invalid size")
                    total += child_info.st_size
                    if total > self.max_bytes:
                        raise RangeCacheError("range cache exceeds its aggregate byte cap")
                if re.fullmatch(r"[a-f0-9]{64}", entry.name) and child_names not in ({"body.bin", "metadata.json"}, set()):
                    raise RangeCacheError("range cache entry is incomplete")
        except OSError as error:
            raise RangeCacheError("cannot enumerate range cache safely") from error
        return total, entry_count

    @staticmethod
    def _read_regular(path: Path, maximum: int) -> bytes:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags)
        try:
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_size < 0 or info.st_size > maximum:
                raise RangeCacheError("range cache file is not a bounded regular file")
            chunks: list[bytes] = []
            remaining = info.st_size
            while remaining:
                part = os.read(descriptor, min(64 * 1024, remaining))
                if not part:
                    raise RangeCacheError("range cache file changed during bounded read")
                chunks.append(part)
                remaining -= len(part)
            if os.read(descriptor, 1):
                raise RangeCacheError("range cache file grew during bounded read")
            return b"".join(chunks)
        finally:
            os.close(descriptor)

    def _load(self, identity: dict[str, object], name: str) -> bytes | None:
        self._check_ancestors(self.cache_root, allow_missing=True)
        directory = self.cache_root / name
        try:
            info = os.lstat(directory)
        except FileNotFoundError:
            return None
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise RangeCacheError("range cache entry path is not a real directory")
        self._check_ancestors(directory, allow_missing=False)
        metadata_path = directory / "metadata.json"
        body_path = directory / "body.bin"
        try:
            metadata_bytes = self._read_regular(metadata_path, 16_384)
            metadata = json.loads(metadata_bytes.decode("utf-8", errors="strict"))
            if not isinstance(metadata, dict) or set(metadata) != {"schemaVersion", "release", "url", "fileBytes", "etag", "first", "last", "bytes", "sha256", "status", "contentRange", "contentEncoding"}:
                raise RangeCacheError("range cache metadata has an unsupported shape")
            if metadata_bytes != self._canonical(metadata):
                raise RangeCacheError("range cache metadata is not canonical")
            expected = {**identity, "bytes": int(identity["last"]) - int(identity["first"]) + 1}
            if any(type(metadata.get(key)) is not type(value) or metadata.get(key) != value for key, value in expected.items()):
                raise RangeCacheError("range cache metadata identity does not match the requested span")
            if (type(metadata.get("status")) is not int or metadata["status"] != 206
                    or metadata.get("contentRange") != f"bytes {identity['first']}-{identity['last']}/{identity['fileBytes']}"
                    or metadata.get("contentEncoding") != "identity"):
                raise RangeCacheError("range cache response metadata is not an exact identity 206 span")
            if isinstance(metadata.get("sha256"), bool) or not isinstance(metadata.get("sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", metadata["sha256"]):
                raise RangeCacheError("range cache body hash is invalid")
            payload = self._read_regular(body_path, self.max_entry_bytes)
            if len(payload) != expected["bytes"] or hashlib.sha256(payload).hexdigest() != metadata["sha256"]:
                raise RangeCacheError("range cache body length or hash is corrupt")
            return payload
        except FileNotFoundError as error:
            raise RangeCacheError("range cache entry is incomplete") from error
        except (UnicodeDecodeError, json.JSONDecodeError, OSError, ValueError, TypeError) as error:
            if isinstance(error, RangeCacheError):
                raise
            raise RangeCacheError("range cache entry is corrupt") from error

    @contextmanager
    def flight(self, url: str, file_bytes: int, first: int, last: int) -> Iterator[None]:
        identity_key = (self.release, url, file_bytes, first, last)
        state = self._state
        with state.lock:
            record = state.flights.get(identity_key)
            if record is None:
                if len(state.flights) < self.max_entries:
                    record = [threading.Lock(), 0, False]
                    state.flights[identity_key] = record
                else:
                    state.overflow_refs += 1
                    record = [state.overflow_lock, state.overflow_refs, True]
            if not record[2]:
                record[1] = int(record[1]) + 1
            lock = record[0]
        acquired = False
        try:
            lock.acquire()
            acquired = True
            yield
        finally:
            if acquired:
                lock.release()
            with state.lock:
                if record[2]:
                    state.overflow_refs = max(0, state.overflow_refs - 1)
                else:
                    record[1] = int(record[1]) - 1
                    if record[1] == 0:
                        state.flights.pop(identity_key, None)

    def get(self, url: str, file_bytes: int, etag: str, first: int, last: int) -> bytes | None:
        identity = self._identity(url, file_bytes, etag, first, last)
        name = self._entry_name(identity)
        with self._state.lock:
            self._scan()
            return self._load(identity, name)

    def put(self, url: str, file_bytes: int, etag: str, first: int, last: int, payload: bytes) -> bool:
        identity = self._identity(url, file_bytes, etag, first, last)
        if not isinstance(payload, bytes) or len(payload) != int(last) - int(first) + 1 or len(payload) > self.max_entry_bytes:
            raise ValueError("range cache payload does not exactly match the requested span")
        name = self._entry_name(identity)
        metadata = self._canonical({**identity, "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(),
                                    "status": 206,
                                    "contentRange": f"bytes {first}-{last}/{file_bytes}",
                                    "contentEncoding": "identity"})
        growth = len(payload) + len(metadata)
        if growth > self.max_entry_bytes + 16_384:
            return False
        state = self._state
        with state.lock:
            current_bytes, entries = self._scan()
            existing = self._load(identity, name)
            if existing is not None:
                if existing != payload:
                    raise RangeCacheError("immutable range cache collision has different bytes")
                return False
            if entries >= self.max_entries or current_bytes + growth > self.max_bytes or self._written + growth > self.max_growth_bytes:
                return False
            self._check_ancestors(self.cache_root, allow_missing=True)
            free_root = self.cache_root
            while not free_root.exists():
                free_root = free_root.parent
            if shutil.disk_usage(free_root).free - growth < self.minimum_free_bytes:
                return False
            self._ensure_cache_dir()
            # Recheck all quotas after directory creation and immediately before
            # creating a temporary entry. Process-level acquisition locking
            # serializes other writers; the local state lock covers thread races.
            current_bytes, entries = self._scan()
            if entries >= self.max_entries or current_bytes + growth > self.max_bytes or self._written + growth > self.max_growth_bytes:
                return False
            if shutil.disk_usage(self.cache_root).free - growth < self.minimum_free_bytes:
                return False
            temp = self.cache_root / f".range-{os.getpid()}-{time.time_ns()}-{threading.get_ident()}"
            os.mkdir(temp, 0o700)
            body_path = temp / "body.bin"
            metadata_path = temp / "metadata.json"
            target = self.cache_root / name
            published = False
            try:
                self._write_new_file(body_path, payload)
                self._write_new_file(metadata_path, metadata)
                self._fsync_directory(temp)
                self._check_ancestors(self.cache_root, allow_missing=False)
                if target.exists():
                    raise RangeCacheError("immutable range cache entry appeared during publication")
                os.rename(temp, target)
                published = True
                self._fsync_directory(self.cache_root)
                self._written += growth
                return True
            except OSError as error:
                # Incomplete temporary directories are deliberately retained as
                # bounded evidence and counted by later scans.
                try:
                    evidence = target if published else temp
                    actual = sum(os.stat(child, follow_symlinks=False).st_size for child in evidence.iterdir()
                                 if child.is_file() and not child.is_symlink())
                    self._written += actual
                except OSError:
                    pass
                if error.errno in (errno.ENOSPC, getattr(errno, "EDQUOT", -1)) and not published:
                    return False
                raise
            except Exception:
                try:
                    evidence = target if published else temp
                    actual = sum(os.stat(child, follow_symlinks=False).st_size for child in evidence.iterdir()
                                 if child.is_file() and not child.is_symlink())
                    self._written += actual
                except OSError:
                    pass
                raise

    @staticmethod
    def _write_new_file(target: Path, payload: bytes) -> None:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(target, flags, 0o600)
        try:
            view = memoryview(payload)
            while view:
                written = os.write(descriptor, view)
                if written <= 0:
                    raise OSError("short write while publishing range cache entry")
                view = view[written:]
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    @staticmethod
    def _fsync_directory(directory: Path) -> None:
        descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
        try:
            os.fsync(descriptor)
        except OSError as error:
            if error.errno not in (errno.EINVAL, errno.ENOTSUP, errno.EBADF):
                raise
        finally:
            os.close(descriptor)
