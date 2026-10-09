#!/usr/bin/env python3
"""Check the retained synthetic actor and receipt against an exact public build.

Only the original, already accepted same-spot intent is replayed. This is a
release witness, not a game-wide export or a browser acceptance check.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time


ROOT = Path(__file__).resolve().parents[2] / '.cache/world-build/evidence'
FIELDS = ('cash', 'home', 'homeOwned', 'property', 'estate', 'inventory',
          'business', 'location', 'spot')


def private_witness():
    path = ROOT / 'consolidated-synthetic-continuity-before.private.json'
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
        raise ValueError('witness is not an owned regular file')
    if info.st_mode & 0o077 or info.st_nlink != 1 or info.st_size > 1048576:
        raise ValueError('witness permissions, links or size refused')
    data = json.loads(path.read_text())
    cookie = data['cookie']
    if not isinstance(cookie, str) or any(c in cookie for c in '\r\n"\\'):
        raise ValueError('witness cookie format refused')
    action = data['action']
    if action.get('type') != 'spot' or action.get('cityId') != 'lagos':
        raise ValueError('witness is not the authorized same-spot intent')
    if action.get('payload') != {'id': data['beforeState']['spot']}:
        raise ValueError('witness spot intent differs from original state')
    stamp = int(action['actionId'].split(':', 1)[0])
    age = int(time.time() * 1000) - stamp
    if age < 0 or age >= 24 * 60 * 60 * 1000 - 90000:
        raise ValueError('original intent lacks a safe margin in its 24-hour replay window')
    if data['duplicateReceipt'].get('duplicate') is not True:
        raise ValueError('witness has no previously verified duplicate receipt')
    return data


def request(cookie, path, body=None):
    config = 'url = "https://joinallworld.com' + path + '"\n'
    config += 'header = "Cookie: ' + cookie + '"\n'
    config += 'header = "Origin: https://joinallworld.com"\n'
    if body is not None:
        config += 'request = "POST"\nheader = "Content-Type: application/json"\n'
        config += 'data = ' + json.dumps(json.dumps(body, separators=(',', ':'))) + '\n'
    result = subprocess.run(
        ['curl', '--config', '-', '--max-time', '15', '--max-filesize', '1048576',
         '--silent', '--show-error', '--write-out', '\n%{http_code}'],
        input=config, text=True, capture_output=True, timeout=20)
    text, _, status = result.stdout.rpartition('\n')
    if result.returncode or status != '200':
        raise ValueError('normal API request refused: HTTP ' + status)
    if len(text.encode()) > 1048576:
        raise ValueError('API response exceeded its bound')
    return json.loads(text)


def differences(wanted, current):
    return [key for key in FIELDS if (key in wanted) != (key in current)
            or wanted.get(key) != current.get(key)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-sha', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{40}', args.source_sha):
        parser.error('--source-sha requires an exact 40-character commit')
    expected = ('joinallworld-' + args.source_sha)[:40]
    result = {'format': 'world-consolidated-continuity-check-v1',
              'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'sourceSha': args.source_sha, 'expectedPublicBuild': expected,
              'scope': 'retained synthetic actor and original same-spot receipt only',
              'status': 'unverified', 'newActorCreated': False}
    lock = os.open(str(ROOT / 'continuity-check.lock'),
                   os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        witness = private_witness()
        cookie = witness['cookie']
        health = request(cookie, '/api/health')
        if health.get('ok') is not True or health.get('build') != expected:
            raise ValueError('named public build does not match expected source')
        session = request(cookie, '/api/session')['session']
        if session.get('id') != witness['session']['id']:
            raise ValueError('original public identity changed')
        baseline = witness['duplicateReceipt']['state']
        life = request(cookie, '/api/life?city=lagos')['state']
        changed = differences(baseline, life)
        if changed:
            result['changedFields'] = changed
            raise ValueError('stable state differs before receipt replay')
        receipt = request(cookie, '/api/action', witness['action'])
        if receipt.get('duplicate') is not True or receipt.get('ok') is not True:
            raise ValueError('original receipt was not replayed successfully')
        if receipt.get('code') != witness['receipt']['code']:
            raise ValueError('original receipt code changed')
        changed = differences(baseline, receipt.get('state', {}))
        if changed:
            result['changedFields'] = changed
            raise ValueError('stable state differs after duplicate replay')
        result.update(status='passed', sameOriginalIdentity=True,
                      sameIdReceiptDuplicate=True, stableFields=list(FIELDS),
                      privateWitnessSha256=hashlib.sha256(
                          (ROOT / 'consolidated-synthetic-continuity-before.private.json')
                          .read_bytes()).hexdigest())
    except BlockingIOError:
        os.close(lock)
        print(json.dumps({'status': 'refused', 'reason': 'another continuity check is active'}))
        return 1
    except Exception as error:
        result['reason'] = str(error) if isinstance(error, ValueError) else type(error).__name__
    result['limitations'] = ['not a game-wide export or restore',
                             'not provider full-source identity proof',
                             'not bundle, browser, reconnect or physical-phone acceptance']
    target = ROOT / 'consolidated-continuity-check-latest.json'
    temp = ROOT / ('continuity-check-' + str(os.getpid()) + '.tmp')
    try:
        fd = os.open(str(temp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as output:
            output.write(json.dumps(result, indent=2) + '\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, target)
        print(json.dumps(result))
    finally:
        os.close(lock)
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
