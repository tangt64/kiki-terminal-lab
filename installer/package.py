#!/usr/bin/env python3
"""Create an allowlisted, independently installable source distribution."""
import hashlib
import json
import argparse
import datetime
import re
import stat
import subprocess
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RELEASE = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
VERSION = RELEASE["version"]
PRODUCT = RELEASE["name"]
FILES = {"package.json", "package-lock.json", "vite.config.js", "Containerfile", ".containerignore", ".gitignore", ".env.example", "README.md", "LICENSE", "NOTICE.md", "AUTHORS.md", "CONTRIBUTING.md", "SUPPORT.md", "CHANGELOG.md", "SOURCE-PROVENANCE.json"}
DIRECTORIES = {"client", "server", "platform", "installer", "scripts", "docs", "tests", "deploy"}
EXTENSIONS = {".js", ".jsx", ".mjs", ".css", ".sql", ".html", ".svg", ".png", ".webp", ".excalidrawlib", ".sh", ".py", ".md", ".json", ".yaml", ".txt"}
EXCLUDED_CONTENT = {"platform/client/src/curriculum-2026-data.js"}


def allowed_source(relative):
    if relative.as_posix() in EXCLUDED_CONTENT:
        return False
    if any(part in {"node_modules", ".git", "__pycache__", "data", "secrets", "runtime", "backups", "dist", "releases", "board-fonts", "board-pdf"} for part in relative.parts):
        return False
    dependency_notice = relative.parts[:3] == ("client", "public", "licenses") or relative.parts[:4] == ("platform", "client", "public", "licenses")
    return relative.as_posix() in FILES or (len(relative.parts) > 1 and relative.parts[0] in DIRECTORIES and (relative.suffix in EXTENSIONS or relative.name.upper().startswith(("LICENSE", "NOTICE", "COPYING", "AUTHORS")) or dependency_notice))


def committed_sources(reference, root=ROOT):
    if not re.fullmatch(r"(?:[a-f0-9]{40}|[a-f0-9]{64})", reference):
        raise ValueError("Use a full commit hash")
    def git(*args):
        return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.PIPE)
    actual_root = Path(git("rev-parse", "--show-toplevel").decode().strip()).resolve()
    if actual_root != root.resolve():
        raise ValueError("Expected the independent repository root")
    release = json.loads(git("show", f"{reference}:package.json"))
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]*", release["name"]):
        raise ValueError("Invalid distribution name")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?", release["version"]):
        raise ValueError("Invalid distribution version")
    entries = {}
    for entry in git("ls-tree", "-rz", "--full-tree", reference).split(b"\0"):
        if not entry:
            continue
        metadata, name = entry.split(b"\t", 1)
        mode, kind, oid = metadata.decode().split()
        name = name.decode("utf-8")
        if not allowed_source(Path(name)):
            continue
        if kind != "blob" or mode not in ("100644", "100755"):
            raise ValueError(f"Unsupported source entry: {name}")
        entries[name] = (mode, oid)
    if FILES - entries.keys():
        raise ValueError("Required distribution files are absent from the commit")
    return release, entries, git


def verify_archive(archive_path, reference, root=ROOT):
    release, entries, git = committed_sources(reference, root)
    prefix = release["name"] + "/"
    object_format = git("rev-parse", "--show-object-format").decode().strip()
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        expected = {prefix + name for name in entries} | {prefix + "SHA256SUMS.json"}
        if len(names) != len(set(names)) or set(names) != expected:
            raise ValueError("ZIP file inventory differs from the committed distribution")
        if sum(item.file_size for item in archive.infolist()) > 512 * 1024 * 1024:
            raise ValueError("Expanded source archive is too large")
        for item in archive.infolist():
            if item.file_size > 128 * 1024 * 1024 or stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError("Unsupported archive entry")
        manifest = json.loads(archive.read(prefix + "SHA256SUMS.json"))
        if set(manifest) != set(entries):
            raise ValueError("ZIP hash inventory differs from the commit")
        for name, (_, oid) in entries.items():
            body = archive.read(prefix + name)
            if hashlib.sha256(body).hexdigest() != manifest[name]:
                raise ValueError(f"ZIP SHA-256 mismatch: {name}")
            blob = b"blob " + str(len(body)).encode() + b"\0" + body
            if hashlib.new(object_format, blob).hexdigest() != oid:
                raise ValueError(f"ZIP differs from the committed source: {name}")
    return {"product": release["name"], "version": release["version"], "commit": reference, "files": len(entries), "sha256": hashlib.sha256(Path(archive_path).read_bytes()).hexdigest()}


