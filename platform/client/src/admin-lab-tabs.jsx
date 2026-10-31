import { useMemo, useState } from "react";
import {
  AdminField,
  describeCourseLabResizePolicy,
  formatCurrency,
  getCustomLabAdvancedConfigLines,
  getCustomLabStatusLabel,
  getNormalizedSshPublicHost,
  isValidExternalPort,
  labStatus,
  resolveCourseLabResizeAllowedFlavors,
} from "./portal-views.jsx";
import { deriveVmNodes } from "./portal-views.jsx";
import TerminalView, { DomainView } from "./terminal-view.jsx";

function formatPocQuote(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return "-";
  const amount = Number(rawValue.replace(/[^\d.-]/g, ""));
  return Number.isFinite(amount) && amount >= 0 ? formatCurrency(amount) : value || "-";
}

function canDeleteUnsubmittedPocQuote(request) {
  const status = String(request?.status || "").toLowerCase();
  const paymentStatus = String(request?.paymentStatus || "").toLowerCase();
  return status === "quoted"
    && paymentStatus !== "paid"
    && !request?.paymentOrderId
    && !request?.paymentRequestedAt
    && !request?.paymentKey
    && !request?.paymentPaidAt
    && !request?.stackId
    && !request?.stackName;
}

function buildAdminPocTerminalLab(request) {
  if (!request) return null;
  return {
    id: request.id,
    courseId: 0,
    status: request.status,
    stackName: request.stackName || request.title || `고급 랩 ${request.id}`,
    courseTitle: request.title || `고급 랩 ${request.id}`,
    labBackendType: "vm",
    resourceType: "custom-lab",
    instanceIp: request.instanceIp || "",
    instanceIps: request.instanceIps || [],
    vmNodes: request.vmNodes || [],
    terminalSshUser: request.terminalSshUser || "",
    terminalSshPassword: request.terminalSshPassword || "",
    requestedPublicDomains: request.requestedPublicDomains || [],
    publicDomains: request.publicDomains || [],
    publicEnabled: Boolean(request.publicEnabled),
    publicRequestPending: Boolean(request.publicRequestPending),
    publicReviewedBy: request.publicReviewedBy || "",
    publicReviewedAt: request.publicReviewedAt || null,
    publicReviewNote: request.publicReviewNote || "",
    externalSshEnabled: Boolean(request.externalSshEnabled),
    externalSshPort: request.externalSshPort || null,
    externalSshRequestPending: Boolean(request.externalSshRequestPending),
  };
}

function getPocResultGroup(request) {
  const label = String(request?.examTitle || request?.courseTitle || request?.title || "고급 랩 결과").trim() || "고급 랩 결과";
  const stableCandidates = [
    ["resultGroupId", request?.resultGroupId],
    ["pocResultGroupId", request?.pocResultGroupId],
    ["labExamId", request?.labExamId],
    ["examId", request?.examId],
    ["labExamSessionId", request?.labExamSessionId],
    ["examSessionId", request?.examSessionId],
    ["courseId", request?.courseId],
    ["courseSlug", request?.courseSlug],
  ];
  const stableCandidate = stableCandidates.find(([, value]) => String(value || "").trim());
  const normalizedLabel = label.toLocaleLowerCase("ko-KR");
  const key = stableCandidate
    ? ["courseId", "courseSlug"].includes(stableCandidate[0])
      ? `${stableCandidate[0]}:${String(stableCandidate[1]).trim()}:title:${normalizedLabel}`
      : `${stableCandidate[0]}:${String(stableCandidate[1]).trim()}`
    : `title:${normalizedLabel}`;
  return { key, label };
}

function getPocNodeHost(node, request) {
  return String(
    node?.fixedIp
    || node?.fixed_ip
    || node?.floatingIp
    || node?.floating_ip
    || request?.instanceIp
    || "",
  ).trim();
}

function getPocNodeLabel(node, index) {
  return String(node?.name || node?.label || node?.id || `VM ${index + 1}`).trim();
}

function findAdminCourseForLab(props, lab) {
  if (!lab || lab.resourceType === "custom-lab") return null;
  return (props.adminCourses || []).find((item) => Number(item.id) === Number(lab.courseId)) || null;
}

function getCourseApprovalMode(course, key) {
  return String(course?.[key] || "manual").trim().toLowerCase();
}

function isCourseFeatureDisabled(course, key) {
  return getCourseApprovalMode(course, key) === "disabled";
}

