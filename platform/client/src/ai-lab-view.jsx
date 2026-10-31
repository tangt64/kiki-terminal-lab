import { useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "./xterm.css";

const AI_LAB_PRESETS = [
  {
    id: "python",
    label: "Python AI 실습",
    description: "가벼운 NumPy·Pandas·scikit-learn 실습",
    recommendedBackend: "container",
    port: "8888",
    command: "sleep infinity",
    diskGb: 20,
  },
  {
    id: "notebook",
    label: "Jupyter Notebook",
    description: "브라우저 Notebook과 데이터 분석 환경",
    recommendedBackend: "container",
    port: "8888",
    command: "start-notebook.py --ServerApp.token=''",
    diskGb: 40,
  },
  {
    id: "inference",
    label: "LLM 추론",
    description: "모델 다운로드와 API 추론처럼 메모리가 필요한 작업",
    recommendedBackend: "container",
    gpuRequired: true,
    port: "8000",
    command: "sleep infinity",
    diskGb: 80,
  },
  {
    id: "cuda",
    label: "CUDA / GPU 개발",
    description: "GPU Flavor와 사전 구성된 드라이버 이미지가 필요한 작업",
    recommendedBackend: "container",
    gpuRequired: true,
    port: "8888",
    command: "sleep infinity",
    diskGb: 100,
  },
];

function uniqueNames(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function resourceStatusLabel(status) {
  const value = String(status || "").toLowerCase();
  if (["running", "active"].includes(value)) return "실행 중";
  if (["requested", "approved", "provisioning", "creating"].includes(value)) return "준비 중";
  if (["stopped", "paused", "suspended"].includes(value)) return "중지";
  if (["failed", "error"].includes(value)) return "오류";
  if (["terminated", "deleted"].includes(value)) return "종료";
  return status || "확인 중";
}

function terminalSocketUrl(path) {
  if (/^wss?:\/\//i.test(String(path || ""))) return path;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export function ZunContainerConsole({ session, onClose }) {
  const rootRef = useRef(null);

  useEffect(() => {
    if (!session?.wsPath || !rootRef.current) return undefined;
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      theme: { background: "#07111f", foreground: "#e5edf8" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(rootRef.current);
    fit.fit();
    terminal.writeln("Zun 컨테이너 콘솔을 연결하고 있습니다.");
    const socket = new WebSocket(terminalSocketUrl(session.wsPath));
    socket.addEventListener("open", () => {
      fit.fit();
      socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      terminal.writeln(`대상: ${session.targetLabel || "컨테이너"}`);
    });
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "data" || payload.type === "output") terminal.write(payload.data || "");
        else if (payload.type === "status") terminal.writeln(`\r\n[안내] ${payload.message || ""}`);
        else if (payload.type === "error") terminal.writeln(`\r\n[오류] ${payload.message || ""}`);
        else if (payload.type === "exit") terminal.writeln("\r\n[콘솔 종료]");
      } catch {
        terminal.write(String(event.data || ""));
      }
    });
    socket.addEventListener("close", () => terminal.writeln("\r\n[연결 종료]"));
    const input = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
    });
    const resize = terminal.onResize(({ cols, rows }) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", cols, rows }));
    });
    let fitFrame = 0;
    let measuredWidth = 0;
    let measuredHeight = 0;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry?.contentRect?.width || rootRef.current?.clientWidth || 0);
      const height = Math.round(entry?.contentRect?.height || rootRef.current?.clientHeight || 0);
      if (!width || !height || (width === measuredWidth && height === measuredHeight)) return;
      measuredWidth = width;
      measuredHeight = height;
      cancelAnimationFrame(fitFrame);
      fitFrame = requestAnimationFrame(() => {
        try { fit.fit(); } catch {}
      });
    });
    observer.observe(rootRef.current);
    terminal.focus();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(fitFrame);
      input.dispose();
      resize.dispose();
      socket.close();
      terminal.dispose();
    };
  }, [session?.wsPath]);

  return (
    <section className="simple-panel ai-lab-console-panel" aria-label="Zun 컨테이너 콘솔">
      <div className="portal-detail-head">
        <div><p className="card-label">CONTAINER CONSOLE</p><h3>{session?.targetLabel || "Zun 컨테이너"}</h3></div>
        <button className="mini-btn" onClick={onClose} type="button">콘솔 닫기</button>
      </div>
      <p className="hint">SSH 서버 없이 Zun WebSocket으로 컨테이너에 직접 연결합니다.</p>
      <div className="terminal-root is-embedded" ref={rootRef} />
    </section>
  );
}

