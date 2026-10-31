import { useEffect, useMemo, useState } from "react";
import { api } from "./portal-state.js";
import { AI_VM_WORKLOADS, formatAiVmExtraSpecs, parseAiVmExtraSpecs } from "../../shared/ai-vm-flavor-catalog.js";

const VM_ACTIVE = new Set(["active", "running"]);
const VM_STOPPED = new Set(["shutoff", "stopped", "paused", "suspended"]);
const CONTAINER_ACTIVE = new Set(["running", "creating", "starting", "provisioning"]);
const CONTAINER_STOPPED = new Set(["stopped", "failed", "error", "exited"]);

function normalizedStatus(value) {
  return String(value || "unknown").trim().toLowerCase() || "unknown";
}

function statusLabel(value) {
  const status = normalizedStatus(value);
  if (["active", "running"].includes(status)) return "실행 중";
  if (["requested", "approved", "executing", "provisioning", "creating", "starting"].includes(status)) return "준비 중";
  if (["shutoff", "stopped", "paused", "suspended", "exited"].includes(status)) return "중지";
  if (["failed", "error"].includes(status)) return "오류";
  if (["deleted", "terminated"].includes(status)) return "삭제됨";
  return value || "확인 필요";
}

function statusClass(value) {
  const status = normalizedStatus(value);
  if (["active", "running"].includes(status)) return "is-success";
  if (["failed", "error"].includes(status)) return "is-failed";
  if (["requested", "approved", "executing", "provisioning", "creating", "starting"].includes(status)) return "is-warn";
  return "is-muted";
}

function canRun(item, action) {
  const status = normalizedStatus(item.status);
  const isVm = item.kind === "vm" || item.kind === "legacy-vm";
  if (action === "refresh") return true;
  if (action === "publish") return item.kind === "container" && status === "running" && Boolean(item.exposedPort);
  if (action === "delete") return Boolean(item.remoteId || item.kind === "container");
  if (action === "start") return isVm ? VM_STOPPED.has(status) : CONTAINER_STOPPED.has(status);
  if (action === "stop") return isVm ? VM_ACTIVE.has(status) : CONTAINER_ACTIVE.has(status);
  if (action === "reboot") return isVm && VM_ACTIVE.has(status);
  return false;
}

