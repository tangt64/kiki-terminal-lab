import { useRef, useState } from "react";
import {
  AdminField,
  FlavorBadges,
  PanelStatusMessage,
  formatCurrency,
  renderZunStatus,
} from "./portal-views.jsx";
import KubectlDownloadMenu from "./kubectl-download-menu.jsx";

function toPositiveInteger(value, fallback = 1) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

const INTERNAL_IMAGE_REQUEST_MESSAGE = "필요한 이미지가 있으시면 커뮤니티에 요청하세요.";
const MAX_SELF_SERVICE_NETWORK_REQUESTS = 3;
const SELF_SERVICE_VLAN_MIN = 4000;
const SELF_SERVICE_VLAN_MAX = 4094;
const DEFAULT_SELF_SERVICE_ADVANCED_DAILY_PRICES = {
  volumeGb: 30,
  floatingIp: 1500,
  network: 1200,
  router: 800,
  trunk: 800,
  manualPort: 300,
  qos: 300,
  firewallGroup: 500,
};

function createEmptyNetworkRequest() {
  return {
    networkName: "",
    subnetCidr: "",
    vlanMode: "none",
    vlanId: "",
    routerEnabled: true,
    trunkEnabled: false,
    manualPortEnabled: false,
    portName: "",
    qosPolicyName: "",
    firewallGroupName: "",
  };
}

function getNetworkRequestRows(form = {}) {
  const rows = Array.isArray(form.networkRequests) ? form.networkRequests : [];
  const normalized = rows
    .slice(0, MAX_SELF_SERVICE_NETWORK_REQUESTS)
    .map((item) => ({
      ...createEmptyNetworkRequest(),
      ...item,
      routerEnabled: item?.routerEnabled !== false,
      trunkEnabled: Boolean(item?.trunkEnabled),
      manualPortEnabled: Boolean(item?.manualPortEnabled || item?.trunkEnabled),
    }));
  if (normalized.length) return normalized;
  if (form.networkName || form.subnetCidr) {
    return [{ ...createEmptyNetworkRequest(), networkName: form.networkName || "", subnetCidr: form.subnetCidr || "" }];
  }
  return [createEmptyNetworkRequest()];
}

