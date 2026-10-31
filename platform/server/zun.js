import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { fetchOpenstack, registerOpenstackCloudCaPaths } from "./openstack-fetch.js";

const OPENSTACK_CLOUDS_YAML = process.env.OPENSTACK_CLOUDS_YAML || path.join(process.cwd(), "clouds.yaml");
const OPENSTACK_CLOUD_NAME = process.env.OPENSTACK_CLOUD_NAME || "openstack";
const OPENSTACK_INTERFACE = process.env.OPENSTACK_INTERFACE || "";
const OPENSTACK_REGION = process.env.OPENSTACK_REGION || "";
const ZUN_API_TIMEOUT_MS = Number(process.env.ZUN_API_TIMEOUT_MS || 15000);
const ZUN_API_MICROVERSION = String(process.env.ZUN_API_MICROVERSION || "1.31").trim() || "1.31";
const ZUN_REGISTRY_ID = String(process.env.ZUN_REGISTRY_ID || "").trim();
const ZUN_WEBSOCKET_INTERNAL_BASE_URL = String(process.env.ZUN_WEBSOCKET_INTERNAL_BASE_URL || "").trim();
const ZUN_AUTH_CACHE_SKEW_MS = Math.max(30_000, Number(process.env.ZUN_AUTH_CACHE_SKEW_MS || 60_000) || 60_000);
const ZUN_AUTH_CACHE_FALLBACK_TTL_MS = Math.max(60_000, Number(process.env.ZUN_AUTH_CACHE_FALLBACK_TTL_MS || 5 * 60_000) || 5 * 60_000);
const openstackApiCloudTarget = {
  cloudsYamlPath: process.env.OPENSTACK_SERVICE_CLOUDS_YAML || OPENSTACK_CLOUDS_YAML,
  cloudName: process.env.OPENSTACK_SERVICE_CLOUD_NAME || OPENSTACK_CLOUD_NAME,
  authUrl: "",
};
const authenticationCache = new Map();

export function configureZunOpenstackCloud(settings = {}) {
  const previousTarget = JSON.stringify(openstackApiCloudTarget);
  openstackApiCloudTarget.cloudsYamlPath = String(settings.serviceCloudsYaml || process.env.OPENSTACK_SERVICE_CLOUDS_YAML || OPENSTACK_CLOUDS_YAML).trim() || OPENSTACK_CLOUDS_YAML;
  openstackApiCloudTarget.cloudName = String(settings.serviceCloudName || process.env.OPENSTACK_SERVICE_CLOUD_NAME || OPENSTACK_CLOUD_NAME).trim() || OPENSTACK_CLOUD_NAME;
  openstackApiCloudTarget.authUrl = String(settings.serviceAuthUrl || "").trim();
  if (JSON.stringify(openstackApiCloudTarget) !== previousTarget) authenticationCache.clear();
}

function normalizeBaseUrl(apiUrl) {
  const value = String(apiUrl || "").trim();
  return value ? value.replace(/\/+$/, "") : "";
}

async function readBodySafely(response) {
  const raw = await response.text();
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      return { json: JSON.parse(raw), text: raw };
    } catch {
      return { json: null, text: raw };
    }
  }

  return { json: null, text: raw };
}

function normalizeErrorDetail(payload, text, statusText) {
  if (payload?.error?.message) return payload.error.message;
  if (payload?.message) return payload.message;
  if (payload?.faultstring) return payload.faultstring;
  if (payload?.error_message) return payload.error_message;
  if (text) return text;
  return statusText;
}

function buildOpenstackServiceError(label, response, payload, text) {
  const detail = normalizeErrorDetail(payload, text, response.statusText);
  const error = new Error(`${label} (${response.status}): ${detail}`);
  error.status = response.status;
  error.statusCode = response.status;
  error.statusText = response.statusText;
  error.body = text;
  error.payload = payload;
  error.url = response.url || "";
  error.endpoint = response.url || "";
  return error;
}

