import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("community_installer", Path(__file__).with_name("install.py"))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
pack_spec = importlib.util.spec_from_file_location("community_packager", Path(__file__).with_name("package.py"))
packager = importlib.util.module_from_spec(pack_spec)
pack_spec.loader.exec_module(packager)


class InstallerTests(unittest.TestCase):
    def test_optional_ssh_sources_require_cidrs_and_have_no_default_hosts(self):
        self.assertEqual(installer.validate_source_cidrs(""), "")
        self.assertEqual(installer.validate_source_cidrs("192.0.2.10/32,2001:db8::10/128,192.0.2.10/32"), "192.0.2.10/32,2001:db8::10/128")
        for value in ("192.0.2.10", "192.0.2.10/33", "2001:db8::10/129", "not-a-network"):
            with self.assertRaises(ValueError):
                installer.validate_source_cidrs(value)

    def args(self, directory):
        return SimpleNamespace(state_dir=directory, engine="podman", public_url="http://localhost:4080", port=4080, bind="127.0.0.1")

    def test_plan_is_read_only_and_scoped_to_community(self):
        with tempfile.TemporaryDirectory() as directory:
            plan = installer.Installer(self.args(directory)).plan()
            self.assertEqual(plan["product"], "terminal-lab-community")
            self.assertEqual(list(Path(directory).iterdir()), [])
            self.assertNotIn("password", json.dumps(plan).lower())

    def test_unowned_container_is_never_adopted(self):
        with tempfile.TemporaryDirectory() as directory:
            instance = installer.Installer(self.args(directory))
            instance.state = {"id": "community-test"}
            instance.run = lambda *args, **kwargs: subprocess.CompletedProcess(args, 0, stdout=b'[{"Config":{"Labels":{"other":"production"}}}]')
            with self.assertRaisesRegex(RuntimeError, "unowned"):
                instance.owned("container", "original-terminal-lab")

    def test_app_uses_dedicated_network_and_only_selected_port(self):
        with tempfile.TemporaryDirectory() as directory:
            instance = installer.Installer(self.args(directory))
            instance.state = {"id": "test", "app": "tl-community-test-app", "network": "tl-community-test-net", "data_volume": "tl-community-test-appdata", "image": "community:test", "bind": "127.0.0.1", "port": 4080}
            arguments = list(map(str, instance.app_arguments()))
            self.assertIn("127.0.0.1:4080:4080", arguments)
            self.assertIn("tl-community-test-net", arguments)
            self.assertIn("tl-community-test-appdata:/app/data", arguments)
            self.assertNotIn("5432:5432", " ".join(arguments))

    def test_public_origin_rejects_credentials_and_extra_paths(self):
        for value in ("file:///etc/passwd", "https://user:password@example.com", "https://example.com/admin"):
            with self.assertRaises(ValueError):
                installer.validate_url(value)

    def test_state_and_env_files_are_replaced_only_by_explicit_write(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "app.env"
            installer.write_private(target, "SECRET=example\n")
            self.assertEqual(target.read_text(), "SECRET=example\n")

    def test_distribution_excludes_live_secrets_database_and_parent_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in packager.FILES:
                (root / name).write_text("example", encoding="utf-8")
            for name in (".env", "runtime/deployment/app.env", "secrets/clouds.yaml", "data/database.json", "node_modules/package/index.js", "server/api.js", "platform/client/src/curriculum-2026-data.js"):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("sentinel", encoding="utf-8")
            included = {p.relative_to(root).as_posix() for p in packager.source_files(root)}
            self.assertIn("server/api.js", included)
            self.assertNotIn(".env", included)
            self.assertNotIn("secrets/clouds.yaml", included)
            self.assertNotIn("runtime/deployment/app.env", included)
            self.assertNotIn("data/database.json", included)
            self.assertNotIn("node_modules/package/index.js", included)
            self.assertNotIn("platform/client/src/curriculum-2026-data.js", included)


if __name__ == "__main__":
    unittest.main()
