#!/usr/bin/env python3
"""Read-only verification that source packets match blobs in an exact Git commit."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys


MAX_PACKET_BYTES = 1_048_576
MAX_BLOB_BYTES = 16_777_216
GIT_TIMEOUT_SECONDS = 10
SHA1 = re.compile(r'[a-f0-9]{40}\Z')
SHA256 = re.compile(r'[a-f0-9]{64}\Z')


class PacketError(ValueError):
    def __init__(self, message, path=None):
        super().__init__(message)
        self.path = path


def normalized_path(value):
    if not isinstance(value, str) or not value or value.startswith('/') or '\\' in value or ':' in value:
        raise PacketError('path must be normalized and relative', value if isinstance(value, str) else None)
    if len(value.encode('utf-8')) > 4096 or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise PacketError('path length or characters are refused', value)
    path = PurePosixPath(value)
    if path.is_absolute() or path.as_posix() != value or any(part in ('', '.', '..') for part in value.split('/')):
        raise PacketError('path must be normalized and relative', value)
    return value


def read_packets(packet_paths, packet_hashes):
    pins = {}
    for packet_arg in packet_paths:
        packet_path = Path(packet_arg)
        try:
            descriptor = os.open(packet_path, os.O_RDONLY | os.O_NONBLOCK | getattr(os, 'O_NOFOLLOW', 0))
            with os.fdopen(descriptor, 'rb') as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode):
                    raise PacketError('packet must be a regular non-symlink file')
                if info.st_size > MAX_PACKET_BYTES:
                    raise PacketError('packet exceeds the 1 MiB limit')
                raw = stream.read(MAX_PACKET_BYTES + 1)
        except OSError as error:
            raise PacketError(f'cannot read packet: {type(error).__name__}') from None
        if len(raw) > MAX_PACKET_BYTES:
            raise PacketError('packet exceeds the 1 MiB limit')
        packet_hashes.append(hashlib.sha256(raw).hexdigest())
        try:
            packet = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise PacketError('packet is not valid UTF-8 JSON') from None
        if not isinstance(packet, dict) or type(packet.get('schemaVersion')) is not int or packet['schemaVersion'] != 1:
            raise PacketError('packet schemaVersion must be integer 1')
        entries = packet.get('sourceFiles')
        if not isinstance(entries, list) or not entries:
            raise PacketError('packet sourceFiles must be a non-empty array')
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) != {'path', 'bytes', 'sha256'}:
                raise PacketError('each sourceFiles entry must contain exactly path, bytes and sha256')
            path = normalized_path(entry['path'])
            size, digest = entry['bytes'], entry['sha256']
            if type(size) is not int or size < 0 or size > MAX_BLOB_BYTES:
                raise PacketError('pinned blob bytes must be an integer from 0 through 16 MiB', path)
            if not isinstance(digest, str) or not SHA256.fullmatch(digest):
                raise PacketError('pinned blob sha256 must be 64 lowercase hexadecimal characters', path)
            if path in pins:
                raise PacketError('duplicate source path across packet pins', path)
            pins[path] = {'bytes': size, 'sha256': digest}
    return pins


def git(target, *args, max_stdout=4096):
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    env.update(GIT_NO_LAZY_FETCH='1', GIT_OPTIONAL_LOCKS='0', GIT_TERMINAL_PROMPT='0')
    try:
        result = subprocess.run(
            ['git', '-C', str(target), *args], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=GIT_TIMEOUT_SECONDS,
            check=False, env=env,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise PacketError(f'git command failed: {type(error).__name__}') from None
    if len(result.stdout) > max_stdout:
        raise PacketError('git command output exceeded its bound')
    if result.returncode != 0:
        raise PacketError('git could not read the requested commit or blob')
    return result.stdout


def resolve_target(target_arg, ref):
    if not SHA1.fullmatch(ref):
        raise PacketError('--ref must be an exact 40-character lowercase commit SHA')
    target = Path(target_arg).resolve(strict=True)
    if not target.is_dir():
        raise PacketError('--target must name a Git working tree directory')
    top = git(target, 'rev-parse', '--show-toplevel').decode('utf-8', 'strict').strip()
    if Path(top).resolve() != target:
        raise PacketError('--target must be the Git worktree root')
    resolved = git(target, 'rev-parse', '--verify', '--end-of-options', f'{ref}^{{commit}}').decode('ascii', 'strict').strip()
    if resolved != ref:
        raise PacketError('--ref did not resolve to that exact commit SHA')
    return target


def verify_blob(target, ref, path, pin):
    listing = git(target, 'ls-tree', '-z', ref, '--', f':(top,literal){path}', max_stdout=8192)
    records = listing.split(b'\0')
    if records[-1:] == [b'']:
        records.pop()
    if len(records) != 1 or b'\t' not in records[0]:
        raise PacketError('source path is missing at the target commit', path)
    header, committed_path = records[0].split(b'\t', 1)
    try:
        mode, object_type, _object_id = header.decode('ascii').split(' ')
        decoded_path = committed_path.decode('utf-8', 'strict')
    except (UnicodeDecodeError, ValueError):
        raise PacketError('git returned an invalid tree entry', path) from None
    if decoded_path != path or mode not in ('100644', '100755') or object_type != 'blob':
        raise PacketError('source path is not a regular committed file', path)
    object_name = f'{ref}:{path}'
    try:
        size_text = git(target, 'cat-file', '-s', object_name, max_stdout=128).decode('ascii', 'strict').strip()
    except UnicodeDecodeError:
        raise PacketError('git returned an invalid blob size', path) from None
    if not size_text.isdecimal():
        raise PacketError('source path is missing or is not a blob at the target commit', path)
    actual_size = int(size_text)
    if actual_size > MAX_BLOB_BYTES:
        raise PacketError('committed blob exceeds the 16 MiB limit', path)
    if actual_size != pin['bytes']:
        raise PacketError(f'byte count mismatch: packet {pin["bytes"]}, commit {actual_size}', path)
    blob = git(target, 'cat-file', 'blob', object_name, max_stdout=MAX_BLOB_BYTES)
    if len(blob) != actual_size:
        raise PacketError('git blob output length differs from its object size', path)
    digest = hashlib.sha256(blob).hexdigest()
    if digest != pin['sha256']:
        raise PacketError(f'sha256 mismatch: packet {pin["sha256"]}, commit {digest}', path)


def check(args):
    result = {
        'format': 'world-source-packet-check-v1',
        'targetSha': None,
        'packetSha256': [],
        'selectedPaths': [],
        'omittedPaths': [],
        'mismatches': [],
        'passed': False,
        'sourceIdentity': False,
        'releaseReady': False,
        'scope': {
            'included': ['sourceIdentity'],
            'excluded': ['build', 'tests', 'provider', 'runtime', 'deployment', 'production-open-countries'],
        },
    }
    try:
        target = resolve_target(args.target, args.ref)
        result['targetSha'] = args.ref
        pins = read_packets(args.packet, result['packetSha256'])
        selected_args = args.path or []
        selected = [normalized_path(path) for path in selected_args] if selected_args else list(pins)
        if len(set(selected)) != len(selected):
            raise PacketError('duplicate --path selection')
        undeclared = sorted(set(selected) - pins.keys())
        if undeclared:
            raise PacketError('--path selection is not declared by the packet: ' + ', '.join(undeclared))
        selected_set = set(selected)
        result['selectedPaths'] = sorted(selected_set)
        result['omittedPaths'] = sorted(set(pins) - selected_set)
        for path in result['selectedPaths']:
            try:
                verify_blob(target, args.ref, path, pins[path])
            except PacketError as error:
                result['mismatches'].append({'path': error.path or path, 'reason': str(error)})
        result['passed'] = not result['mismatches']
        result['sourceIdentity'] = result['passed']
    except (OSError, UnicodeError, PacketError) as error:
        result['mismatches'].append({'path': getattr(error, 'path', None), 'reason': str(error)})
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True, help='Git worktree root to inspect')
    parser.add_argument('--ref', required=True, help='exact 40-character commit SHA')
    parser.add_argument('--packet', action='append', required=True, help='schemaVersion 1 source packet JSON; repeatable')
    parser.add_argument('--path', action='append', help='select one declared source path; repeatable')
    args = parser.parse_args(argv)
    result = check(args)
    print(json.dumps(result, sort_keys=True))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
