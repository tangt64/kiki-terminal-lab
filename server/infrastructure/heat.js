// Infrastructure dependency closure extracted from Terminal Lab. See SOURCE-PROVENANCE.json.
import fs from "node:fs/promises";

import path from "node:path";

import { fileURLToPath } from "node:url";

import { createHash } from "node:crypto";

import YAML from "yaml";

import { fetchOpenstack, registerOpenstackCloudCaPaths } from "./openstack-fetch.js";

import { createIsoServer, completeIsoServer, isoError } from "./iso-vm.js";

import { receiveIso, streamIsoToGlance } from "./iso-upload.js";

import { getOpenstackRequestCaBundle } from "./openstack-fetch.js";

const HEAT_DRIVER = process.env.HEAT_DRIVER || "openstack";

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

const DATA_ROOT_DIR = process.env.DATA_ROOT_DIR || path.resolve(__dirname, "../data");

const OPENSTACK_CLOUDS_YAML = process.env.OPENSTACK_CLOUDS_YAML || path.join(process.cwd(), "clouds.yaml");

const OPENSTACK_CLOUD_NAME = process.env.OPENSTACK_CLOUD_NAME || "openstack";

const OPENSTACK_SERVICE_PROJECT_NAME = process.env.OPENSTACK_SERVICE_PROJECT_NAME || "service";

const SELF_SERVICE_VM_NETWORK = process.env.SELF_SERVICE_VM_NETWORK || "net-infra";

const OPENSTACK_SERVICE_CLOUDS_YAML = process.env.OPENSTACK_SERVICE_CLOUDS_YAML || "";

const OPENSTACK_SERVICE_CLOUD_NAME = process.env.OPENSTACK_SERVICE_CLOUD_NAME || "";

const OPENSTACK_SERVICE_COMPUTE_API_URL = process.env.OPENSTACK_SERVICE_COMPUTE_API_URL || "";

const OPENSTACK_SERVICE_NETWORK_API_URL = process.env.OPENSTACK_SERVICE_NETWORK_API_URL || "";

const OPENSTACK_SERVICE_METRIC_API_URL = process.env.OPENSTACK_SERVICE_METRIC_API_URL || "";

const DEFAULT_POC_PROJECT_NAME = "terminal-community";

const OPENSTACK_POC_PROJECT_NAME = process.env.OPENSTACK_POC_PROJECT_NAME || DEFAULT_POC_PROJECT_NAME;

const OPENSTACK_POC_CLOUDS_YAML = process.env.OPENSTACK_POC_CLOUDS_YAML || "";

const OPENSTACK_POC_CLOUD_NAME = process.env.OPENSTACK_POC_CLOUD_NAME || "";

const OPENSTACK_POC_METRIC_API_URL = process.env.OPENSTACK_POC_METRIC_API_URL || "";

const OPENSTACK_INTERFACE = process.env.OPENSTACK_INTERFACE || "";

const OPENSTACK_PREFER_INTERNAL_ENDPOINTS = process.env.OPENSTACK_PREFER_INTERNAL_ENDPOINTS === "1";

const OPENSTACK_INTERNAL_ENDPOINT_HOST = String(process.env.OPENSTACK_INTERNAL_ENDPOINT_HOST || "").trim();

const OPENSTACK_PUBLIC_ENDPOINT_HOSTS = new Set(
  String(process.env.OPENSTACK_PUBLIC_ENDPOINT_HOSTS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);

const OPENSTACK_REGION = process.env.OPENSTACK_REGION || "";

const HEAT_POLL_INTERVAL_MS = Number(process.env.HEAT_POLL_INTERVAL_MS || 5000);

const HEAT_POLL_TIMEOUT_MS = Number(process.env.HEAT_POLL_TIMEOUT_MS || 1000 * 60 * 10);

const OPENSTACK_DEBUG = process.env.OPENSTACK_DEBUG === "1";

const SELF_SERVICE_VM_VLAN_PROTOCOL_MAX = 4094;

const SELF_SERVICE_VM_VLAN_DEFAULT_MIN = 4000;

const SELF_SERVICE_VM_VLAN_DEFAULT_MAX = 4300;

const SELF_SERVICE_VM_VLAN_RAW_MIN = Math.min(SELF_SERVICE_VM_VLAN_PROTOCOL_MAX, Math.max(1, Number.parseInt(process.env.SELF_SERVICE_VM_VLAN_MIN || String(SELF_SERVICE_VM_VLAN_DEFAULT_MIN), 10) || SELF_SERVICE_VM_VLAN_DEFAULT_MIN));

const SELF_SERVICE_VM_VLAN_RAW_MAX = Math.min(SELF_SERVICE_VM_VLAN_PROTOCOL_MAX, Number.parseInt(process.env.SELF_SERVICE_VM_VLAN_MAX || String(SELF_SERVICE_VM_VLAN_DEFAULT_MAX), 10) || SELF_SERVICE_VM_VLAN_DEFAULT_MAX);

const SELF_SERVICE_VM_VLAN_MIN = Math.min(SELF_SERVICE_VM_VLAN_RAW_MIN, SELF_SERVICE_VM_VLAN_RAW_MAX);

const SELF_SERVICE_VM_VLAN_MAX = Math.max(SELF_SERVICE_VM_VLAN_RAW_MIN, SELF_SERVICE_VM_VLAN_RAW_MAX);

const openstackCloudTargets = {
  serviceProjectName: OPENSTACK_SERVICE_PROJECT_NAME,
  serviceCloudsYaml: OPENSTACK_SERVICE_CLOUDS_YAML,
  serviceCloudName: OPENSTACK_SERVICE_CLOUD_NAME,
  serviceAuthUrl: "",
  serviceHeatApiUrl: "",
  serviceComputeApiUrl: OPENSTACK_SERVICE_COMPUTE_API_URL,
  serviceNetworkApiUrl: OPENSTACK_SERVICE_NETWORK_API_URL,
  serviceMetricApiUrl: OPENSTACK_SERVICE_METRIC_API_URL,
  pocProjectName: OPENSTACK_POC_PROJECT_NAME,
  pocCloudsYaml: OPENSTACK_POC_CLOUDS_YAML,
  pocCloudName: OPENSTACK_POC_CLOUD_NAME,
  pocAuthUrl: "",
  pocHeatApiUrl: "",
  pocMetricApiUrl: OPENSTACK_POC_METRIC_API_URL,
};

function buildNetworkApiUrl(endpoint, pathName) {
  const base = normalizeEndpoint(endpoint);
  const suffix = String(pathName || "").replace(/^\/+/, "");
  return /\/v2\.0$/i.test(base) ? `${base}/${suffix}` : `${base}/v2.0/${suffix}`;
}

function normalizeMiniHorizonCollection(payload, key) {
  return Array.isArray(payload?.[key]) ? payload[key] : [];
}

async function getProjectResourceContext(projectName = "") {
  const normalizedProjectName = String(projectName || "").trim();
  if (!normalizedProjectName) throw new Error("projectName is required.");
  const cloud = await loadCloudConfig({ projectName: normalizedProjectName });
  const auth = await authenticate(cloud, { projectName: normalizedProjectName });
  return {
    projectName: normalizedProjectName,
    projectId: auth.projectId || "",
    token: auth.token,
    imageEndpoint: normalizeEndpoint(findCatalogEndpoint(auth.catalog, { type: "image", region: cloud.region_name, interfaceName: cloud.interface })).replace(/\/v2$/i, ""),
    computeEndpoint: resolveComputeEndpoint(cloud, auth),
    volumeEndpoint: applyProjectIdToEndpoint(resolveVolumeEndpoint(cloud, auth), auth.projectId),
    networkEndpoint: resolveNetworkEndpoint(cloud, auth),
    loadBalancerEndpoint: normalizeEndpoint(findCatalogEndpoint(auth.catalog, { type: "load-balancer", region: cloud.region_name, interfaceName: cloud.interface })),
    alarmEndpoint: normalizeEndpoint(findCatalogEndpoint(auth.catalog, { type: "alarming", region: cloud.region_name, interfaceName: cloud.interface })),
    reservationEndpoint: normalizeEndpoint(findCatalogEndpoint(auth.catalog, { type: "reservation", region: cloud.region_name, interfaceName: cloud.interface })),
    shareEndpoint: applyProjectIdToEndpoint(normalizeEndpoint(findCatalogEndpoint(auth.catalog, { type: "sharev2", region: cloud.region_name, interfaceName: cloud.interface })), auth.projectId),
  };
}

async function mutateProjectService({ projectName = "", endpointKey = "", serviceLabel = "OpenStack", pathName = "", method = "POST", body = null, expectJson = true } = {}) {
  if (HEAT_DRIVER === "mock") return { id: `mock-${Date.now()}`, ...(body || {}) };
  const context = await getProjectResourceContext(projectName);
  const endpoint = context[endpointKey];
  if (!endpoint) throw new Error(`${serviceLabel} endpoint를 확인할 수 없습니다.`);
  return openstackFetch(buildVersionAwareServiceUrl(endpoint, pathName), { method, token: context.token, body, expectJson });
}

function buildVersionAwareServiceUrl(endpoint = "", pathName = "") {
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  const normalizedPath = String(pathName || "").replace(/^\/+/, "");
  const endpointVersion = normalizedEndpoint.match(/\/(v\d+(?:\.\d+)?)$/i)?.[1]?.toLowerCase() || "";
  const pathParts = normalizedPath.split("/").filter(Boolean);
  if (endpointVersion && String(pathParts[0] || "").toLowerCase() === endpointVersion) {
    pathParts.shift();
  }
  return `${normalizedEndpoint}/${pathParts.join("/")}`;
}

async function createOpenstackAlarm({ projectName = "", name = "", resourceId = "", metric = "cpu_util", threshold = 80, comparisonOperator = "gt", period = 300 } = {}) {
  const normalizedName = String(name || "").trim();
  const normalizedResourceId = String(resourceId || "").trim();
  if (!normalizedName || !normalizedResourceId) throw new Error("알림 이름과 대상 인스턴스가 필요합니다.");
  return mutateProjectService({ projectName, endpointKey: "alarmEndpoint", serviceLabel: "Aodh", pathName: "v2/alarms", body: { name: normalizedName, type: "gnocchi_resources_threshold", enabled: true, severity: "moderate", gnocchi_resources_threshold_rule: { metric: String(metric || "cpu_util"), threshold: Number(threshold || 80), comparison_operator: String(comparisonOperator || "gt"), aggregation_method: "mean", granularity: Number(period || 300), evaluation_periods: 1, resource_type: "instance", resource_id: normalizedResourceId } } });
}

async function deleteOpenstackAlarm({ projectName = "", alarmId = "" } = {}) {
  return mutateProjectService({ projectName, endpointKey: "alarmEndpoint", serviceLabel: "Aodh", pathName: `v2/alarms/${encodeURIComponent(String(alarmId || ""))}`, method: "DELETE", expectJson: false });
}

async function createOpenstackReservation({ projectName = "", name = "", startDate = "", endDate = "", resourceType = "virtual:instance", amount = 1, flavor = "" } = {}) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName || !startDate || !endDate) throw new Error("예약 이름과 시작·종료 시간이 필요합니다.");
  const resourceProperties = flavor ? JSON.stringify(["=", "$flavor_id", String(flavor)]) : "";
  const normalizedStartDate = new Date(startDate).toISOString();
  const normalizedEndDate = new Date(endDate).toISOString();
  if (normalizedEndDate <= normalizedStartDate) throw new Error("예약 종료 시간은 시작 시간보다 뒤여야 합니다.");
  return mutateProjectService({ projectName, endpointKey: "reservationEndpoint", serviceLabel: "Blazar", pathName: "v1/leases", body: { name: normalizedName, start_date: normalizedStartDate, end_date: normalizedEndDate, events: [], reservations: [{ resource_type: resourceType, amount: Math.max(1, Number(amount || 1)), ...(resourceProperties ? { resource_properties: resourceProperties } : {}) }] } });
}

async function deleteOpenstackReservation({ projectName = "", leaseId = "" } = {}) {
  return mutateProjectService({ projectName, endpointKey: "reservationEndpoint", serviceLabel: "Blazar", pathName: `v1/leases/${encodeURIComponent(String(leaseId || ""))}`, method: "DELETE", expectJson: false });
}

async function createOpenstackShare({ projectName = "", name = "", sizeGb = 1, shareType = "", shareProtocol = "NFS" } = {}) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) throw new Error("공유 스토리지 이름이 필요합니다.");
  return mutateProjectService({ projectName, endpointKey: "shareEndpoint", serviceLabel: "Manila", pathName: "shares", body: { share: { name: normalizedName, size: Math.max(1, Number(sizeGb || 1)), share_proto: String(shareProtocol || "NFS").toUpperCase(), ...(shareType ? { share_type: String(shareType) } : {}) } } });
}

async function deleteOpenstackShare({ projectName = "", shareId = "" } = {}) {
  return mutateProjectService({ projectName, endpointKey: "shareEndpoint", serviceLabel: "Manila", pathName: `shares/${encodeURIComponent(String(shareId || ""))}`, method: "DELETE", expectJson: false });
}

async function mutateNeutron({ projectName = "", pathName = "", method = "POST", body = null, expectJson = true } = {}) {
  if (HEAT_DRIVER === "mock") {
    const key = body && typeof body === "object" ? Object.keys(body)[0] : "";
    if (key && body[key] && typeof body[key] === "object") return { [key]: { id: `mock-${key}-${Date.now()}`, ...body[key] } };
    return { ok: true, id: `mock-${Date.now()}` };
  }
  const context = await getProjectResourceContext(projectName);
  if (!context.networkEndpoint) throw new Error("Neutron endpoint를 확인할 수 없습니다.");
  return openstackFetch(buildNetworkApiUrl(context.networkEndpoint, pathName), { method, token: context.token, body, expectJson });
}

async function mutateOctavia({ projectName = "", pathName = "", method = "POST", body = null, expectJson = true } = {}) {
  if (HEAT_DRIVER === "mock") {
    const key = body && typeof body === "object" ? Object.keys(body)[0] : "";
    if (key && body[key] && typeof body[key] === "object") return { [key]: { id: `mock-${key}-${Date.now()}`, ...body[key] } };
    return { ok: true, id: `mock-${Date.now()}` };
  }
  const context = await getProjectResourceContext(projectName);
  if (!context.loadBalancerEndpoint) {
    const error = new Error("Octavia 로드밸런서 endpoint를 확인할 수 없습니다.");
    error.statusCode = 503;
    throw error;
  }
  const suffix = String(pathName || "").replace(/^\/+/, "");
  return openstackFetch(`${context.loadBalancerEndpoint}/v2/lbaas/${suffix}`, { method, token: context.token, body, expectJson });
}

function normalizeLoadBalancerProtocol(value, allowed = ["TCP", "HTTP", "HTTPS", "UDP"]) {
  const protocol = String(value || "TCP").trim().toUpperCase();
  if (!allowed.includes(protocol)) throw new Error(`지원하지 않는 로드밸런서 프로토콜입니다: ${protocol}`);
  return protocol;
}

function normalizeProtocolPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("포트는 1~65535 사이여야 합니다.");
  return port;
}

async function createOpenstackLoadBalancer({ projectName = "", name = "", vipSubnetId = "" } = {}) {
  const value = String(name || "").trim(), subnet = String(vipSubnetId || "").trim();
  if (!value || !subnet) throw new Error("로드밸런서 이름과 VIP 서브넷이 필요합니다.");
  const data = await mutateOctavia({ projectName, pathName: "loadbalancers", body: { loadbalancer: { name: value, vip_subnet_id: subnet, admin_state_up: true } } });
  return data?.loadbalancer || data;
}

async function deleteOpenstackLoadBalancer({ projectName = "", loadBalancerId = "" } = {}) {
  const id = String(loadBalancerId || "").trim(); if (!id) throw new Error("loadBalancerId가 필요합니다.");
  await mutateOctavia({ projectName, pathName: `loadbalancers/${encodeURIComponent(id)}?cascade=true`, method: "DELETE", expectJson: false });
  return { ok: true, loadBalancerId: id };
}

async function createOpenstackLoadBalancerListener({ projectName = "", loadBalancerId = "", name = "", protocol = "TCP", protocolPort = 80 } = {}) {
  const loadbalancer = String(loadBalancerId || "").trim(), value = String(name || "").trim();
  if (!loadbalancer || !value) throw new Error("로드밸런서와 리스너 이름이 필요합니다.");
  const data = await mutateOctavia({ projectName, pathName: "listeners", body: { listener: { name: value, loadbalancer_id: loadbalancer, protocol: normalizeLoadBalancerProtocol(protocol), protocol_port: normalizeProtocolPort(protocolPort), admin_state_up: true } } });
  return data?.listener || data;
}

async function deleteOpenstackLoadBalancerListener({ projectName = "", listenerId = "" } = {}) {
  const id = String(listenerId || "").trim(); if (!id) throw new Error("listenerId가 필요합니다.");
  await mutateOctavia({ projectName, pathName: `listeners/${encodeURIComponent(id)}`, method: "DELETE", expectJson: false }); return { ok: true, listenerId: id };
}

async function createOpenstackLoadBalancerPool({ projectName = "", listenerId = "", name = "", protocol = "TCP", algorithm = "ROUND_ROBIN" } = {}) {
  const listener = String(listenerId || "").trim(), value = String(name || "").trim(), lbAlgorithm = String(algorithm || "ROUND_ROBIN").trim().toUpperCase();
  if (!listener || !value) throw new Error("리스너와 풀 이름이 필요합니다.");
  if (!["ROUND_ROBIN", "LEAST_CONNECTIONS", "SOURCE_IP"].includes(lbAlgorithm)) throw new Error("지원하지 않는 분산 방식입니다.");
  const data = await mutateOctavia({ projectName, pathName: "pools", body: { pool: { name: value, listener_id: listener, protocol: normalizeLoadBalancerProtocol(protocol), lb_algorithm: lbAlgorithm, admin_state_up: true } } });
  return data?.pool || data;
}

async function deleteOpenstackLoadBalancerPool({ projectName = "", poolId = "" } = {}) {
  const id = String(poolId || "").trim(); if (!id) throw new Error("poolId가 필요합니다.");
  await mutateOctavia({ projectName, pathName: `pools/${encodeURIComponent(id)}`, method: "DELETE", expectJson: false }); return { ok: true, poolId: id };
}

async function createOpenstackLoadBalancerMember({ projectName = "", poolId = "", name = "", address = "", protocolPort = 80, subnetId = "" } = {}) {
  const pool = String(poolId || "").trim(), ip = String(address || "").trim(), subnet = String(subnetId || "").trim();
  if (!pool || !ip || !subnet) throw new Error("풀, 멤버 IP, 서브넷이 필요합니다.");
  const member = { name: String(name || "").trim(), address: ip, protocol_port: normalizeProtocolPort(protocolPort), subnet_id: subnet, admin_state_up: true };
  const data = await mutateOctavia({ projectName, pathName: `pools/${encodeURIComponent(pool)}/members`, body: { member } }); return data?.member || data;
}