function splitZunCommand(commandText) {
  const value = String(commandText || "").trim();
  if (!value) return null;
  const tokens = value.match(/"[^"]*"|'[^']*'|[^\s]+/g) || [];
  const normalized = tokens
    .map((token) => token.replace(/^['"]|['"]$/g, "").trim())
    .filter(Boolean);
  return normalized.length ? normalized : null;
}

async function requestZun(apiUrl, pathname, options = {}) {
  const cloud = await loadCloudConfig();
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || ZUN_API_TIMEOUT_MS) || ZUN_API_TIMEOUT_MS);
  let auth = await authenticate(cloud, { projectName: options.projectName, timeoutMs });
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const resolvedBaseUrl = normalizeBaseUrl(apiUrl) || findCatalogEndpoint(auth.catalog, {
      type: "container",
      region: auth.regionName,
      interfaceName: auth.interfaceName,
    });

    if (!resolvedBaseUrl) {
      throw new Error("Zun API URL이 설정되지 않았고 서비스 카탈로그에서도 찾지 못했습니다.");
    }

    response = await fetchWithTimeout(`${resolvedBaseUrl}${pathname}`, {
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Auth-Token": auth.token,
        "OpenStack-API-Version": `container ${options.microversion || ZUN_API_MICROVERSION}`,
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    }, timeoutMs);
    if (response.status !== 401 || attempt > 0) break;
    auth = await authenticate(cloud, { projectName: options.projectName, timeoutMs, forceRefresh: true });
  }

  const { json: payload, text } = await readBodySafely(response);
  if (!response.ok) {
    throw buildOpenstackServiceError("Zun API 요청에 실패했습니다.", response, payload, text);
  }

  return payload;
}

export async function createZunRemoteContainer({
  apiUrl,
  name,
  image,
  commandText = "",
  exposedPort = null,
  requireExposedPort = false,
  network = "net-infra",
  securityGroup = "default",
  projectName = "",
  registryId = ZUN_REGISTRY_ID,
  runtime = "",
  hints = null,
}) {
  const body = {
    name,
    image,
    interactive: true,
    tty: true,
  };

  if (String(registryId || "").trim()) {
    body.registry_id = String(registryId).trim();
  }

  if (String(runtime || "").trim()) {
    body.runtime = String(runtime).trim();
  }
  if (hints && typeof hints === "object" && !Array.isArray(hints) && Object.keys(hints).length) {
    body.hints = hints;
  }

  if (network) {
    body.nets = [{ network }];
  }

  if (securityGroup) {
    body.security_groups = [securityGroup];
  }

  const normalizedCommand = splitZunCommand(commandText);
  if (normalizedCommand) {
    body.command = normalizedCommand;
  }

  if (exposedPort != null && Number(exposedPort) > 0) {
    body.exposed_ports = {
      [String(Math.max(1, Number(exposedPort) || 1))]: {},
    };
  }

  try {
    const payload = await requestZun(apiUrl, "/containers", { method: "POST", body, projectName });
    return {
      ...normalizeZunResponse(payload),
      exposedPortsApplied: Boolean(body.exposed_ports),
      securityGroupsApplied: Boolean(body.security_groups?.length),
    };
  } catch (error) {
    const rawMessage = String(error?.message || "");
    const securityGroupConflict = Boolean(body.exposed_ports && body.security_groups?.length)
      && /schema-validation-error|should not be valid under \{'required': \['security_groups', 'exposed_ports'\]\}/i.test(rawMessage);
    const securityGroupUnavailable = Boolean(body.security_groups?.length)
      && /security group[^\n]*not found|container\.invalid-value[^\n]*security group/i.test(rawMessage);
    if (securityGroupConflict || securityGroupUnavailable) {
      const fallbackBody = { ...body };
      delete fallbackBody.security_groups;
      try {
        const payload = await requestZun(apiUrl, "/containers", { method: "POST", body: fallbackBody, projectName });
        return {
          ...normalizeZunResponse(payload),
          exposedPortsApplied: Boolean(fallbackBody.exposed_ports),
          securityGroupsApplied: false,
        };
      } catch (fallbackError) {
        const fallbackMessage = String(fallbackError?.message || "");
        const exposedPortsUnsupportedAfterSecurityGroupFallback = fallbackBody.exposed_ports
          && /invalid-param-in-version|exposed_ports is only supported from version/i.test(fallbackMessage);
        if (!exposedPortsUnsupportedAfterSecurityGroupFallback) throw fallbackError;
        if (requireExposedPort) {
          throw new Error("현재 Zun API 버전에서는 컨테이너 포트 publish가 지원되지 않습니다. SSH 접속이 필요한 과정은 Zun API 마이크로버전을 1.24 이상으로 올리거나, 콘솔 전용 과정으로 바꿔 주세요.");
        }
        delete fallbackBody.exposed_ports;
        const payload = await requestZun(apiUrl, "/containers", { method: "POST", body: fallbackBody, projectName });
        return {
          ...normalizeZunResponse(payload),
          exposedPortsApplied: false,
          securityGroupsApplied: false,
        };
      }
    }
    const exposedPortsUnsupported = body.exposed_ports
      && /invalid-param-in-version|exposed_ports is only supported from version/i.test(rawMessage);
    if (!exposedPortsUnsupported) {
      throw error;
    }
    if (requireExposedPort) {
      throw new Error("현재 Zun API 버전에서는 컨테이너 포트 publish가 지원되지 않습니다. SSH 접속이 필요한 과정은 Zun API 마이크로버전을 1.24 이상으로 올리거나, 콘솔 전용 과정으로 바꿔 주세요.");
    }
    const fallbackBody = { ...body };
    delete fallbackBody.exposed_ports;
    const payload = await requestZun(apiUrl, "/containers", { method: "POST", body: fallbackBody, projectName });
    return {
      ...normalizeZunResponse(payload),
      exposedPortsApplied: false,
      securityGroupsApplied: Boolean(fallbackBody.security_groups?.length),
    };
  }
}

