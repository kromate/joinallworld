"""Independent small-fixture oracle, not a capture/index/coverage verifier.

Hash oracle scope: ASCII integer-only Feature fixtures, whose JSON number/string
encoding agrees with ECMAScript. Noninteger features still get independently
reconstructed exact dyadic owner arithmetic, but no general body hash claim.
"""
import hashlib
import json
import math
import sys
from fractions import Fraction


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def hash_compatible(value):
    if isinstance(value, str):
        return value.isascii()
    if isinstance(value, float):
        return False
    if isinstance(value, list):
        return all(hash_compatible(item) for item in value)
    if isinstance(value, dict):
        return all(key.isascii() and hash_compatible(item) for key, item in value.items())
    return value is None or isinstance(value, (bool, int))


def positions(coordinates):
    if isinstance(coordinates, list) and len(coordinates) >= 2 and all(isinstance(n, (int, float)) and not isinstance(n, bool) for n in coordinates):
        yield coordinates
    else:
        for item in coordinates:
            yield from positions(item)


def reconstruct(feature, binding):
    layer = feature["properties"]["sourceLayer"]
    assert layer in ("buildings", "transportation")
    assert ("roads" if layer == "transportation" else layer) in binding["layers"]
    key = {"provider": "overture", "release": binding["release"], "sourceLayer": layer, "sourceFeatureId": feature["id"]}
    candidates = []
    for coordinate in positions(feature["geometry"]["coordinates"]):
        lon, lat = coordinate[:2]
        assert math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90
        candidates.append((-180 if lon == 180 or abs(lat) == 90 else lon, lat))
    lon, lat = min(candidates)
    # Fraction(float) reconstructs the exact binary value rather than rounded lon+180.
    column = math.floor((Fraction(lon) + 180) * 2)
    row = min(359, math.floor((Fraction(lat) + 90) * 2))
    return {"keyHash": hashlib.sha256(encoded(key)).hexdigest(),
            "bodyHash": hashlib.sha256(encoded(feature)).hexdigest() if hash_compatible(feature) else None,
            "anchor": [lon, lat], "cell": f"geo-grid-v1:l1:x{column}:y{row}"}


if __name__ == "__main__":
    raw = sys.stdin.buffer.read(1_000_001)
    if len(raw) > 1_000_000:
        raise ValueError("fixture input exceeds one MB")
    request = json.loads(raw)
    if len(request["features"]) > 100:
        raise ValueError("fixture oracle is limited to 100 features")
    print(json.dumps([reconstruct(feature, request["binding"]) for feature in request["features"]]))
