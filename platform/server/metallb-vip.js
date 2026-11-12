export const DEFAULT_METALLB_VIP_POOL_CIDR = "";
export const DEFAULT_METALLB_VIP_BLOCK_PREFIX = 28;

function parseIpv4Address(value = "") {
  const parts = String(value || "").trim().split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((octet, index) => !/^\d+$/.test(parts[index]) || !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

function formatIpv4Address(value) {
  const normalized = Number(value) >>> 0;
  return [
    (normalized >>> 24) & 255,
    (normalized >>> 16) & 255,
    (normalized >>> 8) & 255,
    normalized & 255,
  ].join(".");
}

export function parseIpv4Cidr(value = "") {
  const [address, rawPrefix] = String(value || "").trim().split("/");
  const prefix = Number.parseInt(rawPrefix, 10);
  const parsedAddress = parseIpv4Address(address);
  if (parsedAddress == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 30) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return {
    address: parsedAddress,
    network: (parsedAddress & mask) >>> 0,
    prefix,
    size: 2 ** (32 - prefix),
  };
}

export function resolveMetalLbVipPoolConfig({
  poolCidr = DEFAULT_METALLB_VIP_POOL_CIDR,
  blockPrefix = DEFAULT_METALLB_VIP_BLOCK_PREFIX,
} = {}) {
  const pool = parseIpv4Cidr(poolCidr);
  const normalizedBlockPrefix = Math.max(25, Math.min(30, Number.parseInt(blockPrefix, 10) || DEFAULT_METALLB_VIP_BLOCK_PREFIX));
  if (!pool) throw new Error("METALLB_VIP_POOL_CIDR must be a valid IPv4 CIDR.");
  if (normalizedBlockPrefix < pool.prefix) {
    throw new Error("METALLB_VIP_BLOCK_PREFIX must be greater than or equal to the MetalLB pool prefix.");
  }
  const blockSize = 2 ** (32 - normalizedBlockPrefix);
  const blockCount = pool.size / blockSize;
  if (!Number.isInteger(blockCount) || blockCount < 1) {
    throw new Error("MetalLB VIP pool cannot be divided into the requested block prefix.");
  }
  return { ...pool, blockPrefix: normalizedBlockPrefix, blockSize, blockCount };
}

export function buildMetalLbVipAllocation(cidr) {
  const block = parseIpv4Cidr(cidr);
  if (!block) return null;
  const addresses = [];
  for (let offset = 0; offset < block.size; offset += 1) {
    const candidate = (block.network + offset) >>> 0;
    const lastOctet = candidate & 255;
    if (lastOctet === 0 || lastOctet === 255) continue;
    addresses.push(`${formatIpv4Address(candidate)}/32`);
  }
  if (!addresses.length) return null;
  return {
    cidr: `${formatIpv4Address(block.network)}/${block.prefix}`,
    addresses,
    range: `${addresses[0].replace(/\/32$/, "")}-${addresses.at(-1).replace(/\/32$/, "")}`,
  };
}

export function selectAvailableMetalLbVipAllocation(config, reservedCidrs = []) {
  const reserved = new Set((Array.isArray(reservedCidrs) ? reservedCidrs : []).map((item) => String(item || "").trim()).filter(Boolean));
  for (let index = 0; index < config.blockCount; index += 1) {
    const cidr = `${formatIpv4Address((config.network + config.blockSize * index) >>> 0)}/${config.blockPrefix}`;
    if (reserved.has(cidr)) continue;
    const allocation = buildMetalLbVipAllocation(cidr);
    if (allocation) return allocation;
  }
  return null;
}