export function AdminLabDomainsTab(props) {
  const filteredLabs = [
    ...(props.adminLabs || []).map((lab) => ({ ...lab, resourceType: "lab" })),
    ...(props.adminCustomLabRequests || []).map((request) => ({
      ...request,
      resourceType: "custom-lab",
      courseTitle: request.title || `고급 랩 ${request.id}`,
    })),
  ].filter((lab) => {
    const hasPendingDomains = (lab.requestedPublicDomains || []).length > 0;
    const hasPendingTcpRoutes = lab.resourceType !== "custom-lab" && (lab.requestedPublicTcpRoutes || []).length > 0;
    if (!hasPendingDomains && !hasPendingTcpRoutes) return false;
    if (lab.resourceType === "custom-lab") return true;
    const course = findAdminCourseForLab(props, lab);
    return hasPendingTcpRoutes || String(course?.publicDomainApprovalMode || "manual").trim().toLowerCase() !== "instant";
  });

  return (
    <section className="portal-stack">
      <section className="admin-simple-card">
        <div className="admin-card-header">
          <strong>도메인 승인</strong>
        </div>
        <div className="hint">관리자 승인 방식 과정의 공개 도메인 요청만 표시합니다.</div>
      </section>
      <section className="admin-request-stack">
        {filteredLabs.length ? filteredLabs.map((lab) => {
          const course = findAdminCourseForLab(props, lab);
          const publicDomainDisabled = isCourseFeatureDisabled(course, "publicDomainApprovalMode");
          const publicTcpDisabled = isCourseFeatureDisabled(course, "publicTcpApprovalMode");
          return (
          <article className="admin-request-card" key={`domain-${lab.resourceType}-${lab.id}`}>
            <div className="admin-request-card-head">
              <div>
                <strong>{lab.resourceType === "custom-lab" ? `고급 랩: ${lab.courseTitle}` : lab.courseTitle}</strong>
                <div className="hint">{`${lab.userName || lab.username} (${lab.username})`}</div>
              </div>
              <span className="status-chip is-warn">승인 대기</span>
              {publicDomainDisabled && (lab.requestedPublicDomains || []).length ? <span className="status-chip is-error">도메인 사용금지</span> : null}
              {publicTcpDisabled && (lab.requestedPublicTcpRoutes || []).length ? <span className="status-chip is-error">TCP 사용금지</span> : null}
            </div>
            <div className="simple-status-list">
              <div>{`IP: ${lab.instanceIp || "-"}`}</div>
              <div>{`현재 공개 URL: ${(lab.publicDomains || []).map((entry) => entry.url).join(", ") || "-"}`}</div>
            </div>
            <div className="admin-request-body">
              {(lab.requestedPublicDomains || []).map((entry) => {
                const noteKey = `${lab.resourceType}:${lab.id}:${entry.subdomain}`;
                return (
                  <div className="admin-request-item" key={noteKey}>
                    <div className="admin-request-item-head">
                      <strong>{entry.url}</strong>
                      <span>{`${entry.protocol.toUpperCase()} ${entry.port}`}</span>
                    </div>
                    <textarea
                      value={props.labDomainReviewNotes[noteKey] || ""}
                      onChange={(event) => props.setLabDomainReviewNotes((current) => ({ ...current, [noteKey]: event.target.value }))}
                      placeholder="승인 또는 반려 메모"
                    />
                    <div className="admin-inline-actions">
                      <button className="mini-btn primary-mini-btn" disabled={publicDomainDisabled} onClick={() => props.onApproveLabDomain(lab.id, entry)} type="button">{publicDomainDisabled ? "사용금지" : "승인"}</button>
                      <button className="mini-btn reject-btn" onClick={() => props.onRejectLabDomain(lab.id, entry)} type="button">반려</button>
                    </div>
                  </div>
                );
              })}
              {lab.resourceType !== "custom-lab" ? (lab.requestedPublicTcpRoutes || []).map((entry) => {
                const targetPort = Number(entry.targetPort);
                const routeKey = String(entry.nodeId || entry.targetHost || "").trim();
                const noteKey = `${lab.id}:${targetPort}${routeKey ? `:${routeKey}` : ""}`;
                const targetLabel = [entry.nodeName, entry.targetHost].filter(Boolean).join(" / ") || "기본 대상";
                return (
                  <div className="admin-request-item" key={`tcp-${noteKey}`}>
                    <div className="admin-request-item-head">
                      <strong>{`외부 TCP 포트 요청`}</strong>
                      <span>{`내부 TCP ${targetPort || "-"} · ${targetLabel}`}</span>
                    </div>
                    <textarea
                      value={props.labTcpReviewNotes[noteKey] || ""}
                      onChange={(event) => props.setLabTcpReviewNotes((current) => ({ ...current, [noteKey]: event.target.value }))}
                      placeholder="승인 또는 반려 메모"
                    />
                    <div className="admin-inline-actions">
                      <button className="mini-btn primary-mini-btn" disabled={publicTcpDisabled} onClick={() => props.onApprovePublicPort(lab.id, targetPort, entry)} type="button">{publicTcpDisabled ? "TCP 사용금지" : "TCP 승인"}</button>
                      <button className="mini-btn reject-btn" onClick={() => props.onRejectPublicPort(lab.id, targetPort, entry)} type="button">TCP 반려</button>
                    </div>
                  </div>
                );
              }) : null}
            </div>
          </article>
          );
        }) : <section className="admin-simple-card"><div className="hint">승인 대기 중인 도메인 요청이 없습니다.</div></section>}
      </section>
    </section>
  );
}

