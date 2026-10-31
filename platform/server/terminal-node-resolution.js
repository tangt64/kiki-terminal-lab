export function canFallbackToAnyHeatServerResource({
  selectedNode = null,
  serverResourceCount = 0,
} = {}) {
  return !selectedNode || Number(serverResourceCount || 0) <= 1;
}

export function getResolvedServerAddresses(server) {
  const addresses = [];
  const collect = (rawAddresses) => {
    if (Array.isArray(rawAddresses)) {
      for (const item of rawAddresses) {
        if (typeof item === "string") {
          addresses.push(item);
        } else {
          addresses.push(item?.addr, item?.ip, item?.address);
        }
      }
      return;
    }
    if (!rawAddresses || typeof rawAddresses !== "object") return;
    for (const entries of Object.values(rawAddresses)) {
      collect(entries);
    }
  };

  collect(server?.addresses);
  if (server?.raw && server.raw !== server) collect(server.raw.addresses);
  addresses.push(
    server?.accessIPv4,
    server?.access_ipv4,
    server?.fixedIp,
    server?.fixed_ip,
    server?.raw?.accessIPv4,
    server?.raw?.access_ipv4,
  );
  return [...new Set(addresses.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function resolvedServerMatchesAnyIp(server, candidateIps = []) {
  const wanted = new Set(candidateIps.map((value) => String(value || "").trim()).filter(Boolean));
  if (!wanted.size) return false;
  return getResolvedServerAddresses(server).some((address) => wanted.has(address));
}
