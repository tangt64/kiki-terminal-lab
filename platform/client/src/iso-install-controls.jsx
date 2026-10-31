import { useState } from "react";
import "./iso-install-controls.css";

export function IsoUploadFields({ projectName, canUpload, onUploaded, onBusy, disabled }) {
  const [file, setFile] = useState(null);
  const [sha256, setSha256] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function upload() {
    if (!file || !file.name.toLowerCase().endsWith(".iso") || !/^[a-f0-9]{64}$/i.test(sha256)) {
      setMessage("ISO 파일과 빌드 결과의 SHA-256 64자리를 입력하세요."); return;
    }
    if (file.size > 8 * 1024 ** 3) { setMessage("ISO 파일은 8GB까지 업로드할 수 있습니다."); return; }
    setBusy(true); onBusy?.(true); setMessage("");
    try {
      const query = new URLSearchParams({ projectName, name: file.name, sha256 });
      const response = await fetch("/api/cloud-console/iso-images?" + query, { method: "POST", credentials: "include", headers: { "Content-Type": "application/octet-stream" }, body: file });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "ISO를 업로드하지 못했습니다.");
      await onUploaded(result.result);
      setMessage("SHA-256을 검증하고 프로젝트 전용 ISO로 등록했습니다.");
    } catch (error) { setMessage(error.message || "ISO 업로드에 실패했습니다."); }
    finally { setBusy(false); onBusy?.(false); }
  }
  return <fieldset disabled={disabled || busy} className="mini-horizon-iso-fields">
    <legend>UEFI ISO 설치</legend>
    <p className="hint">ISO와 빈 설치 디스크로 부팅합니다. VNC에서 OS와 계정을 설치한 뒤 정상 종료하고 ‘설치 완료 · 디스크로 부팅’을 선택하세요. 설치 디스크는 보존됩니다.</p>
    {canUpload ? <>
      <label className="mini-horizon-field"><span>새 ISO 파일</span><input accept=".iso,application/x-iso9660-image" type="file" onChange={(event) => setFile(event.target.files?.[0] || null)}/></label>
      <label className="mini-horizon-field"><span>ISO SHA-256</span><input value={sha256} onChange={(event) => setSha256(event.target.value.trim())} placeholder="빌드 결과의 SHA-256" autoComplete="off"/></label>
      <button className="mini-btn" type="button" disabled={!file || !sha256 || busy} onClick={upload}>{busy ? "ISO 업로드 중…" : "ISO 업로드"}</button>
    </> : <p className="hint">사용할 ISO가 없다면 관리자에게 ISO 등록과 이미지 사용 허용을 요청하세요.</p>}
    {message ? <p role="status" aria-live="polite">{message}</p> : null}
  </fieldset>;
}

export function IsoInstallStatus({ server, runtimeServerId, busy, onComplete }) {
  if (server.metadata?.terminal_lab_boot_source !== "iso") return null;
  if (runtimeServerId) return <p className="hint">디스크 부팅 VM: {runtimeServerId}. 원본 설치 VM은 복구용으로 정지 상태를 유지하세요.</p>;
  return <div className="mini-horizon-iso-status">
    <p className="hint">ISO 설치용 VM · 운영체제 설치와 계정 설정은 VNC에서 진행합니다.</p>
    <button className="mini-btn" type="button" disabled={busy || server.status !== "SHUTOFF"} onClick={onComplete}>설치 완료 · 디스크로 부팅</button>
    {server.status !== "SHUTOFF" ? <small>OS 설치를 완료하고 설치 VM을 정상 종료한 뒤 전환할 수 있습니다.</small> : null}
  </div>;
}
