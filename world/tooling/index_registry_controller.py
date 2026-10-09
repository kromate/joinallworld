"""Restartable fixed-registry controller, not a country/acquisition campaign.

Records and the sole fixed execution slot live inside the namespace allowance.
The fixed registry worker inherits its permanent lease. A new controller must
reacquire that lease before touching retained execution bytes; no PID signalling,
process-name guessing or unknown snapshot scavenging. A prepared attempt may have
launched before controller loss; it stays fully charged. Terminal digest binds
settlement of that attempt, not a successful SQL result or coverage claim.
"""
import hashlib
import os
from pathlib import Path
import shutil
import stat
from contextlib import nullcontext

from index_controller_record import (FORMAT, FORMAT_V2, FORMAT_V3, encode_controller_record, decode_controller_record,
                                      start_attempt, snapshot_ready, finish_attempt, settlement, _has_initialized_result)
from index_controller_state import (RECORD, PENDING, EXECUTION, RECLAIM, REGISTRY, REGISTRY_PENDING, read_private, publish,
                                    footprint, identity, anchor_registry, verify_registry_anchor, _mint_shard_handoff)
from index_execution_snapshot import CONFIGURATION, _capture, _inventory, VerifiedIndexExecution
from index_namespace import _aggregate, _root, _preflight, namespace_binding
from index_tooling import FILES, decode_tooling_manifest, verify_index_tooling, source_snapshot_allowance
from index_bootstrap import _node_pin
from index_registry_startup import _runtime, startup_index_namespace
from index_reservations import DATABASE_BYTES, REGISTRY_ALLOWANCE
from index_resource_limits import bounded_integer
from index_writer_lock import index_writer_lease
from index_root import _lease, prepare_index_shard_plan_authority
from index_admission_input import binding_pin, validate_admission_binding

MIB = 1024*1024


