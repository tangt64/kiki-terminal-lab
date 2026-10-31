import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { fetchOpenstack, registerOpenstackCloudCaPaths } from "./openstack-fetch.js";

const OPENSTACK_CLOUDS_YAML = process.env.OPENSTACK_CLOUDS_YAML || path.join(process.cwd(), "clouds.yaml");
const OPENSTACK_CLOUD_NAME = process.env.OPENSTACK_CLOUD_NAME || "openstack";
const OPENSTACK_INTERFACE = process.env.OPENSTACK_INTERFACE || "";
const OPENSTACK_REGION = process.env.OPENSTACK_REGION || "";
const TROVE_API_TIMEOUT_MS = Number(process.env.TROVE_API_TIMEOUT_MS || 15000);
const openstackApiCloudTarget = {
  cloudsYamlPath: process.env.OPENSTACK_SERVICE_CLOUDS_YAML || OPENSTACK_CLOUDS_YAML,
  cloudName: process.env.OPENSTACK_SERVICE_CLOUD_NAME || OPENSTACK_CLOUD_NAME,
  authUrl: "",
};

export function configureTroveOpenstackCloud(settings = {}) {
  openstackApiCloudTarget.cloudsYamlPath = String(settings.serviceCloudsYaml || process.env.OPENSTACK_SERVICE_CLOUDS_YAML || OPENSTACK_CLOUDS_YAML).trim() || OPENSTACK_CLOUDS_YAML;
  openstackApiCloudTarget.cloudName = String(settings.serviceCloudName || process.env.OPENSTACK_SERVICE_CLOUD_NAME || OPENSTACK_CLOUD_NAME).trim() || OPENSTACK_CLOUD_NAME;
  openstackApiCloudTarget.authUrl = String(settings.serviceAuthUrl || "").trim();
}

function normalizeBaseUrl(apiUrl) {
  const value = String(apiUrl || "").trim();
  return value ? value.replace(/\/+$/, "") : "";
}

function applyProjectIdToTroveUrl(apiUrl, projectId = "") {
  const normalized = normalizeBaseUrl(apiUrl);
  const encodedProjectId = encodeURIComponent(String(projectId || "").trim());
  if (!normalized || !encodedProjectId) return normalized;

  const withPlaceholders = normalized
    .replace(/\{(?:project_id|tenant_id)\}/gi, encodedProjectId)
    .replace(/\$\((?:project_id|tenant_id)\)s/gi, encodedProjectId)
    .replace(/%\((?:project_id|tenant_id)\)s/gi, encodedProjectId);

  return /\/v1(?:\.0)?$/i.test(withPlaceholders)
    ? `${withPlaceholders}/${encodedProjectId}`
    : withPlaceholders;
}

function ensureV3AuthUrl(authUrl) {
  const value = String(authUrl || "").replace(/\/+$/, "");
  return /\/v3$/i.test(value) ? value : `${value}/v3`;
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
  if (payload?.badRequest?.message) return payload.badRequest.message;
  if (payload?.faultstring) return payload.faultstring;
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

export async function loadCloudConfig() {
  let raw;
  try {
    raw = await fs.readFile(openstackApiCloudTarget.cloudsYamlPath, "utf8");
  } catch {
    throw new Error(`Unable to read clouds.yaml: ${openstackApiCloudTarget.cloudsYamlPath}`);
  }

  const parsed = YAML.parse(raw) || {};
  const cloud = parsed?.clouds?.[openstackApiCloudTarget.cloudName];
  if (!cloud) throw new Error(`Cloud "${openstackApiCloudTarget.cloudName}" was not found in clouds.yaml.`);
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

export async function authenticate(cloud, { projectName = "", timeoutMs = TROVE_API_TIMEOUT_MS } = {}) {
  const authUrl = ensureV3AuthUrl(cloud.auth.auth_url);
  const resolvedProjectName = String(projectName || "").trim();
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
    headers: { Accept: "application/json", "Content-Type": "application/json" },
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
        scope: { project: scopeProject },
      },
    }),
  }, timeoutMs);

  const { json: payload, text } = await readBodySafely(response);
  if (!response.ok) {
    throw buildOpenstackServiceError("Keystone authentication failed", response, payload, text);
  }
  const token = response.headers.get("x-subject-token");
  if (!token) throw new Error("Keystone response did not include X-Subject-Token.");
  return {
    token,
    catalog: payload?.token?.catalog || [],
    projectId: payload?.token?.project?.id || cloud.auth.project_id || "",
    regionName: cloud.region_name,
    interfaceName: cloud.interface,
  };
}

