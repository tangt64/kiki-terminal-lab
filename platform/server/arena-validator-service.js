import { resolveOpenstackServer } from "./heat.js";
import { fetchZunRemoteContainer } from "./zun.js";

const DEFAULT_VALIDATION_RULES = {
  "boot-mount-recovery": [
    { key: "availability", competency: "복구 완성도", weight: 60, label: "가상머신 정상 상태", type: "runtime.server_status", includesAny: ["active"], passDetail: "가상머신이 ACTIVE 상태입니다.", failDetail: "가상머신이 정상 실행 상태가 아닙니다." },
    { key: "persistence", competency: "서비스 안정성", weight: 40, label: "재부팅 후 정상 상태", type: "runtime.server_status", includesAny: ["active"], requiresMetadataField: "lastRebootAt", passDetail: "재부팅 후에도 정상 상태가 유지됩니다.", failDetail: "재부팅 후 정상 상태를 확인해야 합니다." },
  ],
  "incident-webroot-cleanup": [
    { key: "availability", competency: "복구 완성도", weight: 70, label: "서비스 런타임 정상 상태", type: "runtime.container_status", includesAny: ["running"], passDetail: "컨테이너가 실행 중입니다.", failDetail: "컨테이너가 정상 실행 상태가 아닙니다." },
    { key: "stability", competency: "서비스 안정성", weight: 30, label: "재접속 후 정상 상태", type: "runtime.container_status", includesAny: ["running"], requiresMetadataField: "lastReconnectAt", passDetail: "재접속 후에도 서비스가 정상입니다.", failDetail: "재접속 후 정상 상태를 확인해야 합니다." },
  ],
  "perf-log-throttle": [
    { key: "availability", competency: "복구 완성도", weight: 100, label: "서비스 런타임 정상 상태", type: "runtime.container_status", includesAny: ["running"], passDetail: "컨테이너가 실행 중입니다.", failDetail: "컨테이너가 정상 실행 상태가 아닙니다." },
  ],
  "boss-os-recovery": [
    { key: "availability", competency: "복구 완성도", weight: 60, label: "가상머신 정상 상태", type: "runtime.server_status", includesAny: ["active"], passDetail: "가상머신이 ACTIVE 상태입니다.", failDetail: "가상머신이 정상 실행 상태가 아닙니다." },
    { key: "persistence", competency: "서비스 안정성", weight: 40, label: "재부팅 후 정상 상태", type: "runtime.server_status", includesAny: ["active"], requiresMetadataField: "lastRebootAt", passDetail: "재부팅 후에도 정상 상태가 유지됩니다.", failDetail: "재부팅 후 정상 상태를 확인해야 합니다." },
  ],
};

function hasIsoStamp(value) {
  return Boolean(String(value || "").trim());
}

function buildCheck(key, label, passed, detail) {
  return {
    key,
    label,
    passed: Boolean(passed),
    detail: String(detail || "").trim(),
  };
}

function buildAssessment(checks = []) {
  const totalWeight = checks.reduce((sum, item) => sum + Math.max(0, Number(item.weight || 0)), 0) || checks.length || 1;
  const earnedWeight = checks.reduce((sum, item) => sum + (item.passed ? Math.max(0, Number(item.weight || 0)) || 1 : 0), 0);
  const competencies = checks.reduce((result, item) => {
    const key = item.competency || "복구 완성도";
    const current = result.get(key) || { earned: 0, total: 0 };
    const weight = Math.max(0, Number(item.weight || 0)) || 1;
    current.total += weight;
    if (item.passed) current.earned += weight;
    result.set(key, current);
    return result;
  }, new Map());
  return {
    score: Math.round((earnedWeight / totalWeight) * 100),
    competencies: [...competencies.entries()].map(([label, value]) => ({
      label,
      score: Math.round((value.earned / value.total) * 100),
    })),
  };
}

async function resolveRuntimeState({ sessionRecord, platformStatus, serviceProjectName, zunProjectName }) {
  const driver = String(sessionRecord?.metadata?.driver || "").trim();

  if (driver === "zun" && platformStatus?.zunApiUrl && sessionRecord?.resourceId) {
    try {
      const container = await fetchZunRemoteContainer({
        apiUrl: platformStatus.zunApiUrl,
        projectName: zunProjectName,
        containerUuid: sessionRecord.resourceId,
      });
      return { driver, container };
    } catch (error) {
      return { driver, container: null, error: error.message };
    }
  }

  if (driver === "openstack") {
    try {
      const server = await resolveOpenstackServer({
        serverName: sessionRecord?.metadata?.stackName || sessionRecord?.resourceName || "",
        fixedIp: sessionRecord?.metadata?.instanceIp || "",
        projectName: serviceProjectName,
      });
      return { driver, server };
    } catch (error) {
      return { driver, server: null, error: error.message };
    }
  }

  return { driver: driver || "mock" };
}

