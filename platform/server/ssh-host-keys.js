import path from "node:path";

const SSH_KNOWN_HOSTS_SCOPES = new Set(["resource", "global", "none"]);

function sanitizeAliasPart(value, fallback, maxLength = 64) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
  return normalized || fallback;
}

export function normalizeSshKnownHostsScope(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SSH_KNOWN_HOSTS_SCOPES.has(normalized) ? normalized : "resource";
}

export function isSshKnownHostsSink(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/\\/g, "/");
  return normalized === "none" || normalized === "/dev/null" || normalized === "nul";
}

export function isSshHostKeyMismatch(value) {
  return /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|Offending (?:ECDSA|ED25519|RSA|DSA) key in/i.test(String(value || ""));
}

export function buildSshHostKeyAlias({
  resourceType = "lab",
  resourceId = "",
  nodeId = "",
  host = "",
} = {}) {
  const typePart = sanitizeAliasPart(resourceType, "lab", 32);
  const resourcePart = sanitizeAliasPart(resourceId, "unknown", 64);
  const nodePart = sanitizeAliasPart(nodeId || host, "primary", 80);
  return `terminal-lab-${typePart}-${resourcePart}-${nodePart}`;
}

export function resolveSshKnownHostsFile({
  baseFile,
  scope = "resource",
  hostKeyAlias,
} = {}) {
  const normalizedScope = normalizeSshKnownHostsScope(scope);
  if (normalizedScope === "none") return "none";
  const normalizedBaseFile = String(baseFile || "").trim();
  if (!normalizedBaseFile) return "none";
  if (isSshKnownHostsSink(normalizedBaseFile)) {
    return normalizedBaseFile.toLowerCase() === "none" ? "none" : normalizedBaseFile;
  }
  if (normalizedScope === "global") return normalizedBaseFile;
  const alias = sanitizeAliasPart(hostKeyAlias, "unknown", 220);
  return path.join(`${normalizedBaseFile}.d`, alias);
}

export function buildSshHostKeyOptions(target, {
  baseFile,
  scope = "resource",
} = {}) {
  const hostKeyAlias = buildSshHostKeyAlias(target);
  return {
    hostKeyAlias,
    knownHostsFile: resolveSshKnownHostsFile({
      baseFile,
      scope,
      hostKeyAlias,
    }),
  };
}