export function findCatalogEndpoint(catalog, { type, region, interfaceName }) {
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

function resolveTroveBaseUrl(apiUrl, auth) {
  const configuredUrl = normalizeBaseUrl(apiUrl);
  const catalogUrl = configuredUrl ? "" : findCatalogEndpoint(auth.catalog, {
    type: "database",
    region: auth.regionName,
    interfaceName: auth.interfaceName,
  });
  return applyProjectIdToTroveUrl(configuredUrl || catalogUrl, auth.projectId);
}

export async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    return await fetchOpenstack(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Trove API 응답 시간이 초과되었습니다.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestTrove(apiUrl, pathname, options = {}) {
  const cloud = await loadCloudConfig();
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || TROVE_API_TIMEOUT_MS) || TROVE_API_TIMEOUT_MS);
  const auth = await authenticate(cloud, { projectName: options.projectName, timeoutMs });
  const resolvedBaseUrl = resolveTroveBaseUrl(apiUrl, auth);
  if (!resolvedBaseUrl) {
    throw new Error("Trove API URL이 설정되지 않았고 서비스 카탈로그에서도 찾지 못했습니다.");
  }
  if (typeof options.onResolvedEndpoint === "function") {
    options.onResolvedEndpoint(resolvedBaseUrl);
  }
  const response = await fetchWithTimeout(`${resolvedBaseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Token": auth.token,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  }, timeoutMs);
  const { json: payload, text } = await readBodySafely(response);
  if (!response.ok) {
    throw buildOpenstackServiceError("Trove API 요청에 실패했습니다.", response, payload, text);
  }
  return payload;
}

function normalizeInstance(item) {
  return {
    instanceUuid: item.id || item.uuid || "",
    name: item.name || "",
    status: item.status || item.state || "",
    hostname: item.hostname || "",
    datastoreType: item.datastore?.type || item.datastore?.type_name || "",
    datastoreVersion: item.datastore?.version || item.datastore?.version_name || "",
    flavor: item.flavor?.id || item.flavor?.name || item.flavorRef || "",
    sizeGb: Number(item.volume?.size || item.volume_size || 0) || null,
  };
}

export async function createTroveInstance({
  apiUrl,
  name,
  datastoreType,
  datastoreVersion = "",
  flavor,
  sizeGb = 1,
  projectName = "",
  databaseName = "",
  databaseUsername = "",
  databasePassword = "",
  nics = [],
}) {
  const instance = {
    name,
    flavorRef: flavor,
    volume: { size: Math.max(1, Number(sizeGb || 1) || 1) },
    datastore: { type: datastoreType },
  };
  if (String(datastoreVersion || "").trim()) instance.datastore.version = String(datastoreVersion || "").trim();
  if (String(databaseName || "").trim()) {
    const dbName = String(databaseName).trim();
    instance.databases = [{ name: dbName }];
    if (String(databaseUsername || "").trim() && databasePassword) {
      instance.users = [{
        name: String(databaseUsername).trim(),
        password: String(databasePassword),
        databases: [{ name: dbName }],
      }];
    }
  }
  if (Array.isArray(nics) && nics.length) instance.nics = nics;
  const payload = await requestTrove(apiUrl, "/instances", {
    method: "POST",
    projectName,
    body: { instance },
  });
  return normalizeInstance(payload?.instance || payload || {});
}

export async function fetchTroveInstance({ apiUrl, instanceUuid, projectName = "" }) {
  const payload = await requestTrove(apiUrl, `/instances/${encodeURIComponent(instanceUuid)}`, { projectName });
  return normalizeInstance(payload?.instance || payload || {});
}

export async function deleteTroveInstance({ apiUrl, instanceUuid, projectName = "" }) {
  await requestTrove(apiUrl, `/instances/${encodeURIComponent(instanceUuid)}`, { method: "DELETE", projectName });
}

export async function listTroveDatastores({ apiUrl, projectName = "", timeoutMs = TROVE_API_TIMEOUT_MS, onResolvedEndpoint }) {
  const payload = await requestTrove(apiUrl, "/datastores", { projectName, timeoutMs, onResolvedEndpoint });
  const datastores = Array.isArray(payload?.datastores) ? payload.datastores : [];
  return datastores.map((item) => ({
    id: item.id || item.name || "",
    name: item.name || item.id || "",
  })).filter((item) => item.name);
}

export async function probeTroveApi({ apiUrl, projectName = "", timeoutMs = TROVE_API_TIMEOUT_MS }) {
  const startedAt = Date.now();
  let endpoint = "";
  const onResolvedEndpoint = (value) => {
    if (!endpoint && value) endpoint = value;
  };
  let instancesPayload;
  let datastores;
  try {
    [instancesPayload, datastores] = await Promise.all([
      requestTrove(apiUrl, "/instances?limit=1", { projectName, timeoutMs, onResolvedEndpoint }),
      listTroveDatastores({ apiUrl, projectName, timeoutMs, onResolvedEndpoint }).catch(() => []),
    ]);
  } catch (error) {
    error.endpoint = error.endpoint || endpoint;
    throw error;
  }
  const instances = Array.isArray(instancesPayload?.instances) ? instancesPayload.instances : [];
  return {
    ok: true,
    endpoint,
    latencyMs: Date.now() - startedAt,
    sampleCount: instances.length,
    datastoreCount: datastores.length,
  };
}
