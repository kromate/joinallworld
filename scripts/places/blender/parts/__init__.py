"""Parts registry: every parts/*.py exports PARTS = {'part-id': fn(b, look, rng, detail, at=(x, y, z), rot=0.0, **params)}.

`REGISTRY` maps id -> function, `SOURCE` id -> file stem, `WARNINGS` lists load problems (duplicate ids, import errors, bad entries).
Files starting with `_` are helpers and skipped. Hyphenated file names are fine (loaded by path). Priority: files in alphabetical order,
the first definition of an id wins (a duplicate is a warning) and every part is also addressable as "<file-stem>/<id>" (e.g. "mosque-domed/dome"); `core.py` is always the LOWEST priority, so any other file overrides it.
List everything with `python3 scripts/places/blender/parts/list.py`.
"""
import importlib.util
import inspect
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
REGISTRY = {}
SOURCE = {}
PARAMS = {}   # id -> accepted parameter names (best effort: PART_DOC / PART_PARAMS of the file, else the signature)
DOC = {}      # id -> one-paragraph description
WARNINGS = []
STD_ARGS = ('b', 'look', 'rng', 'detail', 'at', 'rot')


def _load(path):
    stem = path.stem
    name = f'{__name__}.{stem.replace("-", "_")}'
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    try:
        spec.loader.exec_module(mod)
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return mod


def _register():
    files = sorted(p for p in HERE.glob('*.py') if not p.name.startswith('_') and p.name != 'list.py')
    files.sort(key=lambda p: p.stem == 'core')   # core last = lowest priority
    for path in files:
        try:
            mod = _load(path)
        except Exception as exc:  # noqa: BLE001 - one broken parts file must not take the others down
            WARNINGS.append(f'parts/{path.name} failed to import: {type(exc).__name__}: {exc}')
            continue
        table = getattr(mod, 'PARTS', None)
        if not isinstance(table, dict):
            WARNINGS.append(f'parts/{path.name} has no PARTS dict')
            continue
        for pid, fn in table.items():
            if not callable(fn):
                WARNINGS.append(f'parts/{path.name}: {pid!r} is not callable')
                continue
            qid = f'{path.stem}/{pid}'    # always addressable as "<file>/<id>", also when another file owns the plain id
            REGISTRY[qid] = fn
            SOURCE[qid] = path.stem
            PARAMS[qid], DOC[qid] = _describe(mod, pid, fn)
            if pid in REGISTRY:
                if SOURCE[pid] != 'core' and path.stem != 'core':
                    WARNINGS.append(f'duplicate part id {pid!r} in parts/{path.name}: plain id stays with {SOURCE[pid]}; use "{qid}" for this one')
            else:
                REGISTRY[pid] = fn
                SOURCE[pid] = path.stem
                PARAMS[pid], DOC[pid] = PARAMS[qid], DOC[qid]


def _describe(mod, pid, fn):
    """(param specs, doc). param specs: list of (name, default) -- from PART_DOC / PART_PARAMS of the file, else the signature."""
    doc = (getattr(fn, '__doc__', None) or '').strip()
    specs = None
    pd = getattr(mod, 'PART_DOC', None)
    pp = getattr(mod, 'PART_PARAMS', None)
    if isinstance(pd, dict) and pid in pd and isinstance(pd[pid], dict):
        d = pd[pid]
        doc = str(d.get('doc') or doc)
        ps = d.get('params')
        if isinstance(ps, dict):
            specs = [(k, (v[0] if isinstance(v, (tuple, list)) and v else v)) for k, v in ps.items()]
    elif isinstance(pp, dict) and isinstance(pp.get(pid), dict):
        specs = list(pp[pid].items())
    if specs is None:
        try:
            sig = inspect.signature(fn)
            specs = [(n, None if p.default is p.empty else p.default) for n, p in sig.parameters.items()
                     if n not in STD_ARGS and p.kind not in (p.VAR_KEYWORD, p.VAR_POSITIONAL)]
        except (TypeError, ValueError):
            specs = []
    for k in getattr(mod, 'LOOK_KEYS', ()):
        if k not in [n for n, _ in specs]:
            specs.append((k, None))
    return specs, doc


def get(pid):
    return REGISTRY.get(pid)


def declared_params(pid):
    """Accepted parameter names of a part; [] when unknown (then nothing is checked)."""
    return [n for n, _ in PARAMS.get(pid, [])]


_register()
