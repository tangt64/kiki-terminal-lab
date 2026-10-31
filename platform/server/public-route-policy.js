const DEFAULT_ALLOWED_PUBLIC_ROUTE_PORTS = "80,443,3000,8080,8443,30443";

export function parseAllowedPublicRoutePorts(value = process.env.ALLOWED_PUBLIC_ROUTE_PORTS || DEFAULT_ALLOWED_PUBLIC_ROUTE_PORTS) {
  return new Set(
    String(value || DEFAULT_ALLOWED_PUBLIC_ROUTE_PORTS)
      .split(",")
      .map((item) => Number(String(item || "").trim()))
      .filter((item) => Number.isInteger(item) && item > 0 && item <= 65535),
  );
}

export function normalizeCustomRoutePorts(input) {
  const source = Array.isArray(input) ? input : [];
  return Array.from({ length: 3 }, (_item, index) => {
    const current = source[index] || {};
    const port = Number(current.port || 0);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  }).filter(Boolean);
}

export function resolveAllowedPublicRoutePorts(platformStatus, basePorts = parseAllowedPublicRoutePorts()) {
  const ports = new Set([80, 443]);
  for (const port of basePorts) ports.add(port);
  for (const port of normalizeCustomRoutePorts(platformStatus?.customRouteSlots)) ports.add(port);
  return ports;
}

export function isAllowedPublicRoutePort(value, platformStatus, basePorts = parseAllowedPublicRoutePorts()) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

export function formatAllowedPublicRoutePorts(platformStatus, basePorts = parseAllowedPublicRoutePorts()) {
  return [];
}

export function inferPublicRouteProtocolForPort(port) {
  const numericPort = Number(port || 0);
  if (numericPort === 443 || numericPort === 8443) return "https";
  if (Number.isInteger(numericPort) && numericPort > 1000 && String(numericPort).endsWith("443")) return "https";
  return "http";
}

export function normalizePublicRouteProtocol(protocol, port = null) {
  if (String(protocol || "").trim().toLowerCase() === "https") return "https";
  if (port != null && inferPublicRouteProtocolForPort(port) === "https") return "https";
  return "http";
}
