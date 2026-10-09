"""Private, bounded controller files. No SQL, signalling or arbitrary paths.

Mutation requires the actual namespace lease. Deterministic pending prefixes can
resume; contradictory state is preserved. State and snapshot share the existing
17MiB registry allowance, including the conservative four database-file ceilings.
"""
import os
from pathlib import Path
import stat
import hashlib
import json
from index_controller_record import decode_controller_record, encode_controller_record
from index_tooling import FILES

RECORD = "controller.json"
PENDING = "controller.pending"
EXECUTION = "controller.execution"
RECLAIM = "controller.reclaim"
REGISTRY = "controller.registry.json"
REGISTRY_PENDING = "controller.registry.pending"
CONTROLS = frozenset({RECORD, PENDING, EXECUTION, RECLAIM, REGISTRY, REGISTRY_PENDING})
MAX_BYTES = 64000
SNAPSHOT_FILES = set(FILES) | {"world/acquisition-sources.json"}
DIRECTORIES = {"world", "world/tooling"}
MAX_CONTROL_BYTES = 1024*1024


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def read_private(path, maximum=MAX_BYTES, modes=(0o600,)):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) not in modes or not 0 <= info.st_size <= maximum
                or identity(path.lstat()) != identity(info)):
            raise ValueError("unsafe controller file; preserve it")
        raw = bytearray()
        while len(raw) <= maximum:
            chunk = os.read(descriptor, min(65536, maximum+1-len(raw)))
            if not chunk: break
            raw.extend(chunk)
        if (len(raw) != info.st_size or identity(os.fstat(descriptor)) != identity(info)
                or identity(path.lstat()) != identity(info)):
            raise ValueError("controller file changed; preserve it")
        return bytes(raw)
    finally: os.close(descriptor)


def footprint(root):
    """Bound every fixed entry, including partial copies; reject foreign paths."""
    charged = 0
    for name in [RECORD, PENDING, REGISTRY, REGISTRY_PENDING]:
        path = root/name
        try: info = path.lstat()
        except FileNotFoundError: continue
        read_private(path, 4096 if name in {REGISTRY,REGISTRY_PENDING} else MAX_BYTES)
        charged += max(info.st_size, info.st_blocks*512)
    count = 0
    def walk(directory, prefix=""):
        nonlocal charged, count
        info = directory.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o700 or directory.resolve(strict=True) != directory):
            raise ValueError("unsafe controller snapshot directory; preserve it")
        charged += info.st_blocks*512
        with os.scandir(directory) as entries:
            for entry in entries:
                count += 1
                if count > len(SNAPSHOT_FILES)+len(DIRECTORIES):
                    raise ValueError("controller snapshot entry limit exceeded")
                relative = prefix+entry.name
                if relative in DIRECTORIES:
                    walk(Path(entry.path), relative+"/")
                elif relative in SNAPSHOT_FILES:
                    info = entry.stat(follow_symlinks=False)
                    read_private(Path(entry.path), 1024*1024, (0o400, 0o600))
                    charged += max(info.st_size, info.st_blocks*512)
                else: raise ValueError("unknown controller snapshot entry; preserve it")
                if charged > MAX_CONTROL_BYTES: raise ValueError("controller physical allowance exceeded")
    for name in [EXECUTION, RECLAIM]:
        execution = root/name
        try: execution.lstat()
        except FileNotFoundError: continue
        walk(execution)
    if charged > MAX_CONTROL_BYTES: raise ValueError("controller physical allowance exceeded")
    return charged


