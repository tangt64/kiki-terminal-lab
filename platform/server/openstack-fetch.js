import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";

let cachedCaBundle = null;
let cachedCaStatus = null;
let cachedCaSignature = "";
const OPENSTACK_HTTP_TIMEOUT_MS = Math.max(1000, Math.min(120000, Number(process.env.OPENSTACK_HTTP_TIMEOUT_MS || 30000) || 30000));
const dynamicCaPathRecords = [];
const dynamicCaWarnings = new Map();

function unique(items = []) {
  return Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));
}

function normalizeCaCandidatePath(filePath = "", baseFilePath = "") {
  const value = String(filePath || "").trim();
  if (!value || /^(true|false|null|none)$/i.test(value)) return "";
  if (path.isAbsolute(value)) return value;
  const baseDir = baseFilePath ? path.dirname(path.resolve(baseFilePath)) : process.cwd();
  return path.resolve(baseDir, value);
}

function invalidateOpenstackCaCache() {
  cachedCaBundle = null;
  cachedCaStatus = null;
  cachedCaSignature = "";
}

export function registerOpenstackCaPath(filePath = "", source = "runtime") {
  const normalizedPath = normalizeCaCandidatePath(filePath);
  if (!normalizedPath) return "";
  const normalizedSource = String(source || "runtime").trim() || "runtime";
  if (!dynamicCaPathRecords.some((item) => item.path === normalizedPath && item.source === normalizedSource)) {
    dynamicCaPathRecords.push({ path: normalizedPath, source: normalizedSource });
    invalidateOpenstackCaCache();
  }
  return normalizedPath;
}

function registerOpenstackCaWarning(message = "", source = "runtime") {
  const text = String(message || "").trim();
  const key = String(source || text || "runtime").trim();
  if (!text) {
    if (dynamicCaWarnings.delete(key)) invalidateOpenstackCaCache();
    return;
  }
  if (dynamicCaWarnings.get(key) === text) return;
  dynamicCaWarnings.set(key, text);
  invalidateOpenstackCaCache();
}

export function registerOpenstackCloudCaPaths({ cloud = {}, cloudsYamlPath = "", cloudName = "" } = {}) {
  const sourcePrefix = [
    "clouds.yaml",
    String(cloudsYamlPath || "").trim(),
    String(cloudName || "").trim(),
  ].filter(Boolean).join(":");
  const verifyValue = typeof cloud?.verify === "boolean" || typeof cloud?.verify === "string"
    ? String(cloud.verify).trim().toLowerCase()
    : "";
  if (verifyValue === "false") {
    registerOpenstackCaWarning(
      "clouds.yaml의 verify:false 설정은 Terminal Lab OpenStack API 호출에서 보안상 사용하지 않습니다. 사설 CA를 cacert, OPENSTACK_CA_CERT, OS_CACERT, NODE_EXTRA_CA_CERTS 중 하나로 지정해 주세요.",
      `${sourcePrefix}:verify`,
    );
  } else {
    registerOpenstackCaWarning("", `${sourcePrefix}:verify`);
  }
  const candidates = [
    { value: cloud?.cacert, field: "cacert" },
    { value: cloud?.ca_cert, field: "ca_cert" },
    { value: cloud?.ca_certificate, field: "ca_certificate" },
    { value: typeof cloud?.verify === "string" ? cloud.verify : "", field: "verify" },
    { value: cloud?.auth?.cacert, field: "auth.cacert" },
  ];
  return candidates
    .map((candidate) => {
      const normalizedPath = normalizeCaCandidatePath(candidate.value, cloudsYamlPath);
      if (!normalizedPath) return "";
      return registerOpenstackCaPath(normalizedPath, `${sourcePrefix}:${candidate.field}`);
    })
    .filter(Boolean);
}