function evaluateRule(rule, context) {
  const metadata = context.sessionRecord?.metadata || {};
  const runtimeState = context.runtimeState || {};
  const passDetail = String(rule.passDetail || "").trim();
  const failDetail = String(rule.failDetail || "").trim();
  const decorate = (check) => ({ ...check, competency: String(rule.competency || "복구 완성도"), weight: Math.max(0, Number(rule.weight || 0)) || 1 });
  const requiredMetadataReady = !rule.requiresMetadataField || hasIsoStamp(metadata?.[rule.requiresMetadataField]);

  if (rule.type === "session.console_type") {
    const passed = String(context.sessionRecord?.consoleType || "").trim() === String(rule.equals || "").trim();
    return decorate(buildCheck(rule.key, rule.label, passed, passed ? passDetail : failDetail));
  }

  if (rule.type === "metadata.timestamp_exists") {
    const passed = hasIsoStamp(metadata?.[rule.field]);
    return decorate(buildCheck(rule.key, rule.label, passed, passed ? passDetail : failDetail));
  }

  if (rule.type === "metadata.any_timestamp_exists") {
    const fields = Array.isArray(rule.fields) ? rule.fields : [];
    const passed = fields.some((field) => hasIsoStamp(metadata?.[field]));
    return decorate(buildCheck(rule.key, rule.label, passed, passed ? passDetail : failDetail));
  }

  if (rule.type === "runtime.server_present") {
    const passed = Boolean(runtimeState.server || runtimeState.driver === "mock");
    return decorate(buildCheck(rule.key, rule.label, passed, passed ? passDetail : (runtimeState.error || failDetail)));
  }

  if (rule.type === "runtime.server_status") {
    const status = String(runtimeState.server?.status || "").toLowerCase();
    const includesAny = Array.isArray(rule.includesAny) ? rule.includesAny.map((item) => String(item).toLowerCase()) : [];
    const passed = requiredMetadataReady && includesAny.some((item) => status.includes(item));
    return decorate(buildCheck(rule.key, rule.label, passed, passed ? passDetail : (runtimeState.error || failDetail)));
  }

  if (rule.type === "runtime.container_status") {
    const status = String(runtimeState.container?.status || "").toLowerCase();
    const includesAny = Array.isArray(rule.includesAny) ? rule.includesAny.map((item) => String(item).toLowerCase()) : [];
    const passed = requiredMetadataReady && includesAny.some((item) => status.includes(item));
    const detail = runtimeState.container?.status ? `${passDetail || "상태"}: ${runtimeState.container.status}` : (runtimeState.error || failDetail);
    return decorate(buildCheck(rule.key, rule.label, passed, detail));
  }

  if (rule.type === "runtime.driver_present") {
    const passed = runtimeState.driver === "mock" || Boolean(runtimeState.container || runtimeState.server);
    return decorate(buildCheck(rule.key, rule.label, passed, passed ? passDetail : (runtimeState.error || failDetail)));
  }

  if (rule.type === "session.state") {
    const passed = String(context.sessionRecord?.state || "").trim() === String(rule.equals || "").trim();
    return decorate(buildCheck(rule.key, rule.label, passed, passed ? passDetail : failDetail));
  }

  return decorate(buildCheck(rule.key || "rule", rule.label || "규칙", false, `지원하지 않는 규칙: ${rule.type}`));
}

function resolveValidationRules(scenario, validatorKey) {
  const metadataRules = Array.isArray(scenario?.metadata?.validationRules) ? scenario.metadata.validationRules : [];
  if (metadataRules.length) return metadataRules;
  return DEFAULT_VALIDATION_RULES[validatorKey] || [
    { key: "session", label: "세션 상태 확인", type: "session.state", equals: "running", passDetail: "검증 가능한 상태", failDetail: "실행 중 세션 필요" },
  ];
}

export function evaluateArenaAssessment({ sessionRecord, scenario, runtimeState = {} }) {
  const validatorKey = String(scenario?.validatorKey || "").trim();
  const rules = resolveValidationRules(scenario, validatorKey);
  const checks = rules.map((rule) => evaluateRule(rule, { sessionRecord, runtimeState }));
  const assessment = buildAssessment(checks);
  return {
    passed: checks.every((item) => item.passed),
    validatorKey,
    checks,
    score: assessment.score,
    competencies: assessment.competencies,
    rulesApplied: rules.length,
  };
}

export async function validateArenaSession({
  sessionRecord,
  scenario,
  firstCapture,
  platformStatus,
  serviceProjectName,
  zunProjectName,
}) {
  const runtimeState = await resolveRuntimeState({
    sessionRecord,
    platformStatus,
    serviceProjectName,
    zunProjectName,
  });
  const assessment = evaluateArenaAssessment({ sessionRecord, scenario, runtimeState });

  return {
    ...assessment,
    competencies: assessment.competencies,
    summary: assessment.passed ? "최종 시스템 상태 검증을 통과했습니다." : "정상화되지 않은 시스템 상태가 남아 있습니다.",
    runtimeState,
  };
}