async function deleteOpenstackLoadBalancerMember({ projectName = "", poolId = "", memberId = "" } = {}) {
  const pool = String(poolId || "").trim(), id = String(memberId || "").trim(); if (!pool || !id) throw new Error("poolId와 memberId가 필요합니다.");
  await mutateOctavia({ projectName, pathName: `pools/${encodeURIComponent(pool)}/members/${encodeURIComponent(id)}`, method: "DELETE", expectJson: false }); return { ok: true, poolId: pool, memberId: id };
}

async function createOpenstackLoadBalancerHealthMonitor({ projectName = "", poolId = "", type = "TCP", delay = 5, timeout = 3, maxRetries = 3, urlPath = "/", expectedCodes = "200" } = {}) {
  const pool = String(poolId || "").trim(), monitorType = normalizeLoadBalancerProtocol(type, ["PING", "TCP", "HTTP", "HTTPS"]);
  if (!pool) throw new Error("poolId가 필요합니다.");
  const monitor = { pool_id: pool, type: monitorType, delay: Math.max(1, Number(delay) || 5), timeout: Math.max(1, Number(timeout) || 3), max_retries: Math.max(1, Math.min(10, Number(maxRetries) || 3)), admin_state_up: true };
  if (["HTTP", "HTTPS"].includes(monitorType)) { monitor.url_path = String(urlPath || "/").trim() || "/"; monitor.expected_codes = String(expectedCodes || "200").trim() || "200"; monitor.http_method = "GET"; }
  const data = await mutateOctavia({ projectName, pathName: "healthmonitors", body: { healthmonitor: monitor } }); return data?.healthmonitor || data;
}

async function deleteOpenstackLoadBalancerHealthMonitor({ projectName = "", healthMonitorId = "" } = {}) {
  const id = String(healthMonitorId || "").trim(); if (!id) throw new Error("healthMonitorId가 필요합니다.");
  await mutateOctavia({ projectName, pathName: `healthmonitors/${encodeURIComponent(id)}`, method: "DELETE", expectJson: false }); return { ok: true, healthMonitorId: id };
}

async function createOpenstackNetwork({ projectName = "", name = "" } = {}) {
  const value=String(name||"").trim(); if(!value) throw new Error("네트워크 이름이 필요합니다.");
  const data=await mutateNeutron({projectName,pathName:"networks",body:{network:{name:value,admin_state_up:true}}}); return data?.network||data;
}

async function deleteOpenstackNetwork({ projectName = "", networkId = "" } = {}) {
  const id=String(networkId||"").trim(); if(!id) throw new Error("networkId가 필요합니다.");
  await mutateNeutron({projectName,pathName:`networks/${encodeURIComponent(id)}`,method:"DELETE",expectJson:false}); return {ok:true,networkId:id};
}

async function createOpenstackSubnet({ projectName = "", networkId = "", name = "", cidr = "" } = {}) {
  const network=String(networkId||"").trim(), value=String(name||"").trim(), range=String(cidr||"").trim();
  if(!network||!value||!range) throw new Error("networkId, 서브넷 이름, CIDR가 필요합니다.");
  const data=await mutateNeutron({projectName,pathName:"subnets",body:{subnet:{network_id:network,name:value,cidr:range,ip_version:4,enable_dhcp:true}}}); return data?.subnet||data;
}

async function deleteOpenstackSubnet({ projectName = "", subnetId = "" } = {}) {
  const id=String(subnetId||"").trim(); if(!id) throw new Error("subnetId가 필요합니다.");
  await mutateNeutron({projectName,pathName:`subnets/${encodeURIComponent(id)}`,method:"DELETE",expectJson:false}); return {ok:true,subnetId:id};
}

async function createOpenstackRouter({ projectName = "", name = "", externalNetworkId = "" } = {}) {
  const value=String(name||"").trim(); if(!value) throw new Error("라우터 이름이 필요합니다.");
  const router={name:value,admin_state_up:true}; if(String(externalNetworkId||"").trim()) router.external_gateway_info={network_id:String(externalNetworkId).trim()};
  const data=await mutateNeutron({projectName,pathName:"routers",body:{router}}); return data?.router||data;
}

async function deleteOpenstackRouter({ projectName = "", routerId = "" } = {}) {
  const id=String(routerId||"").trim(); if(!id) throw new Error("routerId가 필요합니다.");
  await mutateNeutron({projectName,pathName:`routers/${encodeURIComponent(id)}`,method:"DELETE",expectJson:false}); return {ok:true,routerId:id};
}

async function connectOpenstackRouterSubnet({ projectName = "", routerId = "", subnetId = "" } = {}) {
  const router=String(routerId||"").trim(), subnet=String(subnetId||"").trim(); if(!router||!subnet) throw new Error("routerId와 subnetId가 필요합니다.");
  return mutateNeutron({projectName,pathName:`routers/${encodeURIComponent(router)}/add_router_interface`,method:"PUT",body:{subnet_id:subnet}});
}

async function disconnectOpenstackRouterSubnet({ projectName = "", routerId = "", subnetId = "" } = {}) {
  const router=String(routerId||"").trim(), subnet=String(subnetId||"").trim(); if(!router||!subnet) throw new Error("routerId와 subnetId가 필요합니다.");
  return mutateNeutron({projectName,pathName:`routers/${encodeURIComponent(router)}/remove_router_interface`,method:"PUT",body:{subnet_id:subnet}});
}

async function allocateOpenstackFloatingIp({ projectName = "", floatingNetworkId = "", portId = "" } = {}) {
  const network=String(floatingNetworkId||"").trim(); if(!network) throw new Error("외부 네트워크 ID가 필요합니다.");
  const floatingip={floating_network_id:network}; if(String(portId||"").trim()) floatingip.port_id=String(portId).trim();
  const data=await mutateNeutron({projectName,pathName:"floatingips",body:{floatingip}}); return data?.floatingip||data;
}

async function updateOpenstackFloatingIpPort({ projectName = "", floatingIpId = "", portId = "" } = {}) {
  const id=String(floatingIpId||"").trim(); if(!id) throw new Error("floatingIpId가 필요합니다.");
  const data=await mutateNeutron({projectName,pathName:`floatingips/${encodeURIComponent(id)}`,method:"PUT",body:{floatingip:{port_id:String(portId||"").trim()||null}}}); return data?.floatingip||data;
}

async function releaseOpenstackFloatingIp({ projectName = "", floatingIpId = "" } = {}) {
  const id=String(floatingIpId||"").trim(); if(!id) throw new Error("floatingIpId가 필요합니다.");
  await mutateNeutron({projectName,pathName:`floatingips/${encodeURIComponent(id)}`,method:"DELETE",expectJson:false}); return {ok:true,floatingIpId:id};
}

async function createOpenstackSecurityGroup({ projectName = "", name = "", description = "" } = {}) {
  const value=String(name||"").trim(); if(!value) throw new Error("보안그룹 이름이 필요합니다.");
  const data=await mutateNeutron({projectName,pathName:"security-groups",body:{security_group:{name:value,description:String(description||"").trim()}}}); return data?.security_group||data;
}

async function deleteOpenstackSecurityGroup({ projectName = "", securityGroupId = "" } = {}) {
  const id=String(securityGroupId||"").trim(); if(!id) throw new Error("securityGroupId가 필요합니다.");
  await mutateNeutron({projectName,pathName:`security-groups/${encodeURIComponent(id)}`,method:"DELETE",expectJson:false}); return {ok:true,securityGroupId:id};
}

async function createOpenstackSecurityGroupRule({ projectName = "", securityGroupId = "", direction = "ingress", protocol = null, portMin = null, portMax = null, remoteIpPrefix = "" } = {}) {
  const group=String(securityGroupId||"").trim(); if(!group) throw new Error("securityGroupId가 필요합니다.");
  const normalizedProtocol=String(protocol||"").trim().toLowerCase();
  const rule={security_group_id:group,direction:direction==="egress"?"egress":"ingress",ethertype:"IPv4"};
  if(normalizedProtocol) rule.protocol=normalizedProtocol;
  if(["tcp","udp"].includes(normalizedProtocol)){const min=Number(portMin),max=Number(portMax);if(!Number.isInteger(min)||!Number.isInteger(max)||min<1||max>65535||min>max) throw new Error("TCP/UDP 포트 범위는 1~65535 사이여야 합니다.");rule.port_range_min=min;rule.port_range_max=max;}
  if(String(remoteIpPrefix||"").trim()) rule.remote_ip_prefix=String(remoteIpPrefix).trim();
  const data=await mutateNeutron({projectName,pathName:"security-group-rules",body:{security_group_rule:rule}}); return data?.security_group_rule||data;
}

async function deleteOpenstackSecurityGroupRule({ projectName = "", ruleId = "" } = {}) {
  const id=String(ruleId||"").trim(); if(!id) throw new Error("ruleId가 필요합니다.");
  await mutateNeutron({projectName,pathName:`security-group-rules/${encodeURIComponent(id)}`,method:"DELETE",expectJson:false}); return {ok:true,ruleId:id};
}

async function attachOpenstackServerNetwork({ projectName = "", serverId = "", networkId = "" } = {}) {
  const server = String(serverId || "").trim();
  const network = String(networkId || "").trim();
  if (!server || !network) throw new Error("serverId와 networkId가 필요합니다.");
  if (HEAT_DRIVER === "mock") return { id: `mock-port-${Date.now()}`, port_id: `mock-port-${Date.now()}`, net_id: network };
  const context = await getProjectResourceContext(projectName);
  if (!context.computeEndpoint) throw new Error("Nova endpoint를 확인할 수 없습니다.");
  const data = await openstackFetch(`${context.computeEndpoint}/servers/${encodeURIComponent(server)}/os-interface`, { method: "POST", token: context.token, body: { interfaceAttachment: { net_id: network } } });
  return data?.interfaceAttachment || data || {};
}

async function detachOpenstackServerNetwork({ projectName = "", serverId = "", portId = "" } = {}) {
  const server = String(serverId || "").trim();
  const port = String(portId || "").trim();
  if (!server || !port) throw new Error("serverId와 portId가 필요합니다.");
  if (HEAT_DRIVER === "mock") return { ok: true, serverId: server, portId: port };
  const context = await getProjectResourceContext(projectName);
  if (!context.computeEndpoint) throw new Error("Nova endpoint를 확인할 수 없습니다.");
  await openstackFetch(`${context.computeEndpoint}/servers/${encodeURIComponent(server)}/os-interface/${encodeURIComponent(port)}`, { method: "DELETE", token: context.token, expectJson: false });
  return { ok: true, serverId: server, portId: port };
}

async function addOpenstackServerSecurityGroup({ projectName = "", serverId = "", securityGroupName = "" } = {}) {
  const server = String(serverId || "").trim();
  const name = String(securityGroupName || "").trim();
  if (!server || !name) throw new Error("serverId와 보안그룹 이름이 필요합니다.");
  if (HEAT_DRIVER === "mock") return { ok: true, serverId: server, securityGroupName: name };
  const context = await getProjectResourceContext(projectName);
  if (!context.computeEndpoint) throw new Error("Nova endpoint를 확인할 수 없습니다.");
  await openstackFetch(context.computeEndpoint + "/servers/" + encodeURIComponent(server) + "/action", { method: "POST", token: context.token, body: { addSecurityGroup: { name } }, expectJson: false });
  return { ok: true, serverId: server, securityGroupName: name };
}

async function removeOpenstackServerSecurityGroup({ projectName = "", serverId = "", securityGroupName = "" } = {}) {
  const server = String(serverId || "").trim();
  const name = String(securityGroupName || "").trim();
  if (!server || !name) throw new Error("serverId와 보안그룹 이름이 필요합니다.");
  if (HEAT_DRIVER === "mock") return { ok: true, serverId: server, securityGroupName: name };
  const context = await getProjectResourceContext(projectName);
  if (!context.computeEndpoint) throw new Error("Nova endpoint를 확인할 수 없습니다.");
  await openstackFetch(context.computeEndpoint + "/servers/" + encodeURIComponent(server) + "/action", { method: "POST", token: context.token, body: { removeSecurityGroup: { name } }, expectJson: false });
  return { ok: true, serverId: server, securityGroupName: name };
}

async function isoProjectApi(projectName) {
  const context = await getProjectResourceContext(projectName);
  const api = (kind, suffix, options) => {
    const endpoint = context[kind + "Endpoint"];
    if (!endpoint) throw isoError(kind + " 서비스에 연결할 수 없습니다.", 503);
    return openstackFetch(endpoint + suffix, { ...options, token: context.token });
  };
  return { context, api };
}

const isoUploads = new Set();

async function uploadOpenstackIso({ projectName, name, expectedSha256, ownerUserId, stream }) {
  if (!name || String(name).length > 128) throw isoError("ISO 이미지 이름은 1~128자로 지정하세요.");
  if (HEAT_DRIVER !== "openstack") throw isoError("ISO 업로드는 실제 OpenStack 연결이 필요합니다.", 503);
  const uploadKey = `${projectName}/${ownerUserId}`;
  if (isoUploads.has(uploadKey) || isoUploads.size >= 2) throw isoError("ISO 업로드가 진행 중입니다. 완료 후 다시 시도하세요.", 409);
  isoUploads.add(uploadKey); let file;
  try {
    const { context, api } = await isoProjectApi(projectName);
    if (!context.imageEndpoint) throw isoError("Glance 서비스에 연결할 수 없습니다.", 503);
    file = await receiveIso(stream, { directory: path.join(DATA_ROOT_DIR, "iso-uploads"), expectedSha256 });
    const listed = await api("image", "/v2/images?disk_format=iso&limit=500", { method: "GET" });
    const existing = (listed.images || []).find((image) => image.status === "active" && image.owner === context.projectId && image.terminal_lab_user_id === String(ownerUserId) && image.terminal_lab_iso_sha256 === file.sha256);
    if (existing) return { ...existing, reused: true };
    const image = await api("image", "/v2/images", { method: "POST", body: { name: String(name), disk_format: "iso", container_format: "bare", visibility: "private", hw_firmware_type: "uefi", hw_disk_bus: "scsi", hw_cdrom_bus: "scsi", hw_scsi_model: "virtio-scsi", os_secure_boot: "disabled", terminal_lab_managed: "true", terminal_lab_user_id: String(ownerUserId), terminal_lab_iso_sha256: file.sha256 } });
    if (!image?.id) throw isoError("Glance 이미지 ID를 확인하지 못했습니다.", 502);
    await streamIsoToGlance(context.imageEndpoint + `/v2/images/${image.id}/file`, { ...file, token: context.token, ca: getOpenstackRequestCaBundle() });
    const uploaded = await api("image", `/v2/images/${image.id}`, { method: "GET" });
    if (uploaded.status !== "active") throw isoError(`ISO 이미지 ${image.id}가 아직 active 상태가 아닙니다. 상태를 확인하세요.`, 409);
    return uploaded;
  } finally { try { if (file) await file.cleanup(); } finally { isoUploads.delete(uploadKey); } }
}

async function completeOpenstackIsoInstall(options) {
  if (HEAT_DRIVER !== "openstack") throw isoError("디스크 부팅 전환은 실제 OpenStack 연결이 필요합니다.", 503);
  const { api } = await isoProjectApi(options.projectName);
  return completeIsoServer(api, options);
}

async function createOpenstackServerDirect({ projectName = "", name = "", imageRef = "", flavorRef = "", networkId = "", securityGroupNames = [], bootVolumeSizeGb = 0, bootSource = "image", ownerUserId = "", loginUsername = "", loginPassword = "" } = {}) {
  const serverName=String(name||"").trim(), image=String(imageRef||"").trim(), flavor=String(flavorRef||"").trim(), network=String(networkId||"").trim();
  if(!serverName||!image||!flavor||!network) throw new Error("인스턴스 이름, 이미지, Flavor, 네트워크가 필요합니다.");
  if (!["image", "iso"].includes(bootSource)) throw isoError("지원하지 않는 부팅 방식입니다.");
  if(HEAT_DRIVER==="mock") return {id:`mock-server-${Date.now()}`,name:serverName,status:"BUILD"};
  const context=await getProjectResourceContext(projectName);
  if(!context.computeEndpoint) throw new Error("Nova endpoint를 확인할 수 없습니다.");
  const cloud=await loadCloudConfig({projectName}); const auth={token:context.token,catalog:(await authenticate(cloud,{projectName})).catalog};
  const imageEndpoint=normalizeEndpoint(findCatalogEndpoint(auth.catalog,{type:"image",region:cloud.region_name,interfaceName:cloud.interface}));
  const imageId=await resolveOpenstackImageId({imageEndpoint,token:context.token,imageRef:image});
  const flavorId=isOpenstackUuidValue(flavor)?flavor:await resolveFlavorRefByName({computeEndpoint:context.computeEndpoint,token:context.token,flavorName:flavor});
  if(!imageId) throw new Error("선택한 이미지를 찾을 수 없습니다."); if(!flavorId) throw new Error("선택한 Flavor를 찾을 수 없습니다.");
  if (bootSource === "iso") {
    const iso = await openstackFetch(`${imageEndpoint.replace(/\/v2$/i, "")}/v2/images/${imageId}`, { method: "GET", token: context.token });
    const { api } = await isoProjectApi(projectName);
    return createIsoServer(api, { name: serverName, image: iso, flavorId, flavorRef: flavor, networkId: network, securityGroupNames, ownerUserId, bootVolumeSizeGb: bootVolumeSizeGb === "" || bootVolumeSizeGb === undefined ? 32 : Number(bootVolumeSizeGb) });
  }
  const server={name:serverName,flavorRef:flavorId,networks:[{uuid:network}],metadata:{terminal_lab_managed:"true",terminal_lab_user_id:String(ownerUserId||"")}};
  const username=String(loginUsername||"").trim(),password=String(loginPassword||"");
  if(username&&password){const cloudConfig=["#cloud-config","users:","  - default","  - name: "+JSON.stringify(username),"    groups: [sudo]","    shell: /bin/bash","    sudo: ALL=(ALL) NOPASSWD:ALL","    lock_passwd: false","ssh_pwauth: true","chpasswd:","  expire: false","  users:","    - name: "+JSON.stringify(username),"      password: "+JSON.stringify(password),"      type: text",""].join("\n");server.user_data=Buffer.from(cloudConfig,"utf8").toString("base64");}

  const groups=(Array.isArray(securityGroupNames)?securityGroupNames:[]).map((item)=>String(item||"").trim()).filter(Boolean); if(groups.length) server.security_groups=groups.map((groupName)=>({name:groupName}));
  if(Number(bootVolumeSizeGb)>0){server.block_device_mapping_v2=[{boot_index:0,uuid:imageId,source_type:"image",destination_type:"volume",volume_size:Math.max(1,Number(bootVolumeSizeGb)),delete_on_termination:true}];} else server.imageRef=imageId;
  const data=await openstackFetch(`${context.computeEndpoint}/servers`,{method:"POST",token:context.token,body:{server}}); return data?.server||data;
}

