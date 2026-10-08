import pathlib
import sys
import tarfile

archive, destination = sys.argv[1:]
root = pathlib.Path(destination)
root.mkdir()
with tarfile.open(archive) as source:
    members = source.getmembers()
    # Current street packs: about 5,850 entries and 90 MB including the Worker.
    # Keep a bounded archive and enforce the same 5 MiB per-file ceiling as the package guard.
    if len(members) > 6500 or sum(item.size for item in members) > 100 * 1024 * 1024 or any(item.size > 5 * 1024 * 1024 for item in members):
        raise ValueError('Package size limit')
    for item in members:
        path = pathlib.PurePosixPath(item.name)
        if path.is_absolute() or '..' in path.parts or not (item.isfile() or item.isdir()):
            raise ValueError('Unsafe package entry')
    source.extractall(root, members=members, filter='data')
