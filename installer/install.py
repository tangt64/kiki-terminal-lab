#!/usr/bin/env python3
"""Install only KIKI OS TERMINAL-LAB and its private PostgreSQL instance.

No OS installation, OpenStack deployment or parent project operations are performed.
Python 3.9+, Docker or rootless Podman. Inspect with `plan` before installation.
"""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import time
from urllib.parse import urlparse
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
LABEL = "io.kikios.terminal-lab.installation"
LEGACY_LABEL = "io.terminallab.community.installation"
LEGACY_PRODUCT = "terminal-lab-community"
RELEASE = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
PRODUCT = RELEASE["name"]
VERSION = RELEASE["version"]


def write_private(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
        stream.write(value)
    os.chmod(path, 0o600)


def validate_url(value):
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("public-url must be an HTTP(S) origin")
    return value.rstrip("/")


def validate_source_cidrs(value):
    entries = list(dict.fromkeys(part.strip() for part in value.split(",") if part.strip()))
    for entry in entries:
        if "/" not in entry:
            raise ValueError("SSH sources must be explicit IPv4/IPv6 CIDRs")
        ipaddress.ip_network(entry, strict=False)
    return ",".join(entries)


class Installer:
    def __init__(self, args):
        self.args = args
        self.state_dir = Path(args.state_dir).resolve()
        self.state_file = self.state_dir / "deployment.json"
        self.state = json.loads(self.state_file.read_text(encoding="utf-8")) if self.state_file.exists() else None
        self.engine = self.state["engine"] if self.state else args.engine

    @property
    def label(self):
        # Old deployment files keep their original ownership boundary.
        label = self.state.get("ownership_label", LEGACY_LABEL) if self.state else LABEL
        if label not in (LABEL, LEGACY_LABEL):
            raise ValueError("Unknown installation ownership label")
        return label

    def run(self, *args, check=True, stdout=subprocess.PIPE):
        result = subprocess.run([self.engine, *map(str, args)], check=False, stdout=stdout, stderr=subprocess.PIPE)
        if check and result.returncode:
            # Engine errors may contain secrets from runtime configuration: do not echo full output.
            raise RuntimeError(f"{self.engine} {args[0]} failed ({result.returncode}). Inspect the named KIKI containers with the engine CLI.")
        return result

    def save(self):
        write_private(self.state_file, json.dumps(self.state, indent=2) + "\n")

    def owned(self, kind, name):
        result = self.run(kind, "inspect", name, check=False)
        if result.returncode:
            return False
        data = json.loads(result.stdout)[0]
        labels = data.get("Labels") or data.get("Config", {}).get("Labels") or {}
        if labels.get(self.label) != self.state["id"]:
            raise RuntimeError(f"Refusing to modify an unowned {kind}: {name}")
        return True

    def plan(self):
        return {"product": PRODUCT, "version": VERSION, "engine": self.engine,
                "state_dir": str(self.state_dir), "public_url": validate_url(self.args.public_url),
                "host_port": self.args.port, "bind": self.args.bind,
                "ssh_source_cidrs": validate_source_cidrs(getattr(self.args, "ssh_source_cidrs", "")),
                "validation_network": getattr(self.args, "validation_network", ""),
                "actions": ["build independent application image", "create separately labelled network, database volume and application-data volume",
                            "start PostgreSQL without a published database port", "start KIKI OS TERMINAL-LAB on the selected free port",
                            "check /api/health", "write optional user-systemd Quadlet files"],
                "requirements": ["existing OpenStack", "clouds.yaml for a service account allowed to create dedicated projects", "Docker or rootless Podman", "network for npm and container images unless preloaded"],
                "original_terminal_lab": "no access or modifications"}

    def check_port(self):
        if self.args.bind not in ("127.0.0.1", "0.0.0.0"):
            raise ValueError("bind must be 127.0.0.1 or 0.0.0.0")
        with socket.socket() as probe:
            probe.bind((self.args.bind, self.args.port))

    def install(self):
        if self.state:
            raise RuntimeError("Installation already exists. Use start or update; existing secrets are never overwritten.")
        if not shutil.which(self.engine):
            raise RuntimeError(f"{self.engine} is not available")
        self.check_port()
        public_url = validate_url(self.args.public_url)
        cloud = Path(self.args.clouds).resolve() if self.args.clouds else None
        if not cloud or not cloud.is_file():
            raise ValueError("--clouds must point to an existing clouds.yaml; only a private copy is installed")
        if self.args.username == "" or not self.args.username.isascii() or not self.args.username.replace("-", "").replace("_", "").isalnum():
            raise ValueError("username must contain ASCII letters, numbers, hyphens or underscores")
        install_id = secrets.token_hex(6)
        prefix = PRODUCT + "-" + install_id
        self.state = {"product": PRODUCT, "ownership_label": LABEL, "service_prefix": PRODUCT, "id": install_id, "engine": self.engine, "prefix": prefix, "version": VERSION,
                      "network": prefix + "-net", "volume": prefix + "-pgdata", "data_volume": prefix + "-appdata", "database": prefix + "-db",
                      "app": prefix + "-app", "image": prefix + f"-app:{VERSION}", "public_url": public_url,
                      "port": self.args.port, "bind": self.args.bind, "stage": "prepared",
                      "tcp_forwarding": self.args.enable_tcp_forwarding, "tcp_port_start": self.args.tcp_port_start,
                      "tcp_port_end": self.args.tcp_port_end, "tcp_bind": self.args.bind}
        password = secrets.token_urlsafe(24)
        database_password = secrets.token_urlsafe(32)
        self.save()
        write_private(self.state_dir / "database.env", f"POSTGRES_USER=community\nPOSTGRES_DB=community\nPOSTGRES_PASSWORD={database_password}\n")
        app_env = {"DATABASE_URL": f"postgresql://community:{database_password}@{self.state['database']}:5432/community",
                   "SESSION_SECRET": secrets.token_hex(48), "CREDENTIAL_KEY": secrets.token_hex(32),
                   "INITIAL_ADMIN_USERNAME": self.args.username, "INITIAL_ADMIN_PASSWORD": password,
                   "INITIAL_ADMIN_NAME": "Administrator", "PUBLIC_URL": public_url,
                   "OPENSTACK_CLOUDS_YAML": "/app/secrets/clouds.yaml", "OPENSTACK_CLOUD_NAME": self.args.cloud_name,
                   "OPENSTACK_SERVICE_PROJECT_NAME": self.args.service_project,
                   "OPENSTACK_INTERFACE": "public", "OPENSTACK_PREFER_INTERNAL_ENDPOINTS": "0", "TRUST_PROXY": "1" if self.args.trust_proxy else "0",
                   "PUBLIC_BASE_DOMAIN": self.args.public_base_domain, "SSH_PUBLIC_HOST": self.args.ssh_public_host,
                   "COMMUNITY_SSH_SOURCE_CIDRS": validate_source_cidrs(getattr(self.args, "ssh_source_cidrs", "")),
                   "COMMUNITY_VALIDATION_NETWORK": getattr(self.args, "validation_network", ""),
                   "TCP_FORWARDING_ENABLED": "1" if self.args.enable_tcp_forwarding else "0",
                   "TCP_PORT_START": self.args.tcp_port_start, "TCP_PORT_END": self.args.tcp_port_end}
        if self.args.ca:
            app_env["OPENSTACK_CA_CERT"] = "/app/secrets/openstack-ca.crt"
            write_private(self.state_dir / "secrets" / "openstack-ca.crt", Path(self.args.ca).read_text(encoding="utf-8"))
        write_private(self.state_dir / "app.env", "".join(f"{k}={v}\n" for k, v in app_env.items()))
        write_private(self.state_dir / "initial-admin.txt", f"username={self.args.username}\npassword={password}\n")
        write_private(self.state_dir / "secrets" / "clouds.yaml", cloud.read_text(encoding="utf-8"))
        # The image uses UID 1000; mount files remain private to the invoking user.
        if os.name != "nt":
            for file in (self.state_dir / "secrets").iterdir():
                os.chmod(file, 0o644)
            os.chmod(self.state_dir / "secrets", 0o700)
        self.build()
        self.run("network", "create", "--label", f"{self.label}={install_id}", self.state["network"])
        self.run("volume", "create", "--label", f"{self.label}={install_id}", self.state["volume"])
        self.run("volume", "create", "--label", f"{self.label}={install_id}", self.state["data_volume"])
        self.start()
        self.quadlets()
        print(f"Installed: {public_url}\nInitial credentials: {self.state_dir / 'initial-admin.txt'}\nChange the initial password after login.")

    def require_state(self):
        if not self.state:
            raise RuntimeError("No KIKI deployment state exists in this directory")

    def resume(self):
        self.require_state()
        if self.state.get("stage") != "prepared":
            raise RuntimeError("Only a prepared installation may be resumed. Use start for an existing deployment.")
        for name in ("app.env", "database.env", "secrets/clouds.yaml"):
            if not (self.state_dir / name).is_file():
                raise RuntimeError("Prepared installation is missing its original secret files; refusing to regenerate keys")
        self.build()
        self.state.setdefault("data_volume", self.state["prefix"] + "-appdata")
        self.save()
        for kind, key in (("network", "network"), ("volume", "volume"), ("volume", "data_volume")):
            if not self.owned(kind, self.state[key]):
                self.run(kind, "create", "--label", f"{self.label}={self.state['id']}", self.state[key])
        self.start()
        self.quadlets()

    def build(self):
        self.require_state()
        image_format = ["--format", "docker"] if self.engine == "podman" else []
        self.run("build", *image_format, "--label", f"{self.label}={self.state['id']}", "-f", ROOT / "Containerfile", "-t", self.state["image"], ROOT)

    def app_arguments(self, image=None):
        s = self.state
        # Rootless Podman maps the host owner to the image user; Docker uses a private secret directory mounted as root.
        user = ["--userns=keep-id:uid=1000,gid=1000"] if self.engine == "podman" else []
        mounts = []
        if s.get("data_volume"):
            mounts += ["-v", f"{s['data_volume']}:/app/data"]
        for name in ("clouds.yaml", "openstack-ca.crt"):
            if (self.state_dir / "secrets" / name).exists():
                mounts += ["-v", f"{self.state_dir / 'secrets' / name}:/app/secrets/{name}:ro,Z"]
        ports = ["-p", f"{s['bind']}:{s['port']}:4080"]
        if s.get("tcp_forwarding"):
            first, last = s["tcp_port_start"], s["tcp_port_end"]
            ports += ["-p", f"{s['tcp_bind']}:{first}-{last}:{first}-{last}"]
        return ["run", "-d", "--name", s["app"], "--label", f"{self.label}={s['id']}", "--restart", "unless-stopped",
                "--network", s["network"], "--env-file", self.state_dir / "app.env", "--security-opt", "no-new-privileges",
                "--cap-drop", "ALL", *user, *mounts, *ports, image or s["image"]]

    def start(self):
        self.require_state()
        s = self.state
        if not s.get("data_volume"):
            s["data_volume"] = s["prefix"] + "-appdata"
            self.run("volume", "create", "--label", f"{self.label}={s['id']}", s["data_volume"])
            self.save()
        elif not self.owned("volume", s["data_volume"]):
            raise RuntimeError("The owned application-data volume is missing; refusing to start with empty upload/template storage")
        if not self.owned("network", s["network"]) or not self.owned("volume", s["volume"]):
            raise RuntimeError("Owned network or volume is missing; installation is incomplete")
        if self.owned("container", s["database"]):
            self.run("start", s["database"])
        else:
            self.run("run", "-d", "--name", s["database"], "--label", f"{self.label}={s['id']}", "--restart", "unless-stopped",
                     "--network", s["network"], "--env-file", self.state_dir / "database.env", "-v", f"{s['volume']}:/var/lib/postgresql/data", "docker.io/postgres:17-bookworm")
        for _ in range(60):
            if self.run("exec", s["database"], "pg_isready", "-U", "community", "-d", "community", check=False).returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("KIKI PostgreSQL did not become ready")
        if self.owned("container", s["app"]):
            self.run("start", s["app"])
        else:
            self.run(*self.app_arguments())
        self.health()
        s["stage"] = "running"
        self.save()

    def health(self):
        url = f"http://127.0.0.1:{self.state['port']}/api/health"
        for _ in range(60):
            try:
                with urlopen(url, timeout=3) as response:
                    data = json.load(response)
                if data.get("ok") and data.get("product") in (PRODUCT, LEGACY_PRODUCT):
                    return
            except (OSError, ValueError):
                pass
            time.sleep(1)
        raise RuntimeError("KIKI application health check failed; original services were not changed")

    def stop(self):
        self.require_state()
        for name in (self.state["app"], self.state["database"]):
            if self.owned("container", name):
                self.run("stop", "--time", "15", name)
        self.state["stage"] = "stopped"
        self.save()

    def status(self):
        self.require_state()
        for name in (self.state["app"], self.state["database"]):
            if self.owned("container", name):
                result = self.run("container", "inspect", "--format", "{{.State.Status}}", name)
                print(name + ": " + result.stdout.decode().strip())
            else:
                print(name + ": absent")

    def backup(self):
        self.require_state()
        if not self.owned("container", self.state["database"]):
            raise RuntimeError("KIKI database is not running")
        destination = self.state_dir / "backups" / time.strftime("kiki-terminal-lab-%Y%m%d-%H%M%S.dump")
        destination.parent.mkdir(parents=True, exist_ok=True)
        # O_EXCL prevents overwriting a backup taken in the same second.
        app_running = False
        if self.owned("container", self.state["app"]):
            state = json.loads(self.run("container", "inspect", self.state["app"]).stdout)[0]
            app_running = state.get("State", {}).get("Running", False)
        files_destination = destination.with_suffix(".files.tar.gz")
        fd = os.open(str(destination), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            with os.fdopen(fd, "wb") as output:
                if app_running:
                    self.run("stop", "--time", "15", self.state["app"])
                self.run("exec", self.state["database"], "pg_dump", "-U", "community", "-d", "community", "-Fc", stdout=output)
            if self.state.get("data_volume") and self.owned("volume", self.state["data_volume"]):
                files_fd = os.open(str(files_destination), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(files_fd, "wb") as output:
                    self.run("run", "--rm", "--label", f"{self.label}={self.state['id']}", "--network", "none", "--user", "0:0", "--entrypoint", "tar", "-v", f"{self.state['data_volume']}:/backup:ro", self.state["image"], "-C", "/backup", "-czf", "-", ".", stdout=output)
                print(f"Application files backup: {files_destination}")
        except Exception:
            destination.unlink(missing_ok=True)
            files_destination.unlink(missing_ok=True)
            raise
        finally:
            if app_running:
                self.run("start", self.state["app"])
        print(f"Database backup: {destination}")
        print("Keep app.env (including SESSION_SECRET and CREDENTIAL_KEY), deployment.json and secrets/clouds.yaml in a separate protected backup.")
        return destination

    def update(self):
        self.require_state()
        if not self.owned("container", self.state["app"]):
            raise RuntimeError("Start the existing application before update")
        previous = json.loads(self.run("container", "inspect", self.state["app"]).stdout)[0]["Image"]
        self.backup()
        if not self.state.get("data_volume"):
            self.state["data_volume"] = self.state["prefix"] + "-appdata"
            self.run("volume", "create", "--label", f"{self.label}={self.state['id']}", self.state["data_volume"])
            self.save()
        self.state["image"] = self.state["prefix"] + f"-app:{VERSION}"
        self.build()
        self.run("stop", "--time", "15", self.state["app"])
        self.run("rm", self.state["app"])
        try:
            self.run(*self.app_arguments())
            self.health()
        except Exception:
            if self.owned("container", self.state["app"]):
                self.run("stop", self.state["app"], check=False)
                self.run("rm", self.state["app"])
            previous_version = self.state.get("version", "")
            if previous_version.startswith("0.1.") and not VERSION.startswith("0.1."):
                raise RuntimeError("Update failed during the 0.1-to-platform schema transition. The application is stopped, the database and both backups are preserved. Restore the matching pre-upgrade DB before starting the previous image.")
            self.run(*self.app_arguments(previous))
            raise RuntimeError("Update failed; previous application image was restarted. Inspect KIKI state before retrying.")
        self.state["version"] = VERSION
        self.save()
        print("KIKI OS TERMINAL-LAB updated; database volume and credential keys preserved.")

    def uninstall(self):
        self.require_state()
        self.stop()
        for name in (self.state["app"], self.state["database"]):
            if self.owned("container", name):
                self.run("rm", name)
        self.state["stage"] = "uninstalled-data-preserved"
        self.save()
        print("KIKI containers removed. Database volume, network, secrets and backups are preserved. `start` reinstalls containers.")

    def quadlets(self):
        if self.engine != "podman":
            return
        s = self.state
        unit_prefix = s.get("service_prefix", "tl-community")
        if unit_prefix not in (PRODUCT, "tl-community"):
            raise ValueError("Unknown service prefix")
        directory = self.state_dir / "systemd"
        directory.mkdir(exist_ok=True)
        for file in [self.state_dir, ROOT]:
            if any(c in str(file) for c in ('\n', '\r', '"', '%')):
                raise ValueError("The deployment path cannot contain newlines, quotes or systemd specifiers")
        # Export only. Enabling boot services requires an explicit operator action documented in README.
        (directory / f"{unit_prefix}-db.container").write_text(f'''[Unit]
Description=KIKI OS TERMINAL-LAB PostgreSQL
[Container]
Image=docker.io/postgres:17-bookworm
ContainerName={s['database']}
Network={s['network']}
EnvironmentFile="{self.state_dir / 'database.env'}"
Volume={s['volume']}:/var/lib/postgresql/data
Label={self.label}={s['id']}
[Service]
Restart=on-failure
[Install]
WantedBy=default.target
''', encoding="utf-8")
        (directory / f"{unit_prefix}-app.container").write_text(f'''[Unit]
Description=KIKI OS TERMINAL-LAB Portal
Requires={unit_prefix}-db.service
After={unit_prefix}-db.service
[Container]
Image={s['image']}
ContainerName={s['app']}
Network={s['network']}
EnvironmentFile="{self.state_dir / 'app.env'}"
Volume="{self.state_dir / 'secrets'}:/app/secrets:ro,Z"
Volume={s.get('data_volume', s['prefix'] + '-appdata')}:/app/data
UserNS=keep-id:uid=1000,gid=1000
PublishPort={s['bind']}:{s['port']}:4080
Label={self.label}={s['id']}
DropCapability=all
NoNewPrivileges=true
[Service]
Restart=on-failure
[Install]
WantedBy=default.target
''', encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["plan", "install", "resume", "start", "stop", "status", "backup", "update", "uninstall"])
    parser.add_argument("--state-dir", default=str(ROOT / "runtime" / "deployment"))
    parser.add_argument("--engine", choices=["podman", "docker"], default="podman")
    parser.add_argument("--public-url", default="http://localhost:4080")
    parser.add_argument("--port", type=int, choices=range(1024, 65536), metavar="1024-65535", default=4080)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--trust-proxy", action="store_true", help="Trust one hop from your TLS reverse proxy")
    parser.add_argument("--clouds")
    parser.add_argument("--cloud-name", default="community")
    parser.add_argument("--service-project", default="admin")
    parser.add_argument("--ca")
    parser.add_argument("--username", default="admin")
    parser.add_argument("--public-base-domain", default="")
    parser.add_argument("--ssh-public-host", default="")
    parser.add_argument("--ssh-source-cidrs", default="", help="Explicit comma-separated operator CIDRs for optional SSH ingress")
    parser.add_argument("--validation-network", default="", help="Explicit OpenStack network for the optional VM lifecycle test")
    parser.add_argument("--enable-tcp-forwarding", action="store_true")
    parser.add_argument("--tcp-port-start", type=int, default=22000)
    parser.add_argument("--tcp-port-end", type=int, default=22099)
    args = parser.parse_args()
    # Disallow line injection into env files, CLI mount values and generated service files.
    for value in vars(args).values():
        if isinstance(value, str) and any(c in value for c in ("\n", "\r", "\x00")):
            parser.error("Arguments cannot contain control characters")
    try:
        args.ssh_source_cidrs = validate_source_cidrs(args.ssh_source_cidrs)
        if args.enable_tcp_forwarding and not args.ssh_public_host:
            raise ValueError("--ssh-public-host is required when TCP forwarding is enabled")
        if not (1024 <= args.tcp_port_start <= args.tcp_port_end <= 65535) or args.tcp_port_end - args.tcp_port_start > 999:
            raise ValueError("TCP port range must contain at most 1000 ports in 1024..65535")
        installer = Installer(args)
        if args.command == "plan":
            print(json.dumps(installer.plan(), ensure_ascii=False, indent=2))
        else:
            getattr(installer, args.command)()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
