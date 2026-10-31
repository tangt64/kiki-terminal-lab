import { useMemo, useState } from "react";
import { formatDateTime, formatTrafficBytes, labStatus } from "./portal-views.jsx";

const RUNNING_STATUSES = new Set(["running"]);
const ACTIVE_STATUSES = new Set(["approved", "provisioning", "running", "paused", "stopped", "terminating"]);

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function clampPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function metricClass(percent) {
  if (percent >= 90) return "is-danger";
  if (percent >= 75) return "is-warn";
  return "is-ok";
}

function riskClass(level) {
  const normalized = normalizeText(level);
  if (normalized === "danger") return "is-error";
  if (normalized === "warn") return "is-warn";
  return "is-success";
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildFallbackItems(props = {}) {
  const courses = new Map((props.adminCourses || []).map((course) => [Number(course.id), course]));
  const labItems = (props.adminLabs || [])
    .filter((lab) => ACTIVE_STATUSES.has(normalizeText(lab.status)))
    .map((lab) => {
      const course = courses.get(Number(lab.courseId)) || {};
      return {
        key: `lab-${lab.id}`,
        type: "lab",
        id: lab.id,
        title: lab.courseTitle || course.title || lab.title || "과정 랩",
        label: "랩",
        userName: lab.userName || lab.name || lab.username || "-",
        username: lab.username || "-",
        status: normalizeText(lab.status) || "unknown",
        instanceIp: lab.instanceIp || lab.instance_ip || "-",
        flavor: lab.flavor || course.flavor || "-",
        instanceCount: lab.instanceCount || 1,
        metrics: lab.metrics || {},
        risk: lab.risk || { level: "normal", label: "정상" },
        actions: {
          canPause: normalizeText(lab.status) === "running",
          canResume: ["paused", "stopped"].includes(normalizeText(lab.status)),
          canTerminate: true,
          canWarn: true,
        },
      };
    });

  const selfServiceItems = (props.selfServiceVms || [])
    .filter((vm) => ACTIVE_STATUSES.has(normalizeText(vm.status)))
    .map((vm) => ({
      key: `self-service-vm-${vm.id}`,
      type: "self-service-vm",
      id: vm.id,
      title: vm.stackName || vm.projectName || "사용자화 VM",
      label: "사용자화 VM",
      userName: vm.userName || vm.username || "-",
      username: vm.username || "-",
      status: normalizeText(vm.status) || "unknown",
      instanceIp: vm.instanceIp || vm.instance_ip || "-",
      flavor: vm.flavor || "-",
      instanceCount: vm.instanceCount || 1,
      metrics: vm.metrics || {},
      risk: vm.risk || { level: "normal", label: "정상" },
      actions: {
        canTerminate: true,
        canWarn: true,
      },
    }));

  return [...labItems, ...selfServiceItems];
}

function getMonitorItems(props = {}) {
  const payload = props.adminInstanceMonitor || {};
  if (Array.isArray(payload.items) && payload.items.length) return payload.items;
  return buildFallbackItems(props);
}

function metricValue(metrics = {}, key) {
  const value = Number(metrics[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function getItemNetworkBytes(item = {}) {
  const metrics = item.metrics || {};
  const rx = metricValue(metrics, "networkRxBytes");
  const tx = metricValue(metrics, "networkTxBytes");
  return metricValue(metrics, "networkDailyBytes") || metricValue(metrics, "networkTotalBytes") || rx + tx;
}

function getMetricSnapshot(item = {}) {
  const metrics = item.metrics || {};
  const diskBytes = metricValue(metrics, "diskReadBytes") + metricValue(metrics, "diskWriteBytes");
  const networkBytes = getItemNetworkBytes(item);
  return {
    cpu: clampPercent(metrics.cpuUsagePercent),
    memory: clampPercent(metrics.memoryUsagePercent),
    diskBytes,
    networkBytes,
  };
}

function renderMetricBar(label, percent, valueLabel) {
  const safePercent = clampPercent(percent);
  return (
    <div className="ops-monitor-metric">
      <span>{label}</span>
      <strong>{valueLabel}</strong>
      <i aria-hidden="true">
        <b className={metricClass(safePercent)} style={{ width: `${safePercent}%` }} />
      </i>
    </div>
  );
}

function handleSelectableCardKeyDown(event, onSelect) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onSelect();
}

function terminateItem(props, item) {
  if (item.type === "self-service-vm") {
    props.onTerminateSelfServiceVm?.(item.id);
    return;
  }
  props.onTerminateLab?.(item.id);
}

function getCinderDefaults(props) {
  const platform = props.platformStatus || {};
  const projects = safeArray(platform.selfServiceVmAllowedProjects);
  const networks = safeArray(platform.selfServiceVmAllowedNetworks);
  const images = safeArray(platform.selfServiceVmAllowedImages);
  const flavors = safeArray(platform.selfServiceVmAllowedFlavors);
  return {
    projectName: projects[0] || platform.serviceProjectName || "",
    networkName: networks[0] || "net-infra",
    imageName: images[0] || "",
    flavor: flavors[0] || "",
    bootVolumeSizeGb: Number(platform.selfServiceVmDefaultBootVolumeSizeGb || 20) || 20,
    bootVolumeType: platform.selfServiceVmDefaultBootVolumeType || "",
  };
}

function formatPreflightIssues(preflight = {}) {
  const failedChecks = safeArray(preflight.checks).filter((item) => item && item.pass === false);
  if (!failedChecks.length) return preflight.detailMessage || "";
  return failedChecks
    .map((item) => {
      const required = `${item.required}${item.unit || ""}`;
      const remaining = item.remaining == null ? "확인 불가" : `${item.remaining}${item.unit || ""}`;
      return `${item.label}: 필요 ${required} / 남음 ${remaining}`;
    })
    .join(" · ");
}

export default function OpsMonitorView(props) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [selectedKey, setSelectedKey] = useState("");
  const [cinderStatus, setCinderStatus] = useState(null);
  const [cinderBusy, setCinderBusy] = useState(false);

  const items = useMemo(() => getMonitorItems(props), [props.adminInstanceMonitor, props.adminLabs, props.selfServiceVms, props.adminCourses]);
  const normalizedQuery = normalizeText(query);
  const filteredItems = items.filter((item) => {
    const status = normalizeText(item.status);
    if (statusFilter === "running" && !RUNNING_STATUSES.has(status)) return false;
    if (statusFilter === "risk" && !["danger", "warn"].includes(normalizeText(item.risk?.level))) return false;
    if (!normalizedQuery) return true;
    return [
      item.title,
      item.label,
      item.userName,
      item.username,
      item.instanceIp,
      item.flavor,
      item.stackName,
      item.projectName,
    ].some((value) => normalizeText(value).includes(normalizedQuery));
  });
  const totals = props.adminInstanceMonitor?.totals || {};
  const runningCount = items.filter((item) => RUNNING_STATUSES.has(normalizeText(item.status))).length;
  const riskCount = items.filter((item) => ["danger", "warn"].includes(normalizeText(item.risk?.level))).length;
  const connectedUsers = Number(props.adminAccessStats?.currentConnectedUsers || props.apiMonitor?.access?.currentConnectedUsers || 0) || 0;
  const checkedAt = props.adminInstanceMonitor?.checkedAt || props.apiMonitor?.checkedAt || "";
  const selectedItem = items.find((item) => (item.key || `${item.type}-${item.id}`) === selectedKey) || filteredItems[0] || null;
  const cinderDefaults = getCinderDefaults(props);
  const cinderEnabled = Boolean(props.platformStatus?.selfServiceVmVolumeBootEnabled);
  const cinderReady = Boolean(cinderEnabled && cinderDefaults.projectName && cinderDefaults.flavor && cinderDefaults.imageName);

  async function runCinderPreflight() {
    if (!props.onCheckSelfServiceVmPreflight) return;
    setCinderBusy(true);
    setCinderStatus({ tone: "info", message: "Cinder volume 부팅 사전 점검 중입니다." });
    try {
      const result = await props.onCheckSelfServiceVmPreflight({
        ...cinderDefaults,
        instanceCount: 1,
        bootFromVolume: true,
        bootVolumeSizeGb: cinderDefaults.bootVolumeSizeGb,
      });
      const preflight = result?.preflight || {};
      setCinderStatus({
        tone: preflight.canCreate === false ? "error" : "success",
        message: preflight.message || (preflight.canCreate === false ? "Cinder volume 부팅 점검이 실패했습니다." : "Cinder volume 부팅 사전 점검을 통과했습니다."),
        detail: formatPreflightIssues(preflight),
      });
    } catch (error) {
      setCinderStatus({ tone: "error", message: error.message || "Cinder volume 부팅 점검 중 오류가 발생했습니다." });
    } finally {
      setCinderBusy(false);
    }
  }

  async function runCinderCreateTest() {
    if (!props.onCreateSelfServiceVm) return;
    if (!window.confirm("Cinder volume 부팅 테스트 VM 1대를 실제로 생성할까요? 생성 후 운영 모니터에서 정리할 수 있습니다.")) return;
    setCinderBusy(true);
    setCinderStatus({ tone: "info", message: "Cinder volume 부팅 테스트 VM 생성을 요청하고 있습니다." });
    try {
      const result = await props.onCreateSelfServiceVm({
        ...cinderDefaults,
        instanceCount: 1,
        bootFromVolume: true,
        bootVolumeSizeGb: cinderDefaults.bootVolumeSizeGb,
        cloudInitMode: "none",
        cinderBootTest: true,
        __returnError: true,
      });
      setCinderStatus({ tone: result ? "success" : "error", message: result?.message || "테스트 VM 생성 요청 결과를 확인해 주세요." });
    } catch (error) {
      setCinderStatus({ tone: "error", message: error.message || "Cinder 테스트 VM 생성 중 오류가 발생했습니다." });
    } finally {
      setCinderBusy(false);
    }
  }

  return (
    <section className="ops-monitor-view">
      <header className="ops-monitor-hero">
        <div>
          <p className="card-label">LIVE OPERATIONS</p>
          <h2>운영 모니터</h2>
          <p>관리자 전용 화면입니다. 실행 중인 랩과 VM, 접속 인원, 위험 신호를 한곳에서 확인합니다.</p>
        </div>
        <div className="ops-monitor-actions">
          <span>{checkedAt ? `최근 수집 ${formatDateTime(checkedAt)}` : "수집 대기"}</span>
          <button className="primary-btn" onClick={props.onRefreshApiMonitor} type="button">새로고침</button>
          <button className="ghost-btn" onClick={() => window.open("/ops-monitor", "_blank", "noopener,noreferrer")} type="button">독립 창</button>
          <button className="ghost-btn" onClick={() => props.navigate?.("/admin")} type="button">관리자 페이지</button>
        </div>
      </header>

      <div className="ops-monitor-summary">
        <article>
          <span>전체 VM</span>
          <strong>{`${totals.total ?? items.length}개`}</strong>
          <small>{`실행 중 ${totals.running ?? runningCount}개`}</small>
        </article>
        <article>
          <span>주의 대상</span>
          <strong>{`${riskCount}개`}</strong>
          <small>CPU, MEM, NET, 장기 실행 기준</small>
        </article>
        <article>
          <span>접속 인원</span>
          <strong>{`${connectedUsers}명`}</strong>
          <small>현재 접속 통계 기준</small>
        </article>
        <article>
          <span>수집 상태</span>
          <strong>{`${totals.collectionOk ?? 0}/${totals.collectionPartial ?? 0}`}</strong>
          <small>{`정상/부분 · 대기 ${totals.collectionWaiting ?? 0}`}</small>
        </article>
      </div>

      <div className="ops-monitor-toolbar">
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="사용자, 과정, Stack, IP, Flavor 검색"
          type="search"
          value={query}
        />
        <div className="ops-monitor-filter" role="group" aria-label="모니터 필터">
          <button className={statusFilter === "active" ? "is-active" : ""} onClick={() => setStatusFilter("active")} type="button">전체</button>
          <button className={statusFilter === "running" ? "is-active" : ""} onClick={() => setStatusFilter("running")} type="button">실행 중</button>
          <button className={statusFilter === "risk" ? "is-active" : ""} onClick={() => setStatusFilter("risk")} type="button">주의</button>
        </div>
      </div>

      <div className="ops-monitor-layout">
        <div className="ops-monitor-grid">
          {filteredItems.length ? filteredItems.map((item) => {
            const metrics = item.metrics || {};
            const snapshot = getMetricSnapshot(item);
            const itemKey = item.key || `${item.type}-${item.id}`;
            return (
              <article
                className={`ops-monitor-vm ${selectedKey === itemKey ? "is-selected" : ""}`}
                key={itemKey}
                onClick={() => setSelectedKey(itemKey)}
                onKeyDown={(event) => handleSelectableCardKeyDown(event, () => setSelectedKey(itemKey))}
                role="button"
                tabIndex={0}
              >
                <div className="ops-monitor-vm-icon" aria-hidden="true">
                  {item.type === "self-service-vm" ? "VM" : "LAB"}
                </div>
                <div className="ops-monitor-vm-main">
                  <div className="ops-monitor-vm-head">
                    <strong>{item.title || item.label || `인스턴스 #${item.id}`}</strong>
                    <span className={`status-chip ${riskClass(item.risk?.level)}`}>{item.risk?.label || "정상"}</span>
                  </div>
                  <div className="ops-monitor-vm-meta">
                    <span>{item.userName || item.username || "-"}</span>
                    <span>{item.instanceIp || "-"}</span>
                    <span>{labStatus(item.status)}</span>
                  </div>
                  <div className="ops-monitor-metrics">
                    {renderMetricBar("CPU", snapshot.cpu, metrics.cpuSupported === false ? "-" : `${snapshot.cpu}%`)}
                    {renderMetricBar("MEM", snapshot.memory, metrics.memorySupported === false ? "-" : `${snapshot.memory}%`)}
                    {renderMetricBar("DISK", snapshot.diskBytes ? 100 : 0, formatTrafficBytes(snapshot.diskBytes))}
                    {renderMetricBar("NET", snapshot.networkBytes ? 100 : 0, formatTrafficBytes(snapshot.networkBytes))}
                  </div>
                  <div className="ops-monitor-vm-foot">
                    <span>{metrics.checkedAt ? `수집 ${formatDateTime(metrics.checkedAt)}` : metrics.message || "수집 대기"}</span>
                  </div>
                </div>
              </article>
            );
          }) : (
            <div className="ops-monitor-empty">
              <strong>표시할 인스턴스가 없습니다.</strong>
              <span>검색어 또는 필터를 변경하거나 새로고침해 주세요.</span>
            </div>
          )}
        </div>

        <aside className="ops-monitor-detail">
          <h3>자원 확인</h3>
          {selectedItem ? (
            <>
              <div className="ops-monitor-detail-title">
                <strong>{selectedItem.title || selectedItem.label || `자원 #${selectedItem.id}`}</strong>
                <span className={`status-chip ${riskClass(selectedItem.risk?.level)}`}>{selectedItem.risk?.label || "정상"}</span>
              </div>
              <dl>
                <div><dt>사용자</dt><dd>{selectedItem.userName || selectedItem.username || "-"}</dd></div>
                <div><dt>상태</dt><dd>{labStatus(selectedItem.status)}</dd></div>
                <div><dt>IP</dt><dd>{selectedItem.instanceIp || "-"}</dd></div>
                <div><dt>Flavor</dt><dd>{selectedItem.flavor || "-"}</dd></div>
                <div><dt>수집</dt><dd>{selectedItem.metrics?.checkedAt ? formatDateTime(selectedItem.metrics.checkedAt) : "대기"}</dd></div>
              </dl>
              <div className="ops-monitor-detail-actions">
                {selectedItem.actions?.canWarn !== false ? <button className="mini-btn" onClick={() => props.onWarnInstanceUsage?.(selectedItem)} type="button">사용자 경고</button> : null}
                {selectedItem.actions?.canPause ? <button className="mini-btn stop-btn" onClick={() => props.onAdminLabPowerAction?.(selectedItem.id, "pause")} type="button">일시중지</button> : null}
                {selectedItem.actions?.canResume ? <button className="mini-btn start-btn" onClick={() => props.onAdminLabPowerAction?.(selectedItem.id, "resume")} type="button">시작</button> : null}
                {selectedItem.actions?.canTerminate ? <button className="mini-btn danger-mini-btn" onClick={() => terminateItem(props, selectedItem)} type="button">자원 정리</button> : null}
              </div>
            </>
          ) : (
            <p className="hint">왼쪽 목록에서 자원을 선택하면 상세 상태와 정리 버튼이 표시됩니다.</p>
          )}
        </aside>
      </div>

      <section className="ops-monitor-cinder">
        <div>
          <p className="card-label">CINDER BOOT TEST</p>
          <h3>Cinder volume 부팅 점검</h3>
          <p>전용 프로젝트에서 OS 디스크를 Cinder volume으로 만드는 경로를 사전 점검하거나 테스트 VM 1대로 확인합니다.</p>
          <div className="ops-monitor-cinder-meta">
            <span>{`프로젝트 ${cinderDefaults.projectName || "-"}`}</span>
            <span>{`네트워크 ${cinderDefaults.networkName || "-"}`}</span>
            <span>{`Flavor ${cinderDefaults.flavor || "-"}`}</span>
            <span>{`Volume ${cinderDefaults.bootVolumeSizeGb}GB${cinderDefaults.bootVolumeType ? ` / ${cinderDefaults.bootVolumeType}` : ""}`}</span>
          </div>
        </div>
        <div className="ops-monitor-cinder-actions">
          <span className={`status-chip ${cinderEnabled ? "is-success" : "is-warn"}`}>{cinderEnabled ? "기능 활성" : "설정 필요"}</span>
          <button className="ghost-btn" disabled={!cinderReady || cinderBusy} onClick={runCinderPreflight} type="button">사전 점검</button>
          <button className="primary-btn" disabled={!cinderReady || cinderBusy} onClick={runCinderCreateTest} type="button">테스트 VM 생성</button>
        </div>
        {cinderStatus ? (
          <div className={`inline-message is-${cinderStatus.tone === "error" ? "danger" : cinderStatus.tone === "success" ? "success" : "info"} ops-monitor-cinder-result`}>
            <strong>{cinderStatus.message}</strong>
            {cinderStatus.detail ? <span>{cinderStatus.detail}</span> : null}
          </div>
        ) : null}
      </section>
    </section>
  );
}
