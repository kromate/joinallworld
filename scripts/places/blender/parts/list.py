#!/usr/bin/env python3
"""List every registered part (id, source file, parameters, docstring) WITHOUT Blender.

    python3 scripts/places/blender/parts/list.py            # human readable
    python3 scripts/places/blender/parts/list.py --json     # {"parts": {id: {file, params: [{name, default}], doc}}, "warnings": []}
    python3 scripts/places/blender/parts/list.py wall       # only ids containing "wall"

The real registry (parts/__init__.py) is imported with stub `bpy`/`mathutils` modules, so parts files that register themselves
dynamically are listed exactly as the composer sees them. Needs no Blender and works with any python3 >= 3.8.
"""
import json
import sys
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent


def load():
    for m in ('bpy', 'mathutils', 'mathutils.geometry', 'bpy_extras', 'bpy_extras.object_utils'):
        if m not in sys.modules:
            sys.modules[m] = mock.MagicMock()
    sys.path.insert(0, str(HERE.parent))
    import parts  # noqa: E402
    out = {}
    for pid in sorted(parts.REGISTRY):
        alias = '/' in pid and parts.SOURCE.get(pid.split('/', 1)[1]) == parts.SOURCE[pid]   # "<file>/<id>" of a part that owns its plain id
        out[pid] = {
            'alias': alias,
            'file': parts.SOURCE[pid],
            'params': [{'name': n, 'default': d if isinstance(d, (int, float, str, bool, list, tuple, type(None))) else repr(d)}
                       for n, d in parts.PARAMS.get(pid, [])],
            'doc': parts.DOC.get(pid, ''),
        }
    return out, list(parts.WARNINGS)


def main(argv):
    as_json = '--json' in argv
    filt = [a for a in argv if not a.startswith('--')]
    try:
        parts, warnings = load()
    except Exception as exc:  # noqa: BLE001
        print(f'could not load the registry: {type(exc).__name__}: {exc}', file=sys.stderr)
        return 1
    if as_json:
        print(json.dumps({'parts': parts, 'warnings': warnings}, indent=1))
        return 0
    for pid, p in parts.items():
        if p.get('alias'):
            continue   # qualified alias of a part that owns its plain id: still valid in specs, not listed twice
        if filt and not any(f in pid for f in filt):
            continue
        sig = ', '.join(x['name'] + ('' if x['default'] is None else f"={x['default']!r}") for x in p['params'])
        print(f'{pid:<20} [{p["file"]}]  ({sig})')
        first = p['doc'].strip().splitlines()[0] if p['doc'].strip() else ''
        if first:
            print(f'    {first[:160]}')
    print(f'\n{len(parts)} parts', file=sys.stderr)
    for w in warnings:
        print('warning:', w, file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