function candidateCaPathRecords() {
  const rawRecords = [
    { path: process.env.OPENSTACK_CA_CERT, source: "OPENSTACK_CA_CERT" },
    { path: process.env.OPENSTACK_CA_CERT_FILE, source: "OPENSTACK_CA_CERT_FILE" },
    { path: process.env.OPENSTACK_CA_CERT_HOST, source: "OPENSTACK_CA_CERT_HOST" },
    { path: process.env.OS_CACERT, source: "OS_CACERT" },
    { path: process.env.REQUESTS_CA_BUNDLE, source: "REQUESTS_CA_BUNDLE" },
    { path: process.env.NODE_EXTRA_CA_CERTS, source: "NODE_EXTRA_CA_CERTS" },
    { path: process.env.SSL_CERT_FILE, source: "SSL_CERT_FILE" },
    ...dynamicCaPathRecords,
    { path: path.resolve(process.cwd(), "secrets", "openstack-rootCA.crt"), source: "workspace default" },
    { path: "/app/secrets/openstack-rootCA.crt", source: "container mount default" },
  ].filter((item) => String(item.path || "").trim());
  const grouped = new Map();
  for (const item of rawRecords) {
    const filePath = String(item.path || "").trim();
    if (!grouped.has(filePath)) grouped.set(filePath, { path: filePath, sources: [] });
    grouped.get(filePath).sources.push(item.source);
  }
  return [...grouped.values()];
}

function candidateCaPaths() {
  return unique(candidateCaPathRecords().map((item) => item.path));
}

function buildOpenstackCaSignature(paths = candidateCaPaths()) {
  return paths.map((filePath) => {
    try {
      const stat = fs.statSync(filePath);
      return [
        filePath,
        stat.isFile() ? "file" : "other",
        stat.size,
        stat.mtimeMs,
      ].join(":");
    } catch {
      return `${filePath}:missing`;
    }
  }).join("|");
}

function parseOpenstackCaCertificates(filePath, content = "", stat = null) {
  const blocks = content.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  return blocks.map((block, index) => {
    try {
      const certificate = new X509Certificate(block);
      const validFromMs = Date.parse(certificate.validFrom);
      const validToMs = Date.parse(certificate.validTo);
      const now = Date.now();
      return {
        path: filePath,
        index: index + 1,
        subject: certificate.subject,
        issuer: certificate.issuer,
        validFrom: certificate.validFrom,
        validTo: certificate.validTo,
        fingerprint256: certificate.fingerprint256,
        selfSigned: certificate.subject === certificate.issuer,
        notYetValid: Number.isFinite(validFromMs) ? validFromMs > now : false,
        expired: Number.isFinite(validToMs) ? validToMs < now : false,
        fileSize: stat?.size ?? null,
        fileModifiedAt: stat?.mtime ? stat.mtime.toISOString() : "",
      };
    } catch (error) {
      return {
        path: filePath,
        index: index + 1,
        parseError: error.message,
        fileSize: stat?.size ?? null,
        fileModifiedAt: stat?.mtime ? stat.mtime.toISOString() : "",
      };
    }
  });
}

function certificateBlocks(content = "") {
  return String(content || "").match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
}

function buildRequestCaBundle(customCaBundle = "") {
  const customBlocks = certificateBlocks(customCaBundle);
  if (!customBlocks.length) return undefined;
  return unique([...rootCertificates, ...customBlocks]);
}

