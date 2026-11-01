import { useEffect, useState } from "react";
import { ACTIVE_LAB_STATUSES, accessEventLabel, AdminDisclosureCard, AdminField, FlavorBadges, QuotaSummaryBlock, TrafficUsageBlock, VmUsageBlock, formatCurrency, formatDateTime, formatTrafficBytes, labStatus, useImeBufferedInput } from "./portal-views.jsx";

function renderApiMonitorTone(entry) {
  if (!entry) return { label: "확인 전", className: "is-muted" };
  if (entry.ok) return { label: "정상", className: "is-success" };
  if (entry.deferred) return { label: "확인 대기", className: "is-muted" };
  if (entry.enabled === false || entry.configured === false) return { label: "미설정", className: "is-muted" };
  return { label: "오류", className: "is-error" };
}

function isOpenstackCaTrustIssue(entry) {
  const text = [
    entry?.message,
    entry?.detailMessage,
    entry?.error,
    entry?.explanation,
    entry?.code,
    entry?.title,
    entry?.type,
    entry?.detail,
    entry?.details,
    entry?.openstackCaStatus?.error,
    ...(Array.isArray(entry?.mountWarnings) ? entry.mountWarnings : []),
    ...(Array.isArray(entry?.openstackCaStatus?.mountWarnings) ? entry.openstackCaStatus.mountWarnings : []),
    ...(Array.isArray(entry?.openstackCaStatus?.loadedPaths) ? entry.openstackCaStatus.loadedPaths : []),
    ...(Array.isArray(entry?.openstackCaStatus?.checkedPaths) ? entry.openstackCaStatus.checkedPaths : []),
  ].filter(Boolean).join(" ").toLowerCase();
  return /unable_to_verify_leaf_signature|unable to verify|unable_to_get_issuer_cert|err_tls_cert_altname_invalid|cert_altname|subject alternative name|hostname.*(does not match|mismatch)|certificate|self.?signed|ca not loaded|openstack ca not loaded|tls|not yet valid/.test(text);
}

function getApiMonitorIssueText(entry) {
  return [
    entry?.message,
    entry?.detailMessage,
    entry?.error,
    entry?.explanation,
    entry?.code,
    entry?.title,
    entry?.type,
    entry?.detail,
    entry?.details,
    entry?.openstackCaStatus?.error,
    ...(Array.isArray(entry?.mountWarnings) ? entry.mountWarnings : []),
    ...(Array.isArray(entry?.openstackCaStatus?.mountWarnings) ? entry.openstackCaStatus.mountWarnings : []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function getOpenstackApiIssueGuide(item = {}) {
  const entry = item.value;
  if (!entry || entry.ok || entry.disabled || entry.deferred || entry.enabled === false) return null;
  const text = getApiMonitorIssueText(entry);
  if (isOpenstackCaTrustIssue(entry)) {
    return {
      title: "CA/TLS 신뢰 체인 점검",
      detail: "Keystone 또는 OpenStack API 인증서 체인이 컨테이너 안에서 신뢰되지 않고 있습니다.",
      tone: "is-warn",
      steps: [
        "/app/secrets/openstack-rootCA.crt 마운트 여부 확인",
        "OPENSTACK_CA_CERT 또는 NODE_EXTRA_CA_CERTS 환경값 확인",
        "OpenStack 인증 파일의 auth_url 인증서 체인이 해당 RootCA로 이어지는지 확인",
      ],
    };
  }
  if (/403|forbidden|not authorized|access was denied|unauthorized/.test(text)) {
    return {
      title: "OpenStack 권한/역할 점검",
      detail: "서비스 계정 또는 전용 프로젝트 역할이 부족해 API 호출이 거부될 수 있습니다.",
      tone: "is-error",
      steps: [
        "서비스 계정이 대상 프로젝트 멤버인지 확인",
        "member/admin/heat_stack_owner 등 필요한 역할 확인",
        "프로젝트 scope와 domain 설정이 서비스 인증 파일과 일치하는지 확인",
      ],
    };
  }
  if (/quota|overquota|exceeded|limit/.test(text)) {
    return {
      title: "Quota/잔여 자원 점검",
      detail: "프로젝트 한도 또는 잔여 자원이 부족해 요청이 실패할 수 있습니다.",
      tone: "is-warn",
      steps: [
        "vCPU, RAM, Volume, Port, Security Group Rule 잔여량 확인",
        "실패한 요청의 예상 자원량과 현재 Quota 비교",
        "불필요한 잔여 자원 정리 후 재시도",
      ],
    };
  }
  if (item.key === "heat" && entry.cloudsYamlReadable === false) {
    return {
      title: "OpenStack 인증 파일 경로 점검",
      detail: "서버가 OpenStack 인증 파일을 읽지 못하고 있습니다.",
      tone: "is-error",
      steps: [
        "컨테이너 내부에서 실제 서비스/클라우드 콘솔 인증 파일 존재 여부 확인",
        "배포 env의 OPENSTACK_*_CLOUDS_YAML_HOST 마운트 경로 확인",
        "파일 권한과 Podman 볼륨 마운트 상태 확인",
      ],
    };
  }
  return {
    title: `${item.title || "API"} 연결 점검`,
    detail: String(entry.message || entry.error || "상세 오류를 확인하고 설정/권한/네트워크를 점검해 주세요."),
    tone: "is-info",
    steps: [
      "새로고침으로 일시 오류인지 확인",
      "엔드포인트 URL과 인증 프로젝트 확인",
      "동일 오류가 반복되면 운영 로그와 함께 문의",
    ],
  };
}

function formatAdminApiErrorDetail(value = "") {
  return String(value || "")
    .replace(/((?:password|token|secret)\s*[:=]\s*)[^,\s}]+/gi, "$1[숨김]")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 1000);
}

function renderLlmProviderLabel(provider) {
  if (provider === "ollama-native") return "Ollama Native";
  return "내부 LLM";
}

const OPENSTACK_USAGE_ORDER = [
  "instances",
  "cores",
  "ram",
  "volumes",
  "volumeStorage",
  "volumeSnapshots",
  "networks",
  "subnets",
  "routers",
  "floatingIps",
  "ports",
  "securityGroups",
  "securityGroupRules",
];

const OPENSTACK_USAGE_LABELS = {
  instances: "인스턴스",
  cores: "vCPU",
  ram: "RAM",
  volumes: "볼륨",
  volumeStorage: "블록 스토리지",
  volumeSnapshots: "볼륨 스냅샷",
  networks: "네트워크",
  subnets: "서브넷",
  routers: "라우터",
  floatingIps: "Floating IP",
  ports: "포트",
  securityGroups: "보안 그룹",
  securityGroupRules: "보안 그룹 규칙",
};

const TRAFFIC_MONITOR_VISIBLE_STATUSES = new Set(["provisioning", "running", "paused", "stopped", "terminating"]);
const SELF_SERVICE_LONG_WAIT_MS = 24 * 60 * 60 * 1000;
const SELF_SERVICE_PROVISIONING_WAIT_MS = 60 * 60 * 1000;
const SELF_SERVICE_PROJECT_STATUS_FILTERS = new Set(["all", "requested", "approved", "rejected"]);
const SELF_SERVICE_VM_STATUS_FILTERS = new Set(["all", "requested", "approved", "provisioning", "running", "failed", "terminated"]);
const SELF_SERVICE_PROJECT_OPS_FILTERS = new Set(["all", "attention", "issue", "cleanup"]);
const SELF_SERVICE_VM_OPS_FILTERS = new Set(["all", "attention", "issue", "active", "cleanup"]);
const SELF_SERVICE_PROJECT_STATUS_LABELS = {
  all: "전체 상태",
  requested: "검토 중",
  approved: "승인됨",
  rejected: "반려됨",
};
const SELF_SERVICE_VM_STATUS_LABELS = {
  all: "전체 상태",
  requested: "승인 대기",
  approved: "승인됨",
  provisioning: "생성 중",
  running: "실행 중",
  failed: "실패",
  terminated: "종료됨",
};
const SELF_SERVICE_PROJECT_OPS_LABELS = {
  all: "전체 운영",
  attention: "장기 대기",
  issue: "오류/Quota",
  cleanup: "정리 가능",
};
const SELF_SERVICE_VM_OPS_LABELS = {
  all: "전체 운영",
  attention: "장기/지연",
  issue: "오류/Quota",
  active: "진행/실행",
  cleanup: "정리 가능",
};
const SELF_SERVICE_PROJECT_CLEANUP_BLOCKING_VM_STATUSES = new Set(["requested", "approved", "provisioning", "running", "terminating"]);
const SELF_SERVICE_ADMIN_DEDICATED_PROJECT_PREFIX = "custom-lab-";
const SELF_SERVICE_ADMIN_RESERVED_PROJECT_ALIAS_KEYS = new Set(["service", "example.com", "zun", "magnum", "poc-example.com", "trove"]);
const ADMIN_API_MONITOR_FOCUS_STORAGE_KEY = "admin:apiMonitor:focus";
const ADMIN_PLATFORM_FOCUS_STORAGE_KEY = "admin:platform:focus";

function normalizeAdminOpenstackName(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_.-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[_.-]+|[_.-]+$/g, "");
}

function getAdminSelfServiceProjectAliasKeys(value = "") {
  const key = normalizeAdminOpenstackName(value).toLowerCase();
  if (!key) return [];
  const variants = [key];
  if (key.startsWith(SELF_SERVICE_ADMIN_DEDICATED_PROJECT_PREFIX)) variants.push(key.slice(SELF_SERVICE_ADMIN_DEDICATED_PROJECT_PREFIX.length));
  else variants.push(`${SELF_SERVICE_ADMIN_DEDICATED_PROJECT_PREFIX}${key}`);
  return [...new Set(variants.filter(Boolean))];
}

function isSameAdminSelfServiceProjectName(left = "", right = "") {
  const leftName = normalizeAdminOpenstackName(left).toLowerCase();
  const rightName = normalizeAdminOpenstackName(right).toLowerCase();
  if (!leftName || !rightName) return false;
  if (leftName === rightName) return true;
  const leftAliases = getAdminSelfServiceProjectAliasKeys(leftName);
  const rightAliases = getAdminSelfServiceProjectAliasKeys(rightName);
  if (
    leftAliases.some((key) => SELF_SERVICE_ADMIN_RESERVED_PROJECT_ALIAS_KEYS.has(key))
    || rightAliases.some((key) => SELF_SERVICE_ADMIN_RESERVED_PROJECT_ALIAS_KEYS.has(key))
  ) {
    return false;
  }
  return leftAliases.some((key) => rightAliases.includes(key));
}

function isVisibleTrafficMonitorLab(lab = {}) {
  const status = String(lab.status || "").trim().toLowerCase();
  if (!TRAFFIC_MONITOR_VISIBLE_STATUSES.has(status)) return false;
  return !(status === "terminating" && lab.terminatedAt);
}

function formatOpenstackUsageValue(value, unit = "") {
  const number = Number(value || 0);
  const rendered = Number.isInteger(number) ? String(number) : number.toFixed(1);
  return `${rendered}${unit ? ` ${unit}` : ""}`;
}

function normalizeOpenstackUsageResources(quotaStatus = {}) {
  const trendResources = Array.isArray(quotaStatus.usageTrend?.resources) ? quotaStatus.usageTrend.resources : [];
  const trendMap = new Map(trendResources.map((resource) => [resource.key, resource]));
  const currentEntries = Object.entries(quotaStatus.metrics || {});
  const keys = Array.from(new Set([
    ...OPENSTACK_USAGE_ORDER,
    ...currentEntries.map(([key]) => key),
    ...trendResources.map((resource) => resource.key),
  ])).filter((key) => trendMap.has(key) || quotaStatus.metrics?.[key]);

  return keys.map((key) => {
    const current = quotaStatus.metrics?.[key] || {};
    const trend = trendMap.get(key) || {};
    const points = Array.isArray(trend.points) ? trend.points : [];
    return {
      key,
      label: trend.label || OPENSTACK_USAGE_LABELS[key] || key,
      unit: current.unit || trend.unit || "",
      current,
      points,
    };
  }).filter((resource) => resource.points.length || resource.current.used != null);
}

function formatApiMonitorReportValue(value, fallback = "-") {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || fallback;
  return String(value);
}

function addApiMonitorReportLine(lines, label, value, fallback = "-") {
  lines.push(`- ${label}: ${formatApiMonitorReportValue(value, fallback)}`);
}

function collectOpenstackCaPaths(...entries) {
  return Array.from(new Set(entries
    .flatMap((entry) => [
      ...(Array.isArray(entry?.loadedPaths) ? entry.loadedPaths : []),
      ...(Array.isArray(entry?.checkedPaths) ? entry.checkedPaths : []),
    ])
    .filter(Boolean)));
}

function collectOpenstackCaCertificateDetails(...entries) {
  const seen = new Set();
  const details = [];
  entries
    .flatMap((entry) => Array.isArray(entry?.certificateDetails) ? entry.certificateDetails : [])
    .filter(Boolean)
    .forEach((certificate) => {
      const key = [
        certificate.path,
        certificate.index,
        certificate.fingerprint256,
        certificate.subject,
      ].filter(Boolean).join("|");
      if (seen.has(key)) return;
      seen.add(key);
      details.push(certificate);
    });
  return details;
}

function collectOpenstackCaMountWarnings(...entries) {
  return Array.from(new Set(entries
    .flatMap((entry) => [
      ...(Array.isArray(entry?.mountWarnings) ? entry.mountWarnings : []),
      ...(Array.isArray(entry?.openstackCaStatus?.mountWarnings) ? entry.openstackCaStatus.mountWarnings : []),
    ])
    .map((item) => String(item || "").trim())
    .filter(Boolean)));
}

function buildOpenstackDiagnosticReport(apiMonitor = {}, platformStatus = {}) {
  const heat = apiMonitor.heat || {};
  const quota = apiMonitor.quota || {};
  const openstackCa = apiMonitor.openstackCa || {};
  const extensionEntries = [
    ["Heat/OpenStack", heat],
    ["프로젝트 Quota", quota],
    ["Zun", apiMonitor.zun],
    ["CAPO", apiMonitor.magnum],
    ["Trove", apiMonitor.trove],
  ];
  const caPaths = collectOpenstackCaPaths(
    openstackCa,
    heat.openstackCaStatus,
    quota.openstackCaStatus,
    apiMonitor.zun?.openstackCaStatus,
    apiMonitor.magnum?.openstackCaStatus,
    apiMonitor.trove?.openstackCaStatus,
  );
  const caCertificateDetails = collectOpenstackCaCertificateDetails(
    openstackCa,
    openstackCa.openstackCaStatus,
    heat.openstackCaStatus,
    quota.openstackCaStatus,
    apiMonitor.zun?.openstackCaStatus,
    apiMonitor.magnum?.openstackCaStatus,
    apiMonitor.trove?.openstackCaStatus,
  );
  const caMountWarnings = collectOpenstackCaMountWarnings(
    openstackCa,
    openstackCa.openstackCaStatus,
    heat,
    heat.openstackCaStatus,
    quota,
    quota.openstackCaStatus,
    apiMonitor.zun,
    apiMonitor.zun?.openstackCaStatus,
    apiMonitor.magnum,
    apiMonitor.magnum?.openstackCaStatus,
    apiMonitor.trove,
    apiMonitor.trove?.openstackCaStatus,
  );
  const quotaWarnings = normalizeOpenstackUsageResources(quota)
    .map((resource) => {
      const latest = resource.points[resource.points.length - 1] || {};
      const percent = Number(latest.percent ?? resource.current.percent ?? 0) || 0;
      const used = latest.used ?? resource.current.used;
      const limit = latest.limit ?? resource.current.limit;
      return { ...resource, percent, used, limit };
    })
    .filter((resource) => resource.percent >= 70)
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 6);
  const lines = [
    "[KIKI OS TERMINAL-LAB OpenStack 진단 리포트]",
    `생성 시각: ${new Date().toLocaleString("ko-KR")}`,
    `최근 점검: ${formatApiMonitorReportValue(apiMonitor.checkedAt, "기록 없음")}`,
    "",
    "1. 인증서 / clouds.yaml",
  ];

  addApiMonitorReportLine(lines, "OpenStack CA 로드", openstackCa.loaded ?? heat.openstackCaStatus?.loaded ?? quota.openstackCaStatus?.loaded);
  addApiMonitorReportLine(lines, "OpenStack CA 경로", caPaths, "확인 경로 없음");
  addApiMonitorReportLine(lines, "OpenStack CA 경고", caMountWarnings, "없음");
  addApiMonitorReportLine(lines, "OpenStack CA 마지막 로드", openstackCa.reloadedAt || heat.openstackCaStatus?.reloadedAt || quota.openstackCaStatus?.reloadedAt);
  addApiMonitorReportLine(lines, "OpenStack CA 인증서 수", caCertificateDetails.filter((item) => !item.parseError).length);
  caCertificateDetails.slice(0, 4).forEach((certificate) => {
    if (certificate.parseError) {
      lines.push(`- CA #${certificate.index || "?"}: 파싱 실패 (${certificate.path || "-"}) / ${certificate.parseError}`);
      return;
    }
    lines.push(`- CA #${certificate.index || "?"}: ${certificate.subject || "-"} / issuer ${certificate.issuer || "-"} / valid ${certificate.validFrom || "-"} ~ ${certificate.validTo || "-"}${certificate.expired ? " / 만료됨" : certificate.notYetValid ? " / 아직 유효 전" : ""}`);
  });
  addApiMonitorReportLine(lines, "clouds.yaml", heat.cloudsYamlReadable ? `${heat.cloudsYamlPath || "-"} 읽기 가능` : `${heat.cloudsYamlPath || "-"} 읽기 불가`);
  if (heat.serviceCloudsYamlPath) {
    addApiMonitorReportLine(lines, "서비스 clouds.yaml", heat.serviceCloudsYamlReadable ? `${heat.serviceCloudsYamlPath} 읽기 가능` : `${heat.serviceCloudsYamlPath} 읽기 불가`);
  }
  if (heat.pocCloudsYamlPath) {
    addApiMonitorReportLine(lines, "고급 랩 clouds.yaml", heat.pocCloudsYamlReadable ? `${heat.pocCloudsYamlPath} 읽기 가능` : `${heat.pocCloudsYamlPath} 읽기 불가`);
  }
  addApiMonitorReportLine(lines, "Keystone/Auth URL", heat.authUrl);
  addApiMonitorReportLine(lines, "Heat API URL", heat.serviceHeatApiUrl || heat.endpoint);
  addApiMonitorReportLine(lines, "Compute API URL", heat.computeApiUrl);
  addApiMonitorReportLine(lines, "Network API URL", heat.networkApiUrl);

  lines.push("", "2. API 상태");
  extensionEntries.forEach(([label, entry]) => {
    const tone = renderApiMonitorTone(entry);
    const message = entry?.message || entry?.error || entry?.detailMessage || entry?.explanation || "";
    lines.push(`- ${label}: ${tone.label}${message ? ` / ${message}` : ""}`);
  });

  lines.push("", "3. Quota / 자원");
  addApiMonitorReportLine(lines, "Quota 프로젝트", quota.projectName || platformStatus.openstackServiceProjectName);
  if (quotaWarnings.length) {
    quotaWarnings.forEach((resource) => {
      const limitText = Number(resource.limit || 0) > 0 ? formatOpenstackUsageValue(resource.limit, resource.unit) : "무제한";
      lines.push(`- ${resource.label}: ${Math.round(resource.percent)}% (${formatOpenstackUsageValue(resource.used, resource.unit)} / ${limitText})`);
    });
  } else {
    lines.push("- Quota 경고: 70% 이상 사용 자원 없음 또는 미수집");
  }

  lines.push("", "4. 조치 체크리스트");
  lines.push("- CA/TLS 오류: npm run check:openstack-tls -- --json 결과의 runtime, dns, ca, tls 섹션을 확인");
  lines.push("- DNS 실패: 호스트와 앱 컨테이너에서 auth_url 호스트명이 모두 해석되는지 /etc/resolv.conf, hosts, 내부 DNS를 확인");
  lines.push("- CA/TLS 오류: OPENSTACK_CA_CERT_HOST, 컨테이너 마운트, NODE_EXTRA_CA_CERTS, auth_url 인증서 체인과 SAN을 확인");
  lines.push("- clouds.yaml 읽기 불가: podman volume mount, 파일 권한, OPENSTACK_*_CLOUDS_YAML_HOST 경로를 확인");
  lines.push("- 403/권한 오류: 프로젝트 scope, domain, member/admin/heat_stack_owner 역할을 확인");
  lines.push("- Quota/OverQuota: vCPU, RAM, Volume, Port, Security Group Rule 잔여량과 잔여 자원을 확인");
  return lines.join("\n");
}

function getTimestampMs(value) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSelfServiceItemAgeMs(item = {}, picker = (value) => value.createdAt || value.requestedAt || value.updatedAt) {
  const timestamp = getTimestampMs(picker(item));
  return timestamp ? Math.max(0, Date.now() - timestamp) : 0;
}