async function createOpenstackVolume({ projectName = "", name = "", sizeGb = 1, description = "" } = {}) {
  const normalizedName = String(name || "").trim();
  const normalizedSize = Math.max(1, Number(sizeGb || 1) || 1);
  if (!normalizedName) throw new Error("볼륨 이름이 필요합니다.");
  if (HEAT_DRIVER === "mock") return { id: `mock-volume-${Date.now()}`, name: normalizedName, size: normalizedSize, status: "available" };
  const context = await getProjectResourceContext(projectName);
  if (!context.volumeEndpoint) throw new Error("Cinder endpoint를 확인할 수 없습니다.");
  const data = await openstackFetch(`${context.volumeEndpoint}/volumes`, {
    method: "POST", token: context.token,
    body: { volume: { name: normalizedName, size: normalizedSize, description: String(description || "").trim() } },
  });
  return data?.volume || data || {};
}

async function deleteOpenstackVolume({ projectName = "", volumeId = "" } = {}) {
  const id = String(volumeId || "").trim();
  if (!id) throw new Error("volumeId가 필요합니다.");
  if (HEAT_DRIVER === "mock") return { ok: true, volumeId: id };
  const context = await getProjectResourceContext(projectName);
  if (!context.volumeEndpoint) throw new Error("Cinder endpoint를 확인할 수 없습니다.");
  await openstackFetch(`${context.volumeEndpoint}/volumes/${encodeURIComponent(id)}`, { method: "DELETE", token: context.token, expectJson: false });
  return { ok: true, volumeId: id };
}

async function attachOpenstackVolume({ projectName = "", serverId = "", volumeId = "" } = {}) {
  const server = String(serverId || "").trim();
  const volume = String(volumeId || "").trim();
  if (!server || !volume) throw new Error("serverId와 volumeId가 필요합니다.");
  if (HEAT_DRIVER === "mock") return { id: volume, serverId: server, volumeId: volume };
  const context = await getProjectResourceContext(projectName);
  if (!context.computeEndpoint) throw new Error("Nova endpoint를 확인할 수 없습니다.");
  const data = await openstackFetch(`${context.computeEndpoint}/servers/${encodeURIComponent(server)}/os-volume_attachments`, {
    method: "POST", token: context.token, body: { volumeAttachment: { volumeId: volume } },
  });
  return data?.volumeAttachment || data || {};
}

async function detachOpenstackVolume({ projectName = "", serverId = "", attachmentId = "" } = {}) {
  const server = String(serverId || "").trim();
  const attachment = String(attachmentId || "").trim();
  if (!server || !attachment) throw new Error("serverId와 attachmentId가 필요합니다.");
  if (HEAT_DRIVER === "mock") return { ok: true, serverId: server, attachmentId: attachment };
  const context = await getProjectResourceContext(projectName);
  if (!context.computeEndpoint) throw new Error("Nova endpoint를 확인할 수 없습니다.");
  await openstackFetch(`${context.computeEndpoint}/servers/${encodeURIComponent(server)}/os-volume_attachments/${encodeURIComponent(attachment)}`, { method: "DELETE", token: context.token, expectJson: false });
  return { ok: true, serverId: server, attachmentId: attachment };
}

async function getOpenstackProjectSnapshot({ projectName = "" } = {}) {
  const normalizedProjectName = String(projectName || "").trim();
  if (!normalizedProjectName) throw new Error("projectName is required.");
  if (HEAT_DRIVER === "mock") {
    return {
      ok: true,
      driver: "mock",
      projectName: normalizedProjectName,
      projectId: `mock-${normalizedProjectName}`,
      refreshedAt: new Date().toISOString(),
      loadBalancerAvailable: true,
      isoImages: [], instances: [], volumes: [], networks: [], subnets: [], routers: [], floatingIps: [], securityGroups: [], ports: [], loadBalancers: [], loadBalancerListeners: [], loadBalancerPools: [], loadBalancerMembers: [], loadBalancerHealthMonitors: [], alarms: [], reservations: [], shares: [], shareTypes: [], alarmAvailable: false, reservationAvailable: false, shareAvailable: false,
      quota: await probeOpenstackQuota({ projectName: normalizedProjectName }),
      warnings: [],
    };
  }
  if (HEAT_DRIVER !== "openstack") throw new Error(`Unsupported HEAT_DRIVER: ${HEAT_DRIVER}`);

  const cloud = await loadCloudConfig({ projectName: normalizedProjectName });
  const auth = await authenticate(cloud, { projectName: normalizedProjectName });
  const computeEndpoint = resolveComputeEndpoint(cloud, auth);
  const volumeEndpoint = applyProjectIdToEndpoint(resolveVolumeEndpoint(cloud, auth), auth.projectId);
  const networkEndpoint = resolveNetworkEndpoint(cloud, auth);
  const loadBalancerEndpoint = normalizeEndpoint(findCatalogEndpoint(auth.catalog, { type: "load-balancer", region: cloud.region_name, interfaceName: cloud.interface }));
  const alarmEndpoint = normalizeEndpoint(findCatalogEndpoint(auth.catalog, { type: "alarming", region: cloud.region_name, interfaceName: cloud.interface }));
  const reservationEndpoint = normalizeEndpoint(findCatalogEndpoint(auth.catalog, { type: "reservation", region: cloud.region_name, interfaceName: cloud.interface }));
  const shareEndpoint = applyProjectIdToEndpoint(normalizeEndpoint(findCatalogEndpoint(auth.catalog, { type: "sharev2", region: cloud.region_name, interfaceName: cloud.interface })), auth.projectId);
  const warnings = [];
  const safeLoad = async (label, loader, fallback = {}) => {
    try { return await loader(); }
    catch (error) {
      warnings.push(`${label}: ${error.message}`);
      return fallback;
    }
  };

  const imageEndpoint = normalizeEndpoint(findCatalogEndpoint(auth.catalog, { type: "image", region: cloud.region_name, interfaceName: cloud.interface })).replace(/\/v2$/i, "");
  const [serverData, volumeData, networkData, subnetData, routerData, floatingIpData, securityGroupData, portData, loadBalancerData, listenerData, poolData, healthMonitorData, alarmData, leaseData, shareData, shareTypeData, quota, isoImageData] = await Promise.all([
    computeEndpoint ? safeLoad("Nova", () => openstackFetch(`${computeEndpoint}/servers/detail`, { method: "GET", token: auth.token })) : {},
    volumeEndpoint ? safeLoad("Cinder", () => openstackFetch(`${volumeEndpoint}/volumes/detail`, { method: "GET", token: auth.token })) : {},
    networkEndpoint ? safeLoad("Neutron network", () => openstackFetch(buildNetworkApiUrl(networkEndpoint, "networks"), { method: "GET", token: auth.token })) : {},
    networkEndpoint ? safeLoad("Neutron subnet", () => openstackFetch(buildNetworkApiUrl(networkEndpoint, `subnets?project_id=${encodeURIComponent(auth.projectId || "")}`), { method: "GET", token: auth.token })) : {},
    networkEndpoint ? safeLoad("Neutron router", () => openstackFetch(buildNetworkApiUrl(networkEndpoint, `routers?project_id=${encodeURIComponent(auth.projectId || "")}`), { method: "GET", token: auth.token })) : {},
    networkEndpoint ? safeLoad("Neutron floating IP", () => openstackFetch(buildNetworkApiUrl(networkEndpoint, `floatingips?project_id=${encodeURIComponent(auth.projectId || "")}`), { method: "GET", token: auth.token })) : {},
    networkEndpoint ? safeLoad("Neutron security group", () => openstackFetch(buildNetworkApiUrl(networkEndpoint, `security-groups?project_id=${encodeURIComponent(auth.projectId || "")}`), { method: "GET", token: auth.token })) : {},
    networkEndpoint ? safeLoad("Neutron port", () => openstackFetch(buildNetworkApiUrl(networkEndpoint, `ports?project_id=${encodeURIComponent(auth.projectId || "")}`), { method: "GET", token: auth.token })) : {},
    loadBalancerEndpoint ? safeLoad("Octavia load balancer", () => openstackFetch(`${loadBalancerEndpoint}/v2/lbaas/loadbalancers`, { method: "GET", token: auth.token })) : {},
    loadBalancerEndpoint ? safeLoad("Octavia listener", () => openstackFetch(`${loadBalancerEndpoint}/v2/lbaas/listeners`, { method: "GET", token: auth.token })) : {},
    loadBalancerEndpoint ? safeLoad("Octavia pool", () => openstackFetch(`${loadBalancerEndpoint}/v2/lbaas/pools`, { method: "GET", token: auth.token })) : {},
    loadBalancerEndpoint ? safeLoad("Octavia health monitor", () => openstackFetch(`${loadBalancerEndpoint}/v2/lbaas/healthmonitors`, { method: "GET", token: auth.token })) : {},
    alarmEndpoint ? safeLoad("Aodh alarm", () => openstackFetch(`${alarmEndpoint}/v2/alarms`, { method: "GET", token: auth.token }), []) : [],
    reservationEndpoint ? safeLoad("Blazar lease", () => openstackFetch(buildVersionAwareServiceUrl(reservationEndpoint, "v1/leases"), { method: "GET", token: auth.token }), { leases: [] }) : { leases: [] },
    shareEndpoint ? safeLoad("Manila share", () => openstackFetch(`${shareEndpoint}/shares/detail`, { method: "GET", token: auth.token }), { shares: [] }) : { shares: [] },
    shareEndpoint ? safeLoad("Manila share type", () => openstackFetch(`${shareEndpoint}/types`, { method: "GET", token: auth.token }), { share_types: [] }) : { share_types: [] },
    safeLoad("Quota", () => probeOpenstackQuota({ projectName: normalizedProjectName }), { ok: false, metrics: {} }),
    imageEndpoint ? safeLoad("Glance ISO", () => openstackFetch(`${imageEndpoint}/v2/images?disk_format=iso&status=active&limit=500`, { method: "GET", token: auth.token }), { images: [] }) : { images: [] },
  ]);

  const loadBalancerPools = normalizeMiniHorizonCollection(poolData, "pools");
  const memberGroups = loadBalancerEndpoint ? await Promise.all(loadBalancerPools.map((pool) => safeLoad(`Octavia pool ${pool.id} member`, () => openstackFetch(`${loadBalancerEndpoint}/v2/lbaas/pools/${encodeURIComponent(pool.id)}/members`, { method: "GET", token: auth.token }), { members: [] }))) : [];
  const loadBalancerMembers = memberGroups.flatMap((data, index) => normalizeMiniHorizonCollection(data, "members").map((member) => ({ ...member, pool_id: member.pool_id || loadBalancerPools[index]?.id || "" })));

  return {
    ok: true,
    driver: HEAT_DRIVER,
    projectName: normalizedProjectName,
    projectId: auth.projectId || "",
    refreshedAt: new Date().toISOString(),
    loadBalancerAvailable: Boolean(loadBalancerEndpoint),
    isoImages: normalizeMiniHorizonCollection(isoImageData, "images").map((image) => ({ id: image.id, name: image.name, size: image.size, hw_firmware_type: image.hw_firmware_type, owner: image.owner, terminal_lab_user_id: image.terminal_lab_user_id, terminal_lab_managed: image.terminal_lab_managed })),
    instances: normalizeMiniHorizonCollection(serverData, "servers"),
    volumes: normalizeMiniHorizonCollection(volumeData, "volumes"),
    networks: normalizeMiniHorizonCollection(networkData, "networks").filter((network) => isVisibleSelfServiceNetwork(network, auth.projectId)),
    subnets: normalizeMiniHorizonCollection(subnetData, "subnets"),
    routers: normalizeMiniHorizonCollection(routerData, "routers"),
    floatingIps: normalizeMiniHorizonCollection(floatingIpData, "floatingips"),
    securityGroups: normalizeMiniHorizonCollection(securityGroupData, "security_groups"),
    ports: normalizeMiniHorizonCollection(portData, "ports"),
    loadBalancers: normalizeMiniHorizonCollection(loadBalancerData, "loadbalancers"),
    loadBalancerListeners: normalizeMiniHorizonCollection(listenerData, "listeners"),
    loadBalancerPools,
    loadBalancerMembers,
    loadBalancerHealthMonitors: normalizeMiniHorizonCollection(healthMonitorData, "healthmonitors"),
    alarmAvailable: Boolean(alarmEndpoint),
    alarms: Array.isArray(alarmData) ? alarmData : normalizeMiniHorizonCollection(alarmData, "alarms"),
    reservationAvailable: Boolean(reservationEndpoint),
    reservations: normalizeMiniHorizonCollection(leaseData, "leases"),
    shareAvailable: Boolean(shareEndpoint),
    shares: normalizeMiniHorizonCollection(shareData, "shares"),
    shareTypes: normalizeMiniHorizonCollection(shareTypeData, "share_types"),
    quota,
    warnings: [...warnings, ...(Array.isArray(quota?.warnings) ? quota.warnings : [])],
  };
}

async function probeOpenstackQuota({ projectName = "" } = {}) {
  if (HEAT_DRIVER === "mock") {
    return {
      ok: true,
      driver: "mock",
      projectName: OPENSTACK_CLOUD_NAME,
      metrics: buildQuotaMetrics({
        instances: { used: 1, limit: 10 },
        cores: { used: 2, limit: 20 },
        ram: { used: 4096, limit: 32768, unit: "MB" },
        volumes: { used: 2, limit: 20 },
        volumeStorage: { used: 80, limit: 1000, unit: "GB" },
        networks: { used: 3, limit: 20 },
        subnets: { used: 3, limit: 20 },
        routers: { used: 1, limit: 10 },
        floatingIps: { used: 2, limit: 20 },
        ports: { used: 8, limit: 200 },
      }),
    };
  }

  if (HEAT_DRIVER !== "openstack") {
    throw new Error(`Unsupported HEAT_DRIVER: ${HEAT_DRIVER}`);
  }

  const cloud = await loadCloudConfig({ projectName });
  const auth = await authenticate(cloud, { projectName });
  const computeEndpoint = resolveComputeEndpoint(cloud, auth);
  const volumeEndpoint = resolveVolumeEndpoint(cloud, auth);
  const networkEndpoint = resolveNetworkEndpoint(cloud, auth);

  if (!computeEndpoint) {
    throw new Error("Compute endpoint could not be resolved from clouds.yaml.");
  }

  const data = await openstackFetch(`${computeEndpoint}/limits`, {
    method: "GET",
    token: auth.token,
  });

  const absolute = data?.limits?.absolute || {};
  const extraMetrics = {};
  const errors = [];
  if (volumeEndpoint) {
    try {
      Object.assign(extraMetrics, await probeVolumeQuotaMetrics({ volumeEndpoint, token: auth.token }));
    } catch (error) {
      errors.push(`Cinder: ${error.message}`);
    }
  }
  if (networkEndpoint && auth.projectId) {
    try {
      Object.assign(extraMetrics, await probeNetworkQuotaMetrics({ networkEndpoint, token: auth.token, projectId: auth.projectId }));
    } catch (error) {
      errors.push(`Neutron: ${error.message}`);
    }
  }
  return {
    ok: true,
    driver: HEAT_DRIVER,
    endpoint: computeEndpoint,
    volumeEndpoint,
    networkEndpoint,
    projectName: projectName || cloud?.auth?.project_name || OPENSTACK_CLOUD_NAME,
    projectId: auth.projectId || "",
    warnings: errors,
    metrics: buildQuotaMetrics({
      instances: {
        used: absolute.totalInstancesUsed,
        limit: absolute.maxTotalInstances,
      },
      cores: {
        used: absolute.totalCoresUsed,
        limit: absolute.maxTotalCores,
      },
      ram: {
        used: absolute.totalRAMUsed,
        limit: absolute.maxTotalRAMSize,
        unit: "MB",
      },
      ...extraMetrics,
    }),
  };
}

async function resolveOpenstackImageId({ imageEndpoint, token, imageRef = "" } = {}) {
  const normalizedRef = String(imageRef || "").trim();
  if (!normalizedRef) return "";
  if (isOpenstackUuidValue(normalizedRef)) return normalizedRef;
  if (!imageEndpoint) {
    throw new Error(`OpenStack Image endpoint를 찾을 수 없어 이미지 이름을 확인할 수 없습니다: ${normalizedRef}`);
  }

  const params = new URLSearchParams({
    name: normalizedRef,
    status: "active",
    limit: "50",
  });
  const imageApiBase = imageEndpoint.replace(/\/v2$/i, "");
  const data = await openstackFetch(`${imageApiBase}/v2/images?${params.toString()}`, {
    method: "GET",
    token,
  });
  const matches = (Array.isArray(data?.images) ? data.images : [])
    .filter((image) => String(image?.name || "").trim() === normalizedRef)
    .filter((image) => !image?.status || String(image.status).toLowerCase() === "active");
  if (matches.length > 1) {
    throw new Error(`동일한 이름의 활성 OpenStack 이미지가 여러 개입니다: ${normalizedRef}`);
  }
  return String(matches[0]?.id || "").trim();
}

async function startOpenstackServer({ serverId = "", projectName = "" } = {}) {
  return setOpenstackServerPowerState({
    serverId,
    projectName,
    action: "os-start",
    targetStatuses: ["ACTIVE"],
  });
}

async function stopOpenstackServer({ serverId = "", projectName = "" } = {}) {
  return setOpenstackServerPowerState({
    serverId,
    projectName,
    action: "os-stop",
    targetStatuses: ["SHUTOFF", "STOPPED"],
  });
}

async function rebootOpenstackServer({ serverId = "", projectName = "", hard = false } = {}) {
  if (HEAT_DRIVER === "mock") {
    return {
      ok: true,
      serverId: String(serverId || "").trim(),
      status: "ACTIVE",
      rebootType: hard ? "HARD" : "SOFT",
    };
  }
  if (HEAT_DRIVER !== "openstack") {
    throw new Error(`Unsupported HEAT_DRIVER: ${HEAT_DRIVER}`);
  }

  const normalizedServerId = String(serverId || "").trim();
  if (!normalizedServerId) throw new Error("serverId is required to reboot an OpenStack server.");

  const cloud = await loadCloudConfig({ projectName });
  const auth = await authenticate(cloud, { projectName });
  const computeEndpoint = resolveComputeEndpoint(cloud, auth);
  if (!computeEndpoint) {
    throw new Error("Compute endpoint could not be resolved from clouds.yaml.");
  }

  const rebootType = hard ? "HARD" : "SOFT";
  await openstackFetch(`${computeEndpoint}/servers/${encodeURIComponent(normalizedServerId)}/action`, {
    method: "POST",
    token: auth.token,
    expectJson: false,
    body: {
      reboot: { type: rebootType },
    },
  });

  const updated = await waitForServerStatus({
    computeEndpoint,
    token: auth.token,
    serverId: normalizedServerId,
    targetStatuses: ["ACTIVE"],
  });

  return {
    ok: true,
    serverId: normalizedServerId,
    status: String(updated?.status || "").toUpperCase() || "ACTIVE",
    rebootType,
    raw: updated,
  };
}

