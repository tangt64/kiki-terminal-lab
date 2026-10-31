import { authenticate, fetchWithTimeout, findCatalogEndpoint, loadCloudConfig } from "./trove.js";

const DESIGNATE_TIMEOUT_MS = Number(process.env.DESIGNATE_API_TIMEOUT_MS || 15000);

function normalizeUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function designateBaseUrl(auth) {
  const endpoint = findCatalogEndpoint(auth.catalog, {
    type: "dns",
    region: auth.regionName,
    interfaceName: auth.interfaceName,
  });
  if (!endpoint) throw new Error("Designate DNS API endpoint를 서비스 카탈로그에서 찾지 못했습니다.");
  const normalized = normalizeUrl(endpoint);
  return /\/v2$/i.test(normalized) ? normalized : `${normalized}/v2`;
}

async function requestDesignate(pathname, { projectName = "", method = "GET", body } = {}) {
  const cloud = await loadCloudConfig();
  const auth = await authenticate(cloud, { projectName, timeoutMs: DESIGNATE_TIMEOUT_MS });
  const response = await fetchWithTimeout(`${designateBaseUrl(auth)}${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Token": auth.token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, DESIGNATE_TIMEOUT_MS);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    const detail = payload?.message || payload?.error?.message || text || response.statusText;
    const error = new Error(`Designate API 요청에 실패했습니다. (${response.status}): ${detail}`);
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

export async function listDesignateZones({ projectName = "" } = {}) {
  const data = await requestDesignate("/zones?limit=1000", { projectName });
  const zones = Array.isArray(data?.zones) ? data.zones : [];
  const recordsets = [];
  await Promise.all(zones.map(async (zone) => {
    const result = await requestDesignate(`/zones/${encodeURIComponent(zone.id)}/recordsets?limit=1000`, { projectName });
    for (const recordset of result?.recordsets || []) recordsets.push({ ...recordset, zone_id: zone.id, zone_name: zone.name });
  }));
  return { zones, recordsets };
}

export function normalizeInternalZoneName(value = "") {
  const base = "apps.example.com";
  let name = String(value || "").trim().toLowerCase().replace(/\.+$/, "");
  if (name && !name.includes(".")) name = `${name}.${base}`;
  if (!name || name === base || !name.endsWith(`.${base}`) || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(name)) {
    const error = new Error(`도메인은 <이름>.${base} 형식으로 입력해 주세요.`);
    error.statusCode = 400;
    throw error;
  }
  return `${name}.`;
}

export function normalizeRecordsetName(value = "", zoneName = "") {
  const zone = String(zoneName || "").trim().toLowerCase().replace(/\.+$/, "");
  let name = String(value || "").trim().toLowerCase().replace(/\.+$/, "");
  if (name && !name.includes(".")) name = `${name}.${zone}`;
  if (!name || !zone || (name !== zone && !name.endsWith(`.${zone}`))) {
    const error = new Error("레코드 이름은 선택한 존에 속해야 합니다.");
    error.statusCode = 400;
    throw error;
  }
  return `${name}.`;
}

export async function createDesignateZone({ projectName = "", name = "", email = "admin@example.com", ttl = 300 } = {}) {
  return requestDesignate("/zones", {
    projectName,
    method: "POST",
    body: { name: normalizeInternalZoneName(name), email: String(email || "admin@example.com").trim(), type: "PRIMARY", ttl: Math.max(60, Number(ttl || 300) || 300) },
  });
}

export async function deleteDesignateZone({ projectName = "", zoneId = "" } = {}) {
  return requestDesignate(`/zones/${encodeURIComponent(zoneId)}`, { projectName, method: "DELETE" });
}

export async function createDesignateRecordset({ projectName = "", zoneId = "", zoneName = "", name = "", type = "A", records = [], ttl = 300 } = {}) {
  const normalizedType = String(type || "A").trim().toUpperCase();
  if (!["A", "AAAA", "CNAME", "TXT"].includes(normalizedType)) {
    const error = new Error("지원하는 레코드 형식은 A, AAAA, CNAME, TXT입니다.");
    error.statusCode = 400;
    throw error;
  }
  let values = (Array.isArray(records) ? records : [records]).map((item) => String(item || "").trim()).filter(Boolean);
  if (!values.length) { const error = new Error("레코드 값을 입력해 주세요."); error.statusCode = 400; throw error; }
  if (normalizedType === "TXT") values = values.map((value) => value.startsWith('"') && value.endsWith('"') ? value : JSON.stringify(value));
  if (normalizedType === "CNAME") values = values.map((value) => `${value.replace(/\.+$/, "")}.`);
  return requestDesignate(`/zones/${encodeURIComponent(zoneId)}/recordsets`, {
    projectName,
    method: "POST",
    body: { name: normalizeRecordsetName(name, zoneName), type: normalizedType, records: values, ttl: Math.max(60, Number(ttl || 300) || 300) },
  });
}

export async function deleteDesignateRecordset({ projectName = "", zoneId = "", recordsetId = "" } = {}) {
  return requestDesignate(`/zones/${encodeURIComponent(zoneId)}/recordsets/${encodeURIComponent(recordsetId)}`, { projectName, method: "DELETE" });
}
