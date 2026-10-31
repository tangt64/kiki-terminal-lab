function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function getVmNodeOrdinal(node) {
  if (!node || typeof node !== "object") return null;

  for (const value of [
    node.nodeIndex,
    node.node_index,
  ]) {
    const ordinal = parsePositiveInteger(value);
    if (ordinal != null) return ordinal;
  }

  for (const value of [
    node.id,
    node.name,
    node.serverName,
    node.server_name,
  ]) {
    const identity = String(value || "").trim();
    if (!identity) continue;
    const match = identity.match(/(?:^|[^a-z0-9])node[-_\s]*(\d+)(?=$|[^0-9])/i)
      || identity.match(/(?:^|\s)노드\s*(\d+)(?=$|\s)/);
    const ordinal = parsePositiveInteger(match?.[1]);
    if (ordinal != null) return ordinal;
  }

  return null;
}

export function sortVmNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length < 2) {
    return Array.isArray(nodes) ? [...nodes] : [];
  }

  const ordered = nodes
    .map((node, index) => ({
      node,
      index,
      ordinal: getVmNodeOrdinal(node),
    }))
    .filter((entry) => entry.ordinal != null)
    .sort((left, right) => left.ordinal - right.ordinal || left.index - right.index);

  if (ordered.length < 2) return [...nodes];

  let orderedIndex = 0;
  return nodes.map((node) => {
    if (getVmNodeOrdinal(node) == null) return node;
    const replacement = ordered[orderedIndex]?.node || node;
    orderedIndex += 1;
    return replacement;
  });
}
