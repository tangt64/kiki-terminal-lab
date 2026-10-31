import { useEffect, useMemo, useRef, useState } from "react";
import { parse } from "yaml";
import { AdminField, formatDateTime } from "./portal-views.jsx";

const HEAT_WORKLOAD_TEST_STORAGE_KEY = "terminal-lab:heat-workload-test:last-job-id";

const HEAT_RESOURCE_STYLES = {
  compute: { label: "Compute", fill: "#eff6ff", stroke: "#2563eb", text: "#1e3a8a" },
  network: { label: "Network", fill: "#ecfdf5", stroke: "#16a34a", text: "#14532d" },
  storage: { label: "Storage", fill: "#fefce8", stroke: "#ca8a04", text: "#713f12" },
  group: { label: "Group", fill: "#f5f3ff", stroke: "#7c3aed", text: "#4c1d95" },
  config: { label: "Config", fill: "#f8fafc", stroke: "#64748b", text: "#334155" },
  other: { label: "Other", fill: "#f8fafc", stroke: "#94a3b8", text: "#334155" },
};

function toPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getHeatResourceKind(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("resourcegroup")) return "group";
  if (normalized.includes("nova::server") || normalized.includes("magnum") || normalized.includes("zun")) return "compute";
  if (normalized.includes("neutron") || normalized.includes("network") || normalized.includes("port") || normalized.includes("router")) return "network";
  if (normalized.includes("cinder") || normalized.includes("volume")) return "storage";
  if (normalized.includes("softwareconfig") || normalized.includes("waitcondition") || normalized.includes("cloudconfig")) return "config";
  return "other";
}

function getShortResourceType(type) {
  const raw = String(type || "unknown").trim();
  const parts = raw.split("::").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join("::") : raw;
}

function getParameterDefault(parametersMap, name) {
  const parameter = toPlainObject(parametersMap[name]);
  return parameter.default;
}

function getParameterRange(parametersMap, name) {
  const parameter = toPlainObject(parametersMap[name]);
  const constraints = Array.isArray(parameter.constraints) ? parameter.constraints : [];
  const range = constraints.map((item) => toPlainObject(item).range).find(Boolean);
  return range ? toPlainObject(range) : {};
}

function resolveHeatCountLabel(count, parametersMap) {
  if (count == null || count === "") return "";
  if (typeof count === "number" || typeof count === "string") return `x ${count}`;
  if (count && typeof count === "object" && typeof count.get_param === "string") {
    const paramName = count.get_param;
    const fallback = getParameterDefault(parametersMap, paramName);
    const range = getParameterRange(parametersMap, paramName);
    if (range.min != null || range.max != null) {
      const min = range.min ?? fallback ?? "?";
      const max = range.max ?? fallback ?? "?";
      return `x ${min}-${max}`;
    }
    return fallback != null && fallback !== "" ? `x ${fallback}` : `x ${paramName}`;
  }
  return "x N";
}

function collectHeatReferences(value, knownNames, refs = new Set()) {
  if (!value || typeof value !== "object") return refs;
  if (Array.isArray(value)) {
    value.forEach((item) => collectHeatReferences(item, knownNames, refs));
    return refs;
  }
  if (typeof value.get_resource === "string" && knownNames.has(value.get_resource)) {
    refs.add(value.get_resource);
  }
  if (Array.isArray(value.get_attr) && typeof value.get_attr[0] === "string" && knownNames.has(value.get_attr[0])) {
    refs.add(value.get_attr[0]);
  }
  Object.values(value).forEach((item) => collectHeatReferences(item, knownNames, refs));
  return refs;
}

function collectDependsOn(value, knownNames) {
  const refs = new Set();
  if (typeof value === "string" && knownNames.has(value)) refs.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (typeof item === "string" && knownNames.has(item)) refs.add(item);
    });
  }
  return refs;
}

function parseHeatTemplateTopology(content) {
  const raw = String(content || "").trim();
  if (!raw) {
    return {
      valid: false,
      empty: true,
      message: "템플릿 내용을 입력하면 구조 미리보기가 표시됩니다.",
      resources: [],
      edges: [],
      parameters: [],
      outputs: [],
      counts: {},
    };
  }

  try {
    const parsed = parse(raw) || {};
    const resourcesMap = toPlainObject(parsed.resources);
    const parametersMap = toPlainObject(parsed.parameters);
    const parameters = Object.keys(parametersMap);
    const outputs = Object.keys(toPlainObject(parsed.outputs));
    const knownNames = new Set(Object.keys(resourcesMap));
    const resources = Object.entries(resourcesMap).map(([name, definition]) => {
      const resource = toPlainObject(definition);
      const properties = toPlainObject(resource.properties);
      const resourceDef = toPlainObject(properties.resource_def);
      const nestedType = resourceDef.type ? String(resourceDef.type) : "";
      const type = String(resource.type || "unknown");
      const kind = getHeatResourceKind(type);
      const nestedKind = nestedType ? getHeatResourceKind(nestedType) : "";
      const dependencies = new Set([
        ...collectDependsOn(resource.depends_on, knownNames),
        ...collectHeatReferences(properties, knownNames),
      ]);
      return {
        name,
        type,
        shortType: getShortResourceType(type),
        nestedType,
        nestedShortType: nestedType ? getShortResourceType(nestedType) : "",
        kind,
        nestedKind,
        dependencies: Array.from(dependencies),
        count: properties.count,
        countLabel: resolveHeatCountLabel(properties.count, parametersMap),
      };
    });
    const edges = resources.flatMap((resource) =>
      resource.dependencies.map((source) => ({ source, target: resource.name }))
    );
    const counts = resources.reduce((memo, resource) => {
      memo[resource.kind] = (memo[resource.kind] || 0) + 1;
      if (resource.kind === "group" && resource.nestedKind) {
        memo[`${resource.nestedKind}Group`] = (memo[`${resource.nestedKind}Group`] || 0) + 1;
      }
      return memo;
    }, {});
    return {
      valid: true,
      empty: false,
      resources,
      edges,
      parameters,
      parametersMap,
      outputs,
      counts,
      description: String(parsed.description || "").trim(),
      version: String(parsed.heat_template_version || "").trim(),
      message: resources.length ? "" : "resources 블록이 없어 토폴로지를 그릴 리소스가 없습니다.",
    };
  } catch (error) {
    return {
      valid: false,
      empty: false,
      message: error?.message || "YAML을 파싱하지 못했습니다.",
      resources: [],
      edges: [],
      parameters: [],
      outputs: [],
      counts: {},
    };
  }
}

function getHeatTopologyMetrics(content) {
  const topology = parseHeatTemplateTopology(content);
  const computeGroupCount = topology.counts.computeGroup || 0;
  const networkGroupCount = topology.counts.networkGroup || 0;
  return {
    topology,
    resourceCount: topology.resources.length,
    parameterCount: topology.parameters.length,
    outputCount: topology.outputs.length,
    computeCount: topology.counts.compute || 0,
    computeGroupCount,
    networkCount: topology.counts.network || 0,
    networkGroupCount,
    groupCount: topology.counts.group || 0,
    hasCompute: Boolean((topology.counts.compute || 0) + computeGroupCount),
    hasNetwork: Boolean((topology.counts.network || 0) + networkGroupCount),
    hasGroup: Boolean(topology.counts.group || 0),
  };
}

function formatHeatUnitSummary(label, directCount, groupCount) {
  if (groupCount && directCount) return `${label} ${directCount} + 그룹 ${groupCount}`;
  if (groupCount) return `${label} 그룹 ${groupCount}`;
  return `${label} ${directCount}`;
}

function HeatTemplateSummary({ content }) {
  const metrics = useMemo(() => getHeatTopologyMetrics(content), [content]);
  if (!metrics.topology.valid) {
    return <div className="status-chip is-warn">시각화 불가</div>;
  }
  return (
    <div className="heat-template-summary">
      <span className="status-chip">{`리소스 ${metrics.resourceCount}`}</span>
      <span className="status-chip is-success">{formatHeatUnitSummary("VM", metrics.computeCount, metrics.computeGroupCount)}</span>
      <span className="status-chip">{formatHeatUnitSummary("네트워크", metrics.networkCount, metrics.networkGroupCount)}</span>
      {metrics.groupCount ? <span className="status-chip is-warn">{`그룹 ${metrics.groupCount}`}</span> : null}
      <span className="status-chip">{`출력 ${metrics.outputCount}`}</span>
    </div>
  );
}