def inspect_controller(root, aggregate, *, strict=True):
    charged = footprint(root)
    present = {name for name in CONTROLS if (root/name).exists() or (root/name).is_symlink()}
    if not present: return 0
    if not strict: return charged  # Parent filesystem classification only, never SQL.
    verify_registry_anchor(root)
    if RECORD not in present: raise ValueError("controller record must be reconciled before SQL")
    value = decode_controller_record(read_private(root/RECORD))
    actual = root.lstat(); lock = (root/"writer.lock").lstat()
    expected = {"device":actual.st_dev,"inode":actual.st_ino,"lockDevice":lock.st_dev,
                "lockInode":lock.st_ino,"aggregateBytes":aggregate}
    if value["namespace"] != expected: raise ValueError("controller namespace identity/budget differs")
    if PENDING in present: raise ValueError("staged controller record must be reconciled before SQL")
    if REGISTRY_PENDING in present: raise ValueError("staged registry witness must be reconciled before SQL")
    if RECLAIM in present: raise ValueError("interrupted snapshot reclaim must finish before SQL")
    if EXECUTION in present:
        if not value["attempts"]: raise ValueError("unbound controller execution snapshot")
        attempt = value["attempts"][-1]; info = (root/EXECUTION).lstat()
        if (attempt["snapshotDevice"],attempt["snapshotInode"]) != (info.st_dev,info.st_ino):
            raise ValueError("controller snapshot identity differs; preserve state")
    return charged


def publish(root, value):
    """Fsync a deterministic private pending prefix, rename, fsync namespace."""
    _publish_bytes(root,encode_controller_record(value),RECORD,PENDING,MAX_BYTES)


