#!/usr/bin/env python3
"""Explicit offline, versioned correction for the reviewed Dar/Gaborone/Mogadishu extents."""
import argparse
from contextlib import nullcontext
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import signal
import time
import threading
from types import ModuleType
from contextlib import redirect_stdout
import io

ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "scripts/world/build-africa-starters.py"
REVISION_ROOT = ROOT / ".cache/world-build/africa-starter-revisions"
ALLOWED = {"TZ": "dar", "BW": "gaborone", "SO": "mogadishu"}
ASSET_NAMES = ("facts.ts", "geometry.ts", "index.ts", "content.ts", "map.ts")
MAX_OSM_BYTES = 8 * 1024 * 1024
MAX_RECEIPT_BYTES = 256 * 1024
MAX_LEDGER_BYTES = 64 * 1024
MAX_INTENT_BYTES = 512 * 1024
MAX_OPERATION_SECONDS = 180
MAX_ASSET_BYTES = 8 * 1024 * 1024
MAX_TOTAL_ASSET_BYTES = 24 * 1024 * 1024
MAX_OUTLINE_PARTS = 4
MAX_TOTAL_OUTLINE_BYTES = 8 * 1024 * 1024
MAX_ARCHIVE_BYTES = 3 * MAX_TOTAL_ASSET_BYTES + 3 * MAX_RECEIPT_BYTES + MAX_INTENT_BYTES + 16 * 1024
GENERATOR_SOURCE_BYTES = GENERATOR.read_bytes()
GENERATOR_SOURCE_SHA256 = hashlib.sha256(GENERATOR_SOURCE_BYTES).hexdigest()


def load_generator():
    module = ModuleType("africa_starter_revision_compiler")
    module.__file__ = str(GENERATOR)
    exec(compile(GENERATOR_SOURCE_BYTES, str(GENERATOR), "exec"), module.__dict__)
    return module