export function AdminLabSshTab(props) {
  const pendingLabs = (props.adminLabs || []).filter((lab) => lab.externalSshRequestPending || lab.externalRdpRequestPending);
  return (
    <section className="portal-stack">
      <section className="admin-simple-card">
        <div className="admin-card-header">
          <strong>외부 접속 승인</strong>
        </div>
        <div className="hint">외부 SSH/RDP 승인 대기 항목을 관리합니다.</div>
      </section>
      <section className="admin-request-stack">
        {pendingLabs.length ? pendingLabs.map((lab) => {
          const nodes = deriveVmNodes(lab);
          const course = findAdminCourseForLab(props, lab);
          const externalSshDisabled = isCourseFeatureDisabled(course, "externalSshApprovalMode");
          const externalRdpDisabled = isCourseFeatureDisabled(course, "externalRdpApprovalMode");
          return (
            <article className="admin-request-card" key={`ssh-${lab.id}`}>
              <div className="admin-request-card-head">
                <div>
                  <strong>{lab.courseTitle}</strong>
                  <div className="hint">{`${lab.userName || lab.username} (${lab.username})`}</div>
                </div>
                <span className="status-chip is-warn">승인 대기</span>
                {externalSshDisabled && lab.externalSshRequestPending ? <span className="status-chip is-error">SSH 사용금지</span> : null}
                {externalRdpDisabled && lab.externalRdpRequestPending ? <span className="status-chip is-error">RDP 사용금지</span> : null}
              </div>
              <div className="simple-status-list">
                <div>{`상태: ${labStatus(lab.status)}`}</div>
                <div>{`IP: ${lab.instanceIp || "-"}`}</div>
                <div>{`대상 VM: ${nodes.map((node) => node.name).join(", ") || "-"}`}</div>
              </div>
              <textarea
                value={props.labSshReviewNotes[lab.id] || ""}
                onChange={(event) => props.setLabSshReviewNotes((current) => ({ ...current, [lab.id]: event.target.value }))}
                placeholder="승인 또는 반려 메모"
              />
              <div className="admin-inline-actions">
                {lab.externalSshRequestPending ? (
                  <>
                    <button className="mini-btn primary-mini-btn" disabled={externalSshDisabled} onClick={() => props.onApproveExternalSsh(lab.id)} type="button">{externalSshDisabled ? "SSH 사용금지" : "SSH 승인"}</button>
                    <button className="mini-btn reject-btn" onClick={() => props.onRejectExternalSsh(lab.id)} type="button">SSH 반려</button>
                  </>
                ) : null}
                {lab.externalRdpRequestPending ? (
                  <>
                    <button className="mini-btn primary-mini-btn" disabled={externalRdpDisabled} onClick={() => props.onApproveExternalRdp(lab.id)} type="button">{externalRdpDisabled ? "RDP 사용금지" : "RDP 승인"}</button>
                    <button className="mini-btn reject-btn" onClick={() => props.onRejectExternalRdp(lab.id)} type="button">RDP 반려</button>
                  </>
                ) : null}
              </div>
            </article>
          );
        }) : <section className="admin-simple-card"><div className="hint">승인 대기 중인 외부 접속 요청이 없습니다.</div></section>}
      </section>
    </section>
  );
}