function truncateTopologyText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function getHeatTopologyLayout(resources, expanded = false) {
  const nodeWidth = expanded ? 248 : 196;
  const nodeHeight = expanded ? 70 : 66;
  const left = 26;
  const top = 24;
  const gapX = expanded ? 92 : 76;
  const gapY = expanded ? 22 : 18;
  const resourceByName = new Map(resources.map((resource) => [resource.name, resource]));
  const depthByName = new Map();

  function resolveDepth(name, visiting = new Set()) {
    if (depthByName.has(name)) return depthByName.get(name);
    if (visiting.has(name)) return 0;
    const resource = resourceByName.get(name);
    if (!resource) return 0;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(name);
    const dependencyDepths = resource.dependencies
      .filter((dependency) => resourceByName.has(dependency))
      .map((dependency) => resolveDepth(dependency, nextVisiting));
    const depth = dependencyDepths.length ? Math.max(...dependencyDepths) + 1 : 0;
    depthByName.set(name, depth);
    return depth;
  }

  const layers = new Map();
  resources.forEach((resource) => {
    const depth = resolveDepth(resource.name);
    const layer = layers.get(depth) || [];
    layer.push(resource);
    layers.set(depth, layer);
  });

  const positions = new Map();
  const orderedLayers = [...layers.entries()].sort(([leftDepth], [rightDepth]) => leftDepth - rightDepth);
  orderedLayers.forEach(([depth, layer]) => {
    layer
      .sort((leftResource, rightResource) => leftResource.name.localeCompare(rightResource.name))
      .forEach((resource, index) => {
        positions.set(resource.name, {
          x: left + depth * (nodeWidth + gapX),
          y: top + index * (nodeHeight + gapY),
        });
      });
  });

  const maxDepth = orderedLayers.length ? orderedLayers.at(-1)[0] : 0;
  const maxLayerSize = Math.max(1, ...orderedLayers.map(([, layer]) => layer.length));
  return {
    nodeWidth,
    nodeHeight,
    positions,
    width: Math.max(expanded ? 980 : 760, left * 2 + (maxDepth + 1) * nodeWidth + maxDepth * gapX),
    height: Math.max(250, top * 2 + maxLayerSize * nodeHeight + Math.max(0, maxLayerSize - 1) * gapY),
  };
}

