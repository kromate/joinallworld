#!/usr/bin/env python3
"""Bounded serial orchestration for the existing African starter generator."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import time
import uuid
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
BUILDER = "scripts/world/build-africa-starters.py"
CONVERTER = "scripts/world/build-playable-africa.py"
VERIFIER = "scripts/world/verify-playable-destination.ts"
INVENTORY = "world/playable-africa-rollout/inventory.json"
SLOT = "scripts/agent-slot.ts"
RUNNER = "world/tooling/run_africa_starters.py"
OPTIONAL_PUBLICATION_HELPER = "world/tooling/atomic_starter_publication.py"
RUNS = ".cache/world-build/playable-africa-runs"
DOWNLOAD_RESERVATION = 8 * 1024 * 1024
MAX_COUNTRIES = 5
MAX_RESERVATION = 64 * 1024 * 1024
MAX_SECONDS = 600
MAX_OUTPUT = 128 * 1024
MAX_CONTRACT = 128 * 1024
IMPORTABLE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".pyw", ".pyc", ".pyo",
                      ".json", ".json5", ".jsonc", ".wasm", ".sh", ".bash", ".css", ".html", ".vue", ".svelte",
                      ".class", ".jar", ".so", ".dylib", ".dll", ".node"}
PLAN_FIELDS = (
    "country", "city", "settlement", "settlementRole", "timezone", "stateId", "stateName",
    "airportDatasetName", "airportDatasetPoint", "airportEvidence", "catalogueBytes", "catalogueLimit",
    "selectionEvidence",
)


class RunnerError(RuntimeError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json_bounded(path, limit=MAX_CONTRACT):
    if not hasattr(os, "O_NOFOLLOW"):
        raise RunnerError("safe no-follow file access is unavailable")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise RunnerError("contract must be a bounded regular file")
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise RunnerError("contract and report files must be owned private 0600 files")
        pieces, size = [], 0
        while True:
            piece = os.read(fd, min(65536, limit + 1 - size))
            if not piece:
                break
            pieces.append(piece)
            size += len(piece)
            if size > limit:
                raise RunnerError("contract exceeds its byte limit")
        return json.loads(b"".join(pieces))
    finally:
        os.close(fd)


def has_owned_publication_intent(root, city, country):
    """Accept only the publisher's bounded, private ownership marker for this city."""
    if (not isinstance(city, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", city)
            or not isinstance(country, str) or not re.fullmatch(r"[A-Z]{2}", country)):
        return False
    root = Path(root).resolve()
    base = root / ".cache/world-build/africa-starter-publication"
    stage = base / city
    for path in (root, root / ".cache", root / ".cache/world-build", base, stage):
        try:
            info = path.lstat()
        except FileNotFoundError:
            return False
        if not stat.S_ISDIR(info.st_mode) or path.resolve() != path:
            return False
        if path in (base, stage) and (info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700):
            return False
    intent = stage / "intent.json"
    try:
        descriptor = os.open(intent, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
    except OSError:
        return False
    try:
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 512 * 1024):
            return False
        chunks, size = [], 0
        while True:
            chunk = os.read(descriptor, min(65536, 512 * 1024 + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > 512 * 1024:
                return False
    finally:
        os.close(descriptor)
    try:
        marker = json.loads(b"".join(chunks))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False
    identity = marker.get("identity") if isinstance(marker, dict) else None
    return (isinstance(marker, dict) and type(marker.get("schemaVersion")) is int and marker.get("schemaVersion") == 1
            and isinstance(identity, dict)
            and identity.get("countryIso2") == country and identity.get("cityId") == city)


def ensure_run_directory(root, target, *, create):
    root = Path(root).resolve()
    target = Path(os.path.abspath(target))
    run_root = root / RUNS
    if target != run_root and not (target.parent == run_root and re.fullmatch(r"[0-9a-f]{64}", target.name)):
        raise RunnerError("run evidence must live in its content-addressed private directory")
    try:
        relative = target.relative_to(root)
    except ValueError as error:
        raise RunnerError("run evidence directory escapes the repository root") from error
    current = root
    paths = [root]
    for part in relative.parts:
        current = current / part
        paths.append(current)
    for path in paths:
        try:
            info = path.lstat()
        except FileNotFoundError:
            if not create:
                raise RunnerError(f"private run directory is missing: {path}")
            path.mkdir(mode=0o700)
            info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or path.resolve() != path:
            raise RunnerError("run evidence path has a symlink or non-directory parent")
        if path == run_root or path == target:
            if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
                raise RunnerError("run evidence directories must be current-user-owned mode 0700")
    return target


def atomic_json(root, path, value, *, exclusive=False):
    path = Path(path)
    ensure_run_directory(root, path.parent, create=True)
    try:
        existing = path.lstat()
    except FileNotFoundError:
        existing = None
    if existing is not None and (not stat.S_ISREG(existing.st_mode) or existing.st_uid != os.getuid()
                                 or stat.S_IMODE(existing.st_mode) != 0o600):
        raise RunnerError("refusing to replace an unexpected run evidence file")
    if exclusive and existing is not None:
        raise RunnerError(f"refusing to replace existing frozen contract: {path}")
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(temporary, flags, 0o600)
    try:
        payload = canonical(value) + b"\n"
        with os.fdopen(descriptor, "wb", closefd=True) as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o600)
        if exclusive:
            try:
                os.link(temporary, path)
            except FileExistsError as error:
                raise RunnerError(f"refusing to replace existing frozen contract: {path}") from error
            temporary.unlink()
        else:
            os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
        raise


def source_pins(root):
    paths = [BUILDER, CONVERTER, VERIFIER, INVENTORY, SLOT, RUNNER, OPTIONAL_PUBLICATION_HELPER]
    pins = {}
    for relative in paths:
        path = root / relative
        try:
            info = path.lstat()
        except FileNotFoundError as error:
            raise RunnerError(f"missing frozen runner input: {relative}") from error
        if not stat.S_ISREG(info.st_mode) or info.st_size > 8 * 1024 * 1024:
            raise RunnerError(f"missing frozen runner input: {relative}")
        body = path.read_bytes()
        pins[relative] = {"sha256": digest(body), "bytes": len(body)}
    return pins


def git_snapshot(root, city_ids, *, expected_head=None, timeout=30):
    head_result = run_command(["git", "rev-parse", "HEAD"], cwd=root, timeout=timeout)
    status_result = run_command(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd=root, timeout=timeout)
    if len(head_result.stdout) > 256 or len(status_result.stdout) > MAX_OUTPUT:
        raise RunnerError("Git source-tree output exceeded its bound")
    head = head_result.stdout.decode("ascii").strip()
    if not re.fullmatch(r"[0-9a-f]{40}", head):
        raise RunnerError("Git did not report an exact commit SHA")
    if expected_head is not None and head != expected_head:
        raise RunnerError("Git HEAD differs from the frozen run contract")
    status = status_result.stdout
    generated_assets = {"facts.ts", "geometry.ts", "index.ts", "content.ts", "map.ts"}
    allowed_city_assets = {f"src/game/cities/{city}/{name}" for city in city_ids for name in generated_assets}
    receipts = {f"world/playable-africa-rollout/receipts/{city}.json" for city in city_ids}
    entries = status.split(b"\0")
    index = 0
    while index < len(entries):
        entry = entries[index]
        index += 1
        if not entry:
            continue
        if len(entry) < 4:
            raise RunnerError("Git reported malformed worktree status")
        code = entry[:2].decode("ascii", errors="replace")
        path = entry[3:].decode("utf-8", errors="strict")
        if "R" in code or "C" in code:
            raise RunnerError("renamed or copied tracked paths are not allowed during a starter run")
        if path in allowed_city_assets or path in receipts:
            continue
        if code == "??":
            if path == "deploy/tooling/node_modules" or path.startswith("deploy/tooling/node_modules/"):
                continue
            protected = path.startswith(("src/game/", "scripts/world/", "world/"))
            if protected:
                suffix = Path(path).suffix.lower()
                candidate = root / path
                try:
                    info = candidate.lstat()
                except FileNotFoundError as error:
                    raise RunnerError(f"untracked source disappeared during tree validation: {path}") from error
                if stat.S_ISLNK(info.st_mode) or stat.S_ISREG(info.st_mode) and (
                        suffix in IMPORTABLE_SUFFIXES or info.st_mode & 0o111):
                    raise RunnerError(f"untracked importable or executable source blocks frozen tree: {path}")
                if suffix == ".md" and stat.S_ISREG(info.st_mode):
                    continue
                if suffix == ".md":
                    raise RunnerError(f"untracked non-regular source blocks frozen tree: {path}")
            elif path.lower().endswith(".md"):
                continue
            continue
        raise RunnerError(f"dirty tracked non-output source blocks starter run: {path}")
    return head


def parse_json_lines(output, label):
    if len(output) > MAX_OUTPUT:
        raise RunnerError(f"{label} output exceeds its limit")
    rows = []
    for line in output.decode("utf-8", errors="strict").splitlines():
        if line.strip():
            value = json.loads(line)
            if not isinstance(value, dict):
                raise RunnerError(f"{label} returned a non-object row")
            rows.append(value)
    return rows


def run_command(command, *, cwd, timeout, env=None):
    process = None
    selector = selectors.DefaultSelector()
    output = {"stdout": bytearray(), "stderr": bytearray()}

    def stop_and_reap():
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=0.5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

    try:
        process = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert process.stdout is not None and process.stderr is not None
        selector.register(process.stdout, selectors.EVENT_READ, "stdout")
        selector.register(process.stderr, selectors.EVENT_READ, "stderr")
        deadline = time.monotonic() + max(0.01, timeout)
        while selector.get_map():
            if time.monotonic() >= deadline:
                raise RunnerError(f"command timed out: {Path(command[0]).name}")
            for key, _ in selector.select(min(0.1, max(0.001, deadline - time.monotonic()))):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                buffer = output[key.data]
                buffer.extend(chunk)
                if len(buffer) > MAX_OUTPUT:
                    tail = bytes(buffer[-1024:]).decode("utf-8", errors="replace").replace("\n", " ")
                    raise RunnerError(f"child {key.data} exceeded its 128 KiB output cap; tail: {tail[-600:]}")
        try:
            return_code = process.wait(timeout=max(0.01, deadline - time.monotonic()))
        except subprocess.TimeoutExpired as error:
            raise RunnerError(f"command timed out: {Path(command[0]).name}") from error
    except (OSError, subprocess.SubprocessError) as error:
        stop_and_reap()
        raise RunnerError(f"could not complete child command: {Path(command[0]).name}") from error
    except Exception:
        stop_and_reap()
        raise
    finally:
        selector.close()
        if process is not None:
            if process.stdout is not None:
                process.stdout.close()
            if process.stderr is not None:
                process.stderr.close()
    if return_code != 0:
        detail = bytes(output["stderr"][-1024:]).decode("utf-8", errors="replace").replace("\n", " ")[:500]
        raise RunnerError(f"child exited {return_code}: {detail}")
    return SimpleNamespace(returncode=return_code, stdout=bytes(output["stdout"]), stderr=bytes(output["stderr"]))


def remaining(deadline):
    seconds = deadline - time.monotonic()
    if seconds <= 0:
        raise RunnerError("the frozen run walltime has elapsed")
    return seconds


def builder_command(python, root, country, mode, juba):
    command = [python, "-I", "-B", str(root / BUILDER), "--country", country]
    if mode is not None:
        command.append(mode)
    if juba and country == "SS":
        command.extend(["--juba-selection", juba[0], "--juba-selection-sha256", juba[1]])
    return command


def make_plans(root, python, countries, juba, deadline, execute):
    command = [python, "-I", "-B", str(root / BUILDER)]
    for country in countries:
        command.extend(["--country", country])
    command.append("--plan")
    if juba:
        command.extend(["--juba-selection", juba[0], "--juba-selection-sha256", juba[1]])
    result = execute(command, cwd=root, timeout=remaining(deadline))
    rows = parse_json_lines(result.stdout, "starter plan")
    if len(rows) != len(countries):
        raise RunnerError("starter plan did not return exactly one row per selected country")
    plans = []
    for country, row in zip(countries, rows):
        if row.get("country") != country or row.get("status") != "ready" or not row.get("city"):
            raise RunnerError(f"starter plan refused {country}: {row.get('reason') or row.get('status')}")
        if not isinstance(row.get("wouldRequest"), bool) or not isinstance(row.get("cachedSample"), bool):
            raise RunnerError(f"starter plan omitted source-cache state for {country}")
        plans.append(row)
    if len({row["city"] for row in plans}) != len(plans):
        raise RunnerError("starter plan produced duplicate city ids")
    return plans


def stable_plan(row):
    return {key: row.get(key) for key in PLAN_FIELDS}


def contract_hash(contract):
    value = dict(contract)
    value.pop("contractSha256", None)
    return digest(canonical(value))


def contract_location(root, contract):
    expected = root / RUNS / contract["contractSha256"] / "contract.json"
    return expected


def load_contract(root, path):
    root = Path(root).resolve()
    input_path = Path(os.path.abspath(path))
    try:
        input_info = input_path.lstat()
    except FileNotFoundError as error:
        raise RunnerError("resume contract path does not exist") from error
    if not stat.S_ISREG(input_info.st_mode) or input_info.st_uid != os.getuid() or stat.S_IMODE(input_info.st_mode) != 0o600:
        raise RunnerError("resume contract must be a private regular file owned by the current user")
    contract_path = input_path.resolve()
    if contract_path != input_path or not stat.S_ISREG(contract_path.lstat().st_mode):
        raise RunnerError("resume contract path must be canonical and have no symlink parents")
    contract = read_json_bounded(contract_path)
    if not isinstance(contract, dict) or contract.get("schemaVersion") != 1:
        raise RunnerError("unsupported frozen Africa run contract")
    required = {"gitHead", "sourcePins", "countries", "plans", "initialCacheState", "jubaSelection", "python", "node", "budgets", "contractSha256"}
    if not required.issubset(contract):
        raise RunnerError("frozen Africa run contract is incomplete")
    expected_sha = contract_hash(contract)
    if contract.get("contractSha256") != expected_sha:
        raise RunnerError("frozen Africa run contract SHA mismatch")
    budgets = contract["budgets"]
    if (not re.fullmatch(r"[0-9a-f]{40}", str(contract["gitHead"])) or not isinstance(contract["sourcePins"], dict)
            or not isinstance(contract["countries"], list) or not 1 <= len(contract["countries"]) <= MAX_COUNTRIES
            or any(not isinstance(code, str) or not re.fullmatch(r"[A-Z]{2}", code) for code in contract["countries"])
            or len(set(contract["countries"])) != len(contract["countries"])
            or not isinstance(contract["plans"], list) or len(contract["plans"]) != len(contract["countries"])
            or not isinstance(contract["initialCacheState"], list) or len(contract["initialCacheState"]) != len(contract["countries"])
            or not isinstance(budgets, dict) or not isinstance(budgets.get("seconds"), int) or isinstance(budgets.get("seconds"), bool)
            or not 1 <= budgets["seconds"] <= MAX_SECONDS or not isinstance(budgets.get("maxCountries"), int)
            or isinstance(budgets.get("maxCountries"), bool) or not 1 <= budgets["maxCountries"] <= MAX_COUNTRIES
            or not isinstance(budgets.get("maxReservedBytes"), int) or isinstance(budgets.get("maxReservedBytes"), bool)
            or not 0 <= budgets["maxReservedBytes"] <= MAX_RESERVATION
            or not isinstance(budgets.get("reservedPotentialBytes"), int) or isinstance(budgets.get("reservedPotentialBytes"), bool)
            or not 0 <= budgets["reservedPotentialBytes"] <= budgets["maxReservedBytes"]
            or budgets.get("perCityReservationBytes") != DOWNLOAD_RESERVATION or not isinstance(contract["node"], str)
            or not isinstance(contract["python"], str) or not Path(contract["node"]).is_absolute() or not Path(contract["python"]).is_absolute()):
        raise RunnerError("frozen Africa run contract fields or budget bounds are invalid")
    if any(not isinstance(row, dict) or row.get("country") != code or not isinstance(row.get("city"), str)
           for code, row in zip(contract["countries"], contract["plans"])):
        raise RunnerError("frozen Africa plan identities do not match the selection")
    plan_by_country = {row["country"]: row for row in contract["plans"]}
    if any(not isinstance(state, dict) or state.get("city") != plan_by_country[code]["city"]
           or not isinstance(state.get("cachedSample"), bool) or not isinstance(state.get("wouldRequest"), bool)
           for code, state in zip(contract["countries"], contract["initialCacheState"])):
        raise RunnerError("frozen Africa initial cache snapshot is invalid")
    juba = contract["jubaSelection"]
    if juba is not None and (not isinstance(juba, list) or len(juba) != 2 or not all(isinstance(item, str) for item in juba)
                             or not re.fullmatch(r"[0-9a-f]{64}", juba[1])):
        raise RunnerError("frozen Juba selection binding is invalid")
    if contract_path != contract_location(root, contract):
        raise RunnerError("resume contract is outside its content-addressed run directory")
    ensure_run_directory(root, contract_path.parent, create=False)
    return contract, contract_path.parent


def report_write(root, report_path, report):
    atomic_json(root, report_path, report)


def validate_report(report, contract, pins):
    if not isinstance(report, dict) or report.get("schemaVersion") != 1:
        raise RunnerError("unsupported runner report schema")
    if report.get("contractSha256") != contract["contractSha256"] or report.get("sourcePins") != pins or report.get("gitHead") != contract["gitHead"] or report.get("budgets") != contract["budgets"]:
        raise RunnerError("run report is not bound to the frozen source contract")
    if report.get("status") not in {"running", "partial", "complete"}:
        raise RunnerError("run report status is invalid")
    cities = report.get("cities")
    expected = {row["city"]: row["country"] for row in contract["plans"]}
    if not isinstance(cities, dict) or len(cities) > len(expected) or any(city not in expected or not isinstance(state, dict) for city, state in cities.items()):
        raise RunnerError("run report contains invalid city checkpoint state")
    valid_status = {"planned", "generation-started", "generated", "source-checked", "verified", "partial-output-refused"}
    for city, state in cities.items():
        if state.get("country") != expected[city] or state.get("status") not in valid_status:
            raise RunnerError("run report city identity or status is invalid")
    if not isinstance(report.get("windows"), list) or len(report["windows"]) > 32:
        raise RunnerError("run report has invalid bounded window history")
    if not isinstance(report.get("failures"), list) or len(report["failures"]) > 32:
        raise RunnerError("run report has invalid bounded failure history")


def execute_campaign(root, config, *, execute=run_command, now=time.monotonic):
    root = Path(root).resolve()
    start = now()
    deadline = start + config["seconds"]
    pins = source_pins(root)
    resume_dir = None
    if config.get("resume"):
        contract, resume_dir = load_contract(root, config["resume"])
        if pins != contract["sourcePins"]:
            raise RunnerError("generator, verifier, inventory, slot, or runner source differs from frozen contract")
        if config.get("python") and str(Path(config["python"]).resolve()) != contract["python"]:
            raise RunnerError("Python executable differs from frozen contract")
        if config.get("node") and str(Path(config["node"]).resolve()) != contract["node"]:
            raise RunnerError("Node executable differs from frozen contract")
        for key in ("seconds", "maxCountries", "maxReservedBytes"):
            supplied = config.get(key)
            if supplied is not None and supplied != contract["budgets"][key]:
                raise RunnerError(f"resume {key} differs from frozen contract")
        countries = contract["countries"]
        if config.get("checkGit", True):
            git_snapshot(root, [row["city"] for row in contract["plans"]], expected_head=contract["gitHead"], timeout=remaining(deadline))
            if source_pins(root) != pins:
                raise RunnerError("frozen generator/verifier inputs changed during resume validation")
        python, node = contract["python"], contract["node"]
        juba = contract.get("jubaSelection")
        seconds = contract["budgets"]["seconds"]
        deadline = start + seconds
        plans = make_plans(root, python, countries, juba, deadline, execute)
        expected = contract["plans"]
        if [stable_plan(row) for row in plans] != expected:
            raise RunnerError("current plan identity differs from the frozen country selection")
        report_path = resume_dir / "report.json"
        if report_path.exists():
            report = read_json_bounded(report_path)
            validate_report(report, contract, pins)
        else:
            report = {"schemaVersion": 1, "contractSha256": contract["contractSha256"], "sourcePins": pins,
                      "gitHead": contract["gitHead"], "budgets": contract["budgets"], "status": "partial", "cities": {}, "windows": [], "failures": []}
    else:
        countries = config["countries"]
        if not countries or len(countries) > config["maxCountries"]:
            raise RunnerError("select between one and --max-countries countries")
        python, node = str(Path(config["python"]).resolve()), str(Path(config["node"]).resolve())
        juba = config.get("jubaSelection")
        plans = make_plans(root, python, countries, juba, deadline, execute)
        reserved = sum(DOWNLOAD_RESERVATION for row in plans if row["wouldRequest"])
        if reserved > config["maxReservedBytes"]:
            raise RunnerError(f"potential source reservation {reserved} exceeds --max-reserved-bytes {config['maxReservedBytes']}")
        git_head = git_snapshot(root, [row["city"] for row in plans], timeout=remaining(deadline)) if config.get("checkGit", True) else "0" * 40
        if source_pins(root) != pins:
            raise RunnerError("generator/verifier inputs changed during run-contract creation")
        contract = {
            "schemaVersion": 1,
            "gitHead": git_head,
            "sourcePins": pins,
            "countries": countries,
            "plans": [stable_plan(row) for row in plans],
            "initialCacheState": [{"city": row["city"], "cachedSample": row["cachedSample"], "wouldRequest": row["wouldRequest"]} for row in plans],
            "jubaSelection": juba,
            "python": python,
            "node": node,
            "budgets": {"seconds": config["seconds"], "maxCountries": config["maxCountries"], "maxReservedBytes": config["maxReservedBytes"],
                        "reservedPotentialBytes": reserved, "perCityReservationBytes": DOWNLOAD_RESERVATION},
        }
        contract["contractSha256"] = contract_hash(contract)
        resume_dir = contract_location(root, contract).parent
        ensure_run_directory(root, resume_dir, create=True)
        contract_path = resume_dir / "contract.json"
        try:
            existing_entries = {entry.name for entry in resume_dir.iterdir()}
        except OSError as error:
            raise RunnerError("could not inspect the private run directory") from error
        unexpected_entries = existing_entries - {"contract.json", "report.json"}
        if unexpected_entries:
            raise RunnerError("content-addressed run directory contains unexpected prior evidence")
        if contract_path.exists():
            existing, _ = load_contract(root, contract_path)
            if existing != contract:
                raise RunnerError("content-addressed run contract path contains different data")
            raise RunnerError("this exact run contract already exists; use --resume so original request attempts cannot be repeated")
        if (resume_dir / "report.json").exists():
            raise RunnerError("run report already exists without a new contract; refusing to replace prior evidence")
        atomic_json(root, contract_path, contract, exclusive=True)
        report_path = resume_dir / "report.json"
        report = {"schemaVersion": 1, "contractSha256": contract["contractSha256"], "sourcePins": pins,
                  "gitHead": contract["gitHead"], "budgets": contract["budgets"], "status": "running", "cities": {}, "windows": [], "failures": []}
        report_write(root, report_path, report)

    report["status"] = "running"
    if len(report.get("windows", [])) >= 32:
        raise RunnerError("run report has reached its 32-window bound")
    if len(report.get("failures", [])) > 32:
        raise RunnerError("run report exceeds its 32-failure bound")
    window = {"startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "budgetSeconds": contract["budgets"]["seconds"]}
    report.setdefault("windows", []).append(window)
    report_write(root, report_path, report)
    try:
        for country, planned in zip(countries, plans):
            remaining(deadline)
            city = planned["city"]
            state = report["cities"].setdefault(city, {"country": country, "status": "planned"})
            original_cache = next(item for item in contract["initialCacheState"] if item["city"] == city)
            check = lambda: execute(builder_command(python, root, country, "--check", juba), cwd=root, timeout=remaining(deadline))
            verify = lambda: execute([node, "--max-old-space-size=256", "--experimental-strip-types", str(root / VERIFIER), city],
                                     cwd=root, timeout=remaining(deadline), env={**os.environ, "NODE_OPTIONS": "--max-old-space-size=256"})
            if state.get("generated") is not True:
                output_dir = root / "src/game/cities" / city
                receipt_path = root / "world/playable-africa-rollout/receipts" / f"{city}.json"
                stage_dir = root / ".cache/world-build/africa-starter-publication" / city
                output_exists = os.path.lexists(output_dir)
                receipt_exists = os.path.lexists(receipt_path)
                stage_exists = os.path.lexists(stage_dir)
                partial_publication = not (output_exists and receipt_exists) and (output_exists or receipt_exists or stage_exists)
                cache_now = planned["cachedSample"]
                if partial_publication and (not cache_now or not has_owned_publication_intent(root, city, country)):
                    state["status"] = "partial-output-refused"
                    state["publicationRecoveryRequested"] = False
                    state["publishingGap"] = "partial publication lacks a matching private intent or cached source; all files are preserved"
                    report_write(root, report_path, report)
                    raise RunnerError(f"{city}: partial publication lacks a matching owned intent or cached source; preserving files without acquisition")
                state["publicationRecoveryRequested"] = partial_publication
                if state.get("operationStarted") and state.get("acquisitionAuthorized") and not cache_now:
                    raise RunnerError(f"{city}: prior acquisition may have spent its request; no identical retry is allowed")
                acquire = not partial_publication and not cache_now and original_cache["wouldRequest"] and not state.get("operationStarted")
                if not cache_now and not acquire:
                    raise RunnerError(f"{city}: source cache is absent after a prior operation; refusing another request")
                state["status"] = "generation-started"
                state["operationStarted"] = True
                state["acquisitionAuthorized"] = acquire or state.get("acquisitionAuthorized", False)
                report_write(root, report_path, report)
                if acquire:
                    command = builder_command(python, root, country, "--acquire", juba)
                else:
                    command = builder_command(python, root, country, None, juba)
                result = execute(command, cwd=root, timeout=remaining(deadline))
                generated = parse_json_lines(result.stdout, f"generation {city}")
                if len(generated) != 1 or generated[0].get("status") != "generated" or generated[0].get("country") != country or generated[0].get("city") != city:
                    raise RunnerError(f"{city}: generator did not confirm its expected source output")
                state["generated"] = True
                state["status"] = "generated"
                report_write(root, report_path, report)
            checked = parse_json_lines(check().stdout, f"source check {city}")
            if len(checked) != 1 or checked[0].get("status") != "pinned-assets-match" or checked[0].get("city") != city:
                raise RunnerError(f"{city}: source receipt/assets check did not confirm the expected city")
            state["sourceChecked"] = True
            state["status"] = "source-checked"
            report_write(root, report_path, report)
            verified = parse_json_lines(verify().stdout, f"engine verification {city}")
            if len(verified) != 1 or verified[0].get("status") != "verified" or verified[0].get("city") != city:
                raise RunnerError(f"{city}: isolated engine verifier did not confirm the expected city")
            state["engineVerified"] = True
            state["status"] = "verified"
            report_write(root, report_path, report)
        report["status"] = "complete"
        report["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        window["finishedAt"] = report["completedAt"]
        window["elapsedSeconds"] = round(now() - start, 3)
        report_write(root, report_path, report)
    except Exception as error:
        report["status"] = "partial"
        failure = {"message": str(error)[:600], "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        report.setdefault("failures", []).append(failure)
        report["lastFailure"] = failure
        window["finishedAt"] = failure["at"]
        window["elapsedSeconds"] = round(now() - start, 3)
        report_write(root, report_path, report)
        raise
    return {"contractSha256": contract["contractSha256"], "contractPath": str(contract_location(root, contract)),
            "reportPath": str(report_path), "status": report["status"], "countries": countries}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--country", action="append", help="Explicit ISO2 country selection; repeat in serial order")
    parser.add_argument("--resume", help="Resume the exact content-addressed contract and report")
    parser.add_argument("--python", help="Absolute Python executable to freeze in a new contract")
    parser.add_argument("--node", help="Absolute Node executable to freeze in a new contract")
    parser.add_argument("--seconds", type=int, help="Finite total walltime, 1..600 seconds (default 600)")
    parser.add_argument("--max-countries", type=int, help="Maximum selected countries, 1..5 (default 5)")
    parser.add_argument("--max-reserved-bytes", type=int, help="Maximum potential source download reservation, at most 64 MiB")
    parser.add_argument("--juba-selection")
    parser.add_argument("--juba-selection-sha256")
    parser.add_argument("--_inside-slot", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.seconds is not None and not 1 <= args.seconds <= MAX_SECONDS:
        parser.error("--seconds must be from 1 to 600")
    if args.max_countries is not None and not 1 <= args.max_countries <= MAX_COUNTRIES:
        parser.error("--max-countries must be from 1 to 5")
    if args.max_reserved_bytes is not None and not 0 <= args.max_reserved_bytes <= MAX_RESERVATION:
        parser.error("--max-reserved-bytes must be from 0 to 64 MiB")
    if (args.juba_selection is None) != (args.juba_selection_sha256 is None):
        parser.error("--juba-selection and --juba-selection-sha256 must be supplied together")
    if args.juba_selection_sha256 and (len(args.juba_selection_sha256) != 64 or any(c not in "0123456789abcdef" for c in args.juba_selection_sha256)):
        parser.error("--juba-selection-sha256 must be 64 lowercase hexadecimal characters")
    if args.resume:
        if args.country or args.seconds is not None or args.max_countries is not None or args.max_reserved_bytes is not None or args.juba_selection:
            parser.error("--resume uses the frozen selection and budgets; do not pass country, budget, or Juba overrides")
    elif not args.country:
        parser.error("new runs require at least one --country")
    if args.country:
        args.country = [country.upper() for country in args.country]
        if len(set(args.country)) != len(args.country) or any(len(country) != 2 or not country.isalpha() or not country.isascii() for country in args.country):
            parser.error("use distinct two-letter ASCII ISO2 country codes")
    return args


def contract_for_resume(root, args):
    if not args.resume:
        return None
    contract, _ = load_contract(root, args.resume)
    return contract


def supervise(args, raw_argv):
    root = ROOT
    contract = contract_for_resume(root, args)
    node_default = contract["node"] if contract else args.node or shutil.which("node")
    python_default = contract["python"] if contract else args.python or sys.executable
    node = str(Path(node_default).resolve()) if node_default else None
    python = str(Path(python_default).resolve()) if python_default else None
    if not node or not Path(node).is_file() or not os.access(node, os.X_OK):
        raise RunnerError("a known executable Node path is required")
    if not python or not Path(python).is_file() or not os.access(python, os.X_OK):
        raise RunnerError("a known executable Python path is required")
    forwarded = list(raw_argv)
    if "--node" not in forwarded:
        forwarded.extend(["--node", node])
    if "--python" not in forwarded:
        forwarded.extend(["--python", python])
    command = [node, "--experimental-strip-types", str(root / SLOT), "heavy", "--wait-ms", "0", "--",
               python, "-I", "-B", str(root / RUNNER), "--_inside-slot", *forwarded]
    process = subprocess.Popen(command, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True)
    seconds = args.seconds or MAX_SECONDS
    try:
        result = wait_owned_process_group(process, seconds)
        if result.returncode != 0:
            detail = result.stderr[-1024:].decode("utf-8", errors="replace").replace("\n", " ")[:500]
            raise RunnerError(f"starter runner child exited {result.returncode}: {detail}")
        if result.stdout:
            sys.stdout.buffer.write(result.stdout)
            sys.stdout.buffer.flush()
        if result.stderr:
            sys.stderr.buffer.write(result.stderr)
            sys.stderr.buffer.flush()
        return result.returncode
    except KeyboardInterrupt:
        stop_owned_process_group(process)
        raise


def stop_owned_process_group(process, *, grace=0.25):
    """Stop every process in a new-session child group, even after its leader exits."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        pass
    # A child may outlive an exited group leader. Always kill the group after grace.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=1)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def wait_owned_process_group(process, timeout):
    if process.stdout is None or process.stderr is None:
        raise RunnerError("supervised process requires bounded output pipes")
    selector = selectors.DefaultSelector()
    outputs = {"stdout": bytearray(), "stderr": bytearray()}
    selector.register(process.stdout, selectors.EVENT_READ, "stdout")
    selector.register(process.stderr, selectors.EVENT_READ, "stderr")
    deadline = time.monotonic() + timeout
    try:
        while selector.get_map() or process.poll() is None:
            if time.monotonic() >= deadline:
                stop_owned_process_group(process)
                raise RunnerError("Africa starter run exceeded its frozen walltime; owned process group was stopped and reaped")
            if not selector.get_map():
                try:
                    process.wait(timeout=min(0.1, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    continue
                break
            for key, _ in selector.select(min(0.1, max(0.001, deadline - time.monotonic()))):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                output = outputs[key.data]
                output.extend(chunk)
                if len(output) > MAX_OUTPUT:
                    stop_owned_process_group(process)
                    raise RunnerError(f"supervised child {key.data} exceeded its 128 KiB output cap")
        # A successful leader must not leave an untracked worker behind either.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        return SimpleNamespace(returncode=process.wait(), stdout=bytes(outputs["stdout"]), stderr=bytes(outputs["stderr"]))
    except KeyboardInterrupt:
        stop_owned_process_group(process)
        raise
    finally:
        selector.close()
        process.stdout.close()
        process.stderr.close()


def main(argv=None):
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    args = parse_args(raw_argv)
    if not args._inside_slot:
        return supervise(args, raw_argv)
    if "heavy" not in os.environ.get("AGENT_SLOT_HELD", "").split(","):
        raise RunnerError("internal runner requires the existing shared heavy slot")
    resume_contract = contract_for_resume(ROOT, args)
    config = {
        "countries": args.country,
        "resume": args.resume,
        "python": args.python,
        "node": args.node,
        "seconds": args.seconds if args.seconds is not None else (resume_contract["budgets"]["seconds"] if resume_contract else 600),
        "maxCountries": args.max_countries if args.max_countries is not None else (resume_contract["budgets"]["maxCountries"] if resume_contract else 5),
        "maxReservedBytes": args.max_reserved_bytes if args.max_reserved_bytes is not None else (resume_contract["budgets"]["maxReservedBytes"] if resume_contract else 40 * 1024 * 1024),
        "jubaSelection": [args.juba_selection, args.juba_selection_sha256] if args.juba_selection else None,
    }
    result = execute_campaign(ROOT, config)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RunnerError, OSError, ValueError, json.JSONDecodeError) as error:
        print(f"run_africa_starters: {str(error).replace(chr(10), ' ')[:600]}", file=sys.stderr)
        raise SystemExit(1)