function getSelfServiceDetailText(item = {}) {
  return [
    item.status,
    item.errorMessage,
    item.statusReason,
    item.reviewNote,
    item.note,
    item.projectName,
    item.requestedProjectName,
    item.networkName,
    item.subnetCidr,
    item.advancedConfig?.cleanupLastError,
    ...(Array.isArray(item.networkRequests) ? item.networkRequests.flatMap((network) => [
      network?.networkName,
      network?.subnetCidr,
      network?.vlanId,
      network?.portName,
      network?.qosPolicyName,
      network?.firewallGroupName,
    ]) : []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function hasSelfServiceFailureSignal(item = {}) {
  const status = String(item.status || "").trim().toLowerCase();
  const detail = getSelfServiceDetailText(item);
  return ["failed", "error"].includes(status)
    || detail.includes("실패")
    || detail.includes("오류")
    || detail.includes("failed")
    || detail.includes("error");
}

function hasSelfServiceInfraIssueSignal(item = {}) {
  const detail = getSelfServiceDetailText(item);
  return hasSelfServiceFailureSignal(item)
    || detail.includes("quota")
    || detail.includes("overquota")
    || detail.includes("exceeded")
    || detail.includes("403")
    || detail.includes("forbidden")
    || detail.includes("not authorized")
    || detail.includes("access was denied")
    || detail.includes("clouds.yaml")
    || detail.includes("auth")
    || detail.includes("neutron");
}

function classifySelfServiceIssue(item = {}) {
  const detail = getSelfServiceDetailText(item);
  const hasFailure = hasSelfServiceFailureSignal(item);
  const hasQuotaIssue = detail.includes("quota") || detail.includes("overquota") || detail.includes("exceeded");
  const hasPermissionIssue = detail.includes("403")
    || detail.includes("forbidden")
    || detail.includes("not authorized")
    || detail.includes("access was denied");
  const hasAuthIssue = detail.includes("clouds.yaml")
    || detail.includes("authentication")
    || detail.includes("unauthorized")
    || (hasFailure && detail.includes("auth"));
  const hasNetworkIssue = detail.includes("neutron")
    || detail.includes("security_group")
    || detail.includes("networkerror")
    || detail.includes("network error")
    || (hasFailure && (
      detail.includes("network")
      || detail.includes("subnet")
      || detail.includes("router")
      || detail.includes("vlan")
      || detail.includes("trunk")
      || detail.includes("port")
    ));
  if (!hasFailure && !hasQuotaIssue && !hasPermissionIssue && !hasAuthIssue && !hasNetworkIssue) return null;
  if (hasQuotaIssue) {
    return {
      key: "quota",
      title: "Quota 초과",
      tone: "warn",
      priority: 8,
      detail: "vCPU, RAM, 볼륨, Floating IP, 보안그룹 규칙 한도를 먼저 확인하세요.",
      actionLabel: "오류 필터",
      targetParams: { ssProjectOps: "issue", ssVmOps: "issue" },
    };
  }
  if (hasPermissionIssue) {
    return {
      key: "permission",
      title: "권한/역할",
      tone: "danger",
      priority: 7,
      detail: "서비스 계정의 프로젝트 역할과 Heat/Nova/Neutron 권한을 점검하세요.",
      actionLabel: "사전 점검",
      targetTab: "platform",
    };
  }
  if (hasAuthIssue) {
    return {
      key: "auth",
      title: "인증 설정",
      tone: "danger",
      priority: 6,
      detail: "clouds.yaml 경로, cloud name, 프로젝트 스코프가 서버 설정과 맞는지 확인하세요.",
      actionLabel: "플랫폼 설정",
      targetTab: "platform",
    };
  }
  if (hasNetworkIssue) {
    return {
      key: "network",
      title: "네트워크",
      tone: "warn",
      priority: 5,
      detail: "네트워크, 라우터, VLAN/Trunk, 포트, 보안그룹 규칙 충돌 여부를 확인하세요.",
      actionLabel: "리소스 정리",
      targetTab: "openstackCleanup",
    };
  }
  if (hasFailure) {
    return {
      key: "operation",
      title: "생성 실패",
      tone: "danger",
      priority: 4,
      detail: "상세 처리 기록을 확인하고 잔여 자원 정리 후 재시도하세요.",
      actionLabel: "오류 필터",
      targetParams: { ssProjectOps: "issue", ssVmOps: "issue" },
    };
  }
  return null;
}

function buildSelfServiceIssueSummary(items = []) {
  const grouped = new Map();
  items.forEach((item) => {
    const issue = classifySelfServiceIssue(item);
    if (!issue) return;
    const current = grouped.get(issue.key) || {
      ...issue,
      count: 0,
      sources: [],
      targetTab: issue.targetTab || "selfServiceVms",
    };
    current.count += 1;
    const label = [item._sourceType, item.projectName || item.requestedProjectName || item.stackName || item.name].filter(Boolean).join(" · ");
    if (label && current.sources.length < 3) current.sources.push(label);
    grouped.set(issue.key, current);
  });
  return [...grouped.values()].sort((a, b) => (b.count * 10 + b.priority) - (a.count * 10 + a.priority));
}

function readSelfServiceUrlFilter(paramName, allowedValues, fallback = "all") {
  if (typeof window === "undefined") return fallback;
  try {
    const value = new URLSearchParams(window.location.search || "").get(paramName) || fallback;
    return allowedValues.has(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeSelfServiceUrlFilters(filters = {}) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  Object.entries(filters).forEach(([key, value]) => {
    if (!value || value === "all") {
      url.searchParams.delete(key);
      return;
    }
    url.searchParams.set(key, value);
  });
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState({}, "", nextUrl);
  }
}

function buildSelfServiceFilterUrl(filters = {}) {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.pathname = "/admin";
  url.searchParams.set("tab", "selfServiceVms");
  Object.entries(filters).forEach(([key, value]) => {
    if (!value || value === "all") {
      url.searchParams.delete(key);
      return;
    }
    url.searchParams.set(key, value);
  });
  return url.toString();
}

const SELF_SERVICE_FILTER_DEFAULTS = {
  ssProjectStatus: "all",
  ssProjectOps: "all",
  ssVmStatus: "all",
  ssVmOps: "all",
};

function normalizeSelfServiceFilterParams(params = {}) {
  return {
    ssProjectStatus: SELF_SERVICE_PROJECT_STATUS_FILTERS.has(params.ssProjectStatus) ? params.ssProjectStatus : SELF_SERVICE_FILTER_DEFAULTS.ssProjectStatus,
    ssProjectOps: SELF_SERVICE_PROJECT_OPS_FILTERS.has(params.ssProjectOps) ? params.ssProjectOps : SELF_SERVICE_FILTER_DEFAULTS.ssProjectOps,
    ssVmStatus: SELF_SERVICE_VM_STATUS_FILTERS.has(params.ssVmStatus) ? params.ssVmStatus : SELF_SERVICE_FILTER_DEFAULTS.ssVmStatus,
    ssVmOps: SELF_SERVICE_VM_OPS_FILTERS.has(params.ssVmOps) ? params.ssVmOps : SELF_SERVICE_FILTER_DEFAULTS.ssVmOps,
  };
}

function getContentItemUpdatedAt(item = {}) {
  return item.updatedAt || item.modifiedAt || item.createdAt || item.publishedAt || item.startsAt || "";
}

function clampMonitorPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function clampMonitorRelativePercent(value, maxValue) {
  const number = Number(value || 0);
  const max = Number(maxValue || 0);
  if (!Number.isFinite(number) || !Number.isFinite(max) || number <= 0 || max <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((number / max) * 100)));
}

function hasMonitorRuntimeResource(item = {}) {
  return Boolean(
    item.stackId
      || item.stackName
      || item.instanceUuid
      || item.instanceIp
      || item.containerUuid
      || (Array.isArray(item.instanceIps) && item.instanceIps.some((entry) => entry?.address || entry?.ip || entry))
      || (Array.isArray(item.vmNodes) && item.vmNodes.length > 0),
  );
}

function getMonitorMetricSupportState(value) {
  if (value === false) return "unsupported";
  if (value === null) return "unknown";
  return "supported";
}

function getMetricToneClass(value) {
  const percent = clampMonitorPercent(value);
  if (percent >= 85) return "is-danger";
  if (percent >= 60) return "is-warn";
  return "is-safe";
}

function getMonitorRiskClass(level) {
  if (level === "danger") return "is-error";
  if (level === "warn") return "is-warn";
  if (level === "watch") return "is-muted";
  return "is-success";
}

function getSelfServiceOperationAdvice(item = {}, kind = "vm") {
  const status = String(item.status || "").trim().toLowerCase();
  const detail = getSelfServiceDetailText(item);
  const hasFailureSignal = hasSelfServiceFailureSignal(item);

  if (hasFailureSignal) {
    if (detail.includes("quota") || detail.includes("overquota") || detail.includes("exceeded")) {
      return {
        title: "Quota 초과 가능성",
        detail: "프로젝트 vCPU, RAM, 볼륨, 보안그룹 규칙 여유를 먼저 확인하고 필요하면 증설 또는 기존 자원 정리를 안내하세요.",
        tone: "warn",
      };
    }
    if (detail.includes("403") || detail.includes("forbidden") || detail.includes("not authorized") || detail.includes("access was denied")) {
      return {
        title: "권한/역할 점검 필요",
        detail: "서비스 계정이 대상 프로젝트에서 member, heat_stack_owner 등 필요한 역할을 가지고 있는지 확인하세요.",
        tone: "danger",
      };
    }
    if (detail.includes("clouds.yaml") || detail.includes("auth") || detail.includes("authentication")) {
      return {
        title: "OpenStack 인증 설정 확인",
        detail: "clouds.yaml 마운트 경로, 클라우드 이름, 프로젝트 스코프가 서버 설정과 일치하는지 확인하세요.",
        tone: "danger",
      };
    }
    if (detail.includes("neutron") || detail.includes("network") || detail.includes("subnet") || detail.includes("router") || detail.includes("security_group") || detail.includes("vlan") || detail.includes("trunk")) {
      return {
        title: "네트워크 구성 점검",
        detail: "전용 네트워크, 라우터, 보안그룹, VLAN/Trunk 요청 값이 충돌하지 않는지 확인한 뒤 재시도하세요.",
        tone: "warn",
      };
    }
    return {
      title: "실패 원인 확인 필요",
      detail: kind === "project"
        ? "처리 기록을 열어 자동 구성 실패 지점을 확인하고, 준비가 끝난 뒤 수동 승인 또는 재요청을 선택하세요."
        : "오류 기록을 확인하고, 임시 자원 잔여 여부를 점검한 뒤 재시도 또는 기록 제거를 선택하세요.",
      tone: "danger",
    };
  }

  if (status === "requested") {
    return {
      title: kind === "project" ? "승인 전 검토" : "생성 승인 대기",
      detail: kind === "project"
        ? "프로젝트명, 비용/Quota, 네트워크 이름/CIDR, VLAN/Trunk 요청을 확인한 뒤 자동 승인 또는 수동 승인을 선택하세요."
        : "사용자 권한, 이미지/Flavor 허용 여부, 예상 Quota 영향을 확인한 뒤 승인하세요.",
      tone: "info",
    };
  }

  if (["approved", "provisioning", "creating", "build", "building"].includes(status)) {
    return {
      title: "생성 흐름 진행 중",
      detail: "중복 승인이나 반복 재시도를 피하고, 상태 갱신 후 작업 로그가 멈춰 있으면 운영 문의 기록을 남기세요.",
      tone: "info",
    };
  }

  if (["terminating", "deleting", "stopping"].includes(status)) {
    return {
      title: "정리 흐름 진행 중",
      detail: "포트, 볼륨, 라우터 같은 연결 자원이 남을 수 있으니 완료 후 잔여 자원 정리 화면에서 한 번 더 확인하세요.",
      tone: "warn",
    };
  }

  if (["terminated", "deleted", "rejected"].includes(status)) {
    return {
      title: "기록 정리 가능",
      detail: "실제 클라우드 자원 잔여 여부를 확인한 뒤 필요한 기록만 선택해 제거하세요.",
      tone: "muted",
    };
  }

  return null;
}

function pushSelfServiceStageChip(chips, key, label, tone = "info") {
  if (!key || chips.some((chip) => chip.key === key)) return;
  chips.push({ key, label, tone });
}

function getSelfServiceStageChips(item = {}, kind = "vm") {
  const status = String(item.status || "").trim().toLowerCase();
  const detail = getSelfServiceDetailText(item);
  const chips = [];

  if (status === "requested") pushSelfServiceStageChip(chips, "requested", "검토 대기", "wait");
  if (status === "approved") pushSelfServiceStageChip(chips, "approved", "승인됨", "success");
  if (["provisioning", "creating", "building"].includes(status)) pushSelfServiceStageChip(chips, "provisioning", "생성 중", "wait");
  if (["running", "active", "available"].includes(status)) pushSelfServiceStageChip(chips, "running", "사용 가능", "success");
  if (["terminating", "deleting", "stopping"].includes(status)) pushSelfServiceStageChip(chips, "terminating", "정리 중", "warning");
  if (["terminated", "deleted", "stopped"].includes(status)) pushSelfServiceStageChip(chips, "terminated", "종료됨", "muted");
  if (status === "rejected") pushSelfServiceStageChip(chips, "rejected", "반려됨", "muted");
  if (hasSelfServiceFailureSignal(item)) pushSelfServiceStageChip(chips, "failed", "실패", "error");

  if (detail.includes("quota") || detail.includes("overquota") || detail.includes("exceeded")) pushSelfServiceStageChip(chips, "quota", "Quota", "warning");
  if (detail.includes("403") || detail.includes("forbidden") || detail.includes("not authorized") || detail.includes("access was denied")) pushSelfServiceStageChip(chips, "permission", "권한", "error");
  if (detail.includes("clouds.yaml") || detail.includes("auth")) pushSelfServiceStageChip(chips, "auth", "인증", "error");

  if (kind === "project") {
    const networks = normalizeAdminProjectNetworkRequests(item);
    if (item.projectName || item.requestedProjectName) pushSelfServiceStageChip(chips, "project", "프로젝트", "info");
    if (networks.length) pushSelfServiceStageChip(chips, "network", `네트워크 ${networks.length}`, "info");
    if (networks.some((network) => network.routerEnabled !== false)) pushSelfServiceStageChip(chips, "router", "라우터", "info");
    if (networks.some((network) => String(network.vlanMode || "").toLowerCase() === "vlan" || network.vlanId)) pushSelfServiceStageChip(chips, "vlan", "VLAN", "warning");
    if (networks.some((network) => network.manualPortEnabled || network.portName)) pushSelfServiceStageChip(chips, "port", "포트", "info");
    if (networks.some((network) => network.trunkEnabled)) pushSelfServiceStageChip(chips, "trunk", "Trunk", "warning");
    if (networks.some((network) => network.qosPolicyName)) pushSelfServiceStageChip(chips, "qos", "QoS", "info");
    if (networks.some((network) => network.firewallGroupName)) pushSelfServiceStageChip(chips, "firewall", "방화벽", "info");
    if (detail.includes("keystone")) pushSelfServiceStageChip(chips, "keystone", "Keystone", "success");
    if (detail.includes("role") || detail.includes("역할")) pushSelfServiceStageChip(chips, "role", "역할 부여", "success");
  } else {
    if (item.projectName) pushSelfServiceStageChip(chips, "project", "프로젝트", "info");
    if (item.networkName) pushSelfServiceStageChip(chips, "network", "네트워크", "info");
    if (item.flavor) pushSelfServiceStageChip(chips, "flavor", item.flavor, "info");
    if (item.bootFromVolume) pushSelfServiceStageChip(chips, "boot-volume", "볼륨 부팅", "warning");
    if (item.dataVolumeEnabled || Number(item.dataVolumeCount || 0) > 0) pushSelfServiceStageChip(chips, "data-volume", "데이터 볼륨", "warning");
    if (item.floatingIpRequested) pushSelfServiceStageChip(chips, "floating-ip", "Floating IP", "warning");
    if (item.cloudInitTemplateName || item.cloudInitCustomFileName) pushSelfServiceStageChip(chips, "cloud-init", "cloud-init", "info");
    if (item.instanceIp) pushSelfServiceStageChip(chips, "ip", "IP 할당", "success");
  }

  return chips.slice(0, 8);
}

const ADMIN_SELF_SERVICE_ADVANCED_DAILY_PRICES = {
  network: 1200,
  router: 800,
  floatingIp: 1500,
  volumeGb: 30,
  database: 7000,
  databaseGb: 40,
};

function resolveAdminSelfServicePrices(platformStatus = {}) {
  const source = platformStatus?.pocAdvancedDailyPrices && typeof platformStatus.pocAdvancedDailyPrices === "object"
    ? platformStatus.pocAdvancedDailyPrices
    : {};
  return Object.fromEntries(Object.entries(ADMIN_SELF_SERVICE_ADVANCED_DAILY_PRICES).map(([key, fallback]) => [
    key,
    Math.max(0, Number(source[key] ?? fallback) || 0),
  ]));
}

function addAdminImpactMetric(metrics, key, label, value, unit = "") {
  const amount = Math.max(0, Number(value || 0));
  if (!amount) return;
  const current = metrics.get(key);
  metrics.set(key, {
    label,
    unit,
    value: amount + Number(current?.value || 0),
  });
}

function formatAdminImpactMetric(metric = {}) {
  const value = Number(metric.value || 0);
  return `${new Intl.NumberFormat("ko-KR").format(value)}${metric.unit || ""}`;
}

function normalizeAdminProjectNetworkRequests(request = {}) {
  const networks = [];
  if (request.networkName || request.subnetCidr) {
    networks.push({
      networkName: request.networkName,
      subnetCidr: request.subnetCidr,
      routerEnabled: true,
      source: "legacy",
    });
  }
  (Array.isArray(request.networkRequests) ? request.networkRequests : []).forEach((network) => {
    if (!network || typeof network !== "object") return;
    if (!network.networkName && !network.subnetCidr && !network.vlanId && !network.trunkEnabled && !network.manualPortEnabled) return;
    networks.push({
      networkName: network.networkName || "",
      subnetCidr: network.subnetCidr || "",
      routerEnabled: network.routerEnabled !== false,
      vlanMode: network.vlanMode || "",
      vlanId: network.vlanId || "",
      trunkEnabled: Boolean(network.trunkEnabled),
      manualPortEnabled: Boolean(network.manualPortEnabled || network.trunkEnabled),
      portName: network.portName || "",
      qosPolicyName: network.qosPolicyName || "",
      firewallGroupName: network.firewallGroupName || "",
      source: "advanced",
    });
  });
  return networks;
}

function isAdminSelfServiceNetworkOnlyRequest(request = {}) {
  const note = String(request.note || "").toLowerCase();
  return note.includes("[전용 네트워크 요청]")
    || note.includes("전용 네트워크 요청")
    || Boolean(request.requestDedicatedNetworkOnly);
}

function getAdminSelfServiceProjectRequestKindLabel(request = {}) {
  return isAdminSelfServiceNetworkOnlyRequest(request) ? "전용 네트워크 추가 요청" : "전용 프로젝트 요청";
}

function buildAdminProjectRequestImpact(request = {}, platformStatus = {}) {
  const prices = resolveAdminSelfServicePrices(platformStatus);
  const quota = platformStatus?.selfServiceVmProjectQuota || {};
  const networks = normalizeAdminProjectNetworkRequests(request);
  const networkOnly = isAdminSelfServiceNetworkOnlyRequest(request);
  const metrics = new Map();
  const costItems = [];
  const notes = [];
  let monthlyCost = 0;
  let needsQuote = true;

  const addCost = (label, monthly) => {
    const amount = Math.max(0, Number(monthly || 0));
    if (!amount) return;
    monthlyCost += amount;
    costItems.push({ label, amount });
  };

  if (!networkOnly) {
    addAdminImpactMetric(metrics, "instances", "VM 한도", quota.instances, "대");
    addAdminImpactMetric(metrics, "cores", "vCPU 한도", quota.cores, "개");
    addAdminImpactMetric(metrics, "ram", "RAM 한도", Math.round(Number(quota.ram || 0) / 1024), "GB");
    addAdminImpactMetric(metrics, "volumes", "볼륨 한도", quota.volumes, "개");
    addAdminImpactMetric(metrics, "gigabytes", "볼륨 용량", quota.gigabytes, "GB");
    addAdminImpactMetric(metrics, "floatingip", "Floating IP 한도", quota.floatingip, "개");
    addAdminImpactMetric(metrics, "security_group", "보안그룹 한도", quota.security_group, "개");
    addAdminImpactMetric(metrics, "security_group_rule", "보안규칙 한도", quota.security_group_rule, "개");
  } else {
    notes.push("기존 전용 프로젝트에 네트워크만 추가하는 요청입니다.");
  }

  if (networks.length) {
    let billableNetworkCount = 0;
    let billableRouterCount = 0;
    networks.forEach((network) => {
      addAdminImpactMetric(metrics, "network", "네트워크", 1, "개");
      addAdminImpactMetric(metrics, "subnet", "서브넷", network.subnetCidr ? 1 : 0, "개");
      if (network.routerEnabled) addAdminImpactMetric(metrics, "router", "라우터", 1, "개");
      if (network.manualPortEnabled || network.trunkEnabled) addAdminImpactMetric(metrics, "port", "수동/Trunk 포트", network.trunkEnabled ? 2 : 1, "개");
      if (network.trunkEnabled) addAdminImpactMetric(metrics, "trunk", "Trunk", 1, "개");
      if (network.qosPolicyName) addAdminImpactMetric(metrics, "qos", "QoS 정책", 1, "개");
      if (network.firewallGroupName) addAdminImpactMetric(metrics, "firewall", "방화벽 그룹", 1, "개");
      billableNetworkCount += 1;
      if (network.routerEnabled) billableRouterCount += 1;
    });
    addCost(`전용 네트워크 x${billableNetworkCount}`, prices.network * 30 * billableNetworkCount);
    if (billableRouterCount) addCost(`라우터 x${billableRouterCount}`, prices.router * 30 * billableRouterCount);
  } else {
    notes.push(networkOnly ? "요청 네트워크 정보 확인 필요" : "네트워크: net-infra 기본 사용");
  }

  const hasPolicyReview = networks.some((network) => (
    network.trunkEnabled
    || network.vlanMode === "vlan"
    || network.vlanId
    || network.manualPortEnabled
    || network.qosPolicyName
    || network.firewallGroupName
  ));
  if (hasPolicyReview) notes.push("VLAN/Trunk/QoS/방화벽 정책 검토 필요");
  if (platformStatus?.selfServiceVmProjectAutoConfigureEnabled) {
    notes.push(platformStatus?.selfServiceVmProjectAutoNetworkEnabled ? "승인 시 프로젝트와 전용 네트워크 자동 구성" : "승인 시 프로젝트/Quota 자동 구성");
  } else {
    notes.push("수동 준비 후 승인 권장");
  }

  const flow = networkOnly
    ? "요청 → 관리자 승인 → 전용 네트워크/라우터 구성 → 토폴로지 반영"
    : platformStatus?.selfServiceVmProjectAutoConfigureEnabled
    ? "요청 → 관리자 승인 → OpenStack 프로젝트/Quota 구성 → 사용자 목록 반영"
    : "요청 → OpenStack 수동 준비 → 관리자 수동 승인 → 사용자 목록 반영";
  const networkSummary = networks.length
    ? networks.map((network) => `${network.networkName || "이름 미정"}${network.subnetCidr ? ` / ${network.subnetCidr}` : ""}`).join(", ")
    : "net-infra 기본 사용";

  return {
    monthlyCost,
    needsQuote,
    costItems,
    metrics: [...metrics.values()],
    notes,
    flow,
    networkSummary,
  };
}

function AdminProjectRequestImpact({ request, platformStatus, defaultOpen = false }) {
  const impact = buildAdminProjectRequestImpact(request, platformStatus);
  const costLabel = impact.monthlyCost ? `${formatCurrency(impact.monthlyCost)}${impact.needsQuote ? "+" : ""}` : impact.needsQuote ? "견적 필요" : "추가 비용 없음";
  const costHint = impact.costItems.length
    ? impact.costItems.map((item) => `${item.label} ${formatCurrency(item.amount)}`).join(" · ")
    : "프로젝트 기본 단가와 운영 정책에 따라 승인 시 확정됩니다.";

  return (
    <details className="admin-self-service-impact" open={defaultOpen}>
      <summary>
        <span>승인 전 영향</span>
        <strong>{costLabel}</strong>
      </summary>
      <div className="admin-self-service-impact-grid">
        <div className="admin-self-service-impact-card is-cost">
          <span>예상 월 비용</span>
          <strong>{costLabel}</strong>
          <small>{costHint}</small>
        </div>
        <div className="admin-self-service-impact-card">
          <span>Quota 영향</span>
          <strong>{impact.metrics.length ? `${impact.metrics.length}개 항목` : "영향 적음"}</strong>
          <div className="admin-self-service-impact-tags">
            {impact.metrics.length ? impact.metrics.slice(0, 8).map((metric) => (
              <em key={metric.label}>{`${metric.label} ${formatAdminImpactMetric(metric)}`}</em>
            )) : <em>추가 Quota 없음</em>}
          </div>
        </div>
        <div className="admin-self-service-impact-card">
          <span>네트워크/처리</span>
          <strong>{impact.networkSummary}</strong>
          <small>{impact.flow}</small>
        </div>
      </div>
      {impact.notes.length ? (
        <div className="admin-self-service-impact-notes">
          {impact.notes.map((note) => <span key={note}>{note}</span>)}
        </div>
      ) : null}
    </details>
  );
}

function resolveAdminSelfServiceFlavorSpec(platformStatus = {}, flavor = "") {
  const specs = platformStatus?.pocFlavorSpecs && typeof platformStatus.pocFlavorSpecs === "object" ? platformStatus.pocFlavorSpecs : {};
  const spec = specs?.[flavor] || {};
  const flavorName = String(flavor || "").toLowerCase();
  const fallbackVcpu = flavorName.includes("medium") ? 4 : flavorName.includes("small") ? 2 : 1;
  const fallbackRamGb = flavorName.includes("medium") ? 8 : flavorName.includes("small") ? 4 : 2;
  const fallbackDiskGb = flavorName.includes("medium") ? 80 : flavorName.includes("small") ? 50 : 20;
  const rawRam = Number(spec.ramGb ?? spec.memoryGb ?? spec.ram ?? spec.memory);
  return {
    vcpu: Math.max(1, Number(spec.vcpu ?? spec.vcpus ?? spec.cpu ?? fallbackVcpu) || fallbackVcpu),
    ramGb: Math.max(1, Number.isFinite(rawRam) && rawRam > 128 ? Math.round(rawRam / 1024) : rawRam || fallbackRamGb),
    diskGb: Math.max(1, Number(spec.diskGb ?? spec.disk ?? fallbackDiskGb) || fallbackDiskGb),
  };
}

function buildAdminVmRequestImpact(vm = {}, platformStatus = {}) {
  const prices = resolveAdminSelfServicePrices(platformStatus);
  const flavor = vm.flavor || platformStatus?.selfServiceVmAllowedFlavors?.[0] || "m1.tiny";
  const spec = resolveAdminSelfServiceFlavorSpec(platformStatus, flavor);
  const instanceCount = Math.max(1, Number(vm.instanceCount || 1) || 1);
  const metrics = new Map();
  const costItems = [];
  const notes = [];
  let monthlyCost = 0;
  let needsQuote = false;

  const addCost = (label, monthly) => {
    const amount = Math.max(0, Number(monthly || 0));
    if (!amount) {
      needsQuote = true;
      return;
    }
    monthlyCost += amount;
    costItems.push({ label, amount });
  };

  const dailyFlavorPrice = Math.max(0, Number(platformStatus?.pocFlavorDailyPrices?.[flavor] || 0));
  addCost(`${flavor} x${instanceCount}`, dailyFlavorPrice * instanceCount * 30);
  addAdminImpactMetric(metrics, "instances", "인스턴스", instanceCount, "대");
  addAdminImpactMetric(metrics, "cores", "vCPU", spec.vcpu * instanceCount, "개");
  addAdminImpactMetric(metrics, "ram", "RAM", spec.ramGb * instanceCount, "GB");
  addAdminImpactMetric(metrics, "ports", "NIC 포트", instanceCount, "개");

  if (vm.bootFromVolume) {
    const bootVolumeSizeGb = Math.max(1, Number(vm.bootVolumeSizeGb || 20) || 20);
    addCost("부팅 볼륨", bootVolumeSizeGb * instanceCount * prices.volumeGb * 30);
    addAdminImpactMetric(metrics, "volumes", "부팅 볼륨", instanceCount, "개");
    addAdminImpactMetric(metrics, "gigabytes", "부팅 볼륨 용량", bootVolumeSizeGb * instanceCount, "GB");
  } else {
    notes.push(`ephemeral 디스크 약 ${spec.diskGb}GB 기준`);
  }

  if (vm.dataVolumeEnabled) {
    const dataVolumeCount = Math.max(1, Number(vm.dataVolumeCount || 1) || 1);
    const dataVolumeSizeGb = Math.max(1, Number(vm.dataVolumeSizeGb || 20) || 20);
    addCost("데이터 볼륨", dataVolumeCount * dataVolumeSizeGb * prices.volumeGb * 30);
    addAdminImpactMetric(metrics, "volumes", "데이터 볼륨", dataVolumeCount, "개");
    addAdminImpactMetric(metrics, "gigabytes", "데이터 볼륨 용량", dataVolumeCount * dataVolumeSizeGb, "GB");
  }

  if (vm.floatingIpRequested) {
    addCost("Floating IP", prices.floatingIp * instanceCount * 30);
    addAdminImpactMetric(metrics, "floatingip", "Floating IP", instanceCount, "개");
  }

  if (vm.cloudInitTemplateName) notes.push(`cloud-init 템플릿: ${vm.cloudInitTemplateName}`);
  if (vm.cloudInitCustomFileName) notes.push(`cloud-init 직접 입력: ${vm.cloudInitCustomFileName}`);
  notes.push(`프로젝트: ${vm.projectName || platformStatus?.serviceProjectName || "service"}`);
  notes.push(`네트워크: ${vm.networkName || "net-infra"}`);

  const status = String(vm.status || "").toLowerCase();
  const flow = status === "requested"
    ? "관리자 승인 후 실행 흐름으로 진행됩니다."
    : status === "failed"
      ? "재시도 전 Quota와 권한, 잔여 자원을 먼저 확인하세요."
      : ["provisioning", "approved"].includes(status)
        ? "생성 흐름이 진행 중입니다. 중복 승인 없이 상태 갱신을 확인하세요."
        : ["running"].includes(status)
          ? "현재 사용 중인 자원입니다. 종료 전 사용자 작업 상태를 확인하세요."
          : "기록 정리 전 실제 잔여 자원 여부를 확인하세요.";

  return {
    monthlyCost,
    needsQuote,
    costItems,
    metrics: [...metrics.values()],
    notes,
    flow,
  };
}

function AdminVmRequestImpact({ vm, platformStatus, defaultOpen = false }) {
  const impact = buildAdminVmRequestImpact(vm, platformStatus);
  const costLabel = impact.monthlyCost ? `${formatCurrency(impact.monthlyCost)}${impact.needsQuote ? "+" : ""}` : impact.needsQuote ? "견적 필요" : "추가 비용 없음";
  const costHint = impact.costItems.length
    ? impact.costItems.map((item) => `${item.label} ${formatCurrency(item.amount)}`).join(" · ")
    : impact.needsQuote
      ? "Flavor 또는 부가 자원 단가가 비어 있어 운영 견적이 필요합니다."
      : "현재 기록 기준 추가 비용 단가가 없습니다.";

  return (
    <details className="admin-self-service-impact" open={defaultOpen}>
      <summary>
        <span>자원 영향</span>
        <strong>{costLabel}</strong>
      </summary>
      <div className="admin-self-service-impact-grid">
        <div className="admin-self-service-impact-card is-cost">
          <span>예상 월 비용</span>
          <strong>{costLabel}</strong>
          <small>{costHint}</small>
        </div>
        <div className="admin-self-service-impact-card">
          <span>Quota 영향</span>
          <strong>{impact.metrics.length ? `${impact.metrics.length}개 항목` : "영향 적음"}</strong>
          <div className="admin-self-service-impact-tags">
            {impact.metrics.length ? impact.metrics.slice(0, 8).map((metric) => (
              <em key={metric.label}>{`${metric.label} ${formatAdminImpactMetric(metric)}`}</em>
            )) : <em>추가 Quota 없음</em>}
          </div>
        </div>
        <div className="admin-self-service-impact-card">
          <span>운영 흐름</span>
          <strong>{impact.flow}</strong>
          <small>승인/재시도/삭제 전에 같은 기준으로 확인합니다.</small>
        </div>
      </div>
      {impact.notes.length ? (
        <div className="admin-self-service-impact-notes">
          {impact.notes.map((note) => <span key={note}>{note}</span>)}
        </div>
      ) : null}
    </details>
  );
}

function buildAdminContainerCleanupImpact(container = {}) {
  const metrics = new Map();
  const notes = [];
  addAdminImpactMetric(metrics, "containers", "컨테이너", 1, "개");
  if (container.port) addAdminImpactMetric(metrics, "ports", "공개 포트", 1, "개");
  if (container.image) notes.push(`이미지: ${container.image}`);
  if (container.address) notes.push(`주소: ${container.address}`);
  return {
    monthlyCost: 0,
    needsQuote: true,
    costItems: [],
    metrics: [...metrics.values()],
    notes,
    flow: "Zun 컨테이너, 포트, 공개 라우트 잔여 여부를 함께 확인하세요.",
  };
}

function buildAdminMagnumCleanupImpact(cluster = {}) {
  const metrics = new Map();
  const nodeCount = Math.max(0, Number(cluster.nodeCount || 0) || 0);
  const masterCount = Math.max(0, Number(cluster.masterCount || 0) || 0);
  const totalNodes = Math.max(1, nodeCount + masterCount);
  const notes = [];
  addAdminImpactMetric(metrics, "clusters", "클러스터", 1, "개");
  addAdminImpactMetric(metrics, "nodes", "노드", totalNodes, "개");
  if (cluster.clusterTemplateName) notes.push(`CAPO 프로파일: ${cluster.clusterTemplateName}`);
  if (cluster.clusterUuid) notes.push(`UUID: ${cluster.clusterUuid}`);
  return {
    monthlyCost: 0,
    needsQuote: true,
    costItems: [],
    metrics: [...metrics.values()],
    notes,
    flow: "CAPO 클러스터와 생성된 노드/네트워크 잔여 자원을 같이 확인하세요.",
  };
}

function buildAdminTroveCleanupImpact(instance = {}, platformStatus = {}) {
  const prices = resolveAdminSelfServicePrices(platformStatus);
  const metrics = new Map();
  const costItems = [];
  const notes = [];
  let monthlyCost = 0;
  let needsQuote = false;
  const addCost = (label, monthly) => {
    const amount = Math.max(0, Number(monthly || 0));
    if (!amount) {
      needsQuote = true;
      return;
    }
    monthlyCost += amount;
    costItems.push({ label, amount });
  };
  const sizeGb = Math.max(0, Number(instance.sizeGb || instance.volumeSizeGb || 0) || 0);
  addAdminImpactMetric(metrics, "databases", "DB 인스턴스", 1, "개");
  addAdminImpactMetric(metrics, "volumes", "DB 볼륨", sizeGb ? 1 : 0, "개");
  addAdminImpactMetric(metrics, "gigabytes", "DB 볼륨 용량", sizeGb, "GB");
  if (instance.flavor) {
    const flavorDailyPrice = Math.max(0, Number(platformStatus?.pocFlavorDailyPrices?.[instance.flavor] || 0));
    if (flavorDailyPrice) addCost(`DB Flavor ${instance.flavor}`, flavorDailyPrice * 30);
    const spec = resolveAdminSelfServiceFlavorSpec(platformStatus, instance.flavor);
    addAdminImpactMetric(metrics, "cores", "vCPU", spec.vcpu, "개");
    addAdminImpactMetric(metrics, "ram", "RAM", spec.ramGb, "GB");
  } else {
    needsQuote = true;
  }
  addCost("DB 기본", prices.database * 30);
  if (sizeGb) addCost("DB 볼륨", sizeGb * prices.databaseGb * 30);
  if (instance.datastoreType) notes.push(`Datastore: ${instance.datastoreType}${instance.datastoreVersion ? ` ${instance.datastoreVersion}` : ""}`);
  if (instance.hostname) notes.push(`Host: ${instance.hostname}`);
  return {
    monthlyCost,
    needsQuote,
    costItems,
    metrics: [...metrics.values()],
    notes,
    flow: "DB 인스턴스 삭제 후 볼륨/백업/보안그룹 잔여 여부를 확인하세요.",
  };
}

function formatAdminCleanupImpactCostLabel(impact = {}) {
  if (impact.monthlyCost) return `${formatCurrency(impact.monthlyCost)}${impact.needsQuote ? "+" : ""}`;
  return impact.needsQuote ? "견적 필요" : "추가 비용 없음";
}

function formatAdminCleanupImpactHint(impact = {}) {
  if (impact.costItems?.length) {
    return impact.costItems.map((item) => `${item.label} ${formatCurrency(item.amount)}`).join(" · ");
  }
  return impact.needsQuote ? "단가 또는 실제 자원 구성이 운영 정책에 따라 확정됩니다." : "현재 기록 기준 추가 비용 단가가 없습니다.";
}

function AdminCleanupImpactSummary({ impact }) {
  if (!impact) return null;
  const metrics = Array.isArray(impact.metrics) ? impact.metrics : [];
  const notes = Array.isArray(impact.notes) ? impact.notes : [];
  const costLabel = formatAdminCleanupImpactCostLabel(impact);
  return (
    <details className="admin-self-service-impact admin-cleanup-impact">
      <summary>
        <span>자원/비용 영향</span>
        <strong>{costLabel}</strong>
      </summary>
      <div className="admin-cleanup-impact-body">
        <div className="admin-self-service-impact-tags">
          {metrics.length ? metrics.slice(0, 8).map((metric) => (
            <em key={`${metric.label}-${metric.value}`}>{`${metric.label} ${formatAdminImpactMetric(metric)}`}</em>
          )) : <em>기록된 Quota 영향 없음</em>}
        </div>
        <small>{formatAdminCleanupImpactHint(impact)}</small>
        {impact.flow ? <small>{impact.flow}</small> : null}
        {notes.length ? (
          <div className="admin-self-service-impact-notes">
            {notes.slice(0, 4).map((note) => <span key={note}>{note}</span>)}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function AdminSelfServiceReviewModal({ pendingAction, platformStatus, onCancel, onConfirm }) {
  if (!pendingAction) return null;
  const isProject = pendingAction.kind === "project";
  const target = pendingAction.item || {};
  const targetName = isProject
    ? target.projectName || target.requestedProjectName || "전용 프로젝트"
    : target.stackName || `self-vm-${target.id}`;
  const title = pendingAction.title || (isProject ? "전용 프로젝트 승인 확인" : "연구실/랩 VM 승인 확인");
  const description = pendingAction.description || "아래 비용, Quota, 네트워크 영향을 확인한 뒤 계속 진행하세요.";
  const confirmLabel = pendingAction.confirmLabel || "확인 후 진행";
  const isManualProject = isProject && pendingAction.options?.skipAutoConfigure;

  return (
    <div className="portal-modal-backdrop" role="presentation">
      <div className="portal-modal-card admin-self-service-review-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="admin-self-service-review-head">
          <div>
            <span className="card-label">승인 전 확인</span>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
          <button className="mini-btn" onClick={onCancel} type="button">닫기</button>
        </div>
        <div className="admin-self-service-review-target">
          <span>대상</span>
          <strong>{targetName}</strong>
          <small>{isProject ? `${target.userName || target.username || "-"} (${target.username || "-"})` : `${target.userName || target.username || "-"} · ${target.flavor || "-"} / ${target.instanceCount || 1}대`}</small>
        </div>
        {isProject ? (
          <AdminProjectRequestImpact request={target} platformStatus={platformStatus} defaultOpen />
        ) : (
          <AdminVmRequestImpact vm={target} platformStatus={platformStatus} defaultOpen />
        )}
        <div className={`inline-message ${isManualProject ? "is-warning" : "is-info"}`}>
          {isManualProject
            ? "수동 승인은 OpenStack 프로젝트, 역할, Quota, 네트워크가 이미 준비된 경우에만 사용하세요."
            : "진행하면 사용자 화면의 상태와 생성 흐름이 바로 변경됩니다. 중복 승인이나 반복 재시도 여부를 한 번 더 확인하세요."}
        </div>
        <div className="admin-self-service-review-actions">
          <button className="mini-btn" onClick={onCancel} type="button">취소</button>
          <button className="mini-btn approve-btn" onClick={onConfirm} type="button">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function renderOptionalPercent(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.max(0, Math.round(number))}%` : "-";
}

function renderMonitorMeter({ label, valueLabel, widthPercent, fillClassName = "is-safe", hint = "" }) {
  return (
    <div className="quota-item is-inline-monitor">
      <div className="quota-item-head">
        <span>{label}</span>
        <strong>{valueLabel}</strong>
      </div>
      <div className="quota-meter">
        <div className={`quota-meter-fill ${fillClassName}`} style={{ width: `${clampMonitorPercent(widthPercent)}%` }} />
      </div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

function renderMonitorTrend(history = []) {
  const points = Array.isArray(history) ? history.slice(-12) : [];
  if (points.length < 2) return <div className="hint">추이 데이터 수집 중</div>;
  const renderLine = (key, color) => {
    const values = points.map((point) => Math.max(0, Number(point?.[key] || 0) || 0));
    const max = Math.max(1, ...values);
    const width = 96;
    const height = 28;
    const step = points.length > 1 ? width / (points.length - 1) : width;
    const polyline = values.map((value, index) => {
      const x = Math.round(index * step);
      const y = Math.round(height - ((value / max) * (height - 4)) - 2);
      return `${x},${y}`;
    }).join(" ");
    return <polyline key={key} points={polyline} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
  };
  const latest = points.at(-1) || {};
  return (
    <div>
      <svg aria-hidden="true" height="30" role="img" viewBox="0 0 96 30" width="96">
        {renderLine("cpu", "#f59e0b")}
        {renderLine("memory", "#2563eb")}
        {renderLine("networkBytes", "#10b981")}
      </svg>
      <div className="hint">{`추이 CPU ${Math.round(Number(latest.cpu || 0))}% / MEM ${Math.round(Number(latest.memory || 0))}% / NET ${formatTrafficBytes(latest.networkBytes || 0)}`}</div>
    </div>
  );
}

function buildFallbackInstanceMonitorItems(props, activeLabs, courseMap) {
  const userMap = new Map((props.adminUsers || []).map((user) => [Number(user.id), user]));
  const labItems = activeLabs.filter((lab) => hasMonitorRuntimeResource(lab)).map((lab) => {
    const user = userMap.get(Number(lab.userId)) || {};
    const course = courseMap.get(Number(lab.courseId)) || {};
    const status = String(lab.status || "").toLowerCase();
    const cpu = Number(lab.cpuUsagePercent || 0) || 0;
    const memory = Number(lab.memoryUsagePercent || 0) || 0;
    const riskScore = (lab.trafficExceeded ? 4 : 0) + (cpu >= 85 ? 3 : cpu >= 60 ? 1 : 0) + (memory >= 85 ? 3 : memory >= 60 ? 1 : 0);
    return {
      key: `lab:${lab.id}`,
      type: "lab",
      label: lab.purpose === "exam" ? "시험 랩" : "과정 랩",
      id: lab.id,
      userId: lab.userId,
      username: lab.username || user.username || "",
      userName: lab.userName || user.name || "",
      userRole: user.role || "",
      userStatus: user.status || "",
      selfServiceVmEnabled: Boolean(user.selfServiceVmEnabled),
      courseTitle: lab.courseTitle || course.title || "",
      title: lab.stackName || lab.courseTitle || `랩 #${lab.id}`,
      status,
      stackName: lab.stackName || "",
      instanceIp: lab.instanceIp || "",
      instanceCount: Math.max(1, Array.isArray(lab.vmNodes) && lab.vmNodes.length ? lab.vmNodes.length : 1),
      flavor: lab.currentFlavor || course?.heatParameters?.flavor || "",
      backendType: lab.labBackendType || course.labBackendType || "vm",
      lastActivityAt: lab.lastAccessedAt || "",
      recentlyActive: false,
      metrics: {
        supported: true,
        cpuUsagePercent: cpu,
        memoryUsagePercent: memory,
        diskReadBytes: lab.diskReadBytes || 0,
        diskWriteBytes: lab.diskWriteBytes || 0,
        networkRxBytes: lab.trafficRxBytes || 0,
        networkTxBytes: lab.trafficTxBytes || 0,
        networkDailyBytes: lab.trafficDailyBytes || 0,
        networkTotalBytes: lab.trafficTotalBytes || 0,
        trafficExceeded: Boolean(lab.trafficExceeded),
        diskSupported: lab.vmMetricsCheckedAt ? null : false,
        networkSupported: lab.trafficIncomingMetricId || lab.trafficOutgoingMetricId ? (lab.trafficCheckedAt ? true : null) : (lab.trafficCheckedAt ? null : false),
        networkMetricMapped: Boolean(lab.trafficIncomingMetricId || lab.trafficOutgoingMetricId),
        checkedAt: lab.vmMetricsCheckedAt || lab.trafficCheckedAt || "",
      },
      risk: {
        level: riskScore >= 5 ? "danger" : riskScore >= 3 ? "warn" : riskScore > 0 ? "watch" : "normal",
        label: riskScore >= 5 ? "위험" : riskScore >= 3 ? "주의" : riskScore > 0 ? "관찰" : "정상",
        score: riskScore,
        reasons: [
          lab.trafficExceeded ? "트래픽 한도 초과" : "",
          cpu >= 85 ? `CPU ${Math.round(cpu)}%` : "",
          memory >= 85 ? `MEM ${Math.round(memory)}%` : "",
        ].filter(Boolean),
      },
      actions: {
        canWarn: Boolean(user.id || lab.userId || lab.username),
        canPause: status === "running",
        canResume: ["approved", "provisioning", "paused", "stopped"].includes(status),
        canTerminate: ["approved", "provisioning", "running", "paused", "stopped", "failed"].includes(status),
        canDisableVmAccess: Boolean(user.selfServiceVmEnabled),
      },
    };
  });
  const selfServiceItems = (props.selfServiceVms || [])
    .filter((vm) => ["approved", "provisioning", "running", "failed"].includes(String(vm.status || "").toLowerCase()) && hasMonitorRuntimeResource(vm))
    .map((vm) => {
      const user = userMap.get(Number(vm.userId)) || {};
      return {
        key: `self-service-vm:${vm.id}`,
        type: "self-service-vm",
        label: "클라우드 콘솔",
        id: vm.id,
        userId: vm.userId,
        username: vm.username || user.username || "",
        userName: vm.userName || user.name || "",
        userRole: user.role || "",
        userStatus: user.status || "",
        selfServiceVmEnabled: Boolean(user.selfServiceVmEnabled),
        courseTitle: "",
        title: vm.stackName || `self-vm-${vm.id}`,
        status: String(vm.status || "").toLowerCase(),
        stackName: vm.stackName || "",
        instanceIp: vm.instanceIp || "",
        instanceCount: Math.max(1, Number(vm.instanceCount || 1) || 1),
        flavor: vm.flavor || "",
        backendType: "vm",
        lastActivityAt: vm.startedAt || vm.createdAt || "",
        recentlyActive: false,
        metrics: { supported: false, checkedAt: "", message: "수집 대기" },
        risk: { level: "normal", label: "정상", score: 0, reasons: [] },
        actions: {
          canWarn: Boolean(user.id || vm.userId || vm.username),
          canPause: false,
          canResume: false,
          canTerminate: ["approved", "provisioning", "running", "failed"].includes(String(vm.status || "").toLowerCase()),
          canDisableVmAccess: Boolean(user.selfServiceVmEnabled),
        },
      };
    });
  return [...labItems, ...selfServiceItems].sort((left, right) => Number(right.risk?.score || 0) - Number(left.risk?.score || 0));
}

const OPENSTACK_USAGE_CHART_WIDTH = 320;
const OPENSTACK_USAGE_CHART_HEIGHT = 72;
const OPENSTACK_USAGE_CHART_PADDING = 8;

function getOpenstackUsageToneClass(percent) {
  if (percent >= 85) return "is-danger";
  if (percent >= 60) return "is-warn";
  return "is-safe";
}

function getOpenstackUsageChartPoints(points) {
  const visiblePoints = points.slice(-12).map((point) => ({
    ...point,
    percent: Math.max(0, Math.min(100, Number(point.percent || 0) || 0)),
  }));
  const plotPoints = visiblePoints.length === 1
    ? [visiblePoints[0], visiblePoints[0]]
    : visiblePoints;
  const drawableWidth = OPENSTACK_USAGE_CHART_WIDTH - (OPENSTACK_USAGE_CHART_PADDING * 2);
  const drawableHeight = OPENSTACK_USAGE_CHART_HEIGHT - (OPENSTACK_USAGE_CHART_PADDING * 2);
  const coordinates = plotPoints.map((point, index) => {
    const x = OPENSTACK_USAGE_CHART_PADDING + (plotPoints.length === 1 ? drawableWidth / 2 : (drawableWidth * index) / (plotPoints.length - 1));
    const y = OPENSTACK_USAGE_CHART_PADDING + drawableHeight - ((point.percent / 100) * drawableHeight);
    return { x, y, point };
  });
  return { coordinates };
}

function OpenstackUsageTrendBlock({ quotaStatus }) {
  const resources = normalizeOpenstackUsageResources(quotaStatus);
  const days = Number(quotaStatus?.usageTrend?.days || 5);
  if (!resources.length) {
    return <div className="empty-state">{quotaStatus?.usageTrend?.message || `최근 ${days}일 OpenStack 사용량 기록이 없습니다.`}</div>;
  }

  return (
    <div className="openstack-usage-grid">
      {resources.map((resource) => {
        const points = resource.points.length ? resource.points : [{
          collectedAt: quotaStatus?.collectedAt || "",
          used: resource.current.used,
          limit: resource.current.limit,
          percent: resource.current.percent,
        }];
        const latest = points[points.length - 1] || {};
        const latestUsed = latest.used ?? resource.current.used;
        const latestLimit = latest.limit ?? resource.current.limit;
        const latestPercent = Math.max(0, Math.min(100, Number(latest.percent ?? resource.current.percent ?? 0) || 0));
        const chart = getOpenstackUsageChartPoints(points);
        const linePoints = chart.coordinates.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
        const areaPoints = chart.coordinates.length
          ? `${OPENSTACK_USAGE_CHART_PADDING},${OPENSTACK_USAGE_CHART_HEIGHT - OPENSTACK_USAGE_CHART_PADDING} ${linePoints} ${OPENSTACK_USAGE_CHART_WIDTH - OPENSTACK_USAGE_CHART_PADDING},${OPENSTACK_USAGE_CHART_HEIGHT - OPENSTACK_USAGE_CHART_PADDING}`
          : "";
        const toneClass = getOpenstackUsageToneClass(latestPercent);
        return (
          <article className="openstack-usage-card" key={resource.key}>
            <div className="openstack-usage-head">
              <strong>{resource.label}</strong>
              <span>{`${latestPercent}%`}</span>
            </div>
            <div className={`openstack-usage-chart ${toneClass}`} aria-label={`${resource.label} 최근 ${days}일 선형 사용량`}>
              <svg focusable="false" viewBox={`0 0 ${OPENSTACK_USAGE_CHART_WIDTH} ${OPENSTACK_USAGE_CHART_HEIGHT}`}>
                <line className="openstack-usage-gridline" x1={OPENSTACK_USAGE_CHART_PADDING} x2={OPENSTACK_USAGE_CHART_WIDTH - OPENSTACK_USAGE_CHART_PADDING} y1="36" y2="36" />
                {areaPoints ? <polygon className="openstack-usage-area" points={areaPoints} /> : null}
                {linePoints ? <polyline className="openstack-usage-line" points={linePoints} /> : null}
                {chart.coordinates.map(({ x, y, point }, index) => (
                  <circle
                    className={`openstack-usage-point ${getOpenstackUsageToneClass(point.percent)}`}
                    cx={x}
                    cy={y}
                    key={`${resource.key}-${point.collectedAt || index}`}
                    r="3"
                  >
                    <title>{`${formatDateTime(point.collectedAt)} ${point.percent}%`}</title>
                  </circle>
                ))}
              </svg>
            </div>
            <div className="openstack-usage-meta">
              <span>{`${formatOpenstackUsageValue(latestUsed, resource.unit)} / ${Number(latestLimit || 0) > 0 ? formatOpenstackUsageValue(latestLimit, resource.unit) : "무제한"}`}</span>
              <span>{latest.collectedAt ? formatDateTime(latest.collectedAt) : "수집 대기"}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function AdminLogsTab(props) {
  return (
    <section className="admin-simple-card">
      <div className="admin-card-header">
        <strong>시스템 로그</strong>
      </div>
      <div className="log-list">
        {props.adminLogs?.length ? props.adminLogs.map((log) => (
          <article className={`log-item is-${log.level}`} key={log.id}>
            <div className="log-item-head">
              <strong>{String(log.level || "info").toUpperCase()}</strong>
              <span>{log.createdAt || "-"}</span>
            </div>
            <pre>{log.message}</pre>
          </article>
        )) : <p className="hint">표시할 로그가 없습니다.</p>}
      </div>
    </section>
  );
}

function formatReportNumber(value, suffix = "") {
  const number = Number(value || 0);
  return `${number.toLocaleString("ko-KR")}${suffix}`;
}



export function AdminAuditLogsTab(props) {
  const [search, setSearch] = useState("");
  const searchInput = useImeBufferedInput(search, setSearch);
  const logs = Array.isArray(props.adminAuditLogs) ? props.adminAuditLogs : [];
  const query = search.trim().toLowerCase();
  const filteredLogs = logs.filter((log) => {
    if (!query) return true;
    return [
      log.action,
      log.targetType,
      log.targetId,
      log.summary,
      log.adminUsername,
      log.ipAddress,
    ].some((value) => String(value || "").toLowerCase().includes(query));
  });

  return (
    <section className="admin-simple-card">
      <div className="admin-card-header">
        <div>
          <strong>관리자 감사 로그</strong>
          <div className="hint">설정, 과정, 공지, 이벤트 같은 운영 변경 이력을 확인합니다.</div>
        </div>
      </div>
      <div className="admin-toolbar">
        <input {...searchInput} placeholder="액션, 대상, 관리자, IP 검색" />
      </div>
      <div className="admin-table admin-table-scroll">
        <div className="admin-table-head admin-course-grid">
          <span>작업</span>
          <span>대상</span>
          <span>관리자 / 시각</span>
        </div>
        {filteredLogs.length ? filteredLogs.map((log) => (
          <div className="admin-table-row admin-course-grid" key={log.id}>
            <span>
              <strong>{log.action || "-"}</strong>
              <div className="hint">{log.summary || "-"}</div>
            </span>
            <span>
              <div>{`${log.targetType || "-"} ${log.targetId || ""}`.trim()}</div>
              {Object.keys(log.metadata || {}).length ? <div className="hint">{JSON.stringify(log.metadata)}</div> : null}
            </span>
            <span>
              <div>{log.adminUsername || "-"}</div>
              <div className="hint">{formatDateTime(log.createdAt)}</div>
              <div className="hint">{log.ipAddress || "-"}</div>
            </span>
          </div>
        )) : <div className="hint">표시할 감사 로그가 없습니다.</div>}
      </div>
    </section>
  );
}

export function AdminSelfServiceVmTab(props) {
  const projectRequests = Array.isArray(props.selfServiceProjectRequests) ? props.selfServiceProjectRequests : [];
  const users = Array.isArray(props.adminUsers) ? props.adminUsers : [];
  const vms = Array.isArray(props.selfServiceVms) ? props.selfServiceVms : [];
  const extensionCleanupItems = [
    ...vms.map((item) => ({ type: "클라우드 콘솔", status: item.status })),
    ...(props.zunContainers || []).map((item) => ({ type: "컨테이너", status: item.status })),
    ...(props.magnumClusters || []).map((item) => ({ type: "K8s", status: item.status })),
    ...(props.troveInstances || []).map((item) => ({ type: "DB", status: item.status })),
    ...(props.adminCustomLabRequests || props.customLabRequests || []).map((item) => ({ type: "고급 랩", status: item.status })),
  ];
  const cleanupWatchCount = extensionCleanupItems.filter((item) => ["failed", "terminated", "deleted", "stopped", "rejected"].includes(String(item.status || "").toLowerCase())).length;
  const busyProjectRequestIds = new Set((props.selfServiceProjectReviewBusyIds || []).map((id) => Number(id)));
  const autoConfigureProjects = Boolean(props.platformStatus?.selfServiceVmProjectAutoConfigureEnabled);
  const allowedVmImages = Array.isArray(props.platformStatus?.selfServiceVmAllowedImages) ? props.platformStatus.selfServiceVmAllowedImages.filter(Boolean) : [];
  const allowedVmFlavors = Array.isArray(props.platformStatus?.selfServiceVmAllowedFlavors) ? props.platformStatus.selfServiceVmAllowedFlavors.filter(Boolean) : [];
  const allowedVmProjects = Array.isArray(props.platformStatus?.selfServiceVmAllowedProjects) ? props.platformStatus.selfServiceVmAllowedProjects.filter(Boolean) : [];
  const enabledSelfServiceUsers = users.filter((user) => user.selfServiceVmEnabled);
  const pendingProjectRequests = projectRequests.filter((item) => item.status === "requested");
  const approvedProjectRequests = projectRequests.filter((item) => item.status === "approved");
  const containerImages = Array.isArray(props.platformStatus?.zunAllowedImages) ? props.platformStatus.zunAllowedImages.filter(Boolean) : [];
  const magnumTemplateCount = Array.isArray(props.magnumTemplates) ? props.magnumTemplates.length : 0;
  const troveDatastores = Array.isArray(props.platformStatus?.troveAllowedDatastores) ? props.platformStatus.troveAllowedDatastores.filter(Boolean) : [];
  const troveFlavors = Array.isArray(props.platformStatus?.troveAllowedFlavors) ? props.platformStatus.troveAllowedFlavors.filter(Boolean) : [];
  const troveSizes = Array.isArray(props.platformStatus?.troveAllowedSizesGb) ? props.platformStatus.troveAllowedSizesGb.filter((item) => Number(item) > 0) : [];
  const issueSummaries = buildSelfServiceIssueSummary([
    ...projectRequests.map((item) => ({ ...item, _sourceType: "전용 프로젝트" })),
    ...vms.map((item) => ({ ...item, _sourceType: "VM" })),
    ...(props.zunContainers || []).map((item) => ({ ...item, _sourceType: "컨테이너" })),
    ...(props.magnumClusters || []).map((item) => ({ ...item, _sourceType: "K8s" })),
    ...(props.troveInstances || []).map((item) => ({ ...item, _sourceType: "DB" })),
    ...(props.adminCustomLabRequests || props.customLabRequests || []).map((item) => ({ ...item, _sourceType: "고급 랩" })),
  ]);
  const topIssue = issueSummaries[0];
  const cloudDiagnostics = [
    {
      title: "최근 실패 원인",
      tone: topIssue ? topIssue.tone : "ready",
      summary: topIssue ? `${topIssue.title} ${topIssue.count}건` : "즉시 조치 없음",
      detail: topIssue ? topIssue.detail : "Quota, 권한, 인증, 네트워크 실패 신호가 현재 운영 기록에서 두드러지지 않습니다.",
      action: topIssue?.sources?.length ? `영향: ${topIssue.sources.join(" / ")}` : "사용자 콘솔 진단과 관리자 기록을 계속 같이 확인하세요.",
      actionLabel: topIssue?.actionLabel || "오류 필터",
      targetTab: topIssue?.targetTab || "selfServiceVms",
      targetParams: topIssue?.targetParams || { ssProjectOps: "issue", ssVmOps: "issue" },
    },
    {
      title: "연구실/랩 VM 신청",
      tone: props.platformStatus?.selfServiceVmServiceEnabled === false || !allowedVmImages.length || !allowedVmFlavors.length ? "warn" : "ready",
      summary: props.platformStatus?.selfServiceVmServiceEnabled === false ? "비활성" : "사용 가능",
      detail: `이미지 ${allowedVmImages.length}개 / Flavor ${allowedVmFlavors.length}개 / 기본 프로젝트 ${allowedVmProjects.length || 1}개`,
      action: !allowedVmImages.length || !allowedVmFlavors.length ? "플랫폼 설정에서 허용 이미지와 Flavor를 먼저 지정하세요." : "사용자 화면에서 인스턴스 생성 버튼이 활성화됩니다.",
      actionLabel: "플랫폼 설정",
      targetTab: "platform",
    },
    {
      title: "전용 프로젝트 흐름",
      tone: pendingProjectRequests.length ? "warn" : approvedProjectRequests.length ? "ready" : "muted",
      summary: `${approvedProjectRequests.length}개 승인 / ${pendingProjectRequests.length}개 검토`,
      detail: autoConfigureProjects ? "자동 구성 사용" : "수동 준비 후 승인",
      action: autoConfigureProjects ? "승인 시 프로젝트/Quota/기본 네트워크 구성을 함께 시도합니다." : "수동 승인 전 OpenStack 프로젝트와 네트워크가 준비되어야 합니다.",
      actionLabel: pendingProjectRequests.length ? "요청 필터" : "자동 구성 설정",
      targetTab: pendingProjectRequests.length ? "selfServiceVms" : "platform",
      targetParams: pendingProjectRequests.length ? { ssProjectStatus: "requested", ssProjectOps: "all" } : undefined,
    },
    {
      title: "사용자 권한",
      tone: enabledSelfServiceUsers.length ? "ready" : "warn",
      summary: `${enabledSelfServiceUsers.length}명 허용`,
      detail: "허용된 사용자만 무료 클라우드 콘솔 가능",
      action: enabledSelfServiceUsers.length ? "검색과 일괄 선택으로 권한을 빠르게 조정할 수 있습니다." : "사용 가능 사용자를 지정해야 사용자 메뉴에서 신청할 수 있습니다.",
      actionLabel: "사용자 관리",
      targetTab: "users",
    },
    {
      title: "컨테이너 랩",
      tone: props.platformStatus?.zunEnabled && containerImages.length ? "ready" : "warn",
      summary: props.platformStatus?.zunEnabled ? "기능 활성" : "기능 비활성",
      detail: `허용 이미지 ${containerImages.length}개`,
      action: props.platformStatus?.zunEnabled && containerImages.length ? "사용자 화면에서 컨테이너 생성이 가능합니다." : "확장 기능 설정에서 Zun 사용 여부와 허용 이미지를 확인하세요.",
      actionLabel: "컨테이너 설정",
      targetTab: "zun",
    },
    {
      title: "Kubernetes 클러스터",
      tone: props.platformStatus?.magnumEnabled && magnumTemplateCount ? "ready" : "warn",
      summary: props.platformStatus?.magnumEnabled ? "기능 활성" : "기능 비활성",
      detail: `CAPO 프로파일 ${magnumTemplateCount}개`,
      action: props.platformStatus?.magnumEnabled && magnumTemplateCount ? "사용자가 CAPO 프로파일을 선택해 클러스터 요청을 남길 수 있습니다." : "CAPO 사용 여부와 공개 프로파일 목록을 확인하세요.",
      actionLabel: "K8s 설정",
      targetTab: "magnum",
    },
    {
      title: "데이터베이스",
      tone: props.platformStatus?.troveEnabled && troveDatastores.length && troveFlavors.length && troveSizes.length ? "ready" : "warn",
      summary: props.platformStatus?.troveEnabled ? "기능 활성" : "기능 비활성",
      detail: `Datastore ${troveDatastores.length}개 / Flavor ${troveFlavors.length}개 / 크기 ${troveSizes.length}개`,
      action: props.platformStatus?.troveEnabled && troveDatastores.length && troveFlavors.length && troveSizes.length ? "사용자가 DB 요청을 남길 수 있습니다." : "Trove 사용 여부와 허용 Datastore/Flavor/볼륨 크기를 확인하세요.",
      actionLabel: "플랫폼 설정",
      targetTab: "platform",
    },
    {
      title: "잔여 자원 정리",
      tone: cleanupWatchCount ? "warn" : "ready",
      summary: `${cleanupWatchCount}건 확인`,
      detail: "실패/종료/삭제/반려 기록 기준",
      action: cleanupWatchCount ? "기록 제거 전 실제 OpenStack/Zun/CAPO/Trove 잔여 자원을 확인하세요." : "현재 정리 확인 대상이 없습니다.",
      actionLabel: cleanupWatchCount ? "리소스 정리" : "정리 화면",
      targetTab: "openstackCleanup",
    },
  ];
  const [userQuery, setUserQuery] = useState("");
  const [userAccessFilter, setUserAccessFilter] = useState("all");
  const [selectedSelfServiceUserIds, setSelectedSelfServiceUserIds] = useState([]);
  const [projectRequestFilter, setProjectRequestFilter] = useState(() => readSelfServiceUrlFilter("ssProjectStatus", SELF_SERVICE_PROJECT_STATUS_FILTERS));
  const [projectOpsFilter, setProjectOpsFilter] = useState(() => readSelfServiceUrlFilter("ssProjectOps", SELF_SERVICE_PROJECT_OPS_FILTERS));
  const [selectedProjectRequestIds, setSelectedProjectRequestIds] = useState([]);
  const [vmRecordFilter, setVmRecordFilter] = useState(() => readSelfServiceUrlFilter("ssVmStatus", SELF_SERVICE_VM_STATUS_FILTERS));
  const [vmOpsFilter, setVmOpsFilter] = useState(() => readSelfServiceUrlFilter("ssVmOps", SELF_SERVICE_VM_OPS_FILTERS));
  const [selectedVmRecordIds, setSelectedVmRecordIds] = useState([]);
  const [filterShareStatus, setFilterShareStatus] = useState("");
  const [pendingReviewAction, setPendingReviewAction] = useState(null);
  const selfServiceFilterParams = {
    ssProjectStatus: projectRequestFilter,
    ssProjectOps: projectOpsFilter,
    ssVmStatus: vmRecordFilter,
    ssVmOps: vmOpsFilter,
  };
  useEffect(() => {
    writeSelfServiceUrlFilters(selfServiceFilterParams);
  }, [projectRequestFilter, projectOpsFilter, vmRecordFilter, vmOpsFilter]);
  const resetSelfServiceFilters = () => {
    setProjectRequestFilter("all");
    setProjectOpsFilter("all");
    setVmRecordFilter("all");
    setVmOpsFilter("all");
    setSelectedProjectRequestIds([]);
    setSelectedVmRecordIds([]);
    setFilterShareStatus("필터를 초기화했습니다.");
  };
  const applySelfServiceFilterParams = (params = {}, message = "") => {
    const normalizedParams = normalizeSelfServiceFilterParams(params);
    setProjectRequestFilter(normalizedParams.ssProjectStatus);
    setProjectOpsFilter(normalizedParams.ssProjectOps);
    setVmRecordFilter(normalizedParams.ssVmStatus);
    setVmOpsFilter(normalizedParams.ssVmOps);
    setSelectedProjectRequestIds([]);
    setSelectedVmRecordIds([]);
    if (message) setFilterShareStatus(message);
  };
  const openDiagnosticTarget = (item) => {
    if (!item?.targetTab) return;
    const targetParams = normalizeSelfServiceFilterParams(item.targetParams || {});
    if (item.targetTab === "selfServiceVms") {
      applySelfServiceFilterParams(targetParams, `${item.title || "진단"} 필터를 적용했습니다.`);
      return;
    }
    props.onOpenAdminTab?.(item.targetTab, { searchParams: item.targetParams || {} });
  };
  const copySelfServiceFilterLink = async () => {
    const link = buildSelfServiceFilterUrl(selfServiceFilterParams);
    if (!link) return;
    try {
      await navigator.clipboard?.writeText(link);
      setFilterShareStatus("현재 필터 링크를 복사했습니다.");
    } catch {
      setFilterShareStatus(link);
    }
  };
  const normalizeSearchText = (value) => String(value || "").trim().toLowerCase();
  const userSearchNeedle = normalizeSearchText(userQuery);
  const filteredUsers = users.filter((user) => {
    const matchesAccess = userAccessFilter === "all"
      || (userAccessFilter === "enabled" && user.selfServiceVmEnabled)
      || (userAccessFilter === "disabled" && !user.selfServiceVmEnabled);
    if (!matchesAccess) return false;
    if (!userSearchNeedle) return true;
    return [user.name, user.username, user.email, user.status]
      .some((value) => normalizeSearchText(value).includes(userSearchNeedle));
  });
  const filteredUserIds = filteredUsers.map((user) => Number(user.id)).filter(Boolean);
  const selectedVisibleUserIds = filteredUserIds.filter((id) => selectedSelfServiceUserIds.includes(id));
  const toggleSelectedId = (setter, id, checked) => {
    const numericId = Number(id);
    if (!numericId) return;
    setter((current) => checked
      ? [...new Set([...current, numericId])]
      : current.filter((item) => Number(item) !== numericId));
  };
  const setVisibleSelection = (setter, ids, checked) => {
    const numericIds = ids.map((id) => Number(id)).filter(Boolean);
    setter((current) => checked
      ? [...new Set([...current, ...numericIds])]
      : current.filter((id) => !numericIds.includes(Number(id))));
  };
  const compactText = (value) => String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const renderCompactHistory = (label, value) => {
    const lines = compactText(value);
    if (!lines.length) return null;
    const summary = lines[0].length > 120 ? `${lines[0].slice(0, 120)}...` : lines[0];
    return (
      <details className="self-service-compact-log">
        <summary>
          <span>{label}</span>
          <small>{summary}</small>
        </summary>
        <pre>{lines.join("\n")}</pre>
      </details>
    );
  };
  const renderOperationAdvice = (item, kind) => {
    const advice = getSelfServiceOperationAdvice(item, kind);
    if (!advice) return null;
    return (
      <div className={`self-service-operation-advice is-${advice.tone || "info"}`}>
        <strong>{advice.title}</strong>
        <span>{advice.detail}</span>
      </div>
    );
  };
  const projectStatusText = (status) => status === "approved" ? "승인됨" : status === "rejected" ? "반려됨" : "검토 중";
  const vmStatusText = (status) => status === "requested" ? "관리자 승인 대기" : status === "approved" ? "승인됨" : status === "provisioning" ? "생성 중" : status === "running" ? "실행 중" : status === "terminating" ? "종료 중" : status === "terminated" ? "종료됨" : "실패";
  const isLongWaitingProjectRequest = (request) => request.status === "requested" && getSelfServiceItemAgeMs(request) >= SELF_SERVICE_LONG_WAIT_MS;
  const isLongWaitingVmRecord = (vm) => {
    if (["requested", "approved"].includes(vm.status)) return getSelfServiceItemAgeMs(vm) >= SELF_SERVICE_LONG_WAIT_MS;
    if (vm.status === "provisioning") return getSelfServiceItemAgeMs(vm, (item) => item.updatedAt || item.createdAt || item.requestedAt) >= SELF_SERVICE_PROVISIONING_WAIT_MS;
    return false;
  };
  const isProjectRequestBlockedByActiveVm = (request = {}) => {
    if (request.status !== "approved") return false;
    const projectName = request.projectName || request.requestedProjectName || "";
    const userId = Number(request.userId);
    if (!projectName || !userId) return false;
    return vms.some((vm) => (
      SELF_SERVICE_PROJECT_CLEANUP_BLOCKING_VM_STATUSES.has(String(vm.status || "").toLowerCase())
      && Number(vm.userId) === userId
      && isSameAdminSelfServiceProjectName(projectName, vm.projectName)
    ));
  };
  const canDeleteProjectRequestRecord = (request = {}) => (
    ["approved", "rejected"].includes(request.status)
    && !isProjectRequestBlockedByActiveVm(request)
  );
  const matchesProjectOpsFilter = (request) => {
    if (projectOpsFilter === "attention") return isLongWaitingProjectRequest(request);
    if (projectOpsFilter === "issue") return hasSelfServiceInfraIssueSignal(request);
    if (projectOpsFilter === "cleanup") return canDeleteProjectRequestRecord(request);
    return true;
  };
  const matchesVmOpsFilter = (vm) => {
    if (vmOpsFilter === "attention") return isLongWaitingVmRecord(vm);
    if (vmOpsFilter === "issue") return vm.status === "failed" || hasSelfServiceInfraIssueSignal(vm);
    if (vmOpsFilter === "active") return ["requested", "approved", "provisioning", "running"].includes(vm.status);
    if (vmOpsFilter === "cleanup") return ["failed", "terminated"].includes(vm.status);
    return true;
  };
  const projectOpsFilterOptions = [
    { key: "all", label: "전체", count: projectRequests.length },
    { key: "attention", label: "장기 대기", count: projectRequests.filter(isLongWaitingProjectRequest).length },
    { key: "issue", label: "오류/Quota", count: projectRequests.filter(hasSelfServiceInfraIssueSignal).length },
    { key: "cleanup", label: "정리 가능", count: projectRequests.filter(canDeleteProjectRequestRecord).length },
  ];
  const vmOpsFilterOptions = [
    { key: "all", label: "전체", count: vms.length },
    { key: "attention", label: "장기/지연", count: vms.filter(isLongWaitingVmRecord).length },
    { key: "issue", label: "오류/Quota", count: vms.filter((vm) => vm.status === "failed" || hasSelfServiceInfraIssueSignal(vm)).length },
    { key: "active", label: "진행/실행", count: vms.filter((vm) => ["requested", "approved", "provisioning", "running"].includes(vm.status)).length },
    { key: "cleanup", label: "정리 가능", count: vms.filter((vm) => ["failed", "terminated"].includes(vm.status)).length },
  ];
  const filteredProjectRequests = projectRequests
    .filter((request) => projectRequestFilter === "all" || request.status === projectRequestFilter)
    .filter(matchesProjectOpsFilter);
  const removableProjectRequestIds = filteredProjectRequests.filter(canDeleteProjectRequestRecord).map((request) => Number(request.id));
  const selectedRemovableProjectRequestIds = selectedProjectRequestIds.filter((id) => {
    const request = projectRequests.find((item) => Number(item.id) === Number(id));
    return request && canDeleteProjectRequestRecord(request);
  });
  const filteredVms = vms
    .filter((vm) => vmRecordFilter === "all" || vm.status === vmRecordFilter)
    .filter(matchesVmOpsFilter);
  const deletableVmRecordIds = filteredVms.filter((vm) => ["failed", "terminated"].includes(vm.status)).map((vm) => Number(vm.id));
  const requestedVmCount = vms.filter((vm) => vm.status === "requested").length;
  const delayedProjectCount = projectRequests.filter(isLongWaitingProjectRequest).length;
  const delayedVmCount = vms.filter(isLongWaitingVmRecord).length;
  const delayedQueueCount = delayedProjectCount + delayedVmCount;
  const issueCount = issueSummaries.reduce((sum, item) => sum + Number(item.count || 0), 0);
  const cleanupProjectRecordCount = projectRequests.filter(canDeleteProjectRequestRecord).length;
  const blockedProjectRecordCount = projectRequests.filter((request) => ["approved", "rejected"].includes(request.status) && !canDeleteProjectRequestRecord(request)).length;
  const cleanupVmRecordCount = vms.filter((vm) => ["failed", "terminated"].includes(vm.status)).length;
  const disabledSelfServiceUserCount = users.filter((user) => !user.selfServiceVmEnabled).length;
  const activeVmCount = vms.filter((item) => ["requested", "approved", "provisioning", "running"].includes(item.status)).length;
  const hasActiveSelfServiceFilters = projectRequestFilter !== "all"
    || projectOpsFilter !== "all"
    || vmRecordFilter !== "all"
    || vmOpsFilter !== "all"
    || userAccessFilter !== "all"
    || Boolean(userQuery.trim());
  const selfServiceFilterGuide = issueCount
    ? `오류/Quota 신호 ${issueCount}건을 먼저 확인하세요.`
    : delayedQueueCount
      ? `장기 대기/지연 ${delayedQueueCount}건을 먼저 확인하세요.`
      : pendingProjectRequests.length
        ? `전용 프로젝트 검토 ${pendingProjectRequests.length}건이 대기 중입니다.`
        : "현재 운영 필터에서 급한 조치 신호는 없습니다.";
  const selfServiceFilterStatusCards = [
    {
      key: "project-filter",
      title: "전용 프로젝트",
      tone: filteredProjectRequests.length ? (projectRequestFilter !== "all" || projectOpsFilter !== "all" ? "active" : "ready") : "empty",
      status: `${SELF_SERVICE_PROJECT_STATUS_LABELS[projectRequestFilter] || projectRequestFilter} · ${SELF_SERVICE_PROJECT_OPS_LABELS[projectOpsFilter] || projectOpsFilter}`,
      detail: `표시 ${filteredProjectRequests.length}건 / 전체 ${projectRequests.length}건`,
      href: "#self-service-project-requests",
      actionLabel: "프로젝트 표",
    },
    {
      key: "vm-filter",
      title: "클라우드 콘솔",
      tone: filteredVms.length ? (vmRecordFilter !== "all" || vmOpsFilter !== "all" ? "active" : "ready") : "empty",
      status: `${SELF_SERVICE_VM_STATUS_LABELS[vmRecordFilter] || vmRecordFilter} · ${SELF_SERVICE_VM_OPS_LABELS[vmOpsFilter] || vmOpsFilter}`,
      detail: `표시 ${filteredVms.length}건 / 전체 ${vms.length}건`,
      href: "#self-service-vm-records",
      actionLabel: "VM 표",
    },
    {
      key: "user-filter",
      title: "사용자 권한",
      tone: selectedSelfServiceUserIds.length ? "active" : userAccessFilter !== "all" || userQuery.trim() ? "ready" : "muted",
      status: userAccessFilter === "enabled" ? "사용 가능만" : userAccessFilter === "disabled" ? "사용 제한만" : "전체 사용자",
      detail: `표시 ${filteredUsers.length}명 / 선택 ${selectedSelfServiceUserIds.length}명`,
      href: "#self-service-user-access",
      actionLabel: "권한 표",
    },
  ];
  const focusProjectRequests = (status = "all", ops = "all", message = "") => {
    setProjectRequestFilter(status);
    setProjectOpsFilter(ops);
    setSelectedProjectRequestIds([]);
    if (message) setFilterShareStatus(message);
  };
  const focusVmRecords = (status = "all", ops = "all", message = "") => {
    setVmRecordFilter(status);
    setVmOpsFilter(ops);
    setSelectedVmRecordIds([]);
    if (message) setFilterShareStatus(message);
  };
  const adminPriorityActions = [
    {
      key: "project",
      icon: "PRJ",
      label: "프로젝트 승인 대기",
      count: pendingProjectRequests.length,
      detail: pendingProjectRequests.length ? (autoConfigureProjects ? "자동 구성 전 비용/Quota 확인" : "수동 프로젝트 준비 후 승인") : "대기 중인 전용 프로젝트 없음",
      tone: pendingProjectRequests.length ? "warn" : "ready",
      actionLabel: pendingProjectRequests.length ? "검토 열기" : "승인 기록",
      onClick: () => focusProjectRequests(pendingProjectRequests.length ? "requested" : "approved", "all", "전용 프로젝트 요청 필터를 적용했습니다."),
    },
    {
      key: "vm",
      icon: "VM",
      label: "VM 생성 승인",
      count: requestedVmCount,
      detail: requestedVmCount ? "이미지, Flavor, 프로젝트 영향 확인" : "승인 대기 VM 없음",
      tone: requestedVmCount ? "warn" : "ready",
      actionLabel: requestedVmCount ? "승인 대기" : "진행 보기",
      onClick: () => focusVmRecords(requestedVmCount ? "requested" : "all", "active", "클라우드 콘솔 기록 필터를 적용했습니다."),
    },
    {
      key: "delay",
      icon: "TIME",
      label: "지연 확인",
      count: delayedQueueCount,
      detail: delayedQueueCount ? `프로젝트 ${delayedProjectCount}건 / VM ${delayedVmCount}건` : "지연 신호 없음",
      tone: delayedQueueCount ? "warn" : "ready",
      actionLabel: "지연 필터",
      onClick: () => {
        focusProjectRequests("all", "attention", "");
        focusVmRecords("all", "attention", "장기 대기/지연 필터를 적용했습니다.");
      },
    },
    {
      key: "issue",
      icon: "ERR",
      label: "오류/Quota",
      count: issueCount,
      detail: topIssue ? topIssue.detail : "권한, 인증, Quota 오류 신호 없음",
      tone: issueCount ? (topIssue?.tone === "danger" ? "danger" : "warn") : "ready",
      actionLabel: issueCount ? "오류 보기" : "진단 보기",
      onClick: () => {
        focusProjectRequests("all", "issue", "");
        focusVmRecords("all", "issue", "오류/Quota 필터를 적용했습니다.");
      },
    },
    {
      key: "cleanup",
      icon: "CLR",
      label: "정리 가능 기록",
      count: cleanupProjectRecordCount + cleanupVmRecordCount,
      detail: cleanupWatchCount ? "실제 잔여 자원 확인 후 기록 정리" : "정리 대기 기록 없음",
      tone: cleanupWatchCount ? "warn" : "muted",
      actionLabel: cleanupWatchCount ? "정리 필터" : "정리 화면",
      onClick: () => {
        focusProjectRequests("all", "cleanup", "");
        focusVmRecords("all", "cleanup", "정리 가능 기록 필터를 적용했습니다.");
      },
    },
    {
      key: "access",
      icon: "USR",
      label: "사용자 권한",
      count: enabledSelfServiceUsers.length,
      detail: disabledSelfServiceUserCount ? `${disabledSelfServiceUserCount}명은 아직 사용 제한` : "모든 표시 사용자가 허용 상태",
      tone: enabledSelfServiceUsers.length ? "ready" : "warn",
      actionLabel: "사용자 필터",
      onClick: () => {
        setUserAccessFilter(disabledSelfServiceUserCount ? "disabled" : "enabled");
        setFilterShareStatus("사용자 권한 필터를 적용했습니다.");
      },
    },
  ];
  const executeProjectRequestReview = (request, action, options = {}) => {
    if (action === "approve") {
      const projectName = request.projectName || request.requestedProjectName || "";
      if (!projectName) return;
      props.onReviewSelfServiceProjectRequest?.(request.id, "approve", {
        projectName,
        reviewNote: options.skipAutoConfigure ? "관리자 수동 승인" : "관리자 승인",
        skipAutoConfigure: Boolean(options.skipAutoConfigure),
      });
      return;
    }
    props.onReviewSelfServiceProjectRequest?.(request.id, "reject", { reviewNote: "관리자 반려" });
  };
  const reviewProjectRequest = (request, action, options = {}) => {
    if (action !== "approve") {
      executeProjectRequestReview(request, action, options);
      return;
    }
    setPendingReviewAction({
      kind: "project",
      item: request,
      action,
      options,
      title: options.skipAutoConfigure ? "전용 프로젝트 수동 승인 확인" : "전용 프로젝트 자동 승인 확인",
      description: options.skipAutoConfigure
        ? "OpenStack 프로젝트가 이미 준비되었는지 확인한 뒤 수동 승인하세요."
        : "승인 시 자동 구성 흐름이 실행될 수 있습니다. 비용, Quota, 네트워크 요청을 다시 확인하세요.",
      confirmLabel: options.skipAutoConfigure ? "수동 승인" : autoConfigureProjects ? "자동 승인" : "승인",
    });
  };
  const executeVmReview = (vm, action, reviewNote = "") => {
    props.onReviewSelfServiceVm?.(vm.id, action, reviewNote);
  };
  const reviewVmRequest = (vm, action, reviewNote = "") => {
    if (action !== "approve") {
      executeVmReview(vm, action, reviewNote);
      return;
    }
    setPendingReviewAction({
      kind: "vm",
      item: vm,
      action,
      reviewNote,
      title: vm.status === "failed" ? "연구실/랩 VM 재시도 확인" : "연구실/랩 VM 승인 확인",
      description: vm.status === "failed"
        ? "실패한 요청을 다시 생성하기 전, 비용과 Quota 영향 및 기존 잔여 자원을 확인하세요."
        : "승인 후 HeatStack 생성 흐름이 시작될 수 있습니다. 비용과 Quota 영향을 다시 확인하세요.",
      confirmLabel: vm.status === "failed" ? "재시도" : "승인",
    });
  };
  const confirmPendingReviewAction = () => {
    const action = pendingReviewAction;
    if (!action) return;
    setPendingReviewAction(null);
    if (action.kind === "project") {
      executeProjectRequestReview(action.item, action.action, action.options);
      return;
    }
    executeVmReview(action.item, action.action, action.reviewNote);
  };
  return (
    <section className="portal-stack">
      <div className="admin-simple-card">
        <div className="admin-card-header">
          <div>
            <strong>클라우드 콘솔 운영 현황</strong>
            <div className="hint">사용자 화면의 무료 클라우드 콘솔과 연결되는 사용자화 VM 운영 영역입니다.</div>
          </div>
          <div className="admin-inline-actions">
            <button className="mini-btn" onClick={copySelfServiceFilterLink} type="button">현재 필터 링크 복사</button>
            <button className="mini-btn" onClick={resetSelfServiceFilters} type="button">필터 초기화</button>
          </div>
        </div>
        {filterShareStatus ? <div className="inline-message is-info">{filterShareStatus}</div> : null}
        <div className="admin-extension-summary-grid">
          <div>
            <span>무료 랩 권한</span>
            <strong>{enabledSelfServiceUsers.length}명</strong>
            <small>허용된 사용자만 신청 가능</small>
          </div>
          <div>
            <span>전용 프로젝트 요청</span>
            <strong>{pendingProjectRequests.length}건</strong>
            <small>{autoConfigureProjects ? "자동 구성 사용" : "수동 준비 후 승인"}</small>
          </div>
          <div>
            <span>클라우드 콘솔</span>
            <strong>{activeVmCount}건</strong>
            <small>대기/생성/실행 중 요청</small>
          </div>
          <div>
            <span>정리 확인</span>
            <strong>{cleanupWatchCount}건</strong>
            <small>실패/종료 후 잔여 자원 점검 대상</small>
          </div>
        </div>
        <div className="self-service-admin-priority-panel" aria-label="클라우드 콘솔 오늘 처리 우선순위">
          <div className="self-service-admin-priority-head">
            <div>
              <span className="eyebrow">Today Queue</span>
              <strong>오늘 먼저 볼 작업</strong>
              <p className="hint">터미널 클라우드와 클라우드 콘솔에서 관리자가 바로 처리해야 할 흐름만 모았습니다.</p>
            </div>
            <button className="mini-btn" onClick={() => props.onOpenAdminTab?.("messages")} type="button">정리 문의함</button>
          </div>
          <div className="self-service-admin-priority-grid">
            {adminPriorityActions.map((item) => (
              <button className={`self-service-admin-priority-card is-${item.tone}`} key={item.key} onClick={item.onClick} type="button">
                <span className="self-service-admin-priority-icon" aria-hidden="true">{item.icon}</span>
                <span>
                  <small>{item.label}</small>
                  <strong>{item.count}건</strong>
                  <em>{item.detail}</em>
                </span>
                <b>{item.actionLabel}</b>
              </button>
            ))}
          </div>
          <div className="self-service-admin-flow" aria-label="클라우드 콘솔 처리 흐름">
            <span className={enabledSelfServiceUsers.length ? "is-ready" : "is-warn"}>1. 권한 {enabledSelfServiceUsers.length}명</span>
            <span className={pendingProjectRequests.length ? "is-warn" : "is-ready"}>2. 프로젝트 검토 {pendingProjectRequests.length}건</span>
            <span className={activeVmCount ? "is-warn" : "is-ready"}>3. 생성/실행 {activeVmCount}건</span>
            <span className={cleanupWatchCount ? "is-warn" : "is-ready"}>4. 잔여 정리 {cleanupWatchCount}건</span>
          </div>
        </div>
        <div className={`self-service-filter-status-panel ${hasActiveSelfServiceFilters ? "is-active" : ""}`} aria-label="클라우드 콘솔 필터 상태">
          <div className="self-service-filter-status-head">
            <div>
              <span className="eyebrow">Active Filter</span>
              <strong>{hasActiveSelfServiceFilters ? "필터가 적용되어 있습니다" : "전체 운영 목록을 보고 있습니다"}</strong>
              <p className="hint">{selfServiceFilterGuide}</p>
            </div>
            <div className="admin-inline-actions">
              <button className="mini-btn" onClick={copySelfServiceFilterLink} type="button">필터 링크 복사</button>
              <button className="mini-btn" onClick={resetSelfServiceFilters} type="button">전체 보기</button>
            </div>
          </div>
          <div className="self-service-filter-status-grid">
            {selfServiceFilterStatusCards.map((item) => (
              <a className={`self-service-filter-status-card is-${item.tone}`} href={item.href} key={item.key}>
                <span>{item.title}</span>
                <strong>{item.status}</strong>
                <small>{item.detail}</small>
                <b>{item.actionLabel}</b>
              </a>
            ))}
          </div>
        </div>
        <div className="simple-status-list">
          <div>{`허용 Flavor: ${(props.platformStatus?.selfServiceVmAllowedFlavors || []).join(", ") || "-"}`}</div>
          <div>{`허용 이미지: ${(props.platformStatus?.selfServiceVmAllowedImages || []).join(", ") || "-"}`}</div>
          <div>{`허용 프로젝트: ${(props.platformStatus?.selfServiceVmAllowedProjects || [props.platformStatus?.serviceProjectName || "service"]).join(", ")}`}</div>
          <div>{`생성 방식: ${props.platformStatus?.selfServiceVmAutoProvisionEnabled === false ? "관리자 승인 후 실행" : "즉시 실행"}`}</div>
          <div>{`고급 옵션: 데이터 볼륨 ${props.platformStatus?.selfServiceVmDataVolumeEnabled ? "허용" : "미허용"} / Floating IP ${props.platformStatus?.selfServiceVmFloatingIpEnabled ? "허용" : "미허용"}`}</div>
          <div>{`전용 프로젝트 자동 구성: ${props.platformStatus?.selfServiceVmProjectAutoConfigureEnabled ? "사용" : "미사용"}`}</div>
          <div>사용 가능 여부: 사용자 관리 또는 이 화면의 계정별 클라우드 콘솔 토글로 제어</div>
          <div className="hint">미허용 사용자의 권한 요청은 쪽지 관리로 전달됩니다. 별도 OpenStack 프로젝트 생성 요청은 비용/Quota/네트워크 정책 확인 후 처리하는 것을 권장합니다.</div>
          <div className="hint">
            {(props.platformStatus?.selfServiceVmAllowedFlavors || []).map((flavor) => (
              <span className="flavor-inline-row" key={flavor}>
                <span>{flavor}</span>
                <FlavorBadges flavor={flavor} />
              </span>
            ))}
          </div>
          <div>{`총 요청 수: ${vms.length}`}</div>
          <div>{`실행 중: ${vms.filter((item) => item.status === "running").length}`}</div>
        </div>
        <div className="self-service-diagnostic-grid" aria-label="클라우드 콘솔 운영 진단">
          {cloudDiagnostics.map((item) => (
            <article
              className={`self-service-diagnostic-card is-${item.tone} ${item.targetTab ? "is-clickable" : ""}`}
              key={item.title}
              onClick={() => openDiagnosticTarget(item)}
              onKeyDown={(event) => {
                if (!item.targetTab || !["Enter", " "].includes(event.key)) return;
                event.preventDefault();
                openDiagnosticTarget(item);
              }}
              role={item.targetTab ? "button" : undefined}
              tabIndex={item.targetTab ? 0 : undefined}
            >
              <div>
                <span>{item.title}</span>
                <strong>{item.summary}</strong>
              </div>
              <p>{item.detail}</p>
              <footer className="self-service-diagnostic-footer">
                <small>{item.action}</small>
                {item.targetTab ? (
                  <button className="mini-btn" onClick={(event) => { event.stopPropagation(); openDiagnosticTarget(item); }} type="button">
                    {item.actionLabel || "열기"}
                  </button>
                ) : null}
              </footer>
            </article>
          ))}
        </div>
      </div>
      <div className="admin-simple-card" id="self-service-user-access">
        <div className="admin-card-header">
          <div>
            <strong>사용 가능 사용자</strong>
            <div className="hint">사용자 메뉴와 동일하게 계정별 무료 클라우드 콘솔 가능 여부를 관리합니다.</div>
          </div>
          <div className="admin-inline-actions">
            <button className="mini-btn approve-btn" disabled={!selectedSelfServiceUserIds.length} onClick={() => props.onBulkSetSelfServiceVmAccess?.(selectedSelfServiceUserIds, true)} type="button">
              선택 사용 허용
            </button>
            <button className="mini-btn reject-btn" disabled={!selectedSelfServiceUserIds.length} onClick={() => props.onBulkSetSelfServiceVmAccess?.(selectedSelfServiceUserIds, false)} type="button">
              선택 사용 제한
            </button>
          </div>
        </div>
        <div className="self-service-admin-toolbar">
          <input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="이름, 아이디, 이메일로 사용자 검색" />
          <select value={userAccessFilter} onChange={(event) => setUserAccessFilter(event.target.value)}>
            <option value="all">전체 사용자</option>
            <option value="enabled">사용 가능</option>
            <option value="disabled">사용 제한</option>
          </select>
          <button
            className="mini-btn"
            disabled={!filteredUserIds.length}
            onClick={() => setVisibleSelection(setSelectedSelfServiceUserIds, filteredUserIds, selectedVisibleUserIds.length !== filteredUserIds.length)}
            type="button"
          >
            {filteredUserIds.length && selectedVisibleUserIds.length === filteredUserIds.length ? "검색 결과 선택 해제" : "검색 결과 전체 선택"}
          </button>
          <span className="hint">{`표시 ${filteredUsers.length}명 / 선택 ${selectedSelfServiceUserIds.length}명`}</span>
        </div>
        <div className="admin-table admin-table-scroll">
          <div className="admin-table-head admin-course-grid">
            <span>사용자</span>
            <span>상태</span>
            <span>작업</span>
          </div>
          {filteredUsers.length ? filteredUsers.map((user) => (
            <div className="admin-table-row admin-course-grid" key={`self-service-user-${user.id}`}>
              <span>
                <label className="self-service-select-line">
                  <input
                    checked={selectedSelfServiceUserIds.includes(Number(user.id))}
                    onChange={(event) => toggleSelectedId(setSelectedSelfServiceUserIds, user.id, event.target.checked)}
                    type="checkbox"
                  />
                  <strong>{user.name || user.username}</strong>
                </label>
                <div className="hint">{user.username}</div>
                {user.email ? <div className="hint">{user.email}</div> : null}
              </span>
              <span>
                <div>{user.selfServiceVmEnabled ? "사용 가능" : "사용 제한"}</div>
                <div className="hint">{user.status === "approved" ? "승인 계정" : "미승인 계정"}</div>
              </span>
              <div className="admin-inline-actions">
                <button
                  className={`mini-btn ${user.selfServiceVmEnabled ? "reject-btn" : "approve-btn"}`}
                  onClick={() => props.onUserPatch?.(user.id, user.role, user.status, { selfServiceVmEnabled: !user.selfServiceVmEnabled })}
                  type="button"
                >
                  {user.selfServiceVmEnabled ? "사용 제한" : "사용 허용"}
                </button>
              </div>
            </div>
          )) : <div className="hint">조건에 맞는 사용자가 없습니다.</div>}
        </div>
      </div>
      <div className="admin-simple-card" id="self-service-project-requests">
        <div className="admin-card-header">
          <div>
            <strong>전용 OpenStack 프로젝트/네트워크 요청</strong>
            <div className="hint">프로젝트 생성 요청과 승인된 프로젝트의 네트워크 추가 요청을 함께 관리합니다. 자동 구성이 켜져 있으면 승인 시 필요한 OpenStack 구성 작업을 실행합니다.</div>
          </div>
          <div className="admin-inline-actions">
            <select value={projectRequestFilter} onChange={(event) => setProjectRequestFilter(event.target.value)}>
              <option value="all">전체</option>
              <option value="requested">검토 중</option>
              <option value="approved">승인됨</option>
              <option value="rejected">반려됨</option>
            </select>
            <button
              className="mini-btn"
              disabled={!removableProjectRequestIds.length}
              onClick={() => setVisibleSelection(setSelectedProjectRequestIds, removableProjectRequestIds, !removableProjectRequestIds.every((id) => selectedProjectRequestIds.includes(id)))}
              type="button"
            >
              제거 가능 선택
            </button>
            <button
              className="mini-btn danger-mini-btn"
              disabled={!selectedRemovableProjectRequestIds.length}
              onClick={() => props.onDeleteSelfServiceProjectRecords?.(selectedRemovableProjectRequestIds)}
              type="button"
            >
              선택 기록 제거
            </button>
          </div>
        </div>
        <div className="self-service-ops-filter-row" aria-label="전용 프로젝트 운영 필터">
          {projectOpsFilterOptions.map((option) => (
            <button
              className={`mini-btn ${projectOpsFilter === option.key ? "is-active" : ""}`}
              key={`project-filter-${option.key}`}
              onClick={() => setProjectOpsFilter(option.key)}
              type="button"
            >
              <span>{option.label}</span>
              <strong>{option.count}</strong>
            </button>
          ))}
          <span className="hint">{`표시 ${filteredProjectRequests.length}건 · 정리 가능 ${removableProjectRequestIds.length}건 · 링크 공유 가능`}</span>
        </div>
        {blockedProjectRecordCount ? (
          <div className="inline-message is-info">
            {`진행 중인 연구실/랩 VM이 있는 승인 프로젝트 ${blockedProjectRecordCount}건은 VM 종료 후 기록을 제거할 수 있습니다.`}
          </div>
        ) : null}
        {filteredProjectRequests.length ? (
          <div className="admin-table admin-table-scroll">
            <div className="admin-table-head admin-course-grid">
              <span>사용자 / 프로젝트</span>
              <span>상태</span>
              <span>작업</span>
            </div>
            {filteredProjectRequests.map((request) => {
              const isBlockedByActiveVm = isProjectRequestBlockedByActiveVm(request);
              const canRemoveRequest = canDeleteProjectRequestRecord(request);
              const stageChips = getSelfServiceStageChips(request, "project");
              const requestKindLabel = getAdminSelfServiceProjectRequestKindLabel(request);
              const isNetworkOnlyRequest = isAdminSelfServiceNetworkOnlyRequest(request);
              return (
              <div className="admin-table-row admin-course-grid" key={request.id}>
                <span>
                  <label className="self-service-select-line">
                    <input
                      checked={canRemoveRequest && selectedProjectRequestIds.includes(Number(request.id))}
                      disabled={!canRemoveRequest}
                      onChange={(event) => toggleSelectedId(setSelectedProjectRequestIds, request.id, event.target.checked)}
                      type="checkbox"
                    />
                    <strong>{request.projectName || request.requestedProjectName}</strong>
                  </label>
                  <div className="self-service-checkpoints" aria-label="전용 프로젝트 요청 유형">
                    <span className={isNetworkOnlyRequest ? "is-network" : "is-info"}>{requestKindLabel}</span>
                  </div>
                  <div className="hint">{`${request.userName || request.username} (${request.username})`}</div>
                  {request.requestedQuota ? <div className="hint">{`쿼터 ${request.quotaProfileId || "basic"} · VM ${request.requestedQuota.instances || 0} · vCPU ${request.requestedQuota.cores || 0} · RAM ${Math.round(Number(request.requestedQuota.ram || 0) / 1024)}GB · Disk ${request.requestedQuota.gigabytes || 0}GB`}</div> : null}
                  <div className="hint">{`접수: ${formatDateTime(request.createdAt)}${request.reviewedAt ? ` / 검토: ${formatDateTime(request.reviewedAt)}` : ""}`}</div>
                  {stageChips.length ? (
                    <div className="self-service-checkpoints" aria-label={`${requestKindLabel} 단계`}>
                      {stageChips.map((chip) => (
                        <span className={`is-${chip.tone || "info"}`} key={`${request.id}-${chip.key}`}>{chip.label}</span>
                      ))}
                    </div>
                  ) : null}
                  {Array.isArray(request.networkRequests) && request.networkRequests.length ? (
                    <details className="self-service-compact-log">
                      <summary>
                        <span>{`전용 네트워크 ${request.networkRequests.length}개`}</span>
                        <small>{request.networkRequests[0]?.networkName || "네트워크 요청"}</small>
                      </summary>
                      <pre>{request.networkRequests.map((network, index) => [
                        `${index + 1}. ${network.networkName || "-"} / ${network.subnetCidr || "-"}`,
                        `Router: ${network.routerEnabled === false ? "미요청" : "요청"}`,
                        `VLAN: ${network.vlanMode === "vlan" ? network.vlanId || "자동 할당" : "미사용"}`,
                        `Port: ${network.manualPortEnabled || network.trunkEnabled ? network.portName || "자동 이름" : "자동 생성"}`,
                        `Trunk: ${network.trunkEnabled ? "요청" : "미요청"}`,
                        network.qosPolicyName ? `QoS: ${network.qosPolicyName}` : "",
                        network.firewallGroupName ? `방화벽 그룹: ${network.firewallGroupName}` : "",
                      ].filter(Boolean).join("\n")).join("\n\n")}</pre>
                    </details>
                  ) : request.networkName ? <div className="hint">{`전용 네트워크: ${request.networkName}${request.subnetCidr ? ` / ${request.subnetCidr}` : ""}`}</div> : <div className="hint">네트워크: net-infra 기본 사용</div>}
                  {renderCompactHistory("요청 메모", request.note)}
                </span>
                <span>
                  <div>{projectStatusText(request.status)}</div>
                  {renderOperationAdvice(request, "project")}
                  <AdminProjectRequestImpact request={request} platformStatus={props.platformStatus} />
                  {renderCompactHistory("처리 기록", request.reviewNote)}
                  {request.status === "approved" ? <div className="hint">제거하면 사용자 프로젝트 선택 목록에서 숨겨집니다.</div> : null}
                  {isBlockedByActiveVm ? <div className="hint">진행 중인 VM이 있어 기록 제거가 보호됩니다.</div> : null}
                  {request.status === "requested" ? <div className="hint">검토 중 요청은 승인 또는 반려 후 제거할 수 있습니다.</div> : null}
                </span>
                <div className="admin-inline-actions">
                  {request.status === "requested" ? (
                    <>
                      <button
                        className="mini-btn approve-btn"
                        disabled={busyProjectRequestIds.has(Number(request.id))}
                        onClick={() => reviewProjectRequest(request, "approve")}
                        type="button"
                      >
                        {busyProjectRequestIds.has(Number(request.id)) ? "승인 중" : autoConfigureProjects ? "자동 승인" : "승인"}
                      </button>
                      {autoConfigureProjects ? (
                        <button
                          className="mini-btn"
                          disabled={busyProjectRequestIds.has(Number(request.id))}
                          onClick={() => reviewProjectRequest(request, "approve", { skipAutoConfigure: true })}
                          type="button"
                        >
                          수동 승인
                        </button>
                      ) : null}
                      <button
                        className="mini-btn reject-btn"
                        disabled={busyProjectRequestIds.has(Number(request.id))}
                        onClick={() => reviewProjectRequest(request, "reject")}
                        type="button"
                      >
                        반려
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
            })}
          </div>
        ) : <div className="hint">조건에 맞는 전용 프로젝트 요청이 없습니다.</div>}
      </div>
      <div className="admin-simple-card" id="self-service-vm-records">
        <div className="admin-card-header">
          <div>
            <strong>클라우드 콘솔 기록</strong>
            <div className="hint">실패/종료 기록은 선택 후 제거할 수 있고, 진행 중인 자원 기록은 보호됩니다.</div>
          </div>
          <div className="admin-inline-actions">
            <select value={vmRecordFilter} onChange={(event) => setVmRecordFilter(event.target.value)}>
              <option value="all">전체</option>
              <option value="requested">승인 대기</option>
              <option value="approved">승인됨</option>
              <option value="provisioning">생성 중</option>
              <option value="running">실행 중</option>
              <option value="failed">실패</option>
              <option value="terminated">종료됨</option>
            </select>
            <button
              className="mini-btn"
              disabled={!deletableVmRecordIds.length}
              onClick={() => setVisibleSelection(setSelectedVmRecordIds, deletableVmRecordIds, !deletableVmRecordIds.every((id) => selectedVmRecordIds.includes(id)))}
              type="button"
            >
              삭제 가능 선택
            </button>
            <button
              className="mini-btn danger-mini-btn"
              disabled={!selectedVmRecordIds.length}
              onClick={() => props.onDeleteSelfServiceVmRecords?.(selectedVmRecordIds)}
              type="button"
            >
              선택 기록 제거
            </button>
          </div>
        </div>
        <div className="self-service-ops-filter-row" aria-label="클라우드 콘솔 기록 운영 필터">
          {vmOpsFilterOptions.map((option) => (
            <button
              className={`mini-btn ${vmOpsFilter === option.key ? "is-active" : ""}`}
              key={`vm-filter-${option.key}`}
              onClick={() => setVmOpsFilter(option.key)}
              type="button"
            >
              <span>{option.label}</span>
              <strong>{option.count}</strong>
            </button>
          ))}
          <span className="hint">{`표시 ${filteredVms.length}건 · 링크 공유 가능`}</span>
        </div>
        <div className="admin-table admin-table-scroll">
          <div className="admin-table-head admin-course-grid">
            <span>사용자 / VM</span>
            <span>상태</span>
            <span>작업</span>
          </div>
          {filteredVms.length ? filteredVms.map((vm) => {
            const canDeleteVmRecord = ["failed", "terminated"].includes(vm.status);
            const stageChips = getSelfServiceStageChips(vm, "vm");
            return (
            <div className="admin-table-row admin-course-grid" key={vm.id}>
              <span>
                <label className="self-service-select-line">
                  <input
                    checked={selectedVmRecordIds.includes(Number(vm.id))}
                    disabled={!canDeleteVmRecord}
                    onChange={(event) => toggleSelectedId(setSelectedVmRecordIds, vm.id, event.target.checked)}
                    type="checkbox"
                  />
                  <strong>{vm.stackName || `self-vm-${vm.id}`}</strong>
                </label>
                <div className="hint">{`${vm.userName || vm.username} (${vm.username})`}</div>
                <div className="hint">{`접수: ${formatDateTime(vm.createdAt)}${vm.updatedAt ? ` / 갱신: ${formatDateTime(vm.updatedAt)}` : ""}`}</div>
                {stageChips.length ? (
                  <div className="self-service-checkpoints" aria-label="클라우드 콘솔 단계">
                    {stageChips.map((chip) => (
                      <span className={`is-${chip.tone || "info"}`} key={`${vm.id}-${chip.key}`}>{chip.label}</span>
                    ))}
                  </div>
                ) : null}
                <div className="hint">{`프로젝트: ${vm.projectName || props.platformStatus?.serviceProjectName || "service"}`}</div>
                <div className="hint">{`네트워크: ${vm.networkName || "net-infra"}`}</div>
                <div className="hint">{`Flavor: ${vm.flavor}`}</div>
                <FlavorBadges flavor={vm.flavor} />
                <div className="hint">{`개수: ${vm.instanceCount || 1}대`}</div>
                <div className="hint">{`Boot: ${vm.bootFromVolume ? `Cinder volume ${vm.bootVolumeSizeGb || 20}GB` : "image/ephemeral"}`}</div>
                <div className="hint">{`cloud-init: ${vm.cloudInitTemplateName || "-"}`}</div>
                <div className="hint">{`IP: ${vm.instanceIp || "-"}`}</div>
                {vm.externalSshEnabled ? (
                  <div className="hint">{`외부 SSH: ${(Array.isArray(vm.vmNodes) ? vm.vmNodes : []).filter((node) => node.externalSshPort).map((node) => `${node.name || node.id || "VM"}:${node.externalSshPort}`).join(", ") || vm.externalSshPort || "-"}`}</div>
                ) : vm.externalSshRequestPending ? (
                  <div className="hint">외부 SSH 승인 대기</div>
                ) : null}
              </span>
              <span>
                <div>{vmStatusText(vm.status)}</div>
                {renderOperationAdvice(vm, "vm")}
                <AdminVmRequestImpact vm={vm} platformStatus={props.platformStatus} />
                {renderCompactHistory("오류", vm.errorMessage)}
                {renderCompactHistory("진행 기록", vm.reviewNote)}
                {!canDeleteVmRecord ? <div className="hint">진행 중인 자원 기록은 보호됩니다.</div> : null}
              </span>
              <div className="admin-inline-actions">
                {vm.status === "requested" ? (
                  <>
                    <button className="mini-btn approve-btn" onClick={() => reviewVmRequest(vm, "approve", vm.reviewNote || "")} type="button">승인</button>
                    <button className="mini-btn reject-btn" onClick={() => reviewVmRequest(vm, "reject", "관리자 반려")} type="button">반려</button>
                  </>
                ) : null}
                {vm.status === "failed" ? (
                  <button className="mini-btn approve-btn" onClick={() => reviewVmRequest(vm, "approve", "관리자 재시도")} type="button">재시도</button>
                ) : null}
                {vm.externalSshRequestPending ? (
                  <>
                    <button className="mini-btn approve-btn" onClick={() => props.onApproveSelfServiceVmExternalSsh?.(vm.id, "관리자 승인")} type="button">SSH 승인</button>
                    <button className="mini-btn reject-btn" onClick={() => props.onRejectSelfServiceVmExternalSsh?.(vm.id, "관리자 반려")} type="button">SSH 반려</button>
                  </>
                ) : null}
                {vm.externalSshEnabled ? (
                  <button className="mini-btn" onClick={() => props.onReleaseSelfServiceVmExternalSsh?.(vm.id)} type="button">SSH 해제</button>
                ) : null}
                {["provisioning", "running"].includes(vm.status) ? (
                  <button className="mini-btn danger-mini-btn" onClick={() => props.onTerminateSelfServiceVm(vm.id)} type="button">가상머신 삭제</button>
                ) : null}
              </div>
            </div>
          );
          }) : <div className="hint">조건에 맞는 클라우드 콘솔 기록이 없습니다.</div>}
        </div>
      </div>
      <AdminSelfServiceReviewModal
        onCancel={() => setPendingReviewAction(null)}
        onConfirm={confirmPendingReviewAction}
        pendingAction={pendingReviewAction}
        platformStatus={props.platformStatus}
      />
    </section>
  );
}

export function AdminMailingTab(props) {
  const recipientMode = String(props.adminMailForm?.recipientMode || "manual").trim() || "manual";
  const allUsers = Array.isArray(props.adminUsers) ? props.adminUsers : [];
  const mailTargetCounts = {
    "@ALL": allUsers.filter((user) => String(user.email || "").trim()).length,
    "@APPROVED": allUsers.filter((user) => user.status === "approved" && String(user.email || "").trim()).length,
    "@STUDENTS": allUsers.filter((user) => user.role !== "admin" && String(user.email || "").trim()).length,
    "@ADMINS": allUsers.filter((user) => user.role === "admin" && String(user.email || "").trim()).length,
  };
  const recipientModeHint = {
    manual: "쉼표, 세미콜론, 줄바꿈으로 여러 이메일이나 아이디를 직접 입력합니다.",
    "@ALL": `이메일이 있는 전체 사용자 ${mailTargetCounts["@ALL"]}명에게 발송합니다.`,
    "@APPROVED": `승인된 사용자 중 이메일이 있는 ${mailTargetCounts["@APPROVED"]}명에게 발송합니다.`,
    "@STUDENTS": `일반 사용자 중 이메일이 있는 ${mailTargetCounts["@STUDENTS"]}명에게 발송합니다.`,
    "@ADMINS": `관리자 중 이메일이 있는 ${mailTargetCounts["@ADMINS"]}명에게 발송합니다.`,
    "@ACTIVE": "최근 접속한 사용자 중 이메일이 있는 계정에게 발송합니다.",
  }[recipientMode];
  const campaignForm = props.mailCampaignForm || {};
  const campaignPreview = props.mailCampaignPreview || null;
  const campaigns = Array.isArray(props.adminMailCampaigns) ? props.adminMailCampaigns : [];
  const selectedCampaign = props.selectedMailCampaign || null;
  const campaignModes = Array.isArray(campaignForm.recipientModes) ? campaignForm.recipientModes : [];

  useEffect(() => {
    props.loadAdminMailCampaigns?.();
  }, []);

  function toggleCampaignMode(mode) {
    props.setMailCampaignForm((current) => {
      const modes = Array.isArray(current.recipientModes) ? current.recipientModes : [];
      return {
        ...current,
        recipientModes: modes.includes(mode) ? modes.filter((item) => item !== mode) : [...modes, mode],
      };
    });
  }

  async function onCampaignCsvSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      props.setMailCampaignForm((current) => ({ ...current, csvText: "", sourceFileName: "" }));
      event.target.value = "";
      return;
    }
    const csvText = await file.text();
    props.setMailCampaignForm((current) => ({ ...current, csvText, sourceFileName: file.name }));
  }

  const campaignStatusLabel = (status) => ({
    pending: "대기",
    sending: "발송 중",
    completed: "완료",
    accepted: "SMTP 접수",
    failed: "실패",
    bounced: "반송",
    replied: "회신",
    no_reply: "미회신",
    queued: "대기",
  }[status] || status || "-");

  return (
    <div className="stack">
      <div className="admin-summary-grid">
        <div className="admin-summary-card">
          <span className="card-label">메일 설정</span>
          <strong>{props.platformStatus?.mailEnabled ? "활성" : "비활성"}</strong>
          <div className="hint">{props.platformStatus?.mailProvider || "미설정"}</div>
        </div>
        <div className="admin-summary-card">
          <span className="card-label">전체 사용자</span>
          <strong>{mailTargetCounts["@ALL"]}명</strong>
          <div className="hint">이메일 등록 기준</div>
        </div>
        <div className="admin-summary-card">
          <span className="card-label">승인 사용자</span>
          <strong>{mailTargetCounts["@APPROVED"]}명</strong>
          <div className="hint">승인 + 이메일 등록 기준</div>
        </div>
      </div>

      <div className="simple-panel">
        <div className="admin-card-header">
          <div>
            <span className="card-label">CSV + 회원 통합 발송</span>
            <strong>수신자별 개별 메일 캠페인</strong>
            <div className="hint">외부 CSV와 회원 그룹을 합친 뒤 중복을 제거하고 한 명씩 개별 발송합니다.</div>
            <div className="hint">SMTP 즉시 거부는 자동 반영됩니다. 지연 반송·회신 자동 수집은 Gmail API 수신 연동 전까지 아래 상세 화면에서 수동 반영합니다.</div>
          </div>
          <button className="ghost-btn refresh-btn" onClick={() => props.loadAdminMailCampaigns?.()} type="button">상태 새로고침</button>
        </div>

        <form className="settings-panel admin-form" onSubmit={props.onCreateMailCampaign}>
          <div className="admin-form-grid compact-admin-grid admin-mail-form-grid">
            <AdminField label="캠페인 이름" hint="발송 이력에서 구분할 내부 이름입니다.">
              <input value={campaignForm.name || ""} onChange={(event) => props.setMailCampaignForm((current) => ({ ...current, name: event.target.value }))} placeholder="예: 8월 교육 안내" />
            </AdminField>
            <AdminField label="메일 유형">
              <select value={campaignForm.purpose || "operational"} onChange={(event) => props.setMailCampaignForm((current) => ({ ...current, purpose: event.target.value, externalConsentConfirmed: false }))}>
                <option value="operational">운영·안내 메일</option>
                <option value="marketing">마케팅 메일</option>
              </select>
            </AdminField>
            <AdminField label="외부 CSV" hint="company_name,email 또는 회사명,이메일 열을 지원합니다. 최대 2MB, 기본 1,500명입니다.">
              <input accept=".csv,text/csv" onChange={onCampaignCsvSelected} type="file" />
              <div className="hint">{campaignForm.sourceFileName ? `${campaignForm.sourceFileName} 선택됨` : "선택된 CSV 없음"}</div>
            </AdminField>
            <AdminField label="회원 그룹" hint="여러 그룹을 함께 선택할 수 있으며 이메일 중복은 자동 제거합니다.">
              <div className="stack compact-stack">
                {[
                  ["@ALL", "전체 회원"],
                  ["@APPROVED", "승인 회원"],
                  ["@STUDENTS", "일반 회원"],
                  ["@ADMINS", "관리자"],
                  ["@ACTIVE", "최근 접속 회원"],
                ].map(([mode, label]) => (
                  <label className="admin-checkbox-line" key={mode}>
                    <input checked={campaignModes.includes(mode)} onChange={() => toggleCampaignMode(mode)} type="checkbox" />
                    <span>{label} <code>{mode}</code></span>
                  </label>
                ))}
              </div>
            </AdminField>
            <AdminField label="추가 수신자" hint="이메일 또는 회원 아이디를 쉼표·세미콜론·줄바꿈으로 입력합니다.">
              <textarea value={campaignForm.manualRecipients || ""} onChange={(event) => props.setMailCampaignForm((current) => ({ ...current, manualRecipients: event.target.value }))} placeholder="recipient@example.com" />
            </AdminField>
            <AdminField label="회신 기한" hint="기한까지 회신 상태가 등록되지 않으면 미회신으로 표시합니다. 0은 사용 안 함입니다.">
              <input min="0" max="90" type="number" value={campaignForm.replyDeadlineDays ?? "7"} onChange={(event) => props.setMailCampaignForm((current) => ({ ...current, replyDeadlineDays: event.target.value }))} />
            </AdminField>
            <AdminField label="제목">
              <input value={campaignForm.subject || ""} onChange={(event) => props.setMailCampaignForm((current) => ({ ...current, subject: event.target.value }))} placeholder="메일 제목" />
            </AdminField>
            <AdminField label="내용">
              <textarea className="admin-mail-body" value={campaignForm.text || ""} onChange={(event) => props.setMailCampaignForm((current) => ({ ...current, text: event.target.value }))} placeholder="보낼 메일 내용을 입력해 주세요." />
            </AdminField>
          </div>
          {campaignForm.purpose === "marketing" && campaignForm.csvText ? (
            <label className="admin-checkbox-line">
              <input checked={campaignForm.externalConsentConfirmed === true} onChange={(event) => props.setMailCampaignForm((current) => ({ ...current, externalConsentConfirmed: event.target.checked }))} type="checkbox" />
              <span>CSV의 외부 수신자가 광고성 이메일 수신에 명시적으로 동의했음을 확인했습니다.</span>
            </label>
          ) : null}
          {props.mailCampaignStatus?.message ? <div className={`inline-message ${props.mailCampaignStatus.tone === "error" ? "is-error" : ""}`}>{props.mailCampaignStatus.message}</div> : null}
          {campaignPreview ? (
            <div className="simple-status-list">
              <div><strong>최종 대상 {campaignPreview.totalCount || 0}명</strong></div>
              <div>{`CSV ${campaignPreview.csvRecipientCount || 0} · 회원 그룹 ${campaignPreview.memberRecipientCount || 0} · 직접 입력 ${campaignPreview.manualRecipientCount || 0}`}</div>
              <div>{`중복 제거 ${campaignPreview.duplicateCount || 0} · 잘못된 CSV 행 ${campaignPreview.invalidCount || 0}`}</div>
              {(campaignPreview.recipients || []).slice(0, 8).map((recipient) => <div key={recipient.email}>{`${recipient.companyName || recipient.recipientName || "-"} · ${recipient.email} · ${(recipient.sources || []).join(", ")}`}</div>)}
              {campaignPreview.truncated ? <div>미리보기는 최대 200명까지만 표시합니다.</div> : null}
            </div>
          ) : null}
          <div className="portal-actions">
            <button className="mini-btn" onClick={props.onPreviewMailCampaign} type="button">대상 미리보기</button>
            <button className="mini-btn primary-mini-btn" disabled={!campaignPreview?.totalCount} type="submit">개별 발송 시작</button>
          </div>
        </form>

        <div className="settings-panel">
          <div className="admin-card-header"><strong>캠페인 현황</strong><span className="hint">최근 {campaigns.length}건</span></div>
          {campaigns.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>생성</th><th>캠페인</th><th>상태</th><th>전체</th><th>접수</th><th>실패</th><th>반송</th><th>회신</th><th>미회신</th><th>상세</th></tr></thead>
                <tbody>{campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>{formatDateTime(campaign.createdAt)}</td>
                    <td><div>{campaign.name || campaign.subject}</div><div className="hint">{campaign.sourceFileName || (campaign.recipientModes || []).join(", ") || "직접 입력"}</div></td>
                    <td><span className={`status-badge ${campaign.status === "completed" ? "is-success" : "is-muted"}`}>{campaignStatusLabel(campaign.status)}</span></td>
                    <td>{campaign.totalCount || 0}</td><td>{campaign.acceptedCount || 0}</td><td>{campaign.failedCount || 0}</td><td>{campaign.bouncedCount || 0}</td><td>{campaign.repliedCount || 0}</td><td>{campaign.noReplyCount || 0}</td>
                    <td><button className="mini-btn" onClick={() => props.loadMailCampaignDetail?.(campaign.id)} type="button">보기</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <div className="empty-state">아직 CSV·회원 통합 캠페인이 없습니다.</div>}
        </div>

        {selectedCampaign ? (
          <div className="settings-panel">
            <div className="admin-card-header"><div><strong>{selectedCampaign.name || selectedCampaign.subject}</strong><div className="hint">수신자별 상태</div></div></div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>회사/이름</th><th>이메일</th><th>출처</th><th>상태</th><th>시각/오류</th><th>상태 반영</th></tr></thead>
                <tbody>{(selectedCampaign.deliveries || []).map((delivery) => (
                  <tr key={delivery.id}>
                    <td>{delivery.companyName || delivery.recipientName || "-"}</td>
                    <td>{delivery.email}</td>
                    <td>{(delivery.sources || [delivery.source]).join(", ")}</td>
                    <td><span className={`status-badge ${delivery.status === "accepted" || delivery.status === "replied" ? "is-success" : delivery.status === "failed" || delivery.status === "bounced" ? "is-danger" : "is-muted"}`}>{campaignStatusLabel(delivery.status)}</span></td>
                    <td><div>{delivery.acceptedAt ? formatDateTime(delivery.acceptedAt) : "-"}</div>{delivery.errorMessage ? <div className="hint">{delivery.errorMessage}</div> : null}</td>
                    <td><div className="portal-actions"><button className="mini-btn" onClick={() => props.onRecordMailCampaignEvent?.(selectedCampaign.id, delivery.email, "replied")} type="button">회신</button><button className="mini-btn danger-mini-btn" onClick={() => props.onRecordMailCampaignEvent?.(selectedCampaign.id, delivery.email, "bounced")} type="button">반송</button></div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      <div className="simple-panel">
        <div className="admin-card-header">
          <div>
            <strong>메일 운영</strong>
            <div className="hint">설정은 플랫폼 설정에서 유지하고, 실제 발송은 이 탭에서 운영합니다.</div>
          </div>
        </div>

        <div className="settings-panel">
          <div className="admin-card-header">
            <div>
              <div className="card-label">메일 테스트</div>
              <strong>현재 설정으로 테스트 메일 보내기</strong>
            </div>
          </div>
          <div className="admin-form-grid compact-admin-grid">
            <AdminField label="테스트 수신 주소" hint="비워두면 현재 관리자 계정 이메일로 발송을 시도합니다.">
              <input value={props.mailTestAddress || ""} onChange={(event) => props.setMailTestAddress(event.target.value)} placeholder="예: admin@example.com" />
            </AdminField>
          </div>
          <div className="hint">
            실제 발송 전에는 `연결 확인`으로 SMTP 서버 인증과 포트 접근만 먼저 확인할 수 있습니다.
          </div>
          <div className="portal-actions">
            <button className="mini-btn" onClick={props.onVerifyMailConnection} type="button">연결 확인</button>
            <button className="mini-btn test-btn" onClick={props.onTestMail} type="button">테스트 메일 발송</button>
          </div>
        </div>

        <form className="settings-panel admin-form" onSubmit={props.onSendAdminMail}>
          <div className="admin-card-header">
            <div>
              <div className="card-label">관리자 메일링</div>
              <strong>단일 그룹 또는 직접 입력 대상으로 공지 메일 보내기</strong>
            </div>
          </div>
          <div className="admin-form-grid compact-admin-grid">
            <AdminField label="수신 대상" hint="토큰 기반 그룹 발송 또는 직접 입력 중 하나를 선택합니다.">
              <select
                value={recipientMode}
                onChange={(event) => props.setAdminMailForm((current) => ({ ...current, recipientMode: event.target.value }))}
              >
                <option value="manual">직접 입력</option>
                <option value="@ALL">@ALL 전체 사용자</option>
                <option value="@APPROVED">@APPROVED 승인 사용자</option>
                <option value="@STUDENTS">@STUDENTS 일반 사용자</option>
                <option value="@ADMINS">@ADMINS 관리자</option>
                <option value="@ACTIVE">@ACTIVE 최근 접속 사용자</option>
              </select>
            </AdminField>
            <AdminField label="수신자" hint={recipientModeHint}>
              <textarea
                value={props.adminMailForm?.to || ""}
                disabled={recipientMode !== "manual"}
                onChange={(event) => props.setAdminMailForm((current) => ({ ...current, to: event.target.value }))}
                placeholder={recipientMode === "manual" ? "user1@example.com, user2 또는 @ALL" : recipientMode}
              />
            </AdminField>
            <AdminField label="제목">
              <input value={props.adminMailForm?.subject || ""} onChange={(event) => props.setAdminMailForm((current) => ({ ...current, subject: event.target.value }))} placeholder="메일 제목" />
            </AdminField>
            <AdminField label="내용">
              <textarea value={props.adminMailForm?.text || ""} onChange={(event) => props.setAdminMailForm((current) => ({ ...current, text: event.target.value }))} placeholder="보낼 메일 내용을 입력해 주세요." />
            </AdminField>
          </div>
          <div className="simple-status-list">
            <div>지원 토큰: <code>@ALL</code>, <code>@APPROVED</code>, <code>@STUDENTS</code>, <code>@ADMINS</code>, <code>@ACTIVE</code></div>
            <div>직접 입력 모드에서는 이메일 주소 또는 사용자 아이디를 쉼표/줄바꿈으로 함께 넣을 수 있습니다.</div>
          </div>
          <div className="portal-actions">
            <button className="mini-btn primary-mini-btn" type="submit">관리자 메일링 발송</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AdminMailLogsTab(props) {
  const [query, setQuery] = useState("");
  const queryInput = useImeBufferedInput(query, setQuery);
  const logs = Array.isArray(props.adminMailLogs) ? props.adminMailLogs : [];
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const filteredLogs = normalizedQuery
    ? logs.filter((log) => [
        log.mailType,
        log.provider,
        log.senderUsername,
        log.subject,
        log.status,
        log.errorMessage,
        log.metadata?.purpose,
        log.metadata?.consultingRequestId,
        log.metadata?.consultingRequestTitle,
        log.metadata?.templateKey,
        ...(Array.isArray(log.recipients) ? log.recipients : []),
      ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery)))
    : logs;
  return (
    <div className="stack">
      <div className="admin-summary-grid">
        <div className="admin-summary-card">
          <span className="card-label">총 이력</span>
          <strong>{filteredLogs.length}건</strong>
          <div className="hint">최근 메일 발송 기준</div>
        </div>
        <div className="admin-summary-card">
          <span className="card-label">성공</span>
          <strong>{filteredLogs.filter((item) => item.status === "sent").length}건</strong>
          <div className="hint">정상 발송</div>
        </div>
        <div className="admin-summary-card">
          <span className="card-label">실패/건너뜀</span>
          <strong>{filteredLogs.filter((item) => item.status !== "sent").length}건</strong>
          <div className="hint">failed / skipped</div>
        </div>
      </div>
      <div className="simple-panel">
        <div className="admin-card-header">
          <div>
            <strong>메일 발송 이력</strong>
            <div className="hint">회원, 초대장, 결제, 과정, 외부 SSH, 자격증, 시험 결과, 관리자 메일링 이력을 확인합니다.</div>
          </div>
          <div className="admin-history-search">
            <button className="ghost-btn refresh-btn" onClick={props.onRefreshAdminMailLogs} type="button">새로고침</button>
            <input
              {...queryInput}
              placeholder="유형, 제공자, 발신자, 제목, 상태, 오류 검색"
            />
            <span className="hint">{`전체 ${logs.length}건`}</span>
          </div>
        </div>
        {props.adminMailLogsStatus?.message ? <div className={`inline-message ${props.adminMailLogsStatus.tone === "error" ? "is-error" : ""}`}>{props.adminMailLogsStatus.message}</div> : null}
        {filteredLogs.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table admin-log-table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>유형</th>
                  <th>제공자</th>
                  <th>발신자</th>
                  <th>수신</th>
                  <th>제목</th>
                  <th>상태</th>
                  <th>오류</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.createdAt)}</td>
                    <td>{log.mailType || "-"}</td>
                    <td>{log.provider || "-"}</td>
                    <td>{log.senderUsername || "-"}</td>
                    <td>{log.recipientCount || 0}명</td>
                    <td>
                      <div>{log.subject || "-"}</div>
                      {log.metadata?.consultingRequestId ? (
                        <div className="hint">{`상담 #${log.metadata.consultingRequestId}${log.metadata?.consultingRequestTitle ? ` · ${log.metadata.consultingRequestTitle}` : ""}`}</div>
                      ) : null}
                    </td>
                    <td><span className={`status-badge ${log.status === "sent" ? "is-success" : log.status === "failed" ? "is-danger" : "is-muted"}`}>{log.status || "-"}</span></td>
                    <td>{log.errorMessage || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">{logs.length ? "검색 조건에 맞는 메일 발송 이력이 없습니다." : "아직 메일 발송 이력이 없습니다."}</div>
        )}
      </div>
    </div>
  );
}

export function AdminAccessLogsTab(props) {
  const [query, setQuery] = useState("");
  const queryInput = useImeBufferedInput(query, setQuery);
  const stats = props.adminAccessStats || {};
  const logs = (props.adminAccessLogs && props.adminAccessLogs.length ? props.adminAccessLogs : stats.recentLogs) || [];
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const filteredLogs = normalizedQuery
    ? logs.filter((log) => [
        log.userName,
        log.username,
        accessEventLabel(log.eventType),
        log.eventType,
        log.ipAddress,
        log.userAgent,
      ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery)))
    : logs;
  const loginCount = Number(stats.totalLoginEvents || 0);
  const currentConnectedUsers = Number(stats.currentConnectedUsers || 0);
  const todayUsers = Number(stats.todayUsers || 0);
  const monthUsers = Number(stats.monthUsers || 0);

  return (
    <section className="portal-stack">
      <div className="admin-summary-grid">
        <div className="admin-summary-card">
          <span className="card-label">현재 접속자</span>
          <strong>{currentConnectedUsers}명</strong>
          <div className="hint">{`${Number(stats.activeWithinMinutes || 2)}분 내 활동 기준`}</div>
        </div>
        <div className="admin-summary-card">
          <span className="card-label">오늘 접속 사용자</span>
          <strong>{todayUsers}명</strong>
          <div className="hint">오늘 한 번 이상 접속</div>
        </div>
        <div className="admin-summary-card">
          <span className="card-label">이번 달 접속 사용자</span>
          <strong>{monthUsers}명</strong>
          <div className="hint">월간 고유 접속자</div>
        </div>
        <div className="admin-summary-card">
          <span className="card-label">누적 로그인</span>
          <strong>{loginCount}건</strong>
          <div className="hint">전체 로그인 이벤트</div>
        </div>
      </div>
      <div className="simple-panel">
        <div className="admin-card-header">
          <div>
            <strong>사용자 접속 이력</strong>
            <div className="hint">최근 200건 기준으로 로그인, 로그아웃, 세션 활동 기록을 확인합니다.</div>
          </div>
          <div className="admin-history-search">
            <button className="ghost-btn refresh-btn" onClick={props.onRefreshAdminAccessLogs} type="button">새로고침</button>
            <input
              {...queryInput}
              placeholder="사용자, 이벤트, IP, User-Agent 검색"
            />
            <span className="hint">{`전체 ${logs.length}건`}</span>
          </div>
        </div>
        {props.adminAccessLogsStatus?.message ? <div className={`inline-message ${props.adminAccessLogsStatus.tone === "error" ? "is-error" : ""}`}>{props.adminAccessLogsStatus.message}</div> : null}
        {filteredLogs.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table admin-log-table admin-access-log-table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>사용자</th>
                  <th>이벤트</th>
                  <th>IP</th>
                  <th>User-Agent</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.createdAt)}</td>
                    <td>
                      <strong>{log.userName || "-"}</strong>
                      <div className="hint">{log.username || "-"}</div>
                    </td>
                    <td>{accessEventLabel(log.eventType)}</td>
                    <td>{log.ipAddress || "-"}</td>
                    <td>{log.userAgent || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">{logs.length ? "검색 조건에 맞는 접속 이력이 없습니다." : "아직 기록된 접속 이력이 없습니다."}</div>
        )}
      </div>
    </section>
  );
}

export function AdminInstanceMonitorTab(props) {
  const [instanceMonitorFilter, setInstanceMonitorFilter] = useState("all");
  const [managedResourceType, setManagedResourceType] = useState("all");
  const [managedResourceHealth, setManagedResourceHealth] = useState("all");
  const [managedResourceSearch, setManagedResourceSearch] = useState("");
  const trafficCourseMap = new Map((props.adminCourses || []).map((course) => [Number(course.id), course]));
  const activeLabStatuses = new Set(ACTIVE_LAB_STATUSES);
  const activeLabs = (props.adminLabs || []).filter((lab) => activeLabStatuses.has(String(lab.status || "").toLowerCase()));
  const instanceMonitorPayload = props.adminInstanceMonitor || {};
  const managedResources = instanceMonitorPayload.managedResources || {};
  const managedResourceItems = Array.isArray(managedResources.items) ? managedResources.items : [];
  const managedResourceTotals = managedResources.totals || {};
  const managedSearchText = String(managedResourceSearch || "").trim().toLowerCase();
  const visibleManagedResources = managedResourceItems.filter((item) => {
    if (managedResourceType !== "all" && item.type !== managedResourceType) return false;
    if (managedResourceHealth !== "all" && item.health !== managedResourceHealth) return false;
    if (!managedSearchText) return true;
    return [item.name, item.userName, item.username, item.projectName, item.resourceId, item.address, item.summary, item.specification, item.message]
      .filter(Boolean).join(" ").toLowerCase().includes(managedSearchText);
  });
  const instanceMonitorItems = Array.isArray(instanceMonitorPayload.items) && instanceMonitorPayload.items.length
    ? instanceMonitorPayload.items
    : buildFallbackInstanceMonitorItems(props, activeLabs, trafficCourseMap);
  const instanceMonitorTotals = instanceMonitorPayload.totals || {};
  const autoWarning = instanceMonitorPayload.autoWarning || {};
  const autoWarningCandidates = Array.isArray(autoWarning.candidates) ? autoWarning.candidates : [];
  const autoWarningReadyCount = Number(instanceMonitorTotals.autoWarningReady ?? autoWarningCandidates.filter((item) => item.autoWarning?.eligible).length) || 0;
  const longIdleHours = Number(instanceMonitorPayload.longIdleHours || 12) || 12;
  const instanceDangerCount = instanceMonitorItems.filter((item) => item.risk?.level === "danger").length;
  const instanceWarnCount = instanceMonitorItems.filter((item) => item.risk?.level === "warn").length;
  const instanceRunningCount = instanceMonitorItems.filter((item) => item.status === "running").length;
  const instanceMetricsWaitingCount = instanceMonitorItems.filter((item) => item.metrics?.supported && !item.metrics?.checkedAt).length;
  const instanceRiskCount = instanceMonitorItems.filter((item) => ["danger", "warn"].includes(item.risk?.level)).length;
  const instanceCollectionIssueCount = instanceMonitorItems.filter((item) =>
    ["partial", "stale", "waiting", "unsupported"].includes(item.metrics?.collection?.level)).length;
  const visibleInstanceMonitorItems = instanceMonitorItems.filter((item) => {
    if (instanceMonitorFilter === "running") return item.status === "running";
    if (instanceMonitorFilter === "risk") return ["danger", "warn"].includes(item.risk?.level);
    if (instanceMonitorFilter === "collection") return ["partial", "stale", "waiting", "unsupported"].includes(item.metrics?.collection?.level);
    return true;
  });
  const visibleInstanceDangerCount = visibleInstanceMonitorItems.filter((item) => item.risk?.level === "danger").length;
  const visibleInstanceWarnCount = visibleInstanceMonitorItems.filter((item) => item.risk?.level === "warn").length;
  const maxDiskBytes = Math.max(0, ...visibleInstanceMonitorItems.map((item) =>
    getMonitorMetricSupportState(item.metrics?.diskSupported) === "supported"
      ? (Number(item.metrics?.diskReadBytes || 0) || 0) + (Number(item.metrics?.diskWriteBytes || 0) || 0)
      : 0));
  const maxNetworkBytes = Math.max(0, ...visibleInstanceMonitorItems.map((item) =>
    getMonitorMetricSupportState(item.metrics?.networkSupported) === "supported"
      ? (Number(item.metrics?.networkDailyBytes || 0) || 0) || (Number(item.metrics?.networkTotalBytes || 0) || 0)
      : 0));
  const blockVmAccess = (item) => {
    const user = (props.adminUsers || []).find((candidate) =>
      Number(candidate.id) === Number(item.userId)
      || String(candidate.username || "").trim().toLowerCase() === String(item.username || "").trim().toLowerCase());
    if (!user || !user.selfServiceVmEnabled) return;
    const label = item.userName || item.username || `사용자 #${item.userId}`;
    if (typeof window !== "undefined" && !window.confirm(`${label}의 클라우드 콘솔 권한을 해제할까요?`)) return;
    props.onUserPatch?.(user.id, user.role, user.status, { selfServiceVmEnabled: false });
  };
  const terminateMonitorItem = (item) => {
    if (item.type === "self-service-vm") {
      props.onTerminateSelfServiceVm?.(item.id);
      return;
    }
    props.onTerminateLab?.(item.id);
  };

  return (
    <section className="portal-stack">
      <div className="admin-simple-card">
        <div className="admin-card-header">
          <div>
            <p className="card-label">Instance Monitor</p>
            <strong>인스턴스 모니터링</strong>
            <div className="hint">{`실제 런타임 자원만 표시 · 장시간 미사용 ${longIdleHours}시간 기준`}</div>
          </div>
          <div className="admin-inline-actions">
            <span className="hint">{instanceMonitorPayload.checkedAt ? `최근 수집: ${formatDateTime(instanceMonitorPayload.checkedAt)}` : "최근 수집 대기"}</span>
            <button className="mini-btn refresh-btn" onClick={props.onRefreshApiMonitor} type="button">새로고침</button>
          </div>
        </div>
        <div className="admin-summary-grid">
          <article className="admin-summary-item">
            <span>전체 인스턴스</span>
            <strong>{`${instanceMonitorTotals.total ?? instanceMonitorItems.length}개`}</strong>
            <div className="hint">{`랩 ${instanceMonitorTotals.lab ?? instanceMonitorItems.filter((item) => item.type === "lab").length}개 / 클라우드 콘솔 ${instanceMonitorTotals.selfServiceVm ?? instanceMonitorItems.filter((item) => item.type === "self-service-vm").length}개${Number(instanceMonitorTotals.hiddenNoResource || 0) ? ` / 리소스 없음 제외 ${instanceMonitorTotals.hiddenNoResource}개` : ""}`}</div>
          </article>
          <article className="admin-summary-item">
            <span>실행 중</span>
            <strong>{`${instanceMonitorTotals.running ?? instanceRunningCount}개`}</strong>
            <div className="hint">{`중지 ${instanceMonitorTotals.paused ?? instanceMonitorItems.filter((item) => ["paused", "stopped"].includes(item.status)).length}개`}</div>
          </article>
          <article className="admin-summary-item">
            <span>위험/주의</span>
            <strong>{`${instanceMonitorTotals.danger ?? instanceDangerCount} / ${instanceMonitorTotals.warn ?? instanceWarnCount}`}</strong>
            <div className="hint">CPU, MEM, 트래픽, 장기 대기 기준</div>
          </article>
          <article className="admin-summary-item">
            <span>수집 상태</span>
            <strong>{`${instanceMonitorTotals.collectionOk ?? 0} / ${instanceMonitorTotals.collectionPartial ?? 0}`}</strong>
            <div className="hint">{`정상 / 부분 / 지연 ${instanceMonitorTotals.collectionStale ?? 0} / 대기 ${instanceMonitorTotals.collectionWaiting ?? instanceMetricsWaitingCount}`}</div>
          </article>
          <article className="admin-summary-item">
            <span>자동 경고</span>
            <strong>{`${autoWarningReadyCount}개`}</strong>
            <div className="hint">{`후보 ${instanceMonitorTotals.autoWarningCandidates ?? autoWarningCandidates.length}개 / 쿨다운 ${autoWarning.cooldownHours || 12}시간`}</div>
          </article>
        </div>
      </div>

      {autoWarningCandidates.length ? (
        <AdminDisclosureCard
          defaultOpen={autoWarningReadyCount > 0}
          title="자동 경고 후보"
          subtitle="CPU/MEM/트래픽 위험 기준과 발송 쿨다운을 적용합니다."
          summary={`발송 가능 ${autoWarningReadyCount}개 / 후보 ${autoWarningCandidates.length}개`}
        >
          <div className="admin-inline-actions">
            <button className="mini-btn refresh-btn" disabled={!autoWarningReadyCount} onClick={() => props.onSendAutoInstanceWarnings?.()} type="button">자동 경고 발송</button>
            <span className="hint">{`최대 ${autoWarning.maxBatch || 20}건씩 발송`}</span>
          </div>
          <div className="admin-table admin-table-scroll">
            <div className="admin-table-head admin-course-grid">
              <span>대상</span>
              <span>경고 기준</span>
              <span>발송 상태</span>
            </div>
            {autoWarningCandidates.map((candidate) => (
              <div className="admin-table-row admin-course-grid" key={`auto-warning-${candidate.key || `${candidate.type}-${candidate.id}`}`}>
                <span>
                  <strong>{candidate.userName || candidate.username || "-"}</strong>
                  <div className="hint">{candidate.title || `인스턴스 #${candidate.id}`}</div>
                </span>
                <span>
                  <div>{candidate.autoWarning?.reasons?.length ? candidate.autoWarning.reasons.join(", ") : "위험 기준 확인"}</div>
                  <div className="hint">{candidate.risk?.label ? `위험도 ${candidate.risk.label}` : "위험도 확인 중"}</div>
                </span>
                <span>
                  <span className={`status-chip ${candidate.autoWarning?.eligible ? "is-warn" : "is-muted"}`}>{candidate.autoWarning?.label || "확인 중"}</span>
                  {candidate.autoWarning?.cooldownUntil ? <div className="hint">{`다음 가능 ${formatDateTime(candidate.autoWarning.cooldownUntil)}`}</div> : null}
                </span>
              </div>
            ))}
          </div>
        </AdminDisclosureCard>
      ) : null}

      <AdminDisclosureCard
        defaultOpen
        title="플랫폼 자원 현황"
        subtitle="데이터베이스, 쿠버네티스, 클라우드 콘솔 자원의 소유자와 생성 상태를 통합 확인합니다."
        summary={`전체 ${managedResourceTotals.total ?? managedResourceItems.length}개 / 주의 ${managedResourceTotals.issue ?? 0}개`}
      >
        <div className="admin-summary-grid">
          <article className="admin-summary-item">
            <span>데이터베이스</span>
            <strong>{`${managedResourceTotals.database ?? 0}개`}</strong>
            <div className="hint">Trove 인스턴스</div>
          </article>
          <article className="admin-summary-item">
            <span>쿠버네티스</span>
            <strong>{`${managedResourceTotals.kubernetes ?? 0}개`}</strong>
            <div className="hint">CAPO 클러스터</div>
          </article>
          <article className="admin-summary-item">
            <span>클라우드 콘솔</span>
            <strong>{`${managedResourceTotals.cloudConsole ?? 0}개`}</strong>
            <div className="hint">가상머신 생성 작업</div>
          </article>
          <article className="admin-summary-item">
            <span>상태</span>
            <strong>{`${managedResourceTotals.healthy ?? 0} / ${managedResourceTotals.progress ?? 0} / ${managedResourceTotals.issue ?? 0}`}</strong>
            <div className="hint">정상 / 진행 / 주의</div>
          </article>
        </div>
        <div className="admin-history-search">
          <input
            onChange={(event) => setManagedResourceSearch(event.target.value)}
            placeholder="자원명, 사용자, 프로젝트, UUID, 주소 검색"
            type="search"
            value={managedResourceSearch}
          />
          <select onChange={(event) => setManagedResourceType(event.target.value)} value={managedResourceType}>
            <option value="all">전체 유형</option>
            <option value="database">데이터베이스</option>
            <option value="kubernetes">쿠버네티스</option>
            <option value="cloud-console">클라우드 콘솔</option>
          </select>
          <select onChange={(event) => setManagedResourceHealth(event.target.value)} value={managedResourceHealth}>
            <option value="all">전체 상태</option>
            <option value="healthy">정상</option>
            <option value="progress">진행</option>
            <option value="issue">주의</option>
            <option value="inactive">종료/삭제</option>
          </select>
        </div>
        <div className="admin-table admin-table-scroll">
          <div className="admin-table-head admin-course-grid">
            <span>사용자 / 자원</span>
            <span>구성 / 주소</span>
            <span>상태</span>
          </div>
          {visibleManagedResources.length ? visibleManagedResources.map((item) => (
            <div className="admin-table-row admin-course-grid" key={item.key}>
              <span>
                <strong>{item.name || `${item.typeLabel} #${item.id}`}</strong>
                <div className="hint">{`${item.userName || item.username || "-"}${item.username ? ` (${item.username})` : ""}`}</div>
                <div className="hint">{`${item.typeLabel || item.type} / 프로젝트 ${item.projectName || "-"}`}</div>
                {item.resourceId ? <div className="hint">{`UUID: ${item.resourceId}`}</div> : null}
              </span>
              <span>
                <div>{item.summary || "-"}</div>
                {item.specification ? <div className="hint">{item.specification}</div> : null}
                <div className="hint">{`주소: ${item.address || "-"}`}</div>
                <div className="hint">{`생성: ${item.createdAt ? formatDateTime(item.createdAt) : "-"}`}</div>
              </span>
              <span>
                <span className={`status-chip ${item.health === "healthy" ? "is-success" : item.health === "progress" ? "is-warn" : item.health === "issue" ? "is-error" : "is-muted"}`}>{item.status || "-"}</span>
                {item.message ? <div className="hint">{item.message}</div> : null}
                <div className="hint">{item.health === "healthy" ? "정상" : item.health === "progress" ? "진행 중" : item.health === "issue" ? "확인 필요" : "종료/삭제"}</div>
              </span>
            </div>
          )) : <div className="empty-state">검색 조건에 맞는 플랫폼 자원이 없습니다.</div>}
        </div>
      </AdminDisclosureCard>

      <AdminDisclosureCard
        defaultOpen
        title="모니터링 대상"
        subtitle="실제 생성된 랩 VM과 클라우드 콘솔 자원의 최근 사용률, 네트워크 사용량, 운영 조치 상태"
        summary={visibleInstanceMonitorItems.length ? `표시 ${visibleInstanceMonitorItems.length}개 / 위험 ${visibleInstanceDangerCount}개 / 주의 ${visibleInstanceWarnCount}개` : "표시 대상 없음"}
      >
        <div className="admin-inline-actions">
          <button
            className={`mini-btn ${instanceMonitorFilter === "all" ? "is-active" : ""}`}
            onClick={() => setInstanceMonitorFilter("all")}
            type="button"
          >
            {`전체 ${instanceMonitorItems.length}개`}
          </button>
          <button
            className={`mini-btn ${instanceMonitorFilter === "running" ? "is-active" : ""}`}
            onClick={() => setInstanceMonitorFilter("running")}
            type="button"
          >
            {`실행 중 ${instanceRunningCount}개`}
          </button>
          <button
            className={`mini-btn ${instanceMonitorFilter === "risk" ? "is-active" : ""}`}
            onClick={() => setInstanceMonitorFilter("risk")}
            type="button"
          >
            {`위험 ${instanceRiskCount}개`}
          </button>
          <button
            className={`mini-btn ${instanceMonitorFilter === "collection" ? "is-active" : ""}`}
            onClick={() => setInstanceMonitorFilter("collection")}
            type="button"
          >
            {`수집 이슈 ${instanceCollectionIssueCount}개`}
          </button>
        </div>
        <div className="admin-table admin-table-scroll">
          <div className="admin-table-head admin-course-grid">
            <span>사용자 / 인스턴스</span>
            <span>CPU / MEM / DISK / NET</span>
            <span>상태 / 조치</span>
          </div>
          {visibleInstanceMonitorItems.length ? visibleInstanceMonitorItems.map((item) => {
            const cpuPercent = clampMonitorPercent(item.metrics?.cpuUsagePercent);
            const memoryPercent = clampMonitorPercent(item.metrics?.memoryUsagePercent);
            const diskReadBytes = Number(item.metrics?.diskReadBytes || 0) || 0;
            const diskWriteBytes = Number(item.metrics?.diskWriteBytes || 0) || 0;
            const diskTotalBytes = diskReadBytes + diskWriteBytes;
            const networkRxBytes = Number(item.metrics?.networkRxBytes || 0) || 0;
            const networkTxBytes = Number(item.metrics?.networkTxBytes || 0) || 0;
            const networkDailyBytes = Number(item.metrics?.networkDailyBytes || 0) || 0;
            const networkTotalBytes = Number(item.metrics?.networkTotalBytes ?? (networkRxBytes + networkTxBytes)) || 0;
            const networkMeterBytes = networkDailyBytes || networkTotalBytes;
            const diskSupportState = getMonitorMetricSupportState(item.metrics?.diskSupported);
            const networkSupportState = getMonitorMetricSupportState(item.metrics?.networkSupported);
            const diskHint = diskSupportState === "unsupported"
              ? "DISK 메트릭 없음"
              : diskSupportState === "unknown"
                ? `R ${formatTrafficBytes(diskReadBytes)} / W ${formatTrafficBytes(diskWriteBytes)} / 수집 확인 중`
                : `R ${formatTrafficBytes(diskReadBytes)} / W ${formatTrafficBytes(diskWriteBytes)}`;
            const networkHint = networkSupportState === "unsupported"
              ? (item.metrics?.networkMetricMapped === false ? "NET 매핑 없음" : "NET 메트릭 없음")
              : networkSupportState === "unknown"
                ? `RX ${formatTrafficBytes(networkRxBytes)} / TX ${formatTrafficBytes(networkTxBytes)} / 수집 확인 중`
                : `RX ${formatTrafficBytes(networkRxBytes)} / TX ${formatTrafficBytes(networkTxBytes)}${networkDailyBytes ? ` / 누적 ${formatTrafficBytes(networkTotalBytes)}` : ""}`;
            const riskClass = getMonitorRiskClass(item.risk?.level);
            const collection = item.metrics?.collection || {};
            return (
              <div className="admin-table-row admin-course-grid" key={item.key || `${item.type}-${item.id}`}>
                <span>
                  <strong>{item.userName || item.username || "-"}</strong>
                  <div className="hint">{`${item.username || "-"} / ${item.label || item.type || "instance"}`}</div>
                  <div className="hint">{item.courseTitle || item.title || `인스턴스 #${item.id}`}</div>
                  <div className="hint">{`Flavor: ${item.flavor || "-"} / ${item.instanceCount || 1}대`}</div>
                  <div className="hint">{`IP: ${item.instanceIp || "-"}`}</div>
                  <div className="hint">{`최근 활동: ${item.lastActivityAt ? formatDateTime(item.lastActivityAt) : "-"}`}</div>
                  <div className="hint">{`미사용 기준: ${longIdleHours}시간${item.recentlyActive ? " / 최근 접속 있음" : ""}`}</div>
                </span>
                <span>
                  {item.metrics?.supported ? (
                    <>
                      {renderMonitorMeter({
                        label: "CPU",
                        valueLabel: item.metrics.cpuSupported === false ? "-" : renderOptionalPercent(item.metrics.cpuUsagePercent),
                        widthPercent: item.metrics.cpuSupported === false ? 0 : cpuPercent,
                        fillClassName: getMetricToneClass(cpuPercent),
                      })}
                      {renderMonitorMeter({
                        label: "MEM",
                        valueLabel: item.metrics.memorySupported === false ? "-" : renderOptionalPercent(item.metrics.memoryUsagePercent),
                        widthPercent: item.metrics.memorySupported === false ? 0 : memoryPercent,
                        fillClassName: getMetricToneClass(memoryPercent),
                      })}
                      {renderMonitorMeter({
                        label: "DISK I/O",
                        valueLabel: diskSupportState === "unsupported" ? "-" : diskSupportState === "unknown" ? "확인 중" : formatTrafficBytes(diskTotalBytes),
                        widthPercent: diskSupportState === "supported" ? clampMonitorRelativePercent(diskTotalBytes, maxDiskBytes) : 0,
                        hint: diskHint,
                      })}
                      {renderMonitorMeter({
                        label: "NET",
                        valueLabel: networkSupportState === "unsupported" ? "-" : networkSupportState === "unknown" ? "확인 중" : networkDailyBytes ? `오늘 ${formatTrafficBytes(networkDailyBytes)}` : formatTrafficBytes(networkTotalBytes),
                        widthPercent: networkSupportState === "supported" ? clampMonitorRelativePercent(networkMeterBytes, maxNetworkBytes) : 0,
                        hint: networkHint,
                      })}
                      {renderMonitorTrend(item.metrics.history)}
                      <div className="hint">{item.metrics.checkedAt ? `수집 ${formatDateTime(item.metrics.checkedAt)}` : "수집 대기"}</div>
                    </>
                  ) : (
                    <>
                      <div className="hint">CPU/MEM/DISK/NET 수집 대기</div>
                      <div className="hint">{item.metrics?.message || "메트릭 매핑 후 표시됩니다."}</div>
                    </>
                  )}
                </span>
                <span>
                  <div className="admin-inline-actions">
                    <span className={`status-chip ${riskClass}`}>{item.risk?.label || "정상"}</span>
                    <span className="status-chip is-muted">{labStatus(item.status)}</span>
                    {collection.label ? <span className={`status-chip ${collection.tone || "is-muted"}`}>{collection.label}</span> : null}
                  </div>
                  {collection.message ? <div className="hint">{collection.message}</div> : null}
                  {item.risk?.reasons?.length ? <div className="hint">{item.risk.reasons.join(", ")}</div> : <div className="hint">위험 신호 없음</div>}
                  <div className="admin-inline-actions">
                    {item.actions?.canWarn !== false ? <button className="mini-btn" onClick={() => props.onWarnInstanceUsage?.(item)} type="button">경고</button> : null}
                    {item.actions?.canPause ? <button className="mini-btn stop-btn" onClick={() => props.onAdminLabPowerAction?.(item.id, "pause")} type="button">중지</button> : null}
                    {item.actions?.canResume ? <button className="mini-btn start-btn" onClick={() => props.onAdminLabPowerAction?.(item.id, "resume")} type="button">시작</button> : null}
                    {item.actions?.canDisableVmAccess ? <button className="mini-btn" onClick={() => blockVmAccess(item)} type="button">VM 권한 차단</button> : null}
                    {item.actions?.canTerminate ? <button className="mini-btn danger-mini-btn" onClick={() => terminateMonitorItem(item)} type="button">제거</button> : null}
                  </div>
                </span>
              </div>
            );
          }) : (
            <div className="hint">
              {instanceMonitorFilter === "running"
                ? "현재 실행 중인 모니터링 대상 인스턴스가 없습니다."
                : instanceMonitorFilter === "risk"
                  ? "현재 위험/주의 모니터링 대상 인스턴스가 없습니다."
                  : instanceMonitorFilter === "collection"
                    ? "현재 수집 이슈가 있는 모니터링 대상 인스턴스가 없습니다."
                    : "현재 모니터링 대상 인스턴스가 없습니다."}
            </div>
          )}
        </div>
      </AdminDisclosureCard>
    </section>
  );
}

export function AdminApiMonitorTab(props) {
  const [trafficDebugDuration, setTrafficDebugDuration] = useState("30");
  const [trafficDebugInterface, setTrafficDebugInterface] = useState("");
  const [focusedApiMonitorKey, setFocusedApiMonitorKey] = useState("");
  const [diagnosticReportStatus, setDiagnosticReportStatus] = useState("");
  const accessStats = props.apiMonitor?.access || {};
  const accessRecentDays = Number(accessStats.recentDays || 5);
  const recentUserSummaries = Array.isArray(accessStats.recentUserSummaries) ? accessStats.recentUserSummaries : [];
  const recentAccessLogs = Array.isArray(accessStats.recentLogs) ? accessStats.recentLogs : [];
  const trafficDebugCapture = props.trafficDebugCapture || null;
  const trafficDebugStatus = props.trafficDebugStatus || {};
  const trafficDebugNetwork = trafficDebugCapture?.network || {};
  const trafficDebugAppHttp = trafficDebugCapture?.appHttp || {};
  const trafficDebugAccessLogs = trafficDebugCapture?.accessLogs || {};
  const trafficDebugGroups = Array.isArray(trafficDebugAppHttp.byGroup) ? trafficDebugAppHttp.byGroup : [];
  const trafficDebugTopPaths = Array.isArray(trafficDebugAppHttp.topPaths) ? trafficDebugAppHttp.topPaths : [];
  const trafficDebugAccessTopPaths = Array.isArray(trafficDebugAccessLogs.topPaths) ? trafficDebugAccessLogs.topPaths : [];
  const trafficDebugInterfaces = Array.isArray(trafficDebugCapture?.interfaces) ? trafficDebugCapture.interfaces : [];
  const trafficDebugCapturing = Boolean(trafficDebugStatus.capturing);
  const trafficDebugStatusClass = trafficDebugStatus.tone === "error" ? "is-error" : trafficDebugStatus.tone === "success" ? "is-success" : "is-info";
  const trafficDebugSummary = trafficDebugCapture
    ? `${trafficDebugCapture.interfaceName || "인터페이스 미확인"} / TX ${formatTrafficBytes(trafficDebugNetwork.txBytes)}`
    : "캡처 대기";
  const trafficCourseMap = new Map((props.adminCourses || []).map((course) => [Number(course.id), course]));
  const recentActiveUsernames = new Set(
    recentAccessLogs
      .filter((log) => log.eventType !== "logout")
      .map((log) => String(log.username || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const activeLabStatuses = new Set(ACTIVE_LAB_STATUSES);
  const activeLabs = (props.adminLabs || []).filter((lab) => activeLabStatuses.has(String(lab.status || "").toLowerCase()));
  const monitoredLabs = (props.adminLabs || []).filter((lab) => {
    const course = trafficCourseMap.get(Number(lab.courseId));
    return Boolean(course?.trafficMonitoringEnabled) && isVisibleTrafficMonitorLab(lab);
  });
  const trafficExceededLabs = monitoredLabs.filter((lab) => Boolean(lab.trafficExceeded));
  const trafficPausedLabs = monitoredLabs.filter((lab) => String(lab.status || "").toLowerCase() === "paused");
  const totalTrafficBytes = monitoredLabs.reduce((sum, lab) => sum + Math.max(0, Number(lab.trafficTotalBytes || 0) || 0), 0);
  const todayTrafficBytes = monitoredLabs.reduce((sum, lab) => sum + Math.max(0, Number(lab.trafficDailyBytes || 0) || 0), 0);
  const monitoredActiveLabs = monitoredLabs.filter((lab) => activeLabStatuses.has(String(lab.status || "").toLowerCase()));
  const activeLabUsers = Array.from(
    new Map(
      activeLabs.map((lab) => {
        const key = String(lab.username || lab.userName || lab.userId || lab.id).trim();
        return [key, lab];
      }),
    ).values(),
  );
  const trafficTopLabs = [...monitoredLabs]
    .sort((a, b) => Number(b.trafficTotalBytes || 0) - Number(a.trafficTotalBytes || 0))
    .slice(0, 5);
  const trafficDetailLabs = [...monitoredLabs]
    .sort((a, b) => {
      if (Boolean(b.trafficExceeded) !== Boolean(a.trafficExceeded)) {
        return Boolean(b.trafficExceeded) ? 1 : -1;
      }
      return Number(b.trafficTotalBytes || 0) - Number(a.trafficTotalBytes || 0);
    });
  const activeUserPreview = Array.from(
    new Set(
      (recentUserSummaries.length ? recentUserSummaries : recentAccessLogs)
        .filter((item) => item.lastEventType !== "logout" && item.eventType !== "logout")
        .map((item) => String(item.username || item.userName || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 5);
  const previewOverflow = Math.max(0, Number(accessStats.currentConnectedUsers || 0) - activeUserPreview.length);
  const nowMs = Date.now();
  const expiringLabs = activeLabs.filter((lab) => {
    const expiresMs = getTimestampMs(lab.expiresAt);
    return expiresMs > nowMs && expiresMs - nowMs <= 6 * 60 * 60 * 1000;
  });
  const stuckProvisionLabs = activeLabs.filter((lab) => {
    const status = String(lab.status || "").toLowerCase();
    const createdMs = getTimestampMs(lab.createdAt || lab.requestedAt);
    return ["approved", "provisioning", "building"].includes(status) && createdMs > 0 && nowMs - createdMs >= 30 * 60 * 1000;
  });
  const pendingExposureLabs = activeLabs.filter((lab) => (
    lab.publicRequestPending
    || lab.publicTcpRequestPending
    || lab.externalSshRequestPending
    || lab.externalRdpRequestPending
    || (Array.isArray(lab.requestedPublicDomains) && lab.requestedPublicDomains.length > 0)
    || (Array.isArray(lab.requestedPublicTcpRoutes) && lab.requestedPublicTcpRoutes.length > 0)
  ));
  const instructorWatchItems = [
    ...stuckProvisionLabs.map((lab) => ({ lab, reason: "랩 생성 장기 대기", tone: "is-error", detail: "30분 이상 생성/승인 단계에 머무름", priority: 4 })),
    ...trafficExceededLabs.map((lab) => ({ lab, reason: "트래픽 한도 초과", tone: "is-warn", detail: `누적 ${formatTrafficBytes(lab.trafficTotalBytes)}`, priority: 3 })),
    ...pendingExposureLabs.map((lab) => ({ lab, reason: "공개 접속 승인 대기", tone: "is-info", detail: "도메인/TCP/RDP/SSH 노출 요청 확인", priority: 2 })),
    ...expiringLabs.map((lab) => ({ lab, reason: "자동 회수 임박", tone: "is-muted", detail: lab.expiresAt ? `${formatDateTime(lab.expiresAt)} 만료` : "만료 예정", priority: 1 })),
  ]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 8);
  const quotaWarningItems = normalizeOpenstackUsageResources(props.apiMonitor?.quota || {})
    .map((resource) => {
      const latest = resource.points[resource.points.length - 1] || {};
      const percent = Number(latest.percent ?? resource.current.percent ?? 0) || 0;
      const used = latest.used ?? resource.current.used;
      const limit = latest.limit ?? resource.current.limit;
      return { ...resource, percent, used, limit };
    })
    .filter((resource) => resource.percent >= 70)
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 6);
  const contentVersionItems = [
    ...(props.adminCourses || []).map((course) => ({
      key: `course-${course.id}`,
      type: "과정",
      title: course.title || `과정 #${course.id}`,
      detail: `${course.courseStatus || "draft"} / ${course.labBackendType || "vm"}`,
      updatedAt: getContentItemUpdatedAt(course),
    })),
    ...(props.adminHeatTemplates || []).map((template) => ({
      key: `heat-${template.name}`,
      type: "Heat",
      title: template.name,
      detail: template.inUseCount ? `사용 중 ${template.inUseCount}개 과정` : "미사용 템플릿",
      updatedAt: getContentItemUpdatedAt(template),
    })),
    ...(props.adminApplicationYamls || []).map((item) => ({
      key: `application-yaml-${item.name}`,
      type: "Application YAML",
      title: item.name,
      detail: item.validationError || (item.category === "exception" ? "예외 서비스" : "기본 서비스"),
      updatedAt: getContentItemUpdatedAt(item),
    })),
    ...(props.adminCloudInitTemplates || []).map((template) => ({
      key: `cloud-init-${template.name}`,
      type: "cloud-init",
      title: template.name,
      detail: template.description || "설명 없음",
      updatedAt: getContentItemUpdatedAt(template),
    })),
  ]
    .sort((a, b) => getTimestampMs(b.updatedAt) - getTimestampMs(a.updatedAt))
    .slice(0, 8);
  const arenaOverview = props.adminArenaOverview?.overview || {};
  const arenaStats = arenaOverview.stats || {};
  const arenaLeaderboard = Array.isArray(arenaOverview.leaderboard) ? arenaOverview.leaderboard : [];
  const arenaSessions = Array.isArray(props.adminArenaOverview?.sessions) ? props.adminArenaOverview.sessions : [];
  const arenaAttempts = Array.isArray(props.adminArenaOverview?.attempts) ? props.adminArenaOverview.attempts : [];
  const arenaCaptures = Array.isArray(props.adminArenaOverview?.captures) ? props.adminArenaOverview.captures : [];
  const items = [
    { key: "portal", title: "포털 API", value: props.apiMonitor?.portal },
    { key: "postgres", title: "PostgreSQL", value: props.apiMonitor?.postgres },
    { key: "routes", title: "라우트 맵", value: props.apiMonitor?.routes },
    { key: "access", title: "접속 통계", value: props.apiMonitor?.access },
    { key: "llm", title: "LLM API", value: props.apiMonitor?.llm },
    { key: "zun", title: "Zun API", value: props.apiMonitor?.zun },
    { key: "magnum", title: "CAPO", value: props.apiMonitor?.magnum },
    { key: "trove", title: "Trove API", value: props.apiMonitor?.trove },
    { key: "heat", title: "Heat/OpenStack", value: props.apiMonitor?.heat },
    { key: "quota", title: "프로젝트 Quota", value: props.apiMonitor?.quota },
  ];
  const openstackDiagnosticReport = buildOpenstackDiagnosticReport(props.apiMonitor || {}, props.platformStatus || {});
  const openstackDiagnosticReportPreview = openstackDiagnosticReport.split("\n").slice(0, 14).join("\n");
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const requestedFocus = window.sessionStorage.getItem(ADMIN_API_MONITOR_FOCUS_STORAGE_KEY) || "";
      if (requestedFocus) {
        window.sessionStorage.removeItem(ADMIN_API_MONITOR_FOCUS_STORAGE_KEY);
        setFocusedApiMonitorKey(requestedFocus);
      }
    } catch {
      // Storage is optional; the monitor tab remains usable without focus handoff.
    }
  }, []);
  useEffect(() => {
    if (!focusedApiMonitorKey || typeof window === "undefined") return undefined;
    const focusTimer = window.setTimeout(() => {
      const node = document.getElementById(`api-monitor-card-${focusedApiMonitorKey}`);
      if (!node) return;
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      if (typeof node.focus === "function") {
        node.focus({ preventScroll: true });
      }
    }, 80);
    const clearTimer = window.setTimeout(() => setFocusedApiMonitorKey(""), 5200);
    return () => {
      window.clearTimeout(focusTimer);
      window.clearTimeout(clearTimer);
    };
  }, [focusedApiMonitorKey]);
  const failedLabItems = (props.adminLabs || [])
    .filter((lab) => ["failed", "error"].includes(String(lab.status || "").toLowerCase()))
    .slice(0, 3);
  const apiRiskItems = items
    .filter((item) => item.value && renderApiMonitorTone(item.value).className === "is-error")
    .slice(0, 3);
  const cicdMode = props.platformStatus?.cicdExecutionMode === "jenkins" ? "jenkins" : "simulated";
  const cicdMissingSettings = [
    !props.platformStatus?.jenkinsBaseUrl ? "URL" : "",
    !props.platformStatus?.jenkinsUsername ? "사용자" : "",
    !props.platformStatus?.jenkinsApiTokenConfigured && !props.platformStatus?.jenkinsApiToken ? "API Token" : "",
  ].filter(Boolean);
  const cicdRiskItems = cicdMode !== "jenkins"
    ? [{
        key: "cicd-mode",
        label: "CI/CD",
        title: "시뮬레이션 모드",
        detail: "실제 배포 전 Jenkins 실행 모드로 전환이 필요합니다.",
        tone: "is-warn",
        actionLabel: "CI/CD 설정",
        targetTab: "cicd",
      }]
    : cicdMissingSettings.length
      ? [{
          key: "cicd-jenkins-settings",
          label: "CI/CD",
          title: "Jenkins 설정 부족",
          detail: `${cicdMissingSettings.join(", ")} 설정을 확인해 주세요.`,
          tone: "is-error",
          actionLabel: "Jenkins 설정",
          targetTab: "cicd",
        }]
      : [];
  const operatingRiskItems = [
    ...quotaWarningItems.map((resource) => ({
      key: `quota-${resource.key}`,
      label: "리소스",
      title: `${resource.label} ${Math.round(resource.percent)}% 사용`,
      detail: `${formatOpenstackUsageValue(resource.used, resource.unit)} / ${formatOpenstackUsageValue(resource.limit, resource.unit)}`,
      tone: resource.percent >= 90 ? "is-error" : "is-warn",
      actionLabel: "Quota 보기",
      actionHint: "API 모니터 Quota 카드로 이동",
      monitorFocusKey: "quota",
    })),
    ...instructorWatchItems.slice(0, 3).map((item, index) => ({
      key: `watch-${item.lab?.id || "lab"}-${index}`,
      label: "랩 운영",
      title: item.reason,
      detail: `${item.lab?.username || item.lab?.userName || "사용자"} · ${item.detail}`,
      tone: item.tone,
      actionLabel: item.reason === "공개 접속 승인 대기" ? "승인 센터" : "인스턴스 확인",
      actionHint: item.reason === "공개 접속 승인 대기" ? "대기 요청을 한 화면에서 처리" : "랩 상태와 메트릭 확인",
      targetTab: item.reason === "공개 접속 승인 대기" ? "approvalCenter" : "instanceMonitor",
    })),
    ...failedLabItems.map((lab) => ({
      key: `failed-lab-${lab.id}`,
      label: "생성 실패",
      title: lab.courseTitle || lab.stackName || `랩 #${lab.id}`,
      detail: lab.errorMessage || lab.statusMessage || "실패 원인 확인 필요",
      tone: "is-error",
      actionLabel: "실패 랩 확인",
      actionHint: "실패 원인과 인스턴스 상태 확인",
      targetTab: "instanceMonitor",
    })),
    ...cicdRiskItems,
    ...apiRiskItems.map((item) => {
      const guide = getOpenstackApiIssueGuide(item);
      return {
        key: `api-${item.key}`,
        label: "API",
        title: guide?.title || item.title,
        detail: guide?.detail || String(item.value?.message || item.value?.error || "연결 상태 확인 필요"),
        tone: guide?.tone || "is-error",
        actionLabel: "API 카드 보기",
        actionHint: "오류 상세와 조치 순서 확인",
        monitorFocusKey: item.key,
      };
    }),
  ].slice(0, 6);
  const focusApiMonitorCard = (key) => {
    const nextKey = String(key || "").trim();
    if (!nextKey) return;
    if (typeof window === "undefined") {
      setFocusedApiMonitorKey(nextKey);
      return;
    }
    setFocusedApiMonitorKey("");
    window.setTimeout(() => setFocusedApiMonitorKey(nextKey), 0);
  };
  const openRiskItem = (item = {}) => {
    if (item.monitorFocusKey) {
      focusApiMonitorCard(item.monitorFocusKey);
      return;
    }
    if (item.targetTab) {
      props.onOpenAdminTab?.(item.targetTab);
    }
  };
  const openApiMonitorSettings = (item = {}) => {
    const targetId = ["zun", "magnum", "trove"].includes(item.key)
      ? "admin-platform-extensions-settings"
      : "admin-platform-openstack-scope";
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(ADMIN_PLATFORM_FOCUS_STORAGE_KEY, targetId);
      } catch {
        // Tab navigation still works when session storage is unavailable.
      }
    }
    props.onOpenAdminTab?.("platform");
  };
  const startTrafficDebugCapture = () => props.onStartTrafficDebugCapture?.({
    durationSeconds: trafficDebugDuration,
    interfaceName: trafficDebugInterface,
  });
  const copyOpenstackDiagnosticReport = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(openstackDiagnosticReport);
      } else if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = openstackDiagnosticReport;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      } else {
        throw new Error("clipboard unavailable");
      }
      setDiagnosticReportStatus("진단 리포트를 복사했습니다.");
    } catch {
      setDiagnosticReportStatus("자동 복사를 지원하지 않습니다. 아래 내용을 선택해서 복사해 주세요.");
    }
  };

  return (
    <section className="portal-stack">
      <div className="admin-simple-card admin-risk-panel">
        <div className="admin-card-header">
          <div>
            <p className="card-label">Today</p>
            <strong>오늘 운영 리스크</strong>
          </div>
          <span className={`status-chip ${operatingRiskItems.length ? "is-warn" : "is-success"}`}>
            {operatingRiskItems.length ? `${operatingRiskItems.length}건 확인` : "정상"}
          </span>
        </div>
        <div className="admin-risk-grid">
          {operatingRiskItems.length ? operatingRiskItems.map((item) => (
            <article className={`admin-risk-card ${item.tone || ""}`} key={item.key}>
              <span>{item.label}</span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
              {item.actionLabel ? (
                <div className="admin-risk-action-row">
                  <button className="mini-btn admin-risk-action" onClick={() => openRiskItem(item)} type="button">{item.actionLabel}</button>
                  {item.actionHint ? <em>{item.actionHint}</em> : null}
                </div>
              ) : null}
            </article>
          )) : (
            <article className="admin-risk-card is-empty">
              <span>점검 완료</span>
              <strong>긴급 확인 항목이 없습니다</strong>
              <small>API, Quota, 랩 생성 상태가 현재 기준 안정적입니다.</small>
            </article>
          )}
        </div>
      </div>
      <div className="admin-simple-card">
        <div className="admin-card-header">
          <strong>API 접근 상태</strong>
          <div className="admin-inline-actions">
            <span className="hint">{props.apiMonitor?.checkedAt ? `최근 점검: ${props.apiMonitor.checkedAt}` : "최근 점검 기록 없음"}</span>
            <button className="mini-btn refresh-btn" onClick={props.onRefreshApiMonitor} type="button">새로고침</button>
          </div>
        </div>
        <div className="admin-summary-grid">
          <article className="admin-summary-item">
            <span>포털</span>
            <strong>{props.apiMonitor?.portal?.ok ? "정상" : "점검 필요"}</strong>
            <div className="hint">{props.apiMonitor?.portal?.dbMode || props.apiMonitor?.portal?.dbDriver || "-"}</div>
          </article>
          <article className="admin-summary-item">
            <span>현재 접속자</span>
            <strong>{`${accessStats.currentConnectedUsers ?? 0}명`}</strong>
            <div className="hint">{`최근 ${accessRecentDays}일 사용자 ${accessStats.recentUsers ?? 0}명`}</div>
            {activeUserPreview.length ? (
              <div className="hint">
                {activeUserPreview.join(", ")}
                {previewOverflow > 0 ? ` 외 ${previewOverflow}명` : ""}
              </div>
            ) : null}
          </article>
          <article className="admin-summary-item">
            <span>LLM 응답</span>
            <strong>{props.apiMonitor?.llm?.latencyMs != null ? `${props.apiMonitor.llm.latencyMs}ms` : "-"}</strong>
            <div className="hint">
              {props.apiMonitor?.llm
                ? `${renderLlmProviderLabel(props.apiMonitor.llm.provider)} / ${props.apiMonitor.llm.model || "모델 미설정"}`
                : "미확인"}
            </div>
            <div className="hint">{props.apiMonitor?.llm?.ok ? "정상" : props.apiMonitor?.llm?.message || "미확인"}</div>
          </article>
          <article className="admin-summary-item">
            <span>Quota</span>
            <strong>{props.apiMonitor?.quota?.projectName || "-"}</strong>
            <div className="hint">{props.apiMonitor?.quota?.ok ? "조회 가능" : props.apiMonitor?.quota?.message || "미확인"}</div>
          </article>
          <article className="admin-summary-item">
            <span>트래픽 초과 랩</span>
            <strong>{`${trafficExceededLabs.length}개`}</strong>
            <div className="hint">{`모니터링 대상 ${monitoredLabs.length}개`}</div>
          </article>
          <article className="admin-summary-item">
            <span>트래픽 일시중지</span>
            <strong>{`${trafficPausedLabs.length}개`}</strong>
            <div className="hint">과정 정책 기준 자동/수동 일시중지</div>
          </article>
          <article className="admin-summary-item">
            <span>활성 랩 사용자</span>
            <strong>{`${activeLabUsers.length}명`}</strong>
            <div className="hint">{`실행/승인 랩 ${activeLabs.length}개`}</div>
          </article>
          <article className="admin-summary-item">
            <span>오늘 트래픽</span>
            <strong>{formatTrafficBytes(todayTrafficBytes)}</strong>
            <div className="hint">{`누적 ${formatTrafficBytes(totalTrafficBytes)}`}</div>
          </article>
          <article className="admin-summary-item">
            <span>모니터링 중인 활성 랩</span>
            <strong>{`${monitoredActiveLabs.length}개`}</strong>
            <div className="hint">{`수집 대기 ${monitoredLabs.filter((lab) => !lab.trafficCheckedAt).length}개`}</div>
          </article>
        </div>
        <div className="api-monitor-diagnostic-report">
          <div className="api-monitor-diagnostic-report-head">
            <div>
              <p className="card-label">OpenStack Diagnostics</p>
              <strong>운영 진단 리포트</strong>
              <span>CA, clouds.yaml, Heat, Quota 상태를 민감정보 없이 묶어서 공유할 수 있습니다.</span>
            </div>
            <div className="api-monitor-diagnostic-actions">
              <button className="mini-btn" onClick={copyOpenstackDiagnosticReport} type="button">진단 리포트 복사</button>
              <button className="mini-btn ghost" onClick={props.onRefreshApiMonitor} type="button">상태 재점검</button>
            </div>
          </div>
          <pre className="api-monitor-diagnostic-preview">{openstackDiagnosticReportPreview}</pre>
          {diagnosticReportStatus ? <div className="api-monitor-diagnostic-status">{diagnosticReportStatus}</div> : null}
        </div>
        <div className="api-monitor-grid">
          {items.map((item) => {
            const tone = renderApiMonitorTone(item.value);
            const isFocused = focusedApiMonitorKey === item.key;
            const issueGuide = getOpenstackApiIssueGuide(item);
            const caStatus = item.value?.openstackCaStatus || (item.key === "openstackCa" ? item.value : null);
            const caLoadedPaths = Array.isArray(caStatus?.loadedPaths) ? caStatus.loadedPaths.filter(Boolean) : [];
            const caCheckedPaths = Array.isArray(caStatus?.checkedPaths) ? caStatus.checkedPaths.filter(Boolean) : [];
            const caMountWarnings = collectOpenstackCaMountWarnings(item.value, caStatus);
            const caCertificates = collectOpenstackCaCertificateDetails(caStatus);
            return (
              <article
                className={`api-monitor-card ${isFocused ? "is-focused" : ""}`}
                data-api-monitor-key={item.key}
                id={`api-monitor-card-${item.key}`}
                key={item.key}
                tabIndex={isFocused ? -1 : undefined}
              >
                <div className="api-monitor-head">
                  <strong>{item.title}</strong>
                  <span className={`status-chip ${tone.className}`}>{tone.label}</span>
                </div>
                  <div className="simple-status-list">
                    {item.key === "llm" && item.value?.provider ? <div>{`연결 방식: ${renderLlmProviderLabel(item.value.provider)}`}</div> : null}
                    {item.key === "llm" && item.value?.model ? <div>{`모델: ${item.value.model}`}</div> : null}
                    {item.key === "llm" && item.value?.configuredEndpoint ? <div>{`설정 URL: ${item.value.configuredEndpoint}`}</div> : null}
                    {item.key === "llm" && item.value?.probeEndpoint ? <div>{`상태 확인 URL: ${item.value.probeEndpoint}`}</div> : null}
                    {item.key !== "llm" && item.value?.endpoint ? <div>{`엔드포인트: ${item.value.endpoint}`}</div> : null}
                    {item.value?.latencyMs != null ? <div>{`응답 시간: ${item.value.latencyMs}ms`}</div> : null}
                    {item.key === "portal" && item.value ? <div>{`앱 DB: ${item.value.dbDriver || "postgres"}`}</div> : null}
                    {item.key === "portal" && item.value ? <div>{`DB 모드: ${item.value.dbMode || "postgres"}`}</div> : null}
                    {item.key === "portal" && item.value?.dbModeMessage ? <div>{item.value.dbModeMessage}</div> : null}
                    {item.key === "portal" && item.value ? <div>{`쿠키 보안: ${item.value.sessionCookieSecure ? "활성" : "비활성"}`}</div> : null}
                    {item.key === "portal" && item.value ? <div>{`세션 저장소: ${item.value.sessionStoreDriver || "postgres"}`}</div> : null}
                    {item.key === "postgres" && item.value ? <div>{`테이블 수: ${item.value.tableCount ?? 0}`}</div> : null}
                    {item.key === "postgres" && item.value?.missingTables?.length ? <div>{`누락 테이블: ${item.value.missingTables.join(", ")}`}</div> : null}
                    {item.key === "postgres" && item.value?.version ? <div>{`버전: ${item.value.version}`}</div> : null}
                    {item.key === "access" && item.value ? <div>{`현재 접속자: ${item.value.currentConnectedUsers ?? 0}명`}</div> : null}
                    {item.key === "access" && item.value ? <div>{`최근 ${item.value.recentDays ?? 5}일 접속 사용자: ${item.value.recentUsers ?? 0}명`}</div> : null}
                    {item.key === "access" && item.value ? <div>{`최근 ${item.value.recentDays ?? 5}일 로그인: ${item.value.recentLoginEvents ?? 0}회`}</div> : null}
                    {item.key === "access" && item.value ? <div>{`오늘 접속자: ${item.value.todayUsers ?? 0}명`}</div> : null}
                    {item.key === "access" && item.value ? <div>{`현재 접속 기준: 최근 ${item.value.activeWithinMinutes ?? 2}분 활동`}</div> : null}
                    {item.key === "llm" && item.value ? <div>{`모델 응답 샘플: ${item.value.preview || "-"}`}</div> : null}
                    {item.key === "zun" && item.value ? <div>{`샘플 수: ${item.value.sampleCount ?? 0}`}</div> : null}
                    {item.key === "zun" && item.value?.projectName ? <div>{`프로젝트: ${item.value.projectName}`}</div> : null}
                    {item.key === "magnum" && item.value ? <div>{`CAPO 프로파일 수: ${item.value.templateCount ?? 0}`}</div> : null}
                    {item.key === "magnum" && item.value?.projectName ? <div>{`프로젝트: ${item.value.projectName}`}</div> : null}
                    {item.key === "trove" && item.value ? <div>{`샘플 수: ${item.value.sampleCount ?? 0}`}</div> : null}
                    {item.key === "trove" && item.value ? <div>{`Datastore 수: ${item.value.datastoreCount ?? 0}`}</div> : null}
                    {item.key === "trove" && item.value?.projectName ? <div>{`프로젝트: ${item.value.projectName}`}</div> : null}
                    {item.key === "heat" && item.value ? <div>{`템플릿 수: ${item.value.templatesCount ?? 0}`}</div> : null}
                    {item.key === "heat" && item.value?.cloudsYamlPath ? <div>{`기본 인증 파일: ${item.value.cloudsYamlPath} · ${item.value.cloudsYamlReadable ? "읽기 가능" : "읽기 불가"}`}</div> : null}
                    {item.key === "heat" && item.value?.serviceCloudsYamlPath ? <div>{`서비스 인증 파일: ${item.value.serviceCloudsYamlEffectivePath || item.value.serviceCloudsYamlPath} · ${item.value.serviceCloudsYamlFallbackUsed ? "폴백 사용" : item.value.serviceCloudsYamlReadable ? "읽기 가능" : "읽기 불가"}`}</div> : null}
                    {item.key === "heat" && item.value?.pocCloudsYamlPath ? <div>{`클라우드 콘솔 인증 파일: ${item.value.pocCloudsYamlEffectivePath || item.value.pocCloudsYamlPath} · ${item.value.pocCloudsYamlFallbackUsed ? "폴백 사용" : item.value.pocCloudsYamlReadable ? "읽기 가능" : "읽기 불가"}`}</div> : null}
                    {item.key === "heat" && item.value?.openstackAuthOk != null ? <div>{`OpenStack 인증: ${item.value.openstackAuthOk ? "정상" : "실패"}`}</div> : null}
                    {item.key === "heat" && item.value?.authUrl ? <div>{`Keystone/Auth URL: ${item.value.authUrl}`}</div> : null}
                    {item.key === "heat" && item.value?.serviceHeatApiUrl ? <div>{`Heat API URL: ${item.value.serviceHeatApiUrl}`}</div> : null}
                    {item.key === "heat" && item.value?.computeApiUrl ? <div>{`Compute API URL: ${item.value.computeApiUrl}`}</div> : null}
                    {item.key === "heat" && item.value?.networkApiUrl ? <div>{`Network API URL: ${item.value.networkApiUrl}`}</div> : null}
                    {item.key === "routes" && item.value?.routeExportDir ? <div>{`Route dir: ${item.value.routeExportDir}`}</div> : null}
                    {item.key === "routes" && item.value?.ssh ? <div>{`SSH map: ${item.value.ssh.actualCount ?? 0}/${item.value.ssh.expectedCount ?? 0}`}</div> : null}
                    {item.key === "routes" && item.value?.ssh?.missing?.length ? <div>{`SSH map 누락: ${item.value.ssh.missing.length}건`}</div> : null}
                    {item.key === "routes" && item.value?.ssh?.stale?.length ? <div>{`SSH map 잔여: ${item.value.ssh.stale.length}건`}</div> : null}
                    {item.key === "quota" && item.value?.projectName ? <div>{`프로젝트: ${item.value.projectName}`}</div> : null}
                    {caLoadedPaths.length ? <div>{`OpenStack CA 로드: ${caLoadedPaths.join(", ")}`}</div> : null}
                    {caStatus?.reloadedAt ? <div>{`OpenStack CA 마지막 로드: ${caStatus.reloadedAt}`}</div> : null}
                    {caCertificates.length ? <div>{`OpenStack CA 인증서: ${caCertificates.filter((certificate) => !certificate.parseError).length}개`}</div> : null}
                    {caCertificates.slice(0, 2).map((certificate) => (
                      <div key={`${item.key}-ca-${certificate.path || "path"}-${certificate.index || "cert"}`}>
                        {certificate.parseError
                          ? `CA 파싱 실패: ${certificate.parseError}`
                          : `CA 유효기간: ${certificate.validFrom || "-"} ~ ${certificate.validTo || "-"}${certificate.expired ? " / 만료됨" : certificate.notYetValid ? " / 아직 유효 전" : ""}`}
                      </div>
                    ))}
                    {caMountWarnings.slice(0, 2).map((warning) => <div key={`${item.key}-ca-warning-${warning}`}>{`OpenStack CA 경고: ${warning}`}</div>)}
                    {caStatus && !caStatus.loaded && caCheckedPaths.length ? <div>{`OpenStack CA 후보: ${caCheckedPaths.join(", ")}`}</div> : null}
                    {item.value?.message ? <div>{`상세: ${item.value.message}`}</div> : null}
                    {item.value?.detailMessage && formatAdminApiErrorDetail(item.value.detailMessage) !== formatAdminApiErrorDetail(item.value.message) ? (
                      <div>{`관리자 오류 원문: ${formatAdminApiErrorDetail(item.value.detailMessage)}`}</div>
                    ) : null}
                    {issueGuide ? (
                      <div className={`api-monitor-guide ${issueGuide.tone || "is-info"}`}>
                        <strong>{issueGuide.title}</strong>
                        <span>{issueGuide.detail}</span>
                        <div className="api-monitor-guide-steps">
                          {issueGuide.steps.map((step) => <em key={step}>{step}</em>)}
                        </div>
                        <div className="admin-inline-actions">
                          <button className="mini-btn" onClick={() => openApiMonitorSettings(item)} type="button">관련 설정 수정</button>
                          <button className="mini-btn ghost" onClick={props.onRefreshApiMonitor} type="button">다시 점검</button>
                        </div>
                      </div>
                    ) : null}
                    {!item.value ? <div>아직 점검 데이터가 없습니다.</div> : null}
                  </div>
                  {item.key === "quota" && item.value?.metrics ? <QuotaSummaryBlock compact quotaStatus={item.value} /> : null}
                </article>
              );
            })}
        </div>
      </div>
      <AdminDisclosureCard
        defaultOpen
        title="수업 당일 콘솔 / 비용 가드레일"
        subtitle="활성 랩, 막힌 수강생, 공개 접속 요청, 자동 회수 임박 항목을 한 화면에서 먼저 확인합니다."
        summary={instructorWatchItems.length ? `확인 필요 ${instructorWatchItems.length}건` : "긴급 확인 항목 없음"}
      >
        <div className="admin-summary-grid">
          <article className="admin-summary-item">
            <span>막힌 랩</span>
            <strong>{`${stuckProvisionLabs.length}개`}</strong>
            <div className="hint">30분 이상 생성/승인 단계</div>
          </article>
          <article className="admin-summary-item">
            <span>공개 접속 요청</span>
            <strong>{`${pendingExposureLabs.length}개`}</strong>
            <div className="hint">도메인/TCP/RDP/SSH 승인 대기</div>
          </article>
          <article className="admin-summary-item">
            <span>회수 임박</span>
            <strong>{`${expiringLabs.length}개`}</strong>
            <div className="hint">6시간 이내 만료 예정</div>
          </article>
          <article className="admin-summary-item">
            <span>Quota 경고</span>
            <strong>{`${quotaWarningItems.length}개`}</strong>
            <div className="hint">사용률 70% 이상 자원</div>
          </article>
        </div>
        {quotaWarningItems.length ? (
          <div className="admin-summary-grid">
            {quotaWarningItems.map((resource) => (
              <article className="admin-summary-item" key={`quota-warning-${resource.key}`}>
                <span>{resource.label}</span>
                <strong>{`${Math.round(resource.percent)}%`}</strong>
                <div className="hint">{`${formatOpenstackUsageValue(resource.used, resource.unit)} / ${Number(resource.limit || 0) > 0 ? formatOpenstackUsageValue(resource.limit, resource.unit) : "무제한"}`}</div>
              </article>
            ))}
          </div>
        ) : null}
        <div className="admin-table admin-table-scroll">
          <div className="admin-table-head admin-course-grid">
            <span>수강생 / 과정</span>
            <span>확인 항목</span>
            <span>상태 / 자원</span>
          </div>
          {instructorWatchItems.length ? instructorWatchItems.map((item, index) => {
            const lab = item.lab || {};
            const course = trafficCourseMap.get(Number(lab.courseId));
            return (
              <div className="admin-table-row admin-course-grid" key={`instructor-watch-${lab.id}-${item.reason}-${index}`}>
                <span>
                  <strong>{lab.userName || lab.username || "-"}</strong>
                  <div className="hint">{lab.username || "-"}</div>
                  <div className="hint">{course?.title || `과정 #${lab.courseId}`}</div>
                </span>
                <span>
                  <span className={`status-chip ${item.tone}`}>{item.reason}</span>
                  <div className="hint">{item.detail}</div>
                </span>
                <span>
                  <div>{labStatus(lab.status)}</div>
                  <div className="hint">{`CPU ${Math.max(0, Number(lab.cpuUsagePercent || 0))}% / MEM ${Math.max(0, Number(lab.memoryUsagePercent || 0))}%`}</div>
                  <div className="hint">{`오늘 ${formatTrafficBytes(lab.trafficDailyBytes)} / 총 ${formatTrafficBytes(lab.trafficTotalBytes)}`}</div>
                </span>
              </div>
            );
          }) : <div className="hint">수업 당일 콘솔에 우선 확인할 항목이 없습니다.</div>}
        </div>
      </AdminDisclosureCard>
      <AdminDisclosureCard
        title="콘텐츠 버전 / Arena 리포트"
        subtitle="최근 바뀐 과정·랩 콘텐츠와 Arena 운영 지표를 함께 봅니다."
        summary={contentVersionItems.length ? `최근 변경 ${contentVersionItems.length}건` : "최근 변경 없음"}
      >
        <div className="admin-summary-grid">
          <article className="admin-summary-item">
            <span>Arena 시즌</span>
            <strong>{arenaOverview.season?.title || "미운영"}</strong>
            <div className="hint">{arenaOverview.season?.status || "활성 시즌 없음"}</div>
          </article>
          <article className="admin-summary-item">
            <span>노드 점령률</span>
            <strong>{`${Number(arenaStats.capturedNodes || 0)} / ${Number(arenaStats.totalNodes || 0)}`}</strong>
            <div className="hint">{arenaStats.bossOpen || arenaStats.bossOpened ? "Boss 오픈" : "Boss 잠김"}</div>
          </article>
          <article className="admin-summary-item">
            <span>참여/세션</span>
            <strong>{`${Number(arenaStats.activePlayers || arenaStats.activeUsers || 0)}명`}</strong>
            <div className="hint">{`최근 세션 ${arenaSessions.length}건 / 검증 ${arenaAttempts.length}건`}</div>
          </article>
          <article className="admin-summary-item">
            <span>캡처 기록</span>
            <strong>{`${arenaCaptures.length}건`}</strong>
            <div className="hint">{arenaLeaderboard.length ? `1위 ${arenaLeaderboard[0]?.handle || arenaLeaderboard[0]?.username || "-"}` : "리더보드 대기"}</div>
          </article>
        </div>
        <div className="admin-table admin-table-scroll">
          <div className="admin-table-head admin-course-grid">
            <span>콘텐츠</span>
            <span>상태</span>
            <span>최근 변경</span>
          </div>
          {contentVersionItems.length ? contentVersionItems.map((item) => (
            <div className="admin-table-row admin-course-grid" key={item.key}>
              <span>
                <strong>{item.title}</strong>
                <div className="hint">{item.type}</div>
              </span>
              <span>{item.detail}</span>
              <span>{item.updatedAt ? formatDateTime(item.updatedAt) : "변경일 미확인"}</span>
            </div>
          )) : <div className="hint">버전 추적에 표시할 과정/템플릿 변경 기록이 없습니다.</div>}
        </div>
        {arenaLeaderboard.length ? (
          <div className="admin-table admin-table-scroll">
            <div className="admin-table-head admin-course-grid">
              <span>Arena 플레이어</span>
              <span>점령/점수</span>
              <span>팀 모드 활용</span>
            </div>
            {arenaLeaderboard.slice(0, 6).map((entry, index) => (
              <div className="admin-table-row admin-course-grid" key={`arena-report-${entry.userId || entry.handle || index}`}>
                <span>
                  <strong>{entry.handle || entry.username || `플레이어 ${index + 1}`}</strong>
                  <div className="hint">{`순위 ${index + 1}`}</div>
                </span>
                <span>
                  <div>{`${Number(entry.captures || entry.captureCount || entry.nodes || 0)}개 점령`}</div>
                  <div className="hint">{`점수 ${Number(entry.score || entry.points || 0)}`}</div>
                </span>
                <span>
                  <div>팀전 리포트 기준 데이터</div>
                  <div className="hint">개인 리더보드를 팀/부서별 결과지로 확장 가능</div>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </AdminDisclosureCard>
      <AdminDisclosureCard
        title="Outgoing 트래픽 디버그"
        subtitle="버튼을 누른 뒤 짧은 시간 동안 시스템 인터페이스 TX/RX 증가량과 앱 응답 바이트를 함께 샘플링합니다."
        summary={trafficDebugSummary}
      >
        <div className="settings-panel">
          <div className="settings-panel-head">
            <div>
              <strong>디버깅 캡처</strong>
              <p className="hint">캡처를 시작한 뒤 관리자 화면은 그대로 두고 다른 탭에서 메인 페이지 새로고침처럼 확인할 동작을 실행하면 됩니다.</p>
            </div>
            <div className="admin-inline-actions">
              <span className={`status-chip ${trafficDebugCapturing ? "is-warn" : trafficDebugCapture ? "is-success" : "is-muted"}`}>
                {trafficDebugCapturing ? "캡처 중" : trafficDebugCapture ? "최근 결과 있음" : "대기"}
              </span>
            </div>
          </div>
          <div className="admin-form-grid">
            <AdminField label="캡처 시간">
              <select disabled={trafficDebugCapturing} onChange={(event) => setTrafficDebugDuration(event.target.value)} value={trafficDebugDuration}>
                {[15, 30, 60, 90].map((seconds) => (
                  <option key={seconds} value={seconds}>{`${seconds}초`}</option>
                ))}
              </select>
            </AdminField>
            <AdminField label="인터페이스" hint="비워두면 서버가 eth/ens/enp 계열을 우선 자동 선택합니다.">
              <input
                disabled={trafficDebugCapturing}
                list="traffic-debug-interface-list"
                onChange={(event) => setTrafficDebugInterface(event.target.value)}
                placeholder={trafficDebugCapture?.interfaceName || "자동 선택"}
                value={trafficDebugInterface}
              />
              <datalist id="traffic-debug-interface-list">
                {trafficDebugInterfaces.map((item) => (
                  <option key={item.name} value={item.name}>{item.operstate || item.name}</option>
                ))}
              </datalist>
            </AdminField>
          </div>
          <div className="admin-inline-actions">
            <button className="primary-mini-btn" disabled={trafficDebugCapturing} onClick={startTrafficDebugCapture} type="button">
              {trafficDebugCapturing ? "캡처 중..." : "캡처 시작"}
            </button>
            {trafficDebugCapture?.checkedAt ? <span className="hint">{`최근 캡처: ${formatDateTime(trafficDebugCapture.checkedAt)}`}</span> : null}
          </div>
          {trafficDebugStatus.message ? <div className={`inline-message ${trafficDebugStatusClass}`}>{trafficDebugStatus.message}</div> : null}
        </div>
        {trafficDebugCapture ? (
          <>
            <div className="admin-summary-grid">
              <article className="admin-summary-item">
                <span>System TX 증가량</span>
                <strong>{trafficDebugNetwork.available ? formatTrafficBytes(trafficDebugNetwork.txBytes) : "-"}</strong>
                <div className="hint">
                  {trafficDebugNetwork.available
                    ? `${formatTrafficBytes(trafficDebugNetwork.txBytesPerSecond)}/s / ${trafficDebugCapture.interfaceName || "-"}`
                    : trafficDebugNetwork.message || "네트워크 카운터 미확인"}
                </div>
              </article>
              <article className="admin-summary-item">
                <span>System RX 증가량</span>
                <strong>{trafficDebugNetwork.available ? formatTrafficBytes(trafficDebugNetwork.rxBytes) : "-"}</strong>
                <div className="hint">{trafficDebugNetwork.available ? `${formatTrafficBytes(trafficDebugNetwork.rxBytesPerSecond)}/s` : "수신 카운터 미확인"}</div>
              </article>
              <article className="admin-summary-item">
                <span>앱 응답 바이트</span>
                <strong>{formatTrafficBytes(trafficDebugAppHttp.totalResponseBytes)}</strong>
                <div className="hint">{`${trafficDebugAppHttp.requestCount || 0}건 / Express 응답 본문 기준`}</div>
              </article>
              <article className="admin-summary-item">
                <span>Access log 응답 바이트</span>
                <strong>{trafficDebugAccessLogs.available ? formatTrafficBytes(trafficDebugAccessLogs.totalBytes) : "-"}</strong>
                <div className="hint">{trafficDebugAccessLogs.available ? `${trafficDebugAccessLogs.requestCount || 0}건` : "로그 경로 미연결"}</div>
              </article>
            </div>
            {trafficDebugGroups.length ? (
              <div className="admin-table admin-table-scroll">
                <div className="admin-table-head admin-course-grid">
                  <span>앱 URL 그룹</span>
                  <span>응답 바이트</span>
                  <span>요청 / 상태</span>
                </div>
                {trafficDebugGroups.map((item) => (
                  <div className="admin-table-row admin-course-grid" key={`traffic-debug-group-${item.label}`}>
                    <span><strong>{item.label}</strong></span>
                    <span>{formatTrafficBytes(item.bytes)}</span>
                    <span>
                      <div>{`${item.requestCount || 0}건`}</div>
                      <div className="hint">{Object.entries(item.statuses || {}).map(([status, count]) => `${status} ${count}`).join(", ") || "-"}</div>
                    </span>
                  </div>
                ))}
              </div>
            ) : <div className="hint">캡처 시간 동안 앱에서 기록한 응답 바이트가 없습니다.</div>}
            {trafficDebugTopPaths.length ? (
              <div className="admin-table admin-table-scroll">
                <div className="admin-table-head admin-course-grid">
                  <span>앱 상위 경로</span>
                  <span>응답 바이트</span>
                  <span>요청 / 상태</span>
                </div>
                {trafficDebugTopPaths.slice(0, 6).map((item) => (
                  <div className="admin-table-row admin-course-grid" key={`traffic-debug-path-${item.label}`}>
                    <span><strong>{item.label}</strong></span>
                    <span>{formatTrafficBytes(item.bytes)}</span>
                    <span>
                      <div>{`${item.requestCount || 0}건`}</div>
                      <div className="hint">{Object.entries(item.statuses || {}).map(([status, count]) => `${status} ${count}`).join(", ") || "-"}</div>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {trafficDebugAccessLogs.message ? <div className="inline-message is-info">{trafficDebugAccessLogs.message}</div> : null}
            {trafficDebugAccessTopPaths.length ? (
              <div className="admin-table admin-table-scroll">
                <div className="admin-table-head admin-course-grid">
                  <span>Access log 상위 경로</span>
                  <span>응답 바이트</span>
                  <span>요청 / 상태</span>
                </div>
                {trafficDebugAccessTopPaths.slice(0, 6).map((item) => (
                  <div className="admin-table-row admin-course-grid" key={`traffic-debug-access-${item.label}`}>
                    <span><strong>{item.label}</strong></span>
                    <span>{formatTrafficBytes(item.bytes)}</span>
                    <span>
                      <div>{`${item.requestCount || 0}건`}</div>
                      <div className="hint">{Object.entries(item.statuses || {}).map(([status, count]) => `${status} ${count}`).join(", ") || "-"}</div>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </AdminDisclosureCard>
      <AdminDisclosureCard
        defaultOpen
        title={`최근 ${props.apiMonitor?.quota?.usageTrend?.days || 5}일 OpenStack 자원 사용량`}
        subtitle="인스턴스, 네트워크, 블록 스토리지 계열 Quota 사용률을 최근 수집값 기준으로 표시합니다."
        summary={props.apiMonitor?.quota?.usageTrend?.resources?.length ? `${props.apiMonitor.quota.usageTrend.resources.length}개 자원 추이` : "수집 기록 없음"}
      >
        <OpenstackUsageTrendBlock quotaStatus={props.apiMonitor?.quota || {}} />
      </AdminDisclosureCard>
      <AdminDisclosureCard
        defaultOpen
        title="활성 랩 사용자 모니터링"
        subtitle="현재 운영 중인 랩과 최근 포털 활동을 함께 확인합니다."
        summary={activeLabUsers.length ? `활성 사용자 ${activeLabUsers.length}명 / 활성 랩 ${activeLabs.length}개` : "활성 랩 없음"}
      >
        <div className="admin-table admin-table-scroll">
          <div className="admin-table-head admin-course-grid">
            <span>사용자 / 과정</span>
            <span>랩 상태</span>
            <span>자원 / 트래픽</span>
          </div>
          {activeLabs.length ? activeLabs.map((lab) => {
            const course = trafficCourseMap.get(Number(lab.courseId));
            const username = String(lab.username || "").trim().toLowerCase();
            const recentlyActive = username && recentActiveUsernames.has(username);
            return (
              <div className="admin-table-row admin-course-grid" key={`active-lab-${lab.id}`}>
                <span>
                  <strong>{lab.userName || lab.username || "-"}</strong>
                  <div className="hint">{lab.username || "-"}</div>
                  <div className="hint">{course?.title || `과정 #${lab.courseId}`}</div>
                </span>
                <span>
                  <div>{labStatus(lab.status)}</div>
                  <div className="hint">{recentlyActive ? "최근 포털 활동 있음" : "최근 활동 미확인"}</div>
                  <div className="hint">{lab.trafficCheckedAt || lab.vmMetricsCheckedAt || "수집 대기"}</div>
                </span>
                <span>
                  <div>{`CPU ${Math.max(0, Number(lab.cpuUsagePercent || 0))}% / MEM ${Math.max(0, Number(lab.memoryUsagePercent || 0))}%`}</div>
                  <div className="hint">{`오늘 ${formatTrafficBytes(lab.trafficDailyBytes)} / 총 ${formatTrafficBytes(lab.trafficTotalBytes)}`}</div>
                  <div className="hint">{`Backend: ${lab.labBackendType || course?.labBackendType || "vm"}`}</div>
                </span>
              </div>
            );
          }) : <div className="hint">현재 활성 상태로 볼 랩이 없습니다.</div>}
        </div>
      </AdminDisclosureCard>
      <AdminDisclosureCard
        defaultOpen
        title="트래픽 사용량 전체 요약"
        subtitle="현재 운영 흐름에 남아 있는 트래픽 모니터링 랩만 집계합니다."
        summary={monitoredLabs.length ? `대상 ${monitoredLabs.length}개 / 오늘 ${formatTrafficBytes(todayTrafficBytes)} / 누적 ${formatTrafficBytes(totalTrafficBytes)}` : "트래픽 모니터링 미사용"}
      >
        <div className="admin-summary-grid">
          <article className="admin-summary-item">
            <span>모니터링 대상</span>
            <strong>{`${monitoredLabs.length}개`}</strong>
            <div className="hint">{`활성 ${monitoredActiveLabs.length}개 / 일시중지 ${trafficPausedLabs.length}개`}</div>
          </article>
          <article className="admin-summary-item">
            <span>오늘 사용량</span>
            <strong>{formatTrafficBytes(todayTrafficBytes)}</strong>
            <div className="hint">일일 집계 합산</div>
          </article>
          <article className="admin-summary-item">
            <span>누적 사용량</span>
            <strong>{formatTrafficBytes(totalTrafficBytes)}</strong>
            <div className="hint">전체 모니터링 랩 합산</div>
          </article>
          <article className="admin-summary-item">
            <span>한도 초과</span>
            <strong>{`${trafficExceededLabs.length}개`}</strong>
            <div className="hint">{trafficExceededLabs.length ? "정책 조치 확인 필요" : "초과 랩 없음"}</div>
          </article>
        </div>
        <div className="admin-summary-grid">
          {trafficTopLabs.length ? trafficTopLabs.map((lab) => {
            const course = trafficCourseMap.get(Number(lab.courseId));
            return (
              <article className="admin-summary-item" key={lab.id}>
                <span>{course?.title || `랩 #${lab.id}`}</span>
                <strong>{formatTrafficBytes(lab.trafficTotalBytes)}</strong>
                <div className="hint">{`${lab.userName || lab.username || "-"} / 오늘 ${formatTrafficBytes(lab.trafficDailyBytes)}`}</div>
                <div className="hint">{`CPU ${Math.max(0, Number(lab.cpuUsagePercent || 0))}% / MEM ${Math.max(0, Number(lab.memoryUsagePercent || 0))}%`}</div>
                <div className="hint">{lab.trafficExceeded ? "한도 초과" : lab.trafficCheckedAt || "수집 대기"}</div>
                <TrafficUsageBlock compact course={course} lab={lab} />
                <VmUsageBlock compact course={course} lab={lab} />
              </article>
            );
          }) : <div className="hint">현재 집계할 트래픽 모니터링 랩이 없습니다.</div>}
        </div>
        {trafficDetailLabs.length ? (
          <div className="admin-table admin-table-scroll">
            <div className="admin-table-head admin-course-grid">
              <span>사용자 / 과정</span>
              <span>트래픽 상태</span>
              <span>사용량 / 실사용률</span>
            </div>
            {trafficDetailLabs.map((lab) => {
              const course = trafficCourseMap.get(Number(lab.courseId));
              return (
                <div className="admin-table-row admin-course-grid" key={`traffic-${lab.id}`}>
                  <span>
                    <strong>{lab.userName || lab.username || "-"}</strong>
                    <div className="hint">{course?.title || `과정 #${lab.courseId}`}</div>
                  </span>
                  <span>
                    <div>{lab.trafficExceeded ? "한도 초과" : "정상"}</div>
                    <div className="hint">{`상태: ${labStatus(lab.status)}`}</div>
                  </span>
                  <span>
                    <div>{`오늘 ${formatTrafficBytes(lab.trafficDailyBytes)}`}</div>
                    <div className="hint">{`총 ${formatTrafficBytes(lab.trafficTotalBytes)}`}</div>
                    <div className="hint">{`CPU ${Math.max(0, Number(lab.cpuUsagePercent || 0))}% / MEM ${Math.max(0, Number(lab.memoryUsagePercent || 0))}%`}</div>
                    <div className="hint">{`Disk I/O ${formatTrafficBytes((Number(lab.diskReadBytes || 0) || 0) + (Number(lab.diskWriteBytes || 0) || 0))}`}</div>
                    <div className="hint">{lab.trafficCheckedAt || "수집 대기"}</div>
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </AdminDisclosureCard>
      <AdminDisclosureCard
        title={`최근 ${accessRecentDays}일 사용자 활동`}
        subtitle="오래된 접속 로그는 제외하고 사용자별 마지막 활동을 중심으로 집계합니다."
        summary={recentUserSummaries.length ? `${recentUserSummaries.length}명 표시 중` : recentAccessLogs.length ? `${recentAccessLogs.length}건 표시 중` : "기록 없음"}
      >
        <div className="admin-table admin-table-scroll">
          <div className="admin-table-head admin-course-grid">
            <span>사용자</span>
            <span>최근 활동</span>
            <span>접속 정보</span>
          </div>
          {recentUserSummaries.length ? recentUserSummaries.map((user) => (
            <div className="admin-table-row admin-course-grid" key={`recent-user-${user.userId || user.username}`}>
              <span>
                <strong>{user.userName || user.username || "-"}</strong>
                <div className="hint">{user.username || "-"}</div>
                <div className="hint">{`로그인 ${Number(user.loginCount || 0)}회 / 기록 ${Number(user.accessLogCount || 0)}건`}</div>
              </span>
              <span>
                <div>{user.lastEventType === "login" ? "로그인" : user.lastEventType === "logout" ? "로그아웃" : "활동"}</div>
                <div className="hint">{user.lastActiveAt ? formatDateTime(user.lastActiveAt) : "-"}</div>
              </span>
              <span>
                <div className="hint">{`IP: ${user.lastIpAddress || "-"}${Number(user.ipCount || 0) > 1 ? ` 외 ${Number(user.ipCount || 0) - 1}개` : ""}`}</div>
                <div className="hint">{user.lastUserAgent || "-"}</div>
              </span>
            </div>
          )) : recentAccessLogs.length ? recentAccessLogs.map((log) => (
            <div className="admin-table-row admin-course-grid" key={log.id}>
              <span>
                <strong>{log.userName || log.username || "-"}</strong>
                <div className="hint">{log.username || "-"}</div>
              </span>
              <span>
                <div>{log.eventType === "login" ? "로그인" : log.eventType === "logout" ? "로그아웃" : "활동"}</div>
                <div className="hint">{log.createdAt ? formatDateTime(log.createdAt) : "-"}</div>
              </span>
              <span>
                <div className="hint">{`IP: ${log.ipAddress || "-"}`}</div>
                <div className="hint">{log.userAgent || "-"}</div>
              </span>
            </div>
          )) : <div className="hint">{`최근 ${accessRecentDays}일 접속 로그가 없습니다.`}</div>}
        </div>
      </AdminDisclosureCard>
    </section>
  );
}

function cleanupHasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasCleanupExposureResidue(item = {}, resourceType = "lab") {
  if (resourceType === "custom-lab") {
    return cleanupHasItems(item.requestedPublicDomains)
      || cleanupHasItems(item.publicDomains)
      || Boolean(item.publicEnabled)
      || Boolean(item.publicRequestPending);
  }
  return cleanupHasItems(item.requestedPublicDomains)
    || cleanupHasItems(item.publicDomains)
    || cleanupHasItems(item.requestedPublicTcpRoutes)
    || cleanupHasItems(item.publicTcpRoutes)
    || Boolean(item.publicEnabled)
    || Boolean(item.publicRequestPending)
    || Boolean(item.publicTcpEnabled)
    || Boolean(item.publicTcpRequestPending)
    || Boolean(item.externalSshEnabled)
    || Boolean(item.externalSshRequestPending)
    || Number(item.externalSshPort || 0) > 0
    || Boolean(item.externalRdpEnabled)
    || Boolean(item.externalRdpRequestPending)
    || Number(item.externalRdpPort || 0) > 0;
}

function hasCleanupRemoteRefs(item = {}) {
  return Boolean(
    item.stackId
      || item.stackName
      || item.instanceUuid
      || item.instanceIp
      || item.containerUuid
      || cleanupHasItems(item.vmNodes),
  );
}

function getCleanupAdvancedCounts(advancedConfig = {}) {
  const createdResources = advancedConfig?.createdResources || {};
  return [
    { key: "network", label: "네트워크", count: createdResources.network ? 1 : 0 },
    { key: "nodes", label: "VM 노드", count: Array.isArray(createdResources.nodes) ? createdResources.nodes.length : 0 },
    { key: "volumes", label: "볼륨", count: Array.isArray(createdResources.volumes) ? createdResources.volumes.length : 0 },
    { key: "loadBalancer", label: "로드밸런서", count: createdResources.loadBalancer ? 1 : 0 },
    { key: "database", label: "DB", count: createdResources.database ? 1 : 0 },
  ].filter((item) => item.count > 0);
}

function cleanupInactiveStatus(status) {
  return ["terminating", "terminated", "failed", "cancelled", "canceled"].includes(String(status || "").toLowerCase());
}

function shouldShowLabCleanupRetry(lab = {}) {
  const status = String(lab.status || "").toLowerCase();
  if (status === "terminating") return hasCleanupRemoteRefs(lab) || hasCleanupExposureResidue(lab);
  if (status === "failed") return hasCleanupRemoteRefs(lab);
  return false;
}

function shouldShowCustomLabCleanupRetry(request = {}) {
  const status = String(request.status || "").toLowerCase();
  const hasRefs = hasCleanupRemoteRefs(request) || Boolean(request.advancedConfig?.createdResources);
  if (status === "terminating") return hasRefs || hasCleanupExposureResidue(request, "custom-lab");
  if (status === "failed") return hasRefs;
  if (status === "running" && request.errorMessage) return hasRefs;
  return false;
}

function shouldShowCustomAdvancedCleanup(request = {}) {
  if (!request.advancedConfig?.createdResources || request.advancedConfig?.cleanedUpAt) return false;
  const status = String(request.status || "").toLowerCase();
  return ["terminating", "terminated", "failed"].includes(status) || Boolean(request.errorMessage);
}

function summarizeCleanupItem(item = {}, resourceType = "lab") {
  const resourceCounts = resourceType === "custom-lab" ? getCleanupAdvancedCounts(item.advancedConfig) : [];
  return {
    id: item.id,
    resourceType,
    resourceKey: `${resourceType}:${item.id}`,
    title: resourceType === "custom-lab"
      ? (item.title || item.stackName || `고급 랩 요청 #${item.id}`)
      : (item.courseTitle || item.stackName || `랩 요청 #${item.id}`),
    userName: item.userName || item.name || "",
    username: item.username || "",
    status: item.status || "",
    stackName: item.stackName || "",
    stackId: item.stackId || "",
    instanceUuid: item.instanceUuid || "",
    instanceIp: item.instanceIp || "",
    errorMessage: item.errorMessage || "",
    createdAt: item.createdAt || "",
    terminatedAt: item.terminatedAt || "",
    hasRemoteRefs: hasCleanupRemoteRefs(item),
    hasExposureResidue: hasCleanupExposureResidue(item, resourceType),
    hasAdvancedResources: resourceCounts.length > 0,
    advancedCleanedUpAt: item.advancedConfig?.cleanedUpAt || "",
    resourceCounts,
  };
}

function buildOpenstackCleanupReportFromProps(props) {
  const labs = Array.isArray(props.adminLabs) ? props.adminLabs : [];
  const customLabRequests = Array.isArray(props.adminCustomLabRequests) ? props.adminCustomLabRequests : [];
  const retryableLabs = labs.filter(shouldShowLabCleanupRetry).map((lab) => summarizeCleanupItem(lab, "lab"));
  const retryableCustomLabs = customLabRequests.filter(shouldShowCustomLabCleanupRetry).map((request) => summarizeCleanupItem(request, "custom-lab"));
  const advancedResourceResidues = customLabRequests.filter(shouldShowCustomAdvancedCleanup).map((request) => summarizeCleanupItem(request, "custom-lab"));
  const routeResidues = [
    ...labs
      .filter((lab) => cleanupInactiveStatus(lab.status) && hasCleanupExposureResidue(lab))
      .map((lab) => summarizeCleanupItem(lab, "lab")),
    ...customLabRequests
      .filter((request) => cleanupInactiveStatus(request.status) && hasCleanupExposureResidue(request, "custom-lab"))
      .map((request) => summarizeCleanupItem(request, "custom-lab")),
  ];
  const candidateKeys = new Set([
    ...retryableLabs,
    ...retryableCustomLabs,
    ...advancedResourceResidues,
    ...routeResidues,
  ].map((item) => item.resourceKey));

  return {
    retryableLabs,
    retryableCustomLabs,
    advancedResourceResidues,
    routeResidues,
    summary: {
      retryableLabs: retryableLabs.length,
      retryableCustomLabs: retryableCustomLabs.length,
      advancedResourceResidues: advancedResourceResidues.length,
      routeResidues: routeResidues.length,
      totalCandidates: candidateKeys.size,
    },
  };
}

const EXTENSION_CLEANUP_STATUSES = new Set([
  "failed",
  "error",
  "terminated",
  "deleted",
  "stopped",
  "rejected",
  "cancelled",
  "canceled",
]);

const EXTENSION_CLEANUP_RECORD_STATUSES = new Set([
  "deleted",
]);

function isExtensionCleanupRecordOnly(item = {}) {
  const status = String(item.status || item.state || "").trim().toLowerCase();
  return EXTENSION_CLEANUP_RECORD_STATUSES.has(status);
}

function isExtensionCleanupCandidate(item = {}) {
  const status = String(item.status || item.state || "").toLowerCase();
  const errorText = [
    item.errorMessage,
    item.statusReason,
    item.reviewNote,
    item.message,
  ].filter(Boolean).join(" ").toLowerCase();
  return EXTENSION_CLEANUP_STATUSES.has(status) || /failed|error|quota|forbidden|denied|cleanup|delete/.test(errorText);
}

function shouldDeleteSelfServiceVmRecord(item = {}) {
  const status = String(item.status || item.state || "").trim().toLowerCase();
  return ["failed", "terminated", "deleted"].includes(status);
}

function getExtensionOwnerLabel(item = {}) {
  const name = item.userName || item.user?.name || "";
  const username = item.username || "";
  if (name && username) return `${name} (${username})`;
  return name || username || "-";
}

function getExtensionStatusReason(item = {}) {
  return item.errorMessage || item.statusReason || item.reviewNote || item.message || "";
}

function buildExtensionCleanupItems(props) {
  const selfServiceVms = Array.isArray(props.selfServiceVms) ? props.selfServiceVms : [];
  const zunContainers = Array.isArray(props.zunContainers) ? props.zunContainers : [];
  const magnumClusters = Array.isArray(props.magnumClusters) ? props.magnumClusters : [];
  const troveInstances = Array.isArray(props.troveInstances) ? props.troveInstances : [];

  return [
    ...selfServiceVms.filter(isExtensionCleanupCandidate).map((vm) => ({
      id: vm.id,
      kind: "self-service-vm",
      resourceKey: `extension:self-service-vm:${vm.id}`,
      typeLabel: "사용자화 VM",
      title: vm.stackName || vm.name || `사용자화 VM #${vm.id}`,
      owner: getExtensionOwnerLabel(vm),
      status: vm.status,
      reason: getExtensionStatusReason(vm),
      targetTab: "selfServiceVms",
      impact: buildAdminVmRequestImpact(vm, props.platformStatus),
      details: [
        vm.projectName ? `프로젝트: ${vm.projectName}` : "",
        vm.flavor ? `Flavor: ${vm.flavor}` : "",
        vm.instanceCount ? `개수: ${vm.instanceCount}` : "",
        vm.instanceIp ? `IP: ${vm.instanceIp}` : "",
        vm.stackId ? `Stack ID: ${vm.stackId}` : "",
      ].filter(Boolean),
      actions: ["terminate"],
    })),
    ...zunContainers.filter(isExtensionCleanupCandidate).map((container) => ({
      id: container.id,
      kind: "zun-container",
      resourceKey: `extension:zun-container:${container.id}`,
      typeLabel: "컨테이너",
      title: container.name || `컨테이너 #${container.id}`,
      owner: getExtensionOwnerLabel(container),
      status: container.status || container.state,
      reason: getExtensionStatusReason(container),
      targetTab: "zun",
      impact: buildAdminContainerCleanupImpact(container),
      details: [
        container.image ? `이미지: ${container.image}` : "",
        container.uuid ? `UUID: ${container.uuid}` : "",
        container.address ? `주소: ${container.address}` : "",
        container.port ? `포트: ${container.port}` : "",
      ].filter(Boolean),
      actions: ["refresh", "delete"],
    })),
    ...magnumClusters.filter(isExtensionCleanupCandidate).map((cluster) => ({
      id: cluster.id,
      kind: "magnum-cluster",
      resourceKey: `extension:magnum-cluster:${cluster.id}`,
      typeLabel: "Kubernetes",
      title: cluster.name || `클러스터 #${cluster.id}`,
      owner: getExtensionOwnerLabel(cluster),
      status: cluster.status,
      reason: getExtensionStatusReason(cluster),
      targetTab: "magnum",
      impact: buildAdminMagnumCleanupImpact(cluster),
      details: [
        cluster.clusterTemplateName ? `CAPO 프로파일: ${cluster.clusterTemplateName}` : "",
        cluster.nodeCount ? `노드: ${cluster.nodeCount}` : "",
        cluster.masterCount ? `마스터: ${cluster.masterCount}` : "",
        cluster.clusterUuid ? `UUID: ${cluster.clusterUuid}` : "",
      ].filter(Boolean),
      actions: ["refresh", "delete"],
    })),
    ...troveInstances.filter(isExtensionCleanupCandidate).map((instance) => ({
      id: instance.id,
      kind: "trove-instance",
      resourceKey: `extension:trove-instance:${instance.id}`,
      typeLabel: "데이터베이스",
      title: instance.name || `DB #${instance.id}`,
      owner: getExtensionOwnerLabel(instance),
      status: instance.status,
      reason: getExtensionStatusReason(instance),
      targetTab: "trove",
      impact: buildAdminTroveCleanupImpact(instance, props.platformStatus),
      details: [
        instance.datastoreType ? `Datastore: ${instance.datastoreType}${instance.datastoreVersion ? ` ${instance.datastoreVersion}` : ""}` : "",
        instance.flavor ? `Flavor: ${instance.flavor}` : "",
        instance.sizeGb ? `볼륨: ${instance.sizeGb}GB` : "",
        instance.hostname ? `Host: ${instance.hostname}` : "",
      ].filter(Boolean),
      actions: ["refresh", "delete"],
    })),
  ];
}

function cleanupStatusChipClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "failed") return "is-error";
  if (normalized === "terminating" || normalized === "provisioning") return "is-warn";
  if (normalized === "terminated" || normalized === "cancelled" || normalized === "canceled") return "is-muted";
  if (normalized === "running") return "is-success";
  return "is-muted";
}

function isExtensionCleanupUrgent(item = {}) {
  const status = String(item.status || "").trim().toLowerCase();
  const reason = String(item.reason || "").trim().toLowerCase();
  return ["failed", "error"].includes(status)
    || /quota|forbidden|denied|failed|error|unauthorized|keystone|timeout/.test(reason);
}

function isExtensionCleanupInactive(item = {}) {
  const status = String(item.status || "").trim().toLowerCase();
  return ["terminated", "deleted", "stopped", "rejected", "cancelled", "canceled"].includes(status);
}

function formatCleanupResourceCounts(item) {
  const counts = Array.isArray(item.resourceCounts) ? item.resourceCounts : [];
  return counts.length ? counts.map((resource) => `${resource.label} ${resource.count}`).join(" / ") : "기록 없음";
}

function getCleanupItemSearchText(item = {}) {
  return [
    item.title,
    item.userName,
    item.username,
    item.status,
    item.stackName,
    item.stackId,
    item.instanceUuid,
    item.instanceIp,
    item.id ? `#${item.id}` : "",
    item.resourceType === "custom-lab" ? "고급 랩 주문" : "랩 요청",
  ].filter(Boolean).join(" ").toLowerCase();
}

async function postOpenstackCleanupAction(path, body) {
  const { api: requestApi } = await import("./portal-state.js");
  return requestApi(path, { method: "POST", body });
}

async function getOpenstackCleanupAction(path) {
  const { api: requestApi } = await import("./portal-state.js");
  return requestApi(path);
}

async function refreshOpenstackCleanupData(props) {
  if (typeof props.loadAdmin === "function") {
    await props.loadAdmin();
    return;
  }
  const refreshTasks = [props.loadLabs, props.loadCustomLabRequests].filter((task) => typeof task === "function");
  await Promise.all(refreshTasks.map((task) => task()));
}

function OpenstackCleanupSection({ title, subtitle, items, emptyText, renderActions }) {
  return (
    <div className="admin-simple-card">
      <div className="admin-card-header">
        <strong>{title}</strong>
        <span className="hint">{subtitle}</span>
      </div>
      <div className="admin-table admin-table-scroll">
        <div className="admin-table-head admin-course-grid">
          <span>대상</span>
          <span>참조 / 상태</span>
          <span>작업</span>
        </div>
        {items.length ? items.map((item) => (
          <div className="admin-table-row admin-course-grid" key={item.resourceKey}>
            <span>
              <strong>{item.title}</strong>
              <div className="hint">{`${item.userName || item.username || "-"}${item.username ? ` (${item.username})` : ""}`}</div>
              <div className="hint">{item.resourceType === "custom-lab" ? "고급 랩 주문" : "랩 요청"}</div>
              {item.terminatedAt ? <div className="hint">{`종료 시각: ${formatDateTime(item.terminatedAt)}`}</div> : null}
            </span>
            <span>
              <span className={`status-chip ${cleanupStatusChipClass(item.status)}`}>{labStatus(item.status) || item.status || "-"}</span>
              <div className="hint">{`Stack: ${item.stackName || item.stackId || "-"}`}</div>
              <div className="hint">{`IP: ${item.instanceIp || "-"}`}</div>
              {item.hasAdvancedResources ? <div className="hint">{`고급 리소스: ${formatCleanupResourceCounts(item)}`}</div> : null}
              {item.advancedCleanedUpAt ? <div className="hint">{`고급 정리 완료: ${formatDateTime(item.advancedCleanedUpAt)}`}</div> : null}
              {item.errorMessage ? <div className="hint">{item.errorMessage}</div> : null}
            </span>
            <div className="admin-inline-actions">
              {renderActions(item)}
            </div>
          </div>
        )) : <div className="empty-state">{emptyText}</div>}
      </div>
    </div>
  );
}

function AdminCleanupSafetyPreview({
  extensionResidues = [],
  heatStackData = {},
  selectedExposureKeys = [],
  selectedHeatStackKeys = [],
  summary = {},
}) {
  const stacks = Array.isArray(heatStackData?.stacks) ? heatStackData.stacks : [];
  const heatStackKeySet = new Set(selectedHeatStackKeys);
  const selectedHeatStacks = stacks.filter((stack) => heatStackKeySet.has(getHeatStackRowKey(stack)) && !stack.deleteBlocked);
  const blockedHeatStacks = stacks.filter((stack) => stack.deleteBlocked).length;
  const urgentExtensions = extensionResidues.filter(isExtensionCleanupUrgent).length;
  const inactiveExtensions = extensionResidues.filter(isExtensionCleanupInactive).length;
  const retryableCount = Number(summary.retryableLabs || 0) + Number(summary.retryableCustomLabs || 0);
  const advancedResidueCount = Number(summary.advancedResourceResidues || 0);
  const selectedExposureCount = selectedExposureKeys.length;
  const hasSelectedAction = selectedHeatStacks.length || selectedExposureCount;
  const focusCount = selectedHeatStacks.length + selectedExposureCount + urgentExtensions + retryableCount + advancedResidueCount;
  const safetyItems = [
    {
      label: "선택 HeatStack",
      value: selectedHeatStacks.length,
      detail: selectedHeatStacks.length ? "OpenStack에서 실제 Stack 삭제 대상입니다." : "선택된 Stack이 없습니다.",
      tone: selectedHeatStacks.length ? "danger" : "muted",
    },
    {
      label: "선택 노출값",
      value: selectedExposureCount,
      detail: selectedExposureCount ? "공개 도메인/TCP/SSH/RDP 연결 값을 DB에서 정리합니다." : "선택된 공개 노출값이 없습니다.",
      tone: selectedExposureCount ? "warning" : "muted",
    },
    {
      label: "우선 조치",
      value: urgentExtensions,
      detail: urgentExtensions ? "실패/권한/Quota 오류 기록을 먼저 확인하세요." : "즉시 조치할 확장 기능 오류는 없습니다.",
      tone: urgentExtensions ? "danger" : "success",
    },
    {
      label: "자동 차단",
      value: blockedHeatStacks,
      detail: blockedHeatStacks ? "DB 참조가 있는 Stack은 삭제 버튼과 선택이 차단됩니다." : "현재 조회 결과에서 차단된 Stack은 없습니다.",
      tone: blockedHeatStacks ? "warning" : "success",
    },
  ];
  return (
    <div className={`admin-cleanup-safety-preview ${focusCount ? "is-attention" : "is-clear"}`}>
      <div className="admin-cleanup-safety-head">
        <div>
          <span className="eyebrow">Cleanup Safety</span>
          <strong>정리 전 영향 미리보기</strong>
          <small>{hasSelectedAction ? "선택한 항목과 우선 조치 대상을 실행 전에 한 번 더 확인하세요." : "삭제/정리 작업을 시작하기 전에 후보와 차단 상태를 먼저 확인합니다."}</small>
        </div>
        <span className={`status-chip ${focusCount ? "is-warn" : "is-success"}`}>{focusCount ? `확인 ${focusCount}건` : "안정"}</span>
      </div>
      <div className="admin-cleanup-safety-grid">
        {safetyItems.map((item) => (
          <article className={`is-${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </article>
        ))}
      </div>
      <div className="admin-cleanup-safety-order">
        <strong>권장 순서</strong>
        <span>1. HeatStack 조회</span>
        <span>2. 확장 기능 상태 갱신</span>
        <span>3. 공개 노출값 정리</span>
        <span>4. 자원 정리 재시도</span>
      </div>
      {inactiveExtensions ? <div className="hint">{`종료/삭제 상태 확장 기능 ${inactiveExtensions}건은 실제 잔여 자원 확인 후 기록 정리 여부를 판단하세요.`}</div> : null}
    </div>
  );
}

function OpenstackExtensionCleanupSection({ items, busyKey, onOpenAdminTab, onRunAction }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const searchInput = useImeBufferedInput(search, setSearch);
  const query = String(search || "").trim().toLowerCase();
  const recordItems = items.filter(isExtensionCleanupRecordOnly);
  const activeItems = items.filter((item) => !isExtensionCleanupRecordOnly(item));
  const urgentCount = activeItems.filter(isExtensionCleanupUrgent).length;
  const inactiveCount = activeItems.filter(isExtensionCleanupInactive).length;
  const filteredItems = activeItems.filter((item) => {
    const typeMatches = filter === "all"
      || item.kind === filter
      || (filter === "urgent" && isExtensionCleanupUrgent(item))
      || (filter === "inactive" && isExtensionCleanupInactive(item));
    const searchText = [
      item.typeLabel,
      item.title,
      item.owner,
      item.status,
      item.reason,
      ...(item.details || []),
      formatAdminCleanupImpactCostLabel(item.impact),
      ...(item.impact?.metrics || []).map((metric) => `${metric.label} ${formatAdminImpactMetric(metric)}`),
    ].filter(Boolean).join(" ").toLowerCase();
    return typeMatches && (!query || searchText.includes(query));
  });
  const typeOptions = [
    { key: "all", label: "전체", count: activeItems.length },
    { key: "urgent", label: "우선 조치", count: urgentCount },
    { key: "inactive", label: "종료/삭제", count: inactiveCount },
    { key: "self-service-vm", label: "사용자화 VM", count: activeItems.filter((item) => item.kind === "self-service-vm").length },
    { key: "zun-container", label: "컨테이너", count: activeItems.filter((item) => item.kind === "zun-container").length },
    { key: "magnum-cluster", label: "Kubernetes", count: activeItems.filter((item) => item.kind === "magnum-cluster").length },
    { key: "trove-instance", label: "데이터베이스", count: activeItems.filter((item) => item.kind === "trove-instance").length },
  ];

  const renderActionButtons = (item) => {
    const refreshAction = item.kind === "zun-container"
      ? "refreshZun"
      : item.kind === "magnum-cluster"
        ? "refreshMagnum"
        : item.kind === "trove-instance"
          ? "refreshTrove"
          : "";
    const deleteAction = item.kind === "self-service-vm"
      ? (shouldDeleteSelfServiceVmRecord(item) ? "deleteSelfServiceVmRecord" : "terminateSelfServiceVm")
      : item.kind === "zun-container"
        ? "deleteZun"
        : item.kind === "magnum-cluster"
          ? "deleteMagnum"
          : item.kind === "trove-instance"
            ? "deleteTrove"
            : "";
    return (
      <>
        {refreshAction ? (
          <button
            className="mini-btn"
            disabled={busyKey === `${item.resourceKey}:refresh`}
            onClick={() => onRunAction(item, refreshAction)}
            type="button"
          >
            {busyKey === `${item.resourceKey}:refresh` ? "갱신 중" : "상태 갱신"}
          </button>
        ) : null}
        {deleteAction ? (
          <button
            className="mini-btn danger-mini-btn"
            disabled={busyKey === `${item.resourceKey}:delete`}
            onClick={() => onRunAction(item, deleteAction)}
            type="button"
          >
            {busyKey === `${item.resourceKey}:delete` ? "요청 중" : item.kind === "self-service-vm" && deleteAction === "deleteSelfServiceVmRecord" ? "기록 삭제" : item.kind === "self-service-vm" ? "삭제/정리" : "삭제"}
          </button>
        ) : null}
        <button className="mini-btn" onClick={() => onOpenAdminTab?.(item.targetTab)} type="button">관련 화면</button>
      </>
    );
  };

  return (
    <div className="admin-simple-card">
      <div className="admin-card-header">
        <div>
          <strong>확장 기능 잔여 자원</strong>
          <div className="hint">사용자화 VM, 컨테이너, Kubernetes, DB의 실패/종료 기록을 모아 정리 흐름으로 바로 이동합니다.</div>
        </div>
        <div className="admin-inline-actions">
          <span className={`status-chip ${urgentCount ? "is-error" : activeItems.length ? "is-warn" : "is-success"}`}>{urgentCount ? `우선 조치 ${urgentCount}건` : activeItems.length ? `${activeItems.length}건 확인` : "정상"}</span>
          {inactiveCount ? <span className="status-chip is-muted">{`종료/삭제 ${inactiveCount}건`}</span> : null}
          {recordItems.length ? <span className="status-chip is-muted">{`처리 기록 ${recordItems.length}건`}</span> : null}
        </div>
      </div>
      <div className="admin-history-search">
        <input {...searchInput} placeholder="자원명, 사용자, 상태, 오류 검색" type="search" />
        <select onChange={(event) => setFilter(event.target.value)} value={filter}>
          {typeOptions.map((option) => <option key={option.key} value={option.key}>{`${option.label} (${option.count})`}</option>)}
        </select>
      </div>
      <div className="admin-table admin-table-scroll">
        <div className="admin-table-head admin-course-grid">
          <span>자원</span>
          <span>상태 / 원인</span>
          <span>작업</span>
        </div>
        {filteredItems.length ? filteredItems.map((item) => (
          <div className="admin-table-row admin-course-grid" key={item.resourceKey}>
            <span>
              <span className="status-chip is-muted">{item.typeLabel}</span>
              <strong>{item.title}</strong>
              <div className="hint">{item.owner}</div>
              {(item.details || []).slice(0, 4).map((detail) => <div className="hint" key={detail}>{detail}</div>)}
            </span>
            <span>
              <span className={`status-chip ${cleanupStatusChipClass(item.status)}`}>{labStatus(item.status) || item.status || "-"}</span>
              {item.reason ? <div className="hint">{item.reason}</div> : <div className="hint">상태 기록 기준으로 정리 후보에 포함되었습니다.</div>}
              <AdminCleanupImpactSummary impact={item.impact} />
            </span>
            <div className="admin-inline-actions">
              {renderActionButtons(item)}
            </div>
          </div>
        )) : <div className="empty-state">{activeItems.length ? "검색 조건에 맞는 잔여 자원이 없습니다." : "정리 후보로 보이는 확장 기능 잔여 자원이 없습니다."}</div>}
      </div>
      {recordItems.length ? (
        <details className="admin-cleanup-records">
          <summary>{`처리 기록 ${recordItems.length}건 보기`}</summary>
          <div className="admin-cleanup-record-list">
            {recordItems.slice(0, 12).map((item) => (
              <div className="admin-cleanup-record-row" key={`record-${item.resourceKey}`}>
                <strong>{item.title}</strong>
                <span>{item.typeLabel}</span>
                <span>{labStatus(item.status) || item.status || "-"}</span>
                <small>{item.owner}</small>
              </div>
            ))}
            {recordItems.length > 12 ? <div className="hint">{`외 ${recordItems.length - 12}건은 관련 화면 또는 작업 로그에서 확인하세요.`}</div> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function OpenstackExposureCleanupSection({
  items,
  busyKey,
  completedItems = [],
  completedKeys,
  selectedKeys,
  onCleanupAll,
  onCleanupOne,
  onCleanupSelected,
  onSelectKeys,
}) {
  const [search, setSearch] = useState("");
  const searchInput = useImeBufferedInput(search, setSearch);
  const query = String(search || "").trim().toLowerCase();
  const selectedKeySet = new Set(selectedKeys);
  const completedKeySet = new Set(completedKeys);
  const visibleItems = items.filter((item) => !completedKeySet.has(item.resourceKey));
  const filteredItems = query
    ? visibleItems.filter((item) => getCleanupItemSearchText(item).includes(query))
    : visibleItems;
  const selectableFilteredKeys = filteredItems
    .filter((item) => !completedKeySet.has(item.resourceKey))
    .map((item) => item.resourceKey);
  const selectableFilteredKeySet = new Set(selectableFilteredKeys);
  const selectedItems = items.filter((item) => selectedKeySet.has(item.resourceKey) && !completedKeySet.has(item.resourceKey));
  const selectedVisibleCount = filteredItems.filter((item) => selectedKeySet.has(item.resourceKey)).length;
  const allFilteredSelected = selectableFilteredKeys.length > 0 && selectableFilteredKeys.every((key) => selectedKeySet.has(key));

  const toggleItem = (resourceKey) => {
    onSelectKeys(
      selectedKeySet.has(resourceKey)
        ? selectedKeys.filter((key) => key !== resourceKey)
        : Array.from(new Set([...selectedKeys, resourceKey])),
    );
  };

  const toggleFilteredItems = () => {
    if (!selectableFilteredKeys.length) return;
    if (allFilteredSelected) {
      onSelectKeys(selectedKeys.filter((key) => !selectableFilteredKeySet.has(key)));
      return;
    }
    onSelectKeys(Array.from(new Set([...selectedKeys, ...selectableFilteredKeys])));
  };

  return (
    <div className="admin-simple-card">
      <div className="admin-card-header">
        <div>
          <strong>공개 노출값 잔여 정리</strong>
          <div className="hint">종료/실패 상태에 남아 있는 공개 도메인, TCP, SSH/RDP 값을 제거합니다.</div>
        </div>
        <div className="admin-inline-actions">
          <span className="hint">{`잔여 ${visibleItems.length}건 / 전체 ${items.length}건 / 선택 ${selectedItems.length}건`}</span>
          <button
            className="mini-btn"
            disabled={!selectedItems.length || Boolean(busyKey)}
            onClick={() => onCleanupSelected(selectedItems)}
            type="button"
          >
            {busyKey === "exposure:bulk" ? "선택 정리 중" : "선택 노출값 정리"}
          </button>
          <button
            className="mini-btn danger-mini-btn"
            disabled={!visibleItems.length || Boolean(busyKey)}
            onClick={() => onCleanupAll(visibleItems)}
            type="button"
          >
            {busyKey === "exposure:all" ? "전체 정리 중" : "전체 잔여 정리"}
          </button>
        </div>
      </div>
      <div className="admin-history-search">
        <input
          type="search"
          {...searchInput}
          placeholder="사용자 이름, 아이디, 과정, Stack, IP 검색"
        />
        <button className="mini-btn" disabled={!selectableFilteredKeys.length || Boolean(busyKey)} onClick={toggleFilteredItems} type="button">
          {allFilteredSelected ? "검색 결과 선택 해제" : "검색 결과 선택"}
        </button>
        <button className="mini-btn" disabled={!selectedKeys.length || Boolean(busyKey)} onClick={() => onSelectKeys([])} type="button">선택 해제</button>
        {selectedVisibleCount ? <span className="hint">{`현재 검색 결과에서 ${selectedVisibleCount}건 선택됨`}</span> : null}
      </div>
      <div className="admin-table admin-table-scroll">
        <div className="admin-table-head admin-course-grid">
          <span>대상</span>
          <span>참조 / 상태</span>
          <span>작업</span>
        </div>
        {filteredItems.length ? filteredItems.map((item) => {
          const key = `exposure:${item.resourceKey}`;
          return (
            <div className="admin-table-row admin-course-grid" key={item.resourceKey}>
              <span>
                <label className="admin-filter-inline">
                  <input
                    checked={selectedKeySet.has(item.resourceKey)}
                    disabled={Boolean(busyKey)}
                    onChange={() => toggleItem(item.resourceKey)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{item.title}</strong>
                    <div className="hint">{`${item.userName || item.username || "-"}${item.username ? ` (${item.username})` : ""}`}</div>
                  </span>
                </label>
                <div className="hint">{item.resourceType === "custom-lab" ? "고급 랩 주문" : "랩 요청"}</div>
                {item.terminatedAt ? <div className="hint">{`종료 시각: ${formatDateTime(item.terminatedAt)}`}</div> : null}
              </span>
              <span>
                <span className={`status-chip ${cleanupStatusChipClass(item.status)}`}>{labStatus(item.status) || item.status || "-"}</span>
                <div className="hint">{`Stack: ${item.stackName || item.stackId || "-"}`}</div>
                <div className="hint">{`IP: ${item.instanceIp || "-"}`}</div>
                {item.errorMessage ? <div className="hint">{item.errorMessage}</div> : null}
              </span>
              <div className="admin-inline-actions">
                <button
                  className="mini-btn"
                  disabled={Boolean(busyKey)}
                  onClick={() => onCleanupOne(item)}
                  type="button"
                >
                  {busyKey === key ? "실행 중" : "노출값 정리"}
                </button>
              </div>
            </div>
          );
        }) : <div className="empty-state">{visibleItems.length ? "검색 조건에 맞는 공개 노출값 잔여가 없습니다." : "정리 완료: 종료된 리소스에 남은 공개 노출값이 없습니다."}</div>}
      </div>
      {completedItems.length ? (
        <details className="admin-cleanup-records">
          <summary>{`노출값 정리 완료 ${completedItems.length}건 보기`}</summary>
          <div className="admin-cleanup-record-list">
            {completedItems.slice(0, 12).map((item) => (
              <div className="admin-cleanup-record-row" key={`exposure-completed-${item.resourceKey}`}>
                <strong>{item.title}</strong>
                <span>{item.resourceType === "custom-lab" ? "고급 랩" : "랩 요청"}</span>
                <span>노출값 정리 완료</span>
                <small>{item.userName || item.username || "-"}</small>
              </div>
            ))}
            {completedItems.length > 12 ? <div className="hint">{`외 ${completedItems.length - 12}건은 작업 로그에서 확인하세요.`}</div> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function getHeatStackRowKey(stack = {}) {
  return `${stack.stackName || "-"}:${stack.stackId || "-"}`;
}

function heatStackStatusChipClass(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized.endsWith("_FAILED")) return "is-error";
  if (normalized.endsWith("_IN_PROGRESS")) return "is-warn";
  if (normalized.endsWith("_COMPLETE")) return "is-success";
  return "is-muted";
}

function formatHeatStackAge(stack = {}) {
  if (stack.ageDays == null) return "생성일 확인 필요";
  return stack.ageDays === 0 ? "오늘 생성" : `${stack.ageDays}일 경과`;
}

function formatHeatStackReference(reference = {}) {
  const typeLabel = reference.resourceType === "custom-lab" ? "고급 랩" : "랩";
  const statusLabel = labStatus(reference.status) || reference.status || "-";
  return `${typeLabel} #${reference.resourceId || "-"} · ${reference.title || "-"} · ${statusLabel}`;
}

function filterHeatStacks(stacks = [], filter = "recommended") {
  if (filter === "all") return stacks;
  if (filter === "recommended") return stacks.filter((stack) => stack.cleanupRecommended);
  if (filter === "unreferenced") return stacks.filter((stack) => Number(stack.referenceCount || 0) === 0);
  if (filter === "referenced") return stacks.filter((stack) => Number(stack.referenceCount || 0) > 0);
  if (filter === "blocked") return stacks.filter((stack) => stack.deleteBlocked);
  if (filter === "failed") return stacks.filter((stack) => String(stack.status || "").toUpperCase().endsWith("_FAILED"));
  return stacks;
}

function buildOpenstackHeatStackCleanupPath({ projectScope = "service", olderThanDays = 7 } = {}) {
  const params = new URLSearchParams();
  params.set("projectScope", projectScope);
  params.set("olderThanDays", String(Math.max(0, Number(olderThanDays || 0) || 0)));
  params.set("limit", "200");
  return `/api/admin/openstack-cleanup/heat-stacks?${params.toString()}`;
}

function OpenstackHeatStackCleanupSection({
  busyKey,
  data,
  filter,
  hasLoaded,
  olderThanDays,
  onDeleteOne,
  onDeleteSelected,
  onFilterChange,
  onOlderThanDaysChange,
  onProjectScopeChange,
  onRefresh,
  onSelectKeys,
  projectScope,
  selectedKeys,
}) {
  const stacks = Array.isArray(data?.stacks) ? data.stacks : [];
  const filteredStacks = filterHeatStacks(stacks, filter);
  const selectedKeySet = new Set(selectedKeys);
  const selectableFilteredKeys = filteredStacks
    .filter((stack) => !stack.deleteBlocked)
    .map((stack) => getHeatStackRowKey(stack));
  const selectableFilteredKeySet = new Set(selectableFilteredKeys);
  const selectedItems = stacks.filter((stack) => selectedKeySet.has(getHeatStackRowKey(stack)) && !stack.deleteBlocked);
  const allFilteredSelected = selectableFilteredKeys.length > 0 && selectableFilteredKeys.every((key) => selectedKeySet.has(key));
  const isBusy = Boolean(busyKey);

  const toggleItem = (stack) => {
    if (stack.deleteBlocked) return;
    const key = getHeatStackRowKey(stack);
    onSelectKeys(
      selectedKeySet.has(key)
        ? selectedKeys.filter((item) => item !== key)
        : Array.from(new Set([...selectedKeys, key])),
    );
  };

  const toggleFilteredItems = () => {
    if (!selectableFilteredKeys.length) return;
    if (allFilteredSelected) {
      onSelectKeys(selectedKeys.filter((key) => !selectableFilteredKeySet.has(key)));
      return;
    }
    onSelectKeys(Array.from(new Set([...selectedKeys, ...selectableFilteredKeys])));
  };

  return (
    <div className="admin-simple-card openstack-heat-cleanup-card">
      <div className="admin-card-header">
        <div>
          <strong>OpenStack HeatStack 직접 정리</strong>
          <div className="hint">OpenStack에 남아 있는 과거 HeatStack을 조회하고, DB에서 사용 중이 아닌 항목만 선택 삭제합니다.</div>
        </div>
        <div className="admin-inline-actions">
          <span className="hint">{`표시 ${filteredStacks.length}건 / 전체 ${stacks.length}건 / 선택 ${selectedItems.length}건`}</span>
          <button
            className="mini-btn danger-mini-btn"
            disabled={!selectedItems.length || isBusy}
            onClick={() => onDeleteSelected(selectedItems)}
            type="button"
          >
            {busyKey === "heat:delete:bulk" ? "선택 삭제 중" : "선택 HeatStack 삭제"}
          </button>
        </div>
      </div>
      <div className="admin-history-search openstack-heat-cleanup-tools">
        <label className="admin-filter-inline">
          <span>프로젝트</span>
          <select disabled={isBusy} onChange={(event) => onProjectScopeChange(event.target.value)} value={projectScope}>
            <option value="service">일반 랩</option>
            <option value="poc">고급 랩</option>
          </select>
        </label>
        <label className="admin-filter-inline">
          <span>오래된 기준</span>
          <input
            disabled={isBusy}
            min="0"
            onChange={(event) => onOlderThanDaysChange(event.target.value)}
            type="number"
            value={olderThanDays}
          />
          <span>일</span>
        </label>
        <label className="admin-filter-inline">
          <span>보기</span>
          <select disabled={isBusy} onChange={(event) => onFilterChange(event.target.value)} value={filter}>
            <option value="recommended">정리 추천</option>
            <option value="unreferenced">DB 참조 없음</option>
            <option value="failed">실패 상태</option>
            <option value="referenced">DB 참조 있음</option>
            <option value="blocked">삭제 차단</option>
            <option value="all">전체</option>
          </select>
        </label>
        <button className="mini-btn refresh-btn" disabled={isBusy} onClick={onRefresh} type="button">
          {busyKey === "heat:list" ? "조회 중" : "HeatStack 조회"}
        </button>
        <button className="mini-btn" disabled={!selectableFilteredKeys.length || isBusy} onClick={toggleFilteredItems} type="button">
          {allFilteredSelected ? "표시 항목 선택 해제" : "표시 항목 선택"}
        </button>
        <button className="mini-btn" disabled={!selectedKeys.length || isBusy} onClick={() => onSelectKeys([])} type="button">선택 해제</button>
      </div>
      {data?.projectName ? (
        <div className="openstack-heat-cleanup-summary">
          <span className="status-chip is-muted">{`프로젝트: ${data.projectName}`}</span>
          <span className="status-chip is-success">{`정리 추천 ${data.summary?.cleanupRecommended || 0}건`}</span>
          <span className="status-chip is-warn">{`삭제 차단 ${data.summary?.deleteBlocked || 0}건`}</span>
          <span className="status-chip is-muted">{`DB 참조 ${data.summary?.referenced || 0}건`}</span>
        </div>
      ) : null}
      <div className="admin-table admin-table-scroll">
        <div className="admin-table-head admin-heat-stack-grid">
          <span>HeatStack</span>
          <span>상태 / 경과</span>
          <span>DB 참조</span>
          <span>작업</span>
        </div>
        {filteredStacks.length ? filteredStacks.map((stack) => {
          const key = getHeatStackRowKey(stack);
          const selected = selectedKeySet.has(key);
          return (
            <div className="admin-table-row admin-heat-stack-grid" key={key}>
              <span>
                <label className="admin-filter-inline">
                  <input
                    checked={selected}
                    disabled={stack.deleteBlocked || isBusy}
                    onChange={() => toggleItem(stack)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{stack.stackName}</strong>
                    <div className="hint">{stack.stackId}</div>
                  </span>
                </label>
                <div className="hint">{stack.creationTime ? `생성: ${formatDateTime(stack.creationTime)}` : "생성일 없음"}</div>
              </span>
              <span>
                <span className={`status-chip ${heatStackStatusChipClass(stack.status)}`}>{stack.status || "-"}</span>
                <div className="hint">{formatHeatStackAge(stack)}</div>
                {stack.cleanupRecommended ? <div className="hint">정리 추천 대상</div> : null}
                {stack.statusReason ? <div className="hint">{stack.statusReason}</div> : null}
              </span>
              <span>
                <span className={`status-chip ${stack.deleteBlocked ? "is-warn" : stack.referenceCount ? "is-muted" : "is-success"}`}>
                  {stack.deleteBlocked ? "삭제 차단" : stack.referenceCount ? "참조 있음" : "참조 없음"}
                </span>
                {stack.references?.length ? stack.references.slice(0, 3).map((reference) => (
                  <div className="hint" key={`${reference.resourceType}:${reference.resourceId}`}>{formatHeatStackReference(reference)}</div>
                )) : <div className="hint">DB 기록과 연결되지 않은 Stack입니다.</div>}
                {stack.deleteBlockedReason ? <div className="hint">{stack.deleteBlockedReason}</div> : null}
              </span>
              <div className="admin-inline-actions">
                <button
                  className="mini-btn danger-mini-btn"
                  disabled={stack.deleteBlocked || isBusy}
                  onClick={() => onDeleteOne(stack)}
                  type="button"
                >
                  {busyKey === `heat:delete:${key}` ? "삭제 중" : "삭제"}
                </button>
              </div>
            </div>
          );
        }) : <div className="empty-state">{hasLoaded ? "조건에 맞는 HeatStack이 없습니다." : "HeatStack 조회 버튼을 눌러 OpenStack에 남은 Stack을 확인해 주세요."}</div>}
      </div>
    </div>
  );
}

export function AdminOpenstackCleanupTab(props) {
  const [busyKey, setBusyKey] = useState("");
  const [selectedExposureKeys, setSelectedExposureKeys] = useState([]);
  const [completedExposureKeys, setCompletedExposureKeys] = useState([]);
  const [completedExposureItems, setCompletedExposureItems] = useState([]);
  const [status, setStatus] = useState({ tone: "info", message: "현재 관리자 데이터 기준으로 정리 후보를 표시합니다." });
  const [heatStackProjectScope, setHeatStackProjectScope] = useState("service");
  const [heatStackOlderThanDays, setHeatStackOlderThanDays] = useState("7");
  const [heatStackFilter, setHeatStackFilter] = useState("recommended");
  const [heatStackData, setHeatStackData] = useState({ stacks: [], summary: null, projectName: "" });
  const [heatStackLoaded, setHeatStackLoaded] = useState(false);
  const [selectedHeatStackKeys, setSelectedHeatStackKeys] = useState([]);
  const report = buildOpenstackCleanupReportFromProps(props);
  const summary = report.summary;
  const extensionResidues = buildExtensionCleanupItems(props);
  const totalCleanupCandidates = summary.totalCandidates + extensionResidues.length;
  const statusClass = status.tone === "error" ? "is-error" : status.tone === "success" ? "is-success" : "is-info";

  const refreshHeatStacks = async () => {
    setBusyKey("heat:list");
    setStatus({ tone: "info", message: "OpenStack HeatStack 목록을 조회 중입니다." });
    try {
      const response = await getOpenstackCleanupAction(buildOpenstackHeatStackCleanupPath({
        projectScope: heatStackProjectScope,
        olderThanDays: heatStackOlderThanDays,
      }));
      setHeatStackData(response || { stacks: [], summary: null, projectName: "" });
      setHeatStackLoaded(true);
      setSelectedHeatStackKeys([]);
      setStatus({
        tone: "success",
        message: `HeatStack ${response?.stacks?.length || 0}건을 조회했습니다. 정리 추천 ${response?.summary?.cleanupRecommended || 0}건입니다.`,
      });
    } catch (error) {
      setStatus({ tone: "error", message: error.message || "HeatStack 목록 조회 중 오류가 발생했습니다." });
    } finally {
      setBusyKey("");
    }
  };

  const refreshHeatStacksAfterDelete = async () => {
    const response = await getOpenstackCleanupAction(buildOpenstackHeatStackCleanupPath({
      projectScope: heatStackProjectScope,
      olderThanDays: heatStackOlderThanDays,
    }));
    setHeatStackData(response || { stacks: [], summary: null, projectName: "" });
    setHeatStackLoaded(true);
  };

  const runCleanupAction = async (path, body, successMessage, nextBusyKey, confirmMessage = "") => {
    if (confirmMessage && typeof window !== "undefined" && !window.confirm(confirmMessage)) {
      setStatus({ tone: "info", message: "정리 작업을 취소했습니다." });
      return;
    }
    setBusyKey(nextBusyKey);
    setStatus({ tone: "info", message: "정리 작업을 실행 중입니다." });
    try {
      const response = await postOpenstackCleanupAction(path, body);
      await refreshOpenstackCleanupData(props);
      setStatus({ tone: "success", message: response?.message || successMessage });
    } catch (error) {
      setStatus({ tone: "error", message: error.message || "정리 작업 중 오류가 발생했습니다." });
    } finally {
      setBusyKey("");
    }
  };

  const runHeatStackDelete = async (targetItems, nextBusyKey = "heat:delete:bulk") => {
    const targets = (Array.isArray(targetItems) ? targetItems : [targetItems])
      .filter(Boolean)
      .filter((stack) => stack.stackName && stack.stackId && !stack.deleteBlocked);
    if (!targets.length) {
      setStatus({ tone: "info", message: "삭제 가능한 HeatStack을 선택해 주세요." });
      return;
    }
    const confirmed = typeof window === "undefined"
      || window.confirm(`선택한 HeatStack ${targets.length}건을 OpenStack에서 삭제할까요? 이 작업은 되돌릴 수 없습니다.`);
    if (!confirmed) return;

    setBusyKey(nextBusyKey);
    setStatus({ tone: "info", message: targets.length > 1 ? `HeatStack ${targets.length}건을 삭제 중입니다.` : "HeatStack을 삭제 중입니다." });
    try {
      const response = await postOpenstackCleanupAction("/api/admin/openstack-cleanup/heat-stacks/delete", {
        projectScope: heatStackProjectScope,
        stacks: targets.map((stack) => ({ stackName: stack.stackName, stackId: stack.stackId })),
      });
      const deletedKeySet = new Set((response?.results || [])
        .filter((result) => result.ok)
        .map((result) => getHeatStackRowKey(result)));
      setSelectedHeatStackKeys((current) => current.filter((key) => !deletedKeySet.has(key)));
      await refreshHeatStacksAfterDelete();
      setStatus({
        tone: response?.failedCount ? "error" : "success",
        message: response?.message || `HeatStack ${targets.length}건을 삭제했습니다.`,
      });
    } catch (error) {
      setStatus({ tone: "error", message: error.message || "HeatStack 삭제 중 오류가 발생했습니다." });
    } finally {
      setBusyKey("");
    }
  };

  const runExposureCleanup = async (targetItems, nextBusyKey = "exposure:bulk", cleanupAll = false) => {
    const targets = (Array.isArray(targetItems) ? targetItems : [targetItems]).filter(Boolean);
    if (!targets.length) {
      setStatus({ tone: "info", message: "정리할 공개 노출값 잔여를 선택해 주세요." });
      return;
    }
    if (cleanupAll && typeof window !== "undefined" && !window.confirm(`공개 노출값 잔여 ${targets.length}건을 한 번에 정리할까요?\n\n종료된 리소스의 공개 도메인, TCP, SSH/RDP 연결 값이 제거됩니다.`)) return;
    setBusyKey(nextBusyKey);
    setStatus({ tone: "info", message: targets.length > 1 ? `공개 노출값 잔여 ${targets.length}건을 정리 중입니다.` : "공개 노출값 잔여를 정리 중입니다." });

    try {
      const response = await postOpenstackCleanupAction("/api/admin/openstack-cleanup/clear-exposures", {
        ...(cleanupAll
          ? { all: true }
          : { items: targets.map((item) => ({ resourceType: item.resourceType, id: item.id })) }),
      });
      const resultByKey = new Map((response?.results || []).map((result) => [`${result.resourceType}:${result.id}`, result]));
      const succeeded = targets.filter((item) => resultByKey.get(item.resourceKey)?.ok);
      const failed = targets
        .filter((item) => !resultByKey.get(item.resourceKey)?.ok)
        .map((item) => {
          const result = resultByKey.get(item.resourceKey);
          return {
            item,
            error: new Error(result?.message || (result?.residueRemaining ? "정리 후에도 공개 노출값이 남아 있습니다." : "정리 결과를 확인할 수 없습니다.")),
          };
        });
      if (succeeded.length) {
        const succeededKeySet = new Set(succeeded.map((item) => item.resourceKey));
        setCompletedExposureKeys((current) => Array.from(new Set([...current, ...succeeded.map((item) => item.resourceKey)])));
        setCompletedExposureItems((current) => {
          const next = [
            ...succeeded,
            ...current.filter((entry) => !succeededKeySet.has(entry.resourceKey)),
          ];
          return next.slice(0, 40);
        });
        setSelectedExposureKeys((current) => current.filter((key) => !succeededKeySet.has(key)));
        await refreshOpenstackCleanupData(props);
      }
      if (failed.length) {
        const failedSummary = failed
          .slice(0, 3)
          .map(({ item, error }) => `${item.userName || item.username || item.title || item.id}: ${error.message || "오류"}`)
          .join(" / ");
        setStatus({
          tone: "error",
          message: succeeded.length
            ? `일부 완료: ${succeeded.length}건 정리, ${failed.length}건 실패. ${failedSummary}`
            : `공개 노출값 정리에 실패했습니다. ${failedSummary}`,
        });
        return;
      }
      setStatus({ tone: "success", message: `완료: 공개 노출값 잔여 ${succeeded.length}건을 정리했습니다.` });
    } finally {
      setBusyKey("");
    }
  };

  const runExtensionAction = async (item, action) => {
    if (!item) return;
    const isDeleteAction = /delete|terminate/i.test(action);
    const isRecordDeleteAction = action === "deleteSelfServiceVmRecord";
    const nextBusyKey = `${item.resourceKey}:${isDeleteAction ? "delete" : "refresh"}`;
    const actionMap = {
      terminateSelfServiceVm: () => props.onTerminateSelfServiceVm?.(item.id),
      deleteSelfServiceVmRecord: () => props.onDeleteSelfServiceVmRecords?.([item.id]),
      refreshZun: () => props.onRefreshZunContainer?.(item.id),
      deleteZun: () => props.onDeleteZunContainer?.(item.id),
      refreshMagnum: () => props.onRefreshMagnumCluster?.(item.id),
      deleteMagnum: () => props.onDeleteMagnumCluster?.(item.id),
      refreshTrove: () => props.onRefreshTroveInstance?.(item.id),
      deleteTrove: () => props.onDeleteTroveInstance?.(item.id),
    };
    const runner = actionMap[action];
    if (!runner) {
      setStatus({ tone: "info", message: "지원하지 않는 확장 기능 작업입니다." });
      return;
    }
    if (isDeleteAction && !isRecordDeleteAction && typeof window !== "undefined") {
      const confirmed = window.confirm(`${item.typeLabel} '${item.title}' 삭제/정리 작업을 실행할까요?\n\n상태: ${labStatus(item.status) || item.status || "-"}\n소유자: ${item.owner || "-"}\n실제 클라우드 자원 삭제 또는 종료 요청이 발생할 수 있습니다.`);
      if (!confirmed) {
        setStatus({ tone: "info", message: "확장 기능 정리 작업을 취소했습니다." });
        return;
      }
    }
    setBusyKey(nextBusyKey);
    setStatus({ tone: "info", message: `${item.typeLabel} 작업을 요청했습니다.` });
    try {
      const result = await runner();
      if (result === false) {
        setStatus({ tone: "info", message: "작업을 취소했습니다." });
        return;
      }
      await refreshOpenstackCleanupData(props);
      setStatus({ tone: "success", message: `${item.typeLabel} 작업 요청을 처리했습니다. 실제 잔여 자원은 상태 갱신 후 다시 확인해 주세요.` });
    } catch (error) {
      setStatus({ tone: "error", message: error.message || "확장 기능 작업 중 오류가 발생했습니다." });
    } finally {
      setBusyKey("");
    }
  };

  return (
    <section className="portal-stack">
      <div className="admin-simple-card">
        <div className="admin-card-header">
          <strong>OpenStack 리소스 정리 센터</strong>
          <div className="admin-inline-actions">
            <span className="hint">{`후보 ${totalCleanupCandidates}건`}</span>
            <button className="mini-btn refresh-btn" onClick={() => refreshOpenstackCleanupData(props)} type="button">새로고침</button>
          </div>
        </div>
        <div className="admin-summary-grid">
          <article className="admin-summary-item">
            <span>랩 정리 재시도</span>
            <strong>{`${summary.retryableLabs}건`}</strong>
            <div className="hint">종료 중/실패 상태의 Heat 또는 VM 참조</div>
          </article>
          <article className="admin-summary-item">
            <span>고급 랩 정리 재시도</span>
            <strong>{`${summary.retryableCustomLabs}건`}</strong>
            <div className="hint">Heat stack, 생성 네트워크, 볼륨 참조</div>
          </article>
          <article className="admin-summary-item">
            <span>고급 리소스 잔여</span>
            <strong>{`${summary.advancedResourceResidues}건`}</strong>
            <div className="hint">고급 랩 생성 네트워크/라우터/볼륨 정리 대상</div>
          </article>
          <article className="admin-summary-item">
            <span>노출값 잔여</span>
            <strong>{`${summary.routeResidues}건`}</strong>
            <div className="hint">공개 도메인, TCP, SSH/RDP 라우트 값</div>
          </article>
          <article className="admin-summary-item">
            <span>확장 기능 잔여</span>
            <strong>{`${extensionResidues.length}건`}</strong>
            <div className="hint">사용자화 VM, 컨테이너, Kubernetes, DB 실패/종료 기록</div>
          </article>
        </div>
        {status.message ? <div className={`inline-message ${statusClass}`}>{status.message}</div> : null}
      </div>

      <AdminCleanupSafetyPreview
        extensionResidues={extensionResidues}
        heatStackData={heatStackData}
        selectedExposureKeys={selectedExposureKeys}
        selectedHeatStackKeys={selectedHeatStackKeys}
        summary={summary}
      />

      <OpenstackHeatStackCleanupSection
        busyKey={busyKey}
        data={heatStackData}
        filter={heatStackFilter}
        hasLoaded={heatStackLoaded}
        olderThanDays={heatStackOlderThanDays}
        onDeleteOne={(stack) => runHeatStackDelete(stack, `heat:delete:${getHeatStackRowKey(stack)}`)}
        onDeleteSelected={(stacks) => runHeatStackDelete(stacks, "heat:delete:bulk")}
        onFilterChange={setHeatStackFilter}
        onOlderThanDaysChange={setHeatStackOlderThanDays}
        onProjectScopeChange={(nextScope) => {
          setHeatStackProjectScope(nextScope);
          setSelectedHeatStackKeys([]);
          setHeatStackLoaded(false);
          setHeatStackData({ stacks: [], summary: null, projectName: "" });
        }}
        onRefresh={refreshHeatStacks}
        onSelectKeys={setSelectedHeatStackKeys}
        projectScope={heatStackProjectScope}
        selectedKeys={selectedHeatStackKeys}
      />

      <OpenstackExtensionCleanupSection
        busyKey={busyKey}
        items={extensionResidues}
        onOpenAdminTab={props.onOpenAdminTab}
        onRunAction={runExtensionAction}
      />

      <OpenstackCleanupSection
        emptyText="정리 재시도가 필요한 일반 랩이 없습니다."
        items={report.retryableLabs}
        renderActions={(item) => {
          const key = `retry:${item.resourceKey}`;
          return (
            <button
              className="mini-btn danger-mini-btn"
              disabled={busyKey === key}
              onClick={() => runCleanupAction(
                "/api/admin/openstack-cleanup/retry",
                { resourceType: item.resourceType, id: item.id },
                "랩 자원 정리를 다시 실행했습니다.",
                key,
                `${item.title} 랩 자원 정리를 다시 실행할까요?\n\nHeatStack, 서버, 포트 삭제 요청이 다시 전달될 수 있습니다.`,
              )}
              type="button"
            >
              {busyKey === key ? "실행 중" : "정리 재시도"}
            </button>
          );
        }}
        subtitle="Heat stack 삭제와 서버/포트 삭제 흐름을 다시 실행합니다."
        title="랩 자원 정리 재시도"
      />

      <OpenstackCleanupSection
        emptyText="정리 재시도가 필요한 고급 랩 주문이 없습니다."
        items={report.retryableCustomLabs}
        renderActions={(item) => {
          const key = `retry:${item.resourceKey}`;
          return (
            <button
              className="mini-btn danger-mini-btn"
              disabled={busyKey === key}
              onClick={() => runCleanupAction(
                "/api/admin/openstack-cleanup/retry",
                { resourceType: item.resourceType, id: item.id },
                "고급 랩 자원 정리를 다시 실행했습니다.",
                key,
                `${item.title} 고급 랩 자원 정리를 다시 실행할까요?\n\nHeatStack과 keypair 정리 요청이 다시 전달될 수 있습니다.`,
              )}
              type="button"
            >
              {busyKey === key ? "실행 중" : "정리 재시도"}
            </button>
          );
        }}
        subtitle="고급 랩 Heat stack 삭제와 keypair 정리를 다시 실행합니다."
        title="고급 랩 자원 정리 재시도"
      />

      <OpenstackCleanupSection
        emptyText="수동 정리가 필요한 고급 랩 리소스가 없습니다."
        items={report.advancedResourceResidues}
        renderActions={(item) => {
          const key = `advanced:${item.resourceKey}`;
          return (
            <button
              className="mini-btn danger-mini-btn"
              disabled={busyKey === key}
              onClick={() => runCleanupAction(
                "/api/admin/openstack-cleanup/poc-advanced",
                { id: item.id },
                "고급 랩 리소스 정리를 실행했습니다.",
                key,
                `${item.title} 고급 리소스 잔여 정리를 실행할까요?\n\n네트워크, 라우터, 포트, 볼륨 같은 부가 리소스 삭제 요청이 포함될 수 있습니다.`,
              )}
              type="button"
            >
              {busyKey === key ? "실행 중" : "고급 리소스 정리"}
            </button>
          );
        }}
        subtitle="Heat 외부에서 기록된 네트워크, 라우터, 포트, 볼륨을 정리합니다."
        title="고급 랩 리소스 잔여 정리"
      />

      <OpenstackExposureCleanupSection
        busyKey={busyKey}
        completedItems={completedExposureItems}
        completedKeys={completedExposureKeys}
        items={report.routeResidues}
        onCleanupAll={(items) => runExposureCleanup(items, "exposure:all", true)}
        onCleanupOne={(item) => runExposureCleanup(item, `exposure:${item.resourceKey}`)}
        onCleanupSelected={(items) => runExposureCleanup(items, "exposure:bulk")}
        onSelectKeys={setSelectedExposureKeys}
        selectedKeys={selectedExposureKeys}
      />
    </section>
  );
}