function normalizeRegistryResponse(payload) {
  const value = payload?.registry || payload || {};
  return {
    registryId: String(value.uuid || value.id || "").trim(),
    name: String(value.name || "").trim(),
    domain: String(value.domain || "").trim(),
  };
}

export async function createZunRegistry({
  apiUrl,
  projectName = "",
  name,
  domain,
  username,
  password,
}) {
  const payload = await requestZun(apiUrl, "/registries", {
    method: "POST",
    projectName,
    body: {
      name: String(name || "").trim(),
      domain: String(domain || "").trim(),
      username: String(username || "").trim(),
      password: String(password || ""),
    },
  });
  const registry = normalizeRegistryResponse(payload);
  if (!registry.registryId) {
    throw new Error("Zun Registry 생성 응답에서 ID를 확인하지 못했습니다.");
  }
  return registry;
}

export async function deleteZunRegistry({ apiUrl, projectName = "", registryId }) {
  const normalizedId = String(registryId || "").trim();
  if (!normalizedId) return;
  try {
    await requestZun(apiUrl, `/registries/${encodeURIComponent(normalizedId)}`, {
      method: "DELETE",
      projectName,
    });
  } catch (error) {
    if (/not found|404/i.test(String(error?.message || ""))) return;
    throw error;
  }
}

export async function startZunRemoteContainer({ apiUrl, containerUuid, projectName = "" }) {
  const payload = await requestZun(apiUrl, `/containers/${encodeURIComponent(containerUuid)}/start`, { method: "POST", projectName });
  return normalizeZunResponse(payload);
}

export async function stopZunRemoteContainer({ apiUrl, containerUuid, projectName = "" }) {
  const payload = await requestZun(apiUrl, `/containers/${encodeURIComponent(containerUuid)}/stop`, { method: "POST", projectName });
  return normalizeZunResponse(payload);
}

export async function deleteZunRemoteContainer({ apiUrl, containerUuid, projectName = "" }) {
  try {
    await requestZun(apiUrl, `/containers/${encodeURIComponent(containerUuid)}?stop=true`, { method: "DELETE", projectName });
  } catch (error) {
    const message = String(error?.message || "");
    if (/not found|404/i.test(message)) return;
    if (/invalid-state|created state|stopped state|conflict|409/i.test(message)) {
      try {
        await requestZun(apiUrl, `/containers/${encodeURIComponent(containerUuid)}`, { method: "DELETE", projectName });
        return;
      } catch (fallbackError) {
        const fallbackMessage = String(fallbackError?.message || "");
        if (/not found|404/i.test(fallbackMessage)) return;
        throw fallbackError;
      }
    }
    throw error;
  }
}

export async function fetchZunRemoteContainer({ apiUrl, containerUuid, projectName = "" }) {
  const payload = await requestZun(apiUrl, `/containers/${encodeURIComponent(containerUuid)}`, { projectName });
  return normalizeZunResponse(payload);
}

export async function attachZunRemoteContainer({ apiUrl, containerUuid, projectName = "" }) {
  const payload = await requestZun(
    apiUrl,
    `/containers/${encodeURIComponent(containerUuid)}/attach?logs=0&stream=1&stdin=1&stdout=1&stderr=1`,
    { projectName },
  );
  return normalizeZunAttachResponse(payload);
}

export async function executeZunRemoteContainer({
  apiUrl,
  containerUuid,
  command = "/bin/bash",
  interactive = true,
  run = false,
  projectName = "",
}) {
  const params = new URLSearchParams();
  params.set("command", String(command || "").trim() || "/bin/bash");
  params.set("interactive", interactive ? "true" : "false");
  params.set("run", run ? "true" : "false");
  const payload = await requestZun(
    apiUrl,
    `/containers/${encodeURIComponent(containerUuid)}/execute?${params.toString()}`,
    { method: "POST", projectName },
  );
  return normalizeZunExecResponse(payload);
}