export function AdminLabResizeTab(props) {
  const pendingLabs = (props.adminLabs || []).filter((lab) => lab.resizeRequestPending);
  return (
    <section className="portal-stack">
      <section className="admin-simple-card">
        <div className="admin-card-header">
          <strong>랩 사양 변경</strong>
        </div>
        <div className="hint">사용자가 요청한 Flavor 변경을 승인하거나 반려합니다.</div>
      </section>
      <section className="admin-request-stack">
        {pendingLabs.length ? pendingLabs.map((lab) => {
          const course = (props.adminCourses || []).find((item) => Number(item.id) === Number(lab.courseId)) || null;
          const allowedFlavors = resolveCourseLabResizeAllowedFlavors(course, props.platformStatus);
          const selectedFlavor = props.labResizeFlavorDrafts?.[lab.id] || lab.requestedResizeFlavor || allowedFlavors[0] || "";
          return (
            <article className="admin-request-card" key={`resize-${lab.id}`}>
              <div className="admin-request-card-head">
                <div>
                  <strong>{lab.courseTitle}</strong>
                  <div className="hint">{`${lab.userName || lab.username} (${lab.username})`}</div>
                </div>
                <span className="status-chip is-warn">변경 대기</span>
              </div>
              <div className="simple-status-list">
                <div>{`현재 Flavor: ${lab.currentFlavor || "-"}`}</div>
                <div>{`요청 Flavor: ${lab.requestedResizeFlavor || "-"}`}</div>
                <div>{`정책: ${describeCourseLabResizePolicy(course, props.platformStatus)}`}</div>
              </div>
              <AdminField label="승인 Flavor">
                <select
                  value={selectedFlavor}
                  onChange={(event) => props.setLabResizeFlavorDrafts((current) => ({ ...current, [lab.id]: event.target.value }))}
                >
                  {allowedFlavors.map((flavor) => <option key={flavor} value={flavor}>{flavor}</option>)}
                </select>
              </AdminField>
              <textarea
                value={props.labResizeReviewNotes?.[lab.id] || ""}
                onChange={(event) => props.setLabResizeReviewNotes((current) => ({ ...current, [lab.id]: event.target.value }))}
                placeholder="승인 또는 반려 메모"
              />
              <div className="admin-inline-actions">
                <button className="mini-btn primary-mini-btn" disabled={!selectedFlavor} onClick={() => props.onApproveLabResize(lab.id, selectedFlavor)} type="button">승인</button>
                <button className="mini-btn reject-btn" onClick={() => props.onRejectLabResize(lab.id)} type="button">반려</button>
              </div>
            </article>
          );
        }) : <section className="admin-simple-card"><div className="hint">사양 변경 대기 항목이 없습니다.</div></section>}
      </section>
    </section>
  );
}

function buildPocResourceGraph(request) {
  const advanced = request?.advancedConfig && typeof request.advancedConfig === "object" ? request.advancedConfig : {};
  const advancedEnabled = Boolean(advanced.enabled);
  const status = String(request?.status || "").trim().toLowerCase();
  const isFailed = status === "failed";
  const isRunning = status === "running";
  const isProvisioning = status === "provisioning";
  const instanceIps = Array.isArray(request?.instanceIps) ? request.instanceIps : [];
  const floatingIps = instanceIps.filter((item) => String(item?.type || "").toLowerCase().includes("floating")).map((item) => item.address).filter(Boolean);
  const fixedIps = instanceIps.filter((item) => String(item?.type || "").toLowerCase().includes("fixed")).map((item) => item.address).filter(Boolean);
  const createdResources = advanced.createdResources && typeof advanced.createdResources === "object" ? advanced.createdResources : {};
  const nodes = [
    { id: "compute", label: "Compute", detail: fixedIps[0] || `${request.instanceCount || 1}대`, x: 50, y: 76, type: "core", status },
  ];
  const warnings = [];
  const edges = [];
  const addNode = (node, target = "compute") => {
    nodes.push(node);
    edges.push({ from: target, to: node.id });
  };

  if (advancedEnabled && advanced.network?.enabled) {
    addNode({ id: "network", label: "Network", detail: createdResources.network?.networkId ? "created" : advanced.network.networkName || "전용망", x: 170, y: 42, type: "network", status });
    if (advanced.network.attachRouter) {
      addNode({ id: "router", label: "Router", detail: createdResources.network?.routerId ? "created" : advanced.network.externalNetworkName || "외부망", x: 292, y: 42, type: "network", status }, "network");
    }
  }
  if (advancedEnabled && advanced.publicIp?.enabled) {
    addNode({ id: "publicIp", label: "Public IP", detail: floatingIps[0] || advanced.publicIp.externalNetworkName || "외부망", x: 170, y: 112, type: "network", status });
  }
  if (advancedEnabled && advanced.volumes?.enabled) {
    const createdVolumeCount = Array.isArray(createdResources.volumes) ? createdResources.volumes.length : 0;
    addNode({ id: "block", label: "Block", detail: createdVolumeCount ? `${createdVolumeCount}개 생성` : `${advanced.volumes.count || 1}개 / ${advanced.volumes.sizeGb || 0}GB`, x: 170, y: 182, type: "storage", status });
  }
  if (advancedEnabled && advanced.loadBalancer?.enabled) {
    addNode({ id: "lb", label: "Load Balancer", detail: createdResources.loadBalancer?.loadBalancerId ? "created" : `${advanced.loadBalancer.listenerPort || 0}->${advanced.loadBalancer.targetPort || 0}`, x: 292, y: 112, type: "network", status }, advanced.network?.enabled ? "network" : "compute");
    if (!advanced.network?.enabled) warnings.push("로드밸런서는 전용 네트워크가 필요합니다.");
  }
  if (advancedEnabled && advanced.database?.enabled) {
    addNode({ id: "db", label: "Database", detail: createdResources.database?.instanceId ? "created" : `${advanced.database.engine || "DB"} ${advanced.database.sizeGb || 0}GB`, x: 292, y: 182, type: "data", status });
    warnings.push("DB는 Trove 지원 여부에 따라 생성 가능 여부가 달라집니다.");
  }

  return { nodes, edges, warnings, stateLabel: isFailed ? "실패" : isRunning ? "실행 중" : isProvisioning ? "생성 중" : "요청됨" };
}

