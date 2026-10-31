import { fetchOpenstack } from "./openstack-fetch.js";
import { authenticate, fetchWithTimeout, findCatalogEndpoint, loadCloudConfig } from "./trove.js";

const BARBICAN_TIMEOUT_MS = Number(process.env.BARBICAN_API_TIMEOUT_MS || 15000);

function baseUrl(auth) {
  const endpoint = findCatalogEndpoint(auth.catalog, {
    type: "key-manager",
    region: auth.regionName,
    interfaceName: "internal",
  }) || findCatalogEndpoint(auth.catalog, {
    type: "key-manager",
    region: auth.regionName,
    interfaceName: auth.interfaceName,
  });
  if (!endpoint) throw new Error("Barbican key-manager endpoint를 찾지 못했습니다.");
  return endpoint.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function secretUrl(auth, secretRef, suffix = "") {
  const match = String(secretRef || "").match(/\/secrets\/([^/?#]+)/);
  if (!match) throw new Error("올바르지 않은 Barbican secret 참조입니다.");
  return `${baseUrl(auth)}/v1/secrets/${encodeURIComponent(match[1])}${suffix}`;
}

async function responseError(response) {
  const text = await response.text();
  let detail = text;
  try { detail = JSON.parse(text)?.description || JSON.parse(text)?.message || text; } catch {}
  const error = new Error(`Barbican 요청 실패 (${response.status}): ${detail || response.statusText}`);
  error.status = response.status;
  throw error;
}

export async function createDatabaseCredentialSecret({ projectName, instanceName, payload }) {
  const cloud = await loadCloudConfig();
  const auth = await authenticate(cloud, { projectName, timeoutMs: BARBICAN_TIMEOUT_MS });
  const response = await fetchWithTimeout(`${baseUrl(auth)}/v1/secrets`, {
    method: "POST",
    headers: { "X-Auth-Token": auth.token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      name: `trove/${instanceName}/database-credential`,
      payload: JSON.stringify(payload),
      payload_content_type: "text/plain;charset=utf-8",
      secret_type: "opaque",
    }),
  }, BARBICAN_TIMEOUT_MS);
  if (!response.ok) return responseError(response);
  const result = await response.json();
  return String(result.secret_ref || "");
}

export async function readDatabaseCredentialSecret({ projectName, secretRef }) {
  const cloud = await loadCloudConfig();
  const auth = await authenticate(cloud, { projectName, timeoutMs: BARBICAN_TIMEOUT_MS });
  const url = secretUrl(auth, secretRef, "/payload");
  const response = await fetchWithTimeout(url, {
    headers: { "X-Auth-Token": auth.token, Accept: "application/octet-stream" },
  }, BARBICAN_TIMEOUT_MS);
  if (!response.ok) return responseError(response);
  return JSON.parse(await response.text());
}

export async function deleteDatabaseCredentialSecret({ projectName, secretRef }) {
  if (!secretRef) return;
  const cloud = await loadCloudConfig();
  const auth = await authenticate(cloud, { projectName, timeoutMs: BARBICAN_TIMEOUT_MS });
  const response = await fetchOpenstack(secretUrl(auth, secretRef), {
    method: "DELETE",
    headers: { "X-Auth-Token": auth.token },
  });
  if (!response.ok && response.status !== 404) return responseError(response);
}
