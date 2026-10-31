import { useState } from "react";
import "./kubectl-download-menu.css";

export const KUBECTL_RELEASES = Object.freeze({
  "1.30": "v1.30.14",
  "1.31": "v1.31.14",
  "1.32": "v1.32.13",
  "1.33": "v1.33.13",
});

const KUBECTL_PLATFORMS = Object.freeze([
  { id: "linux-amd64", label: "Linux x86_64", os: "linux", arch: "amd64", fileName: "kubectl" },
  { id: "linux-arm64", label: "Linux ARM64", os: "linux", arch: "arm64", fileName: "kubectl" },
  { id: "windows-amd64", label: "Windows x86_64", os: "windows", arch: "amd64", fileName: "kubectl.exe" },
  { id: "darwin-amd64", label: "macOS Intel", os: "darwin", arch: "amd64", fileName: "kubectl" },
  { id: "darwin-arm64", label: "macOS Apple Silicon", os: "darwin", arch: "arm64", fileName: "kubectl" },
]);

export function buildKubectlDownloadUrl(release, platform) {
  return `https://dl.k8s.io/release/${release}/bin/${platform.os}/${platform.arch}/${platform.fileName}`;
}

export default function KubectlDownloadMenu({ defaultMinor = "1.30" }) {
  const initialMinor = Object.hasOwn(KUBECTL_RELEASES, defaultMinor) ? defaultMinor : "1.30";
  const [minor, setMinor] = useState(initialMinor);
  const release = KUBECTL_RELEASES[minor];

  return (
    <details className="kubectl-download-menu">
      <summary className="mini-btn">kubectl 다운로드</summary>
      <div className="kubectl-download-panel">
        <label>
          <span>Kubernetes 버전</span>
          <select value={minor} onChange={(event) => setMinor(event.target.value)}>
            {Object.entries(KUBECTL_RELEASES).map(([version, patch]) => (
              <option key={version} value={version}>{`${version} (${patch})`}</option>
            ))}
          </select>
        </label>
        <div className="kubectl-download-links">
          {KUBECTL_PLATFORMS.map((platform) => (
            <a
              className="mini-btn"
              href={buildKubectlDownloadUrl(release, platform)}
              key={platform.id}
              rel="noreferrer"
              target="_blank"
            >
              {platform.label}
            </a>
          ))}
        </div>
        <small>{`${release} 공식 Kubernetes 바이너리 · 클러스터와 같은 minor 버전을 권장합니다.`}</small>
      </div>
    </details>
  );
}
