"""The fixed helper joins and releases only its inherited writer-lock reference."""
import json
import fcntl
import errno
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from index_writer_lock import IndexWriterBusy, index_writer_lease


SCRIPT = Path(__file__).resolve().parent/"index_writer_lock.py"


def identity(root):
    directory = root.lstat(); lock = (root/"writer.lock").lstat()
    return directory.st_dev, directory.st_ino, lock.st_dev, lock.st_ino


def run_helper(root, descriptor, expected=None, arguments=None):
    values = identity(root) if expected is None else expected
    args = [str(SCRIPT), "--campaign-inherited-lease", str(root), *(str(v) for v in values)]
    if arguments is not None: args = list(arguments)
    try: old_flags = fcntl.fcntl(6, fcntl.F_GETFD)
    except OSError as error:
        if error.errno != errno.EBADF: raise
        old_flags = None; saved = None
    else: saved = fcntl.fcntl(6, fcntl.F_DUPFD_CLOEXEC, 7)
    try:
        if descriptor != 6: os.dup2(descriptor, 6, inheritable=True)
        else: os.set_inheritable(6, True)
        return subprocess.run([sys.executable, "-I", "-B", *args], pass_fds=(6,),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=4, check=False)
    finally:
        if saved is None: os.close(6)
        else:
            os.dup2(saved, 6, inheritable=not bool(old_flags & fcntl.FD_CLOEXEC)); os.close(saved)


class CampaignInheritedLeaseTests(unittest.TestCase):
    def root(self, parent, name):
        path = Path(parent)/name; path.mkdir(mode=0o700); return path

    def test_same_open_description_stays_locked_until_parent_closes_final_reference(self):
        with tempfile.TemporaryDirectory(prefix="world-campaign-lease-") as temp:
            root = self.root(temp, "root")
            with index_writer_lease(root) as lease:
                result = run_helper(root, lease.descriptor)
                self.assertEqual(result.returncode, 0, result.stderr[:1024])
                self.assertEqual(result.stderr, b"")
                report = json.loads(result.stdout)
                self.assertEqual(set(report), {"format","rootDevice","rootInode","lockDevice","lockInode","helperSha256"})
                self.assertEqual(report["format"], "world-campaign-lease-ready-v1")
                self.assertEqual(result.stdout, (json.dumps(report, sort_keys=True, separators=(",", ":"))+"\n").encode())
                self.assertEqual(report["helperSha256"], __import__("hashlib").sha256(SCRIPT.read_bytes()).hexdigest())
                with self.assertRaises(IndexWriterBusy):
                    with index_writer_lease(root): pass
            with index_writer_lease(root): pass

    def test_wrong_root_or_descriptor_identity_and_malformed_arguments_have_no_ready_line(self):
        with tempfile.TemporaryDirectory(prefix="world-campaign-lease-") as temp:
            root = self.root(temp, "root"); other = self.root(temp, "other")
            with index_writer_lease(root): pass
            with index_writer_lease(other): pass
            fd = os.open(other/"writer.lock", os.O_RDWR|os.O_NONBLOCK)
            try:
                wrong = list(identity(root)); wrong[0] += 1
                result = run_helper(root, fd, expected=wrong)
                self.assertNotEqual(result.returncode, 0); self.assertEqual(result.stdout, b"")
                result = run_helper(root, fd)
                self.assertNotEqual(result.returncode, 0); self.assertEqual(result.stdout, b"")
                malformed = [str(SCRIPT), "--campaign-inherited-lease", str(root), "01", "2", "3", "4"]
                result = run_helper(root, fd, arguments=malformed)
                self.assertNotEqual(result.returncode, 0); self.assertEqual(result.stdout, b"")
                alias = Path(temp)/"root-alias"; alias.symlink_to(root, target_is_directory=True)
                result = run_helper(alias, fd)
                self.assertNotEqual(result.returncode, 0); self.assertEqual(result.stdout, b"")
            finally: os.close(fd)

    def test_helper_claims_an_unlocked_open_description_and_other_description_sees_busy(self):
        with tempfile.TemporaryDirectory(prefix="world-campaign-lease-") as temp:
            root = self.root(temp, "root")
            with index_writer_lease(root): pass
            first = os.open(root/"writer.lock", os.O_RDWR|os.O_NONBLOCK)
            other = os.open(root/"writer.lock", os.O_RDWR|os.O_NONBLOCK)
            before = identity(root)
            try:
                acquired = run_helper(root, first)
                self.assertEqual(acquired.returncode, 0, acquired.stderr[:1024])
                busy = run_helper(root, other)
                self.assertNotEqual(busy.returncode, 0); self.assertEqual(busy.stdout, b"")
                self.assertEqual(identity(root), before)
            finally: os.close(other); os.close(first)
            released = os.open(root/"writer.lock", os.O_RDWR|os.O_NONBLOCK)
            try:
                result = run_helper(root, released)
                self.assertEqual(result.returncode, 0, result.stderr[:1024])
            finally: os.close(released)

    def test_bad_named_lock_shapes_are_refused_without_mutation(self):
        with tempfile.TemporaryDirectory(prefix="world-campaign-lease-") as temp:
            for kind in ("symlink", "hardlink", "mode", "nonempty"):
                with self.subTest(kind=kind):
                    root = self.root(temp, kind)
                    with index_writer_lease(root): pass
                    lock = root/"writer.lock"; target = None
                    if kind == "symlink":
                        target = Path(temp)/(kind+"-target"); target.write_bytes(b""); target.chmod(0o600)
                        lock.unlink(); lock.symlink_to(target)
                    elif kind == "hardlink":
                        os.link(lock, Path(temp)/(kind+"-link"))
                    elif kind == "mode": lock.chmod(0o640)
                    else: lock.write_bytes(b"x")
                    fd = os.open(target if kind == "symlink" else lock, os.O_RDWR|os.O_NONBLOCK)
                    before = identity(root)
                    try:
                        result = run_helper(root, fd, expected=(root.stat().st_dev,root.stat().st_ino,
                            os.fstat(fd).st_dev,os.fstat(fd).st_ino))
                        self.assertNotEqual(result.returncode, 0); self.assertEqual(result.stdout, b"")
                        self.assertEqual(identity(root), before)
                    finally: os.close(fd)


if __name__ == "__main__": unittest.main()