def package_commit(reference, root=ROOT):
    release, entries, git = committed_sources(reference, root)
    output = root / "releases" / f"{release['name']}-{release['version']}.zip"
    output.parent.mkdir(exist_ok=True)
    timestamp = int(git("show", "-s", "--format=%ct", reference))
    moment = datetime.datetime.fromtimestamp(max(315532800, min(timestamp, 4354819198)), datetime.timezone.utc)
    manifest = {}
    # Git blobs avoid host line-ending filters and exclude every uncommitted file.
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        def add(name, body, mode="100644"):
            item = zipfile.ZipInfo(release["name"] + "/" + name, moment.timetuple()[:6])
            item.create_system = 3
            item.external_attr = (stat.S_IFREG | (0o755 if mode == "100755" else 0o644)) << 16
            item.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(item, body, compresslevel=9)
        with subprocess.Popen(["git", "-C", str(root), "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as reader:
            try:
                for name, (mode, oid) in sorted(entries.items()):
                    reader.stdin.write((oid + "\n").encode())
                    reader.stdin.flush()
                    header = reader.stdout.readline().decode().split()
                    if len(header) != 3 or header[:2] != [oid, "blob"]:
                        raise ValueError("Cannot read the committed source blob")
                    size = int(header[2])
                    body = reader.stdout.read(size)
                    if len(body) != size or reader.stdout.read(1) != b"\n":
                        raise ValueError("Incomplete committed source blob")
                    manifest[name] = hashlib.sha256(body).hexdigest()
                    add(name, body, mode)
            finally:
                reader.stdin.close()
                reader.wait(timeout=10)
        add("SHA256SUMS.json", (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode())
    digest = verify_archive(output, reference, root)["sha256"]
    output.with_suffix(".zip.sha256").write_bytes(f"{digest}  {output.name}\n".encode("ascii"))
    return output, digest


def source_files(root=ROOT):
    result = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if relative.as_posix() in EXCLUDED_CONTENT:
            continue
        if any(part in {"node_modules", ".git", "__pycache__", "data", "secrets", "runtime", "backups", "dist", "releases", "board-fonts", "board-pdf"} for part in relative.parts):
            continue
        if path.is_symlink():
            raise ValueError(f"Symlinks are not allowed in distributions: {relative}")
        if not path.is_file():
            continue
        if allowed_source(relative):
            if not path.resolve().is_relative_to(root):
                raise ValueError("Source escapes the distribution root")
            result.append(path)
    missing = FILES - {p.relative_to(root).as_posix() for p in result}
    if missing:
        raise ValueError("Missing distribution files: " + ", ".join(sorted(missing)))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", help="Package or verify an exact committed source snapshot")
    parser.add_argument("--verify-archive", type=Path)
    args = parser.parse_args()
    if args.verify_archive:
        if not args.ref:
            parser.error("--verify-archive requires --ref")
        print(json.dumps(verify_archive(args.verify_archive, args.ref)))
        return
    if args.ref:
        output, digest = package_commit(args.ref)
        print(output)
        print(f"SHA256 {digest}")
        return
    files = source_files()
    output = ROOT / "releases" / f"{PRODUCT}-{VERSION}.zip"
    output.parent.mkdir(exist_ok=True)
    manifest = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, f"{PRODUCT}/{path.relative_to(ROOT).as_posix()}")
        archive.writestr(f"{PRODUCT}/SHA256SUMS.json", json.dumps(manifest, indent=2) + "\n")
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(".zip.sha256").write_text(f"{digest}  {output.name}\n", encoding="ascii")
    print(output)
    print(f"SHA256 {digest}")


if __name__ == "__main__":
    main()
