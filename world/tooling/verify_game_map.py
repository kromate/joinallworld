"""Independent production-outline conservation audit; no network or writer access.

Compares every embedded asset to its immutable directory bytes, every coordinate to
the original Natural Earth source, and the crosswalk to the actual checked-in atlas.
Run: python3 world/tooling/verify_game_map.py <absolute repository> <catalogue file>
"""
from __future__ import annotations

import base64
import hashlib
import json
import pathlib
import re
import sys
from urllib.parse import quote


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def read(path: pathlib.Path, cap: int) -> bytes:
    require(not any(p.is_symlink() for p in [path, *path.parents]), f"symlink: {path}")
    require(path.is_file() and path.stat().st_size <= cap, f"missing/oversized: {path}")
    with path.open("rb") as handle:
        body = handle.read(cap + 1)
    require(len(body) <= cap, f"oversized read: {path}")
    return body


def audit(repository: pathlib.Path, catalogue_path: pathlib.Path) -> dict:
    catalogue_body = read(catalogue_path, 256_000)
    catalogue_hash = digest(catalogue_body)
    require(catalogue_path.name == f"catalogue-v1-{catalogue_hash}.txt", "catalogue filename hash")
    catalogue = json.loads(catalogue_body)
    require(catalogue["schemaVersion"] == 1 and catalogue["kind"] == "country-detail-catalogue", "catalogue version")
    source_pin = json.loads(read(repository / "world/inventory-10m-sources.json", 128_000))
    raw = read(repository / source_pin["input"], 16_000_000)
    require(len(raw) == source_pin["source"]["bytes"] and digest(raw) == source_pin["source"]["sha256"], "raw source hash")
    require(catalogue["source"] == source_pin["source"], "catalogue source differs")
    source_features = json.loads(raw)["features"]
    source_by_ref = {f'{source_pin["source"]["id"]}:NE_ID:{f["properties"]["NE_ID"]}': f for f in source_features}
    require(len(source_by_ref) == 258 == len(catalogue["entries"]), "country denominator")
    atlas = read(repository / catalogue["atlas"]["path"], 2_000_000)
    require(len(atlas) == catalogue["atlas"]["bytes"] and digest(atlas) == catalogue["atlas"]["sha256"], "atlas hash")
    match = re.search(rb"export const WORLD[^=]*=\s*(\{.*\});", atlas, re.S)
    require(match is not None, "atlas literal not found")
    atlas_features = json.loads(match.group(1))["features"]
    atlas_ids = {f["id"] for f in atlas_features if re.fullmatch(r"[a-z]{2}", f["id"])}
    require(len(atlas_features) == 241 and len(atlas_ids) == 236, "coarse atlas denominator")
    code_refs: dict[str, list[str]] = {}
    for ref, feature in source_by_ref.items():
        code = feature["properties"].get("ISO_A2_EH")
        if isinstance(code, str) and re.fullmatch(r"[A-Z]{2}", code):
            code_refs.setdefault(code.lower(), []).append(ref)
    directory = catalogue["directory"]
    directory_root = repository / ".cache/world-build/output/country-inventory"
    manifest_body = read(directory_root / directory["manifestPath"], 1_000_000)
    require(digest(manifest_body) == directory["manifestHash"], "directory hash")
    require(json.loads(manifest_body) == directory["manifest"], "embedded manifest differs")
    manifest = directory["manifest"]
    require(manifest["source"] == catalogue["source"], "directory source differs")
    countries: dict[str, dict] = {}
    pending = [manifest["rootNodePath"]]
    visited = set()
    while pending:
        relative = pending.pop()
        require(relative not in visited and len(visited) < 4096, "repeated/unbounded hierarchy")
        visited.add(relative)
        require(re.fullmatch(r"nodes/[a-f0-9]{64}\.json", relative) is not None, "node path")
        body = read(directory_root / relative, 128_000)
        require(digest(body) == pathlib.PurePosixPath(relative).stem, "node hash")
        index = json.loads(body)
        pending.extend(child["path"] for child in index["children"])
        if index["node"]["kind"] == "country":
            index["_path"] = relative
            countries[index["node"]["id"]] = index
        require(len(countries) + len(pending) < 4096, "hierarchy bound")
    require(len(countries) == 258, "directory country denominator")
    entry_by_id = {row["countryId"]: row for row in catalogue["entries"]}
    require(len(entry_by_id) == 258 and entry_by_id.keys() == countries.keys(), "catalogue omits/repeats country")
    public_files = {catalogue_path.name}
    bundle_total = 0
    source_bytes = 0
    positions = 0
    bundles = 0
    crosswalk_counts: dict[str, int] = {}
    for country_id, row in entry_by_id.items():
        original = countries[country_id]
        node = original["node"]
        require(row["nodePath"] == original["_path"] and row["name"] == node["name"] and row["continentId"] == node["parentId"], "entry node binding")
        require(row["sourceRef"] == node["sourceFeatureIds"][0], "source reference")
        feature = source_by_ref[row["sourceRef"]]
        expected_id = "legacy-ng" if feature["properties"]["ISO_A2_EH"] == "NG" else "country:natural-earth:" + quote(f'NE_ID:{feature["properties"]["NE_ID"]}', safe="")
        require(country_id == expected_id, "source identity")
        if country_id == "legacy-ng":
            require(row["availability"] == "protected" and row["bundlePath"] is None and row["bundleSha256"] is None and row["bundleBytes"] is None, "Nigeria bundle prohibited")
            continue
        require(row["availability"] == "mapped", "source outline omitted")
        require(re.fullmatch(r"world-country-detail/[a-f0-9]{64}\.txt", row["bundlePath"]) is not None, "bundle path")
        filename = pathlib.PurePosixPath(row["bundlePath"]).name
        bundle_body = read(catalogue_path.parent / filename, 5_242_880)
        require(len(bundle_body) == row["bundleBytes"] and digest(bundle_body) == row["bundleSha256"] == pathlib.PurePosixPath(row["bundlePath"]).stem, "bundle hash/length")
        public_files.add(filename)
        bundle = json.loads(bundle_body)
        require(bundle["countryId"] == country_id and bundle["sourceRef"] == row["sourceRef"] and bundle["directoryManifestHash"] == directory["manifestHash"] and bundle["atlasSha256"] == catalogue["atlas"]["sha256"], "bundle source binding")
        decoded = []
        for asset in bundle["assets"]:
            require(asset["encoding"] == "base64" and re.fullmatch(r"(?:nodes|outline-index|outlines)/[a-f0-9]{64}\.json", asset["path"]) is not None, "asset encoding/path")
            body = base64.b64decode(asset["body"], validate=True)
            require(0 < len(body) <= 512_000 and len(body) == asset["bytes"] and digest(body) == asset["sha256"] == pathlib.PurePosixPath(asset["path"]).stem, "asset hash/length")
            require(body == read(directory_root / asset["path"], 512_000), "embedded source bytes differ")
            decoded.append((asset["path"], json.loads(body)))
            source_bytes += len(body)
        require(sum(a["bytes"] for a in bundle["assets"]) <= 2_097_152 and 3 <= len(decoded) <= 6, "bundle decoded cap")
        require(decoded[0][0] == original["_path"] and decoded[1][0] == original["outlineIndexPath"], "index order")
        outline = decoded[1][1]
        require([a[0] for a in decoded[2:]] == [p["path"] for p in outline["parts"]], "geometry part order/extras")
        polygons = [polygon for _, part in decoded[2:] for polygon in part["coordinates"]]
        expected = feature["geometry"]["coordinates"]
        if feature["geometry"]["type"] == "Polygon":
            expected = [expected]
        require(polygons == expected, "original coordinates/holes/order changed")
        count = sum(len(ring) for polygon in polygons for ring in polygon)
        require(count == outline["coordinatePositions"] and count <= 100_000, "position conservation")
        positions += count
        bundles += 1
        bundle_total += len(bundle_body)
    crosswalk = catalogue["crosswalk"]
    require({row["atlasFeatureId"] for row in crosswalk} == atlas_ids and len(crosswalk) == 236, "crosswalk denominator")
    for row in crosswalk:
        code = row["atlasFeatureId"]
        matches = code_refs.get(code, [])
        expected_state = "matched" if len(matches) == 1 else "ambiguous" if matches else "unmatched"
        require(row["state"] == expected_state, "crosswalk ambiguous/absent join changed")
        if expected_state == "matched":
            entry = entry_by_id[row["countryId"]]
            require(entry["sourceRef"] == matches[0] and entry["atlasFeatureId"] == code, "crosswalk exact source mismatch")
        else:
            require(row["countryId"] is None and row["sourceNeId"] is None, "nonunique join must stay unassigned")
        crosswalk_counts[expected_state] = crosswalk_counts.get(expected_state, 0) + 1
    require(bundles == 257 and positions == 546_699, "source geometry denominator")
    require({p.name for p in catalogue_path.parent.iterdir()} == public_files, "unexpected/missing public files")
    return {"verified": True, "networkBytes": 0, "catalogueHash": catalogue_hash, "countries": 258, "bundles": bundles, "protectedNigeria": 1, "originalPositions": positions, "originalAssetBytes": source_bytes, "catalogueBytes": len(catalogue_body), "bundleBytes": bundle_total, "crosswalk": crosswalk_counts, "scope": "Byte-identical directory assets and original source coordinates; geographic display only, no playability or legal-boundary claim."}


if __name__ == "__main__":
    try:
        require(len(sys.argv) == 3, "expected repository and catalogue paths")
        print(json.dumps(audit(pathlib.Path(sys.argv[1]).resolve(), pathlib.Path(sys.argv[2]).absolute()), sort_keys=True))
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        print(f"game map audit failed: {exc}", file=sys.stderr)
        sys.exit(1)
