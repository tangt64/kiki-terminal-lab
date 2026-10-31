import "./env-loader.js";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runtimeCloseDatabasePool,
  runtimeEnsureSchema,
  runtimeGetPlatformStatus,
  runtimeListMagnumClusters,
  runtimeListPublishedLabRoutes,
} from "./db-runtime.js";
import {
  isAllowedPublicRoutePort,
  normalizePublicRouteProtocol,
  parseAllowedPublicRoutePorts,
} from "./public-route-policy.js";
import { sortVmNodes } from "./vm-node-order.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RUNTIME_ROOT_DIR = process.env.RUNTIME_ROOT_DIR || path.resolve(__dirname, "../runtime");
const ROUTE_EXPORT_DIR = process.env.LAB_ROUTE_EXPORT_DIR || path.join(RUNTIME_ROOT_DIR, "haproxy");
const LAB_BASE_DOMAIN = process.env.LAB_BASE_DOMAIN || "apps.example.com";
const CONTROLLER_INTERVAL_MS = Math.max(1000, Number(process.env.LAB_ROUTE_CONTROLLER_INTERVAL_MS || 5000) || 5000);
const ALLOWED_PUBLIC_ROUTE_PORTS = parseAllowedPublicRoutePorts();
const BLOCKED_ROUTE_TARGETS = [
  "0.0.0.0",
  "::",
  "localhost",
  "127.0.0.1",
  "example.com",
  "portal.example.com",
  LAB_BASE_DOMAIN,
  ...String(process.env.LAB_ROUTE_BLOCKED_TARGETS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
];

const ROUTE_FILES = {
  routeMap: path.join(ROUTE_EXPORT_DIR, "lab-routes.map"),
  protocolMap: path.join(ROUTE_EXPORT_DIR, "lab-routes-protocol.map"),
  hostMap: path.join(ROUTE_EXPORT_DIR, "lab-routes-host.map"),
  portMap: path.join(ROUTE_EXPORT_DIR, "lab-routes-port.map"),
  backendMap: path.join(ROUTE_EXPORT_DIR, "lab-routes-backend.map"),
  backendConfig: path.join(ROUTE_EXPORT_DIR, "lab-route-backends.cfg"),
  pocRouteMap: path.join(ROUTE_EXPORT_DIR, "poc-routes.map"),
  pocProtocolMap: path.join(ROUTE_EXPORT_DIR, "poc-routes-protocol.map"),
  pocHostMap: path.join(ROUTE_EXPORT_DIR, "poc-routes-host.map"),
  pocPortMap: path.join(ROUTE_EXPORT_DIR, "poc-routes-port.map"),
  pocBackendMap: path.join(ROUTE_EXPORT_DIR, "poc-routes-backend.map"),
  pocBackendConfig: path.join(ROUTE_EXPORT_DIR, "poc-route-backends.cfg"),
  sshMap: path.join(ROUTE_EXPORT_DIR, "lab-ssh-routes.map"),
  rdpMap: path.join(ROUTE_EXPORT_DIR, "lab-rdp-routes.map"),
  tcpMap: path.join(ROUTE_EXPORT_DIR, "lab-tcp-routes.map"),
  tcpBackendMap: path.join(ROUTE_EXPORT_DIR, "lab-tcp-routes-backend.map"),
};

function isValidExternalPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function sanitizeRouteHost(value) {
  const host = String(value || "").trim().toLowerCase();
  if (!host || /\s/.test(host)) return "";
  if (net.isIP(host)) return host;
  if (!/^[a-z0-9.-]+$/.test(host)) return "";
  if (host.includes("..") || host.startsWith(".") || host.endsWith(".")) return "";
  return host;
}

function sanitizeRouteFqdn(value) {
  const fqdn = sanitizeRouteHost(value);
  if (!fqdn || net.isIP(fqdn)) return "";
  const labels = fqdn.split(".");
  if (labels.length < 2) return "";
  if (labels.some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) return "";
  return fqdn;
}

function parseIpv4(value) {
  if (net.isIP(value) !== 4) return null;
  return value.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function ipv4MatchesCidr(ip, cidr) {
  const [base, prefixText] = String(cidr || "").split("/", 2);
  const prefix = Number(prefixText);
  const ipNumber = parseIpv4(ip);
  const baseNumber = parseIpv4(base);
  if (ipNumber == null || baseNumber == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNumber & mask) === (baseNumber & mask);
}

function isBlockedRouteTargetHost(value) {
  const host = sanitizeRouteHost(value);
  if (!host) return true;
  if (host === "0.0.0.0" || host === "::" || host === "localhost") return true;
  if (
    net.isIP(host)
    && (
      host === "127.0.0.1"
      || host === "::1"
      || ipv4MatchesCidr(host, "127.0.0.0/8")
      || ipv4MatchesCidr(host, "169.254.0.0/16")
      || ipv4MatchesCidr(host, "224.0.0.0/4")
    )
  ) {
    return true;
  }
  return BLOCKED_ROUTE_TARGETS.some((blockedValue) => {
    const rawBlocked = String(blockedValue || "").trim().toLowerCase();
    if (rawBlocked.includes("/")) return ipv4MatchesCidr(host, rawBlocked);
    const blocked = sanitizeRouteHost(rawBlocked);
    if (!blocked) return false;
    if (host === blocked) return true;
    return !net.isIP(host) && host.endsWith(`.${blocked}`);
  });
}

function isAuxiliaryNetworkVmNode(node) {
  const id = String(node?.id || "").trim().toLowerCase();
  const name = String(node?.name || "").trim().toLowerCase();
  const serverId = String(node?.serverId || node?.server_id || node?.instanceUuid || node?.instance_uuid || "").trim();
  const fixedIp = sanitizeRouteHost(node?.fixedIp || node?.fixed_ip || node?.ip);
  const identity = [id, name].filter(Boolean).join(" ");
  if (!identity || serverId) return false;
  return /[_-](dev|devnet)(?:\s|$)/.test(identity)
    && (!fixedIp || fixedIp.startsWith("192.168.10."));
}

function deriveTerminalNodes(lab) {
  const explicit = Array.isArray(lab?.vmNodes) ? lab.vmNodes.filter((node) => node && !isAuxiliaryNetworkVmNode(node)) : [];
  if (explicit.length) {
    return sortVmNodes(explicit).map((node, index) => ({
      id: String(node.id || `node-${index + 1}`),
      serverId: String(node.serverId || node.server_id || node.instanceUuid || node.instance_uuid || "").trim(),
      name: String(node.name || `node ${index + 1}`),
      fixedIp: sanitizeRouteHost(node.fixedIp),
      floatingIp: sanitizeRouteHost(node.floatingIp),
      status: String(node.status || lab?.status || "running"),
      role: String(node.role || "lab"),
      externalSshPort: isValidExternalPort(node.externalSshPort)
        ? Number(node.externalSshPort)
        : index === 0 && isValidExternalPort(lab?.externalSshPort)
          ? Number(lab.externalSshPort)
          : null,
      externalRdpPort: isValidExternalPort(node.externalRdpPort)
        ? Number(node.externalRdpPort)
        : index === 0 && isValidExternalPort(lab?.externalRdpPort)
          ? Number(lab.externalRdpPort)
          : null,
      sshHost: sanitizeRouteHost(node.sshHost || node.externalSshHost || node.externalSshDomain),
    }));
  }
  const items = Array.isArray(lab?.instanceIps) ? lab.instanceIps : [];
  const fixedIp = sanitizeRouteHost(items.find((item) => item.type === "fixed")?.address || lab?.instanceIp);
  const floatingIp = sanitizeRouteHost(items.find((item) => item.type === "floating")?.address);
  if (!fixedIp && !floatingIp) return [];
  return [{
    id: "node-1",
    name: lab?.stackName || "node 1",
    fixedIp,
    floatingIp,
    status: String(lab?.status || "running"),
    role: "lab",
    externalSshPort: isValidExternalPort(lab?.externalSshPort) ? Number(lab.externalSshPort) : null,
    externalRdpPort: isValidExternalPort(lab?.externalRdpPort) ? Number(lab.externalRdpPort) : null,
    sshHost: "",
  }];
}

function pickRouteTargetHost(lab) {
  const nodes = deriveTerminalNodes(lab);
  const node = nodes.find((item) => item.fixedIp) || nodes.find((item) => item.floatingIp);
  return node ? { type: node.fixedIp ? "fixed" : "floating", address: node.fixedIp || node.floatingIp } : null;
}

function resolveRouteTargetHostForNode(lab, options = {}) {
  const requestedNodeId = String(options.nodeId || "").trim();
  const requestedTargetHost = sanitizeRouteHost(options.targetHost);
  const nodes = deriveTerminalNodes(lab);
  if (requestedNodeId && nodes.length) {
    const matchedNode = nodes.find((node) => String(node.id || "").trim() === requestedNodeId);
    const address = matchedNode?.fixedIp || matchedNode?.floatingIp || "";
    if (address) {
      return {
        type: matchedNode.fixedIp ? "fixed" : "floating",
        address,
        nodeId: String(matchedNode.id || ""),
        nodeName: String(matchedNode.name || ""),
      };
    }
  }
  if (requestedTargetHost) {
    return {
      type: "fixed",
      address: requestedTargetHost,
      nodeId: requestedNodeId,
      nodeName: "",
    };
  }
  return pickRouteTargetHost(lab);
}

function sanitizeSshHostLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function deriveNodeSshHost(lab, node, index) {
  const explicitHost = sanitizeRouteHost(node?.sshHost || node?.externalSshHost || node?.externalSshDomain);
  if (explicitHost) return explicitHost;
  const baseHost = sanitizeSshHostLabel(lab?.publicSubdomain || lab?.requestedPublicSubdomain || lab?.stackName || lab?.courseTitle || lab?.userName || lab?.username || `lab-${lab?.id || "node"}`);
  return `${baseHost || `lab-${lab?.id || "node"}`}-node${index + 1}.${LAB_BASE_DOMAIN}`.toLowerCase();
}

function buildExternalSshTargets(lab) {
  const nodes = deriveTerminalNodes(lab).map((node, index) => ({
    ...node,
    sshHost: deriveNodeSshHost(lab, node, index),
  }));
  if (nodes.length) return nodes;
  const targetHost = pickRouteTargetHost(lab);
  if (!targetHost?.address) return [];
  return [{
    id: "node-1",
    name: lab?.stackName || "node 1",
    fixedIp: targetHost.address,
    floatingIp: "",
    externalSshPort: isValidExternalPort(lab?.externalSshPort) ? Number(lab.externalSshPort) : null,
    sshHost: deriveNodeSshHost(lab, {}, 0),
  }];
}

function getEnabledExternalSshTargets(lab) {
  if (!lab?.externalSshEnabled) return [];
  const targets = buildExternalSshTargets(lab)
    .filter((node) => isValidExternalPort(node.externalSshPort) && (node.fixedIp || node.floatingIp));
  const legacyPort = Number(lab?.externalSshPort);
  if (!isValidExternalPort(legacyPort) || targets.some((node) => Number(node.externalSshPort) === legacyPort)) {
    return targets;
  }
  const firstTarget = targets.find((node) => node.fixedIp || node.floatingIp)
    || buildExternalSshTargets(lab).find((node) => node.fixedIp || node.floatingIp);
  return firstTarget
    ? [{ ...firstTarget, externalSshPort: legacyPort }, ...targets]
    : targets;
}

function getEnabledExternalRdpTargets(lab) {
  if (!lab?.externalRdpEnabled) return [];
  return deriveTerminalNodes(lab)
    .filter((node) => isValidExternalPort(node.externalRdpPort) && (node.fixedIp || node.floatingIp));
}

function buildLabRouteBackendName(fqdn, prefix = "lab_route") {
  const normalized = String(fqdn || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${prefix}_${normalized || "default"}`;
}

function buildTcpRouteBackendName(externalPort) {
  return `lab_tcp_route_${Number(externalPort) || "default"}`;
}

function createRouteBucket() {
  return {
    routeLines: [],
    protocolLines: [],
    hostLines: [],
    portLines: [],
    backendMapLines: [],
    backendConfigBlocks: [],
    skipped: [],
  };
}

function renderHttpRoute(route, bucket, backendPrefix = "lab_route", platformStatus = null) {
  const targetHost = pickRouteTargetHost(route);
  const hasPublicExposure = Array.isArray(route.publicDomains) && route.publicDomains.length;
  if (!targetHost && hasPublicExposure) {
    bucket.skipped.push(route.id);
    return;
  }

  const entries = Array.isArray(route.publicDomains) && route.publicDomains.length
    ? route.publicDomains
    : (route.publicFqdn && route.publicPort ? [{ fqdn: route.publicFqdn, port: route.publicPort, protocol: route.publicProtocol || "http" }] : []);

  for (const entry of entries) {
    const fqdn = sanitizeRouteFqdn(entry?.fqdn);
    const port = Number(entry?.port);
    if (!fqdn || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    if (!isAllowedPublicRoutePort(port, platformStatus, ALLOWED_PUBLIC_ROUTE_PORTS)) {
      bucket.skipped.push(route.id);
      continue;
    }
    const entryTarget = resolveRouteTargetHostForNode(route, entry);
    const entryTargetAddress = sanitizeRouteHost(entryTarget?.address);
    if (!entryTargetAddress || isBlockedRouteTargetHost(entryTargetAddress)) {
      bucket.skipped.push(route.id);
      continue;
    }
    const protocol = normalizePublicRouteProtocol(entry.protocol, port);
    const backendName = buildLabRouteBackendName(fqdn, backendPrefix);
    bucket.routeLines.push(`${fqdn} ${entryTargetAddress}:${port}`);
    bucket.protocolLines.push(`${fqdn} ${protocol}`);
    bucket.hostLines.push(`${fqdn} ${entryTargetAddress}`);
    bucket.portLines.push(`${fqdn} ${port}`);
    bucket.backendMapLines.push(`${fqdn} ${backendName}`);
    bucket.backendConfigBlocks.push([
      `backend ${backendName}`,
      "    mode http",
      "    http-request set-header X-Forwarded-Host %[req.hdr(host)]",
      protocol === "https"
        ? `    server target ${entryTargetAddress}:${port} ssl verify none`
        : `    server target ${entryTargetAddress}:${port}`,
    ].join("\n"));
  }
}

function renderRouteFiles(routes, platformStatus = null) {
  const lab = createRouteBucket();
  const poc = createRouteBucket();
  const routeLines = [];
  const protocolLines = [];
  const hostLines = [];
  const portLines = [];
  const backendMapLines = [];
  const backendConfigBlocks = [];
  const sshRouteLines = [];
  const rdpRouteLines = [];
  const tcpRouteLines = [];
  const tcpBackendMapLines = [];
  const tcpBackendConfigBlocks = [];
  const skippedLabs = [];

  for (const route of routes) {
    const isPocRoute = String(route?.resourceType || "").trim().toLowerCase() === "custom-lab";
    if (isPocRoute) {
      renderHttpRoute(route, poc, "poc_route", platformStatus);
      continue;
    }
    renderHttpRoute(route, lab, "lab_route", platformStatus);
    const targetHost = pickRouteTargetHost(route);
    const hasPublicExposure = route.externalSshEnabled
      || route.externalRdpEnabled;
    if (!targetHost && hasPublicExposure) {
      skippedLabs.push(route.id);
      continue;
    }

    const defaultTargetAddress = sanitizeRouteHost(targetHost?.address);
    for (const sshTarget of getEnabledExternalSshTargets(route)) {
      const sshTargetHost = sanitizeRouteHost(sshTarget.fixedIp || sshTarget.floatingIp);
      if (sshTargetHost && !isBlockedRouteTargetHost(sshTargetHost) && sshTarget.externalSshPort) {
        sshRouteLines.push(`${Number(sshTarget.externalSshPort)} ${sshTargetHost}:22`);
      }
    }

    for (const rdpTarget of getEnabledExternalRdpTargets(route)) {
      const rdpTargetHost = sanitizeRouteHost(rdpTarget.fixedIp || rdpTarget.floatingIp);
      if (rdpTargetHost && !isBlockedRouteTargetHost(rdpTargetHost) && rdpTarget.externalRdpPort) {
        rdpRouteLines.push(`${Number(rdpTarget.externalRdpPort)} ${rdpTargetHost}:3389`);
      }
    }

    for (const tcpRoute of Array.isArray(route.publicTcpRoutes) ? route.publicTcpRoutes : []) {
      const externalPort = Number(tcpRoute?.externalPort);
      const targetPort = Number(tcpRoute?.targetPort);
      const tcpTarget = resolveRouteTargetHostForNode(route, tcpRoute);
      const tcpTargetAddress = sanitizeRouteHost(tcpTarget?.address || defaultTargetAddress);
      if (!isValidExternalPort(externalPort) || !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535 || !tcpTargetAddress || isBlockedRouteTargetHost(tcpTargetAddress)) continue;
      const backendName = buildTcpRouteBackendName(externalPort);
      tcpRouteLines.push(`${externalPort} ${tcpTargetAddress}:${targetPort}`);
      tcpBackendMapLines.push(`${externalPort} ${backendName}`);
      tcpBackendConfigBlocks.push([
        `backend ${backendName}`,
        "    mode tcp",
        `    server target ${tcpTargetAddress}:${targetPort}`,
      ].join("\n"));
    }
  }

  const labBackendConfigBlocks = [...lab.backendConfigBlocks, ...tcpBackendConfigBlocks];

  return {
    files: {
      [ROUTE_FILES.routeMap]: `${lab.routeLines.join("\n")}${lab.routeLines.length ? "\n" : ""}`,
      [ROUTE_FILES.protocolMap]: `${lab.protocolLines.join("\n")}${lab.protocolLines.length ? "\n" : ""}`,
      [ROUTE_FILES.hostMap]: `${lab.hostLines.join("\n")}${lab.hostLines.length ? "\n" : ""}`,
      [ROUTE_FILES.portMap]: `${lab.portLines.join("\n")}${lab.portLines.length ? "\n" : ""}`,
      [ROUTE_FILES.backendMap]: `${lab.backendMapLines.join("\n")}${lab.backendMapLines.length ? "\n" : ""}`,
      [ROUTE_FILES.backendConfig]: `${labBackendConfigBlocks.join("\n\n")}${labBackendConfigBlocks.length ? "\n" : ""}`,
      [ROUTE_FILES.pocRouteMap]: `${poc.routeLines.join("\n")}${poc.routeLines.length ? "\n" : ""}`,
      [ROUTE_FILES.pocProtocolMap]: `${poc.protocolLines.join("\n")}${poc.protocolLines.length ? "\n" : ""}`,
      [ROUTE_FILES.pocHostMap]: `${poc.hostLines.join("\n")}${poc.hostLines.length ? "\n" : ""}`,
      [ROUTE_FILES.pocPortMap]: `${poc.portLines.join("\n")}${poc.portLines.length ? "\n" : ""}`,
      [ROUTE_FILES.pocBackendMap]: `${poc.backendMapLines.join("\n")}${poc.backendMapLines.length ? "\n" : ""}`,
      [ROUTE_FILES.pocBackendConfig]: `${poc.backendConfigBlocks.join("\n\n")}${poc.backendConfigBlocks.length ? "\n" : ""}`,
      [ROUTE_FILES.sshMap]: `${sshRouteLines.join("\n")}${sshRouteLines.length ? "\n" : ""}`,
      [ROUTE_FILES.rdpMap]: `${rdpRouteLines.join("\n")}${rdpRouteLines.length ? "\n" : ""}`,
      [ROUTE_FILES.tcpMap]: `${tcpRouteLines.join("\n")}${tcpRouteLines.length ? "\n" : ""}`,
      [ROUTE_FILES.tcpBackendMap]: `${tcpBackendMapLines.join("\n")}${tcpBackendMapLines.length ? "\n" : ""}`,
    },
    summary: {
      domainCount: lab.routeLines.length,
      pocDomainCount: poc.routeLines.length,
      sshCount: sshRouteLines.length,
      rdpCount: rdpRouteLines.length,
      tcpCount: tcpRouteLines.length,
      skippedLabs: skippedLabs.length + lab.skipped.length,
      skippedPoc: poc.skipped.length,
    },
  };
}

function buildMagnumApiRoutes(clusters = []) {
  return clusters
    .filter((cluster) => cluster?.externalApiEnabled
      && isValidExternalPort(cluster?.externalApiPort)
      && sanitizeRouteHost(cluster?.apiAddress)
      && !["deleted", "delete_complete", "failed", "error"].includes(String(cluster?.status || "").trim().toLowerCase()))
    .map((cluster) => ({
      id: `capo-${cluster.id}`,
      resourceType: "capo-cluster",
      instanceIp: sanitizeRouteHost(cluster.apiAddress),
      publicTcpRoutes: [{
        externalPort: Number(cluster.externalApiPort),
        targetPort: Math.max(1, Math.min(65535, Number(cluster.apiPort || 6443) || 6443)),
        targetHost: sanitizeRouteHost(cluster.apiAddress),
      }],
    }));
}

async function writeFileAtomic(filePath, content) {
  const current = await fs.readFile(filePath, "utf8").catch(() => null);
  if (current === content) return false;
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, { encoding: "utf8", mode: 0o644 });
  await fs.rename(tempPath, filePath);
  await fs.chmod(filePath, 0o644).catch(() => {});
  return true;
}

export async function syncPublishedLabRoutes() {
  await fs.mkdir(ROUTE_EXPORT_DIR, { recursive: true, mode: 0o755 });
  await fs.chmod(ROUTE_EXPORT_DIR, 0o755).catch(() => {});
  const [routes, platformStatus, magnumClusters] = await Promise.all([
    runtimeListPublishedLabRoutes(),
    runtimeGetPlatformStatus().catch(() => null),
    runtimeListMagnumClusters().catch(() => []),
  ]);
  const rendered = renderRouteFiles([...routes, ...buildMagnumApiRoutes(magnumClusters)], platformStatus);
  let changedFiles = 0;
  for (const [filePath, content] of Object.entries(rendered.files)) {
    if (await writeFileAtomic(filePath, content)) changedFiles += 1;
  }
  return { ...rendered.summary, changedFiles };
}

async function runController() {
  let lastSummary = "";
  let running = true;
  let wakeController = null;
  const stopController = (signal) => {
    if (!running) return;
    running = false;
    console.log(`[route-controller] ${signal} received; stopping`);
    wakeController?.();
  };
  process.once("SIGTERM", () => stopController("SIGTERM"));
  process.once("SIGINT", () => stopController("SIGINT"));

  while (running) {
    try {
      await runtimeEnsureSchema();
      const summary = await syncPublishedLabRoutes();
      const printable = JSON.stringify(summary);
      if (summary.changedFiles || printable !== lastSummary) {
        console.log(`[route-controller] sync ${printable}`);
        lastSummary = printable;
      }
    } catch (error) {
      console.error("[route-controller] sync failed", error);
    }
    if (!running) break;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, CONTROLLER_INTERVAL_MS);
      wakeController = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wakeController = null;
  }
  await runtimeCloseDatabasePool();
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runController().catch((error) => {
    console.error("[route-controller] fatal", error);
    process.exit(1);
  });
}
