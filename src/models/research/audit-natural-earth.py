"""Audit the pinned source data without saving it or changing game assets.

Run with Python 3. Uses only the standard library. Network access is required.
This is a research probe, not a production model builder or a geographic validator.
"""

import hashlib
import json
import signal
import urllib.request


REVISION = "ca96624a56bd078437bca8184e78163e5039ad19"
SOURCE = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    f"{REVISION}/geojson/ne_10m_admin_1_states_provinces.geojson"
)


def audit():
    """Return source provenance, country counts, names, and unsimplified sizes."""
    with urllib.request.urlopen(SOURCE, timeout=45) as response:
        raw = response.read()
    data = json.loads(raw)
    countries = []
    for code, expected in [("NGA", 37), ("KEN", 47)]:
        features = [
            feature for feature in data["features"]
            if feature["properties"].get("adm0_a3") == code
        ]
        subset = {"type": "FeatureCollection", "features": features}
        countries.append({
            "country": code,
            "features": len(features),
            "requiredFeatures": expected,
            "countMatchesBrief": len(features) == expected,
            "names": [feature["properties"].get("name") for feature in features],
            "minifiedSubsetBytes": len(
                json.dumps(subset, separators=(",", ":")).encode()
            ),
        })
    return {
        "source": SOURCE,
        "revision": REVISION,
        "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "countries": countries,
    }


if __name__ == "__main__":
    signal.alarm(90)
    print(json.dumps(audit(), indent=2))
