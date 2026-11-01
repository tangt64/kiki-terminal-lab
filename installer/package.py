#!/usr/bin/env python3
"""Create an allowlisted, independently installable source distribution."""
import hashlib
import json
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
        # Generated dependency notices can be extensionless (for example react-LICENSE).
        dependency_notice = relative.parts[:3] == ("client", "public", "licenses") or relative.parts[:4] == ("platform", "client", "public", "licenses")
        allowed = relative.as_posix() in FILES or (relative.parts[0] in DIRECTORIES and (path.suffix in EXTENSIONS or path.name.upper().startswith(("LICENSE", "NOTICE", "COPYING", "AUTHORS")) or dependency_notice) and len(relative.parts) > 1)
        if allowed:
            if not path.resolve().is_relative_to(root):
                raise ValueError("Source escapes the distribution root")
            result.append(path)
    missing = FILES - {p.relative_to(root).as_posix() for p in result}
    if missing:
        raise ValueError("Missing distribution files: " + ", ".join(sorted(missing)))
    return result


def main():
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