def _copy_snapshot(root, repository, manifest, configuration, source_pin):
    execution = root/EXECUTION
    try: execution.mkdir(mode=0o700)
    except FileExistsError: pass
    footprint(root)
    pins = {**manifest["files"], CONFIGURATION:source_pin}
    for name in (*FILES, CONFIGURATION):
        expected = _capture(repository, name, pins[name])
        file = execution/name; directory = execution
        for segment in name.split("/")[:-1]:
            directory = directory/segment
            try: directory.mkdir(mode=0o700)
            except FileExistsError: pass
            info = directory.lstat()
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                    or stat.S_IMODE(info.st_mode) != 0o700 or directory.resolve(strict=True) != directory):
                raise ValueError("unsafe persistent snapshot directory")
        try: old = read_private(file, pins[name]["bytes"], (0o400,0o600))
        except FileNotFoundError: old = b""
        if not expected.startswith(old): raise ValueError("contradictory snapshot prefix; preserve state")
        directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        descriptor = None
        try:
            try: descriptor = os.open(file.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,0o600,dir_fd=directory_fd)
            except FileExistsError:
                info = file.lstat()
                if stat.S_IMODE(info.st_mode)==0o400:
                    if old!=expected: raise ValueError("immutable snapshot file is incomplete")
                    continue
                descriptor = os.open(file.name,os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW,dir_fd=directory_fd)
                if identity(os.fstat(descriptor)) != identity(info): raise ValueError("snapshot inode changed")
            view = memoryview(expected)[len(old):]
            while view:
                written=os.write(descriptor,view)
                if written<1: raise OSError("short persistent snapshot write")
                view=view[written:]
            os.fchmod(descriptor,0o400); os.fsync(descriptor); os.fsync(directory_fd)
        finally:
            if descriptor is not None: os.close(descriptor)
            os.close(directory_fd)
    for directory in [execution/"world/tooling",execution/"world",execution,root]:
        descriptor=os.open(directory,os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(descriptor)
        finally: os.close(descriptor)
    return execution


def _snapshot(root, manifest_bytes, manifest_pin, configuration, source_pin):
    execution=root/EXECUTION
    verify_index_tooling(execution,manifest_bytes,manifest_pin)
    if _capture(execution,CONFIGURATION,source_pin)!=configuration: raise ValueError("retained snapshot configuration differs")
    charged=_inventory(execution)
    return VerifiedIndexExecution(execution,manifest_bytes,dict(manifest_pin),configuration,dict(source_pin),charged)


def _cleanup(root, record, manifest_bytes, manifest_pin, configuration, source_pin):
    execution=root/EXECUTION
    reclaim=root/RECLAIM
    try: info=execution.lstat()
    except FileNotFoundError:
        try: info=reclaim.lstat()
        except FileNotFoundError: return
    attempt=record["attempts"][-1]
    if (info.st_dev,info.st_ino)!=(attempt["snapshotDevice"],attempt["snapshotInode"]):
        raise ValueError("retained snapshot inode differs; preserve it")
    if execution.exists():
        if reclaim.exists() or reclaim.is_symlink(): raise ValueError("mixed execution/reclaim slots; preserve both")
        _snapshot(root,manifest_bytes,manifest_pin,configuration,source_pin)
        os.rename(execution,reclaim)
        descriptor=os.open(root,os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(descriptor)
        finally: os.close(descriptor)
    footprint(root)
    # A deletion interruption leaves a subset of the exact pinned files. Verify
    # every remaining byte before completing reclaim; never require deleted files
    # to reappear, and never delete foreign/symlink/changed survivors.
    pins={**decode_tooling_manifest(manifest_bytes,manifest_pin)["files"],CONFIGURATION:source_pin}
    for name,expected in pins.items():
        file=reclaim/name
        try: file.lstat()
        except FileNotFoundError: continue
        if stat.S_IMODE(file.lstat().st_mode)!=0o400:
            raise ValueError("reclaim survivor mode differs; preserve it")
        _capture(reclaim,name,expected)
    if (reclaim.lstat().st_dev,reclaim.lstat().st_ino)!=(info.st_dev,info.st_ino):
        raise ValueError("reclaim root changed; preserve it")
    shutil.rmtree(reclaim)  # Only the fixed, leased, verified subset of this owned slot.
    descriptor=os.open(root,os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


def restartable_registry_startup(namespace_root, aggregate_bytes, repository_root, manifest_bytes,
                                 manifest_pin, source_configuration, source_pin, python, python_runtime,
                                 *, cpu_seconds=10,wall_seconds=15,rss_limit_bytes=96*MIB,attempt_limit=16,
                                 _binding_bytes=None, _inherited_lease=None, _plan_input=None):
    """One charged startup attempt with conservative restart/reconciliation.

    This returns only a supervised registry report, never a live SQL writer. The
    same complete pins and limits are required on restart. Exhaustion is terminal
    admission failure, not an invitation to delete/reset the journal.
    """
    aggregate=_aggregate(aggregate_bytes); repository=Path(repository_root)
    runtime=_runtime(python_runtime)
    bounded_integer(cpu_seconds,1,60,"CPU seconds"); bounded_integer(wall_seconds,1,60,"wall seconds")
    bounded_integer(rss_limit_bytes,64*MIB,512*MIB,"sampled RSS bytes"); bounded_integer(attempt_limit,1,16,"attempt limit")
    verify_index_tooling(repository,manifest_bytes,manifest_pin)
    manifest=decode_tooling_manifest(manifest_bytes,manifest_pin)
    if _capture(repository,CONFIGURATION,source_pin)!=source_configuration:
        raise ValueError("persistent source configuration differs")
    operation = None
    if _binding_bytes is not None:
        validate_admission_binding(_binding_bytes, manifest_pin, source_pin, source_configuration)
        operation = {"kind":"admit", "binding":binding_pin(_binding_bytes)}
    authority = None
    if _plan_input is not None:
        if type(_plan_input) is not dict or set(_plan_input) != {"raw", "pin"} or _binding_bytes is None:
            raise ValueError("planned admission requires exact input and unchanged V1 base")
        raw, pin = _plan_input["raw"], _plan_input["pin"]
        authority = prepare_index_shard_plan_authority(raw, pin, _binding_bytes)
        if authority.aggregate_bytes != aggregate: raise ValueError("plan aggregate differs")
        _plan_input = {"raw": raw, "pin": dict(pin)}
        operation = {"kind": "admit-plan", "plan": dict(pin), "baseBinding": binding_pin(_binding_bytes)}
    executable_pin={"nodeBytes":runtime["pythonBytes"],"nodeSha256":runtime["pythonSha256"]}
    executable,before_runtime=_node_pin(python,executable_pin,label="Python")
    reserve=source_snapshot_allowance(manifest,len(source_configuration))+2*65536+2*8192
    if operation is not None: reserve += 8192
    if 4*DATABASE_BYTES+reserve>REGISTRY_ALLOWANCE:
        raise ValueError("persistent execution inputs cannot fit the immutable registry allowance")
    root,_=_root(namespace_root); expected=namespace_binding(aggregate,sqlite_version=runtime["sqliteVersion"])
    _preflight(root,expected,aggregate,controller_check=False,plan_authority=authority)
    if _inherited_lease is not None:
        _lease(_inherited_lease)
        if _inherited_lease.root != root: raise ValueError("controller inherited lease differs from its namespace")
    with (nullcontext(_inherited_lease) if _inherited_lease is not None else index_writer_lease(root)) as lease:
        _lease(lease); _preflight(root,expected,aggregate,controller_check=False,plan_authority=authority)
        verify_registry_anchor(root)
        had_anchor=any((root/name).exists() or (root/name).is_symlink() for name in [REGISTRY,REGISTRY_PENDING])
        if had_anchor and not (root/RECORD).exists():
            raise ValueError("initialized controller attempt record disappeared; preserve quota")
        info=root.lstat()
        header={"format":FORMAT_V3 if authority is not None else FORMAT_V2 if operation is not None else FORMAT,"namespace":{"device":info.st_dev,"inode":info.st_ino,
            "lockDevice":lease.device,"lockInode":lease.inode,"aggregateBytes":aggregate},
            "runtime":runtime,"toolingManifest":dict(manifest_pin),"sourceConfiguration":dict(source_pin),
            "limits":{"cpuSeconds":cpu_seconds,"wallSeconds":wall_seconds,"rssBytes":rss_limit_bytes,"attempts":attempt_limit},"attempts":[]}
        if authority is not None: header["operation"] = operation
        encode_controller_record(header)
        try: record=decode_controller_record(read_private(root/RECORD))
        except FileNotFoundError: record=None
        if record is not None and {k:v for k,v in record.items() if k!="attempts"}!={k:v for k,v in header.items() if k!="attempts"}:
            raise ValueError("controller binding changed; preserve attempts and snapshot")
        if record is not None and _has_initialized_result(record) and not had_anchor:
            raise ValueError("successful initialized registry witness disappeared; preserve state")
        if (root/"reservations.sqlite").exists():
            # Adoption of an already initialized namespace also anchors its inode
            # before any controller attempt can be recorded or retried.
            anchor_registry(root)
        recovered=0
        if record is None:
            if (root/EXECUTION).exists() or (root/RECLAIM).exists(): raise ValueError("unbound execution slot; preserve it")
            record=start_attempt(header,operation); publish(root,record)
        elif record["attempts"] and record["attempts"][-1]["snapshotDevice"] is not None:
            # The inherited lock, not stale PID data, proves the fixed lease holder
            # is gone. Preserve interrupted attempt charges, settle, then retry.
            if record["attempts"][-1]["phase"]!="terminal":
                reconciled=finish_attempt(record,settlement(record))
                # An interrupted successful terminal publication has its own
                # deterministic tag and requires the durable ledger witness.
                try: pending=read_private(root/PENDING)
                except FileNotFoundError: pending=None
                success=finish_attempt(record,settlement(record,initialized=True))
                if pending is not None and not encode_controller_record(reconciled).startswith(pending):
                    if not had_anchor or not encode_controller_record(success).startswith(pending):
                        raise ValueError("contradictory terminal controller prefix; preserve state")
                    reconciled=success
                record=reconciled; publish(root,record); recovered=1
            _cleanup(root,record,manifest_bytes,manifest_pin,source_configuration,source_pin)
            record=start_attempt(record,operation); publish(root,record)
        elif not record["attempts"]:
            record=start_attempt(record,operation); publish(root,record)
        elif operation is not None and record["attempts"][-1]["operation"] != operation:
            raise ValueError("unlaunched admission operation differs; preserve its bound input")
        execution=_copy_snapshot(root,repository,manifest,source_configuration,source_pin)
        snapshot=_snapshot(root,manifest_bytes,manifest_pin,source_configuration,source_pin)
        if 4*DATABASE_BYTES+footprint(root)+64000+65536+root.lstat().st_blocks*512>REGISTRY_ALLOWANCE:
            raise ValueError("actual persistent snapshot cannot fit immutable allowance")
        info=execution.lstat()
        record=snapshot_ready(record,info.st_dev,info.st_ino); publish(root,record)
        _,after_runtime=_node_pin(executable,executable_pin,label="Python")
        if before_runtime!=after_runtime: raise RuntimeError("Python runtime changed before persistent launch")
        result=startup_index_namespace(root,aggregate,repository,manifest_bytes,manifest_pin,
            source_configuration,source_pin,executable,runtime,cpu_seconds=cpu_seconds,wall_seconds=wall_seconds,
            rss_limit_bytes=rss_limit_bytes,_inherited_lease=lease,_execution=snapshot,_binding_bytes=_binding_bytes,_plan_input=_plan_input)
        _lease(lease)
        anchor_registry(root)
        record=finish_attempt(record,settlement(record,initialized=True)); publish(root,record)
        _cleanup(root,record,manifest_bytes,manifest_pin,source_configuration,source_pin)
        result["controller"]={"attempts":len(record["attempts"]),"attemptLimit":attempt_limit,
            "reservedWallSeconds":len(record["attempts"])*wall_seconds,"reconciledInterruptedAttempts":recovered,
            "recordSha256":hashlib.sha256(encode_controller_record(record)).hexdigest(),
            "scope":("Fixed registry admission only; no capture/campaign completion." if operation is not None else
                     "Fixed registry startup only; settlement digest is not worker success or country coverage.")}
        if authority is not None and _inherited_lease is not None:
            guard=result["guard"]
            if (guard.get("returnCode") != 0 or guard.get("reason") != "exit"
                    or guard.get("inheritedLease") is not True or guard.get("inheritedNamespaceLease") is not True
                    or record["attempts"][-1]["phase"] != "terminal"):
                raise ValueError("successful reaped batch and caller-held namespace lease are required")
            anchor=read_private(root/REGISTRY,4096)
            result["_shardHandoff"]=_mint_shard_handoff(
                root,lease,authority,result["registry"]["shardAdmission"],encode_controller_record(record),anchor,operation)
        return result