async function deleteOpenstackServer({ serverId = "", projectName = "" } = {}) {
  if (HEAT_DRIVER === "mock") {
    return {
      ok: true,
      serverId: String(serverId || "").trim(),
      deletedPortIds: [],
    };
  }
  if (HEAT_DRIVER !== "openstack") {
    throw new Error(`Unsupported HEAT_DRIVER: ${HEAT_DRIVER}`);
  }

  const normalizedServerId = String(serverId || "").trim();
  if (!normalizedServerId) throw new Error("serverId is required to delete an OpenStack server.");

  const cloud = await loadCloudConfig({ projectName });
  const auth = await authenticate(cloud, { projectName });
  const computeEndpoint = resolveComputeEndpoint(cloud, auth);
  const networkEndpoint = resolveNetworkEndpoint(cloud, auth);
  if (!computeEndpoint) {
    throw new Error("Compute endpoint could not be resolved from clouds.yaml.");
  }

  const attachedPortIds = networkEndpoint
    ? await collectOpenstackServerPortIds({
        computeEndpoint,
        networkEndpoint,
        token: auth.token,
        serverId: normalizedServerId,
      })
    : [];

  let alreadyDeleted = false;
  try {
    await openstackFetch(`${computeEndpoint}/servers/${encodeURIComponent(normalizedServerId)}`, {
      method: "DELETE",
      token: auth.token,
      expectJson: false,
    });
  } catch (error) {
    if (isOpenstackNotFoundError(error)) {
      alreadyDeleted = true;
    } else {
      throw error;
    }
  }

  if (!alreadyDeleted) {
    await waitForServerDeleted({
      computeEndpoint,
      token: auth.token,
      serverId: normalizedServerId,
    });
  }

  const deletedPortIds = networkEndpoint && attachedPortIds.length
    ? await deleteOpenstackPorts({
        networkEndpoint,
        token: auth.token,
        portIds: attachedPortIds,
      })
    : [];

  return { ok: true, serverId: normalizedServerId, alreadyDeleted, deletedPortIds };
}

async function setOpenstackServerPowerState({
  serverId = "",
  projectName = "",
  action = "",
  targetStatuses = [],
} = {}) {
  if (HEAT_DRIVER === "mock") {
    const normalizedAction = String(action || "").trim();
    return {
      ok: true,
      serverId: String(serverId || "").trim(),
      status: normalizedAction === "os-stop" ? "SHUTOFF" : "ACTIVE",
    };
  }
  if (HEAT_DRIVER !== "openstack") {
    throw new Error(`Unsupported HEAT_DRIVER: ${HEAT_DRIVER}`);
  }

  const normalizedServerId = String(serverId || "").trim();
  const normalizedAction = String(action || "").trim();
  if (!normalizedServerId) throw new Error("serverId is required to change an OpenStack server power state.");
  if (!normalizedAction) throw new Error("action is required to change an OpenStack server power state.");

  const cloud = await loadCloudConfig({ projectName });
  const auth = await authenticate(cloud, { projectName });
  const computeEndpoint = resolveComputeEndpoint(cloud, auth);
  if (!computeEndpoint) {
    throw new Error("Compute endpoint could not be resolved from clouds.yaml.");
  }

  const current = await openstackFetch(`${computeEndpoint}/servers/${encodeURIComponent(normalizedServerId)}`, {
    method: "GET",
    token: auth.token,
  });
  const currentServer = current?.server || null;
  const currentStatus = String(currentServer?.status || "").trim().toUpperCase();
  const normalizedTargets = Array.isArray(targetStatuses)
    ? targetStatuses.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)
    : [];
  if (normalizedTargets.includes(currentStatus)) {
    return {
      ok: true,
      serverId: normalizedServerId,
      status: currentStatus,
      raw: currentServer,
    };
  }

  await openstackFetch(`${computeEndpoint}/servers/${encodeURIComponent(normalizedServerId)}/action`, {
    method: "POST",
    token: auth.token,
    expectJson: false,
    body: {
      [normalizedAction]: null,
    },
  });

  const updated = await waitForServerStatus({
    computeEndpoint,
    token: auth.token,
    serverId: normalizedServerId,
    targetStatuses: normalizedTargets,
  });

  return {
    ok: true,
    serverId: normalizedServerId,
    status: String(updated?.status || "").toUpperCase(),
    raw: updated,
  };
}

async function createOpenstackRemoteConsole({ serverId = "", protocol = "serial", type = "serial", projectName = "" } = {}) {
  if (HEAT_DRIVER === "mock") {
    return {
      ok: true,
      protocol: String(protocol || "serial").trim() || "serial",
      type: String(type || "serial").trim() || "serial",
      url: `https://console.mock.local/${encodeURIComponent(String(serverId || "mock-server"))}`,
    };
  }
  if (HEAT_DRIVER !== "openstack") {
    throw new Error(`Unsupported HEAT_DRIVER: ${HEAT_DRIVER}`);
  }

  const normalizedServerId = String(serverId || "").trim();
  const normalizedProtocol = String(protocol || "serial").trim() || "serial";
  const normalizedType = String(type || "serial").trim() || "serial";
  if (!normalizedServerId) throw new Error("serverId is required to open an OpenStack remote console.");

  const cloud = await loadCloudConfig({ projectName });
  const auth = await authenticate(cloud, { projectName });
  const computeEndpoint = resolveComputeEndpoint(cloud, auth);
  if (!computeEndpoint) {
    throw new Error("Compute endpoint could not be resolved from clouds.yaml.");
  }

  try {
    const data = await openstackFetch(`${computeEndpoint}/servers/${encodeURIComponent(normalizedServerId)}/remote-consoles`, {
      method: "POST",
      token: auth.token,
      headers: {
        "OpenStack-API-Version": "compute 2.6",
      },
      body: {
        remote_console: {
          protocol: normalizedProtocol,
          type: normalizedType,
        },
      },
    });
    const remoteConsole = data?.remote_console || {};
    const url = String(remoteConsole.url || "").trim();
    if (!url) throw new Error("Nova remote console URL was empty.");
    return {
      ok: true,
      protocol: String(remoteConsole.protocol || normalizedProtocol).trim() || normalizedProtocol,
      type: String(remoteConsole.type || normalizedType).trim() || normalizedType,
      url,
      raw: data,
    };
  } catch (error) {
    let legacyAction = "";
    let legacyPayload = null;
    if (normalizedProtocol === "serial" && normalizedType === "serial") {
      legacyAction = "os-getSerialConsole";
      legacyPayload = { type: "serial" };
    } else if (normalizedProtocol === "vnc" && normalizedType === "novnc") {
      legacyAction = "os-getVNCConsole";
      legacyPayload = { type: "novnc" };
    } else {
      throw error;
    }
    const legacy = await openstackFetch(`${computeEndpoint}/servers/${encodeURIComponent(normalizedServerId)}/action`, {
      method: "POST",
      token: auth.token,
      body: {
        [legacyAction]: legacyPayload,
      },
    });
    const consoleInfo = legacy?.console || {};
    const url = String(consoleInfo.url || "").trim();
    if (!url) throw error;
    return {
      ok: true,
      protocol: normalizedProtocol,
      type: String(consoleInfo.type || normalizedType).trim() || normalizedType,
      url,
      raw: legacy,
    };
  }
}

function resolveCloudConfigTarget({ projectName = "" } = {}) {
  const normalizedProjectName = String(projectName || "").trim();
  const target = {
    cloudsYamlPath: openstackCloudTargets.serviceCloudsYaml || OPENSTACK_CLOUDS_YAML,
    cloudName: openstackCloudTargets.serviceCloudName || OPENSTACK_CLOUD_NAME,
    authUrl: openstackCloudTargets.serviceAuthUrl,
    heatApiUrl: openstackCloudTargets.serviceHeatApiUrl,
    computeApiUrl: openstackCloudTargets.serviceComputeApiUrl,
    networkApiUrl: openstackCloudTargets.serviceNetworkApiUrl,
    metricApiUrl: openstackCloudTargets.serviceMetricApiUrl,
  };

  if (normalizedProjectName && normalizedProjectName === openstackCloudTargets.serviceProjectName) {
    return {
      cloudsYamlPath: openstackCloudTargets.serviceCloudsYaml || target.cloudsYamlPath,
      cloudName: openstackCloudTargets.serviceCloudName || target.cloudName,
      authUrl: openstackCloudTargets.serviceAuthUrl,
      heatApiUrl: openstackCloudTargets.serviceHeatApiUrl,
      computeApiUrl: openstackCloudTargets.serviceComputeApiUrl,
      networkApiUrl: openstackCloudTargets.serviceNetworkApiUrl,
      metricApiUrl: openstackCloudTargets.serviceMetricApiUrl,
    };
  }

  if (normalizedProjectName && normalizedProjectName === openstackCloudTargets.pocProjectName) {
    return {
      cloudsYamlPath: openstackCloudTargets.pocCloudsYaml || target.cloudsYamlPath,
      cloudName: openstackCloudTargets.pocCloudName || target.cloudName,
      authUrl: openstackCloudTargets.pocAuthUrl,
      heatApiUrl: openstackCloudTargets.pocHeatApiUrl,
      metricApiUrl: openstackCloudTargets.pocMetricApiUrl,
    };
  }

  return target;
}

async function loadCloudConfig({ projectName = "", preferCloudAuthUrl = false } = {}) {
  const target = resolveCloudConfigTarget({ projectName });
  const fallbackPaths = [
    target.cloudsYamlPath,
    openstackCloudTargets.serviceCloudsYaml,
    OPENSTACK_CLOUDS_YAML,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const candidatePaths = [...new Set(fallbackPaths)];
  let raw = "";
  let effectiveCloudsYamlPath = "";
  for (const candidatePath of candidatePaths) {
    try {
      raw = await fs.readFile(candidatePath, "utf8");
      effectiveCloudsYamlPath = candidatePath;
      break;
    } catch {
      // Continue to the next configured authentication file.
    }
  }
  if (!effectiveCloudsYamlPath) {
    throw new Error(`Unable to read OpenStack authentication file: ${candidatePaths.join(", ") || target.cloudsYamlPath}`);
  }

  const parsed = YAML.parse(raw) || {};
  const clouds = parsed?.clouds && typeof parsed.clouds === "object" ? parsed.clouds : {};
  const cloudNames = Object.keys(clouds).filter(Boolean);
  const resolvedCloudName = clouds[target.cloudName]
    ? target.cloudName
    : cloudNames.length === 1
      ? cloudNames[0]
      : "";
  const cloud = resolvedCloudName ? clouds[resolvedCloudName] : null;
  if (!cloud) {
    const availableClouds = cloudNames.length ? ` Available clouds: ${cloudNames.join(", ")}.` : "";
    throw new Error(`Cloud "${target.cloudName}" was not found in clouds.yaml.${availableClouds}`);
  }

  const auth = cloud.auth || {};
  const missingAuthFields = ["auth_url", "username", "password"].filter((field) => !String(auth[field] || "").trim());
  if (missingAuthFields.length) {
    throw new Error(`clouds.yaml의 "${resolvedCloudName}" cloud에 ${missingAuthFields.join(", ")} 항목이 없습니다.`);
  }
  registerOpenstackCloudCaPaths({ cloud, cloudsYamlPath: effectiveCloudsYamlPath, cloudName: resolvedCloudName });

  return {
    ...cloud,
    auth: {
      ...cloud.auth,
      auth_url: normalizeEndpoint(preferCloudAuthUrl ? cloud.auth.auth_url : (target.authUrl || cloud.auth.auth_url)),
    },
    cloudName: resolvedCloudName,
    cloudsYamlPath: effectiveCloudsYamlPath,
    cloudsYamlFallbackUsed: effectiveCloudsYamlPath !== target.cloudsYamlPath,
    heatApiUrl: target.heatApiUrl || "",
    computeApiUrl: target.computeApiUrl || "",
    networkApiUrl: target.networkApiUrl || "",
    metricApiUrl: target.metricApiUrl || "",
    interface: resolveOpenstackInterface(cloud.interface),
    region_name: OPENSTACK_REGION || cloud.region_name || "",
  };
}

function resolveAdminAuthScopeMode(cloud = {}) {
  const auth = cloud.auth || {};
  const systemScope = String(auth.system_scope || cloud.system_scope || "").trim().toLowerCase();
  if (systemScope === "all") return "system";
  if (String(auth.domain_id || cloud.domain_id || auth.domain_name || cloud.domain_name || "").trim()) return "domain";
  return "project";
}

function buildAuthScope(cloud, { projectName = "", scopeMode = "project" } = {}) {
  const auth = cloud.auth || {};
  if (scopeMode === "system") {
    return { system: { all: true } };
  }
  if (scopeMode === "domain") {
    const domainId = String(auth.domain_id || cloud.domain_id || "").trim();
    if (domainId) return { domain: { id: domainId } };
    return { domain: { name: auth.domain_name || cloud.domain_name || auth.project_domain_name || auth.user_domain_name || "Default" } };
  }

  const resolvedProjectName = String(projectName || "").trim();
  const project = resolvedProjectName
    ? {
        name: resolvedProjectName,
        domain: { name: auth.project_domain_name || auth.user_domain_name || "Default" },
      }
    : auth.project_id
    ? { id: auth.project_id }
    : {
        name: auth.project_name,
        domain: { name: auth.project_domain_name || auth.user_domain_name || "Default" },
      };
  return { project };
}

async function authenticate(cloud, { projectName = "", scopeMode = "project" } = {}) {
  const authUrl = ensureV3AuthUrl(cloud.auth.auth_url);
  const resolvedScopeMode = ["system", "domain"].includes(scopeMode) ? scopeMode : "project";
  const scope = buildAuthScope(cloud, { projectName, scopeMode: resolvedScopeMode });

  const tokenUrl = `${authUrl}/auth/tokens`;
  const response = await fetchOpenstackResponse(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      auth: {
        identity: {
          methods: ["password"],
          password: {
            user: {
              name: cloud.auth.username,
              domain: { name: cloud.auth.user_domain_name || "Default" },
              password: cloud.auth.password,
            },
          },
        },
        scope,
      },
    }),
  }, { service: "Keystone authentication" });

  if (!response.ok) {
    const body = await safeText(response);
    throw new Error(`Keystone authentication failed (${response.status}): ${body}`);
  }

  const token = response.headers.get("x-subject-token");
  const payload = await response.json();
  if (!token) {
    throw new Error("Keystone response did not include X-Subject-Token.");
  }

  return {
    token,
    catalog: payload?.token?.catalog || [],
    userId: String(payload?.token?.user?.id || "").trim(),
    userName: String(payload?.token?.user?.name || cloud.auth.username || "").trim(),
    scopeMode: resolvedScopeMode,
    projectId: String(payload?.token?.project?.id || cloud.auth.project_id || "").trim(),
    projectName: String(payload?.token?.project?.name || projectName || cloud.auth.project_name || "").trim(),
    projectDomainId: String(payload?.token?.project?.domain?.id || "").trim(),
    projectDomainName: String(payload?.token?.project?.domain?.name || cloud.auth.project_domain_name || cloud.auth.user_domain_name || "Default").trim(),
    domainId: String(payload?.token?.domain?.id || cloud.auth.domain_id || cloud.domain_id || "").trim(),
    domainName: String(payload?.token?.domain?.name || cloud.auth.domain_name || cloud.domain_name || cloud.auth.project_domain_name || cloud.auth.user_domain_name || "Default").trim(),
  };
}

