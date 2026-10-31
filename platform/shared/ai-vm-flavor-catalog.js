export const AI_VM_WORKLOADS = ["python", "notebook", "inference", "cuda"];

function stringList(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))];
}

function profileId(value, flavorName, index) {
  const normalized = String(value || flavorName || `ai-flavor-${index + 1}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `ai-flavor-${index + 1}`;
}

function extraSpecs(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .slice(0, 30)
    .map(([key, specValue]) => [String(key || "").trim(), String(specValue ?? "").trim()])
    .filter(([key, specValue]) => key && specValue));
}

export function normalizeAiVmFlavorCatalog(value, allowedFlavors = []) {
  const allowed = new Set(stringList(allowedFlavors));
  const source = Array.isArray(value) ? value : [];
  const seenIds = new Set();
  const seenFlavors = new Set();
  const result = [];
  for (const [index, raw] of source.slice(0, 50).entries()) {
    const flavorName = String(raw?.flavorName || "").trim();
    if (!flavorName || (allowed.size && !allowed.has(flavorName)) || seenFlavors.has(flavorName)) continue;
    const id = profileId(raw?.id, flavorName, index);
    if (seenIds.has(id)) continue;
    const workload = AI_VM_WORKLOADS.includes(String(raw?.workload || "").trim()) ? String(raw.workload).trim() : "python";
    const gpuEnabled = Boolean(raw?.gpuEnabled);
    const gpuCount = gpuEnabled ? Math.max(1, Math.min(16, Number(raw?.gpuCount || 1) || 1)) : 0;
    result.push({
      id,
      flavorName,
      label: String(raw?.label || flavorName).trim().slice(0, 100) || flavorName,
      description: String(raw?.description || "").trim().slice(0, 500),
      workload,
      enabled: raw?.enabled !== false,
      gpuEnabled,
      gpuType: gpuEnabled ? String(raw?.gpuType || "GPU").trim().slice(0, 80) || "GPU" : "",
      gpuCount,
      vramGb: gpuEnabled ? Math.max(0, Math.min(2048, Number(raw?.vramGb || 0) || 0)) : 0,
      allowedImages: stringList(raw?.allowedImages),
      expectedExtraSpecs: extraSpecs(raw?.expectedExtraSpecs),
      maxInstancesPerUser: Math.max(1, Math.min(20, Number(raw?.maxInstancesPerUser || 1) || 1)),
      hourlyCost: Math.max(0, Number(raw?.hourlyCost || 0) || 0),
      softwareDelivery: "bootstrap",
    });
    seenIds.add(id);
    seenFlavors.add(flavorName);
  }
  return result;
}

export function parseAiVmExtraSpecs(value) {
  return Object.fromEntries(String(value || "").split(",").map((item) => {
    const separator = item.indexOf("=");
    return separator > 0 ? [item.slice(0, separator).trim(), item.slice(separator + 1).trim()] : ["", ""];
  }).filter(([key, specValue]) => key && specValue));
}

export function formatAiVmExtraSpecs(value) {
  return Object.entries(extraSpecs(value)).map(([key, specValue]) => `${key}=${specValue}`).join(", ");
}