function loadOpenstackCaBundle() {
  const caRecords = candidateCaPathRecords();
  const caPaths = caRecords.map((item) => item.path);
  const currentSignature = buildOpenstackCaSignature(caPaths);
  if (cachedCaBundle !== null && cachedCaSignature === currentSignature) return cachedCaBundle;
  const certs = [];
  const checkedPaths = [];
  const loadedPaths = [];
  const certificateDetails = [];
  const candidateDetails = [];
  for (const record of caRecords) {
    const filePath = record.path;
    const candidateDetail = {
      path: filePath,
      sources: record.sources,
      exists: false,
      isFile: false,
      readable: false,
      loaded: false,
      error: "",
    };
    checkedPaths.push(filePath);
    try {
      const stat = fs.statSync(filePath);
      candidateDetail.exists = true;
      candidateDetail.isFile = stat.isFile();
      candidateDetail.fileSize = stat.size;
      candidateDetail.fileModifiedAt = stat.mtime ? stat.mtime.toISOString() : "";
      if (!stat.isFile()) {
        candidateDetail.error = "path is not a file";
        candidateDetails.push(candidateDetail);
        continue;
      }
      const content = fs.readFileSync(filePath, "utf8").trim();
      candidateDetail.readable = true;
      if (content.includes("BEGIN CERTIFICATE")) {
        certs.push(content);
        loadedPaths.push(filePath);
        candidateDetail.loaded = true;
        certificateDetails.push(...parseOpenstackCaCertificates(filePath, content, stat));
      } else {
        candidateDetail.error = "no PEM certificate block";
      }
    } catch (error) {
      candidateDetail.error = error?.code || error?.message || "read failed";
      // Optional CA candidates may not exist on every deployment target.
    }
    candidateDetails.push(candidateDetail);
  }
  const validCertificateCount = certificateDetails.filter((item) => !item.parseError).length;
  const expiredCertificates = certificateDetails.filter((item) => item.expired).length;
  const notYetValidCertificates = certificateDetails.filter((item) => item.notYetValid).length;
  const mountWarnings = unique([
    ...buildOpenstackCaMountWarnings(candidateDetails),
    ...dynamicCaWarnings.values(),
  ]);
  cachedCaBundle = certs.length ? certs.join("\n") : "";
  cachedCaStatus = {
    loaded: Boolean(certs.length),
    loadedPaths,
    checkedPaths,
    candidateDetails,
    mountWarnings,
    signature: currentSignature,
    reloadedAt: new Date().toISOString(),
    certificateCount: validCertificateCount,
    expiredCertificates,
    notYetValidCertificates,
    certificateDetails,
  };
  cachedCaSignature = currentSignature;
  return cachedCaBundle;
}

export function getOpenstackCaStatus() {
  loadOpenstackCaBundle();
  return cachedCaStatus || {
    loaded: false,
    loadedPaths: [],
    checkedPaths: candidateCaPaths(),
    candidateDetails: [],
    mountWarnings: [],
    signature: buildOpenstackCaSignature(),
    reloadedAt: "",
    certificateCount: 0,
    expiredCertificates: 0,
    notYetValidCertificates: 0,
    certificateDetails: [],
  };
}

export function getOpenstackRequestCaBundle() {
  const ca = loadOpenstackCaBundle();
  return buildRequestCaBundle(ca);
}