export async function resizeZunExec({
  apiUrl,
  containerUuid,
  execId,
  cols = 120,
  rows = 32,
  projectName = "",
}) {
  const params = new URLSearchParams();
  params.set("exec_id", String(execId || "").trim());
  params.set("w", String(Math.max(20, Number(cols || 120) || 120)));
  params.set("h", String(Math.max(10, Number(rows || 32) || 32)));
  const payload = await requestZun(
    apiUrl,
    `/containers/${encodeURIComponent(containerUuid)}/execute_resize?${params.toString()}`,
    { method: "POST", projectName },
  );
  return normalizeZunExecResponse(payload);
}

export async function resizeZunRemoteContainer({ apiUrl, containerUuid, cols = 120, rows = 32, projectName = "" }) {
  await requestZun(apiUrl, `/containers/${encodeURIComponent(containerUuid)}/resize`, {
    method: "POST",
    projectName,
    body: {
      w: Math.max(20, Number(cols || 120) || 120),
      h: Math.max(10, Number(rows || 32) || 32),
    },
  });
}

export async function probeZunApi({ apiUrl, projectName = "", timeoutMs = ZUN_API_TIMEOUT_MS }) {
  const startedAt = Date.now();
  const payload = await requestZun(apiUrl, "/containers?limit=1", { projectName, timeoutMs });
  return {
    ok: true,
    latencyMs: Date.now() - startedAt,
    sampleCount: Array.isArray(payload?.containers) ? payload.containers.length : 0,
  };
}

function normalizeZunResponse(payload) {
  const data = payload?.container ?? payload ?? {};
  return {
    containerUuid: data.uuid || data.id || data.container_uuid || "",
    name: data.name || "",
    image: data.image || "",
    status: data.status || data.state || "",
    addresses: normalizeAddresses(data.addresses || data.address || {}),
  };
}

function normalizeZunAttachResponse(payload) {
  if (typeof payload === "string") {
    return { websocketUrl: normalizeZunWebsocketUrl(payload) };
  }
  return {
    websocketUrl: normalizeZunWebsocketUrl(
      payload?.websocket_url
      || payload?.url
      || payload?.attach_url
      || payload?.ws_url
      || "",
    ).trim(),
  };
}

function normalizeZunExecResponse(payload) {
  if (typeof payload === "string") {
    return { execId: "", websocketUrl: normalizeZunWebsocketUrl(payload), rawUrl: String(payload || "").trim() };
  }
  return {
    execId: String(payload?.exec_id || payload?.id || "").trim(),
    websocketUrl: normalizeZunWebsocketUrl(payload?.proxy_url || payload?.websocket_url || payload?.ws_url || payload?.attach_url || payload?.url || ""),
    rawUrl: String(payload?.proxy_url || payload?.url || payload?.websocket_url || payload?.ws_url || payload?.attach_url || "").trim(),
    output: payload?.output ?? null,
    exitCode: payload?.exit_code ?? null,
  };
}

function normalizeZunWebsocketUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || !ZUN_WEBSOCKET_INTERNAL_BASE_URL) return raw;
  try {
    const source = new URL(raw);
    if (!["ws:", "wss:"].includes(source.protocol)) return raw;
    const target = new URL(ZUN_WEBSOCKET_INTERNAL_BASE_URL);
    if (!["ws:", "wss:", "http:", "https:"].includes(target.protocol)) return raw;
    target.protocol = target.protocol === "http:" ? "ws:" : target.protocol === "https:" ? "wss:" : target.protocol;
    target.pathname = source.pathname || target.pathname || "/";
    target.search = source.search;
    target.hash = "";
    return target.toString();
  } catch {
    return raw;
  }
}

function normalizeAddresses(addresses) {
  if (Array.isArray(addresses)) {
    return addresses
      .map((item) => ({
        network: item.network || item.net_name || "",
        address: item.addr || item.address || item.ip || "",
      }))
      .filter((item) => item.address);
  }

  if (addresses && typeof addresses === "object") {
    return Object.entries(addresses).flatMap(([networkName, items]) =>
      (Array.isArray(items) ? items : [items]).map((item) => ({
        network: networkName,
        address: item?.addr || item?.address || item?.ip || "",
      })),
    ).filter((item) => item.address);
  }

  return [];
}

