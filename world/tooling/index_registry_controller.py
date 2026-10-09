"""Registry controller: retain leases, unknown state and charged attempts.
Settlement does not prove worker success or coverage.
"""
import hashlib
import fcntl
import os
from pathlib import Path
import shutil  # shared cleanup test hook
from contextlib import nullcontext

from index_controller_record import (FORMAT, FORMAT_V2, FORMAT_V3, encode_controller_record, decode_controller_record,
                                      start_attempt, snapshot_ready, finish_attempt, settlement, _has_initialized_result,
                                      verify_terminal_plan_header)
from index_controller_state import (RECORD, PENDING, EXECUTION, RECLAIM, REGISTRY, REGISTRY_PENDING, read_private, publish,
                                    footprint, anchor_registry, verify_registry_anchor, _mint_shard_handoff,
                                    shard_admission_summary)
from index_execution_snapshot import (CONFIGURATION, _capture, _inventory, VerifiedIndexExecution,
    _copy_snapshot, _snapshot, _cleanup)
from index_namespace import _aggregate, _root, _preflight, namespace_binding
from index_tooling import decode_tooling_manifest, verify_index_tooling, source_snapshot_allowance
from index_bootstrap import _node_pin
from index_registry_startup import _runtime, startup_index_namespace
from index_reservations import DATABASE_BYTES, REGISTRY_ALLOWANCE
from index_resource_limits import bounded_integer
from index_writer_lock import index_writer_lease
from index_root import _lease, prepare_index_shard_plan_authority
from index_admission_input import binding_pin, validate_admission_binding

MIB = 1024*1024


def restartable_registry_startup(namespace_root, aggregate_bytes, repository_root, manifest_bytes,
                                 manifest_pin, source_configuration, source_pin, python, python_runtime,
                                 *, cpu_seconds=10,wall_seconds=15,rss_limit_bytes=96*MIB,attempt_limit=16,
                                 _binding_bytes=None, _inherited_lease=None, _plan_input=None):
    """Run one charged attempt; restarts retain pins, snapshot and exhausted quota."""
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


def verify_terminal_shard_admission(namespace_root, aggregate_bytes, repository_root, manifest_bytes,
                                    manifest_pin, source_configuration, source_pin, python, python_runtime,
                                    *, cpu_seconds=10, wall_seconds=15, rss_limit_bytes=96*MIB,
                                    attempt_limit=16, _binding_bytes=None, _plan_input=None,
                                    _inherited_lease=None, _expected=None):
    """Verify a completed V3 plan under its actual lease without another attempt."""
    if (_inherited_lease is None or type(_binding_bytes) is not bytes
            or type(_plan_input) is not dict or set(_plan_input)!={"raw","pin"}
            or type(_expected) is not dict
            or set(_expected)!={"controllerRecordSha256","registryAnchorSha256","shardAdmission"}):
        raise ValueError("terminal shard verification requires its exact held lease and durable receipt")
    aggregate=_aggregate(aggregate_bytes); root,_=_root(namespace_root); repository=Path(repository_root)
    runtime=_runtime(python_runtime)
    bounded_integer(cpu_seconds,1,60,"CPU seconds"); bounded_integer(wall_seconds,1,60,"wall seconds")
    bounded_integer(rss_limit_bytes,64*MIB,512*MIB,"sampled RSS bytes")
    bounded_integer(attempt_limit,1,16,"attempt limit")
    raw=_plan_input["raw"]; plan_pin=dict(_plan_input["pin"])
    authority=prepare_index_shard_plan_authority(raw,plan_pin,_binding_bytes)
    if authority.aggregate_bytes!=aggregate: raise ValueError("terminal plan aggregate differs from the held namespace")
    _lease(_inherited_lease)
    if _inherited_lease.root!=root: raise ValueError("terminal verifier inherited a different namespace lease")
    probe=os.open(root/"writer.lock",os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        held=os.fstat(probe)
        if (held.st_dev,held.st_ino)!=( _inherited_lease.device,_inherited_lease.inode):
            raise ValueError("namespace lock inode changed before verification")
        try: fcntl.flock(probe,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: pass
        else:
            fcntl.flock(probe,fcntl.LOCK_UN)
            raise ValueError("caller does not hold the actual namespace flock")
    finally: os.close(probe)
    if any((root/name).exists() or (root/name).is_symlink()
           for name in (PENDING,EXECUTION,RECLAIM,REGISTRY_PENDING,"namespace.pending")):
        raise ValueError("terminal shard admission has unsettled controller state")
    record_raw=read_private(root/RECORD); record=decode_controller_record(record_raw)
    anchor=read_private(root/REGISTRY,4096); verify_registry_anchor(root)
    operation={"kind":"admit-plan","plan":dict(plan_pin),"baseBinding":binding_pin(_binding_bytes)}
    info=root.lstat(); lock=(root/"writer.lock").lstat()
    namespace={"device":info.st_dev,"inode":info.st_ino,"lockDevice":lock.st_dev,
        "lockInode":lock.st_ino,"aggregateBytes":aggregate}
    verify_terminal_plan_header(record,operation,runtime,manifest_pin,source_pin,
        {"cpuSeconds":cpu_seconds,"wallSeconds":wall_seconds,"rssBytes":rss_limit_bytes,
         "attempts":attempt_limit},namespace)
    summary=shard_admission_summary(root,authority)
    for key in ("controllerRecordSha256","registryAnchorSha256"):
        value=_expected[key]
        if type(value) is not str or len(value)!=64 or any(char not in "0123456789abcdef" for char in value):
            raise ValueError("terminal admission receipt has an invalid SHA-256 pin")
    if (hashlib.sha256(record_raw).hexdigest()!=_expected["controllerRecordSha256"]
            or hashlib.sha256(anchor).hexdigest()!=_expected["registryAnchorSha256"]
            or _expected["shardAdmission"]!=summary):
        raise ValueError("terminal admission receipt differs from durable controller/registry evidence")
    before=(record_raw,anchor,summary)
    from index_registry_startup import verify_index_shard_namespace
    result=verify_index_shard_namespace(root,aggregate,repository,manifest_bytes,manifest_pin,
        source_configuration,source_pin,python,runtime,cpu_seconds=cpu_seconds,wall_seconds=wall_seconds,
        rss_limit_bytes=rss_limit_bytes,_inherited_lease=_inherited_lease,
        _binding_bytes=_binding_bytes,_plan_input={"raw":raw,"pin":dict(plan_pin)})
    _lease(_inherited_lease)
    if (read_private(root/RECORD)!=before[0] or read_private(root/REGISTRY,4096)!=before[1]
            or shard_admission_summary(root,authority)!=before[2]):
        raise ValueError("terminal registry evidence changed during verification")
    report=result.get("registry"); guard=result.get("guard")
    if (type(report) is not dict or report.get("format")!="feature-index-registry-verify-plan-v1"
            or report.get("shardAdmission")!=summary or type(guard) is not dict
            or guard.get("returnCode")!=0 or guard.get("reason")!="exit"
            or guard.get("inheritedLease") is not True or guard.get("inheritedNamespaceLease") is not True):
        raise ValueError("fixed terminal verifier did not return its exact reaped proof")
    attempts=record["attempts"]
    record_sha=hashlib.sha256(record_raw).hexdigest()
    result["controller"]={"attempts":len(attempts),"attemptLimit":attempt_limit,
        "recordSha256":record_sha,"reopened":True,
        "scope":"Read-only verification of terminal plan reservations and child identities; no new admission."}
    result["_shardHandoff"]=_mint_shard_handoff(root,_inherited_lease,authority,summary,
        record_raw,anchor,operation)
    return result
