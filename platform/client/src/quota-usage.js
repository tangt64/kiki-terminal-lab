const PORTAL_RESOURCE_USAGE_METRIC_KEYS = ["cores", "ram", "volumeStorage"];

function getPortalResourceUsageMetrics(quotaStatus) {
  const metrics = quotaStatus?.metrics || {};
  const focusedMetrics = PORTAL_RESOURCE_USAGE_METRIC_KEYS
    .map((key) => metrics[key])
    .filter(Boolean);
  return focusedMetrics.length ? focusedMetrics : Object.values(metrics);
}

export function getQuotaUsagePercent(quotaStatus) {
  const metrics = getPortalResourceUsageMetrics(quotaStatus);
  if (!metrics.length) return 0;
  return metrics.reduce((max, metric) => {
    const value = Number(metric?.percent || 0);
    if (!Number.isFinite(value)) return max;
    return Math.max(max, Math.max(0, Math.min(100, value)));
  }, 0);
}

export function getQuotaUsageToneClass(quotaStatus) {
  const percent = getQuotaUsagePercent(quotaStatus);
  if (percent >= 92) return "is-quota-critical";
  if (percent >= 78) return "is-quota-hot";
  if (percent >= 60) return "is-quota-warn";
  return "is-quota-calm";
}
