#!/usr/bin/env python3
"""Wait for the RSS monitor's positive bootstrap sample, then run exact argv."""
import json
import os
import subprocess
import sys


def main() -> int:
    if len(sys.argv) != 2:
        return 125
    try:
        ready_fd = int(os.environ["MONITOR_READY_FD"])
        gate_fd = int(os.environ["MONITOR_GATE_FD"])
        argv = json.loads(sys.argv[1])
        if not isinstance(argv, list) or not argv or not all(isinstance(arg, str) for arg in argv):
            return 125
        os.write(ready_fd, b"R")
        os.close(ready_fd)
        if os.read(gate_fd, 1) != b"G":
            return 125
        os.close(gate_fd)
        child = subprocess.Popen(argv, close_fds=True)
        return child.wait()
    except (KeyError, OSError, ValueError, TypeError, json.JSONDecodeError):
        return 125


if __name__ == "__main__":
    raise SystemExit(main())
