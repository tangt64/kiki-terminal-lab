import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import warnings
import zipfile

spec = importlib.util.spec_from_file_location("release_packager", Path(__file__).with_name("package.py"))
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class CommittedPackageTests(unittest.TestCase):
    def git(self, root, *args):
        return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.PIPE).decode().strip()

    def repository(self, root, version="1.0.0"):
        self.git(root, "init", "-q")
        self.git(root, "config", "core.autocrlf", "false")
        for name in packager.FILES:
            (root / name).write_bytes(b"fixture\n")
        (root / "package.json").write_text(json.dumps({"name": "kiki-terminal-lab", "version": version}), encoding="utf-8")
        (root / "server").mkdir()
        (root / "server/api.js").write_bytes(b"export const value = 1;\n")
        (root / ".env").write_bytes(b"FIXTURE_ONLY=not-a-secret\n")
        self.git(root, "add", "--all")
        self.git(root, "-c", "user.name=Release fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "fixture")
        return self.git(root, "rev-parse", "HEAD")

    def test_zip_uses_committed_blobs_and_excludes_dirty_untracked_and_secret_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = self.repository(root)
            (root / "server/api.js").write_bytes(b"uncommitted edit\n")
            (root / "server/untracked.js").write_bytes(b"untracked\n")
            archive, _ = packager.package_commit(reference, root)
            with zipfile.ZipFile(archive) as stream:
                self.assertEqual(stream.read("kiki-terminal-lab/server/api.js"), b"export const value = 1;\n")
                self.assertNotIn("kiki-terminal-lab/.env", stream.namelist())
                self.assertNotIn("kiki-terminal-lab/server/untracked.js", stream.namelist())
            self.assertEqual(packager.verify_archive(archive, reference, root)["commit"], reference)

    def test_same_commit_is_reproducible_despite_worktree_timestamps(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = self.repository(root)
            archive, digest = packager.package_commit(reference, root)
            original = archive.read_bytes()
            archive.unlink()
            archive.with_suffix(".zip.sha256").unlink()
            os.utime(root / "server/api.js", (1000000000, 1000000000))
            repeated, repeated_digest = packager.package_commit(reference, root)
            self.assertEqual(repeated.read_bytes(), original)
            self.assertEqual(repeated_digest, digest)

    def test_changed_source_with_a_forged_manifest_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = self.repository(root)
            archive, _ = packager.package_commit(reference, root)
            with zipfile.ZipFile(archive) as stream:
                bodies = {name: stream.read(name) for name in stream.namelist()}
            name = "kiki-terminal-lab/server/api.js"
            bodies[name] = b"changed source\n"
            manifest = json.loads(bodies["kiki-terminal-lab/SHA256SUMS.json"])
            manifest["server/api.js"] = hashlib.sha256(bodies[name]).hexdigest()
            bodies["kiki-terminal-lab/SHA256SUMS.json"] = json.dumps(manifest).encode()
            altered = root / "altered.zip"
            with zipfile.ZipFile(altered, "w") as stream:
                for name, body in bodies.items():
                    stream.writestr(name, body)
            with self.assertRaisesRegex(ValueError, "committed source"):
                packager.verify_archive(altered, reference, root)

    def test_additional_zip_paths_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = self.repository(root)
            archive, _ = packager.package_commit(reference, root)
            with zipfile.ZipFile(archive, "a") as stream:
                stream.writestr("kiki-terminal-lab/../../outside", b"not permitted")
            with self.assertRaisesRegex(ValueError, "inventory"):
                packager.verify_archive(archive, reference, root)

    def test_duplicate_zip_entries_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = self.repository(root)
            archive, _ = packager.package_commit(reference, root)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with zipfile.ZipFile(archive, "a") as stream:
                    stream.writestr("kiki-terminal-lab/server/api.js", b"duplicate")
            with self.assertRaisesRegex(ValueError, "inventory"):
                packager.verify_archive(archive, reference, root)

    def test_existing_version_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = self.repository(root)
            archive, _ = packager.package_commit(reference, root)
            original = archive.read_bytes()
            with self.assertRaises(FileExistsError):
                packager.package_commit(reference, root)
            self.assertEqual(archive.read_bytes(), original)

    def test_wrong_commit_is_rejected_even_when_the_version_is_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = self.repository(root)
            archive, _ = packager.package_commit(reference, root)
            (root / "server/api.js").write_bytes(b"next commit\n")
            self.git(root, "add", "server/api.js")
            self.git(root, "-c", "user.name=Release fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "next")
            with self.assertRaisesRegex(ValueError, "committed source"):
                packager.verify_archive(archive, self.git(root, "rev-parse", "HEAD"), root)

    def test_unsafe_versions_and_symbolic_references_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = self.repository(root, version="../../outside")
            with self.assertRaisesRegex(ValueError, "version"):
                packager.package_commit(reference, root)
            with self.assertRaisesRegex(ValueError, "commit hash"):
                packager.committed_sources("HEAD", root)


if __name__ == "__main__":
    unittest.main()