function buildNetworkRequestNote(form = {}) {
  const rows = getNetworkRequestRows(form)
    .map((item) => ({
      networkName: String(item.networkName || "").trim(),
      subnetCidr: String(item.subnetCidr || "").trim(),
      vlanMode: String(item.vlanMode || "none").trim(),
      vlanId: String(item.vlanId || "").trim(),
      routerEnabled: item.routerEnabled !== false,
      trunkEnabled: Boolean(item.trunkEnabled),
      manualPortEnabled: Boolean(item.manualPortEnabled || item.trunkEnabled),
      portName: String(item.portName || "").trim(),
      qosPolicyName: String(item.qosPolicyName || "").trim(),
      firewallGroupName: String(item.firewallGroupName || "").trim(),
    }))
    .filter((item) => item.networkName || item.subnetCidr || item.vlanId || item.qosPolicyName || item.firewallGroupName || item.trunkEnabled || item.manualPortEnabled || item.portName);
  if (!rows.length) return "";
  const lines = ["[전용 네트워크 요청]"];
  rows.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.networkName || "이름 미정"} / ${item.subnetCidr || "CIDR 미정"}`);
    lines.push(`   - Router: ${item.routerEnabled ? "요청" : "미요청"}`);
    lines.push(`   - Port: ${item.manualPortEnabled ? `${item.portName || "자동 이름"}${item.trunkEnabled ? " (Trunk parent)" : ""}` : "자동 생성"}`);
    lines.push(`   - VLAN: ${item.vlanMode === "vlan" ? item.vlanId || "자동 할당" : "미사용"}`);
    lines.push(`   - Trunk: ${item.trunkEnabled ? "요청" : "미요청"}`);
    if (item.qosPolicyName) lines.push(`   - Network QoS: ${item.qosPolicyName}`);
    if (item.firewallGroupName) lines.push(`   - 방화벽 그룹: ${item.firewallGroupName}`);
  });
  lines.push(`※ VLAN ID는 ${SELF_SERVICE_VLAN_MIN}~${SELF_SERVICE_VLAN_MAX} 범위에서 신청 및 사용 가능하며, 비워두면 자동 할당됩니다.`);
  lines.push("※ Router/VLAN Trunk/수동 포트/QoS/방화벽 그룹은 OpenStack Neutron 확장 기능과 관리자 정책 확인 후 적용됩니다.");
  return lines.join("\n");
}

function getNetworkRequestValidationMessage(form = {}) {
  const rows = getNetworkRequestRows(form);
  const invalidNetwork = rows.find((item) => {
    const hasNetworkOption = item.networkName || item.subnetCidr || item.vlanMode === "vlan" || item.trunkEnabled || item.manualPortEnabled || item.portName || item.qosPolicyName || item.firewallGroupName;
    return hasNetworkOption && (!String(item.networkName || "").trim() || !String(item.subnetCidr || "").trim());
  });
  if (invalidNetwork) {
    return "전용 네트워크 옵션을 요청하려면 네트워크 이름과 CIDR 대역을 함께 입력해 주세요.";
  }
  const invalidVlan = rows.find((item) => {
    if (String(item.vlanMode || "none") !== "vlan") return false;
    const vlanRaw = String(item.vlanId || "").trim();
    if (!vlanRaw) return false;
    const vlanId = Number.parseInt(vlanRaw, 10);
    return !Number.isInteger(vlanId) || vlanId < SELF_SERVICE_VLAN_MIN || vlanId > SELF_SERVICE_VLAN_MAX;
  });
  if (invalidVlan) {
    return `VLAN ID는 ${SELF_SERVICE_VLAN_MIN}~${SELF_SERVICE_VLAN_MAX} 사이 숫자로 입력하거나 비워두세요.`;
  }
  return "";
}

function renderSelfServiceVmStatus(status) {
  if (status === "requested") return "승인 대기";
  if (status === "approved") return "승인됨";
  if (status === "provisioning") return "생성 중";
  if (status === "running") return "실행 중";
  if (status === "terminating") return "종료 중";
  if (status === "terminated") return "종료됨";
  return "실패";
}

function renderMagnumStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "requested") return "승인 대기";
  if (normalized === "approved") return "승인됨";
  if (["creating", "provisioning"].includes(normalized)) return "생성 중";
  if (["running", "create_complete"].includes(normalized)) return "실행 중";
  if (["deleting", "terminating"].includes(normalized)) return "삭제 중";
  if (["deleted", "terminated"].includes(normalized)) return "삭제됨";
  if (["rejected", "failed", "error", "create_failed"].includes(normalized)) return "생성 실패";
  return status || "상태 확인 중";
}

function formatTopologyDetail(value, maxLength = 16) {
  const text = String(value || "-");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function formatSelfServiceQuotaAmount(value, unit = "") {
  const number = Math.max(0, Number(value || 0) || 0);
  if (unit === "MB") return number >= 1024 ? `${Math.round(number / 1024)}GB` : `${Math.round(number)}MB`;
  if (unit === "GB") return `${Math.round(number)}GB`;
  return `${Math.round(number)}`;
}

function getSelfServiceFlavorSpec(flavor, platformStatus = {}) {
  const normalized = String(flavor || "").toLowerCase();
  const spec = platformStatus?.pocFlavorSpecs?.[flavor] || {};
  if (Number(spec.vcpu) > 0 && Number(spec.ramGb) > 0) {
    return {
      vcpu: Number(spec.vcpu),
      ramGb: Number(spec.ramGb),
      diskGb: Number(spec.diskGb || 0) || (normalized.includes("tiny") ? 20 : normalized.includes("medium") ? 80 : normalized.includes("large") ? 160 : 50),
    };
  }
  if (normalized.includes("tiny")) return { vcpu: 1, ramGb: 2, diskGb: 20 };
  if (normalized.includes("small")) return { vcpu: 2, ramGb: 4, diskGb: 50 };
  if (normalized.includes("medium")) return { vcpu: 4, ramGb: 8, diskGb: 80 };
  if (normalized.includes("large")) return { vcpu: 8, ramGb: 16, diskGb: 160 };
  return { vcpu: 1, ramGb: 2, diskGb: 20 };
}

function resolveSelfServiceDailyPrice(flavor, platformStatus = {}) {
  const priceMap = platformStatus?.pocFlavorDailyPrices || {};
  return Math.max(0, Number(priceMap?.[flavor] || 0));
}

function resolveSelfServiceAdvancedDailyPrices(platformStatus = {}) {
  const source = platformStatus?.pocAdvancedDailyPrices && typeof platformStatus.pocAdvancedDailyPrices === "object"
    ? platformStatus.pocAdvancedDailyPrices
    : {};
  return Object.entries(DEFAULT_SELF_SERVICE_ADVANCED_DAILY_PRICES).reduce((prices, [key, fallback]) => ({
    ...prices,
    [key]: Math.max(0, Number(source[key] ?? fallback) || 0),
  }), {});
}

function calculateSelfServiceCostEstimate({
  form = {},
  projectRequestForm = {},
  platformStatus = {},
  volumeBootEnabled = false,
  dataVolumeFeatureEnabled = false,
  floatingIpFeatureEnabled = false,
  usageDays = 30,
  billable = false,
}) {
  const instanceCount = toPositiveInteger(form.instanceCount, 1);
  const safeUsageDays = toPositiveInteger(usageDays, 30);
  const flavor = form.flavor || platformStatus?.selfServiceVmAllowedFlavors?.[0] || "m1.tiny";
  const dailyPrice = resolveSelfServiceDailyPrice(flavor, platformStatus);
  const advancedPrices = resolveSelfServiceAdvancedDailyPrices(platformStatus);
  const items = [];
  const addItem = ({ key, label, quantity = 1, unitDailyPrice = 0, detail = "" }) => {
    const safeQuantity = Math.max(0, Number(quantity) || 0);
    const safeUnitDailyPrice = Math.max(0, Number(unitDailyPrice) || 0);
    if (!safeQuantity || !safeUnitDailyPrice) return;
    const daily = Math.floor(safeQuantity * safeUnitDailyPrice);
    items.push({
      key,
      label,
      quantity: safeQuantity,
      unitDailyPrice: safeUnitDailyPrice,
      daily,
      amount: daily * safeUsageDays,
      detail,
    });
  };

  addItem({
    key: "compute",
    label: "가상머신",
    quantity: instanceCount,
    unitDailyPrice: dailyPrice,
    detail: `${flavor} x ${instanceCount}대`,
  });

  if (volumeBootEnabled && form.bootFromVolume) {
    const bootVolumeSizeGb = Math.max(1, Number(form.bootVolumeSizeGb || 20) || 20);
    addItem({
      key: "boot-volume",
      label: "OS 볼륨",
      quantity: bootVolumeSizeGb * instanceCount,
      unitDailyPrice: advancedPrices.volumeGb,
      detail: `${bootVolumeSizeGb}GB x ${instanceCount}대`,
    });
  }

  if (dataVolumeFeatureEnabled && form.dataVolumeEnabled) {
    const dataVolumeCount = toPositiveInteger(form.dataVolumeCount, 1);
    const dataVolumeSizeGb = Math.max(1, Number(form.dataVolumeSizeGb || 20) || 20);
    addItem({
      key: "data-volume",
      label: "데이터 볼륨",
      quantity: dataVolumeCount * dataVolumeSizeGb,
      unitDailyPrice: advancedPrices.volumeGb,
      detail: `${dataVolumeSizeGb}GB x ${dataVolumeCount}개`,
    });
  }

  if (floatingIpFeatureEnabled && form.floatingIpRequested) {
    addItem({
      key: "floating-ip",
      label: "Floating IP",
      quantity: instanceCount,
      unitDailyPrice: advancedPrices.floatingIp,
      detail: `${instanceCount}개`,
    });
  }

  const networkRows = getNetworkRequestRows(projectRequestForm).filter((item) => (
    String(item.networkName || "").trim()
    || String(item.subnetCidr || "").trim()
    || String(item.vlanMode || "none") === "vlan"
    || Boolean(item.trunkEnabled)
    || Boolean(item.manualPortEnabled)
    || String(item.qosPolicyName || "").trim()
    || String(item.firewallGroupName || "").trim()
  ));
  const networkCount = networkRows.filter((item) => item.networkName || item.subnetCidr).length;
  const routerCount = networkRows.filter((item) => item.routerEnabled !== false && (item.networkName || item.subnetCidr)).length;
  const trunkCount = networkRows.filter((item) => item.trunkEnabled).length;
  const manualPortCount = networkRows.filter((item) => item.manualPortEnabled || item.trunkEnabled).length;
  const qosCount = networkRows.filter((item) => item.qosPolicyName).length;
  const firewallCount = networkRows.filter((item) => item.firewallGroupName).length;
  addItem({ key: "network", label: "전용 네트워크", quantity: networkCount, unitDailyPrice: advancedPrices.network, detail: networkCount ? `${networkCount}개` : "" });
  addItem({ key: "router", label: "라우터", quantity: routerCount, unitDailyPrice: advancedPrices.router, detail: routerCount ? `${routerCount}개` : "" });
  addItem({ key: "trunk", label: "Trunk", quantity: trunkCount, unitDailyPrice: advancedPrices.trunk, detail: trunkCount ? `${trunkCount}개` : "" });
  addItem({ key: "manual-port", label: "수동 포트", quantity: manualPortCount, unitDailyPrice: advancedPrices.manualPort, detail: manualPortCount ? `${manualPortCount}개` : "" });
  addItem({ key: "qos", label: "네트워크 QoS", quantity: qosCount, unitDailyPrice: advancedPrices.qos, detail: qosCount ? `${qosCount}개` : "" });
  addItem({ key: "firewall", label: "방화벽 그룹", quantity: firewallCount, unitDailyPrice: advancedPrices.firewallGroup, detail: firewallCount ? `${firewallCount}개` : "" });

  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const discounts = [];
  const addDiscount = (type, label, rate) => {
    if (subtotal <= 0 || rate <= 0) return;
    discounts.push({ type, label, rate, amount: Math.floor(subtotal * rate) });
  };
  if (safeUsageDays >= 14) addDiscount("period", "14일 이상 기간 할인", 0.2);
  else if (safeUsageDays >= 7) addDiscount("period", "7일 이상 기간 할인", 0.1);
  if (instanceCount >= 5) addDiscount("volume", "5대 이상 수량 할인", 0.1);
  else if (instanceCount >= 3) addDiscount("volume", "3대 이상 수량 할인", 0.05);
  const discountAmount = Math.min(subtotal, discounts.reduce((sum, discount) => sum + discount.amount, 0));
  const estimatedAmount = Math.max(0, subtotal - discountAmount);

  return {
    billable,
    dailyPrice,
    instanceCount,
    usageDays: safeUsageDays,
    subtotal,
    discounts,
    discountAmount,
    amount: billable ? estimatedAmount : 0,
    paidEstimateAmount: estimatedAmount,
    items,
  };
}

function SelfServiceImpactPreview({ form = {}, platformStatus = {}, volumeBootEnabled = false, dataVolumeFeatureEnabled = false, floatingIpFeatureEnabled = false }) {
  const instanceCount = toPositiveInteger(form.instanceCount, 1);
  const spec = getSelfServiceFlavorSpec(form.flavor, platformStatus);
  const bootFromVolume = Boolean(volumeBootEnabled && form.bootFromVolume);
  const bootVolumeSizeGb = Math.max(1, Number(form.bootVolumeSizeGb || 20) || 20);
  const dataVolumeEnabled = Boolean(dataVolumeFeatureEnabled && form.dataVolumeEnabled);
  const dataVolumeCount = dataVolumeEnabled ? toPositiveInteger(form.dataVolumeCount, 1) : 0;
  const dataVolumeSizeGb = dataVolumeEnabled ? Math.max(1, Number(form.dataVolumeSizeGb || 20) || 20) : 0;
  const floatingIpCount = floatingIpFeatureEnabled && form.floatingIpRequested ? instanceCount : 0;
  const bootVolumeCount = bootFromVolume ? instanceCount : 0;
  const bootVolumeGb = bootVolumeCount * bootVolumeSizeGb;
  const dataVolumeGb = dataVolumeCount * dataVolumeSizeGb;
  const volumeCount = bootVolumeCount + dataVolumeCount;
  const volumeGb = bootVolumeGb + dataVolumeGb;
  const billableItems = [
    bootFromVolume ? `OS 볼륨 ${bootVolumeCount}개` : "",
    dataVolumeEnabled ? `데이터 볼륨 ${dataVolumeCount}개` : "",
    floatingIpCount ? `Floating IP ${floatingIpCount}개` : "",
  ].filter(Boolean);

  return (
    <section className="self-service-impact-preview">
      <div className="self-service-impact-head">
        <div>
          <strong>예상 Quota 영향</strong>
          <p>현재 선택값으로 생성 전에 차감될 자원을 미리 확인합니다.</p>
        </div>
        <span>{form.flavor || "Flavor 선택"}</span>
      </div>
      <div className="self-service-impact-grid">
        <span><b>VM</b><em>{`${instanceCount}대`}</em></span>
        <span><b>vCPU</b><em>{`${spec.vcpu * instanceCount}`}</em></span>
        <span><b>RAM</b><em>{`${spec.ramGb * instanceCount}GB`}</em></span>
        <span><b>Port</b><em>{`${instanceCount}개`}</em></span>
        <span><b>Volume</b><em>{volumeCount ? `${volumeCount}개 / ${volumeGb}GB` : "사용 안 함"}</em></span>
        <span><b>Floating IP</b><em>{floatingIpCount ? `${floatingIpCount}개` : "사용 안 함"}</em></span>
      </div>
      <div className="self-service-impact-notes">
        <span>{`기본 디스크: ${bootFromVolume ? `Cinder volume ${bootVolumeSizeGb}GB x ${instanceCount}` : `이미지/ephemeral 약 ${spec.diskGb}GB 기준`}`}</span>
        {dataVolumeEnabled ? <span>{`추가 데이터 볼륨: ${dataVolumeSizeGb}GB x ${dataVolumeCount}, 첫 번째 VM에 연결`}</span> : null}
        <span>{billableItems.length ? `비용 확인 필요 항목: ${billableItems.join(", ")}` : "추가 과금 가능 항목은 선택되지 않았습니다."}</span>
      </div>
    </section>
  );
}

function getSelfServicePreflightTone(preflight = {}) {
  if (preflight.checking) return "info";
  if (preflight.canCreate === false) return "error";
  if (preflight.ok === false && preflight.message) return "warning";
  return "success";
}

function renderSelfServiceVmProgress(vm = {}) {
  const note = String(vm.reviewNote || "");
  const matched = note.match(/진행 상태:\s*(.+)$/m);
  if (matched?.[1]) return matched[1].trim();
  if (vm.status === "requested") return "관리자 승인 대기";
  if (vm.status === "approved") return "생성 승인 완료";
  if (vm.status === "provisioning") return "HeatStack 생성 중";
  if (vm.status === "running") return "사용 가능";
  if (vm.status === "terminating") return "삭제 중";
  if (vm.status === "terminated") return "삭제 완료";
  return "생성 실패";
}

function SelfServiceVmPreflightPanel({ preflight = {} }) {
  if (!preflight?.message && !preflight?.checking) return null;
  const tone = getSelfServicePreflightTone(preflight);
  const checks = Array.isArray(preflight.checks) ? preflight.checks : [];
  return (
    <div className={`self-service-preflight is-${tone}`}>
      <div className="self-service-preflight-head">
        <strong>{preflight.checking ? "프로젝트 자원 확인 중" : preflight.canCreate === false ? "생성 전 확인 필요" : "프로젝트 자원 점검"}</strong>
        <span>{preflight.projectName || "-"}</span>
      </div>
      <p>{preflight.message}</p>
      {preflight.detailMessage ? <p className="hint">{preflight.detailMessage}</p> : null}
      {checks.length ? (
        <div className="self-service-quota-grid">
          {checks.map((item) => (
            <span className={`self-service-quota-pill ${item.pass ? "is-pass" : "is-fail"}`} key={item.key}>
              <b>{item.label}</b>
              <span>{`필요 ${formatSelfServiceQuotaAmount(item.required, item.unit)} / 남음 ${item.remaining == null ? "무제한" : formatSelfServiceQuotaAmount(item.remaining, item.unit)}`}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SelfServiceVmTopology({ vm = null, form = {}, title = "예상 자원 구성도" }) {
  const instanceCount = toPositiveInteger(vm?.instanceCount ?? form.instanceCount, 1);
  const flavor = vm?.flavor || form.flavor || "-";
  const networkName = vm?.networkName || form.networkName || "net-infra";
  const bootFromVolume = Boolean(vm?.bootFromVolume ?? form.bootFromVolume);
  const bootVolumeDetail = bootFromVolume ? `${vm?.bootVolumeSizeGb || form.bootVolumeSizeGb || 20}GB` : "ephemeral";
  const formCloudInitMode = form.cloudInitMode || (form.cloudInitCustomContent ? "custom" : form.cloudInitTemplateName ? "template" : "none");
  const cloudInit = vm?.cloudInitCustomContentAvailable
    ? vm.cloudInitCustomFileName ? `직접 입력 / ${vm.cloudInitCustomFileName}` : "직접 입력"
    : vm?.cloudInitTemplateName || (formCloudInitMode === "custom" ? form.cloudInitCustomFileName || "직접 입력" : form.cloudInitTemplateName) || "선택 안 함";
  const status = String(vm?.status || "requested").toLowerCase();
  const detail = vm?.instanceIp || `${instanceCount}대 / ${flavor}`;
  const firstNetworkRequest = getNetworkRequestRows(form).find((item) => item.networkName || item.subnetCidr || item.trunkEnabled || item.manualPortEnabled || item.vlanMode === "vlan") || {};
  const effectiveNetworkName = firstNetworkRequest.networkName || networkName;
  const portDetail = firstNetworkRequest.manualPortEnabled || firstNetworkRequest.trunkEnabled
    ? firstNetworkRequest.portName || "manual port"
    : firstNetworkRequest.vlanMode === "vlan"
      ? `VLAN ${firstNetworkRequest.vlanId || "auto"}`
      : "auto port";
  const nicDetail = `${instanceCount} NIC`;
  const nodes = [
    { id: "public", label: "Public", detail: "접속", type: "network", x: 18, y: 38 },
    { id: "network", label: "Network", detail: formatTopologyDetail(effectiveNetworkName), type: "network", x: 138, y: 38 },
    { id: "port", label: "Port", detail: formatTopologyDetail(portDetail), type: "port", x: 258, y: 38 },
    { id: "nic", label: "NIC", detail: formatTopologyDetail(nicDetail), type: "nic", x: 378, y: 38 },
    { id: "compute", label: "Compute", detail: formatTopologyDetail(detail), type: status === "running" ? "running" : status === "provisioning" ? "provisioning" : status === "failed" ? "failed" : "core", x: 498, y: 38 },
    { id: "security", label: "Security", detail: "example.com", type: "storage", x: 258, y: 132 },
    { id: "config", label: "cloud-init", detail: formatTopologyDetail(cloudInit), type: "data", x: 498, y: 132 },
    { id: "bootVolume", label: "Boot disk", detail: formatTopologyDetail(bootVolumeDetail), type: "storage", x: 408, y: 176 },
  ];
  const edges = [
    ["public", "network"],
    ["network", "port"],
    ["port", "nic"],
    ["nic", "compute"],
    ["security", "port"],
    ["config", "compute"],
    ["bootVolume", "compute"],
  ];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const center = (node) => ({ x: node.x + 45, y: node.y + 22 });

  return (
    <details className="poc-resource-disclosure" open={!vm}>
      <summary>
        <span>{title}</span>
        <b>{vm ? renderSelfServiceVmStatus(status) : "미리보기"}</b>
      </summary>
      <figure className="poc-resource-graph self-service-vm-graph">
        <div className="poc-resource-legend" aria-label="자원 유형 범례">
          <span><i className="is-core" />Compute</span>
          <span><i className="is-network" />Network</span>
          <span><i className="is-port" />Port/NIC</span>
          <span><i className="is-storage" />Security</span>
          <span><i className="is-data" />Config</span>
        </div>
        <svg aria-label={title} role="img" viewBox="0 0 606 242">
          {edges.map(([from, to]) => {
            const fromCenter = center(nodeMap.get(from));
            const toCenter = center(nodeMap.get(to));
            return <line className="poc-resource-edge" key={`${from}-${to}`} x1={fromCenter.x} x2={toCenter.x} y1={fromCenter.y} y2={toCenter.y} />;
          })}
          {nodes.map((node) => (
            <g className={`poc-resource-node is-${node.type}`} key={node.id} transform={`translate(${node.x} ${node.y})`}>
              <rect height="44" rx="8" width="90" />
              <text className="poc-resource-label" x="45" y="18">{node.label}</text>
              <text className="poc-resource-detail" x="45" y="31">{node.detail}</text>
            </g>
          ))}
        </svg>
      </figure>
    </details>
  );
}

export function InternalImageServerView(props = {}) {
  const [search, setSearch] = useState({ query: "", loading: false, message: "", images: [] });
  const [copied, setCopied] = useState("");

  const openCommunity = () => {
    if (typeof props.onOpenCommunity === "function") {
      props.onOpenCommunity();
      return;
    }
    props.setSection?.("qna");
  };

  const runSearch = async (event) => {
    event?.preventDefault?.();
    const query = String(search.query || "").trim();
    setSearch((current) => ({ ...current, loading: true, message: "", images: [] }));
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      params.set("limit", "40");
      const response = await fetch(`/api/internal-images/search?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = response.headers.get("content-type")?.includes("application/json") ? await response.json() : {};
      if (!response.ok) throw new Error(INTERNAL_IMAGE_REQUEST_MESSAGE);
      const images = (Array.isArray(payload.images) ? payload.images : [])
        .map((item) => ({
          name: String(item?.name || "").trim(),
          repository: String(item?.repository || "").trim(),
          tag: String(item?.tag || "").trim(),
        }))
        .filter((item) => item.name);
      setSearch((current) => ({
        ...current,
        loading: false,
        message: images.length ? `${images.length}개 이미지를 찾았습니다.` : INTERNAL_IMAGE_REQUEST_MESSAGE,
        images,
      }));
    } catch (error) {
      setSearch((current) => ({
        ...current,
        loading: false,
        message: error.message || INTERNAL_IMAGE_REQUEST_MESSAGE,
        images: [],
      }));
    }
  };

  const copyText = async (value, label) => {
    const text = String(value || "").trim();
    if (!text) return;
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(label || text);
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      setCopied("복사 실패");
      window.setTimeout(() => setCopied(""), 1800);
    }
  };

  return (
    <section className="portal-stack internal-image-server-view">
      <section className="simple-panel internal-image-server-hero">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">INTERNAL IMAGE SERVER</p>
            <h3>내부 이미지 서버</h3>
            <p className="hint">실습 환경에서 사용할 컨테이너 이미지를 내부 레지스트리 기준으로 검색하고 pull 명령을 복사합니다.</p>
          </div>
        </div>
        <form className="internal-image-search-bar" onSubmit={runSearch}>
          <input
            autoComplete="off"
            placeholder="예: ubuntu, nginx, redis, rockylinux"
            value={search.query}
            onChange={(event) => setSearch((current) => ({ ...current, query: event.target.value }))}
          />
          <button className="primary-btn" disabled={search.loading} type="submit">
            {search.loading ? "검색 중" : "이미지 검색"}
          </button>
        </form>
        <div className="internal-image-server-note">
          <strong>이미지가 없나요?</strong>
          <span>{INTERNAL_IMAGE_REQUEST_MESSAGE}</span>
          <button className="link-btn" onClick={openCommunity} type="button">커뮤니티로 이동</button>
        </div>
        {search.message ? <p className="hint">{search.message}</p> : null}
        {copied ? <div className="global-banner is-success">{copied === "복사 실패" ? copied : `${copied} 복사됨`}</div> : null}
      </section>

      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">IMAGE CATALOG</p>
            <h3>검색 결과</h3>
          </div>
        </div>
        {search.images.length ? (
          <div className="internal-image-result-list">
            {search.images.map((image) => (
              <article className="internal-image-result-row" key={image.name}>
                <div>
                  <strong>{image.name}</strong>
                  <span>{image.repository}{image.tag ? `:${image.tag}` : ""}</span>
                </div>
                <div className="admin-inline-actions">
                  <button className="mini-btn" onClick={() => copyText(image.name, "이미지 이름")} type="button">이미지 복사</button>
                  <button className="mini-btn" onClick={() => copyText(`podman pull ${image.name}`, "podman 명령")} type="button">podman pull</button>
                  <button className="mini-btn" onClick={() => copyText(`docker pull ${image.name}`, "docker 명령")} type="button">docker pull</button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <strong>검색어를 입력해 내부 이미지 서버를 확인해 주세요.</strong>
            <p className="hint">검색은 서버에서 내부 레지스트리 API로 수행됩니다.</p>
          </div>
        )}
      </section>
    </section>
  );
}

export function ZunView(props) {
  const activeContainer = props.zunContainers.find((item) => ["requested", "provisioning", "creating", "running", "stopping"].includes(String(item.status || "").toLowerCase())) || null;
  const activeContainerStatus = String(activeContainer?.status || "").toLowerCase();
  const isContainerProvisioning = Boolean(activeContainer && ["requested", "provisioning", "creating"].includes(activeContainerStatus));
  const zunReady = Boolean(props.platformStatus?.zunEnabled);
  const allowedContainerImages = Array.isArray(props.platformStatus?.zunAllowedImages) && props.platformStatus.zunAllowedImages.length
    ? props.platformStatus.zunAllowedImages
    : ["docker.io/library/rockylinux:9", "docker.io/library/ubuntu:24.04"];
  const useCustomImage = props.zunForm.imageSource === "custom";
  const selectedManagedImage = allowedContainerImages.includes(props.zunForm.imageName)
    ? props.zunForm.imageName
    : allowedContainerImages[0] || "";
  const selectedContainerImage = useCustomImage ? String(props.zunForm.customImageName || "").trim() : selectedManagedImage;

  return (
    <section className="portal-stack">
      <form className="simple-panel admin-form" onSubmit={props.onCreateZunContainer}>
        <div className="portal-detail-head">
          <div>
            <p className="card-label">컨테이너 랩</p>
            <h3>OS 이미지를 선택해 웹 콘솔 컨테이너 실행</h3>
            <p className="hint">짧은 실습, CLI 테스트, 웹 서비스 데모처럼 VM까지 필요 없는 작업은 컨테이너 랩에서 빠르게 시작합니다.</p>
          </div>
          <span className={`status-chip ${zunReady ? "is-success" : "is-muted"}`}>{zunReady ? "사용 가능" : "비활성"}</span>
        </div>
        <div className="extension-summary-grid">
          <div><span>실행 방식</span><strong>웹 콘솔</strong><small>SSH 서버 없이 연결</small></div>
          <div><span>기본 네트워크</span><strong>net-infra</strong><small>필요 시 서비스 포트만 공개</small></div>
          <div><span>허용 이미지</span><strong>{allowedContainerImages.length}</strong><small>{selectedContainerImage || "관리자 등록 필요"}</small></div>
          <div><span>진행 중</span><strong>{activeContainer ? renderZunStatus(activeContainer.status) : "없음"}</strong><small>{activeContainer?.name || "새 컨테이너 생성 가능"}</small></div>
        </div>
        <div className="extension-step-card">
          <div className="extension-step-head">
            <span>1</span>
            <div>
              <strong>컨테이너 이미지와 실행 방식</strong>
              <p className="hint">일반 OS 이미지를 기본으로 쓰고, 컨테이너가 바로 종료되지 않도록 대기 명령을 둡니다.</p>
            </div>
          </div>
          <div className="admin-form-grid compact-admin-grid">
            <AdminField label="컨테이너 이름" required>
              <input value={props.zunForm.name} onChange={(event) => props.setZunForm((current) => ({ ...current, name: event.target.value }))} placeholder="예: client-demo" />
            </AdminField>
            <AdminField label="이미지 입력 방식" required>
              <select value={useCustomImage ? "custom" : "managed"} onChange={(event) => props.setZunForm((current) => ({ ...current, imageSource: event.target.value === "custom" ? "custom" : "managed", registryAuthEnabled: event.target.value === "custom" ? current.registryAuthEnabled : false, registryPassword: "" }))}>
                <option value="managed">관리자 제공 이미지</option>
                <option value="custom">직접 이미지 주소 입력</option>
              </select>
            </AdminField>
            {!useCustomImage ? <AdminField label="컨테이너 이미지" required hint="관리자가 제공하는 이미지입니다.">
              <select value={selectedManagedImage} onChange={(event) => props.setZunForm((current) => ({ ...current, imageName: event.target.value }))}>
                {allowedContainerImages.length ? allowedContainerImages.map((imageName) => (
                  <option key={imageName} value={imageName}>{imageName}</option>
                )) : <option value="">허용 이미지 없음</option>}
              </select>
            </AdminField> : <AdminField label="이미지 주소" required hint="예: registry.example.com/team/image:tag">
              <input autoComplete="off" value={props.zunForm.customImageName || ""} onChange={(event) => props.setZunForm((current) => ({ ...current, customImageName: event.target.value }))} placeholder="registry.example.com/library/rockylinux:9" />
            </AdminField>}
            <AdminField label="실행 명령" hint="OS 컨테이너가 바로 종료되지 않도록 기본 대기 명령을 사용합니다.">
              <input value={props.zunForm.commandText} onChange={(event) => props.setZunForm((current) => ({ ...current, commandText: event.target.value }))} placeholder="예: sleep infinity" />
            </AdminField>
          </div>
          {useCustomImage ? <div className="admin-form-grid compact-admin-grid">
            <AdminField label="레지스트리 인증">
              <label className="zun-registry-auth-toggle">
                <input checked={Boolean(props.zunForm.registryAuthEnabled)} onChange={(event) => props.setZunForm((current) => ({ ...current, registryAuthEnabled: event.target.checked, registryPassword: "" }))} type="checkbox" />
                <span>아이디·비밀번호 또는 토큰 사용</span>
              </label>
            </AdminField>
            {props.zunForm.registryAuthEnabled ? <>
              <AdminField label="레지스트리 URL" required hint="경로 없이 HTTPS 주소만 입력합니다.">
                <input autoComplete="url" value={props.zunForm.registryUrl || ""} onChange={(event) => props.setZunForm((current) => ({ ...current, registryUrl: event.target.value }))} placeholder="https://registry.example.com" type="url" />
              </AdminField>
              <AdminField label="아이디" required>
                <input autoComplete="username" value={props.zunForm.registryUsername || ""} onChange={(event) => props.setZunForm((current) => ({ ...current, registryUsername: event.target.value }))} />
              </AdminField>
              <AdminField label="비밀번호 또는 토큰" required hint="입력값은 화면과 포털 DB에 저장하지 않습니다.">
                <input autoComplete="new-password" value={props.zunForm.registryPassword || ""} onChange={(event) => props.setZunForm((current) => ({ ...current, registryPassword: event.target.value }))} type="password" />
              </AdminField>
            </> : null}
          </div> : null}
        </div>
        <div className="extension-step-card">
          <div className="extension-step-head">
            <span>2</span>
            <div>
              <strong>접속과 공개 포트</strong>
              <p className="hint">콘솔만 사용할 때는 포트를 비워두고, 웹 서비스 테스트가 필요할 때만 포트를 입력합니다.</p>
            </div>
          </div>
          <div className="admin-form-grid compact-admin-grid">
            <AdminField label="서비스 포트(선택)" hint="웹서비스 공개가 필요할 때만 입력합니다. 콘솔만 쓸 때는 비워도 됩니다.">
              <input value={props.zunForm.exposedPort} onChange={(event) => props.setZunForm((current) => ({ ...current, exposedPort: event.target.value }))} placeholder="예: 8080" />
            </AdminField>
          </div>
        </div>
        <div className="simple-status-list">
          <div>{`기본 네트워크: net-infra`}</div>
          <div>{`기본 보안그룹: example.com`}</div>
          <div>웹 콘솔: SSH 서버 없이 /bin/bash 또는 /bin/sh에 연결</div>
          <div>복사/붙여넣기: 브라우저 터미널에서 지원</div>
          <div>{`컨테이너 기능: ${props.platformStatus?.zunEnabled ? "활성" : "비활성"}`}</div>
        </div>
        <div className="portal-actions">
          <button className="primary-btn" disabled={!zunReady || Boolean(activeContainer) || !selectedContainerImage} type="submit">컨테이너 생성</button>
          {isContainerProvisioning ? (
            <div className="container-provisioning-message" role="status">
              <span className="container-provisioning-spinner" aria-hidden="true" />
              <span>
                <strong>생성중 입니다. 잠시만 기다려주세요</strong>
                <small>{activeContainer?.name ? `${activeContainer.name} 컨테이너를 준비하고 있습니다.` : "컨테이너를 준비하고 있습니다."}</small>
              </span>
            </div>
          ) : activeContainer ? <span className="hint">이미 진행 중인 컨테이너가 있습니다.</span> : null}
        </div>
      </form>

      <PanelStatusMessage {...props.zunStatus} />

      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">컨테이너 현황</p>
            <h3>내 컨테이너</h3>
          </div>
        </div>
        <div className="qna-board">
          {props.zunContainers.length ? props.zunContainers.map((container) => (
            <article className="qna-thread" key={container.id}>
              <div className="qna-thread-head">
                <strong>{container.name}</strong>
                <span>{renderZunStatus(container.status)}</span>
              </div>
              <div className="qna-post-body">
                <div>{`이미지: ${container.imageName}`}</div>
                <div>{`포트: ${container.exposedPort || "-"}`}</div>
                <div>{`UUID: ${container.containerUuid || "-"}`}</div>
                <div>{`주소: ${container.addresses?.map((item) => `${item.network ? `${item.network}: ` : ""}${item.address}`).join(", ") || "-"}`}</div>
                {(container.publicDomains || []).length ? <div className="domain-chip-list">{container.publicDomains.map((domain) => <span className="domain-chip" key={domain.fqdn || domain.subdomain}><a href={domain.url} rel="noreferrer" target="_blank">{domain.fqdn || domain.subdomain}</a><button aria-label="도메인 해제" onClick={() => props.onUnpublishZunContainerDomain?.(container.id, domain)} type="button">×</button></span>)}</div> : <div>외부 도메인: 없음</div>}
                {container.commandText ? <div>{`명령: ${container.commandText}`}</div> : null}
                {container.errorMessage ? <div>{`오류: ${container.errorMessage}`}</div> : null}
                <div className="admin-inline-actions">
                  {container.containerUuid && ["running", "creating"].includes(container.status) ? <button className="mini-btn primary-mini-btn" onClick={() => props.onCreateZunContainerTerminalSession?.(container.id)} type="button">웹 콘솔</button> : null}
                  {["stopped", "failed"].includes(container.status) ? <button className="mini-btn start-btn" onClick={() => props.onStartZunContainer(container.id)} type="button">시작</button> : null}
                  {["running", "creating"].includes(container.status) ? <button className="mini-btn stop-btn" onClick={() => props.onStopZunContainer(container.id)} type="button">중지</button> : null}
                  <button className="mini-btn" onClick={() => props.onRefreshZunContainer(container.id)} type="button">상태 갱신</button>
                  <button className="mini-btn" disabled={String(container.status || "").toLowerCase() !== "running" || !container.exposedPort} onClick={() => props.onPublishZunContainerDomain?.(container.id, {})} type="button">도메인 추가</button>
                  <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteZunContainer(container.id)} type="button">삭제</button>
                </div>
              </div>
            </article>
          )) : <p className="hint">생성된 컨테이너가 없습니다.</p>}
        </div>
      </section>
    </section>
  );
}

export function MagnumView(props) {
  const activeCluster = props.magnumClusters.find((item) => !["deleted", "failed"].includes(String(item.status || "").toLowerCase())) || null;
  const magnumReady = Boolean(props.platformStatus?.magnumEnabled);
  const selectedTemplate = props.magnumTemplates.find((item) => item.id === props.magnumForm.clusterTemplateId);

  return (
    <section className="portal-stack">
      <form className="simple-panel admin-form" onSubmit={props.onCreateMagnumCluster}>
        <div className="portal-detail-head">
          <div>
            <p className="card-label">쿠버네티스 클러스터</p>
            <h3>CAPO 기반 Kubernetes 클러스터 요청</h3>
            <p className="hint">프로파일을 선택하고 클러스터 이름과 규모를 입력해 요청합니다.</p>
          </div>
          <span className={`status-chip ${magnumReady ? "is-success" : "is-muted"}`}>{magnumReady ? "요청 가능" : "비활성"}</span>
        </div>
        <div className="extension-summary-grid">
          <div><span>프로젝트</span><strong>{props.platformStatus?.magnumProjectName || "poc-example.com"}</strong><small>클러스터 전용 자원 영역</small></div>
          <div><span>CAPO 프로파일</span><strong>{props.magnumTemplates.length}</strong><small>{selectedTemplate?.name || "프로파일 선택 필요"}</small></div>
          <div><span>내 클러스터</span><strong>{activeCluster ? activeCluster.status || "진행 중" : "없음"}</strong><small>{activeCluster?.name || "새 요청 가능"}</small></div>
        </div>
        <div className="extension-step-card">
          <div className="extension-step-head">
            <span>1</span>
            <div>
              <strong>프로파일과 이름</strong>
              <p className="hint">관리자가 공개한 CAPO 프로파일 안에서 생성할 클러스터 유형을 선택합니다.</p>
            </div>
          </div>
          <div className="admin-form-grid compact-admin-grid">
            <AdminField label="클러스터 이름" required>
              <input value={props.magnumForm.name} onChange={(event) => props.setMagnumForm((current) => ({ ...current, name: event.target.value }))} placeholder="예: engineer-k8s" />
            </AdminField>
            <AdminField label="CAPO 프로파일" required hint="관리자가 공개한 Cluster API Provider OpenStack 프로파일입니다.">
              <select
                value={props.magnumForm.clusterTemplateId}
                onChange={(event) => {
                  const template = props.magnumTemplates.find((item) => item.id === event.target.value);
                  props.setMagnumForm((current) => ({
                    ...current,
                    clusterTemplateId: event.target.value,
                    clusterTemplateName: template?.name || "",
                    kubernetesVersion: template?.defaultKubernetesVersion || template?.kubernetesVersions?.[0]?.minor || "",
                    controlPlaneFlavor: template?.masterFlavorId || template?.allowedControlPlaneFlavors?.[0] || "",
                    workerFlavor: template?.flavorId || template?.allowedWorkerFlavors?.[0] || "",
                  }));
                }}
              >
                <option value="">선택해 주세요</option>
                {props.magnumTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </AdminField>
            <AdminField label="Kubernetes 버전" required hint="선택한 버전에 맞는 전용 Glance 이미지를 사용합니다.">
              <select value={props.magnumForm.kubernetesVersion} onChange={(event) => props.setMagnumForm((current) => ({ ...current, kubernetesVersion: event.target.value }))}>
                {(selectedTemplate?.kubernetesVersions || []).map((entry) => <option key={entry.version} value={entry.minor}>{entry.version}</option>)}
              </select>
            </AdminField>
          </div>
        </div>
        <div className="extension-step-card">
          <div className="extension-step-head">
            <span>2</span>
            <div>
              <strong>노드 규모</strong>
              <p className="hint">컨트롤 플레인과 워커 수를 정하면 운영자가 quota와 정책을 확인합니다.</p>
            </div>
          </div>
          <div className="admin-form-grid compact-admin-grid">
            <AdminField label="컨트롤 플레인 수" required>
              <input min="1" step="1" type="number" value={props.magnumForm.masterCount} onChange={(event) => props.setMagnumForm((current) => ({ ...current, masterCount: event.target.value }))} />
            </AdminField>
            <AdminField label="워커 수" required>
              <input min="1" step="1" type="number" value={props.magnumForm.nodeCount} onChange={(event) => props.setMagnumForm((current) => ({ ...current, nodeCount: event.target.value }))} />
            </AdminField>
            <AdminField label="Control plane Flavor" required hint="관리자가 이 프로파일에 허용한 사양입니다.">
              <select value={props.magnumForm.controlPlaneFlavor} onChange={(event) => props.setMagnumForm((current) => ({ ...current, controlPlaneFlavor: event.target.value }))}>
                {(selectedTemplate?.allowedControlPlaneFlavors || []).map((flavor) => <option key={flavor} value={flavor}>{flavor}</option>)}
              </select>
            </AdminField>
            <AdminField label="Worker Flavor" required hint="모든 워커 노드에 적용할 사양입니다.">
              <select value={props.magnumForm.workerFlavor} onChange={(event) => props.setMagnumForm((current) => ({ ...current, workerFlavor: event.target.value }))}>
                {(selectedTemplate?.allowedWorkerFlavors || []).map((flavor) => <option key={flavor} value={flavor}>{flavor}</option>)}
              </select>
            </AdminField>
          </div>
        </div>
        <div className="simple-status-list">
          <div>{`쿠버네티스 프로젝트: ${props.platformStatus?.magnumProjectName || "poc-example.com"}`}</div>
          <div>{`CAPO management endpoint / clusterctl 실행 경로: ${props.platformStatus?.magnumApiUrl || "관리자 설정 필요"}`}</div>
          <div>{`사용 가능한 CAPO 프로파일: ${props.magnumTemplates.length}`}</div>
        </div>
        <div className="admin-inline-actions">
          <button className="mini-btn primary-mini-btn" disabled={!magnumReady || Boolean(activeCluster) || !selectedTemplate || !props.magnumForm.name.trim()} type="submit">생성 요청</button>
          {activeCluster ? <span className="hint">이미 진행 중이거나 승인 대기 중인 쿠버네티스 클러스터가 있습니다.</span> : null}
        </div>
      </form>

      <PanelStatusMessage {...props.magnumStatus} />

      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">쿠버네티스 현황</p>
            <h3>내 쿠버네티스 클러스터</h3>
          </div>
        </div>
        <div className="qna-board">
          {props.magnumClusters.length ? props.magnumClusters.map((cluster) => (
            <article className="qna-thread" key={cluster.id}>
              <div className="qna-thread-head">
                <strong>{cluster.name}</strong>
                <span>{renderMagnumStatus(cluster.status)}</span>
              </div>
              <div className="simple-status-list">
                <div>{`CAPO 프로파일: ${cluster.clusterTemplateName || cluster.clusterTemplateId}`}</div>
                <div>{`Kubernetes 버전: ${cluster.kubernetesVersion || "-"}`}</div>
                <div>{`구성: control-plane ${cluster.masterCount} / worker ${cluster.nodeCount}`}</div>
                <div>{`Flavor: control-plane ${cluster.controlPlaneFlavor || "-"} / worker ${cluster.workerFlavor || "-"}`}</div>
                <div>{`UUID: ${cluster.clusterUuid || "-"}`}</div>
                <div>{`내부 API 주소: ${cluster.apiAddress ? `https://${cluster.apiAddress}:${cluster.apiPort || 6443}` : "-"}`}</div>
                <div>{`외부 API 주소: ${cluster.externalApiEnabled && cluster.externalApiHost && cluster.externalApiPort ? `https://${cluster.externalApiHost}:${cluster.externalApiPort}` : "사용 안 함"}`}</div>
                <div>{`상태 설명: ${cluster.statusReason || "상태를 확인하고 있습니다."}`}</div>
              </div>
              <div className="admin-inline-actions">
                {cluster.clusterUuid ? <button className="mini-btn" onClick={() => props.onRefreshMagnumCluster(cluster.id)} type="button">상태 갱신</button> : null}
                {cluster.clusterUuid ? <button className="mini-btn" onClick={() => props.onDownloadMagnumKubeconfig(cluster.id)} type="button">kubeconfig 다운로드</button> : null}
                {cluster.clusterUuid ? <KubectlDownloadMenu defaultMinor={String(cluster.kubernetesVersion || "").replace(/^v/, "").split(".").slice(0, 2).join(".")} /> : null}
                <button className="mini-btn danger-toggle" onClick={() => props.onDeleteMagnumCluster(cluster.id)} type="button">삭제</button>
              </div>
            </article>
          )) : <p className="hint">생성된 쿠버네티스 클러스터가 없습니다.</p>}
        </div>
      </section>
    </section>
  );
}

function renderTroveStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (["active", "available", "running"].includes(normalized)) return "사용 가능";
  if (["build", "building", "provisioning", "creating"].includes(normalized)) return "생성 중";
  if (["restart", "reboot", "resizing"].includes(normalized)) return "작업 중";
  if (["deleted"].includes(normalized)) return "삭제됨";
  if (["failed", "error"].includes(normalized)) return "실패";
  return status || "-";
}

export function TroveView(props) {
  const activeInstance = props.troveInstances.find((item) => !["deleted", "failed"].includes(String(item.status || "").toLowerCase())) || null;
  const allowedDatastores = props.troveDatastores?.length
    ? props.troveDatastores.map((item) => item.name || item.id).filter(Boolean)
    : props.platformStatus?.troveAllowedDatastores || [];
  const allowedFlavors = props.platformStatus?.troveAllowedFlavors || [];
  const allowedSizes = props.platformStatus?.troveAllowedSizesGb || [];
  const troveReady = Boolean(props.platformStatus?.troveEnabled);
  const canCreateTrove = troveReady && allowedDatastores.length > 0 && allowedFlavors.length > 0 && allowedSizes.length > 0;
  const datastoreLabels = { mysql: "MySQL", postgresql: "PostgreSQL", mariadb: "MariaDB" };

  return (
    <section className="portal-stack">
      <form className="simple-panel admin-form" id="trove-create" onSubmit={props.onCreateTroveInstance}>
        <div className="portal-detail-head">
          <div>
            <p className="card-label">Trove DBaaS</p>
            <h3>관리형 데이터베이스 인스턴스 생성</h3>
            <p className="hint">실습용 DB가 필요할 때 datastore, Flavor, 볼륨 크기만 정해 빠르게 요청합니다.</p>
          </div>
          <span className={`status-chip ${props.platformStatus?.troveEnabled ? "is-success" : "is-muted"}`}>
            {props.platformStatus?.troveEnabled ? "사용" : "비활성"}
          </span>
        </div>
        <div className="extension-summary-grid">
          <div><span>프로젝트</span><strong>{props.platformStatus?.troveProjectName || "trove"}</strong><small>DB 전용 자원 영역</small></div>
          <div><span>Datastore</span><strong>{allowedDatastores.length}</strong><small>{allowedDatastores.join(", ") || "등록 필요"}</small></div>
          <div><span>진행 중</span><strong>{activeInstance ? renderTroveStatus(activeInstance.status) : "없음"}</strong><small>{activeInstance?.name || "새 DB 생성 가능"}</small></div>
        </div>
        <div className="extension-step-card">
          <div className="extension-step-head">
            <span>1</span>
            <div>
              <strong>DB 엔진과 이름</strong>
              <p className="hint">사용 가능한 datastore 중에서 선택하고, 버전이 필요한 경우 명시합니다.</p>
            </div>
          </div>
          <div className="admin-form-grid compact-admin-grid">
            <AdminField label="DB 이름" required>
              <input value={props.troveForm.name} onChange={(event) => props.setTroveForm((current) => ({ ...current, name: event.target.value }))} placeholder="예: student-db" />
            </AdminField>
            <AdminField label="초기 데이터베이스">
              <input value={props.troveForm.databaseName || ""} onChange={(event) => props.setTroveForm((current) => ({ ...current, databaseName: event.target.value }))} placeholder="비워두면 DB 이름과 동일" />
            </AdminField>
            <AdminField label="Datastore" required>
              <select value={props.troveForm.datastoreType} onChange={(event) => props.setTroveForm((current) => ({ ...current, datastoreType: event.target.value, datastoreVersion: "" }))}>
                {allowedDatastores.length ? allowedDatastores.map((datastore) => (
                  <option key={datastore} value={datastore}>{datastoreLabels[String(datastore).toLowerCase()] || datastore}</option>
                )) : <option value="">등록된 datastore 없음</option>}
              </select>
            </AdminField>
            <AdminField label="Datastore 버전">
              <input value={props.troveForm.datastoreVersion} onChange={(event) => props.setTroveForm((current) => ({ ...current, datastoreVersion: event.target.value }))} placeholder="비워두면 기본 지원 버전 사용" />
            </AdminField>
          </div>
        </div>
        <div className="extension-step-card">
          <div className="extension-step-head">
            <span>2</span>
            <div>
              <strong>Flavor와 볼륨</strong>
              <p className="hint">관리자 허용 범위 안에서 DB 리소스와 저장 공간을 선택합니다.</p>
            </div>
          </div>
          <div className="admin-form-grid compact-admin-grid">
            <AdminField label="Flavor" required>
              <select value={props.troveForm.flavor} onChange={(event) => props.setTroveForm((current) => ({ ...current, flavor: event.target.value }))}>
                {allowedFlavors.length ? allowedFlavors.map((flavor) => (
                  <option key={flavor} value={flavor}>{flavor}</option>
                )) : <option value="">등록된 Flavor 없음</option>}
              </select>
            </AdminField>
            <AdminField label="볼륨(GB)" required>
              <select value={String(props.troveForm.sizeGb)} onChange={(event) => props.setTroveForm((current) => ({ ...current, sizeGb: event.target.value }))}>
                {allowedSizes.length ? allowedSizes.map((size) => (
                  <option key={size} value={String(size)}>{`${size} GB`}</option>
                )) : <option value="">등록된 크기 없음</option>}
              </select>
            </AdminField>
          </div>
        </div>
        <div className="simple-status-list">
          <div>프로젝트: 클라우드 콘솔에서 승인된 내 전용 프로젝트</div>
          <div>{`Trove API URL: ${props.platformStatus?.troveApiUrl || "-"}`}</div>
          <div>{`허용 datastore: ${allowedDatastores.join(", ") || "-"}`}</div>
        </div>
        <div className="portal-actions">
          <button className="primary-btn" disabled={!canCreateTrove} type="submit">DB 인스턴스 생성</button>
          {!canCreateTrove ? <span className="hint">관리자 설정에서 Trove 사용 여부, datastore, Flavor, 볼륨 크기를 확인해 주세요.</span> : null}
        </div>
      </form>

      <PanelStatusMessage {...props.troveStatus} />

      <section className="simple-panel" id="trove-instances">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">DB 인스턴스 현황</p>
            <h3>내 데이터베이스</h3>
          </div>
        </div>
        <div className="qna-board">
          {props.troveInstances.length ? props.troveInstances.map((instance) => (
            <details className="qna-thread resource-detail-disclosure" key={instance.id}>
              <summary className="qna-thread-head">
                <span className="resource-detail-title">
                  <strong>{instance.name}</strong>
                  <small>{`${instance.datastoreType || "DB"}${instance.datastoreVersion ? ` ${instance.datastoreVersion}` : ""} · ${instance.flavor || "-"}`}</small>
                </span>
                <span>{renderTroveStatus(instance.status)}</span>
              </summary>
              <div className="resource-detail-content">
                <div className="simple-status-list">
                  <div>{`Datastore: ${instance.datastoreType}${instance.datastoreVersion ? ` ${instance.datastoreVersion}` : ""}`}</div>
                  <div>{`프로젝트: ${instance.projectName || "-"}`}</div>
                  <div>{`Flavor: ${instance.flavor}`}</div>
                  <div>{`볼륨: ${instance.sizeGb} GB`}</div>
                  <div>{`UUID: ${instance.instanceUuid || "-"}`}</div>
                  <div>{`Hostname: ${instance.hostname || "-"}`}</div>
                  <div>{`Database: ${instance.databaseName || "-"}`}</div>
                  <div>{`Username: ${instance.databaseUsername || "Barbican에 저장됨"}`}</div>
                  <div>{`Port: ${instance.databasePort || 3306}`}</div>
                  <div>{`상태 설명: ${instance.statusReason || "-"}`}</div>
                  {instance.errorMessage ? <div>{`오류: ${instance.errorMessage}`}</div> : null}
                </div>
                {props.troveCredentials?.[instance.id] ? (
                  <div className="simple-status-list" aria-live="polite">
                    <div>{`접속 주소: ${props.troveCredentials[instance.id].host || "준비 중"}:${props.troveCredentials[instance.id].port || 3306}`}</div>
                    <div>{`아이디: ${props.troveCredentials[instance.id].username}`}</div>
                    <div>{`비밀번호: ${props.troveCredentials[instance.id].password}`}</div>
                    <div>{`데이터베이스: ${props.troveCredentials[instance.id].database}`}</div>
                  </div>
                ) : null}
                <div className="admin-inline-actions">
                  {instance.instanceUuid ? <button className="mini-btn" onClick={() => props.onRefreshTroveInstance(instance.id)} type="button">상태 갱신</button> : null}
                  {instance.hasCredential ? <button className="mini-btn" onClick={() => props.onRevealTroveCredentials(instance.id)} type="button">접속 정보 보기</button> : null}
                  <button className="mini-btn danger-toggle" onClick={() => props.onDeleteTroveInstance(instance.id)} type="button">삭제</button>
                </div>
              </div>
            </details>
          )) : <p className="hint">생성된 DB 인스턴스가 없습니다.</p>}
        </div>
      </section>
      <section className="simple-panel" id="trove-credentials">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">Barbican</p>
            <h3>내 DB 자격증명</h3>
            <p className="hint">전용 프로젝트에 저장된 DB 접속 정보를 인스턴스별로 확인합니다. 실제 비밀번호는 요청할 때만 표시됩니다.</p>
          </div>
        </div>
        <div className="simple-status-list">
          {props.troveInstances.some((instance) => instance.hasCredential) ? props.troveInstances.filter((instance) => instance.hasCredential).map((instance) => (
            <div key={`credential-${instance.id}`}>
              <strong>{instance.name}</strong>{` · ${instance.projectName || "프로젝트 없음"} · `}
              <button className="mini-btn" onClick={() => props.onRevealTroveCredentials(instance.id)} type="button">접속 정보 보기</button>
            </div>
          )) : <div>저장된 DB 자격증명이 없습니다.</div>}
        </div>
      </section>
    </section>
  );
}