def _publish_bytes(root,raw,final_name,pending_name,maximum):
    pending = root/pending_name
    try: old = read_private(pending,maximum)
    except FileNotFoundError: old = b""
    if not raw.startswith(old): raise ValueError("contradictory staged controller record; preserve it")
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    descriptor = None
    try:
        try: descriptor = os.open(pending_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        except FileExistsError:
            descriptor = os.open(pending_name, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW, dir_fd=directory)
            if identity(os.fstat(descriptor)) != identity(pending.lstat()) or os.fstat(descriptor).st_size != len(old):
                raise ValueError("controller pending inode changed")
        view = memoryview(raw)[len(old):]
        while view:
            count = os.write(descriptor, view)
            if count < 1: raise OSError("short controller record write")
            view = view[count:]
        os.fsync(descriptor)
        os.rename(pending_name, final_name, src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
    finally:
        if descriptor is not None: os.close(descriptor)
        os.close(directory)


def _anchor_bytes(root):
    try:
        metadata=read_private(root/"namespace.json",4096)
        database=root/"reservations.sqlite"; info=database.lstat()
    except FileNotFoundError as error:
        raise ValueError("initialized registry metadata/database disappeared; preserve state") from error
    if (not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_nlink!=1
            or stat.S_IMODE(info.st_mode)!=0o600 or not 4096<=info.st_size<=4*1024*1024):
        raise ValueError("initialized registry witness requires its existing private database")
    value={"format":"feature-index-controller-registry-v1","databaseDevice":info.st_dev,
           "databaseInode":info.st_ino,"namespaceBindingSha256":hashlib.sha256(metadata).hexdigest()}
    return (json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=True)+"\n").encode("ascii")


def verify_registry_anchor(root):
    try: raw=read_private(root/REGISTRY,4096)
    except FileNotFoundError:
        # Even an incomplete witness was created only after a real registry was
        # present. Never interpret its later absence as a new empty namespace.
        if (root/REGISTRY_PENDING).exists() or (root/REGISTRY_PENDING).is_symlink():
            expected=_anchor_bytes(root)
            pending=read_private(root/REGISTRY_PENDING,4096)
            # A tiny prefix is not original-inode evidence. Preserve it rather
            # than anchoring a replacement which happens to share its device.
            identity_end=expected.index(b',"format":')
            if len(pending)<identity_end or not expected.startswith(pending):
                raise ValueError("staged registry witness differs; preserve state")
        return
    expected=_anchor_bytes(root)
    if raw!=expected: raise ValueError("initialized registry identity/metadata disappeared or changed; preserve state")


def _mint_shard_handoff(root, lease, authority, summary, record, anchor, operation):
    from index_root import _lease
    from index_controller_record import FORMAT_V3, decode_controller_record, settlement
    from index_writer_lock import (IndexShardHandoff, _SHARD_HANDOFF_SEAL,
        _register_shard_handoff, _verify_shard_handoff)
    root, info = _lease(lease); lock = (root/"writer.lock").lstat()
    if (type(record) is not bytes or type(anchor) is not bytes or type(summary) is not dict
            or type(operation) is not dict):
        raise TypeError("settled handoff evidence must be exact immutable inputs")
    decoded = decode_controller_record(record); recorded_operation = decoded.get("operation", {})
    namespace = decoded["namespace"]
    last = decoded["attempts"][-1] if decoded["attempts"] else {}
    prepared = decode_controller_record(record)
    if prepared["attempts"]:
        attempt = prepared["attempts"][-1]
        attempt.update(phase="prepared", workerPid=None, resultSha256=None)
    if (decoded["format"] != FORMAT_V3 or not decoded["attempts"]
            or decoded["attempts"][-1]["phase"] != "terminal"
            or last.get("resultSha256") != settlement(prepared, initialized=True)
            or operation != recorded_operation or operation.get("kind") != "admit-plan"
            or operation["plan"]["sha256"] != authority.plan_hash
            or operation["baseBinding"]["sha256"] != authority.base_hash
            or last.get("operation") != operation
            or (namespace["device"], namespace["inode"], namespace["lockDevice"], namespace["lockInode"])
                != (info.st_dev, info.st_ino, lease.device, lease.inode)
            or namespace["aggregateBytes"] != authority.aggregate_bytes):
        raise ValueError("handoff is not bound to the settled exact namespace plan")
    verify_registry_anchor(root)
    if any((root/name).exists() or (root/name).is_symlink()
           for name in (PENDING, RECLAIM, EXECUTION, REGISTRY_PENDING, "namespace.pending")):
        raise ValueError("controller settlement is not final")
    if read_private(root/RECORD) != record or read_private(root/REGISTRY, 4096) != anchor:
        raise ValueError("durable controller record or registry anchor changed before handoff")
    from index_admission_worker import shard_admission_summary
    expected_summary = shard_admission_summary(root, authority)
    packed = json.dumps(summary, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    if packed != json.dumps(expected_summary, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii"):
        raise ValueError("complete plan roots differ from the worker report")
    value = IndexShardHandoff(root, (info.st_dev, info.st_ino, lock.st_dev, lock.st_ino),
        lease, authority, packed, hashlib.sha256(record).hexdigest(),
        hashlib.sha256(anchor).hexdigest(), _SHARD_HANDOFF_SEAL)
    value = _register_shard_handoff(value)
    _verify_shard_handoff(value, lease, authority)
    return value


def verify_shard_handoff(handoff, lease, authority):
    if lease is not handoff.namespace_lease or authority is not handoff.authority:
        raise TypeError("shard handoff lost its caller lease or exact plan authority")
    raw = read_private(handoff.root/RECORD); anchor = read_private(handoff.root/REGISTRY, 4096)
    verify_registry_anchor(handoff.root)
    if (hashlib.sha256(raw).hexdigest() != handoff.record_sha256
            or hashlib.sha256(anchor).hexdigest() != handoff.anchor_sha256
            or any((handoff.root/name).exists() or (handoff.root/name).is_symlink()
                   for name in (PENDING, RECLAIM, EXECUTION, REGISTRY_PENDING, "namespace.pending"))):
        raise ValueError("settled controller record or registry anchor changed")
    from index_admission_worker import shard_admission_summary
    packed = json.dumps(shard_admission_summary(handoff.root, authority), sort_keys=True,
                        separators=(",", ":"), ensure_ascii=True).encode("ascii")
    if packed != handoff.summary: raise ValueError("complete shard root/lock identity set changed")
    return handoff.root


def anchor_registry(root):
    """Anchor existing final ledger before adoption or returning startup success."""
    verify_registry_anchor(root)
    expected=_anchor_bytes(root)
    if (root/REGISTRY).exists(): return
    _publish_bytes(root,expected,REGISTRY,REGISTRY_PENDING,4096)