GEN = load_generator()
PUB = ModuleType("africa_starter_revision_publication")
PUB.__file__ = str(ROOT / "world/tooling/atomic_starter_publication.py")
exec(compile(Path(PUB.__file__).read_bytes(), PUB.__file__, "exec"), PUB.__dict__)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def safe_read(path, limit, label):
    path = Path(path)
    if path.is_absolute():
        try:
            path.relative_to(ROOT)
        except ValueError:
            raise ValueError(f"{label} must remain beneath the repository root")
        check_path_chain(path.parent)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
    except OSError as error:
        raise ValueError(f"Cannot safely read {label}: {error}") from error
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise ValueError(f"{label} must be a bounded regular file")
        chunks, size = [], 0
        while True:
            chunk = os.read(fd, min(65536, limit + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > limit:
                raise ValueError(f"{label} exceeds its byte limit")
        return b"".join(chunks)
    finally:
        os.close(fd)


def check_path_chain(path, *, private=False, create=False):
    path = Path(path)
    try:
        relative = path.relative_to(ROOT)
    except ValueError as error:
        raise ValueError("Revision path escapes the repository") from error
    current = ROOT
    for part in relative.parts:
        current = current / part
        if not os.path.lexists(current):
            if not create:
                raise ValueError(f"Required revision path is missing: {current}")
            current.mkdir(mode=0o700 if private else 0o755)
        info = current.lstat()
        if not stat.S_ISDIR(info.st_mode) or current.resolve() != current:
            raise ValueError(f"Revision path has a symlink or non-directory parent: {current}")
        private_root = ROOT / ".cache/world-build/africa-starter-revisions"
        owned_private = current == private_root or private_root in current.parents
        if private and owned_private and (info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077):
            raise ValueError(f"Revision staging directory must be current-user-owned and private: {current}")
    return path


def write_prefix(path, expected, limit, *, mode=0o644):
    path = Path(path)
    if len(expected) > limit:
        raise ValueError(f"Revision file exceeds {limit}-byte limit: {path.name}")
    try:
        prior = path.lstat()
    except FileNotFoundError:
        prior = None
    if prior is None:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        prefix = b""
    else:
        if not stat.S_ISREG(prior.st_mode) or prior.st_uid != os.geteuid():
            raise ValueError(f"Revision file is not an owned regular file: {path.name}")
        prefix = safe_read(path, limit, path.name)
        if len(prefix) > len(expected) or not expected.startswith(prefix):
            raise ValueError(f"Revision file is outside the expected owned prefix: {path.name}")
        fd = os.open(path, os.O_WRONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
    try:
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode) or opened.st_size != len(prefix):
            raise ValueError(f"Revision file changed during write: {path.name}")
        if prior is not None and (opened.st_dev != prior.st_dev or opened.st_ino != prior.st_ino):
            raise ValueError(f"Revision file inode changed: {path.name}")
        if prefix != expected:
            os.lseek(fd, len(prefix), os.SEEK_SET)
            view = memoryview(expected[len(prefix):])
            while view:
                size = os.write(fd, view)
                if size <= 0:
                    raise OSError("short revision write")
                view = view[size:]
        os.fsync(fd)
    finally:
        os.close(fd)
    parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(parent_fd)
    finally:
        os.close(parent_fd)


def ensure_empty_or_expected(path, expected_names):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError(f"Revision staging directory ownership or mode changed: {path}")
    names = {entry.name for entry in path.iterdir()}
    if not names.issubset(expected_names):
        raise ValueError(f"Revision staging directory contains unknown files: {path}")


def pin_map(files):
    return {name: {"bytes": len(raw), "sha256": sha(raw)} for name, raw in sorted(files.items())}


def verify_receipt_asset_pins(receipt, files):
    expected = receipt.get("assets")
    if not isinstance(expected, dict) or set(expected) != set(ASSET_NAMES):
        raise ValueError("Archived receipt does not pin the exact five starter assets")
    if {name: {"bytes": len(raw), "sha256": sha(raw)} for name, raw in files.items()} != expected:
        raise ValueError("Archived prior assets do not match their original receipt")


def validate_asset_set(files):
    if set(files) != set(ASSET_NAMES) or any(len(raw) > MAX_ASSET_BYTES for raw in files.values()):
        raise ValueError("Starter asset set is incomplete or exceeds its per-file byte cap")
    if sum(len(raw) for raw in files.values()) > MAX_TOTAL_ASSET_BYTES:
        raise ValueError("Starter asset set exceeds its fixed total byte cap")
    return files


def read_city(city_path, receipt_path):
    check_path_chain(city_path)
    info = city_path.lstat()
    if not stat.S_ISDIR(info.st_mode):
        raise ValueError("Published city path must be a real directory")
    names = {entry.name for entry in city_path.iterdir()}
    if names != set(ASSET_NAMES):
        raise ValueError("Published city must contain exactly the five starter assets")
    files = {name: safe_read(city_path / name, 8 * 1024 * 1024, f"{city_path.name}/{name}") for name in ASSET_NAMES}
    validate_asset_set(files)
    receipt = safe_read(receipt_path, MAX_RECEIPT_BYTES, f"{city_path.name} receipt")
    return files, receipt


def request_inputs(city, centre, old_receipt):
    cache = ROOT / ".cache/world-build/playable-africa" / city
    check_path_chain(cache)
    raw = safe_read(cache / "source.osm", MAX_OSM_BYTES, f"{city} cached OSM")
    source_raw = safe_read(cache / "source.json", MAX_RECEIPT_BYTES, f"{city} OSM receipt")
    ledger_raw = safe_read(cache / "requests.json", MAX_LEDGER_BYTES, f"{city} request ledger")
    source = json.loads(source_raw)
    ledger = json.loads(ledger_raw)
    lon, lat = centre
    bbox = [round(lon - .003, 6), round(lat - .003, 6), round(lon + .003, 6), round(lat + .003, 6)]
    url = "https://api.openstreetmap.org/api/0.6/map?bbox=" + ",".join(map(str, bbox))
    raw_hash = sha(raw)
    if (not isinstance(source, dict) or source.get("url") != url or source.get("bounds") != bbox
            or source.get("bytes") != len(raw) or source.get("sha256") != raw_hash
            or source != old_receipt.get("sources", {}).get("osm")):
        raise ValueError(f"{city} cached OSM source does not exactly match its existing receipt")
    if not isinstance(ledger, list) or len(ledger) != 1:
        raise ValueError(f"{city} request ledger is malformed or does not match its original one-request intent")
    request_intent = {"url": url, "reservedBytes": MAX_OSM_BYTES, "status": "complete",
                      "receivedBytes": len(raw), "sha256": raw_hash}
    if ledger[0] != request_intent:
        raise ValueError(f"{city} request ledger and cached source disagree")
    pins = {"sourceOsm": sha(raw), "sourceReceipt": sha(source_raw), "requestLedger": sha(ledger_raw)}
    return raw, source, pins


def compile_target(country, source_raw, source_info):
    city = ALLOWED[country]
    captured = {}
    original = {name: getattr(GEN, name) for name in ("OUTPUT", "RECEIPTS", "acquire", "publish_city", "publication_lease")}
    try:
        with tempfile.TemporaryDirectory(prefix="africa-starter-revision-") as temporary:
            temporary = Path(temporary)
            GEN.OUTPUT = temporary / "cities"
            GEN.RECEIPTS = temporary / "receipts"
            GEN.OUTPUT.mkdir()
            GEN.RECEIPTS.mkdir()
            def offline_acquire(identifier, centre):
                if identifier != city:
                    raise ValueError("Revision compiler requested an unselected city")
                return source_raw, source_info
            def capture(root, city_relative, receipt_relative, stage_relative, files, receipt_bytes, identity, source_identity, **_kwargs):
                if (city_relative != f"src/game/cities/{city}" or receipt_relative != f"world/playable-africa-rollout/receipts/{city}.json"
                        or identity.get("countryIso2") != country or identity.get("cityId") != city):
                    raise ValueError("Compiler publication identity differs from the explicit revision selection")
                captured.update(files={name: value.encode("utf-8") for name, value in files.items()},
                                receipt=bytes(receipt_bytes), identity=identity, sourceIdentity=source_identity)
            GEN.acquire = offline_acquire
            GEN.publish_city = capture
            GEN.publication_lease = lambda _root, _stage: nullcontext()
            with patch_argv(["build-africa-starters.py", "--country", country]), redirect_stdout(io.StringIO()):
                GEN.main()
        if not captured:
            raise ValueError("Existing generator did not produce a revision payload")
        if set(captured["files"]) != set(ASSET_NAMES):
            raise ValueError("Existing generator produced an unexpected asset set")
        if sum(len(raw) for raw in captured["files"].values()) > 24 * 1024 * 1024:
            raise ValueError("Revised assets exceed the existing bounded publication total")
        validate_asset_set(captured["files"])
        return captured
    finally:
        for name, value in original.items():
            setattr(GEN, name, value)


class patch_argv:
    def __init__(self, argv):
        self.argv = argv
    def __enter__(self):
        self.original = sys.argv
        sys.argv = list(self.argv)
    def __exit__(self, *_args):
        sys.argv = self.original


def revision_identity(country, city, before_files, before_receipt, after, source_pins):
    identity = {"countryIso2": country, "cityId": city}
    before = {"assets": pin_map(before_files), "receipt": {"bytes": len(before_receipt), "sha256": sha(before_receipt)}}
    after_pins = {"assets": pin_map(after["files"]), "receipt": {"bytes": len(after["receipt"]), "sha256": sha(after["receipt"])} }
    core = {"schemaVersion": 1, "identity": identity, "before": before, "after": after_pins, "sourcePins": source_pins}
    revision_id = sha(canonical(core))
    return revision_id, {**core, "revisionId": revision_id}


def read_snapshot(stage, directory, receipt_name):
    asset_dir = stage / directory
    ensure_empty_or_expected(asset_dir, set(ASSET_NAMES) | {"receipt.json"})
    assets = validate_asset_set({name: safe_read(asset_dir / name, MAX_ASSET_BYTES, name) for name in ASSET_NAMES})
    if receipt_name != "receipt.json":
        raise ValueError("Unexpected archived receipt path")
    receipt = safe_read(asset_dir / receipt_name, MAX_RECEIPT_BYTES, receipt_name)
    return assets, receipt


def stage_revision(stage, intent, before_files, before_receipt, after_files, after_receipt):
    validate_asset_set(before_files)
    validate_asset_set(after_files)
    # The moved original city and receipt remain archived alongside the immutable
    # pre-publication copy, so account for their duplicate bytes too.
    archive_bytes = (sum(len(raw) for raw in (*before_files.values(), *after_files.values()))
                     + sum(len(raw) for raw in before_files.values())
                     + 2 * len(before_receipt) + len(after_receipt))
    if (any(len(raw) > MAX_ASSET_BYTES for raw in (*before_files.values(), *after_files.values()))
            or len(before_receipt) > MAX_RECEIPT_BYTES or len(after_receipt) > MAX_RECEIPT_BYTES
            or archive_bytes > MAX_ARCHIVE_BYTES):
        raise ValueError("Versioned revision archive exceeds its fixed byte budget")
    stage = check_path_chain(stage, private=True, create=True)
    allowed = {"intent.json", "before", "next", "archive-ready.json", "before-city", "before-receipt.json", "after-receipt.json", "complete.json"}
    ensure_empty_or_expected(stage, allowed)
    intent_raw = canonical(intent) + b"\n"
    write_prefix(stage / "intent.json", intent_raw, MAX_INTENT_BYTES, mode=0o600)
    before_assets = stage / "before"
    next_assets = stage / "next"
    check_path_chain(before_assets, private=True, create=True)
    check_path_chain(next_assets, private=True, create=True)
    ensure_empty_or_expected(before_assets, set(ASSET_NAMES) | {"receipt.json"})
    ensure_empty_or_expected(next_assets, set(ASSET_NAMES))
    for name, raw in before_files.items():
        write_prefix(before_assets / name, raw, MAX_ASSET_BYTES)
    write_prefix(before_assets / "receipt.json", before_receipt, MAX_RECEIPT_BYTES)
    for name, raw in after_files.items():
        write_prefix(next_assets / name, raw, MAX_ASSET_BYTES)
    write_prefix(stage / "after-receipt.json", after_receipt, MAX_RECEIPT_BYTES)
    ready = canonical({"schemaVersion": 1, "revisionId": intent["revisionId"], "intentSha256": sha(intent_raw)}) + b"\n"
    write_prefix(stage / "archive-ready.json", ready, 4096, mode=0o600)


def check_asset_directory(path, expected):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode):
        raise ValueError(f"Revision city directory is not a real directory: {path}")
    if {item.name for item in path.iterdir()} != set(expected):
        raise ValueError("Revision city has unknown or missing assets")
    actual = validate_asset_set({name: safe_read(path / name, MAX_ASSET_BYTES, name) for name in expected})
    if actual != expected:
        raise ValueError("Revision city bytes differ from before/after pins")


def check_receipt(path, expected):
    try:
        raw = safe_read(path, MAX_RECEIPT_BYTES, "revision receipt")
    except OSError:
        return False
    return raw == expected


def verify_stage_revision(stage, intent, before_files, before_receipt, after_files, after_receipt, city_path):
    stage_names = {entry.name for entry in stage.iterdir()}
    allowed = {"intent.json", "before", "next", "archive-ready.json", "before-city", "before-receipt.json", "after-receipt.json", "complete.json"}
    if not stage_names.issubset(allowed):
        raise ValueError("Revision archive contains unknown entries")
    intent_raw = canonical(intent) + b"\n"
    if safe_read(stage / "intent.json", MAX_INTENT_BYTES, "revision intent") != intent_raw:
        raise ValueError("Revision archive intent differs from recomputed pins")
    ready = canonical({"schemaVersion": 1, "revisionId": intent["revisionId"], "intentSha256": sha(intent_raw)}) + b"\n"
    if not check_receipt(stage / "archive-ready.json", ready):
        raise ValueError("Revision archive readiness marker is missing or changed")
    archived_files, archived_receipt = read_snapshot(stage, "before", "receipt.json")
    if archived_files != before_files or archived_receipt != before_receipt:
        raise ValueError("Immutable initial revision archive differs from its source pins")
    if safe_read(stage / "after-receipt.json", MAX_RECEIPT_BYTES, "after receipt") != after_receipt:
        raise ValueError("Staged revised receipt differs from its source pins")
    if os.path.lexists(stage / "next"):
        check_asset_directory(stage / "next", after_files)
    elif not os.path.lexists(city_path):
        raise ValueError("Revision archive has no staged next city and no published city")
    else:
        check_asset_directory(city_path, after_files)
    if os.path.lexists(stage / "before-city"):
        check_asset_directory(stage / "before-city", before_files)
    if os.path.lexists(stage / "before-receipt.json") and not check_receipt(stage / "before-receipt.json", before_receipt):
        raise ValueError("Archived prior receipt differs from its original pin")


def publish_revision(stage, city_path, receipt_path, before_files, before_receipt, after_files, after_receipt):
    next_dir = stage / "next"
    archived_city = stage / "before-city"
    archived_receipt = stage / "before-receipt.json"
    if not (stage / "archive-ready.json").is_file():
        raise ValueError("Prior payload archive is not durable; no output was changed")
    stage_device = os.stat(stage).st_dev
    if stage_device != os.stat(city_path.parent).st_dev or stage_device != os.stat(receipt_path.parent).st_dev:
        raise ValueError("Revision archive, city and receipt must share a filesystem for atomic renames")
    for path in (stage / "archive-ready.json", stage / "intent.json"):
        safe_read(path, 4096 if path.name.startswith("archive") else MAX_INTENT_BYTES, path.name)

    def city_state():
        if not os.path.lexists(city_path): return "missing"
        for label, payload in (("before", before_files), ("after", after_files)):
            try:
                check_asset_directory(city_path, payload)
                return label
            except ValueError:
                continue
        raise ValueError("Current city output is neither the pinned prior nor exact revised payload")

    state = city_state()
    # Validate the receipt before the first live-city rename. A newer receipt must
    # stop the operation while the original city is still in place.
    receipt_exists = os.path.lexists(receipt_path)
    archived_receipt_exists = os.path.lexists(archived_receipt)
    if receipt_exists:
        if check_receipt(receipt_path, before_receipt):
            receipt_state = "before"
            if archived_receipt_exists:
                raise ValueError("Prior receipt exists both live and in the revision archive")
        elif check_receipt(receipt_path, after_receipt):
            receipt_state = "after"
            if state != "after" or not archived_receipt_exists or not check_receipt(archived_receipt, before_receipt):
                raise ValueError("Newer receipt is present without its exact published city and archived prior receipt")
        else:
            raise ValueError("Current receipt is neither the pinned prior nor exact revised receipt")
    elif archived_receipt_exists:
        if not check_receipt(archived_receipt, before_receipt):
            raise ValueError("Archived prior receipt differs from its original pin")
        if state != "after":
            raise ValueError("Receipt moved before the replacement city was fully published")
        receipt_state = "archived"
    else:
        raise ValueError("Receipt is missing without this revision's archived prior receipt")

    if os.path.lexists(archived_city):
        check_asset_directory(archived_city, before_files)
    elif state == "after" or state == "missing":
        raise ValueError("Published revision has no exact archived prior city directory")
    if state == "before":
        if os.path.lexists(archived_city):
            raise ValueError("Archive already contains an unexpected prior city directory")
        os.rename(city_path, archived_city)
        fsync_dir(city_path.parent)
        fsync_dir(stage)
    elif state == "missing":
        if not os.path.lexists(archived_city):
            raise ValueError("City output is missing without this revision's archived prior directory")
        check_asset_directory(archived_city, before_files)
    if city_state() == "missing":
        check_asset_directory(next_dir, after_files)
        if os.stat(next_dir).st_dev != os.stat(city_path.parent).st_dev:
            raise ValueError("Revision stage and city output are on different filesystems")
        os.rename(next_dir, city_path)
        fsync_dir(city_path.parent)
        fsync_dir(stage)
    elif city_state() == "after":
        pass
    else:
        raise ValueError("City output did not reach the expected revised state")

    if receipt_state == "before":
        os.rename(receipt_path, archived_receipt)
        fsync_dir(receipt_path.parent)
        fsync_dir(stage)
    if os.path.lexists(archived_receipt) and not check_receipt(archived_receipt, before_receipt):
        raise ValueError("Archived prior receipt differs from its original pin")
    if not os.path.lexists(receipt_path):
        staged_receipt = stage / "after-receipt.json"
        if check_receipt(staged_receipt, after_receipt) is False:
            raise ValueError("Staged revised receipt is missing or changed")
        os.link(staged_receipt, receipt_path, follow_symlinks=False)
        fsync_dir(receipt_path.parent)
    if not check_receipt(receipt_path, after_receipt):
        raise ValueError("Published revised receipt does not match its archive pin")
    check_asset_directory(city_path, after_files)
    complete = canonical({"schemaVersion": 1, "revisionId": stage.name, "status": "complete"}) + b"\n"
    write_prefix(stage / "complete.json", complete, 4096, mode=0o600)
    return "complete"


def fsync_dir(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


def verify_source_inputs(country, old_receipt):
    data = GEN.inventory(verify_cached_sources=True)
    rows = {row["iso2"]: row for row in data.get("countries", [])}
    row = rows.get(country)
    if not isinstance(row, dict) or row.get("gaps"):
        raise ValueError(f"{country} has missing inventory or unresolved source gaps")
    place, timezone, airport = GEN.validate_row(row, verify_cached_sources=True)
    identity = GEN.generation_identity(row)
    city = ALLOWED[country]
    if identity["cityId"] != city:
        raise ValueError("Reviewed country-to-city identity has changed")
    inventory_raw = safe_read(GEN.DATA / "inventory.json", GEN.MAX_SELECTION_BYTES, "pinned inventory")
    if old_receipt.get("inventorySha256") != sha(inventory_raw):
        raise ValueError("Existing receipt does not bind the current pinned inventory")
    osm_raw, source_info, cache_pins = request_inputs(city, place["coordinatesWgs84"], old_receipt)
    point_raw = safe_read(ROOT / place["pointAssetPath"], GEN.MAX_POINT_BYTES, "selected place point")
    if sha(point_raw) != place["pointAssetSha256"]:
        raise ValueError("Selected place point differs from its pinned source")
    outline_pins = {}
    outline_parts = row["admin0Geometry"].get("outlineParts", [])
    if not isinstance(outline_parts, list) or not 1 <= len(outline_parts) <= MAX_OUTLINE_PARTS:
        raise ValueError("Pinned country outline exceeds its fixed part-count bound")
    outline_total = 0
    for part in outline_parts:
        raw = safe_read(ROOT / part["path"], 2 * 1024 * 1024, "pinned Natural Earth outline")
        outline_total += len(raw)
        if outline_total > MAX_TOTAL_OUTLINE_BYTES:
            raise ValueError("Pinned country outlines exceed their fixed total byte bound")
        if sha(raw) != part["sha256"]:
            raise ValueError("Pinned Natural Earth outline changed")
        outline_pins[part["path"]] = part["sha256"]
    current_generator_hash = sha(safe_read(GENERATOR, 2 * 1024 * 1024, "generator source"))
    if current_generator_hash != GENERATOR_SOURCE_SHA256:
        raise ValueError("Generator source changed after this revision process loaded it")
    source_pins = {"inventorySha256": sha(inventory_raw), "osm": cache_pins,
                   "pointSha256": sha(point_raw), "outlines": outline_pins,
                   "generatorSha256": current_generator_hash,
                   "revisionToolSha256": sha(safe_read(Path(__file__), 2 * 1024 * 1024, "revision tool source"))}
    return row, place, timezone, airport, identity, osm_raw, source_info, source_pins


def capture_compile(country, raw, source_info):
    return compile_target(country, raw, source_info)


def _do_country(country, mode, revision_id=None):
    if country not in ALLOWED:
        raise ValueError("Only TZ, BW or SO may be revised by this explicit correction tool")
    city = ALLOWED[country]
    city_path = ROOT / "src/game/cities" / city
    receipt_path = ROOT / "world/playable-africa-rollout/receipts" / f"{city}.json"
    lease_relative = f".cache/world-build/africa-starter-publication/{city}"
    with PUB.publication_lease(ROOT, lease_relative):
        stage = REVISION_ROOT / city / (revision_id or "pending")
        if mode == "resume":
            check_path_chain(stage, private=True)
            intent_raw = safe_read(stage / "intent.json", MAX_INTENT_BYTES, "revision intent")
            intent = json.loads(intent_raw)
            if intent.get("schemaVersion") != 1 or intent.get("revisionId") != revision_id:
                raise ValueError("Revision archive identity does not match the requested revision ID")
            before_files, before_receipt = read_snapshot(stage, "before", "receipt.json")
        else:
            before_files, before_receipt = read_city(city_path, receipt_path)
        old_receipt_obj = json.loads(before_receipt)
        row, place, timezone, airport, identity, raw, source_info, source_pins = verify_source_inputs(country, old_receipt_obj)
        if (old_receipt_obj.get("countryIso2") != country or old_receipt_obj.get("cityId") != city
                or old_receipt_obj.get("inventorySha256") != source_pins["inventorySha256"]
                or old_receipt_obj.get("selectedPlace") != place or old_receipt_obj.get("airportCandidate") != airport
                or old_receipt_obj.get("generationIdentity") != identity
                or old_receipt_obj.get("sources", {}).get("naturalEarth") != row["admin0Geometry"]):
            raise ValueError("Archived prior receipt identity differs from the pinned source row")
        if mode == "resume":
            verify_receipt_asset_pins(old_receipt_obj, before_files)
        else:
            GEN.verify_assets(old_receipt_obj, row, place, airport, identity, sha(safe_read(GEN.DATA / "inventory.json", GEN.MAX_SELECTION_BYTES, "pinned inventory")), output_root=city_path.parent)
        compiled = capture_compile(country, raw, source_info)
        if compiled["identity"] != {"countryIso2": country, "cityId": city, "generationIdentity": identity}:
            raise ValueError("Revised compiler receipt identity changed unexpectedly")
        new_receipt = json.loads(compiled["receipt"])
        expected_source_identity = {"countryIso2": country, "cityId": city, "generationIdentity": identity,
                                    "inventorySha256": sha(safe_read(GEN.DATA / "inventory.json", GEN.MAX_SELECTION_BYTES, "pinned inventory")),
                                    "selectedPlace": place, "airportCandidate": airport,
                                    "naturalEarth": row["admin0Geometry"],
                                    "osm": {"url": source_info["url"], "bytes": source_info.get("bytes", len(raw)), "sha256": source_info["sha256"]},
                                    "jubaSelection": None}
        if compiled["sourceIdentity"] != expected_source_identity:
            raise ValueError("Compiler source identity differs from the pinned revision inputs")
        if new_receipt.get("sources", {}).get("osm") != old_receipt_obj.get("sources", {}).get("osm"):
            raise ValueError("Compiler attempted to change frozen OSM source provenance")
        if new_receipt.get("sources", {}).get("naturalEarth") != old_receipt_obj.get("sources", {}).get("naturalEarth"):
            raise ValueError("Compiler attempted to change pinned geography provenance")
        # Refuse a source race between validation, compilation and publication.
        _, _, _, _, _, _, _, after_source_pins = verify_source_inputs(country, old_receipt_obj)
        if after_source_pins != source_pins:
            raise ValueError("Pinned source inputs changed while compiling the revision")
        revision, expected_intent = revision_identity(country, city, before_files, before_receipt, compiled, source_pins)
        intent = expected_intent
        if mode == "resume":
            if intent != json.loads(intent_raw):
                raise ValueError("Recomputed source or payload identity differs from the archived revision")
            # The archive is authoritative only when every present output is an exact before/after state.
            if os.path.lexists(city_path):
                try: check_asset_directory(city_path, before_files)
                except ValueError: check_asset_directory(city_path, compiled["files"])
            if os.path.lexists(receipt_path):
                if not (check_receipt(receipt_path, before_receipt) or check_receipt(receipt_path, compiled["receipt"])):
                    raise ValueError("Current receipt is newer or differs from both archived states")
        if revision_id and revision_id != revision:
            raise ValueError("Requested revision ID differs from the recomputed pinned payload")
        stage = REVISION_ROOT / city / revision
        if mode == "plan":
            return {"status": "planned", "country": country, "city": city, "revisionId": revision,
                    "archivePath": str(stage), "before": intent["before"], "after": intent["after"], "sourcePins": source_pins}
        if mode == "apply" and os.path.lexists(stage):
            raise ValueError("This revision already has a stage/archive; use --resume with its exact revision ID")
        if mode == "resume":
            ready = canonical({"schemaVersion": 1, "revisionId": revision, "intentSha256": sha(canonical(intent) + b"\n")}) + b"\n"
            if os.path.lexists(stage / "archive-ready.json") and check_receipt(stage / "archive-ready.json", ready):
                verify_stage_revision(stage, intent, before_files, before_receipt, compiled["files"], compiled["receipt"], city_path)
            else:
                # Publisher cannot start until this marker is durable, so prefix repair is safe only
                # while both live paths still contain the exact original state.
                if os.path.lexists(stage / "before-city") or os.path.lexists(stage / "before-receipt.json"):
                    raise ValueError("Incomplete archive marker conflicts with started publication")
                check_asset_directory(city_path, before_files)
                if not check_receipt(receipt_path, before_receipt):
                    raise ValueError("Cannot repair an incomplete archive after receipt state changed")
                stage_revision(stage, intent, before_files, before_receipt, compiled["files"], compiled["receipt"])
                verify_stage_revision(stage, intent, before_files, before_receipt, compiled["files"], compiled["receipt"], city_path)
        else:
            stage_revision(stage, intent, before_files, before_receipt, compiled["files"], compiled["receipt"])
        return {"status": publish_revision(stage, city_path, receipt_path, before_files, before_receipt,
                                            compiled["files"], compiled["receipt"]),
                "country": country, "city": city, "revisionId": revision, "archivePath": str(stage)}


def do_country(country, mode, revision_id=None):
    if threading.current_thread() is not threading.main_thread() or not hasattr(signal, "setitimer"):
        raise ValueError("Bounded revision execution requires the main thread and interval-timer support")
    old_handler = signal.getsignal(signal.SIGALRM)
    old_timer = signal.getitimer(signal.ITIMER_REAL)
    started = time.monotonic()
    def expired(_signum, _frame):
        raise TimeoutError(f"Starter revision exceeded its {MAX_OPERATION_SECONDS}-second execution limit")
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, MAX_OPERATION_SECONDS)
    try:
        return _do_country(country, mode, revision_id)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, old_handler)
        if old_timer[0] > 0:
            remaining = max(0.001, old_timer[0] - (time.monotonic() - started))
            signal.setitimer(signal.ITIMER_REAL, remaining, old_timer[1])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--country", choices=sorted(ALLOWED))
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--plan", action="store_true", help="Read-only compile and print exact revision pins")
    modes.add_argument("--apply", action="store_true", help="Archive and publish one exact planned revision")
    modes.add_argument("--resume", action="store_true", help="Resume one exact archived revision")
    parser.add_argument("--revision-id", help="Exact 64-character revision ID returned by --plan")
    args = parser.parse_args(argv)
    if args.resume and not args.country:
        parser.error("--country is required with --resume")
    if not args.resume and not args.country:
        parser.error("--country is required")
    if args.apply and not args.revision_id:
        parser.error("--apply requires the exact --revision-id from --plan")
    if args.resume and not args.revision_id:
        parser.error("--resume requires the exact --revision-id from --plan")
    if args.revision_id and not re.fullmatch(r"[0-9a-f]{64}", args.revision_id):
        parser.error("--revision-id must be 64 lowercase hexadecimal characters")
    if args.plan and args.revision_id:
        parser.error("--plan computes the revision ID; do not pass --revision-id")
    mode = "plan" if args.plan else "apply" if args.apply else "resume"
    print(json.dumps(do_country(args.country, mode, args.revision_id), sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"revise-africa-starter: {str(error).replace(chr(10), ' ')[:500]}", file=sys.stderr)
        raise SystemExit(1)
