"""Fixed actual SIGKILL witnesses at durable admission boundaries."""
import os
from pathlib import Path
import signal
import sys

sys.path.insert(0, str(Path(__file__).resolve(strict=True).parent))
from index_admission_worker import run_admission
from index_registry_worker import _runtime_environment


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in {"reserved", "binding-published"}:
        raise ValueError("admission witness requires one fixed boundary")
    root, budget, lease = _runtime_environment()
    selected = sys.argv[1]
    def boundary(name):
        if name == selected: os.kill(os.getpid(), signal.SIGKILL)
    run_admission(root, budget, lease, boundary)
    raise RuntimeError("admission witness did not reach its fixed boundary")


if __name__ == "__main__": raise SystemExit(main())