async function ensureSelfServiceOpenstackProject({
  projectName = "",
  serviceProjectName = "",
  ownerLabel = "",
  roleNames = [],
  quota = {},
  ensureSecurityGroup = true,
  securityGroupName = "",
  ensureNetwork = false,
  networkName = "",
  subnetName = "",
  subnetCidr = "",
  routerName = "",
  externalNetworkName = "",
  manualPortEnabled = false,
  manualPortName = "",
  trunkEnabled = false,
  networkRequests = [],
} = {}) {
  const normalizedProjectName = String(projectName || "").trim();
  const steps = [];
  const markStep = (key, label, status, detail = "") => {
    const existing = steps.find((item) => item.key === key);
    const next = { key, label, status, detail };
    if (existing) Object.assign(existing, next);
    else steps.push(next);
  };
  const failWithSteps = (error) => {
    error.steps = steps;
    throw error;
  };
  if (!normalizedProjectName) {
    throw new Error("OpenStack 프로젝트 이름이 필요합니다.");
  }

  if (HEAT_DRIVER === "mock") {
    return {
      ok: true,
      driver: "mock",
      project: { id: `mock-project-${normalizedProjectName}`, name: normalizedProjectName, created: true },
      roles: [],
      quotas: { skipped: true },
      resources: {},
      steps: [{ key: "mock", label: "Mock 자동 구성", status: "success", detail: "실제 OpenStack 호출 없음" }],
      warnings: [],
    };
  }
  if (HEAT_DRIVER !== "openstack") {
    throw new Error(`Unsupported HEAT_DRIVER: ${HEAT_DRIVER}`);
  }

  let cloud;
  let adminAuth;
  try {
    cloud = await loadCloudConfig({
      projectName: serviceProjectName || openstackCloudTargets.serviceProjectName,
      preferCloudAuthUrl: true,
    });
    const adminScopeMode = resolveAdminAuthScopeMode(cloud);
    markStep("cloud", "clouds.yaml 로드", "success", cloud.cloudName || "");
    adminAuth = await authenticate(cloud, {
      projectName: serviceProjectName || openstackCloudTargets.serviceProjectName,
      scopeMode: adminScopeMode,
    });
    markStep("auth", "서비스 계정 인증", "success", `${adminAuth.scopeMode}:${adminAuth.projectName || adminAuth.domainName || "all"}`);
  } catch (error) {
    markStep("auth", "서비스 계정 인증", "failed", error.message);
    failWithSteps(error);
  }
  const keystoneEndpoint = ensureV3AuthUrl(cloud.auth.auth_url);
  const warnings = [];
  if (adminAuth.scopeMode === "project") {
    warnings.push("현재 clouds.yaml 인증은 프로젝트 스코프입니다. Keystone 정책에 따라 프로젝트 자동 생성 권한이 부족할 수 있습니다. system_scope: all 또는 domain_name/domain_id 설정을 권장합니다.");
  }
  const domainId = adminAuth.domainId || adminAuth.projectDomainId || await resolveKeystoneDomainId({
    keystoneEndpoint,
    token: adminAuth.token,
    domainName: adminAuth.domainName || adminAuth.projectDomainName || cloud.auth.project_domain_name || cloud.auth.user_domain_name || "Default",
  });
  let project;
  try {
    project = await ensureKeystoneProject({
      keystoneEndpoint,
      token: adminAuth.token,
      projectName: normalizedProjectName,
      domainId,
      description: `Terminal Lab dedicated project${ownerLabel ? ` for ${ownerLabel}` : ""}`,
    });
    markStep("project", "Keystone 프로젝트 준비", "success", project.created ? "새 프로젝트 생성" : "기존 프로젝트 확인");
  } catch (error) {
    markStep("project", "Keystone 프로젝트 준비", "failed", error.message);
    failWithSteps(error);
  }

  const normalizedRoleNames = normalizeRoleNames(roleNames);
  const assignedRoles = [];
  for (const roleName of normalizedRoleNames) {
    try {
      const role = await resolveKeystoneRoleByName({ keystoneEndpoint, token: adminAuth.token, roleName });
      if (!role?.id) {
        warnings.push(`역할을 찾을 수 없습니다: ${roleName}`);
        continue;
      }
      await assignKeystoneProjectRole({
        keystoneEndpoint,
        token: adminAuth.token,
        projectId: project.id,
        userId: adminAuth.userId,
        roleId: role.id,
      });
      assignedRoles.push({ id: role.id, name: role.name || roleName });
      markStep(`role:${roleName}`, `역할 부여: ${roleName}`, "success", adminAuth.userName || adminAuth.userId);
    } catch (error) {
      warnings.push(`역할 부여 실패(${roleName}): ${error.message}`);
      markStep(`role:${roleName}`, `역할 부여: ${roleName}`, "warning", error.message);
    }
  }

  const quotas = await applySelfServiceProjectQuotas({
    cloud,
    auth: adminAuth,
    projectId: project.id,
    quota,
    warnings,
    steps,
  });

  const resources = {};
  if (ensureSecurityGroup || ensureNetwork) {
    const needsProjectScopedSetup = Boolean(
      (ensureSecurityGroup && String(securityGroupName || "").trim())
      || ensureNetwork,
    );
    let projectAuth = null;
    let networkEndpoint = "";
    try {
      projectAuth = await authenticateProjectWithRetry(cloud, { projectName: normalizedProjectName });
      networkEndpoint = resolveNetworkEndpoint(cloud, projectAuth);
      if (!networkEndpoint && needsProjectScopedSetup) {
        const error = new Error("Neutron endpoint를 확인할 수 없어 전용 네트워크/보안그룹 자동 구성을 진행할 수 없습니다.");
        markStep("project-auth", "프로젝트 스코프 인증", "failed", error.message);
        failWithSteps(error);
      }
      markStep("project-auth", "프로젝트 스코프 인증", "success", projectAuth.projectName || normalizedProjectName);
    } catch (error) {
      warnings.push(`프로젝트 스코프 인증 실패: ${error.message}`);
      markStep("project-auth", "프로젝트 스코프 인증", "failed", error.message);
      if (needsProjectScopedSetup) {
        failWithSteps(error);
      }
    }

    if (projectAuth && networkEndpoint) {
      if (ensureSecurityGroup && String(securityGroupName || "").trim()) {
        try {
          resources.securityGroup = await ensureOpenstackSecurityGroup({
            networkEndpoint,
            token: projectAuth.token,
            projectId: project.id,
            name: securityGroupName,
          });
          markStep("security-group", "기본 보안그룹 준비", "success", resources.securityGroup.name || securityGroupName);
        } catch (error) {
          warnings.push(`보안그룹 준비 실패: ${error.message}`);
          markStep("security-group", "기본 보안그룹 준비", "failed", error.message);
          failWithSteps(error);
        }
      }
      const requestedNetworks = Array.isArray(networkRequests) && networkRequests.length
        ? networkRequests.slice(0, 3).map((item) => ({
            networkName: String(item?.networkName || "").trim(),
            subnetName: String(item?.subnetName || "").trim(),
            subnetCidr: String(item?.subnetCidr || "").trim(),
            routerEnabled: item?.routerEnabled !== false,
            routerName: String(item?.routerName || "").trim(),
            manualPortEnabled: Boolean(item?.manualPortEnabled || item?.trunkEnabled),
            manualPortName: String(item?.portName || item?.manualPortName || "").trim(),
            trunkEnabled: Boolean(item?.trunkEnabled),
            vlanId: String(item?.vlanId || "").trim(),
            vlanAuto: Boolean(item?.vlanAuto),
            qosPolicyName: String(item?.qosPolicyName || "").trim(),
            firewallGroupName: String(item?.firewallGroupName || "").trim(),
          })).filter((item) => item.networkName)
        : String(networkName || "").trim()
          ? [{
              networkName,
              subnetName,
              subnetCidr,
              routerEnabled: true,
              routerName,
              manualPortEnabled,
              manualPortName,
              trunkEnabled,
              vlanId: "",
              qosPolicyName: "",
              firewallGroupName: "",
            }]
          : [];
      if (ensureNetwork && requestedNetworks.length) {
        resources.networks = [];
        const networkFailures = [];
        for (const [index, requestedNetwork] of requestedNetworks.entries()) {
          try {
            const preparedNetwork = await ensureOpenstackProjectNetwork({
              networkEndpoint,
              token: projectAuth.token,
              projectId: project.id,
              projectName: normalizedProjectName,
              networkName: requestedNetwork.networkName,
              subnetName: requestedNetwork.subnetName || `${requestedNetwork.networkName}-subnet`,
              subnetCidr: requestedNetwork.subnetCidr || deriveProjectSubnetCidr(`${normalizedProjectName}-${index}`),
              routerName: requestedNetwork.routerEnabled === false ? "" : requestedNetwork.routerName || `${requestedNetwork.networkName}-router`,
              externalNetworkName,
              manualPortEnabled: requestedNetwork.manualPortEnabled,
              manualPortName: requestedNetwork.manualPortName,
              trunkEnabled: requestedNetwork.trunkEnabled,
              vlanId: requestedNetwork.vlanId,
              vlanAuto: requestedNetwork.vlanAuto,
              qosPolicyName: requestedNetwork.qosPolicyName,
              firewallGroupName: requestedNetwork.firewallGroupName,
              securityGroupIds: resources.securityGroup?.id ? [resources.securityGroup.id] : [],
            });
            resources.networks.push(preparedNetwork);
            if (!resources.network) resources.network = preparedNetwork;
            markStep(`network:${index + 1}`, `전용 네트워크 준비 ${index + 1}`, "success", preparedNetwork.network?.name || requestedNetwork.networkName);
            if (preparedNetwork.routerWarning) {
              warnings.push(`${requestedNetwork.networkName}: ${preparedNetwork.routerWarning}`);
              markStep(`router:${index + 1}`, `라우터 게이트웨이 확인 ${index + 1}`, "warning", preparedNetwork.routerWarning);
            }
            if (preparedNetwork.port?.id) {
              markStep(`port:${index + 1}`, requestedNetwork.trunkEnabled ? `Trunk 부모 포트 준비 ${index + 1}` : `수동 포트 준비 ${index + 1}`, "success", preparedNetwork.port.name || requestedNetwork.manualPortName || "");
            }
            if (requestedNetwork.trunkEnabled) {
              if (preparedNetwork.trunk?.id) {
                markStep(`trunk:${index + 1}`, `Trunk 포트 준비 ${index + 1}`, "success", preparedNetwork.trunk.name || "");
              } else {
                const trunkDetail = preparedNetwork.trunkError || "서브포트 연결은 관리자 확인 필요";
                warnings.push(`${requestedNetwork.networkName}: Trunk 요청은 부모 포트까지만 자동 준비했습니다. ${trunkDetail}`);
                markStep(`trunk:${index + 1}`, `Trunk 포트 확인 ${index + 1}`, "warning", trunkDetail);
              }
            }
          } catch (error) {
            const failureMessage = `${requestedNetwork.networkName}: 네트워크 준비 실패: ${error.message}`;
            networkFailures.push(failureMessage);
            warnings.push(failureMessage);
            markStep(`network:${index + 1}`, `전용 네트워크 준비 ${index + 1}`, "failed", error.message);
          }
        }
        if (networkFailures.length) {
          failWithSteps(new Error(`전용 네트워크 자동 구성 실패: ${networkFailures.join(" / ")}`));
        }
      }
    }
  }

  return {
    ok: true,
    driver: HEAT_DRIVER,
    project,
    roles: assignedRoles,
    quotas,
    resources,
    steps,
    warnings,
  };
}

async function cleanupSelfServiceOpenstackProject({
  projectName = "",
  serviceProjectName = "",
  dryRun = false,
  deleteProject = true,
} = {}) {
  const normalizedProjectName = String(projectName || "").trim();
  const steps = [];
  const markStep = (key, label, status, detail = "") => steps.push({ key, label, status, detail });
  if (!normalizedProjectName) {
    throw new Error("OpenStack projectName is required for cleanup.");
  }

  if (HEAT_DRIVER === "mock") {
    return {
      ok: true,
      driver: "mock",
      dryRun: Boolean(dryRun),
      project: { id: `mock-project-${normalizedProjectName}`, name: normalizedProjectName, deleted: !dryRun && Boolean(deleteProject) },
      inventory: buildSelfServiceProjectCleanupSummary({}),
      deleted: {},
      steps: [{ key: "mock", label: "Mock OpenStack project cleanup", status: "success", detail: "No live OpenStack calls executed." }],
      warnings: [],
    };
  }
  if (HEAT_DRIVER !== "openstack") {
    throw new Error(`Unsupported HEAT_DRIVER: ${HEAT_DRIVER}`);
  }

  const cloud = await loadCloudConfig({
    projectName: serviceProjectName || openstackCloudTargets.serviceProjectName,
    preferCloudAuthUrl: true,
  });
  const adminAuth = await authenticate(cloud, {
    projectName: serviceProjectName || openstackCloudTargets.serviceProjectName,
    scopeMode: resolveAdminAuthScopeMode(cloud),
  });
  markStep("auth", "Keystone admin authentication", "success", adminAuth.scopeMode);
  const keystoneEndpoint = ensureV3AuthUrl(cloud.auth.auth_url);
  let project;
  try {
    project = await findKeystoneProjectByName({
      keystoneEndpoint,
      token: adminAuth.token,
      projectName: normalizedProjectName,
    });
  } catch (error) {
    markStep("project", "Keystone project lookup", "failed", error.message);
    error.steps = steps;
    throw error;
  }
  if (!project?.id) {
    markStep("project", "Keystone project lookup", "success", "Already deleted or not found");
    return {
      ok: true,
      driver: HEAT_DRIVER,
      dryRun: Boolean(dryRun),
      project: { id: "", name: normalizedProjectName, alreadyDeleted: true },
      inventory: buildSelfServiceProjectCleanupSummary({}),
      deleted: {},
      steps,
      warnings: [],
    };
  }

  markStep("project", "Keystone project lookup", "success", `${project.name || normalizedProjectName} / ${project.id}`);
  let projectAuth;
  try {
    projectAuth = await authenticateProjectWithRetry(cloud, { projectName: normalizedProjectName });
    markStep("project-auth", "Project-scoped authentication", "success", normalizedProjectName);
  } catch (error) {
    markStep("project-auth", "Project-scoped authentication", "failed", error.message);
    error.steps = steps;
    throw error;
  }
  // Project cleanup must follow the endpoints granted in the project-scoped
  // token catalog. Admin UI endpoint overrides may point at management-only
  // proxies that reject tenant cleanup calls.
  const cleanupCloud = {
    ...cloud,
    heatApiUrl: "",
    computeApiUrl: "",
    networkApiUrl: "",
  };
  const endpoints = {
    heat: normalizeEndpoint(findCatalogEndpoint(projectAuth.catalog, {
      type: "orchestration",
      region: cleanupCloud.region_name,
      interfaceName: cleanupCloud.interface,
    })),
    compute: resolveComputeEndpoint(cleanupCloud, projectAuth),
    network: resolveNetworkEndpoint(cleanupCloud, projectAuth),
    volume: resolveVolumeEndpoint(cleanupCloud, projectAuth),
    loadBalancer: normalizeEndpoint(findCatalogEndpoint(projectAuth.catalog, { type: "load-balancer", region: cleanupCloud.region_name, interfaceName: cleanupCloud.interface })),
    dns: normalizeEndpoint(findCatalogEndpoint(projectAuth.catalog, { type: "dns", region: cleanupCloud.region_name, interfaceName: cleanupCloud.interface })),
    keyManager: normalizeEndpoint(findCatalogEndpoint(projectAuth.catalog, { type: "key-manager", region: cleanupCloud.region_name, interfaceName: cleanupCloud.interface })).replace(/\/v1$/i, ""),
    alarm: normalizeEndpoint(findCatalogEndpoint(projectAuth.catalog, { type: "alarming", region: cleanupCloud.region_name, interfaceName: cleanupCloud.interface })),
    reservation: normalizeEndpoint(findCatalogEndpoint(projectAuth.catalog, { type: "reservation", region: cleanupCloud.region_name, interfaceName: cleanupCloud.interface })),
    share: applyProjectIdToEndpoint(normalizeEndpoint(findCatalogEndpoint(projectAuth.catalog, { type: "sharev2", region: cleanupCloud.region_name, interfaceName: cleanupCloud.interface })), project.id),
  };
  let inventory;
  try {
    inventory = await collectSelfServiceProjectCleanupInventory({
      endpoints,
      token: projectAuth.token,
      projectId: project.id,
      projectName: normalizedProjectName,
    });
  } catch (error) {
    markStep("inventory", "OpenStack project resource inventory", "failed", error.message);
    error.steps = steps;
    throw error;
  }
  markStep("inventory", "OpenStack project resource inventory", "success", formatCleanupInventorySummary(inventory));

  if (dryRun) {
    return {
      ok: true,
      driver: HEAT_DRIVER,
      dryRun: true,
      project: { id: String(project.id), name: String(project.name || normalizedProjectName), deleted: false },
      inventory: buildSelfServiceProjectCleanupSummary(inventory),
      resources: inventory,
      deleted: {},
      steps,
      warnings: [],
    };
  }

  const deleted = await deleteSelfServiceProjectResources({
    endpoints,
    token: projectAuth.token,
    projectId: project.id,
    projectName: normalizedProjectName,
    inventory,
    steps,
  });
  let remaining = {};
  let remainingSummary = {};
  for (let attempt = 0; attempt < 7; attempt += 1) {
    remaining = await collectSelfServiceProjectCleanupInventory({ endpoints, token: projectAuth.token, projectId: project.id, projectName: normalizedProjectName });
    remainingSummary = buildSelfServiceProjectCleanupSummary(remaining);
    if (!Object.values(remainingSummary).some((count) => Number(count || 0) > 0)) break;
    if (attempt < 6) await sleep(2000);
  }
  if (Object.values(remainingSummary).some((count) => Number(count || 0) > 0)) {
    markStep("verify-empty", "Verify project is empty", "failed", formatCleanupInventorySummary(remaining));
    const error = new Error(`OpenStack project cleanup stopped because resources remain: ${formatCleanupInventorySummary(remaining)}`);
    error.steps = steps;
    error.inventory = remainingSummary;
    throw error;
  }
  markStep("verify-empty", "Verify project is empty", "success", "No remaining managed resources found");

  let projectDeleted = false;
  if (deleteProject) {
    try {
      await openstackFetch(`${keystoneEndpoint}/projects/${encodeURIComponent(project.id)}`, {
        method: "DELETE",
        token: adminAuth.token,
        expectJson: false,
      });
      projectDeleted = true;
      markStep("delete-project", "Delete Keystone project", "success", String(project.name || normalizedProjectName));
    } catch (error) {
      if (isOpenstackNotFoundError(error)) {
        projectDeleted = true;
        markStep("delete-project", "Delete Keystone project", "success", "Already deleted");
      } else {
        markStep("delete-project", "Delete Keystone project", "failed", error.message);
        error.steps = steps;
        throw error;
      }
    }
  }

  return {
    ok: true,
    driver: HEAT_DRIVER,
    dryRun: false,
    project: { id: String(project.id), name: String(project.name || normalizedProjectName), deleted: projectDeleted },
    inventory: buildSelfServiceProjectCleanupSummary(inventory),
    remaining: remainingSummary,
    deleted,
    steps,
    warnings: [],
  };
}

function asOpenstackResourceArray(payload, key) {
  return Array.isArray(payload?.[key]) ? payload[key] : [];
}

function pickOpenstackResourceId(item = {}) {
  return String(item?.id || item?.uuid || "").trim();
}

function pickOpenstackResourceName(item = {}) {
  return String(item?.name || item?.stack_name || item?.display_name || item?.id || "").trim();
}

function normalizeCleanupResource(item = {}, extra = {}) {
  return {
    id: pickOpenstackResourceId(item),
    name: pickOpenstackResourceName(item),
    status: String(item?.status || item?.stack_status || "").trim(),
    projectId: String(item?.project_id || item?.tenant_id || item?.projectId || item?.["os-vol-tenant-attr:tenant_id"] || "").trim(),
    ...extra,
  };
}

const PROTECTED_SHARED_NETWORK_NAMES = new Set(["net-infra"]);

function isProjectOwnedCleanupResource(resource = {}, projectId = "") {
  const ownerId = String(resource?.projectId || "").trim();
  return Boolean(ownerId && projectId && ownerId === String(projectId).trim());
}

function isDeletableProjectNetwork(network = {}, projectId = "") {
  const name = String(network?.name || "").trim().toLowerCase();
  return isProjectOwnedCleanupResource(network, projectId)
    && !network.shared
    && !network.external
    && !PROTECTED_SHARED_NETWORK_NAMES.has(name);
}

async function listOpenstackCleanupResources({ endpoint = "", token, path: resourcePath = "", key = "", tolerateMissing = true }) {
  if (!endpoint || !resourcePath || !key) return [];
  try {
    const data = await openstackFetch(buildVersionAwareServiceUrl(endpoint, resourcePath), {
      method: "GET",
      token,
    });
    return asOpenstackResourceArray(data, key);
  } catch (error) {
    if (tolerateMissing && (isOpenstackNotFoundError(error) || Number(error?.status || error?.statusCode) === 403)) {
      return [];
    }
    throw error;
  }
}

