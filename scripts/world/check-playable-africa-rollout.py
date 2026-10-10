#!/usr/bin/env python3
"""Read-only, bounded verification of committed starter assets and receipt identities."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

ASSETS = frozenset(('facts.ts', 'geometry.ts', 'index.ts', 'content.ts', 'map.ts'))
CITY_ID = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*\Z')
SHA256 = re.compile(r'[0-9a-f]{64}\Z')
ROOT = Path(__file__).absolute().parents[2]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_bounded(root, parts, maximum):
    """Open every directory and the final regular file without following symlinks."""
    require(root.is_absolute(), 'repository root must be absolute')
    require(all(part not in ('', '.', '..') and '/' not in part for part in parts), 'invalid path component')
    descriptor = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in (*root.parts[1:], *parts[:-1]):
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        file_descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
        try:
            before = os.fstat(file_descriptor)
            require(stat.S_ISREG(before.st_mode), 'source must be a regular file')
            require(0 < before.st_size <= maximum, 'source byte bound exceeded')
            chunks = []
            remaining = maximum + 1
            while remaining:
                chunk = os.read(file_descriptor, min(remaining, 65536))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            data = b''.join(chunks)
            after = os.fstat(file_descriptor)
            require(len(data) == before.st_size <= maximum, 'source size changed or exceeded bound')
            require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                    (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'source changed during read')
            return data
        finally:
            os.close(file_descriptor)
    finally:
        os.close(descriptor)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON key')
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError('nonfinite JSON number: ' + value)


DECODER = json.JSONDecoder(object_pairs_hook=unique_object, parse_constant=reject_constant)


def facts_object(data):
    text = data.decode('utf-8')
    markers = list(re.finditer(r'\bexport const FACTS\s*=\s*', text))
    require(len(markers) == 1, 'facts must have one literal FACTS export')
    value, end = DECODER.raw_decode(text, markers[0].end())
    require(re.fullmatch(r'\s+satisfies DestinationFacts\s*;?\s*', text[end:]) is not None,
            'facts export must be a JSON object with a DestinationFacts suffix')
    require(isinstance(value, dict), 'facts must be a JSON object')
    return value


def check_city(root, city):
    receipt_bytes = read_bounded(root, ('world', 'playable-africa-rollout', 'receipts', city + '.json'), 256 * 1024)
    receipt = DECODER.decode(receipt_bytes.decode('utf-8'))
    require(isinstance(receipt, dict) and receipt.get('cityId') == city, 'receipt city mismatch')
    assets = receipt.get('assets')
    require(isinstance(assets, dict) and set(assets) == ASSETS, 'receipt requires exactly five asset keys')
    facts = None
    for name in sorted(ASSETS):
        pin = assets[name]
        require(isinstance(pin, dict) and set(pin) == {'bytes', 'sha256'}, 'invalid asset pin fields')
        size = pin['bytes']
        digest = pin['sha256']
        require(type(size) is int and 0 < size <= 8 * 1024 * 1024, 'invalid asset byte pin')
        require(isinstance(digest, str) and SHA256.fullmatch(digest) is not None, 'invalid asset hash pin')
        data = read_bounded(root, ('src', 'game', 'cities', city, name), 8 * 1024 * 1024)
        require(len(data) == size and hashlib.sha256(data).hexdigest() == digest, 'asset bytes/hash mismatch: ' + name)
        if name == 'facts.ts':
            facts = facts_object(data)
    require(facts is not None and facts.get('id') == city, 'facts city mismatch')
    iso = receipt.get('countryIso2')
    country = facts.get('country')
    require(isinstance(iso, str) and re.fullmatch(r'[A-Z]{2}', iso) is not None, 'invalid receipt country')
    require(isinstance(country, dict) and country.get('idISOlower') == iso.lower(), 'facts country mismatch')
    if 'generationIdentity' in receipt:
        identity = receipt['generationIdentity']
        state = facts.get('state')
        require(isinstance(identity, dict) and isinstance(state, dict), 'invalid generation identity')
        require(identity.get('cityId') == city and isinstance(identity.get('stateId'), str) and
                identity['stateId'] == state.get('idunique') and isinstance(identity.get('stateName'), str) and
                identity['stateName'] == state.get('name'), 'generation identity mismatch')
    return {'city': city, 'status': 'pinned-assets-match'}


def main(cities):
    require(1 <= len(cities) <= 53 and len(set(cities)) == len(cities), 'require 1–53 unique city IDs')
    require(all(len(city) <= 64 and CITY_ID.fullmatch(city) is not None for city in cities), 'invalid city ID')
    # Verify every requested city before emitting successful rows.
    rows = [check_city(ROOT, city) for city in cities]
    for row in rows:
        print(json.dumps(row, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (OSError, ValueError, UnicodeError, RecursionError) as error:
        print('offline starter check refused: ' + str(error), file=sys.stderr)
        sys.exit(1)