export default function AdminAiLabsTab(props) {
  const [actions, setActions] = useState([]);
  const [resources, setResources] = useState([]);
  const [capacity, setCapacity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState({ tone: "", message: "" });
  const [backendFilter, setBackendFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState([]);

  const refresh = async () => {
    setLoading(true);
    const [actionResult, resourceResult, capacityResult] = await Promise.allSettled([
      api("/api/cloud-console/actions"),
      api("/api/admin/cloud-console/resources"),
      api("/api/admin/cloud-console/flavor-capacity"),
    ]);
    if (actionResult.status === "fulfilled") setActions(actionResult.value.actions || []);
    if (resourceResult.status === "fulfilled") setResources(resourceResult.value.projects || []);
    if (capacityResult.status === "fulfilled") setCapacity(capacityResult.value.flavors || []);
    const failures = [actionResult, resourceResult, capacityResult].filter((item) => item.status === "rejected");
    if (failures.length) setNotice({ tone: "error", message: failures.map((item) => item.reason?.message).filter(Boolean).join(" · ") || "AI 랩 자원을 모두 불러오지 못했습니다." });
    try { await props.loadAdmin?.(); } catch { /* Keep the directly loaded AI resource results. */ }
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  const items = useMemo(() => {
    const aiVmCatalog = Array.isArray(props.platformStatus?.aiVmFlavorCatalog) ? props.platformStatus.aiVmFlavorCatalog : [];
    const instanceMap = new Map();
    for (const project of resources) {
      for (const instance of project.instances || []) {
        instanceMap.set(`${String(project.projectName || "").toLowerCase()}:${instance.id}`, { instance, project });
      }
    }
    const vmItems = actions
      .filter((action) => action.operation === "POST /api/cloud-console/instances" && action.request?.body?.resourceSource === "ai-lab")
      .map((action) => {
        const remoteId = String(action.result?.id || action.result?.server?.id || "").trim();
        const matched = instanceMap.get(`${String(action.projectName || "").toLowerCase()}:${remoteId}`);
        return {
          key: `vm:${action.id}`,
          kind: "vm",
          recordId: action.id,
          remoteId,
          name: matched?.instance?.name || action.request?.body?.name || `AI VM #${action.id}`,
          status: matched?.instance?.status || action.result?.instanceStatus || action.status,
          userId: action.userId,
          userName: action.userName || action.username || matched?.project?.userName || `사용자 #${action.userId}`,
          projectName: action.projectName || "",
          imageName: action.request?.body?.imageRef || "",
          flavor: action.request?.body?.flavorRef || "",
          presetId: action.request?.body?.resourcePresetId || "",
          presetLabel: action.request?.body?.resourcePresetLabel || "",
          errorMessage: action.errorMessage || "",
          inferred: false,
          gpu: Boolean(aiVmCatalog.find((profile) => profile.id === action.request?.body?.aiFlavorProfileId)?.gpuEnabled),
        };
      });
    const legacyVmItems = (props.selfServiceVms || [])
      .filter((vm) => String(vm.publicAccessNote || "").startsWith("AI 랩"))
      .map((vm) => ({
        key: `legacy-vm:${vm.id}`,
        kind: "legacy-vm",
        recordId: vm.id,
        remoteId: vm.vmNodes?.[0]?.serverId || vm.instanceUuid || "",
        name: vm.stackName || `AI VM #${vm.id}`,
        status: vm.status,
        userId: vm.userId,
        userName: vm.userName || vm.username || `사용자 #${vm.userId}`,
        projectName: vm.projectName || "",
        imageName: vm.imageName || "",
        flavor: vm.flavor || "",
        presetId: "legacy",
        presetLabel: vm.publicAccessNote,
        errorMessage: vm.errorMessage || "",
        inferred: true,
        gpu: Boolean(aiVmCatalog.find((profile) => profile.flavorName === vm.flavor)?.gpuEnabled),
      }));
    const catalog = Array.isArray(props.platformStatus?.aiContainerImageCatalog) ? props.platformStatus.aiContainerImageCatalog : [];
    const containerItems = (props.zunContainers || [])
      .filter((container) => {
        if (container.resourceSource === "ai-lab") return true;
        return String(container.name || "").toLowerCase().startsWith("ai-")
          && catalog.some((entry) => String(entry.targetImage || "").toLowerCase() === String(container.imageName || "").toLowerCase());
      })
      .map((container) => {
        const catalogItem = catalog.find((entry) => String(entry.targetImage || "").toLowerCase() === String(container.imageName || "").toLowerCase());
        return {
          key: `container:${container.id}`,
          kind: "container",
          recordId: container.id,
          remoteId: container.containerUuid || "",
          name: container.name || `AI 컨테이너 #${container.id}`,
          status: container.status,
          userId: container.userId,
          userName: container.userName || container.username || `사용자 #${container.userId}`,
          projectName: container.projectName || "",
          imageName: container.imageName || "",
          flavor: "",
          presetId: container.resourcePresetId || catalogItem?.id || "",
          presetLabel: catalogItem?.label || "",
          errorMessage: container.errorMessage || "",
          exposedPort: container.exposedPort || null,
          publicDomains: Array.isArray(container.publicDomains) ? container.publicDomains : [],
          inferred: container.resourceSource !== "ai-lab",
          gpu: Boolean(catalogItem?.gpuRequired),
        };
      });
    return [...vmItems, ...legacyVmItems, ...containerItems];
  }, [actions, resources, props.selfServiceVms, props.zunContainers, props.platformStatus?.aiContainerImageCatalog, props.platformStatus?.aiVmFlavorCatalog]);

  const aiVmProfiles = Array.isArray(props.platformStatus?.aiVmFlavorCatalog) ? props.platformStatus.aiVmFlavorCatalog : [];
  const aiContainerPresets = Array.isArray(props.platformStatus?.aiContainerImageCatalog) ? props.platformStatus.aiContainerImageCatalog : [];
  const allowedFlavors = Array.isArray(props.platformStatus?.selfServiceVmAllowedFlavors) ? props.platformStatus.selfServiceVmAllowedFlavors : [];
  const allowedImages = Array.isArray(props.platformStatus?.selfServiceVmAllowedImages) ? props.platformStatus.selfServiceVmAllowedImages : [];
  const updateAiVmProfile = (id, patch) => props.setPlatformStatus?.((current) => ({
    ...current,
    aiVmFlavorCatalog: (current.aiVmFlavorCatalog || []).map((item) => item.id === id ? { ...item, ...patch } : item),
  }));
  const addAiVmProfile = () => {
    const flavorName = allowedFlavors.find((name) => !aiVmProfiles.some((item) => item.flavorName === name));
    if (!flavorName) { setNotice({ tone: "error", message: "추가할 수 있는 미등록 허용 Flavor가 없습니다." }); return; }
    const id = `ai-${String(flavorName).toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}`;
    props.setPlatformStatus?.((current) => ({
      ...current,
      aiVmFlavorCatalog: [...(current.aiVmFlavorCatalog || []), {
        id, flavorName, label: flavorName, description: "", workload: "python", enabled: true,
        gpuEnabled: false, gpuType: "", gpuCount: 0, vramGb: 0, allowedImages: [],
        expectedExtraSpecs: {}, maxInstancesPerUser: 1, hourlyCost: 0, softwareDelivery: "bootstrap",
      }],
    }));
  };
  const removeAiVmProfile = (id) => {
    if (!window.confirm("이 AI VM Flavor 프로파일을 삭제할까요?")) return;
    props.setPlatformStatus?.((current) => ({ ...current, aiVmFlavorCatalog: (current.aiVmFlavorCatalog || []).filter((item) => item.id !== id) }));
  };

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const backendMatches = backendFilter === "all" || (backendFilter === "vm" ? item.kind !== "container" : item.kind === "container");
      const status = normalizedStatus(item.status);
      const statusMatches = statusFilter === "all"
        || (statusFilter === "active" && (VM_ACTIVE.has(status) || CONTAINER_ACTIVE.has(status)))
        || (statusFilter === "stopped" && (VM_STOPPED.has(status) || CONTAINER_STOPPED.has(status)))
        || (statusFilter === "issue" && ["failed", "error"].includes(status));
      const text = [item.name, item.userName, item.projectName, item.imageName, item.flavor, item.presetId, item.presetLabel, item.errorMessage].join(" ").toLowerCase();
      return backendMatches && statusMatches && (!query || text.includes(query));
    });
  }, [items, backendFilter, statusFilter, search]);

  const selectedItems = items.filter((item) => selectedKeys.includes(item.key));
  const toggleSelected = (key) => setSelectedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const selectVisible = (checked) => setSelectedKeys((current) => checked ? [...new Set([...current, ...filteredItems.map((item) => item.key)])] : current.filter((key) => !filteredItems.some((item) => item.key === key)));

  const executeAction = async (item, action) => {
    if (item.kind === "legacy-vm") {
      if (action === "delete") return props.onTerminateSelfServiceVm?.(item.recordId, { skipConfirm: true });
      if (["start", "stop", "reboot"].includes(action)) return props.onPowerActionSelfServiceVm?.(item.recordId, action);
      return null;
    }
    if (item.kind === "vm") {
      if (action === "refresh") return null;
      const path = `/api/cloud-console/instances/${encodeURIComponent(item.remoteId)}`;
      return action === "delete"
        ? api(path, { method: "DELETE", body: { projectName: item.projectName } })
        : api(`${path}/action`, { method: "POST", body: { projectName: item.projectName, action } });
    }
    if (action === "refresh") return api(`/api/zun/containers/${item.recordId}/refresh`, { method: "POST" });
    if (action === "delete") return api(`/api/zun/containers/${item.recordId}`, { method: "DELETE" });
    if (action === "publish") return api(`/api/zun/containers/${item.recordId}/domains`, { method: "POST", body: {} });
    return api(`/api/zun/containers/${item.recordId}/${action}`, { method: "POST" });
  };

  const runBulk = async (action, explicitItems = selectedItems) => {
    const targets = explicitItems.filter((item) => canRun(item, action));
    if (!targets.length) { setNotice({ tone: "error", message: "선택한 자원에서 실행 가능한 작업이 없습니다." }); return; }
    if (action === "delete" && !window.confirm(`AI 랩 자원 ${targets.length}개를 삭제할까요? 원격 VM·컨테이너도 함께 삭제됩니다.`)) return;
    setBusy(action);
    setNotice({ tone: "", message: "" });
    const failures = [];
    for (const item of targets) {
      try { await executeAction(item, action); }
      catch (error) { failures.push(`${item.name}: ${error.message || "작업 실패"}`); }
    }
    setSelectedKeys([]);
    await refresh();
    setNotice(failures.length
      ? { tone: "error", message: `${targets.length - failures.length}개 완료, ${failures.length}개 실패 · ${failures.slice(0, 3).join(" · ")}` }
      : { tone: "success", message: `AI 랩 자원 ${targets.length}개의 ${action === "start" ? "시작" : action === "stop" ? "중지" : action === "reboot" ? "재부팅" : action === "delete" ? "삭제" : action === "publish" ? "도메인 연결" : "상태 갱신"} 작업을 완료했습니다.` });
    setBusy("");
  };

  const activeCount = items.filter((item) => VM_ACTIVE.has(normalizedStatus(item.status)) || normalizedStatus(item.status) === "running").length;
  const issueCount = items.filter((item) => ["failed", "error"].includes(normalizedStatus(item.status))).length;
  const allVisibleSelected = Boolean(filteredItems.length) && filteredItems.every((item) => selectedKeys.includes(item.key));

  return <section className="portal-stack">
    <section className="admin-simple-card">
      <div className="admin-card-header">
        <div><strong>AI 랩 통합 관리</strong><div className="hint">VM·Zun 컨테이너 AI 랩을 사용자, 프리셋, 상태 기준으로 관리합니다.</div></div>
        <div className="admin-inline-actions">
          <button className="mini-btn" onClick={() => props.onOpenAdminTab?.("imageMirroring")} type="button">AI 이미지</button>
          <button className="mini-btn" onClick={() => props.onOpenAdminTab?.("platform")} type="button">AI/GPU 설정</button>
          <button className="mini-btn" disabled={loading || Boolean(busy)} onClick={refresh} type="button">새로고침</button>
        </div>
      </div>
      <div className="summary-grid">
        <div className="summary-card"><span>전체 AI 랩</span><strong>{items.length}</strong></div>
        <div className="summary-card"><span>VM / 컨테이너</span><strong>{`${items.filter((item) => item.kind !== "container").length} / ${items.filter((item) => item.kind === "container").length}`}</strong></div>
        <div className="summary-card"><span>실행 중</span><strong>{activeCount}</strong></div>
        <div className="summary-card"><span>오류</span><strong>{issueCount}</strong></div>
      </div>
    </section>

    <section className="admin-simple-card">
      <div className="admin-card-header">
        <div><strong>AI 컨테이너 프리셋</strong><div className="hint">사설 레지스트리 허용 상태와 GPU Runtime 준비 여부를 확인합니다.</div></div>
        <button className="mini-btn" onClick={() => props.onOpenAdminTab?.("imageMirroring")} type="button">이미지 미러링 관리</button>
      </div>
      <div className="admin-table admin-table-scroll">
        <div className="admin-table-head admin-course-grid"><span>프리셋</span><span>이미지 / 포트</span><span>상태</span></div>
        {aiContainerPresets.map((preset) => <div className="admin-table-row admin-course-grid" key={preset.id}>
          <span><strong>{preset.label}</strong><div className="hint">{preset.description}</div></span>
          <span><div className="hint">{preset.targetImage || preset.sourceImage}</div><div className="hint">{`포트 ${preset.recommendedPort || "-"}${preset.gpuRequired ? " · GPU" : " · CPU"}`}</div></span>
          <span><span className={`status-chip ${preset.allowed && preset.gpuReady ? "is-success" : "is-warn"}`}>{!preset.allowed ? "미러링/허용 필요" : !preset.gpuReady ? "GPU Runtime 필요" : "사용 가능"}</span></span>
        </div>)}
      </div>
    </section>

    <section className="admin-simple-card">
      <div className="admin-card-header">
        <div><strong>AI VM Flavor 프로파일</strong><div className="hint">OpenStack Flavor와 실제 extra_specs를 연결합니다. 가상머신 이미지는 기반 OS만 허용하고 AI 프로그램은 이미지에 고정하지 않습니다.</div></div>
        <div className="admin-inline-actions">
          <button className="mini-btn" onClick={addAiVmProfile} type="button">프로파일 추가</button>
          <button className="mini-btn save-btn" onClick={props.onSavePlatformSettings} type="button">설정 저장</button>
        </div>
      </div>
      {aiVmProfiles.length ? <div className="ai-vm-profile-list">{aiVmProfiles.map((profile) => {
        const live = capacity.find((item) => item.name === profile.flavorName);
        return <article className="simple-panel ai-vm-profile-card" key={profile.id}>
          <div className="admin-card-header">
            <div><strong>{profile.label || profile.flavorName}</strong><div className="hint">{live ? `${live.vcpus} vCPU · ${(Number(live.ramMb || 0) / 1024).toFixed(1)}GB RAM · ${live.diskGb}GB Disk · 예상 ${live.maxCreatable ?? "-"}대` : "OpenStack 실 사양 확인 필요"}</div></div>
            <span className={`status-chip ${live?.requiredSpecsMatch === false ? "is-failed" : live?.source === "openstack" ? "is-success" : "is-muted"}`}>{live?.requiredSpecsMatch === false ? "extra_specs 불일치" : live?.source === "openstack" ? "실 Flavor 확인" : "확인 필요"}</span>
          </div>
          {live ? <div className="mini-horizon-flavor-details"><code>{Object.keys(live.extraSpecs || {}).length ? Object.entries(live.extraSpecs).map(([key, value]) => `${key}=${value}`).join(" · ") : "OpenStack extra_specs 없음 또는 조회 권한 없음"}</code></div> : null}
          <div className="admin-form-grid compact-admin-grid">
            <label><span>OpenStack Flavor</span><select value={profile.flavorName} onChange={(event) => updateAiVmProfile(profile.id, { flavorName: event.target.value })}>{allowedFlavors.map((item) => <option disabled={aiVmProfiles.some((entry) => entry.id !== profile.id && entry.flavorName === item)} key={item} value={item}>{item}</option>)}</select></label>
            <label><span>표시 이름</span><input value={profile.label || ""} onChange={(event) => updateAiVmProfile(profile.id, { label: event.target.value })} /></label>
            <label><span>용도</span><select value={profile.workload || "python"} onChange={(event) => updateAiVmProfile(profile.id, { workload: event.target.value })}>{AI_VM_WORKLOADS.map((item) => <option key={item} value={item}>{item === "python" ? "Python AI" : item === "notebook" ? "Jupyter Notebook" : item === "inference" ? "LLM 추론" : "CUDA 개발"}</option>)}</select></label>
            <label><span>상태</span><select value={profile.enabled === false ? "disabled" : "enabled"} onChange={(event) => updateAiVmProfile(profile.id, { enabled: event.target.value === "enabled" })}><option value="enabled">사용</option><option value="disabled">중지</option></select></label>
            <label><span>GPU</span><select value={profile.gpuEnabled ? "enabled" : "disabled"} onChange={(event) => updateAiVmProfile(profile.id, { gpuEnabled: event.target.value === "enabled" })}><option value="disabled">CPU 전용</option><option value="enabled">GPU/vGPU</option></select></label>
            <label><span>GPU 종류</span><input disabled={!profile.gpuEnabled} value={profile.gpuType || ""} onChange={(event) => updateAiVmProfile(profile.id, { gpuType: event.target.value })} placeholder="예: NVIDIA A100" /></label>
            <label><span>GPU 개수</span><input disabled={!profile.gpuEnabled} min="1" max="16" type="number" value={profile.gpuCount || 1} onChange={(event) => updateAiVmProfile(profile.id, { gpuCount: Number(event.target.value || 1) })} /></label>
            <label><span>VRAM(GB)</span><input disabled={!profile.gpuEnabled} min="0" type="number" value={profile.vramGb || 0} onChange={(event) => updateAiVmProfile(profile.id, { vramGb: Number(event.target.value || 0) })} /></label>
            <label><span>사용자당 최대</span><input min="1" max="20" type="number" value={profile.maxInstancesPerUser || 1} onChange={(event) => updateAiVmProfile(profile.id, { maxInstancesPerUser: Number(event.target.value || 1) })} /></label>
            <label><span>시간당 예상 비용</span><input min="0" type="number" value={profile.hourlyCost || 0} onChange={(event) => updateAiVmProfile(profile.id, { hourlyCost: Number(event.target.value || 0) })} /></label>
            <label><span>허용 기반 OS 이미지</span><select multiple value={profile.allowedImages || []} onChange={(event) => updateAiVmProfile(profile.id, { allowedImages: [...event.target.selectedOptions].map((item) => item.value) })}>{allowedImages.map((item) => <option key={item} value={item}>{item}</option>)}</select><small>AI 프레임워크 사전 설치 이미지가 아닌 최소 OS 또는 GPU 드라이버 기반 이미지를 선택합니다.</small></label>
            <label><span>필수 extra_specs</span><input defaultValue={formatAiVmExtraSpecs(profile.expectedExtraSpecs)} key={`${profile.id}:${formatAiVmExtraSpecs(profile.expectedExtraSpecs)}`} onBlur={(event) => updateAiVmProfile(profile.id, { expectedExtraSpecs: parseAiVmExtraSpecs(event.target.value) })} placeholder="예: pci_passthrough:alias=a100:1" /><small>쉼표로 구분한 key=value 형식이며 입력 후 포커스를 벗어나면 반영됩니다.</small></label>
            <label className="admin-field-wide"><span>설명</span><input value={profile.description || ""} onChange={(event) => updateAiVmProfile(profile.id, { description: event.target.value })} placeholder="사용 목적과 제약사항" /></label>
          </div>
          <div className="admin-inline-actions">{Object.keys(live?.extraSpecs || {}).length ? <button className="mini-btn" onClick={() => updateAiVmProfile(profile.id, { expectedExtraSpecs: live.extraSpecs })} type="button">현재 extra_specs 복사</button> : null}<button className="mini-btn danger-mini-btn" onClick={() => removeAiVmProfile(profile.id)} type="button">프로파일 삭제</button></div>
        </article>;
      })}</div> : <div className="empty-state">등록된 AI VM Flavor 프로파일이 없습니다. 허용 Flavor를 먼저 등록한 뒤 프로파일을 추가해 주세요.</div>}
    </section>

    <section className="admin-simple-card">
      <div className="admin-history-search">
        <input onChange={(event) => setSearch(event.target.value)} placeholder="랩 이름, 사용자, 프로젝트, 이미지, Flavor 검색" type="search" value={search} />
        <select onChange={(event) => setBackendFilter(event.target.value)} value={backendFilter}><option value="all">VM + 컨테이너</option><option value="vm">VM</option><option value="container">컨테이너</option></select>
        <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="all">전체 상태</option><option value="active">실행/생성</option><option value="stopped">중지</option><option value="issue">오류</option></select>
      </div>
      <div className="admin-card-header">
        <label><input checked={allVisibleSelected} onChange={(event) => selectVisible(event.target.checked)} type="checkbox" /> 표시 항목 선택</label>
        <div className="admin-inline-actions">
          <span className="hint">{selectedItems.length}개 선택</span>
          <button className="mini-btn start-btn" disabled={Boolean(busy) || !selectedItems.some((item) => canRun(item, "start"))} onClick={() => runBulk("start")} type="button">시작</button>
          <button className="mini-btn stop-btn" disabled={Boolean(busy) || !selectedItems.some((item) => canRun(item, "stop"))} onClick={() => runBulk("stop")} type="button">중지</button>
          <button className="mini-btn" disabled={Boolean(busy) || !selectedItems.some((item) => canRun(item, "reboot"))} onClick={() => runBulk("reboot")} type="button">재부팅</button>
          <button className="mini-btn" disabled={Boolean(busy) || !selectedItems.length} onClick={() => runBulk("refresh")} type="button">상태 갱신</button>
          <button className="mini-btn danger-mini-btn" disabled={Boolean(busy) || !selectedItems.some((item) => canRun(item, "delete"))} onClick={() => runBulk("delete")} type="button">삭제</button>
        </div>
      </div>
      {notice.message ? <div className={`mini-horizon-status is-${notice.tone || "info"}`}>{notice.message}</div> : null}
      {loading ? <div className="empty-state">AI 랩 자원을 불러오고 있습니다.</div> : <div className="admin-table admin-table-scroll">
        <div className="admin-table-head admin-course-grid"><span>AI 랩 / 사용자</span><span>상태 / 구성</span><span>작업</span></div>
        {filteredItems.length ? filteredItems.map((item) => <div className="admin-table-row admin-course-grid" key={item.key}>
          <span>
            <label><input checked={selectedKeys.includes(item.key)} onChange={() => toggleSelected(item.key)} type="checkbox" /> <strong>{item.name}</strong></label>
            <div className="hint">{item.kind === "container" ? "CONTAINER" : "VM"}{item.gpu ? " · GPU" : " · CPU"}{item.inferred ? " · 기존 기록 추정" : ""}</div>
            <div className="hint">{item.userName} · {item.projectName || "프로젝트 없음"}</div>
          </span>
          <span>
            <span className={`status-chip ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
            <div className="hint">{item.presetLabel || item.presetId || "프리셋 없음"}</div>
            <div className="hint">{item.flavor || item.imageName || "구성 정보 없음"}</div>
            {item.kind === "container" && item.publicDomains?.length ? <div className="hint">{`외부 도메인 ${item.publicDomains.map((entry) => entry.fqdn || entry.subdomain).join(", ")}`}</div> : null}
            {item.errorMessage ? <div className="hint">{item.errorMessage}</div> : null}
          </span>
          <div className="admin-inline-actions">
            {canRun(item, "start") ? <button className="mini-btn start-btn" disabled={Boolean(busy)} onClick={() => runBulk("start", [item])} type="button">시작</button> : null}
            {canRun(item, "stop") ? <button className="mini-btn stop-btn" disabled={Boolean(busy)} onClick={() => runBulk("stop", [item])} type="button">중지</button> : null}
            {canRun(item, "reboot") ? <button className="mini-btn" disabled={Boolean(busy)} onClick={() => runBulk("reboot", [item])} type="button">재부팅</button> : null}
            <button className="mini-btn" disabled={Boolean(busy)} onClick={() => runBulk("refresh", [item])} type="button">갱신</button>
            {item.kind === "container" ? <button className="mini-btn" disabled={Boolean(busy) || normalizedStatus(item.status) !== "running" || !item.exposedPort} onClick={() => runBulk("publish", [item])} type="button">도메인 추가</button> : null}
            <button className="mini-btn danger-mini-btn" disabled={Boolean(busy) || !canRun(item, "delete")} onClick={() => runBulk("delete", [item])} type="button">삭제</button>
          </div>
        </div>) : <div className="empty-state">조건에 맞는 AI 랩 자원이 없습니다.</div>}
      </div>}
    </section>
  </section>;
}
