"""Fixed controller-death descriptor witness; no SQL/network/reservation writes.

The bounded fixture alone acknowledges via one fixed private snapshot file. This
worker is not selected by the production registry startup API or any job payload.
"""
import json
import os
from pathlib import Path
import resource
import stat
import sys
import time

HERE = Path(__file__).resolve(strict=True).parent
sys.path.insert(0, str(HERE))
from index_registry_worker import _runtime_environment
from index_reservations import DATABASE_BYTES


def main():
    if len(sys.argv) != 1:
        raise ValueError("fixed registry witness accepts no arguments")
    root, _, lease = _runtime_environment()
    file_limit = resource.getrlimit(resource.RLIMIT_FSIZE)[0]
    cpu_limit = resource.getrlimit(resource.RLIMIT_CPU)[0]
    if (file_limit == resource.RLIM_INFINITY or not 0 < file_limit <= DATABASE_BYTES
            or cpu_limit == resource.RLIM_INFINITY or not 0 < cpu_limit <= 60
            or resource.getrlimit(resource.RLIMIT_CORE) != (0, 0)):
        raise RuntimeError("fixed witness did not inherit kernel limits")
    execution = HERE.parent.parent
    print(json.dumps({"pid": os.getpid(), "namespace": str(root), "device": lease.device,
                      "inode": lease.inode, "executionRoot": str(execution),
                      "fileLimit": file_limit, "cpuLimit": cpu_limit, "coreLimit": 0}), flush=True)
    deadline = time.monotonic() + 10
    release = execution/"lease.release"
    while time.monotonic() < deadline:
        try: descriptor = os.open(release, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            time.sleep(0.02); continue
        try:
            info = os.fstat(descriptor); named = release.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
                    or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size != 1
                    or (info.st_dev, info.st_ino) != (named.st_dev, named.st_ino)
                    or os.read(descriptor, 2) != b"X"):
                raise ValueError("fixed private acknowledgement differs")
            return 0
        finally: os.close(descriptor)
    raise RuntimeError("fixed witness exceeded its bounded acknowledgement wait")


if __name__ == "__main__": raise SystemExit(main())