async function loadCloudConfig() {
  let raw;
  try {
    raw = await fs.readFile(openstackApiCloudTarget.cloudsYamlPath, "utf8");
  } catch {
    throw new Error(`Unable to read clouds.yaml: ${openstackApiCloudTarget.cloudsYamlPath}`);
  }

  const parsed = YAML.parse(raw) || {};
  const cloud = parsed?.clouds?.[openstackApiCloudTarget.cloudName];
  if (!cloud) {
    throw new Error(`Cloud "${openstackApiCloudTarget.cloudName}" was not found in clouds.yaml.`);
  }

  const auth = cloud.auth || {};
  if (!auth.auth_url || !auth.username || !auth.password) {
    throw new Error("clouds.yaml is missing auth_url, username, or password.");
  }
  registerOpenstackCloudCaPaths({
    cloud,
    cloudsYamlPath: openstackApiCloudTarget.cloudsYamlPath,
    cloudName: openstackApiCloudTarget.cloudName,
  });

  return {
    ...cloud,
    auth: {
      ...cloud.auth,
      auth_url: openstackApiCloudTarget.authUrl || cloud.auth.auth_url,
    },
    interface: OPENSTACK_INTERFACE || cloud.interface || "public",
    region_name: OPENSTACK_REGION || cloud.region_name || "",
  };
}

function getAuthenticationCacheKey(cloud, projectName) {
  return JSON.stringify({
    authUrl: ensureV3AuthUrl(cloud.auth.auth_url),
    username: cloud.auth.username,
    userDomain: cloud.auth.user_domain_name || "Default",
    projectName: String(projectName || cloud.auth.project_name || "").trim(),
    projectId: projectName ? "" : String(cloud.auth.project_id || "").trim(),
    projectDomain: cloud.auth.project_domain_name || cloud.auth.user_domain_name || "Default",
    region: cloud.region_name || "",
    interfaceName: cloud.interface || "",
  });
}

export function clearZunAuthenticationCache() {
  authenticationCache.clear();
}

export function getZunAuthenticationCacheSize() {
  return authenticationCache.size;
}

async function authenticate(cloud, { projectName = "", timeoutMs = ZUN_API_TIMEOUT_MS, forceRefresh = false } = {}) {
  const authUrl = ensureV3AuthUrl(cloud.auth.auth_url);
  const resolvedProjectName = String(projectName || "").trim();
  const cacheKey = getAuthenticationCacheKey(cloud, resolvedProjectName);
  const cached = authenticationCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAtMs - ZUN_AUTH_CACHE_SKEW_MS > Date.now()) {
    return cached.value;
  }
  if (forceRefresh) authenticationCache.delete(cacheKey);
  const scopeProject = resolvedProjectName
    ? {
        name: resolvedProjectName,
        domain: { name: cloud.auth.project_domain_name || cloud.auth.user_domain_name || "Default" },
      }
    : cloud.auth.project_id
    ? { id: cloud.auth.project_id }
    : {
        name: cloud.auth.project_name,
        domain: { name: cloud.auth.project_domain_name || cloud.auth.user_domain_name || "Default" },
      };

  const response = await fetchWithTimeout(`${authUrl}/auth/tokens`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
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
        scope: {
          project: scopeProject,
        },
      },
    }),
  }, timeoutMs);

  const { json: payload, text } = await readBodySafely(response);
  if (!response.ok) {
    throw buildOpenstackServiceError("Keystone authentication failed", response, payload, text);
  }

  const token = response.headers.get("x-subject-token");
  if (!token) {
    throw new Error("Keystone response did not include X-Subject-Token.");
  }

  const value = {
    token,
    catalog: payload?.token?.catalog || [],
    regionName: cloud.region_name,
    interfaceName: cloud.interface,
  };
  const parsedExpiry = Date.parse(payload?.token?.expires_at || "");
  const expiresAtMs = Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + ZUN_AUTH_CACHE_FALLBACK_TTL_MS;
  authenticationCache.set(cacheKey, { value, expiresAtMs });
  return value;
}

function ensureV3AuthUrl(authUrl) {
  const value = String(authUrl || "").replace(/\/+$/, "");
  return /\/v3$/i.test(value) ? value : `${value}/v3`;
}

function findCatalogEndpoint(catalog, { type, region, interfaceName }) {
  const service = catalog.find((item) => item.type === type);
  if (!service) return "";

  const endpoints = Array.isArray(service.endpoints) ? service.endpoints : [];
  const matched = endpoints.find((endpoint) => {
    const regionOk = !region || endpoint.region === region || endpoint.region_id === region;
    const interfaceOk = !interfaceName || endpoint.interface === interfaceName;
    return regionOk && interfaceOk;
  }) || endpoints.find((endpoint) => !interfaceName || endpoint.interface === interfaceName) || endpoints[0];

  return normalizeBaseUrl(matched?.url || "");
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    return await fetchOpenstack(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Zun API 요청 시간이 ${timeoutMs}ms를 초과했습니다.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