async function collectSelfServiceProjectCleanupInventory({ endpoints = {}, token, projectId = "", projectName = "" }) {
  const loadBalancers = await listOpenstackCleanupResources({ endpoint: endpoints.loadBalancer, token, path: "/v2/lbaas/loadbalancers", key: "loadbalancers" });
  const dnsZones = await listOpenstackCleanupResources({ endpoint: endpoints.dns, token, path: "/zones?limit=1000", key: "zones" });
  const shares = await listOpenstackCleanupResources({ endpoint: endpoints.share, token, path: "/shares/detail", key: "shares" });
  const reservations = await listOpenstackCleanupResources({ endpoint: endpoints.reservation, token, path: "/v1/leases", key: "leases" });
  const secrets = await listOpenstackCleanupResources({ endpoint: endpoints.keyManager, token, path: "/v1/secrets?limit=1000", key: "secrets" });
  let alarms = [];
  if (endpoints.alarm) {
    try { const payload = await openstackFetch(`${endpoints.alarm}/v2/alarms`, { method: "GET", token }); alarms = Array.isArray(payload) ? payload : asOpenstackResourceArray(payload, "alarms"); }
    catch (error) { if (!isOpenstackNotFoundError(error) && Number(error?.status || error?.statusCode) !== 403) throw error; }
  }
  const heatStacks = await listOpenstackCleanupResources({
    endpoint: endpoints.heat,
    token,
    path: "/stacks?limit=500&sort_keys=creation_time&sort_dir=desc",
    key: "stacks",
  });
  const servers = await listOpenstackCleanupResources({
    endpoint: endpoints.compute,
    token,
    path: "/servers/detail?all_tenants=1",
    key: "servers",
  });
  const volumes = await listOpenstackCleanupResources({
    endpoint: endpoints.volume,
    token,
    path: `/volumes/detail?all_tenants=1&project_id=${encodeURIComponent(projectId)}`,
    key: "volumes",
  });
  const floatingIps = await listOpenstackCleanupResources({
    endpoint: endpoints.network,
    token,
    path: appendProjectIdQuery("/v2.0/floatingips", projectId),
    key: "floatingips",
  });
  const ports = await listOpenstackCleanupResources({
    endpoint: endpoints.network,
    token,
    path: appendProjectIdQuery("/v2.0/ports", projectId),
    key: "ports",
  });
  const routers = await listOpenstackCleanupResources({
    endpoint: endpoints.network,
    token,
    path: appendProjectIdQuery("/v2.0/routers", projectId),
    key: "routers",
  });
  const subnets = await listOpenstackCleanupResources({
    endpoint: endpoints.network,
    token,
    path: appendProjectIdQuery("/v2.0/subnets", projectId),
    key: "subnets",
  });
  const networks = await listOpenstackCleanupResources({
    endpoint: endpoints.network,
    token,
    path: appendProjectIdQuery("/v2.0/networks", projectId),
    key: "networks",
  });
  const securityGroups = await listOpenstackCleanupResources({
    endpoint: endpoints.network,
    token,
    path: appendProjectIdQuery("/v2.0/security-groups", projectId),
    key: "security_groups",
  });
  return {
    loadBalancers: loadBalancers.map(normalizeCleanupResource).filter((item) => item.id),
    dnsZones: dnsZones.map(normalizeCleanupResource).filter((item) => item.id),
    shares: shares.map(normalizeCleanupResource).filter((item) => item.id),
    reservations: reservations.map(normalizeCleanupResource).filter((item) => item.id),
    alarms: alarms.map((item) => normalizeCleanupResource(item, { id: String(item?.alarm_id || item?.id || "").trim() })).filter((item) => item.id),
    managedSecrets: secrets.map((item) => { const secretRef = String(item?.secret_ref || "").trim(); return normalizeCleanupResource(item, { id: pickOpenstackResourceId(item) || secretRef.split("/").filter(Boolean).pop() || "", secretRef }); }).filter((item) => item.id && /^(trove|terminal-lab)\//i.test(item.name)),
    heatStacks: heatStacks.map((stack) => ({
      id: String(stack.stackId || stack.id || "").trim(),
      name: String(stack.stackName || stack.name || "").trim(),
      status: String(stack.status || "").trim(),
    })).filter((item) => item.id && item.name && item.status !== "DELETE_COMPLETE"),
    servers: servers.map(normalizeCleanupResource).filter((item) => item.id),
    volumes: volumes.map(normalizeCleanupResource).filter((item) => item.id),
    floatingIps: floatingIps.map(normalizeCleanupResource).filter((item) => item.id),
    ports: ports.map((port) => normalizeCleanupResource(port, {
      deviceId: String(port?.device_id || "").trim(),
      deviceOwner: String(port?.device_owner || "").trim(),
      networkId: String(port?.network_id || "").trim(),
      fixedIps: Array.isArray(port?.fixed_ips) ? port.fixed_ips : [],
    })).filter((item) => item.id),
    routers: routers.map(normalizeCleanupResource).filter((item) => item.id),
    networks: networks.map((network) => normalizeCleanupResource(network, {
      shared: Boolean(network?.shared),
      external: Boolean(network?.["router:external"]),
    })).filter((item) => item.id && isDeletableProjectNetwork(item, projectId)),
    subnets: subnets.map((subnet) => normalizeCleanupResource(subnet, {
      networkId: String(subnet?.network_id || "").trim(),
    })).filter((item) => item.id && isProjectOwnedCleanupResource(item, projectId)),
    securityGroups: securityGroups
      .map(normalizeCleanupResource)
      .filter((item) => item.id && item.name !== "default"),
  };
}

function buildSelfServiceProjectCleanupSummary(inventory = {}) {
  return {
    loadBalancers: Array.isArray(inventory.loadBalancers) ? inventory.loadBalancers.length : 0,
    dnsZones: Array.isArray(inventory.dnsZones) ? inventory.dnsZones.length : 0,
    shares: Array.isArray(inventory.shares) ? inventory.shares.length : 0,
    reservations: Array.isArray(inventory.reservations) ? inventory.reservations.length : 0,
    alarms: Array.isArray(inventory.alarms) ? inventory.alarms.length : 0,
    managedSecrets: Array.isArray(inventory.managedSecrets) ? inventory.managedSecrets.length : 0,
    heatStacks: Array.isArray(inventory.heatStacks) ? inventory.heatStacks.length : 0,
    servers: Array.isArray(inventory.servers) ? inventory.servers.length : 0,
    volumes: Array.isArray(inventory.volumes) ? inventory.volumes.length : 0,
    floatingIps: Array.isArray(inventory.floatingIps) ? inventory.floatingIps.length : 0,
    routers: Array.isArray(inventory.routers) ? inventory.routers.length : 0,
    ports: Array.isArray(inventory.ports) ? inventory.ports.length : 0,
    subnets: Array.isArray(inventory.subnets) ? inventory.subnets.length : 0,
    networks: Array.isArray(inventory.networks) ? inventory.networks.length : 0,
    securityGroups: Array.isArray(inventory.securityGroups) ? inventory.securityGroups.length : 0,
  };
}

function formatCleanupInventorySummary(inventory = {}) {
  const summary = buildSelfServiceProjectCleanupSummary(inventory);
  const parts = Object.entries(summary)
    .filter(([, count]) => Number(count || 0) > 0)
    .map(([key, count]) => `${key}=${count}`);
  return parts.length ? parts.join(", ") : "empty";
}

async function ignoreOpenstackMissingDelete(action) {
  try {
    await action();
    return { deleted: true };
  } catch (error) {
    if (isOpenstackNotFoundError(error)) return { deleted: false, alreadyDeleted: true };
    throw error;
  }
}

async function deleteSelfServiceProjectResources({ endpoints = {}, token, projectId = "", projectName = "", inventory = {}, steps = [] }) {
  const markStep = (key, label, status, detail = "") => steps.push({ key, label, status, detail });
  const deleted = {
    loadBalancers: [], dnsZones: [], shares: [], reservations: [], alarms: [], managedSecrets: [],
    heatStacks: [],
    servers: [],
    volumes: [],
    floatingIps: [],
    routerInterfaces: [],
    routers: [],
    ports: [],
    subnets: [],
    networks: [],
    securityGroups: [],
  };

  for (const alarm of inventory.alarms || []) { await ignoreOpenstackMissingDelete(() => openstackFetch(`${endpoints.alarm}/v2/alarms/${encodeURIComponent(alarm.id)}`, { method: "DELETE", token, expectJson: false })); deleted.alarms.push(alarm.id); }
  for (const reservation of inventory.reservations || []) { await ignoreOpenstackMissingDelete(() => openstackFetch(`${endpoints.reservation}/v1/leases/${encodeURIComponent(reservation.id)}`, { method: "DELETE", token, expectJson: false })); deleted.reservations.push(reservation.id); }
  for (const loadBalancer of inventory.loadBalancers || []) { await ignoreOpenstackMissingDelete(() => openstackFetch(`${endpoints.loadBalancer}/v2/lbaas/loadbalancers/${encodeURIComponent(loadBalancer.id)}?cascade=true`, { method: "DELETE", token, expectJson: false })); deleted.loadBalancers.push(loadBalancer.id); }
  for (const zone of inventory.dnsZones || []) { await ignoreOpenstackMissingDelete(() => openstackFetch(`${endpoints.dns}/zones/${encodeURIComponent(zone.id)}`, { method: "DELETE", token, expectJson: false })); deleted.dnsZones.push(zone.id); }
  for (const share of inventory.shares || []) { await ignoreOpenstackMissingDelete(() => openstackFetch(`${endpoints.share}/shares/${encodeURIComponent(share.id)}`, { method: "DELETE", token, expectJson: false })); deleted.shares.push(share.id); }
  for (const secret of inventory.managedSecrets || []) { await ignoreOpenstackMissingDelete(() => openstackFetch(`${endpoints.keyManager}/v1/secrets/${encodeURIComponent(secret.id)}`, { method: "DELETE", token, expectJson: false })); deleted.managedSecrets.push(secret.id); }
  for (const [key,label] of [["alarms","Delete Aodh alarms"],["reservations","Delete Blazar reservations"],["loadBalancers","Delete Octavia load balancers"],["dnsZones","Delete Designate zones"],["shares","Delete Manila shares"],["managedSecrets","Delete portal-managed Barbican secrets"]]) if (deleted[key].length) markStep(`delete-${key}`, label, "success", String(deleted[key].length));

  for (const stack of inventory.heatStacks || []) {
    await ignoreOpenstackMissingDelete(() => openstackFetch(`${endpoints.heat}/stacks/${encodeURIComponent(stack.name)}/${encodeURIComponent(stack.id)}`, {
      method: "DELETE",
      token,
      expectJson: false,
    }));
    deleted.heatStacks.push(stack.id);
  }
  if (deleted.heatStacks.length) markStep("delete-heat", "Delete Heat stacks", "success", String(deleted.heatStacks.length));

  for (const server of inventory.servers || []) {
    await deleteOpenstackServer({ serverId: server.id, projectName });
    deleted.servers.push(server.id);
  }
  if (deleted.servers.length) markStep("delete-servers", "Delete Nova servers", "success", String(deleted.servers.length));

  const postServerInventory = await collectSelfServiceProjectCleanupInventory({
    endpoints,
    token,
    projectId,
    projectName,
  });

  for (const floatingIp of postServerInventory.floatingIps || []) {
    await ignoreOpenstackMissingDelete(() => openstackFetch(`${endpoints.network}/v2.0/floatingips/${encodeURIComponent(floatingIp.id)}`, {
      method: "DELETE",
      token,
      expectJson: false,
    }));
    deleted.floatingIps.push(floatingIp.id);
  }
  if (deleted.floatingIps.length) markStep("delete-floatingips", "Delete floating IPs", "success", String(deleted.floatingIps.length));

  for (const router of postServerInventory.routers || []) {
    const routerPorts = (postServerInventory.ports || []).filter((port) =>
      port.deviceId === router.id && /router_interface/i.test(port.deviceOwner));
    for (const port of routerPorts) {
      await ignoreOpenstackMissingDelete(() => openstackFetch(`${endpoints.network}/v2.0/routers/${encodeURIComponent(router.id)}/remove_router_interface`, {
        method: "PUT",
        token,
        body: { port_id: port.id },
      }));
      deleted.routerInterfaces.push(port.id);
    }
    await ignoreOpenstackMissingDelete(() => openstackFetch(`${endpoints.network}/v2.0/routers/${encodeURIComponent(router.id)}`, {
      method: "PUT",
      token,
      body: { router: { external_gateway_info: null } },
    }));
    await ignoreOpenstackMissingDelete(() => openstackFetch(`${endpoints.network}/v2.0/routers/${encodeURIComponent(router.id)}`, {
      method: "DELETE",
      token,
      expectJson: false,
    }));
    deleted.routers.push(router.id);
  }
  if (deleted.routers.length) markStep("delete-routers", "Delete routers", "success", String(deleted.routers.length));

  const postRouterInventory = await collectSelfServiceProjectCleanupInventory({
    endpoints,
    token,
    projectId,
    projectName,
  });

  const deletablePorts = (postRouterInventory.ports || []).filter((port) =>
    !/router_|network:dhcp/i.test(port.deviceOwner));
  for (const port of deletablePorts) {
    await deleteOpenstackPortWithRetry({ networkEndpoint: endpoints.network, token, portId: port.id });
    deleted.ports.push(port.id);
  }
  if (deleted.ports.length) markStep("delete-ports", "Delete Neutron ports", "success", String(deleted.ports.length));

  for (const volume of postRouterInventory.volumes || []) {
    await ignoreOpenstackMissingDelete(() => openstackFetch(`${endpoints.volume}/volumes/${encodeURIComponent(volume.id)}`, {
      method: "DELETE",
      token,
      expectJson: false,
    }));
    deleted.volumes.push(volume.id);
  }
  if (deleted.volumes.length) markStep("delete-volumes", "Delete Cinder volumes", "success", String(deleted.volumes.length));

  for (const subnet of postRouterInventory.subnets || []) {
    await ignoreOpenstackMissingDelete(() => openstackFetch(`${endpoints.network}/v2.0/subnets/${encodeURIComponent(subnet.id)}`, {
      method: "DELETE",
      token,
      expectJson: false,
    }));
    deleted.subnets.push(subnet.id);
  }
  if (deleted.subnets.length) markStep("delete-subnets", "Delete subnets", "success", String(deleted.subnets.length));

  for (const network of postRouterInventory.networks || []) {
    await ignoreOpenstackMissingDelete(() => openstackFetch(`${endpoints.network}/v2.0/networks/${encodeURIComponent(network.id)}`, {
      method: "DELETE",
      token,
      expectJson: false,
    }));
    deleted.networks.push(network.id);
  }
  if (deleted.networks.length) markStep("delete-networks", "Delete networks", "success", String(deleted.networks.length));

  for (const securityGroup of postRouterInventory.securityGroups || []) {
    await ignoreOpenstackMissingDelete(() => openstackFetch(`${endpoints.network}/v2.0/security-groups/${encodeURIComponent(securityGroup.id)}`, {
      method: "DELETE",
      token,
      expectJson: false,
    }));
    deleted.securityGroups.push(securityGroup.id);
  }
  if (deleted.securityGroups.length) markStep("delete-security-groups", "Delete security groups", "success", String(deleted.securityGroups.length));

  return deleted;
}

function normalizeRoleNames(roleNames = []) {
  const source = Array.isArray(roleNames) ? roleNames : String(roleNames || "").split(",");
  const normalized = source.map((item) => String(item || "").trim()).filter(Boolean);
  return normalized.length ? [...new Set(normalized)] : ["member", "heat_stack_owner"];
}

async function resolveKeystoneDomainId({ keystoneEndpoint, token, domainName = "Default" }) {
  const data = await openstackFetch(`${keystoneEndpoint}/domains?name=${encodeURIComponent(domainName || "Default")}`, {
    method: "GET",
    token,
  });
  const domains = Array.isArray(data?.domains) ? data.domains : [];
  return String(domains[0]?.id || "default").trim() || "default";
}

async function findKeystoneProjectByName({ keystoneEndpoint, token, projectName }) {
  const data = await openstackFetch(`${keystoneEndpoint}/projects?name=${encodeURIComponent(projectName)}`, {
    method: "GET",
    token,
  });
  const projects = Array.isArray(data?.projects) ? data.projects : [];
  return projects.find((item) => String(item?.name || "").trim().toLowerCase() === projectName.toLowerCase()) || null;
}

async function ensureKeystoneProject({ keystoneEndpoint, token, projectName, domainId, description }) {
  // A filtered project lookup still requires identity:list_projects in Keystone.
  // Create first so service accounts with create_project, but without global list access,
  // can provision a new dedicated project without an unnecessary admin-only call.
  try {
    const data = await openstackFetch(`${keystoneEndpoint}/projects`, {
      method: "POST",
      token,
      body: {
        project: {
          name: projectName,
          description,
          enabled: true,
          domain_id: domainId || "default",
        },
      },
    });
    const project = data?.project || {};
    return { id: String(project.id || ""), name: String(project.name || projectName), created: true, raw: project };
  } catch (error) {
    if (isOpenstackConflictError(error)) {
      const retried = await findKeystoneProjectByName({ keystoneEndpoint, token, projectName });
      if (retried?.id) return { id: String(retried.id), name: String(retried.name || projectName), created: false, raw: retried };
    }
    throw error;
  }
}

async function resolveKeystoneRoleByName({ keystoneEndpoint, token, roleName }) {
  const data = await openstackFetch(`${keystoneEndpoint}/roles?name=${encodeURIComponent(roleName)}`, {
    method: "GET",
    token,
  });
  const roles = Array.isArray(data?.roles) ? data.roles : [];
  return roles.find((item) => String(item?.name || "").trim() === roleName) || null;
}

async function assignKeystoneProjectRole({ keystoneEndpoint, token, projectId, userId, roleId }) {
  if (!projectId || !userId || !roleId) {
    throw new Error("projectId, userId, roleId가 필요합니다.");
  }
  await openstackFetch(`${keystoneEndpoint}/projects/${encodeURIComponent(projectId)}/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`, {
    method: "PUT",
    token,
    expectJson: false,
  });
}

async function authenticateProjectWithRetry(cloud, { projectName }) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await authenticate(cloud, { projectName });
    } catch (error) {
      lastError = error;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

async function applySelfServiceProjectQuotas({ cloud, auth, projectId, quota = {}, warnings = [], steps = [] }) {
  const markStep = (key, label, status, detail = "") => steps.push({ key, label, status, detail });
  const result = { compute: null, volume: null, network: null };
  const computeEndpoint = resolveComputeEndpoint(cloud, auth);
  const volumeEndpoint = resolveVolumeEndpoint(cloud, auth);
  const networkEndpoint = resolveNetworkEndpoint(cloud, auth);

  const computeQuota = pickPositiveQuotaValues(quota, {
    instances: "instances",
    cores: "cores",
    ram: "ram",
  });
  if (computeEndpoint && Object.keys(computeQuota).length) {
    try {
      await openstackFetch(`${computeEndpoint}/os-quota-sets/${encodeURIComponent(projectId)}`, {
        method: "PUT",
        token: auth.token,
        body: { quota_set: computeQuota },
      });
      result.compute = computeQuota;
      markStep("quota:compute", "Compute quota 적용", "success", Object.keys(computeQuota).join(", "));
    } catch (error) {
      warnings.push(`Compute quota 적용 실패: ${error.message}`);
      markStep("quota:compute", "Compute quota 적용", "warning", error.message);
    }
  }

  const volumeQuota = pickPositiveQuotaValues(quota, {
    volumes: "volumes",
    gigabytes: "gigabytes",
    snapshots: "snapshots",
  });
  if (volumeEndpoint && Object.keys(volumeQuota).length) {
    try {
      await openstackFetch(`${volumeEndpoint}/os-quota-sets/${encodeURIComponent(projectId)}`, {
        method: "PUT",
        token: auth.token,
        body: { quota_set: volumeQuota },
      });
      result.volume = volumeQuota;
      markStep("quota:volume", "Cinder quota 적용", "success", Object.keys(volumeQuota).join(", "));
    } catch (error) {
      warnings.push(`Cinder quota 적용 실패: ${error.message}`);
      markStep("quota:volume", "Cinder quota 적용", "warning", error.message);
    }
  }

  const networkQuota = pickPositiveQuotaValues(quota, {
    network: "network",
    subnet: "subnet",
    router: "router",
    port: "port",
    floatingip: "floatingip",
    security_group: "security_group",
    security_group_rule: "security_group_rule",
  });
  if (networkEndpoint && Object.keys(networkQuota).length) {
    try {
      await openstackFetch(`${networkEndpoint}/v2.0/quotas/${encodeURIComponent(projectId)}`, {
        method: "PUT",
        token: auth.token,
        body: { quota: networkQuota },
      });
      result.network = networkQuota;
      markStep("quota:network", "Neutron quota 적용", "success", Object.entries(networkQuota).map(([key, value]) => `${key}=${value}`).join(", "));
    } catch (error) {
      warnings.push(`Neutron quota 적용 실패: ${error.message}`);
      markStep("quota:network", "Neutron quota 적용", "warning", error.message);
    }
  }

  return result;
}

function pickPositiveQuotaValues(source = {}, mapping = {}) {
  const result = {};
  for (const [sourceKey, targetKey] of Object.entries(mapping)) {
    const value = Number.parseInt(source?.[sourceKey], 10);
    if (Number.isInteger(value) && value >= 0) result[targetKey] = value;
  }
  return result;
}

function appendProjectIdQuery(path, projectId = "") {
  const normalizedProjectId = String(projectId || "").trim();
  return normalizedProjectId ? `${path}${path.includes("?") ? "&" : "?"}project_id=${encodeURIComponent(normalizedProjectId)}` : path;
}

function matchesOpenstackProjectId(item = {}, projectId = "") {
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId) return true;
  const resourceProjectId = String(item?.project_id || item?.tenant_id || item?.projectId || "").trim();
  return Boolean(resourceProjectId) && resourceProjectId === normalizedProjectId;
}