function AdminPocResourceGraph({ request }) {
  const graph = buildPocResourceGraph(request);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  return (
    <figure className="poc-resource-graph" aria-label="요청 자원 그래프">
      <figcaption>
        <span>요청/실제 자원 구성도</span>
        <b>{graph.stateLabel}</b>
      </figcaption>
      <svg role="img" viewBox="0 0 380 250">
        {graph.edges.map((edge) => {
          const from = nodeById.get(edge.from);
          const to = nodeById.get(edge.to);
          if (!from || !to) return null;
          return <line className="poc-resource-edge" key={`${edge.from}-${edge.to}`} x1={from.x + 42} y1={from.y + 22} x2={to.x + 42} y2={to.y + 22} />;
        })}
        {graph.nodes.map((node) => (
          <g className={`poc-resource-node is-${node.type} is-${node.status || "requested"}`} key={node.id}>
            <rect height="44" rx="8" width="84" x={node.x} y={node.y} />
            <text className="poc-resource-label" x={node.x + 42} y={node.y + 18}>{node.label}</text>
            <text className="poc-resource-detail" x={node.x + 42} y={node.y + 34}>{node.detail}</text>
          </g>
        ))}
      </svg>
      {graph.warnings.length ? (
        <div className="poc-resource-warnings">
          {graph.warnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      ) : null}
    </figure>
  );
}

export function AdminCustomLabRequestsTab(props) {
  const requests = Array.isArray(props.adminCustomLabRequests) ? props.adminCustomLabRequests : [];
  const resultGroups = useMemo(() => {
    const grouped = new Map();
    for (const request of requests) {
      const group = getPocResultGroup(request);
      const current = grouped.get(group.key) || { key: group.key, label: group.label, requests: [] };
      current.requests.push(request);
      grouped.set(group.key, current);
    }
    return Array.from(grouped.values()).sort((a, b) => String(a.label).localeCompare(String(b.label), "ko"));
  }, [requests]);
  const [selectedResultKey, setSelectedResultKey] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const activeResultKey = selectedResultKey || resultGroups[0]?.key || "";
  const activeGroup = resultGroups.find((group) => group.key === activeResultKey) || resultGroups[0] || null;
  const activeRequests = activeGroup?.requests || [];
  const activeRequest = activeRequests.find((request) => Number(request.id) === Number(selectedRequestId))
    || activeRequests[0]
    || null;
  const activeNodes = activeRequest ? deriveVmNodes(activeRequest) : [];

  function openPocNodeTerminal(request, node = null) {
    if (!request?.id) return;
    const host = getPocNodeHost(node, request);
    props.onCreateCustomLabTerminalSession?.(request.id, {
      nodeId: node?.id || "",
      targetHost: host,
      stayOnCurrentSection: true,
      replayMetadata: {
        purpose: "admin_poc_review",
        customLabRequestId: String(request.id),
        pocTitle: String(request.title || ""),
        username: String(request.username || ""),
        nodeId: String(node?.id || ""),
      },
    });
  }

  function openActivePocTerminal(overrides = {}) {
    if (!activeRequest?.id) return;
    const nodeId = String(overrides?.nodeId || "").trim();
    const targetHost = String(overrides?.targetHost || "").trim();
    const node = nodeId
      ? activeNodes.find((item) => String(item.id || "") === nodeId) || null
      : targetHost
        ? { id: "", fixedIp: targetHost, name: targetHost }
        : activeNodes[0] || null;
    openPocNodeTerminal(activeRequest, node);
  }

  function blockUnsupportedPocAction(message) {
    props.setAdminStatus?.(message);
  }

  return (
    <section className="portal-stack">
      <section className="admin-simple-card">
        <div className="admin-card-header">
          <strong>고급 랩 결과 확인</strong>
          <span className="hint">{`결과 카드 ${resultGroups.length}개 / 요청 ${requests.length}건`}</span>
        </div>
        <div className="admin-request-stack">
          {resultGroups.length ? resultGroups.map((group) => {
            const runningCount = group.requests.filter((request) => String(request.status || "").toLowerCase() === "running").length;
            return (
              <button
                className={group.key === activeResultKey ? "admin-request-card is-selected" : "admin-request-card"}
                key={group.key}
                onClick={() => {
                  setSelectedResultKey(group.key);
                  setSelectedRequestId(group.requests[0]?.id || null);
                }}
                type="button"
              >
                <div className="admin-request-card-head">
                  <div>
                    <strong>{`${group.label} 결과`}</strong>
                    <div className="hint">{`수강생 ${group.requests.length}명 / 실행 중 ${runningCount}건`}</div>
                  </div>
                  <span className="status-chip">{runningCount ? "검토 가능" : "대기"}</span>
                </div>
              </button>
            );
          }) : <div className="hint">고급 랩 결과 카드로 표시할 요청이 없습니다.</div>}
        </div>
        {activeGroup ? (
          <div className="admin-table admin-table-scroll">
            <div className="admin-table-head admin-course-grid">
              <span>수강생</span>
              <span>상태 / VM</span>
              <span>접근</span>
            </div>
            {activeRequests.map((request) => {
              const nodes = deriveVmNodes(request);
              const isSelected = Number(activeRequest?.id) === Number(request.id);
              return (
                <div className={`admin-table-row admin-course-grid ${isSelected ? "is-editing" : ""}`} key={`poc-result-${request.id}`}>
                  <span>
                    <button className="mini-btn" onClick={() => setSelectedRequestId(request.id)} type="button">
                      {request.userName || request.username || `사용자 #${request.userId || "-"}`}
                    </button>
                    <small>{request.username || "-"}</small>
                    <small>{request.title || `고급 랩 #${request.id}`}</small>
                  </span>
                  <span>
                    <strong>{getCustomLabStatusLabel(request.status)}</strong>
                    <small>{`VM ${nodes.length || Number(request.instanceCount || 0) || 1}대`}</small>
                    <small>{`대표 IP: ${request.instanceIp || "-"}`}</small>
                  </span>
                  <span>
                    <div className="admin-inline-actions">
                      {String(request.status || "").toLowerCase() === "running" ? (
                        <button className="mini-btn primary-mini-btn" onClick={() => openPocNodeTerminal(request, nodes[0] || null)} type="button">대표 터미널</button>
                      ) : null}
                      <button className="mini-btn" onClick={() => setSelectedRequestId(request.id)} type="button">{isSelected ? "선택됨" : "VM 보기"}</button>
                    </div>
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
        {activeRequest ? (
          <div className="admin-simple-card inline-admin-editor">
            <div className="admin-card-header">
              <strong>{`${activeRequest.userName || activeRequest.username || "사용자"} / VM 접근`}</strong>
              <span className="hint">{activeRequest.stackName || activeRequest.title || `고급 랩 #${activeRequest.id}`}</span>
            </div>
            <div className="simple-status-list compact-status-list">
              <div>{`SSH 계정: ${activeRequest.terminalSshUser || "-"}`}</div>
              <div>{`대표 IP: ${activeRequest.instanceIp || "-"}`}</div>
              <div>{`공개 URL: ${(activeRequest.publicDomains || []).map((entry) => entry.url || entry.hostname || entry.subdomain).filter(Boolean).join(", ") || "-"}`}</div>
            </div>
            <div className="admin-table admin-table-scroll">
              <div className="admin-table-head admin-course-grid">
                <span>가상머신</span>
                <span>IP</span>
                <span>터미널</span>
              </div>
              {(activeNodes.length ? activeNodes : [{ id: "primary", name: "Primary VM", fixedIp: activeRequest.instanceIp }]).map((node, index) => {
                const host = getPocNodeHost(node, activeRequest);
                return (
                  <div className="admin-table-row admin-course-grid" key={`${activeRequest.id}-${node.id || index}`}>
                    <span>
                      <strong>{getPocNodeLabel(node, index)}</strong>
                      <small>{node.id || "-"}</small>
                    </span>
                    <span>
                      <small>{`Fixed: ${node.fixedIp || node.fixed_ip || "-"}`}</small>
                      <small>{`Floating: ${node.floatingIp || node.floating_ip || "-"}`}</small>
                    </span>
                    <span>
                      <button
                        className="mini-btn primary-mini-btn"
                        disabled={String(activeRequest.status || "").toLowerCase() !== "running" || !host}
                        onClick={() => openPocNodeTerminal(activeRequest, node)}
                        type="button"
                      >
                        터미널 접속
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
            {activeRequest.status === "running" && props.publicRouteForm && props.setPublicRouteForm ? (
              <div className="poc-terminal-panel">
                <DomainView
                  {...props}
                  activeLab={buildAdminPocTerminalLab(activeRequest)}
                  labExams={[]}
                />
              </div>
            ) : null}
            {props.terminalSession?.resourceType === "custom-lab" && Number(props.terminalSession?.customLabRequestId) === Number(activeRequest.id) ? (
              <div className="poc-terminal-panel">
                <TerminalView
                  {...props}
                  activeLab={buildAdminPocTerminalLab(activeRequest)}
                  autoOpenTerminal={false}
                  courses={[]}
                  embeddedMode
                  labExams={[]}
                  labs={[]}
                  onCreateTerminalSession={openActivePocTerminal}
                  onOpenTerminalPopup={() => blockUnsupportedPocAction("고급 랩 터미널은 현재 관리자 화면 안에서 연결해 주세요.")}
                  onUploadLabFile={() => blockUnsupportedPocAction("고급 랩 파일 업로드는 아직 지원하지 않습니다.")}
                  platformStatus={{
                    ...(props.platformStatus || {}),
                    externalSshRoutesEnabled: false,
                    externalRdpRoutesEnabled: false,
                  }}
                  selectedCourse={null}
                  selectedCourseLab={null}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
      <section className="admin-simple-card">
      <div className="admin-card-header">
        <strong>고급 랩 주문 / 프로비저닝</strong>
      </div>
      <div className="settings-panel admin-section-note">
        <div className="card-label">선결제 자동 구성</div>
        <div className="simple-status-list">
          <div>사용자가 허용된 이미지와 Flavor, 개수, 사용일수를 선택하면 자동 견적이 생성됩니다.</div>
          <div>선결제가 완료되면 Heat 기반 프로비저닝이 자동으로 시작됩니다. 이 화면에서는 운영 확인, 예외 반려, 자원 삭제를 처리합니다.</div>
        </div>
      </div>
      <div className="admin-table admin-table-scroll admin-custom-lab-scroll">
        <div className="admin-table-head admin-course-grid">
          <span>주문 정보</span>
          <span>상태 / 결제</span>
          <span>운영 작업</span>
        </div>
        {requests.map((request) => {
          const draft = props.customLabReviewDrafts[request.id] || {};
          const status = String(request.status || "").toLowerCase();
          return (
            <div className="admin-table-row admin-course-grid" key={request.id}>
              <span>
                <strong>{request.title}</strong>
                <div className="hint">{request.userName} ({request.username})</div>
                <div className="hint">{`${request.instanceCount}대 / ${request.vcpu} vCPU / ${request.ramGb}GB RAM / ${request.diskGb}GB Disk`}</div>
                <div className="hint">{`이미지: ${request.imageName}${request.usagePeriod ? ` / 사용 기간: ${request.usagePeriod}` : ""}`}</div>
                {request.instanceIp ? <div className="hint">{`IP: ${request.instanceIp}`}</div> : null}
                {request.stackName ? <div className="hint">{`Stack: ${request.stackName}`}</div> : null}
                {request.heatTemplateName ? <div className="hint">{`Heat 템플릿: ${request.heatTemplateName}`}</div> : null}
                {request.applicationYamlName ? <div className="hint">{`Application YAML: ${request.applicationYamlName}`}</div> : null}
                {getCustomLabAdvancedConfigLines(request.advancedConfig).map((line) => <div className="hint" key={`${request.id}-${line}`}>{line}</div>)}
                {request.note ? <div className="hint">{`메모: ${request.note}`}</div> : null}
                <AdminPocResourceGraph request={request} />
              </span>
              <span>
                <div>{getCustomLabStatusLabel(request.status)}</div>
                <div className="hint">{`견적: ${formatPocQuote(request.quotedPrice)}`}</div>
                {request.paymentStatus ? <div className="hint">{`결제: ${request.paymentStatus}`}</div> : null}
                {request.stackId ? <div className="hint">{`Stack ID: ${request.stackId}`}</div> : null}
                {Array.isArray(request.instanceIps) && request.instanceIps.length ? <div className="hint">{`생성 IP: ${request.instanceIps.map((item) => item.address || item).filter(Boolean).join(", ")}`}</div> : null}
                {request.advancedConfig?.generatedHeatTemplate ? <div className="hint">요청값 기반 Heat 자동 생성</div> : null}
                {request.errorMessage ? <div className="hint">{`오류: ${request.errorMessage}`}</div> : null}
                {request.reviewNote ? <div className="hint">{`처리 메모: ${request.reviewNote}`}</div> : null}
              </span>
              <div className="admin-inline-actions admin-review-stack">
                <textarea
                  placeholder="운영 메모 또는 반려 사유"
                  value={draft.reviewNote || ""}
                  onChange={(event) => props.setCustomLabReviewDrafts((current) => ({ ...current, [request.id]: { ...current[request.id], reviewNote: event.target.value } }))}
                />
                <select
                  value={draft.heatTemplateName || request.heatTemplateName || ""}
                  onChange={(event) => props.setCustomLabReviewDrafts((current) => ({ ...current, [request.id]: { ...current[request.id], heatTemplateName: event.target.value } }))}
                >
                  <option value="">Heat 템플릿 선택</option>
                  {(props.adminHeatTemplates || []).map((template) => <option key={template.name} value={template.name}>{template.name}</option>)}
                </select>
                <select
                  value={draft.applicationYamlName || request.applicationYamlName || ""}
                  onChange={(event) => props.setCustomLabReviewDrafts((current) => ({ ...current, [request.id]: { ...current[request.id], applicationYamlName: event.target.value } }))}
                >
                  <option value="">Application YAML 선택</option>
                  {(props.adminApplicationYamls || []).filter((item) => !item.validationError).map((item) => (
                    <option key={item.name} value={item.name}>{`${item.name} (${item.category === "exception" ? "예외" : "기본"})`}</option>
                  ))}
                </select>
                <select
                  value={draft.cloudInitTemplateName || request.cloudInitTemplateName || ""}
                  onChange={(event) => props.setCustomLabReviewDrafts((current) => ({ ...current, [request.id]: { ...current[request.id], cloudInitTemplateName: event.target.value } }))}
                >
                  <option value="">cloud-init 템플릿 선택</option>
                  {(props.adminCloudInitTemplates || []).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                </select>
                <div className="admin-inline-actions">
                  {["quoted", "failed"].includes(status) ? <button className="mini-btn primary-mini-btn" onClick={() => props.onReviewCustomLabRequest(request.id, "approved")} type="button">프로비저닝 재시도</button> : null}
                  {["requested", "quoted", "confirmed", "failed"].includes(status) ? <button className="mini-btn danger-mini-btn" onClick={() => props.onReviewCustomLabRequest(request.id, "rejected")} type="button">반려</button> : null}
                  {status === "running" ? <button className="mini-btn danger-mini-btn" onClick={() => props.onTerminateAdminCustomLabRequest(request.id)} type="button">자원 삭제</button> : null}
                  {props.onDeleteAdminCustomLabQuote && canDeleteUnsubmittedPocQuote(request) ? (
                    <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteAdminCustomLabQuote(request.id)} type="button">미제출 견적 삭제</button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
    </section>
  );
}

export function AdminInvitesTab(props) {
  return (
    <section className="portal-stack">
      <form className="admin-simple-card admin-form" onSubmit={props.onCreateInvite}>
        <div className="admin-card-header">
          <strong>초대 코드 등록</strong>
          <div className="admin-inline-actions">
            <button className="mini-btn" onClick={props.onGenerateInviteCode} type="button">코드 생성</button>
          </div>
        </div>
        <div className="admin-form-grid compact-admin-grid">
          <AdminField label="코드" required>
            <input value={props.inviteForm.code} onChange={(event) => props.setInviteForm((current) => ({ ...current, code: event.target.value }))} placeholder="예: LAB-INVITE-001" />
          </AdminField>
          <AdminField label="설명">
            <input value={props.inviteForm.label} onChange={(event) => props.setInviteForm((current) => ({ ...current, label: event.target.value }))} placeholder="예: 4월 교육 초대" />
          </AdminField>
          <AdminField label="발송 이메일">
            <input value={props.inviteForm.recipientEmail || ""} onChange={(event) => props.setInviteForm((current) => ({ ...current, recipientEmail: event.target.value }))} placeholder="선택 입력" />
          </AdminField>
          <AdminField label="연결 과정">
            <select value={props.inviteForm.courseId} onChange={(event) => props.setInviteForm((current) => ({ ...current, courseId: event.target.value }))}>
              <option value="">없음</option>
              {(props.adminCourses || []).map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
            </select>
          </AdminField>
          <AdminField label="최대 사용 횟수">
            <input min="1" type="number" value={props.inviteForm.maxUses} onChange={(event) => props.setInviteForm((current) => ({ ...current, maxUses: event.target.value }))} />
          </AdminField>
          <AdminField label="만료일">
            <input type="date" value={props.inviteForm.expiresAt || ""} onChange={(event) => props.setInviteForm((current) => ({ ...current, expiresAt: event.target.value }))} />
          </AdminField>
        </div>
        <div className="portal-actions">
          <button className="primary-btn" type="submit">초대 코드 저장</button>
        </div>
      </form>
      <section className="admin-simple-card">
        <div className="admin-card-header">
          <strong>초대 코드 목록</strong>
        </div>
        <div className="admin-table admin-table-scroll">
          {(props.adminInvites || []).map((invite) => (
            <div className="admin-table-row admin-course-grid" key={invite.id}>
              <span>
                <strong>{invite.code}</strong>
                <div className="hint">{invite.label || "-"}</div>
              </span>
              <span>
                <div>{invite.active ? "사용 중" : "중지"}</div>
                <div className="hint">{`사용 ${invite.usedCount || 0}/${invite.maxUses || 1}`}</div>
              </span>
              <div className="admin-inline-actions">
                <button className="mini-btn" onClick={() => props.onToggleInvite(invite.id)} type="button">{invite.active ? "중지" : "사용"}</button>
                <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteInvite(invite.id)} type="button">삭제</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
