import importlib.util
from pathlib import Path
import tempfile
import sys
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
spec = importlib.util.spec_from_file_location("build", ROOT / "scripts/build.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class RuntimeArchiveTest(unittest.TestCase):
    def test_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / "bad.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("../escaped", "bad")
            with self.assertRaises(ValueError):
                build.extract_runtime(archive, Path(temp) / "runtime")
            self.assertFalse((Path(temp) / "escaped").exists())

    def test_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / "bad.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                item = zipfile.ZipInfo("link")
                item.external_attr = 0o120777 << 16
                bundle.writestr(item, "/etc/passwd")
            with self.assertRaises(ValueError):
                build.extract_runtime(archive, Path(temp) / "runtime")

    def test_digest_matches_known_sha256(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "file"
            source.write_bytes(b"abc")
            self.assertEqual(build.digest(source),
                             "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")


if __name__ == "__main__":
    unittest.main()
