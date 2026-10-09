"""Bounded immutable index configuration; no filesystem, SQLite or source access.

Pins describe expectations. A guarded opener must verify actual tooling manifest,
source configuration, engine constants and Node/SQLite versions before launch.
"""
import hashlib
import json
import re

MIB = 1024 * 1024
FORMAT = "feature-index-binding-v1"
MAX_BYTES = 4096
VERSIONS = {
    "format": FORMAT,
    "engineVersion": "complete-feature-index-v1",
    "identityVersion": "overture-complete-feature-owner-v1",
    "captureVersion": "overture-pinned-capture-v1",
    "sourceCompiler": "world-source-compiler-v2",
}
ENGINE_CEILINGS = {"databaseBytes": 64*MIB, "captures": 4096,
                   "occurrences": 250000, "versions": 100000, "observations": 16384}
PROCESS_BOUNDS = {"fileBytes": (65536, 64*MIB), "cpuSeconds": (1, 60),
                  "wallSeconds": (1, 60), "heapMiB": (64, 1536),
                  "rssBytes": (64*MIB, 512*MIB)}


def _object(value, keys, label):
    if type(value) is not dict or set(value) != set(keys):
        raise ValueError(f"{label} requires its exact binding fields")
    return value


def _integer(value, minimum, maximum, label):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{label} exceeds its explicit binding bound")


def _pin(value, label):
    _object(value, ["sha256", "bytes"], label)
    _sha(value["sha256"], label)
    _integer(value["bytes"], 1, 64000, f"{label} bytes")


def _sha(value, label):
    if type(value) is not str or not re.fullmatch("[a-f0-9]{64}", value):
        raise ValueError(f"{label} requires an exact SHA-256")


def _validate(value):
    _object(value, [*VERSIONS, "source", "toolingManifest", "runtime", "engineLimits",
                    "processLimits", "reservedBytes"], "index binding")
    for key, expected in VERSIONS.items():
        if type(value[key]) is not str or value[key] != expected:
            raise ValueError(f"unsupported {key}")
    source = _object(value["source"], ["provider", "release", "layers", "configuration"], "source")
    if type(source["provider"]) is not str or source["provider"] != "overture":
        raise ValueError("index source provider must be overture")
    if type(source["release"]) is not str or not re.fullmatch(r"\d{4}-\d{2}-\d{2}\.\d{1,3}", source["release"], flags=re.ASCII):
        raise ValueError("index source requires its exact release spelling")
    layers = source["layers"]
    if (type(layers) is not list or not 1 <= len(layers) <= 2
            or any(type(layer) is not str for layer in layers)
            or layers not in [["buildings"], ["roads"], ["buildings", "roads"]]):
        raise ValueError("index layers require unique canonical buildings/roads order")
    _pin(source["configuration"], "source configuration")
    _pin(value["toolingManifest"], "tooling manifest")
    runtime = _object(value["runtime"], ["nodeVersion", "sqliteVersion", "nodeSha256", "nodeBytes"], "runtime")
    for key, pattern in [("nodeVersion", r"v22\.\d{1,3}\.\d{1,3}"),
                         ("sqliteVersion", r"3\.\d{1,3}\.\d{1,3}")]:
        if type(runtime[key]) is not str or not re.fullmatch(pattern, runtime[key], flags=re.ASCII):
            raise ValueError(f"unsupported exact runtime {key}")
    _sha(runtime["nodeSha256"], "Node executable")
    _integer(runtime["nodeBytes"], 1, 256*MIB, "Node executable bytes")
    limits = _object(value["engineLimits"], ENGINE_CEILINGS, "engine limits")
    for key, ceiling in ENGINE_CEILINGS.items():
        _integer(limits[key], 65536 if key == "databaseBytes" else 1, ceiling, key)
    if limits["databaseBytes"] % 4096:
        raise ValueError("index database quota requires complete 4096-byte pages")
    process = _object(value["processLimits"], PROCESS_BOUNDS, "process limits")
    for key, (minimum, maximum) in PROCESS_BOUNDS.items():
        _integer(process[key], minimum, maximum, key)
    _integer(value["reservedBytes"], 65536, 512*MIB, "reserved bytes")
    if not limits["databaseBytes"] <= process["fileBytes"] <= value["reservedBytes"]:
        raise ValueError("database/file/declared reservation bounds are contradictory")
    # This relation alone does not prove WAL/bootstrap/directory worst-case space.
    # Measured allowance admission remains the guarded opener's responsibility.


def encode_index_binding(value):
    """Validate and encode exact ASCII, sorted-key, compact JSON without newline."""
    _validate(value)
    raw = json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":"),
                     allow_nan=False).encode("ascii")
    if len(raw) > MAX_BYTES:
        raise ValueError("index binding exceeds its byte bound")
    return raw


def _pairs(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("index binding contains duplicate decoded keys")
        value[key] = item
    return value


def _nonfinite(_):
    raise ValueError("index binding contains a nonfinite JSON number")


def decode_index_binding(raw):
    """Validate bytes before parsing; refuse alternate encodings of the same fields."""
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_BYTES:
        raise ValueError("index binding requires bounded immutable bytes")
    try:
        value = json.loads(raw.decode("ascii"), object_pairs_hook=_pairs, parse_constant=_nonfinite)
    except (UnicodeError, RecursionError) as error:
        raise ValueError("index binding encoding/depth is unsupported") from error
    if encode_index_binding(value) != raw:
        raise ValueError("index binding is not canonical; no implicit normalization")
    return value


def index_binding_hash(raw):
    decode_index_binding(raw)
    return hashlib.sha256(raw).hexdigest()