function buildOpenstackCaMountWarnings(candidateDetails = []) {
  const warnings = [];
  const byPath = new Map(candidateDetails.map((item) => [item.path, item]));
  const hostPath = String(process.env.OPENSTACK_CA_CERT_HOST || "").trim();
  if (hostPath && !byPath.get(hostPath)?.exists) {
    warnings.push("OPENSTACK_CA_CERT_HOST가 설정되어 있지만 현재 프로세스에서 읽을 수 없습니다. Podman에서는 이 값이 호스트 경로이므로 /app/secrets/openstack-rootCA.crt로 마운트하고 OPENSTACK_CA_CERT/NODE_EXTRA_CA_CERTS는 컨테이너 내부 경로를 가리켜야 합니다.");
  }
  for (const envName of ["OPENSTACK_CA_CERT", "OPENSTACK_CA_CERT_FILE", "OS_CACERT", "REQUESTS_CA_BUNDLE", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"]) {
    const envPath = String(process.env[envName] || "").trim();
    if (envPath && !byPath.get(envPath)?.loaded) {
      const detail = byPath.get(envPath);
      warnings.push(`${envName} 값(${envPath})에서 CA를 로드하지 못했습니다${detail?.error ? ` (${detail.error})` : ""}.`);
    }
  }
  return unique(warnings);
}

function isTlsTrustError(error) {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").trim();
  if ([
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_GET_ISSUER_CERT",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "CERT_HAS_EXPIRED",
    "CERT_NOT_YET_VALID",
    "CERT_UNTRUSTED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "ERR_TLS_CERT_ALTNAME_INVALID",
  ].includes(code)) {
    return true;
  }
  return /unable to verify|self.?signed|issuer cert|certificate has expired|not yet valid|hostname.*(does not match|mismatch)|cert_altname|subject alternative name|leaf signature/i.test(message);
}

function formatCaStatusForError() {
  const status = getOpenstackCaStatus();
  const certificateSummary = status.certificateCount
    ? `; certificates=${status.certificateCount}`
    : "";
  const invalidSummary = [
    status.expiredCertificates ? `expired=${status.expiredCertificates}` : "",
    status.notYetValidCertificates ? `notYetValid=${status.notYetValidCertificates}` : "",
  ].filter(Boolean).join(", ");
  const invalidHint = invalidSummary ? `; ${invalidSummary}` : "";
  if (status.loaded) {
    const warningHint = status.mountWarnings?.length ? `; CA path warnings: ${status.mountWarnings.join(" | ")}` : "";
    return `OpenStack CA loaded from ${status.loadedPaths.join(", ")}${certificateSummary}${invalidHint}${warningHint}; if TLS verification still fails, check the endpoint leaf/intermediate chain and auth_url hostname/SAN`;
  }
  const warningHint = status.mountWarnings?.length ? `; ${status.mountWarnings.join(" | ")}` : "";
  return `OpenStack CA not loaded; checked ${status.checkedPaths.join(", ") || "no candidate paths"}${warningHint}`;
}

function enhanceRequestError(error) {
  if (!isTlsTrustError(error)) return error;
  const enhanced = new Error(`${error.message}; ${formatCaStatusForError()}`, { cause: error });
  enhanced.code = error.code;
  enhanced.openstackCaStatus = getOpenstackCaStatus();
  return enhanced;
}

function createHeaders(headers = {}) {
  const entries = [];
  const source = headers && typeof headers === "object" ? headers : {};
  if (typeof source.entries === "function") {
    for (const [key, value] of source.entries()) entries.push([key, value]);
  } else {
    for (const [key, value] of Object.entries(source)) entries.push([key, value]);
  }
  const normalized = new Map();
  for (const [key, value] of entries) {
    normalized.set(String(key).toLowerCase(), String(value));
  }
  return {
    get(name) {
      return normalized.get(String(name || "").toLowerCase()) || null;
    },
  };
}

function requestBodyToBuffer(body) {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  return Buffer.from(String(body));
}

function abortError(signal) {
  const error = signal?.reason instanceof Error
    ? signal.reason
    : new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

export async function fetchOpenstack(url, options = {}) {
  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === "https:";
  const bodyBuffer = requestBodyToBuffer(options.body);
  const headers = { ...(options.headers || {}) };
  if (bodyBuffer && !Object.keys(headers).some((key) => key.toLowerCase() === "content-length")) {
    headers["Content-Length"] = String(bodyBuffer.length);
  }
  const ca = isHttps ? loadOpenstackCaBundle() : "";
  const requestOptions = {
    method: options.method || "GET",
    headers,
    ca: buildRequestCaBundle(ca),
  };

  return await new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError(options.signal));
      return;
    }
    const client = isHttps ? https : http;
    const req = client.request(parsedUrl, requestOptions, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || 0,
          statusText: res.statusMessage || "",
          headers: createHeaders(res.headers || {}),
          async text() {
            return buffer.toString("utf8");
          },
          async json() {
            const text = buffer.toString("utf8");
            return text ? JSON.parse(text) : null;
          },
        });
      });
    });
    req.on("error", (error) => reject(enhanceRequestError(error)));
    req.setTimeout(OPENSTACK_HTTP_TIMEOUT_MS, () => {
      const error = new Error("OpenStack request timed out after " + OPENSTACK_HTTP_TIMEOUT_MS + "ms.");
      error.code = "ETIMEDOUT";
      req.destroy(error);
    });
    const onAbort = () => {
      req.destroy(abortError(options.signal));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    req.on("close", () => options.signal?.removeEventListener("abort", onAbort));
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}