function HeatTopologyPanel({ content, name = "" }) {
  const topology = useMemo(() => parseHeatTemplateTopology(content), [content]);
  const [showAllResources, setShowAllResources] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const previewResourceLimit = 18;
  const visibleResources = showAllResources ? topology.resources : topology.resources.slice(0, previewResourceLimit);
  const topologyLayout = useMemo(() => getHeatTopologyLayout(visibleResources, isExpanded), [visibleResources, isExpanded]);
  const visibleNames = new Set(visibleResources.map((resource) => resource.name));
  const visibleEdges = topology.edges.filter((edge) => visibleNames.has(edge.source) && visibleNames.has(edge.target));
  const hasHiddenResources = topology.resources.length > previewResourceLimit;

  return (
    <section className={`heat-topology-panel${isExpanded ? " is-expanded" : ""}`} aria-label="Heat 템플릿 시각화 미리보기">
      <div className="admin-card-header">
        <div>
          <strong>토폴로지 미리보기</strong>
          <p className="hint">{name || "작성 중인 Heat 템플릿"}</p>
        </div>
        <div className="heat-topology-actions">
          <button aria-pressed={isExpanded} className="mini-btn" onClick={() => setIsExpanded((current) => !current)} type="button">
            {isExpanded ? "기본 보기" : "넓게 보기"}
          </button>
          {hasHiddenResources ? (
            <button className="mini-btn" onClick={() => setShowAllResources((current) => !current)} type="button">
              {showAllResources ? `간단히 보기 (${previewResourceLimit}개)` : `전체 ${topology.resources.length}개 보기`}
            </button>
          ) : null}
        </div>
      </div>

      {!topology.valid ? (
        <div className={`status ${topology.empty ? "is-info" : "is-error"}`}>{topology.message}</div>
      ) : (
        <>
          <div className="heat-topology-stats">
            <span><strong>{topology.resources.length}</strong> 리소스</span>
            <span><strong>{topology.parameters.length}</strong> 파라미터</span>
            <span><strong>{topology.outputs.length}</strong> 출력</span>
            <span><strong>{topology.edges.length}</strong> 연결</span>
          </div>
          {topology.message ? <div className="status is-info">{topology.message}</div> : null}
          <div className="heat-topology-legend">
            {Object.entries(HEAT_RESOURCE_STYLES).filter(([key]) => topology.counts[key]).map(([key, style]) => (
              <span key={key}><i style={{ background: style.fill, borderColor: style.stroke }} />{`${style.label} ${topology.counts[key]}`}</span>
            ))}
            {topology.counts.computeGroup ? <span><i style={{ background: HEAT_RESOURCE_STYLES.compute.fill, borderColor: HEAT_RESOURCE_STYLES.compute.stroke }} />{`VM 그룹 ${topology.counts.computeGroup}`}</span> : null}
            {topology.counts.networkGroup ? <span><i style={{ background: HEAT_RESOURCE_STYLES.network.fill, borderColor: HEAT_RESOURCE_STYLES.network.stroke }} />{`Port 그룹 ${topology.counts.networkGroup}`}</span> : null}
          </div>
          <div className="heat-topology-canvas" role="img" aria-label={`${topology.resources.length}개 Heat 리소스 구조도`}>
            <div className="heat-topology-view-note" style={{ minWidth: `${topologyLayout.width}px` }}>
              <span>{`의존성 단계별 배열 · ${visibleResources.length}/${topology.resources.length}개 표시`}</span>
              <span>가로·세로로 스크롤해 전체 구조를 확인하세요.</span>
            </div>
            <svg
              preserveAspectRatio="xMinYMin meet"
              style={{ minWidth: `${topologyLayout.width}px`, width: `${topologyLayout.width}px` }}
              viewBox={`0 0 ${topologyLayout.width} ${topologyLayout.height}`}
            >
              <defs>
                <marker id="heat-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
                  <path d="M0,0 L8,4 L0,8 Z" fill="#94a3b8" />
                </marker>
              </defs>
              {visibleEdges.map((edge, index) => {
                const source = topologyLayout.positions.get(edge.source);
                const target = topologyLayout.positions.get(edge.target);
                if (!source || !target) return null;
                const sourceX = source.x + topologyLayout.nodeWidth;
                const sourceY = source.y + topologyLayout.nodeHeight / 2;
                const targetX = target.x;
                const targetY = target.y + topologyLayout.nodeHeight / 2;
                const midX = sourceX + Math.max(28, (targetX - sourceX) / 2);
                return (
                  <path
                    d={`M ${sourceX} ${sourceY} C ${midX} ${sourceY}, ${midX} ${targetY}, ${targetX - 8} ${targetY}`}
                    fill="none"
                    key={`${edge.source}-${edge.target}-${index}`}
                    markerEnd="url(#heat-arrow)"
                    stroke="#94a3b8"
                    strokeWidth="2"
                  />
                );
              })}
              {visibleResources.map((resource) => {
                const position = topologyLayout.positions.get(resource.name);
                const visualKind = resource.kind === "group" && resource.nestedKind ? resource.nestedKind : resource.kind;
                const style = HEAT_RESOURCE_STYLES[visualKind] || HEAT_RESOURCE_STYLES.other;
                const countLabel = resource.countLabel ? ` ${resource.countLabel}` : resource.kind === "group" ? " x N" : "";
                const typeLabel = resource.kind === "group" && resource.nestedShortType ? `${resource.nestedShortType} 그룹` : resource.shortType;
                return (
                  <g key={resource.name} transform={`translate(${position.x}, ${position.y})`}>
                    <title>{`${resource.name} · ${typeLabel}${countLabel}`}</title>
                    <rect fill={style.fill} height={topologyLayout.nodeHeight} rx="8" stroke={style.stroke} strokeWidth="1.5" width={topologyLayout.nodeWidth} />
                    <text fill={style.text} fontSize={isExpanded ? "13" : "12"} fontWeight="800" x="12" y="23">{truncateTopologyText(resource.name, isExpanded ? 32 : 25)}</text>
                    <text fill="#475569" fontSize="11" x="12" y={isExpanded ? "44" : "42"}>{truncateTopologyText(`${typeLabel}${countLabel}`, isExpanded ? 34 : 27)}</text>
                    {resource.nestedShortType ? <text fill="#64748b" fontSize="10" x="12" y={isExpanded ? "60" : "57"}>{truncateTopologyText(`반복: ${resource.nestedShortType}`, isExpanded ? 34 : 27)}</text> : null}
                  </g>
                );
              })}
            </svg>
          </div>
          {hasHiddenResources && !showAllResources ? (
            <p className="hint">{`리소스가 많아 상위 ${visibleResources.length}개만 미리보기에 표시했습니다.`}</p>
          ) : null}
          <div className="heat-topology-details">
            <div>
              <strong>주요 파라미터</strong>
              <p>{topology.parameters.slice(0, 8).join(", ") || "-"}</p>
            </div>
            <div>
              <strong>출력값</strong>
              <p>{topology.outputs.slice(0, 8).join(", ") || "-"}</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

const HEAT_TEMPLATE_FILTERS = [
  { key: "all", label: "전체" },
  { key: "compute", label: "VM 포함" },
  { key: "network", label: "네트워크 포함" },
  { key: "group", label: "반복 그룹" },
  { key: "used", label: "사용 중" },
  { key: "unused", label: "미사용" },
];

function matchesHeatTemplateFilter(template, filter, metrics) {
  if (filter === "used") return Boolean(template.inUseCount);
  if (filter === "unused") return !template.inUseCount;
  if (filter === "compute") return metrics.hasCompute;
  if (filter === "network") return metrics.hasNetwork;
  if (filter === "group") return metrics.hasGroup;
  return true;
}

function HeatTemplateImpact({ template }) {
  if (!template?.inUseCount) {
    return <div className="status is-info">아직 연결된 과정이 없는 템플릿입니다.</div>;
  }
  const titles = Array.isArray(template.usedByTitles) ? template.usedByTitles.filter(Boolean) : [];
  return (
    <div className="status is-warn heat-template-impact">
      <strong>{`저장 영향: 이 템플릿을 ${template.inUseCount}개 과정에서 사용 중입니다.`}</strong>
      {titles.length ? <span>{titles.join(", ")}</span> : null}
    </div>
  );
}

function HeatTemplateSaveNotice({ name, template }) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    return <div className="status is-info heat-template-save-notice">파일명을 입력하면 새 템플릿인지 덮어쓰기인지 알려드립니다.</div>;
  }
  if (!template) {
    return <div className="status is-success heat-template-save-notice"><strong>새 템플릿 저장</strong><span>{`${normalizedName} 파일을 새로 만듭니다.`}</span></div>;
  }
  return (
    <div className="status is-warn heat-template-save-notice" role="status">
      <strong>덮어쓰기 대상</strong>
      <span><code>{normalizedName}</code>{" 파일을 교체합니다. 저장 후 ‘덮어쓰기 완료’ 결과를 표시합니다."}</span>
    </div>
  );
}

function formatCapacityValue(value, unit = "") {
  const number = Math.max(0, Number(value || 0) || 0);
  if (unit === "MB") return number >= 1024 ? `${Math.round(number / 1024)}GB` : `${Math.round(number)}MB`;
  if (unit === "GB") return `${Math.round(number)}GB`;
  return `${Math.round(number)}${unit && unit !== "개" && unit !== "대" ? unit : ""}`;
}

function getHeatWorkloadJobStatus(job) {
  return String(job?.status || job?.result?.status || "").toLowerCase();
}

function getHeatWorkloadJobPhase(job) {
  return String(job?.phase || job?.result?.phase || "").toLowerCase();
}

function isHeatWorkloadJobActive(job) {
  const status = getHeatWorkloadJobStatus(job);
  const phase = getHeatWorkloadJobPhase(job);
  if (["deleted", "completed", "failed", "cancelled", "canceled"].includes(phase)) return false;
  return ["queued", "running"].includes(status);
}

function summarizeHeatWorkloadJob(job) {
  const normalizedJob = job?.result || job || {};
  const status = normalizedJob.status || job?.status || "-";
  const phase = normalizedJob.phase || job?.phase || "";
  const templateName = normalizedJob.templateName || job?.templateName || "";
  const updatedAt = normalizedJob.updatedAt || normalizedJob.completedAt || job?.updatedAt || job?.completedAt || "";
  return [
    normalizedJob.jobId ? `Job ${String(normalizedJob.jobId).slice(0, 8)}` : "",
    status,
    phase,
    templateName,
    updatedAt ? formatDateTime(updatedAt) : "",
  ].filter(Boolean).join(" · ");
}

function formatHostUsagePercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 10) / 10}%` : "-";
}

function HeatTemplateHostUsageReport({ report }) {
  if (!report) return null;
  const hosts = Array.isArray(report.hosts) ? report.hosts : [];
  const warnings = Array.isArray(report.warnings) ? report.warnings.filter(Boolean) : [];
  const summary = report.summary || {};
  return (
    <section className={`heat-host-report ${report.ok ? "is-ok" : "is-muted"}`}>
      <div className="heat-host-report-head">
        <div>
          <span className="heat-capacity-kicker">HOST USAGE REPORT</span>
          <strong>OpenStack 호스트 사용률</strong>
          <p>{report.message || "Prometheus 호스트 리포트를 확인하지 못했습니다."}</p>
        </div>
        <div className="heat-host-report-summary">
          <span>{`호스트 ${summary.hostCount ?? hosts.length ?? 0}개`}</span>
          <strong>{`CPU max ${formatHostUsagePercent(summary.maxCpu)}`}</strong>
          <strong>{`MEM max ${formatHostUsagePercent(summary.maxMemory)}`}</strong>
        </div>
      </div>
      {report.windowStartedAt || report.windowEndedAt ? (
        <div className="hint">
          {[report.windowStartedAt ? `시작 ${formatDateTime(report.windowStartedAt)}` : "", report.windowEndedAt ? `종료 ${formatDateTime(report.windowEndedAt)}` : "", report.stepSeconds ? `${report.stepSeconds}초 간격` : ""].filter(Boolean).join(" / ")}
        </div>
      ) : null}
      {hosts.length ? (
        <div className="admin-table admin-table-scroll">
          <div className="admin-table-head heat-host-report-grid">
            <span>호스트</span>
            <span>CPU 시작/평균/최대/종료</span>
            <span>RAM 시작/평균/최대/종료</span>
            <span>샘플</span>
          </div>
          {hosts.map((host) => (
            <div className="admin-table-row heat-host-report-grid" key={host.host}>
              <span><strong>{host.host}</strong></span>
              <span>{[host.cpu?.start, host.cpu?.avg, host.cpu?.max, host.cpu?.end].map(formatHostUsagePercent).join(" / ")}</span>
              <span>{[host.memory?.start, host.memory?.avg, host.memory?.max, host.memory?.end].map(formatHostUsagePercent).join(" / ")}</span>
              <span>{Math.max(Number(host.cpu?.samples || 0) || 0, Number(host.memory?.samples || 0) || 0)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {warnings.length ? (
        <div className="status is-warn">
          <strong>{`${report.warnPercent || 90}% 이상 사용률 확인`}</strong>
          <span>{warnings.slice(0, 4).join(" / ")}</span>
        </div>
      ) : null}
    </section>
  );
}

function HeatTemplateCapacityPlanner(props) {
  const templates = Array.isArray(props.adminHeatTemplates) ? props.adminHeatTemplates : [];
  const defaultTemplateName = templates.find((item) => String(item.name || "").toLowerCase().includes("kubeflow"))?.name || templates[0]?.name || "";
  const [form, setForm] = useState({
    templateName: defaultTemplateName,
    labCount: "30",
    projectScope: "service",
    flavorName: "",
    includeFlavorDiskAsVolume: false,
  });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testForm, setTestForm] = useState({
    workloadEnabled: true,
    holdMinutes: "10",
  });
  const [testResult, setTestResult] = useState(null);
  const [testBusy, setTestBusy] = useState(false);
  const [recentTestJobs, setRecentTestJobs] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedHistoryJob, setSelectedHistoryJob] = useState(null);
  const getHeatWorkloadTestRef = useRef(props.onGetHeatTemplateWorkloadTest);
  const listHeatWorkloadTestsRef = useRef(props.onListHeatTemplateWorkloadTests);

  getHeatWorkloadTestRef.current = props.onGetHeatTemplateWorkloadTest;
  listHeatWorkloadTestsRef.current = props.onListHeatTemplateWorkloadTests;

  useEffect(() => {
    if (form.templateName || !defaultTemplateName) return;
    setForm((current) => ({ ...current, templateName: defaultTemplateName }));
  }, [defaultTemplateName, form.templateName]);

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setResult(null);
    setTestResult(null);
  };
  const updateTestForm = (key, value) => {
    setTestForm((current) => ({ ...current, [key]: value }));
    setTestResult(null);
  };
  async function restoreHeatWorkloadJob({ preferStored = true } = {}) {
    const storedJobId = typeof window !== "undefined" && preferStored
      ? String(window.localStorage.getItem(HEAT_WORKLOAD_TEST_STORAGE_KEY) || "").trim()
      : "";
    if (storedJobId && getHeatWorkloadTestRef.current) {
      try {
        const storedJob = await getHeatWorkloadTestRef.current(storedJobId);
        const restored = storedJob.result || storedJob;
        if (restored?.jobId && isHeatWorkloadJobActive(restored)) {
          setTestResult(restored);
          return restored;
        }
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(HEAT_WORKLOAD_TEST_STORAGE_KEY);
        }
      } catch {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(HEAT_WORKLOAD_TEST_STORAGE_KEY);
        }
      }
    }
    if (!listHeatWorkloadTestsRef.current) return null;
    const listed = await listHeatWorkloadTestsRef.current({ limit: 10 });
    const jobs = Array.isArray(listed?.result?.jobs) ? listed.result.jobs : Array.isArray(listed?.jobs) ? listed.jobs : [];
    setRecentTestJobs(jobs);
    const runningJob = jobs.find((job) => isHeatWorkloadJobActive(job));
    if (runningJob?.jobId) {
      setTestResult(runningJob);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(HEAT_WORKLOAD_TEST_STORAGE_KEY, runningJob.jobId);
      }
      return runningJob;
    }
    setTestResult(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(HEAT_WORKLOAD_TEST_STORAGE_KEY);
    }
    return null;
  }
  const onSubmit = async (event) => {
    event.preventDefault();
    if (!form.templateName || !props.onCheckHeatTemplateCapacity) return;
    setBusy(true);
    try {
      const nextResult = await props.onCheckHeatTemplateCapacity({
        templateName: form.templateName,
        labCount: form.labCount,
        projectScope: form.projectScope,
        flavorName: form.flavorName,
        includeFlavorDiskAsVolume: form.includeFlavorDiskAsVolume,
      });
      setResult(nextResult);
    } catch (error) {
      setResult({ ok: false, canFit: false, message: error.message || "수용량 계산에 실패했습니다.", checks: [], warnings: [] });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let disposed = false;
    const restore = async () => {
      try {
        const restored = await restoreHeatWorkloadJob({ preferStored: true });
        if (disposed || !restored?.jobId) return;
        setTestResult(restored);
      } catch {
        // A missing in-memory job usually means the app container restarted; the operator can use the HeatStack cleanup view.
      }
    };
    restore();
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (typeof window === "undefined" || !testResult?.jobId) return;
    if (isHeatWorkloadJobActive(testResult)) {
      window.localStorage.setItem(HEAT_WORKLOAD_TEST_STORAGE_KEY, testResult.jobId);
    } else {
      window.localStorage.removeItem(HEAT_WORKLOAD_TEST_STORAGE_KEY);
    }
  }, [testResult?.jobId]);
  useEffect(() => {
    if (!testResult?.jobId || !getHeatWorkloadTestRef.current) return undefined;
    if (!isHeatWorkloadJobActive(testResult)) return undefined;
    let disposed = false;
    const poll = async () => {
      try {
        const nextJob = await getHeatWorkloadTestRef.current(testResult.jobId);
        if (!disposed) {
          const normalizedJob = nextJob.result || nextJob;
          setTestResult(normalizedJob);
          setRecentTestJobs((current) => [normalizedJob, ...current.filter((job) => job.jobId !== normalizedJob?.jobId)].filter(Boolean).slice(0, 10));
          if (!isHeatWorkloadJobActive(normalizedJob) && typeof window !== "undefined") {
            window.localStorage.removeItem(HEAT_WORKLOAD_TEST_STORAGE_KEY);
          }
        }
      } catch (error) {
        if (!disposed) {
          setTestResult((current) => ({
            ...(current || {}),
            status: "failed",
            message: error.message || "임시 실행 테스트 상태 확인에 실패했습니다.",
            errorMessage: error.message || "",
          }));
        }
      }
    };
    const timer = window.setInterval(poll, 5000);
    poll();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [testResult?.jobId, testResult?.status]);
  const requestedTestStackCount = Math.max(1, Number.parseInt(String(form.labCount || "1"), 10) || 1);
  const onRunTemporaryTest = async () => {
    if (!form.templateName || !props.onRunHeatTemplateWorkloadTest) return;
    if (typeof window !== "undefined") {
      const minutes = Math.max(0, Number.parseFloat(testForm.holdMinutes || "0") || 0);
      const confirmed = window.confirm(`선택한 Heat 템플릿으로 임시 Stack ${requestedTestStackCount}개를 생성하고 약 ${minutes}분 후 자동 삭제합니다. 실행할까요?`);
      if (!confirmed) return;
    }
    setTestBusy(true);
    setTestResult(null);
    try {
      const nextResult = await props.onRunHeatTemplateWorkloadTest({
        templateName: form.templateName,
        projectScope: form.projectScope,
        flavorName: form.flavorName,
        workloadEnabled: testForm.workloadEnabled,
        holdMinutes: testForm.holdMinutes,
        stackCount: requestedTestStackCount,
        labCount: form.labCount,
        confirmTemporaryRun: true,
      });
      setTestResult(nextResult);
      setRecentTestJobs((current) => [nextResult, ...current.filter((job) => job.jobId !== nextResult?.jobId)].filter(Boolean).slice(0, 10));
      setHistoryOpen(true);
    } catch (error) {
      setTestResult({
        ok: false,
        message: error.message || "임시 생성/삭제 테스트에 실패했습니다.",
        warnings: [],
      });
    } finally {
      setTestBusy(false);
    }
  };
  const onRestoreTemporaryTest = async () => {
    if (!props.onListHeatTemplateWorkloadTests && !props.onGetHeatTemplateWorkloadTest) return;
    setTestBusy(true);
    try {
      const restored = await restoreHeatWorkloadJob({ preferStored: false });
      if (!restored?.jobId) {
        setHistoryOpen(true);
      }
    } catch (error) {
      setTestResult({
        ok: false,
        status: "failed",
        message: error.message || "최근 임시 실행 테스트 작업을 불러오지 못했습니다.",
        warnings: [],
      });
    } finally {
      setTestBusy(false);
    }
  };

  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const warnings = Array.isArray(result?.warnings) ? result.warnings.filter(Boolean) : [];
  const flavorDetails = Array.isArray(result?.flavorDetails) ? result.flavorDetails : [];
  const testJob = testResult?.jobId ? testResult : null;
  const activeTestJob = testJob && isHeatWorkloadJobActive(testJob) ? testJob : null;
  const staleTestJob = testJob && !activeTestJob ? testJob : null;
  const finalTestResult = activeTestJob?.result || (!testJob ? testResult : null);
  const testRunning = Boolean(activeTestJob);
  const showMainTestNotice = Boolean(finalTestResult && (!testJob || activeTestJob));
  const activeTestResult = showMainTestNotice ? finalTestResult : null;
  const testWarnings = Array.isArray(finalTestResult?.warnings) ? finalTestResult.warnings.filter(Boolean) : [];
  const testStackName = finalTestResult?.stackName || activeTestJob?.stackName || "";
  const testStackNames = Array.isArray(finalTestResult?.stackNames) ? finalTestResult.stackNames.filter(Boolean) : [];
  const testStackCount = Math.max(1, Number(finalTestResult?.stackCount || activeTestJob?.stackCount || requestedTestStackCount) || 1);
  const testCreatedStackCount = Math.max(0, Number(finalTestResult?.createdStackCount || activeTestJob?.createdStackCount || 0) || 0);
  const testReadyStackCount = Math.max(0, Number(finalTestResult?.readyStackCount || activeTestJob?.readyStackCount || 0) || 0);
  const testFailedStackCount = Math.max(0, Number(finalTestResult?.failedStackCount || activeTestJob?.failedStackCount || 0) || 0);
  const testPendingStackCount = Math.max(0, Number(finalTestResult?.pendingStackCount || activeTestJob?.pendingStackCount || 0) || 0);
  const testStackStatusSummary = finalTestResult?.stackStatusSummary || activeTestJob?.stackStatusSummary || null;
  const testStackLabel = testStackCount > 1
    ? `Stack 요청 ${testCreatedStackCount}/${testStackCount}개 · 준비 ${testReadyStackCount}/${testStackCount}개${testFailedStackCount ? ` · 실패 ${testFailedStackCount}` : ""}${testPendingStackCount ? ` · 대기 ${testPendingStackCount}` : ""}${testStackNames[0] ? ` (${testStackNames[0]}${testStackNames.length > 1 ? ` 외 ${testStackNames.length - 1}` : ""})` : ""}`
    : testStackName ? `Stack ${testStackName}` : "";
  const testCleanup = finalTestResult?.cleanup || null;
  const testWorkloadInjected = Boolean(finalTestResult?.workloadInjected);
  const testStatusOk = Boolean(finalTestResult?.ok || activeTestJob?.status === "completed");
  const testStatusMessage = finalTestResult?.message || activeTestJob?.message || "";
  const testStackStatusText = testStackStatusSummary?.statuses
    ? Object.entries(testStackStatusSummary.statuses)
        .filter(([, count]) => Number(count || 0) > 0)
        .map(([status, count]) => `${status} ${count}`)
        .join(" · ")
    : "";
  const maxCapacity = result?.maxCapacity || {};
  const maxBottleneckLabel = Array.isArray(maxCapacity.bottlenecks) && maxCapacity.bottlenecks.length
    ? `병목: ${maxCapacity.bottlenecks.map((item) => item.label).join(", ")}`
    : "";
  const shortageChecks = checks.filter((check) => !check.pass && Number(check.shortfall || 0) > 0);
  const shortageSummary = shortageChecks
    .map((check) => `${check.label} ${formatCapacityValue(check.shortfall, check.unit)} 부족`)
    .join(" / ");
  useEffect(() => {
    if (!staleTestJob?.jobId) return;
    setRecentTestJobs((current) => [staleTestJob, ...current.filter((job) => (job.result || job)?.jobId !== staleTestJob.jobId)].slice(0, 10));
    setSelectedHistoryJob(staleTestJob);
    setHistoryOpen(true);
    setTestResult(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(HEAT_WORKLOAD_TEST_STORAGE_KEY);
    }
  }, [staleTestJob?.jobId]);
  return (
    <div className="heat-capacity-planner">
      <form className="heat-capacity-form" onSubmit={onSubmit}>
        <div className="heat-capacity-head">
          <div>
            <span className="heat-capacity-kicker">CAPACITY PLANNER</span>
            <strong>랩 규모 계산</strong>
            <p>Heat 템플릿, 생성 수량, 현재 OpenStack Quota 기준으로 요청량과 최대 생성 가능 수량을 함께 확인합니다.</p>
          </div>
          <button className="mini-btn save-btn" disabled={busy || !form.templateName} type="submit">{busy ? "계산 중" : "계산 및 최대치 확인"}</button>
        </div>
        <div className="heat-capacity-form-grid">
          <AdminField label="Heat 템플릿">
            <select value={form.templateName} onChange={(event) => updateForm("templateName", event.target.value)}>
              <option value="">템플릿 선택</option>
              {templates.map((template) => (
                <option key={template.name} value={template.name}>{template.name}</option>
              ))}
            </select>
          </AdminField>
          <AdminField label="생성 수량" hint="예: kubeflow 30대">
            <input min="1" max="1000" type="number" value={form.labCount} onChange={(event) => updateForm("labCount", event.target.value)} />
          </AdminField>
          <AdminField label="Quota 프로젝트">
            <select value={form.projectScope} onChange={(event) => updateForm("projectScope", event.target.value)}>
              <option value="service">{`서비스 (${props.platformStatus?.serviceProjectName || "service"})`}</option>
              <option value="poc">{`고급/PoC (${props.platformStatus?.pocProjectName || "PoC-example.com"})`}</option>
            </select>
          </AdminField>
          <AdminField label="Flavor override" hint="템플릿 기본값을 그대로 쓰려면 비워둡니다.">
            <input value={form.flavorName} onChange={(event) => updateForm("flavorName", event.target.value)} placeholder="예: t1.k8s.kubeflow" />
          </AdminField>
        </div>
        <label className={`heat-capacity-toggle ${form.includeFlavorDiskAsVolume ? "is-checked" : ""}`}>
          <input checked={form.includeFlavorDiskAsVolume} onChange={(event) => updateForm("includeFlavorDiskAsVolume", event.target.checked)} type="checkbox" />
          <span className="heat-capacity-toggle-control" aria-hidden="true" />
          <span className="heat-capacity-toggle-copy">
            <strong>Flavor root disk를 Cinder 볼륨 Quota에 포함</strong>
            <small>부팅 디스크가 Cinder 볼륨으로 잡히는 환경이면 켜서 더 보수적으로 계산합니다.</small>
          </span>
          <span className="status-chip">{form.includeFlavorDiskAsVolume ? "포함" : "미포함"}</span>
        </label>
      </form>

      <div className="heat-workload-test-panel">
        <div className="heat-workload-copy">
          <span className="heat-capacity-kicker">TEMPORARY RUN</span>
          <strong>임시 생성/삭제 및 workload 테스트</strong>
          <p>선택한 템플릿으로 생성 수량만큼 Stack을 만들고, workload cloud-init을 주입한 뒤 자동 삭제합니다.</p>
        </div>
        <div className="heat-workload-controls">
          <span className="status-chip">{`Stack ${requestedTestStackCount}개`}</span>
          <label className="compact-check">
            <input checked={testForm.workloadEnabled} onChange={(event) => updateTestForm("workloadEnabled", event.target.checked)} type="checkbox" />
            <span>기본 workload 포함</span>
          </label>
          <label className="heat-workload-hold">
            <span>유지</span>
            <input min="0" max="1440" step="1" type="number" value={testForm.holdMinutes} onChange={(event) => updateTestForm("holdMinutes", event.target.value)} />
            <span>분 후 삭제</span>
          </label>
          <button className="mini-btn test-btn" disabled={testBusy || testRunning || !form.templateName || !props.onRunHeatTemplateWorkloadTest} onClick={onRunTemporaryTest} type="button">
            {testBusy ? "시작 중" : testRunning ? "진행 중" : "임시 실행 테스트"}
          </button>
          <button className="mini-btn" disabled={testBusy || (!props.onListHeatTemplateWorkloadTests && !props.onGetHeatTemplateWorkloadTest)} onClick={onRestoreTemporaryTest} type="button">
            최근 작업 불러오기
          </button>
        </div>
      </div>

      {showMainTestNotice ? (
        <div className={`status ${testStatusOk ? "is-success" : "is-warn"}`}>
          <strong>{testStatusMessage || (testStatusOk ? "임시 실행 테스트 완료" : "임시 실행 테스트 진행 중")}</strong>
          <span>{[
            activeTestJob?.jobId ? `Job ${activeTestJob.jobId.slice(0, 8)}` : "",
            testStackLabel,
            activeTestJob?.phase ? `단계 ${activeTestJob.phase}` : "",
            activeTestJob?.cleanupDueAt ? `삭제 예정 ${formatDateTime(activeTestJob.cleanupDueAt)}` : "",
            testCleanup?.attempted ? (testCleanup?.ok ? "삭제 완료" : "삭제 확인 필요") : "",
            finalTestResult ? (testWorkloadInjected ? "workload 주입" : "workload 미주입") : "",
          ].filter(Boolean).join(" / ")}</span>
          {activeTestJob?.errorMessage ? <span>{`상태 오류: ${activeTestJob.errorMessage}`}</span> : null}
          {finalTestResult?.createErrorMessage ? <span>{`생성 오류: ${finalTestResult.createErrorMessage}`}</span> : null}
          {testStackStatusText ? <span>{`Stack 상태: ${testStackStatusText}`}</span> : null}
          {testWarnings.length ? <span>{testWarnings.join(" / ")}</span> : null}
        </div>
      ) : null}

      <HeatTemplateHostUsageReport report={activeTestResult?.hostUsageReport || (testRunning ? activeTestJob?.hostUsageReport : null)} />

      {recentTestJobs.length ? (
        <details className="heat-workload-records" open={historyOpen} onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
          <summary>
            <span>임시 실행 기록</span>
            <strong>{`${recentTestJobs.length}건`}</strong>
          </summary>
          <div className="portal-chip-row admin-request-chip-row heat-workload-history">
            {recentTestJobs.slice(0, 6).map((job) => {
              const normalizedJob = job.result || job;
              const jobStatus = String(normalizedJob.status || job.status || "").toLowerCase();
              const statusClass = jobStatus === "completed" ? "is-success" : jobStatus === "running" || jobStatus === "queued" ? "is-info" : "is-warn";
              return (
                <button
                  className={`status-chip ${statusClass}`}
                  key={normalizedJob.jobId || job.jobId}
                  onClick={() => {
                    setSelectedHistoryJob(normalizedJob);
                    setHistoryOpen(true);
                  }}
                  type="button"
                >
                  {summarizeHeatWorkloadJob(normalizedJob)}
                </button>
              );
            })}
          </div>
          {selectedHistoryJob ? (
            <div className={`status ${selectedHistoryJob.ok || selectedHistoryJob.status === "completed" ? "is-success" : "is-warn"}`}>
              <strong>{selectedHistoryJob.message || "임시 실행 기록"}</strong>
              <span>{summarizeHeatWorkloadJob(selectedHistoryJob)}</span>
              {selectedHistoryJob.createErrorMessage ? <span>{selectedHistoryJob.createErrorMessage}</span> : null}
              {Array.isArray(selectedHistoryJob.warnings) && selectedHistoryJob.warnings.length ? <span>{selectedHistoryJob.warnings.filter(Boolean).join(" / ")}</span> : null}
            </div>
          ) : null}
        </details>
      ) : null}

      {result ? (
        <div className={`status ${result.canFit ? "is-success" : "is-warn"}`}>
          <strong>{result.message || (result.canFit ? "수용 가능" : "확인 필요")}</strong>
          {shortageSummary ? <span>{shortageSummary}</span> : null}
          {result.detailMessage ? <span>{result.detailMessage}</span> : null}
        </div>
      ) : null}

      {result ? (
        <div className="admin-summary-grid heat-capacity-summary">
          <article className="admin-summary-item">
            <span>템플릿</span>
            <strong>{result.templateName || form.templateName}</strong>
            <div className="hint">{`프로젝트 ${result.projectName || "-"}`}</div>
          </article>
          <article className="admin-summary-item">
            <span>생성 수량</span>
            <strong>{`${result.labCount || form.labCount}개`}</strong>
            <div className="hint">동시 생성 기준</div>
          </article>
          <article className="admin-summary-item">
            <span>최대 생성 가능</span>
            <strong>{maxCapacity.count == null ? "미확정" : `${maxCapacity.count}개`}</strong>
            <div className="hint">{maxBottleneckLabel || maxCapacity.message || "Quota 기준 시뮬레이션"}</div>
          </article>
          <article className="admin-summary-item">
            <span>VM/vCPU/RAM</span>
            <strong>{`${formatCapacityValue(result.requested?.instances)} / ${formatCapacityValue(result.requested?.cores)} / ${formatCapacityValue(result.requested?.ram, "MB")}`}</strong>
            <div className="hint">총 요청량</div>
          </article>
          <article className="admin-summary-item">
            <span>Disk/Port</span>
            <strong>{`${formatCapacityValue(result.requested?.volumeStorage, "GB")} / ${formatCapacityValue(result.requested?.ports)}`}</strong>
            <div className="hint">{`local ${formatCapacityValue(result.requested?.localDisk, "GB")}`}</div>
          </article>
        </div>
      ) : null}

      {checks.length ? (
        <div className="admin-table admin-table-scroll">
          <div className="admin-table-head admin-template-capacity-grid">
            <span>Quota 항목</span>
            <span>랩 1개</span>
            <span>총 필요</span>
            <span>남음 / 한도</span>
            <span>부족</span>
            <span>최대</span>
          </div>
          {checks.map((check) => (
            <div className="admin-table-row admin-template-capacity-grid" key={check.key}>
              <span><span className={`status-chip ${check.pass ? "is-success" : "is-warn"}`}>{check.pass ? "가능" : "부족"}</span> {check.label}</span>
              <span>{formatCapacityValue(check.perLab, check.unit)}</span>
              <span><strong>{formatCapacityValue(check.required, check.unit)}</strong></span>
              <span>{check.remaining == null ? "무제한 또는 미수집" : `${formatCapacityValue(check.remaining, check.unit)} / ${formatCapacityValue(check.limit, check.unit)}`}</span>
              <span>{check.pass ? "-" : `${formatCapacityValue(check.shortfall, check.unit)} 부족`}</span>
              <span>{check.maxCreatable == null ? "-" : `${check.maxCreatable}개`}</span>
            </div>
          ))}
        </div>
      ) : null}

      {flavorDetails.length ? (
        <div className="portal-chip-row admin-request-chip-row">
          {flavorDetails.map((flavor) => (
            <span className="status-chip" key={`${flavor.name}-${flavor.count}`}>
              {`${flavor.name} x${flavor.count} · ${flavor.vcpus}vCPU · ${formatCapacityValue(flavor.ram, "MB")} · ${flavor.disk}GB`}
            </span>
          ))}
        </div>
      ) : null}

      {warnings.length ? (
        <div className="status is-warn">
          <strong>확인 필요</strong>
          <span>{warnings.slice(0, 4).join(" / ")}</span>
        </div>
      ) : null}
    </div>
  );
}

export function AdminTemplatesTab(props) {
  const [editingTemplateName, setEditingTemplateName] = useState(null);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateFilter, setTemplateFilter] = useState("all");
  const [overwriteHeatUpload, setOverwriteHeatUpload] = useState(true);
  const inlineEditorRef = useRef(null);
  const activeHeatTemplate = useMemo(() => {
    const formName = String(props.heatTemplateForm?.name || "").trim();
    return (props.adminHeatTemplates || []).find((template) => template.name === formName) || null;
  }, [props.adminHeatTemplates, props.heatTemplateForm?.name]);
  const filteredHeatTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    return (props.adminHeatTemplates || []).filter((template) => {
      const metrics = getHeatTopologyMetrics(template.content);
      if (!matchesHeatTemplateFilter(template, templateFilter, metrics)) return false;
      if (!query) return true;
      const haystack = [
        template.name,
        template.content,
        ...(template.usedByTitles || []),
      ].join("\n").toLowerCase();
      return haystack.includes(query);
    });
  }, [props.adminHeatTemplates, templateFilter, templateSearch]);

  useEffect(() => {
    if (!editingTemplateName || !inlineEditorRef.current) return;
    inlineEditorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusTarget = inlineEditorRef.current.querySelector("input, textarea");
    focusTarget?.focus();
  }, [editingTemplateName]);

  return (
    <section className="admin-simple-card admin-course-card">
      <div className="admin-card-header"><strong>템플릿 파일 관리</strong></div>

      <HeatTemplateCapacityPlanner {...props} />

      <div className="admin-columns admin-template-columns">
        <div className="admin-simple-card">
          <div className="settings-panel">
            <div className="admin-card-header">
              <strong>템플릿 파일 업로드</strong>
              <label className="admin-checkbox-line heat-template-upload-control">
                <input
                  checked={overwriteHeatUpload}
                  onChange={(event) => setOverwriteHeatUpload(event.target.checked)}
                  type="checkbox"
                />
                <span>같은 파일명 덮어쓰기</span>
              </label>
            </div>
            <div className="admin-form-grid compact-admin-grid">
              <AdminField label="YAML 파일" hint="Heat 템플릿 yaml/yml 파일을 바로 업로드합니다. 파일 내용은 오른쪽 편집기에도 자동으로 채워집니다.">
                <input
                  accept=".yaml,.yml,text/yaml,text/x-yaml,application/x-yaml"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      props.onUploadHeatTemplate(file, { overwrite: overwriteHeatUpload });
                      event.target.value = "";
                    }
                  }}
                  type="file"
                />
              </AdminField>
              <div className="hint">파일을 선택하면 바로 업로드합니다. 덮어쓰기를 켜면 같은 파일명의 템플릿을 새 내용으로 교체합니다.</div>
            </div>
          </div>
          <div className="heat-template-filterbar">
            <label className="admin-lab-search">
              템플릿 검색
              <input
                onChange={(event) => setTemplateSearch(event.target.value)}
                placeholder="파일명, 리소스, 과정명 검색"
                value={templateSearch}
              />
            </label>
            <div className="course-access-filter-row heat-template-filter-row">
              {HEAT_TEMPLATE_FILTERS.map((filter) => (
                <button
                  className={`mini-btn ${templateFilter === filter.key ? "primary-mini-btn" : ""}`}
                  key={filter.key}
                  onClick={() => setTemplateFilter(filter.key)}
                  type="button"
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <span className="hint">{`${filteredHeatTemplates.length}/${(props.adminHeatTemplates || []).length}개 표시`}</span>
          </div>
          <div className="admin-table admin-table-scroll">
            <div className="admin-table-head admin-template-list-grid">
              <span>파일명</span>
              <span>미리보기</span>
              <span>작업</span>
            </div>

            {filteredHeatTemplates.length ? filteredHeatTemplates.map((template) => (
              <div className={`admin-row-group ${editingTemplateName === template.name ? "is-editing" : ""}`} key={template.name}>
                <div className="admin-table-row admin-template-list-grid">
                  <span>
                    <strong>{template.name}</strong>
                    <div className="hint">{template.inUseCount ? `사용 중 ${template.inUseCount}개 과정` : "미사용 템플릿"}</div>
                    {template.usedByTitles?.length ? <div className="hint">{template.usedByTitles.join(", ")}</div> : null}
                  </span>
                  <div className="admin-template-preview">
                    <HeatTemplateSummary content={template.content} />
                    <span>{template.content.split("\n").slice(0, 2).join(" ")}</span>
                  </div>
                  <div className="admin-inline-actions">
                    <button className="mini-btn" onClick={() => { props.onHeatTemplateEdit(template); setEditingTemplateName(template.name); }} type="button">편집</button>
                    <button className="mini-btn danger-mini-btn" disabled={Boolean(template.inUseCount)} onClick={() => { props.onDeleteHeatTemplate(template.name); if (editingTemplateName === template.name) { props.onCancelHeatTemplateEdit(); setEditingTemplateName(null); } }} type="button">삭제</button>
                  </div>
                </div>
                {editingTemplateName === template.name ? (
                  <form
                    className="admin-form admin-simple-card inline-admin-editor"
                    onSubmit={async (event) => {
                      const saved = await props.onHeatTemplateSave(event);
                      if (saved) {
                        props.onCancelHeatTemplateEdit();
                        setEditingTemplateName(null);
                      }
                    }}
                    ref={inlineEditorRef}
                  >
                    <div className="admin-card-header">
                      <div className="inline-edit-title">
                        <strong>{`${template.name} 수정`}</strong>
                        <span className="status-chip is-success">편집 중</span>
                      </div>
                      <div className="admin-inline-actions">
                        <button className="mini-btn save-btn" type="submit">저장</button>
                        <button className="mini-btn" onClick={() => { props.onCancelHeatTemplateEdit(); setEditingTemplateName(null); }} type="button">취소</button>
                      </div>
                    </div>
                    <div className="heat-template-edit-grid">
                      <div className="heat-template-editor-fields">
                        <AdminField label="템플릿 파일명" required>
                          <input value={props.heatTemplateForm.name} onChange={(event) => props.setHeatTemplateForm((current) => ({ ...current, name: event.target.value }))} placeholder="linux-shell-lab.yaml" />
                        </AdminField>
                        <HeatTemplateImpact template={activeHeatTemplate || template} />
                        <HeatTemplateSaveNotice name={props.heatTemplateForm.name} template={activeHeatTemplate || template} />
                        <AdminField label="템플릿 내용" required>
                          <textarea className="admin-large-textarea" value={props.heatTemplateForm.content} onChange={(event) => props.setHeatTemplateForm((current) => ({ ...current, content: event.target.value }))} placeholder="heat_template_version: 2018-08-31" rows={22} />
                        </AdminField>
                      </div>
                      <HeatTopologyPanel content={props.heatTemplateForm.content} name={props.heatTemplateForm.name || template.name} />
                    </div>
                  </form>
                ) : null}
              </div>
            )) : (
              <div className="admin-table-row admin-template-list-grid">
                <span>검색 결과 없음</span>
                <span className="hint">검색어 또는 필터 조건을 조정해 주세요.</span>
                <span />
              </div>
            )}
          </div>
        </div>

        {!editingTemplateName ? (
          <div className="admin-simple-card admin-template-editor">
            <form className="admin-form" onSubmit={props.onHeatTemplateSave}>
              <div className="admin-card-header">
                <strong>새 Heat 템플릿 작성</strong>
              </div>
              <div className="heat-template-edit-grid">
                <div className="heat-template-editor-fields">
                  <AdminField label="템플릿 파일명" required hint="실제 heat-templates 디렉터리에 저장될 파일명입니다. yaml 또는 yml 확장자를 권장합니다."><input value={props.heatTemplateForm.name} onChange={(event) => props.setHeatTemplateForm((current) => ({ ...current, name: event.target.value }))} placeholder="linux-shell-lab.yaml" /></AdminField>
                  <HeatTemplateImpact template={activeHeatTemplate} />
                  <HeatTemplateSaveNotice name={props.heatTemplateForm.name} template={activeHeatTemplate} />
                  <AdminField label="템플릿 내용" required hint="Heat YAML 원문입니다. 업로드한 파일을 수정하거나 새 템플릿을 직접 작성할 수 있습니다."><textarea className="admin-large-textarea" value={props.heatTemplateForm.content} onChange={(event) => props.setHeatTemplateForm((current) => ({ ...current, content: event.target.value }))} placeholder="heat_template_version: 2018-08-31" rows={22} /></AdminField>
                </div>
                <HeatTopologyPanel content={props.heatTemplateForm.content} name={props.heatTemplateForm.name} />
              </div>
              <div className="admin-inline-actions">
                <button className="mini-btn save-btn" type="submit">저장</button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function AdminApplicationYamlsTab(props) {
  const [editingYamlName, setEditingYamlName] = useState(null);
  const [selectedUploadFiles, setSelectedUploadFiles] = useState([]);
  const [uploadError, setUploadError] = useState("");
  const uploadInputRef = useRef(null);
  const inlineEditorRef = useRef(null);

  useEffect(() => {
    if (!editingYamlName || !inlineEditorRef.current) return;
    inlineEditorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusTarget = inlineEditorRef.current.querySelector("input, textarea, select");
    focusTarget?.focus();
  }, [editingYamlName]);

  async function handleApplicationYamlUpload() {
    const files = selectedUploadFiles.filter(Boolean);
    if (!files.length || props.applicationYamlUploadState?.uploading) return;
    if (typeof props.onUploadApplicationYaml !== "function") {
      const message = "Application YAML 업로드 핸들러가 연결되지 않았습니다.";
      setUploadError(message);
      props.setAdminStatus?.(message);
      return;
    }
    setUploadError("");
    try {
      await props.onUploadApplicationYaml(files);
      setSelectedUploadFiles([]);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    } catch (error) {
      const message = error?.message || "Application YAML 업로드에 실패했습니다.";
      setUploadError(message);
      props.setAdminStatus?.(message);
    }
  }

  return (
    <section className="admin-simple-card admin-course-card">
      <div className="admin-card-header"><strong>Application YAML</strong></div>

      <div className="admin-columns admin-template-columns">
        <div className="admin-simple-card">
          <div className="settings-panel">
            <div className="admin-card-header">
              <strong>Application YAML 업로드</strong>
            </div>
            <div className="admin-form-grid compact-admin-grid">
              <AdminField label="YAML 파일" hint="기본 서비스 또는 예외 서비스용 Application YAML 파일을 업로드합니다. 여러 파일을 한 번에 선택할 수 있고, 같은 파일명은 기존 항목을 덮어씁니다. OpenStack 프로젝트 설정용 YAML도 여기서 함께 관리할 수 있습니다.">
                <input
                  accept=".yaml,.yml,text/yaml,text/x-yaml,application/x-yaml"
                  disabled={props.applicationYamlUploadState?.uploading}
                  multiple
                  ref={uploadInputRef}
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    setUploadError("");
                    setSelectedUploadFiles(files);
                  }}
                  type="file"
                />
              </AdminField>
              <div className="admin-inline-actions">
                <button
                  className="mini-btn save-btn"
                  disabled={!selectedUploadFiles.length || props.applicationYamlUploadState?.uploading}
                  onClick={handleApplicationYamlUpload}
                  type="button"
                >
                  선택 파일 업로드
                </button>
                {selectedUploadFiles.length ? (
                  <span className="hint">{selectedUploadFiles.map((file) => file.name).join(", ")}</span>
                ) : (
                  <span className="hint">파일을 선택한 뒤 업로드 버튼을 눌러 주세요.</span>
                )}
              </div>
              {uploadError ? <div className="status is-error">{uploadError}</div> : null}
              <div className="hint">기본 서비스와 예외 서비스 분류는 오른쪽 편집기의 유형 필드에서 함께 관리합니다. Kubernetes 매니페스트나 앱 배포 YAML만 등록해 주세요.</div>
              {props.applicationYamlUploadState?.uploading ? (
                <div className="hint">{`업로드 중... ${props.applicationYamlUploadState.completed}/${props.applicationYamlUploadState.total}`}</div>
              ) : null}
            </div>
          </div>

          <div className="admin-table admin-table-scroll">
            <div className="admin-table-head admin-template-list-grid">
              <span>파일명</span>
              <span>유형 / 설명</span>
              <span>작업</span>
            </div>

            {props.adminApplicationYamls.length ? props.adminApplicationYamls.map((item) => (
              <div className={`admin-row-group ${editingYamlName === item.name ? "is-editing" : ""}`} key={item.name}>
                <div className="admin-table-row admin-template-list-grid">
                  <span>
                    <strong>{item.name}</strong>
                    {item.inUseCount ? <> <span className="status-chip is-success">사용 중</span></> : null}
                    <div className="hint">{item.updatedAt ? `수정: ${formatDateTime(item.updatedAt)}` : "-"}</div>
                    {item.usedByTitles?.length ? <div className="hint">{item.usedByTitles.join(", ")}</div> : null}
                  </span>
                  <span className="admin-template-preview">
                    <div>{item.category === "exception" ? "예외 서비스" : "기본 서비스"}</div>
                    <div className="hint">{item.description || item.content.split("\n").slice(0, 2).join(" ")}</div>
                    {item.validationError ? <div className="status is-error">{item.validationError}</div> : null}
                  </span>
                  <div className="admin-inline-actions">
                    <button className="mini-btn" onClick={() => { props.onApplicationYamlEdit(item); setEditingYamlName(item.name); }} type="button">편집</button>
                    <button className="mini-btn danger-mini-btn" onClick={() => { props.onDeleteApplicationYaml(item.name); if (editingYamlName === item.name) { props.onCancelApplicationYamlEdit(); setEditingYamlName(null); } }} type="button">삭제</button>
                  </div>
                </div>
                {editingYamlName === item.name ? (
                  <form
                    className="admin-form admin-simple-card inline-admin-editor"
                    onSubmit={async (event) => {
                      const saved = await props.onApplicationYamlSave(event);
                      if (saved) {
                        props.onCancelApplicationYamlEdit();
                        setEditingYamlName(null);
                      }
                    }}
                    ref={inlineEditorRef}
                  >
                    <div className="admin-card-header">
                      <div className="inline-edit-title">
                        <strong>{`${item.name} 수정`}</strong>
                        <span className="status-chip is-success">편집 중</span>
                      </div>
                      <div className="admin-inline-actions">
                        <button className="mini-btn save-btn" type="submit">저장</button>
                        <button className="mini-btn" onClick={() => { props.onCancelApplicationYamlEdit(); setEditingYamlName(null); }} type="button">취소</button>
                      </div>
                    </div>
                    <AdminField label="파일명" required>
                      <input value={props.applicationYamlForm.name} onChange={(event) => props.setApplicationYamlForm((current) => ({ ...current, name: event.target.value }))} placeholder="default-service.yaml" />
                    </AdminField>
                    <AdminField label="유형" required>
                      <select value={props.applicationYamlForm.category} onChange={(event) => props.setApplicationYamlForm((current) => ({ ...current, category: event.target.value }))}>
                        <option value="basic">기본 서비스</option>
                        <option value="exception">예외 서비스</option>
                      </select>
                    </AdminField>
                    <AdminField label="설명">
                      <input value={props.applicationYamlForm.description} onChange={(event) => props.setApplicationYamlForm((current) => ({ ...current, description: event.target.value }))} placeholder="예: 기본 애플리케이션 배포" />
                    </AdminField>
                    <AdminField label="YAML 내용" required>
                      <textarea className="admin-large-textarea" value={props.applicationYamlForm.content} onChange={(event) => props.setApplicationYamlForm((current) => ({ ...current, content: event.target.value }))} placeholder="apiVersion: v1" rows={22} />
                    </AdminField>
                    {props.applicationYamlForm.validationError ? <div className="status is-error">{props.applicationYamlForm.validationError}</div> : null}
                  </form>
                ) : null}
              </div>
            )) : <div className="hint">등록된 Application YAML 파일이 없습니다.</div>}
          </div>
        </div>

        {!editingYamlName ? (
          <div className="admin-simple-card admin-template-editor">
            <form className="admin-form" onSubmit={props.onApplicationYamlSave}>
              <div className="admin-card-header">
                <strong>새 Application YAML 작성</strong>
              </div>
              <AdminField label="파일명" required hint="application-yamls 디렉터리에 저장될 파일명입니다. yaml 또는 yml 확장자를 권장합니다. clouds.yaml 같은 OpenStack 인증 파일명은 사용할 수 없습니다.">
                <input value={props.applicationYamlForm.name} onChange={(event) => props.setApplicationYamlForm((current) => ({ ...current, name: event.target.value }))} placeholder="default-service.yaml" />
              </AdminField>
              <AdminField label="유형" required hint="공통으로 자주 쓰는 YAML이면 기본 서비스, 특수한 고급 랩이나 예외 흐름이면 예외 서비스로 분류합니다.">
                <select value={props.applicationYamlForm.category} onChange={(event) => props.setApplicationYamlForm((current) => ({ ...current, category: event.target.value }))}>
                  <option value="basic">기본 서비스</option>
                  <option value="exception">예외 서비스</option>
                </select>
              </AdminField>
              <AdminField label="설명" hint="관리자 목록에서 이 YAML의 용도와 구분을 빠르게 파악하기 위한 설명입니다.">
                <input value={props.applicationYamlForm.description} onChange={(event) => props.setApplicationYamlForm((current) => ({ ...current, description: event.target.value }))} placeholder="예: 기본 애플리케이션 배포" />
              </AdminField>
              <AdminField label="YAML 내용" required hint="실제 Application YAML 원문입니다. 업로드 후 수정하거나 새 파일을 직접 작성할 수 있습니다. Kubernetes/애플리케이션 배포용 YAML만 입력해 주세요.">
                <textarea className="admin-large-textarea" value={props.applicationYamlForm.content} onChange={(event) => props.setApplicationYamlForm((current) => ({ ...current, content: event.target.value }))} placeholder="apiVersion: v1" rows={22} />
              </AdminField>
              {props.applicationYamlForm.validationError ? <div className="status is-error">{props.applicationYamlForm.validationError}</div> : null}
              <div className="admin-inline-actions">
                <button className="mini-btn save-btn" type="submit">저장</button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function AdminCloudInitTemplatesTab(props) {
  const [editingTemplateName, setEditingTemplateName] = useState(null);
  const inlineEditorRef = useRef(null);

  useEffect(() => {
    if (!editingTemplateName || !inlineEditorRef.current) return;
    inlineEditorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusTarget = inlineEditorRef.current.querySelector("input, textarea");
    focusTarget?.focus();
  }, [editingTemplateName]);

  return (
    <section className="admin-simple-card admin-course-card">
      <div className="admin-card-header"><strong>cloud-init 템플릿</strong></div>

      <div className="admin-columns admin-template-columns">
        <div className="admin-simple-card">
          <div className="settings-panel">
            <div className="admin-card-header">
              <strong>cloud-init 업로드</strong>
            </div>
            <div className="admin-form-grid compact-admin-grid">
              <AdminField label="YAML 파일" hint="사용자화 가상머신 구성과 고급 랩에서 선택할 cloud-init 템플릿입니다.">
                <input
                  accept=".yaml,.yml,text/yaml,text/x-yaml,application/x-yaml"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      props.onUploadCloudInitTemplate(file);
                      event.target.value = "";
                    }
                  }}
                  type="file"
                />
              </AdminField>
              <AdminField label="설명">
                <input value={props.cloudInitTemplateForm.description} onChange={(event) => props.setCloudInitTemplateForm((current) => ({ ...current, description: event.target.value }))} />
              </AdminField>
            </div>
          </div>
          <div className="qna-board admin-list-panel">
            {props.adminCloudInitTemplates.length ? props.adminCloudInitTemplates.map((item) => (
              <div className={`admin-row-group ${editingTemplateName === item.name ? "is-editing" : ""}`} key={item.name}>
                <button className={`admin-list-item ${editingTemplateName === item.name ? "is-active is-editing" : ""}`} onClick={() => { props.onCloudInitTemplateEdit(item); setEditingTemplateName(item.name); }} type="button">
                  <strong>{item.name}</strong>
                  <span>{item.description || "설명 없음"}</span>
                </button>
                {editingTemplateName === item.name ? (
                  <form
                    className="admin-form admin-simple-card inline-admin-editor"
                    onSubmit={async (event) => {
                      const saved = await props.onCloudInitTemplateSave(event);
                      if (saved) {
                        props.onCancelCloudInitTemplateEdit();
                        setEditingTemplateName(null);
                      }
                    }}
                    ref={inlineEditorRef}
                  >
                    <div className="admin-card-header">
                      <div className="inline-edit-title">
                        <strong>{`${item.name} 수정`}</strong>
                        <span className="status-chip is-success">편집 중</span>
                      </div>
                      <div className="admin-inline-actions">
                        <button className="mini-btn save-btn" type="submit">저장</button>
                        <button className="mini-btn" onClick={() => { props.onCancelCloudInitTemplateEdit(); setEditingTemplateName(null); }} type="button">취소</button>
                        <button className="mini-btn danger-mini-btn" onClick={() => { props.onDeleteCloudInitTemplate(props.cloudInitTemplateForm.name); props.onCancelCloudInitTemplateEdit(); setEditingTemplateName(null); }} type="button">삭제</button>
                      </div>
                    </div>
                    <AdminField label="파일명" required>
                      <input value={props.cloudInitTemplateForm.name} onChange={(event) => props.setCloudInitTemplateForm((current) => ({ ...current, name: event.target.value }))} />
                    </AdminField>
                    <AdminField label="설명">
                      <input value={props.cloudInitTemplateForm.description} onChange={(event) => props.setCloudInitTemplateForm((current) => ({ ...current, description: event.target.value }))} />
                    </AdminField>
                    <AdminField label="YAML 내용" required>
                      <textarea className="admin-large-textarea" value={props.cloudInitTemplateForm.content} onChange={(event) => props.setCloudInitTemplateForm((current) => ({ ...current, content: event.target.value }))} />
                    </AdminField>
                  </form>
                ) : null}
              </div>
            )) : <div className="hint">등록된 cloud-init 템플릿이 없습니다.</div>}
          </div>
        </div>

        {!editingTemplateName ? (
          <form className="admin-simple-card admin-form admin-template-editor" onSubmit={props.onCloudInitTemplateSave}>
            <div className="admin-card-header">
              <strong>새 cloud-init 작성</strong>
              <div className="admin-card-tools">
                <button className="ghost-btn save-btn" type="submit">저장</button>
              </div>
            </div>
            <AdminField label="파일명" required hint="템플릿 파일명입니다. .yaml 또는 .yml 확장자를 사용합니다.">
              <input value={props.cloudInitTemplateForm.name} onChange={(event) => props.setCloudInitTemplateForm((current) => ({ ...current, name: event.target.value }))} />
            </AdminField>
            <AdminField label="설명">
              <input value={props.cloudInitTemplateForm.description} onChange={(event) => props.setCloudInitTemplateForm((current) => ({ ...current, description: event.target.value }))} />
            </AdminField>
            <AdminField label="YAML 내용" required hint="cloud-init 원문입니다. 예: #cloud-config, packages, runcmd">
              <textarea className="admin-large-textarea" value={props.cloudInitTemplateForm.content} onChange={(event) => props.setCloudInitTemplateForm((current) => ({ ...current, content: event.target.value }))} />
            </AdminField>
          </form>
        ) : null}
      </div>
    </section>
  );
}