function isVisibleSelfServiceNetwork(network = {}, projectId = "") {
  const networkName = String(network?.name || "").trim().toLowerCase();
  return matchesOpenstackProjectId(network, projectId)
    || networkName === SELF_SERVICE_VM_NETWORK.toLowerCase();
}

async function ensureCloudConsoleSshSecurityGroup({ projectName = "" } = {}) {
  const name = "terminal-lab-cloud-ssh";
  if (HEAT_DRIVER === "mock") return { id: "mock-cloud-ssh", name };
  const context = await getProjectResourceContext(projectName);
  return ensureOpenstackSecurityGroup({
    networkEndpoint: context.networkEndpoint, token: context.token, projectId: context.projectId,
    name, sshRemoteIpPrefix: "0.0.0.0/0", includeIcmp: false,
  });
}

async function ensureOpenstackSecurityGroup({ networkEndpoint, token, projectId, name, sshRemoteIpPrefix = "", includeIcmp = true }) {
  const normalizedName = String(name || "").trim();
  let securityGroup = await resolveOpenstackSecurityGroup({ networkEndpoint, token, projectId, name: normalizedName });
  let createdByRequest = false;
  if (!securityGroup?.id) {
    try {
      securityGroup = (await openstackFetch(`${networkEndpoint}/v2.0/security-groups`, {
        method: "POST",
        token,
        body: {
          security_group: {
            name: normalizedName,
            description: "Terminal Lab self-service VM access",
            project_id: projectId,
          },
        },
      }))?.security_group;
      createdByRequest = Boolean(securityGroup?.id);
    } catch (error) {
      if (!isOpenstackConflictError(error)) throw error;
      securityGroup = await resolveOpenstackSecurityGroup({ networkEndpoint, token, projectId, name: normalizedName });
      if (!securityGroup?.id) throw error;
    }
  }
  await ensureSecurityGroupRule({ networkEndpoint, token, securityGroupId: securityGroup.id, protocol: "tcp", portRangeMin: 22, portRangeMax: 22, remoteIpPrefix: sshRemoteIpPrefix });
  if (includeIcmp) await ensureSecurityGroupRule({ networkEndpoint, token, securityGroupId: securityGroup.id, protocol: "icmp" });
  return { id: String(securityGroup.id || ""), name: String(securityGroup.name || normalizedName), created: createdByRequest };
}

async function resolveOpenstackSecurityGroup({ networkEndpoint, token, projectId = "", name }) {
  const normalizedName = String(name || "").trim();
  const data = await openstackFetch(appendProjectIdQuery(`${networkEndpoint}/v2.0/security-groups?name=${encodeURIComponent(normalizedName)}`, projectId), {
    method: "GET",
    token,
  });
  const existing = (Array.isArray(data?.security_groups) ? data.security_groups : [])
    .find((item) => String(item?.name || "").trim() === normalizedName && matchesOpenstackProjectId(item, projectId));
  return existing?.id ? { id: String(existing.id || ""), name: String(existing.name || normalizedName), created: false } : null;
}

async function ensureSecurityGroupRule({ networkEndpoint, token, securityGroupId, protocol, portRangeMin = null, portRangeMax = null, remoteIpPrefix = "" }) {
  try {
    await openstackFetch(`${networkEndpoint}/v2.0/security-group-rules`, {
      method: "POST",
      token,
      body: {
        security_group_rule: {
          direction: "ingress",
          ethertype: "IPv4",
          protocol,
          security_group_id: securityGroupId,
          ...(remoteIpPrefix ? { remote_ip_prefix: remoteIpPrefix } : {}),
          ...(portRangeMin ? { port_range_min: portRangeMin } : {}),
          ...(portRangeMax ? { port_range_max: portRangeMax } : {}),
        },
      },
    });
  } catch (error) {
    if (!isOpenstackConflictError(error)) throw error;
  }
}

async function ensureOpenstackProjectNetwork({ networkEndpoint, token, projectId = "", projectName, networkName, subnetName, subnetCidr, routerName, externalNetworkName, manualPortEnabled = false, manualPortName = "", trunkEnabled = false, vlanId = "", vlanAuto = false, qosPolicyName = "", firewallGroupName = "", securityGroupIds = [] }) {
  const network = await ensureNetworkByName({ networkEndpoint, token, projectId, name: networkName, vlanId, vlanAuto });
  const subnet = await ensureSubnetForNetwork({ networkEndpoint, token, networkId: network.id, name: subnetName, cidr: subnetCidr });
  const result = { network, subnet, vlanId: String(network.vlanId || vlanId || ""), vlanAuto: Boolean(vlanAuto), qosPolicyName: String(qosPolicyName || ""), firewallGroupName: String(firewallGroupName || "") };
  const externalNetwork = externalNetworkName
    ? await resolveNetworkByName({ networkEndpoint, token, name: externalNetworkName })
    : null;
  if (routerName) {
    const router = await ensureRouterByName({ networkEndpoint, token, projectId, name: routerName, externalNetworkId: externalNetwork?.id || "" });
    await ensureRouterInterface({ networkEndpoint, token, routerId: router.id, subnetId: subnet.id });
    result.router = router;
    if (router.gatewayWarning) {
      result.routerWarning = router.gatewayWarning;
    } else if (externalNetwork?.id) {
      result.externalNetwork = { id: String(externalNetwork.id || ""), name: String(externalNetwork.name || externalNetworkName) };
    } else if (externalNetworkName) {
      result.routerWarning = `외부 네트워크 ${externalNetworkName}을 찾지 못해 라우터 외부 게이트웨이는 연결하지 않았습니다.`;
    } else {
      result.routerWarning = "외부 네트워크 이름이 비어 있어 라우터 외부 게이트웨이는 연결하지 않았습니다.";
    }
  }
  if (manualPortEnabled) {
    result.port = await ensurePortByName({
      networkEndpoint,
      token,
      projectId,
      networkId: network.id,
      name: manualPortName || `${networkName}-parent-port`,
      securityGroupIds,
    });
    if (trunkEnabled && result.port?.id) {
      try {
        result.trunk = await ensureTrunkForPort({
          networkEndpoint,
          token,
          parentPortId: result.port.id,
          name: `${result.port.name || networkName}-trunk`,
        });
      } catch (error) {
        result.trunkError = error.message;
      }
    }
  }
  return { ...result, projectName };
}

async function ensureTrunkForPort({ networkEndpoint, token, parentPortId, name }) {
  const normalizedName = String(name || "").trim();
  const existing = await resolveTrunkForPort({ networkEndpoint, token, parentPortId, name: normalizedName });
  if (existing?.id) return existing;
  let created;
  try {
    created = await openstackFetch(`${networkEndpoint}/v2.0/trunks`, {
      method: "POST",
      token,
      body: {
        trunk: {
          name: normalizedName,
          port_id: parentPortId,
          admin_state_up: true,
          sub_ports: [],
        },
      },
    });
  } catch (error) {
    if (!isOpenstackConflictError(error)) throw error;
    const resolved = await resolveTrunkForPort({ networkEndpoint, token, parentPortId, name: normalizedName });
    if (resolved?.id) return resolved;
    throw error;
  }
  const trunk = created?.trunk || {};
  return { id: String(trunk.id || ""), name: String(trunk.name || normalizedName), created: true };
}

async function resolveTrunkForPort({ networkEndpoint, token, parentPortId, name }) {
  const normalizedName = String(name || "").trim();
  const data = await openstackFetch(`${networkEndpoint}/v2.0/trunks?name=${encodeURIComponent(normalizedName)}`, {
    method: "GET",
    token,
  });
  const existing = (Array.isArray(data?.trunks) ? data.trunks : [])
    .find((item) => String(item?.port_id || "").trim() === String(parentPortId || "").trim() || String(item?.name || "").trim() === normalizedName);
  return existing?.id ? { id: String(existing.id), name: String(existing.name || normalizedName), created: false } : null;
}

async function ensurePortByName({ networkEndpoint, token, projectId = "", networkId, name, securityGroupIds = [] }) {
  const normalizedName = String(name || "").trim();
  const existing = await resolvePortByName({ networkEndpoint, token, projectId, networkId, name: normalizedName });
  if (existing?.id) return existing;
  let created;
  try {
    created = await openstackFetch(`${networkEndpoint}/v2.0/ports`, {
      method: "POST",
      token,
      body: {
        port: {
          network_id: networkId,
          name: normalizedName,
          admin_state_up: true,
          ...(Array.isArray(securityGroupIds) && securityGroupIds.length ? { security_groups: securityGroupIds } : {}),
        },
      },
    });
  } catch (error) {
    if (!isOpenstackConflictError(error)) throw error;
    const resolved = await resolvePortByName({ networkEndpoint, token, projectId, networkId, name: normalizedName });
    if (resolved?.id) return resolved;
    throw error;
  }
  const port = created?.port || {};
  return { id: String(port.id || ""), name: String(port.name || normalizedName), created: true };
}

async function resolvePortByName({ networkEndpoint, token, projectId = "", networkId, name }) {
  const normalizedName = String(name || "").trim();
  const data = await openstackFetch(appendProjectIdQuery(`${networkEndpoint}/v2.0/ports?name=${encodeURIComponent(normalizedName)}`, projectId), {
    method: "GET",
    token,
  });
  const existing = (Array.isArray(data?.ports) ? data.ports : [])
    .find((item) =>
      String(item?.name || "").trim() === normalizedName
      && String(item?.network_id || "").trim() === String(networkId || "").trim()
      && matchesOpenstackProjectId(item, projectId));
  return existing?.id ? { id: String(existing.id), name: String(existing.name || normalizedName), created: false } : null;
}

function pickSelfServiceVlanId(excluded = new Set()) {
  const min = SELF_SERVICE_VM_VLAN_MIN;
  const max = SELF_SERVICE_VM_VLAN_MAX;
  const size = Math.max(1, max - min + 1);
  const start = min + Math.floor(Math.random() * size);
  for (let offset = 0; offset < size; offset += 1) {
    const candidate = min + ((start - min + offset) % size);
    if (!excluded.has(candidate)) return candidate;
  }
  return start;
}

function normalizeSelfServiceVlanId(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^\d+$/.test(raw)) {
    throw new Error(`VLAN ID는 숫자로 입력해야 합니다. 사용 가능 범위는 ${SELF_SERVICE_VM_VLAN_MIN}~${SELF_SERVICE_VM_VLAN_MAX}입니다.`);
  }
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id < SELF_SERVICE_VM_VLAN_MIN || id > SELF_SERVICE_VM_VLAN_MAX) {
    throw new Error(`VLAN ID ${raw}는 사용할 수 없습니다. OpenStack VLAN ID는 ${SELF_SERVICE_VM_VLAN_MIN}~${SELF_SERVICE_VM_VLAN_MAX} 범위에서 신청해 주세요.`);
  }
  return String(id);
}

async function ensureNetworkByName({ networkEndpoint, token, projectId = "", name, vlanId = "", vlanAuto = false }) {
  const existing = await resolveNetworkByName({ networkEndpoint, token, projectId, name });
  if (existing?.id) return { id: String(existing.id), name: String(existing.name || name), created: false };
  const triedAutoVlans = new Set();
  const maxAttempts = vlanAuto ? Math.min(8, Math.max(1, SELF_SERVICE_VM_VLAN_MAX - SELF_SERVICE_VM_VLAN_MIN + 1)) : 1;
  let lastError = null;
  let data;
  let resolvedVlanId = normalizeSelfServiceVlanId(vlanId);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (vlanAuto && !resolvedVlanId) {
      resolvedVlanId = String(pickSelfServiceVlanId(triedAutoVlans));
    }
    if (resolvedVlanId) triedAutoVlans.add(Number(resolvedVlanId));
    const createBody = {
      network: {
        name,
        admin_state_up: true,
        ...(resolvedVlanId ? { "provider:network_type": "vlan", "provider:segmentation_id": Number(resolvedVlanId) } : {}),
      },
    };
    try {
      data = await openstackFetch(`${networkEndpoint}/v2.0/networks`, {
        method: "POST",
        token,
        body: createBody,
      });
      break;
    } catch (error) {
      lastError = error;
      if (!vlanAuto || !isOpenstackConflictError(error) || attempt >= maxAttempts - 1) {
        if (resolvedVlanId) {
          throw new Error(`VLAN ${resolvedVlanId} 네트워크 자동 생성에 실패했습니다. provider network 권한, physical network 매핑, VLAN ID 충돌 여부를 확인해 주세요. (${error.message})`, { cause: error });
        }
        throw error;
      }
      resolvedVlanId = "";
    }
  }
  if (!data && lastError) {
    throw lastError;
  }
  const network = data?.network || {};
  return { id: String(network.id || ""), name: String(network.name || name), created: true, vlanId: resolvedVlanId };
}

async function ensureSubnetForNetwork({ networkEndpoint, token, networkId, name, cidr }) {
  const existing = await resolveSubnetForNetwork({ networkEndpoint, token, networkId, name, cidr });
  if (existing?.id) return existing;
  let created;
  try {
    created = await openstackFetch(`${networkEndpoint}/v2.0/subnets`, {
      method: "POST",
      token,
      body: {
        subnet: {
          name,
          network_id: networkId,
          ip_version: 4,
          cidr,
          enable_dhcp: true,
        },
      },
    });
  } catch (error) {
    if (!isOpenstackConflictError(error)) throw error;
    const resolved = await resolveSubnetForNetwork({ networkEndpoint, token, networkId, name, cidr });
    if (resolved?.id) return resolved;
    throw error;
  }
  const subnet = created?.subnet || {};
  return { id: String(subnet.id || ""), name: String(subnet.name || name), cidr: String(subnet.cidr || cidr), created: true };
}

async function resolveSubnetForNetwork({ networkEndpoint, token, networkId, name, cidr }) {
  const data = await openstackFetch(`${networkEndpoint}/v2.0/subnets?network_id=${encodeURIComponent(networkId)}`, {
    method: "GET",
    token,
  });
  const existing = (Array.isArray(data?.subnets) ? data.subnets : [])
    .find((item) => String(item?.name || "").trim() === name || String(item?.cidr || "").trim() === cidr);
  return existing?.id ? { id: String(existing.id), name: String(existing.name || name), cidr: String(existing.cidr || cidr), created: false } : null;
}

async function ensureRouterByName({ networkEndpoint, token, projectId = "", name, externalNetworkId }) {
  const existing = await resolveRouterByName({ networkEndpoint, token, projectId, name });
  if (existing?.id) return existing;
  let created;
  try {
    created = await openstackFetch(`${networkEndpoint}/v2.0/routers`, {
      method: "POST",
      token,
      body: {
        router: {
          name,
          admin_state_up: true,
          ...(externalNetworkId ? { external_gateway_info: { network_id: externalNetworkId } } : {}),
        },
      },
    });
  } catch (error) {
    if (externalNetworkId && isOpenstackIpAddressGenerationFailure(error)) {
      const fallback = await openstackFetch(networkEndpoint + "/v2.0/routers", {
        method: "POST",
        token,
        body: { router: { name, admin_state_up: true } },
      });
      const router = fallback?.router || {};
      return {
        id: String(router.id || ""),
        name: String(router.name || name),
        created: true,
        gatewayWarning: "외부 네트워크의 할당 가능한 IP가 없어 내부 라우터만 구성했습니다. 외부 IP 풀 확보 후 게이트웨이를 연결해 주세요.",
      };
    }
    if (!isOpenstackConflictError(error)) throw error;
    const resolved = await resolveRouterByName({ networkEndpoint, token, projectId, name });
    if (resolved?.id) return resolved;
    throw error;
  }
  const router = created?.router || {};
  return { id: String(router.id || ""), name: String(router.name || name), created: true };
}

async function resolveRouterByName({ networkEndpoint, token, projectId = "", name }) {
  const data = await openstackFetch(appendProjectIdQuery(`${networkEndpoint}/v2.0/routers?name=${encodeURIComponent(name)}`, projectId), {
    method: "GET",
    token,
  });
  const existing = (Array.isArray(data?.routers) ? data.routers : [])
    .find((item) => String(item?.name || "").trim() === name && matchesOpenstackProjectId(item, projectId));
  return existing?.id ? { id: String(existing.id), name: String(existing.name || name), created: false } : null;
}

async function ensureRouterInterface({ networkEndpoint, token, routerId, subnetId }) {
  try {
    await openstackFetch(`${networkEndpoint}/v2.0/routers/${encodeURIComponent(routerId)}/add_router_interface`, {
      method: "PUT",
      token,
      body: { subnet_id: subnetId },
    });
  } catch (error) {
    if (!isOpenstackConflictError(error)) throw error;
  }
}

function deriveProjectSubnetCidr(projectName) {
  const digest = createHash("sha1").update(String(projectName || "terminal-lab")).digest();
  const octet = 1 + (digest[0] % 254);
  return `172.20.${octet}.0/24`;
}

function findCatalogEndpoint(catalog, { type, region, interfaceName }) {
  const service = catalog.find((item) => item.type === type);
  if (!service) return "";

  const endpoints = Array.isArray(service.endpoints) ? service.endpoints : [];
  const matched = endpoints.find((endpoint) => {
    const regionOk = !region || endpoint.region === region || endpoint.region_id === region;
    const interfaceOk = !interfaceName || endpoint.interface === interfaceName;
    return regionOk && interfaceOk;
  }) || endpoints.find((endpoint) => !interfaceName || endpoint.interface === interfaceName)
    || (OPENSTACK_PREFER_INTERNAL_ENDPOINTS ? endpoints.find((endpoint) => endpoint.interface === "internal") : null)
    || endpoints[0];

  return matched?.url || "";
}

function resolveComputeEndpoint(cloud, auth) {
  return normalizeEndpoint(cloud.computeApiUrl || findCatalogEndpoint(auth.catalog, {
    type: "compute",
    region: cloud.region_name,
    interfaceName: cloud.interface,
  }));
}

function resolveNetworkEndpoint(cloud, auth) {
  return normalizeEndpoint(cloud.networkApiUrl || findCatalogEndpoint(auth.catalog, {
    type: "network",
    region: cloud.region_name,
    interfaceName: cloud.interface,
  }));
}

function resolveVolumeEndpoint(cloud, auth) {
  return normalizeEndpoint(
    cloud.volumeApiUrl
      || findCatalogEndpoint(auth.catalog, {
        type: "volumev3",
        region: cloud.region_name,
        interfaceName: cloud.interface,
      })
      || findCatalogEndpoint(auth.catalog, {
        type: "volumev2",
        region: cloud.region_name,
        interfaceName: cloud.interface,
      })
      || findCatalogEndpoint(auth.catalog, {
        type: "block-storage",
        region: cloud.region_name,
        interfaceName: cloud.interface,
      }),
  );
}