export default function AiLabView(props) {
  const status = props.platformStatus || {};
  const serviceProjectName = String(status.serviceProjectName || "").trim().toLowerCase();
  const projects = useMemo(() => uniqueNames(status.selfServiceVmAllowedProjects || []).filter((name) => (
    props.isAdmin || name.toLowerCase() !== serviceProjectName
  )), [props.isAdmin, serviceProjectName, status.selfServiceVmAllowedProjects]);
  const vmImages = uniqueNames(status.selfServiceVmAllowedImages || []);
  const flavors = uniqueNames(status.selfServiceVmAllowedFlavors || []);
  const aiVmProfiles = (Array.isArray(status.aiVmFlavorCatalog) ? status.aiVmFlavorCatalog : [])
    .filter((item) => item?.enabled !== false && flavors.includes(String(item?.flavorName || "").trim()));
  const containerImages = uniqueNames(status.zunAllowedImages || []);
  const containerCatalog = (Array.isArray(status.aiContainerImageCatalog) ? status.aiContainerImageCatalog : [])
    .filter((item) => item?.targetImage && containerImages.some((image) => image.toLowerCase() === item.targetImage.toLowerCase()));
  const initialContainerPreset = containerCatalog.find((item) => item.recommended)
    || containerCatalog.find((item) => item.targetImage?.toLowerCase() === containerImages[0]?.toLowerCase())
    || null;
  const vmAvailable = Boolean(status.selfServiceVmServiceEnabled && (props.isAdmin || props.session?.selfServiceVmEnabled));
  const containerAvailable = Boolean(status.zunEnabled);
  const [backend, setBackend] = useState(containerAvailable ? "container" : "vm");
  const [presetId, setPresetId] = useState("python");
  const [name, setName] = useState("ai-lab");
  const [projectName, setProjectName] = useState(projects[0] || "");
  const [vmImage, setVmImage] = useState(vmImages[0] || "");
  const [aiFlavorProfileId, setAiFlavorProfileId] = useState(aiVmProfiles.find((item) => item.workload === "python")?.id || aiVmProfiles[0]?.id || "");
  const [containerImageMode, setContainerImageMode] = useState(containerImages.length ? "managed" : "custom");
  const [containerImage, setContainerImage] = useState(initialContainerPreset?.targetImage || containerImages[0] || "");
  const [customContainerImage, setCustomContainerImage] = useState("");
  const [storageGb, setStorageGb] = useState("20");
  const [exposedPort, setExposedPort] = useState(String(initialContainerPreset?.recommendedPort || "8888"));
  const [commandText, setCommandText] = useState(String(initialContainerPreset?.commandText || ""));
  const [creating, setCreating] = useState(false);
  const [accessBusyKey, setAccessBusyKey] = useState("");
  const [resultStatus, setResultStatus] = useState({ tone: "", message: "" });
  const [containerConsoleSession, setContainerConsoleSession] = useState(null);
  const consolePanelRef = useRef(null);

  useEffect(() => {
    if (!containerConsoleSession?.wsPath) return undefined;
    const frame = window.requestAnimationFrame(() => {
      consolePanelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [containerConsoleSession?.wsPath]);
  const preset = AI_LAB_PRESETS.find((item) => item.id === presetId) || AI_LAB_PRESETS[0];
  const selectedAiVmProfile = aiVmProfiles.find((item) => item.id === aiFlavorProfileId)
    || aiVmProfiles.find((item) => item.workload === preset.id)
    || null;
  const profileVmImages = selectedAiVmProfile?.allowedImages?.length
    ? vmImages.filter((item) => selectedAiVmProfile.allowedImages.includes(item))
    : vmImages;
  const selectedProjectName = projects.includes(projectName) ? projectName : projects[0] || "";
  const selectedVmImage = profileVmImages.includes(vmImage) ? vmImage : profileVmImages[0] || "";
  const selectedFlavor = selectedAiVmProfile?.flavorName || "";
  const selectedContainerImage = containerImages.includes(containerImage) ? containerImage : "";
  const selectedContainerPreset = containerCatalog.find((item) => item.targetImage.toLowerCase() === selectedContainerImage.toLowerCase()) || null;
  const containerPresetMatchesEnvironment = Boolean(
    selectedContainerPreset
    && selectedContainerPreset.category === preset.id
    && (!selectedContainerPreset.gpuRequired || selectedContainerPreset.gpuReady)
  );
  const recentVms = (props.cloudConsoleActions || [])
    .filter((item) => item.operation === "POST /api/cloud-console/instances" && item.request?.body?.resourceSource === "ai-lab")
    .map((item) => ({
      id: item.result?.id || item.result?.server?.id || `action-${item.id}`,
      actionId: item.id,
      status: item.result?.instanceStatus || (item.status === "completed" ? "running" : item.status),
      stackName: item.request?.body?.name || item.result?.name || `AI VM #${item.id}`,
      flavor: item.request?.body?.flavorRef || "",
      imageName: item.request?.body?.imageRef || "",
      projectName: item.projectName || "",
      resourcePresetId: item.request?.body?.resourcePresetId || "",
    }));
  const recentContainers = (props.zunContainers || [])
    .filter((item) => item.resourceSource === "ai-lab" || (String(item.name || "").toLowerCase().startsWith("ai-") && containerCatalog.some((entry) => entry.targetImage.toLowerCase() === String(item.imageName || "").toLowerCase())));

  function choosePreset(nextPresetId) {
    const next = AI_LAB_PRESETS.find((item) => item.id === nextPresetId) || AI_LAB_PRESETS[0];
    setPresetId(next.id);
    if (next.recommendedBackend === "container" && containerAvailable) setBackend("container");
    if ((next.recommendedBackend === "vm" || !containerAvailable) && vmAvailable) setBackend("vm");
    setStorageGb(String(next.diskGb));
    setExposedPort(next.port);
    setCommandText(next.command);
    const matchingContainerPreset = containerCatalog.find((item) => item.category === next.id && (!item.gpuRequired || item.gpuReady));
    if (matchingContainerPreset) {
      setContainerImageMode("managed");
      setContainerImage(matchingContainerPreset.targetImage);
      setExposedPort(String(matchingContainerPreset.recommendedPort || next.port));
      setCommandText(String(matchingContainerPreset.commandText || ""));
    } else if (next.recommendedBackend === "container") {
      setContainerImageMode("managed");
      setContainerImage("");
      setCommandText("");
    }
    const matchingAiVmProfile = aiVmProfiles.find((item) => item.workload === next.id && (!next.gpuRequired || item.gpuEnabled));
    setAiFlavorProfileId(matchingAiVmProfile?.id || "");
    if (matchingAiVmProfile?.allowedImages?.length) {
      const nextImage = vmImages.find((item) => matchingAiVmProfile.allowedImages.includes(item));
      if (nextImage) setVmImage(nextImage);
    }
  }

  async function createAiLab(event) {
    event.preventDefault();
    setResultStatus({ tone: "info", message: "AI 랩 생성 요청을 전송하고 있습니다." });
    setCreating(true);
    try {
      if (backend === "vm") {
        if (!vmAvailable) throw new Error("가상머신 기반 AI 랩이 현재 비활성화되어 있습니다.");
        if (!selectedProjectName) throw new Error("먼저 클라우드 콘솔에서 전용 프로젝트를 생성해 주세요.");
        if (!selectedAiVmProfile || selectedAiVmProfile.workload !== preset.id) throw new Error("선택한 환경에 맞는 AI VM Flavor 프로파일이 없습니다.");
        if (!selectedVmImage || !selectedFlavor) throw new Error("기반 OS 이미지와 AI Flavor 프로파일을 선택해 주세요.");
        const snapshot = await props.loadCloudConsoleSnapshot?.(selectedProjectName);
        const externalNetworkName = String(status.selfServiceVmProjectExternalNetworkName || "net-external").trim().toLowerCase();
        const network = (snapshot?.networks || []).find((item) => !item["router:external"] && String(item.name || "").trim().toLowerCase() === "net-infra")
          || (snapshot?.networks || []).find((item) => !item["router:external"] && String(item.name || "").trim().toLowerCase() !== externalNetworkName);
        if (!network?.id) throw new Error("AI 가상머신에 연결할 프로젝트 네트워크가 없습니다.");
        const securityGroupNames = (snapshot?.securityGroups || []).some((item) => String(item.name || "").trim().toLowerCase() === "example.com") ? ["example.com"] : [];
        const result = await props.runCloudConsoleAction?.({
          method: "POST",
          path: "/api/cloud-console/instances",
          projectName: selectedProjectName,
          body: {
            name: `${name.trim() || "ai-lab"}-${preset.id}`,
            imageRef: selectedVmImage,
            flavorRef: selectedFlavor,
            networkId: network.id,
            securityGroupNames,
            bootVolumeSizeGb: Number(storageGb || preset.diskGb),
            resourceSource: "ai-lab",
            resourcePresetId: preset.id,
            resourcePresetLabel: preset.label,
            aiFlavorProfileId: selectedAiVmProfile.id,
          },
        });
        if (!result) throw new Error("가상머신 생성 요청을 완료하지 못했습니다. 화면 알림을 확인해 주세요.");
        setResultStatus({ tone: "success", message: result.message || "가상머신 기반 AI 랩 생성을 요청했습니다." });
      } else {
        if (!containerAvailable) throw new Error("컨테이너 기반 AI 랩이 현재 비활성화되어 있습니다.");
        const useCustomImage = containerImageMode === "custom";
        const imageName = useCustomImage ? customContainerImage.trim() : selectedContainerImage;
        if (!name.trim() || !imageName) throw new Error("랩 이름과 컨테이너 이미지를 입력해 주세요.");
        if (!useCustomImage && !containerPresetMatchesEnvironment) {
          throw new Error("선택한 환경과 일치하는 사용 가능한 컨테이너 프리셋이 없습니다.");
        }
        const result = await props.onCreateZunContainer?.({
          name: name.trim(),
          imageSource: useCustomImage ? "custom" : "managed",
          imageName: useCustomImage ? containerImages[0] || "" : imageName,
          customImageName: useCustomImage ? imageName : "",
          registryAuthEnabled: false,
          registryUrl: "",
          registryUsername: "",
          registryPassword: "",
          commandText,
          exposedPort,
          presetId: useCustomImage ? "" : selectedContainerPreset?.id || "",
          resourceSource: "ai-lab",
          resourcePresetId: preset.id,
        });
        if (!result) throw new Error("컨테이너 생성 요청을 완료하지 못했습니다. 화면 알림을 확인해 주세요.");
        setResultStatus({ tone: "success", message: result.message || "컨테이너 기반 AI 랩 생성을 요청했습니다." });
      }
    } catch (error) {
      setResultStatus({ tone: "error", message: error.message || "AI 랩 생성 요청에 실패했습니다." });
    } finally {
      setCreating(false);
    }
  }

  async function openContainerConsole(container) {
    const key = `container:${container.id}`;
    setAccessBusyKey(key);
    setResultStatus({ tone: "info", message: `${container.name || "AI 컨테이너"} 콘솔을 준비하고 있습니다.` });
    try {
      const session = await props.onCreateZunContainerTerminalSession?.(container.id, { navigate: false, throwOnError: true });
      if (!session?.wsPath) throw new Error("컨테이너 콘솔 연결 정보를 받지 못했습니다.");
      setContainerConsoleSession(session);
      setResultStatus({ tone: "success", message: "컨테이너 콘솔을 연결했습니다." });
    } catch (error) {
      setResultStatus({ tone: "error", message: error.message || "컨테이너 콘솔을 열지 못했습니다." });
    } finally {
      setAccessBusyKey("");
    }
  }

  async function runContainerAction(container, action) {
    const key = `${action}:${container.id}`;
    if (action === "delete" && !window.confirm(`${container.name || "AI 컨테이너"}를 삭제할까요?`)) return;
    setAccessBusyKey(key);
    const handlers = {
      start: props.onStartZunContainer,
      stop: props.onStopZunContainer,
      refresh: props.onRefreshZunContainer,
      delete: props.onDeleteZunContainer,
      publish: props.onPublishZunContainerDomain,
    };
    try {
      await handlers[action]?.(container.id, action === "publish" ? {} : undefined);
    } finally {
      setAccessBusyKey("");
    }
  }

  async function removeContainerDomain(container, domain) {
    const key = `domain:${container.id}:${domain.fqdn || domain.subdomain}`;
    setAccessBusyKey(key);
    try {
      await props.onUnpublishZunContainerDomain?.(container.id, domain);
    } finally {
      setAccessBusyKey("");
    }
  }

  function openVmAccess() {
    setResultStatus({ tone: "info", message: "가상머신 접속 관리에서 xterm·SSH·VNC를 선택할 수 있습니다." });
    props.setSection?.("terminalCloud");
  }

  return (
    <section className="portal-stack ai-lab-view">
      <section className="simple-panel ai-lab-hero">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">AI LAB</p>
            <h3>워크로드에 맞는 AI 실습 환경</h3>
            <p className="hint">빠른 실험은 컨테이너로, GPU·대용량 모델·장시간 작업은 전용 가상머신으로 구성합니다.</p>
          </div>
          <span className={`status-chip ${vmAvailable || containerAvailable ? "is-success" : "is-warn"}`}>{vmAvailable || containerAvailable ? "구성 가능" : "서비스 비활성"}</span>
        </div>
        <div className="admin-summary-grid">
          <div className="admin-summary-card"><span className="card-label">실행 방식</span><strong>{[vmAvailable && "VM", containerAvailable && "Container"].filter(Boolean).join(" + ") || "없음"}</strong><small>필요한 격리 수준에 따라 선택</small></div>
          <div className="admin-summary-card"><span className="card-label">AI Flavor 프로파일</span><strong>{aiVmProfiles.length}</strong><small>{aiVmProfiles.map((item) => item.label).join(", ") || "관리자 등록 필요"}</small></div>
          <div className="admin-summary-card"><span className="card-label">내 AI 자원</span><strong>{recentVms.length + recentContainers.length}</strong><small>최근 VM·컨테이너 기준</small></div>
        </div>
      </section>

      <form className="simple-panel admin-form" onSubmit={createAiLab}>
        <div className="portal-detail-head">
          <div><p className="card-label">새 AI 랩</p><h3>구성 방식 선택</h3></div>
        </div>
        <div className="ai-lab-backend-grid">
          <button className={`ai-lab-backend-card${backend === "container" ? " is-selected" : ""}`} disabled={!containerAvailable} onClick={() => setBackend("container")} type="button">
            <span>CONTAINER</span><strong>빠른 AI 실험</strong><small>시작이 빠르고 짧은 Python·Notebook 실습에 적합합니다. 현재 GPU 패스스루는 지원하지 않습니다.</small>
          </button>
          <button className={`ai-lab-backend-card${backend === "vm" ? " is-selected" : ""}`} disabled={!vmAvailable} onClick={() => setBackend("vm")} type="button">
            <span>VIRTUAL MACHINE</span><strong>전용 AI 워크스테이션</strong><small>GPU Flavor, 큰 디스크, 장시간 추론과 CUDA 개발에 적합합니다.</small>
          </button>
        </div>

        <div className="admin-form-grid compact-admin-grid">
          <label><span>환경 프리셋</span><select value={presetId} onChange={(event) => choosePreset(event.target.value)}>{AI_LAB_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><small>{preset.description}</small></label>
          {backend === "container" ? <label><span>랩 이름</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: ai-notebook" /></label> : null}
          {backend === "vm" ? <>
            <label><span>전용 프로젝트</span><select value={selectedProjectName} onChange={(event) => setProjectName(event.target.value)}><option value="">프로젝트 없음</option>{projects.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label><span>기반 OS 이미지</span><select value={selectedVmImage} onChange={(event) => setVmImage(event.target.value)}>{profileVmImages.length ? profileVmImages.map((item) => <option key={item} value={item}>{item}</option>) : <option value="">허용 기반 이미지 없음</option>}</select><small>AI 프로그램은 이미지에 고정하지 않고 생성 후 선택형 구성으로 분리합니다.</small></label>
            <label><span>AI Flavor 프로파일</span><select value={selectedAiVmProfile?.id || ""} onChange={(event) => setAiFlavorProfileId(event.target.value)}><option value="">프로파일 없음</option>{aiVmProfiles.filter((item) => item.workload === preset.id).map((item) => <option key={item.id} value={item.id}>{item.label} · {item.flavorName}{item.gpuEnabled ? ` · ${item.gpuType} x${item.gpuCount}` : " · CPU"}</option>)}</select><small>{selectedAiVmProfile ? `${selectedAiVmProfile.description || preset.description} · 사용자당 최대 ${selectedAiVmProfile.maxInstancesPerUser}대` : "관리자가 OpenStack Flavor와 extra_specs를 연결해야 합니다."}</small></label>
            <label><span>루트 디스크(GB)</span><input min="20" max="2048" type="number" value={storageGb} onChange={(event) => setStorageGb(event.target.value)} /><small>{status.selfServiceVmVolumeBootEnabled ? "Cinder 볼륨 부팅 적용" : "이미지 기본 디스크 사용"}</small></label>
          </> : <>
            <label><span>이미지 유형</span><select value={containerImageMode} onChange={(event) => setContainerImageMode(event.target.value)}><option value="managed">관리자 허용 이미지</option><option value="custom">직접 입력</option></select></label>
            {containerImageMode === "managed" ? <label><span>컨테이너 이미지</span><select value={selectedContainerImage} onChange={(event) => { const value = event.target.value; const catalogItem = containerCatalog.find((entry) => entry.targetImage.toLowerCase() === value.toLowerCase()); setContainerImage(value); if (catalogItem) { setPresetId(catalogItem.category); setExposedPort(String(catalogItem.recommendedPort || "")); setCommandText(String(catalogItem.commandText || "")); } }}><option value="">프리셋 이미지 선택</option>{containerImages.map((item) => { const catalogItem = containerCatalog.find((entry) => entry.targetImage.toLowerCase() === item.toLowerCase()); return <option disabled={!catalogItem || Boolean(catalogItem.gpuRequired && !catalogItem.gpuReady)} key={item} value={item}>{catalogItem ? `${catalogItem.label}${catalogItem.gpuRequired ? " · GPU" : ""}` : `${item} · 프리셋 없음`}</option>; })}</select><small>{selectedContainerPreset?.description || "선택한 환경과 일치하는 이미지를 선택해 주세요."}</small></label> : <label><span>컨테이너 이미지 URL</span><input value={customContainerImage} onChange={(event) => setCustomContainerImage(event.target.value)} placeholder="예: quay.io/jupyter/pytorch-notebook:latest" /></label>}
            <label><span>실행 명령</span><input disabled={containerImageMode === "managed"} value={commandText} onChange={(event) => setCommandText(event.target.value)} /><small>{containerImageMode === "managed" ? "관리 프리셋이 이미지 기본 명령 또는 지정 명령을 적용합니다." : "비워두면 이미지 기본 명령을 사용합니다."}</small></label>
            <label><span>서비스 포트</span><input disabled={containerImageMode === "managed"} min="1" max="65535" type="number" value={exposedPort} onChange={(event) => setExposedPort(event.target.value)} /><small>{containerImageMode === "managed" ? selectedContainerPreset?.autoPublishDomain ? "관리 프리셋 권장 포트를 적용하고 실행 완료 후 자동 도메인을 연결합니다." : "관리 프리셋 권장 포트를 적용합니다. 서비스가 없는 개발 런타임은 도메인을 자동 연결하지 않습니다." : null}</small></label>
          </>}
        </div>

        {backend === "vm" && !selectedAiVmProfile ? <div className="inline-notice-card is-warning">이 환경에 사용할 AI VM Flavor 프로파일이 없습니다. 관리자가 Flavor, 용도, GPU 사양과 필수 extra_specs를 등록해야 합니다.</div> : null}
        {backend === "container" && selectedContainerPreset?.gpuRequired && !selectedContainerPreset?.gpuReady ? <div className="inline-notice-card is-warning">이 이미지는 GPU가 필요하지만 Zun GPU Runtime이 아직 준비되지 않았습니다. 관리자 설정 후 사용할 수 있습니다.</div> : null}
        {backend === "container" && containerImageMode === "managed" && !containerPresetMatchesEnvironment ? <div className="inline-notice-card is-warning">{preset.gpuRequired ? "이 환경에 필요한 GPU 컨테이너 프리셋이 아직 준비되지 않았습니다." : "선택한 환경과 일치하는 허용 이미지가 없습니다. 관리자가 프리셋 이미지를 먼저 미러링해야 합니다."}</div> : null}
        {backend === "vm" && selectedAiVmProfile?.gpuEnabled && !Object.keys(selectedAiVmProfile.expectedExtraSpecs || {}).length ? <div className="inline-notice-card is-warning">GPU 프로파일의 필수 extra_specs가 비어 있어 생성할 수 없습니다. 관리자 설정을 확인해 주세요.</div> : null}
        {backend === "vm" && !projects.length ? <div className="inline-notice-card is-warning">전용 프로젝트가 없습니다. 클라우드 콘솔에서 프로젝트를 먼저 생성해야 합니다.</div> : null}
        {resultStatus.message ? <p className={`hint ${resultStatus.tone === "error" ? "is-error" : resultStatus.tone === "success" ? "is-success" : ""}`}>{resultStatus.message}</p> : null}
        <div className="portal-actions">
          <button className="primary-btn" disabled={creating || (backend === "vm" ? !vmAvailable || !projects.length || !selectedAiVmProfile || selectedAiVmProfile.workload !== preset.id || (selectedAiVmProfile.gpuEnabled && !Object.keys(selectedAiVmProfile.expectedExtraSpecs || {}).length) : !containerAvailable || (containerImageMode === "managed" && !containerPresetMatchesEnvironment) || Boolean(selectedContainerPreset?.gpuRequired && !selectedContainerPreset?.gpuReady))} type="submit">{creating ? "AI 랩 구성 중" : `${backend === "vm" ? "VM" : "컨테이너"} AI 랩 생성`}</button>
          <button className="mini-btn" onClick={() => props.setSection?.(backend === "vm" ? "terminalCloud" : "zun")} type="button">상세 관리 화면</button>
        </div>
      </form>

      <section className="simple-panel">
        <div className="portal-detail-head"><div><p className="card-label">내 자원</p><h3>AI VM·컨테이너 통합 관리</h3></div></div>
        <div className="ai-lab-resource-grid">
          {[...recentVms.map((item) => ({ ...item, kind: "VM", title: item.stackName || item.name || `VM #${item.id}` })), ...recentContainers.map((item) => ({ ...item, kind: "Container", title: item.name || `Container #${item.id}` }))].map((item) => {
            const normalizedStatus = String(item.status || "").toLowerCase();
            const containerXtermReady = item.kind === "Container" && Boolean(item.containerUuid) && normalizedStatus === "running";
            const vmAccessReady = item.kind === "VM" && ["running", "active"].includes(normalizedStatus);
            const busyKey = `${item.kind === "Container" ? "container" : "vm"}:${item.id}`;
            return (
              <article className="admin-summary-card" key={`${item.kind}-${item.id}`}>
                <span className="card-label">{item.kind}</span>
                <strong>{item.title}</strong>
                <small>{resourceStatusLabel(item.status)}{item.flavor ? ` · ${item.flavor}` : ""}{item.imageName ? ` · ${item.imageName}` : ""}</small>
                {item.kind === "Container" && (item.publicDomains || []).length ? <div className="domain-chip-list">{item.publicDomains.map((domain) => <span className="domain-chip" key={domain.fqdn || domain.subdomain}><a href={domain.url} rel="noreferrer" target="_blank">{domain.fqdn || domain.subdomain}</a><button aria-label="도메인 해제" disabled={Boolean(accessBusyKey)} onClick={() => removeContainerDomain(item, domain)} type="button">×</button></span>)}</div> : null}
                <div className="portal-actions">
                  {item.kind === "Container" ? <>
                    <button className="mini-btn primary-mini-btn" disabled={!containerXtermReady || Boolean(accessBusyKey)} onClick={() => openContainerConsole(item)} type="button">{accessBusyKey === busyKey ? "콘솔 준비 중" : "컨테이너 콘솔"}</button>
                    {normalizedStatus === "stopped" || normalizedStatus === "failed" ? <button className="mini-btn start-btn" disabled={Boolean(accessBusyKey)} onClick={() => runContainerAction(item, "start")} type="button">시작</button> : null}
                    {normalizedStatus === "running" ? <button className="mini-btn stop-btn" disabled={Boolean(accessBusyKey)} onClick={() => runContainerAction(item, "stop")} type="button">중지</button> : null}
                    <button className="mini-btn" disabled={Boolean(accessBusyKey)} onClick={() => runContainerAction(item, "refresh")} type="button">갱신</button>
                    <button className="mini-btn" disabled={normalizedStatus !== "running" || !item.exposedPort || Boolean(accessBusyKey)} onClick={() => runContainerAction(item, "publish")} type="button">도메인 추가</button>
                    <button className="mini-btn danger-mini-btn" disabled={Boolean(accessBusyKey)} onClick={() => runContainerAction(item, "delete")} type="button">삭제</button>
                  </> : <>
                    <button className="mini-btn primary-mini-btn" disabled={!vmAccessReady || Boolean(accessBusyKey)} onClick={openVmAccess} type="button">xterm · SSH · VNC</button>
                    <button className="mini-btn" onClick={() => props.setSection?.("terminalCloud")} type="button">가상머신 관리</button>
                  </>}
                </div>
                <small>{item.kind === "Container" ? "Zun WebSocket 콘솔(exec, 필요 시 attach)과 시작·중지·갱신·삭제·외부 도메인을 이 화면에서 관리합니다." : "가상머신 접속 관리에서 SSH 인증정보와 VNC 콘솔을 선택합니다."}</small>
              </article>
            );
          })}
          {!recentVms.length && !recentContainers.length ? <div className="hint">생성된 AI 랩 후보 자원이 없습니다.</div> : null}
        </div>
      </section>
      {containerConsoleSession ? <div ref={consolePanelRef}><ZunContainerConsole session={containerConsoleSession} onClose={() => setContainerConsoleSession(null)} /></div> : null}
    </section>
  );
}
