function normalizeIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function getNodeServerId(node = {}) {
  return normalizeIdentity(node.serverId || node.server_id || node.instanceUuid || node.instance_uuid);
}

function getNodeFixedIp(node = {}) {
  return normalizeIdentity(node.fixedIp || node.fixed_ip || node.ip);
}

function normalizeNetworkInterfaces(node = {}) {
  const interfaces = Array.isArray(node.networkInterfaces)
    ? node.networkInterfaces
    : Array.isArray(node.network_interfaces)
      ? node.network_interfaces
      : [];
  return interfaces
    .map((entry) => ({
      portId: String(entry?.portId || entry?.port_id || "").trim(),
      portName: String(entry?.portName || entry?.port_name || entry?.name || "").trim(),
      networkId: String(entry?.networkId || entry?.network_id || "").trim(),
      fixedIp: String(entry?.fixedIp || entry?.fixed_ip || entry?.ipAddress || entry?.ip_address || "").trim(),
      macAddress: String(entry?.macAddress || entry?.mac_address || entry?.mac || "").trim(),
    }))
    .filter((entry) => entry.portId || entry.fixedIp || entry.macAddress);
}

function nodesMatch(left = {}, right = {}) {
  const leftServerId = getNodeServerId(left);
  const rightServerId = getNodeServerId(right);
  if (leftServerId && rightServerId) return leftServerId === rightServerId;

  const leftFixedIp = getNodeFixedIp(left);
  const rightFixedIp = getNodeFixedIp(right);
  if (leftFixedIp && rightFixedIp) return leftFixedIp === rightFixedIp;

  const leftId = normalizeIdentity(left.id);
  const rightId = normalizeIdentity(right.id);
  return Boolean(leftId && rightId && leftId === rightId);
}

export function needsLabMacReconciliation(lab = {}) {
  const status = normalizeIdentity(lab.status);
  if (!["running", "paused"].includes(status)) return false;
  if (!String(lab.stackName || "").trim()) return false;
  if (normalizeIdentity(lab.labBackendType || lab.backendType) === "container") return false;

  const nodes = Array.isArray(lab.vmNodes) ? lab.vmNodes.filter(Boolean) : [];
  if (!nodes.length) return true;
  return nodes.some((node) => (
    !String(node.macAddress || node.mac_address || node.mac || "").trim()
    || normalizeNetworkInterfaces(node).length === 0
  ));
}

export function mergeResolvedVmNodeMacAddresses(existingNodes = [], resolvedNodes = []) {
  const current = Array.isArray(existingNodes) ? existingNodes.filter(Boolean) : [];
  const resolved = Array.isArray(resolvedNodes) ? resolvedNodes.filter(Boolean) : [];
  if (!resolved.length) return { nodes: current, changed: false };
  if (!current.length) {
    const nodes = resolved.map((node) => ({ ...node }));
    return {
      nodes,
      changed: nodes.some((node) => String(node.macAddress || "").trim()),
    };
  }

  let changed = false;
  const nodes = current.map((node) => {
    const match = resolved.find((candidate) => nodesMatch(node, candidate));
    const macAddress = String(match?.macAddress || match?.mac_address || match?.mac || "").trim();
    const currentInterfaces = normalizeNetworkInterfaces(node);
    const resolvedInterfaces = normalizeNetworkInterfaces(match);
    const nextInterfaces = resolvedInterfaces.length ? resolvedInterfaces : currentInterfaces;
    const currentMacAddress = String(node.macAddress || node.mac_address || node.mac || "").trim();
    const nextMacAddress = currentMacAddress || macAddress;
    const interfacesChanged = JSON.stringify(currentInterfaces) !== JSON.stringify(nextInterfaces);
    const macChanged = currentMacAddress !== nextMacAddress;
    if (!interfacesChanged && !macChanged) return node;
    changed = true;
    return {
      ...node,
      macAddress: nextMacAddress,
      ...(nextInterfaces.length || Array.isArray(node.networkInterfaces)
        ? { networkInterfaces: nextInterfaces }
        : {}),
    };
  });
  return { nodes, changed };
}