async function openstackFetch(url, { method, token, body, expectJson = true, headers = {} }) {
  debug("request", { method, url, hasBody: Boolean(body) });
  const response = await fetchOpenstackResponse(url, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Token": token,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  }, { service: "OpenStack API request" });

  if (!response.ok) {
    const text = await safeText(response);
    const error = new Error(`OpenStack API request failed (${response.status}): ${text}`);
    error.status = response.status;
    error.statusCode = response.status;
    error.statusText = response.statusText;
    error.body = text;
    error.url = url;
    throw error;
  }

  if (!expectJson || response.status === 204) {
    return response;
  }

  return await response.json();
}

async function fetchOpenstackResponse(url, options = {}, { service = "OpenStack request" } = {}) {
  try {
    return await fetchOpenstack(url, options);
  } catch (error) {
    const wrapped = new Error(`${service} failed: ${formatFetchError(error, url)}`, { cause: error });
    if (error?.code) wrapped.code = error.code;
    if (error?.openstackCaStatus) wrapped.openstackCaStatus = error.openstackCaStatus;
    throw wrapped;
  }
}

function formatFetchError(error, url) {
  const cause = error?.cause || {};
  const causeMessages = Array.isArray(cause?.errors)
    ? cause.errors.map(formatFetchCause).filter(Boolean)
    : [formatFetchCause(cause)].filter(Boolean);
  const detailParts = [
    causeMessages.length ? causeMessages.join("; ") : "",
    formatFetchCaStatus(error?.openstackCaStatus),
    /OpenStack CA|auth_url hostname|intermediate chain/i.test(String(error?.message || "")) ? String(error.message) : "",
  ].map((item) => String(item || "").trim()).filter(Boolean);
  const detail = [...new Set(detailParts)].join("; ") || String(error?.message || "fetch failed");
  return `${detail} (${String(url || "").replace(/\/+$/, "")})`;
}

function formatFetchCaStatus(status = null) {
  if (!status || typeof status !== "object") return "";
  const paths = Array.isArray(status.loadedPaths) ? status.loadedPaths.filter(Boolean) : [];
  const checkedPaths = Array.isArray(status.checkedPaths) ? status.checkedPaths.filter(Boolean) : [];
  const certificates = Number(status.certificateCount || 0) || 0;
  const invalid = [
    status.expiredCertificates ? `만료 ${status.expiredCertificates}건` : "",
    status.notYetValidCertificates ? `유효 전 ${status.notYetValidCertificates}건` : "",
  ].filter(Boolean).join(", ");
  if (paths.length) {
    return `OpenStack CA 로드됨: ${paths.join(", ")}${certificates ? ` / 인증서 ${certificates}개` : ""}${invalid ? ` / ${invalid}` : ""}. 계속 실패하면 Keystone 인증서의 leaf/intermediate 체인과 auth_url 호스트명/SAN을 확인하세요.`;
  }
  if (checkedPaths.length) {
    return `OpenStack CA 로드 안 됨. 확인한 경로: ${checkedPaths.join(", ")}`;
  }
  return "";
}

function formatFetchCause(cause) {
  if (!cause || typeof cause !== "object") return "";
  const parts = [
    cause.code,
    cause.syscall,
    cause.hostname,
    cause.address,
    cause.port,
    cause.reason,
    cause.message,
  ].map((item) => String(item || "").trim()).filter(Boolean);
  return [...new Set(parts)].join(" ");
}

function isOpenstackNotFoundError(error) {
  const statuses = [
    error?.status,
    error?.statusCode,
    error?.response?.status,
    error?.cause?.status,
    error?.cause?.statusCode,
  ].map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (statuses.includes(404)) return true;
  const text = [
    error?.message,
    error?.body,
    error?.statusText,
    error?.code,
    error?.cause?.message,
    error?.cause?.body,
  ].map((value) => String(value || "")).join(" ");
  return /\b404\b|not found|notfound|resource.*missing|could not be found/i.test(text);
}

function isOpenstackConflictError(error) {
  const statuses = [
    error?.status,
    error?.statusCode,
    error?.response?.status,
    error?.cause?.status,
    error?.cause?.statusCode,
  ].map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (statuses.includes(409)) return true;
  const text = [
    error?.message,
    error?.body,
    error?.statusText,
    error?.code,
    error?.cause?.message,
    error?.cause?.body,
  ].map((value) => String(value || "")).join(" ");
  return /\b409\b|conflict|already exists|already in use|duplicate|overlap|vlan.*(used|exists|conflict|duplicate|already)|segmentation[_\s-]?id.*(used|exists|conflict|duplicate|already)|(used|exists|conflict|duplicate|already).*segmentation[_\s-]?id/i.test(text);
}

function isOpenstackIpAddressGenerationFailure(error) {
  const text = [error?.message, error?.body, error?.cause?.message, error?.cause?.body]
    .map((value) => String(value || ""))
    .join(" ");
  return /IpAddressGenerationFailure|No more IP addresses available/i.test(text);
}

async function collectOpenstackServerPortIds({ computeEndpoint, networkEndpoint, token, serverId }) {
  const portIds = new Set();
  try {
    for (const portId of await listOpenstackServerInterfacePortIds({ computeEndpoint, token, serverId })) {
      portIds.add(portId);
    }
  } catch (error) {
    if (!isOpenstackNotFoundError(error)) {
      console.warn("[openstack] server interface port lookup failed", {
        serverId,
        message: error?.message,
      });
    }
  }

  try {
    for (const portId of await listOpenstackPortsByDeviceId({ networkEndpoint, token, deviceId: serverId })) {
      portIds.add(portId);
    }
  } catch (error) {
    if (!isOpenstackNotFoundError(error)) {
      console.warn("[openstack] neutron device port lookup failed", {
        serverId,
        message: error?.message,
      });
    }
  }

  return [...portIds];
}

async function listOpenstackServerInterfacePortIds({ computeEndpoint, token, serverId }) {
  const data = await openstackFetch(`${computeEndpoint}/servers/${encodeURIComponent(serverId)}/os-interface`, {
    method: "GET",
    token,
  });
  const attachments = Array.isArray(data?.interfaceAttachments)
    ? data.interfaceAttachments
    : Array.isArray(data?.interface_attachments)
      ? data.interface_attachments
      : [];
  return attachments
    .map((attachment) => String(attachment?.port_id || attachment?.portId || attachment?.id || "").trim())
    .filter(Boolean);
}

async function listOpenstackPortsByDeviceId({ networkEndpoint, token, deviceId }) {
  const data = await openstackFetch(`${networkEndpoint}/v2.0/ports?device_id=${encodeURIComponent(deviceId)}`, {
    method: "GET",
    token,
  });
  const ports = Array.isArray(data?.ports) ? data.ports : [];
  return ports
    .map((port) => String(port?.id || "").trim())
    .filter(Boolean);
}

async function deleteOpenstackPorts({ networkEndpoint, token, portIds = [] }) {
  const uniquePortIds = [...new Set(portIds.map((portId) => String(portId || "").trim()).filter(Boolean))];
  const deletedPortIds = [];
  const errors = [];

  for (const portId of uniquePortIds) {
    try {
      const result = await deleteOpenstackPortWithRetry({ networkEndpoint, token, portId });
      if (result.deleted) {
        deletedPortIds.push(portId);
      }
    } catch (error) {
      errors.push(`${portId}: ${error.message}`);
    }
  }

  if (errors.length) {
    throw new Error(`OpenStack server ports could not be deleted: ${errors.join("; ")}`);
  }

  return deletedPortIds;
}

async function deleteOpenstackPortWithRetry({ networkEndpoint, token, portId }) {
  const startedAt = Date.now();
  const timeoutMs = Math.min(HEAT_POLL_TIMEOUT_MS, 60_000);
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await openstackFetch(`${networkEndpoint}/v2.0/ports/${encodeURIComponent(portId)}`, {
        method: "DELETE",
        token,
        expectJson: false,
      });
      return { deleted: true };
    } catch (error) {
      if (isOpenstackNotFoundError(error)) {
        return { deleted: false, alreadyDeleted: true };
      }
      if (!isOpenstackConflictError(error)) {
        throw error;
      }
      await sleep(Math.min(HEAT_POLL_INTERVAL_MS, 5000));
    }
  }
  throw new Error(`Port ${portId} was still in use after server deletion.`);
}

async function resolveNetworkByName({ networkEndpoint, token, projectId = "", name = "" }) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return null;
  const data = await openstackFetch(appendProjectIdQuery(`${networkEndpoint}/v2.0/networks?name=${encodeURIComponent(normalizedName)}`, projectId), {
    method: "GET",
    token,
  });
  const networks = Array.isArray(data?.networks) ? data.networks : [];
  return networks.find((item) => String(item?.name || "").trim() === normalizedName && matchesOpenstackProjectId(item, projectId)) || null;
}

async function resolveFlavorRefByName({ computeEndpoint, token, flavorName = "" }) {
  const normalizedName = String(flavorName || "").trim();
  if (!normalizedName) return "";
  const data = await openstackFetch(`${computeEndpoint}/flavors/detail`, {
    method: "GET",
    token,
  });
  const flavors = Array.isArray(data?.flavors) ? data.flavors : [];
  const matched = flavors.find((item) => String(item?.name || "").trim() === normalizedName) || null;
  return matched ? String(matched.id || "").trim() : "";
}

async function listFlavorDetails({ flavorNames = [], projectName = "" } = {}) {
  const allowedNames = new Set((Array.isArray(flavorNames) ? flavorNames : []).map((item) => String(item || "").trim()).filter(Boolean));
  if (!allowedNames.size || HEAT_DRIVER === "mock") return [];
  if (HEAT_DRIVER !== "openstack") throw new Error(`Unsupported HEAT_DRIVER: ${HEAT_DRIVER}`);
  const cloud = await loadCloudConfig({ projectName });
  const auth = await authenticate(cloud, { projectName });
  const computeEndpoint = resolveComputeEndpoint(cloud, auth);
  if (!computeEndpoint) throw new Error("Compute endpoint could not be resolved from clouds.yaml.");
  const data = await openstackFetch(`${computeEndpoint}/flavors/detail`, { method: "GET", token: auth.token });
  const flavors = (Array.isArray(data?.flavors) ? data.flavors : []).filter((item) => allowedNames.has(String(item?.name || "").trim()));
  return Promise.all(flavors.map(async (flavor) => {
    let extraSpecs = {};
    try {
      const extraData = await openstackFetch(`${computeEndpoint}/flavors/${encodeURIComponent(flavor.id)}/os-extra_specs`, { method: "GET", token: auth.token });
      extraSpecs = extraData?.extra_specs && typeof extraData.extra_specs === "object" ? extraData.extra_specs : {};
    } catch {
      // Nova policy can permit flavor details while denying extra-spec reads.
    }
    return {
      id: String(flavor.id || ""), name: String(flavor.name || ""), vcpus: Number(flavor.vcpus || 0),
      ramMb: Number(flavor.ram || 0), diskGb: Number(flavor.disk || 0),
      ephemeralGb: Number(flavor["OS-FLV-EXT-DATA:ephemeral"] || 0), swapMb: Number(flavor.swap || 0),
      rxtxFactor: Number(flavor.rxtx_factor || 0), isPublic: flavor["os-flavor-access:is_public"] !== false, extraSpecs,
    };
  }));
}

async function waitForServerStatus({ computeEndpoint, token, serverId, targetStatuses = [] }) {
  const normalizedTargets = Array.isArray(targetStatuses)
    ? targetStatuses.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < HEAT_POLL_TIMEOUT_MS) {
    const data = await openstackFetch(`${computeEndpoint}/servers/${encodeURIComponent(serverId)}`, {
      method: "GET",
      token,
    });
    const server = data?.server || null;
    const status = String(server?.status || "").trim().toUpperCase();
    if (normalizedTargets.includes(status)) {
      return server;
    }
    if (["ERROR", "RESIZE_ERROR"].includes(status)) {
      throw new Error(`Server ${serverId} reached failure status ${status}.`);
    }
    await sleep(HEAT_POLL_INTERVAL_MS);
  }
  throw new Error(`Server ${serverId} did not reach status ${normalizedTargets.join(" or ")}.`);
}

async function waitForServerDeleted({ computeEndpoint, token, serverId }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < HEAT_POLL_TIMEOUT_MS) {
    try {
      await openstackFetch(`${computeEndpoint}/servers/${encodeURIComponent(serverId)}`, {
        method: "GET",
        token,
      });
    } catch (error) {
      if (isOpenstackNotFoundError(error)) {
        return true;
      }
      throw error;
    }
    await sleep(HEAT_POLL_INTERVAL_MS);
  }
  throw new Error(`Server ${serverId} was not deleted before timeout.`);
}

function isOpenstackUuidValue(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function buildQuotaMetrics(metrics) {
  return Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => {
      const used = Number(value?.used || 0);
      const limit = Number(value?.limit || 0);
      const remaining = limit > 0 ? Math.max(limit - used, 0) : null;
      const percent = limit > 0 ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : 0;
      return [key, {
        used,
        limit,
        remaining,
        percent,
        unit: value?.unit || "",
      }];
    }),
  );
}

async function probeVolumeQuotaMetrics({ volumeEndpoint, token }) {
  const data = await openstackFetch(`${volumeEndpoint}/limits`, {
    method: "GET",
    token,
  });
  const absolute = data?.limits?.absolute || {};
  return {
    volumes: {
      used: absolute.totalVolumesUsed,
      limit: absolute.maxTotalVolumes,
    },
    volumeStorage: {
      used: absolute.totalGigabytesUsed,
      limit: absolute.maxTotalVolumeGigabytes,
      unit: "GB",
    },
    volumeSnapshots: {
      used: absolute.totalSnapshotsUsed,
      limit: absolute.maxTotalSnapshots,
    },
  };
}

async function probeNetworkQuotaMetrics({ networkEndpoint, token, projectId }) {
  const quota = await openstackFetch(`${networkEndpoint}/v2.0/quotas/${encodeURIComponent(projectId)}/details`, {
    method: "GET",
    token,
  });
  const source = quota?.quota || quota?.quotas || {};
  return Object.fromEntries(
    [
      ["networks", "network"],
      ["subnets", "subnet"],
      ["routers", "router"],
      ["floatingIps", "floatingip"],
      ["ports", "port"],
      ["securityGroups", "security_group"],
      ["securityGroupRules", "security_group_rule"],
    ].map(([metricKey, quotaKey]) => {
      const item = source?.[quotaKey] || {};
      return [metricKey, {
        used: item.used,
        limit: item.limit,
      }];
    }).filter(([, value]) => value.used != null || value.limit != null),
  );
}

function resolveOpenstackInterface(interfaceName = "") {
  const explicitInterface = String(OPENSTACK_INTERFACE || "").trim();
  if (explicitInterface) return explicitInterface;

  const normalized = String(interfaceName || "").trim();
  if (OPENSTACK_PREFER_INTERNAL_ENDPOINTS && (!normalized || normalized === "public")) {
    return "internal";
  }
  return normalized || (OPENSTACK_PREFER_INTERNAL_ENDPOINTS ? "internal" : "public");
}

function rewriteOpenstackEndpointToInternal(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed || !OPENSTACK_PREFER_INTERNAL_ENDPOINTS || !OPENSTACK_INTERNAL_ENDPOINT_HOST || !OPENSTACK_PUBLIC_ENDPOINT_HOSTS.size) {
    return trimmed;
  }

  const match = trimmed.match(/^(https?:\/\/)([^/?#]+)(.*)$/i);
  if (!match) return trimmed;

  try {
    const parsedHost = new URL(`${match[1]}${match[2]}`);
    if (!OPENSTACK_PUBLIC_ENDPOINT_HOSTS.has(parsedHost.hostname.toLowerCase())) return trimmed;
    const nextAuthority = parsedHost.port
      ? `${OPENSTACK_INTERNAL_ENDPOINT_HOST}:${parsedHost.port}`
      : OPENSTACK_INTERNAL_ENDPOINT_HOST;
    return `${match[1]}${nextAuthority}${match[3]}`;
  } catch {
    return trimmed;
  }
}

function normalizeEndpoint(url) {
  const normalizedScheme = String(url || "")
    .trim()
    .replace(/^(https?):\/\/(?:https?:\/\/)+/i, "$1://");
  return rewriteOpenstackEndpointToInternal(normalizedScheme.replace(/\/+$/, "")).replace(/\/+$/, "");
}

function applyProjectIdToEndpoint(url, projectId = "") {
  const normalized = normalizeEndpoint(url);
  const encodedProjectId = encodeURIComponent(String(projectId || "").trim());
  if (!normalized || !encodedProjectId) return normalized;
  return normalized
    .replace(/\{(?:project_id|tenant_id)\}/gi, encodedProjectId)
    .replace(/\$\((?:project_id|tenant_id)\)s/gi, encodedProjectId)
    .replace(/%\((?:project_id|tenant_id)\)s/gi, encodedProjectId);
}

function ensureV3AuthUrl(authUrl) {
  const trimmed = normalizeEndpoint(authUrl);
  return trimmed.endsWith("/v3") ? trimmed : `${trimmed}/v3`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function debug(message, payload) {
  if (!OPENSTACK_DEBUG) return;
  console.log(`[openstack] ${message}`, payload);
}

export { getOpenstackProjectSnapshot, probeOpenstackQuota, listFlavorDetails, ensureSelfServiceOpenstackProject, cleanupSelfServiceOpenstackProject, createOpenstackServerDirect, deleteOpenstackServer, startOpenstackServer, stopOpenstackServer, rebootOpenstackServer, createOpenstackRemoteConsole, createOpenstackVolume, deleteOpenstackVolume, attachOpenstackVolume, detachOpenstackVolume, createOpenstackNetwork, deleteOpenstackNetwork, createOpenstackSubnet, deleteOpenstackSubnet, createOpenstackRouter, deleteOpenstackRouter, connectOpenstackRouterSubnet, disconnectOpenstackRouterSubnet, allocateOpenstackFloatingIp, updateOpenstackFloatingIpPort, releaseOpenstackFloatingIp, createOpenstackSecurityGroup, deleteOpenstackSecurityGroup, createOpenstackSecurityGroupRule, deleteOpenstackSecurityGroupRule, attachOpenstackServerNetwork, detachOpenstackServerNetwork, addOpenstackServerSecurityGroup, removeOpenstackServerSecurityGroup, createOpenstackLoadBalancer, deleteOpenstackLoadBalancer, createOpenstackLoadBalancerListener, deleteOpenstackLoadBalancerListener, createOpenstackLoadBalancerPool, deleteOpenstackLoadBalancerPool, createOpenstackLoadBalancerMember, deleteOpenstackLoadBalancerMember, createOpenstackLoadBalancerHealthMonitor, deleteOpenstackLoadBalancerHealthMonitor, createOpenstackAlarm, deleteOpenstackAlarm, createOpenstackReservation, deleteOpenstackReservation, createOpenstackShare, deleteOpenstackShare, uploadOpenstackIso, completeOpenstackIsoInstall, ensureCloudConsoleSshSecurityGroup, getProjectResourceContext, openstackFetch, loadCloudConfig, authenticate, findCatalogEndpoint };
