export const LAB_QUOTA_CIRCUIT_BREAKER_METRIC_KEYS = ["cores", "ram", "volumeStorage"];
export const DEFAULT_LAB_QUOTA_CIRCUIT_BREAKER_THRESHOLD_PERCENT = 80;

const METRIC_LABELS = {
  cores: "vCPU",
  ram: "RAM",
  volumeStorage: "Volume",
};

export function normalizeLabQuotaCircuitBreakerThreshold(value, fallback = DEFAULT_LAB_QUOTA_CIRCUIT_BREAKER_THRESHOLD_PERCENT) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(50, Math.min(100, parsed));
}

function resolveMetricPercent(metric) {
  const explicitPercent = Number(metric?.percent);
  if (Number.isFinite(explicitPercent)) {
    return Math.max(0, Math.min(100, explicitPercent));
  }
  const used = Number(metric?.used);
  const limit = Number(metric?.limit);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

export function evaluateLabQuotaCircuitBreaker(quotaStatus, thresholdValue) {
  const thresholdPercent = normalizeLabQuotaCircuitBreakerThreshold(thresholdValue);
  if (!quotaStatus || quotaStatus.ok === false || !quotaStatus.metrics || typeof quotaStatus.metrics !== "object") {
    return {
      tripped: false,
      thresholdPercent,
      percent: 0,
      metricKey: "",
      metricLabel: "",
      reason: "quota-unavailable",
    };
  }

  const candidates = LAB_QUOTA_CIRCUIT_BREAKER_METRIC_KEYS
    .map((metricKey) => {
      const percent = resolveMetricPercent(quotaStatus.metrics[metricKey]);
      return percent == null
        ? null
        : {
            metricKey,
            metricLabel: METRIC_LABELS[metricKey] || metricKey,
            percent: Math.round(percent * 10) / 10,
          };
    })
    .filter(Boolean)
    .sort((a, b) => b.percent - a.percent);
  const highest = candidates[0];
  if (!highest) {
    return {
      tripped: false,
      thresholdPercent,
      percent: 0,
      metricKey: "",
      metricLabel: "",
      reason: "quota-metrics-unavailable",
    };
  }

  return {
    ...highest,
    tripped: highest.percent >= thresholdPercent,
    thresholdPercent,
    reason: highest.percent >= thresholdPercent ? "quota-threshold-reached" : "quota-safe",
  };
}

export function buildLabQuotaCircuitBreakerMessage(evaluation) {
  const metricLabel = String(evaluation?.metricLabel || evaluation?.metricKey || "OpenStack 자원").trim();
  const percent = Math.max(0, Number(evaluation?.percent || 0) || 0);
  const thresholdPercent = normalizeLabQuotaCircuitBreakerThreshold(evaluation?.thresholdPercent);
  return `🚨 ${metricLabel} 사용률 ${percent}%가 자동 차단 기준 ${thresholdPercent}%에 도달해 신규 랩 생성을 중지했습니다. 자원을 정리한 뒤 관리자가 서킷 브레이크를 해제해 주세요.`;
}
