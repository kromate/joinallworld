"""Serial lock fixtures. Own temporary directories only; no index/ledger writes."""
from contextlib import contextmanager
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile
import unittest

from index_writer_lock import IndexWriterBusy, index_writer_lease


@contextmanager
def private_root():
    with tempfile.TemporaryDirectory(prefix="allworld-index-lock-fixture-") as temporary:
        root = Path(temporary).resolve(strict=True)
        root.chmod(0o700)
        yield root


class IndexWriterLockTests(unittest.TestCase):
    def test_release_retains_one_empty_inode_and_allows_reacquisition(self):
        with private_root() as root:
            with index_writer_lease(root) as first:
                original = (first.device, first.inode)
                self.assertEqual(os.fstat(first.descriptor).st_size, 0)
            self.assertTrue((root / "writer.lock").exists())
            with index_writer_lease(root) as second:
                self.assertEqual((second.device, second.inode), original)

    def test_contender_fails_without_deleting_or_replacing_active_inode(self):
        with private_root() as root:
            with index_writer_lease(root) as first:
                with self.assertRaises(IndexWriterBusy), index_writer_lease(root):
                    self.fail("second writer entered")
                self.assertEqual((root / "writer.lock").stat().st_ino, first.inode)

    def test_duplicated_reference_keeps_lease_after_original_context_closes(self):
        with private_root() as root:
            duplicate = None
            try:
                with index_writer_lease(root) as lease:
                    duplicate = os.dup(lease.descriptor)
                with self.assertRaises(IndexWriterBusy), index_writer_lease(root):
                    self.fail("original close unlocked its live duplicate")
            finally:
                if duplicate is not None:
                    os.close(duplicate)
            with index_writer_lease(root):
                pass

    def test_exception_releases_reference_without_removing_inode(self):
        with private_root() as root:
            with self.assertRaisesRegex(RuntimeError, "fixture interruption"):
                with index_writer_lease(root):
                    raise RuntimeError("fixture interruption")
            with index_writer_lease(root):
                self.assertEqual((root / "writer.lock").stat().st_size, 0)

    def test_fixed_child_inherits_lease_until_its_descriptor_closes(self):
        with private_root() as root:
            child = None
            try:
                with index_writer_lease(root) as lease:
                    # Fixed fixture code only; inherited fd stays open while the
                    # parent closes its own reference. No database/network access.
                    child = subprocess.Popen([sys.executable, "-I", "-c",
                        "import os,sys; os.write(1,b'R'); os.read(0,1); os.close(int(sys.argv[1]))",
                        str(lease.descriptor)], pass_fds=(lease.descriptor,),
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    self.assertTrue(select.select([child.stdout], [], [], 3)[0], "child did not confirm readiness")
                    self.assertEqual(child.stdout.read(1), b"R")
                with self.assertRaises(IndexWriterBusy), index_writer_lease(root):
                    self.fail("parent reference close unlocked the live child")
                stdout, stderr = child.communicate(b"X", timeout=3)
                self.assertEqual((child.returncode, stdout, stderr), (0, b"", b""))
                with index_writer_lease(root):
                    pass
            finally:
                if child is not None:
                    if child.poll() is None:
                        child.kill()
                    child.communicate(timeout=3)

    def test_relative_and_symlink_directory_roots_are_refused(self):
        with private_root() as root:
            alias = root / "alias"
            alias.symlink_to(root, target_is_directory=True)
            for bad in [Path("relative"), alias]:
                with self.subTest(root=bad), self.assertRaises((ValueError, FileNotFoundError)), index_writer_lease(bad):
                    self.fail("noncanonical root entered")
            self.assertFalse((root / "writer.lock").exists())

    def test_nonprivate_root_is_refused_before_creating_lock(self):
        with private_root() as root:
            root.chmod(0o755)
            with self.assertRaisesRegex(ValueError, "0700"), index_writer_lease(root):
                self.fail("nonprivate root entered")
            self.assertFalse((root / "writer.lock").exists())

    def test_lock_symlink_never_touches_its_target(self):
        with private_root() as root:
            target = root / "preserved"
            target.write_bytes(b"preserved")
            (root / "writer.lock").symlink_to(target)
            with self.assertRaises((OSError, ValueError)), index_writer_lease(root):
                self.fail("lock symlink entered")
            self.assertEqual(target.read_bytes(), b"preserved")

    def test_hardlinked_lock_is_refused(self):
        with private_root() as root:
            target = root / "original"
            target.touch(mode=0o600)
            os.link(target, root / "writer.lock")
            with self.assertRaisesRegex(ValueError, "one link"), index_writer_lease(root):
                self.fail("hardlinked lock entered")
            self.assertEqual(target.stat().st_nlink, 2)

    def test_nonempty_or_nonprivate_lock_is_refused_and_preserved(self):
        for content, mode in [(b"pid:stale", 0o600), (b"", 0o644)]:
            with private_root() as root:
                lock = root / "writer.lock"
                lock.write_bytes(content); lock.chmod(mode)
                with self.assertRaisesRegex(ValueError, "private empty"), index_writer_lease(root):
                    self.fail("unknown lock state entered")
                self.assertEqual(lock.read_bytes(), content)
                self.assertEqual(lock.stat().st_mode & 0o777, mode)


if __name__ == "__main__":
    unittest.main()
