import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import "./env-loader.js";
import { normalizeAiVmFlavorCatalog } from "../shared/ai-vm-flavor-catalog.js";
const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}
const DATABASE_POOL_MAX_CONNECTIONS = Math.max(1, Number(process.env.DATABASE_POOL_MAX_CONNECTIONS || 10) || 10);
const DATABASE_POOL_WAIT_LOG_THRESHOLD_MS = Math.max(0, Number(process.env.DATABASE_POOL_WAIT_LOG_THRESHOLD_MS || 250) || 250);
const BACKUP_MAX_TABLE_ROWS = Math.max(1, Number(process.env.BACKUP_MAX_TABLE_ROWS || 100000) || 100000);
const BACKUP_MAX_TOTAL_ROWS = Math.max(BACKUP_MAX_TABLE_ROWS, Number(process.env.BACKUP_MAX_TOTAL_ROWS || 500000) || 500000);
const BACKUP_DUMP_TABLE_CHUNK_ROWS = Math.max(1, Number(process.env.BACKUP_DUMP_TABLE_CHUNK_ROWS || 50000) || 50000);
const BACKUP_DUMP_INSERT_BATCH_ROWS = Math.max(1, Number(process.env.BACKUP_DUMP_INSERT_BATCH_ROWS || 1000) || 1000);
const BACKUP_RECENT_ACTIVITY_ROWS = Math.min(
  BACKUP_MAX_TABLE_ROWS,
  Math.max(1, Number(process.env.BACKUP_RECENT_ACTIVITY_ROWS || 50000) || 50000),
);
const BACKUP_REPLAY_EVENT_ROWS = Math.min(
  BACKUP_MAX_TABLE_ROWS,
  Math.max(1, Number(process.env.BACKUP_REPLAY_EVENT_ROWS || 50000) || 50000),
);
const BACKUP_OPENSTACK_USAGE_SNAPSHOT_ROWS = Math.min(
  BACKUP_MAX_TABLE_ROWS,
  Math.max(1, Number(process.env.BACKUP_OPENSTACK_USAGE_SNAPSHOT_ROWS || 100000) || 100000),
);
const BACKUP_TABLE_EXPORT_POLICIES = {
  admin_audit_logs: {
    mode: "latest",
    maxRows: BACKUP_RECENT_ACTIVITY_ROWS,
    orderBy: "created_at DESC, id DESC",
  },
  arena_events: {
    mode: "latest",
    maxRows: BACKUP_RECENT_ACTIVITY_ROWS,
    orderBy: "created_at DESC, id DESC",
  },
  cicd_run_events: {
    mode: "latest",
    maxRows: BACKUP_RECENT_ACTIVITY_ROWS,
    orderBy: "created_at DESC, id DESC",
  },
  lucky_draw_attempts: {
    mode: "latest",
    maxRows: BACKUP_RECENT_ACTIVITY_ROWS,
    orderBy: "created_at DESC, id DESC",
  },
  lucky_draw_grants: {
    mode: "latest",
    maxRows: BACKUP_RECENT_ACTIVITY_ROWS,
    orderBy: "created_at DESC, id DESC",
  },
  mail_logs: {
    mode: "latest",
    maxRows: BACKUP_RECENT_ACTIVITY_ROWS,
    orderBy: "created_at DESC, id DESC",
  },
  mail_campaigns: {
    mode: "latest",
    maxRows: BACKUP_RECENT_ACTIVITY_ROWS,
    orderBy: "created_at DESC, id DESC",
  },
  mail_campaign_deliveries: {
    mode: "latest",
    maxRows: BACKUP_RECENT_ACTIVITY_ROWS,
    orderBy: "created_at DESC, id DESC",
  },
  openstack_resource_usage_snapshots: {
    mode: "latest",
    maxRows: BACKUP_OPENSTACK_USAGE_SNAPSHOT_ROWS,
    orderBy: "collected_at DESC, id DESC",
  },
  terminal_replay_events: {
    mode: "latest",
    maxRows: BACKUP_REPLAY_EVENT_ROWS,
    orderBy: "id DESC",
  },
  user_access_logs: {
    mode: "latest",
    maxRows: BACKUP_RECENT_ACTIVITY_ROWS,
    orderBy: "created_at DESC, id DESC",
  },
  user_messages: {
    mode: "latest",
    maxRows: BACKUP_RECENT_ACTIVITY_ROWS,
    orderBy: "created_at DESC, id DESC",
  },
  user_notifications: {
    mode: "latest",
    maxRows: BACKUP_RECENT_ACTIVITY_ROWS,
    orderBy: "created_at DESC, id DESC",
  },
};
const BACKUP_TABLE_DUMP_POLICIES = {
  terminal_replay_events: {
    format: "json-row-chunks-v1",
    orderColumn: "id",
    orderBy: "id ASC",
    chunkRows: BACKUP_DUMP_TABLE_CHUNK_ROWS,
  },
};

const DEFAULT_LLM_SYSTEM_PROMPT = [
  "당신은 Terminal Lab Community의 클라우드·시스템 운영 도우미입니다.",
  "",
  "목표:",
  "- 사용자가 가상머신, 컨테이너, 쿠버네티스 클러스터를 이해하고 운영 문제를 해결하도록 돕습니다.",
  "- 답변은 운영 절차와 확인 방법을 중심으로 작성합니다.",
  "- 가능한 경우 바로 실행 가능한 명령어나 확인 순서를 함께 제공합니다.",
  "",
  "행동 원칙:",
  "- 초보자도 이해할 수 있게 짧고 명확하게 설명합니다.",
  "- 먼저 가능성이 높은 원인부터 제시합니다.",
  "- 여러 단계가 필요하면 번호로 나눠 안내합니다.",
  "- 사용자가 설명한 자원 상태와 오류 메시지가 있으면 우선 반영합니다.",
  "- 위험하거나 파괴적인 명령은 주의 문구를 함께 표시합니다.",
  "- 확실하지 않으면 추측이라고 밝히고 확인 방법도 안내합니다.",
  "",
  "제한:",
  "- 존재하지 않는 기능이 있는 것처럼 말하지 않습니다.",
  "- 관리자 권한이 필요한 작업은 일반 사용자 작업과 구분해서 설명합니다.",
  "- 비밀번호, 토큰, 개인정보 같은 민감한 정보는 그대로 출력하지 않습니다.",
  "",
  "응답 스타일:",
  "- 한국어로 답변합니다.",
  "- 불안하게 과장하지 않게 작성합니다.",
  "- 클라우드와 시스템 운영 맥락에 맞는 표현을 사용합니다.",
].join("\\n");
const DEFAULT_LLM_SURVEY_FEEDBACK_PROMPT = [
  "당신은 Terminal Lab의 학습 코치입니다.",
  "사전/사후 설문의 질문 의미와 학습자 답변을 함께 보고, 학습자에게 직접 도움이 되는 해설을 작성합니다.",
  "- 각 문항의 질문 의도를 반영해 답변에서 드러난 현재 상태, 강점, 막힌 지점을 해석합니다.",
  "- 다음 실습에서 바로 해볼 수 있는 행동을 구체적으로 제안합니다.",
  "- 점수나 선택지를 비난하지 않고, 격려와 현실적인 조언을 균형 있게 작성합니다.",
  "- 관리자 평가, 개인정보 추정, 합격/불합격 판단은 하지 않습니다.",
].join("\n");
const DEFAULT_LLM_PROVIDER = "custom";
const DEFAULT_LLM_API_URL = "";
const DEFAULT_LLM_MODEL = "model";
const DEFAULT_LLM_DAILY_QUOTA_ENABLED = true;
const DEFAULT_LLM_DAILY_QUOTA_LIMIT = 10;
const DEFAULT_LLM_MAX_TOKENS = Math.max(1, Number(process.env.LLM_MAX_TOKENS || 512) || 512);
const DEFAULT_LLM_ADMIN_TEST_MAX_TOKENS = Math.max(1, Number(process.env.LLM_ADMIN_TEST_MAX_TOKENS || 80) || 80);
const DEFAULT_LLM_SURVEY_FEEDBACK_MAX_TOKENS = Math.max(64, Number(process.env.LLM_SURVEY_FEEDBACK_MAX_TOKENS || Math.min(DEFAULT_LLM_MAX_TOKENS, 384)) || Math.min(DEFAULT_LLM_MAX_TOKENS, 384));
const DEFAULT_LLM_SURVEY_FEEDBACK_TIMEOUT_MS = Math.max(30000, Number(process.env.LLM_SURVEY_FEEDBACK_TIMEOUT_MS || process.env.LLM_API_TIMEOUT_MS || 180000) || 180000);
const DEFAULT_LLM_SURVEY_FEEDBACK_OPTIONS_JSON = String(process.env.LLM_SURVEY_FEEDBACK_OPTIONS_JSON || "").trim();
const DEFAULT_LLM_THINKING_MODE = "disabled";
const DEFAULT_LLM_WEB_SEARCH_ENABLED = String(process.env.LLM_WEB_SEARCH_ENABLED || "true").toLowerCase() !== "false";
const DEFAULT_LLM_WEB_SEARCH_TIMEOUT_MS = Math.max(1000, Number(process.env.LLM_WEB_SEARCH_TIMEOUT_MS || 8000) || 8000);
const DEFAULT_LLM_WEB_SEARCH_RESULT_LIMIT = Math.min(10, Math.max(1, Number(process.env.LLM_WEB_SEARCH_RESULT_LIMIT || 5) || 5));
const DEFAULT_SITE_UPDATE_MESSAGE = "화면과 기능을 더 보기 좋게 다듬고 있어요. 잠시 후 새로고침하면 이어서 사용할 수 있습니다.";
const DEFAULT_OPENSTACK_STATUS_PROBES_ENABLED = parseEnvFlag(process.env.OPENSTACK_STATUS_PROBES_ENABLED, true);
const DEFAULT_OPENSTACK_STATUS_CACHE_TTL_MINUTES = Math.max(1, Math.min(1440, Math.round((Number(process.env.API_STATUS_CACHE_TTL_MS || 600000) || 600000) / 60000)));
const DEFAULT_ADMIN_AUTO_REFRESH_INTERVAL_SECONDS = Math.max(10, Math.min(3600, Number(process.env.ADMIN_AUTO_REFRESH_INTERVAL_SECONDS || 60) || 60));
const DEFAULT_USER_AUTO_REFRESH_INTERVAL_SECONDS = Math.max(10, Math.min(3600, Number(process.env.USER_AUTO_REFRESH_INTERVAL_SECONDS || 60) || 60));
const DEFAULT_ACCESS_ACTIVE_WITHIN_MINUTES = Math.max(1, Number(process.env.ACCESS_ACTIVE_WITHIN_MINUTES || 2) || 2);
const COURSE_ACCESS_DEFAULT_DAYS = Math.max(1, Number(process.env.COURSE_ACCESS_DEFAULT_DAYS || 30) || 30);
const COURSE_ACCESS_MAX_DAYS = Math.max(COURSE_ACCESS_DEFAULT_DAYS, Math.min(36500, Number(process.env.COURSE_ACCESS_MAX_DAYS || 3650) || 3650));
const COURSE_ACCESS_EXPIRING_SOON_DAYS = Math.max(1, Number(process.env.COURSE_ACCESS_EXPIRING_SOON_DAYS || 7) || 7);

function parseEnvFlag(value, fallback = true) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["0", "false", "no", "off", "disabled"].includes(raw)) return false;
  if (["1", "true", "yes", "on", "enabled"].includes(raw)) return true;
  return fallback;
}

function normalizeStoredLlmProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["ollama", "ollama-native", "ollama_native", "native"].includes(normalized)) return "ollama-native";
  return DEFAULT_LLM_PROVIDER;
}

function normalizeStoredLlmThinkingMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["enabled", "on", "true", "think"].includes(normalized)) return "enabled";
  if (["default", "auto", "model"].includes(normalized)) return "default";
  return DEFAULT_LLM_THINKING_MODE;
}

function resolveCourseAccessDays(value, fallback = COURSE_ACCESS_DEFAULT_DAYS) {
  const fallbackDays = Math.max(1, Math.min(COURSE_ACCESS_MAX_DAYS, Math.floor(Number(fallback || COURSE_ACCESS_DEFAULT_DAYS) || COURSE_ACCESS_DEFAULT_DAYS)));
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallbackDays;
  return Math.max(1, Math.min(COURSE_ACCESS_MAX_DAYS, Math.floor(parsed)));
}

function resolveCourseAccessExpiryIso(baseValue = Date.now(), days = COURSE_ACCESS_DEFAULT_DAYS) {
  const parsed = typeof baseValue === "number" ? baseValue : Date.parse(String(baseValue || ""));
  const baseMs = Number.isFinite(parsed) ? Math.max(parsed, Date.now()) : Date.now();
  return new Date(baseMs + (resolveCourseAccessDays(days) * 24 * 60 * 60 * 1000)).toISOString();
}

function getCourseAccessDaysRemaining(expiresAt) {
  const expiresMs = Date.parse(String(expiresAt || ""));
  if (!Number.isFinite(expiresMs)) return null;
  return Math.ceil((expiresMs - Date.now()) / (24 * 60 * 60 * 1000));
}

function normalizeCourseEnrollmentFields(row) {
  const enrollmentExpiresAt = String(row?.enrollmentExpiresAt ?? row?.enrollment_expires_at ?? "").trim();
  const enrollmentDaysRemaining = enrollmentExpiresAt ? getCourseAccessDaysRemaining(enrollmentExpiresAt) : null;
  const enrollmentExpired = enrollmentDaysRemaining != null && enrollmentDaysRemaining <= 0;
  const enrollmentExpiringSoon = enrollmentDaysRemaining != null && enrollmentDaysRemaining > 0 && enrollmentDaysRemaining <= COURSE_ACCESS_EXPIRING_SOON_DAYS;
  const courseAccessDays = resolveCourseAccessDays(row?.courseAccessDays ?? row?.course_access_days);
  return {
    enrollmentCreatedAt: row?.enrollmentCreatedAt || row?.enrollment_created_at || null,
    enrollmentExpiresAt: enrollmentExpiresAt || null,
    enrollmentDaysRemaining,
    enrollmentExpired,
    enrollmentExpiringSoon,
    courseAccessDays,
    courseAccessDefaultDays: COURSE_ACCESS_DEFAULT_DAYS,
    courseAccessExpiringSoonDays: COURSE_ACCESS_EXPIRING_SOON_DAYS,
  };
}

function isGovernmentProgramTypeValue(programType) {
  const normalized = String(programType || "").trim().replace(/\s+/g, "");
  const lower = normalized.toLowerCase();
  return normalized.includes("정부")
    || normalized.includes("국비")
    || normalized.includes("지원금")
    || normalized.includes("내일배움")
    || lower.includes("hrd")
    || lower.includes("k-digital")
    || lower.includes("kdigital");
}

function normalizeCourseProgramTypeValue(programType, fallback = "일반") {
  const normalized = String(programType || fallback).trim() || fallback;
  return isGovernmentProgramTypeValue(normalized) ? "정부지원금" : normalized;
}

function normalizeCourseProgramTypeOptions(options) {
  const source = Array.isArray(options) && options.length ? options : ["일반", "ILT", "정부지원금", "기업", "학교", "검증"];
  const normalized = source
    .map((item) => normalizeCourseProgramTypeValue(item, ""))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function normalizeCourseOverviewPoints(value, fallback = []) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  const normalized = source.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 4);
  return normalized.length ? normalized : fallback;
}

function normalizeCourseQuoteAccessMode(value) {
  const normalized = String(value || "enabled").trim().toLowerCase();
  return ["enabled", "admin_only", "disabled"].includes(normalized) ? normalized : "enabled";
}

function normalizePortalUiMode(value, fallback = "legacy") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["legacy", "switchable", "v2"].includes(normalized)) return normalized;
  return fallback;
}

function normalizeSupportAvailabilityMode(value, fallback = "available") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["available", "away"].includes(normalized)) return normalized;
  return fallback;
}

const DEFAULT_LLM_DAILY_QUOTA_ADMIN_BYPASS = true;
const DEFAULT_LANDING_DEMO_TYPE = "youtube";
const DEFAULT_LANDING_YOUTUBE_URL = "";
const DEFAULT_LANDING_EYEBROW = "오픈소스 엔지니어링 랩";
const DEFAULT_LANDING_TITLE = "리눅스 인프라 엔지니어를 위한 오픈소스 실습 랩";
const DEFAULT_LANDING_COPY = "Linux/Kubernetes/OpenStack/CI/CD/DEV 자동화 실습을 브라우저 콘솔과 교안으로 한 흐름에서 제공합니다.";
const DEFAULT_LANDING_AUTH_EYEBROW = "접속 안내";
const DEFAULT_LANDING_AUTH_TITLE = "로그인 또는 회원가입";
const DEFAULT_LANDING_AUTH_COPY = "승인된 계정으로 실습 환경과 교육 자료에 바로 접근할 수 있습니다.";
const DEFAULT_LANDING_FEATURES_JSON = JSON.stringify([
  { title: "교육과정", body: "PDF 교안, 안내 가이드, 영상 링크를 한 화면에서 확인합니다." },
  { title: "실습 랩", body: "과정별 랩 요청, 상태 확인, 공개 URL과 도메인 요청까지 바로 연결합니다." },
  { title: "브라우저 터미널", body: "별도 설치 없이 SSH 접속과 인스턴스 상태를 브라우저에서 확인합니다." },
]);
const DEFAULT_LANDING_CUSTOMER_LOGOS_TITLE = "함께한 고객";
const DEFAULT_LANDING_CUSTOMER_LOGOS_JSON = "[]";
const DEFAULT_LANDING_FREE_TITLE = "현재 무료로 운영 중입니다";
const DEFAULT_LANDING_FREE_SUBTITLE = "회원가입 후 관리자 승인을 받으면 공개 과정과 랩 신청을 바로 확인할 수 있습니다.";
const DEFAULT_COURSE_OVERVIEWS = {
  standard: {
    description: "일반 과정은 스스로 학습 과정 입니다. 강사 비용이 제외되어 있기 때문에 저렴하게 사용이 가능 합니다.",
    points: ["셀프 학습", "강사 비용 제외", "저렴한 수강"],
  },
  ilt: {
    description: "ILT(Instructor Led Training)는 강사와 함께 진행하는 교육 과정입니다. 일정, 장소, 실습 환경을 확인한 뒤 신청할 수 있습니다.",
    points: ["강사 주도", "일정 기반", "실시간 질의응답"],
  },
  online: {
    description: "온라인으로 진행되는 강의입니다. 비용 부담이 낮고 장소 제약이 적어, 원하는 환경에서 빠르게 수강할 수 있습니다.",
    points: ["원격 접속", "낮은 비용", "장소 제약 적음"],
  },
  government: {
    description: "정부 예산으로 운영하는 100% 무료 과정입니다. 다만 교육 장소, 신청 대상, 일정 조건을 먼저 확인해야 합니다.",
    points: ["100% 무료", "현장 조건 확인", "승인 후 수강"],
  },
};
const DEFAULT_CUSTOM_DOMAIN_GUIDANCE = {
  intro: "아래와 같이 DNS 레코드 설정이 필요합니다.",
  cnameLabel: "CNAME",
  cnameText: "{domain} → {target}",
  ownershipLabel: "소유권 확인",
  ownershipText: "TXT {txtName} 추가",
  recommendationLabel: "권장 DNS",
  recommendationText: "Cloudflare DNS 사용 권장(무료), 프록시 활성화, SSL/TLS Full",
  verificationLabel: "검증 TXT",
  verificationText: "TXT 레코드가 없으면 서비스에서 도메인을 인식할 수 없습니다.",
};
const DEFAULT_OTP_ISSUER_NAME = "Terminal Lab";
const DEFAULT_ZUN_API_URL = "";
const DEFAULT_POC_PROJECT_NAME = "PoC-example.com";
const DEFAULT_MAIL_WEBHOOK_URL = String(process.env.MAIL_WEBHOOK_URL || "").trim();
const DEFAULT_MAIL_WEBHOOK_TIMEOUT_MS = Number(process.env.MAIL_WEBHOOK_TIMEOUT_MS || 10000);
const DEFAULT_LAB_CIRCUIT_BREAKER_MESSAGE = "현재 랩 생성이 잠시 제한되어 있습니다.";
const DEFAULT_LAB_AUTO_CIRCUIT_BREAKER_THRESHOLD_PERCENT = 80;
const DEFAULT_TROVE_ALLOWED_DATASTORES = ["mysql", "postgresql", "mariadb"];
const DEFAULT_TROVE_ALLOWED_FLAVORS = ["m1.small", "m1.medium"];
const DEFAULT_TROVE_ALLOWED_SIZES_GB = [5, 10, 20];
const DEFAULT_POC_ADVANCED_DAILY_PRICES = {
  network: 1200,
  router: 800,
  floatingIp: 1500,
  volumeGb: 30,
  database: 7000,
  databaseGb: 40,
};
const DEFAULT_TERMINAL_SESSION_IDLE_MINUTES = Math.max(
  1,
  Number(process.env.TERMINAL_SESSION_IDLE_MINUTES || 0)
    || Math.round(Number(process.env.TERMINAL_SESSION_IDLE_TIMEOUT_MS || 0) / 60000)
    || Number(process.env.TERMINAL_SESSION_TTL_MINUTES || 0)
    || Math.round((Number(process.env.TERMINAL_SESSION_TTL_MS || 0) || 600000) / 60000),
);
const DEFAULT_TERMINAL_REPLAY_ENABLED = String(process.env.TERMINAL_REPLAY_ENABLED || "true").toLowerCase() !== "false";
const DEFAULT_UNUSED_VM_RETENTION_MINUTES = Math.max(
  1440,
  Math.round(
    (
      Number(process.env.LAB_UNUSED_VM_RETENTION_MS || 0)
      || Number(process.env.LAB_UNUSED_VM_RETENTION_DAYS || 7) * 24 * 60 * 60 * 1000
    ) / 60000,
  ),
);
const DEFAULT_UNUSED_VM_AUTO_PAUSE_MINUTES = Math.max(
  1440,
  Math.round(
    (
      Number(process.env.LAB_UNUSED_VM_AUTO_PAUSE_MS || 0)
      || Number(process.env.LAB_UNUSED_VM_AUTO_PAUSE_DAYS || 1) * 24 * 60 * 60 * 1000
    ) / 60000,
  ),
);
const ENV_PAYMENT_GATEWAY_PROVIDER = String(process.env.PAYMENT_GATEWAY_PROVIDER || process.env.TOSS_PAYMENTS_PROVIDER || "").trim().toLowerCase();

function normalizeLabBackendType(value) {
  const backendType = String(value || "vm").trim().toLowerCase();
  return backendType === "container" ? "container" : "vm";
}

function normalizePocProjectName(value) {
  const normalized = String(value || "").trim();
  return !normalized || normalized.toLowerCase() === "poc" ? DEFAULT_POC_PROJECT_NAME : normalized;
}
const ENV_PAYMENT_GATEWAY_ENABLED = String(process.env.PAYMENT_GATEWAY_ENABLED || process.env.TOSS_PAYMENTS_ENABLED || "").trim().toLowerCase();
const ENV_PAYMENT_GATEWAY_MERCHANT_ID = String(process.env.PAYMENT_GATEWAY_MERCHANT_ID || process.env.TOSS_PAYMENTS_MERCHANT_ID || "").trim();
const ENV_PAYMENT_GATEWAY_API_BASE_URL = String(process.env.PAYMENT_GATEWAY_API_BASE_URL || process.env.TOSS_PAYMENTS_API_BASE_URL || "").trim();
const ENV_PAYMENT_GATEWAY_PUBLIC_KEY = String(process.env.PAYMENT_GATEWAY_PUBLIC_KEY || process.env.TOSS_PAYMENTS_PUBLIC_KEY || "").trim();
const ENV_PAYMENT_GATEWAY_SECRET_KEY = String(process.env.PAYMENT_GATEWAY_SECRET_KEY || process.env.TOSS_PAYMENTS_SECRET_KEY || "").trim();
const ENV_PAYMENT_GATEWAY_WEBHOOK_SECRET = String(process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET || process.env.TOSS_PAYMENTS_WEBHOOK_SECRET || "").trim();
const ENV_PAYMENT_GATEWAY_USE_DOCS_TEST_KEYS = String(process.env.PAYMENT_GATEWAY_USE_DOCS_TEST_KEYS || process.env.TOSS_PAYMENTS_USE_DOCS_TEST_KEYS || "").trim().toLowerCase();
const DOCS_TOSS_PUBLIC_KEY = "";
const DOCS_TOSS_SECRET_KEY = "";
let pool = null;
let pgSchemaEnsured = false;

function resolveEnvPaymentGatewayProvider() {
  if (["toss", "tosspayment", "tosspayments", "toss-payments"].includes(ENV_PAYMENT_GATEWAY_PROVIDER)) return "tosspayments";
  if (["portone", "iamport"].includes(ENV_PAYMENT_GATEWAY_PROVIDER)) return "portone";
  if (ENV_PAYMENT_GATEWAY_PROVIDER === "manual") return "manual";
  return "";
}

function resolveEnvPaymentGatewayEnabled() {
  if (!ENV_PAYMENT_GATEWAY_ENABLED) return null;
  return ["1", "true", "yes", "on", "enabled"].includes(ENV_PAYMENT_GATEWAY_ENABLED);
}

function useDocsTossTestKeys() {
  return ["1", "true", "yes", "on", "enabled"].includes(ENV_PAYMENT_GATEWAY_USE_DOCS_TEST_KEYS);
}

const COURSE_SELECT = `
  SELECT c.id, c.slug, c.category, c.course_type AS "courseType", c.package_items_json AS "packageItemsJson", c.program_type AS "programType", c.title, c.summary, c.price, c.duration, c.course_access_days AS "courseAccessDays", c.level, c.body,
         c.promo_enabled AS "promoEnabled", c.promo_price AS "promoPrice", c.promo_starts_at AS "promoStartsAt", c.promo_ends_at AS "promoEndsAt",
         c.youtube_url AS "youtubeUrl", c.online_meeting_url AS "onlineMeetingUrl", c.online_board_url AS "onlineBoardUrl", c.online_course_notice AS "onlineCourseNotice", c.online_session_note AS "onlineSessionNote", c.objectives_json AS "objectivesJson",
         c.lab_guide_markdown AS "labGuideMarkdown", c.commands_markdown AS "commandsMarkdown", c.ai_system_prompt AS "aiSystemPrompt", c.ai_quick_prompts_json AS "aiQuickPromptsJson", c.materials_json AS "materialsJson", c.course_curriculum_json AS "courseCurriculumJson", c.course_videos_json AS "courseVideosJson", c.course_recordings_json AS "courseRecordingsJson", c.example_files_json AS "exampleFilesJson", c.git_repositories_json AS "gitRepositoriesJson", c.external_tool_links_json AS "externalToolLinksJson", c.external_learning_tools_json AS "externalLearningToolsJson", c.lab_start_checklist_json AS "labStartChecklistJson", c.survey_config_json AS "surveyConfigJson",
         c.lab_enabled AS "labEnabled", c.lab_approval_mode AS "labApprovalMode", c.public_domain_approval_mode AS "publicDomainApprovalMode",
         c.public_tcp_approval_mode AS "publicTcpApprovalMode",
         c.external_ssh_approval_mode AS "externalSshApprovalMode",
         c.external_rdp_approval_mode AS "externalRdpApprovalMode",
         c.external_ssh_route_mode AS "externalSshRouteMode",
         c.lab_backend_type AS "labBackendType", c.container_image_name AS "containerImageName",
         c.container_command_text AS "containerCommandText", c.container_exposed_port AS "containerExposedPort",
         c.container_access_mode AS "containerAccessMode", c.container_console_mode AS "containerConsoleMode",
         c.lab_retention_mode AS "labRetentionMode", c.lab_retention_preset AS "labRetentionPreset",
         c.lab_retention_days AS "labRetentionDays", c.allow_resume_existing_lab AS "allowResumeExistingLab",
         c.lab_resize_policy AS "labResizePolicy", c.lab_resize_allowed_flavors AS "labResizeAllowedFlavors",
         c.terminal_replay_mode AS "terminalReplayMode",
         c.traffic_monitoring_enabled AS "trafficMonitoringEnabled", c.traffic_daily_limit_gb AS "trafficDailyLimitGb",
         c.traffic_total_limit_gb AS "trafficTotalLimitGb", c.traffic_exceeded_action AS "trafficExceededAction",
         c.heat_api_url AS "heatApiUrl", c.heat_template_name AS "heatTemplateName",
       c.heat_stack_prefix AS "heatStackPrefix", c.heat_parameters_json AS "heatParametersJson",
       c.terminal_ssh_user AS "terminalSshUser", c.terminal_ssh_port AS "terminalSshPort",
       c.terminal_jump_host AS "terminalJumpHost", c.terminal_jump_user AS "terminalJumpUser",
       c.is_published AS "isPublished", c.is_landing_preview AS "isLandingPreview", c.course_status AS "courseStatus",
       c.release_label AS "releaseLabel", c.access_scope AS "accessScope", c.access_code AS "accessCode",
       c.created_at AS "createdAt", c.updated_at AS "updatedAt"
`;

const COURSE_FREE_PROMOTION_SQL = `(
  COALESCE(c.promo_enabled, 0)=1
  AND COALESCE(c.promo_price, 0) <= 0
  AND NULLIF(c.promo_starts_at, '') IS NOT NULL
  AND NULLIF(c.promo_ends_at, '') IS NOT NULL
  AND NULLIF(c.promo_starts_at, '')::timestamptz <= NOW()
  AND NULLIF(c.promo_ends_at, '')::timestamptz > NOW()
)`;

const LAB_SELECT = `
SELECT lr.*, u.name AS "userName", u.username, c.title AS "courseTitle", c.slug AS "courseSlug",
       c.summary AS "courseSummary", c.category AS "courseCategory", c.heat_template_name AS "courseHeatTemplateName"
FROM lab_requests lr
JOIN users u ON u.id = lr.user_id
JOIN courses c ON c.id = lr.course_id
`;
const LAB_ACTIVE_RECORD_CLAUSE = "COALESCE(lr.archived_at, '') = ''";
const OLD_LAB_REQUEST_ARCHIVE_STATUSES = ["terminated", "failed", "deleted", "deleting", "cancelled", "canceled", "rejected"];
const LAB_ADMIN_IN_USE_QUERY_STATUSES = ["provisioning", "running", "paused", "stopped"];

const ARENA_SEASON_SELECT = `
SELECT s.id, s.code, s.title, s.status, s.reset_policy AS "resetPolicy",
       s.started_at AS "startedAt", s.ends_at AS "endsAt", s.created_at AS "createdAt"
FROM arena_seasons s
`;

const ARENA_SCENARIO_SELECT = `
SELECT s.id, s.code, s.title, s.summary, s.backend_type AS "backendType", s.console_type AS "consoleType",
       s.tier, s.difficulty, s.ttl_seconds AS "ttlSeconds", s.validator_key AS "validatorKey",
       s.image_name AS "imageName", s.flavor_name AS "flavorName", s.network_name AS "networkName",
       s.metadata_json AS "metadataJson", s.created_at AS "createdAt"
FROM arena_scenarios s
`;

const ARENA_NODE_SELECT = `
SELECT n.id, n.season_id AS "seasonId", n.scenario_id AS "scenarioId", n.node_code AS "nodeCode", n.label,
       n.map_x AS "mapX", n.map_y AS "mapY", n.current_owner_user_id AS "currentOwnerUserId",
       n.current_owner_handle AS "currentOwnerHandle", n.first_capture_at AS "firstCaptureAt",
       n.status, n.created_at AS "createdAt", sc.code AS "scenarioCode", sc.backend_type AS "backendType",
       sc.console_type AS "consoleType", sc.tier, sc.title AS "scenarioTitle"
FROM arena_nodes n
JOIN arena_scenarios sc ON sc.id = n.scenario_id
`;

const ARENA_SESSION_SELECT = `
SELECT s.id, s.season_id AS "seasonId", s.node_id AS "nodeId", s.scenario_id AS "scenarioId", s.user_id AS "userId",
       s.state, s.backend_type AS "backendType", s.console_type AS "consoleType", s.resource_id AS "resourceId",
       s.resource_name AS "resourceName", s.console_url AS "consoleUrl", s.validator_state AS "validatorState",
       s.started_at AS "startedAt", s.expires_at AS "expiresAt", s.ended_at AS "endedAt",
       s.terminated_reason AS "terminatedReason", s.metadata_json AS "metadataJson",
       n.node_code AS "nodeCode", n.label AS "nodeLabel", sc.code AS "scenarioCode", sc.title AS "scenarioTitle"
FROM arena_sessions s
JOIN arena_nodes n ON n.id = s.node_id
JOIN arena_scenarios sc ON sc.id = s.scenario_id
`;

function getPool() {
  if (!pool) pool = new Pool({ connectionString: DATABASE_URL, max: DATABASE_POOL_MAX_CONNECTIONS, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
  return pool;
}

export function runtimeGetDatabasePoolStats() {
  if (!pool) {
    return {
      initialized: false,
      max: DATABASE_POOL_MAX_CONNECTIONS,
      total: 0,
      idle: 0,
      waiting: 0,
    };
  }
  return {
    initialized: true,
    max: DATABASE_POOL_MAX_CONNECTIONS,
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

export async function runtimeProbeDatabase() {
  try {
    await withClient((client) => client.query("SELECT 1"));
    return true;
  } catch {
    return false;
  }
}

export async function runtimeCloseDatabasePool() {
  const activePool = pool;
  pool = null;
  pgSchemaEnsured = false;
  if (activePool) await activePool.end();
}

async function withClient(fn) {
  const p = getPool();
  if (!p) throw new Error("PostgreSQL is not configured.");
  if (!pgSchemaEnsured) {
    await ensurePostgresSchemaCompatibility();
    pgSchemaEnsured = true;
  }
  const waitStartedAt = process.hrtime.bigint();
  const client = await p.connect();
  const waitMs = Number(process.hrtime.bigint() - waitStartedAt) / 1e6;
  if (DATABASE_POOL_WAIT_LOG_THRESHOLD_MS > 0 && waitMs >= DATABASE_POOL_WAIT_LOG_THRESHOLD_MS) {
    console.warn("[perf] postgres-pool-wait", {
      ms: Math.round(waitMs),
      ...runtimeGetDatabasePoolStats(),
    });
  }
  try { return await fn(client); } finally { client.release(); }
}
async function withTx(fn) {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
async function pgWithExternalPortLock(fn) {
  return withTx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", ["terminal_lab_external_ports"]);
    return fn();
  });
}
async function pgWithMetalLbVipAllocationLock(fn) {
  return withTx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", ["terminal_lab_metallb_vip_allocation"]);
    return fn();
  });
}
async function ensureCicdTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS cicd_projects (
      id BIGINT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id BIGINT REFERENCES courses(id) ON DELETE SET NULL,
      lab_request_id BIGINT REFERENCES lab_requests(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT 'manual',
      repository_url TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT 'main',
      pipeline_engine TEXT NOT NULL DEFAULT 'jenkins',
      jenkins_job_name TEXT NOT NULL DEFAULT '',
      jenkinsfile_path TEXT NOT NULL DEFAULT 'Jenkinsfile',
      build_server_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      variables_json TEXT NOT NULL DEFAULT '{}',
      stages_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, slug)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS cicd_runs (
      id BIGINT PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES cicd_projects(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      commit_ref TEXT NOT NULL DEFAULT '',
      commit_sha TEXT NOT NULL DEFAULT '',
      source_branch TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      current_stage TEXT NOT NULL DEFAULT '',
      jenkins_build_number TEXT NOT NULL DEFAULT '',
      result_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS cicd_run_events (
      id BIGINT PRIMARY KEY,
      run_id BIGINT NOT NULL REFERENCES cicd_runs(id) ON DELETE CASCADE,
      stage TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_cicd_projects_user_status ON cicd_projects(user_id, status, updated_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_cicd_projects_course ON cicd_projects(course_id)`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS cicd_credentials (
      id BIGINT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      credential_type TEXT NOT NULL,
      jenkins_credential_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, slug)
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_cicd_credentials_user_updated ON cicd_credentials(user_id, updated_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_cicd_runs_project_created ON cicd_runs(project_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_cicd_runs_user_created ON cicd_runs(user_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_cicd_runs_status_created ON cicd_runs(status, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_cicd_run_events_run_created ON cicd_run_events(run_id, created_at ASC, id ASC)`);
  await client.query(`ALTER TABLE cicd_projects ADD COLUMN IF NOT EXISTS jenkins_job_name TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE cicd_projects ADD COLUMN IF NOT EXISTS jenkinsfile_path TEXT NOT NULL DEFAULT 'Jenkinsfile'`);
  await client.query(`ALTER TABLE cicd_runs ADD COLUMN IF NOT EXISTS jenkins_build_number TEXT NOT NULL DEFAULT ''`);
}

async function ensureHeatWorkloadTestTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS heat_workload_test_jobs (
      job_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'queued',
      phase TEXT NOT NULL DEFAULT 'queued',
      message TEXT NOT NULL DEFAULT '',
      template_name TEXT NOT NULL DEFAULT '',
      project_name TEXT NOT NULL DEFAULT '',
      stack_name TEXT NOT NULL DEFAULT '',
      stack_id TEXT NOT NULL DEFAULT '',
      stack_count INTEGER NOT NULL DEFAULT 1,
      created_stack_count INTEGER NOT NULL DEFAULT 0,
      ready_stack_count INTEGER NOT NULL DEFAULT 0,
      failed_stack_count INTEGER NOT NULL DEFAULT 0,
      pending_stack_count INTEGER NOT NULL DEFAULT 0,
      hold_seconds INTEGER NOT NULL DEFAULT 0,
      cleanup_due_at TEXT,
      started_at TEXT,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      error_message TEXT NOT NULL DEFAULT '',
      result_json TEXT NOT NULL DEFAULT '{}',
      stack_status_summary_json TEXT NOT NULL DEFAULT '{}',
      host_usage_report_json TEXT NOT NULL DEFAULT '{}',
      stacks_json TEXT NOT NULL DEFAULT '[]',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_by_username TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_heat_workload_test_jobs_status_updated ON heat_workload_test_jobs(status, updated_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_heat_workload_test_jobs_project_updated ON heat_workload_test_jobs(project_name, updated_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_heat_workload_test_jobs_template_updated ON heat_workload_test_jobs(template_name, updated_at DESC)`);
}

async function ensurePostgresSchemaCompatibility() {
  const p = getPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS written_exam_attempts (
        id TEXT PRIMARY KEY,
        course_id BIGINT NOT NULL,
        exam_title TEXT NOT NULL,
        user_id BIGINT NOT NULL REFERENCES users(id),
        user_name TEXT NOT NULL,
        username TEXT NOT NULL,
        answers_json TEXT NOT NULL DEFAULT '{}',
        score INTEGER NOT NULL DEFAULT 0,
        total_points INTEGER NOT NULL DEFAULT 0,
        passed INTEGER NOT NULL DEFAULT 0,
        results_json TEXT NOT NULL DEFAULT '[]',
        submitted_at TEXT NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS lab_exam_attempts (
        id TEXT PRIMARY KEY,
        course_id BIGINT NOT NULL,
        exam_title TEXT NOT NULL,
        user_id BIGINT NOT NULL REFERENCES users(id),
        user_name TEXT NOT NULL,
        username TEXT NOT NULL,
        session_id TEXT,
        lab_request_id BIGINT,
        exit_code INTEGER NOT NULL DEFAULT 1,
        stdout_text TEXT NOT NULL DEFAULT '',
        stderr_text TEXT NOT NULL DEFAULT '',
        score INTEGER NOT NULL DEFAULT 0,
        total_points INTEGER NOT NULL DEFAULT 0,
        passed INTEGER NOT NULL DEFAULT 0,
        messages_json TEXT NOT NULL DEFAULT '[]',
        screenshot_path TEXT NOT NULL DEFAULT '',
        screenshot_url TEXT NOT NULL DEFAULT '',
        result_snapshot_json TEXT NOT NULL DEFAULT '{}',
        review_status TEXT NOT NULL DEFAULT 'pending',
        review_note TEXT NOT NULL DEFAULT '',
        reviewed_by BIGINT REFERENCES users(id),
        reviewed_at TEXT,
        result_mail_sent_at TEXT,
        submitted_at TEXT NOT NULL
      )
    `);
    await client.query(`ALTER TABLE lab_exam_attempts ADD COLUMN IF NOT EXISTS screenshot_path TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_exam_attempts ADD COLUMN IF NOT EXISTS screenshot_url TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_exam_attempts ADD COLUMN IF NOT EXISTS result_snapshot_json TEXT NOT NULL DEFAULT '{}'`);
    await client.query(`ALTER TABLE lab_exam_attempts ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending'`);
    await client.query(`ALTER TABLE lab_exam_attempts ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_exam_attempts ADD COLUMN IF NOT EXISTS reviewed_by BIGINT REFERENCES users(id)`);
    await client.query(`ALTER TABLE lab_exam_attempts ADD COLUMN IF NOT EXISTS reviewed_at TEXT`);
    await client.query(`ALTER TABLE lab_exam_attempts ADD COLUMN IF NOT EXISTS review_history_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE lab_exam_attempts ADD COLUMN IF NOT EXISTS result_mail_sent_at TEXT`);
    await client.query(`ALTER TABLE lab_exam_attempts ADD COLUMN IF NOT EXISTS session_id TEXT`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS lab_exam_sessions (
        id TEXT PRIMARY KEY,
        course_id BIGINT NOT NULL,
        exam_title TEXT NOT NULL DEFAULT '',
        user_id BIGINT NOT NULL REFERENCES users(id),
        lab_request_id BIGINT,
        attempt_id TEXT,
        status TEXT NOT NULL DEFAULT 'preparing',
        started_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        ended_at TEXT,
        grading_started_at TEXT,
        grading_finished_at TEXT,
        end_reason TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_exam_sessions_user_course_status ON lab_exam_sessions(user_id, course_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_exam_sessions_lab ON lab_exam_sessions(lab_request_id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS lab_exam_configs (
        course_id BIGINT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
        config_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS certificates (
        id TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id),
        user_name TEXT NOT NULL,
        username TEXT NOT NULL,
        course_id BIGINT NOT NULL,
        course_title TEXT NOT NULL,
        certificate_code TEXT NOT NULL UNIQUE,
        verify_code TEXT NOT NULL UNIQUE,
        written_attempt_id TEXT,
        lab_attempt_id TEXT,
        issued_at TEXT NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_access_logs (
        id BIGINT PRIMARY KEY,
        user_id BIGINT REFERENCES users(id),
        user_name TEXT NOT NULL DEFAULT '',
        username TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL,
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_access_logs_user_created ON user_access_logs(user_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_access_logs_event_created ON user_access_logs(event_type, created_at DESC)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id BIGINT PRIMARY KEY,
        admin_user_id BIGINT REFERENCES users(id),
        admin_username TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT '',
        target_id TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON admin_audit_logs(created_at DESC, id DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action_created ON admin_audit_logs(action, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target_created ON admin_audit_logs(target_type, target_id, created_at DESC)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS terminal_replay_sessions (
        id TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        lab_request_id BIGINT,
        course_id BIGINT,
        node_id TEXT NOT NULL DEFAULT '',
        node_name TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT '',
        target_label TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'recording',
        metadata_json TEXT NOT NULL DEFAULT '{}'
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS terminal_replay_events (
        id BIGINT PRIMARY KEY,
        replay_session_id TEXT NOT NULL REFERENCES terminal_replay_sessions(id) ON DELETE CASCADE,
        offset_ms INTEGER NOT NULL DEFAULT 0,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_terminal_replay_sessions_user_started ON terminal_replay_sessions(user_id, started_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_terminal_replay_sessions_lab_started ON terminal_replay_sessions(lab_request_id, started_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_terminal_replay_events_session_offset ON terminal_replay_events(replay_session_id, offset_ms, id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS terminal_session_registry (
        id TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        resource_type TEXT NOT NULL DEFAULT 'lab',
        lab_request_id BIGINT,
        custom_lab_request_id BIGINT,
        course_id BIGINT,
        host TEXT NOT NULL DEFAULT '',
        host_type TEXT NOT NULL DEFAULT '',
        node_id TEXT NOT NULL DEFAULT '',
        node_name TEXT NOT NULL DEFAULT '',
        username TEXT NOT NULL DEFAULT '',
        port INTEGER NOT NULL DEFAULT 22,
        jump_host TEXT NOT NULL DEFAULT '',
        jump_user TEXT NOT NULL DEFAULT '',
        exam_session_id TEXT NOT NULL DEFAULT '',
        replay_metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_terminal_session_registry_user_activity ON terminal_session_registry(user_id, last_activity_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_terminal_session_registry_expires ON terminal_session_registry(expires_at)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS openstack_resource_usage_snapshots (
        id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL DEFAULT '',
        driver TEXT NOT NULL DEFAULT '',
        resource_key TEXT NOT NULL,
        resource_label TEXT NOT NULL DEFAULT '',
        used_value DOUBLE PRECISION NOT NULL DEFAULT 0,
        limit_value DOUBLE PRECISION NOT NULL DEFAULT 0,
        percent INTEGER NOT NULL DEFAULT 0,
        unit TEXT NOT NULL DEFAULT '',
        collected_at TEXT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_openstack_usage_project_resource_collected ON openstack_resource_usage_snapshots(project_name, resource_key, collected_at DESC)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_session_devices (
        session_id TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ip_address TEXT NOT NULL DEFAULT '',
        ip_prefix TEXT NOT NULL DEFAULT '',
        user_agent_hash TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        warned_at TEXT,
        restricted_at TEXT,
        status TEXT NOT NULL DEFAULT 'active'
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_session_devices_user_last_seen ON user_session_devices(user_id, last_seen_at)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_access_restrictions (
        id BIGINT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason TEXT NOT NULL DEFAULT '',
        restricted_until TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        resolved_at TEXT
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_access_restrictions_user_until ON user_access_restrictions(user_id, restricted_until)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_notifications (
        id BIGINT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id),
        type TEXT NOT NULL DEFAULT 'system',
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        link_section TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        read_at TEXT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_messages (
        id BIGINT PRIMARY KEY,
        sender_id BIGINT NOT NULL REFERENCES users(id),
        recipient_id BIGINT NOT NULL REFERENCES users(id),
        subject TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        read_at TEXT,
        sender_archived INTEGER NOT NULL DEFAULT 0,
        recipient_archived INTEGER NOT NULL DEFAULT 0
      )
    `);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS ai_system_prompt TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS ai_quick_prompts_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_curriculum_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_videos_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS example_files_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS git_repositories_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS promo_enabled INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS promo_price INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS promo_starts_at TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS promo_ends_at TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_access_days INTEGER NOT NULL DEFAULT 30`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_landing_preview INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_status TEXT NOT NULL DEFAULT 'published'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS release_label TEXT NOT NULL DEFAULT ''`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS textbooks (
        id BIGINT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        content_markdown TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        version TEXT NOT NULL DEFAULT '1.0',
        created_by BIGINT REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS course_textbooks (
        id BIGINT PRIMARY KEY,
        course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        textbook_id BIGINT NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        required INTEGER NOT NULL DEFAULT 0,
        visible INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(course_id, textbook_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_course_textbooks_course_order ON course_textbooks(course_id, sort_order, id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_course_textbooks_textbook ON course_textbooks(textbook_id)`);
    await client.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS sender_archived INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS recipient_archived INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS recipient_type TEXT NOT NULL DEFAULT 'user'`);
    await client.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS recipient_group_key TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS recipient_group_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS delivery_group_id TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS cleanup_status TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS cleanup_status_note TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS cleanup_status_updated_at TEXT`);
    await client.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS cleanup_status_updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created ON user_notifications(user_id, created_at DESC, id DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_messages_recipient_created ON user_messages(recipient_id, recipient_archived, created_at DESC, id DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_messages_sender_created ON user_messages(sender_id, sender_archived, created_at DESC, id DESC)`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'learning'`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS exam_session_id TEXT`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS archived_at TEXT`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS archived_reason TEXT NOT NULL DEFAULT ''`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_exam_session ON lab_requests(exam_session_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_archived_status_created ON lab_requests(archived_at, status, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_archived_user_created ON lab_requests(archived_at, user_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_archived_course_created ON lab_requests(archived_at, course_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_created ON lab_requests(created_at DESC, id DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_status_created ON lab_requests(status, created_at DESC, id DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_stack_name ON lab_requests(stack_name)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_instance_ip ON lab_requests(instance_ip)`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS support_message_enabled INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS self_service_vm_enabled INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poc_free_access_enabled INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS instructor_share_enabled INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_permissions_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS external_tool_links_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS external_learning_tools_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS lab_start_checklist_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_recordings_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS lab_exam_config_json TEXT NOT NULL DEFAULT '{}'`);
    await client.query(`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS schedule_source TEXT NOT NULL DEFAULT 'manual'`);
    await client.query(`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS external_event_id TEXT NOT NULL DEFAULT ''`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_schedule_events_external_source ON schedule_events(schedule_source, external_event_id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_marketing_consents (
        id BIGINT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel TEXT NOT NULL DEFAULT 'email',
        purpose TEXT NOT NULL DEFAULT 'marketing',
        consented INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT '',
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        agreed_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_marketing_consents_user_created ON user_marketing_consents(user_id, created_at DESC)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id BIGINT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id),
        course_id BIGINT NOT NULL REFERENCES courses(id),
        provider TEXT NOT NULL DEFAULT 'manual',
        order_id TEXT NOT NULL UNIQUE,
        payment_key TEXT UNIQUE,
        provider_order_id TEXT NOT NULL DEFAULT '',
        amount INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'KRW',
        status TEXT NOT NULL DEFAULT 'ready',
        failure_reason TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        requested_at TEXT NOT NULL,
        ready_at TEXT,
        paid_at TEXT,
        failed_at TEXT,
        cancelled_at TEXT,
        reviewed_by BIGINT REFERENCES users(id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS exam_entitlements (
        id TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        exam_course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        source TEXT NOT NULL DEFAULT 'admin',
        source_payment_id BIGINT REFERENCES payments(id) ON DELETE SET NULL,
        required_course_id BIGINT REFERENCES courses(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'active',
        granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        granted_at TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT,
        revoke_reason TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}'
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_exam_entitlements_user_exam_status ON exam_entitlements(user_id, exam_course_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_exam_entitlements_payment ON exam_entitlements(source_payment_id)`);
    const legacyExamAccessRows = (await client.query(`
      SELECT uca.user_id, uca.course_id, uca.granted_via, uca.created_at, uca.expires_at,
        (SELECT p.id FROM payments p WHERE p.user_id=uca.user_id AND p.course_id=uca.course_id AND p.status='paid' ORDER BY p.paid_at DESC NULLS LAST, p.id DESC LIMIT 1) AS source_payment_id
      FROM user_course_access uca
      WHERE uca.granted_via IN ('payment','free_self_enrollment','purchase_request','admin_manual','signup_code','invite_code','redeem_code','promotion_claim','exam_promotion','exam_free')
        AND NOT EXISTS (
          SELECT 1 FROM exam_entitlements ee
          WHERE ee.user_id=uca.user_id AND ee.exam_course_id=uca.course_id AND ee.status='active'
        )
    `)).rows;
    for (const row of legacyExamAccessRows) {
      const grantedVia = String(row.granted_via || "").toLowerCase();
      if (grantedVia === "payment" && !row.source_payment_id) continue;
      const source = grantedVia === "payment"
        ? "payment"
        : ["signup_code", "invite_code", "redeem_code", "promotion_claim", "exam_promotion"].includes(grantedVia)
          ? "promotion"
          : ["free_self_enrollment", "exam_free"].includes(grantedVia)
            ? "free"
            : "admin";
      await client.query(
        `INSERT INTO exam_entitlements (id,user_id,exam_course_id,source,source_payment_id,status,granted_at,expires_at,metadata_json)
         VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8)`,
        [randomUUID(), row.user_id, row.course_id, source, row.source_payment_id || null, row.created_at || new Date().toISOString(), row.expires_at || null, JSON.stringify({ migratedFrom: "user_course_access", grantedVia })],
      );
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS course_quotes (
        id BIGINT PRIMARY KEY,
        quote_no TEXT NOT NULL UNIQUE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'issued',
        recipient_company_name TEXT NOT NULL DEFAULT '',
        recipient_name TEXT NOT NULL DEFAULT '',
        recipient_email TEXT NOT NULL DEFAULT '',
        recipient_phone TEXT NOT NULL DEFAULT '',
        subtotal_amount INTEGER NOT NULL DEFAULT 0,
        discount_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
        discount_amount INTEGER NOT NULL DEFAULT 0,
        vat_rate DOUBLE PRECISION NOT NULL DEFAULT 0.1,
        vat_amount INTEGER NOT NULL DEFAULT 0,
        total_amount INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'KRW',
        pricing_basis_json TEXT NOT NULL DEFAULT '{}',
        business_snapshot_json TEXT NOT NULL DEFAULT '{}',
        note TEXT NOT NULL DEFAULT '',
        issued_at TEXT NOT NULL,
        valid_until TEXT,
        sent_at TEXT,
        sent_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        accepted_at TEXT,
        cancelled_at TEXT,
        reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await client.query(`ALTER TABLE course_quotes ADD COLUMN IF NOT EXISTS sent_at TEXT`);
    await client.query(`ALTER TABLE course_quotes ADD COLUMN IF NOT EXISTS sent_by BIGINT REFERENCES users(id) ON DELETE SET NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_course_quotes_user_issued ON course_quotes(user_id, issued_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_course_quotes_status_issued ON course_quotes(status, issued_at DESC)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS course_quote_items (
        id BIGINT PRIMARY KEY,
        quote_id BIGINT NOT NULL REFERENCES course_quotes(id) ON DELETE CASCADE,
        course_id BIGINT REFERENCES courses(id) ON DELETE SET NULL,
        course_title TEXT NOT NULL DEFAULT '',
        course_slug TEXT NOT NULL DEFAULT '',
        course_category TEXT NOT NULL DEFAULT '',
        course_type TEXT NOT NULL DEFAULT 'standard',
        program_type TEXT NOT NULL DEFAULT '',
        duration TEXT NOT NULL DEFAULT '',
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price INTEGER NOT NULL DEFAULT 0,
        line_subtotal INTEGER NOT NULL DEFAULT 0,
        pricing_note TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_course_quote_items_quote ON course_quote_items(quote_id, sort_order, id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS discount_coupons (
        id BIGINT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
        course_id BIGINT REFERENCES courses(id) ON DELETE CASCADE,
        source TEXT NOT NULL DEFAULT 'manual',
        discount_type TEXT NOT NULL DEFAULT 'percent',
        discount_value INTEGER NOT NULL DEFAULT 0,
        max_uses INTEGER NOT NULL DEFAULT 1,
        used_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        expires_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        used_at TEXT
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_discount_coupons_user_status ON discount_coupons(user_id, status)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS terms_versions (
        id BIGINT PRIMARY KEY,
        terms_key TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 0,
        created_by BIGINT REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        published_at TEXT,
        UNIQUE(terms_key, version)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_terms_versions_key_active ON terms_versions(terms_key, is_active)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_terms_agreements (
        id BIGINT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        terms_version_id BIGINT NOT NULL REFERENCES terms_versions(id),
        terms_key TEXT NOT NULL,
        terms_title TEXT NOT NULL DEFAULT '',
        terms_version TEXT NOT NULL,
        terms_summary TEXT NOT NULL DEFAULT '',
        terms_body TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        agreed_at TEXT NOT NULL
      )
    `);
    await client.query(`ALTER TABLE user_terms_agreements ADD COLUMN IF NOT EXISTS terms_title TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_terms_agreements ADD COLUMN IF NOT EXISTS terms_summary TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_terms_agreements ADD COLUMN IF NOT EXISTS terms_body TEXT NOT NULL DEFAULT ''`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_terms_agreements_user ON user_terms_agreements(user_id, agreed_at DESC)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS consulting_requests (
        id BIGINT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'requested',
        title TEXT NOT NULL,
        company_name TEXT NOT NULL DEFAULT '',
        contact_name TEXT NOT NULL DEFAULT '',
        contact_email TEXT NOT NULL DEFAULT '',
        contact_phone TEXT NOT NULL DEFAULT '',
        inquiry_type TEXT NOT NULL DEFAULT '',
        industry TEXT NOT NULL DEFAULT '',
        current_environment TEXT NOT NULL DEFAULT '',
        requirements TEXT NOT NULL DEFAULT '',
        budget_range TEXT NOT NULL DEFAULT '',
        desired_timeline TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        admin_note TEXT NOT NULL DEFAULT '',
        reviewed_by BIGINT REFERENCES users(id),
        created_at TEXT NOT NULL,
        reviewed_at TEXT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public_quote_inquiries (
        id BIGINT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'requested',
        company_name TEXT NOT NULL DEFAULT '',
        contact_name TEXT NOT NULL DEFAULT '',
        contact_email TEXT NOT NULL DEFAULT '',
        contact_phone TEXT NOT NULL DEFAULT '',
        interest_type TEXT NOT NULL DEFAULT '',
        course_titles TEXT NOT NULL DEFAULT '',
        participant_count INTEGER NOT NULL DEFAULT 1,
        desired_timeline TEXT NOT NULL DEFAULT '',
        requirements TEXT NOT NULL DEFAULT '',
        privacy_agreed INTEGER NOT NULL DEFAULT 0,
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        admin_note TEXT NOT NULL DEFAULT '',
        reviewed_by BIGINT REFERENCES users(id),
        created_at TEXT NOT NULL,
        reviewed_at TEXT
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_public_quote_inquiries_status_created ON public_quote_inquiries(status, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_public_quote_inquiries_email_created ON public_quote_inquiries(contact_email, created_at DESC)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS arena_seasons (
        id BIGINT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        reset_policy TEXT NOT NULL DEFAULT 'quarterly',
        started_at TEXT,
        ends_at TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS arena_scenarios (
        id BIGINT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        backend_type TEXT NOT NULL DEFAULT 'container',
        console_type TEXT NOT NULL DEFAULT 'xterm',
        tier TEXT NOT NULL DEFAULT 'normal',
        difficulty INTEGER NOT NULL DEFAULT 1,
        ttl_seconds INTEGER NOT NULL DEFAULT 1200,
        validator_key TEXT NOT NULL DEFAULT '',
        image_name TEXT NOT NULL DEFAULT '',
        flavor_name TEXT NOT NULL DEFAULT '',
        network_name TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS arena_nodes (
        id BIGINT PRIMARY KEY,
        season_id BIGINT NOT NULL REFERENCES arena_seasons(id) ON DELETE CASCADE,
        scenario_id BIGINT NOT NULL REFERENCES arena_scenarios(id),
        node_code TEXT NOT NULL,
        label TEXT NOT NULL,
        map_x DOUBLE PRECISION NOT NULL DEFAULT 0,
        map_y DOUBLE PRECISION NOT NULL DEFAULT 0,
        current_owner_user_id BIGINT REFERENCES users(id),
        current_owner_handle TEXT NOT NULL DEFAULT '',
        first_capture_at TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        UNIQUE(season_id, node_code)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS arena_sessions (
        id BIGINT PRIMARY KEY,
        season_id BIGINT NOT NULL REFERENCES arena_seasons(id),
        node_id BIGINT NOT NULL REFERENCES arena_nodes(id),
        scenario_id BIGINT NOT NULL REFERENCES arena_scenarios(id),
        user_id BIGINT NOT NULL REFERENCES users(id),
        state TEXT NOT NULL DEFAULT 'provisioning',
        backend_type TEXT NOT NULL DEFAULT 'container',
        console_type TEXT NOT NULL DEFAULT 'xterm',
        resource_id TEXT NOT NULL DEFAULT '',
        resource_name TEXT NOT NULL DEFAULT '',
        console_url TEXT NOT NULL DEFAULT '',
        validator_state TEXT NOT NULL DEFAULT 'pending',
        started_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        ended_at TEXT,
        terminated_reason TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}'
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS arena_attempts (
        id BIGINT PRIMARY KEY,
        session_id BIGINT NOT NULL UNIQUE REFERENCES arena_sessions(id) ON DELETE CASCADE,
        season_id BIGINT NOT NULL REFERENCES arena_seasons(id),
        node_id BIGINT NOT NULL REFERENCES arena_nodes(id),
        user_id BIGINT NOT NULL REFERENCES users(id),
        result TEXT NOT NULL DEFAULT 'failed',
        score INTEGER NOT NULL DEFAULT 0,
        mmr_delta INTEGER NOT NULL DEFAULT 0,
        rank_delta INTEGER NOT NULL DEFAULT 0,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        first_try_bonus INTEGER NOT NULL DEFAULT 0,
        remaining_seconds INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS arena_captures (
        id BIGINT PRIMARY KEY,
        season_id BIGINT NOT NULL REFERENCES arena_seasons(id),
        node_id BIGINT NOT NULL REFERENCES arena_nodes(id),
        user_id BIGINT NOT NULL REFERENCES users(id),
        capture_type TEXT NOT NULL DEFAULT 'first_blood',
        created_at TEXT NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS arena_events (
        id BIGINT PRIMARY KEY,
        season_id BIGINT NOT NULL REFERENCES arena_seasons(id),
        node_id BIGINT REFERENCES arena_nodes(id),
        user_id BIGINT REFERENCES users(id),
        event_type TEXT NOT NULL DEFAULT 'system',
        message TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS lucky_draw_events (
        id BIGINT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        daily_attempt_limit INTEGER NOT NULL DEFAULT 3,
        require_verified_user INTEGER NOT NULL DEFAULT 1,
        allow_new_users_only INTEGER NOT NULL DEFAULT 0,
        new_user_window_days INTEGER NOT NULL DEFAULT 30,
        allow_dormant_users_only INTEGER NOT NULL DEFAULT 0,
        dormant_days INTEGER NOT NULL DEFAULT 30,
        created_by BIGINT REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await client.query(`ALTER TABLE lucky_draw_events ADD COLUMN IF NOT EXISTS allow_new_users_only INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lucky_draw_events ADD COLUMN IF NOT EXISTS new_user_window_days INTEGER NOT NULL DEFAULT 30`);
    await client.query(`ALTER TABLE lucky_draw_events ADD COLUMN IF NOT EXISTS allow_dormant_users_only INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lucky_draw_events ADD COLUMN IF NOT EXISTS dormant_days INTEGER NOT NULL DEFAULT 30`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS lucky_draw_rewards (
        id BIGINT PRIMARY KEY,
        event_id BIGINT NOT NULL REFERENCES lucky_draw_events(id) ON DELETE CASCADE,
        reward_type TEXT NOT NULL DEFAULT 'message',
        label TEXT NOT NULL,
        course_id BIGINT REFERENCES courses(id),
        coupon_discount_type TEXT NOT NULL DEFAULT 'percent',
        coupon_discount_value INTEGER NOT NULL DEFAULT 0,
        coupon_expires_in_days INTEGER NOT NULL DEFAULT 7,
        probability_weight INTEGER NOT NULL DEFAULT 1,
        total_stock INTEGER,
        daily_stock INTEGER,
        per_user_limit INTEGER NOT NULL DEFAULT 1,
        message_text TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await client.query(`ALTER TABLE lucky_draw_rewards ADD COLUMN IF NOT EXISTS coupon_discount_type TEXT NOT NULL DEFAULT 'percent'`);
    await client.query(`ALTER TABLE lucky_draw_rewards ADD COLUMN IF NOT EXISTS coupon_discount_value INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lucky_draw_rewards ADD COLUMN IF NOT EXISTS coupon_expires_in_days INTEGER NOT NULL DEFAULT 7`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS lucky_draw_attempts (
        id BIGINT PRIMARY KEY,
        event_id BIGINT NOT NULL REFERENCES lucky_draw_events(id) ON DELETE CASCADE,
        reward_id BIGINT REFERENCES lucky_draw_rewards(id) ON DELETE SET NULL,
        user_id BIGINT NOT NULL REFERENCES users(id),
        attempt_date TEXT NOT NULL,
        attempt_no INTEGER NOT NULL DEFAULT 1,
        result_status TEXT NOT NULL DEFAULT 'issued',
        grant_id BIGINT,
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS lucky_draw_grants (
        id BIGINT PRIMARY KEY,
        event_id BIGINT NOT NULL REFERENCES lucky_draw_events(id) ON DELETE CASCADE,
        reward_id BIGINT REFERENCES lucky_draw_rewards(id) ON DELETE SET NULL,
        user_id BIGINT NOT NULL REFERENCES users(id),
        grant_type TEXT NOT NULL DEFAULT 'message',
        status TEXT NOT NULL DEFAULT 'issued',
        label TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        used_at TEXT,
        revoked_at TEXT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS llm_daily_usage (
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        usage_date TEXT NOT NULL,
        used_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        last_question_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, usage_date)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS zun_containers (
        id BIGINT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'requested',
        project_name TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        image_name TEXT NOT NULL,
        command_text TEXT NOT NULL DEFAULT '',
        exposed_port INTEGER,
        container_uuid TEXT,
        registry_id TEXT NOT NULL DEFAULT '',
        registry_domain TEXT NOT NULL DEFAULT '',
        resource_source TEXT NOT NULL DEFAULT '',
        resource_preset_id TEXT NOT NULL DEFAULT '',
        addresses_json TEXT NOT NULL DEFAULT '[]',
        public_domains_json TEXT NOT NULL DEFAULT '[]',
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        stopped_at TEXT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS magnum_clusters (
        id BIGINT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'requested',
        project_name TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        cluster_template_id TEXT NOT NULL,
        cluster_template_name TEXT NOT NULL DEFAULT '',
        kubernetes_version TEXT NOT NULL DEFAULT '',
        node_count INTEGER NOT NULL DEFAULT 1,
        master_count INTEGER NOT NULL DEFAULT 1,
        control_plane_flavor TEXT NOT NULL DEFAULT '',
        worker_flavor TEXT NOT NULL DEFAULT '',
        cluster_uuid TEXT,
        api_address TEXT NOT NULL DEFAULT '',
        api_port INTEGER NOT NULL DEFAULT 6443,
        external_api_enabled INTEGER NOT NULL DEFAULT 0,
        external_api_host TEXT NOT NULL DEFAULT '',
        external_api_port INTEGER,
        status_reason TEXT NOT NULL DEFAULT '',
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        deleted_at TEXT
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_arena_nodes_season_id ON arena_nodes(season_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_arena_sessions_user_state ON arena_sessions(user_id, state)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_arena_events_season_created ON arena_events(season_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lucky_draw_rewards_event_id ON lucky_draw_rewards(event_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lucky_draw_attempts_event_user_date ON lucky_draw_attempts(event_id, user_id, attempt_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lucky_draw_grants_user_created_at ON lucky_draw_grants(user_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_llm_daily_usage_date ON llm_daily_usage(usage_date, user_id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS trove_instances (
        id BIGINT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'requested',
        project_name TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        datastore_type TEXT NOT NULL,
        datastore_version TEXT NOT NULL DEFAULT '',
        flavor TEXT NOT NULL,
        size_gb INTEGER NOT NULL DEFAULT 1,
        instance_uuid TEXT,
        hostname TEXT NOT NULL DEFAULT '',
        database_name TEXT NOT NULL DEFAULT '',
        database_username TEXT NOT NULL DEFAULT '',
        credential_secret_ref TEXT NOT NULL DEFAULT '',
        database_port INTEGER NOT NULL DEFAULT 3306,
        status_reason TEXT NOT NULL DEFAULT '',
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        deleted_at TEXT
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_trove_instances_user_id ON trove_instances(user_id)`);
    await client.query(`CREATE TABLE IF NOT EXISTS resource_deletion_jobs (
      id TEXT PRIMARY KEY,resource_type TEXT NOT NULL,resource_id TEXT NOT NULL DEFAULT '',user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      project_name TEXT NOT NULL DEFAULT '',resource_name TEXT NOT NULL DEFAULT '',remote_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_resource_deletion_jobs_status_updated ON resource_deletion_jobs(status, updated_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_resource_deletion_jobs_project_updated ON resource_deletion_jobs(project_name, updated_at DESC)`);
    await client.query(`CREATE TABLE IF NOT EXISTS cloud_console_actions (
      id BIGINT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,project_name TEXT NOT NULL DEFAULT '',operation TEXT NOT NULL,
      request_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'requested',estimated_monthly_cost INTEGER NOT NULL DEFAULT 0,
      result_json TEXT NOT NULL DEFAULT '{}',error_message TEXT NOT NULL DEFAULT '',reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,reviewed_at TEXT,executed_at TEXT
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cloud_console_actions_user_created ON cloud_console_actions(user_id, created_at DESC)`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS price INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_access_days INTEGER NOT NULL DEFAULT 30`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS promo_enabled INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS promo_price INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS promo_starts_at TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS promo_ends_at TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS commands_markdown TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_type TEXT NOT NULL DEFAULT 'standard'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS package_items_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS program_type TEXT NOT NULL DEFAULT '일반'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS online_meeting_url TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS online_board_url TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS online_course_notice TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS online_session_note TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS external_ssh_approval_mode TEXT NOT NULL DEFAULT 'manual'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS external_rdp_approval_mode TEXT NOT NULL DEFAULT 'manual'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS public_tcp_approval_mode TEXT NOT NULL DEFAULT 'manual'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS external_ssh_route_mode TEXT NOT NULL DEFAULT 'both'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS lab_retention_mode TEXT NOT NULL DEFAULT 'ephemeral'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS lab_retention_preset TEXT NOT NULL DEFAULT '1'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS lab_retention_days INTEGER NOT NULL DEFAULT 1`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS allow_resume_existing_lab INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS lab_resize_policy TEXT NOT NULL DEFAULT 'requestable'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS lab_resize_allowed_flavors TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS terminal_replay_mode TEXT NOT NULL DEFAULT 'inherit'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS lab_backend_type TEXT NOT NULL DEFAULT 'vm'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS container_image_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS container_command_text TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS container_exposed_port INTEGER`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS container_access_mode TEXT NOT NULL DEFAULT 'console'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS container_console_mode TEXT NOT NULL DEFAULT 'zun'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS traffic_monitoring_enabled INTEGER NOT NULL DEFAULT 1`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS traffic_daily_limit_gb DOUBLE PRECISION NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS traffic_total_limit_gb DOUBLE PRECISION NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS traffic_exceeded_action TEXT NOT NULL DEFAULT 'warn'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS survey_config_json TEXT NOT NULL DEFAULT '{}'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS external_learning_tools_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS public_domain_approval_mode TEXT NOT NULL DEFAULT 'manual'`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS course_package_grants (
        id TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        package_course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        item_course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        source_payment_id BIGINT REFERENCES payments(id) ON DELETE SET NULL,
        access_created INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        granted_at TEXT NOT NULL,
        revoked_at TEXT,
        UNIQUE(user_id, package_course_id, item_course_id, source_payment_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_course_package_grants_payment ON course_package_grants(source_payment_id, status)`);
    await client.query(`ALTER TABLE notices ADD COLUMN IF NOT EXISTS is_pinned INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE course_access_requests ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE course_access_requests ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'access'`);
    await client.query(`ALTER TABLE course_access_requests ADD COLUMN IF NOT EXISTS request_note TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_course_access ADD COLUMN IF NOT EXISTS expires_at TEXT`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_course_access_expires ON user_course_access(expires_at)`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS heat_template_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS cloud_init_template_name TEXT NOT NULL DEFAULT ''`);
await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS advanced_config_json TEXT NOT NULL DEFAULT '{}'`);
await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS desired_budget INTEGER NOT NULL DEFAULT 0`);
await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS application_yaml_name TEXT NOT NULL DEFAULT ''`);
await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT ''`);
await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT ''`);
await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_order_id TEXT NOT NULL DEFAULT ''`);
await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_key TEXT NOT NULL DEFAULT ''`);
await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_requested_at TEXT`);
await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_paid_at TEXT`);
await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_failed_at TEXT`);
await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS payment_failure_reason TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS stack_name TEXT`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS stack_id TEXT`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS instance_ip TEXT`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS instance_ips_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS vm_nodes_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS error_message TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS terminal_ssh_user TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS terminal_ssh_password TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS requested_public_domains_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS public_domains_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS public_enabled INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS public_request_pending INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS public_reviewed_by TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS public_reviewed_at TEXT`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS public_review_note TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS started_at TEXT`);
    await client.query(`ALTER TABLE custom_lab_requests ADD COLUMN IF NOT EXISTS terminated_at TEXT`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS terminal_ssh_user TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS terminal_ssh_password TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS lab_backend_type TEXT NOT NULL DEFAULT 'vm'`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS container_uuid TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS container_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS container_image_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS container_command_text TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS container_access_mode TEXT NOT NULL DEFAULT 'console'`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS container_console_mode TEXT NOT NULL DEFAULT 'zun'`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS instance_uuid TEXT`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS current_flavor TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_resource_id TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_incoming_metric_id TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_outgoing_metric_id TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_rx_bytes BIGINT NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_tx_bytes BIGINT NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_total_bytes BIGINT NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_daily_bytes BIGINT NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_checked_at TEXT`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_exceeded INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS traffic_exceeded_at TEXT`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS cpu_usage_percent DOUBLE PRECISION NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS memory_usage_percent DOUBLE PRECISION NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS disk_read_bytes BIGINT NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS disk_write_bytes BIGINT NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS vm_metrics_checked_at TEXT`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS requested_public_tcp_routes_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS public_tcp_routes_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS public_tcp_enabled INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS public_tcp_request_pending INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS public_tcp_reviewed_by TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS public_tcp_reviewed_at TEXT`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS public_tcp_review_note TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_rdp_enabled INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_rdp_port INTEGER`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_rdp_request_pending INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_rdp_reviewed_by TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_rdp_reviewed_at TEXT`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS external_rdp_review_note TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS requested_resize_flavor TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS resize_request_pending INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS resize_reviewed_by TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS resize_reviewed_at TEXT`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS resize_review_note TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS archived_at TEXT`);
    await client.query(`ALTER TABLE lab_requests ADD COLUMN IF NOT EXISTS archived_reason TEXT NOT NULL DEFAULT ''`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_archived_status_created ON lab_requests(archived_at, status, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_archived_user_created ON lab_requests(archived_at, user_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_archived_course_created ON lab_requests(archived_at, course_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_stack_name ON lab_requests(stack_name)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_instance_ip ON lab_requests(instance_ip)`);
    await client.query(`
      WITH missing_access AS (
        SELECT lr.user_id AS "userId", lr.course_id AS "courseId", MIN(lr.created_at) AS "createdAt"
        FROM lab_requests lr
        LEFT JOIN user_course_access uca ON uca.user_id=lr.user_id AND uca.course_id=lr.course_id
        WHERE uca.id IS NULL
          AND COALESCE(lr.archived_at, '')=''
          AND LOWER(COALESCE(lr.purpose, 'learning'))<>'exam'
          AND LOWER(COALESCE(lr.status, '')) IN ('pending','approved','provisioning','running','paused')
        GROUP BY lr.user_id, lr.course_id
      ), numbered_access AS (
        SELECT ma.*, ROW_NUMBER() OVER (ORDER BY ma."userId", ma."courseId") AS ordinal
        FROM missing_access ma
      ), access_id_base AS (
        SELECT COALESCE(MAX(id), 0) AS "maxId" FROM user_course_access
      )
      INSERT INTO user_course_access (id,user_id,course_id,granted_via,expires_at,created_at)
      SELECT base."maxId" + item.ordinal,
             item."userId",
             item."courseId",
             'lab_request',
             (CURRENT_TIMESTAMP + (GREATEST(1, LEAST(3650, COALESCE(c.course_access_days, 30))) * INTERVAL '1 day'))::text,
             COALESCE(NULLIF(item."createdAt", ''), CURRENT_TIMESTAMP::text)
      FROM numbered_access item
      CROSS JOIN access_id_base base
      JOIN courses c ON c.id=item."courseId"
      ON CONFLICT (user_id,course_id) DO NOTHING
    `);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS cloud_init_template_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS cloud_init_custom_content TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS cloud_init_custom_file_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS network_name TEXT NOT NULL DEFAULT 'net-infra'`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS image_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS boot_from_volume INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS boot_volume_size_gb INTEGER NOT NULL DEFAULT 20`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS boot_volume_type TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS data_volume_enabled INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS data_volume_count INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS data_volume_size_gb INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS data_volume_type TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS floating_ip_requested INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS public_access_note TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS external_ssh_enabled INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS external_ssh_port INTEGER`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS external_ssh_request_pending INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS external_ssh_reviewed_by TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS external_ssh_reviewed_at TEXT`);
    await client.query(`ALTER TABLE self_service_vms ADD COLUMN IF NOT EXISTS external_ssh_review_note TEXT NOT NULL DEFAULT ''`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS self_service_project_requests (
        id BIGINT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'requested',
        requested_project_name TEXT NOT NULL DEFAULT '',
        project_name TEXT NOT NULL DEFAULT '',
        network_name TEXT NOT NULL DEFAULT '',
        subnet_cidr TEXT NOT NULL DEFAULT '',
        network_requests_json TEXT NOT NULL DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '',
        review_note TEXT NOT NULL DEFAULT '',
        reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        reviewed_at TEXT
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_self_service_project_requests_user ON self_service_project_requests(user_id, status, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_self_service_project_requests_project ON self_service_project_requests(project_name)`);
    await client.query(`ALTER TABLE self_service_project_requests ADD COLUMN IF NOT EXISTS network_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE self_service_project_requests ADD COLUMN IF NOT EXISTS subnet_cidr TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE self_service_project_requests ADD COLUMN IF NOT EXISTS network_requests_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE self_service_project_requests ADD COLUMN IF NOT EXISTS quota_profile_id TEXT NOT NULL DEFAULT 'basic'`);
    await client.query(`ALTER TABLE self_service_project_requests ADD COLUMN IF NOT EXISTS requested_quota_json TEXT NOT NULL DEFAULT '{}'`);
    await client.query(`ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS registry_id TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS registry_domain TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS resource_source TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS resource_preset_id TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS public_domains_json TEXT NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS control_plane_flavor TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS worker_flavor TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS kubernetes_version TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS api_port INTEGER NOT NULL DEFAULT 6443`);
    await client.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS external_api_enabled INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS external_api_host TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS external_api_port INTEGER`);
    await client.query(`ALTER TABLE trove_instances ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE trove_instances ADD COLUMN IF NOT EXISTS database_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE trove_instances ADD COLUMN IF NOT EXISTS database_username TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE trove_instances ADD COLUMN IF NOT EXISTS credential_secret_ref TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE trove_instances ADD COLUMN IF NOT EXISTS database_port INTEGER NOT NULL DEFAULT 3306`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_zun_containers_project_status ON zun_containers(project_name, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_magnum_clusters_project_status ON magnum_clusters(project_name, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_trove_instances_project_status ON trove_instances(project_name, status)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS internal_image_cache (
        id BIGINT PRIMARY KEY,
        registry_url TEXT NOT NULL DEFAULT '',
        namespace TEXT NOT NULL DEFAULT '',
        repository TEXT NOT NULL DEFAULT '',
        tag TEXT NOT NULL DEFAULT 'latest',
        image_name TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'harbor-cache',
        artifact_digest TEXT NOT NULL DEFAULT '',
        pushed_at TEXT NOT NULL DEFAULT '',
        cached_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(registry_url, namespace, repository, tag)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_internal_image_cache_namespace_repo ON internal_image_cache(namespace, repository)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_internal_image_cache_cached_at ON internal_image_cache(cached_at DESC)`);
    await client.query(`ALTER TABLE user_access_logs ADD COLUMN IF NOT EXISTS user_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_access_logs ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_access_logs ADD COLUMN IF NOT EXISTS ip_address TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_access_logs ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT ''`);
    await ensureCicdTables(client);
    await ensureHeatWorkloadTestTables(client);
  } finally {
    client.release();
  }
}
function normalizeUserRole(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["admin", "administrator", "관리자"].includes(normalized)) return "admin";
  if (["student", "user", "학습자"].includes(normalized)) return "student";
  return "student";
}
function normalizeUserStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["approved", "승인"].includes(normalized)) return "approved";
  if (["pending", "승인대기", "대기"].includes(normalized)) return "pending";
  return "pending";
}
function normalizeFlag(value) {
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  return Boolean(value);
}
const ADMIN_PERMISSION_KEYS = new Set([
  "admin:access",
  "admin:all",
  "admin:users",
  "admin:courses",
  "admin:labs",
  "admin:cloud",
  "admin:platform",
  "admin:ops",
  "admin:templates",
  "admin:marketing",
  "admin:messages",
  "admin:monitor",
]);
function normalizeAdminPermissions(value) {
  const source = Array.isArray(value) ? value : safeJsonParse(value || "[]", []);
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(source) ? source : []) {
    const key = String(item || "").trim().toLowerCase();
    if (!ADMIN_PERMISSION_KEYS.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result.includes("admin:all") ? ["admin:all"] : result;
}
function normalizeCourseFeatureApprovalMode(value) {
  const normalized = String(value || "manual").trim().toLowerCase();
  return ["manual", "instant", "disabled"].includes(normalized) ? normalized : "manual";
}
function normalizeUserRow(row) {
  const termsAgreements = safeJsonParse(row?.termsAgreementsJson || row?.terms_agreements_json || "[]", []);
  const marketingConsent = safeJsonParse(row?.marketingConsentJson || row?.marketing_consent_json || "{}", {});
  const agreedKeys = new Set(termsAgreements.map((item) => String(item?.termsKey || item?.terms_key || "").trim()));
  const activeAccessRestriction = normalizeUserAccessRestrictionRow(safeJsonParse(row?.activeAccessRestrictionJson ?? row?.active_access_restriction_json ?? null, null));
  return row ? {
    ...row,
    email: String(row.email || "").trim(),
    enrolledCourses: safeJsonParse(row.enrolledCoursesJson || row.enrolled_courses_json || "[]", []),
    termsAgreements,
    termsAgreementStatus: agreedKeys.has("standard_terms") && agreedKeys.has("service_additional_terms")
      ? "모든 약관 확인 및 동의 하였음"
      : "약관 동의 이력 없음",
    signupReason: String(row.signupReason || row.signup_reason || "").trim(),
    userSource: String(row.userSource || row.user_source || "self_signup").trim() || "self_signup",
    qnaLastReadAt: String(row.qnaLastReadAt || row.qna_last_read_at || "").trim(),
    otpEnabled: normalizeFlag(row.otpEnabled ?? row.otp_enabled),
    otpSecret: String(row.otpSecret ?? row.otp_secret ?? "").trim(),
    supportMessageEnabled: normalizeFlag(row.supportMessageEnabled ?? row.support_message_enabled),
    selfServiceVmEnabled: normalizeFlag(row.selfServiceVmEnabled ?? row.self_service_vm_enabled),
    pocFreeAccessEnabled: normalizeFlag(row.pocFreeAccessEnabled ?? row.poc_free_access_enabled),
    instructorShareEnabled: normalizeFlag(row.instructorShareEnabled ?? row.instructor_share_enabled),
    adminPermissions: normalizeAdminPermissions(row.adminPermissions ?? row.admin_permissions ?? row.adminPermissionsJson ?? row.admin_permissions_json),
    marketingEmailConsent: normalizeFlag(marketingConsent.emailConsent ?? marketingConsent.email_consent),
    marketingEmailConsentDecided: normalizeFlag(marketingConsent.hasDecision ?? marketingConsent.has_decision),
    marketingEmailConsentAt: marketingConsent.emailConsentAt ?? marketingConsent.email_consent_at ?? null,
    marketingEmailRevokedAt: marketingConsent.emailRevokedAt ?? marketingConsent.email_revoked_at ?? null,
    role: normalizeUserRole(row.role),
    status: normalizeUserStatus(row.status),
    lastActiveAt: row.lastActiveAt ?? row.last_active_at ?? null,
    activeNow: normalizeFlag(row.activeNow ?? row.active_now),
    activeWeek: normalizeFlag(row.activeWeek ?? row.active_week),
    activeMonth: normalizeFlag(row.activeMonth ?? row.active_month),
    activeYear: normalizeFlag(row.activeYear ?? row.active_year),
    accessLogCount: Number(row.accessLogCount ?? row.access_log_count ?? 0),
    activeAccessRestriction,
    accountSharingRestricted: activeAccessRestriction?.reason === "account_sharing",
  } : null;
}
function normalizePasswordResetPinRow(row) {
  return row ? {
    ...row,
    id: String(row.id || ""),
    userId: Number(row.userId ?? row.user_id),
    issuedBy: row.issuedBy != null ? Number(row.issuedBy) : row.issued_by != null ? Number(row.issued_by) : null,
    attemptCount: Number(row.attemptCount ?? row.attempt_count ?? 0),
    expiresAt: row.expiresAt ?? row.expires_at ?? null,
    usedAt: row.usedAt ?? row.used_at ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    email: String(row.email || "").trim(),
  } : null;
}
function normalizeUserAccessLogRow(row) {
  return row ? {
    id: String(row.id || ""),
    userId: row.userId != null ? Number(row.userId) : row.user_id != null ? Number(row.user_id) : null,
    userName: String(row.userName ?? row.user_name ?? "").trim(),
    username: String(row.username || "").trim(),
    eventType: String(row.eventType ?? row.event_type ?? "").trim(),
    ipAddress: String(row.ipAddress ?? row.ip_address ?? "").trim(),
    userAgent: String(row.userAgent ?? row.user_agent ?? "").trim(),
    createdAt: row.createdAt ?? row.created_at ?? null,
  } : null;
}
function normalizeAdminAuditLogRow(row) {
  return row ? {
    id: String(row.id || ""),
    adminUserId: row.adminUserId != null ? Number(row.adminUserId) : row.admin_user_id != null ? Number(row.admin_user_id) : null,
    adminUsername: String(row.adminUsername ?? row.admin_username ?? "").trim(),
    action: String(row.action || "").trim(),
    targetType: String(row.targetType ?? row.target_type ?? "").trim(),
    targetId: String(row.targetId ?? row.target_id ?? "").trim(),
    summary: String(row.summary || "").trim(),
    metadata: safeJsonParse(String(row.metadataJson ?? row.metadata_json ?? "{}"), {}),
    ipAddress: String(row.ipAddress ?? row.ip_address ?? "").trim(),
    userAgent: String(row.userAgent ?? row.user_agent ?? "").trim(),
    createdAt: row.createdAt ?? row.created_at ?? null,
  } : null;
}
function normalizeOauthAccountRow(row) {
  return row ? {
    id: String(row.id || ""),
    userId: Number(row.userId ?? row.user_id),
    provider: String(row.provider || "").trim(),
    providerUserId: String(row.providerUserId ?? row.provider_user_id ?? "").trim(),
    email: String(row.email || "").trim(),
    displayName: String(row.displayName ?? row.display_name ?? "").trim(),
    profile: safeJsonParse(row.profileJson || row.profile_json || "{}", {}),
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  } : null;
}
function normalizeUserSessionDeviceRow(row) {
  return row ? {
    sessionId: String(row.sessionId ?? row.session_id ?? ""),
    userId: Number(row.userId ?? row.user_id),
    ipAddress: String(row.ipAddress ?? row.ip_address ?? "").trim(),
    ipPrefix: String(row.ipPrefix ?? row.ip_prefix ?? "").trim(),
    userAgentHash: String(row.userAgentHash ?? row.user_agent_hash ?? "").trim(),
    userAgent: String(row.userAgent ?? row.user_agent ?? "").trim(),
    firstSeenAt: row.firstSeenAt ?? row.first_seen_at ?? null,
    lastSeenAt: row.lastSeenAt ?? row.last_seen_at ?? null,
    warnedAt: row.warnedAt ?? row.warned_at ?? null,
    restrictedAt: row.restrictedAt ?? row.restricted_at ?? null,
    status: String(row.status || "active").trim() || "active",
  } : null;
}
function normalizeUserAccessRestrictionRow(row) {
  return row ? {
    id: String(row.id || ""),
    userId: Number(row.userId ?? row.user_id),
    reason: String(row.reason || "").trim(),
    restrictedUntil: row.restrictedUntil ?? row.restricted_until ?? null,
    metadata: safeJsonParse(String(row.metadataJson ?? row.metadata_json ?? "{}"), {}),
    createdAt: row.createdAt ?? row.created_at ?? null,
    resolvedAt: row.resolvedAt ?? row.resolved_at ?? null,
  } : null;
}
function normalizeUserNotificationRow(row) {
  return row ? {
    id: String(row.id || ""),
    userId: Number(row.userId ?? row.user_id),
    type: String(row.type || "system").trim() || "system",
    title: String(row.title || "").trim(),
    body: String(row.body || "").trim(),
    linkSection: String(row.linkSection ?? row.link_section ?? "").trim(),
    metadata: safeJsonParse(row.metadataJson ?? row.metadata_json ?? "{}", {}),
    isRead: Boolean(row.isRead ?? row.is_read),
    createdAt: row.createdAt ?? row.created_at ?? null,
    readAt: row.readAt ?? row.read_at ?? null,
  } : null;
}

function normalizeUserMessageRow(row) {
  return row ? {
    id: String(row.id || ""),
    senderId: Number(row.senderId ?? row.sender_id),
    recipientId: Number(row.recipientId ?? row.recipient_id),
    senderName: String(row.senderName ?? row.sender_name ?? "").trim(),
    senderUsername: String(row.senderUsername ?? row.sender_username ?? "").trim(),
    recipientName: String(row.recipientName ?? row.recipient_name ?? "").trim(),
    recipientUsername: String(row.recipientUsername ?? row.recipient_username ?? "").trim(),
    subject: String(row.subject || "").trim(),
    body: String(row.body || "").trim(),
    createdAt: row.createdAt ?? row.created_at ?? null,
    readAt: row.readAt ?? row.read_at ?? null,
    senderArchived: Boolean(row.senderArchived ?? row.sender_archived),
    recipientArchived: Boolean(row.recipientArchived ?? row.recipient_archived),
    recipientType: String(row.recipientType ?? row.recipient_type ?? "user").trim() || "user",
    recipientGroupKey: String(row.recipientGroupKey ?? row.recipient_group_key ?? "").trim(),
    recipientGroupName: String(row.recipientGroupName ?? row.recipient_group_name ?? "").trim(),
    deliveryGroupId: String(row.deliveryGroupId ?? row.delivery_group_id ?? "").trim(),
    cleanupStatus: normalizeMessageCleanupStatus(row.cleanupStatus ?? row.cleanup_status),
    cleanupStatusNote: String(row.cleanupStatusNote ?? row.cleanup_status_note ?? "").trim(),
    cleanupStatusUpdatedAt: row.cleanupStatusUpdatedAt ?? row.cleanup_status_updated_at ?? null,
    cleanupStatusUpdatedBy: Number((row.cleanupStatusUpdatedBy ?? row.cleanup_status_updated_by) || 0) || null,
    cleanupStatusUpdatedByName: String(row.cleanupStatusUpdatedByName ?? row.cleanup_status_updated_by_name ?? "").trim(),
    cleanupStatusUpdatedByUsername: String(row.cleanupStatusUpdatedByUsername ?? row.cleanup_status_updated_by_username ?? "").trim(),
  } : null;
}

function normalizeMessageCleanupStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["requested", "working", "done", "blocked"].includes(normalized) ? normalized : "";
}

function safeJsonParse(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeLandingCustomerLogos(value, { maxItems = 12 } = {}) {
  const parsed = typeof value === "string" ? safeJsonParse(value, []) : value;
  const source = Array.isArray(parsed) ? parsed : [];
  return source
    .map((item, index) => {
      const fallbackId = `customer-logo-${index + 1}`;
      const rawId = String(item?.id || fallbackId).trim();
      const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "-") || fallbackId;
      const name = String(item?.name || "").trim();
      const imagePath = String(item?.imagePath || item?.image_path || item?.path || "").trim();
      const rawWebsite = String(item?.website || item?.href || item?.url || "").trim();
      const website = /^https?:\/\//i.test(rawWebsite) ? rawWebsite : "";
      return {
        id,
        name: name || (imagePath ? `고객 로고 ${index + 1}` : ""),
        imagePath,
        website,
        visible: item?.visible !== false,
      };
    })
    .filter((item) => item.name || item.imagePath)
    .slice(0, maxItems);
}

const DEFAULT_CICD_STAGES = [
  { key: "source", label: "Source", type: "source", required: true },
  { key: "build", label: "Build", type: "build", required: true },
  { key: "test", label: "Test", type: "test", required: true },
  { key: "package", label: "Package", type: "package", required: true },
  { key: "deploy-vm", label: "Deploy VM", type: "deploy", target: "stage-vm", required: true },
  { key: "deploy-k8s", label: "Deploy K8s", type: "deploy", target: "k8s-aio", required: false },
];

const CICD_PROJECT_SELECT = `
  SELECT p.id, p.user_id AS "userId", p.course_id AS "courseId", p.lab_request_id AS "labRequestId",
         p.name, p.slug, p.description, p.provider, p.repository_url AS "repositoryUrl",
         p.branch, p.pipeline_engine AS "pipelineEngine", p.jenkinsfile_path AS "jenkinsfilePath",
         p.jenkins_job_name AS "jenkinsJobName",
         p.build_server_url AS "buildServerUrl",
         p.status, p.variables_json AS "variablesJson", p.stages_json AS "stagesJson",
         p.created_at AS "createdAt", p.updated_at AS "updatedAt",
         u.name AS "userName", u.username,
         c.title AS "courseTitle", c.slug AS "courseSlug",
         lr.status AS "labStatus", lr.stack_name AS "labStackName"
  FROM cicd_projects p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN courses c ON c.id = p.course_id
  LEFT JOIN lab_requests lr ON lr.id = p.lab_request_id
`;

const CICD_RUN_SELECT = `
  SELECT r.id, r.project_id AS "projectId", r.user_id AS "userId", r.status,
         r.trigger_type AS "triggerType", r.commit_ref AS "commitRef", r.commit_sha AS "commitSha",
         r.source_branch AS "sourceBranch", r.summary, r.current_stage AS "currentStage",
         r.jenkins_build_number AS "jenkinsBuildNumber",
         r.result_json AS "resultJson", r.started_at AS "startedAt", r.finished_at AS "finishedAt",
         r.created_at AS "createdAt",
         p.name AS "projectName", p.slug AS "projectSlug", p.pipeline_engine AS "pipelineEngine",
         p.repository_url AS "repositoryUrl", p.branch AS "projectBranch",
         u.name AS "userName", u.username
  FROM cicd_runs r
  JOIN cicd_projects p ON p.id = r.project_id
  LEFT JOIN users u ON u.id = r.user_id
`;

function normalizeCicdSlug(value, fallback = "pipeline") {
  const normalized = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeCicdProjectStatus(value) {
  const normalized = String(value || "active").trim().toLowerCase();
  return ["active", "paused", "archived"].includes(normalized) ? normalized : "active";
}

function normalizeCicdRunStatus(value) {
  const normalized = String(value || "queued").trim().toLowerCase();
  return ["queued", "running", "success", "failed", "cancelled"].includes(normalized) ? normalized : "queued";
}

function normalizeCicdEventStatus(value) {
  const normalized = String(value || "info").trim().toLowerCase();
  return ["queued", "running", "success", "failed", "skipped", "info"].includes(normalized) ? normalized : "info";
}

function normalizeCicdEngine(value) {
  return "jenkins";
}

function normalizeJenkinsfilePath(value) {
  const normalized = String(value || "Jenkinsfile")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
  return normalized || "Jenkinsfile";
}

function normalizeJenkinsJobName(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").slice(0, 240);
}

function normalizeCicdStages(value) {
  const raw = typeof value === "string" ? safeJsonParse(value, []) : value;
  const source = Array.isArray(raw) && raw.length ? raw : DEFAULT_CICD_STAGES;
  return source
    .map((stage, index) => {
      const key = normalizeCicdSlug(stage?.key || stage?.name || stage?.label || `stage-${index + 1}`, `stage-${index + 1}`);
      return {
        key,
        label: String(stage?.label || stage?.name || key).trim() || key,
        type: String(stage?.type || key).trim() || key,
        target: String(stage?.target || "").trim(),
        required: stage?.required === false ? false : true,
      };
    })
    .filter((stage) => stage.key)
    .slice(0, 12);
}

function normalizeCicdProjectRow(row) {
  return row ? {
    id: String(row.id || ""),
    userId: Number(row.userId ?? row.user_id),
    courseId: row.courseId != null ? Number(row.courseId) : row.course_id != null ? Number(row.course_id) : null,
    labRequestId: row.labRequestId != null ? Number(row.labRequestId) : row.lab_request_id != null ? Number(row.lab_request_id) : null,
    name: String(row.name || "").trim(),
    slug: String(row.slug || "").trim(),
    description: String(row.description || "").trim(),
    provider: String(row.provider || "manual").trim() || "manual",
    repositoryUrl: String(row.repositoryUrl ?? row.repository_url ?? "").trim(),
    branch: String(row.branch || "main").trim() || "main",
    pipelineEngine: normalizeCicdEngine(row.pipelineEngine ?? row.pipeline_engine),
    jenkinsJobName: String(row.jenkinsJobName ?? row.jenkins_job_name ?? "").trim(),
    jenkinsfilePath: normalizeJenkinsfilePath(row.jenkinsfilePath ?? row.jenkinsfile_path),
    buildServerUrl: String(row.buildServerUrl ?? row.build_server_url ?? "").trim(),
    status: normalizeCicdProjectStatus(row.status),
    variables: safeJsonParse(row.variablesJson ?? row.variables_json ?? "{}", {}),
    stages: normalizeCicdStages(row.stagesJson ?? row.stages_json ?? "[]"),
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    userName: String(row.userName ?? row.user_name ?? "").trim(),
    username: String(row.username || "").trim(),
    courseTitle: String(row.courseTitle ?? row.course_title ?? "").trim(),
    courseSlug: String(row.courseSlug ?? row.course_slug ?? "").trim(),
    labStatus: String(row.labStatus ?? row.lab_status ?? "").trim(),
    labStackName: String(row.labStackName ?? row.lab_stack_name ?? "").trim(),
  } : null;
}

function normalizeCicdRunEventRow(row) {
  return row ? {
    id: String(row.id || ""),
    runId: Number(row.runId ?? row.run_id),
    stage: String(row.stage || "").trim(),
    status: normalizeCicdEventStatus(row.status),
    message: String(row.message || "").trim(),
    payload: safeJsonParse(row.payloadJson ?? row.payload_json ?? "{}", {}),
    createdAt: row.createdAt ?? row.created_at ?? null,
  } : null;
}

function normalizeCicdRunRow(row, events = null) {
  return row ? {
    id: String(row.id || ""),
    projectId: Number(row.projectId ?? row.project_id),
    userId: row.userId != null ? Number(row.userId) : row.user_id != null ? Number(row.user_id) : null,
    status: normalizeCicdRunStatus(row.status),
    triggerType: String(row.triggerType ?? row.trigger_type ?? "manual").trim() || "manual",
    commitRef: String(row.commitRef ?? row.commit_ref ?? "").trim(),
    commitSha: String(row.commitSha ?? row.commit_sha ?? "").trim(),
    sourceBranch: String(row.sourceBranch ?? row.source_branch ?? "").trim(),
    summary: String(row.summary || "").trim(),
    currentStage: String(row.currentStage ?? row.current_stage ?? "").trim(),
    jenkinsBuildNumber: String(row.jenkinsBuildNumber ?? row.jenkins_build_number ?? "").trim(),
    result: safeJsonParse(row.resultJson ?? row.result_json ?? "{}", {}),
    startedAt: row.startedAt ?? row.started_at ?? null,
    finishedAt: row.finishedAt ?? row.finished_at ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    projectName: String(row.projectName ?? row.project_name ?? "").trim(),
    projectSlug: String(row.projectSlug ?? row.project_slug ?? "").trim(),
    pipelineEngine: normalizeCicdEngine(row.pipelineEngine ?? row.pipeline_engine),
    repositoryUrl: String(row.repositoryUrl ?? row.repository_url ?? "").trim(),
    projectBranch: String(row.projectBranch ?? row.project_branch ?? "").trim(),
    userName: String(row.userName ?? row.user_name ?? "").trim(),
    username: String(row.username || "").trim(),
    events: Array.isArray(events) ? events.map(normalizeCicdRunEventRow).filter(Boolean) : undefined,
  } : null;
}

function normalizeCicdCredentialRow(row) {
  return row ? {
    id: String(row.id || ""),
    userId: Number(row.userId ?? row.user_id),
    name: String(row.name || "").trim(),
    slug: String(row.slug || "").trim(),
    credentialType: String(row.credentialType ?? row.credential_type ?? "").trim(),
    jenkinsCredentialId: String(row.jenkinsCredentialId ?? row.jenkins_credential_id ?? "").trim(),
    username: String(row.username || "").trim(),
    description: String(row.description || "").trim(),
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  } : null;
}

function normalizeConsultingReplyTemplates(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalizeList = (items) => (Array.isArray(items) ? items : [])
    .slice(0, 6)
    .map((item, index) => {
      const status = String(item?.status || "reviewing").trim().toLowerCase();
      return {
        key: String(item?.key || `template-${index + 1}`).trim() || `template-${index + 1}`,
        label: String(item?.label || `템플릿 ${index + 1}`).trim() || `템플릿 ${index + 1}`,
        status: ["requested", "reviewing", "answered", "closed"].includes(status) ? status : "reviewing",
        subject: String(item?.subject || "").trim(),
        note: String(item?.note || "").trim(),
      };
    })
    .filter((item) => item.label && item.note);
  return {
    aiGpu: normalizeList(source.aiGpu),
    general: normalizeList(source.general),
  };
}

function normalizeSelfServiceProjectQuota(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const defaults = {
    instances: 2,
    cores: 4,
    ram: 8192,
    volumes: 2,
    gigabytes: 80,
    snapshots: 2,
    network: 2,
    subnet: 2,
    router: 1,
    port: 20,
    floatingip: 2,
    security_group: 5,
    security_group_rule: 50,
  };
  const minimums = { security_group: 2, security_group_rule: 10 };
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
    key,
    Math.max(minimums[key] || 0, Math.min(1000000, Number.isFinite(Number(source[key])) ? Number(source[key]) : fallback)),
  ]));
}

const LAB_BASE_DOMAIN = process.env.LAB_BASE_DOMAIN || "apps.example.com";

function sanitizeSshHostLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function deriveLabSshHostBase(source) {
  const rawBase = [
    source?.publicSubdomain,
    source?.requestedPublicSubdomain,
    source?.stackName,
    source?.courseTitle,
    source?.userName || source?.username,
    source?.id != null ? `lab-${source.id}` : "",
  ].find((value) => String(value || "").trim());
  return sanitizeSshHostLabel(rawBase || `lab-${source?.id || "node"}`) || `lab-${source?.id || "node"}`;
}

function deriveVmNodeSshHost(source, node, index) {
  const explicitHost = String(node?.sshHost || node?.externalSshHost || node?.externalSshDomain || "").trim().toLowerCase();
  if (explicitHost) return explicitHost;
  const baseHost = deriveLabSshHostBase(source);
  return `${baseHost}-node${index + 1}.${LAB_BASE_DOMAIN}`.toLowerCase();
}

function normalizeVmNodesWithSshHost(source, nodes) {
  return Array.isArray(nodes)
    ? nodes.filter(Boolean).map((node, index) => ({
        ...node,
        externalSshPort: isValidExternalPort(node.externalSshPort) ? Number(node.externalSshPort) : null,
        externalRdpPort: isValidExternalPort(node.externalRdpPort) ? Number(node.externalRdpPort) : null,
        sshHost: deriveVmNodeSshHost(source, node, index),
      }))
    : [];
}

function isValidExternalPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function clampMaxConcurrentLabs(value) {
  return Math.min(5, Math.max(1, Number(value || 1) || 1));
}

function formatKstDatePart(date, options) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    ...options,
  }).format(date);
}
function getKstDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}
function getKstPeriodStartIso(period, date = new Date()) {
  const { year, month, day } = getKstDateParts(date);
  if (period === "year") return new Date(Date.UTC(year, 0, 1, -9)).toISOString();
  if (period === "month") return new Date(Date.UTC(year, month - 1, 1, -9)).toISOString();
  if (period === "day") return new Date(Date.UTC(year, month - 1, day, -9)).toISOString();
  const kstMidnightUtc = Date.UTC(year, month - 1, day, -9);
  const kstDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysFromMonday = (kstDay + 6) % 7;
  return new Date(kstMidnightUtc - daysFromMonday * 24 * 60 * 60 * 1000).toISOString();
}
function formatKstMonthDay(date) {
  return formatKstDatePart(date, { month: "2-digit", day: "2-digit" });
}
function makeKstActivityBuckets(now = new Date()) {
  const dayMs = 24 * 60 * 60 * 1000;
  const currentDayStart = new Date(getKstPeriodStartIso("day", now));
  const currentWeekStart = new Date(getKstPeriodStartIso("week", now));
  const { year, month } = getKstDateParts(now);
  const daily = Array.from({ length: 7 }, (_, index) => {
    const start = new Date(currentDayStart.getTime() - (6 - index) * dayMs);
    const end = new Date(start.getTime() + dayMs);
    return { key: start.toISOString().slice(0, 10), label: formatKstMonthDay(start), start, end, users: new Set() };
  });
  const weekly = Array.from({ length: 8 }, (_, index) => {
    const start = new Date(currentWeekStart.getTime() - (7 - index) * 7 * dayMs);
    const end = new Date(start.getTime() + 7 * dayMs);
    return { key: start.toISOString().slice(0, 10), label: formatKstMonthDay(start), start, end, users: new Set() };
  });
  const monthly = Array.from({ length: 12 }, (_, index) => {
    const monthIndex = month - 1 - (11 - index);
    const start = new Date(Date.UTC(year, monthIndex, 1, -9));
    const end = new Date(Date.UTC(year, monthIndex + 1, 1, -9));
    const labelDate = new Date(Date.UTC(year, monthIndex, 15));
    return { key: `${labelDate.getUTCFullYear()}-${String(labelDate.getUTCMonth() + 1).padStart(2, "0")}`, label: `${labelDate.getUTCMonth() + 1}월`, start, end, users: new Set() };
  });
  const yearly = Array.from({ length: 4 }, (_, index) => {
    const bucketYear = year - (3 - index);
    const start = new Date(Date.UTC(bucketYear, 0, 1, -9));
    const end = new Date(Date.UTC(bucketYear + 1, 0, 1, -9));
    return { key: String(bucketYear), label: `${bucketYear}년`, start, end, users: new Set() };
  });
  return { daily, weekly, monthly, yearly };
}
function normalizeInviteCodeRow(row) {
  return row ? {
    id: Number(row.id), code: row.code, label: row.label || "", enabled: Boolean(row.enabled),
    maxUses: Number(row.max_uses || row.maxUses || 1), usedCount: Number(row.used_count || row.usedCount || 0),
    courseId: row.course_id != null ? Number(row.course_id) : row.courseId != null ? Number(row.courseId) : null,
    courseTitle: row.courseTitle || "", expiresAt: row.expires_at || row.expiresAt || null,
    createdBy: row.created_by != null ? Number(row.created_by) : row.createdBy != null ? Number(row.createdBy) : null,
    createdByName: row.createdByName || "", createdByUsername: row.createdByUsername || "", createdAt: row.created_at || row.createdAt,
  } : null;
}
function normalizeAiQuickPrompts(value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? safeJsonParse(value || "[]", [])
      : [];
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeExternalToolLinks(value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? safeJsonParse(value || "[]", [])
      : [];
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      label: String(item?.label || "").trim(),
      url: String(item?.url || item?.href || "").trim(),
      description: String(item?.description || "").trim(),
      required: Boolean(item?.required),
    }))
    .filter((item) => item.label && /^https?:\/\//i.test(item.url))
    .slice(0, 12);
}

function normalizeLabStartChecklist(value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? safeJsonParse(value || "[]", [])
      : [];
  return (Array.isArray(items) ? items : [])
    .map((item) => String(typeof item === "string" ? item : item?.label || item?.text || "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeCourseRecordings(value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? safeJsonParse(value || "[]", [])
      : [];
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      date: String(item?.date || item?.recordedAt || "").trim().slice(0, 10),
      title: String(item?.title || "").trim(),
      url: String(item?.url || item?.href || "").trim(),
      description: String(item?.description || "").trim(),
      visibility: ["students", "private", "admin"].includes(String(item?.visibility || "").trim())
        ? String(item.visibility).trim()
        : "students",
    }))
    .filter((item) => item.title && /^https?:\/\//i.test(item.url))
    .slice(0, 80);
}

function parseCoursePromoTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : null;
}

function isCoursePromotionActive(row, nowMs = Date.now()) {
  if (!row || !Boolean(row.promoEnabled ?? row.promo_enabled)) return false;
  const startsAt = parseCoursePromoTime(row.promoStartsAt ?? row.promo_starts_at);
  const endsAt = parseCoursePromoTime(row.promoEndsAt ?? row.promo_ends_at);
  if (startsAt == null || endsAt == null) return false;
  return startsAt <= nowMs && nowMs < endsAt;
}

function normalizeCoursePromotionFields(row) {
  const price = Math.max(0, Number(row.price || 0));
  const promoEnabled = Boolean(row.promoEnabled ?? row.promo_enabled);
  const promoPrice = Math.max(0, Number(row.promoPrice ?? row.promo_price ?? 0) || 0);
  const promoStartsAt = String(row.promoStartsAt ?? row.promo_starts_at ?? "").trim();
  const promoEndsAt = String(row.promoEndsAt ?? row.promo_ends_at ?? "").trim();
  const promotionActive = isCoursePromotionActive({ promoEnabled, promoStartsAt, promoEndsAt });
  const effectivePrice = promotionActive ? Math.min(price, promoPrice) : price;
  return {
    promoEnabled,
    promoPrice,
    promoStartsAt,
    promoEndsAt,
    promotionActive,
    effectivePrice,
  };
}

function normalizeCourseRow(row) {
  return row ? {
    id: Number(row.id), slug: row.slug, category: row.category, courseType: row.courseType || "standard", packageItems: safeJsonParse(row.packageItemsJson || "[]", []).map(Number).filter((id) => Number.isInteger(id) && id > 0), programType: normalizeCourseProgramTypeValue(row.programType), title: row.title, summary: row.summary, price: Math.max(0, Number(row.price || 0)), duration: row.duration, level: row.level, body: row.body,
    ...normalizeCoursePromotionFields(row),
    youtubeUrl: row.youtubeUrl || "", onlineMeetingUrl: row.onlineMeetingUrl || "", onlineBoardUrl: row.onlineBoardUrl || "", onlineCourseNotice: row.onlineCourseNotice || "", onlineSessionNote: row.onlineSessionNote || "", labGuideMarkdown: row.labGuideMarkdown || "", commandsMarkdown: row.commandsMarkdown || "", aiSystemPrompt: row.aiSystemPrompt || "", aiQuickPrompts: normalizeAiQuickPrompts(row.aiQuickPromptsJson),
      objectives: safeJsonParse(row.objectivesJson || "[]", []), materials: safeJsonParse(row.materialsJson || "[]", []), textbooks: safeJsonParse(row.textbooksJson || "[]", []), courseCurriculum: safeJsonParse(row.courseCurriculumJson || "[]", []), courseVideos: safeJsonParse(row.courseVideosJson || "[]", []), courseRecordings: normalizeCourseRecordings(row.courseRecordingsJson), exampleFiles: safeJsonParse(row.exampleFilesJson || "[]", []), gitRepositories: safeJsonParse(row.gitRepositoriesJson || "[]", []), externalToolLinks: normalizeExternalToolLinks(row.externalToolLinksJson), externalLearningTools: normalizeExternalToolLinks(row.externalLearningToolsJson), labStartChecklist: normalizeLabStartChecklist(row.labStartChecklistJson), surveyConfig: safeJsonParse(row.surveyConfigJson || "{}", {}),
      labEnabled: Boolean(row.labEnabled), labApprovalMode: row.labApprovalMode || "manual",
      publicDomainApprovalMode: normalizeCourseFeatureApprovalMode(row.publicDomainApprovalMode),
      publicTcpApprovalMode: normalizeCourseFeatureApprovalMode(row.publicTcpApprovalMode),
      externalSshApprovalMode: normalizeCourseFeatureApprovalMode(row.externalSshApprovalMode),
      externalRdpApprovalMode: normalizeCourseFeatureApprovalMode(row.externalRdpApprovalMode),
      externalSshRouteMode: String(row.externalSshRouteMode || "").trim().toLowerCase() === "domain"
        ? "domain"
        : "both",
      labBackendType: normalizeLabBackendType(row.labBackendType),
      containerImageName: String(row.containerImageName || "").trim(),
      containerCommandText: String(row.containerCommandText || "").trim(),
      containerExposedPort: row.containerExposedPort != null ? Math.max(1, Number(row.containerExposedPort || 22) || 22) : null,
      containerAccessMode: ["ssh", "console", "ssh_console"].includes(String(row.containerAccessMode || "").trim()) ? String(row.containerAccessMode || "").trim() : "console",
      containerConsoleMode: ["zun", "ssh"].includes(String(row.containerConsoleMode || "").trim()) ? String(row.containerConsoleMode || "").trim() : "zun",
      labRetentionMode: row.labRetentionMode || "ephemeral",
      labRetentionPreset: row.labRetentionPreset || "1",
      labRetentionDays: Math.max(1, Number(row.labRetentionDays || 1) || 1),
      allowResumeExistingLab: Boolean(row.allowResumeExistingLab),
      labResizePolicy: String(row.labResizePolicy || "requestable").trim() || "requestable",
      labResizeAllowedFlavors: String(row.labResizeAllowedFlavors || "").split(",").map((item) => String(item || "").trim()).filter(Boolean),
      terminalReplayMode: ["inherit", "enabled", "disabled"].includes(String(row.terminalReplayMode || "").trim()) ? String(row.terminalReplayMode || "").trim() : "inherit",
      trafficMonitoringEnabled: Boolean(row.trafficMonitoringEnabled),
      trafficDailyLimitGb: Math.max(0, Number(row.trafficDailyLimitGb || 0)),
      trafficTotalLimitGb: Math.max(0, Number(row.trafficTotalLimitGb || 0)),
      trafficExceededAction: row.trafficExceededAction || "warn",
      heatApiUrl: row.heatApiUrl || "", heatTemplateName: row.heatTemplateName || "", heatStackPrefix: row.heatStackPrefix || "",
    labProvisioningTimeoutMinutes: Math.max(1, Math.min(120, Number(
      safeJsonParse(row.heatParametersJson || "{}", {}).labProvisioningTimeoutMinutes || 10,
    ) || 10)),
    heatParameters: safeJsonParse(row.heatParametersJson || "{}", {}), terminalSshUser: row.terminalSshUser || "",
    terminalSshPort: Number(row.terminalSshPort || 22), terminalJumpHost: row.terminalJumpHost || "", terminalJumpUser: row.terminalJumpUser || "",
    isPublished: Boolean(row.isPublished),
    isLandingPreview: Boolean(row.isLandingPreview),
    courseStatus: ["published", "coming_soon", "archived"].includes(String(row.courseStatus || "").trim()) ? String(row.courseStatus || "").trim() : "published",
    releaseLabel: String(row.releaseLabel || "").trim(),
    accessScope: row.accessScope || "public", accessCode: row.accessCode || "",
    hasAccess: row.hasAccess == null ? true : Boolean(row.hasAccess),
    hasEnrollmentRecord: row.hasEnrollmentRecord == null ? true : Boolean(row.hasEnrollmentRecord),
    enrollmentGrantedVia: String(row.enrollmentGrantedVia || "").trim(),
    ...normalizeCourseEnrollmentFields(row),
    accessRequestStatus: row.accessRequestStatus || "", accessRequestReviewNote: row.accessRequestReviewNote || "",
    revokeRequestStatus: row.revokeRequestStatus || "", revokeRequestReviewNote: row.revokeRequestReviewNote || "",
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  } : null;
}
function normalizeTextbookRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    slug: String(row.slug || "").trim(),
    title: String(row.title || "").trim(),
    summary: String(row.summary || "").trim(),
    contentMarkdown: String(row.contentMarkdown ?? row.content_markdown ?? ""),
    status: ["draft", "published", "archived"].includes(String(row.status || "").trim()) ? String(row.status || "").trim() : "draft",
    version: String(row.version || "1.0").trim() || "1.0",
    createdBy: row.createdBy ?? row.created_by ? Number(row.createdBy ?? row.created_by) : null,
    createdAt: row.createdAt ?? row.created_at ?? "",
    updatedAt: row.updatedAt ?? row.updated_at ?? "",
    courseCount: Number(row.courseCount ?? row.course_count ?? 0),
  };
}
function normalizeScheduleEventRow(row) {
  if (!row) return null;
  const visibility = String(row.visibility || "public").trim();
  return {
    id: Number(row.id),
    title: String(row.title || "").trim(),
    summary: String(row.summary || "").trim(),
    memo: String(row.memo ?? "").trim(),
    location: String(row.location || "").trim(),
    instructorName: String(row.instructorName ?? row.instructor_name ?? "").trim(),
    capacity: Number(row.capacity ?? 0) > 0 ? Number(row.capacity ?? 0) : null,
    applyUrl: String(row.applyUrl ?? row.apply_url ?? "").trim(),
    applyMethod: String(row.applyMethod ?? row.apply_method ?? "").trim(),
    startAt: row.startAt ?? row.start_at ?? "",
    endAt: row.endAt ?? row.end_at ?? "",
    timezone: String(row.timezone || "Asia/Seoul").trim() || "Asia/Seoul",
    visibility: visibility === "private" ? "admin" : ["public", "member", "admin"].includes(visibility) ? visibility : "public",
    status: String(row.status || "scheduled").trim() || "scheduled",
    showOnLanding: Boolean(Number(row.showOnLanding ?? row.show_on_landing ?? 0)),
    promotionEnabled: Boolean(Number(row.promotionEnabled ?? row.promotion_enabled ?? 0)),
    promotionTitle: String(row.promotionTitle ?? row.promotion_title ?? "").trim(),
    promotionMessage: String(row.promotionMessage ?? row.promotion_message ?? "").trim(),
    promotionPriority: Number(row.promotionPriority ?? row.promotion_priority ?? 0) || 0,
    badgeLabel: String(row.badgeLabel ?? row.badge_label ?? "").trim(),
    iconKey: String(row.iconKey ?? row.icon_key ?? "video").trim() || "video",
    courseId: row.courseId ?? row.course_id ? Number(row.courseId ?? row.course_id) : null,
    courseTitle: String(row.courseTitle || "").trim(),
    courseSlug: String(row.courseSlug || "").trim(),
    courseProgramType: String(row.courseProgramType || "").trim(),
    courseType: String(row.courseType || "").trim(),
    recurrence: safeJsonParse(row.recurrenceJson ?? row.recurrence_json ?? "{}", {}),
    recurrenceExceptions: safeJsonParse(row.recurrenceExceptionsJson ?? row.recurrence_exceptions_json ?? "[]", []),
    scheduleSource: String(row.scheduleSource ?? row.schedule_source ?? "manual").trim() || "manual",
    externalEventId: String(row.externalEventId ?? row.external_event_id ?? "").trim(),
    createdBy: row.createdBy ?? row.created_by ? Number(row.createdBy ?? row.created_by) : null,
    createdAt: row.createdAt ?? row.created_at ?? "",
    updatedAt: row.updatedAt ?? row.updated_at ?? "",
  };
}
function normalizeCourseAccessRequestRow(row) {
  return row ? {
    id: Number(row.id),
    userId: Number(row.userId ?? row.user_id),
    courseId: Number(row.courseId ?? row.course_id),
    status: row.status,
    requestType: String(row.requestType ?? row.request_type ?? "access").trim() || "access",
    requestNote: String(row.requestNote ?? row.request_note ?? "").trim(),
    createdAt: row.createdAt ?? row.created_at ?? null,
    reviewedAt: row.reviewedAt ?? row.reviewed_at ?? null,
    reviewedBy: row.reviewedBy ?? row.reviewed_by ?? null,
    reviewNote: row.reviewNote ?? row.review_note ?? "",
    userName: row.userName || "",
    username: row.username || "",
    courseTitle: row.courseTitle || "",
    coursePrice: Math.max(0, Number(row.coursePrice ?? row.course_price ?? 0)),
    courseSlug: row.courseSlug || "",
    enrollmentExpiresAt: row.enrollmentExpiresAt ?? row.enrollment_expires_at ?? null,
  } : null;
}
function normalizePaymentRow(row) {
  return row ? {
    id: Number(row.id),
    userId: Number(row.userId ?? row.user_id),
    courseId: Number(row.courseId ?? row.course_id),
    provider: String(row.provider || "manual"),
    orderId: String(row.orderId ?? row.order_id ?? ""),
    paymentKey: String(row.paymentKey ?? row.payment_key ?? "").trim(),
    providerOrderId: String(row.providerOrderId ?? row.provider_order_id ?? "").trim(),
    amount: Math.max(0, Number(row.amount || 0)),
    currency: String(row.currency || "KRW").trim() || "KRW",
    status: String(row.status || "ready").trim() || "ready",
    failureReason: String(row.failureReason ?? row.failure_reason ?? "").trim(),
    metadata: safeJsonParse(row.metadataJson ?? row.metadata_json ?? "{}", {}),
    requestedAt: row.requestedAt ?? row.requested_at ?? null,
    readyAt: row.readyAt ?? row.ready_at ?? null,
    paidAt: row.paidAt ?? row.paid_at ?? null,
    failedAt: row.failedAt ?? row.failed_at ?? null,
    cancelledAt: row.cancelledAt ?? row.cancelled_at ?? null,
    reviewedBy: row.reviewedBy ?? row.reviewed_by ?? null,
    userName: String(row.userName || "").trim(),
    username: String(row.username || "").trim(),
    courseTitle: String(row.courseTitle || "").trim(),
    courseSlug: String(row.courseSlug || "").trim(),
  } : null;
}
function normalizeCourseQuoteItemRow(row) {
  return row ? {
    id: Number(row.id),
    quoteId: Number(row.quoteId ?? row.quote_id),
    courseId: (row.courseId ?? row.course_id) == null ? null : Number(row.courseId ?? row.course_id),
    courseTitle: String(row.courseTitle ?? row.course_title ?? "").trim(),
    courseSlug: String(row.courseSlug ?? row.course_slug ?? "").trim(),
    courseCategory: String(row.courseCategory ?? row.course_category ?? "").trim(),
    courseType: String(row.courseType ?? row.course_type ?? "standard").trim() || "standard",
    programType: String(row.programType ?? row.program_type ?? "").trim(),
    duration: String(row.duration || "").trim(),
    quantity: Math.max(1, Number(row.quantity || 1) || 1),
    unitPrice: Math.max(0, Number(row.unitPrice ?? row.unit_price ?? 0) || 0),
    lineSubtotal: Math.max(0, Number(row.lineSubtotal ?? row.line_subtotal ?? 0) || 0),
    pricingNote: String(row.pricingNote ?? row.pricing_note ?? "").trim(),
    metadata: safeJsonParse(row.metadataJson ?? row.metadata_json ?? "{}", {}),
    sortOrder: Math.max(0, Number(row.sortOrder ?? row.sort_order ?? 0) || 0),
    createdAt: row.createdAt ?? row.created_at ?? null,
  } : null;
}
function normalizeCourseQuoteRow(row) {
  return row ? {
    id: Number(row.id),
    quoteNo: String(row.quoteNo ?? row.quote_no ?? "").trim(),
    userId: Number(row.userId ?? row.user_id),
    status: String(row.status || "issued").trim() || "issued",
    recipientCompanyName: String(row.recipientCompanyName ?? row.recipient_company_name ?? "").trim(),
    recipientName: String(row.recipientName ?? row.recipient_name ?? "").trim(),
    recipientEmail: String(row.recipientEmail ?? row.recipient_email ?? "").trim(),
    recipientPhone: String(row.recipientPhone ?? row.recipient_phone ?? "").trim(),
    subtotalAmount: Math.max(0, Number(row.subtotalAmount ?? row.subtotal_amount ?? 0) || 0),
    discountRate: Math.max(0, Number(row.discountRate ?? row.discount_rate ?? 0) || 0),
    discountAmount: Math.max(0, Number(row.discountAmount ?? row.discount_amount ?? 0) || 0),
    vatRate: Math.max(0, Number(row.vatRate ?? row.vat_rate ?? 0) || 0),
    vatAmount: Math.max(0, Number(row.vatAmount ?? row.vat_amount ?? 0) || 0),
    totalAmount: Math.max(0, Number(row.totalAmount ?? row.total_amount ?? 0) || 0),
    currency: String(row.currency || "KRW").trim() || "KRW",
    pricingBasis: safeJsonParse(row.pricingBasisJson ?? row.pricing_basis_json ?? "{}", {}),
    businessSnapshot: safeJsonParse(row.businessSnapshotJson ?? row.business_snapshot_json ?? "{}", {}),
    note: String(row.note || "").trim(),
    issuedAt: row.issuedAt ?? row.issued_at ?? null,
    validUntil: row.validUntil ?? row.valid_until ?? null,
    sentAt: row.sentAt ?? row.sent_at ?? null,
    sentBy: row.sentBy ?? row.sent_by ?? null,
    acceptedAt: row.acceptedAt ?? row.accepted_at ?? null,
    cancelledAt: row.cancelledAt ?? row.cancelled_at ?? null,
    reviewedBy: row.reviewedBy ?? row.reviewed_by ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    userName: String(row.userName || "").trim(),
    username: String(row.username || "").trim(),
    userEmail: String(row.userEmail || "").trim(),
    sentByName: String(row.sentByName || "").trim(),
    sentByUsername: String(row.sentByUsername || "").trim(),
    reviewedByName: String(row.reviewedByName || "").trim(),
    reviewedByUsername: String(row.reviewedByUsername || "").trim(),
    items: Array.isArray(row.items) ? row.items.map(normalizeCourseQuoteItemRow).filter(Boolean) : [],
  } : null;
}
function normalizeDomainEntry(entry) {
  if (!entry) return null;
  const domainType = String(entry.domainType || entry.domain_type || "managed").trim().toLowerCase() === "custom" ? "custom" : "managed";
  const fqdn = String(entry.fqdn || "").trim().toLowerCase();
  const subdomain = String(entry.subdomain || (domainType === "custom" ? fqdn : "")).trim().toLowerCase();
  const protocol = String(entry.protocol || "http").trim().toLowerCase() === "https" ? "https" : "http";
  const port = Number(entry.port);
  if (!subdomain || !fqdn || !Number.isInteger(port) || port <= 0) return null;
  const nodeId = String(entry.nodeId || "").trim();
  const nodeName = String(entry.nodeName || "").trim();
  const targetHost = String(entry.targetHost || "").trim();
  const verificationName = String(entry.verificationName || entry.verification_name || "").trim().toLowerCase();
  const verificationValue = String(entry.verificationValue || entry.verification_value || "").trim();
  const verificationStatus = String(entry.verificationStatus || entry.verification_status || "").trim().toLowerCase();
  const verifiedAt = entry.verifiedAt || entry.verified_at || null;
  return {
    subdomain,
    domainType,
    fqdn,
    protocol,
    port,
    url: `${protocol}://${fqdn}`,
    ...(verificationName ? { verificationName } : {}),
    ...(verificationValue ? { verificationValue } : {}),
    ...(verificationStatus ? { verificationStatus } : {}),
    ...(verifiedAt ? { verifiedAt } : {}),
    ...(nodeId ? { nodeId } : {}),
    ...(nodeName ? { nodeName } : {}),
    ...(targetHost ? { targetHost } : {}),
  };
}
function normalizePublicTcpEntry(entry) {
  if (!entry) return null;
  const targetPort = Number(entry.targetPort);
  const externalPort = entry.externalPort == null ? null : Number(entry.externalPort);
  if (!Number.isInteger(targetPort) || targetPort <= 0) return null;
  if (externalPort != null && (!Number.isInteger(externalPort) || externalPort <= 0)) return null;
  const nodeId = String(entry.nodeId || "").trim();
  const nodeName = String(entry.nodeName || "").trim();
  const targetHost = String(entry.targetHost || "").trim();
  return {
    protocol: "tcp",
    targetPort,
    externalPort,
    ...(nodeId ? { nodeId } : {}),
    ...(nodeName ? { nodeName } : {}),
    ...(targetHost ? { targetHost } : {}),
  };
}
function normalizeDomainList(jsonValue, legacyEnabled, legacySubdomain, legacyFqdn, legacyProtocol, legacyPort) {
  let parsed = [];
  try {
    parsed = JSON.parse(jsonValue || "[]");
  } catch {
    parsed = [];
  }
  const list = Array.isArray(parsed) ? parsed.map(normalizeDomainEntry).filter(Boolean) : [];
  if (list.length) return list;
  if (legacyEnabled && legacySubdomain && legacyFqdn && legacyPort != null) {
    const entry = normalizeDomainEntry({
      subdomain: legacySubdomain,
      fqdn: legacyFqdn,
      protocol: legacyProtocol || "http",
      port: legacyPort,
    });
    return entry ? [entry] : [];
  }
  return [];
}
function normalizePublicTcpList(jsonValue) {
  let parsed = [];
  try {
    parsed = JSON.parse(jsonValue || "[]");
  } catch {
    parsed = [];
  }
  return Array.isArray(parsed) ? parsed.map(normalizePublicTcpEntry).filter(Boolean) : [];
}
function coerceDomainPatchList(patchValue, currentValue) {
  if (patchValue === undefined) return currentValue;
  return Array.isArray(patchValue) ? patchValue.map(normalizeDomainEntry).filter(Boolean) : [];
}
function coercePublicTcpPatchList(patchValue, currentValue) {
  if (patchValue === undefined) return currentValue;
  return Array.isArray(patchValue) ? patchValue.map(normalizePublicTcpEntry).filter(Boolean) : [];
}
function normalizeLabRow(row) {
  if (!row) return null;
  const publicDomains = normalizeDomainList(
    row.public_domains_json ?? row.publicDomainsJson,
    row.public_enabled ?? row.publicEnabled,
    row.public_subdomain ?? row.publicSubdomain,
    row.public_fqdn ?? row.publicFqdn,
    row.public_protocol ?? row.publicProtocol,
    row.public_port ?? row.publicPort,
  );
  const requestedPublicDomains = normalizeDomainList(
    row.requested_public_domains_json ?? row.requestedPublicDomainsJson,
    row.public_request_pending ?? row.publicRequestPending,
    row.requested_public_subdomain ?? row.requestedPublicSubdomain,
    row.requested_public_fqdn ?? row.requestedPublicFqdn,
    row.requested_public_protocol ?? row.requestedPublicProtocol,
    row.requested_public_port ?? row.requestedPublicPort,
  );
  const publicTcpRoutes = normalizePublicTcpList(row.public_tcp_routes_json ?? row.publicTcpRoutesJson);
  const requestedPublicTcpRoutes = normalizePublicTcpList(row.requested_public_tcp_routes_json ?? row.requestedPublicTcpRoutesJson);
  const vmNodes = normalizeVmNodesWithSshHost(row, safeJsonParse(row.vm_nodes_json ?? row.vmNodesJson ?? "[]", []));
  const firstPublicDomain = publicDomains[0] || null;
  const firstRequestedDomain = requestedPublicDomains[0] || null;
  const publicEnabled = Boolean(row.public_enabled ?? row.publicEnabled);
  return {
    id: Number(row.id), userId: Number(row.user_id ?? row.userId), courseId: Number(row.course_id ?? row.courseId),
    status: row.status, approvalMode: row.approval_mode ?? row.approvalMode, stackName: row.stack_name ?? row.stackName, stackId: row.stack_id ?? row.stackId,
    purpose: String(row.purpose ?? "learning").trim() || "learning",
    examSessionId: String(row.exam_session_id ?? row.examSessionId ?? "").trim(),
    instanceUuid: String(row.instance_uuid ?? row.instanceUuid ?? "").trim(),
    currentFlavor: String(row.current_flavor ?? row.currentFlavor ?? "").trim(),
    instanceIp: row.instance_ip ?? row.instanceIp, instanceIps: safeJsonParse(row.instance_ips_json ?? row.instanceIpsJson ?? "[]", []),
    vmNodes,
    terminalSshUser: String(row.terminal_ssh_user ?? row.terminalSshUser ?? "").trim(),
    terminalSshPassword: String(row.terminal_ssh_password ?? row.terminalSshPassword ?? ""),
    labBackendType: normalizeLabBackendType(row.lab_backend_type ?? row.labBackendType),
    containerUuid: String(row.container_uuid ?? row.containerUuid ?? "").trim(),
    containerName: String(row.container_name ?? row.containerName ?? "").trim(),
    containerImageName: String(row.container_image_name ?? row.containerImageName ?? "").trim(),
    containerCommandText: String(row.container_command_text ?? row.containerCommandText ?? "").trim(),
    containerAccessMode: ["ssh", "console", "ssh_console"].includes(String(row.container_access_mode ?? row.containerAccessMode ?? "").trim())
      ? String(row.container_access_mode ?? row.containerAccessMode ?? "").trim()
      : "console",
    containerConsoleMode: ["zun", "ssh"].includes(String(row.container_console_mode ?? row.containerConsoleMode ?? "").trim())
      ? String(row.container_console_mode ?? row.containerConsoleMode ?? "").trim()
      : "zun",
    trafficResourceId: String(row.traffic_resource_id ?? row.trafficResourceId ?? "").trim(),
    trafficIncomingMetricId: String(row.traffic_incoming_metric_id ?? row.trafficIncomingMetricId ?? "").trim(),
    trafficOutgoingMetricId: String(row.traffic_outgoing_metric_id ?? row.trafficOutgoingMetricId ?? "").trim(),
    trafficRxBytes: Math.max(0, Number(row.traffic_rx_bytes ?? row.trafficRxBytes ?? 0)),
    trafficTxBytes: Math.max(0, Number(row.traffic_tx_bytes ?? row.trafficTxBytes ?? 0)),
    trafficTotalBytes: Math.max(0, Number(row.traffic_total_bytes ?? row.trafficTotalBytes ?? 0)),
    trafficDailyBytes: Math.max(0, Number(row.traffic_daily_bytes ?? row.trafficDailyBytes ?? 0)),
    trafficCheckedAt: row.traffic_checked_at ?? row.trafficCheckedAt ?? null,
    trafficExceeded: Boolean(row.traffic_exceeded ?? row.trafficExceeded),
    trafficExceededAt: row.traffic_exceeded_at ?? row.trafficExceededAt ?? null,
    cpuUsagePercent: Math.max(0, Number(row.cpu_usage_percent ?? row.cpuUsagePercent ?? 0)),
    memoryUsagePercent: Math.max(0, Number(row.memory_usage_percent ?? row.memoryUsagePercent ?? 0)),
    diskReadBytes: Math.max(0, Number(row.disk_read_bytes ?? row.diskReadBytes ?? 0)),
    diskWriteBytes: Math.max(0, Number(row.disk_write_bytes ?? row.diskWriteBytes ?? 0)),
    vmMetricsCheckedAt: row.vm_metrics_checked_at ?? row.vmMetricsCheckedAt ?? null,
    requestedPublicDomains,
    publicDomains,
    requestedPublicTcpRoutes,
    publicTcpRoutes,
    requestedPublicSubdomain: firstRequestedDomain?.subdomain ?? row.requested_public_subdomain ?? row.requestedPublicSubdomain ?? "",
    requestedPublicFqdn: firstRequestedDomain?.fqdn ?? row.requested_public_fqdn ?? row.requestedPublicFqdn ?? "",
    requestedPublicProtocol: firstRequestedDomain?.protocol ?? row.requested_public_protocol ?? row.requestedPublicProtocol ?? "http",
    requestedPublicPort: firstRequestedDomain?.port != null ? Number(firstRequestedDomain.port) : row.requested_public_port != null ? Number(row.requested_public_port) : row.requestedPublicPort != null ? Number(row.requestedPublicPort) : null,
    publicSubdomain: firstPublicDomain?.subdomain ?? row.public_subdomain ?? row.publicSubdomain ?? "",
    publicFqdn: firstPublicDomain?.fqdn ?? row.public_fqdn ?? row.publicFqdn ?? "",
    publicProtocol: firstPublicDomain?.protocol ?? row.public_protocol ?? row.publicProtocol ?? "http",
    publicPort: firstPublicDomain?.port != null ? Number(firstPublicDomain.port) : row.public_port != null ? Number(row.public_port) : row.publicPort != null ? Number(row.publicPort) : null,
    publicEnabled,
    publicRequestPending: Boolean(row.public_request_pending ?? row.publicRequestPending),
    publicReviewedBy: row.public_reviewed_by ?? row.publicReviewedBy ?? "", publicReviewedAt: row.public_reviewed_at ?? row.publicReviewedAt ?? null,
    publicReviewNote: row.public_review_note ?? row.publicReviewNote ?? "",
    publicTcpEnabled: Boolean(row.public_tcp_enabled ?? row.publicTcpEnabled),
    publicTcpRequestPending: Boolean(row.public_tcp_request_pending ?? row.publicTcpRequestPending),
    publicTcpReviewedBy: row.public_tcp_reviewed_by ?? row.publicTcpReviewedBy ?? "",
    publicTcpReviewedAt: row.public_tcp_reviewed_at ?? row.publicTcpReviewedAt ?? null,
    publicTcpReviewNote: row.public_tcp_review_note ?? row.publicTcpReviewNote ?? "",
    externalSshEnabled: Boolean(row.external_ssh_enabled ?? row.externalSshEnabled),
    externalSshPort: isValidExternalPort(row.external_ssh_port ?? row.externalSshPort) ? Number(row.external_ssh_port ?? row.externalSshPort) : null,
    externalSshRequestPending: Boolean(row.external_ssh_request_pending ?? row.externalSshRequestPending),
    externalSshReviewedBy: row.external_ssh_reviewed_by ?? row.externalSshReviewedBy ?? "",
    externalSshReviewedAt: row.external_ssh_reviewed_at ?? row.externalSshReviewedAt ?? null,
    externalSshReviewNote: row.external_ssh_review_note ?? row.externalSshReviewNote ?? "",
    externalRdpEnabled: Boolean(row.external_rdp_enabled ?? row.externalRdpEnabled),
    externalRdpPort: isValidExternalPort(row.external_rdp_port ?? row.externalRdpPort) ? Number(row.external_rdp_port ?? row.externalRdpPort) : null,
    externalRdpRequestPending: Boolean(row.external_rdp_request_pending ?? row.externalRdpRequestPending),
    externalRdpReviewedBy: row.external_rdp_reviewed_by ?? row.externalRdpReviewedBy ?? "",
    externalRdpReviewedAt: row.external_rdp_reviewed_at ?? row.externalRdpReviewedAt ?? null,
    externalRdpReviewNote: row.external_rdp_review_note ?? row.externalRdpReviewNote ?? "",
    requestedResizeFlavor: String(row.requested_resize_flavor ?? row.requestedResizeFlavor ?? "").trim(),
    resizeRequestPending: Boolean(row.resize_request_pending ?? row.resizeRequestPending),
    resizeReviewedBy: row.resize_reviewed_by ?? row.resizeReviewedBy ?? "",
    resizeReviewedAt: row.resize_reviewed_at ?? row.resizeReviewedAt ?? null,
    resizeReviewNote: row.resize_review_note ?? row.resizeReviewNote ?? "",
    metallbVipCidr: String(row.metallb_vip_cidr ?? row.metallbVipCidr ?? "").trim(),
    publicUrl: firstPublicDomain?.url ?? "",
    requestedPublicUrl: firstRequestedDomain?.url ?? "",
    lastAccessedAt: row.last_accessed_at ?? row.lastAccessedAt ?? null, expiresAt: row.expires_at ?? row.expiresAt ?? null,
    errorMessage: row.error_message ?? row.errorMessage ?? null, createdAt: row.created_at ?? row.createdAt,
    approvedAt: row.approved_at ?? row.approvedAt ?? null, startedAt: row.started_at ?? row.startedAt ?? null, terminatedAt: row.terminated_at ?? row.terminatedAt ?? null,
    archivedAt: row.archived_at ?? row.archivedAt ?? null,
    archivedReason: String(row.archived_reason ?? row.archivedReason ?? "").trim(),
    labBaseDomain: LAB_BASE_DOMAIN,
    userName: row.userName || "", username: row.username || "", courseTitle: row.courseTitle || "", courseSlug: row.courseSlug || "",
    courseSummary: row.courseSummary || "", courseCategory: row.courseCategory || "", courseHeatTemplateName: row.courseHeatTemplateName || "",
  };
}
function normalizeCustomLabRequestRow(row) {
  if (!row) return null;
  let advancedConfig = {};
  try {
    const parsed = JSON.parse(row?.advancedConfigJson ?? row?.advanced_config_json ?? "{}");
    advancedConfig = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    advancedConfig = {};
  }
  const vmNodes = normalizeVmNodesWithSshHost(row, safeJsonParse(row.vmNodesJson ?? row.vm_nodes_json ?? "[]", []));
  const publicDomains = normalizeDomainList(row.publicDomainsJson ?? row.public_domains_json, row.publicEnabled ?? row.public_enabled, "", "", "", null);
  const requestedPublicDomains = normalizeDomainList(row.requestedPublicDomainsJson ?? row.requested_public_domains_json, row.publicRequestPending ?? row.public_request_pending, "", "", "", null);
  const firstPublicDomain = publicDomains[0] || null;
  const firstRequestedDomain = requestedPublicDomains[0] || null;
  return {
    id: Number(row.id),
    userId: Number(row.userId ?? row.user_id),
    status: row.status,
    title: row.title,
    instanceCount: Number(row.instanceCount ?? row.instance_count ?? 1),
    vcpu: Number(row.vcpu || 0),
    ramGb: Number(row.ramGb ?? row.ram_gb ?? 0),
    diskGb: Number(row.diskGb ?? row.disk_gb ?? 0),
    imageName: row.imageName ?? row.image_name ?? "",
    usagePeriod: row.usagePeriod ?? row.usage_period ?? "",
    desiredBudget: Math.max(0, Number(row.desiredBudget ?? row.desired_budget ?? 0)),
    note: row.note ?? "",
    advancedConfig,
    cloudInitTemplateName: row.cloudInitTemplateName ?? row.cloud_init_template_name ?? "",
    quotedPrice: row.quotedPrice ?? row.quoted_price ?? "",
    paymentStatus: String(row.paymentStatus ?? row.payment_status ?? "").trim(),
    paymentProvider: String(row.paymentProvider ?? row.payment_provider ?? "").trim(),
    paymentOrderId: String(row.paymentOrderId ?? row.payment_order_id ?? "").trim(),
    paymentKey: String(row.paymentKey ?? row.payment_key ?? "").trim(),
    paymentRequestedAt: row.paymentRequestedAt ?? row.payment_requested_at ?? null,
    paymentPaidAt: row.paymentPaidAt ?? row.payment_paid_at ?? null,
    paymentFailedAt: row.paymentFailedAt ?? row.payment_failed_at ?? null,
    paymentFailureReason: String(row.paymentFailureReason ?? row.payment_failure_reason ?? "").trim(),
    reviewNote: row.reviewNote ?? row.review_note ?? "",
    heatTemplateName: row.heatTemplateName ?? row.heat_template_name ?? "",
    applicationYamlName: row.applicationYamlName ?? row.application_yaml_name ?? "",
    stackName: row.stackName ?? row.stack_name ?? "",
    stackId: row.stackId ?? row.stack_id ?? "",
    instanceIp: row.instanceIp ?? row.instance_ip ?? "",
    instanceIps: safeJsonParse(row.instanceIpsJson ?? row.instance_ips_json ?? "[]", []),
    vmNodes,
    errorMessage: row.errorMessage ?? row.error_message ?? "",
    terminalSshUser: String(row.terminalSshUser ?? row.terminal_ssh_user ?? "").trim(),
    terminalSshPassword: String(row.terminalSshPassword ?? row.terminal_ssh_password ?? ""),
    requestedPublicDomains,
    publicDomains,
    requestedPublicSubdomain: firstRequestedDomain?.subdomain || "",
    requestedPublicFqdn: firstRequestedDomain?.fqdn || "",
    requestedPublicProtocol: firstRequestedDomain?.protocol || "http",
    requestedPublicPort: firstRequestedDomain?.port || null,
    publicSubdomain: firstPublicDomain?.subdomain || "",
    publicFqdn: firstPublicDomain?.fqdn || "",
    publicUrl: firstPublicDomain?.url || "",
    publicProtocol: firstPublicDomain?.protocol || "http",
    publicPort: firstPublicDomain?.port || null,
    publicEnabled: Boolean(row.publicEnabled ?? row.public_enabled),
    publicRequestPending: Boolean(row.publicRequestPending ?? row.public_request_pending),
    publicReviewedBy: row.publicReviewedBy ?? row.public_reviewed_by ?? "",
    publicReviewedAt: row.publicReviewedAt ?? row.public_reviewed_at ?? null,
    publicReviewNote: row.publicReviewNote ?? row.public_review_note ?? "",
    reviewedById: row.reviewedById != null ? Number(row.reviewedById) : row.reviewed_by != null ? Number(row.reviewed_by) : null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    reviewedAt: row.reviewedAt ?? row.reviewed_at ?? null,
    startedAt: row.startedAt ?? row.started_at ?? null,
    terminatedAt: row.terminatedAt ?? row.terminated_at ?? null,
    labBaseDomain: LAB_BASE_DOMAIN,
    userName: row.userName || "",
    username: row.username || "",
    reviewedByName: row.reviewedByName || "",
    reviewedByUsername: row.reviewedByUsername || "",
  };
}
function normalizeConsultingRequestRow(row) {
  return row ? {
    id: Number(row.id),
    userId: Number(row.userId ?? row.user_id),
    status: String(row.status || "requested").trim(),
    title: String(row.title || "").trim(),
    companyName: String(row.companyName ?? row.company_name ?? "").trim(),
    contactName: String(row.contactName ?? row.contact_name ?? "").trim(),
    contactEmail: String(row.contactEmail ?? row.contact_email ?? "").trim(),
    contactPhone: String(row.contactPhone ?? row.contact_phone ?? "").trim(),
    inquiryType: String(row.inquiryType ?? row.inquiry_type ?? "").trim(),
    industry: String(row.industry ?? "").trim(),
    currentEnvironment: String(row.currentEnvironment ?? row.current_environment ?? "").trim(),
    requirements: String(row.requirements ?? "").trim(),
    budgetRange: String(row.budgetRange ?? row.budget_range ?? "").trim(),
    desiredTimeline: String(row.desiredTimeline ?? row.desired_timeline ?? "").trim(),
    note: String(row.note ?? "").trim(),
    adminNote: String(row.adminNote ?? row.admin_note ?? "").trim(),
    reviewedById: row.reviewedById != null ? Number(row.reviewedById) : row.reviewed_by != null ? Number(row.reviewed_by) : null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    reviewedAt: row.reviewedAt ?? row.reviewed_at ?? null,
    userName: String(row.userName || "").trim(),
    username: String(row.username || "").trim(),
    reviewedByName: String(row.reviewedByName || "").trim(),
    reviewedByUsername: String(row.reviewedByUsername || "").trim(),
  } : null;
}
function normalizePublicQuoteInquiryRow(row) {
  return row ? {
    id: Number(row.id),
    status: String(row.status || "requested").trim(),
    companyName: String(row.companyName ?? row.company_name ?? "").trim(),
    contactName: String(row.contactName ?? row.contact_name ?? "").trim(),
    contactEmail: String(row.contactEmail ?? row.contact_email ?? "").trim(),
    contactPhone: String(row.contactPhone ?? row.contact_phone ?? "").trim(),
    interestType: String(row.interestType ?? row.interest_type ?? "").trim(),
    courseTitles: String(row.courseTitles ?? row.course_titles ?? "").trim(),
    participantCount: Math.max(1, Number(row.participantCount ?? row.participant_count ?? 1) || 1),
    desiredTimeline: String(row.desiredTimeline ?? row.desired_timeline ?? "").trim(),
    requirements: String(row.requirements ?? "").trim(),
    privacyAgreed: Boolean(row.privacyAgreed ?? row.privacy_agreed),
    ipAddress: String(row.ipAddress ?? row.ip_address ?? "").trim(),
    userAgent: String(row.userAgent ?? row.user_agent ?? "").trim(),
    adminNote: String(row.adminNote ?? row.admin_note ?? "").trim(),
    reviewedById: row.reviewedById != null ? Number(row.reviewedById) : row.reviewed_by != null ? Number(row.reviewed_by) : null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    reviewedAt: row.reviewedAt ?? row.reviewed_at ?? null,
    reviewedByName: String(row.reviewedByName || "").trim(),
    reviewedByUsername: String(row.reviewedByUsername || "").trim(),
    source: "public_quote",
  } : null;
}
function normalizeSelfServiceVmRow(row, options = {}) {
  if (!row) return null;
  const vmNodes = normalizeVmNodesWithSshHost(row, safeJsonParse(row.vmNodesJson ?? row.vm_nodes_json ?? "[]", []));
  const cloudInitTemplateName = String(row.cloudInitTemplateName ?? row.cloud_init_template_name ?? "").trim();
  const cloudInitCustomContent = String(row.cloudInitCustomContent ?? row.cloud_init_custom_content ?? "");
  const cloudInitCustomFileName = String(row.cloudInitCustomFileName ?? row.cloud_init_custom_file_name ?? "").trim();
  const hasCloudInitCustomContent = Boolean(cloudInitCustomContent.trim());
  return {
    id: Number(row.id),
    userId: Number(row.userId ?? row.user_id),
    status: row.status,
      instanceCount: Number(row.instanceCount ?? row.instance_count ?? 1),
    flavor: row.flavor ?? "",
    projectName: String(row.projectName ?? row.project_name ?? "").trim(),
    networkName: String(row.networkName ?? row.network_name ?? "net-infra").trim() || "net-infra",
    imageName: String(row.imageName ?? row.image_name ?? "").trim(),
    cloudInitTemplateName,
    cloudInitCustomFileName,
    cloudInitCustomContentAvailable: hasCloudInitCustomContent,
    cloudInitCustomContent: options.includeCloudInitCustomContent ? cloudInitCustomContent : "",
    cloudInitMode: hasCloudInitCustomContent ? "custom" : cloudInitTemplateName ? "template" : "none",
    bootFromVolume: normalizeFlag(row.bootFromVolume ?? row.boot_from_volume),
    bootVolumeSizeGb: Number(row.bootVolumeSizeGb ?? row.boot_volume_size_gb ?? 20) || 20,
    bootVolumeType: String(row.bootVolumeType ?? row.boot_volume_type ?? "").trim(),
    dataVolumeEnabled: normalizeFlag(row.dataVolumeEnabled ?? row.data_volume_enabled),
    dataVolumeCount: Number(row.dataVolumeCount ?? row.data_volume_count ?? 0) || 0,
    dataVolumeSizeGb: Number(row.dataVolumeSizeGb ?? row.data_volume_size_gb ?? 0) || 0,
    dataVolumeType: String(row.dataVolumeType ?? row.data_volume_type ?? "").trim(),
    floatingIpRequested: normalizeFlag(row.floatingIpRequested ?? row.floating_ip_requested),
    publicAccessNote: String(row.publicAccessNote ?? row.public_access_note ?? "").trim(),
    externalSshEnabled: normalizeFlag(row.externalSshEnabled ?? row.external_ssh_enabled),
    externalSshPort: isValidExternalPort(row.externalSshPort ?? row.external_ssh_port) ? Number(row.externalSshPort ?? row.external_ssh_port) : null,
    externalSshRequestPending: normalizeFlag(row.externalSshRequestPending ?? row.external_ssh_request_pending),
    externalSshReviewedBy: String(row.externalSshReviewedBy ?? row.external_ssh_reviewed_by ?? "").trim(),
    externalSshReviewedAt: row.externalSshReviewedAt ?? row.external_ssh_reviewed_at ?? null,
    externalSshReviewNote: String(row.externalSshReviewNote ?? row.external_ssh_review_note ?? "").trim(),
    stackName: row.stackName ?? row.stack_name ?? null,
    stackId: row.stackId ?? row.stack_id ?? null,
    instanceIp: row.instanceIp ?? row.instance_ip ?? null,
    instanceIps: safeJsonParse(row.instanceIpsJson ?? row.instance_ips_json ?? "[]", []),
    vmNodes,
    errorMessage: row.errorMessage ?? row.error_message ?? null,
    reviewNote: row.reviewNote ?? row.review_note ?? null,
    reviewedBy: row.reviewedBy ?? row.reviewed_by ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    startedAt: row.startedAt ?? row.started_at ?? null,
    terminatedAt: row.terminatedAt ?? row.terminated_at ?? null,
    labBaseDomain: LAB_BASE_DOMAIN,
    userName: row.userName || "",
    username: row.username || "",
  };
}
function normalizeSelfServiceProjectRequestRow(row) {
  return row ? {
    id: Number(row.id),
    userId: Number(row.userId ?? row.user_id),
    status: String(row.status || "requested").trim(),
    requestedProjectName: String(row.requestedProjectName ?? row.requested_project_name ?? "").trim(),
    projectName: String(row.projectName ?? row.project_name ?? "").trim(),
    networkName: String(row.networkName ?? row.network_name ?? "").trim(),
    subnetCidr: String(row.subnetCidr ?? row.subnet_cidr ?? "").trim(),
    networkRequests: safeJsonParse(row.networkRequestsJson ?? row.network_requests_json ?? "[]", []),
    quotaProfileId: String(row.quotaProfileId ?? row.quota_profile_id ?? "basic").trim() || "basic",
    requestedQuota: safeJsonParse(row.requestedQuotaJson ?? row.requested_quota_json ?? "{}", {}),
    note: String(row.note ?? "").trim(),
    reviewNote: String(row.reviewNote ?? row.review_note ?? "").trim(),
    reviewedBy: row.reviewedBy != null ? Number(row.reviewedBy) : row.reviewed_by != null ? Number(row.reviewed_by) : null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    reviewedAt: row.reviewedAt ?? row.reviewed_at ?? null,
    userName: String(row.userName || "").trim(),
    username: String(row.username || "").trim(),
    reviewedByName: String(row.reviewedByName || "").trim(),
    reviewedByUsername: String(row.reviewedByUsername || "").trim(),
  } : null;
}
function normalizeZunContainerRow(row) {
  return row ? {
    id: Number(row.id),
    userId: Number(row.userId ?? row.user_id),
    status: row.status,
    projectName: String(row.projectName ?? row.project_name ?? "").trim(),
    name: row.name ?? "",
    imageName: row.imageName ?? row.image_name ?? "",
    commandText: row.commandText ?? row.command_text ?? "",
    exposedPort: row.exposedPort != null ? Number(row.exposedPort) : row.exposed_port != null ? Number(row.exposed_port) : null,
    containerUuid: row.containerUuid ?? row.container_uuid ?? null,
    registryId: String(row.registryId ?? row.registry_id ?? "").trim(),
    registryDomain: String(row.registryDomain ?? row.registry_domain ?? "").trim(),
    resourceSource: String(row.resourceSource ?? row.resource_source ?? "").trim(),
    resourcePresetId: String(row.resourcePresetId ?? row.resource_preset_id ?? "").trim(),
    addresses: safeJsonParse(row.addressesJson ?? row.addresses_json ?? "[]", []),
    publicDomains: normalizeDomainList(row.publicDomainsJson ?? row.public_domains_json ?? "[]", false, "", "", "", null),
    errorMessage: row.errorMessage ?? row.error_message ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    startedAt: row.startedAt ?? row.started_at ?? null,
    stoppedAt: row.stoppedAt ?? row.stopped_at ?? null,
    userName: row.userName || "",
    username: row.username || "",
  } : null;
}
function normalizeMagnumClusterRow(row) {
  return row ? {
    id: Number(row.id),
    userId: Number(row.userId ?? row.user_id),
    userName: row.userName || "",
    username: row.username || "",
    status: row.status,
    projectName: String(row.projectName ?? row.project_name ?? "").trim(),
    name: row.name ?? "",
    clusterTemplateId: row.clusterTemplateId ?? row.cluster_template_id ?? "",
    clusterTemplateName: row.clusterTemplateName ?? row.cluster_template_name ?? "",
    kubernetesVersion: String(row.kubernetesVersion ?? row.kubernetes_version ?? "").trim(),
    nodeCount: Number(row.nodeCount ?? row.node_count ?? 1),
    masterCount: Number(row.masterCount ?? row.master_count ?? 1),
    controlPlaneFlavor: String(row.controlPlaneFlavor ?? row.control_plane_flavor ?? "").trim(),
    workerFlavor: String(row.workerFlavor ?? row.worker_flavor ?? "").trim(),
    clusterUuid: row.clusterUuid ?? row.cluster_uuid ?? "",
    apiAddress: row.apiAddress ?? row.api_address ?? "",
    apiPort: Number(row.apiPort ?? row.api_port ?? 6443) || 6443,
    externalApiEnabled: Boolean(Number(row.externalApiEnabled ?? row.external_api_enabled ?? 0)),
    externalApiHost: String(row.externalApiHost ?? row.external_api_host ?? "").trim(),
    externalApiPort: row.externalApiPort != null ? Number(row.externalApiPort) : row.external_api_port != null ? Number(row.external_api_port) : null,
    statusReason: row.statusReason ?? row.status_reason ?? "",
    errorMessage: row.errorMessage ?? row.error_message ?? "",
    createdAt: row.createdAt ?? row.created_at ?? null,
    startedAt: row.startedAt ?? row.started_at ?? null,
    deletedAt: row.deletedAt ?? row.deleted_at ?? null,
  } : null;
}
function normalizeTroveInstanceRow(row) {
  return row ? {
    id: Number(row.id),
    userId: Number(row.userId ?? row.user_id),
    userName: row.userName || "",
    username: row.username || "",
    status: row.status,
    projectName: String(row.projectName ?? row.project_name ?? "").trim(),
    name: row.name ?? "",
    datastoreType: row.datastoreType ?? row.datastore_type ?? "",
    datastoreVersion: row.datastoreVersion ?? row.datastore_version ?? "",
    flavor: row.flavor ?? "",
    sizeGb: Number(row.sizeGb ?? row.size_gb ?? 1),
    instanceUuid: row.instanceUuid ?? row.instance_uuid ?? "",
    hostname: row.hostname ?? "",
    databaseName: row.databaseName ?? row.database_name ?? "",
    databaseUsername: row.databaseUsername ?? row.database_username ?? "",
    credentialSecretRef: row.credentialSecretRef ?? row.credential_secret_ref ?? "",
    databasePort: Number(row.databasePort ?? row.database_port ?? 3306) || 3306,
    statusReason: row.statusReason ?? row.status_reason ?? "",
    errorMessage: row.errorMessage ?? row.error_message ?? "",
    createdAt: row.createdAt ?? row.created_at ?? null,
    startedAt: row.startedAt ?? row.started_at ?? null,
    deletedAt: row.deletedAt ?? row.deleted_at ?? null,
  } : null;
}
function normalizeResourceDeletionJobRow(row) {
  return row ? {
    id: String(row.id || ""),
    resourceType: String(row.resourceType ?? row.resource_type ?? ""),
    resourceId: String(row.resourceId ?? row.resource_id ?? ""),
    userId: row.userId != null ? Number(row.userId) : row.user_id != null ? Number(row.user_id) : null,
    projectName: String(row.projectName ?? row.project_name ?? ""),
    resourceName: String(row.resourceName ?? row.resource_name ?? ""),
    remoteId: String(row.remoteId ?? row.remote_id ?? ""),
    status: String(row.status || "pending"),
    attempts: Number(row.attempts || 0),
    lastError: String(row.lastError ?? row.last_error ?? ""),
    metadata: safeJsonParse(row.metadataJson ?? row.metadata_json ?? "{}", {}),
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    completedAt: row.completedAt ?? row.completed_at ?? null,
  } : null;
}
function normalizeCloudConsoleActionRow(row) {
  return row ? {
    id:Number(row.id),userId:Number(row.userId??row.user_id),userName:row.userName||"",username:row.username||"",projectName:String(row.projectName??row.project_name??"").trim(),
    operation:String(row.operation||""),request:safeJsonParse(row.requestJson??row.request_json??"{}",{}),status:String(row.status||"requested"),
    estimatedMonthlyCost:Number(row.estimatedMonthlyCost??row.estimated_monthly_cost??0)||0,result:safeJsonParse(row.resultJson??row.result_json??"{}",{}),
    errorMessage:String(row.errorMessage??row.error_message??""),reviewedBy:row.reviewedBy??row.reviewed_by??null,createdAt:row.createdAt??row.created_at??null,
    reviewedAt:row.reviewedAt??row.reviewed_at??null,executedAt:row.executedAt??row.executed_at??null,
  }:null;
}
function normalizeInternalImageCacheRow(row) {
  return row ? {
    id: String(row.id),
    registryUrl: row.registryUrl ?? row.registry_url ?? "",
    namespace: row.namespace || "",
    repository: row.repository || "",
    tag: row.tag || "latest",
    imageName: row.imageName ?? row.image_name ?? "",
    source: row.source || "harbor-cache",
    artifactDigest: row.artifactDigest ?? row.artifact_digest ?? "",
    pushedAt: row.pushedAt ?? row.pushed_at ?? "",
    cachedAt: row.cachedAt ?? row.cached_at ?? "",
    metadata: safeJsonParse(row.metadataJson ?? row.metadata_json ?? "{}", {}),
  } : null;
}
function normalizeWrittenExamAttemptRow(row) {
  return row ? {
    id: String(row.id),
    courseId: Number(row.courseId ?? row.course_id),
    examTitle: row.examTitle ?? row.exam_title ?? "",
    userId: Number(row.userId ?? row.user_id),
    userName: row.userName ?? row.user_name ?? "",
    username: row.username ?? "",
    answers: safeJsonParse(row.answersJson ?? row.answers_json ?? "{}", {}),
    score: Number(row.score || 0),
    totalPoints: Number(row.totalPoints ?? row.total_points ?? 0),
    passed: Boolean(row.passed),
    results: safeJsonParse(row.resultsJson ?? row.results_json ?? "[]", []),
    submittedAt: row.submittedAt ?? row.submitted_at ?? null,
  } : null;
}
function normalizeLabExamAttemptRow(row) {
  return row ? {
    id: String(row.id),
    courseId: Number(row.courseId ?? row.course_id),
    examTitle: row.examTitle ?? row.exam_title ?? "",
    userId: Number(row.userId ?? row.user_id),
    userName: row.userName ?? row.user_name ?? "",
    username: row.username ?? "",
    sessionId: String(row.sessionId ?? row.session_id ?? "").trim(),
    labRequestId: row.labRequestId != null ? Number(row.labRequestId) : row.lab_request_id != null ? Number(row.lab_request_id) : null,
    exitCode: Number(row.exitCode ?? row.exit_code ?? 1),
    stdoutText: row.stdoutText ?? row.stdout_text ?? "",
    stderrText: row.stderrText ?? row.stderr_text ?? "",
    score: Number(row.score || 0),
    totalPoints: Number(row.totalPoints ?? row.total_points ?? 0),
    passed: Boolean(row.passed),
    messages: safeJsonParse(row.messagesJson ?? row.messages_json ?? "[]", []),
    screenshotPath: row.screenshotPath ?? row.screenshot_path ?? "",
    screenshotUrl: row.screenshotUrl ?? row.screenshot_url ?? "",
    resultSnapshot: safeJsonParse(row.resultSnapshotJson ?? row.result_snapshot_json ?? "{}", {}),
    reviewStatus: row.reviewStatus ?? row.review_status ?? "pending",
    reviewNote: row.reviewNote ?? row.review_note ?? "",
    reviewedBy: row.reviewedBy != null ? Number(row.reviewedBy) : row.reviewed_by != null ? Number(row.reviewed_by) : null,
    reviewedAt: row.reviewedAt ?? row.reviewed_at ?? null,
    reviewHistory: safeJsonParse(row.reviewHistoryJson ?? row.review_history_json ?? "[]", []),
    resultMailSentAt: row.resultMailSentAt ?? row.result_mail_sent_at ?? null,
    submittedAt: row.submittedAt ?? row.submitted_at ?? null,
  } : null;
}
function normalizeCertificateRow(row) {
  return row ? {
    id: String(row.id),
    userId: Number(row.userId ?? row.user_id),
    userName: row.userName ?? row.user_name ?? "",
    username: row.username ?? "",
    courseId: Number(row.courseId ?? row.course_id),
    courseTitle: row.courseTitle ?? row.course_title ?? "",
    certificateCode: row.certificateCode ?? row.certificate_code ?? "",
    verifyCode: row.verifyCode ?? row.verify_code ?? "",
    writtenAttemptId: row.writtenAttemptId ?? row.written_attempt_id ?? null,
    labAttemptId: row.labAttemptId ?? row.lab_attempt_id ?? null,
    issuedAt: row.issuedAt ?? row.issued_at ?? null,
  } : null;
}
function normalizeNoticeRow(row) {
  return row ? {
    id: Number(row.id),
    title: row.title ?? "",
    body: row.body ?? "",
    isPinned: Boolean(Number(row.isPinned ?? row.is_pinned ?? 0)),
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    createdByName: row.createdByName || "",
    createdByUsername: row.createdByUsername || "",
  } : null;
}
function normalizeQnaCommentRow(row) {
  return row ? {
    id: Number(row.id),
    postId: Number(row.postId ?? row.post_id),
    userId: Number(row.userId ?? row.user_id),
    parentCommentId: row.parentCommentId != null ? Number(row.parentCommentId) : row.parent_comment_id != null ? Number(row.parent_comment_id) : null,
    body: row.body ?? "",
    createdAt: row.createdAt ?? row.created_at ?? null,
    userName: row.userName || "",
    username: row.username || "",
  } : null;
}
function normalizeQnaRow(row) {
  return row ? {
    id: Number(row.id),
    userId: Number(row.userId ?? row.user_id),
    courseId: row.courseId != null ? Number(row.courseId) : row.course_id != null ? Number(row.course_id) : null,
    courseTitle: String(row.courseTitle ?? row.course_title ?? "").trim(),
    labRequestId: row.labRequestId != null ? Number(row.labRequestId) : row.lab_request_id != null ? Number(row.lab_request_id) : null,
    labStatus: String(row.labStatus ?? row.lab_status ?? "").trim(),
    labInstanceIp: String(row.labInstanceIp ?? row.lab_instance_ip ?? "").trim(),
    labStackName: String(row.labStackName ?? row.lab_stack_name ?? "").trim(),
    postType: String(row.postType ?? row.post_type ?? "question").trim() || "question",
    status: String(row.status || "open").trim() || "open",
    title: row.title ?? "",
    body: row.body ?? "",
    answerText: row.answerText ?? row.answer_text ?? "",
    answeredBy: row.answeredBy != null ? Number(row.answeredBy) : row.answered_by != null ? Number(row.answered_by) : null,
    acceptedCommentId: row.acceptedCommentId != null ? Number(row.acceptedCommentId) : row.accepted_comment_id != null ? Number(row.accepted_comment_id) : null,
    helpfulCount: Math.max(0, Number(row.helpfulCount ?? row.helpful_count ?? 0) || 0),
    labContext: safeJsonParse(row.labContextJson ?? row.lab_context_json ?? "{}", {}),
    createdAt: row.createdAt ?? row.created_at ?? null,
    answeredAt: row.answeredAt ?? row.answered_at ?? null,
    userName: row.userName || "",
    username: row.username || "",
    comments: Array.isArray(row.comments) ? row.comments : [],
  } : null;
}
function normalizeDiscountCouponRow(row) {
  return row ? {
    id: Number(row.id),
    code: String(row.code || "").trim(),
    userId: row.userId != null ? Number(row.userId) : row.user_id != null ? Number(row.user_id) : null,
    userName: String(row.userName ?? row.user_name ?? "").trim(),
    username: String(row.username || "").trim(),
    courseId: row.courseId != null ? Number(row.courseId) : row.course_id != null ? Number(row.course_id) : null,
    source: String(row.source || "manual").trim(),
    discountType: String(row.discountType ?? row.discount_type ?? "percent").trim(),
    discountValue: Math.max(0, Number(row.discountValue ?? row.discount_value ?? 0) || 0),
    maxUses: Math.max(1, Number(row.maxUses ?? row.max_uses ?? 1) || 1),
    usedCount: Math.max(0, Number(row.usedCount ?? row.used_count ?? 0) || 0),
    status: String(row.status || "active").trim(),
    expiresAt: row.expiresAt ?? row.expires_at ?? null,
    metadata: safeJsonParse(row.metadataJson ?? row.metadata_json ?? "{}", {}),
    createdAt: row.createdAt ?? row.created_at ?? null,
    usedAt: row.usedAt ?? row.used_at ?? null,
    courseTitle: String(row.courseTitle ?? row.course_title ?? "").trim(),
  } : null;
}
function normalizeTermsKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "service" || key === "service_additional_terms" || key === "additional") return "service_additional_terms";
  if (key === "standard" || key === "standard_terms") return "standard_terms";
  return key.replace(/[^a-z0-9_:-]/g, "_").slice(0, 80) || "standard_terms";
}
function hashTermsContent({ termsKey, version, title, summary, body }) {
  return createHash("sha256")
    .update([termsKey, version, title, summary, body].map((item) => String(item || "")).join("\n---\n"))
    .digest("hex");
}
function normalizeTermsVersionRow(row) {
  return row ? {
    id: Number(row.id),
    termsKey: row.termsKey ?? row.terms_key ?? "",
    title: row.title || "",
    version: row.version || "",
    summary: row.summary || "",
    body: row.body || "",
    contentHash: row.contentHash ?? row.content_hash ?? "",
    isActive: normalizeFlag(row.isActive ?? row.is_active),
    createdBy: row.createdBy ?? row.created_by ?? null,
    createdByName: row.createdByName ?? row.created_by_name ?? "",
    createdByUsername: row.createdByUsername ?? row.created_by_username ?? "",
    createdAt: row.createdAt ?? row.created_at ?? "",
    updatedAt: row.updatedAt ?? row.updated_at ?? "",
    publishedAt: row.publishedAt ?? row.published_at ?? null,
  } : null;
}
function normalizeArenaSeasonRow(row) {
  return row ? {
    id: Number(row.id),
    code: String(row.code || "").trim(),
    title: String(row.title || "").trim(),
    status: String(row.status || "scheduled").trim(),
    resetPolicy: String(row.resetPolicy ?? row.reset_policy ?? "quarterly").trim(),
    startedAt: row.startedAt ?? row.started_at ?? null,
    endsAt: row.endsAt ?? row.ends_at ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
  } : null;
}
function normalizeArenaScenarioRow(row) {
  return row ? {
    id: Number(row.id),
    code: String(row.code || "").trim(),
    title: String(row.title || "").trim(),
    summary: String(row.summary || "").trim(),
    backendType: String(row.backendType ?? row.backend_type ?? "container").trim(),
    consoleType: String(row.consoleType ?? row.console_type ?? "xterm").trim(),
    tier: String(row.tier || "normal").trim(),
    difficulty: Math.max(1, Number(row.difficulty || 1)),
    ttlSeconds: Math.max(60, Number(row.ttlSeconds ?? row.ttl_seconds ?? 1200)),
    validatorKey: String(row.validatorKey ?? row.validator_key ?? "").trim(),
    imageName: String(row.imageName ?? row.image_name ?? "").trim(),
    flavorName: String(row.flavorName ?? row.flavor_name ?? "").trim(),
    networkName: String(row.networkName ?? row.network_name ?? "").trim(),
    metadata: safeJsonParse(row.metadataJson ?? row.metadata_json ?? "{}", {}),
    createdAt: row.createdAt ?? row.created_at ?? null,
  } : null;
}
function normalizeArenaNodeRow(row) {
  return row ? {
    id: Number(row.id),
    seasonId: Number(row.seasonId ?? row.season_id),
    scenarioId: Number(row.scenarioId ?? row.scenario_id),
    nodeCode: String(row.nodeCode ?? row.node_code ?? "").trim(),
    label: String(row.label || "").trim(),
    mapX: Number(row.mapX ?? row.map_x ?? 0),
    mapY: Number(row.mapY ?? row.map_y ?? 0),
    currentOwnerUserId: row.currentOwnerUserId != null ? Number(row.currentOwnerUserId) : row.current_owner_user_id != null ? Number(row.current_owner_user_id) : null,
    currentOwnerHandle: String(row.currentOwnerHandle ?? row.current_owner_handle ?? "").trim(),
    firstCaptureAt: row.firstCaptureAt ?? row.first_capture_at ?? null,
    status: String(row.status || "open").trim(),
    createdAt: row.createdAt ?? row.created_at ?? null,
    scenarioCode: String(row.scenarioCode ?? row.scenario_code ?? "").trim(),
    scenarioTitle: String(row.scenarioTitle ?? row.scenario_title ?? "").trim(),
    backendType: String(row.backendType ?? row.backend_type ?? "").trim(),
    consoleType: String(row.consoleType ?? row.console_type ?? "").trim(),
    tier: String(row.tier || "").trim(),
  } : null;
}
function normalizeArenaSessionRow(row) {
  return row ? {
    id: Number(row.id),
    seasonId: Number(row.seasonId ?? row.season_id),
    nodeId: Number(row.nodeId ?? row.node_id),
    scenarioId: Number(row.scenarioId ?? row.scenario_id),
    userId: Number(row.userId ?? row.user_id),
    state: String(row.state || "provisioning").trim(),
    backendType: String(row.backendType ?? row.backend_type ?? "container").trim(),
    consoleType: String(row.consoleType ?? row.console_type ?? "xterm").trim(),
    resourceId: String(row.resourceId ?? row.resource_id ?? "").trim(),
    resourceName: String(row.resourceName ?? row.resource_name ?? "").trim(),
    consoleUrl: String(row.consoleUrl ?? row.console_url ?? "").trim(),
    validatorState: String(row.validatorState ?? row.validator_state ?? "pending").trim(),
    startedAt: row.startedAt ?? row.started_at ?? null,
    expiresAt: row.expiresAt ?? row.expires_at ?? null,
    endedAt: row.endedAt ?? row.ended_at ?? null,
    terminatedReason: String(row.terminatedReason ?? row.terminated_reason ?? "").trim(),
    metadata: safeJsonParse(row.metadataJson ?? row.metadata_json ?? "{}", {}),
    nodeCode: String(row.nodeCode ?? row.node_code ?? "").trim(),
    nodeLabel: String(row.nodeLabel ?? row.node_label ?? "").trim(),
    scenarioCode: String(row.scenarioCode ?? row.scenario_code ?? "").trim(),
    scenarioTitle: String(row.scenarioTitle ?? row.scenario_title ?? "").trim(),
  } : null;
}
function normalizeArenaEventRow(row) {
  return row ? {
    id: Number(row.id),
    seasonId: Number(row.seasonId ?? row.season_id),
    nodeId: row.nodeId != null ? Number(row.nodeId) : row.node_id != null ? Number(row.node_id) : null,
    userId: row.userId != null ? Number(row.userId) : row.user_id != null ? Number(row.user_id) : null,
    eventType: String(row.eventType ?? row.event_type ?? "system").trim(),
    message: String(row.message || "").trim(),
    payload: safeJsonParse(row.payloadJson ?? row.payload_json ?? "{}", {}),
    createdAt: row.createdAt ?? row.created_at ?? null,
  } : null;
}
function normalizeArenaAttemptRow(row) {
  return row ? {
    id: Number(row.id),
    sessionId: Number(row.sessionId ?? row.session_id),
    seasonId: Number(row.seasonId ?? row.season_id),
    nodeId: Number(row.nodeId ?? row.node_id),
    userId: Number(row.userId ?? row.user_id),
    result: String(row.result || "failed").trim(),
    score: Number(row.score || 0),
    mmrDelta: Number(row.mmrDelta ?? row.mmr_delta ?? 0),
    rankDelta: Number(row.rankDelta ?? row.rank_delta ?? 0),
    durationSeconds: Number(row.durationSeconds ?? row.duration_seconds ?? 0),
    firstTryBonus: Number(row.firstTryBonus ?? row.first_try_bonus ?? 0),
    remainingSeconds: Number(row.remainingSeconds ?? row.remaining_seconds ?? 0),
    createdAt: row.createdAt ?? row.created_at ?? null,
    nodeCode: String(row.nodeCode ?? row.node_code ?? "").trim(),
    nodeLabel: String(row.nodeLabel ?? row.node_label ?? "").trim(),
    scenarioCode: String(row.scenarioCode ?? row.scenario_code ?? "").trim(),
    scenarioTitle: String(row.scenarioTitle ?? row.scenario_title ?? "").trim(),
  } : null;
}
function normalizeArenaCaptureRow(row) {
  return row ? {
    id: Number(row.id),
    seasonId: Number(row.seasonId ?? row.season_id),
    nodeId: Number(row.nodeId ?? row.node_id),
    userId: Number(row.userId ?? row.user_id),
    captureType: String(row.captureType ?? row.capture_type ?? "first_blood").trim(),
    createdAt: row.createdAt ?? row.created_at ?? null,
    nodeCode: String(row.nodeCode ?? row.node_code ?? "").trim(),
    nodeLabel: String(row.nodeLabel ?? row.node_label ?? "").trim(),
    scenarioCode: String(row.scenarioCode ?? row.scenario_code ?? "").trim(),
    scenarioTitle: String(row.scenarioTitle ?? row.scenario_title ?? "").trim(),
  } : null;
}

function normalizeLuckyDrawEventRow(row) {
  return row ? {
    id: Number(row.id),
    title: String(row.title || "").trim(),
    description: String(row.description || "").trim(),
    status: String(row.status || "draft").trim(),
    timezone: String(row.timezone || "Asia/Seoul").trim() || "Asia/Seoul",
    startAt: row.startAt ?? row.start_at ?? null,
    endAt: row.endAt ?? row.end_at ?? null,
    dailyAttemptLimit: Math.max(1, Number(row.dailyAttemptLimit ?? row.daily_attempt_limit ?? 3) || 3),
    requireVerifiedUser: Boolean(Number(row.requireVerifiedUser ?? row.require_verified_user ?? 1)),
    allowNewUsersOnly: Boolean(Number(row.allowNewUsersOnly ?? row.allow_new_users_only ?? 0)),
    newUserWindowDays: Math.max(1, Number(row.newUserWindowDays ?? row.new_user_window_days ?? 30) || 30),
    allowDormantUsersOnly: Boolean(Number(row.allowDormantUsersOnly ?? row.allow_dormant_users_only ?? 0)),
    dormantDays: Math.max(1, Number(row.dormantDays ?? row.dormant_days ?? 30) || 30),
    createdBy: row.createdBy != null ? Number(row.createdBy) : row.created_by != null ? Number(row.created_by) : null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  } : null;
}

function normalizeLuckyDrawRewardRow(row) {
  return row ? {
    id: Number(row.id),
    eventId: Number(row.eventId ?? row.event_id),
    rewardType: String(row.rewardType ?? row.reward_type ?? "message").trim(),
    label: String(row.label || "").trim(),
    courseId: row.courseId != null ? Number(row.courseId) : row.course_id != null ? Number(row.course_id) : null,
    couponDiscountType: String(row.couponDiscountType ?? row.coupon_discount_type ?? "percent").trim(),
    couponDiscountValue: Math.max(0, Number(row.couponDiscountValue ?? row.coupon_discount_value ?? 0) || 0),
    couponExpiresInDays: Math.max(1, Number(row.couponExpiresInDays ?? row.coupon_expires_in_days ?? 7) || 7),
    probabilityWeight: Math.max(1, Number(row.probabilityWeight ?? row.probability_weight ?? 1) || 1),
    totalStock: row.totalStock != null ? Math.max(0, Number(row.totalStock)) : row.total_stock != null ? Math.max(0, Number(row.total_stock)) : null,
    dailyStock: row.dailyStock != null ? Math.max(0, Number(row.dailyStock)) : row.daily_stock != null ? Math.max(0, Number(row.daily_stock)) : null,
    perUserLimit: Math.max(1, Number(row.perUserLimit ?? row.per_user_limit ?? 1) || 1),
    messageText: String(row.messageText ?? row.message_text ?? "").trim(),
    isActive: Boolean(Number(row.isActive ?? row.is_active ?? 1)),
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    courseTitle: String(row.courseTitle ?? row.course_title ?? "").trim(),
  } : null;
}

function normalizeLuckyDrawAttemptRow(row) {
  return row ? {
    id: Number(row.id),
    eventId: Number(row.eventId ?? row.event_id),
    rewardId: row.rewardId != null ? Number(row.rewardId) : row.reward_id != null ? Number(row.reward_id) : null,
    userId: Number(row.userId ?? row.user_id),
    userName: String(row.userName ?? row.user_name ?? "").trim(),
    username: String(row.username || "").trim(),
    attemptDate: String(row.attemptDate ?? row.attempt_date ?? "").trim(),
    attemptNo: Math.max(1, Number(row.attemptNo ?? row.attempt_no ?? 1) || 1),
    resultStatus: String(row.resultStatus ?? row.result_status ?? "issued").trim(),
    grantId: row.grantId != null ? Number(row.grantId) : row.grant_id != null ? Number(row.grant_id) : null,
    ipAddress: String(row.ipAddress ?? row.ip_address ?? "").trim(),
    userAgent: String(row.userAgent ?? row.user_agent ?? "").trim(),
    createdAt: row.createdAt ?? row.created_at ?? null,
    rewardLabel: String(row.rewardLabel ?? row.reward_label ?? "").trim(),
    rewardType: String(row.rewardType ?? row.reward_type ?? "").trim(),
  } : null;
}

function normalizeLuckyDrawGrantRow(row) {
  return row ? {
    id: Number(row.id),
    eventId: Number(row.eventId ?? row.event_id),
    rewardId: row.rewardId != null ? Number(row.rewardId) : row.reward_id != null ? Number(row.reward_id) : null,
    userId: Number(row.userId ?? row.user_id),
    grantType: String(row.grantType ?? row.grant_type ?? "message").trim(),
    status: String(row.status || "issued").trim(),
    label: String(row.label || "").trim(),
    payload: safeJsonParse(row.payloadJson ?? row.payload_json ?? "{}", {}),
    createdAt: row.createdAt ?? row.created_at ?? null,
    usedAt: row.usedAt ?? row.used_at ?? null,
    revokedAt: row.revokedAt ?? row.revoked_at ?? null,
    rewardLabel: String(row.rewardLabel ?? row.reward_label ?? "").trim(),
    rewardType: String(row.rewardType ?? row.reward_type ?? "").trim(),
  } : null;
}

function normalizeCourseSurveyResponseRow(row) {
  const extractLegacyFeedbackText = (body) => {
    const text = String(body || "").trim();
    if (!text) return "";
    const lines = text.split(/\r?\n/);
    const markerIndex = lines.findIndex((line) => line.includes("응답을 바탕으로 AI 해설을 생성했습니다."));
    if (markerIndex >= 0) return lines.slice(markerIndex + 2).join("\n").trim();
    return text;
  };
  const feedbackText = String(row?.llmFeedbackText ?? row?.llm_feedback_text ?? "").trim()
    || extractLegacyFeedbackText(row?.legacyFeedbackBody ?? row?.legacy_feedback_body);
  const feedbackMessageId = Number(row?.llmFeedbackMessageId ?? row?.llm_feedback_message_id ?? row?.legacyFeedbackMessageId ?? row?.legacy_feedback_message_id ?? 0) || null;
  const feedbackGeneratedBy = Number(row?.llmFeedbackGeneratedBy ?? row?.llm_feedback_generated_by ?? row?.legacyFeedbackGeneratedBy ?? row?.legacy_feedback_generated_by ?? 0) || null;
  const feedbackGeneratedAt = row?.llmFeedbackGeneratedAt ?? row?.llm_feedback_generated_at ?? row?.legacyFeedbackGeneratedAt ?? row?.legacy_feedback_generated_at ?? null;
  const feedbackDelivered = row?.llmFeedbackDelivered ?? row?.llm_feedback_delivered ?? (feedbackText ? 1 : 0);
  return row ? {
    id: Number(row.id),
    userId: Number(row.userId ?? row.user_id),
    userName: String(row.userName ?? row.user_name ?? "").trim(),
    username: String(row.username || "").trim(),
    courseId: Number(row.courseId ?? row.course_id),
    courseTitle: String(row.courseTitle ?? row.course_title ?? "").trim(),
    phase: String(row.phase || "").trim(),
    answers: safeJsonParse(row.answersJson ?? row.answers_json ?? "{}", {}),
    metrics: safeJsonParse(row.metricsJson ?? row.metrics_json ?? "{}", {}),
    submittedAt: row.submittedAt ?? row.submitted_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    feedback: feedbackText ? {
      text: feedbackText,
      model: String(row.llmFeedbackModel ?? row.llm_feedback_model ?? "").trim(),
      provider: String(row.llmFeedbackProvider ?? row.llm_feedback_provider ?? "").trim(),
      delivered: Boolean(Number(feedbackDelivered)),
      messageId: feedbackMessageId,
      generatedBy: feedbackGeneratedBy,
      generatedAt: feedbackGeneratedAt,
    } : null,
    feedbackAuto: {
      status: String(row.llmFeedbackAutoStatus ?? row.llm_feedback_auto_status ?? "none").trim() || "none",
      scheduledFor: row.llmFeedbackAutoScheduledFor ?? row.llm_feedback_auto_scheduled_for ?? null,
      attempts: Number(row.llmFeedbackAutoAttempts ?? row.llm_feedback_auto_attempts ?? 0) || 0,
      error: String(row.llmFeedbackAutoError ?? row.llm_feedback_auto_error ?? "").trim(),
      updatedAt: row.llmFeedbackAutoUpdatedAt ?? row.llm_feedback_auto_updated_at ?? null,
    },
  } : null;
}

function getNextKstSurveyFeedbackRunIso(now = new Date()) {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstDate = new Date(now.getTime() + kstOffsetMs);
  const nextKstRunUtcMs = Date.UTC(
    kstDate.getUTCFullYear(),
    kstDate.getUTCMonth(),
    kstDate.getUTCDate() + 1,
    0,
    5,
    0,
  ) - kstOffsetMs;
  return new Date(nextKstRunUtcMs).toISOString();
}

function normalizeMarketingSurveyRow(row) {
  const options = safeJsonParse(row?.optionsJson ?? row?.options_json ?? "[]", []);
  const mySubmission = row?.mySubmissionId || row?.my_submission_id ? {
    id: Number(row.mySubmissionId ?? row.my_submission_id),
    submittedAt: row.mySubmittedAt ?? row.my_submitted_at ?? null,
    optionIds: safeJsonParse(row.myOptionIdsJson ?? row.my_option_ids_json ?? "[]", []).map(Number).filter(Boolean),
  } : null;
  return row ? {
    id: Number(row.id),
    title: String(row.title || "").trim(),
    description: String(row.description || "").trim(),
    question: String(row.question || "").trim(),
    status: String(row.status || "draft").trim(),
    multiChoice: Boolean(Number(row.multiChoice ?? row.multi_choice ?? 0)),
    showResults: Boolean(Number(row.showResults ?? row.show_results ?? 1)),
    startAt: row.startAt ?? row.start_at ?? null,
    endAt: row.endAt ?? row.end_at ?? null,
    createdBy: row.createdBy != null ? Number(row.createdBy) : row.created_by != null ? Number(row.created_by) : null,
    createdByName: String(row.createdByName ?? row.created_by_name ?? "").trim(),
    createdByUsername: String(row.createdByUsername ?? row.created_by_username ?? "").trim(),
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    totalVotes: Number(row.totalVotes ?? row.total_votes ?? 0) || 0,
    options: Array.isArray(options) ? options.map((option) => ({
      id: Number(option.id),
      label: String(option.label || "").trim(),
      sortOrder: Number(option.sortOrder ?? option.sort_order ?? 0) || 0,
      voteCount: Number(option.voteCount ?? option.vote_count ?? 0) || 0,
    })).filter((option) => option.id && option.label) : [],
    mySubmission,
  } : null;
}

function normalizeMarketingSurveySubmissionRow(row) {
  return row ? {
    id: Number(row.id),
    surveyId: Number(row.surveyId ?? row.survey_id),
    surveyTitle: String(row.surveyTitle ?? row.survey_title ?? "").trim(),
    surveyQuestion: String(row.surveyQuestion ?? row.survey_question ?? "").trim(),
    userId: Number(row.userId ?? row.user_id),
    userName: String(row.userName ?? row.user_name ?? "").trim(),
    username: String(row.username || "").trim(),
    email: String(row.email || "").trim(),
    optionIds: safeJsonParse(row.optionIdsJson ?? row.option_ids_json ?? "[]", []).map(Number).filter(Boolean),
    optionLabels: safeJsonParse(row.optionLabelsJson ?? row.option_labels_json ?? "[]", []).map((item) => String(item || "").trim()).filter(Boolean),
    ipAddress: String(row.ipAddress ?? row.ip_address ?? "").trim(),
    userAgent: String(row.userAgent ?? row.user_agent ?? "").trim(),
    submittedAt: row.submittedAt ?? row.submitted_at ?? null,
  } : null;
}

function formatDateInTimeZone(date = new Date(), timeZone = "Asia/Seoul") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: String(timeZone || "Asia/Seoul").trim() || "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function buildLlmQuotaPolicy(settings, { role = "" } = {}) {
  const enabled = settings?.llmDailyQuotaEnabled !== false;
  const dailyLimit = Math.max(1, Number(settings?.llmDailyQuotaLimit || DEFAULT_LLM_DAILY_QUOTA_LIMIT) || DEFAULT_LLM_DAILY_QUOTA_LIMIT);
  const adminBypass = settings?.llmDailyQuotaAdminBypass !== false;
  const bypassed = adminBypass && String(role || "").trim().toLowerCase() === "admin";
  return {
    enabled,
    dailyLimit,
    adminBypass,
    bypassed,
  };
}

async function pgGetLlmQuotaStatus(userId, { role = "", settings = null, timeZone = "Asia/Seoul" } = {}) {
  const effectiveSettings = settings || await pgGetPlatformStatus();
  const policy = buildLlmQuotaPolicy(effectiveSettings, { role });
  const usageDate = formatDateInTimeZone(new Date(), timeZone);
  const numericUserId = Number(userId || 0);
  let row = null;
  if (numericUserId > 0) {
    row = (await withClient((c) => c.query(
      `SELECT user_id AS "userId", usage_date AS "usageDate", used_count AS "usedCount", success_count AS "successCount", last_question_at AS "lastQuestionAt"
       FROM llm_daily_usage
       WHERE user_id = $1 AND usage_date = $2`,
      [numericUserId, usageDate],
    ))).rows[0] || null;
  }
  const usedQuestions = Math.max(0, Number(row?.usedCount || 0) || 0);
  const remainingQuestions = policy.enabled && !policy.bypassed
    ? Math.max(0, policy.dailyLimit - usedQuestions)
    : null;
  return {
    enabled: policy.enabled,
    bypassed: policy.bypassed,
    adminBypass: policy.adminBypass,
    dailyLimit: policy.dailyLimit,
    usedQuestions,
    remainingQuestions,
    canAsk: !policy.enabled || policy.bypassed || usedQuestions < policy.dailyLimit,
    usageDate,
    timeZone,
    lastQuestionAt: row?.lastQuestionAt || "",
  };
}

async function pgConsumeLlmQuota(userId, { role = "", settings = null, timeZone = "Asia/Seoul" } = {}) {
  const effectiveSettings = settings || await pgGetPlatformStatus();
  const before = await pgGetLlmQuotaStatus(userId, { role, settings: effectiveSettings, timeZone });
  if (!before.enabled || before.bypassed) {
    return before;
  }
  const numericUserId = Number(userId || 0);
  if (numericUserId <= 0) {
    throw new Error("유효한 사용자 정보가 필요합니다.");
  }
  const now = new Date().toISOString();
  const result = await withClient((c) => c.query(
    `
      INSERT INTO llm_daily_usage (user_id, usage_date, used_count, success_count, last_question_at, created_at, updated_at)
      VALUES ($1, $2, 1, 1, $3, $3, $3)
      ON CONFLICT (user_id, usage_date) DO UPDATE
      SET used_count = llm_daily_usage.used_count + 1,
          success_count = llm_daily_usage.success_count + 1,
          last_question_at = EXCLUDED.last_question_at,
          updated_at = EXCLUDED.updated_at
      WHERE llm_daily_usage.used_count < $4
      RETURNING used_count AS "usedCount", success_count AS "successCount", last_question_at AS "lastQuestionAt"
    `,
    [numericUserId, before.usageDate, now, before.dailyLimit],
  ));
  if (!result.rows[0]) {
    const error = new Error("오늘 AI 질문 한도를 모두 사용했습니다.");
    error.code = "LLM_DAILY_QUOTA_EXCEEDED";
    error.quota = await pgGetLlmQuotaStatus(userId, { role, settings: effectiveSettings, timeZone });
    throw error;
  }
  const usedQuestions = Math.max(0, Number(result.rows[0]?.usedCount || 0) || 0);
  return {
    ...before,
    usedQuestions,
    remainingQuestions: Math.max(0, before.dailyLimit - usedQuestions),
    canAsk: usedQuestions < before.dailyLimit,
    lastQuestionAt: result.rows[0]?.lastQuestionAt || now,
  };
}

function weightedPick(items = []) {
  const total = items.reduce((sum, item) => sum + Math.max(1, Number(item?.probabilityWeight || 1) || 1), 0);
  let cursor = Math.random() * total;
  for (const item of items) {
    cursor -= Math.max(1, Number(item?.probabilityWeight || 1) || 1);
    if (cursor < 0) return item;
  }
  return items[0] || null;
}

function generateDiscountCouponCode(prefix = "LUCKY") {
  return `${String(prefix || "LUCKY").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "LUCKY"}-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}
async function nextId(client, tableName) {
  const safe = new Set(["users", "oauth_accounts", "cloud_console_actions", "courses", "textbooks", "course_textbooks", "invite_codes", "user_course_access", "course_access_requests", "payments", "course_quotes", "course_quote_items", "discount_coupons", "terms_versions", "user_terms_agreements", "user_marketing_consents", "lab_requests", "custom_lab_requests", "consulting_requests", "public_quote_inquiries", "self_service_vms", "self_service_project_requests", "zun_containers", "magnum_clusters", "trove_instances", "notices", "qna_posts", "qna_comments", "qna_helpful_votes", "user_access_logs", "admin_audit_logs", "user_access_restrictions", "user_notifications", "user_messages", "schedule_events", "terminal_replay_events", "arena_seasons", "arena_scenarios", "arena_nodes", "arena_sessions", "arena_attempts", "arena_captures", "arena_events", "lucky_draw_events", "lucky_draw_rewards", "lucky_draw_attempts", "lucky_draw_grants", "course_survey_responses", "marketing_surveys", "marketing_survey_options", "marketing_survey_submissions", "marketing_survey_submission_choices"]);
  if (!safe.has(tableName)) throw new Error(`Unsupported table for nextId: ${tableName}`);
  await client.query(`LOCK TABLE ${tableName} IN EXCLUSIVE MODE`);
  const result = await client.query(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM ${tableName}`);
  return Number(result.rows[0]?.id || 1);
}
const qOne = async (sql, params, norm) => normalizeUserRow ? norm((await withClient((c) => c.query(sql, params))).rows[0] || null) : null;
function serializeCourseInput(input) {
  const heatParameters = input.heatParameters && typeof input.heatParameters === "object"
    ? input.heatParameters
    : {};
  const labProvisioningTimeoutMinutes = Math.max(1, Math.min(120, Math.round(Number(
    input.labProvisioningTimeoutMinutes
      ?? heatParameters.labProvisioningTimeoutMinutes
      ?? 10,
  ) || 10)));
  return {
    slug: String(input.slug || "").trim(),
    category: String(input.category || "").trim(),
    courseType: ["standard", "online", "exam", "package"].includes(String(input.courseType || "standard").trim().toLowerCase())
      ? String(input.courseType || "standard").trim().toLowerCase()
      : "standard",
    packageItemsJson: JSON.stringify(Array.from(new Set((Array.isArray(input.packageItems) ? input.packageItems : []).map(Number).filter((id) => Number.isInteger(id) && id > 0)))),
    programType: normalizeCourseProgramTypeValue(input.programType),
    title: String(input.title || "").trim(),
    summary: String(input.summary || "").trim(),
    price: Math.max(0, Number(input.price || 0)),
    promoEnabled: Number(Boolean(input.promoEnabled)),
    promoPrice: Math.max(0, Number(input.promoPrice || 0)),
    promoStartsAt: String(input.promoStartsAt || "").trim(),
    promoEndsAt: String(input.promoEndsAt || "").trim(),
    duration: String(input.duration || "").trim(),
    courseAccessDays: resolveCourseAccessDays(input.courseAccessDays),
    level: String(input.level || "").trim(),
    body: String(input.body || "").trim(),
    youtubeUrl: String(input.youtubeUrl || "").trim(),
    onlineMeetingUrl: String(input.onlineMeetingUrl || "").trim(),
    onlineBoardUrl: String(input.onlineBoardUrl || "").trim(),
    onlineCourseNotice: String(input.onlineCourseNotice || "").trim(),
    onlineSessionNote: String(input.onlineSessionNote || "").trim(),
    labGuideMarkdown: String(input.labGuideMarkdown || ""),
    commandsMarkdown: String(input.commandsMarkdown || ""),
    aiSystemPrompt: String(input.aiSystemPrompt || "").trim(),
    aiQuickPromptsJson: JSON.stringify(normalizeAiQuickPrompts(input.aiQuickPrompts)),
    externalToolLinksJson: JSON.stringify(normalizeExternalToolLinks(input.externalToolLinks)),
    externalLearningToolsJson: JSON.stringify(normalizeExternalToolLinks(input.externalLearningTools)),
    labStartChecklistJson: JSON.stringify(normalizeLabStartChecklist(input.labStartChecklist)),
      objectivesJson: JSON.stringify(Array.isArray(input.objectives) ? input.objectives : []),
      materialsJson: JSON.stringify(Array.isArray(input.materials) ? input.materials : []),
      courseCurriculumJson: JSON.stringify(Array.isArray(input.courseCurriculum) ? input.courseCurriculum : []),
      courseVideosJson: JSON.stringify(Array.isArray(input.courseVideos) ? input.courseVideos : []),
      courseRecordingsJson: JSON.stringify(normalizeCourseRecordings(input.courseRecordings)),
      exampleFilesJson: JSON.stringify(Array.isArray(input.exampleFiles) ? input.exampleFiles : []),
      gitRepositoriesJson: JSON.stringify(Array.isArray(input.gitRepositories) ? input.gitRepositories : []),
      surveyConfigJson: JSON.stringify(input.surveyConfig && typeof input.surveyConfig === "object" ? input.surveyConfig : {}),
      labEnabled: Number(Boolean(input.labEnabled)),
      labApprovalMode: String(input.labApprovalMode || "manual").trim() || "manual",
      publicDomainApprovalMode: normalizeCourseFeatureApprovalMode(input.publicDomainApprovalMode),
      publicTcpApprovalMode: normalizeCourseFeatureApprovalMode(input.publicTcpApprovalMode),
      externalSshApprovalMode: normalizeCourseFeatureApprovalMode(input.externalSshApprovalMode),
      externalRdpApprovalMode: normalizeCourseFeatureApprovalMode(input.externalRdpApprovalMode),
      externalSshRouteMode: String(input.externalSshRouteMode || "").trim().toLowerCase() === "domain"
        ? "domain"
        : "both",
      labRetentionMode: String(input.labRetentionMode || "ephemeral").trim() || "ephemeral",
      labRetentionPreset: String(input.labRetentionPreset || "1").trim() || "1",
      labRetentionDays: Math.max(1, Number(input.labRetentionDays || 1) || 1),
      allowResumeExistingLab: Number(Boolean(input.allowResumeExistingLab)),
      labResizePolicy: String(input.labResizePolicy || "requestable").trim() || "requestable",
      labResizeAllowedFlavors: (Array.isArray(input.labResizeAllowedFlavors) ? input.labResizeAllowedFlavors : String(input.labResizeAllowedFlavors || "").split(","))
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .join(","),
      terminalReplayMode: ["inherit", "enabled", "disabled"].includes(String(input.terminalReplayMode || "").trim())
        ? String(input.terminalReplayMode || "").trim()
        : "inherit",
      labBackendType: normalizeLabBackendType(input.labBackendType),
      containerImageName: String(input.containerImageName || "").trim(),
      containerCommandText: String(input.containerCommandText || "").trim(),
      containerExposedPort: input.containerExposedPort == null || input.containerExposedPort === ""
        ? null
        : Math.max(1, Number(input.containerExposedPort || 22) || 22),
      containerAccessMode: ["ssh", "console", "ssh_console"].includes(String(input.containerAccessMode || "").trim())
        ? String(input.containerAccessMode || "").trim()
        : "console",
      containerConsoleMode: ["zun", "ssh"].includes(String(input.containerConsoleMode || "").trim())
        ? String(input.containerConsoleMode || "").trim()
        : "zun",
      trafficMonitoringEnabled: input.trafficMonitoringEnabled == null ? 1 : Number(Boolean(input.trafficMonitoringEnabled)),
      trafficDailyLimitGb: Math.max(0, Number(input.trafficDailyLimitGb || 0)),
      trafficTotalLimitGb: Math.max(0, Number(input.trafficTotalLimitGb || 0)),
      trafficExceededAction: String(input.trafficExceededAction || "warn").trim() || "warn",
      heatApiUrl: String(input.heatApiUrl || "").trim(),
    heatTemplateName: String(input.heatTemplateName || "").trim(),
    heatStackPrefix: String(input.heatStackPrefix || "").trim(),
    heatParametersJson: JSON.stringify({
      ...heatParameters,
      labProvisioningTimeoutMinutes,
    }),
    terminalSshUser: String(input.terminalSshUser || "").trim(),
    terminalSshPort: Number(input.terminalSshPort || 22),
    terminalJumpHost: String(input.terminalJumpHost || "").trim(),
    terminalJumpUser: String(input.terminalJumpUser || "").trim(),
    isPublished: Number(Boolean(input.isPublished)),
    isLandingPreview: Number(Boolean(input.isLandingPreview)),
    courseStatus: ["published", "coming_soon", "archived"].includes(String(input.courseStatus || "").trim()) ? String(input.courseStatus || "").trim() : "published",
    releaseLabel: String(input.releaseLabel || "").trim(),
    accessScope: String(input.accessScope || "public").trim() || "public",
    accessCode: String(input.accessCode || "").trim(),
  };
}

const USER_MARKETING_CONSENT_SELECT = `COALESCE((SELECT json_build_object('hasDecision', true, 'emailConsent', umc.consented, 'emailConsentAt', umc.agreed_at, 'emailRevokedAt', umc.revoked_at) FROM user_marketing_consents umc WHERE umc.user_id=u.id AND umc.channel='email' AND umc.purpose='marketing' ORDER BY umc.created_at DESC, umc.id DESC LIMIT 1),'{}'::json) AS "marketingConsentJson"`;
async function pgFindUserByUsername(username) { return normalizeUserRow((await withClient((c) => c.query(`SELECT u.id,u.name,u.email,u.username,u.password_hash AS "passwordHash",u.signup_reason AS "signupReason",u.role,u.status,u.user_source AS "userSource",u.approval_mail_sent_at AS "approvalMailSentAt",u.qna_last_read_at AS "qnaLastReadAt",u.otp_enabled AS "otpEnabled",u.otp_secret AS "otpSecret",u.support_message_enabled AS "supportMessageEnabled",u.self_service_vm_enabled AS "selfServiceVmEnabled",u.poc_free_access_enabled AS "pocFreeAccessEnabled",u.instructor_share_enabled AS "instructorShareEnabled",u.admin_permissions_json AS "adminPermissionsJson",u.created_at AS "createdAt",${USER_MARKETING_CONSENT_SELECT},COALESCE((SELECT json_agg(json_build_object('courseId', uca.course_id, 'title', c.title, 'slug', c.slug, 'grantedVia', uca.granted_via, 'expiresAt', uca.expires_at, 'createdAt', uca.created_at) ORDER BY uca.created_at DESC, uca.id DESC) FROM user_course_access uca JOIN courses c ON c.id=uca.course_id WHERE uca.user_id=u.id),'[]'::json) AS "enrolledCoursesJson" FROM users u WHERE u.username=$1`, [username]))).rows[0] || null); }
async function pgFindUserByEmail(email) { return normalizeUserRow((await withClient((c) => c.query(`SELECT u.id,u.name,u.email,u.username,u.password_hash AS "passwordHash",u.signup_reason AS "signupReason",u.role,u.status,u.user_source AS "userSource",u.approval_mail_sent_at AS "approvalMailSentAt",u.qna_last_read_at AS "qnaLastReadAt",u.otp_enabled AS "otpEnabled",u.otp_secret AS "otpSecret",u.support_message_enabled AS "supportMessageEnabled",u.self_service_vm_enabled AS "selfServiceVmEnabled",u.poc_free_access_enabled AS "pocFreeAccessEnabled",u.instructor_share_enabled AS "instructorShareEnabled",u.admin_permissions_json AS "adminPermissionsJson",u.created_at AS "createdAt",${USER_MARKETING_CONSENT_SELECT},COALESCE((SELECT json_agg(json_build_object('courseId', uca.course_id, 'title', c.title, 'slug', c.slug, 'grantedVia', uca.granted_via, 'expiresAt', uca.expires_at, 'createdAt', uca.created_at) ORDER BY uca.created_at DESC, uca.id DESC) FROM user_course_access uca JOIN courses c ON c.id=uca.course_id WHERE uca.user_id=u.id),'[]'::json) AS "enrolledCoursesJson" FROM users u WHERE lower(u.email)=lower($1) ORDER BY u.id ASC LIMIT 1`, [String(email || "").trim()]))).rows[0] || null); }
async function pgFindUserById(id) { return normalizeUserRow((await withClient((c) => c.query(`SELECT u.id,u.name,u.email,u.username,u.signup_reason AS "signupReason",u.role,u.status,u.user_source AS "userSource",u.approval_mail_sent_at AS "approvalMailSentAt",u.qna_last_read_at AS "qnaLastReadAt",u.otp_enabled AS "otpEnabled",u.otp_secret AS "otpSecret",u.support_message_enabled AS "supportMessageEnabled",u.self_service_vm_enabled AS "selfServiceVmEnabled",u.poc_free_access_enabled AS "pocFreeAccessEnabled",u.instructor_share_enabled AS "instructorShareEnabled",u.admin_permissions_json AS "adminPermissionsJson",u.created_at AS "createdAt",${USER_MARKETING_CONSENT_SELECT},COALESCE((SELECT json_agg(json_build_object('courseId', uca.course_id, 'title', c.title, 'slug', c.slug, 'grantedVia', uca.granted_via, 'expiresAt', uca.expires_at, 'createdAt', uca.created_at) ORDER BY uca.created_at DESC, uca.id DESC) FROM user_course_access uca JOIN courses c ON c.id=uca.course_id WHERE uca.user_id=u.id),'[]'::json) AS "enrolledCoursesJson",COALESCE((SELECT json_agg(json_build_object('termsKey', uta.terms_key, 'title', uta.terms_title, 'version', uta.terms_version, 'contentHash', uta.content_hash, 'agreedAt', uta.agreed_at) ORDER BY uta.agreed_at DESC, uta.id DESC) FROM user_terms_agreements uta WHERE uta.user_id=u.id),'[]'::json) AS "termsAgreementsJson" FROM users u WHERE u.id=$1`, [id]))).rows[0] || null); }
async function pgCreateUser(input) {
  const { name, email = "", username, passwordHash, role = "student", status = "pending", userSource = "self_signup", approvalMailSentAt = null, signupReason = "" } = input;
  return withTx(async (client) => {
    const id = await nextId(client, "users");
    const createdAt = new Date().toISOString();
    await client.query(
      `INSERT INTO users (
         id, name, email, username, password_hash, signup_reason,
         role, status, user_source, approval_mail_sent_at,
         otp_enabled, otp_secret, support_message_enabled, self_service_vm_enabled, poc_free_access_enabled, instructor_share_enabled, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17
       )`,
      [
        id,
        name,
        String(email || "").trim(),
        username,
        passwordHash,
        String(signupReason || "").trim(),
        normalizeUserRole(role),
        normalizeUserStatus(status),
        String(userSource || "self_signup").trim() || "self_signup",
        approvalMailSentAt,
        0,
        "",
        Number(Boolean(input.supportMessageEnabled)),
        Number(Boolean(input.selfServiceVmEnabled)),
        Number(Boolean(input.pocFreeAccessEnabled)),
        Number(Boolean(input.instructorShareEnabled)),
        createdAt,
      ],
    );
    return normalizeUserRow((await client.query(`SELECT u.id,u.name,u.email,u.username,u.signup_reason AS "signupReason",u.role,u.status,u.user_source AS "userSource",u.approval_mail_sent_at AS "approvalMailSentAt",u.qna_last_read_at AS "qnaLastReadAt",u.otp_enabled AS "otpEnabled",u.support_message_enabled AS "supportMessageEnabled",u.self_service_vm_enabled AS "selfServiceVmEnabled",u.poc_free_access_enabled AS "pocFreeAccessEnabled",u.instructor_share_enabled AS "instructorShareEnabled",u.admin_permissions_json AS "adminPermissionsJson",u.created_at AS "createdAt",COALESCE((SELECT json_agg(json_build_object('courseId', uca.course_id, 'title', c.title, 'slug', c.slug, 'grantedVia', uca.granted_via, 'expiresAt', uca.expires_at, 'createdAt', uca.created_at) ORDER BY uca.created_at DESC, uca.id DESC) FROM user_course_access uca JOIN courses c ON c.id=uca.course_id WHERE uca.user_id=u.id),'[]'::json) AS "enrolledCoursesJson" FROM users u WHERE u.id=$1`, [id])).rows[0] || null);
  });
}
async function pgFindOauthAccount(provider, providerUserId) {
  return normalizeOauthAccountRow((await withClient((c) => c.query(
    `SELECT id,user_id AS "userId",provider,provider_user_id AS "providerUserId",email,display_name AS "displayName",profile_json AS "profileJson",created_at AS "createdAt",updated_at AS "updatedAt"
     FROM oauth_accounts
     WHERE provider=$1 AND provider_user_id=$2`,
    [String(provider || "").trim(), String(providerUserId || "").trim()],
  ))).rows[0] || null);
}
async function pgCreateOauthAccount({ userId, provider, providerUserId, email = "", displayName = "", profile = {} }) {
  return withTx(async (client) => {
    const id = await nextId(client, "oauth_accounts");
    const now = new Date().toISOString();
    const result = await client.query(
      `INSERT INTO oauth_accounts (
         id, user_id, provider, provider_user_id, email, display_name, profile_json, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9
       )
       ON CONFLICT (provider, provider_user_id) DO NOTHING
       RETURNING id,user_id AS "userId",provider,provider_user_id AS "providerUserId",email,display_name AS "displayName",profile_json AS "profileJson",created_at AS "createdAt",updated_at AS "updatedAt"`,
      [
        id,
        Number(userId),
        String(provider || "").trim(),
        String(providerUserId || "").trim(),
        String(email || "").trim(),
        String(displayName || "").trim(),
        JSON.stringify(profile || {}),
        now,
        now,
      ],
    );
    if (result.rows[0]) return normalizeOauthAccountRow(result.rows[0]);
    return normalizeOauthAccountRow((await client.query(
      `SELECT id,user_id AS "userId",provider,provider_user_id AS "providerUserId",email,display_name AS "displayName",profile_json AS "profileJson",created_at AS "createdAt",updated_at AS "updatedAt"
       FROM oauth_accounts
       WHERE provider=$1 AND provider_user_id=$2`,
      [String(provider || "").trim(), String(providerUserId || "").trim()],
    )).rows[0] || null);
  });
}
async function pgListUsers() {
  const now = new Date();
  const nowIso = now.toISOString();
  const activeSince = new Date(Date.now() - DEFAULT_ACCESS_ACTIVE_WITHIN_MINUTES * 60 * 1000).toISOString();
  const weekStart = getKstPeriodStartIso("week", now);
  const monthStart = getKstPeriodStartIso("month", now);
  const yearStart = getKstPeriodStartIso("year", now);
  return (await withClient((c) => c.query(`
    SELECT u.id,
           u.name,
           u.email,
           u.username,
           u.signup_reason AS "signupReason",
           u.role,
           u.status,
           u.user_source AS "userSource",
           u.approval_mail_sent_at AS "approvalMailSentAt",
           u.qna_last_read_at AS "qnaLastReadAt",
           u.otp_enabled AS "otpEnabled",
           u.support_message_enabled AS "supportMessageEnabled",
           u.self_service_vm_enabled AS "selfServiceVmEnabled",
           u.poc_free_access_enabled AS "pocFreeAccessEnabled",
           u.instructor_share_enabled AS "instructorShareEnabled",
           u.admin_permissions_json AS "adminPermissionsJson",
           u.created_at AS "createdAt",
           ${USER_MARKETING_CONSENT_SELECT},
           (SELECT MAX(ual.created_at)
            FROM user_access_logs ual
            WHERE ual.user_id = u.id
              AND ual.event_type IN ('login', 'session_active')) AS "lastActiveAt",
           EXISTS(SELECT 1
                  FROM user_access_logs ual
                  WHERE ual.user_id = u.id
                    AND ual.created_at >= $1
                    AND ual.event_type IN ('login', 'session_active')) AS "activeNow",
           EXISTS(SELECT 1
                  FROM user_access_logs ual
                  WHERE ual.user_id = u.id
                    AND ual.created_at >= $2
                    AND ual.event_type IN ('login', 'session_active')) AS "activeWeek",
           EXISTS(SELECT 1
                  FROM user_access_logs ual
                  WHERE ual.user_id = u.id
                    AND ual.created_at >= $3
                    AND ual.event_type IN ('login', 'session_active')) AS "activeMonth",
           EXISTS(SELECT 1
                  FROM user_access_logs ual
                  WHERE ual.user_id = u.id
                    AND ual.created_at >= $4
                    AND ual.event_type IN ('login', 'session_active')) AS "activeYear",
           (SELECT COUNT(*)
            FROM user_access_logs ual
            WHERE ual.user_id = u.id
              AND ual.event_type = 'login') AS "accessLogCount",
           (SELECT json_build_object(
              'id', uar.id,
              'userId', uar.user_id,
              'reason', uar.reason,
              'restrictedUntil', uar.restricted_until,
              'metadataJson', uar.metadata_json,
              'createdAt', uar.created_at,
              'resolvedAt', uar.resolved_at
            )
            FROM user_access_restrictions uar
            WHERE uar.user_id = u.id
              AND uar.resolved_at IS NULL
              AND uar.restricted_until > $5
            ORDER BY uar.restricted_until DESC, uar.id DESC
            LIMIT 1) AS "activeAccessRestrictionJson",
           COALESCE((SELECT json_agg(json_build_object('courseId', uca.course_id, 'title', c.title, 'slug', c.slug, 'grantedVia', uca.granted_via, 'expiresAt', uca.expires_at, 'createdAt', uca.created_at) ORDER BY uca.created_at DESC, uca.id DESC) FROM user_course_access uca JOIN courses c ON c.id=uca.course_id WHERE uca.user_id=u.id),'[]'::json) AS "enrolledCoursesJson",
           COALESCE((SELECT json_agg(json_build_object('termsKey', uta.terms_key, 'title', uta.terms_title, 'version', uta.terms_version, 'contentHash', uta.content_hash, 'agreedAt', uta.agreed_at) ORDER BY uta.agreed_at DESC, uta.id DESC) FROM user_terms_agreements uta WHERE uta.user_id=u.id),'[]'::json) AS "termsAgreementsJson"
    FROM users u
    ORDER BY u.created_at DESC,u.id DESC
  `, [activeSince, weekStart, monthStart, yearStart, nowIso]))).rows.map(normalizeUserRow);
}
async function pgRecordUserMarketingConsent({
  userId,
  emailConsent = false,
  source = "",
  ipAddress = "",
  userAgent = "",
} = {}) {
  await withTx(async (c) => {
    const id = await nextId(c, "user_marketing_consents");
    const consented = Boolean(emailConsent);
    const now = new Date().toISOString();
    await c.query(`
      INSERT INTO user_marketing_consents (
        id, user_id, channel, purpose, consented, source,
        ip_address, user_agent, agreed_at, revoked_at, created_at
      )
      VALUES ($1,$2,'email','marketing',$3,$4,$5,$6,$7,$8,$9)
    `, [
      id,
      Number(userId),
      Number(consented),
      String(source || "").trim(),
      String(ipAddress || "").trim(),
      String(userAgent || "").trim(),
      consented ? now : null,
      consented ? null : now,
      now,
    ]);
  });
  return pgFindUserById(userId);
}
async function pgUpdateUserAccess(id, patch) {
  const adminPermissionsJson = patch.adminPermissions === undefined
    ? null
    : JSON.stringify(normalizeAdminPermissions(patch.adminPermissions));
  await withClient((c) => c.query(
    `UPDATE users
     SET role=$2,
         status=$3,
         support_message_enabled=COALESCE($4, support_message_enabled),
         self_service_vm_enabled=COALESCE($5, self_service_vm_enabled),
         poc_free_access_enabled=COALESCE($6, poc_free_access_enabled),
         instructor_share_enabled=COALESCE($7, instructor_share_enabled),
         admin_permissions_json=COALESCE($8, admin_permissions_json)
     WHERE id=$1`,
    [
      id,
      normalizeUserRole(patch.role),
      normalizeUserStatus(patch.status),
      patch.supportMessageEnabled === undefined ? null : Number(Boolean(patch.supportMessageEnabled)),
      patch.selfServiceVmEnabled === undefined ? null : Number(Boolean(patch.selfServiceVmEnabled)),
      patch.pocFreeAccessEnabled === undefined ? null : Number(Boolean(patch.pocFreeAccessEnabled)),
      patch.instructorShareEnabled === undefined ? null : Number(Boolean(patch.instructorShareEnabled)),
      adminPermissionsJson,
    ],
  ));
  return pgFindUserById(id);
}
async function pgMarkApprovalMailSent(id, sentAt = new Date().toISOString()) { await withClient((c) => c.query(`UPDATE users SET approval_mail_sent_at=$2 WHERE id=$1`, [id, sentAt])); return pgFindUserById(id); }
async function pgDeleteUser(id) {
  await withTx(async (c) => {
    await c.query(`DELETE FROM password_reset_pins WHERE user_id=$1 OR issued_by=$1`, [id]);
    await c.query(`DELETE FROM user_access_logs WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM user_notifications WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM user_messages WHERE sender_id=$1 OR recipient_id=$1`, [id]);
    await c.query(`DELETE FROM user_marketing_consents WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM qna_comments WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM qna_posts WHERE user_id=$1 OR answered_by=$1`, [id]);
    await c.query(`DELETE FROM lab_exam_attempts WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM written_exam_attempts WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM certificates WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM lucky_draw_attempts WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM lucky_draw_grants WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM arena_events WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM arena_captures WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM arena_attempts WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM arena_sessions WHERE user_id=$1`, [id]);
    await c.query(`UPDATE arena_nodes SET current_owner_user_id=NULL, current_owner_handle='' WHERE current_owner_user_id=$1`, [id]);
    await c.query(`DELETE FROM lab_requests WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM self_service_vms WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM self_service_project_requests WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM zun_containers WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM magnum_clusters WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM trove_instances WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM consulting_requests WHERE user_id=$1 OR reviewed_by=$1`, [id]);
    await c.query(`DELETE FROM custom_lab_requests WHERE user_id=$1 OR reviewed_by=$1`, [id]);
    await c.query(`UPDATE invite_codes SET created_by=NULL WHERE created_by=$1`, [id]);
    await c.query(`DELETE FROM course_access_requests WHERE user_id=$1 OR reviewed_by=$1`, [id]);
    await c.query(`DELETE FROM payments WHERE user_id=$1 OR reviewed_by=$1`, [id]);
    await c.query(`DELETE FROM user_course_access WHERE user_id=$1`, [id]);
    await c.query(`DELETE FROM users WHERE id=$1`, [id]);
  });
}
async function pgUpdateUserPassword(id, passwordHash) { await withClient((c) => c.query(`UPDATE users SET password_hash=$2 WHERE id=$1`, [id, passwordHash])); return pgFindUserById(id); }
async function pgUpdateUserProfile(id, patch) { await withClient((c) => c.query(`UPDATE users SET name=$2,email=$3 WHERE id=$1`, [id, patch.name, String(patch.email || "").trim()])); return pgFindUserById(id); }
async function pgUpdateUserQnaLastReadAt(id, qnaLastReadAt) { await withClient((c) => c.query(`UPDATE users SET qna_last_read_at=$2 WHERE id=$1`, [id, String(qnaLastReadAt || "").trim()])); return pgFindUserById(id); }
async function pgUpdateUserOtp(id, patch) { await withClient((c) => c.query(`UPDATE users SET otp_enabled=$2,otp_secret=$3 WHERE id=$1`, [id, patch.otpEnabled ? 1 : 0, String(patch.otpSecret || "").trim()])); return pgFindUserById(id); }
async function pgUpdateUsername(id, username) { await withClient((c) => c.query(`UPDATE users SET username=$2 WHERE id=$1`, [id, username])); return pgFindUserById(id); }
async function pgCleanupPasswordResetPins() {
  return withClient(async (c) => {
    const result = await c.query(`
      DELETE FROM password_reset_pins
      WHERE used_at IS NOT NULL
         OR (
           NULLIF(expires_at, '') IS NOT NULL
           AND expires_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
           AND expires_at::timestamptz <= NOW()
         )
    `);
    return Number(result.rowCount || 0);
  });
}
async function pgCreatePasswordResetPin({ userId, pinHash, issuedBy = null, expiresAt }) {
  return withTx(async (client) => {
    await client.query(`
      DELETE FROM password_reset_pins
      WHERE used_at IS NOT NULL
         OR (
           NULLIF(expires_at, '') IS NOT NULL
           AND expires_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
           AND expires_at::timestamptz <= NOW()
         )
    `);
    await client.query(`DELETE FROM password_reset_pins WHERE user_id=$1 AND used_at IS NULL`, [userId]);
    const id = randomUUID();
    await client.query(`INSERT INTO password_reset_pins (id,user_id,pin_hash,issued_by,expires_at,attempt_count,created_at) VALUES ($1,$2,$3,$4,$5,0,CURRENT_TIMESTAMP::text)`,
      [id, userId, pinHash, issuedBy, expiresAt]);
    return normalizePasswordResetPinRow((await client.query(`SELECT pr.id,pr.user_id AS "userId",pr.pin_hash AS "pinHash",pr.issued_by AS "issuedBy",pr.expires_at AS "expiresAt",pr.used_at AS "usedAt",pr.attempt_count AS "attemptCount",pr.created_at AS "createdAt",u.username,u.name,u.email FROM password_reset_pins pr JOIN users u ON u.id=pr.user_id WHERE pr.id=$1`, [id])).rows[0] || null);
  });
}
async function pgFindActivePasswordResetPinByUserId(userId) {
  await pgCleanupPasswordResetPins();
  return normalizePasswordResetPinRow((await withClient((c) => c.query(`
    SELECT pr.id,pr.user_id AS "userId",pr.pin_hash AS "pinHash",pr.issued_by AS "issuedBy",
           pr.expires_at AS "expiresAt",pr.used_at AS "usedAt",pr.attempt_count AS "attemptCount",
           pr.created_at AS "createdAt",u.username,u.name,u.email
    FROM password_reset_pins pr
    JOIN users u ON u.id=pr.user_id
    WHERE pr.user_id=$1
      AND pr.used_at IS NULL
      AND (
        NULLIF(pr.expires_at, '') IS NULL
        OR (
          pr.expires_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          AND pr.expires_at::timestamptz > NOW()
        )
      )
    ORDER BY pr.created_at DESC
    LIMIT 1
  `, [userId]))).rows[0] || null);
}
async function pgIncrementPasswordResetPinAttempt(id) {
  await withClient((c) => c.query(`UPDATE password_reset_pins SET attempt_count = attempt_count + 1 WHERE id=$1`, [id]));
  return normalizePasswordResetPinRow((await withClient((c) => c.query(`SELECT id,user_id AS "userId",pin_hash AS "pinHash",issued_by AS "issuedBy",expires_at AS "expiresAt",used_at AS "usedAt",attempt_count AS "attemptCount",created_at AS "createdAt" FROM password_reset_pins WHERE id=$1`, [id]))).rows[0] || null);
}
async function pgConsumePasswordResetPin(id, usedAt = new Date().toISOString()) {
  await withClient((c) => c.query(`UPDATE password_reset_pins SET used_at=$2 WHERE id=$1`, [id, usedAt]));
}
async function pgListPasswordResetPins(limit = 20) {
  await pgCleanupPasswordResetPins();
  return (await withClient((c) => c.query(`
    SELECT pr.id,
           pr.user_id AS "userId",
           pr.issued_by AS "issuedBy",
           pr.expires_at AS "expiresAt",
           pr.used_at AS "usedAt",
           pr.attempt_count AS "attemptCount",
           pr.created_at AS "createdAt",
           u.username,
           u.name,
           u.email,
           issuer.username AS "issuedByUsername",
           issuer.name AS "issuedByName"
    FROM password_reset_pins pr
    JOIN users u ON u.id = pr.user_id
    LEFT JOIN users issuer ON issuer.id = pr.issued_by
    WHERE pr.used_at IS NULL
      AND (
        NULLIF(pr.expires_at, '') IS NULL
        OR (
          pr.expires_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          AND pr.expires_at::timestamptz > NOW()
        )
      )
    ORDER BY pr.created_at DESC
    LIMIT $1
  `, [limit]))).rows;
}

async function pgCreateUserAccessLog({
  userId = null,
  userName = "",
  username = "",
  eventType,
  ipAddress = "",
  userAgent = "",
  createdAt = new Date().toISOString(),
}) {
  return withTx(async (c) => {
    const id = await nextId(c, "user_access_logs");
    await c.query(
      `INSERT INTO user_access_logs (id,user_id,user_name,username,event_type,ip_address,user_agent,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        userId != null ? Number(userId) : null,
        String(userName || "").trim(),
        String(username || "").trim(),
        String(eventType || "").trim(),
        String(ipAddress || "").trim(),
        String(userAgent || "").trim(),
        createdAt,
      ],
    );
    return normalizeUserAccessLogRow({
      id,
      userId,
      userName,
      username,
      eventType,
      ipAddress,
      userAgent,
      createdAt,
    });
  });
}

async function pgListUserAccessLogs(limit = 50, options = {}) {
  const since = String(options?.since || "").trim();
  const params = [Math.max(1, Number(limit || 50))];
  let whereClause = "";
  if (since) {
    params.push(since);
    whereClause = "WHERE created_at >= $2";
  }
  return (await withClient((c) => c.query(`
    SELECT id,
           user_id AS "userId",
           user_name AS "userName",
           username,
           event_type AS "eventType",
           ip_address AS "ipAddress",
           user_agent AS "userAgent",
           created_at AS "createdAt"
    FROM user_access_logs
    ${whereClause}
    ORDER BY created_at DESC, id DESC
    LIMIT $1
  `, params))).rows.map(normalizeUserAccessLogRow);
}

async function pgCreateAdminAuditLog({
  adminUserId = null,
  adminUsername = "",
  action = "",
  targetType = "",
  targetId = "",
  summary = "",
  metadata = {},
  ipAddress = "",
  userAgent = "",
  createdAt = new Date().toISOString(),
}) {
  const normalizedAction = String(action || "").trim();
  if (!normalizedAction) return null;
  return withTx(async (c) => {
    const id = await nextId(c, "admin_audit_logs");
    await c.query(
      `INSERT INTO admin_audit_logs
        (id,admin_user_id,admin_username,action,target_type,target_id,summary,metadata_json,ip_address,user_agent,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        adminUserId != null ? Number(adminUserId) : null,
        String(adminUsername || "").trim(),
        normalizedAction,
        String(targetType || "").trim(),
        String(targetId || "").trim(),
        String(summary || "").trim(),
        JSON.stringify(metadata || {}),
        String(ipAddress || "").trim(),
        String(userAgent || "").trim(),
        createdAt,
      ],
    );
    return normalizeAdminAuditLogRow({
      id,
      adminUserId,
      adminUsername,
      action: normalizedAction,
      targetType,
      targetId,
      summary,
      metadataJson: JSON.stringify(metadata || {}),
      ipAddress,
      userAgent,
      createdAt,
    });
  });
}

async function pgListAdminAuditLogs(limit = 100, options = {}) {
  const normalizedLimit = Math.max(1, Math.min(2000, Number(limit || 100) || 100));
  const action = String(options?.action || "").trim();
  const targetType = String(options?.targetType || "").trim();
  const since = String(options?.since || "").trim();
  const params = [normalizedLimit];
  const where = [];
  if (action) {
    params.push(action);
    where.push(`action = $${params.length}`);
  }
  if (targetType) {
    params.push(targetType);
    where.push(`target_type = $${params.length}`);
  }
  if (since) {
    params.push(since);
    where.push(`created_at >= $${params.length}`);
  }
  return (await withClient((c) => c.query(`
    SELECT id,
           admin_user_id AS "adminUserId",
           admin_username AS "adminUsername",
           action,
           target_type AS "targetType",
           target_id AS "targetId",
           summary,
           metadata_json AS "metadataJson",
           ip_address AS "ipAddress",
           user_agent AS "userAgent",
           created_at AS "createdAt"
    FROM admin_audit_logs
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC, id DESC
    LIMIT $1
  `, params))).rows.map(normalizeAdminAuditLogRow);
}

async function pgListRecentUserAccessSummaries({ since, limit = 20 } = {}) {
  const sinceIso = String(since || "").trim();
  if (!sinceIso) return [];
  const rowLimit = Math.max(1, Number(limit || 20));
  return (await withClient((c) => c.query(`
    WITH recent AS (
      SELECT id,
             user_id,
             user_name,
             username,
             event_type,
             ip_address,
             user_agent,
             created_at
      FROM user_access_logs
      WHERE user_id IS NOT NULL
        AND created_at >= $1
    ),
    latest AS (
      SELECT DISTINCT ON (user_id)
             user_id,
             user_name,
             username,
             event_type,
             ip_address,
             user_agent,
             created_at
      FROM recent
      ORDER BY user_id, created_at DESC, id DESC
    ),
    aggregate AS (
      SELECT user_id,
             MIN(created_at) AS first_seen_at,
             MAX(created_at) AS last_active_at,
             COUNT(*) AS access_log_count,
             COUNT(*) FILTER (WHERE event_type = 'login') AS login_count,
             COUNT(DISTINCT NULLIF(ip_address, '')) AS ip_count
      FROM recent
      GROUP BY user_id
    )
    SELECT latest.user_id AS "userId",
           latest.user_name AS "userName",
           latest.username,
           latest.event_type AS "lastEventType",
           latest.ip_address AS "lastIpAddress",
           latest.user_agent AS "lastUserAgent",
           aggregate.first_seen_at AS "firstSeenAt",
           aggregate.last_active_at AS "lastActiveAt",
           aggregate.access_log_count AS "accessLogCount",
           aggregate.login_count AS "loginCount",
           aggregate.ip_count AS "ipCount"
    FROM aggregate
    JOIN latest ON latest.user_id = aggregate.user_id
    ORDER BY aggregate.last_active_at DESC, latest.user_id DESC
    LIMIT $2
  `, [sinceIso, rowLimit]))).rows.map((row) => ({
    userId: Number(row.userId || 0),
    userName: String(row.userName || "").trim(),
    username: String(row.username || "").trim(),
    lastEventType: String(row.lastEventType || "").trim(),
    lastIpAddress: String(row.lastIpAddress || "").trim(),
    lastUserAgent: String(row.lastUserAgent || "").trim(),
    firstSeenAt: row.firstSeenAt ?? row.first_seen_at ?? null,
    lastActiveAt: row.lastActiveAt ?? row.last_active_at ?? null,
    accessLogCount: Number(row.accessLogCount ?? row.access_log_count ?? 0),
    loginCount: Number(row.loginCount ?? row.login_count ?? 0),
    ipCount: Number(row.ipCount ?? row.ip_count ?? 0),
  }));
}

async function pgUpsertUserSessionDevice({
  sessionId,
  userId,
  ipAddress = "",
  ipPrefix = "",
  userAgentHash = "",
  userAgent = "",
  seenAt = new Date().toISOString(),
}) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId || !userId) return null;
  return normalizeUserSessionDeviceRow((await withClient((c) => c.query(`
    INSERT INTO user_session_devices
      (session_id, user_id, ip_address, ip_prefix, user_agent_hash, user_agent, first_seen_at, last_seen_at, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'active')
    ON CONFLICT (session_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      ip_address = EXCLUDED.ip_address,
      ip_prefix = EXCLUDED.ip_prefix,
      user_agent_hash = EXCLUDED.user_agent_hash,
      user_agent = EXCLUDED.user_agent,
      last_seen_at = EXCLUDED.last_seen_at,
      status = 'active'
    RETURNING session_id AS "sessionId",
              user_id AS "userId",
              ip_address AS "ipAddress",
              ip_prefix AS "ipPrefix",
              user_agent_hash AS "userAgentHash",
              user_agent AS "userAgent",
              first_seen_at AS "firstSeenAt",
              last_seen_at AS "lastSeenAt",
              warned_at AS "warnedAt",
              restricted_at AS "restrictedAt",
              status
  `, [
    normalizedSessionId,
    Number(userId),
    String(ipAddress || "").trim(),
    String(ipPrefix || "").trim(),
    String(userAgentHash || "").trim(),
    String(userAgent || "").trim().slice(0, 500),
    seenAt,
  ]))).rows[0] || null);
}

async function pgListActiveUserSessionDevices(userId, activeSince) {
  return (await withClient((c) => c.query(`
    SELECT session_id AS "sessionId",
           user_id AS "userId",
           ip_address AS "ipAddress",
           ip_prefix AS "ipPrefix",
           user_agent_hash AS "userAgentHash",
           user_agent AS "userAgent",
           first_seen_at AS "firstSeenAt",
           last_seen_at AS "lastSeenAt",
           warned_at AS "warnedAt",
           restricted_at AS "restrictedAt",
           status
    FROM user_session_devices
    WHERE user_id=$1
      AND status='active'
      AND last_seen_at >= $2
    ORDER BY last_seen_at DESC
  `, [Number(userId), activeSince]))).rows.map(normalizeUserSessionDeviceRow);
}

async function pgMarkUserSessionDeviceWarned(sessionId, warnedAt = new Date().toISOString()) {
  return normalizeUserSessionDeviceRow((await withClient((c) => c.query(`
    UPDATE user_session_devices
       SET warned_at = COALESCE(warned_at, $2),
           restricted_at = COALESCE(restricted_at, $2)
     WHERE session_id=$1
     RETURNING session_id AS "sessionId",
               user_id AS "userId",
               ip_address AS "ipAddress",
               ip_prefix AS "ipPrefix",
               user_agent_hash AS "userAgentHash",
               user_agent AS "userAgent",
               first_seen_at AS "firstSeenAt",
               last_seen_at AS "lastSeenAt",
               warned_at AS "warnedAt",
               restricted_at AS "restrictedAt",
               status
  `, [String(sessionId || "").trim(), warnedAt]))).rows[0] || null);
}

async function pgGetActiveUserAccessRestriction(userId, nowIso = new Date().toISOString()) {
  return normalizeUserAccessRestrictionRow((await withClient((c) => c.query(`
    SELECT id,
           user_id AS "userId",
           reason,
           restricted_until AS "restrictedUntil",
           metadata_json AS "metadataJson",
           created_at AS "createdAt",
           resolved_at AS "resolvedAt"
    FROM user_access_restrictions
    WHERE user_id=$1
      AND resolved_at IS NULL
      AND restricted_until > $2
    ORDER BY restricted_until DESC, id DESC
    LIMIT 1
  `, [Number(userId), nowIso]))).rows[0] || null);
}

async function pgCreateUserAccessRestriction({
  userId,
  reason = "account_sharing",
  restrictedUntil,
  metadata = {},
  createdAt = new Date().toISOString(),
}) {
  return withTx(async (c) => {
    const existing = normalizeUserAccessRestrictionRow((await c.query(`
      SELECT id,
             user_id AS "userId",
             reason,
             restricted_until AS "restrictedUntil",
             metadata_json AS "metadataJson",
             created_at AS "createdAt",
             resolved_at AS "resolvedAt"
      FROM user_access_restrictions
      WHERE user_id=$1
        AND resolved_at IS NULL
        AND restricted_until > $2
      ORDER BY restricted_until DESC, id DESC
      LIMIT 1
    `, [Number(userId), createdAt])).rows[0] || null);
    if (existing) return existing;
    const id = await nextId(c, "user_access_restrictions");
    await c.query(`
      INSERT INTO user_access_restrictions (id,user_id,reason,restricted_until,metadata_json,created_at)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [
      id,
      Number(userId),
      String(reason || "account_sharing").trim() || "account_sharing",
      restrictedUntil,
      JSON.stringify(metadata || {}),
      createdAt,
    ]);
    return normalizeUserAccessRestrictionRow({
      id,
      userId,
      reason,
      restrictedUntil,
      metadataJson: JSON.stringify(metadata || {}),
      createdAt,
      resolvedAt: null,
    });
  });
}
async function pgResolveActiveAccountSharingRestriction(userId, resolvedAt = new Date().toISOString()) {
  const normalizedUserId = Number(userId);
  if (!normalizedUserId) return [];
  return withTx(async (c) => {
    const result = await c.query(`
      UPDATE user_access_restrictions
         SET resolved_at=$2
       WHERE user_id=$1
         AND reason='account_sharing'
         AND resolved_at IS NULL
         AND restricted_until > $2
      RETURNING id,
                user_id AS "userId",
                reason,
                restricted_until AS "restrictedUntil",
                metadata_json AS "metadataJson",
                created_at AS "createdAt",
                resolved_at AS "resolvedAt"
    `, [normalizedUserId, resolvedAt]);
    await c.query(`
      UPDATE user_session_devices
         SET warned_at=NULL,
             restricted_at=NULL
       WHERE user_id=$1
    `, [normalizedUserId]);
    return result.rows.map(normalizeUserAccessRestrictionRow);
  });
}

async function pgGetUserAccessStats({ activeWithinMinutes = DEFAULT_ACCESS_ACTIVE_WITHIN_MINUTES, recentDays = 5 } = {}) {
  const minutes = Math.max(1, Number(activeWithinMinutes || DEFAULT_ACCESS_ACTIVE_WITHIN_MINUTES) || DEFAULT_ACCESS_ACTIVE_WITHIN_MINUTES);
  const days = Math.max(1, Number(recentDays || 5));
  const now = new Date();
  const activeSince = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const recentSince = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const todayPrefix = formatKstDatePart(now, { year: "numeric", month: "2-digit", day: "2-digit" });
  const monthPrefix = formatKstDatePart(now, { year: "numeric", month: "2-digit" });
  const yearPrefix = formatKstDatePart(now, { year: "numeric" });
  const activityBuckets = makeKstActivityBuckets(now);
  const seriesSince = activityBuckets.yearly[0]?.start?.toISOString() || getKstPeriodStartIso("year", now);
  const [currentConnectedUsers, currentInstructorUsers, totalConnectedUsers, todayUsers, monthUsers, yearUsers, recentUsers, recentLoginEvents, totalLoginEvents] = await Promise.all([
    withClient((c) => c.query(`
      SELECT COUNT(DISTINCT user_id) AS count
      FROM user_access_logs
      WHERE user_id IS NOT NULL
        AND created_at >= $1
        AND event_type IN ('login', 'session_active')
    `, [activeSince])),
    withClient((c) => c.query(`
      SELECT COUNT(DISTINCT l.user_id) AS count
      FROM user_access_logs l
      JOIN users u
        ON u.id = l.user_id
      WHERE l.user_id IS NOT NULL
        AND l.created_at >= $1
        AND l.event_type IN ('login', 'session_active')
        AND u.role = 'admin'
    `, [activeSince])),
    withClient((c) => c.query(`
      SELECT COUNT(DISTINCT user_id) AS count
      FROM user_access_logs
      WHERE user_id IS NOT NULL
    `)),
    withClient((c) => c.query(`
      SELECT COUNT(DISTINCT user_id) AS count
      FROM user_access_logs
      WHERE user_id IS NOT NULL
        AND substr(created_at, 1, 10) = $1
    `, [todayPrefix])),
    withClient((c) => c.query(`
      SELECT COUNT(DISTINCT user_id) AS count
      FROM user_access_logs
      WHERE user_id IS NOT NULL
        AND substr(created_at, 1, 7) = $1
    `, [monthPrefix])),
    withClient((c) => c.query(`
      SELECT COUNT(DISTINCT user_id) AS count
      FROM user_access_logs
      WHERE user_id IS NOT NULL
        AND substr(created_at, 1, 4) = $1
    `, [yearPrefix])),
    withClient((c) => c.query(`
      SELECT COUNT(DISTINCT user_id) AS count
      FROM user_access_logs
      WHERE user_id IS NOT NULL
        AND created_at >= $1
        AND event_type IN ('login', 'session_active')
    `, [recentSince])),
    withClient((c) => c.query(`
      SELECT COUNT(*) AS count
      FROM user_access_logs
      WHERE created_at >= $1
        AND event_type = 'login'
    `, [recentSince])),
    withClient((c) => c.query(`
      SELECT COUNT(*) AS count
      FROM user_access_logs
      WHERE event_type = 'login'
    `)),
  ]);
  const seriesRows = (await withClient((c) => c.query(`
    SELECT user_id AS "userId",
           created_at AS "createdAt"
    FROM user_access_logs
    WHERE user_id IS NOT NULL
      AND created_at >= $1
      AND event_type IN ('login', 'session_active')
  `, [seriesSince]))).rows;
  for (const row of seriesRows) {
    const createdAt = new Date(row.createdAt);
    if (!Number.isFinite(createdAt.getTime())) continue;
    for (const bucketList of [activityBuckets.daily, activityBuckets.weekly, activityBuckets.monthly, activityBuckets.yearly]) {
      const bucket = bucketList.find((item) => createdAt >= item.start && createdAt < item.end);
      if (bucket) bucket.users.add(Number(row.userId));
    }
  }
  const serializeBuckets = (bucketList) => bucketList.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: bucket.users.size,
  }));
  const portalUiStatsRow = (await withClient((c) => c.query(`
    SELECT
      COUNT(*) FILTER (WHERE event_type='portal_ui_v1') AS "legacyUsers",
      COUNT(*) FILTER (WHERE event_type='portal_ui_v2') AS "v2Users",
      COUNT(*) AS "reportedUsers"
    FROM (
      SELECT DISTINCT ON (user_id)
             user_id,
             event_type,
             created_at,
             id
      FROM user_access_logs
      WHERE user_id IS NOT NULL
        AND created_at >= $1
        AND event_type IN ('portal_ui_v1', 'portal_ui_v2')
      ORDER BY user_id, created_at DESC, id DESC
    ) latest_portal_ui
  `, [recentSince]))).rows[0] || {};
  const reportedPortalUsers = Number(portalUiStatsRow.reportedUsers || 0);
  const legacyPortalUsers = Number(portalUiStatsRow.legacyUsers || 0);
  const v2PortalUsers = Number(portalUiStatsRow.v2Users || 0);
  const unknownPortalUsers = Math.max(0, Number(recentUsers.rows[0]?.count || 0) - reportedPortalUsers);
  return {
    currentConnectedUsers: Number(currentConnectedUsers.rows[0]?.count || 0),
    currentInstructorUsers: Number(currentInstructorUsers.rows[0]?.count || 0),
    totalConnectedUsers: Number(totalConnectedUsers.rows[0]?.count || 0),
    todayUsers: Number(todayUsers.rows[0]?.count || 0),
    monthUsers: Number(monthUsers.rows[0]?.count || 0),
    yearUsers: Number(yearUsers.rows[0]?.count || 0),
    recentDays: days,
    recentSince,
    recentUsers: Number(recentUsers.rows[0]?.count || 0),
    recentLoginEvents: Number(recentLoginEvents.rows[0]?.count || 0),
    totalLoginEvents: Number(totalLoginEvents.rows[0]?.count || 0),
    activeWithinMinutes: minutes,
    portalUiStats: {
      recentDays: days,
      legacyUsers: legacyPortalUsers,
      v2Users: v2PortalUsers,
      reportedUsers: reportedPortalUsers,
      unknownUsers: unknownPortalUsers,
      totalRecentUsers: Number(recentUsers.rows[0]?.count || 0),
    },
    activitySeries: {
      daily: serializeBuckets(activityBuckets.daily),
      weekly: serializeBuckets(activityBuckets.weekly),
      monthly: serializeBuckets(activityBuckets.monthly),
      yearly: serializeBuckets(activityBuckets.yearly),
    },
    recentUserSummaries: await pgListRecentUserAccessSummaries({ since: recentSince, limit: 20 }),
    recentLogs: await pgListUserAccessLogs(50, { since: recentSince }),
  };
}

const OPENSTACK_RESOURCE_LABELS = {
  instances: "인스턴스",
  cores: "vCPU",
  ram: "RAM",
  volumes: "볼륨",
  volumeStorage: "블록 스토리지",
  volumeSnapshots: "볼륨 스냅샷",
  networks: "네트워크",
  subnets: "서브넷",
  routers: "라우터",
  floatingIps: "Floating IP",
  ports: "포트",
  securityGroups: "보안 그룹",
  securityGroupRules: "보안 그룹 규칙",
};

function normalizeOpenstackUsageSnapshotRow(row) {
  return row ? {
    id: String(row.id || ""),
    projectName: String(row.projectName ?? row.project_name ?? "").trim(),
    driver: String(row.driver || "").trim(),
    resourceKey: String(row.resourceKey ?? row.resource_key ?? "").trim(),
    resourceLabel: String(row.resourceLabel ?? row.resource_label ?? "").trim(),
    used: Number(row.used ?? row.used_value ?? 0) || 0,
    limit: Number(row.limit ?? row.limit_value ?? 0) || 0,
    percent: Math.max(0, Math.min(100, Number(row.percent || 0) || 0)),
    unit: String(row.unit || "").trim(),
    collectedAt: row.collectedAt ?? row.collected_at ?? null,
  } : null;
}

async function pgRecordOpenstackResourceUsageSnapshot({
  projectName = "",
  driver = "",
  metrics = {},
  collectedAt = new Date().toISOString(),
} = {}) {
  const entries = Object.entries(metrics || {}).filter(([, metric]) => metric && typeof metric === "object");
  if (!entries.length) return [];
  return withTx(async (c) => {
    const rows = [];
    for (const [resourceKey, metric] of entries) {
      const row = normalizeOpenstackUsageSnapshotRow((await c.query(`
        INSERT INTO openstack_resource_usage_snapshots
          (id, project_name, driver, resource_key, resource_label, used_value, limit_value, percent, unit, collected_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id,
                  project_name AS "projectName",
                  driver,
                  resource_key AS "resourceKey",
                  resource_label AS "resourceLabel",
                  used_value AS "used",
                  limit_value AS "limit",
                  percent,
                  unit,
                  collected_at AS "collectedAt"
      `, [
        randomUUID(),
        String(projectName || "").trim(),
        String(driver || "").trim(),
        String(resourceKey || "").trim(),
        OPENSTACK_RESOURCE_LABELS[resourceKey] || String(resourceKey || "").trim(),
        Number(metric.used || 0) || 0,
        Number(metric.limit || 0) || 0,
        Math.max(0, Math.min(100, Number(metric.percent || 0) || 0)),
        String(metric.unit || "").trim(),
        collectedAt,
      ])).rows[0] || null);
      if (row) rows.push(row);
    }
    return rows;
  });
}

async function pgListOpenstackResourceUsageTrend({ projectName = "", days = 5, pointsPerResource = 12 } = {}) {
  const recentDays = Math.max(1, Number(days || 5) || 5);
  const pointLimit = Math.max(1, Math.min(96, Number(pointsPerResource || 12) || 12));
  const since = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000).toISOString();
  const normalizedProject = String(projectName || "").trim();
  const rows = (await withClient((c) => c.query(`
    SELECT id,
           project_name AS "projectName",
           driver,
           resource_key AS "resourceKey",
           resource_label AS "resourceLabel",
           used_value AS "used",
           limit_value AS "limit",
           percent,
           unit,
           collected_at AS "collectedAt"
    FROM (
      SELECT id,
             project_name,
             driver,
             resource_key,
             resource_label,
             used_value,
             limit_value,
             percent,
             unit,
             collected_at,
             ROW_NUMBER() OVER (PARTITION BY resource_key ORDER BY collected_at DESC) AS rn
      FROM openstack_resource_usage_snapshots
      WHERE collected_at >= $1
        AND ($2 = '' OR project_name = $2)
    ) ranked
    WHERE rn <= $3
    ORDER BY collected_at ASC, resource_key ASC
  `, [since, normalizedProject, pointLimit]))).rows.map(normalizeOpenstackUsageSnapshotRow);
  const resources = new Map();
  for (const row of rows) {
    const key = row.resourceKey;
    if (!key) continue;
    if (!resources.has(key)) {
      resources.set(key, {
        key,
        label: row.resourceLabel || OPENSTACK_RESOURCE_LABELS[key] || key,
        unit: row.unit || "",
        points: [],
      });
    }
    const item = resources.get(key);
    if (!item.unit && row.unit) item.unit = row.unit;
    item.points.push({
      collectedAt: row.collectedAt,
      used: row.used,
      limit: row.limit,
      percent: row.percent,
    });
  }
  return {
    days: recentDays,
    since,
    resources: Array.from(resources.values()).sort((a, b) => {
      const order = Object.keys(OPENSTACK_RESOURCE_LABELS);
      const aIndex = order.indexOf(a.key);
      const bIndex = order.indexOf(b.key);
      if (aIndex !== bIndex) return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex);
      return a.label.localeCompare(b.label);
    }),
  };
}

function normalizeMailLogRow(row) {
  return row ? {
    id: String(row.id),
    mailType: row.mailType ?? row.mail_type ?? "",
    provider: row.provider ?? "",
    senderUsername: row.senderUsername ?? row.sender_username ?? "",
    recipientMode: row.recipientMode ?? row.recipient_mode ?? "manual",
    recipientCount: Number(row.recipientCount ?? row.recipient_count ?? 0),
    recipients: safeJsonParse(row.recipientsJson ?? row.recipients_json ?? "[]", []),
    subject: row.subject ?? "",
    status: row.status ?? "",
    errorMessage: row.errorMessage ?? row.error_message ?? "",
    metadata: safeJsonParse(row.metadataJson ?? row.metadata_json ?? "{}", {}),
    createdAt: row.createdAt ?? row.created_at ?? null,
  } : null;
}

async function pgCreateMailLog({
  id = randomUUID(),
  mailType = "",
  provider = "",
  senderUsername = "",
  recipientMode = "manual",
  recipientCount = 0,
  recipients = [],
  subject = "",
  status = "sent",
  errorMessage = "",
  metadata = {},
  createdAt = new Date().toISOString(),
}) {
  await withClient((c) => c.query(`
    INSERT INTO mail_logs (
      id, mail_type, provider, sender_username, recipient_mode, recipient_count,
      recipients_json, subject, status, error_message, metadata_json, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [
    String(id || randomUUID()),
    String(mailType || "").trim(),
    String(provider || "").trim(),
    String(senderUsername || "").trim(),
    String(recipientMode || "manual").trim() || "manual",
    Math.max(0, Number(recipientCount || 0) || 0),
    JSON.stringify(Array.isArray(recipients) ? recipients : []),
    String(subject || "").trim(),
    String(status || "sent").trim() || "sent",
    String(errorMessage || "").trim(),
    JSON.stringify(metadata && typeof metadata === "object" ? metadata : {}),
    createdAt,
  ]));
  return normalizeMailLogRow({
    id, mailType, provider, senderUsername, recipientMode, recipientCount,
    recipientsJson: JSON.stringify(Array.isArray(recipients) ? recipients : []),
    subject, status, errorMessage,
    metadataJson: JSON.stringify(metadata && typeof metadata === "object" ? metadata : {}),
    createdAt,
  });
}

async function pgListMailLogs(limit = 100) {
  return (await withClient((c) => c.query(`
    SELECT id,
           mail_type AS "mailType",
           provider,
           sender_username AS "senderUsername",
           recipient_mode AS "recipientMode",
           recipient_count AS "recipientCount",
           recipients_json AS "recipientsJson",
           subject,
           status,
           error_message AS "errorMessage",
           metadata_json AS "metadataJson",
           created_at AS "createdAt"
    FROM mail_logs
    ORDER BY created_at DESC, id DESC
    LIMIT $1
  `, [Math.max(1, Number(limit || 100) || 100)]))).rows.map(normalizeMailLogRow);
}

function normalizeMailCampaignRow(row) {
  return row ? {
    id: String(row.id || ""),
    name: row.name ?? "",
    purpose: row.purpose ?? "operational",
    subject: row.subject ?? "",
    bodyText: row.bodyText ?? row.body_text ?? "",
    recipientModes: safeJsonParse(row.recipientModesJson ?? row.recipient_modes_json ?? "[]", []),
    sourceFileName: row.sourceFileName ?? row.source_file_name ?? "",
    sourceHash: row.sourceHash ?? row.source_hash ?? "",
    status: row.status ?? "pending",
    totalCount: Number(row.totalCount ?? row.total_count ?? 0),
    queuedCount: Number(row.queuedCount ?? row.queued_count ?? 0),
    acceptedCount: Number(row.acceptedCount ?? row.accepted_count ?? 0),
    failedCount: Number(row.failedCount ?? row.failed_count ?? 0),
    bouncedCount: Number(row.bouncedCount ?? row.bounced_count ?? 0),
    repliedCount: Number(row.repliedCount ?? row.replied_count ?? 0),
    noReplyCount: Number(row.noReplyCount ?? row.no_reply_count ?? 0),
    replyDeadlineAt: row.replyDeadlineAt ?? row.reply_deadline_at ?? null,
    createdBy: row.createdBy != null ? Number(row.createdBy) : row.created_by != null ? Number(row.created_by) : null,
    createdByUsername: row.createdByUsername ?? row.created_by_username ?? "",
    createdAt: row.createdAt ?? row.created_at ?? null,
    startedAt: row.startedAt ?? row.started_at ?? null,
    completedAt: row.completedAt ?? row.completed_at ?? null,
  } : null;
}

function normalizeMailCampaignDeliveryRow(row) {
  return row ? {
    id: String(row.id || ""),
    campaignId: String(row.campaignId ?? row.campaign_id ?? ""),
    source: row.source ?? "manual",
    sources: safeJsonParse(row.sourcesJson ?? row.sources_json ?? "[]", []),
    companyName: row.companyName ?? row.company_name ?? "",
    recipientName: row.recipientName ?? row.recipient_name ?? "",
    userId: row.userId != null ? Number(row.userId) : row.user_id != null ? Number(row.user_id) : null,
    email: row.email ?? "",
    status: row.status ?? "queued",
    provider: row.provider ?? "",
    messageId: row.messageId ?? row.message_id ?? "",
    attemptCount: Number(row.attemptCount ?? row.attempt_count ?? 0),
    errorMessage: row.errorMessage ?? row.error_message ?? "",
    metadata: safeJsonParse(row.metadataJson ?? row.metadata_json ?? "{}", {}),
    acceptedAt: row.acceptedAt ?? row.accepted_at ?? null,
    bouncedAt: row.bouncedAt ?? row.bounced_at ?? null,
    repliedAt: row.repliedAt ?? row.replied_at ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  } : null;
}

async function pgCreateMailCampaign({
  id = randomUUID(),
  name = "",
  purpose = "operational",
  subject = "",
  bodyText = "",
  recipientModes = [],
  sourceFileName = "",
  sourceHash = "",
  replyDeadlineAt = null,
  createdBy = null,
  createdByUsername = "",
  recipients = [],
  createdAt = new Date().toISOString(),
}) {
  const campaignId = String(id || randomUUID());
  await withTx(async (c) => {
    await c.query(`
      INSERT INTO mail_campaigns (
        id,name,purpose,subject,body_text,recipient_modes_json,source_file_name,source_hash,
        status,total_count,queued_count,accepted_count,failed_count,bounced_count,replied_count,no_reply_count,
        reply_deadline_at,created_by,created_by_username,created_at,started_at,completed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$9,0,0,0,0,0,$10,$11,$12,$13,NULL,NULL)
    `, [
      campaignId,
      String(name || "").trim(),
      String(purpose || "operational").trim() || "operational",
      String(subject || "").trim(),
      String(bodyText || "").trim(),
      JSON.stringify(Array.isArray(recipientModes) ? recipientModes : []),
      String(sourceFileName || "").trim(),
      String(sourceHash || "").trim(),
      recipients.length,
      replyDeadlineAt || null,
      createdBy != null ? Number(createdBy) : null,
      String(createdByUsername || "").trim(),
      createdAt,
    ]);
    for (const recipient of recipients) {
      await c.query(`
        INSERT INTO mail_campaign_deliveries (
          id,campaign_id,source,sources_json,company_name,recipient_name,user_id,email,status,provider,
          message_id,attempt_count,error_message,metadata_json,accepted_at,bounced_at,replied_at,created_at,updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued','', '',0,'',$9,NULL,NULL,NULL,$10,$10)
      `, [
        randomUUID(),
        campaignId,
        String(recipient?.source || "manual").trim() || "manual",
        JSON.stringify(Array.isArray(recipient?.sources) ? recipient.sources : [recipient?.source || "manual"]),
        String(recipient?.companyName || "").trim(),
        String(recipient?.recipientName || "").trim(),
        recipient?.userId ? Number(recipient.userId) : null,
        String(recipient?.email || "").trim().toLowerCase(),
        JSON.stringify(recipient?.metadata && typeof recipient.metadata === "object" ? recipient.metadata : {}),
        createdAt,
      ]);
    }
  });
  return pgFindMailCampaignById(campaignId);
}

async function pgMarkExpiredMailCampaignNoReplies() {
  const result = await withClient((c) => c.query(`
    UPDATE mail_campaign_deliveries d
    SET status='no_reply', updated_at=CURRENT_TIMESTAMP::text
    FROM mail_campaigns c
    WHERE d.campaign_id=c.id
      AND d.status='accepted'
      AND c.reply_deadline_at IS NOT NULL
      AND c.reply_deadline_at::timestamptz <= CURRENT_TIMESTAMP
  `));
  return Number(result.rowCount || 0);
}

async function pgRefreshMailCampaign(id) {
  const campaignId = String(id || "").trim();
  if (!campaignId) return null;
  await pgMarkExpiredMailCampaignNoReplies();
  const result = await withClient((c) => c.query(`
    WITH counts AS (
      SELECT
        COUNT(*)::integer AS total_count,
        COUNT(*) FILTER (WHERE status IN ('queued','sending'))::integer AS queued_count,
        COUNT(*) FILTER (WHERE status IN ('accepted','bounced','replied','no_reply'))::integer AS accepted_count,
        COUNT(*) FILTER (WHERE status='failed')::integer AS failed_count,
        COUNT(*) FILTER (WHERE status='bounced')::integer AS bounced_count,
        COUNT(*) FILTER (WHERE status='replied')::integer AS replied_count,
        COUNT(*) FILTER (WHERE status='no_reply')::integer AS no_reply_count
      FROM mail_campaign_deliveries
      WHERE campaign_id=$1
    )
    UPDATE mail_campaigns c
    SET total_count=counts.total_count,
        queued_count=counts.queued_count,
        accepted_count=counts.accepted_count,
        failed_count=counts.failed_count,
        bounced_count=counts.bounced_count,
        replied_count=counts.replied_count,
        no_reply_count=counts.no_reply_count,
        status=CASE WHEN counts.queued_count=0 AND c.status IN ('pending','sending') THEN 'completed' ELSE c.status END,
        completed_at=CASE WHEN counts.queued_count=0 AND c.status IN ('pending','sending') THEN COALESCE(c.completed_at,CURRENT_TIMESTAMP::text) ELSE c.completed_at END
    FROM counts
    WHERE c.id=$1
    RETURNING c.*
  `, [campaignId]));
  return normalizeMailCampaignRow(result.rows[0] || null);
}

async function pgFindMailCampaignById(id) {
  const campaign = normalizeMailCampaignRow((await withClient((c) => c.query(`SELECT * FROM mail_campaigns WHERE id=$1`, [String(id || "")]))).rows[0] || null);
  if (!campaign) return null;
  const refreshed = await pgRefreshMailCampaign(campaign.id);
  const deliveries = (await withClient((c) => c.query(`
    SELECT * FROM mail_campaign_deliveries WHERE campaign_id=$1 ORDER BY created_at ASC,id ASC
  `, [campaign.id]))).rows.map(normalizeMailCampaignDeliveryRow);
  return { ...(refreshed || campaign), deliveries };
}

async function pgListMailCampaigns(limit = 50) {
  await pgMarkExpiredMailCampaignNoReplies();
  const campaignIds = (await withClient((c) => c.query(`SELECT id FROM mail_campaigns ORDER BY created_at DESC,id DESC LIMIT $1`, [Math.max(1, Number(limit || 50) || 50)]))).rows.map((row) => String(row.id));
  const campaigns = [];
  for (const id of campaignIds) campaigns.push(await pgRefreshMailCampaign(id));
  return campaigns.filter(Boolean);
}

async function pgClaimNextMailCampaign() {
  const result = await withClient((c) => c.query(`
    WITH next_campaign AS (
      SELECT id FROM mail_campaigns
      WHERE status IN ('pending','sending')
      ORDER BY created_at ASC,id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE mail_campaigns c
    SET status='sending',started_at=COALESCE(c.started_at,CURRENT_TIMESTAMP::text)
    FROM next_campaign n
    WHERE c.id=n.id
    RETURNING c.*
  `));
  return normalizeMailCampaignRow(result.rows[0] || null);
}

async function pgListQueuedMailCampaignDeliveries(campaignId, limit = 100) {
  return (await withClient((c) => c.query(`
    SELECT * FROM mail_campaign_deliveries
    WHERE campaign_id=$1 AND status='queued'
    ORDER BY created_at ASC,id ASC
    LIMIT $2
  `, [String(campaignId || ""), Math.max(1, Number(limit || 100) || 100)]))).rows.map(normalizeMailCampaignDeliveryRow);
}

async function pgUpdateMailCampaignDelivery(id, patch = {}) {
  const current = normalizeMailCampaignDeliveryRow((await withClient((c) => c.query(`SELECT * FROM mail_campaign_deliveries WHERE id=$1`, [String(id || "")]))).rows[0] || null);
  if (!current) return null;
  const nextStatus = String(patch.status ?? current.status).trim() || current.status;
  const updatedAt = new Date().toISOString();
  const row = (await withClient((c) => c.query(`
    UPDATE mail_campaign_deliveries
    SET status=$2,provider=$3,message_id=$4,attempt_count=$5,error_message=$6,metadata_json=$7,
        accepted_at=$8,bounced_at=$9,replied_at=$10,updated_at=$11
    WHERE id=$1
    RETURNING *
  `, [
    current.id,
    nextStatus,
    String(patch.provider ?? current.provider ?? "").trim(),
    String(patch.messageId ?? current.messageId ?? "").trim(),
    Math.max(0, Number(patch.attemptCount ?? current.attemptCount ?? 0) || 0),
    String(patch.errorMessage ?? current.errorMessage ?? "").trim(),
    JSON.stringify(patch.metadata && typeof patch.metadata === "object" ? patch.metadata : current.metadata || {}),
    patch.acceptedAt === undefined ? current.acceptedAt : patch.acceptedAt,
    patch.bouncedAt === undefined ? current.bouncedAt : patch.bouncedAt,
    patch.repliedAt === undefined ? current.repliedAt : patch.repliedAt,
    updatedAt,
  ]))).rows[0] || null;
  return normalizeMailCampaignDeliveryRow(row);
}

async function pgRecordMailCampaignEvent({ campaignId = "", messageId = "", email = "", eventType = "", errorMessage = "" } = {}) {
  const normalizedEventType = String(eventType || "").trim().toLowerCase();
  if (!['bounced','replied'].includes(normalizedEventType)) throw new Error("지원하지 않는 메일 이벤트입니다.");
  const clauses = [];
  const params = [];
  if (campaignId) { params.push(String(campaignId)); clauses.push(`campaign_id=$${params.length}`); }
  if (messageId) { params.push(String(messageId)); clauses.push(`message_id=$${params.length}`); }
  if (email) { params.push(String(email).trim().toLowerCase()); clauses.push(`email=$${params.length}`); }
  if (!clauses.length) throw new Error("메일 이벤트 대상을 지정해 주세요.");
  params.push(new Date().toISOString());
  const eventAtParam = `$${params.length}`;
  params.push(String(errorMessage || "").trim());
  const errorParam = `$${params.length}`;
  const row = (await withClient((c) => c.query(`
    UPDATE mail_campaign_deliveries
    SET status='${normalizedEventType}',
        bounced_at=CASE WHEN '${normalizedEventType}'='bounced' THEN ${eventAtParam} ELSE bounced_at END,
        replied_at=CASE WHEN '${normalizedEventType}'='replied' THEN ${eventAtParam} ELSE replied_at END,
        error_message=CASE WHEN '${normalizedEventType}'='bounced' THEN ${errorParam} ELSE error_message END,
        updated_at=${eventAtParam}
    WHERE ${clauses.join(" AND ")}
    RETURNING *
  `, params))).rows[0] || null;
  const delivery = normalizeMailCampaignDeliveryRow(row);
  if (delivery) await pgRefreshMailCampaign(delivery.campaignId);
  return delivery;
}

async function pgDeleteMailLogsByMetadata({ purpose = "", campaignName = "" } = {}) {
  const normalizedPurpose = String(purpose || "").trim();
  const normalizedCampaignName = String(campaignName || "").trim();
  if (!normalizedPurpose && !normalizedCampaignName) return 0;
  const clauses = [];
  const params = [];
  if (normalizedPurpose) {
    params.push(normalizedPurpose);
    clauses.push(`COALESCE(metadata_json::jsonb ->> 'purpose', '') = $${params.length}`);
  }
  if (normalizedCampaignName) {
    params.push(normalizedCampaignName);
    clauses.push(`COALESCE(metadata_json::jsonb ->> 'campaignName', '') = $${params.length}`);
  }
  const result = await withClient((c) => c.query(`
    DELETE FROM mail_logs
    WHERE ${clauses.join(" AND ")}
  `, params));
  return Number(result.rowCount || 0);
}

async function pgCreateUserNotification({
  userId,
  type = "system",
  title = "",
  body = "",
  linkSection = "",
  metadata = {},
  createdAt = new Date().toISOString(),
}) {
  const id = await withTx(async (c) => {
    const next = await nextId(c, "user_notifications");
    await c.query(`
      INSERT INTO user_notifications (
        id, user_id, type, title, body, link_section, metadata_json, is_read, created_at, read_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,NULL)
    `, [
      next,
      Number(userId),
      String(type || "system").trim() || "system",
      String(title || "").trim(),
      String(body || "").trim(),
      String(linkSection || "").trim(),
      JSON.stringify(metadata && typeof metadata === "object" ? metadata : {}),
      createdAt,
    ]);
    return next;
  });
  return normalizeUserNotificationRow({
    id,
    userId,
    type,
    title,
    body,
    linkSection,
    metadataJson: JSON.stringify(metadata && typeof metadata === "object" ? metadata : {}),
    isRead: 0,
    createdAt,
    readAt: null,
  });
}

async function pgListUserNotifications(userId, limit = 100) {
  return (await withClient((c) => c.query(`
    SELECT id,
           user_id AS "userId",
           type,
           title,
           body,
           link_section AS "linkSection",
           metadata_json AS "metadataJson",
           is_read AS "isRead",
           created_at AS "createdAt",
           read_at AS "readAt"
    FROM user_notifications
    WHERE user_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT $2
  `, [Number(userId), Math.max(1, Math.min(300, Number(limit || 100) || 100))]))).rows.map(normalizeUserNotificationRow);
}

async function pgMarkUserNotificationRead(userId, notificationId, readAt = new Date().toISOString()) {
  await withClient((c) => c.query(`
    UPDATE user_notifications
    SET is_read = 1,
        read_at = COALESCE(read_at, $3)
    WHERE user_id = $1
      AND id = $2
  `, [Number(userId), Number(notificationId), readAt]));
}

async function pgMarkAllUserNotificationsRead(userId, readAt = new Date().toISOString()) {
  await withClient((c) => c.query(`
    UPDATE user_notifications
    SET is_read = 1,
        read_at = COALESCE(read_at, $2)
    WHERE user_id = $1
      AND is_read = 0
  `, [Number(userId), readAt]));
}

async function pgDeleteUserNotification(userId, notificationId) {
  const result = await withClient((c) => c.query(`
    DELETE FROM user_notifications
    WHERE user_id = $1
      AND id = $2
  `, [Number(userId), Number(notificationId)]));
  return Number(result?.rowCount || 0) > 0;
}

async function pgClearUserNotifications(userId) {
  const result = await withClient((c) => c.query(`
    DELETE FROM user_notifications
    WHERE user_id = $1
  `, [Number(userId)]));
  return Number(result?.rowCount || 0) || 0;
}

async function pgListUserMessages(userId) {
  return (await withClient((c) => c.query(`
    WITH visible_messages AS (
      SELECT
        m.id,
        m.sender_id AS "senderId",
        m.recipient_id AS "recipientId",
        sender.name AS "senderName",
        sender.username AS "senderUsername",
        CASE WHEN COALESCE(NULLIF(m.recipient_group_name, ''), '') <> '' THEN m.recipient_group_name ELSE recipient.name END AS "recipientName",
        CASE WHEN COALESCE(NULLIF(m.recipient_group_key, ''), '') <> '' THEN m.recipient_group_key ELSE recipient.username END AS "recipientUsername",
        m.subject,
        m.body,
        m.created_at AS "createdAt",
        m.read_at AS "readAt",
        m.sender_archived AS "senderArchived",
        m.recipient_archived AS "recipientArchived",
        m.recipient_type AS "recipientType",
        m.recipient_group_key AS "recipientGroupKey",
        m.recipient_group_name AS "recipientGroupName",
        m.delivery_group_id AS "deliveryGroupId",
        m.cleanup_status AS "cleanupStatus",
        m.cleanup_status_note AS "cleanupStatusNote",
        m.cleanup_status_updated_at AS "cleanupStatusUpdatedAt",
        m.cleanup_status_updated_by AS "cleanupStatusUpdatedBy",
        cleanup_user.name AS "cleanupStatusUpdatedByName",
        cleanup_user.username AS "cleanupStatusUpdatedByUsername",
        CASE
          WHEN m.sender_id = $1 AND m.recipient_type = 'group' AND COALESCE(NULLIF(m.delivery_group_id, ''), '') <> ''
          THEN ROW_NUMBER() OVER (PARTITION BY m.sender_id, m.delivery_group_id ORDER BY m.id ASC)
          ELSE 1
        END AS sender_group_rank
      FROM user_messages m
      JOIN users sender ON sender.id = m.sender_id
      JOIN users recipient ON recipient.id = m.recipient_id
      LEFT JOIN users cleanup_user ON cleanup_user.id = m.cleanup_status_updated_by
      WHERE (m.sender_id = $1 AND m.sender_archived = 0)
         OR (m.recipient_id = $1 AND m.recipient_archived = 0)
    )
    SELECT *
    FROM visible_messages
    WHERE sender_group_rank = 1
    ORDER BY "createdAt" DESC, id DESC
  `, [Number(userId)]))).rows.map(normalizeUserMessageRow);
}

async function pgListAllUserMessages() {
  return (await withClient((c) => c.query(`
    SELECT
      m.id,
      m.sender_id AS "senderId",
      m.recipient_id AS "recipientId",
      sender.name AS "senderName",
      sender.username AS "senderUsername",
      recipient.name AS "recipientName",
      recipient.username AS "recipientUsername",
      m.subject,
      m.body,
      m.created_at AS "createdAt",
      m.read_at AS "readAt",
      m.sender_archived AS "senderArchived",
      m.recipient_archived AS "recipientArchived",
      m.recipient_type AS "recipientType",
      m.recipient_group_key AS "recipientGroupKey",
      m.recipient_group_name AS "recipientGroupName",
      m.delivery_group_id AS "deliveryGroupId",
      m.cleanup_status AS "cleanupStatus",
      m.cleanup_status_note AS "cleanupStatusNote",
      m.cleanup_status_updated_at AS "cleanupStatusUpdatedAt",
      m.cleanup_status_updated_by AS "cleanupStatusUpdatedBy",
      cleanup_user.name AS "cleanupStatusUpdatedByName",
      cleanup_user.username AS "cleanupStatusUpdatedByUsername"
    FROM user_messages m
    JOIN users sender ON sender.id = m.sender_id
    JOIN users recipient ON recipient.id = m.recipient_id
    LEFT JOIN users cleanup_user ON cleanup_user.id = m.cleanup_status_updated_by
    ORDER BY m.created_at DESC, m.id DESC
  `))).rows.map(normalizeUserMessageRow);
}

async function pgCreateUserMessage({ senderId, recipientId, subject = "", body = "", recipientType = "user", recipientGroupKey = "", recipientGroupName = "", deliveryGroupId = "" }) {
  return withTx(async (c) => {
    const id = await nextId(c, "user_messages");
    await c.query(`
      INSERT INTO user_messages (id, sender_id, recipient_id, subject, body, created_at, read_at, recipient_type, recipient_group_key, recipient_group_name, delivery_group_id)
      VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP::text,NULL,$6,$7,$8,$9)
    `, [
      id,
      Number(senderId),
      Number(recipientId),
      String(subject || "").trim(),
      String(body || "").trim(),
      String(recipientType || "user").trim() || "user",
      String(recipientGroupKey || "").trim(),
      String(recipientGroupName || "").trim(),
      String(deliveryGroupId || "").trim(),
    ]);
    return normalizeUserMessageRow((await c.query(`
      SELECT
        m.id,
        m.sender_id AS "senderId",
        m.recipient_id AS "recipientId",
        sender.name AS "senderName",
        sender.username AS "senderUsername",
        recipient.name AS "recipientName",
        recipient.username AS "recipientUsername",
        m.subject,
        m.body,
        m.created_at AS "createdAt",
        m.read_at AS "readAt",
        m.recipient_type AS "recipientType",
        m.recipient_group_key AS "recipientGroupKey",
        m.recipient_group_name AS "recipientGroupName",
        m.delivery_group_id AS "deliveryGroupId",
        m.cleanup_status AS "cleanupStatus",
        m.cleanup_status_note AS "cleanupStatusNote",
        m.cleanup_status_updated_at AS "cleanupStatusUpdatedAt",
        m.cleanup_status_updated_by AS "cleanupStatusUpdatedBy",
        cleanup_user.name AS "cleanupStatusUpdatedByName",
        cleanup_user.username AS "cleanupStatusUpdatedByUsername"
      FROM user_messages m
      JOIN users sender ON sender.id = m.sender_id
      JOIN users recipient ON recipient.id = m.recipient_id
      LEFT JOIN users cleanup_user ON cleanup_user.id = m.cleanup_status_updated_by
      WHERE m.id = $1
    `, [id])).rows[0] || null);
  });
}

async function pgUpdateUserMessageCleanupStatus(messageId, { cleanupStatus = "", cleanupStatusNote = "", cleanupStatusUpdatedBy = null } = {}) {
  const normalizedStatus = normalizeMessageCleanupStatus(cleanupStatus);
  const note = String(cleanupStatusNote || "").trim().slice(0, 500);
  const updatedAt = normalizedStatus ? new Date().toISOString() : null;
  await withClient((c) => c.query(`
    UPDATE user_messages
    SET cleanup_status = $2,
        cleanup_status_note = $3,
        cleanup_status_updated_at = $4,
        cleanup_status_updated_by = $5
    WHERE id = $1
  `, [
    Number(messageId),
    normalizedStatus,
    note,
    updatedAt,
    normalizedStatus && cleanupStatusUpdatedBy ? Number(cleanupStatusUpdatedBy) : null,
  ]));
  return pgListAllUserMessages();
}

async function pgMarkUserMessageRead(userId, messageId, readAt = new Date().toISOString()) {
  await withClient((c) => c.query(`
    UPDATE user_messages
    SET read_at = COALESCE(read_at, $3)
    WHERE id = $1
      AND recipient_id = $2
  `, [Number(messageId), Number(userId), readAt]));
  return (await pgListUserMessages(userId)).find((item) => Number(item.id) === Number(messageId)) || null;
}

async function pgArchiveUserMessage(userId, messageId) {
  await withClient((c) => c.query(`
    UPDATE user_messages
    SET
      sender_archived = CASE WHEN sender_id = $2 THEN 1 ELSE sender_archived END,
      recipient_archived = CASE WHEN recipient_id = $2 THEN 1 ELSE recipient_archived END
    WHERE id = $1
      AND ($2 = sender_id OR $2 = recipient_id)
  `, [Number(messageId), Number(userId)]));
  return pgListUserMessages(userId);
}

async function pgDeleteUserMessageForUser(userId, messageId) {
  await withTx(async (c) => {
    await c.query(`
      UPDATE user_messages
      SET
        sender_archived = CASE WHEN sender_id = $2 THEN 1 ELSE sender_archived END,
        recipient_archived = CASE WHEN recipient_id = $2 THEN 1 ELSE recipient_archived END
      WHERE id = $1
        AND ($2 = sender_id OR $2 = recipient_id)
    `, [Number(messageId), Number(userId)]);
    await c.query(`
      DELETE FROM user_messages
      WHERE id = $1
        AND sender_archived = 1
        AND recipient_archived = 1
    `, [Number(messageId)]);
  });
  return pgListUserMessages(userId);
}

async function pgDeleteUserMessageById(messageId) {
  await withClient((c) => c.query(`
    DELETE FROM user_messages
    WHERE id = $1
  `, [Number(messageId)]));
  return pgListAllUserMessages();
}

async function pgGetPlatformStatus() {
  const rows = (await withClient((c) => c.query(`SELECT key,value FROM platform_settings`))).rows;
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const envPaymentGatewayProvider = resolveEnvPaymentGatewayProvider();
  const envPaymentGatewayEnabled = resolveEnvPaymentGatewayEnabled();
  const llmProvider = normalizeStoredLlmProvider(values.get("llmProvider") || DEFAULT_LLM_PROVIDER);
  const llmApiUrl = String(values.get("llmApiUrl") || "").trim();
  const llmModel = String(values.get("llmModel") || "").trim();
  const llmApiKey = String(values.get("llmApiKey") || "").trim();
  const llmDailyQuotaEnabled = values.has("llmDailyQuotaEnabled")
    ? values.get("llmDailyQuotaEnabled") === "true"
    : DEFAULT_LLM_DAILY_QUOTA_ENABLED;
  const llmDailyQuotaLimit = Math.max(1, Number(values.get("llmDailyQuotaLimit") || DEFAULT_LLM_DAILY_QUOTA_LIMIT) || DEFAULT_LLM_DAILY_QUOTA_LIMIT);
  const llmDailyQuotaAdminBypass = values.has("llmDailyQuotaAdminBypass")
    ? values.get("llmDailyQuotaAdminBypass") === "true"
    : DEFAULT_LLM_DAILY_QUOTA_ADMIN_BYPASS;
  const llmMaxTokens = Math.max(1, Number(values.get("llmMaxTokens") || DEFAULT_LLM_MAX_TOKENS) || DEFAULT_LLM_MAX_TOKENS);
  const llmAdminTestMaxTokens = Math.max(1, Number(values.get("llmAdminTestMaxTokens") || DEFAULT_LLM_ADMIN_TEST_MAX_TOKENS) || DEFAULT_LLM_ADMIN_TEST_MAX_TOKENS);
  const llmSurveyFeedbackMaxTokens = Math.max(64, Number(values.get("llmSurveyFeedbackMaxTokens") || DEFAULT_LLM_SURVEY_FEEDBACK_MAX_TOKENS) || DEFAULT_LLM_SURVEY_FEEDBACK_MAX_TOKENS);
  const llmSurveyFeedbackTimeoutMs = Math.max(30000, Number(values.get("llmSurveyFeedbackTimeoutMs") || DEFAULT_LLM_SURVEY_FEEDBACK_TIMEOUT_MS) || DEFAULT_LLM_SURVEY_FEEDBACK_TIMEOUT_MS);
  const llmSurveyFeedbackPrompt = String(values.get("llmSurveyFeedbackPrompt") || DEFAULT_LLM_SURVEY_FEEDBACK_PROMPT).trim() || DEFAULT_LLM_SURVEY_FEEDBACK_PROMPT;
  const llmSurveyFeedbackOptionsJson = String(values.get("llmSurveyFeedbackOptionsJson") || DEFAULT_LLM_SURVEY_FEEDBACK_OPTIONS_JSON || "").trim();
  const llmThinkingMode = normalizeStoredLlmThinkingMode(values.get("llmThinkingMode") || DEFAULT_LLM_THINKING_MODE);
  const llmNoThinkDirectiveEnabled = values.has("llmNoThinkDirectiveEnabled")
    ? values.get("llmNoThinkDirectiveEnabled") !== "false"
    : true;
  const llmWebSearchEnabled = values.has("llmWebSearchEnabled")
    ? values.get("llmWebSearchEnabled") !== "false"
    : DEFAULT_LLM_WEB_SEARCH_ENABLED;
  const llmWebSearchTimeoutMs = Math.max(1000, Number(values.get("llmWebSearchTimeoutMs") || DEFAULT_LLM_WEB_SEARCH_TIMEOUT_MS) || DEFAULT_LLM_WEB_SEARCH_TIMEOUT_MS);
  const llmWebSearchResultLimit = Math.min(10, Math.max(1, Number(values.get("llmWebSearchResultLimit") || DEFAULT_LLM_WEB_SEARCH_RESULT_LIMIT) || DEFAULT_LLM_WEB_SEARCH_RESULT_LIMIT));
  const googleSearchApiKey = values.has("googleSearchApiKey")
    ? String(values.get("googleSearchApiKey") || "").trim()
    : String(process.env.GOOGLE_SEARCH_API_KEY || process.env.GOOGLE_CSE_API_KEY || "").trim();
  const googleSearchCx = values.has("googleSearchCx")
    ? String(values.get("googleSearchCx") || "").trim()
    : String(process.env.GOOGLE_SEARCH_CX || process.env.GOOGLE_CSE_ID || "").trim();
  const paymentGatewayProvider = values.has("paymentGatewayProvider")
    ? String(values.get("paymentGatewayProvider") || "").trim() || "manual"
    : envPaymentGatewayProvider || "manual";
  const paymentGatewayApiBaseUrl = values.has("paymentGatewayApiBaseUrl")
    ? String(values.get("paymentGatewayApiBaseUrl") || "").trim()
    : (ENV_PAYMENT_GATEWAY_API_BASE_URL || (paymentGatewayProvider === "tosspayments" ? "https://api.tosspayments.com" : ""));
  const docsTestKeysEnabled = useDocsTossTestKeys() && paymentGatewayProvider === "tosspayments";
  const paymentGatewayPublicKey = values.has("paymentGatewayPublicKey")
    ? String(values.get("paymentGatewayPublicKey") || "").trim()
    : (ENV_PAYMENT_GATEWAY_PUBLIC_KEY || (docsTestKeysEnabled ? DOCS_TOSS_PUBLIC_KEY : ""));
  const paymentGatewaySecretKey = values.has("paymentGatewaySecretKey")
    ? String(values.get("paymentGatewaySecretKey") || "").trim()
    : (ENV_PAYMENT_GATEWAY_SECRET_KEY || (docsTestKeysEnabled ? DOCS_TOSS_SECRET_KEY : ""));
  const oauthGoogleClientId = values.has("oauthGoogleClientId")
    ? String(values.get("oauthGoogleClientId") || "").trim()
    : String(process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
  const oauthGoogleClientSecret = values.has("oauthGoogleClientSecret")
    ? String(values.get("oauthGoogleClientSecret") || "").trim()
    : String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim();
  const oauthKakaoClientId = values.has("oauthKakaoClientId")
    ? String(values.get("oauthKakaoClientId") || "").trim()
    : String(process.env.KAKAO_OAUTH_CLIENT_ID || process.env.KAKAO_REST_API_KEY || process.env.KAKAO_CLIENT_ID || "").trim();
  const oauthKakaoClientSecret = values.has("oauthKakaoClientSecret")
    ? String(values.get("oauthKakaoClientSecret") || "").trim()
    : String(process.env.KAKAO_OAUTH_CLIENT_SECRET || process.env.KAKAO_CLIENT_SECRET || "").trim();
  const oauthNaverClientId = values.has("oauthNaverClientId")
    ? String(values.get("oauthNaverClientId") || "").trim()
    : String(process.env.NAVER_OAUTH_CLIENT_ID || process.env.NAVER_CLIENT_ID || "").trim();
  const oauthNaverClientSecret = values.has("oauthNaverClientSecret")
    ? String(values.get("oauthNaverClientSecret") || "").trim()
    : String(process.env.NAVER_OAUTH_CLIENT_SECRET || process.env.NAVER_CLIENT_SECRET || "").trim();
  const oauthEnabled = values.has("oauthEnabled")
    ? values.get("oauthEnabled") !== "false"
    : true;
  const jenkinsBaseUrl = values.has("jenkinsBaseUrl")
    ? String(values.get("jenkinsBaseUrl") || "").trim()
    : String(process.env.JENKINS_BASE_URL || "").trim();
  const jenkinsUsername = values.has("jenkinsUsername")
    ? String(values.get("jenkinsUsername") || "").trim()
    : String(process.env.JENKINS_USERNAME || "").trim();
  // Jenkins API tokens are deployment secrets. Prefer the runtime secret over
  // the legacy database-backed setting so podman.env remains authoritative.
  const jenkinsApiToken = String(process.env.JENKINS_API_TOKEN || values.get("jenkinsApiToken") || "").trim();
  const jenkinsDefaultFolder = values.has("jenkinsDefaultFolder")
    ? String(values.get("jenkinsDefaultFolder") || "").trim()
    : String(process.env.JENKINS_DEFAULT_FOLDER || "terminal-lab").trim();
  const jenkinsJobPrefix = values.has("jenkinsJobPrefix")
    ? String(values.get("jenkinsJobPrefix") || "").trim()
    : String(process.env.JENKINS_JOB_PREFIX || "tlab-").trim();
  const envCicdExecutionMode = String(process.env.CICD_EXECUTION_MODE || process.env.TERMINAL_LAB_CICD_EXECUTION_MODE || "").trim().toLowerCase();
  const cicdExecutionMode = String(values.get("cicdExecutionMode") || envCicdExecutionMode || (jenkinsBaseUrl ? "jenkins" : "simulated")).trim().toLowerCase() === "jenkins" ? "jenkins" : "simulated";
  const serviceProjectName = String(values.get("serviceProjectName") || "service").trim() || "service";
  const parsedFlavors = String(values.get("selfServiceVmAllowedFlavors") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const parsedSelfServiceImages = String(values.get("selfServiceVmAllowedImages") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const parsedSelfServiceProjects = String(values.get("selfServiceVmAllowedProjects") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const parsedSelfServiceProjectRoleNames = String(values.get("selfServiceVmProjectRoleNames") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const parsedSelfServiceProjectQuota = safeJsonParse(String(values.get("selfServiceVmProjectQuotaJson") || "{}"), {});
  const parsedPocImages = String(values.get("pocAllowedImages") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const parsedPocFlavors = String(values.get("pocAllowedFlavors") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const parsedZunImages = String(values.get("zunAllowedImages") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const parsedMagnumClusterProfiles = safeJsonParse(
    String(values.get("magnumClusterProfilesJson") || process.env.CAPO_CLUSTER_PROFILES_JSON || "[]"),
    [],
  );
  const parsedPocFlavorDailyPrices = safeJsonParse(String(values.get("pocFlavorDailyPricesJson") || "{}"), {});
  const parsedPocAdvancedDailyPrices = safeJsonParse(String(values.get("pocAdvancedDailyPricesJson") || "{}"), {});
  const parsedPocFlavorSpecs = safeJsonParse(String(values.get("pocFlavorSpecsJson") || "{}"), {});
  const parsedAiVmFlavorCatalog = safeJsonParse(String(values.get("aiVmFlavorCatalogJson") || "[]"), []);
  const parsedConsultingReplyTemplates = safeJsonParse(String(values.get("consultingReplyTemplatesJson") || "{}"), {});
  const parsedTroveDatastores = String(values.get("troveAllowedDatastores") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const parsedTroveFlavors = String(values.get("troveAllowedFlavors") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const parsedTroveSizes = String(values.get("troveAllowedSizesGb") || "").split(",").map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0);
  const parsedCourseLevelOptions = String(values.get("courseLevelOptions") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const parsedCourseCategoryOptions = String(values.get("courseCategoryOptions") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const parsedCourseProgramTypeOptions = String(values.get("courseProgramTypeOptions") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const standardCourseOverviewPoints = normalizeCourseOverviewPoints(values.get("standardCourseOverviewPoints"), DEFAULT_COURSE_OVERVIEWS.standard.points);
  const iltCourseOverviewPoints = normalizeCourseOverviewPoints(values.get("iltCourseOverviewPoints"), DEFAULT_COURSE_OVERVIEWS.ilt.points);
  const onlineCourseOverviewPoints = normalizeCourseOverviewPoints(values.get("onlineCourseOverviewPoints"), DEFAULT_COURSE_OVERVIEWS.online.points);
  const governmentCourseOverviewPoints = normalizeCourseOverviewPoints(values.get("governmentCourseOverviewPoints"), DEFAULT_COURSE_OVERVIEWS.government.points);
  const portalUiMode = normalizePortalUiMode(
    values.get("portalUiMode"),
    values.has("userPortalV2Enabled")
      ? (values.get("userPortalV2Enabled") === "true" ? "switchable" : "legacy")
      : "switchable",
  );
  const customRouteSlots = Array.from({ length: 3 }, (_item, index) => {
    const slotIndex = index + 1;
    const parsedPort = Number(values.get(`customRouteSlot${slotIndex}Port`) || 0);
    return {
      id: `custom${slotIndex}`,
      label: String(values.get(`customRouteSlot${slotIndex}Label`) || "").trim(),
      port: Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : null,
    };
  });
  return {
    labCircuitBreaker: values.get("labCircuitBreaker") === "true",
    labCircuitBreakerSource: String(values.get("labCircuitBreakerSource") || "").trim(),
    labCircuitBreakerTriggeredAt: String(values.get("labCircuitBreakerTriggeredAt") || "").trim(),
    labCircuitBreakerMetric: String(values.get("labCircuitBreakerMetric") || "").trim(),
    labCircuitBreakerUsagePercent: Math.max(0, Math.min(100, Number(values.get("labCircuitBreakerUsagePercent") || 0) || 0)),
    labAutoCircuitBreakerEnabled: values.get("labAutoCircuitBreakerEnabled") !== "false",
    labAutoCircuitBreakerThresholdPercent: Math.max(50, Math.min(100, Number(values.get("labAutoCircuitBreakerThresholdPercent") || DEFAULT_LAB_AUTO_CIRCUIT_BREAKER_THRESHOLD_PERCENT) || DEFAULT_LAB_AUTO_CIRCUIT_BREAKER_THRESHOLD_PERCENT)),
    siteUpdateInProgress: values.get("siteUpdateInProgress") === "true",
    siteUpdateMessage: String(values.get("siteUpdateMessage") || DEFAULT_SITE_UPDATE_MESSAGE).trim() || DEFAULT_SITE_UPDATE_MESSAGE,
    accountSharingProtectionEnabled: values.get("accountSharingProtectionEnabled") === "true",
    termsEnabled: values.get("termsEnabled") !== "false",
    userPortalV2Enabled: portalUiMode !== "legacy",
    portalUiMode,
    portalV2TransitionNoticeEnabled: values.get("portalV2TransitionNoticeEnabled") !== "false",
    portalV2TransitionNoticeMessage: String(values.get("portalV2TransitionNoticeMessage") || "").trim(),
    labStartDebugEnabled: values.get("labStartDebugEnabled") === "true",
    maxConcurrentLabs: clampMaxConcurrentLabs(values.get("maxConcurrentLabs") || 1),
    terminalSessionIdleMinutes: Math.max(1, Number(values.get("terminalSessionIdleMinutes") || values.get("terminalSessionTtlMinutes") || DEFAULT_TERMINAL_SESSION_IDLE_MINUTES) || DEFAULT_TERMINAL_SESSION_IDLE_MINUTES),
    terminalReplayEnabled: values.has("terminalReplayEnabled")
      ? values.get("terminalReplayEnabled") !== "false"
      : DEFAULT_TERMINAL_REPLAY_ENABLED,
    terminalFileUploadEnabled: values.get("terminalFileUploadEnabled") === "true",
    unusedVmAutoPauseEnabled: values.get("unusedVmAutoPauseEnabled") !== "false",
    unusedVmAutoPauseMinutes: Math.max(1440, Number(values.get("unusedVmAutoPauseMinutes") || DEFAULT_UNUSED_VM_AUTO_PAUSE_MINUTES) || DEFAULT_UNUSED_VM_AUTO_PAUSE_MINUTES),
    unusedVmRetentionMinutes: Math.max(1440, Number(values.get("unusedVmRetentionMinutes") || DEFAULT_UNUSED_VM_RETENTION_MINUTES) || DEFAULT_UNUSED_VM_RETENTION_MINUTES),
    googleCalendarSyncEnabled: values.get("googleCalendarSyncEnabled") === "true",
    googleCalendarIcsUrl: String(values.get("googleCalendarIcsUrl") || process.env.GOOGLE_CALENDAR_ICS_URL || "").trim(),
    googleCalendarSyncIntervalMinutes: Math.max(15, Number(values.get("googleCalendarSyncIntervalMinutes") || process.env.GOOGLE_CALENDAR_SYNC_INTERVAL_MINUTES || 60) || 60),
    labCircuitBreakerMessage: values.get("labCircuitBreakerMessage") || DEFAULT_LAB_CIRCUIT_BREAKER_MESSAGE,
    llmProvider,
    llmApiUrl: llmApiUrl || (llmProvider === "openai" ? "https://api.openai.com/v1/chat/completions" : DEFAULT_LLM_API_URL),
    llmModel: llmModel || (llmProvider === "openai" ? "gpt-4o-mini" : DEFAULT_LLM_MODEL),
    llmApiKey,
    llmSystemPrompt: String(values.get("llmSystemPrompt") || "").trim() || DEFAULT_LLM_SYSTEM_PROMPT,
    llmEnabled: values.get("llmEnabled") === "true",
    llmDailyQuotaEnabled,
    llmDailyQuotaLimit,
    llmDailyQuotaAdminBypass,
    llmMaxTokens,
    llmAdminTestMaxTokens,
    llmSurveyFeedbackMaxTokens,
    llmSurveyFeedbackTimeoutMs,
    llmSurveyFeedbackPrompt,
    llmSurveyFeedbackOptionsJson,
    llmThinkingMode,
    llmThinkingEnabled: llmThinkingMode === "enabled",
    llmNoThinkDirectiveEnabled,
    llmWebSearchEnabled,
    llmWebSearchTimeoutMs,
    llmWebSearchResultLimit,
    googleSearchApiKey,
    googleSearchCx,
    inviteOnlyMode: values.get("inviteOnlyMode") === "true",
    signupAutoApproveEnabled: values.get("signupAutoApproveEnabled") === "true",
    signupWelcomeCouponEnabled: values.get("signupWelcomeCouponEnabled") !== "false",
    siteVersionNumber: String(values.get("siteVersionNumber") || "v1.0").trim() || "v1.0",
    siteVersionStage: String(values.get("siteVersionStage") || "Release").trim() || "Release",
    siteVersionCodename: String(values.get("siteVersionCodename") || "Engineer Lab").trim() || "Engineer Lab",
    cicdExecutionMode,
    jenkinsBaseUrl,
    jenkinsUsername,
    jenkinsApiToken,
    jenkinsDefaultFolder: jenkinsDefaultFolder || "terminal-lab",
    jenkinsJobPrefix: jenkinsJobPrefix || "tlab-",
    jenkinsAutoCreateJobs: values.has("jenkinsAutoCreateJobs") ? values.get("jenkinsAutoCreateJobs") !== "false" : parseEnvFlag(process.env.JENKINS_AUTO_CREATE_JOBS, true),
    serviceProjectName,
    serviceCloudsYaml: String(values.get("serviceCloudsYaml") || process.env.OPENSTACK_SERVICE_CLOUDS_YAML || "").trim(),
    serviceCloudName: String(values.get("serviceCloudName") || process.env.OPENSTACK_SERVICE_CLOUD_NAME || process.env.OPENSTACK_CLOUD_NAME || "openstack").trim() || "openstack",
    serviceAuthUrl: String(values.get("serviceAuthUrl") || process.env.OPENSTACK_SERVICE_AUTH_URL || "").trim(),
    serviceHeatApiUrl: String(values.get("serviceHeatApiUrl") || process.env.OPENSTACK_SERVICE_HEAT_API_URL || "").trim(),
    serviceComputeApiUrl: String(values.get("serviceComputeApiUrl") || process.env.OPENSTACK_SERVICE_COMPUTE_API_URL || "").trim(),
    serviceNetworkApiUrl: String(values.get("serviceNetworkApiUrl") || process.env.OPENSTACK_SERVICE_NETWORK_API_URL || "").trim(),
    serviceMetricApiUrl: String(values.get("serviceMetricApiUrl") || process.env.OPENSTACK_SERVICE_METRIC_API_URL || "").trim(),
    openstackStatusProbesEnabled: values.has("openstackStatusProbesEnabled")
      ? values.get("openstackStatusProbesEnabled") !== "false"
      : DEFAULT_OPENSTACK_STATUS_PROBES_ENABLED,
    openstackStatusCacheTtlMinutes: Math.max(1, Math.min(1440, Number(values.get("openstackStatusCacheTtlMinutes") || DEFAULT_OPENSTACK_STATUS_CACHE_TTL_MINUTES) || DEFAULT_OPENSTACK_STATUS_CACHE_TTL_MINUTES)),
    adminAutoRefreshIntervalSeconds: Math.max(10, Math.min(3600, Number(values.get("adminAutoRefreshIntervalSeconds") || DEFAULT_ADMIN_AUTO_REFRESH_INTERVAL_SECONDS) || DEFAULT_ADMIN_AUTO_REFRESH_INTERVAL_SECONDS)),
    userAutoRefreshIntervalSeconds: Math.max(10, Math.min(3600, Number(values.get("userAutoRefreshIntervalSeconds") || DEFAULT_USER_AUTO_REFRESH_INTERVAL_SECONDS) || DEFAULT_USER_AUTO_REFRESH_INTERVAL_SECONDS)),
    pocProjectName: normalizePocProjectName(values.get("pocProjectName")),
    pocCloudsYaml: String(values.get("pocCloudsYaml") || process.env.OPENSTACK_POC_CLOUDS_YAML || "").trim(),
    pocCloudName: String(values.get("pocCloudName") || process.env.OPENSTACK_POC_CLOUD_NAME || process.env.OPENSTACK_CLOUD_NAME || "openstack").trim() || "openstack",
    pocAuthUrl: String(values.get("pocAuthUrl") || process.env.OPENSTACK_POC_AUTH_URL || "").trim(),
    pocHeatApiUrl: String(values.get("pocHeatApiUrl") || process.env.OPENSTACK_POC_HEAT_API_URL || "").trim(),
    pocMetricApiUrl: String(values.get("pocMetricApiUrl") || process.env.OPENSTACK_POC_METRIC_API_URL || "").trim(),
    pocDefaultHeatTemplateName: String(values.get("pocDefaultHeatTemplateName") || process.env.SELF_SERVICE_VM_HEAT_TEMPLATE || "self-service-vm-dynamic.yaml").trim() || "self-service-vm-dynamic.yaml",
    zunProjectName: String(values.get("zunProjectName") || "zun").trim() || "zun",
    magnumProjectName: String(values.get("magnumProjectName") || values.get("kubernetesProjectName") || "poc-example.com").trim() || "poc-example.com",
    magnumClusterProfiles: Array.isArray(parsedMagnumClusterProfiles) ? parsedMagnumClusterProfiles : [],
    magnumAutoApproveEnabled: values.get("magnumAutoApproveEnabled") === "true",
    magnumAutoApproveProfileIds: String(values.get("magnumAutoApproveProfileIds") || "").split(",").map((item) => item.trim()).filter(Boolean),
    magnumAutoApproveMaxMasterCount: Math.max(1, Math.min(9, Number(values.get("magnumAutoApproveMaxMasterCount") || 1) || 1)),
    magnumAutoApproveMaxNodeCount: Math.max(1, Math.min(100, Number(values.get("magnumAutoApproveMaxNodeCount") || 3) || 3)),
    magnumAutoApproveMaxClustersPerUser: Math.max(1, Math.min(20, Number(values.get("magnumAutoApproveMaxClustersPerUser") || 1) || 1)),
    magnumAutoApproveRequireQuota: values.get("magnumAutoApproveRequireQuota") !== "false",
    troveProjectName: String(values.get("troveProjectName") || "trove").trim() || "trove",
    selfServiceVmAllowedFlavors: parsedFlavors.length ? parsedFlavors : ["m1.tiny", "m1.small", "m1.medium"],
    aiVmFlavorCatalog: normalizeAiVmFlavorCatalog(parsedAiVmFlavorCatalog, parsedFlavors.length ? parsedFlavors : ["m1.tiny", "m1.small", "m1.medium"]),
    selfServiceVmAllowedImages: parsedSelfServiceImages.length ? parsedSelfServiceImages : [process.env.SELF_SERVICE_VM_IMAGE || "lab-rocky-9-2026"],
    selfServiceVmAllowedProjects: parsedSelfServiceProjects.length ? parsedSelfServiceProjects : [serviceProjectName],
    selfServiceVmAutoProvisionEnabled: values.get("selfServiceVmAutoProvisionEnabled") !== "false",
    selfServiceVmProjectAutoConfigureEnabled: values.get("selfServiceVmProjectAutoConfigureEnabled") === "true",
    selfServiceVmProjectAutoApproveEnabled: values.get("selfServiceVmProjectAutoApproveEnabled") === "true",
    selfServiceVmProjectAutoNetworkEnabled: values.get("selfServiceVmProjectAutoNetworkEnabled") === "true",
    selfServiceVmProjectRoleNames: parsedSelfServiceProjectRoleNames.length ? parsedSelfServiceProjectRoleNames : ["member", "heat_stack_owner"],
    selfServiceVmProjectExternalNetworkName: String(values.get("selfServiceVmProjectExternalNetworkName") || process.env.POC_EXTERNAL_NETWORK || "net-external").trim() || "net-external",
    selfServiceVmProjectQuota: normalizeSelfServiceProjectQuota(parsedSelfServiceProjectQuota),
    arenaEnabled: values.get("arenaEnabled") === "true",
    extensionServiceVisibilityNote: String(values.get("extensionServiceVisibilityNote") || "").trim(),
    selfServiceVmServiceEnabled: values.get("selfServiceVmServiceEnabled") === "true",
    selfServiceVmVolumeBootEnabled: values.get("selfServiceVmVolumeBootEnabled") === "true",
    selfServiceVmDataVolumeEnabled: values.get("selfServiceVmDataVolumeEnabled") === "true",
    selfServiceVmMaxDataVolumeCount: Math.max(1, Number(values.get("selfServiceVmMaxDataVolumeCount") || 2) || 2),
    selfServiceVmMaxDataVolumeSizeGb: Math.max(1, Number(values.get("selfServiceVmMaxDataVolumeSizeGb") || 100) || 100),
    selfServiceVmFloatingIpEnabled: values.get("selfServiceVmFloatingIpEnabled") === "true",
    labAutoBootFromVolumeOnDiskPressureEnabled: values.has("labAutoBootFromVolumeOnDiskPressureEnabled")
      ? values.get("labAutoBootFromVolumeOnDiskPressureEnabled") !== "false"
      : true,
    labAutoBootFromVolumeDiskThresholdPercent: Math.max(1, Math.min(99, Number(values.get("labAutoBootFromVolumeDiskThresholdPercent") || process.env.LAB_AUTO_BOOT_FROM_VOLUME_DISK_THRESHOLD_PERCENT || 80) || 80)),
    labAutoBootVolumeSizeGb: Math.max(1, Math.min(2048, Number(values.get("labAutoBootVolumeSizeGb") || process.env.LAB_AUTO_BOOT_VOLUME_SIZE_GB || 20) || 20)),
    labAutoBootVolumeType: String(values.get("labAutoBootVolumeType") || "").trim(),
    pocEnabled: values.get("pocEnabled") === "true",
    pocFreeModeEnabled: values.get("pocFreeModeEnabled") === "true",
    pocAllowedImages: parsedPocImages.length ? parsedPocImages : ["lab-rocky-9-2026", "ubuntu-24.04"],
    pocAllowedFlavors: parsedPocFlavors.length ? parsedPocFlavors : (parsedFlavors.length ? parsedFlavors : ["m1.tiny", "m1.small", "m1.medium"]),
    pocFlavorDailyPrices: Object.keys(parsedPocFlavorDailyPrices).length ? parsedPocFlavorDailyPrices : { "m1.tiny": 5900, "m1.small": 9900, "m1.medium": 19900 },
    pocAdvancedDailyPrices: Object.fromEntries(Object.entries(DEFAULT_POC_ADVANCED_DAILY_PRICES).map(([key, fallback]) => [
      key,
      Math.max(0, Number(parsedPocAdvancedDailyPrices[key] ?? fallback) || 0),
    ])),
    pocFlavorSpecs: Object.keys(parsedPocFlavorSpecs).length ? parsedPocFlavorSpecs : {
      "m1.tiny": { vcpu: 1, ramGb: 2, diskGb: 20 },
      "m1.small": { vcpu: 2, ramGb: 4, diskGb: 50 },
      "m1.medium": { vcpu: 4, ramGb: 8, diskGb: 80 },
    },
    courseProgramTypeOptions: normalizeCourseProgramTypeOptions(parsedCourseProgramTypeOptions),
    standardCourseOverviewDescription: String(values.get("standardCourseOverviewDescription") || "").trim() || DEFAULT_COURSE_OVERVIEWS.standard.description,
    standardCourseOverviewPoints,
    iltCourseOverviewDescription: String(values.get("iltCourseOverviewDescription") || "").trim() || DEFAULT_COURSE_OVERVIEWS.ilt.description,
    iltCourseOverviewPoints,
    onlineCourseOverviewDescription: String(values.get("onlineCourseOverviewDescription") || "").trim() || DEFAULT_COURSE_OVERVIEWS.online.description,
    onlineCourseOverviewPoints,
    governmentCourseOverviewDescription: String(values.get("governmentCourseOverviewDescription") || "").trim() || DEFAULT_COURSE_OVERVIEWS.government.description,
    governmentCourseOverviewPoints,
    zunApiUrl: String(values.get("zunApiUrl") || "").trim() || DEFAULT_ZUN_API_URL,
    zunEnabled: values.get("zunEnabled") === "true",
    zunAllowedImages: values.has("zunAllowedImages") ? parsedZunImages : ["docker.io/library/rockylinux:9", "docker.io/library/ubuntu:24.04"],
    magnumApiUrl: String(values.get("magnumApiUrl") || "").trim(),
    magnumEnabled: values.get("magnumEnabled") === "true",
    aiGpuEnabled: values.get("aiGpuEnabled") === "true",
    troveApiUrl: String(values.get("troveApiUrl") || "").trim(),
    troveEnabled: values.get("troveEnabled") === "true",
    troveAllowedDatastores: parsedTroveDatastores.length ? parsedTroveDatastores : DEFAULT_TROVE_ALLOWED_DATASTORES,
    troveAllowedFlavors: parsedTroveFlavors.length ? parsedTroveFlavors : DEFAULT_TROVE_ALLOWED_FLAVORS,
    troveAllowedSizesGb: parsedTroveSizes.length ? parsedTroveSizes : DEFAULT_TROVE_ALLOWED_SIZES_GB,
    landingVideoEnabled: values.get("landingVideoEnabled") !== "false",
    landingGuestPreviewEnabled: values.get("landingGuestPreviewEnabled") !== "false",
    landingScheduleEnabled: values.get("landingScheduleEnabled") !== "false",
    landingNoticeEnabled: values.get("landingNoticeEnabled") === "true",
    landingSurveyNoticeEnabled: values.get("landingSurveyNoticeEnabled") === "true",
    landingCurriculumCollapsedByDefault: values.get("landingCurriculumCollapsedByDefault") !== "false",
    landingDemoType: String(values.get("landingDemoType") || DEFAULT_LANDING_DEMO_TYPE).trim().toLowerCase() === "upload" ? "upload" : DEFAULT_LANDING_DEMO_TYPE,
    landingYoutubeUrl: String(values.get("landingYoutubeUrl") || "").trim() || DEFAULT_LANDING_YOUTUBE_URL,
    landingHeroEyebrow: String(values.get("landingHeroEyebrow") || "").trim() || DEFAULT_LANDING_EYEBROW,
    landingHeroTitle: String(values.get("landingHeroTitle") || "").trim() || DEFAULT_LANDING_TITLE,
    landingHeroCopy: String(values.get("landingHeroCopy") || "").trim() || DEFAULT_LANDING_COPY,
    landingAuthEyebrow: String(values.get("landingAuthEyebrow") || "").trim() || DEFAULT_LANDING_AUTH_EYEBROW,
    landingAuthTitle: String(values.get("landingAuthTitle") || "").trim() || DEFAULT_LANDING_AUTH_TITLE,
    landingAuthCopy: String(values.get("landingAuthCopy") || "").trim() || DEFAULT_LANDING_AUTH_COPY,
    landingFeatureCards: safeJsonParse(String(values.get("landingFeatureCardsJson") || DEFAULT_LANDING_FEATURES_JSON), safeJsonParse(DEFAULT_LANDING_FEATURES_JSON, [])),
    landingFreeTitle: String(values.get("landingFreeTitle") || "").trim() || DEFAULT_LANDING_FREE_TITLE,
    landingFreeSubtitle: String(values.get("landingFreeSubtitle") || "").trim() || DEFAULT_LANDING_FREE_SUBTITLE,
    landingCustomerLogosEnabled: values.get("landingCustomerLogosEnabled") !== "false",
    landingCustomerLogosTitle: String(values.get("landingCustomerLogosTitle") || "").trim() || DEFAULT_LANDING_CUSTOMER_LOGOS_TITLE,
    landingCustomerLogos: normalizeLandingCustomerLogos(values.get("landingCustomerLogosJson") || DEFAULT_LANDING_CUSTOMER_LOGOS_JSON),
    landingVideoPath: String(values.get("landingVideoPath") || "").trim(),
    landingVideoMime: String(values.get("landingVideoMime") || "").trim(),
    landingLogoMode: String(values.get("landingLogoMode") || "code").trim().toLowerCase() === "upload" ? "upload" : "code",
    landingLogoPath: String(values.get("landingLogoPath") || "").trim(),
    landingLogoMime: String(values.get("landingLogoMime") || "").trim(),
    faviconMode: String(values.get("faviconMode") || "code").trim().toLowerCase() === "upload" ? "upload" : "code",
    faviconPath: String(values.get("faviconPath") || "").trim(),
    faviconMime: String(values.get("faviconMime") || "").trim(),
    materialsUploadMaxMb: Math.max(1, Number(values.get("materialsUploadMaxMb") || 80) || 80),
    publicDomainRoutesEnabled: values.get("publicDomainRoutesEnabled") !== "false",
    externalSshRoutesEnabled: values.get("externalSshRoutesEnabled") !== "false",
    externalRdpRoutesEnabled: values.get("externalRdpRoutesEnabled") !== "false",
    publicTcpRoutesEnabled: values.get("publicTcpRoutesEnabled") === "true",
    courseQuoteAccessMode: normalizeCourseQuoteAccessMode(values.get("courseQuoteAccessMode")),
    rdpExternalPortStart: Math.max(1, Number(values.get("rdpExternalPortStart") || 43000) || 43000),
    rdpExternalPortEnd: Math.max(1, Number(values.get("rdpExternalPortEnd") || 43099) || 43099),
    tcpExternalPortStart: Math.max(1, Number(values.get("tcpExternalPortStart") || 45000) || 45000),
    tcpExternalPortEnd: Math.max(1, Number(values.get("tcpExternalPortEnd") || 45999) || 45999),
    paymentGatewayEnabled: values.has("paymentGatewayEnabled") ? values.get("paymentGatewayEnabled") === "true" : Boolean(envPaymentGatewayEnabled),
    paymentGatewayProvider,
    paymentGatewayMerchantId: values.has("paymentGatewayMerchantId")
      ? String(values.get("paymentGatewayMerchantId") || "").trim()
      : ENV_PAYMENT_GATEWAY_MERCHANT_ID,
    paymentGatewayApiBaseUrl,
    paymentGatewayPublicKey,
    paymentGatewaySecretKey,
    paymentGatewayWebhookSecret: values.has("paymentGatewayWebhookSecret")
      ? String(values.get("paymentGatewayWebhookSecret") || "").trim()
      : ENV_PAYMENT_GATEWAY_WEBHOOK_SECRET,
    oauthEnabled,
    oauthGoogleEnabled: values.has("oauthGoogleEnabled") ? values.get("oauthGoogleEnabled") === "true" : Boolean(oauthGoogleClientId && oauthGoogleClientSecret),
    oauthGoogleClientId,
    oauthGoogleClientSecret,
    oauthGoogleRedirectUri: String(values.get("oauthGoogleRedirectUri") || process.env.GOOGLE_OAUTH_REDIRECT_URI || "").trim(),
    oauthKakaoEnabled: values.has("oauthKakaoEnabled") ? values.get("oauthKakaoEnabled") === "true" : Boolean(oauthKakaoClientId),
    oauthKakaoClientId,
    oauthKakaoClientSecret,
    oauthKakaoRedirectUri: String(values.get("oauthKakaoRedirectUri") || process.env.KAKAO_OAUTH_REDIRECT_URI || "").trim(),
    oauthNaverEnabled: values.has("oauthNaverEnabled") ? values.get("oauthNaverEnabled") === "true" : Boolean(oauthNaverClientId && oauthNaverClientSecret),
    oauthNaverClientId,
    oauthNaverClientSecret,
    oauthNaverRedirectUri: String(values.get("oauthNaverRedirectUri") || process.env.NAVER_OAUTH_REDIRECT_URI || "").trim(),
    oauthRedirectUri: String(values.get("oauthRedirectUri") || process.env.OAUTH_REDIRECT_URI || "").trim(),
    mailEnabled: values.get("mailEnabled") === "true",
    mailProvider: String(values.get("mailProvider") || "webhook").trim() || "webhook",
    mailFromName: String(values.get("mailFromName") || "Terminal Lab").trim() || "Terminal Lab",
    mailFromAddress: String(values.get("mailFromAddress") || "").trim(),
    mailSmtpHost: String(values.get("mailSmtpHost") || "").trim(),
    mailSmtpPort: Math.max(1, Number(values.get("mailSmtpPort") || 587) || 587),
    mailSmtpSecure: values.get("mailSmtpSecure") === "true",
    mailSmtpUser: String(values.get("mailSmtpUser") || "").trim(),
    mailSmtpPassword: String(values.get("mailSmtpPassword") || "").trim(),
    mailWebhookUrl: String(values.get("mailWebhookUrl") || DEFAULT_MAIL_WEBHOOK_URL || "").trim(),
    mailWebhookTimeoutMs: Math.max(1000, Number(values.get("mailWebhookTimeoutMs") || DEFAULT_MAIL_WEBHOOK_TIMEOUT_MS || 10000) || 10000),
    mailTemplates: safeJsonParse(String(values.get("mailTemplatesJson") || "{}"), {}),
    consultingReplyTemplates: normalizeConsultingReplyTemplates(parsedConsultingReplyTemplates),
    footerAdminName: String(values.get("footerAdminName") || "관리자").trim() || "관리자",
    footerEmail: String(values.get("footerEmail") || "tang@dustbox.kr").trim() || "tang@dustbox.kr",
    footerBusinessInfo: String(values.get("footerBusinessInfo") || "사업자 정보").trim() || "사업자 정보",
    supportMessageGroupName: String(values.get("supportMessageGroupName") || "운영지원").trim() || "운영지원",
    supportAvailabilityMode: normalizeSupportAvailabilityMode(values.get("supportAvailabilityMode")),
    supportUnavailableMessage: String(values.get("supportUnavailableMessage") || "현재 관리자가 부재중입니다. 운영지원 대화는 잠시 후 다시 이용해 주세요.").trim() || "현재 관리자가 부재중입니다. 운영지원 대화는 잠시 후 다시 이용해 주세요.",
    otpAdminRequired: values.get("otpAdminRequired") === "true",
    otpUserEnabled: values.get("otpUserEnabled") === "true",
    otpIssuerName: String(values.get("otpIssuerName") || DEFAULT_OTP_ISSUER_NAME).trim() || DEFAULT_OTP_ISSUER_NAME,
    courseLevelOptions: parsedCourseLevelOptions.length ? parsedCourseLevelOptions : ["입문", "초급", "중급", "고급"],
    courseCategoryOptions: parsedCourseCategoryOptions.length ? parsedCourseCategoryOptions : ["linux", "k8s", "openstack", "ai"],
    customRouteSlots,
    customDomainGuidanceIntro: String(values.get("customDomainGuidanceIntro") || "").trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.intro,
    customDomainGuidanceCnameLabel: String(values.get("customDomainGuidanceCnameLabel") || "").trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.cnameLabel,
    customDomainGuidanceCnameText: String(values.get("customDomainGuidanceCnameText") || "").trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.cnameText,
    customDomainGuidanceOwnershipLabel: String(values.get("customDomainGuidanceOwnershipLabel") || "").trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.ownershipLabel,
    customDomainGuidanceOwnershipText: String(values.get("customDomainGuidanceOwnershipText") || "").trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.ownershipText,
    customDomainGuidanceRecommendationLabel: String(values.get("customDomainGuidanceRecommendationLabel") || "").trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.recommendationLabel,
    customDomainGuidanceRecommendationText: String(values.get("customDomainGuidanceRecommendationText") || "").trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.recommendationText,
    customDomainGuidanceVerificationLabel: String(values.get("customDomainGuidanceVerificationLabel") || "").trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.verificationLabel,
    customDomainGuidanceVerificationText: String(values.get("customDomainGuidanceVerificationText") || "").trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.verificationText,
  };
}
async function pgUpdatePlatformStatus(patch) {
  const normalizedFlavors = Array.isArray(patch.selfServiceVmAllowedFlavors) ? patch.selfServiceVmAllowedFlavors.map((item) => String(item || "").trim()).filter(Boolean) : String(patch.selfServiceVmAllowedFlavors || "").split(",").map((item) => item.trim()).filter(Boolean);
  const normalizedSelfServiceImages = Array.isArray(patch.selfServiceVmAllowedImages) ? patch.selfServiceVmAllowedImages.map((item) => String(item || "").trim()).filter(Boolean) : String(patch.selfServiceVmAllowedImages || "").split(",").map((item) => item.trim()).filter(Boolean);
  const normalizedSelfServiceProjects = Array.isArray(patch.selfServiceVmAllowedProjects) ? patch.selfServiceVmAllowedProjects.map((item) => String(item || "").trim()).filter(Boolean) : String(patch.selfServiceVmAllowedProjects || "").split(",").map((item) => item.trim()).filter(Boolean);
  const normalizedSelfServiceProjectRoleNames = Array.isArray(patch.selfServiceVmProjectRoleNames) ? patch.selfServiceVmProjectRoleNames.map((item) => String(item || "").trim()).filter(Boolean) : String(patch.selfServiceVmProjectRoleNames || "").split(",").map((item) => item.trim()).filter(Boolean);
  const normalizedSelfServiceProjectQuota = patch.selfServiceVmProjectQuota && typeof patch.selfServiceVmProjectQuota === "object" && !Array.isArray(patch.selfServiceVmProjectQuota)
    ? patch.selfServiceVmProjectQuota
    : {};
  const normalizedPocImages = (Array.isArray(patch.pocAllowedImages) ? patch.pocAllowedImages : String(patch.pocAllowedImages || "").split(",")).map((item) => String(item || "").trim()).filter(Boolean);
  const normalizedPocFlavors = (Array.isArray(patch.pocAllowedFlavors) ? patch.pocAllowedFlavors : String(patch.pocAllowedFlavors || "").split(",")).map((item) => String(item || "").trim()).filter(Boolean);
  const normalizedZunImages = (Array.isArray(patch.zunAllowedImages) ? patch.zunAllowedImages : String(patch.zunAllowedImages || "").split(",")).map((item) => String(item || "").trim()).filter(Boolean);
  const normalizedMagnumClusterProfiles = Array.isArray(patch.magnumClusterProfiles) ? patch.magnumClusterProfiles : [];
  const normalizedPocPrices = patch.pocFlavorDailyPrices && typeof patch.pocFlavorDailyPrices === "object" && !Array.isArray(patch.pocFlavorDailyPrices) ? patch.pocFlavorDailyPrices : {};
  const rawPocAdvancedDailyPrices = patch.pocAdvancedDailyPrices && typeof patch.pocAdvancedDailyPrices === "object" && !Array.isArray(patch.pocAdvancedDailyPrices) ? patch.pocAdvancedDailyPrices : {};
  const normalizedPocAdvancedDailyPrices = Object.fromEntries(Object.entries(DEFAULT_POC_ADVANCED_DAILY_PRICES).map(([key, fallback]) => [
    key,
    Math.max(0, Number(rawPocAdvancedDailyPrices[key] ?? fallback) || 0),
  ]));
  const normalizedPocSpecs = patch.pocFlavorSpecs && typeof patch.pocFlavorSpecs === "object" && !Array.isArray(patch.pocFlavorSpecs) ? patch.pocFlavorSpecs : {};
  const normalizedAiVmFlavorCatalog = normalizeAiVmFlavorCatalog(patch.aiVmFlavorCatalog, normalizedFlavors);
  const normalizedConsultingReplyTemplates = normalizeConsultingReplyTemplates(patch.consultingReplyTemplates);
  const normalizedTroveDatastores = (Array.isArray(patch.troveAllowedDatastores) ? patch.troveAllowedDatastores : String(patch.troveAllowedDatastores || "").split(",")).map((item) => String(item || "").trim()).filter(Boolean);
  const normalizedTroveFlavors = (Array.isArray(patch.troveAllowedFlavors) ? patch.troveAllowedFlavors : String(patch.troveAllowedFlavors || "").split(",")).map((item) => String(item || "").trim()).filter(Boolean);
  const normalizedTroveSizes = (Array.isArray(patch.troveAllowedSizesGb) ? patch.troveAllowedSizesGb : String(patch.troveAllowedSizesGb || "").split(",")).map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0);
  const normalizedCourseLevels = (Array.isArray(patch.courseLevelOptions) ? patch.courseLevelOptions : String(patch.courseLevelOptions || "").split(",")).map((item) => String(item || "").trim()).filter(Boolean);
  const normalizedCourseCategories = (Array.isArray(patch.courseCategoryOptions) ? patch.courseCategoryOptions : String(patch.courseCategoryOptions || "").split(",")).map((item) => String(item || "").trim()).filter(Boolean);
  const normalizedCourseProgramTypes = (Array.isArray(patch.courseProgramTypeOptions) ? patch.courseProgramTypeOptions : String(patch.courseProgramTypeOptions || "").split(",")).map((item) => String(item || "").trim()).filter(Boolean);
  const normalizedStandardCourseOverviewPoints = normalizeCourseOverviewPoints(patch.standardCourseOverviewPoints, DEFAULT_COURSE_OVERVIEWS.standard.points);
  const normalizedIltCourseOverviewPoints = normalizeCourseOverviewPoints(patch.iltCourseOverviewPoints, DEFAULT_COURSE_OVERVIEWS.ilt.points);
  const normalizedOnlineCourseOverviewPoints = normalizeCourseOverviewPoints(patch.onlineCourseOverviewPoints, DEFAULT_COURSE_OVERVIEWS.online.points);
  const normalizedGovernmentCourseOverviewPoints = normalizeCourseOverviewPoints(patch.governmentCourseOverviewPoints, DEFAULT_COURSE_OVERVIEWS.government.points);
  const normalizedLandingCustomerLogos = normalizeLandingCustomerLogos(patch.landingCustomerLogos);
  const normalizedCustomRouteSlots = Array.from({ length: 3 }, (_item, index) => {
    const current = Array.isArray(patch.customRouteSlots) ? patch.customRouteSlots[index] || {} : {};
    const port = Number(current.port || 0);
    return {
      labelKey: `customRouteSlot${index + 1}Label`,
      labelValue: String(current.label || "").trim(),
      portKey: `customRouteSlot${index + 1}Port`,
      portValue: Number.isInteger(port) && port > 0 && port <= 65535 ? String(port) : "",
    };
  });
  const portalUiMode = normalizePortalUiMode(
    patch.portalUiMode,
    patch.userPortalV2Enabled ? "switchable" : "legacy",
  );
  const updates = [
    ["labCircuitBreaker", patch.labCircuitBreaker ? "true" : "false"],
    ["labCircuitBreakerSource", String(patch.labCircuitBreakerSource || "").trim()],
    ["labCircuitBreakerTriggeredAt", String(patch.labCircuitBreakerTriggeredAt || "").trim()],
    ["labCircuitBreakerMetric", String(patch.labCircuitBreakerMetric || "").trim()],
    ["labCircuitBreakerUsagePercent", String(Math.max(0, Math.min(100, Number(patch.labCircuitBreakerUsagePercent || 0) || 0)))],
    ["labAutoCircuitBreakerEnabled", patch.labAutoCircuitBreakerEnabled === false ? "false" : "true"],
    ["labAutoCircuitBreakerThresholdPercent", String(Math.max(50, Math.min(100, Number(patch.labAutoCircuitBreakerThresholdPercent || DEFAULT_LAB_AUTO_CIRCUIT_BREAKER_THRESHOLD_PERCENT) || DEFAULT_LAB_AUTO_CIRCUIT_BREAKER_THRESHOLD_PERCENT)))],
    ["siteUpdateInProgress", patch.siteUpdateInProgress ? "true" : "false"],
    ["siteUpdateMessage", String(patch.siteUpdateMessage || DEFAULT_SITE_UPDATE_MESSAGE).trim() || DEFAULT_SITE_UPDATE_MESSAGE],
    ["accountSharingProtectionEnabled", patch.accountSharingProtectionEnabled ? "true" : "false"],
    ["termsEnabled", patch.termsEnabled === false ? "false" : "true"],
    ["userPortalV2Enabled", portalUiMode !== "legacy" ? "true" : "false"],
    ["portalUiMode", portalUiMode],
    ["portalV2TransitionNoticeEnabled", patch.portalV2TransitionNoticeEnabled === false ? "false" : "true"],
    ["portalV2TransitionNoticeMessage", String(patch.portalV2TransitionNoticeMessage || "").trim()],
    ["labStartDebugEnabled", patch.labStartDebugEnabled ? "true" : "false"],
    ["maxConcurrentLabs", String(clampMaxConcurrentLabs(patch.maxConcurrentLabs || 1))],
    ["terminalSessionIdleMinutes", String(Math.max(1, Number(patch.terminalSessionIdleMinutes || patch.terminalSessionTtlMinutes || DEFAULT_TERMINAL_SESSION_IDLE_MINUTES) || DEFAULT_TERMINAL_SESSION_IDLE_MINUTES))],
    ["terminalReplayEnabled", patch.terminalReplayEnabled === false ? "false" : "true"],
    ["terminalFileUploadEnabled", patch.terminalFileUploadEnabled ? "true" : "false"],
    ["unusedVmAutoPauseEnabled", patch.unusedVmAutoPauseEnabled === false ? "false" : "true"],
    ["unusedVmAutoPauseMinutes", String(Math.max(1440, Number(patch.unusedVmAutoPauseMinutes || DEFAULT_UNUSED_VM_AUTO_PAUSE_MINUTES) || DEFAULT_UNUSED_VM_AUTO_PAUSE_MINUTES))],
    ["unusedVmRetentionMinutes", String(Math.max(1440, Number(patch.unusedVmRetentionMinutes || DEFAULT_UNUSED_VM_RETENTION_MINUTES) || DEFAULT_UNUSED_VM_RETENTION_MINUTES))],
    ["googleCalendarSyncEnabled", patch.googleCalendarSyncEnabled ? "true" : "false"],
    ["googleCalendarIcsUrl", String(patch.googleCalendarIcsUrl || "").trim()],
    ["googleCalendarSyncIntervalMinutes", String(Math.max(15, Number(patch.googleCalendarSyncIntervalMinutes || 60) || 60))],
    ["labCircuitBreakerMessage", String(patch.labCircuitBreakerMessage || DEFAULT_LAB_CIRCUIT_BREAKER_MESSAGE).trim()],
    ["llmProvider", normalizeStoredLlmProvider(patch.llmProvider || DEFAULT_LLM_PROVIDER)],
    ["llmApiUrl", String(patch.llmApiUrl || "").trim()],
    ["llmModel", String(patch.llmModel || "").trim() || DEFAULT_LLM_MODEL],
    ["llmApiKey", String(patch.llmApiKey || "").trim()],
    ["llmSystemPrompt", String(patch.llmSystemPrompt || "").trim() || DEFAULT_LLM_SYSTEM_PROMPT],
    ["llmEnabled", patch.llmEnabled === false ? "false" : "true"],
    ["llmDailyQuotaEnabled", patch.llmDailyQuotaEnabled === false ? "false" : "true"],
    ["llmDailyQuotaLimit", String(Math.max(1, Number(patch.llmDailyQuotaLimit || DEFAULT_LLM_DAILY_QUOTA_LIMIT) || DEFAULT_LLM_DAILY_QUOTA_LIMIT))],
    ["llmDailyQuotaAdminBypass", patch.llmDailyQuotaAdminBypass === false ? "false" : "true"],
    ["llmMaxTokens", String(Math.max(1, Number(patch.llmMaxTokens || DEFAULT_LLM_MAX_TOKENS) || DEFAULT_LLM_MAX_TOKENS))],
    ["llmAdminTestMaxTokens", String(Math.max(1, Number(patch.llmAdminTestMaxTokens || DEFAULT_LLM_ADMIN_TEST_MAX_TOKENS) || DEFAULT_LLM_ADMIN_TEST_MAX_TOKENS))],
    ["llmSurveyFeedbackMaxTokens", String(Math.max(64, Number(patch.llmSurveyFeedbackMaxTokens || DEFAULT_LLM_SURVEY_FEEDBACK_MAX_TOKENS) || DEFAULT_LLM_SURVEY_FEEDBACK_MAX_TOKENS))],
    ["llmSurveyFeedbackTimeoutMs", String(Math.max(30000, Number(patch.llmSurveyFeedbackTimeoutMs || DEFAULT_LLM_SURVEY_FEEDBACK_TIMEOUT_MS) || DEFAULT_LLM_SURVEY_FEEDBACK_TIMEOUT_MS))],
    ["llmSurveyFeedbackPrompt", String(patch.llmSurveyFeedbackPrompt || DEFAULT_LLM_SURVEY_FEEDBACK_PROMPT).trim() || DEFAULT_LLM_SURVEY_FEEDBACK_PROMPT],
    ["llmSurveyFeedbackOptionsJson", String(patch.llmSurveyFeedbackOptionsJson || DEFAULT_LLM_SURVEY_FEEDBACK_OPTIONS_JSON || "").trim()],
    ["llmThinkingMode", normalizeStoredLlmThinkingMode(patch.llmThinkingMode || DEFAULT_LLM_THINKING_MODE)],
    ["llmNoThinkDirectiveEnabled", patch.llmNoThinkDirectiveEnabled === false ? "false" : "true"],
    ["llmWebSearchEnabled", patch.llmWebSearchEnabled === false ? "false" : "true"],
    ["llmWebSearchTimeoutMs", String(Math.max(1000, Number(patch.llmWebSearchTimeoutMs || DEFAULT_LLM_WEB_SEARCH_TIMEOUT_MS) || DEFAULT_LLM_WEB_SEARCH_TIMEOUT_MS))],
    ["llmWebSearchResultLimit", String(Math.min(10, Math.max(1, Number(patch.llmWebSearchResultLimit || DEFAULT_LLM_WEB_SEARCH_RESULT_LIMIT) || DEFAULT_LLM_WEB_SEARCH_RESULT_LIMIT)))],
    ["googleSearchApiKey", String(patch.googleSearchApiKey || "").trim()],
    ["googleSearchCx", String(patch.googleSearchCx || "").trim()],
    ["inviteOnlyMode", patch.inviteOnlyMode ? "true" : "false"],
    ["signupAutoApproveEnabled", patch.signupAutoApproveEnabled ? "true" : "false"],
    ["signupWelcomeCouponEnabled", patch.signupWelcomeCouponEnabled === false ? "false" : "true"],
    ["siteVersionNumber", String(patch.siteVersionNumber || "v1.0").trim() || "v1.0"],
    ["siteVersionStage", String(patch.siteVersionStage || "Release").trim() || "Release"],
    ["siteVersionCodename", String(patch.siteVersionCodename || "Engineer Lab").trim() || "Engineer Lab"],
    ["cicdExecutionMode", String(patch.cicdExecutionMode || "simulated").trim().toLowerCase() === "jenkins" ? "jenkins" : "simulated"],
    ["jenkinsBaseUrl", String(patch.jenkinsBaseUrl || "").trim()],
    ["jenkinsUsername", String(patch.jenkinsUsername || "").trim()],
    ["jenkinsApiToken", String(patch.jenkinsApiToken || "").trim()],
    ["jenkinsDefaultFolder", String(patch.jenkinsDefaultFolder || "terminal-lab").trim() || "terminal-lab"],
    ["jenkinsJobPrefix", String(patch.jenkinsJobPrefix || "tlab-").trim()],
    ["jenkinsAutoCreateJobs", patch.jenkinsAutoCreateJobs === false ? "false" : "true"],
    ["serviceProjectName", String(patch.serviceProjectName || "service").trim() || "service"],
    ["serviceCloudsYaml", String(patch.serviceCloudsYaml || "").trim()],
    ["serviceCloudName", String(patch.serviceCloudName || "openstack").trim() || "openstack"],
    ["serviceAuthUrl", String(patch.serviceAuthUrl || "").trim()],
    ["serviceHeatApiUrl", String(patch.serviceHeatApiUrl || "").trim()],
    ["serviceComputeApiUrl", String(patch.serviceComputeApiUrl || "").trim()],
    ["serviceNetworkApiUrl", String(patch.serviceNetworkApiUrl || "").trim()],
    ["serviceMetricApiUrl", String(patch.serviceMetricApiUrl || "").trim()],
    ["openstackStatusProbesEnabled", patch.openstackStatusProbesEnabled === false ? "false" : "true"],
    ["openstackStatusCacheTtlMinutes", String(Math.max(1, Math.min(1440, Number(patch.openstackStatusCacheTtlMinutes || DEFAULT_OPENSTACK_STATUS_CACHE_TTL_MINUTES) || DEFAULT_OPENSTACK_STATUS_CACHE_TTL_MINUTES)))],
    ["adminAutoRefreshIntervalSeconds", String(Math.max(10, Math.min(3600, Number(patch.adminAutoRefreshIntervalSeconds || DEFAULT_ADMIN_AUTO_REFRESH_INTERVAL_SECONDS) || DEFAULT_ADMIN_AUTO_REFRESH_INTERVAL_SECONDS)))],
    ["userAutoRefreshIntervalSeconds", String(Math.max(10, Math.min(3600, Number(patch.userAutoRefreshIntervalSeconds || DEFAULT_USER_AUTO_REFRESH_INTERVAL_SECONDS) || DEFAULT_USER_AUTO_REFRESH_INTERVAL_SECONDS)))],
    ["pocProjectName", normalizePocProjectName(patch.pocProjectName)],
    ["pocCloudsYaml", String(patch.pocCloudsYaml || "").trim()],
    ["pocCloudName", String(patch.pocCloudName || "openstack").trim() || "openstack"],
    ["pocAuthUrl", String(patch.pocAuthUrl || "").trim()],
    ["pocHeatApiUrl", String(patch.pocHeatApiUrl || "").trim()],
    ["pocMetricApiUrl", String(patch.pocMetricApiUrl || "").trim()],
    ["pocDefaultHeatTemplateName", String(patch.pocDefaultHeatTemplateName || process.env.SELF_SERVICE_VM_HEAT_TEMPLATE || "self-service-vm-dynamic.yaml").trim() || "self-service-vm-dynamic.yaml"],
    ["zunProjectName", String(patch.zunProjectName || "zun").trim() || "zun"],
    ["magnumProjectName", String(patch.magnumProjectName || "poc-example.com").trim() || "poc-example.com"],
    ["magnumClusterProfilesJson", JSON.stringify(normalizedMagnumClusterProfiles)],
    ["magnumAutoApproveEnabled", patch.magnumAutoApproveEnabled ? "true" : "false"],
    ["magnumAutoApproveProfileIds", (Array.isArray(patch.magnumAutoApproveProfileIds) ? patch.magnumAutoApproveProfileIds : String(patch.magnumAutoApproveProfileIds || "").split(",")).map((item) => String(item || "").trim()).filter(Boolean).join(",")],
    ["magnumAutoApproveMaxMasterCount", String(Math.max(1, Math.min(9, Number(patch.magnumAutoApproveMaxMasterCount || 1) || 1)))],
    ["magnumAutoApproveMaxNodeCount", String(Math.max(1, Math.min(100, Number(patch.magnumAutoApproveMaxNodeCount || 3) || 3)))],
    ["magnumAutoApproveMaxClustersPerUser", String(Math.max(1, Math.min(20, Number(patch.magnumAutoApproveMaxClustersPerUser || 1) || 1)))],
    ["magnumAutoApproveRequireQuota", patch.magnumAutoApproveRequireQuota === false ? "false" : "true"],
    ["troveProjectName", String(patch.troveProjectName || "trove").trim() || "trove"],
    ["selfServiceVmAllowedFlavors", (normalizedFlavors.length ? normalizedFlavors : ["m1.tiny", "m1.small", "m1.medium"]).join(",")],
    ["aiVmFlavorCatalogJson", JSON.stringify(normalizedAiVmFlavorCatalog)],
    ["selfServiceVmAllowedImages", (normalizedSelfServiceImages.length ? normalizedSelfServiceImages : [process.env.SELF_SERVICE_VM_IMAGE || "lab-rocky-9-2026"]).join(",")],
    ["selfServiceVmAllowedProjects", (normalizedSelfServiceProjects.length ? normalizedSelfServiceProjects : [String(patch.serviceProjectName || "service").trim() || "service"]).join(",")],
    ["selfServiceVmAutoProvisionEnabled", patch.selfServiceVmAutoProvisionEnabled === false ? "false" : "true"],
    ["selfServiceVmProjectAutoConfigureEnabled", patch.selfServiceVmProjectAutoConfigureEnabled ? "true" : "false"],
    ["selfServiceVmProjectAutoApproveEnabled", patch.selfServiceVmProjectAutoApproveEnabled && patch.selfServiceVmProjectAutoConfigureEnabled ? "true" : "false"],
    ["selfServiceVmProjectAutoNetworkEnabled", patch.selfServiceVmProjectAutoNetworkEnabled ? "true" : "false"],
    ["selfServiceVmProjectRoleNames", (normalizedSelfServiceProjectRoleNames.length ? normalizedSelfServiceProjectRoleNames : ["member", "heat_stack_owner"]).join(",")],
    ["selfServiceVmProjectExternalNetworkName", String(patch.selfServiceVmProjectExternalNetworkName || process.env.POC_EXTERNAL_NETWORK || "net-external").trim() || "net-external"],
    ["selfServiceVmProjectQuotaJson", JSON.stringify(normalizeSelfServiceProjectQuota(normalizedSelfServiceProjectQuota))],
    ["arenaEnabled", patch.arenaEnabled ? "true" : "false"],
    ["extensionServiceVisibilityNote", String(patch.extensionServiceVisibilityNote || "").trim()],
    ["selfServiceVmServiceEnabled", patch.selfServiceVmServiceEnabled ? "true" : "false"],
    ["selfServiceVmVolumeBootEnabled", patch.selfServiceVmVolumeBootEnabled ? "true" : "false"],
    ["selfServiceVmDataVolumeEnabled", patch.selfServiceVmDataVolumeEnabled ? "true" : "false"],
    ["selfServiceVmMaxDataVolumeCount", String(Math.max(1, Number(patch.selfServiceVmMaxDataVolumeCount || 2) || 2))],
    ["selfServiceVmMaxDataVolumeSizeGb", String(Math.max(1, Number(patch.selfServiceVmMaxDataVolumeSizeGb || 100) || 100))],
    ["selfServiceVmFloatingIpEnabled", patch.selfServiceVmFloatingIpEnabled ? "true" : "false"],
    ["labAutoBootFromVolumeOnDiskPressureEnabled", patch.labAutoBootFromVolumeOnDiskPressureEnabled === false ? "false" : "true"],
    ["labAutoBootFromVolumeDiskThresholdPercent", String(Math.max(1, Math.min(99, Number(patch.labAutoBootFromVolumeDiskThresholdPercent || 80) || 80)))],
    ["labAutoBootVolumeSizeGb", String(Math.max(1, Math.min(2048, Number(patch.labAutoBootVolumeSizeGb || 20) || 20)))],
    ["labAutoBootVolumeType", String(patch.labAutoBootVolumeType || "").trim()],
    ["pocEnabled", patch.pocEnabled ? "true" : "false"],
    ["pocFreeModeEnabled", patch.pocFreeModeEnabled ? "true" : "false"],
    ["pocAllowedImages", (normalizedPocImages.length ? normalizedPocImages : ["lab-rocky-9-2026", "ubuntu-24.04"]).join(",")],
    ["pocAllowedFlavors", (normalizedPocFlavors.length ? normalizedPocFlavors : (normalizedFlavors.length ? normalizedFlavors : ["m1.tiny", "m1.small", "m1.medium"])).join(",")],
    ["pocFlavorDailyPricesJson", JSON.stringify(normalizedPocPrices)],
    ["pocAdvancedDailyPricesJson", JSON.stringify(normalizedPocAdvancedDailyPrices)],
    ["pocFlavorSpecsJson", JSON.stringify(normalizedPocSpecs)],
    ["zunApiUrl", String(patch.zunApiUrl || "").trim()],
    ["zunEnabled", patch.zunEnabled ? "true" : "false"],
    ["zunAllowedImages", normalizedZunImages.join(",")],
    ["magnumApiUrl", String(patch.magnumApiUrl || "").trim()],
    ["magnumEnabled", patch.magnumEnabled ? "true" : "false"],
    ["aiGpuEnabled", patch.aiGpuEnabled ? "true" : "false"],
    ["troveApiUrl", String(patch.troveApiUrl || "").trim()],
    ["troveEnabled", patch.troveEnabled ? "true" : "false"],
    ["troveAllowedDatastores", (normalizedTroveDatastores.length ? normalizedTroveDatastores : DEFAULT_TROVE_ALLOWED_DATASTORES).join(",")],
    ["troveAllowedFlavors", (normalizedTroveFlavors.length ? normalizedTroveFlavors : DEFAULT_TROVE_ALLOWED_FLAVORS).join(",")],
    ["troveAllowedSizesGb", (normalizedTroveSizes.length ? normalizedTroveSizes : DEFAULT_TROVE_ALLOWED_SIZES_GB).join(",")],
    ["landingVideoEnabled", patch.landingVideoEnabled === false ? "false" : "true"],
    ["landingGuestPreviewEnabled", patch.landingGuestPreviewEnabled === false ? "false" : "true"],
    ["landingScheduleEnabled", patch.landingScheduleEnabled === false ? "false" : "true"],
    ["landingNoticeEnabled", patch.landingNoticeEnabled === true ? "true" : "false"],
    ["landingSurveyNoticeEnabled", patch.landingSurveyNoticeEnabled === true ? "true" : "false"],
    ["landingCurriculumCollapsedByDefault", patch.landingCurriculumCollapsedByDefault === false ? "false" : "true"],
    ["landingDemoType", String(patch.landingDemoType || DEFAULT_LANDING_DEMO_TYPE).trim().toLowerCase() === "upload" ? "upload" : DEFAULT_LANDING_DEMO_TYPE],
    ["landingYoutubeUrl", String(patch.landingYoutubeUrl || DEFAULT_LANDING_YOUTUBE_URL).trim() || DEFAULT_LANDING_YOUTUBE_URL],
    ["landingHeroEyebrow", String(patch.landingHeroEyebrow || DEFAULT_LANDING_EYEBROW).trim() || DEFAULT_LANDING_EYEBROW],
    ["landingHeroTitle", String(patch.landingHeroTitle || DEFAULT_LANDING_TITLE).trim() || DEFAULT_LANDING_TITLE],
    ["landingHeroCopy", String(patch.landingHeroCopy || DEFAULT_LANDING_COPY).trim() || DEFAULT_LANDING_COPY],
    ["landingAuthEyebrow", String(patch.landingAuthEyebrow || DEFAULT_LANDING_AUTH_EYEBROW).trim() || DEFAULT_LANDING_AUTH_EYEBROW],
    ["landingAuthTitle", String(patch.landingAuthTitle || DEFAULT_LANDING_AUTH_TITLE).trim() || DEFAULT_LANDING_AUTH_TITLE],
    ["landingAuthCopy", String(patch.landingAuthCopy || DEFAULT_LANDING_AUTH_COPY).trim() || DEFAULT_LANDING_AUTH_COPY],
    ["landingFeatureCardsJson", JSON.stringify(Array.isArray(patch.landingFeatureCards) && patch.landingFeatureCards.length ? patch.landingFeatureCards.slice(0, 3) : JSON.parse(DEFAULT_LANDING_FEATURES_JSON))],
    ["landingFreeTitle", String(patch.landingFreeTitle || DEFAULT_LANDING_FREE_TITLE).trim() || DEFAULT_LANDING_FREE_TITLE],
    ["landingFreeSubtitle", String(patch.landingFreeSubtitle || DEFAULT_LANDING_FREE_SUBTITLE).trim() || DEFAULT_LANDING_FREE_SUBTITLE],
    ["landingCustomerLogosEnabled", patch.landingCustomerLogosEnabled === false ? "false" : "true"],
    ["landingCustomerLogosTitle", String(patch.landingCustomerLogosTitle || DEFAULT_LANDING_CUSTOMER_LOGOS_TITLE).trim() || DEFAULT_LANDING_CUSTOMER_LOGOS_TITLE],
    ["landingCustomerLogosJson", JSON.stringify(normalizedLandingCustomerLogos)],
    ["landingVideoPath", String(patch.landingVideoPath || "").trim()],
    ["landingVideoMime", String(patch.landingVideoMime || "").trim()],
    ["landingLogoMode", String(patch.landingLogoMode || "code").trim().toLowerCase() === "upload" ? "upload" : "code"],
    ["landingLogoPath", String(patch.landingLogoPath || "").trim()],
    ["landingLogoMime", String(patch.landingLogoMime || "").trim()],
    ["faviconMode", String(patch.faviconMode || "code").trim().toLowerCase() === "upload" ? "upload" : "code"],
    ["faviconPath", String(patch.faviconPath || "").trim()],
    ["faviconMime", String(patch.faviconMime || "").trim()],
    ["materialsUploadMaxMb", String(Math.max(1, Number(patch.materialsUploadMaxMb || 80) || 80))],
    ["publicDomainRoutesEnabled", patch.publicDomainRoutesEnabled === false ? "false" : "true"],
    ["externalSshRoutesEnabled", patch.externalSshRoutesEnabled === false ? "false" : "true"],
    ["externalRdpRoutesEnabled", patch.externalRdpRoutesEnabled === false ? "false" : "true"],
    ["publicTcpRoutesEnabled", patch.publicTcpRoutesEnabled ? "true" : "false"],
    ["courseQuoteAccessMode", normalizeCourseQuoteAccessMode(patch.courseQuoteAccessMode)],
    ["rdpExternalPortStart", String(Math.max(1, Number(patch.rdpExternalPortStart || 43000) || 43000))],
    ["rdpExternalPortEnd", String(Math.max(1, Number(patch.rdpExternalPortEnd || 43099) || 43099))],
    ["tcpExternalPortStart", String(Math.max(1, Number(patch.tcpExternalPortStart || 45000) || 45000))],
    ["tcpExternalPortEnd", String(Math.max(1, Number(patch.tcpExternalPortEnd || 45999) || 45999))],
    ["paymentGatewayEnabled", patch.paymentGatewayEnabled ? "true" : "false"],
    ["paymentGatewayProvider", String(patch.paymentGatewayProvider || "manual").trim() || "manual"],
    ["paymentGatewayMerchantId", String(patch.paymentGatewayMerchantId || "").trim()],
    ["paymentGatewayApiBaseUrl", String(patch.paymentGatewayApiBaseUrl || "").trim()],
    ["paymentGatewayPublicKey", String(patch.paymentGatewayPublicKey || "").trim()],
    ["paymentGatewaySecretKey", String(patch.paymentGatewaySecretKey || "").trim()],
    ["paymentGatewayWebhookSecret", String(patch.paymentGatewayWebhookSecret || "").trim()],
    ["oauthEnabled", patch.oauthEnabled === false ? "false" : "true"],
    ["oauthGoogleEnabled", patch.oauthGoogleEnabled ? "true" : "false"],
    ["oauthGoogleClientId", String(patch.oauthGoogleClientId || "").trim()],
    ["oauthGoogleClientSecret", String(patch.oauthGoogleClientSecret || "").trim()],
    ["oauthGoogleRedirectUri", String(patch.oauthGoogleRedirectUri || "").trim()],
    ["oauthKakaoEnabled", patch.oauthKakaoEnabled ? "true" : "false"],
    ["oauthKakaoClientId", String(patch.oauthKakaoClientId || "").trim()],
    ["oauthKakaoClientSecret", String(patch.oauthKakaoClientSecret || "").trim()],
    ["oauthKakaoRedirectUri", String(patch.oauthKakaoRedirectUri || "").trim()],
    ["oauthNaverEnabled", patch.oauthNaverEnabled ? "true" : "false"],
    ["oauthNaverClientId", String(patch.oauthNaverClientId || "").trim()],
    ["oauthNaverClientSecret", String(patch.oauthNaverClientSecret || "").trim()],
    ["oauthNaverRedirectUri", String(patch.oauthNaverRedirectUri || "").trim()],
    ["oauthRedirectUri", String(patch.oauthRedirectUri || "").trim()],
    ["mailEnabled", patch.mailEnabled ? "true" : "false"],
    ["mailProvider", String(patch.mailProvider || "webhook").trim() || "webhook"],
    ["mailFromName", String(patch.mailFromName || "").trim()],
    ["mailFromAddress", String(patch.mailFromAddress || "").trim()],
    ["mailSmtpHost", String(patch.mailSmtpHost || "").trim()],
    ["mailSmtpPort", String(Math.max(1, Number(patch.mailSmtpPort || 587) || 587))],
    ["mailSmtpSecure", patch.mailSmtpSecure ? "true" : "false"],
    ["mailSmtpUser", String(patch.mailSmtpUser || "").trim()],
    ["mailSmtpPassword", String(patch.mailSmtpPassword || "").trim()],
    ["mailWebhookUrl", String(patch.mailWebhookUrl || "").trim()],
    ["mailWebhookTimeoutMs", String(Math.max(1000, Number(patch.mailWebhookTimeoutMs || DEFAULT_MAIL_WEBHOOK_TIMEOUT_MS || 10000) || 10000))],
    ["mailTemplatesJson", JSON.stringify(patch.mailTemplates && typeof patch.mailTemplates === "object" && !Array.isArray(patch.mailTemplates) ? patch.mailTemplates : {})],
    ["consultingReplyTemplatesJson", JSON.stringify(normalizedConsultingReplyTemplates)],
    ["footerAdminName", String(patch.footerAdminName || "관리자").trim() || "관리자"],
    ["footerEmail", String(patch.footerEmail || "tang@dustbox.kr").trim() || "tang@dustbox.kr"],
    ["footerBusinessInfo", String(patch.footerBusinessInfo || "사업자 정보").trim() || "사업자 정보"],
    ["supportMessageGroupName", String(patch.supportMessageGroupName || "운영지원").trim() || "운영지원"],
    ["supportAvailabilityMode", normalizeSupportAvailabilityMode(patch.supportAvailabilityMode)],
    ["supportUnavailableMessage", String(patch.supportUnavailableMessage || "현재 관리자가 부재중입니다. 운영지원 대화는 잠시 후 다시 이용해 주세요.").trim() || "현재 관리자가 부재중입니다. 운영지원 대화는 잠시 후 다시 이용해 주세요."],
    ["otpAdminRequired", patch.otpAdminRequired ? "true" : "false"],
    ["otpUserEnabled", patch.otpUserEnabled ? "true" : "false"],
    ["otpIssuerName", String(patch.otpIssuerName || DEFAULT_OTP_ISSUER_NAME).trim() || DEFAULT_OTP_ISSUER_NAME],
    ["courseLevelOptions", (normalizedCourseLevels.length ? normalizedCourseLevels : ["입문", "초급", "중급", "고급"]).join(",")],
    ["courseCategoryOptions", (normalizedCourseCategories.length ? normalizedCourseCategories : ["linux", "k8s", "openstack", "ai"]).join(",")],
    ["courseProgramTypeOptions", normalizeCourseProgramTypeOptions(normalizedCourseProgramTypes).join(",")],
    ["standardCourseOverviewDescription", String(patch.standardCourseOverviewDescription || DEFAULT_COURSE_OVERVIEWS.standard.description).trim() || DEFAULT_COURSE_OVERVIEWS.standard.description],
    ["standardCourseOverviewPoints", normalizedStandardCourseOverviewPoints.join(",")],
    ["iltCourseOverviewDescription", String(patch.iltCourseOverviewDescription || DEFAULT_COURSE_OVERVIEWS.ilt.description).trim() || DEFAULT_COURSE_OVERVIEWS.ilt.description],
    ["iltCourseOverviewPoints", normalizedIltCourseOverviewPoints.join(",")],
    ["onlineCourseOverviewDescription", String(patch.onlineCourseOverviewDescription || DEFAULT_COURSE_OVERVIEWS.online.description).trim() || DEFAULT_COURSE_OVERVIEWS.online.description],
    ["onlineCourseOverviewPoints", normalizedOnlineCourseOverviewPoints.join(",")],
    ["governmentCourseOverviewDescription", String(patch.governmentCourseOverviewDescription || DEFAULT_COURSE_OVERVIEWS.government.description).trim() || DEFAULT_COURSE_OVERVIEWS.government.description],
    ["governmentCourseOverviewPoints", normalizedGovernmentCourseOverviewPoints.join(",")],
    ["customDomainGuidanceIntro", String(patch.customDomainGuidanceIntro || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.intro).trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.intro],
    ["customDomainGuidanceCnameLabel", String(patch.customDomainGuidanceCnameLabel || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.cnameLabel).trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.cnameLabel],
    ["customDomainGuidanceCnameText", String(patch.customDomainGuidanceCnameText || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.cnameText).trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.cnameText],
    ["customDomainGuidanceOwnershipLabel", String(patch.customDomainGuidanceOwnershipLabel || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.ownershipLabel).trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.ownershipLabel],
    ["customDomainGuidanceOwnershipText", String(patch.customDomainGuidanceOwnershipText || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.ownershipText).trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.ownershipText],
    ["customDomainGuidanceRecommendationLabel", String(patch.customDomainGuidanceRecommendationLabel || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.recommendationLabel).trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.recommendationLabel],
    ["customDomainGuidanceRecommendationText", String(patch.customDomainGuidanceRecommendationText || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.recommendationText).trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.recommendationText],
    ["customDomainGuidanceVerificationLabel", String(patch.customDomainGuidanceVerificationLabel || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.verificationLabel).trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.verificationLabel],
    ["customDomainGuidanceVerificationText", String(patch.customDomainGuidanceVerificationText || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.verificationText).trim() || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.verificationText],
  ];
  normalizedCustomRouteSlots.forEach((slot) => {
    updates.push([slot.labelKey, slot.labelValue]);
    updates.push([slot.portKey, slot.portValue]);
  });
  await withTx(async (c) => {
    for (const [key, value] of updates) {
      await c.query(`INSERT INTO platform_settings (key,value,updated_at) VALUES ($1,$2,CURRENT_TIMESTAMP::text) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=CURRENT_TIMESTAMP::text`, [key, value]);
    }
  });
  return pgGetPlatformStatus();
}
async function pgCreateInviteCode({ code, label = "", maxUses = 1, expiresAt = null, courseId = null, createdBy = null }) {
  return withTx(async (c) => {
    const id = await nextId(c, "invite_codes");
    await c.query(
      `INSERT INTO invite_codes (id,code,label,max_uses,used_count,course_id,expires_at,created_by,enabled,created_at)
       VALUES ($1,$2,$3,$4,0,$5,$6,$7,1,CURRENT_TIMESTAMP::text)`,
      [id, String(code || "").trim(), String(label || "").trim(), Math.max(1, Number(maxUses || 1)), courseId || null, expiresAt || null, createdBy || null],
    );
    return normalizeInviteCodeRow((await c.query(
      `SELECT ic.*, c.title AS "courseTitle", u.name AS "createdByName", u.username AS "createdByUsername"
       FROM invite_codes ic
       LEFT JOIN courses c ON c.id = ic.course_id
       LEFT JOIN users u ON u.id = ic.created_by
       WHERE ic.id=$1`, [id]
    )).rows[0] || null);
  });
}
async function pgFindInviteCodeById(id) {
  return normalizeInviteCodeRow((await withClient((c) => c.query(
    `SELECT ic.*, c.title AS "courseTitle", u.name AS "createdByName", u.username AS "createdByUsername"
     FROM invite_codes ic
     LEFT JOIN courses c ON c.id = ic.course_id
     LEFT JOIN users u ON u.id = ic.created_by
     WHERE ic.id=$1`, [id]
  ))).rows[0] || null);
}
async function pgListInviteCodes() {
  return (await withClient((c) => c.query(
    `SELECT ic.*, c.title AS "courseTitle", u.name AS "createdByName", u.username AS "createdByUsername"
     FROM invite_codes ic
     LEFT JOIN courses c ON c.id = ic.course_id
     LEFT JOIN users u ON u.id = ic.created_by
     ORDER BY ic.created_at DESC, ic.id DESC`
  ))).rows.map(normalizeInviteCodeRow);
}
async function pgUpdateInviteCode(id, patch) {
  const current = await pgFindInviteCodeById(id);
  if (!current) return null;
  await withClient((c) => c.query(
    `UPDATE invite_codes
     SET enabled=$2, label=$3, max_uses=$4, expires_at=$5, course_id=$6
     WHERE id=$1`,
    [
      id,
      patch.enabled == null ? Number(Boolean(current.enabled)) : Number(Boolean(patch.enabled)),
      patch.label == null ? current.label : String(patch.label || "").trim(),
      patch.maxUses == null ? current.maxUses : Math.max(1, Number(patch.maxUses || 1)),
      patch.expiresAt === undefined ? current.expiresAt : (patch.expiresAt || null),
      patch.courseId === undefined ? (current.courseId || null) : (patch.courseId || null),
    ],
  ));
  return pgFindInviteCodeById(id);
}
async function pgDeleteInviteCode(id) {
  await withClient((c) => c.query(`DELETE FROM invite_codes WHERE id=$1`, [id]));
}
function normalizeCourseTextbookAssignments(input = []) {
  return (Array.isArray(input) ? input : [])
    .map((item, index) => ({
      textbookId: Number(item?.textbookId ?? item?.id),
      sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : index,
      required: Boolean(item?.required),
      visible: item?.visible == null ? true : Boolean(item.visible),
    }))
    .filter((item, index, list) => Number.isInteger(item.textbookId) && item.textbookId > 0 && list.findIndex((candidate) => candidate.textbookId === item.textbookId) === index);
}
async function replaceCourseTextbooks(client, courseId, assignments = []) {
  await client.query(`DELETE FROM course_textbooks WHERE course_id=$1`, [Number(courseId)]);
  for (const [index, assignment] of normalizeCourseTextbookAssignments(assignments).entries()) {
    const id = await nextId(client, "course_textbooks");
    await client.query(
      `INSERT INTO course_textbooks (id,course_id,textbook_id,sort_order,required,visible,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP::text)
       ON CONFLICT (course_id,textbook_id) DO UPDATE
       SET sort_order=EXCLUDED.sort_order, required=EXCLUDED.required, visible=EXCLUDED.visible`,
      [id, Number(courseId), assignment.textbookId, Number.isFinite(Number(assignment.sortOrder)) ? Number(assignment.sortOrder) : index, assignment.required ? 1 : 0, assignment.visible ? 1 : 0],
    );
  }
}
async function attachTextbooksToCourses(courses, { publicOnly = false } = {}) {
  const list = (Array.isArray(courses) ? courses : [courses]).filter(Boolean);
  if (!list.length) return Array.isArray(courses) ? [] : null;
  const ids = list.map((course) => Number(course.id)).filter(Boolean);
  const params = [ids];
  const where = [`ct.course_id = ANY($1)`];
  if (publicOnly) where.push(`ct.visible=1`, `t.status='published'`);
  const rows = (await withClient((c) => c.query(
    `SELECT ct.course_id AS "courseId", ct.sort_order AS "sortOrder", ct.required, ct.visible,
            t.id, t.slug, t.title, t.summary, t.content_markdown AS "contentMarkdown", t.status, t.version,
            t.created_by AS "createdBy", t.created_at AS "createdAt", t.updated_at AS "updatedAt"
     FROM course_textbooks ct
     JOIN textbooks t ON t.id = ct.textbook_id
     WHERE ${where.join(" AND ")}
     ORDER BY ct.course_id ASC, ct.sort_order ASC, ct.id ASC`,
    params,
  ))).rows;
  const byCourseId = new Map();
  for (const row of rows) {
    const textbook = normalizeTextbookRow(row);
    const courseId = Number(row.courseId);
    const items = byCourseId.get(courseId) || [];
    items.push({
      ...textbook,
      textbookId: textbook.id,
      sortOrder: Number(row.sortOrder || 0),
      required: Boolean(Number(row.required ?? 0)),
      visible: Boolean(Number(row.visible ?? 0)),
    });
    byCourseId.set(courseId, items);
  }
  const enriched = list.map((course) => ({ ...course, textbooks: byCourseId.get(Number(course.id)) || [] }));
  return Array.isArray(courses) ? enriched : enriched[0];
}
async function pgListCourses() {
  const courses = (await withClient((c) => c.query(
    `${COURSE_SELECT}
     FROM courses c
     WHERE COALESCE(NULLIF(c.course_status, ''), 'published') <> 'deleted'
     ORDER BY c.id ASC`,
  ))).rows.map(normalizeCourseRow);
  return attachTextbooksToCourses(courses);
}
async function pgCreateCourse(input) {
  const values = serializeCourseInput(input);
  const id = await withTx(async (c) => {
    const id = await nextId(c, "courses");
    await c.query(
      `INSERT INTO courses (
          id, slug, category, course_type, program_type, title, summary, price, duration, level, body, youtube_url, online_meeting_url, online_board_url, online_course_notice, online_session_note, lab_guide_markdown, commands_markdown, ai_system_prompt, objectives_json, materials_json, course_curriculum_json, course_videos_json, course_recordings_json, example_files_json, git_repositories_json, external_tool_links_json, lab_start_checklist_json, survey_config_json,
          lab_enabled, lab_approval_mode, public_domain_approval_mode, external_ssh_approval_mode, external_ssh_route_mode, lab_backend_type, container_image_name, container_command_text, container_exposed_port, container_access_mode, container_console_mode, lab_retention_mode, lab_retention_preset, lab_retention_days, allow_resume_existing_lab, lab_resize_policy, lab_resize_allowed_flavors,
          traffic_monitoring_enabled, traffic_daily_limit_gb, traffic_total_limit_gb, traffic_exceeded_action,
          heat_api_url, heat_template_name, heat_stack_prefix, heat_parameters_json,
          terminal_ssh_user, terminal_ssh_port, terminal_jump_host, terminal_jump_user, is_published, is_landing_preview, course_status, release_label, access_scope, access_code, external_rdp_approval_mode, ai_quick_prompts_json, public_tcp_approval_mode, course_access_days,
          created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,
          $30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,$61,$62,
          $63,$64,$65,$66,
          $67,$68,
          CURRENT_TIMESTAMP::text, CURRENT_TIMESTAMP::text
        )`,
        [
          id, values.slug, values.category, values.courseType, values.programType, values.title, values.summary, values.price, values.duration, values.level, values.body, values.youtubeUrl,
          values.onlineMeetingUrl, values.onlineBoardUrl, values.onlineCourseNotice, values.onlineSessionNote, values.labGuideMarkdown, values.commandsMarkdown, values.aiSystemPrompt, values.objectivesJson, values.materialsJson, values.courseCurriculumJson, values.courseVideosJson, values.courseRecordingsJson, values.exampleFilesJson, values.gitRepositoriesJson, values.externalToolLinksJson, values.labStartChecklistJson, values.surveyConfigJson, values.labEnabled, values.labApprovalMode,
          values.publicDomainApprovalMode, values.externalSshApprovalMode, values.externalSshRouteMode, values.labBackendType, values.containerImageName, values.containerCommandText, values.containerExposedPort, values.containerAccessMode, values.containerConsoleMode, values.labRetentionMode, values.labRetentionPreset, values.labRetentionDays, values.allowResumeExistingLab, values.labResizePolicy, values.labResizeAllowedFlavors,
          values.trafficMonitoringEnabled, values.trafficDailyLimitGb, values.trafficTotalLimitGb, values.trafficExceededAction, values.heatApiUrl,
          values.heatTemplateName, values.heatStackPrefix, values.heatParametersJson, values.terminalSshUser, values.terminalSshPort,
          values.terminalJumpHost, values.terminalJumpUser, values.isPublished, values.isLandingPreview, values.courseStatus, values.releaseLabel, values.accessScope, values.accessCode, values.externalRdpApprovalMode, values.aiQuickPromptsJson, values.publicTcpApprovalMode, values.courseAccessDays,
        ],
    );
    await c.query(
      `UPDATE courses SET promo_enabled=$2, promo_price=$3, promo_starts_at=$4, promo_ends_at=$5 WHERE id=$1`,
      [id, values.promoEnabled, values.promoPrice, values.promoStartsAt, values.promoEndsAt],
    );
    await c.query(`UPDATE courses SET package_items_json=$2 WHERE id=$1`, [id, values.packageItemsJson]);
    await c.query(`UPDATE courses SET external_learning_tools_json=$2 WHERE id=$1`, [id, values.externalLearningToolsJson]);
    await c.query(`UPDATE courses SET terminal_replay_mode=$2 WHERE id=$1`, [id, values.terminalReplayMode]);
    await replaceCourseTextbooks(c, id, input.textbookAssignments || []);
    return id;
  });
  return pgFindCourseById(id);
}
async function pgUpdateCourse(id, input) {
  const values = serializeCourseInput(input);
  await withTx(async (c) => {
    await c.query(
      `UPDATE courses
       SET slug=$2, category=$3, course_type=$4, program_type=$5, title=$6, summary=$7, price=$8, duration=$9, level=$10, body=$11, youtube_url=$12,
           online_meeting_url=$13, online_board_url=$14, online_course_notice=$15, online_session_note=$16, lab_guide_markdown=$17, commands_markdown=$18, ai_system_prompt=$19, objectives_json=$20, materials_json=$21, course_curriculum_json=$22, course_videos_json=$23, course_recordings_json=$24, example_files_json=$25, git_repositories_json=$26, external_tool_links_json=$27, lab_start_checklist_json=$28, survey_config_json=$29, lab_enabled=$30, lab_approval_mode=$31, public_domain_approval_mode=$32,
           external_ssh_approval_mode=$33, external_ssh_route_mode=$34, lab_backend_type=$35, container_image_name=$36, container_command_text=$37, container_exposed_port=$38, container_access_mode=$39, container_console_mode=$40, lab_retention_mode=$41, lab_retention_preset=$42, lab_retention_days=$43, allow_resume_existing_lab=$44, lab_resize_policy=$45, lab_resize_allowed_flavors=$46,
           traffic_monitoring_enabled=$47, traffic_daily_limit_gb=$48, traffic_total_limit_gb=$49, traffic_exceeded_action=$50,
           heat_api_url=$51, heat_template_name=$52, heat_stack_prefix=$53, heat_parameters_json=$54,
           terminal_ssh_user=$55, terminal_ssh_port=$56, terminal_jump_host=$57, terminal_jump_user=$58,
           is_published=$59, is_landing_preview=$60, course_status=$61, release_label=$62, access_scope=$63, access_code=$64, external_rdp_approval_mode=$65, ai_quick_prompts_json=$66, terminal_replay_mode=$67, public_tcp_approval_mode=$68, course_access_days=$69, updated_at=CURRENT_TIMESTAMP::text
       WHERE id=$1`,
      [
        id, values.slug, values.category, values.courseType, values.programType, values.title, values.summary, values.price, values.duration, values.level, values.body, values.youtubeUrl,
        values.onlineMeetingUrl, values.onlineBoardUrl, values.onlineCourseNotice, values.onlineSessionNote, values.labGuideMarkdown, values.commandsMarkdown, values.aiSystemPrompt, values.objectivesJson, values.materialsJson, values.courseCurriculumJson, values.courseVideosJson, values.courseRecordingsJson, values.exampleFilesJson, values.gitRepositoriesJson, values.externalToolLinksJson, values.labStartChecklistJson, values.surveyConfigJson, values.labEnabled, values.labApprovalMode,
        values.publicDomainApprovalMode, values.externalSshApprovalMode, values.externalSshRouteMode, values.labBackendType, values.containerImageName, values.containerCommandText, values.containerExposedPort, values.containerAccessMode, values.containerConsoleMode, values.labRetentionMode, values.labRetentionPreset, values.labRetentionDays, values.allowResumeExistingLab, values.labResizePolicy, values.labResizeAllowedFlavors,
        values.trafficMonitoringEnabled, values.trafficDailyLimitGb, values.trafficTotalLimitGb, values.trafficExceededAction, values.heatApiUrl,
        values.heatTemplateName, values.heatStackPrefix, values.heatParametersJson, values.terminalSshUser, values.terminalSshPort,
        values.terminalJumpHost, values.terminalJumpUser, values.isPublished, values.isLandingPreview, values.courseStatus, values.releaseLabel, values.accessScope, values.accessCode, values.externalRdpApprovalMode, values.aiQuickPromptsJson, values.terminalReplayMode, values.publicTcpApprovalMode, values.courseAccessDays,
      ],
    );
    await c.query(
      `UPDATE courses SET promo_enabled=$2, promo_price=$3, promo_starts_at=$4, promo_ends_at=$5 WHERE id=$1`,
      [id, values.promoEnabled, values.promoPrice, values.promoStartsAt, values.promoEndsAt],
    );
    await c.query(`UPDATE courses SET package_items_json=$2 WHERE id=$1`, [id, values.packageItemsJson]);
    await c.query(`UPDATE courses SET external_learning_tools_json=$2 WHERE id=$1`, [id, values.externalLearningToolsJson]);
    if (Array.isArray(input.textbookAssignments)) {
      await replaceCourseTextbooks(c, id, input.textbookAssignments);
    }
  });
  return pgFindCourseById(id);
}
async function pgDeleteCourse(id) {
  await withTx(async (c) => {
    const deletedSlugSuffix = `-deleted-${id}`;
    const packageRows = (await c.query(`SELECT id, package_items_json AS "packageItemsJson" FROM courses WHERE course_type='package'`)).rows;
    for (const packageRow of packageRows) {
      const nextItems = safeJsonParse(packageRow.packageItemsJson || "[]", []).map(Number).filter((itemId) => Number(itemId) !== Number(id));
      await c.query(
        `UPDATE courses
         SET package_items_json=$2,
             is_published=CASE WHEN $3=0 THEN 0 ELSE is_published END,
             access_scope=CASE WHEN $3=0 THEN 'private' ELSE access_scope END,
             updated_at=CURRENT_TIMESTAMP::text
         WHERE id=$1`,
        [packageRow.id, JSON.stringify(nextItems), nextItems.length],
      );
    }
    await c.query(`DELETE FROM course_access_requests WHERE course_id=$1`, [id]);
    await c.query(`DELETE FROM user_course_access WHERE course_id=$1`, [id]);
    await c.query(`UPDATE invite_codes SET enabled=0, code=code || $2 WHERE course_id=$1 AND code NOT LIKE '%' || $2`, [id, deletedSlugSuffix]);
    await c.query(
      `UPDATE courses
       SET course_status='deleted',
           is_published=0,
           is_landing_preview=0,
           access_scope='private',
           access_code='',
           slug=CASE WHEN slug LIKE '%' || $2 THEN slug ELSE slug || $2 END,
           updated_at=CURRENT_TIMESTAMP::text
       WHERE id=$1`,
      [id, deletedSlugSuffix],
    );
  });
}
async function pgListTextbooks() {
  const rows = (await withClient((c) => c.query(
    `SELECT t.id, t.slug, t.title, t.summary, t.content_markdown AS "contentMarkdown", t.status, t.version,
            t.created_by AS "createdBy", t.created_at AS "createdAt", t.updated_at AS "updatedAt",
            COUNT(ct.id) AS "courseCount"
     FROM textbooks t
     LEFT JOIN course_textbooks ct ON ct.textbook_id = t.id
     GROUP BY t.id
     ORDER BY t.updated_at DESC, t.id DESC`,
  ))).rows;
  return rows.map(normalizeTextbookRow);
}
async function pgCreateTextbook(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "textbooks");
    await c.query(
      `INSERT INTO textbooks (id,slug,title,summary,content_markdown,status,version,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text)`,
      [
        id,
        String(input.slug || "").trim(),
        String(input.title || "").trim(),
        String(input.summary || "").trim(),
        String(input.contentMarkdown || ""),
        String(input.status || "draft").trim(),
        String(input.version || "1.0").trim() || "1.0",
        input.createdBy || null,
      ],
    );
    return normalizeTextbookRow((await c.query(
      `SELECT id, slug, title, summary, content_markdown AS "contentMarkdown", status, version, created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", 0 AS "courseCount"
       FROM textbooks WHERE id=$1`,
      [id],
    )).rows[0] || null);
  });
}
async function pgUpdateTextbook(id, input) {
  await withClient((c) => c.query(
    `UPDATE textbooks
     SET slug=$2, title=$3, summary=$4, content_markdown=$5, status=$6, version=$7, updated_at=CURRENT_TIMESTAMP::text
     WHERE id=$1`,
    [
      Number(id),
      String(input.slug || "").trim(),
      String(input.title || "").trim(),
      String(input.summary || "").trim(),
      String(input.contentMarkdown || ""),
      String(input.status || "draft").trim(),
      String(input.version || "1.0").trim() || "1.0",
    ],
  ));
  return (await pgListTextbooks()).find((item) => Number(item.id) === Number(id)) || null;
}
async function pgDeleteTextbook(id) {
  await withTx(async (c) => {
    await c.query(`DELETE FROM course_textbooks WHERE textbook_id=$1`, [Number(id)]);
    await c.query(`DELETE FROM textbooks WHERE id=$1`, [Number(id)]);
  });
}
function normalizeScheduleInput(input = {}) {
  const recurrence = input.recurrence && typeof input.recurrence === "object" && !Array.isArray(input.recurrence)
    ? input.recurrence
    : {};
  const frequency = ["none", "daily", "weekly", "monthly"].includes(String(recurrence.frequency || "none").trim())
    ? String(recurrence.frequency || "none").trim()
    : "none";
  const weekdays = Array.isArray(recurrence.weekdays)
    ? recurrence.weekdays.map((day) => Math.max(0, Math.min(6, Number(day)))).filter((day, index, list) => Number.isInteger(day) && list.indexOf(day) === index)
    : [];
  return {
    title: String(input.title || "").trim(),
    summary: String(input.summary || "").trim(),
    memo: String(input.memo || "").trim(),
    location: String(input.location || "").trim(),
    instructorName: String(input.instructorName || "").trim(),
    capacity: Number(input.capacity || 0) > 0 ? Number(input.capacity) : null,
    applyUrl: String(input.applyUrl || "").trim(),
    applyMethod: String(input.applyMethod || "").trim(),
    startAt: String(input.startAt || "").trim(),
    endAt: String(input.endAt || "").trim(),
    timezone: String(input.timezone || "Asia/Seoul").trim() || "Asia/Seoul",
    visibility: ["public", "member", "admin"].includes(String(input.visibility || "public").trim()) ? String(input.visibility || "public").trim() : "public",
    status: ["scheduled", "recruiting", "closed", "ended", "cancelled"].includes(String(input.status || "scheduled").trim()) ? String(input.status || "scheduled").trim() : "scheduled",
    showOnLanding: Boolean(input.showOnLanding),
    promotionEnabled: Boolean(input.promotionEnabled),
    promotionTitle: String(input.promotionTitle || "").trim(),
    promotionMessage: String(input.promotionMessage || "").trim(),
    promotionPriority: Math.max(0, Math.min(100, Number(input.promotionPriority || 0) || 0)),
    badgeLabel: String(input.badgeLabel || "").trim(),
    iconKey: ["video", "terminal", "calendar", "check", "rocket", "cloud"].includes(String(input.iconKey || "video").trim()) ? String(input.iconKey || "video").trim() : "video",
    courseId: Number(input.courseId || 0) > 0 ? Number(input.courseId) : null,
    recurrenceExceptions: Array.isArray(input.recurrenceExceptions) ? input.recurrenceExceptions.map((item) => String(item || "").trim()).filter(Boolean) : [],
    recurrence: {
      frequency,
      interval: Math.max(1, Number(recurrence.interval || 1) || 1),
      weekdays,
      until: String(recurrence.until || "").trim(),
      count: recurrence.count ? Math.max(1, Math.min(200, Number(recurrence.count) || 1)) : null,
    },
  };
}
function addScheduleInterval(date, frequency, interval) {
  const next = new Date(date.getTime());
  if (frequency === "daily") next.setUTCDate(next.getUTCDate() + interval);
  if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + (interval * 7));
  if (frequency === "monthly") next.setUTCMonth(next.getUTCMonth() + interval);
  return next;
}
function expandScheduleEvent(event, { from, to, limit = 300 } = {}) {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return [];
  const rangeFrom = from ? new Date(from) : new Date(start.getTime() - 86400000);
  const rangeTo = to ? new Date(to) : new Date(start.getTime() + 120 * 86400000);
  const duration = end.getTime() - start.getTime();
  const recurrence = event.recurrence || {};
  const frequency = String(recurrence.frequency || "none");
  const interval = Math.max(1, Number(recurrence.interval || 1) || 1);
  const until = recurrence.until ? new Date(recurrence.until) : null;
  const hasCountLimit = recurrence.count != null && recurrence.count !== "";
  const maxCount = hasCountLimit ? Math.max(1, Math.min(200, Number(recurrence.count) || 1)) : Number.POSITIVE_INFINITY;
  const excludedDates = new Set((event.recurrenceExceptions || []).map((value) => String(value || "").slice(0, 10)).filter(Boolean));
  const isExcluded = (date) => excludedDates.has(date.toISOString().slice(0, 10));
  const occurrences = [];
  if (frequency === "weekly" && Array.isArray(recurrence.weekdays) && recurrence.weekdays.length) {
    let cursorDay = new Date(start);
    let generatedMatches = 0;
    while (occurrences.length < limit && generatedMatches < maxCount && cursorDay <= rangeTo) {
      const weekOffset = Math.floor((cursorDay.getTime() - start.getTime()) / (7 * 86400000));
      const isScheduledWeek = weekOffset >= 0 && weekOffset % interval === 0;
      if (isScheduledWeek && recurrence.weekdays.includes(cursorDay.getUTCDay()) && (!until || cursorDay <= until) && !isExcluded(cursorDay)) {
        const occurrenceStart = new Date(cursorDay);
        occurrenceStart.setUTCHours(start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds());
        const occurrenceEnd = new Date(occurrenceStart.getTime() + duration);
        generatedMatches += 1;
        if (occurrenceEnd >= rangeFrom && occurrenceStart <= rangeTo) {
          occurrences.push({
            ...event,
            occurrenceId: `${event.id}:${occurrenceStart.toISOString()}`,
            originalStartAt: event.startAt,
            originalEndAt: event.endAt,
            startAt: occurrenceStart.toISOString(),
            endAt: occurrenceEnd.toISOString(),
            isRecurring: true,
          });
        }
      }
      cursorDay.setUTCDate(cursorDay.getUTCDate() + 1);
      if (until && cursorDay > until) break;
    }
    return occurrences;
  }
  let cursor = new Date(start);
  let generated = 0;
  while (occurrences.length < limit && generated < maxCount && cursor <= rangeTo) {
    const occurrenceEnd = new Date(cursor.getTime() + duration);
    const weekdayAllowed = frequency !== "weekly" || !recurrence.weekdays?.length || recurrence.weekdays.includes(cursor.getUTCDay());
    if (weekdayAllowed && occurrenceEnd >= rangeFrom && cursor <= rangeTo && (!until || cursor <= until) && !isExcluded(cursor)) {
      occurrences.push({
        ...event,
        occurrenceId: `${event.id}:${cursor.toISOString()}`,
        originalStartAt: event.startAt,
        originalEndAt: event.endAt,
        startAt: cursor.toISOString(),
        endAt: occurrenceEnd.toISOString(),
        isRecurring: frequency !== "none",
      });
    }
    if (frequency === "none") break;
    cursor = addScheduleInterval(cursor, frequency, interval);
    generated += 1;
    if (until && cursor > until) break;
  }
  return occurrences;
}
async function pgListScheduleEvents({ audience = "member", from = "", to = "", courseId = null, limit = 300, landingOnly = false, status = "", government = "", courseType = "", search = "" } = {}) {
  const params = [];
  const where = [];
  if (audience === "public") where.push(`se.visibility='public'`);
  else if (audience === "member") where.push(`se.visibility IN ('public','member')`);
  if (landingOnly) where.push(`(se.show_on_landing=1 OR se.promotion_enabled=1)`);
  if (courseId) {
    params.push(Number(courseId));
    where.push(`se.course_id=$${params.length}`);
  }
  if (status) {
    params.push(String(status));
    where.push(`se.status=$${params.length}`);
  }
  if (courseType === "online") where.push(`co.course_type='online'`);
  if (courseType === "standard") where.push(`(co.course_type IS NULL OR co.course_type='standard')`);
  if (courseType === "exam") where.push(`co.course_type='exam'`);
  if (government === "true") where.push(`(replace(co.program_type, ' ', '') LIKE '%정부%' OR replace(co.program_type, ' ', '') LIKE '%국비%')`);
  if (government === "false") where.push(`(co.program_type IS NULL OR NOT (replace(co.program_type, ' ', '') LIKE '%정부%' OR replace(co.program_type, ' ', '') LIKE '%국비%'))`);
  if (search) {
    params.push(`%${String(search).trim()}%`);
    where.push(`(se.title ILIKE $${params.length} OR se.summary ILIKE $${params.length} OR se.location ILIKE $${params.length} OR co.title ILIKE $${params.length})`);
  }
  const result = await withClient((c) => c.query(
    `SELECT se.id, se.title, se.summary, '' AS memo, se.location, se.instructor_name AS "instructorName",
            se.capacity, se.apply_url AS "applyUrl", se.apply_method AS "applyMethod",
            se.start_at AS "startAt", se.end_at AS "endAt",
            se.timezone, se.visibility, se.status, se.show_on_landing AS "showOnLanding", se.course_id AS "courseId",
            se.promotion_enabled AS "promotionEnabled", se.promotion_title AS "promotionTitle",
            se.promotion_message AS "promotionMessage", se.promotion_priority AS "promotionPriority",
            se.badge_label AS "badgeLabel", se.icon_key AS "iconKey",
            se.recurrence_json AS "recurrenceJson", se.recurrence_exceptions_json AS "recurrenceExceptionsJson",
            se.schedule_source AS "scheduleSource", se.external_event_id AS "externalEventId", se.created_by AS "createdBy",
            se.created_at AS "createdAt", se.updated_at AS "updatedAt",
            co.title AS "courseTitle", co.slug AS "courseSlug", co.program_type AS "courseProgramType", co.course_type AS "courseType"
     FROM schedule_events se
     LEFT JOIN courses co ON co.id = se.course_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY se.start_at ASC, se.id ASC`,
    params,
  ));
  const events = result.rows.map(normalizeScheduleEventRow).filter((event) => status === "cancelled" || event.status !== "cancelled");
  return events
    .flatMap((event) => expandScheduleEvent(event, { from, to, limit }))
    .sort((left, right) => {
      const priorityDiff = Number(right.promotionPriority || 0) - Number(left.promotionPriority || 0);
      if (landingOnly && priorityDiff) return priorityDiff;
      return new Date(left.startAt).getTime() - new Date(right.startAt).getTime();
    })
    .slice(0, limit);
}
async function pgListAdminScheduleEvents() {
  const result = await withClient((c) => c.query(
    `SELECT se.id, se.title, se.summary, se.memo, se.location, se.instructor_name AS "instructorName",
            se.capacity, se.apply_url AS "applyUrl", se.apply_method AS "applyMethod",
            se.start_at AS "startAt", se.end_at AS "endAt",
            se.timezone, se.visibility, se.status, se.show_on_landing AS "showOnLanding", se.course_id AS "courseId",
            se.promotion_enabled AS "promotionEnabled", se.promotion_title AS "promotionTitle",
            se.promotion_message AS "promotionMessage", se.promotion_priority AS "promotionPriority",
            se.badge_label AS "badgeLabel", se.icon_key AS "iconKey",
            se.recurrence_json AS "recurrenceJson", se.recurrence_exceptions_json AS "recurrenceExceptionsJson",
            se.schedule_source AS "scheduleSource", se.external_event_id AS "externalEventId", se.created_by AS "createdBy",
            se.created_at AS "createdAt", se.updated_at AS "updatedAt",
            co.title AS "courseTitle", co.slug AS "courseSlug", co.program_type AS "courseProgramType", co.course_type AS "courseType"
     FROM schedule_events se
     LEFT JOIN courses co ON co.id = se.course_id
     ORDER BY se.start_at DESC, se.id DESC`,
  ));
  return result.rows.map(normalizeScheduleEventRow);
}
async function pgCreateScheduleEvent(input) {
  const values = normalizeScheduleInput(input);
  const id = await withTx(async (c) => {
    const id = await nextId(c, "schedule_events");
    await c.query(
      `INSERT INTO schedule_events (id,title,summary,memo,location,instructor_name,capacity,apply_url,apply_method,start_at,end_at,timezone,visibility,status,show_on_landing,promotion_enabled,promotion_title,promotion_message,promotion_priority,badge_label,icon_key,course_id,recurrence_json,recurrence_exceptions_json,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text)`,
      [id, values.title, values.summary, values.memo, values.location, values.instructorName, values.capacity, values.applyUrl, values.applyMethod, values.startAt, values.endAt, values.timezone, values.visibility, values.status, values.showOnLanding ? 1 : 0, values.promotionEnabled ? 1 : 0, values.promotionTitle, values.promotionMessage, values.promotionPriority, values.badgeLabel, values.iconKey, values.courseId, JSON.stringify(values.recurrence), JSON.stringify(values.recurrenceExceptions), input.createdBy || null],
    );
    return id;
  });
  return (await pgListAdminScheduleEvents()).find((event) => Number(event.id) === Number(id)) || null;
}
async function pgUpdateScheduleEvent(id, input) {
  const values = normalizeScheduleInput(input);
  await withClient((c) => c.query(
    `UPDATE schedule_events
     SET title=$2, summary=$3, memo=$4, location=$5, instructor_name=$6, capacity=$7, apply_url=$8, apply_method=$9,
         start_at=$10, end_at=$11, timezone=$12, visibility=$13, status=$14, show_on_landing=$15,
         promotion_enabled=$16, promotion_title=$17, promotion_message=$18, promotion_priority=$19, badge_label=$20, icon_key=$21,
         course_id=$22, recurrence_json=$23, recurrence_exceptions_json=$24, updated_at=CURRENT_TIMESTAMP::text
     WHERE id=$1`,
    [Number(id), values.title, values.summary, values.memo, values.location, values.instructorName, values.capacity, values.applyUrl, values.applyMethod, values.startAt, values.endAt, values.timezone, values.visibility, values.status, values.showOnLanding ? 1 : 0, values.promotionEnabled ? 1 : 0, values.promotionTitle, values.promotionMessage, values.promotionPriority, values.badgeLabel, values.iconKey, values.courseId, JSON.stringify(values.recurrence), JSON.stringify(values.recurrenceExceptions)],
  ));
  return (await pgListAdminScheduleEvents()).find((event) => Number(event.id) === Number(id)) || null;
}
async function pgDeleteScheduleEvent(id) {
  await withClient((c) => c.query(`DELETE FROM schedule_events WHERE id=$1`, [Number(id)]));
}
async function pgUpsertGoogleScheduleEvent(input, { createdBy = null } = {}) {
  const values = normalizeScheduleInput({
    ...input,
    visibility: input.visibility || "public",
    status: input.status || "scheduled",
    iconKey: input.iconKey || "calendar",
  });
  const externalEventId = String(input.externalEventId || "").trim();
  if (!externalEventId) {
    throw new Error("Google Calendar 이벤트 ID가 없습니다.");
  }
  const id = await withTx(async (c) => {
    const existing = (await c.query(
      `SELECT id FROM schedule_events WHERE schedule_source='google-calendar' AND external_event_id=$1 LIMIT 1`,
      [externalEventId],
    )).rows[0];
    if (existing?.id) {
      return Number(existing.id);
    }
    const duplicate = (await c.query(
      `SELECT id
       FROM schedule_events
       WHERE LOWER(TRIM(title))=LOWER(TRIM($1))
         AND start_at=$2
         AND end_at=$3
       ORDER BY CASE WHEN schedule_source='manual' THEN 0 ELSE 1 END, id ASC
       LIMIT 1`,
      [values.title, values.startAt, values.endAt],
    )).rows[0];
    if (duplicate?.id) {
      return Number(duplicate.id);
    }
    const id = await nextId(c, "schedule_events");
    await c.query(
      `INSERT INTO schedule_events (
        id,title,summary,memo,location,instructor_name,capacity,apply_url,apply_method,start_at,end_at,timezone,visibility,status,show_on_landing,promotion_enabled,promotion_title,promotion_message,promotion_priority,badge_label,icon_key,course_id,recurrence_json,recurrence_exceptions_json,schedule_source,external_event_id,created_by,created_at,updated_at
       ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'google-calendar',$25,$26,CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text
       )`,
      [
        id, values.title, values.summary, values.memo, values.location, values.instructorName, values.capacity,
        values.applyUrl, values.applyMethod, values.startAt, values.endAt, values.timezone, values.visibility, values.status,
        values.showOnLanding ? 1 : 0, values.promotionEnabled ? 1 : 0, values.promotionTitle, values.promotionMessage,
        values.promotionPriority, values.badgeLabel, values.iconKey, values.courseId, JSON.stringify(values.recurrence),
        JSON.stringify(values.recurrenceExceptions), externalEventId, createdBy || null,
      ],
    );
    return id;
  });
  return (await pgListAdminScheduleEvents()).find((event) => Number(event.id) === Number(id)) || null;
}
async function pgListVisibleCoursesByUser(userId) {
  const result = await withClient((c) => c.query(`${COURSE_SELECT},
CASE WHEN uca.id IS NOT NULL AND (
  NULLIF(uca.expires_at, '') IS NULL
  OR (uca.expires_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND NULLIF(uca.expires_at, '')::timestamptz > NOW())
) THEN 1 WHEN uca.id IS NULL AND c.is_published=1 AND (
  (c.access_scope='public' AND COALESCE(c.price, 0) <= 0)
  OR ${COURSE_FREE_PROMOTION_SQL}
) THEN 1 ELSE 0 END AS "hasAccess",
CASE WHEN uca.id IS NOT NULL THEN 1 ELSE 0 END AS "hasEnrollmentRecord",
uca.granted_via AS "enrollmentGrantedVia",
uca.created_at AS "enrollmentCreatedAt",
uca.expires_at AS "enrollmentExpiresAt",
(SELECT car.status FROM course_access_requests car WHERE car.user_id=$1 AND car.course_id=c.id AND car.request_type='access' ORDER BY car.id DESC LIMIT 1) AS "accessRequestStatus",
(SELECT car.review_note FROM course_access_requests car WHERE car.user_id=$1 AND car.course_id=c.id AND car.request_type='access' ORDER BY car.id DESC LIMIT 1) AS "accessRequestReviewNote",
(SELECT car.status FROM course_access_requests car WHERE car.user_id=$1 AND car.course_id=c.id AND car.request_type='revoke' ORDER BY car.id DESC LIMIT 1) AS "revokeRequestStatus",
(SELECT car.review_note FROM course_access_requests car WHERE car.user_id=$1 AND car.course_id=c.id AND car.request_type='revoke' ORDER BY car.id DESC LIMIT 1) AS "revokeRequestReviewNote"
FROM courses c LEFT JOIN user_course_access uca ON uca.course_id=c.id AND uca.user_id=$2
WHERE c.is_published=1
  AND (
    c.access_scope='public'
    OR c.access_scope='private'
    OR c.program_type LIKE '%정부%'
    OR c.program_type LIKE '%국비%'
    OR c.program_type LIKE '%지원금%'
    OR c.program_type LIKE '%내일배움%'
    OR LOWER(c.program_type) LIKE '%hrd%'
    OR LOWER(c.program_type) LIKE '%k-digital%'
    OR LOWER(c.program_type) LIKE '%kdigital%'
    OR ${COURSE_FREE_PROMOTION_SQL}
    OR uca.id IS NOT NULL
  )
ORDER BY c.id ASC`, [userId, userId]));
  return attachTextbooksToCourses(result.rows.map(normalizeCourseRow), { publicOnly: true });
}
async function pgFindCourseById(id) { return attachTextbooksToCourses(normalizeCourseRow((await withClient((c) => c.query(`${COURSE_SELECT} FROM courses c WHERE c.id=$1`, [id]))).rows[0] || null)); }
async function pgFindCourseByAccessCode(accessCode) {
  const code = String(accessCode || "").trim();
  if (!code) return null;
  return attachTextbooksToCourses(normalizeCourseRow((await withClient((c) => c.query(`${COURSE_SELECT} FROM courses c WHERE LOWER(c.access_code)=LOWER($1) LIMIT 1`, [code]))).rows[0] || null), { publicOnly: true });
}
async function pgFindAvailableInviteCode(code) {
  const normalizedCode = String(code || "").trim();
  if (!normalizedCode) return null;
  return normalizeInviteCodeRow((await withClient((c) => c.query(`SELECT ic.*, c.title AS "courseTitle" FROM invite_codes ic LEFT JOIN courses c ON c.id=ic.course_id WHERE ic.code=$1 AND ic.enabled=1 AND (ic.expires_at IS NULL OR ic.expires_at > CURRENT_TIMESTAMP::text) AND ic.used_count < ic.max_uses LIMIT 1`, [normalizedCode]))).rows[0] || null);
}
async function pgConsumeInviteCode(id) {
  await withClient((c) => c.query(`UPDATE invite_codes SET used_count=used_count+1 WHERE id=$1 AND enabled=1 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP::text) AND used_count < max_uses`, [id]));
  return normalizeInviteCodeRow((await withClient((c) => c.query(`SELECT ic.*, c.title AS "courseTitle", u.name AS "createdByName", u.username AS "createdByUsername" FROM invite_codes ic LEFT JOIN courses c ON c.id=ic.course_id LEFT JOIN users u ON u.id=ic.created_by WHERE ic.id=$1`, [id]))).rows[0] || null);
}
async function grantUserCourseAccessWithClient(c, userId, courseId, grantedVia = "code", options = {}) {
  const existing = (await c.query(
    `SELECT c.course_access_days AS "courseAccessDays", uca.id AS "accessId", uca.expires_at AS "expiresAt"
     FROM courses c
     LEFT JOIN user_course_access uca ON uca.course_id=c.id AND uca.user_id=$1
     WHERE c.id=$2
     LIMIT 1`,
    [userId, courseId],
  )).rows[0] || null;
  if (!existing) throw new Error("과정을 찾을 수 없습니다.");
  const extendExisting = options.extendExisting !== false;
  const existingExpiresAt = String(existing.expiresAt || "").trim();
  const existingExpiresMs = existingExpiresAt ? Date.parse(existingExpiresAt) : null;
  const existingAccessActive = Boolean(
    existing.accessId
    && (!existingExpiresAt || (Number.isFinite(existingExpiresMs) && existingExpiresMs > Date.now())),
  );
  if (!extendExisting && existingAccessActive) return;
  const accessDays = resolveCourseAccessDays(options.courseAccessDays ?? options.days ?? existing?.courseAccessDays);
  const expiryBase = extendExisting ? existing?.expiresAt || Date.now() : Date.now();
  const expiresAt = String(options.expiresAt || "").trim() || resolveCourseAccessExpiryIso(expiryBase, accessDays);
  const id = await nextId(c, "user_course_access");
  await c.query(
    `INSERT INTO user_course_access (id,user_id,course_id,granted_via,expires_at,created_at)
     VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP::text)
     ON CONFLICT (user_id,course_id) DO UPDATE
     SET granted_via=EXCLUDED.granted_via, expires_at=EXCLUDED.expires_at`,
    [id, userId, courseId, grantedVia, expiresAt],
  );
}
async function pgGrantUserCourseAccess(userId, courseId, grantedVia = "code", options = {}) {
  await withTx(async (c) => {
    await grantUserCourseAccessWithClient(c, userId, courseId, grantedVia, options);
  });
}
async function pgRevokeUserCourseAccess(userId, courseId) {
  await withTx(async (c) => {
    await c.query(`DELETE FROM user_course_access WHERE user_id=$1 AND course_id=$2`, [userId, courseId]);
    await c.query(
      `UPDATE exam_entitlements SET status='revoked', revoked_at=CURRENT_TIMESTAMP::text, revoke_reason='course_access_revoked'
       WHERE user_id=$1 AND exam_course_id=$2 AND status='active'`,
      [userId, courseId],
    );
  });
}
async function pgGrantCoursePackageItems({ userId, packageCourseId, sourcePaymentId = null } = {}) {
  const normalizedUserId = Number(userId || 0);
  const normalizedPackageId = Number(packageCourseId || 0);
  const normalizedPaymentId = Number(sourcePaymentId || 0) || null;
  if (!normalizedUserId || !normalizedPackageId) throw new Error("패키지 지급 대상을 확인해 주세요.");
  return withTx(async (c) => {
    const packageRow = (await c.query(
      `SELECT id, course_type AS "courseType", package_items_json AS "packageItemsJson" FROM courses WHERE id=$1 LIMIT 1`,
      [normalizedPackageId],
    )).rows[0] || null;
    if (!packageRow || packageRow.courseType !== "package") throw new Error("패키지 과정을 찾을 수 없습니다.");
    const itemIds = Array.from(new Set(safeJsonParse(packageRow.packageItemsJson || "[]", []).map(Number).filter((id) => Number.isInteger(id) && id > 0 && id !== normalizedPackageId)));
    if (!itemIds.length) throw new Error("패키지에 포함된 과정 또는 시험이 없습니다.");
    const items = (await c.query(
      `SELECT id, title, course_type AS "courseType", course_access_days AS "courseAccessDays"
       FROM courses WHERE id=ANY($1::bigint[]) AND course_type <> 'package' AND COALESCE(NULLIF(course_status, ''), 'published') <> 'deleted'`,
      [itemIds],
    )).rows;
    if (items.length !== itemIds.length) throw new Error("패키지에 삭제되었거나 중첩된 항목이 포함되어 있습니다.");
    const marker = `package:${normalizedPackageId}:${normalizedPaymentId || "grant"}`;
    const granted = [];
    for (const item of items) {
      const existing = (await c.query(
        `SELECT id, granted_via AS "grantedVia", expires_at AS "expiresAt" FROM user_course_access WHERE user_id=$1 AND course_id=$2 LIMIT 1`,
        [normalizedUserId, item.id],
      )).rows[0] || null;
      const expiresMs = existing?.expiresAt ? Date.parse(existing.expiresAt) : null;
      const active = Boolean(existing && (!existing.expiresAt || (Number.isFinite(expiresMs) && expiresMs > Date.now())));
      if (!active) await grantUserCourseAccessWithClient(c, normalizedUserId, Number(item.id), marker, { extendExisting: false });
      const previousGrant = (await c.query(
        `SELECT id FROM course_package_grants
         WHERE user_id=$1 AND package_course_id=$2 AND item_course_id=$3
           AND source_payment_id IS NOT DISTINCT FROM $4 AND status='active' LIMIT 1`,
        [normalizedUserId, normalizedPackageId, item.id, normalizedPaymentId],
      )).rows[0] || null;
      if (!previousGrant) {
        await c.query(
          `INSERT INTO course_package_grants (id,user_id,package_course_id,item_course_id,source_payment_id,access_created,status,granted_at)
           VALUES ($1,$2,$3,$4,$5,$6,'active',CURRENT_TIMESTAMP::text)`,
          [randomUUID(), normalizedUserId, normalizedPackageId, item.id, normalizedPaymentId, Number(!active)],
        );
      }
      granted.push({ id: Number(item.id), title: item.title, courseType: item.courseType, accessCreated: !active });
    }
    return granted;
  });
}
async function pgRevokeCoursePackageByPayment(paymentId) {
  const normalizedPaymentId = Number(paymentId || 0);
  if (!normalizedPaymentId) return [];
  return withTx(async (c) => {
    const payment = (await c.query(`SELECT user_id AS "userId", course_id AS "courseId" FROM payments WHERE id=$1`, [normalizedPaymentId])).rows[0] || null;
    if (!payment) return [];
    const marker = `package:${Number(payment.courseId)}:${normalizedPaymentId}`;
    const grants = (await c.query(
      `SELECT id, item_course_id AS "itemCourseId", access_created AS "accessCreated"
       FROM course_package_grants WHERE source_payment_id=$1 AND status='active'`,
      [normalizedPaymentId],
    )).rows;
    for (const grant of grants) {
      if (Boolean(Number(grant.accessCreated))) {
        await c.query(`DELETE FROM user_course_access WHERE user_id=$1 AND course_id=$2 AND granted_via=$3`, [payment.userId, grant.itemCourseId, marker]);
      }
    }
    await c.query(`DELETE FROM user_course_access WHERE user_id=$1 AND course_id=$2 AND granted_via=$3`, [payment.userId, payment.courseId, marker]);
    await c.query(`UPDATE course_package_grants SET status='revoked', revoked_at=CURRENT_TIMESTAMP::text WHERE source_payment_id=$1 AND status='active'`, [normalizedPaymentId]);
    return grants.map((grant) => Number(grant.itemCourseId));
  });
}
async function pgRevokeCoursePackageItemsByUser(userId, packageCourseId) {
  const normalizedUserId = Number(userId || 0);
  const normalizedPackageId = Number(packageCourseId || 0);
  if (!normalizedUserId || !normalizedPackageId) return [];
  return withTx(async (c) => {
    const grants = (await c.query(
      `SELECT id, item_course_id AS "itemCourseId", source_payment_id AS "sourcePaymentId", access_created AS "accessCreated"
       FROM course_package_grants WHERE user_id=$1 AND package_course_id=$2 AND status='active'`,
      [normalizedUserId, normalizedPackageId],
    )).rows;
    for (const grant of grants) {
      if (!Boolean(Number(grant.accessCreated))) continue;
      const marker = `package:${normalizedPackageId}:${Number(grant.sourcePaymentId || 0) || "grant"}`;
      await c.query(`DELETE FROM user_course_access WHERE user_id=$1 AND course_id=$2 AND granted_via=$3`, [normalizedUserId, grant.itemCourseId, marker]);
    }
    await c.query(
      `UPDATE exam_entitlements SET status='revoked', revoked_at=CURRENT_TIMESTAMP::text, revoke_reason='package_access_revoked'
       WHERE user_id=$1 AND required_course_id=$2 AND status='active'`,
      [normalizedUserId, normalizedPackageId],
    );
    await c.query(
      `UPDATE course_package_grants SET status='revoked', revoked_at=CURRENT_TIMESTAMP::text
       WHERE user_id=$1 AND package_course_id=$2 AND status='active'`,
      [normalizedUserId, normalizedPackageId],
    );
    return grants.map((grant) => Number(grant.itemCourseId));
  });
}
async function pgFindCourseAccessRequestById(id) {
  return normalizeCourseAccessRequestRow((await withClient((c) => c.query(
    `SELECT car.id, car.user_id AS "userId", car.course_id AS "courseId", car.status, car.request_type AS "requestType", car.request_note AS "requestNote",
            car.created_at AS "createdAt", car.reviewed_at AS "reviewedAt", car.reviewed_by AS "reviewedBy", car.review_note AS "reviewNote",
            u.name AS "userName", u.username, c.title AS "courseTitle", c.price AS "coursePrice", c.slug AS "courseSlug",
            uca.expires_at AS "enrollmentExpiresAt"
     FROM course_access_requests car
     JOIN users u ON u.id = car.user_id
     JOIN courses c ON c.id = car.course_id
     LEFT JOIN user_course_access uca ON uca.user_id = car.user_id AND uca.course_id = car.course_id
     WHERE car.id = $1`,
    [id],
  ))).rows[0] || null);
}
async function pgListCourseAccessRequests() {
  return (await withClient((c) => c.query(
    `SELECT car.id, car.user_id AS "userId", car.course_id AS "courseId", car.status, car.request_type AS "requestType", car.request_note AS "requestNote",
            car.created_at AS "createdAt", car.reviewed_at AS "reviewedAt", car.reviewed_by AS "reviewedBy", car.review_note AS "reviewNote",
            u.name AS "userName", u.username, c.title AS "courseTitle", c.price AS "coursePrice", c.slug AS "courseSlug",
            uca.expires_at AS "enrollmentExpiresAt"
     FROM course_access_requests car
     JOIN users u ON u.id = car.user_id
     JOIN courses c ON c.id = car.course_id
     LEFT JOIN user_course_access uca ON uca.user_id = car.user_id AND uca.course_id = car.course_id
     ORDER BY car.created_at DESC, car.id DESC`
  ))).rows.map(normalizeCourseAccessRequestRow);
}
async function pgUpdateCourseAccessRequestStatus(id, { status, reviewedBy, reviewNote = "" }) {
  await withClient((c) => c.query(
    `UPDATE course_access_requests
     SET status=$2, reviewed_at=CURRENT_TIMESTAMP::text, reviewed_by=$3, review_note=$4
     WHERE id=$1`,
    [id, status, reviewedBy, String(reviewNote || "").trim()],
  ));
  return pgFindCourseAccessRequestById(id);
}
async function pgUserHasCourseAccess(userId, courseId) {
  const result = await withClient((c) => c.query(
    `SELECT 1 FROM user_course_access
     WHERE user_id=$1 AND course_id=$2
       AND (
         NULLIF(expires_at, '') IS NULL
         OR (expires_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND NULLIF(expires_at, '')::timestamptz > NOW())
       )
     LIMIT 1`,
    [userId, courseId],
  ));
  return Boolean(result.rows[0]);
}
async function pgCreateCourseAccessRequest(userId, courseId, { requestType = "access", requestNote = "" } = {}) {
  return withTx(async (c) => {
    const rawRequestType = String(requestType || "access").trim().toLowerCase();
    const normalizedRequestType = ["revoke", "interest", "extend"].includes(rawRequestType) ? rawRequestType : "access";
    const normalizedRequestNote = String(requestNote || "").trim();
    const latest = normalizeCourseAccessRequestRow((await c.query(
      `SELECT car.id, car.user_id AS "userId", car.course_id AS "courseId", car.status, car.request_type AS "requestType", car.request_note AS "requestNote",
              car.created_at AS "createdAt", car.reviewed_at AS "reviewedAt", car.reviewed_by AS "reviewedBy", car.review_note AS "reviewNote",
              u.name AS "userName", u.username, c2.title AS "courseTitle", c2.price AS "coursePrice", c2.slug AS "courseSlug",
              uca.expires_at AS "enrollmentExpiresAt"
       FROM course_access_requests car
       JOIN users u ON u.id = car.user_id
       JOIN courses c2 ON c2.id = car.course_id
       LEFT JOIN user_course_access uca ON uca.user_id = car.user_id AND uca.course_id = car.course_id
       WHERE car.user_id=$1 AND car.course_id=$2 AND car.request_type=$3
       ORDER BY car.id DESC LIMIT 1`,
      [userId, courseId, normalizedRequestType],
    )).rows[0] || null);
    if (latest && latest.status === "requested") return latest;
    const id = await nextId(c, "course_access_requests");
    await c.query(
      `INSERT INTO course_access_requests (id,user_id,course_id,status,request_type,request_note,created_at,review_note)
       VALUES ($1,$2,$3,'requested',$4,$5,CURRENT_TIMESTAMP::text,'')`,
      [id, userId, courseId, normalizedRequestType, normalizedRequestNote],
    );
    return (await c.query(
      `SELECT car.id,car.user_id AS "userId",car.course_id AS "courseId",car.status,car.request_type AS "requestType",car.request_note AS "requestNote",
              car.created_at AS "createdAt",car.reviewed_at AS "reviewedAt",car.reviewed_by AS "reviewedBy",car.review_note AS "reviewNote",
              u.name AS "userName",u.username,c.title AS "courseTitle",c.price AS "coursePrice",c.slug AS "courseSlug",
              uca.expires_at AS "enrollmentExpiresAt"
       FROM course_access_requests car
       JOIN users u ON u.id=car.user_id
       JOIN courses c ON c.id=car.course_id
       LEFT JOIN user_course_access uca ON uca.user_id=car.user_id AND uca.course_id=car.course_id
       WHERE car.id=$1`,
      [id],
    )).rows[0] || null;
  });
}
async function pgCreatePayment(input) {
  return withTx(async (c) => {
    const requestedProvider = String(input.provider || "manual").trim().toLowerCase() || "manual";
    const requestedAmount = Math.max(0, Number(input.amount || 0));
    const requestedCurrency = String(input.currency || "KRW").trim().toUpperCase() || "KRW";
    const requestedCouponCode = String(input.metadata?.couponCode || "").trim().toUpperCase();
    const existing = normalizePaymentRow((await c.query(
      `SELECT p.id, p.user_id AS "userId", p.course_id AS "courseId", p.provider, p.order_id AS "orderId",
              p.payment_key AS "paymentKey", p.provider_order_id AS "providerOrderId",
              p.amount, p.currency, p.status, p.failure_reason AS "failureReason",
              p.metadata_json AS "metadataJson", p.requested_at AS "requestedAt", p.ready_at AS "readyAt",
              p.paid_at AS "paidAt", p.failed_at AS "failedAt", p.cancelled_at AS "cancelledAt",
              p.reviewed_by AS "reviewedBy", u.name AS "userName", u.username,
              c2.title AS "courseTitle", c2.slug AS "courseSlug"
       FROM payments p
       JOIN users u ON u.id=p.user_id
       JOIN courses c2 ON c2.id=p.course_id
       WHERE p.user_id=$1 AND p.course_id=$2 AND p.status IN ('pending','ready')
       ORDER BY p.id DESC LIMIT 1`,
      [input.userId, input.courseId],
    )).rows[0] || null);
    if (
      existing
      && String(existing.provider || "manual").trim().toLowerCase() === requestedProvider
      && Math.max(0, Number(existing.amount || 0)) === requestedAmount
      && (String(existing.currency || "KRW").trim().toUpperCase() || "KRW") === requestedCurrency
      && String(existing.metadata?.couponCode || "").trim().toUpperCase() === requestedCouponCode
    ) return existing;
    const id = await nextId(c, "payments");
    await c.query(
      `INSERT INTO payments (
         id,user_id,course_id,provider,order_id,payment_key,provider_order_id,
         amount,currency,status,failure_reason,metadata_json,
         requested_at,ready_at,paid_at,failed_at,cancelled_at,reviewed_by
       )
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,
         $8,$9,$10,$11,$12,
         COALESCE($13,CURRENT_TIMESTAMP::text),$14,$15,$16,$17,$18
       )`,
      [
        id, input.userId, input.courseId, requestedProvider, input.orderId,
        input.paymentKey || null, input.providerOrderId || "",
        requestedAmount, requestedCurrency, input.status || "ready",
        input.failureReason || "", JSON.stringify(input.metadata || {}),
        input.requestedAt || null, input.readyAt || null, input.paidAt || null, input.failedAt || null, input.cancelledAt || null, input.reviewedBy || null,
      ],
    );
    return pgFindPaymentById(id);
  });
}
async function pgFindPaymentById(id) {
  return normalizePaymentRow((await withClient((c) => c.query(
    `SELECT p.id, p.user_id AS "userId", p.course_id AS "courseId", p.provider, p.order_id AS "orderId",
            p.payment_key AS "paymentKey", p.provider_order_id AS "providerOrderId",
            p.amount, p.currency, p.status, p.failure_reason AS "failureReason",
            p.metadata_json AS "metadataJson", p.requested_at AS "requestedAt", p.ready_at AS "readyAt",
            p.paid_at AS "paidAt", p.failed_at AS "failedAt", p.cancelled_at AS "cancelledAt",
            p.reviewed_by AS "reviewedBy", u.name AS "userName", u.username,
            c2.title AS "courseTitle", c2.slug AS "courseSlug"
     FROM payments p
     JOIN users u ON u.id=p.user_id
     JOIN courses c2 ON c2.id=p.course_id
     WHERE p.id=$1`,
    [id],
  ))).rows[0] || null);
}
async function pgFindPaymentByOrderId(orderId) {
  return normalizePaymentRow((await withClient((c) => c.query(
    `SELECT p.id, p.user_id AS "userId", p.course_id AS "courseId", p.provider, p.order_id AS "orderId",
            p.payment_key AS "paymentKey", p.provider_order_id AS "providerOrderId",
            p.amount, p.currency, p.status, p.failure_reason AS "failureReason",
            p.metadata_json AS "metadataJson", p.requested_at AS "requestedAt", p.ready_at AS "readyAt",
            p.paid_at AS "paidAt", p.failed_at AS "failedAt", p.cancelled_at AS "cancelledAt",
            p.reviewed_by AS "reviewedBy", u.name AS "userName", u.username,
            c2.title AS "courseTitle", c2.slug AS "courseSlug"
     FROM payments p
     JOIN users u ON u.id=p.user_id
     JOIN courses c2 ON c2.id=p.course_id
     WHERE p.order_id=$1`,
    [orderId],
  ))).rows[0] || null);
}
async function pgListPayments() {
  return (await withClient((c) => c.query(
    `SELECT p.id, p.user_id AS "userId", p.course_id AS "courseId", p.provider, p.order_id AS "orderId",
            p.payment_key AS "paymentKey", p.provider_order_id AS "providerOrderId",
            p.amount, p.currency, p.status, p.failure_reason AS "failureReason",
            p.metadata_json AS "metadataJson", p.requested_at AS "requestedAt", p.ready_at AS "readyAt",
            p.paid_at AS "paidAt", p.failed_at AS "failedAt", p.cancelled_at AS "cancelledAt",
            p.reviewed_by AS "reviewedBy", u.name AS "userName", u.username,
            c2.title AS "courseTitle", c2.slug AS "courseSlug"
     FROM payments p
     JOIN users u ON u.id=p.user_id
     JOIN courses c2 ON c2.id=p.course_id
     ORDER BY p.requested_at DESC, p.id DESC`
  ))).rows.map(normalizePaymentRow);
}
async function pgListPaymentsByUser(userId) {
  return (await withClient((c) => c.query(
    `SELECT p.id, p.user_id AS "userId", p.course_id AS "courseId", p.provider, p.order_id AS "orderId",
            p.payment_key AS "paymentKey", p.provider_order_id AS "providerOrderId",
            p.amount, p.currency, p.status, p.failure_reason AS "failureReason",
            p.metadata_json AS "metadataJson", p.requested_at AS "requestedAt", p.ready_at AS "readyAt",
            p.paid_at AS "paidAt", p.failed_at AS "failedAt", p.cancelled_at AS "cancelledAt",
            p.reviewed_by AS "reviewedBy", u.name AS "userName", u.username,
            c2.title AS "courseTitle", c2.slug AS "courseSlug"
     FROM payments p
     JOIN users u ON u.id=p.user_id
     JOIN courses c2 ON c2.id=p.course_id
     WHERE p.user_id=$1
     ORDER BY p.requested_at DESC, p.id DESC`,
    [userId],
  ))).rows.map(normalizePaymentRow);
}
function normalizeExamEntitlementRow(row) {
  if (!row) return null;
  const sourcePaymentId = row.sourcePaymentId ?? row.source_payment_id ?? null;
  const requiredCourseId = row.requiredCourseId ?? row.required_course_id ?? null;
  const grantedBy = row.grantedBy ?? row.granted_by ?? null;
  return {
    ...row,
    userId: Number(row.userId ?? row.user_id),
    examCourseId: Number(row.examCourseId ?? row.exam_course_id),
    sourcePaymentId: sourcePaymentId == null ? null : Number(sourcePaymentId),
    requiredCourseId: requiredCourseId == null ? null : Number(requiredCourseId),
    grantedBy: grantedBy == null ? null : Number(grantedBy),
    metadata: safeJsonParse(row.metadataJson ?? row.metadata_json, {}),
  };
}
const EXAM_ENTITLEMENT_SELECT = `
  SELECT ee.id, ee.user_id AS "userId", ee.exam_course_id AS "examCourseId", ee.source,
         ee.source_payment_id AS "sourcePaymentId", ee.required_course_id AS "requiredCourseId",
         ee.status, ee.granted_by AS "grantedBy", ee.granted_at AS "grantedAt",
         ee.expires_at AS "expiresAt", ee.revoked_at AS "revokedAt", ee.revoke_reason AS "revokeReason",
         ee.metadata_json AS "metadataJson", u.name AS "userName", u.username,
         ec.title AS "examCourseTitle", rc.title AS "requiredCourseTitle"
  FROM exam_entitlements ee
  JOIN users u ON u.id=ee.user_id
  JOIN courses ec ON ec.id=ee.exam_course_id
  LEFT JOIN courses rc ON rc.id=ee.required_course_id
`;
async function pgGrantExamEntitlement(input = {}) {
  const userId = Number(input.userId || 0);
  const examCourseId = Number(input.examCourseId || 0);
  if (!userId || !examCourseId) throw new Error("응시권 사용자와 시험 과정을 확인해 주세요.");
  const source = String(input.source || "admin").trim().toLowerCase() || "admin";
  const sourcePaymentId = Number(input.sourcePaymentId || 0) || null;
  const requiredCourseId = Number(input.requiredCourseId || 0) || null;
  return withTx(async (c) => {
    const existing = (await c.query(
      `SELECT id FROM exam_entitlements
       WHERE user_id=$1 AND exam_course_id=$2 AND status='active'
         AND (($3::bigint IS NOT NULL AND source_payment_id=$3) OR ($3::bigint IS NULL AND source=$4 AND COALESCE(required_course_id,0)=COALESCE($5,0)))
       ORDER BY granted_at DESC LIMIT 1`,
      [userId, examCourseId, sourcePaymentId, source, requiredCourseId],
    )).rows[0];
    if (existing?.id) {
      await c.query(
        `UPDATE exam_entitlements SET expires_at=$2, metadata_json=$3 WHERE id=$1`,
        [existing.id, input.expiresAt || null, JSON.stringify(input.metadata || {})],
      );
      return normalizeExamEntitlementRow((await c.query(`${EXAM_ENTITLEMENT_SELECT} WHERE ee.id=$1`, [existing.id])).rows[0]);
    }
    const id = randomUUID();
    await c.query(
      `INSERT INTO exam_entitlements (
        id,user_id,exam_course_id,source,source_payment_id,required_course_id,status,granted_by,granted_at,expires_at,metadata_json
      ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,CURRENT_TIMESTAMP::text,$8,$9)`,
      [id, userId, examCourseId, source, sourcePaymentId, requiredCourseId, Number(input.grantedBy || 0) || null, input.expiresAt || null, JSON.stringify(input.metadata || {})],
    );
    return normalizeExamEntitlementRow((await c.query(`${EXAM_ENTITLEMENT_SELECT} WHERE ee.id=$1`, [id])).rows[0]);
  });
}
async function pgListExamEntitlementsByUser(userId) {
  return (await withClient((c) => c.query(`${EXAM_ENTITLEMENT_SELECT} WHERE ee.user_id=$1 ORDER BY ee.granted_at DESC`, [userId]))).rows.map(normalizeExamEntitlementRow);
}
async function pgListExamEntitlements() {
  return (await withClient((c) => c.query(`${EXAM_ENTITLEMENT_SELECT} ORDER BY ee.granted_at DESC`))).rows.map(normalizeExamEntitlementRow);
}
async function pgRevokeExamEntitlement(id, patch = {}) {
  await withClient((c) => c.query(
    `UPDATE exam_entitlements SET status='revoked', revoked_at=CURRENT_TIMESTAMP::text, revoke_reason=$2 WHERE id=$1`,
    [String(id || ""), String(patch.reason || "").trim()],
  ));
  return normalizeExamEntitlementRow((await withClient((c) => c.query(`${EXAM_ENTITLEMENT_SELECT} WHERE ee.id=$1`, [String(id || "")]))).rows[0] || null);
}
async function pgRevokeExamEntitlementsByPayment(paymentId, reason = "payment_refunded") {
  const result = await withClient((c) => c.query(
    `UPDATE exam_entitlements SET status='revoked', revoked_at=CURRENT_TIMESTAMP::text, revoke_reason=$2
     WHERE source_payment_id=$1 AND status='active' RETURNING id`,
    [Number(paymentId), String(reason || "payment_refunded")],
  ));
  return result.rowCount;
}
async function pgUpdatePayment(id, patch = {}) {
  const current = await pgFindPaymentById(id);
  if (!current) return null;
  await withClient((c) => c.query(
    `UPDATE payments
     SET provider=$2, payment_key=$3, provider_order_id=$4, amount=$5, currency=$6,
         status=$7, failure_reason=$8, metadata_json=$9, ready_at=$10, paid_at=$11,
         failed_at=$12, cancelled_at=$13, reviewed_by=$14
     WHERE id=$1`,
    [
      id,
      String(patch.provider ?? current.provider ?? "manual").trim() || "manual",
      String(patch.paymentKey ?? current.paymentKey ?? "").trim() || null,
      String(patch.providerOrderId ?? current.providerOrderId ?? "").trim(),
      Math.max(0, Number(patch.amount ?? current.amount ?? 0)),
      String(patch.currency ?? current.currency ?? "KRW").trim() || "KRW",
      String(patch.status ?? current.status ?? "ready").trim() || "ready",
      String(patch.failureReason ?? current.failureReason ?? "").trim(),
      JSON.stringify(patch.metadata ?? current.metadata ?? {}),
      patch.readyAt ?? current.readyAt,
      patch.paidAt ?? current.paidAt,
      patch.failedAt ?? current.failedAt,
      patch.cancelledAt ?? current.cancelledAt,
      patch.reviewedBy ?? current.reviewedBy,
    ],
  ));
  return pgFindPaymentById(id);
}
async function pgDeletePayment(id) {
  await withClient((c) => c.query(`DELETE FROM payments WHERE id=$1`, [id]));
}
const COURSE_QUOTE_SELECT = `
SELECT q.id, q.quote_no AS "quoteNo", q.user_id AS "userId", q.status,
       q.recipient_company_name AS "recipientCompanyName",
       q.recipient_name AS "recipientName", q.recipient_email AS "recipientEmail", q.recipient_phone AS "recipientPhone",
       q.subtotal_amount AS "subtotalAmount", q.discount_rate AS "discountRate", q.discount_amount AS "discountAmount",
       q.vat_rate AS "vatRate", q.vat_amount AS "vatAmount", q.total_amount AS "totalAmount", q.currency,
       q.pricing_basis_json AS "pricingBasisJson", q.business_snapshot_json AS "businessSnapshotJson",
       q.note, q.issued_at AS "issuedAt", q.valid_until AS "validUntil", q.accepted_at AS "acceptedAt",
       q.sent_at AS "sentAt", q.sent_by AS "sentBy", q.cancelled_at AS "cancelledAt",
       q.reviewed_by AS "reviewedBy", q.updated_at AS "updatedAt",
       u.name AS "userName", u.username, u.email AS "userEmail",
       sender.name AS "sentByName", sender.username AS "sentByUsername",
       reviewer.name AS "reviewedByName", reviewer.username AS "reviewedByUsername"
FROM course_quotes q
JOIN users u ON u.id=q.user_id
LEFT JOIN users sender ON sender.id=q.sent_by
LEFT JOIN users reviewer ON reviewer.id=q.reviewed_by
`;

function normalizeCourseQuoteStatusValue(value, fallback = "issued") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return ["issued", "sent", "accepted", "cancelled", "expired"].includes(normalized) ? normalized : fallback;
}

async function attachCourseQuoteItemsWithClient(client, rows = []) {
  const quotes = (Array.isArray(rows) ? rows : [rows]).map(normalizeCourseQuoteRow).filter(Boolean);
  if (!quotes.length) return [];
  const quoteIds = quotes.map((quote) => quote.id);
  const result = await client.query(
    `SELECT id, quote_id AS "quoteId", course_id AS "courseId", course_title AS "courseTitle",
            course_slug AS "courseSlug", course_category AS "courseCategory", course_type AS "courseType",
            program_type AS "programType", duration, quantity, unit_price AS "unitPrice",
            line_subtotal AS "lineSubtotal", pricing_note AS "pricingNote", metadata_json AS "metadataJson",
            sort_order AS "sortOrder", created_at AS "createdAt"
     FROM course_quote_items
     WHERE quote_id = ANY($1::bigint[])
     ORDER BY quote_id, sort_order, id`,
    [quoteIds],
  );
  const itemsByQuoteId = new Map();
  for (const item of result.rows.map(normalizeCourseQuoteItemRow).filter(Boolean)) {
    const list = itemsByQuoteId.get(item.quoteId) || [];
    list.push(item);
    itemsByQuoteId.set(item.quoteId, list);
  }
  return quotes.map((quote) => ({ ...quote, items: itemsByQuoteId.get(quote.id) || [] }));
}

async function pgCreateCourseQuote(input) {
  return withTx(async (c) => {
    const now = new Date().toISOString();
    const id = await nextId(c, "course_quotes");
    await c.query(
      `INSERT INTO course_quotes (
         id, quote_no, user_id, status, recipient_company_name, recipient_name, recipient_email, recipient_phone,
         subtotal_amount, discount_rate, discount_amount, vat_rate, vat_amount, total_amount, currency,
         pricing_basis_json, business_snapshot_json, note, issued_at, valid_until, sent_at, sent_by,
         accepted_at, cancelled_at, reviewed_by, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [
        id,
        String(input.quoteNo || "").trim(),
        input.userId,
        normalizeCourseQuoteStatusValue(input.status),
        String(input.recipientCompanyName || "").trim(),
        String(input.recipientName || "").trim(),
        String(input.recipientEmail || "").trim(),
        String(input.recipientPhone || "").trim(),
        Math.max(0, Number(input.subtotalAmount || 0) || 0),
        Math.max(0, Number(input.discountRate || 0) || 0),
        Math.max(0, Number(input.discountAmount || 0) || 0),
        Math.max(0, Number(input.vatRate || 0) || 0),
        Math.max(0, Number(input.vatAmount || 0) || 0),
        Math.max(0, Number(input.totalAmount || 0) || 0),
        String(input.currency || "KRW").trim() || "KRW",
        JSON.stringify(input.pricingBasis || {}),
        JSON.stringify(input.businessSnapshot || {}),
        String(input.note || "").trim(),
        input.issuedAt || now,
        input.validUntil || null,
        input.sentAt || null,
        input.sentBy || null,
        input.acceptedAt || null,
        input.cancelledAt || null,
        input.reviewedBy || null,
        input.updatedAt || now,
      ],
    );
    const items = Array.isArray(input.items) ? input.items : [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index] || {};
      const itemId = await nextId(c, "course_quote_items");
      const quantity = Math.max(1, Number(item.quantity || 1) || 1);
      const unitPrice = Math.max(0, Number(item.unitPrice || 0) || 0);
      await c.query(
        `INSERT INTO course_quote_items (
           id, quote_id, course_id, course_title, course_slug, course_category, course_type, program_type,
           duration, quantity, unit_price, line_subtotal, pricing_note, metadata_json, sort_order, created_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          itemId,
          id,
          item.courseId || null,
          String(item.courseTitle || "").trim(),
          String(item.courseSlug || "").trim(),
          String(item.courseCategory || "").trim(),
          String(item.courseType || "standard").trim() || "standard",
          String(item.programType || "").trim(),
          String(item.duration || "").trim(),
          quantity,
          unitPrice,
          Math.max(0, Number(item.lineSubtotal ?? quantity * unitPrice) || 0),
          String(item.pricingNote || "").trim(),
          JSON.stringify(item.metadata || {}),
          Math.max(0, Number(item.sortOrder ?? index) || 0),
          item.createdAt || now,
        ],
      );
    }
    const rows = (await c.query(`${COURSE_QUOTE_SELECT} WHERE q.id=$1`, [id])).rows;
    return (await attachCourseQuoteItemsWithClient(c, rows))[0] || null;
  });
}

async function pgFindCourseQuoteById(id) {
  return withClient(async (c) => {
    const rows = (await c.query(`${COURSE_QUOTE_SELECT} WHERE q.id=$1`, [id])).rows;
    return (await attachCourseQuoteItemsWithClient(c, rows))[0] || null;
  });
}

async function pgFindCourseQuoteByQuoteNo(quoteNo) {
  return withClient(async (c) => {
    const rows = (await c.query(`${COURSE_QUOTE_SELECT} WHERE q.quote_no=$1`, [String(quoteNo || "").trim()])).rows;
    return (await attachCourseQuoteItemsWithClient(c, rows))[0] || null;
  });
}

async function pgListCourseQuotes() {
  return withClient(async (c) => {
    const rows = (await c.query(`${COURSE_QUOTE_SELECT} ORDER BY q.issued_at DESC, q.id DESC`)).rows;
    return attachCourseQuoteItemsWithClient(c, rows);
  });
}

async function pgListCourseQuotesByUser(userId) {
  return withClient(async (c) => {
    const rows = (await c.query(`${COURSE_QUOTE_SELECT} WHERE q.user_id=$1 ORDER BY q.issued_at DESC, q.id DESC`, [userId])).rows;
    return attachCourseQuoteItemsWithClient(c, rows);
  });
}

async function pgUpdateCourseQuoteStatus(id, patch = {}) {
  const current = await pgFindCourseQuoteById(id);
  if (!current) return null;
  const status = normalizeCourseQuoteStatusValue(patch.status, current.status);
  const now = new Date().toISOString();
  const sentAt = status === "sent" ? (patch.sentAt || current.sentAt || now) : current.sentAt;
  const sentBy = status === "sent" ? (patch.sentBy ?? patch.reviewedBy ?? current.sentBy ?? null) : current.sentBy;
  const acceptedAt = status === "accepted" ? (patch.acceptedAt || current.acceptedAt || now) : current.acceptedAt;
  const cancelledAt = ["cancelled", "expired"].includes(status) ? (patch.cancelledAt || current.cancelledAt || now) : current.cancelledAt;
  await withClient((c) => c.query(
    `UPDATE course_quotes
     SET status=$2, sent_at=$3, sent_by=$4, accepted_at=$5, cancelled_at=$6, reviewed_by=$7, updated_at=$8
     WHERE id=$1`,
    [id, status, sentAt, sentBy, acceptedAt, cancelledAt, patch.reviewedBy ?? current.reviewedBy ?? null, now],
  ));
  return pgFindCourseQuoteById(id);
}
async function pgCreateLabRequest(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "lab_requests");
    await c.query(`INSERT INTO lab_requests (id,user_id,course_id,status,approval_mode,purpose,exam_session_id,stack_name,stack_id,instance_uuid,instance_ip,current_flavor,instance_ips_json,vm_nodes_json,terminal_ssh_user,terminal_ssh_password,lab_backend_type,container_uuid,container_name,container_image_name,container_command_text,container_access_mode,container_console_mode,traffic_resource_id,traffic_incoming_metric_id,traffic_outgoing_metric_id,traffic_rx_bytes,traffic_tx_bytes,traffic_total_bytes,traffic_daily_bytes,traffic_checked_at,traffic_exceeded,traffic_exceeded_at,cpu_usage_percent,memory_usage_percent,disk_read_bytes,disk_write_bytes,vm_metrics_checked_at,requested_public_domains_json,public_domains_json,requested_public_tcp_routes_json,public_tcp_routes_json,last_accessed_at,expires_at,error_message,approved_at,started_at,terminated_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,CURRENT_TIMESTAMP::text)`,
      [id, input.userId, input.courseId, input.status, input.approvalMode, String(input.purpose || "learning").trim() || "learning", String(input.examSessionId || "").trim() || null, input.stackName ?? null, input.stackId ?? null, input.instanceUuid ?? null, input.instanceIp ?? null, String(input.currentFlavor || "").trim(), JSON.stringify(input.instanceIps || []), JSON.stringify(input.vmNodes || []), String(input.terminalSshUser || "").trim(), String(input.terminalSshPassword || ""), normalizeLabBackendType(input.labBackendType), String(input.containerUuid || "").trim(), String(input.containerName || "").trim(), String(input.containerImageName || "").trim(), String(input.containerCommandText || "").trim(), ["ssh", "console", "ssh_console"].includes(String(input.containerAccessMode || "").trim()) ? String(input.containerAccessMode || "").trim() : "console", ["zun", "ssh"].includes(String(input.containerConsoleMode || "").trim()) ? String(input.containerConsoleMode || "").trim() : "zun", String(input.trafficResourceId || "").trim(), String(input.trafficIncomingMetricId || "").trim(), String(input.trafficOutgoingMetricId || "").trim(), Math.max(0, Number(input.trafficRxBytes || 0)), Math.max(0, Number(input.trafficTxBytes || 0)), Math.max(0, Number(input.trafficTotalBytes || 0)), Math.max(0, Number(input.trafficDailyBytes || 0)), input.trafficCheckedAt ?? null, Number(Boolean(input.trafficExceeded)), input.trafficExceededAt ?? null, Math.max(0, Number(input.cpuUsagePercent || 0)), Math.max(0, Number(input.memoryUsagePercent || 0)), Math.max(0, Number(input.diskReadBytes || 0)), Math.max(0, Number(input.diskWriteBytes || 0)), input.vmMetricsCheckedAt ?? null, JSON.stringify(input.requestedPublicDomains || []), JSON.stringify(input.publicDomains || []), JSON.stringify(input.requestedPublicTcpRoutes || []), JSON.stringify(input.publicTcpRoutes || []), input.lastAccessedAt ?? null, input.expiresAt ?? null, input.errorMessage ?? null, input.approvedAt ?? null, input.startedAt ?? null, input.terminatedAt ?? null]);
    if (input.ensureCourseAccess && String(input.purpose || "learning").trim().toLowerCase() !== "exam") {
      await grantUserCourseAccessWithClient(c, input.userId, input.courseId, input.courseAccessGrantedVia || "lab_request", {
        extendExisting: false,
      });
    }
    return normalizeLabRow((await c.query(`${LAB_SELECT} WHERE lr.id=$1`, [id])).rows[0] || null);
  });
}
async function pgFindLabRequestById(id) { return normalizeLabRow((await withClient((c) => c.query(`${LAB_SELECT} WHERE lr.id=$1`, [id]))).rows[0] || null); }
async function pgListLabRequests(options = {}) {
  const includeArchived = Boolean(options?.includeArchived);
  const archivedOnly = Boolean(options?.archivedOnly);
  const whereClause = archivedOnly ? `WHERE NOT (${LAB_ACTIVE_RECORD_CLAUSE})` : includeArchived ? "" : `WHERE ${LAB_ACTIVE_RECORD_CLAUSE}`;
  return (await withClient((c) => c.query(`${LAB_SELECT} ${whereClause} ORDER BY lr.created_at DESC,lr.id DESC`))).rows.map(normalizeLabRow);
}
function buildLabRequestListWhere(options = {}) {
  const clauses = [];
  const params = [];
  if (options.archivedOnly) {
    clauses.push(`NOT (${LAB_ACTIVE_RECORD_CLAUSE})`);
  } else if (!options.includeArchived) {
    clauses.push(LAB_ACTIVE_RECORD_CLAUSE);
  }
  if (options.activeOnly) {
    params.push(LAB_ADMIN_IN_USE_QUERY_STATUSES);
    const statusParam = params.length;
    clauses.push(`(
      LOWER(lr.status) = ANY($${statusParam}::text[])
      OR (
        LOWER(lr.status) = 'approved'
        AND (
          COALESCE(lr.stack_id, '') <> ''
          OR COALESCE(lr.stack_name, '') <> ''
          OR COALESCE(lr.instance_uuid, '') <> ''
          OR COALESCE(lr.instance_ip, '') <> ''
          OR COALESCE(lr.container_uuid, '') <> ''
        )
      )
    )`);
  } else {
    const status = String(options.status || "").trim().toLowerCase();
    if (status && status !== "all") {
      params.push(status);
      clauses.push(`LOWER(lr.status) = $${params.length}`);
    }
  }
  const search = String(options.search || options.q || "").trim();
  if (search) {
    params.push(`%${search}%`);
    const searchParam = params.length;
    clauses.push(`(
      u.name ILIKE $${searchParam}
      OR u.username ILIKE $${searchParam}
      OR c.title ILIKE $${searchParam}
      OR c.slug ILIKE $${searchParam}
      OR lr.status ILIKE $${searchParam}
      OR lr.stack_name ILIKE $${searchParam}
      OR lr.stack_id ILIKE $${searchParam}
      OR lr.instance_ip ILIKE $${searchParam}
      OR lr.instance_uuid ILIKE $${searchParam}
      OR lr.current_flavor ILIKE $${searchParam}
    )`);
  }
  return {
    params,
    whereClause: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
  };
}
async function pgListLabRequestsPage(options = {}) {
  const limit = Math.min(500, Math.max(1, Math.round(Number(options.limit || 50) || 50)));
  const offset = Math.max(0, Math.round(Number(options.offset || 0) || 0));
  const { whereClause, params } = buildLabRequestListWhere(options);
  return withClient(async (c) => {
    const countResult = await c.query(
      `SELECT COUNT(*)::int AS total
       FROM lab_requests lr
       JOIN users u ON u.id = lr.user_id
       JOIN courses c ON c.id = lr.course_id
       ${whereClause}`,
      params,
    );
    const rows = (await c.query(
      `${LAB_SELECT}
       ${whereClause}
       ORDER BY lr.created_at DESC, lr.id DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    )).rows.map(normalizeLabRow);
    return {
      labs: rows,
      total: Number(countResult.rows[0]?.total || 0),
      limit,
      offset,
    };
  });
}
async function pgListLabRequestsByUser(userId, options = {}) {
  const includeArchived = Boolean(options?.includeArchived);
  const archivedClause = includeArchived ? "" : `AND ${LAB_ACTIVE_RECORD_CLAUSE}`;
  return (await withClient((c) => c.query(`${LAB_SELECT} WHERE lr.user_id=$1 ${archivedClause} ORDER BY lr.created_at DESC,lr.id DESC`, [userId]))).rows.map(normalizeLabRow);
}
function normalizeTerminalReplaySessionRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ""),
    userId: Number(row.userId ?? row.user_id ?? 0),
    labRequestId: row.labRequestId ?? row.lab_request_id ?? null,
    courseId: row.courseId ?? row.course_id ?? null,
    nodeId: String(row.nodeId ?? row.node_id ?? ""),
    nodeName: String(row.nodeName ?? row.node_name ?? ""),
    mode: String(row.mode || ""),
    targetLabel: String(row.targetLabel ?? row.target_label ?? ""),
    startedAt: row.startedAt ?? row.started_at ?? "",
    endedAt: row.endedAt ?? row.ended_at ?? null,
    durationMs: Number(row.durationMs ?? row.duration_ms ?? 0),
    status: String(row.status || "recording"),
    metadata: safeJsonParse(row.metadataJson ?? row.metadata_json ?? "{}", {}),
    userName: row.userName ?? row.user_name ?? "",
    username: row.username ?? "",
    courseTitle: row.courseTitle ?? row.course_title ?? "",
  };
}
function normalizeTerminalReplayEventRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0),
    replaySessionId: String(row.replaySessionId ?? row.replay_session_id ?? ""),
    offsetMs: Number(row.offsetMs ?? row.offset_ms ?? 0),
    type: String(row.type ?? row.eventType ?? row.event_type ?? ""),
    payload: safeJsonParse(row.payloadJson ?? row.payload_json ?? "{}", {}),
    createdAt: row.createdAt ?? row.created_at ?? "",
  };
}
function normalizeTerminalSessionRegistryRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ""),
    userId: Number(row.userId ?? row.user_id ?? 0),
    resourceType: String(row.resourceType ?? row.resource_type ?? "lab") || "lab",
    labRequestId: row.labRequestId ?? row.lab_request_id ?? null,
    customLabRequestId: row.customLabRequestId ?? row.custom_lab_request_id ?? null,
    courseId: row.courseId ?? row.course_id ?? null,
    host: String(row.host || ""),
    hostType: String(row.hostType ?? row.host_type ?? ""),
    nodeId: String(row.nodeId ?? row.node_id ?? ""),
    nodeName: String(row.nodeName ?? row.node_name ?? ""),
    username: String(row.username || ""),
    port: Number(row.port || 22),
    jumpHost: String(row.jumpHost ?? row.jump_host ?? ""),
    jumpUser: String(row.jumpUser ?? row.jump_user ?? ""),
    examSessionId: String(row.examSessionId ?? row.exam_session_id ?? ""),
    replayMetadata: safeJsonParse(row.replayMetadataJson ?? row.replay_metadata_json ?? "{}", {}),
    createdAt: row.createdAt ?? row.created_at ?? "",
    lastActivityAt: row.lastActivityAt ?? row.last_activity_at ?? "",
    expiresAt: row.expiresAt ?? row.expires_at ?? "",
  };
}
async function pgCreateTerminalReplaySession(input) {
  const id = String(input.id || randomUUID());
  const now = input.startedAt || new Date().toISOString();
  await withClient((c) => c.query(
    `INSERT INTO terminal_replay_sessions
       (id, user_id, lab_request_id, course_id, node_id, node_name, mode, target_label, started_at, metadata_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      Number(input.userId || 0),
      input.labRequestId ? Number(input.labRequestId) : null,
      input.courseId ? Number(input.courseId) : null,
      String(input.nodeId || "").trim(),
      String(input.nodeName || "").trim(),
      String(input.mode || "").trim(),
      String(input.targetLabel || "").trim(),
      now,
      JSON.stringify(input.metadata || {}),
    ],
  ));
  return pgFindTerminalReplaySessionById(id);
}
async function pgFinishTerminalReplaySession(id, patch = {}) {
  const endedAt = patch.endedAt || new Date().toISOString();
  await withClient((c) => c.query(
    `UPDATE terminal_replay_sessions
     SET ended_at=$2, duration_ms=$3, status=$4
     WHERE id=$1`,
    [
      String(id || ""),
      endedAt,
      Math.max(0, Math.round(Number(patch.durationMs || 0) || 0)),
      String(patch.status || "finished").trim() || "finished",
    ],
  ));
  return pgFindTerminalReplaySessionById(id);
}
async function pgAppendTerminalReplayEvent(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "terminal_replay_events");
    await c.query(
      `INSERT INTO terminal_replay_events
         (id, replay_session_id, offset_ms, event_type, payload_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        id,
        String(input.replaySessionId || ""),
        Math.max(0, Math.round(Number(input.offsetMs || 0) || 0)),
        String(input.eventType || input.type || "").trim(),
        JSON.stringify(input.payload || {}),
        input.createdAt || new Date().toISOString(),
      ],
    );
    return id;
  });
}
async function pgFindTerminalReplaySessionById(id) {
  return normalizeTerminalReplaySessionRow((await withClient((c) => c.query(
    `SELECT r.*, u.name AS "userName", u.username, c.title AS "courseTitle"
     FROM terminal_replay_sessions r
     LEFT JOIN users u ON u.id = r.user_id
     LEFT JOIN courses c ON c.id = r.course_id
     WHERE r.id=$1`,
    [String(id || "")],
  ))).rows[0] || null);
}
async function pgListTerminalReplaySessionsByLab(labRequestId, { userId = null, limit = 20 } = {}) {
  const params = [Number(labRequestId || 0), Math.max(1, Math.min(100, Number(limit || 20)))];
  const userClause = userId ? "AND r.user_id=$3" : "";
  if (userId) params.push(Number(userId));
  return (await withClient((c) => c.query(
    `SELECT r.*, u.name AS "userName", u.username, c.title AS "courseTitle"
     FROM terminal_replay_sessions r
     LEFT JOIN users u ON u.id = r.user_id
     LEFT JOIN courses c ON c.id = r.course_id
     WHERE r.lab_request_id=$1 ${userClause}
     ORDER BY r.started_at DESC
     LIMIT $2`,
    params,
  ))).rows.map(normalizeTerminalReplaySessionRow);
}
async function pgListTerminalReplayEvents(replaySessionId) {
  return (await withClient((c) => c.query(
    `SELECT id, replay_session_id AS "replaySessionId", offset_ms AS "offsetMs", event_type AS "eventType",
            payload_json AS "payloadJson", created_at AS "createdAt"
     FROM terminal_replay_events
     WHERE replay_session_id=$1
     ORDER BY offset_ms ASC, id ASC`,
    [String(replaySessionId || "")],
  ))).rows.map(normalizeTerminalReplayEventRow);
}
async function pgUpsertTerminalSessionRegistry(input) {
  const id = String(input.id || "").trim();
  const userId = Number(input.userId || 0);
  const host = String(input.host || "").trim();
  const username = String(input.username || "").trim();
  if (!id || !userId || !host || !username) return null;
  const now = input.lastActivityAt || input.createdAt || new Date().toISOString();
  const expiresAt = input.expiresAt || new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString();
  await withClient((c) => c.query(
    `INSERT INTO terminal_session_registry
       (id, user_id, resource_type, lab_request_id, custom_lab_request_id, course_id, host, host_type,
        node_id, node_name, username, port, jump_host, jump_user, exam_session_id, replay_metadata_json,
        created_at, last_activity_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (id) DO UPDATE SET
       user_id=EXCLUDED.user_id,
       resource_type=EXCLUDED.resource_type,
       lab_request_id=EXCLUDED.lab_request_id,
       custom_lab_request_id=EXCLUDED.custom_lab_request_id,
       course_id=EXCLUDED.course_id,
       host=EXCLUDED.host,
       host_type=EXCLUDED.host_type,
       node_id=EXCLUDED.node_id,
       node_name=EXCLUDED.node_name,
       username=EXCLUDED.username,
       port=EXCLUDED.port,
       jump_host=EXCLUDED.jump_host,
       jump_user=EXCLUDED.jump_user,
       exam_session_id=EXCLUDED.exam_session_id,
       replay_metadata_json=EXCLUDED.replay_metadata_json,
       last_activity_at=EXCLUDED.last_activity_at,
       expires_at=EXCLUDED.expires_at`,
    [
      id,
      userId,
      String(input.resourceType || "lab").trim() || "lab",
      input.labRequestId ? Number(input.labRequestId) : null,
      input.customLabRequestId ? Number(input.customLabRequestId) : null,
      input.courseId ? Number(input.courseId) : null,
      host,
      String(input.hostType || "").trim(),
      String(input.nodeId || "").trim(),
      String(input.nodeName || "").trim(),
      username,
      Math.max(1, Number(input.port || 22) || 22),
      String(input.jumpHost || "").trim(),
      String(input.jumpUser || "").trim(),
      String(input.examSessionId || "").trim(),
      JSON.stringify(input.replayMetadata || {}),
      input.createdAt || now,
      now,
      expiresAt,
    ],
  ));
  return pgFindTerminalSessionRegistryById(id);
}
async function pgFindTerminalSessionRegistryById(id) {
  return normalizeTerminalSessionRegistryRow((await withClient((c) => c.query(
    `SELECT *
     FROM terminal_session_registry
     WHERE id=$1`,
    [String(id || "")],
  ))).rows[0] || null);
}
async function pgDeleteTerminalSessionRegistry(id) {
  await withClient((c) => c.query(
    `DELETE FROM terminal_session_registry WHERE id=$1`,
    [String(id || "")],
  ));
}
async function pgDeleteExpiredTerminalSessionRegistry(nowIso = new Date().toISOString()) {
  const result = await withClient((c) => c.query(
    `DELETE FROM terminal_session_registry WHERE expires_at <= $1`,
    [String(nowIso || new Date().toISOString())],
  ));
  return Number(result?.rowCount || 0);
}
async function pgFindLabRequestByPublicSubdomain(subdomain) {
  if (!subdomain) return null;
  const rows = (await withClient((c) => c.query(`${LAB_SELECT} WHERE ${LAB_ACTIVE_RECORD_CLAUSE} ORDER BY lr.created_at DESC,lr.id DESC`))).rows.map(normalizeLabRow);
  return rows.find((lab) => [...(lab.publicDomains || []), ...(lab.requestedPublicDomains || [])].some((entry) => entry.subdomain === subdomain)) || null;
}
async function pgListPublishedLabRoutes() {
  const labs = (await withClient((c) => c.query(
    `${LAB_SELECT}
     WHERE ${LAB_ACTIVE_RECORD_CLAUSE}
       AND (lr.public_enabled=1 OR lr.public_tcp_enabled=1 OR lr.external_ssh_enabled=1 OR lr.external_rdp_enabled=1)
     ORDER BY lr.id DESC`,
  ))).rows.map(normalizeLabRow);
  const customLabs = (await pgListCustomLabRequests())
    .filter((request) => request.publicEnabled && Array.isArray(request.publicDomains) && request.publicDomains.length)
    .map((request) => ({
      ...request,
      id: `custom-${request.id}`,
      resourceType: "custom-lab",
      courseTitle: request.title || `PoC ${request.id}`,
      stackName: request.stackName || request.title || `PoC ${request.id}`,
      status: request.status || "running",
      externalSshEnabled: false,
      externalRdpEnabled: false,
      publicTcpRoutes: [],
    }));
  const selfServiceVms = (await pgListSelfServiceVms())
    .filter((vm) => vm.externalSshEnabled && !["failed", "terminated", "deleted", "deleting"].includes(String(vm.status || "").trim().toLowerCase()))
    .map((vm) => ({
      ...vm,
      id: `self-service-vm-${vm.id}`,
      originalId: vm.id,
      resourceType: "self-service-vm",
      courseTitle: vm.stackName || `Self-service VM ${vm.id}`,
      stackName: vm.stackName || `self-vm-${vm.id}`,
      status: vm.status || "running",
      publicDomains: [],
      publicTcpRoutes: [],
      externalSshEnabled: Boolean(vm.externalSshEnabled),
      externalRdpEnabled: false,
    }));
  const cloudConsoleInstances = (await pgListCloudConsoleActions())
    .filter((action) => action.operation === "POST /api/cloud-console/instances" && action.status === "completed" && (action.result?.externalSshFixedIp || action.result?.fixedIp) && ((action.result?.externalSshEnabled && Number(action.result?.externalSshPort || 0) > 0) || (Array.isArray(action.result?.publicDomains) && action.result.publicDomains.length) || (Array.isArray(action.result?.publicTcpRoutes) && action.result.publicTcpRoutes.length)))
    .map((action) => {
      const serverId = String(action.result?.id || action.result?.server?.id || "").trim();
      const fixedIp = String(action.result.externalSshFixedIp || action.result.fixedIp || "").trim();
      const externalSshPort = Number(action.result.externalSshPort);
      return { id: `cloud-console-${action.id}`, originalId: action.id, resourceType: "cloud-console-instance", userId: action.userId, projectName: action.projectName, stackName: action.result?.name || serverId, status: "running", instanceIp: fixedIp, externalSshEnabled: Boolean(action.result?.externalSshEnabled), externalSshPort, externalRdpEnabled: false, publicDomains: Array.isArray(action.result?.publicDomains) ? action.result.publicDomains : [], publicTcpRoutes: Array.isArray(action.result?.publicTcpRoutes) ? action.result.publicTcpRoutes : [], vmNodes: [{ id: serverId, serverId, name: action.result?.name || serverId, fixedIp, status: "running", externalSshPort }] };
    });
  const zunContainers = (await pgListZunContainers())
    .filter((container) => String(container.status || "").trim().toLowerCase() === "running" && Array.isArray(container.publicDomains) && container.publicDomains.length)
    .map((container) => {
      const addresses = Array.isArray(container.addresses) ? container.addresses : [];
      const preferred = addresses.find((item) => String(item?.network || "").trim().toLowerCase() === "net-infra" && item?.address)
        || addresses.find((item) => item?.address);
      const fixedIp = String(preferred?.address || "").trim();
      return {
        id: `zun-${container.id}`,
        originalId: container.id,
        resourceType: "zun-container",
        userId: container.userId,
        projectName: container.projectName,
        stackName: container.name || `Zun ${container.id}`,
        status: "running",
        instanceIp: fixedIp,
        externalSshEnabled: false,
        externalRdpEnabled: false,
        publicDomains: container.publicDomains,
        publicTcpRoutes: [],
        vmNodes: fixedIp ? [{ id: container.containerUuid || `zun-${container.id}`, name: container.name, fixedIp, status: "running" }] : [],
      };
    });
  return [...labs, ...customLabs, ...selfServiceVms, ...cloudConsoleInstances, ...zunContainers];
}
async function pgDeleteLabRequests(ids) {
  const values = Array.isArray(ids) ? ids.map((id) => Number(id)).filter(Boolean) : [];
  if (!values.length) return 0;
  return Number((await withClient((c) => c.query(`DELETE FROM lab_requests WHERE id = ANY($1::bigint[])`, [values]))).rowCount || 0);
}
function normalizeLabRequestArchiveRetentionDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(3650, Math.round(parsed)));
}
async function pgArchiveOldLabRequests(options = {}) {
  const retentionDays = normalizeLabRequestArchiveRetentionDays(options.retentionDays);
  const limit = Math.max(1, Math.min(10000, Number(options.limit || 2000) || 2000));
  const now = new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const reason = String(options.reason || "old-lab-request-cleanup").trim() || "old-lab-request-cleanup";
  const result = await withClient((c) => c.query(
    `WITH candidates AS (
       SELECT id
       FROM lab_requests
       WHERE COALESCE(archived_at, '') = ''
         AND lower(COALESCE(status, '')) = ANY($1::text[])
         AND COALESCE(NULLIF(terminated_at, ''), NULLIF(started_at, ''), NULLIF(approved_at, ''), created_at)::timestamptz < $2::timestamptz
       ORDER BY COALESCE(NULLIF(terminated_at, ''), NULLIF(started_at, ''), NULLIF(approved_at, ''), created_at)::timestamptz ASC, id ASC
       LIMIT $3
     )
     UPDATE lab_requests lr
     SET archived_at=$4,
         archived_reason=$5
     FROM candidates c
     WHERE lr.id=c.id
     RETURNING lr.id, lr.status`,
    [OLD_LAB_REQUEST_ARCHIVE_STATUSES, cutoff, limit, now.toISOString(), reason],
  ));
  return {
    archivedCount: Number(result.rowCount || 0),
    archivedIds: result.rows.map((row) => Number(row.id)).filter(Boolean),
    cutoff,
    retentionDays,
    limit,
  };
}
async function pgDeleteCustomLabRequest(id) {
  const requestId = Number(id);
  if (!requestId) return 0;
  return Number((await withClient((c) => c.query(`DELETE FROM custom_lab_requests WHERE id=$1`, [requestId]))).rowCount || 0);
}
async function pgFindActiveLabByUserId(userId) {
  return normalizeLabRow((await withClient((c) => c.query(`${LAB_SELECT} WHERE lr.user_id=$1 AND ${LAB_ACTIVE_RECORD_CLAUSE} AND lr.status IN ('pending','approved','provisioning','running','terminating') AND COALESCE(lr.purpose,'learning') <> 'exam' ORDER BY lr.created_at DESC,lr.id DESC LIMIT 1`, [userId]))).rows[0] || null);
}
async function pgTouchLabRequest(id, { lastAccessedAt = "", expiresAt = "" } = {}) {
  const labId = Number(id || 0);
  if (!labId) return 0;
  const now = String(lastAccessedAt || new Date().toISOString());
  const nextExpiresAt = String(expiresAt || "");
  const result = await withClient((c) => c.query(
    `UPDATE lab_requests lr
     SET last_accessed_at=$2,
         expires_at=CASE
           WHEN COALESCE(c.lab_enabled, 0) <> 0 AND COALESCE(c.lab_retention_mode, 'ephemeral') = 'persistent'
             THEN lr.expires_at
           ELSE $3
         END
     FROM courses c
     WHERE lr.id=$1 AND lr.course_id=c.id AND lr.status='running'`,
    [labId, now, nextExpiresAt],
  ));
  return Number(result.rowCount || 0);
}
async function pgUpdateLabRequest(id, patch) {
  return withTx(async (c) => {
    const current = normalizeLabRow((await c.query(`${LAB_SELECT} WHERE lr.id=$1`, [id])).rows[0] || null);
    if (!current) return null;
    const hasPatch = (key) => Object.prototype.hasOwnProperty.call(patch || {}, key);
    const nextPublicDomains = coerceDomainPatchList(patch.publicDomains, current.publicDomains || []);
    const nextRequestedDomains = coerceDomainPatchList(patch.requestedPublicDomains, current.requestedPublicDomains || []);
    const nextPublicTcpRoutes = coercePublicTcpPatchList(patch.publicTcpRoutes, current.publicTcpRoutes || []);
    const nextRequestedPublicTcpRoutes = coercePublicTcpPatchList(patch.requestedPublicTcpRoutes, current.requestedPublicTcpRoutes || []);
    const firstPublicDomain = nextPublicDomains[0] || null;
    const firstRequestedDomain = nextRequestedDomains[0] || null;
    await c.query(`UPDATE lab_requests SET status=$2,approval_mode=$3,stack_name=$4,stack_id=$5,instance_uuid=$6,instance_ip=$7,current_flavor=$8,instance_ips_json=$9,vm_nodes_json=$10,terminal_ssh_user=$11,terminal_ssh_password=$12,lab_backend_type=$13,container_uuid=$14,container_name=$15,container_image_name=$16,container_command_text=$17,container_access_mode=$18,container_console_mode=$19,traffic_resource_id=$20,traffic_incoming_metric_id=$21,traffic_outgoing_metric_id=$22,traffic_rx_bytes=$23,traffic_tx_bytes=$24,traffic_total_bytes=$25,traffic_daily_bytes=$26,traffic_checked_at=$27,traffic_exceeded=$28,traffic_exceeded_at=$29,cpu_usage_percent=$30,memory_usage_percent=$31,disk_read_bytes=$32,disk_write_bytes=$33,vm_metrics_checked_at=$34,requested_public_domains_json=$35,requested_public_subdomain=$36,requested_public_fqdn=$37,requested_public_protocol=$38,requested_public_port=$39,public_domains_json=$40,public_subdomain=$41,public_fqdn=$42,public_protocol=$43,public_port=$44,public_enabled=$45,public_request_pending=$46,public_reviewed_by=$47,public_reviewed_at=$48,public_review_note=$49,requested_public_tcp_routes_json=$50,public_tcp_routes_json=$51,public_tcp_enabled=$52,public_tcp_request_pending=$53,public_tcp_reviewed_by=$54,public_tcp_reviewed_at=$55,public_tcp_review_note=$56,external_ssh_enabled=$57,external_ssh_port=$58,external_ssh_request_pending=$59,external_ssh_reviewed_by=$60,external_ssh_reviewed_at=$61,external_ssh_review_note=$62,external_rdp_enabled=$63,external_rdp_port=$64,external_rdp_request_pending=$65,external_rdp_reviewed_by=$66,external_rdp_reviewed_at=$67,external_rdp_review_note=$68,requested_resize_flavor=$69,resize_request_pending=$70,resize_reviewed_by=$71,resize_reviewed_at=$72,resize_review_note=$73,metallb_vip_cidr=$74,last_accessed_at=$75,expires_at=$76,error_message=$77,approved_at=$78,started_at=$79,terminated_at=$80 WHERE id=$1`, [
      id, patch.status ?? current.status, patch.approvalMode ?? current.approvalMode, patch.stackName ?? current.stackName, patch.stackId ?? current.stackId, patch.instanceUuid ?? current.instanceUuid ?? "", patch.instanceIp ?? current.instanceIp, String(patch.currentFlavor ?? current.currentFlavor ?? "").trim(),
      JSON.stringify(patch.instanceIps ?? current.instanceIps ?? []), JSON.stringify(patch.vmNodes ?? current.vmNodes ?? []), String(patch.terminalSshUser ?? current.terminalSshUser ?? "").trim(), String(patch.terminalSshPassword ?? current.terminalSshPassword ?? ""), normalizeLabBackendType(patch.labBackendType ?? current.labBackendType), String(patch.containerUuid ?? current.containerUuid ?? "").trim(), String(patch.containerName ?? current.containerName ?? "").trim(), String(patch.containerImageName ?? current.containerImageName ?? "").trim(), String(patch.containerCommandText ?? current.containerCommandText ?? "").trim(), ["ssh", "console", "ssh_console"].includes(String(patch.containerAccessMode ?? current.containerAccessMode ?? "").trim()) ? String(patch.containerAccessMode ?? current.containerAccessMode ?? "").trim() : "console", ["zun", "ssh"].includes(String(patch.containerConsoleMode ?? current.containerConsoleMode ?? "").trim()) ? String(patch.containerConsoleMode ?? current.containerConsoleMode ?? "").trim() : "zun",
      String(patch.trafficResourceId ?? current.trafficResourceId ?? "").trim(), String(patch.trafficIncomingMetricId ?? current.trafficIncomingMetricId ?? "").trim(), String(patch.trafficOutgoingMetricId ?? current.trafficOutgoingMetricId ?? "").trim(), Math.max(0, Number(patch.trafficRxBytes ?? current.trafficRxBytes ?? 0)), Math.max(0, Number(patch.trafficTxBytes ?? current.trafficTxBytes ?? 0)), Math.max(0, Number(patch.trafficTotalBytes ?? current.trafficTotalBytes ?? 0)), Math.max(0, Number(patch.trafficDailyBytes ?? current.trafficDailyBytes ?? 0)), patch.trafficCheckedAt ?? current.trafficCheckedAt, Number(patch.trafficExceeded ?? current.trafficExceeded ?? false), patch.trafficExceededAt ?? current.trafficExceededAt, Math.max(0, Number(patch.cpuUsagePercent ?? current.cpuUsagePercent ?? 0)), Math.max(0, Number(patch.memoryUsagePercent ?? current.memoryUsagePercent ?? 0)), Math.max(0, Number(patch.diskReadBytes ?? current.diskReadBytes ?? 0)), Math.max(0, Number(patch.diskWriteBytes ?? current.diskWriteBytes ?? 0)), patch.vmMetricsCheckedAt ?? current.vmMetricsCheckedAt,
      JSON.stringify(nextRequestedDomains), firstRequestedDomain?.subdomain || "", firstRequestedDomain?.fqdn || "", firstRequestedDomain?.protocol || "http", firstRequestedDomain?.port ?? null,
      JSON.stringify(nextPublicDomains), firstPublicDomain?.subdomain || "", firstPublicDomain?.fqdn || "", firstPublicDomain?.protocol || "http", firstPublicDomain?.port ?? null,
      Number(patch.publicEnabled ?? (nextPublicDomains.length > 0)), Number(patch.publicRequestPending ?? (nextRequestedDomains.length > 0)), patch.publicReviewedBy ?? current.publicReviewedBy ?? "", patch.publicReviewedAt ?? current.publicReviewedAt, patch.publicReviewNote ?? current.publicReviewNote ?? "",
      JSON.stringify(nextRequestedPublicTcpRoutes), JSON.stringify(nextPublicTcpRoutes), Number(patch.publicTcpEnabled ?? (nextPublicTcpRoutes.length > 0)), Number(patch.publicTcpRequestPending ?? (nextRequestedPublicTcpRoutes.length > 0)), patch.publicTcpReviewedBy ?? current.publicTcpReviewedBy ?? "", patch.publicTcpReviewedAt ?? current.publicTcpReviewedAt, patch.publicTcpReviewNote ?? current.publicTcpReviewNote ?? "",
      Number(patch.externalSshEnabled ?? current.externalSshEnabled ?? false), hasPatch("externalSshPort") ? patch.externalSshPort : current.externalSshPort ?? null, Number(patch.externalSshRequestPending ?? current.externalSshRequestPending ?? false), patch.externalSshReviewedBy ?? current.externalSshReviewedBy ?? "", hasPatch("externalSshReviewedAt") ? patch.externalSshReviewedAt : current.externalSshReviewedAt, patch.externalSshReviewNote ?? current.externalSshReviewNote ?? "",
      Number(patch.externalRdpEnabled ?? current.externalRdpEnabled ?? false), hasPatch("externalRdpPort") ? patch.externalRdpPort : current.externalRdpPort ?? null, Number(patch.externalRdpRequestPending ?? current.externalRdpRequestPending ?? false), patch.externalRdpReviewedBy ?? current.externalRdpReviewedBy ?? "", hasPatch("externalRdpReviewedAt") ? patch.externalRdpReviewedAt : current.externalRdpReviewedAt, patch.externalRdpReviewNote ?? current.externalRdpReviewNote ?? "",
      String(patch.requestedResizeFlavor ?? current.requestedResizeFlavor ?? "").trim(), Number(patch.resizeRequestPending ?? current.resizeRequestPending ?? false), patch.resizeReviewedBy ?? current.resizeReviewedBy ?? "", patch.resizeReviewedAt ?? current.resizeReviewedAt, patch.resizeReviewNote ?? current.resizeReviewNote ?? "",
      String(patch.metallbVipCidr ?? current.metallbVipCidr ?? "").trim(),
      patch.lastAccessedAt ?? current.lastAccessedAt, patch.expiresAt ?? current.expiresAt, patch.errorMessage ?? current.errorMessage, patch.approvedAt ?? current.approvedAt, patch.startedAt ?? current.startedAt, patch.terminatedAt ?? current.terminatedAt,
    ]);
    return normalizeLabRow((await c.query(`${LAB_SELECT} WHERE lr.id=$1`, [id])).rows[0] || null);
  });
}
async function pgListExpiredRunningLabs(expiresBeforeIso, idleBeforeIso = expiresBeforeIso) {
  return (await withClient((c) => c.query(
    `${LAB_SELECT}
     WHERE lr.status IN ('running','paused')
       AND ${LAB_ACTIVE_RECORD_CLAUSE}
       AND (
         (NULLIF(lr.expires_at, '') IS NOT NULL AND lr.expires_at <= $1)
         OR (NULLIF(lr.expires_at, '') IS NULL AND lr.last_accessed_at IS NOT NULL AND lr.last_accessed_at < $2)
       )`,
    [expiresBeforeIso, idleBeforeIso],
  ))).rows.map(normalizeLabRow);
}
async function pgCreateConsultingRequest(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "consulting_requests");
    await c.query(
      `INSERT INTO consulting_requests
       (id, user_id, status, title, company_name, contact_name, contact_email, contact_phone, inquiry_type, industry, current_environment, requirements, budget_range, desired_timeline, note, admin_note, reviewed_by, created_at, reviewed_at)
       VALUES ($1, $2, 'requested', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, '', NULL, CURRENT_TIMESTAMP::text, NULL)`,
      [id, input.userId, input.title, input.companyName || "", input.contactName || "", input.contactEmail || "", input.contactPhone || "", input.inquiryType || "", input.industry || "", input.currentEnvironment || "", input.requirements || "", input.budgetRange || "", input.desiredTimeline || "", input.note || ""],
    );
    return normalizeConsultingRequestRow((await c.query(
      `SELECT cr.id, cr.user_id AS "userId", cr.status, cr.title,
              cr.company_name AS "companyName", cr.contact_name AS "contactName", cr.contact_email AS "contactEmail", cr.contact_phone AS "contactPhone",
              cr.inquiry_type AS "inquiryType", cr.industry, cr.current_environment AS "currentEnvironment",
              cr.requirements, cr.budget_range AS "budgetRange", cr.desired_timeline AS "desiredTimeline",
              cr.note, cr.admin_note AS "adminNote", cr.reviewed_by AS "reviewedById", cr.created_at AS "createdAt", cr.reviewed_at AS "reviewedAt",
              u.name AS "userName", u.username, reviewer.name AS "reviewedByName", reviewer.username AS "reviewedByUsername"
       FROM consulting_requests cr
       JOIN users u ON u.id = cr.user_id
       LEFT JOIN users reviewer ON reviewer.id = cr.reviewed_by
       WHERE cr.id=$1`, [id]
    )).rows[0] || null);
  });
}
async function pgFindConsultingRequestById(id) {
  return normalizeConsultingRequestRow((await withClient((c) => c.query(
    `SELECT cr.id, cr.user_id AS "userId", cr.status, cr.title,
            cr.company_name AS "companyName", cr.contact_name AS "contactName", cr.contact_email AS "contactEmail", cr.contact_phone AS "contactPhone",
            cr.inquiry_type AS "inquiryType", cr.industry, cr.current_environment AS "currentEnvironment",
            cr.requirements, cr.budget_range AS "budgetRange", cr.desired_timeline AS "desiredTimeline",
            cr.note, cr.admin_note AS "adminNote", cr.reviewed_by AS "reviewedById", cr.created_at AS "createdAt", cr.reviewed_at AS "reviewedAt",
            u.name AS "userName", u.username, reviewer.name AS "reviewedByName", reviewer.username AS "reviewedByUsername"
     FROM consulting_requests cr
     JOIN users u ON u.id = cr.user_id
     LEFT JOIN users reviewer ON reviewer.id = cr.reviewed_by
     WHERE cr.id=$1`, [id]
  ))).rows[0] || null);
}
async function pgListConsultingRequests() {
  return (await withClient((c) => c.query(
    `SELECT cr.id, cr.user_id AS "userId", cr.status, cr.title,
            cr.company_name AS "companyName", cr.contact_name AS "contactName", cr.contact_email AS "contactEmail", cr.contact_phone AS "contactPhone",
            cr.inquiry_type AS "inquiryType", cr.industry, cr.current_environment AS "currentEnvironment",
            cr.requirements, cr.budget_range AS "budgetRange", cr.desired_timeline AS "desiredTimeline",
            cr.note, cr.admin_note AS "adminNote", cr.reviewed_by AS "reviewedById", cr.created_at AS "createdAt", cr.reviewed_at AS "reviewedAt",
            u.name AS "userName", u.username, reviewer.name AS "reviewedByName", reviewer.username AS "reviewedByUsername"
     FROM consulting_requests cr
     JOIN users u ON u.id = cr.user_id
     LEFT JOIN users reviewer ON reviewer.id = cr.reviewed_by
     ORDER BY cr.created_at DESC, cr.id DESC`
  ))).rows.map(normalizeConsultingRequestRow);
}
async function pgListConsultingRequestsByUser(userId) {
  return (await withClient((c) => c.query(
    `SELECT cr.id, cr.user_id AS "userId", cr.status, cr.title,
            cr.company_name AS "companyName", cr.contact_name AS "contactName", cr.contact_email AS "contactEmail", cr.contact_phone AS "contactPhone",
            cr.inquiry_type AS "inquiryType", cr.industry, cr.current_environment AS "currentEnvironment",
            cr.requirements, cr.budget_range AS "budgetRange", cr.desired_timeline AS "desiredTimeline",
            cr.note, cr.admin_note AS "adminNote", cr.reviewed_by AS "reviewedById", cr.created_at AS "createdAt", cr.reviewed_at AS "reviewedAt",
            u.name AS "userName", u.username, reviewer.name AS "reviewedByName", reviewer.username AS "reviewedByUsername"
     FROM consulting_requests cr
     JOIN users u ON u.id = cr.user_id
     LEFT JOIN users reviewer ON reviewer.id = cr.reviewed_by
     WHERE cr.user_id=$1
     ORDER BY cr.created_at DESC, cr.id DESC`, [userId]
  ))).rows.map(normalizeConsultingRequestRow);
}
async function pgUpdateConsultingRequest(id, patch) {
  const current = await pgFindConsultingRequestById(id);
  if (!current) return null;
  await withClient((c) => c.query(
    `UPDATE consulting_requests
     SET status=$2, title=$3, company_name=$4, contact_name=$5, contact_email=$6, contact_phone=$7,
         inquiry_type=$8, industry=$9, current_environment=$10, requirements=$11, budget_range=$12,
         desired_timeline=$13, note=$14, admin_note=$15, reviewed_by=$16, reviewed_at=$17
     WHERE id=$1`,
    [
      id,
      patch.status ?? current.status,
      patch.title ?? current.title,
      patch.companyName ?? current.companyName,
      patch.contactName ?? current.contactName,
      patch.contactEmail ?? current.contactEmail,
      patch.contactPhone ?? current.contactPhone,
      patch.inquiryType ?? current.inquiryType,
      patch.industry ?? current.industry,
      patch.currentEnvironment ?? current.currentEnvironment,
      patch.requirements ?? current.requirements,
      patch.budgetRange ?? current.budgetRange,
      patch.desiredTimeline ?? current.desiredTimeline,
      patch.note ?? current.note,
      patch.adminNote ?? current.adminNote,
      patch.reviewedBy ?? current.reviewedById ?? null,
      patch.reviewedAt ?? current.reviewedAt ?? null,
    ],
  ));
  return pgFindConsultingRequestById(id);
}
async function pgCreatePublicQuoteInquiry(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "public_quote_inquiries");
    await c.query(
      `INSERT INTO public_quote_inquiries
       (id, status, company_name, contact_name, contact_email, contact_phone, interest_type, course_titles, participant_count, desired_timeline, requirements, privacy_agreed, ip_address, user_agent, admin_note, reviewed_by, created_at, reviewed_at)
       VALUES ($1, 'requested', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, '', NULL, CURRENT_TIMESTAMP::text, NULL)`,
      [
        id,
        input.companyName || "",
        input.contactName || "",
        input.contactEmail || "",
        input.contactPhone || "",
        input.interestType || "",
        input.courseTitles || "",
        Math.max(1, Number(input.participantCount || 1) || 1),
        input.desiredTimeline || "",
        input.requirements || "",
        Number(Boolean(input.privacyAgreed)),
        input.ipAddress || "",
        input.userAgent || "",
      ],
    );
    return normalizePublicQuoteInquiryRow((await c.query(
      `SELECT pqi.id, pqi.status, pqi.company_name AS "companyName", pqi.contact_name AS "contactName",
              pqi.contact_email AS "contactEmail", pqi.contact_phone AS "contactPhone",
              pqi.interest_type AS "interestType", pqi.course_titles AS "courseTitles",
              pqi.participant_count AS "participantCount", pqi.desired_timeline AS "desiredTimeline",
              pqi.requirements, pqi.privacy_agreed AS "privacyAgreed", pqi.ip_address AS "ipAddress",
              pqi.user_agent AS "userAgent", pqi.admin_note AS "adminNote",
              pqi.reviewed_by AS "reviewedById", pqi.created_at AS "createdAt", pqi.reviewed_at AS "reviewedAt",
              reviewer.name AS "reviewedByName", reviewer.username AS "reviewedByUsername"
       FROM public_quote_inquiries pqi
       LEFT JOIN users reviewer ON reviewer.id = pqi.reviewed_by
       WHERE pqi.id=$1`, [id]
    )).rows[0] || null);
  });
}
async function pgFindPublicQuoteInquiryById(id) {
  return normalizePublicQuoteInquiryRow((await withClient((c) => c.query(
    `SELECT pqi.id, pqi.status, pqi.company_name AS "companyName", pqi.contact_name AS "contactName",
            pqi.contact_email AS "contactEmail", pqi.contact_phone AS "contactPhone",
            pqi.interest_type AS "interestType", pqi.course_titles AS "courseTitles",
            pqi.participant_count AS "participantCount", pqi.desired_timeline AS "desiredTimeline",
            pqi.requirements, pqi.privacy_agreed AS "privacyAgreed", pqi.ip_address AS "ipAddress",
            pqi.user_agent AS "userAgent", pqi.admin_note AS "adminNote",
            pqi.reviewed_by AS "reviewedById", pqi.created_at AS "createdAt", pqi.reviewed_at AS "reviewedAt",
            reviewer.name AS "reviewedByName", reviewer.username AS "reviewedByUsername"
     FROM public_quote_inquiries pqi
     LEFT JOIN users reviewer ON reviewer.id = pqi.reviewed_by
     WHERE pqi.id=$1`, [id]
  ))).rows[0] || null);
}
async function pgListPublicQuoteInquiries() {
  return (await withClient((c) => c.query(
    `SELECT pqi.id, pqi.status, pqi.company_name AS "companyName", pqi.contact_name AS "contactName",
            pqi.contact_email AS "contactEmail", pqi.contact_phone AS "contactPhone",
            pqi.interest_type AS "interestType", pqi.course_titles AS "courseTitles",
            pqi.participant_count AS "participantCount", pqi.desired_timeline AS "desiredTimeline",
            pqi.requirements, pqi.privacy_agreed AS "privacyAgreed", pqi.ip_address AS "ipAddress",
            pqi.user_agent AS "userAgent", pqi.admin_note AS "adminNote",
            pqi.reviewed_by AS "reviewedById", pqi.created_at AS "createdAt", pqi.reviewed_at AS "reviewedAt",
            reviewer.name AS "reviewedByName", reviewer.username AS "reviewedByUsername"
     FROM public_quote_inquiries pqi
     LEFT JOIN users reviewer ON reviewer.id = pqi.reviewed_by
     ORDER BY pqi.created_at DESC, pqi.id DESC`
  ))).rows.map(normalizePublicQuoteInquiryRow);
}
async function pgUpdatePublicQuoteInquiry(id, patch) {
  const current = await pgFindPublicQuoteInquiryById(id);
  if (!current) return null;
  await withClient((c) => c.query(
    `UPDATE public_quote_inquiries
     SET status=$2, admin_note=$3, reviewed_by=$4, reviewed_at=$5
     WHERE id=$1`,
    [
      id,
      patch.status ?? current.status,
      patch.adminNote ?? current.adminNote,
      patch.reviewedBy ?? current.reviewedById ?? null,
      patch.reviewedAt ?? current.reviewedAt ?? null,
    ],
  ));
  return pgFindPublicQuoteInquiryById(id);
}
async function pgCreateCustomLabRequest(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "custom_lab_requests");
    await c.query(
        `INSERT INTO custom_lab_requests
         (id,user_id,status,title,instance_count,vcpu,ram_gb,disk_gb,image_name,usage_period,desired_budget,note,advanced_config_json,cloud_init_template_name,quoted_price,payment_status,payment_provider,payment_order_id,payment_key,payment_requested_at,payment_paid_at,payment_failed_at,payment_failure_reason,review_note,heat_template_name,application_yaml_name,stack_name,stack_id,instance_ip,instance_ips_json,vm_nodes_json,error_message,terminal_ssh_user,terminal_ssh_password,reviewed_by,created_at,reviewed_at,started_at,terminated_at)
         VALUES ($1,$2,'requested',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'','','','','',NULL,NULL,NULL,'','','','',NULL,NULL,NULL,'[]','[]','',$14,$15,NULL,CURRENT_TIMESTAMP::text,NULL,NULL,NULL)`,
        [id, input.userId, input.title, input.instanceCount, input.vcpu, input.ramGb, input.diskGb, input.imageName, input.usagePeriod || "", Math.max(0, Number(input.desiredBudget || 0)), input.note || "", JSON.stringify(input.advancedConfig || {}), input.cloudInitTemplateName || "", String(input.terminalSshUser || "").trim(), String(input.terminalSshPassword || "")],
      );
    return normalizeCustomLabRequestRow((await c.query(
      `SELECT clr.id, clr.user_id AS "userId", clr.status, clr.title, clr.instance_count AS "instanceCount", clr.vcpu,
              clr.ram_gb AS "ramGb", clr.disk_gb AS "diskGb", clr.image_name AS "imageName", clr.usage_period AS "usagePeriod",
              clr.desired_budget AS "desiredBudget", clr.note, clr.advanced_config_json AS "advancedConfigJson", clr.cloud_init_template_name AS "cloudInitTemplateName", clr.quoted_price AS "quotedPrice",
              clr.payment_status AS "paymentStatus", clr.payment_provider AS "paymentProvider", clr.payment_order_id AS "paymentOrderId", clr.payment_key AS "paymentKey",
              clr.payment_requested_at AS "paymentRequestedAt", clr.payment_paid_at AS "paymentPaidAt", clr.payment_failed_at AS "paymentFailedAt", clr.payment_failure_reason AS "paymentFailureReason", clr.review_note AS "reviewNote",
              clr.heat_template_name AS "heatTemplateName", clr.application_yaml_name AS "applicationYamlName",
              clr.stack_name AS "stackName", clr.stack_id AS "stackId", clr.instance_ip AS "instanceIp",
              clr.instance_ips_json AS "instanceIpsJson", clr.vm_nodes_json AS "vmNodesJson",
              clr.error_message AS "errorMessage", clr.terminal_ssh_user AS "terminalSshUser", clr.terminal_ssh_password AS "terminalSshPassword",
              clr.requested_public_domains_json AS "requestedPublicDomainsJson", clr.public_domains_json AS "publicDomainsJson",
              clr.public_enabled AS "publicEnabled", clr.public_request_pending AS "publicRequestPending",
              clr.public_reviewed_by AS "publicReviewedBy", clr.public_reviewed_at AS "publicReviewedAt", clr.public_review_note AS "publicReviewNote",
              clr.reviewed_by AS "reviewedById",
              clr.created_at AS "createdAt", clr.reviewed_at AS "reviewedAt", clr.started_at AS "startedAt", clr.terminated_at AS "terminatedAt", u.name AS "userName", u.username,
              reviewer.name AS "reviewedByName", reviewer.username AS "reviewedByUsername"
       FROM custom_lab_requests clr
       JOIN users u ON u.id = clr.user_id
       LEFT JOIN users reviewer ON reviewer.id = clr.reviewed_by
       WHERE clr.id=$1`, [id]
    )).rows[0] || null);
  });
}
async function pgFindCustomLabRequestById(id) {
  return normalizeCustomLabRequestRow((await withClient((c) => c.query(
    `SELECT clr.id, clr.user_id AS "userId", clr.status, clr.title, clr.instance_count AS "instanceCount", clr.vcpu,
            clr.ram_gb AS "ramGb", clr.disk_gb AS "diskGb", clr.image_name AS "imageName", clr.usage_period AS "usagePeriod",
            clr.desired_budget AS "desiredBudget", clr.note, clr.advanced_config_json AS "advancedConfigJson", clr.cloud_init_template_name AS "cloudInitTemplateName", clr.quoted_price AS "quotedPrice",
            clr.payment_status AS "paymentStatus", clr.payment_provider AS "paymentProvider", clr.payment_order_id AS "paymentOrderId", clr.payment_key AS "paymentKey",
            clr.payment_requested_at AS "paymentRequestedAt", clr.payment_paid_at AS "paymentPaidAt", clr.payment_failed_at AS "paymentFailedAt", clr.payment_failure_reason AS "paymentFailureReason", clr.review_note AS "reviewNote",
            clr.heat_template_name AS "heatTemplateName", clr.application_yaml_name AS "applicationYamlName",
            clr.stack_name AS "stackName", clr.stack_id AS "stackId", clr.instance_ip AS "instanceIp",
            clr.instance_ips_json AS "instanceIpsJson", clr.vm_nodes_json AS "vmNodesJson",
            clr.error_message AS "errorMessage", clr.terminal_ssh_user AS "terminalSshUser", clr.terminal_ssh_password AS "terminalSshPassword",
            clr.requested_public_domains_json AS "requestedPublicDomainsJson", clr.public_domains_json AS "publicDomainsJson",
            clr.public_enabled AS "publicEnabled", clr.public_request_pending AS "publicRequestPending",
            clr.public_reviewed_by AS "publicReviewedBy", clr.public_reviewed_at AS "publicReviewedAt", clr.public_review_note AS "publicReviewNote",
            clr.reviewed_by AS "reviewedById",
            clr.created_at AS "createdAt", clr.reviewed_at AS "reviewedAt", clr.started_at AS "startedAt", clr.terminated_at AS "terminatedAt", u.name AS "userName", u.username,
            reviewer.name AS "reviewedByName", reviewer.username AS "reviewedByUsername"
     FROM custom_lab_requests clr
     JOIN users u ON u.id = clr.user_id
     LEFT JOIN users reviewer ON reviewer.id = clr.reviewed_by
     WHERE clr.id=$1`, [id]
  ))).rows[0] || null);
}
async function pgListCustomLabRequests() {
  return (await withClient((c) => c.query(
    `SELECT clr.id, clr.user_id AS "userId", clr.status, clr.title, clr.instance_count AS "instanceCount", clr.vcpu,
            clr.ram_gb AS "ramGb", clr.disk_gb AS "diskGb", clr.image_name AS "imageName", clr.usage_period AS "usagePeriod",
            clr.desired_budget AS "desiredBudget", clr.note, clr.advanced_config_json AS "advancedConfigJson", clr.cloud_init_template_name AS "cloudInitTemplateName", clr.quoted_price AS "quotedPrice",
            clr.payment_status AS "paymentStatus", clr.payment_provider AS "paymentProvider", clr.payment_order_id AS "paymentOrderId", clr.payment_key AS "paymentKey",
            clr.payment_requested_at AS "paymentRequestedAt", clr.payment_paid_at AS "paymentPaidAt", clr.payment_failed_at AS "paymentFailedAt", clr.payment_failure_reason AS "paymentFailureReason", clr.review_note AS "reviewNote",
            clr.heat_template_name AS "heatTemplateName", clr.application_yaml_name AS "applicationYamlName",
            clr.stack_name AS "stackName", clr.stack_id AS "stackId", clr.instance_ip AS "instanceIp",
            clr.instance_ips_json AS "instanceIpsJson", clr.vm_nodes_json AS "vmNodesJson",
            clr.error_message AS "errorMessage", clr.terminal_ssh_user AS "terminalSshUser", clr.terminal_ssh_password AS "terminalSshPassword",
            clr.requested_public_domains_json AS "requestedPublicDomainsJson", clr.public_domains_json AS "publicDomainsJson",
            clr.public_enabled AS "publicEnabled", clr.public_request_pending AS "publicRequestPending",
            clr.public_reviewed_by AS "publicReviewedBy", clr.public_reviewed_at AS "publicReviewedAt", clr.public_review_note AS "publicReviewNote",
            clr.reviewed_by AS "reviewedById",
            clr.created_at AS "createdAt", clr.reviewed_at AS "reviewedAt", clr.started_at AS "startedAt", clr.terminated_at AS "terminatedAt", u.name AS "userName", u.username,
            reviewer.name AS "reviewedByName", reviewer.username AS "reviewedByUsername"
     FROM custom_lab_requests clr
     JOIN users u ON u.id = clr.user_id
     LEFT JOIN users reviewer ON reviewer.id = clr.reviewed_by
     ORDER BY clr.created_at DESC, clr.id DESC`
  ))).rows.map(normalizeCustomLabRequestRow);
}
async function pgListCustomLabRequestsByUser(userId) {
  return (await withClient((c) => c.query(
    `SELECT clr.id, clr.user_id AS "userId", clr.status, clr.title, clr.instance_count AS "instanceCount", clr.vcpu,
            clr.ram_gb AS "ramGb", clr.disk_gb AS "diskGb", clr.image_name AS "imageName", clr.usage_period AS "usagePeriod",
            clr.desired_budget AS "desiredBudget", clr.note, clr.advanced_config_json AS "advancedConfigJson", clr.cloud_init_template_name AS "cloudInitTemplateName", clr.quoted_price AS "quotedPrice",
            clr.payment_status AS "paymentStatus", clr.payment_provider AS "paymentProvider", clr.payment_order_id AS "paymentOrderId", clr.payment_key AS "paymentKey",
            clr.payment_requested_at AS "paymentRequestedAt", clr.payment_paid_at AS "paymentPaidAt", clr.payment_failed_at AS "paymentFailedAt", clr.payment_failure_reason AS "paymentFailureReason", clr.review_note AS "reviewNote",
            clr.heat_template_name AS "heatTemplateName", clr.application_yaml_name AS "applicationYamlName",
            clr.stack_name AS "stackName", clr.stack_id AS "stackId", clr.instance_ip AS "instanceIp",
            clr.instance_ips_json AS "instanceIpsJson", clr.vm_nodes_json AS "vmNodesJson",
            clr.error_message AS "errorMessage", clr.terminal_ssh_user AS "terminalSshUser", clr.terminal_ssh_password AS "terminalSshPassword",
            clr.requested_public_domains_json AS "requestedPublicDomainsJson", clr.public_domains_json AS "publicDomainsJson",
            clr.public_enabled AS "publicEnabled", clr.public_request_pending AS "publicRequestPending",
            clr.public_reviewed_by AS "publicReviewedBy", clr.public_reviewed_at AS "publicReviewedAt", clr.public_review_note AS "publicReviewNote",
            clr.reviewed_by AS "reviewedById",
            clr.created_at AS "createdAt", clr.reviewed_at AS "reviewedAt", clr.started_at AS "startedAt", clr.terminated_at AS "terminatedAt", u.name AS "userName", u.username,
            reviewer.name AS "reviewedByName", reviewer.username AS "reviewedByUsername"
     FROM custom_lab_requests clr
     JOIN users u ON u.id = clr.user_id
     LEFT JOIN users reviewer ON reviewer.id = clr.reviewed_by
     WHERE clr.user_id=$1
     ORDER BY clr.created_at DESC, clr.id DESC`, [userId]
  ))).rows.map(normalizeCustomLabRequestRow);
}
async function pgUpdateCustomLabRequestStatus(id, {
  status,
  quotedPrice = "",
  desiredBudget = null,
  reviewNote = "",
  paymentStatus = "",
  paymentProvider = "",
  paymentOrderId = "",
  paymentKey = "",
  paymentRequestedAt = null,
  paymentPaidAt = null,
  paymentFailedAt = null,
  paymentFailureReason = "",
  reviewedBy = null,
  advancedConfig = null,
  cloudInitTemplateName = "",
  heatTemplateName = "",
  applicationYamlName = "",
  stackName = null,
  stackId = null,
  instanceIp = null,
  instanceIps = [],
  vmNodes = [],
  errorMessage = "",
  terminalSshUser = "",
  terminalSshPassword = "",
  startedAt = null,
  terminatedAt = null,
}) {
  await withClient((c) => c.query(
      `UPDATE custom_lab_requests
       SET status=$2, quoted_price=$3, desired_budget=$4, review_note=$5, payment_status=$6, payment_provider=$7, payment_order_id=$8, payment_key=$9, payment_requested_at=$10, payment_paid_at=$11, payment_failed_at=$12, payment_failure_reason=$13, reviewed_by=$14, reviewed_at=CURRENT_TIMESTAMP::text,
           advanced_config_json=$15, cloud_init_template_name=$16, heat_template_name=$17, application_yaml_name=$18, stack_name=$19, stack_id=$20, instance_ip=$21,
           instance_ips_json=$22, vm_nodes_json=$23, error_message=$24, terminal_ssh_user=$25, terminal_ssh_password=$26,
           started_at=COALESCE($27, started_at), terminated_at=COALESCE($28, terminated_at)
       WHERE id=$1`,
      [id, status, quotedPrice, desiredBudget ?? 0, reviewNote, paymentStatus, paymentProvider, paymentOrderId, paymentKey, paymentRequestedAt, paymentPaidAt, paymentFailedAt, paymentFailureReason, reviewedBy, JSON.stringify(advancedConfig ?? {}), cloudInitTemplateName, heatTemplateName, applicationYamlName, stackName, stackId, instanceIp, JSON.stringify(instanceIps || []), JSON.stringify(vmNodes || []), errorMessage, terminalSshUser, terminalSshPassword, startedAt, terminatedAt],
    ));
  return pgFindCustomLabRequestById(id);
}
async function pgUpdateCustomLabRequest(id, patch) {
  const current = await pgFindCustomLabRequestById(id);
  if (!current) return null;
  await withClient((c) => c.query(
      `UPDATE custom_lab_requests
       SET status=$2, quoted_price=$3, desired_budget=$4, review_note=$5, payment_status=$6, payment_provider=$7, payment_order_id=$8, payment_key=$9, payment_requested_at=$10, payment_paid_at=$11, payment_failed_at=$12, payment_failure_reason=$13, reviewed_by=$14, reviewed_at=$15,
           advanced_config_json=$16, cloud_init_template_name=$17, heat_template_name=$18, application_yaml_name=$19, stack_name=$20, stack_id=$21, instance_ip=$22,
           instance_ips_json=$23, vm_nodes_json=$24, error_message=$25, terminal_ssh_user=$26, terminal_ssh_password=$27,
           requested_public_domains_json=$28, public_domains_json=$29, public_enabled=$30, public_request_pending=$31,
           public_reviewed_by=$32, public_reviewed_at=$33, public_review_note=$34, started_at=$35, terminated_at=$36
       WHERE id=$1`,
    [
      id,
      patch.status ?? current.status,
      patch.quotedPrice ?? current.quotedPrice ?? "",
      patch.desiredBudget ?? current.desiredBudget ?? 0,
      patch.reviewNote ?? current.reviewNote ?? "",
      patch.paymentStatus ?? current.paymentStatus ?? "",
      patch.paymentProvider ?? current.paymentProvider ?? "",
      patch.paymentOrderId ?? current.paymentOrderId ?? "",
      patch.paymentKey ?? current.paymentKey ?? "",
      patch.paymentRequestedAt ?? current.paymentRequestedAt ?? null,
      patch.paymentPaidAt ?? current.paymentPaidAt ?? null,
      patch.paymentFailedAt ?? current.paymentFailedAt ?? null,
      patch.paymentFailureReason ?? current.paymentFailureReason ?? "",
      patch.reviewedBy ?? current.reviewedById ?? null,
      patch.reviewedAt ?? current.reviewedAt ?? null,
      JSON.stringify(patch.advancedConfig ?? current.advancedConfig ?? {}),
      patch.cloudInitTemplateName ?? current.cloudInitTemplateName ?? "",
      patch.heatTemplateName ?? current.heatTemplateName ?? "",
      patch.applicationYamlName ?? current.applicationYamlName ?? "",
      patch.stackName ?? current.stackName ?? null,
      patch.stackId ?? current.stackId ?? null,
      patch.instanceIp ?? current.instanceIp ?? null,
      JSON.stringify(Array.isArray(patch.instanceIps) ? patch.instanceIps : current.instanceIps || []),
      JSON.stringify(Array.isArray(patch.vmNodes) ? patch.vmNodes : current.vmNodes || []),
      patch.errorMessage ?? current.errorMessage ?? "",
      patch.terminalSshUser ?? current.terminalSshUser ?? "",
      patch.terminalSshPassword ?? current.terminalSshPassword ?? "",
      JSON.stringify(coerceDomainPatchList(patch.requestedPublicDomains, current.requestedPublicDomains || [])),
      JSON.stringify(coerceDomainPatchList(patch.publicDomains, current.publicDomains || [])),
      (patch.publicEnabled ?? current.publicEnabled) ? 1 : 0,
      (patch.publicRequestPending ?? current.publicRequestPending) ? 1 : 0,
      patch.publicReviewedBy ?? current.publicReviewedBy ?? "",
      patch.publicReviewedAt ?? current.publicReviewedAt ?? null,
      patch.publicReviewNote ?? current.publicReviewNote ?? "",
      patch.startedAt ?? current.startedAt ?? null,
      patch.terminatedAt ?? current.terminatedAt ?? null,
      ],
  ));
  return pgFindCustomLabRequestById(id);
}
async function pgCreateSelfServiceVm(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "self_service_vms");
    await c.query(
        `INSERT INTO self_service_vms
         (id,user_id,status,instance_count,flavor,project_name,network_name,image_name,cloud_init_template_name,cloud_init_custom_content,cloud_init_custom_file_name,boot_from_volume,boot_volume_size_gb,boot_volume_type,data_volume_enabled,data_volume_count,data_volume_size_gb,data_volume_type,floating_ip_requested,public_access_note,stack_name,stack_id,instance_ip,instance_ips_json,vm_nodes_json,error_message,review_note,reviewed_by,created_at,started_at,terminated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,CURRENT_TIMESTAMP::text,$29,$30)`,
        [id, input.userId, input.status || "requested", input.instanceCount ?? 1, input.flavor, String(input.projectName || "").trim(), String(input.networkName || "net-infra").trim() || "net-infra", String(input.imageName || "").trim(), input.cloudInitTemplateName ?? "", input.cloudInitCustomContent ?? "", input.cloudInitCustomFileName ?? "", Number(Boolean(input.bootFromVolume)), input.bootVolumeSizeGb ?? 20, input.bootVolumeType ?? "", Number(Boolean(input.dataVolumeEnabled)), input.dataVolumeCount ?? 0, input.dataVolumeSizeGb ?? 0, input.dataVolumeType ?? "", Number(Boolean(input.floatingIpRequested)), input.publicAccessNote ?? "", input.stackName ?? null, input.stackId ?? null, input.instanceIp ?? null, JSON.stringify(input.instanceIps || []), JSON.stringify(input.vmNodes || []), input.errorMessage ?? null, input.reviewNote ?? null, input.reviewedBy ?? null, input.startedAt ?? null, input.terminatedAt ?? null],
      );
    return normalizeSelfServiceVmRow((await c.query(
      `SELECT ssv.*, u.name AS "userName", u.username
       FROM self_service_vms ssv JOIN users u ON u.id=ssv.user_id WHERE ssv.id=$1`, [id]
    )).rows[0] || null);
  });
}
async function pgFindSelfServiceVmById(id, options = {}) {
  return normalizeSelfServiceVmRow((await withClient((c) => c.query(
    `SELECT ssv.*, u.name AS "userName", u.username
     FROM self_service_vms ssv JOIN users u ON u.id=ssv.user_id WHERE ssv.id=$1`, [id]
  ))).rows[0] || null, options);
}
async function pgFindActiveSelfServiceVmByUserId(userId) {
  return normalizeSelfServiceVmRow((await withClient((c) => c.query(
    `SELECT ssv.*, u.name AS "userName", u.username
     FROM self_service_vms ssv JOIN users u ON u.id=ssv.user_id
     WHERE ssv.user_id=$1 AND ssv.status IN ('requested','approved','provisioning','running','terminating')
     ORDER BY ssv.created_at DESC, ssv.id DESC LIMIT 1`, [userId]
  ))).rows[0] || null);
}
async function pgListSelfServiceVms() {
  return (await withClient((c) => c.query(
    `SELECT ssv.*, u.name AS "userName", u.username
     FROM self_service_vms ssv JOIN users u ON u.id=ssv.user_id
     ORDER BY ssv.created_at DESC, ssv.id DESC`
  ))).rows.map(normalizeSelfServiceVmRow);
}
async function pgListSelfServiceVmsByUser(userId) {
  return (await withClient((c) => c.query(
    `SELECT ssv.*, u.name AS "userName", u.username
     FROM self_service_vms ssv JOIN users u ON u.id=ssv.user_id
     WHERE ssv.user_id=$1
     ORDER BY ssv.created_at DESC, ssv.id DESC`, [userId]
  ))).rows.map(normalizeSelfServiceVmRow);
}
async function pgUpdateSelfServiceVm(id, patch) {
  const current = await pgFindSelfServiceVmById(id, { includeCloudInitCustomContent: true });
  if (!current) return null;
  const hasPatch = (key) => Object.prototype.hasOwnProperty.call(patch || {}, key);
  await withClient((c) => c.query(
      `UPDATE self_service_vms
       SET status=$2, instance_count=$3, flavor=$4, project_name=$5, network_name=$6, image_name=$7, cloud_init_template_name=$8, cloud_init_custom_content=$9,
           cloud_init_custom_file_name=$10, boot_from_volume=$11, boot_volume_size_gb=$12, boot_volume_type=$13, data_volume_enabled=$14, data_volume_count=$15,
           data_volume_size_gb=$16, data_volume_type=$17, floating_ip_requested=$18, public_access_note=$19,
           external_ssh_enabled=$20, external_ssh_port=$21, external_ssh_request_pending=$22, external_ssh_reviewed_by=$23, external_ssh_reviewed_at=$24, external_ssh_review_note=$25,
           stack_name=$26, stack_id=$27, instance_ip=$28, instance_ips_json=$29, vm_nodes_json=$30, error_message=$31, review_note=$32, reviewed_by=$33, started_at=$34, terminated_at=$35
       WHERE id=$1`,
      [
        id,
        patch.status ?? current.status,
        patch.instanceCount ?? current.instanceCount,
        patch.flavor ?? current.flavor,
        patch.projectName ?? current.projectName ?? "",
        patch.networkName ?? current.networkName ?? "net-infra",
        patch.imageName ?? current.imageName ?? "",
        patch.cloudInitTemplateName ?? current.cloudInitTemplateName ?? "",
        patch.cloudInitCustomContent ?? current.cloudInitCustomContent ?? "",
        patch.cloudInitCustomFileName ?? current.cloudInitCustomFileName ?? "",
        (patch.bootFromVolume ?? current.bootFromVolume) ? 1 : 0,
        patch.bootVolumeSizeGb ?? current.bootVolumeSizeGb ?? 20,
        patch.bootVolumeType ?? current.bootVolumeType ?? "",
        (patch.dataVolumeEnabled ?? current.dataVolumeEnabled) ? 1 : 0,
        patch.dataVolumeCount ?? current.dataVolumeCount ?? 0,
        patch.dataVolumeSizeGb ?? current.dataVolumeSizeGb ?? 0,
        patch.dataVolumeType ?? current.dataVolumeType ?? "",
        (patch.floatingIpRequested ?? current.floatingIpRequested) ? 1 : 0,
        patch.publicAccessNote ?? current.publicAccessNote ?? "",
        (patch.externalSshEnabled ?? current.externalSshEnabled) ? 1 : 0,
        hasPatch("externalSshPort") ? patch.externalSshPort : current.externalSshPort ?? null,
        (patch.externalSshRequestPending ?? current.externalSshRequestPending) ? 1 : 0,
        patch.externalSshReviewedBy ?? current.externalSshReviewedBy ?? "",
        hasPatch("externalSshReviewedAt") ? patch.externalSshReviewedAt : current.externalSshReviewedAt ?? null,
        patch.externalSshReviewNote ?? current.externalSshReviewNote ?? "",
        patch.stackName ?? current.stackName,
        patch.stackId ?? current.stackId,
        patch.instanceIp ?? current.instanceIp,
        JSON.stringify(patch.instanceIps ?? current.instanceIps ?? []),
        JSON.stringify(patch.vmNodes ?? current.vmNodes ?? []),
        patch.errorMessage ?? current.errorMessage,
        patch.reviewNote ?? current.reviewNote,
        patch.reviewedBy ?? current.reviewedBy,
        patch.startedAt ?? current.startedAt,
        patch.terminatedAt ?? current.terminatedAt,
      ],
    ));
  return pgFindSelfServiceVmById(id);
}
const SELF_SERVICE_PROJECT_REQUEST_SELECT = `
  SELECT spr.id, spr.user_id AS "userId", spr.status,
         spr.requested_project_name AS "requestedProjectName", spr.project_name AS "projectName",
         spr.network_name AS "networkName", spr.subnet_cidr AS "subnetCidr",
         spr.network_requests_json AS "networkRequestsJson",
         spr.quota_profile_id AS "quotaProfileId", spr.requested_quota_json AS "requestedQuotaJson",
         spr.note, spr.review_note AS "reviewNote", spr.reviewed_by AS "reviewedBy",
         spr.created_at AS "createdAt", spr.reviewed_at AS "reviewedAt",
         u.name AS "userName", u.username,
         reviewer.name AS "reviewedByName", reviewer.username AS "reviewedByUsername"
  FROM self_service_project_requests spr
  JOIN users u ON u.id = spr.user_id
  LEFT JOIN users reviewer ON reviewer.id = spr.reviewed_by
`;
async function pgCreateSelfServiceProjectRequest(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "self_service_project_requests");
    await c.query(
      `INSERT INTO self_service_project_requests
       (id,user_id,status,requested_project_name,project_name,network_name,subnet_cidr,network_requests_json,quota_profile_id,requested_quota_json,note,review_note,reviewed_by,created_at,reviewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP::text,$14)`,
      [id, input.userId, input.status || "requested", String(input.requestedProjectName || "").trim(), String(input.projectName || "").trim(), String(input.networkName || "").trim(), String(input.subnetCidr || "").trim(), JSON.stringify(Array.isArray(input.networkRequests) ? input.networkRequests : []), String(input.quotaProfileId || "basic").trim() || "basic", JSON.stringify(input.requestedQuota && typeof input.requestedQuota === "object" ? input.requestedQuota : {}), input.note || "", input.reviewNote || "", input.reviewedBy ?? null, input.reviewedAt ?? null],
    );
    return normalizeSelfServiceProjectRequestRow((await c.query(
      `${SELF_SERVICE_PROJECT_REQUEST_SELECT} WHERE spr.id=$1`, [id],
    )).rows[0] || null);
  });
}
async function pgFindSelfServiceProjectRequestById(id) {
  return normalizeSelfServiceProjectRequestRow((await withClient((c) => c.query(
    `${SELF_SERVICE_PROJECT_REQUEST_SELECT} WHERE spr.id=$1`, [id],
  ))).rows[0] || null);
}
async function pgListSelfServiceProjectRequests() {
  return (await withClient((c) => c.query(
    `${SELF_SERVICE_PROJECT_REQUEST_SELECT} ORDER BY spr.created_at DESC, spr.id DESC`,
  ))).rows.map(normalizeSelfServiceProjectRequestRow);
}
async function pgListSelfServiceProjectRequestsByUser(userId) {
  return (await withClient((c) => c.query(
    `${SELF_SERVICE_PROJECT_REQUEST_SELECT} WHERE spr.user_id=$1 ORDER BY spr.created_at DESC, spr.id DESC`, [userId],
  ))).rows.map(normalizeSelfServiceProjectRequestRow);
}
async function pgUpdateSelfServiceProjectRequest(id, patch) {
  const current = await pgFindSelfServiceProjectRequestById(id);
  if (!current) return null;
  await withClient((c) => c.query(
    `UPDATE self_service_project_requests
     SET status=$2, requested_project_name=$3, project_name=$4, network_name=$5, subnet_cidr=$6, note=$7, review_note=$8,
         reviewed_by=$9, reviewed_at=$10, network_requests_json=$11, quota_profile_id=$12, requested_quota_json=$13
     WHERE id=$1`,
    [
      id,
      patch.status ?? current.status,
      patch.requestedProjectName ?? current.requestedProjectName,
      patch.projectName ?? current.projectName,
      patch.networkName ?? current.networkName,
      patch.subnetCidr ?? current.subnetCidr,
      patch.note ?? current.note,
      patch.reviewNote ?? current.reviewNote,
      patch.reviewedBy ?? current.reviewedBy,
      patch.reviewedAt ?? current.reviewedAt,
      JSON.stringify(Array.isArray(patch.networkRequests) ? patch.networkRequests : current.networkRequests || []),
      String(patch.quotaProfileId ?? current.quotaProfileId ?? "basic").trim() || "basic",
      JSON.stringify(patch.requestedQuota && typeof patch.requestedQuota === "object" ? patch.requestedQuota : current.requestedQuota || {}),
    ],
  ));
  return pgFindSelfServiceProjectRequestById(id);
}
async function pgDeleteSelfServiceProjectRequests(ids) {
  const values = Array.isArray(ids) ? ids.map((id) => Number(id)).filter(Boolean) : [];
  if (!values.length) return 0;
  return Number((await withClient((c) => c.query(
    `DELETE FROM self_service_project_requests
     WHERE id = ANY($1::bigint[]) AND status IN ('approved','rejected','cancelled','canceled')`,
    [values],
  ))).rowCount || 0);
}
async function pgDeleteSelfServiceVmRecords(ids) {
  const values = Array.isArray(ids) ? ids.map((id) => Number(id)).filter(Boolean) : [];
  if (!values.length) return 0;
  return Number((await withClient((c) => c.query(
    `DELETE FROM self_service_vms
     WHERE id = ANY($1::bigint[]) AND status IN ('failed','terminated')`,
    [values],
  ))).rowCount || 0);
}
async function pgCreateZunContainer(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "zun_containers");
    await c.query(
      `INSERT INTO zun_containers
       (id,user_id,status,project_name,name,image_name,command_text,exposed_port,container_uuid,registry_id,registry_domain,resource_source,resource_preset_id,addresses_json,public_domains_json,error_message,created_at,started_at,stopped_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,CURRENT_TIMESTAMP::text,$17,$18)`,
      [id, input.userId, input.status || "requested", String(input.projectName || "").trim(), input.name, input.imageName, input.commandText || "", input.exposedPort ?? null, input.containerUuid ?? null, String(input.registryId || "").trim(), String(input.registryDomain || "").trim(), String(input.resourceSource || "").trim(), String(input.resourcePresetId || "").trim(), JSON.stringify(input.addresses || []), JSON.stringify(input.publicDomains || []), input.errorMessage ?? null, input.startedAt ?? null, input.stoppedAt ?? null],
    );
    return normalizeZunContainerRow((await c.query(
      `SELECT zc.*, u.name AS "userName", u.username
       FROM zun_containers zc JOIN users u ON u.id=zc.user_id WHERE zc.id=$1`, [id]
    )).rows[0] || null);
  });
}
async function pgFindZunContainerById(id) {
  return normalizeZunContainerRow((await withClient((c) => c.query(
    `SELECT zc.*, u.name AS "userName", u.username
     FROM zun_containers zc JOIN users u ON u.id=zc.user_id WHERE zc.id=$1`, [id]
  ))).rows[0] || null);
}
async function pgListZunContainers() {
  return (await withClient((c) => c.query(
    `SELECT zc.*, u.name AS "userName", u.username
     FROM zun_containers zc JOIN users u ON u.id=zc.user_id
     ORDER BY zc.created_at DESC, zc.id DESC`
  ))).rows.map(normalizeZunContainerRow);
}
async function pgListZunContainersByUser(userId) {
  return (await withClient((c) => c.query(
    `SELECT zc.*, u.name AS "userName", u.username
     FROM zun_containers zc JOIN users u ON u.id=zc.user_id
     WHERE zc.user_id=$1
       AND LOWER(COALESCE(zc.status, '')) <> 'deleted'
     ORDER BY zc.created_at DESC, zc.id DESC`, [userId]
  ))).rows.map(normalizeZunContainerRow);
}
async function pgUpdateZunContainer(id, patch) {
  const current = await pgFindZunContainerById(id);
  if (!current) return null;
  await withClient((c) => c.query(
    `UPDATE zun_containers
     SET status=$2, project_name=$3, name=$4, image_name=$5, command_text=$6, exposed_port=$7, container_uuid=$8,
         registry_id=$9, registry_domain=$10, resource_source=$11, resource_preset_id=$12, addresses_json=$13, public_domains_json=$14, error_message=$15, started_at=$16, stopped_at=$17
     WHERE id=$1`,
    [id, patch.status ?? current.status, patch.projectName ?? current.projectName ?? "", patch.name ?? current.name, patch.imageName ?? current.imageName, patch.commandText ?? current.commandText, patch.exposedPort ?? current.exposedPort, patch.containerUuid ?? current.containerUuid, patch.registryId ?? current.registryId ?? "", patch.registryDomain ?? current.registryDomain ?? "", patch.resourceSource ?? current.resourceSource ?? "", patch.resourcePresetId ?? current.resourcePresetId ?? "", JSON.stringify(patch.addresses ?? current.addresses ?? []), JSON.stringify(coerceDomainPatchList(patch.publicDomains, current.publicDomains || [])), patch.errorMessage ?? current.errorMessage, patch.startedAt ?? current.startedAt, patch.stoppedAt ?? current.stoppedAt],
  ));
  return pgFindZunContainerById(id);
}
async function pgDeleteZunContainer(id) {
  const result = await withClient((c) => c.query(`DELETE FROM zun_containers WHERE id=$1`, [id]));
  return Number(result.rowCount || 0) > 0;
}
async function pgCreateMagnumCluster(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "magnum_clusters");
    await c.query(
      `INSERT INTO magnum_clusters
       (id,user_id,status,project_name,name,cluster_template_id,cluster_template_name,kubernetes_version,node_count,master_count,control_plane_flavor,worker_flavor,cluster_uuid,api_address,api_port,external_api_enabled,external_api_host,external_api_port,status_reason,error_message,created_at,started_at,deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,CURRENT_TIMESTAMP::text,$21,$22)`,
      [
        id,
        input.userId,
        input.status || "requested",
        String(input.projectName || "").trim(),
        input.name,
        input.clusterTemplateId,
        input.clusterTemplateName || "",
        String(input.kubernetesVersion || "").trim(),
        Number(input.nodeCount || 1),
        Number(input.masterCount || 1),
        String(input.controlPlaneFlavor || "").trim(),
        String(input.workerFlavor || "").trim(),
        input.clusterUuid ?? null,
        input.apiAddress || "",
        Number(input.apiPort || 6443),
        input.externalApiEnabled ? 1 : 0,
        String(input.externalApiHost || "").trim(),
        input.externalApiPort ?? null,
        input.statusReason || "",
        input.errorMessage ?? null,
        input.startedAt ?? null,
        input.deletedAt ?? null,
      ],
    );
    return normalizeMagnumClusterRow((await c.query(
      `SELECT mc.*, u.name AS "userName", u.username
       FROM magnum_clusters mc JOIN users u ON u.id=mc.user_id WHERE mc.id=$1`,
      [id],
    )).rows[0] || null);
  });
}
async function pgFindMagnumClusterById(id) {
  return normalizeMagnumClusterRow((await withClient((c) => c.query(
    `SELECT mc.*, u.name AS "userName", u.username
     FROM magnum_clusters mc JOIN users u ON u.id=mc.user_id WHERE mc.id=$1`,
    [id],
  ))).rows[0] || null);
}
async function pgListMagnumClusters() {
  return (await withClient((c) => c.query(
    `SELECT mc.*, u.name AS "userName", u.username
     FROM magnum_clusters mc JOIN users u ON u.id=mc.user_id
     WHERE LOWER(COALESCE(mc.status, '')) NOT IN ('deleted', 'delete_complete')
     ORDER BY mc.created_at DESC, mc.id DESC`
  ))).rows.map(normalizeMagnumClusterRow);
}
async function pgListMagnumClustersByUser(userId) {
  return (await withClient((c) => c.query(
    `SELECT mc.*, u.name AS "userName", u.username
     FROM magnum_clusters mc JOIN users u ON u.id=mc.user_id
     WHERE mc.user_id=$1
       AND LOWER(COALESCE(mc.status, '')) <> 'deleted'
     ORDER BY mc.created_at DESC, mc.id DESC`,
    [userId],
  ))).rows.map(normalizeMagnumClusterRow);
}
async function pgUpdateMagnumCluster(id, patch) {
  const current = await pgFindMagnumClusterById(id);
  if (!current) return null;
  await withClient((c) => c.query(
    `UPDATE magnum_clusters
     SET status=$2, project_name=$3, name=$4, cluster_template_id=$5, cluster_template_name=$6, kubernetes_version=$7, node_count=$8, master_count=$9,
         control_plane_flavor=$10, worker_flavor=$11, cluster_uuid=$12, api_address=$13, api_port=$14, external_api_enabled=$15, external_api_host=$16, external_api_port=$17,
         status_reason=$18, error_message=$19, started_at=$20, deleted_at=$21
     WHERE id=$1`,
    [
      id,
      patch.status ?? current.status,
      patch.projectName ?? current.projectName ?? "",
      patch.name ?? current.name,
      patch.clusterTemplateId ?? current.clusterTemplateId,
      patch.clusterTemplateName ?? current.clusterTemplateName,
      patch.kubernetesVersion ?? current.kubernetesVersion ?? "",
      patch.nodeCount ?? current.nodeCount,
      patch.masterCount ?? current.masterCount,
      patch.controlPlaneFlavor ?? current.controlPlaneFlavor ?? "",
      patch.workerFlavor ?? current.workerFlavor ?? "",
      patch.clusterUuid ?? current.clusterUuid,
      patch.apiAddress ?? current.apiAddress,
      patch.apiPort ?? current.apiPort ?? 6443,
      patch.externalApiEnabled != null ? (patch.externalApiEnabled ? 1 : 0) : (current.externalApiEnabled ? 1 : 0),
      patch.externalApiHost ?? current.externalApiHost ?? "",
      Object.prototype.hasOwnProperty.call(patch, "externalApiPort") ? patch.externalApiPort : current.externalApiPort,
      patch.statusReason ?? current.statusReason,
      patch.errorMessage ?? current.errorMessage,
      patch.startedAt ?? current.startedAt,
      patch.deletedAt ?? current.deletedAt,
    ],
  ));
  return pgFindMagnumClusterById(id);
}
async function pgDeleteMagnumCluster(id) {
  const result = await withClient((c) => c.query(`DELETE FROM magnum_clusters WHERE id=$1`, [id]));
  return Number(result.rowCount || 0) > 0;
}

async function pgConsumeRequestRateLimit({ key, windowMs, max }) {
  const normalizedWindowMs = Math.max(1000, Math.floor(Number(windowMs || 0) || 1000));
  const normalizedMax = Math.max(1, Math.floor(Number(max || 0) || 1));
  const now = Date.now();
  const expiresAt = now + normalizedWindowMs;
  const keyHash = createHash("sha256").update(String(key || "anonymous")).digest("hex");
  const result = await withClient((client) => client.query(
    `INSERT INTO request_rate_limits (key_hash, window_started_at_ms, expires_at_ms, hit_count, updated_at)
     VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP::text)
     ON CONFLICT (key_hash) DO UPDATE
     SET window_started_at_ms = CASE
           WHEN request_rate_limits.expires_at_ms <= EXCLUDED.window_started_at_ms THEN EXCLUDED.window_started_at_ms
           ELSE request_rate_limits.window_started_at_ms
         END,
         expires_at_ms = CASE
           WHEN request_rate_limits.expires_at_ms <= EXCLUDED.window_started_at_ms THEN EXCLUDED.expires_at_ms
           ELSE request_rate_limits.expires_at_ms
         END,
         hit_count = CASE
           WHEN request_rate_limits.expires_at_ms <= EXCLUDED.window_started_at_ms THEN 1
           ELSE request_rate_limits.hit_count + 1
         END,
         updated_at = CURRENT_TIMESTAMP::text
     RETURNING hit_count, expires_at_ms`,
    [keyHash, now, expiresAt],
  ));
  const row = result.rows[0] || {};
  const count = Number(row.hit_count || 0) || 0;
  return {
    allowed: count <= normalizedMax,
    count,
    max: normalizedMax,
    retryAfterMs: Math.max(0, Number(row.expires_at_ms || expiresAt) - now),
  };
}

async function pgDeleteExpiredRequestRateLimits(cutoffMs = Date.now()) {
  const result = await withClient((client) => client.query(
    `DELETE FROM request_rate_limits WHERE expires_at_ms < $1`,
    [Math.floor(Number(cutoffMs || Date.now()) || Date.now())],
  ));
  return Number(result.rowCount || 0);
}
async function pgCreateTroveInstance(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "trove_instances");
    await c.query(
      `INSERT INTO trove_instances
       (id,user_id,status,project_name,name,datastore_type,datastore_version,flavor,size_gb,instance_uuid,hostname,database_name,database_username,credential_secret_ref,database_port,status_reason,error_message,created_at,started_at,deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,CURRENT_TIMESTAMP::text,$18,$19)`,
      [
        id,
        input.userId,
        input.status || "requested",
        String(input.projectName || "").trim(),
        input.name,
        input.datastoreType,
        input.datastoreVersion || "",
        input.flavor,
        Math.max(1, Number(input.sizeGb || 1) || 1),
        input.instanceUuid ?? null,
        input.hostname || "",
        input.databaseName || "",
        input.databaseUsername || "",
        input.credentialSecretRef || "",
        Number(input.databasePort || 3306) || 3306,
        input.statusReason || "",
        input.errorMessage ?? null,
        input.startedAt ?? null,
        input.deletedAt ?? null,
      ],
    );
    return normalizeTroveInstanceRow((await c.query(
      `SELECT ti.*, u.name AS "userName", u.username
       FROM trove_instances ti JOIN users u ON u.id=ti.user_id WHERE ti.id=$1`,
      [id],
    )).rows[0] || null);
  });
}
async function pgFindTroveInstanceById(id) {
  return normalizeTroveInstanceRow((await withClient((c) => c.query(
    `SELECT ti.*, u.name AS "userName", u.username
     FROM trove_instances ti JOIN users u ON u.id=ti.user_id WHERE ti.id=$1`,
    [id],
  ))).rows[0] || null);
}
async function pgListTroveInstances() {
  return (await withClient((c) => c.query(
    `SELECT ti.*, u.name AS "userName", u.username
     FROM trove_instances ti JOIN users u ON u.id=ti.user_id
     WHERE LOWER(COALESCE(ti.status, '')) <> 'deleted'
     ORDER BY ti.created_at DESC, ti.id DESC`,
  ))).rows.map(normalizeTroveInstanceRow);
}
async function pgListTroveInstancesByUser(userId) {
  return (await withClient((c) => c.query(
    `SELECT ti.*, u.name AS "userName", u.username
     FROM trove_instances ti JOIN users u ON u.id=ti.user_id
     WHERE ti.user_id=$1
       AND LOWER(COALESCE(ti.status, '')) <> 'deleted'
     ORDER BY ti.created_at DESC, ti.id DESC`,
    [userId],
  ))).rows.map(normalizeTroveInstanceRow);
}
async function pgUpdateTroveInstance(id, patch) {
  const current = await pgFindTroveInstanceById(id);
  if (!current) return null;
  await withClient((c) => c.query(
    `UPDATE trove_instances
     SET status=$2, project_name=$3, name=$4, datastore_type=$5, datastore_version=$6, flavor=$7, size_gb=$8,
         instance_uuid=$9, hostname=$10, database_name=$11, database_username=$12, credential_secret_ref=$13,
         database_port=$14, status_reason=$15, error_message=$16, started_at=$17, deleted_at=$18
     WHERE id=$1`,
    [
      id,
      patch.status ?? current.status,
      patch.projectName ?? current.projectName ?? "",
      patch.name ?? current.name,
      patch.datastoreType ?? current.datastoreType,
      patch.datastoreVersion ?? current.datastoreVersion,
      patch.flavor ?? current.flavor,
      patch.sizeGb ?? current.sizeGb,
      patch.instanceUuid ?? current.instanceUuid,
      patch.hostname ?? current.hostname,
      patch.databaseName ?? current.databaseName,
      patch.databaseUsername ?? current.databaseUsername,
      patch.credentialSecretRef ?? current.credentialSecretRef,
      patch.databasePort ?? current.databasePort ?? 3306,
      patch.statusReason ?? current.statusReason,
      patch.errorMessage ?? current.errorMessage,
      patch.startedAt ?? current.startedAt,
      patch.deletedAt ?? current.deletedAt,
    ],
  ));
  return pgFindTroveInstanceById(id);
}
async function pgDeleteTroveInstance(id) {
  const result = await withClient((c) => c.query(`DELETE FROM trove_instances WHERE id=$1`, [id]));
  return Number(result.rowCount || 0) > 0;
}
async function pgCreateResourceDeletionJob(input = {}) {
  const resourceType = String(input.resourceType || "").trim();
  const resourceId = String(input.resourceId || "").trim();
  const id = String(input.id || (resourceType && resourceId ? `${resourceType}:${resourceId}` : randomUUID()));
  const now = new Date().toISOString();
  await withClient((c) => c.query(
    `INSERT INTO resource_deletion_jobs
     (id,resource_type,resource_id,user_id,project_name,resource_name,remote_id,status,attempts,last_error,metadata_json,created_at,updated_at,completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13)
     ON CONFLICT (id) DO UPDATE SET user_id=EXCLUDED.user_id,project_name=EXCLUDED.project_name,resource_name=EXCLUDED.resource_name,
       remote_id=EXCLUDED.remote_id,status=EXCLUDED.status,attempts=EXCLUDED.attempts,last_error=EXCLUDED.last_error,
       metadata_json=EXCLUDED.metadata_json,updated_at=EXCLUDED.updated_at,completed_at=EXCLUDED.completed_at`,
    [id,resourceType,resourceId,input.userId??null,String(input.projectName||""),String(input.resourceName||""),String(input.remoteId||""),String(input.status||"pending"),Number(input.attempts||0),String(input.lastError||""),JSON.stringify(input.metadata||{}),now,input.completedAt??null],
  ));
  return pgFindResourceDeletionJob(id);
}
async function pgFindResourceDeletionJob(id) {
  return normalizeResourceDeletionJobRow((await withClient((c) => c.query(`SELECT * FROM resource_deletion_jobs WHERE id=$1`, [String(id)]))).rows[0] || null);
}
async function pgUpdateResourceDeletionJob(id, patch = {}) {
  const current = await pgFindResourceDeletionJob(id);
  if (!current) return null;
  await withClient((c) => c.query(
    `UPDATE resource_deletion_jobs SET status=$2,attempts=$3,last_error=$4,metadata_json=$5,updated_at=$6,completed_at=$7 WHERE id=$1`,
    [String(id),patch.status??current.status,patch.attempts??current.attempts,patch.lastError??current.lastError,JSON.stringify(patch.metadata??current.metadata??{}),new Date().toISOString(),Object.prototype.hasOwnProperty.call(patch,"completedAt")?patch.completedAt:current.completedAt],
  ));
  return pgFindResourceDeletionJob(id);
}
async function pgListResourceDeletionJobs({ activeOnly = false, limit = 200 } = {}) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit || 200) || 200));
  const where = activeOnly ? `WHERE status IN ('pending','accepted','retrying','failed')` : "";
  return (await withClient((c) => c.query(`SELECT * FROM resource_deletion_jobs ${where} ORDER BY updated_at DESC LIMIT $1`, [safeLimit]))).rows.map(normalizeResourceDeletionJobRow);
}
async function pgCreateCloudConsoleAction(input) {
  return withTx(async(c)=>{const id=await nextId(c,"cloud_console_actions");await c.query(
    `INSERT INTO cloud_console_actions (id,user_id,project_name,operation,request_json,status,estimated_monthly_cost,result_json,error_message,created_at,reviewed_by,reviewed_at,executed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP::text,$10,$11,$12)`,
    [id,input.userId,String(input.projectName||"").trim(),String(input.operation||""),JSON.stringify(input.request||{}),input.status||"requested",Math.max(0,Number(input.estimatedMonthlyCost||0)||0),JSON.stringify(input.result||{}),String(input.errorMessage||""),input.reviewedBy??null,input.reviewedAt??null,input.executedAt??null]);
    const row=(await c.query(`SELECT a.*,u.name AS "userName",u.username FROM cloud_console_actions a JOIN users u ON u.id=a.user_id WHERE a.id=$1`,[Number(id)])).rows[0]||null;
    return normalizeCloudConsoleActionRow(row);
  });
}
async function pgFindCloudConsoleActionById(id){return normalizeCloudConsoleActionRow((await withClient(c=>c.query(`SELECT a.*,u.name AS "userName",u.username FROM cloud_console_actions a JOIN users u ON u.id=a.user_id WHERE a.id=$1`,[Number(id)]))).rows[0]||null);}
async function pgListCloudConsoleActions(userId=null){const q=userId==null?{text:`SELECT a.*,u.name AS "userName",u.username FROM cloud_console_actions a JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC,a.id DESC`,values:[]}:{text:`SELECT a.*,u.name AS "userName",u.username FROM cloud_console_actions a JOIN users u ON u.id=a.user_id WHERE a.user_id=$1 ORDER BY a.created_at DESC,a.id DESC`,values:[Number(userId)]};return (await withClient(c=>c.query(q.text,q.values))).rows.map(normalizeCloudConsoleActionRow);}
async function pgUpdateCloudConsoleAction(id,patch){const current=await pgFindCloudConsoleActionById(id);if(!current)return null;await withClient(c=>c.query(`UPDATE cloud_console_actions SET status=$2,result_json=$3,error_message=$4,reviewed_by=$5,reviewed_at=$6,executed_at=$7 WHERE id=$1`,[Number(id),patch.status??current.status,JSON.stringify(patch.result??current.result??{}),patch.errorMessage??current.errorMessage,patch.reviewedBy??current.reviewedBy,patch.reviewedAt??current.reviewedAt,patch.executedAt??current.executedAt]));return pgFindCloudConsoleActionById(id);}

async function pgGetInternalImageCacheStatus({ registryUrl = "", namespace = "" } = {}) {
  const normalizedRegistryUrl = String(registryUrl || "").trim();
  const normalizedNamespace = String(namespace || "").trim();
  const row = (await withClient((c) => c.query(
    `SELECT COUNT(*)::int AS count, MAX(cached_at) AS "cachedAt"
     FROM internal_image_cache
     WHERE registry_url=$1 AND namespace=$2`,
    [normalizedRegistryUrl, normalizedNamespace],
  ))).rows[0] || {};
  return {
    registryUrl: normalizedRegistryUrl,
    namespace: normalizedNamespace,
    count: Number(row.count || 0) || 0,
    cachedAt: row.cachedAt || "",
  };
}
async function pgListInternalImageCache({ registryUrl = "", namespace = "", query = "", limit = 30 } = {}) {
  const normalizedRegistryUrl = String(registryUrl || "").trim();
  const normalizedNamespace = String(namespace || "").trim();
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const maxLimit = Math.max(1, Math.min(100, Number(limit || 30) || 30));
  const params = [normalizedRegistryUrl, normalizedNamespace];
  let where = `registry_url=$1 AND namespace=$2`;
  if (normalizedQuery) {
    params.push(`%${normalizedQuery}%`);
    where += ` AND (LOWER(repository) LIKE $${params.length} OR LOWER(tag) LIKE $${params.length} OR LOWER(image_name) LIKE $${params.length})`;
  }
  params.push(maxLimit);
  const rows = (await withClient((c) => c.query(
    `SELECT id, registry_url, namespace, repository, tag, image_name, source,
            artifact_digest, pushed_at, cached_at, metadata_json
     FROM internal_image_cache
     WHERE ${where}
     ORDER BY repository ASC, tag ASC
     LIMIT $${params.length}`,
    params,
  ))).rows;
  return rows.map(normalizeInternalImageCacheRow).filter(Boolean);
}
async function pgReplaceInternalImageCache({ registryUrl = "", namespace = "", images = [], cachedAt = new Date().toISOString() } = {}) {
  const normalizedRegistryUrl = String(registryUrl || "").trim();
  const normalizedNamespace = String(namespace || "").trim();
  const rows = Array.isArray(images) ? images : [];
  return withTx(async (c) => {
    await c.query(`DELETE FROM internal_image_cache WHERE registry_url=$1 AND namespace=$2`, [normalizedRegistryUrl, normalizedNamespace]);
    await c.query(`LOCK TABLE internal_image_cache IN EXCLUSIVE MODE`);
    const idRow = (await c.query(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM internal_image_cache`)).rows[0] || {};
    let nextCacheId = Number(idRow.id || 1) || 1;
    let inserted = 0;
    for (const item of rows) {
      const repository = String(item?.repository || "").trim();
      const tag = String(item?.tag || "latest").trim() || "latest";
      const imageName = String(item?.imageName || item?.name || "").trim();
      if (!repository || !imageName) continue;
      const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
      await c.query(
        `INSERT INTO internal_image_cache
           (id, registry_url, namespace, repository, tag, image_name, source,
            artifact_digest, pushed_at, cached_at, metadata_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (registry_url, namespace, repository, tag) DO UPDATE SET
           image_name=EXCLUDED.image_name,
           source=EXCLUDED.source,
           artifact_digest=EXCLUDED.artifact_digest,
           pushed_at=EXCLUDED.pushed_at,
           cached_at=EXCLUDED.cached_at,
           metadata_json=EXCLUDED.metadata_json`,
        [
          nextCacheId,
          normalizedRegistryUrl,
          normalizedNamespace,
          repository,
          tag,
          imageName,
          String(item?.source || "harbor-cache").trim() || "harbor-cache",
          String(item?.artifactDigest || item?.digest || "").trim(),
          String(item?.pushedAt || item?.pushTime || "").trim(),
          cachedAt,
          JSON.stringify(metadata),
        ],
      );
      nextCacheId += 1;
      inserted += 1;
    }
    return {
      registryUrl: normalizedRegistryUrl,
      namespace: normalizedNamespace,
      cachedAt,
      count: inserted,
    };
  });
}
async function pgListWrittenExamAttempts() {
  return (await withClient((c) => c.query(`
    SELECT id, course_id AS "courseId", exam_title AS "examTitle", user_id AS "userId",
           user_name AS "userName", username, answers_json AS "answersJson",
           score, total_points AS "totalPoints", passed, results_json AS "resultsJson",
           submitted_at AS "submittedAt"
    FROM written_exam_attempts
    ORDER BY submitted_at DESC, id DESC
  `))).rows.map(normalizeWrittenExamAttemptRow);
}
async function pgAppendWrittenExamAttempt(input) {
  const entry = {
    id: String(input.id),
    courseId: Number(input.courseId),
    examTitle: input.examTitle || "",
    userId: Number(input.userId),
    userName: input.userName || "",
    username: input.username || "",
    answersJson: JSON.stringify(input.answers || {}),
    score: Number(input.score || 0),
    totalPoints: Number(input.totalPoints || 0),
    passed: input.passed ? 1 : 0,
    resultsJson: JSON.stringify(input.results || []),
    submittedAt: input.submittedAt,
  };
  await withClient((c) => c.query(`
    INSERT INTO written_exam_attempts (
      id, course_id, exam_title, user_id, user_name, username,
      answers_json, score, total_points, passed, results_json, submitted_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [
    entry.id, entry.courseId, entry.examTitle, entry.userId, entry.userName, entry.username,
    entry.answersJson, entry.score, entry.totalPoints, entry.passed, entry.resultsJson, entry.submittedAt,
  ]));
  return normalizeWrittenExamAttemptRow(entry);
}
async function pgListLabExamAttempts() {
  return (await withClient((c) => c.query(`
    SELECT id, course_id AS "courseId", exam_title AS "examTitle", user_id AS "userId",
             user_name AS "userName", username, session_id AS "sessionId", lab_request_id AS "labRequestId",
             exit_code AS "exitCode", stdout_text AS "stdoutText", stderr_text AS "stderrText",
             score, total_points AS "totalPoints", passed, messages_json AS "messagesJson",
             screenshot_path AS "screenshotPath", screenshot_url AS "screenshotUrl",
             result_snapshot_json AS "resultSnapshotJson",
             review_status AS "reviewStatus", review_note AS "reviewNote",
             reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt",
             review_history_json AS "reviewHistoryJson",
             result_mail_sent_at AS "resultMailSentAt",
             submitted_at AS "submittedAt"
    FROM lab_exam_attempts
    ORDER BY submitted_at DESC, id DESC
  `))).rows.map(normalizeLabExamAttemptRow);
}
async function pgAppendLabExamAttempt(input) {
  const entry = {
    id: String(input.id),
    courseId: Number(input.courseId),
    examTitle: input.examTitle || "",
    userId: Number(input.userId),
    userName: input.userName || "",
    username: input.username || "",
    sessionId: String(input.sessionId || "").trim(),
    labRequestId: input.labRequestId != null ? Number(input.labRequestId) : null,
    exitCode: Number(input.exitCode ?? 1),
    stdoutText: input.stdoutText || "",
    stderrText: input.stderrText || "",
      score: Number(input.score || 0),
      totalPoints: Number(input.totalPoints || 0),
      passed: input.passed ? 1 : 0,
      messagesJson: JSON.stringify(input.messages || []),
      screenshotPath: input.screenshotPath || "",
      screenshotUrl: input.screenshotUrl || "",
      resultSnapshotJson: JSON.stringify(input.resultSnapshot || {}),
      reviewStatus: input.reviewStatus || "pending",
      reviewNote: input.reviewNote || "",
      reviewedBy: input.reviewedBy != null ? Number(input.reviewedBy) : null,
      reviewedAt: input.reviewedAt || null,
      reviewHistoryJson: JSON.stringify(input.reviewHistory || []),
      resultMailSentAt: input.resultMailSentAt || null,
      submittedAt: input.submittedAt,
    };
    await withClient((c) => c.query(`
      INSERT INTO lab_exam_attempts (
        id, course_id, exam_title, user_id, user_name, username, session_id, lab_request_id,
        exit_code, stdout_text, stderr_text, score, total_points, passed, messages_json,
        screenshot_path, screenshot_url, result_snapshot_json, review_status, review_note,
        reviewed_by, reviewed_at, review_history_json, result_mail_sent_at, submitted_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
    `, [
      entry.id, entry.courseId, entry.examTitle, entry.userId, entry.userName, entry.username, entry.sessionId || null, entry.labRequestId,
      entry.exitCode, entry.stdoutText, entry.stderrText, entry.score, entry.totalPoints, entry.passed, entry.messagesJson,
      entry.screenshotPath, entry.screenshotUrl, entry.resultSnapshotJson, entry.reviewStatus, entry.reviewNote,
      entry.reviewedBy, entry.reviewedAt, entry.reviewHistoryJson, entry.resultMailSentAt, entry.submittedAt,
    ]));
  return normalizeLabExamAttemptRow(entry);
}
async function pgUpdateLabExamAttempt(id, patch) {
  const attemptId = String(id || "").trim();
  if (!attemptId) return null;
  const current = normalizeLabExamAttemptRow((await withClient((c) => c.query(`SELECT * FROM lab_exam_attempts WHERE id=$1`, [attemptId]))).rows[0] || null);
  if (!current) return null;
  const next = {
    examTitle: patch.examTitle !== undefined ? patch.examTitle : current.examTitle,
    sessionId: patch.sessionId !== undefined ? patch.sessionId : current.sessionId,
    labRequestId: patch.labRequestId !== undefined ? patch.labRequestId : current.labRequestId,
    exitCode: patch.exitCode !== undefined ? Number(patch.exitCode ?? 1) : current.exitCode,
    stdoutText: patch.stdoutText !== undefined ? patch.stdoutText : current.stdoutText,
    stderrText: patch.stderrText !== undefined ? patch.stderrText : current.stderrText,
    score: patch.score !== undefined ? Number(patch.score || 0) : current.score,
    totalPoints: patch.totalPoints !== undefined ? Number(patch.totalPoints || 0) : current.totalPoints,
    passed: patch.passed !== undefined ? Boolean(patch.passed) : current.passed,
    messages: patch.messages !== undefined ? patch.messages : current.messages,
    screenshotPath: patch.screenshotPath !== undefined ? patch.screenshotPath : current.screenshotPath,
    screenshotUrl: patch.screenshotUrl !== undefined ? patch.screenshotUrl : current.screenshotUrl,
    resultSnapshot: patch.resultSnapshot !== undefined ? patch.resultSnapshot : current.resultSnapshot,
    reviewStatus: patch.reviewStatus ?? current.reviewStatus,
    reviewNote: patch.reviewNote ?? current.reviewNote,
    reviewedBy: patch.reviewedBy !== undefined ? patch.reviewedBy : current.reviewedBy,
    reviewedAt: patch.reviewedAt !== undefined ? patch.reviewedAt : current.reviewedAt,
    reviewHistory: patch.reviewHistory !== undefined ? patch.reviewHistory : current.reviewHistory,
    resultMailSentAt: patch.resultMailSentAt !== undefined ? patch.resultMailSentAt : current.resultMailSentAt,
    submittedAt: patch.submittedAt !== undefined ? patch.submittedAt : current.submittedAt,
  };
  await withClient((c) => c.query(`
    UPDATE lab_exam_attempts
       SET exam_title=$2, session_id=$3, lab_request_id=$4,
           exit_code=$5, stdout_text=$6, stderr_text=$7, score=$8, total_points=$9, passed=$10,
           messages_json=$11, screenshot_path=$12, screenshot_url=$13, result_snapshot_json=$14,
           review_status=$15, review_note=$16, reviewed_by=$17, reviewed_at=$18,
           review_history_json=$19, result_mail_sent_at=$20, submitted_at=$21
     WHERE id=$1
  `, [
    attemptId,
    String(next.examTitle || ""),
    String(next.sessionId || "").trim() || null,
    next.labRequestId != null ? Number(next.labRequestId) : null,
    next.exitCode,
    String(next.stdoutText || ""),
    String(next.stderrText || ""),
    next.score,
    next.totalPoints,
    next.passed ? 1 : 0,
    JSON.stringify(Array.isArray(next.messages) ? next.messages : []),
    String(next.screenshotPath || ""),
    String(next.screenshotUrl || ""),
    JSON.stringify(next.resultSnapshot && typeof next.resultSnapshot === "object" ? next.resultSnapshot : {}),
    String(next.reviewStatus || "pending").trim() || "pending",
    String(next.reviewNote || "").trim(),
    next.reviewedBy != null ? Number(next.reviewedBy) : null,
    next.reviewedAt || null,
    JSON.stringify(Array.isArray(next.reviewHistory) ? next.reviewHistory : []),
    next.resultMailSentAt || null,
    next.submittedAt || current.submittedAt || new Date().toISOString(),
  ]));
  return normalizeLabExamAttemptRow((await withClient((c) => c.query(`
    SELECT id, course_id AS "courseId", exam_title AS "examTitle", user_id AS "userId",
           user_name AS "userName", username, session_id AS "sessionId", lab_request_id AS "labRequestId",
           exit_code AS "exitCode", stdout_text AS "stdoutText", stderr_text AS "stderrText",
           score, total_points AS "totalPoints", passed, messages_json AS "messagesJson",
           screenshot_path AS "screenshotPath", screenshot_url AS "screenshotUrl",
           result_snapshot_json AS "resultSnapshotJson",
           review_status AS "reviewStatus", review_note AS "reviewNote",
           reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt",
           review_history_json AS "reviewHistoryJson",
           result_mail_sent_at AS "resultMailSentAt",
           submitted_at AS "submittedAt"
      FROM lab_exam_attempts
     WHERE id=$1
  `, [attemptId]))).rows[0] || null);
}

async function pgDeleteLabExamAttempt(id) {
  const attemptId = String(id || "").trim();
  if (!attemptId) return null;
  const current = normalizeLabExamAttemptRow((await withClient((c) => c.query(`
    SELECT id, course_id AS "courseId", exam_title AS "examTitle", user_id AS "userId",
           user_name AS "userName", username, session_id AS "sessionId", lab_request_id AS "labRequestId",
           exit_code AS "exitCode", stdout_text AS "stdoutText", stderr_text AS "stderrText",
           score, total_points AS "totalPoints", passed, messages_json AS "messagesJson",
           screenshot_path AS "screenshotPath", screenshot_url AS "screenshotUrl",
           result_snapshot_json AS "resultSnapshotJson",
           review_status AS "reviewStatus", review_note AS "reviewNote",
           reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt",
           review_history_json AS "reviewHistoryJson",
           result_mail_sent_at AS "resultMailSentAt",
           submitted_at AS "submittedAt"
      FROM lab_exam_attempts
     WHERE id=$1
  `, [attemptId]))).rows[0] || null);
  if (!current) return null;
  await withTx(async (client) => {
    await client.query(`UPDATE lab_exam_sessions SET attempt_id=NULL, updated_at=CURRENT_TIMESTAMP::text WHERE attempt_id=$1`, [attemptId]);
    await client.query(`DELETE FROM lab_exam_attempts WHERE id=$1`, [attemptId]);
  });
  return current;
}

function normalizeLabExamSessionRow(row) {
  return row ? {
    id: String(row.id || ""),
    courseId: Number(row.courseId ?? row.course_id ?? 0),
    examTitle: String(row.examTitle ?? row.exam_title ?? "").trim(),
    userId: Number(row.userId ?? row.user_id ?? 0),
    userName: String(row.userName ?? row.user_name ?? "").trim(),
    username: String(row.username || "").trim(),
    labRequestId: row.labRequestId != null ? Number(row.labRequestId) : row.lab_request_id != null ? Number(row.lab_request_id) : null,
    attemptId: String(row.attemptId ?? row.attempt_id ?? "").trim(),
    status: String(row.status || "preparing").trim() || "preparing",
    startedAt: row.startedAt ?? row.started_at ?? null,
    expiresAt: row.expiresAt ?? row.expires_at ?? null,
    endedAt: row.endedAt ?? row.ended_at ?? null,
    gradingStartedAt: row.gradingStartedAt ?? row.grading_started_at ?? null,
    gradingFinishedAt: row.gradingFinishedAt ?? row.grading_finished_at ?? null,
    endReason: String(row.endReason ?? row.end_reason ?? "").trim(),
    errorMessage: String(row.errorMessage ?? row.error_message ?? "").trim(),
    metadata: safeJsonParse(row.metadataJson ?? row.metadata_json ?? "{}", {}),
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    courseTitle: String(row.courseTitle ?? row.course_title ?? "").trim(),
    labStatus: String(row.labStatus ?? row.lab_status ?? "").trim(),
  } : null;
}

const LAB_EXAM_SESSION_SELECT = `
  SELECT s.*, u.name AS "userName", u.username, c.title AS "courseTitle", lr.status AS "labStatus"
  FROM lab_exam_sessions s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN courses c ON c.id = s.course_id
  LEFT JOIN lab_requests lr ON lr.id = s.lab_request_id
`;

async function pgCreateLabExamSession(input) {
  const id = String(input.id || randomUUID());
  const now = input.createdAt || new Date().toISOString();
  const startedAt = input.startedAt || now;
  const expiresAt = input.expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await withClient((c) => c.query(`
    INSERT INTO lab_exam_sessions (
      id, course_id, exam_title, user_id, lab_request_id, attempt_id, status,
      started_at, expires_at, ended_at, grading_started_at, grading_finished_at,
      end_reason, error_message, metadata_json, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
  `, [
    id,
    Number(input.courseId || 0),
    String(input.examTitle || "").trim(),
    Number(input.userId || 0),
    input.labRequestId != null ? Number(input.labRequestId) : null,
    String(input.attemptId || "").trim() || null,
    String(input.status || "preparing").trim() || "preparing",
    startedAt,
    expiresAt,
    input.endedAt || null,
    input.gradingStartedAt || null,
    input.gradingFinishedAt || null,
    String(input.endReason || "").trim(),
    String(input.errorMessage || "").trim(),
    JSON.stringify(input.metadata || {}),
    now,
    now,
  ]));
  return pgFindLabExamSessionById(id);
}

async function pgFindLabExamSessionById(id) {
  return normalizeLabExamSessionRow((await withClient((c) => c.query(`${LAB_EXAM_SESSION_SELECT} WHERE s.id=$1`, [String(id || "")]))).rows[0] || null);
}

async function pgListLabExamSessions() {
  return (await withClient((c) => c.query(`${LAB_EXAM_SESSION_SELECT} ORDER BY s.started_at DESC, s.id DESC`))).rows.map(normalizeLabExamSessionRow);
}

async function pgListLabExamSessionsByUser(userId) {
  return (await withClient((c) => c.query(`${LAB_EXAM_SESSION_SELECT} WHERE s.user_id=$1 ORDER BY s.started_at DESC, s.id DESC`, [Number(userId || 0)]))).rows.map(normalizeLabExamSessionRow);
}

async function pgFindActiveLabExamSessionByUserCourse(userId, courseId) {
  return normalizeLabExamSessionRow((await withClient((c) => c.query(
    `${LAB_EXAM_SESSION_SELECT}
     WHERE s.user_id=$1 AND s.course_id=$2 AND s.status IN ('preparing','ready','running','ending','grading')
       AND s.expires_at::timestamptz > NOW()
     ORDER BY s.started_at DESC, s.id DESC
     LIMIT 1`,
    [Number(userId || 0), Number(courseId || 0)],
  ))).rows[0] || null);
}

async function pgClaimLabExamSessionPreparation(id, leaseUntil) {
  const result = await withClient((c) => c.query(`
    UPDATE lab_exam_sessions
       SET metadata_json=jsonb_set(
             COALESCE(NULLIF(metadata_json, '')::jsonb, '{}'::jsonb),
             '{preparationLeaseUntil}',
             to_jsonb($2::text),
             true
           )::text,
           updated_at=CURRENT_TIMESTAMP::text
     WHERE id=$1
       AND status='preparing'
       AND COALESCE(
             NULLIF(metadata_json::jsonb ->> 'preparationLeaseUntil', '')::timestamptz,
             '-infinity'::timestamptz
           ) <= NOW()
     RETURNING id
  `, [String(id || ''), leaseUntil]));
  return result.rowCount > 0;
}

async function pgUpdateLabExamSession(id, patch = {}) {
  const current = await pgFindLabExamSessionById(id);
  if (!current) return null;
  const next = {
    labRequestId: patch.labRequestId !== undefined ? patch.labRequestId : current.labRequestId,
    attemptId: patch.attemptId !== undefined ? patch.attemptId : current.attemptId,
    status: patch.status !== undefined ? patch.status : current.status,
    startedAt: patch.startedAt !== undefined ? patch.startedAt : current.startedAt,
    expiresAt: patch.expiresAt !== undefined ? patch.expiresAt : current.expiresAt,
    endedAt: patch.endedAt !== undefined ? patch.endedAt : current.endedAt,
    gradingStartedAt: patch.gradingStartedAt !== undefined ? patch.gradingStartedAt : current.gradingStartedAt,
    gradingFinishedAt: patch.gradingFinishedAt !== undefined ? patch.gradingFinishedAt : current.gradingFinishedAt,
    endReason: patch.endReason !== undefined ? patch.endReason : current.endReason,
    errorMessage: patch.errorMessage !== undefined ? patch.errorMessage : current.errorMessage,
    metadata: patch.metadata !== undefined ? patch.metadata : current.metadata,
  };
  await withClient((c) => c.query(`
    UPDATE lab_exam_sessions
       SET lab_request_id=$2, attempt_id=$3, status=$4, started_at=$5, expires_at=$6, ended_at=$7,
           grading_started_at=$8, grading_finished_at=$9, end_reason=$10,
           error_message=$11, metadata_json=$12, updated_at=CURRENT_TIMESTAMP::text
     WHERE id=$1
  `, [
    String(id || ""),
    next.labRequestId != null ? Number(next.labRequestId) : null,
    String(next.attemptId || "").trim() || null,
    String(next.status || "preparing").trim() || "preparing",
    next.startedAt || current.startedAt || new Date().toISOString(),
    next.expiresAt || null,
    next.endedAt || null,
    next.gradingStartedAt || null,
    next.gradingFinishedAt || null,
    String(next.endReason || "").trim(),
    String(next.errorMessage || "").trim(),
    JSON.stringify(next.metadata || {}),
  ]));
  return pgFindLabExamSessionById(id);
}

async function pgDeleteLabExamSession(id) {
  const session = await pgFindLabExamSessionById(id);
  if (!session) return null;
  if (session.attemptId) return null;
  const deleted = await withClient((client) => client.query(
    `DELETE FROM lab_exam_sessions WHERE id=$1 AND attempt_id IS NULL`,
    [String(id || "")],
  ));
  return deleted.rowCount > 0 ? session : null;
}
async function pgListCertificates() {
  return (await withClient((c) => c.query(`
    SELECT id, user_id AS "userId", user_name AS "userName", username,
           course_id AS "courseId", course_title AS "courseTitle",
           certificate_code AS "certificateCode", verify_code AS "verifyCode",
           written_attempt_id AS "writtenAttemptId", lab_attempt_id AS "labAttemptId",
           issued_at AS "issuedAt"
    FROM certificates
    ORDER BY issued_at DESC, id DESC
  `))).rows.map(normalizeCertificateRow);
}
async function pgAppendCertificate(input) {
  const entry = {
    id: String(input.id),
    userId: Number(input.userId),
    userName: input.userName || "",
    username: input.username || "",
    courseId: Number(input.courseId),
    courseTitle: input.courseTitle || "",
    certificateCode: input.certificateCode || "",
    verifyCode: input.verifyCode || "",
    writtenAttemptId: input.writtenAttemptId || null,
    labAttemptId: input.labAttemptId || null,
    issuedAt: input.issuedAt,
  };
  await withTx(async (c) => {
    await c.query(`LOCK TABLE certificates IN EXCLUSIVE MODE`);
    const existing = await c.query(
      `SELECT id FROM certificates WHERE user_id=$1 AND course_id=$2 LIMIT 1`,
      [entry.userId, entry.courseId],
    );
    if (existing.rows[0]?.id) {
      const error = new Error("Certificate already exists for this user and course.");
      error.code = "CERTIFICATE_EXISTS";
      throw error;
    }
    await c.query(`
      INSERT INTO certificates (
        id, user_id, user_name, username, course_id, course_title,
        certificate_code, verify_code, written_attempt_id, lab_attempt_id, issued_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      entry.id, entry.userId, entry.userName, entry.username, entry.courseId, entry.courseTitle,
      entry.certificateCode, entry.verifyCode, entry.writtenAttemptId, entry.labAttemptId, entry.issuedAt,
    ]);
  });
  return normalizeCertificateRow(entry);
}
async function pgCreateNotice({ title, body, isPinned = false, createdBy }) {
  return withTx(async (c) => {
    const id = await nextId(c, "notices");
    await c.query(
      `INSERT INTO notices (id,title,body,is_pinned,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text)`,
      [id, title, body, isPinned ? 1 : 0, createdBy],
    );
    return normalizeNoticeRow((await c.query(
      `SELECT n.id,n.title,n.body,n.is_pinned AS "isPinned",n.created_at AS "createdAt",n.updated_at AS "updatedAt",
              u.name AS "createdByName",u.username AS "createdByUsername"
       FROM notices n JOIN users u ON u.id=n.created_by WHERE n.id=$1`, [id]
    )).rows[0] || null);
  });
}
async function pgUpdateNotice(id, { title, body, isPinned = false }) {
  await withClient((c) => c.query(
    `UPDATE notices SET title=$2, body=$3, is_pinned=$4, updated_at=CURRENT_TIMESTAMP::text WHERE id=$1`,
    [id, title, body, isPinned ? 1 : 0],
  ));
  return pgFindNoticeById(id);
}
async function pgDeleteNotice(id) {
  await withClient((c) => c.query(`DELETE FROM notices WHERE id=$1`, [id]));
}
async function pgFindNoticeById(id) {
  return normalizeNoticeRow((await withClient((c) => c.query(
    `SELECT n.id,n.title,n.body,n.is_pinned AS "isPinned",n.created_at AS "createdAt",n.updated_at AS "updatedAt",
            u.name AS "createdByName",u.username AS "createdByUsername"
     FROM notices n JOIN users u ON u.id=n.created_by WHERE n.id=$1`, [id]
  ))).rows[0] || null);
}
async function pgListNotices() {
  return (await withClient((c) => c.query(
    `SELECT n.id,n.title,n.body,n.is_pinned AS "isPinned",n.created_at AS "createdAt",n.updated_at AS "updatedAt",
            u.name AS "createdByName",u.username AS "createdByUsername"
     FROM notices n JOIN users u ON u.id=n.created_by
     ORDER BY n.is_pinned DESC, n.created_at DESC, n.id DESC`
  ))).rows.map(normalizeNoticeRow);
}
async function pgListQnaComments(postId) {
  return (await withClient((c) => c.query(
    `SELECT c.id,c.post_id AS "postId",c.user_id AS "userId",c.parent_comment_id AS "parentCommentId",c.body,c.created_at AS "createdAt",
            u.name AS "userName",u.username
     FROM qna_comments c JOIN users u ON u.id=c.user_id
     WHERE c.post_id=$1
     ORDER BY c.created_at ASC, c.id ASC`, [postId]
  ))).rows.map(normalizeQnaCommentRow);
}
async function pgFindQnaPostById(id) {
  const row = (await withClient((c) => c.query(
    `SELECT q.id,q.user_id AS "userId",q.course_id AS "courseId",course.title AS "courseTitle",
            q.lab_request_id AS "labRequestId",lab.status AS "labStatus",lab.instance_ip AS "labInstanceIp",lab.stack_name AS "labStackName",
            q.post_type AS "postType",q.status,q.title,q.body,q.answer_text AS "answerText",
            q.answered_by AS "answeredBy",q.accepted_comment_id AS "acceptedCommentId",q.lab_context_json AS "labContextJson",
            COALESCE((SELECT COUNT(*)::int FROM qna_helpful_votes hv WHERE hv.post_id=q.id),0) AS "helpfulCount",
            q.created_at AS "createdAt",q.answered_at AS "answeredAt",
            u.name AS "userName",u.username
     FROM qna_posts q JOIN users u ON u.id=q.user_id
     LEFT JOIN courses course ON course.id=q.course_id
     LEFT JOIN lab_requests lab ON lab.id=q.lab_request_id
     WHERE q.id=$1`, [id]
  ))).rows[0] || null;
  if (!row) return null;
  return normalizeQnaRow({ ...row, comments: await pgListQnaComments(id) });
}
async function pgListQnaPosts() {
  const rows = (await withClient((c) => c.query(
    `SELECT q.id,q.user_id AS "userId",q.course_id AS "courseId",course.title AS "courseTitle",
            q.lab_request_id AS "labRequestId",lab.status AS "labStatus",lab.instance_ip AS "labInstanceIp",lab.stack_name AS "labStackName",
            q.post_type AS "postType",q.status,q.title,q.body,q.answer_text AS "answerText",
            q.answered_by AS "answeredBy",q.accepted_comment_id AS "acceptedCommentId",q.lab_context_json AS "labContextJson",
            COALESCE((SELECT COUNT(*)::int FROM qna_helpful_votes hv WHERE hv.post_id=q.id),0) AS "helpfulCount",
            q.created_at AS "createdAt",q.answered_at AS "answeredAt",
            u.name AS "userName",u.username
     FROM qna_posts q JOIN users u ON u.id=q.user_id
     LEFT JOIN courses course ON course.id=q.course_id
     LEFT JOIN lab_requests lab ON lab.id=q.lab_request_id
     ORDER BY COALESCE((SELECT MAX(c.created_at) FROM qna_comments c WHERE c.post_id=q.id), q.created_at) DESC, q.id DESC`
  ))).rows;
  return Promise.all(rows.map(async (row) => normalizeQnaRow({ ...row, comments: await pgListQnaComments(row.id) })));
}
async function pgCreateQnaPost({ userId, courseId = null, labRequestId = null, postType = "question", title, body, labContext = {} }) {
  return withTx(async (c) => {
    const id = await nextId(c, "qna_posts");
    await c.query(
      `INSERT INTO qna_posts (id,user_id,course_id,lab_request_id,post_type,status,title,body,lab_context_json,created_at)
       VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,CURRENT_TIMESTAMP::text)`,
      [id, userId, courseId != null ? Number(courseId) : null, labRequestId != null ? Number(labRequestId) : null, postType, title, body, JSON.stringify(labContext || {})],
    );
    const row = (await c.query(
      `SELECT q.id,q.user_id AS "userId",q.course_id AS "courseId",course.title AS "courseTitle",
              q.lab_request_id AS "labRequestId",lab.status AS "labStatus",lab.instance_ip AS "labInstanceIp",lab.stack_name AS "labStackName",
              q.post_type AS "postType",q.status,q.title,q.body,q.answer_text AS "answerText",
              q.answered_by AS "answeredBy",q.accepted_comment_id AS "acceptedCommentId",q.lab_context_json AS "labContextJson",
              COALESCE((SELECT COUNT(*)::int FROM qna_helpful_votes hv WHERE hv.post_id=q.id),0) AS "helpfulCount",
              q.created_at AS "createdAt",q.answered_at AS "answeredAt",
              u.name AS "userName",u.username
       FROM qna_posts q JOIN users u ON u.id=q.user_id
       LEFT JOIN courses course ON course.id=q.course_id
       LEFT JOIN lab_requests lab ON lab.id=q.lab_request_id
       WHERE q.id=$1`, [id]
    )).rows[0] || null;
    return normalizeQnaRow(row ? { ...row, comments: [] } : null);
  });
}
async function pgCreateQnaComment({ postId, userId, body, parentCommentId = null }) {
  return withTx(async (c) => {
    const id = await nextId(c, "qna_comments");
    await c.query(
      `INSERT INTO qna_comments (id,post_id,user_id,parent_comment_id,body,created_at) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP::text)`,
      [id, postId, userId, parentCommentId, body],
    );
    return normalizeQnaCommentRow((await c.query(
      `SELECT c.id,c.post_id AS "postId",c.user_id AS "userId",c.parent_comment_id AS "parentCommentId",c.body,c.created_at AS "createdAt",
              u.name AS "userName",u.username
       FROM qna_comments c JOIN users u ON u.id=c.user_id WHERE c.id=$1`, [id]
    )).rows[0] || null);
  });
}
async function pgAnswerQnaPost(id, { answerText, answeredBy }) {
  await withClient((c) => c.query(
    `UPDATE qna_posts SET answer_text=$2, answered_by=$3, answered_at=CURRENT_TIMESTAMP::text,
      status=CASE WHEN status='open' THEN 'in_progress' ELSE status END WHERE id=$1`,
    [id, answerText, answeredBy],
  ));
  return pgFindQnaPostById(id);
}
async function pgUpdateQnaPostStatus(id, status) {
  await withClient((c) => c.query(`UPDATE qna_posts SET status=$2 WHERE id=$1`, [id, status]));
  return pgFindQnaPostById(id);
}
async function pgAcceptQnaComment(postId, commentId) {
  await withClient((c) => c.query(
    `UPDATE qna_posts SET accepted_comment_id=$2, status='solved' WHERE id=$1`,
    [postId, commentId],
  ));
  return pgFindQnaPostById(postId);
}
async function pgMarkQnaHelpful(postId, userId) {
  await withClient((c) => c.query(
    `INSERT INTO qna_helpful_votes (post_id,user_id,created_at)
     VALUES ($1,$2,CURRENT_TIMESTAMP::text)
     ON CONFLICT (post_id,user_id) DO NOTHING`,
    [postId, userId],
  ));
  return pgFindQnaPostById(postId);
}
async function pgDeleteQnaPost(id) {
  await withTx(async (c) => {
    await c.query(`DELETE FROM qna_comments WHERE post_id=$1`, [id]);
    await c.query(`DELETE FROM qna_posts WHERE id=$1`, [id]);
  });
}
async function pgDeleteQnaComment(id) {
  await withTx(async (c) => {
    await c.query(
      `WITH RECURSIVE comment_tree AS (
         SELECT id FROM qna_comments WHERE id=$1
         UNION ALL
         SELECT child.id
         FROM qna_comments child
         JOIN comment_tree tree ON child.parent_comment_id = tree.id
       )
       UPDATE qna_posts
       SET accepted_comment_id=NULL,
           status=CASE WHEN status='solved' THEN 'in_progress' ELSE status END
       WHERE accepted_comment_id IN (SELECT id FROM comment_tree)`,
      [id],
    );
    await c.query(
      `WITH RECURSIVE comment_tree AS (
         SELECT id FROM qna_comments WHERE id=$1
         UNION ALL
         SELECT child.id
         FROM qna_comments child
         JOIN comment_tree tree ON child.parent_comment_id = tree.id
       )
       DELETE FROM qna_comments
       WHERE id IN (SELECT id FROM comment_tree)`,
      [id],
    );
  });
}
async function pgCreateDiscountCoupon(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "discount_coupons");
    const code = String(input.code || "").trim();
    await c.query(`
      INSERT INTO discount_coupons (
        id, code, user_id, course_id, source, discount_type, discount_value,
        max_uses, used_count, status, expires_at, metadata_json, created_at, used_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,CURRENT_TIMESTAMP::text,NULL)
    `, [
      id,
      code,
      input.userId != null ? Number(input.userId) : null,
      input.courseId != null ? Number(input.courseId) : null,
      String(input.source || "manual").trim() || "manual",
      String(input.discountType || "percent").trim() || "percent",
      Math.max(0, Number(input.discountValue || 0) || 0),
      Math.max(1, Number(input.maxUses || 1) || 1),
      String(input.status || "active").trim() || "active",
      input.expiresAt || null,
      JSON.stringify(input.metadata || {}),
    ]);
    return normalizeDiscountCouponRow((await c.query(`
      SELECT dc.id, dc.code, dc.user_id AS "userId", dc.course_id AS "courseId", dc.source,
             dc.discount_type AS "discountType", dc.discount_value AS "discountValue",
             dc.max_uses AS "maxUses", dc.used_count AS "usedCount", dc.status, dc.expires_at AS "expiresAt",
             dc.metadata_json AS "metadataJson", dc.created_at AS "createdAt", dc.used_at AS "usedAt",
             c.title AS "courseTitle"
      FROM discount_coupons dc
      LEFT JOIN courses c ON c.id = dc.course_id
      WHERE dc.id = $1
    `, [id])).rows[0] || null);
  });
}
async function pgFindDiscountCouponByCode(code) {
  return normalizeDiscountCouponRow((await withClient((c) => c.query(`
    SELECT dc.id, dc.code, dc.user_id AS "userId", dc.course_id AS "courseId", dc.source,
           dc.discount_type AS "discountType", dc.discount_value AS "discountValue",
           dc.max_uses AS "maxUses", dc.used_count AS "usedCount", dc.status, dc.expires_at AS "expiresAt",
           dc.metadata_json AS "metadataJson", dc.created_at AS "createdAt", dc.used_at AS "usedAt",
           c.title AS "courseTitle"
    FROM discount_coupons dc
    LEFT JOIN courses c ON c.id = dc.course_id
    WHERE dc.code = $1
  `, [String(code || "").trim()]))).rows[0] || null);
}
async function pgListDiscountCouponsByUser(userId) {
  return (await withClient((c) => c.query(`
    SELECT dc.id, dc.code, dc.user_id AS "userId", u.name AS "userName", u.username, dc.course_id AS "courseId", dc.source,
           dc.discount_type AS "discountType", dc.discount_value AS "discountValue",
           dc.max_uses AS "maxUses", dc.used_count AS "usedCount", dc.status, dc.expires_at AS "expiresAt",
           dc.metadata_json AS "metadataJson", dc.created_at AS "createdAt", dc.used_at AS "usedAt",
           c.title AS "courseTitle"
    FROM discount_coupons dc
    LEFT JOIN users u ON u.id = dc.user_id
    LEFT JOIN courses c ON c.id = dc.course_id
    WHERE dc.user_id = $1
    ORDER BY dc.created_at DESC, dc.id DESC
  `, [Number(userId)]))).rows.map(normalizeDiscountCouponRow);
}
async function pgListDiscountCoupons() {
  return (await withClient((c) => c.query(`
    SELECT dc.id, dc.code, dc.user_id AS "userId", u.name AS "userName", u.username, dc.course_id AS "courseId", dc.source,
           dc.discount_type AS "discountType", dc.discount_value AS "discountValue",
           dc.max_uses AS "maxUses", dc.used_count AS "usedCount", dc.status, dc.expires_at AS "expiresAt",
           dc.metadata_json AS "metadataJson", dc.created_at AS "createdAt", dc.used_at AS "usedAt",
           c.title AS "courseTitle"
    FROM discount_coupons dc
    LEFT JOIN users u ON u.id = dc.user_id
    LEFT JOIN courses c ON c.id = dc.course_id
    ORDER BY dc.created_at DESC, dc.id DESC
  `))).rows.map(normalizeDiscountCouponRow);
}
async function pgListTermsVersions() {
  return (await withClient((c) => c.query(`
    SELECT tv.id, tv.terms_key AS "termsKey", tv.title, tv.version, tv.summary, tv.body,
           tv.content_hash AS "contentHash", tv.is_active AS "isActive",
           tv.created_by AS "createdBy", u.name AS "createdByName", u.username AS "createdByUsername",
           tv.created_at AS "createdAt", tv.updated_at AS "updatedAt", tv.published_at AS "publishedAt"
    FROM terms_versions tv
    LEFT JOIN users u ON u.id = tv.created_by
    ORDER BY tv.terms_key ASC, tv.is_active DESC, tv.created_at DESC, tv.id DESC
  `))).rows.map(normalizeTermsVersionRow);
}
async function pgListActiveTermsVersions() {
  return (await withClient((c) => c.query(`
    SELECT tv.id, tv.terms_key AS "termsKey", tv.title, tv.version, tv.summary, tv.body,
           tv.content_hash AS "contentHash", tv.is_active AS "isActive",
           tv.created_by AS "createdBy", u.name AS "createdByName", u.username AS "createdByUsername",
           tv.created_at AS "createdAt", tv.updated_at AS "updatedAt", tv.published_at AS "publishedAt"
    FROM terms_versions tv
    LEFT JOIN users u ON u.id = tv.created_by
    WHERE tv.is_active = 1
    ORDER BY tv.terms_key ASC, tv.created_at DESC, tv.id DESC
  `))).rows.map(normalizeTermsVersionRow);
}
async function pgFindTermsVersionById(id) {
  return normalizeTermsVersionRow((await withClient((c) => c.query(`
    SELECT tv.id, tv.terms_key AS "termsKey", tv.title, tv.version, tv.summary, tv.body,
           tv.content_hash AS "contentHash", tv.is_active AS "isActive",
           tv.created_by AS "createdBy", u.name AS "createdByName", u.username AS "createdByUsername",
           tv.created_at AS "createdAt", tv.updated_at AS "updatedAt", tv.published_at AS "publishedAt"
    FROM terms_versions tv
    LEFT JOIN users u ON u.id = tv.created_by
    WHERE tv.id = $1
  `, [Number(id)]))).rows[0] || null);
}
async function pgCreateTermsVersion(input) {
  const termsKey = normalizeTermsKey(input.termsKey);
  const title = String(input.title || "").trim();
  const version = String(input.version || "").trim();
  const summary = String(input.summary || "").trim();
  const body = String(input.body || "").trim();
  const isActive = Number(Boolean(input.isActive));
  if (!title || !version || !body) throw new Error("약관명, 버전, 본문을 모두 입력해 주세요.");
  const id = await withTx(async (c) => {
    const id = await nextId(c, "terms_versions");
    const now = new Date().toISOString();
    if (isActive) {
      await c.query(`UPDATE terms_versions SET is_active = 0, updated_at = $2 WHERE terms_key = $1`, [termsKey, now]);
    }
    await c.query(`
      INSERT INTO terms_versions (
        id, terms_key, title, version, summary, body, content_hash,
        is_active, created_by, created_at, updated_at, published_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11)
    `, [
      id,
      termsKey,
      title,
      version,
      summary,
      body,
      hashTermsContent({ termsKey, version, title, summary, body }),
      isActive,
      input.createdBy != null ? Number(input.createdBy) : null,
      now,
      isActive ? now : null,
    ]);
    return id;
  });
  return pgFindTermsVersionById(id);
}
async function pgUpdateTermsVersion(id, patch = {}) {
  const current = await pgFindTermsVersionById(id);
  if (!current) return null;
  const termsKey = normalizeTermsKey(patch.termsKey ?? current.termsKey);
  const title = String(patch.title ?? current.title ?? "").trim();
  const version = String(patch.version ?? current.version ?? "").trim();
  const summary = String(patch.summary ?? current.summary ?? "").trim();
  const body = String(patch.body ?? current.body ?? "").trim();
  const isActive = patch.isActive == null ? Number(Boolean(current.isActive)) : Number(Boolean(patch.isActive));
  if (!title || !version || !body) throw new Error("약관명, 버전, 본문을 모두 입력해 주세요.");
  const activeContentChanged = current.isActive && (
    termsKey !== current.termsKey
    || title !== current.title
    || version !== current.version
    || summary !== current.summary
    || body !== current.body
  );
  if (activeContentChanged) {
    throw new Error("활성화된 약관 본문은 직접 수정할 수 없습니다. 새 버전으로 등록해 갱신해 주세요.");
  }
  await withTx(async (c) => {
    const now = new Date().toISOString();
    if (isActive) {
      await c.query(`UPDATE terms_versions SET is_active = 0, updated_at = $2 WHERE terms_key = $1 AND id <> $3`, [termsKey, now, Number(id)]);
    }
    await c.query(`
      UPDATE terms_versions
      SET terms_key=$2, title=$3, version=$4, summary=$5, body=$6, content_hash=$7,
          is_active=$8, updated_at=$9, published_at=$10
      WHERE id=$1
    `, [
      Number(id),
      termsKey,
      title,
      version,
      summary,
      body,
      hashTermsContent({ termsKey, version, title, summary, body }),
      isActive,
      now,
      isActive ? (current.publishedAt || now) : null,
    ]);
  });
  return pgFindTermsVersionById(id);
}
async function pgCreateUserTermsAgreements({ userId, termsVersions = [], ipAddress = "", userAgent = "" }) {
  const normalizedUserId = Number(userId);
  const items = Array.isArray(termsVersions) ? termsVersions.filter(Boolean) : [];
  if (!normalizedUserId || !items.length) return [];
  return withTx(async (c) => {
    const now = new Date().toISOString();
    const created = [];
    for (const term of items) {
      const id = await nextId(c, "user_terms_agreements");
      await c.query(`
        INSERT INTO user_terms_agreements (
          id, user_id, terms_version_id, terms_key, terms_title,
          terms_version, terms_summary, terms_body, content_hash,
          ip_address, user_agent, agreed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `, [
        id,
        normalizedUserId,
        Number(term.id),
        String(term.termsKey || "").trim(),
        String(term.title || "").trim(),
        String(term.version || "").trim(),
        String(term.summary || "").trim(),
        String(term.body || ""),
        String(term.contentHash || "").trim(),
        String(ipAddress || "").slice(0, 200),
        String(userAgent || "").slice(0, 500),
        now,
      ]);
      created.push({ id, termsVersionId: Number(term.id), termsKey: term.termsKey, termsVersion: term.version, agreedAt: now });
    }
    return created;
  });
}
async function pgUpdateDiscountCoupon(id, patch = {}) {
  const current = await pgFindDiscountCouponById(id);
  if (!current) return null;
  await withClient((c) => c.query(`
    UPDATE discount_coupons
    SET code = $2,
        user_id = $3,
        course_id = $4,
        source = $5,
        discount_type = $6,
        discount_value = $7,
        max_uses = $8,
        used_count = $9,
        status = $10,
        expires_at = $11,
        metadata_json = $12,
        used_at = $13
    WHERE id = $1
  `, [
    Number(id),
    String(patch.code ?? current.code ?? "").trim(),
    patch.userId ?? current.userId ?? null,
    patch.courseId ?? current.courseId ?? null,
    String(patch.source ?? current.source ?? "manual").trim() || "manual",
    String(patch.discountType ?? current.discountType ?? "percent").trim() || "percent",
    Math.max(0, Number(patch.discountValue ?? current.discountValue ?? 0) || 0),
    Math.max(1, Number(patch.maxUses ?? current.maxUses ?? 1) || 1),
    Math.max(0, Number(patch.usedCount ?? current.usedCount ?? 0) || 0),
    String(patch.status ?? current.status ?? "active").trim() || "active",
    patch.expiresAt ?? current.expiresAt ?? null,
    JSON.stringify(patch.metadata ?? current.metadata ?? {}),
    patch.usedAt ?? current.usedAt ?? null,
  ]));
  return pgFindDiscountCouponById(id);
}
async function pgFindDiscountCouponById(id) {
  return normalizeDiscountCouponRow((await withClient((c) => c.query(`
    SELECT dc.id, dc.code, dc.user_id AS "userId", dc.course_id AS "courseId", dc.source,
           dc.discount_type AS "discountType", dc.discount_value AS "discountValue",
           dc.max_uses AS "maxUses", dc.used_count AS "usedCount", dc.status, dc.expires_at AS "expiresAt",
           dc.metadata_json AS "metadataJson", dc.created_at AS "createdAt", dc.used_at AS "usedAt",
           c.title AS "courseTitle"
    FROM discount_coupons dc
    LEFT JOIN courses c ON c.id = dc.course_id
    WHERE dc.id = $1
  `, [Number(id)]))).rows[0] || null);
}
async function pgConsumeDiscountCoupon(id) {
  return withTx(async (c) => {
    const current = normalizeDiscountCouponRow((await c.query(`
      SELECT dc.id, dc.code, dc.user_id AS "userId", dc.course_id AS "courseId", dc.source,
             dc.discount_type AS "discountType", dc.discount_value AS "discountValue",
             dc.max_uses AS "maxUses", dc.used_count AS "usedCount", dc.status, dc.expires_at AS "expiresAt",
             dc.metadata_json AS "metadataJson", dc.created_at AS "createdAt", dc.used_at AS "usedAt",
             c.title AS "courseTitle"
      FROM discount_coupons dc
      LEFT JOIN courses c ON c.id = dc.course_id
      WHERE dc.id = $1
      FOR UPDATE
    `, [Number(id)])).rows[0] || null);
    if (!current) return null;
    const nextUsedCount = Math.max(0, Number(current.usedCount || 0)) + 1;
    const nextStatus = nextUsedCount >= current.maxUses ? "used" : current.status;
    await c.query(`
      UPDATE discount_coupons
      SET used_count = $2,
          status = $3,
          used_at = CURRENT_TIMESTAMP::text
      WHERE id = $1
    `, [Number(id), nextUsedCount, nextStatus]);
    return normalizeDiscountCouponRow((await c.query(`
      SELECT dc.id, dc.code, dc.user_id AS "userId", dc.course_id AS "courseId", dc.source,
             dc.discount_type AS "discountType", dc.discount_value AS "discountValue",
             dc.max_uses AS "maxUses", dc.used_count AS "usedCount", dc.status, dc.expires_at AS "expiresAt",
             dc.metadata_json AS "metadataJson", dc.created_at AS "createdAt", dc.used_at AS "usedAt",
             c.title AS "courseTitle"
      FROM discount_coupons dc
      LEFT JOIN courses c ON c.id = dc.course_id
      WHERE dc.id = $1
    `, [Number(id)])).rows[0] || null);
  });
}

async function pgCreateArenaSeason(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "arena_seasons");
    await c.query(
      `INSERT INTO arena_seasons (id, code, title, status, reset_policy, started_at, ends_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP::text)`,
      [
        id,
        String(input.code || "").trim(),
        String(input.title || "").trim(),
        String(input.status || "scheduled").trim() || "scheduled",
        String(input.resetPolicy || "quarterly").trim() || "quarterly",
        input.startedAt || null,
        input.endsAt || null,
      ],
    );
    return normalizeArenaSeasonRow((await c.query(`${ARENA_SEASON_SELECT} WHERE s.id=$1`, [id])).rows[0] || null);
  });
}
async function pgFindArenaSeasonByCode(code) {
  return normalizeArenaSeasonRow((await withClient((c) => c.query(`${ARENA_SEASON_SELECT} WHERE s.code=$1`, [String(code || "").trim()]))).rows[0] || null);
}
async function pgListArenaSeasons() {
  return (await withClient((c) => c.query(`${ARENA_SEASON_SELECT} ORDER BY s.id DESC`))).rows.map(normalizeArenaSeasonRow);
}
async function pgUpdateArenaSeason(id, patch) {
  const current = normalizeArenaSeasonRow((await withClient((c) => c.query(`${ARENA_SEASON_SELECT} WHERE s.id=$1`, [Number(id)]))).rows[0] || null);
  if (!current) return null;
  await withClient((c) => c.query(
    `UPDATE arena_seasons
     SET code=$2,
         title=$3,
         status=$4,
         reset_policy=$5,
         started_at=$6,
         ends_at=$7
     WHERE id=$1`,
    [
      Number(id),
      patch.code === undefined ? current.code : String(patch.code || "").trim(),
      patch.title === undefined ? current.title : String(patch.title || "").trim(),
      patch.status === undefined ? current.status : String(patch.status || "scheduled").trim(),
      patch.resetPolicy === undefined ? current.resetPolicy : String(patch.resetPolicy || "quarterly").trim(),
      patch.startedAt === undefined ? current.startedAt : (patch.startedAt || null),
      patch.endsAt === undefined ? current.endsAt : (patch.endsAt || null),
    ],
  ));
  return normalizeArenaSeasonRow((await withClient((c) => c.query(`${ARENA_SEASON_SELECT} WHERE s.id=$1`, [Number(id)]))).rows[0] || null);
}
async function pgCreateArenaScenario(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "arena_scenarios");
    await c.query(
      `INSERT INTO arena_scenarios
       (id, code, title, summary, backend_type, console_type, tier, difficulty, ttl_seconds, validator_key, image_name, flavor_name, network_name, metadata_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CURRENT_TIMESTAMP::text)`,
      [
        id,
        String(input.code || "").trim(),
        String(input.title || "").trim(),
        String(input.summary || "").trim(),
        String(input.backendType || "container").trim() || "container",
        String(input.consoleType || "xterm").trim() || "xterm",
        String(input.tier || "normal").trim() || "normal",
        Math.max(1, Number(input.difficulty || 1)),
        Math.max(60, Number(input.ttlSeconds || 1200)),
        String(input.validatorKey || "").trim(),
        String(input.imageName || "").trim(),
        String(input.flavorName || "").trim(),
        String(input.networkName || "").trim(),
        JSON.stringify(input.metadata || {}),
      ],
    );
    return normalizeArenaScenarioRow((await c.query(`${ARENA_SCENARIO_SELECT} WHERE s.id=$1`, [id])).rows[0] || null);
  });
}
async function pgListArenaScenarios() {
  return (await withClient((c) => c.query(`${ARENA_SCENARIO_SELECT} ORDER BY s.id ASC`))).rows.map(normalizeArenaScenarioRow);
}
async function pgUpdateArenaScenario(id, patch) {
  const current = normalizeArenaScenarioRow((await withClient((c) => c.query(`${ARENA_SCENARIO_SELECT} WHERE s.id=$1`, [Number(id)]))).rows[0] || null);
  if (!current) return null;
  await withClient((c) => c.query(
    `UPDATE arena_scenarios
     SET title=$2,
         summary=$3,
         backend_type=$4,
         console_type=$5,
         tier=$6,
         difficulty=$7,
         ttl_seconds=$8,
         validator_key=$9,
         image_name=$10,
         flavor_name=$11,
         network_name=$12,
         metadata_json=$13
     WHERE id=$1`,
    [
      Number(id),
      patch.title === undefined ? current.title : String(patch.title || "").trim(),
      patch.summary === undefined ? current.summary : String(patch.summary || "").trim(),
      patch.backendType === undefined ? current.backendType : String(patch.backendType || "container").trim(),
      patch.consoleType === undefined ? current.consoleType : String(patch.consoleType || "xterm").trim(),
      patch.tier === undefined ? current.tier : String(patch.tier || "normal").trim(),
      patch.difficulty === undefined ? current.difficulty : Math.max(1, Number(patch.difficulty || 1)),
      patch.ttlSeconds === undefined ? current.ttlSeconds : Math.max(60, Number(patch.ttlSeconds || 1200)),
      patch.validatorKey === undefined ? current.validatorKey : String(patch.validatorKey || "").trim(),
      patch.imageName === undefined ? current.imageName : String(patch.imageName || "").trim(),
      patch.flavorName === undefined ? current.flavorName : String(patch.flavorName || "").trim(),
      patch.networkName === undefined ? current.networkName : String(patch.networkName || "").trim(),
      JSON.stringify(patch.metadata === undefined ? current.metadata : (patch.metadata || {})),
    ],
  ));
  return normalizeArenaScenarioRow((await withClient((c) => c.query(`${ARENA_SCENARIO_SELECT} WHERE s.id=$1`, [Number(id)]))).rows[0] || null);
}
async function pgCreateArenaNode(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "arena_nodes");
    await c.query(
      `INSERT INTO arena_nodes
       (id, season_id, scenario_id, node_code, label, map_x, map_y, current_owner_user_id, current_owner_handle, first_capture_at, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_TIMESTAMP::text)`,
      [
        id,
        Number(input.seasonId),
        Number(input.scenarioId),
        String(input.nodeCode || "").trim(),
        String(input.label || "").trim(),
        Number(input.mapX || 0),
        Number(input.mapY || 0),
        input.currentOwnerUserId == null ? null : Number(input.currentOwnerUserId),
        String(input.currentOwnerHandle || "").trim(),
        input.firstCaptureAt || null,
        String(input.status || "open").trim() || "open",
      ],
    );
    return normalizeArenaNodeRow((await c.query(`${ARENA_NODE_SELECT} WHERE n.id=$1`, [id])).rows[0] || null);
  });
}
async function pgListArenaNodesBySeasonId(seasonId) {
  return (await withClient((c) => c.query(`${ARENA_NODE_SELECT} WHERE n.season_id=$1 ORDER BY n.id ASC`, [Number(seasonId)]))).rows.map(normalizeArenaNodeRow);
}
async function pgFindArenaNodeBySeasonAndCode(seasonId, nodeCode) {
  return normalizeArenaNodeRow((await withClient((c) => c.query(`${ARENA_NODE_SELECT} WHERE n.season_id=$1 AND n.node_code=$2`, [Number(seasonId), String(nodeCode || "").trim()]))).rows[0] || null);
}
async function pgUpdateArenaNode(id, patch) {
  const current = normalizeArenaNodeRow((await withClient((c) => c.query(`${ARENA_NODE_SELECT} WHERE n.id=$1`, [Number(id)]))).rows[0] || null);
  if (!current) return null;
  await withClient((c) => c.query(
    `UPDATE arena_nodes
     SET scenario_id=$2,
         node_code=$3,
         label=$4,
         map_x=$5,
         map_y=$6,
         current_owner_user_id=$7,
         current_owner_handle=$8,
         first_capture_at=$9,
         status=$10
     WHERE id=$1`,
    [
      Number(id),
      patch.scenarioId === undefined ? current.scenarioId : Number(patch.scenarioId || current.scenarioId),
      patch.nodeCode === undefined ? current.nodeCode : String(patch.nodeCode || "").trim(),
      patch.label === undefined ? current.label : String(patch.label || "").trim(),
      patch.mapX === undefined ? current.mapX : Number(patch.mapX || 0),
      patch.mapY === undefined ? current.mapY : Number(patch.mapY || 0),
      patch.currentOwnerUserId === undefined ? current.currentOwnerUserId : (patch.currentOwnerUserId == null ? null : Number(patch.currentOwnerUserId)),
      patch.currentOwnerHandle === undefined ? current.currentOwnerHandle : String(patch.currentOwnerHandle || "").trim(),
      patch.firstCaptureAt === undefined ? current.firstCaptureAt : (patch.firstCaptureAt || null),
      patch.status === undefined ? current.status : String(patch.status || "open").trim(),
    ],
  ));
  return normalizeArenaNodeRow((await withClient((c) => c.query(`${ARENA_NODE_SELECT} WHERE n.id=$1`, [Number(id)]))).rows[0] || null);
}
async function pgCreateArenaSession(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "arena_sessions");
    await c.query(
      `INSERT INTO arena_sessions
       (id, season_id, node_id, scenario_id, user_id, state, backend_type, console_type, resource_id, resource_name, console_url, validator_state, started_at, expires_at, ended_at, terminated_reason, metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        id,
        Number(input.seasonId),
        Number(input.nodeId),
        Number(input.scenarioId),
        Number(input.userId),
        String(input.state || "provisioning").trim() || "provisioning",
        String(input.backendType || "container").trim() || "container",
        String(input.consoleType || "xterm").trim() || "xterm",
        String(input.resourceId || "").trim(),
        String(input.resourceName || "").trim(),
        String(input.consoleUrl || "").trim(),
        String(input.validatorState || "pending").trim() || "pending",
        input.startedAt || new Date().toISOString(),
        input.expiresAt,
        input.endedAt || null,
        String(input.terminatedReason || "").trim(),
        JSON.stringify(input.metadata || {}),
      ],
    );
    return normalizeArenaSessionRow((await c.query(`${ARENA_SESSION_SELECT} WHERE s.id=$1`, [id])).rows[0] || null);
  });
}
async function pgFindArenaSessionById(id) {
  return normalizeArenaSessionRow((await withClient((c) => c.query(`${ARENA_SESSION_SELECT} WHERE s.id=$1`, [Number(id)]))).rows[0] || null);
}
async function pgFindActiveArenaSessionByUserId(userId) {
  return normalizeArenaSessionRow((await withClient((c) => c.query(`${ARENA_SESSION_SELECT} WHERE s.user_id=$1 AND s.state IN ('provisioning','running','rebooting','validating') ORDER BY s.id DESC LIMIT 1`, [Number(userId)]))).rows[0] || null);
}
async function pgListArenaSessions(limit = 50) {
  return (await withClient((c) => c.query(
    `${ARENA_SESSION_SELECT}
     ORDER BY s.id DESC
     LIMIT $1`,
    [Math.max(1, Math.min(200, Number(limit || 50)))],
  ))).rows.map(normalizeArenaSessionRow);
}
async function pgUpdateArenaSession(id, patch) {
  const current = await pgFindArenaSessionById(id);
  if (!current) return null;
  await withClient((c) => c.query(
    `UPDATE arena_sessions
     SET state=$2,
         resource_id=$3,
         resource_name=$4,
         console_url=$5,
         validator_state=$6,
         expires_at=$7,
         ended_at=$8,
         terminated_reason=$9,
         metadata_json=$10
     WHERE id=$1`,
    [
      Number(id),
      patch.state === undefined ? current.state : String(patch.state || current.state).trim(),
      patch.resourceId === undefined ? current.resourceId : String(patch.resourceId || "").trim(),
      patch.resourceName === undefined ? current.resourceName : String(patch.resourceName || "").trim(),
      patch.consoleUrl === undefined ? current.consoleUrl : String(patch.consoleUrl || "").trim(),
      patch.validatorState === undefined ? current.validatorState : String(patch.validatorState || current.validatorState).trim(),
      patch.expiresAt === undefined ? current.expiresAt : patch.expiresAt,
      patch.endedAt === undefined ? current.endedAt : patch.endedAt,
      patch.terminatedReason === undefined ? current.terminatedReason : String(patch.terminatedReason || "").trim(),
      JSON.stringify(patch.metadata === undefined ? current.metadata : (patch.metadata || {})),
    ],
  ));
  return pgFindArenaSessionById(id);
}
async function pgCreateArenaEvent(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "arena_events");
    await c.query(
      `INSERT INTO arena_events (id, season_id, node_id, user_id, event_type, message, payload_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        Number(input.seasonId),
        input.nodeId == null ? null : Number(input.nodeId),
        input.userId == null ? null : Number(input.userId),
        String(input.eventType || "system").trim() || "system",
        String(input.message || "").trim(),
        JSON.stringify(input.payload || {}),
        input.createdAt || new Date().toISOString(),
      ],
    );
    return normalizeArenaEventRow((await c.query(`SELECT id, season_id AS "seasonId", node_id AS "nodeId", user_id AS "userId", event_type AS "eventType", message, payload_json AS "payloadJson", created_at AS "createdAt" FROM arena_events WHERE id=$1`, [id])).rows[0] || null);
  });
}
async function pgListArenaEventsBySeasonId(seasonId, limit = 20) {
  return (await withClient((c) => c.query(
    `SELECT id, season_id AS "seasonId", node_id AS "nodeId", user_id AS "userId", event_type AS "eventType", message, payload_json AS "payloadJson", created_at AS "createdAt"
     FROM arena_events
     WHERE season_id=$1
     ORDER BY id DESC
     LIMIT $2`,
    [Number(seasonId), Math.max(1, Math.min(100, Number(limit || 20)))],
  ))).rows.map(normalizeArenaEventRow);
}
async function pgCreateArenaAttempt(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "arena_attempts");
    await c.query(
      `INSERT INTO arena_attempts
       (id, session_id, season_id, node_id, user_id, result, score, mmr_delta, rank_delta, duration_seconds, first_try_bonus, remaining_seconds, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        Number(input.sessionId),
        Number(input.seasonId),
        Number(input.nodeId),
        Number(input.userId),
        String(input.result || "failed").trim() || "failed",
        Number(input.score || 0),
        Number(input.mmrDelta || 0),
        Number(input.rankDelta || 0),
        Number(input.durationSeconds || 0),
        Number(input.firstTryBonus || 0),
        Number(input.remainingSeconds || 0),
        input.createdAt || new Date().toISOString(),
      ],
    );
    return normalizeArenaAttemptRow((await c.query(
      `SELECT a.id, a.session_id AS "sessionId", a.season_id AS "seasonId", a.node_id AS "nodeId", a.user_id AS "userId",
              a.result, a.score, a.mmr_delta AS "mmrDelta", a.rank_delta AS "rankDelta", a.duration_seconds AS "durationSeconds",
              a.first_try_bonus AS "firstTryBonus", a.remaining_seconds AS "remainingSeconds", a.created_at AS "createdAt",
              n.node_code AS "nodeCode", n.label AS "nodeLabel", s.code AS "scenarioCode", s.title AS "scenarioTitle"
       FROM arena_attempts a
       JOIN arena_nodes n ON n.id = a.node_id
       JOIN arena_scenarios s ON s.id = n.scenario_id
       WHERE a.id=$1`,
      [id],
    )).rows[0] || null);
  });
}
async function pgListArenaAttemptsByUserId(userId, limit = 20) {
  return (await withClient((c) => c.query(
    `SELECT a.id, a.session_id AS "sessionId", a.season_id AS "seasonId", a.node_id AS "nodeId", a.user_id AS "userId",
            a.result, a.score, a.mmr_delta AS "mmrDelta", a.rank_delta AS "rankDelta", a.duration_seconds AS "durationSeconds",
            a.first_try_bonus AS "firstTryBonus", a.remaining_seconds AS "remainingSeconds", a.created_at AS "createdAt",
            n.node_code AS "nodeCode", n.label AS "nodeLabel", s.code AS "scenarioCode", s.title AS "scenarioTitle"
     FROM arena_attempts a
     JOIN arena_nodes n ON n.id = a.node_id
     JOIN arena_scenarios s ON s.id = n.scenario_id
     WHERE a.user_id=$1
     ORDER BY a.id DESC
     LIMIT $2`,
    [Number(userId), Math.max(1, Math.min(100, Number(limit || 20)))],
  ))).rows.map(normalizeArenaAttemptRow);
}
async function pgListArenaAttempts(limit = 50) {
  return (await withClient((c) => c.query(
    `SELECT a.id, a.session_id AS "sessionId", a.season_id AS "seasonId", a.node_id AS "nodeId", a.user_id AS "userId",
            a.result, a.score, a.mmr_delta AS "mmrDelta", a.rank_delta AS "rankDelta", a.duration_seconds AS "durationSeconds",
            a.first_try_bonus AS "firstTryBonus", a.remaining_seconds AS "remainingSeconds", a.created_at AS "createdAt",
            n.node_code AS "nodeCode", n.label AS "nodeLabel", s.code AS "scenarioCode", s.title AS "scenarioTitle"
     FROM arena_attempts a
     JOIN arena_nodes n ON n.id = a.node_id
     JOIN arena_scenarios s ON s.id = n.scenario_id
     ORDER BY a.id DESC
     LIMIT $1`,
    [Math.max(1, Math.min(200, Number(limit || 50)))],
  ))).rows.map(normalizeArenaAttemptRow);
}
async function pgCreateArenaCapture(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "arena_captures");
    await c.query(
      `INSERT INTO arena_captures (id, season_id, node_id, user_id, capture_type, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        id,
        Number(input.seasonId),
        Number(input.nodeId),
        Number(input.userId),
        String(input.captureType || "first_blood").trim() || "first_blood",
        input.createdAt || new Date().toISOString(),
      ],
    );
    return normalizeArenaCaptureRow((await c.query(
      `SELECT c.id, c.season_id AS "seasonId", c.node_id AS "nodeId", c.user_id AS "userId", c.capture_type AS "captureType", c.created_at AS "createdAt",
              n.node_code AS "nodeCode", n.label AS "nodeLabel", s.code AS "scenarioCode", s.title AS "scenarioTitle"
       FROM arena_captures c
       JOIN arena_nodes n ON n.id = c.node_id
       JOIN arena_scenarios s ON s.id = n.scenario_id
       WHERE c.id=$1`,
      [id],
    )).rows[0] || null);
  });
}
async function pgListArenaCapturesByUserId(userId, limit = 20) {
  return (await withClient((c) => c.query(
    `SELECT c.id, c.season_id AS "seasonId", c.node_id AS "nodeId", c.user_id AS "userId", c.capture_type AS "captureType", c.created_at AS "createdAt",
            n.node_code AS "nodeCode", n.label AS "nodeLabel", s.code AS "scenarioCode", s.title AS "scenarioTitle"
     FROM arena_captures c
     JOIN arena_nodes n ON n.id = c.node_id
     JOIN arena_scenarios s ON s.id = n.scenario_id
     WHERE c.user_id=$1
     ORDER BY c.id DESC
     LIMIT $2`,
    [Number(userId), Math.max(1, Math.min(100, Number(limit || 20)))],
  ))).rows.map(normalizeArenaCaptureRow);
}
async function pgListArenaCaptures(limit = 50) {
  return (await withClient((c) => c.query(
    `SELECT c.id, c.season_id AS "seasonId", c.node_id AS "nodeId", c.user_id AS "userId", c.capture_type AS "captureType", c.created_at AS "createdAt",
            n.node_code AS "nodeCode", n.label AS "nodeLabel", s.code AS "scenarioCode", s.title AS "scenarioTitle"
     FROM arena_captures c
     JOIN arena_nodes n ON n.id = c.node_id
     JOIN arena_scenarios s ON s.id = n.scenario_id
     ORDER BY c.id DESC
     LIMIT $1`,
    [Math.max(1, Math.min(200, Number(limit || 50)))],
  ))).rows.map(normalizeArenaCaptureRow);
}

async function pgCreateCicdCredential(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "cicd_credentials");
    const now = new Date().toISOString();
    const row = (await c.query(
      `INSERT INTO cicd_credentials
       (id, user_id, name, slug, credential_type, jenkins_credential_id, username, description, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, user_id AS "userId", name, slug, credential_type AS "credentialType",
                 jenkins_credential_id AS "jenkinsCredentialId", username, description,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        Number(input.userId),
        String(input.name || "").trim(),
        String(input.slug || "").trim(),
        String(input.credentialType || "").trim(),
        String(input.jenkinsCredentialId || "").trim(),
        String(input.username || "").trim(),
        String(input.description || "").trim(),
        now,
        now,
      ],
    )).rows[0];
    return normalizeCicdCredentialRow(row);
  });
}

async function pgFindCicdCredentialById(id) {
  const row = (await withClient((c) => c.query(
    `SELECT id, user_id AS "userId", name, slug, credential_type AS "credentialType",
            jenkins_credential_id AS "jenkinsCredentialId", username, description,
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM cicd_credentials WHERE id=$1`,
    [Number(id)],
  ))).rows[0];
  return normalizeCicdCredentialRow(row);
}

async function pgListCicdCredentialsByUser(userId) {
  return (await withClient((c) => c.query(
    `SELECT id, user_id AS "userId", name, slug, credential_type AS "credentialType",
            jenkins_credential_id AS "jenkinsCredentialId", username, description,
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM cicd_credentials WHERE user_id=$1 ORDER BY updated_at DESC, id DESC`,
    [Number(userId)],
  ))).rows.map(normalizeCicdCredentialRow);
}

async function pgDeleteCicdCredential(id) {
  const row = (await withClient((c) => c.query(
    `DELETE FROM cicd_credentials WHERE id=$1
     RETURNING id, user_id AS "userId", name, slug, credential_type AS "credentialType",
               jenkins_credential_id AS "jenkinsCredentialId", username, description,
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [Number(id)],
  ))).rows[0];
  return normalizeCicdCredentialRow(row);
}

async function pgCreateCicdProject(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "cicd_projects");
    const now = new Date().toISOString();
    const userId = Number(input.userId);
    const name = String(input.name || "CI/CD Pipeline").trim() || "CI/CD Pipeline";
    const slugBase = normalizeCicdSlug(input.slug || name, "pipeline");
    let slug = slugBase;
    for (let index = 2; index < 100; index += 1) {
      const existing = await c.query(`SELECT 1 FROM cicd_projects WHERE user_id=$1 AND slug=$2 LIMIT 1`, [userId, slug]);
      if (!existing.rows.length) break;
      slug = `${slugBase}-${index}`;
    }
    const stages = normalizeCicdStages(input.stages);
    const variables = input.variables && typeof input.variables === "object" && !Array.isArray(input.variables) ? input.variables : {};
    await c.query(
      `INSERT INTO cicd_projects
       (id, user_id, course_id, lab_request_id, name, slug, description, provider, repository_url, branch, pipeline_engine, jenkins_job_name, jenkinsfile_path, build_server_url, status, variables_json, stages_json, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        id,
        userId,
        input.courseId == null || input.courseId === "" ? null : Number(input.courseId),
        input.labRequestId == null || input.labRequestId === "" ? null : Number(input.labRequestId),
        name,
        slug,
        String(input.description || "").trim(),
        String(input.provider || "manual").trim() || "manual",
        String(input.repositoryUrl || "").trim(),
        String(input.branch || "main").trim() || "main",
        normalizeCicdEngine(input.pipelineEngine),
        normalizeJenkinsJobName(input.jenkinsJobName),
        normalizeJenkinsfilePath(input.jenkinsfilePath),
        String(input.buildServerUrl || "").trim(),
        normalizeCicdProjectStatus(input.status),
        JSON.stringify(variables),
        JSON.stringify(stages),
        now,
        now,
      ],
    );
    return normalizeCicdProjectRow((await c.query(`${CICD_PROJECT_SELECT} WHERE p.id=$1`, [id])).rows[0] || null);
  });
}

async function pgFindCicdProjectById(id) {
  return normalizeCicdProjectRow((await withClient((c) => c.query(`${CICD_PROJECT_SELECT} WHERE p.id=$1`, [Number(id)]))).rows[0] || null);
}

async function pgListCicdProjects(limit = 100) {
  return (await withClient((c) => c.query(
    `${CICD_PROJECT_SELECT}
     ORDER BY p.updated_at DESC, p.id DESC
     LIMIT $1`,
    [Math.max(1, Math.min(300, Number(limit || 100)))],
  ))).rows.map(normalizeCicdProjectRow);
}

async function pgListCicdProjectsByUser(userId, limit = 100) {
  return (await withClient((c) => c.query(
    `${CICD_PROJECT_SELECT}
     WHERE p.user_id=$1
     ORDER BY p.updated_at DESC, p.id DESC
     LIMIT $2`,
    [Number(userId), Math.max(1, Math.min(200, Number(limit || 100)))],
  ))).rows.map(normalizeCicdProjectRow);
}

async function pgUpdateCicdProject(id, patch) {
  const current = await pgFindCicdProjectById(id);
  if (!current) return null;
  const nextStages = patch.stages === undefined ? current.stages : normalizeCicdStages(patch.stages);
  const nextVariables = patch.variables === undefined
    ? current.variables
    : (patch.variables && typeof patch.variables === "object" && !Array.isArray(patch.variables) ? patch.variables : {});
  await withClient((c) => c.query(
    `UPDATE cicd_projects
     SET name=$2, description=$3, provider=$4, repository_url=$5, branch=$6, pipeline_engine=$7,
         jenkins_job_name=$8, jenkinsfile_path=$9, build_server_url=$10, status=$11, variables_json=$12, stages_json=$13,
         course_id=$14, lab_request_id=$15, updated_at=$16
     WHERE id=$1`,
    [
      Number(id),
      patch.name === undefined ? current.name : (String(patch.name || "").trim() || current.name),
      patch.description === undefined ? current.description : String(patch.description || "").trim(),
      patch.provider === undefined ? current.provider : (String(patch.provider || "manual").trim() || "manual"),
      patch.repositoryUrl === undefined ? current.repositoryUrl : String(patch.repositoryUrl || "").trim(),
      patch.branch === undefined ? current.branch : (String(patch.branch || "main").trim() || "main"),
      patch.pipelineEngine === undefined ? current.pipelineEngine : normalizeCicdEngine(patch.pipelineEngine),
      patch.jenkinsJobName === undefined ? current.jenkinsJobName : normalizeJenkinsJobName(patch.jenkinsJobName),
      patch.jenkinsfilePath === undefined ? current.jenkinsfilePath : normalizeJenkinsfilePath(patch.jenkinsfilePath),
      patch.buildServerUrl === undefined ? current.buildServerUrl : String(patch.buildServerUrl || "").trim(),
      patch.status === undefined ? current.status : normalizeCicdProjectStatus(patch.status),
      JSON.stringify(nextVariables),
      JSON.stringify(nextStages),
      patch.courseId === undefined ? current.courseId : (patch.courseId == null || patch.courseId === "" ? null : Number(patch.courseId)),
      patch.labRequestId === undefined ? current.labRequestId : (patch.labRequestId == null || patch.labRequestId === "" ? null : Number(patch.labRequestId)),
      new Date().toISOString(),
    ],
  ));
  return pgFindCicdProjectById(id);
}

async function pgCreateCicdRun(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "cicd_runs");
    const now = new Date().toISOString();
    await c.query(
      `INSERT INTO cicd_runs
       (id, project_id, user_id, status, trigger_type, commit_ref, commit_sha, source_branch, summary, current_stage, jenkins_build_number, result_json, started_at, finished_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id,
        Number(input.projectId),
        input.userId == null ? null : Number(input.userId),
        normalizeCicdRunStatus(input.status),
        String(input.triggerType || "manual").trim() || "manual",
        String(input.commitRef || "").trim(),
        String(input.commitSha || "").trim(),
        String(input.sourceBranch || "").trim(),
        String(input.summary || "").trim(),
        String(input.currentStage || "").trim(),
        String(input.jenkinsBuildNumber || "").trim(),
        JSON.stringify(input.result && typeof input.result === "object" && !Array.isArray(input.result) ? input.result : {}),
        input.startedAt || null,
        input.finishedAt || null,
        input.createdAt || now,
      ],
    );
    return normalizeCicdRunRow((await c.query(`${CICD_RUN_SELECT} WHERE r.id=$1`, [id])).rows[0] || null);
  });
}

async function pgListCicdRunEvents(runId) {
  return (await withClient((c) => c.query(
    `SELECT id, run_id AS "runId", stage, status, message, payload_json AS "payloadJson", created_at AS "createdAt"
     FROM cicd_run_events
     WHERE run_id=$1
     ORDER BY created_at ASC, id ASC`,
    [Number(runId)],
  ))).rows.map(normalizeCicdRunEventRow);
}

async function pgFindCicdRunById(id) {
  const row = (await withClient((c) => c.query(`${CICD_RUN_SELECT} WHERE r.id=$1`, [Number(id)]))).rows[0] || null;
  if (!row) return null;
  const events = await pgListCicdRunEvents(id);
  return normalizeCicdRunRow(row, events);
}

async function pgListCicdRuns(limit = 100) {
  return (await withClient((c) => c.query(
    `${CICD_RUN_SELECT}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT $1`,
    [Math.max(1, Math.min(300, Number(limit || 100)))],
  ))).rows.map((row) => normalizeCicdRunRow(row));
}

async function pgListCicdRunsByUser(userId, limit = 100) {
  return (await withClient((c) => c.query(
    `${CICD_RUN_SELECT}
     WHERE p.user_id=$1
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT $2`,
    [Number(userId), Math.max(1, Math.min(200, Number(limit || 100)))],
  ))).rows.map((row) => normalizeCicdRunRow(row));
}

async function pgUpdateCicdRun(id, patch) {
  const current = await pgFindCicdRunById(id);
  if (!current) return null;
  const result = patch.result === undefined
    ? current.result
    : (patch.result && typeof patch.result === "object" && !Array.isArray(patch.result) ? patch.result : {});
  await withClient((c) => c.query(
    `UPDATE cicd_runs
     SET status=$2, trigger_type=$3, commit_ref=$4, commit_sha=$5, source_branch=$6,
         summary=$7, current_stage=$8, jenkins_build_number=$9, result_json=$10, started_at=$11, finished_at=$12
     WHERE id=$1`,
    [
      Number(id),
      patch.status === undefined ? current.status : normalizeCicdRunStatus(patch.status),
      patch.triggerType === undefined ? current.triggerType : (String(patch.triggerType || "manual").trim() || "manual"),
      patch.commitRef === undefined ? current.commitRef : String(patch.commitRef || "").trim(),
      patch.commitSha === undefined ? current.commitSha : String(patch.commitSha || "").trim(),
      patch.sourceBranch === undefined ? current.sourceBranch : String(patch.sourceBranch || "").trim(),
      patch.summary === undefined ? current.summary : String(patch.summary || "").trim(),
      patch.currentStage === undefined ? current.currentStage : String(patch.currentStage || "").trim(),
      patch.jenkinsBuildNumber === undefined ? current.jenkinsBuildNumber : String(patch.jenkinsBuildNumber || "").trim(),
      JSON.stringify(result),
      patch.startedAt === undefined ? current.startedAt : patch.startedAt,
      patch.finishedAt === undefined ? current.finishedAt : patch.finishedAt,
    ],
  ));
  return pgFindCicdRunById(id);
}

async function pgCreateCicdRunEvent(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "cicd_run_events");
    await c.query(
      `INSERT INTO cicd_run_events (id, run_id, stage, status, message, payload_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        Number(input.runId),
        String(input.stage || "").trim(),
        normalizeCicdEventStatus(input.status),
        String(input.message || "").trim(),
        JSON.stringify(input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload : {}),
        input.createdAt || new Date().toISOString(),
      ],
    );
    return normalizeCicdRunEventRow((await c.query(
      `SELECT id, run_id AS "runId", stage, status, message, payload_json AS "payloadJson", created_at AS "createdAt"
       FROM cicd_run_events
       WHERE id=$1`,
      [id],
    )).rows[0] || null);
  });
}

const HEAT_WORKLOAD_TEST_JOB_SELECT = `
  SELECT job_id AS "jobId", status, phase, message,
         template_name AS "templateName", project_name AS "projectName",
         stack_name AS "stackName", stack_id AS "stackId",
         stack_count AS "stackCount", created_stack_count AS "createdStackCount",
         ready_stack_count AS "readyStackCount", failed_stack_count AS "failedStackCount",
         pending_stack_count AS "pendingStackCount", hold_seconds AS "holdSeconds",
         cleanup_due_at AS "cleanupDueAt", started_at AS "startedAt",
         updated_at AS "updatedAt", completed_at AS "completedAt",
         error_message AS "errorMessage", result_json AS "resultJson",
         stack_status_summary_json AS "stackStatusSummaryJson",
         host_usage_report_json AS "hostUsageReportJson",
         stacks_json AS "stacksJson", payload_json AS "payloadJson",
         created_by_user_id AS "createdByUserId",
         created_by_username AS "createdByUsername",
         created_at AS "createdAt"
  FROM heat_workload_test_jobs
`;

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeJsonStringify(value, fallback) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}

function normalizeHeatWorkloadTestJobRow(row) {
  if (!row) return null;
  const payload = safeJsonParse(row.payloadJson ?? row.payload_json ?? "{}", {});
  const result = safeJsonParse(row.resultJson ?? row.result_json ?? "{}", {});
  const stackStatusSummary = safeJsonParse(row.stackStatusSummaryJson ?? row.stack_status_summary_json ?? "{}", {});
  const hostUsageReport = safeJsonParse(row.hostUsageReportJson ?? row.host_usage_report_json ?? "{}", {});
  const stacks = safeJsonParse(row.stacksJson ?? row.stacks_json ?? "[]", []);
  const normalizedResult = isPlainObject(result) && Object.keys(result).length ? result : payload?.result || null;
  const normalizedHostUsageReport = isPlainObject(hostUsageReport) && Object.keys(hostUsageReport).length
    ? hostUsageReport
    : payload?.hostUsageReport || normalizedResult?.hostUsageReport || null;
  const normalizedStackStatusSummary = isPlainObject(stackStatusSummary) && Object.keys(stackStatusSummary).length
    ? stackStatusSummary
    : payload?.stackStatusSummary || normalizedResult?.stackStatusSummary || null;
  const normalizedStacks = Array.isArray(stacks) && stacks.length
    ? stacks
    : Array.isArray(payload?.stacks)
      ? payload.stacks
      : Array.isArray(normalizedResult?.stacks)
        ? normalizedResult.stacks
        : [];
  return {
    ...(isPlainObject(payload) ? payload : {}),
    jobId: String(row.jobId ?? row.job_id ?? payload?.jobId ?? ""),
    status: String(row.status ?? payload?.status ?? "queued"),
    phase: String(row.phase ?? payload?.phase ?? "queued"),
    message: String(row.message ?? payload?.message ?? ""),
    templateName: String(row.templateName ?? row.template_name ?? payload?.templateName ?? ""),
    projectName: String(row.projectName ?? row.project_name ?? payload?.projectName ?? ""),
    stackName: String(row.stackName ?? row.stack_name ?? payload?.stackName ?? ""),
    stackId: String(row.stackId ?? row.stack_id ?? payload?.stackId ?? ""),
    stackCount: Math.max(1, Number(row.stackCount ?? row.stack_count ?? payload?.stackCount ?? 1) || 1),
    createdStackCount: Math.max(0, Number(row.createdStackCount ?? row.created_stack_count ?? payload?.createdStackCount ?? 0) || 0),
    readyStackCount: Math.max(0, Number(row.readyStackCount ?? row.ready_stack_count ?? payload?.readyStackCount ?? normalizedResult?.readyStackCount ?? 0) || 0),
    failedStackCount: Math.max(0, Number(row.failedStackCount ?? row.failed_stack_count ?? payload?.failedStackCount ?? normalizedResult?.failedStackCount ?? 0) || 0),
    pendingStackCount: Math.max(0, Number(row.pendingStackCount ?? row.pending_stack_count ?? payload?.pendingStackCount ?? normalizedResult?.pendingStackCount ?? 0) || 0),
    holdSeconds: Math.max(0, Number(row.holdSeconds ?? row.hold_seconds ?? payload?.holdSeconds ?? 0) || 0),
    cleanupDueAt: String(row.cleanupDueAt ?? row.cleanup_due_at ?? payload?.cleanupDueAt ?? ""),
    startedAt: String(row.startedAt ?? row.started_at ?? payload?.startedAt ?? ""),
    updatedAt: String(row.updatedAt ?? row.updated_at ?? payload?.updatedAt ?? ""),
    completedAt: String(row.completedAt ?? row.completed_at ?? payload?.completedAt ?? ""),
    errorMessage: String(row.errorMessage ?? row.error_message ?? payload?.errorMessage ?? ""),
    result: normalizedResult,
    stackStatusSummary: normalizedStackStatusSummary,
    hostUsageReport: normalizedHostUsageReport,
    stacks: normalizedStacks,
    createdByUserId: Number(row.createdByUserId ?? row.created_by_user_id ?? payload?.createdByUserId ?? 0) || null,
    createdByUsername: String(row.createdByUsername ?? row.created_by_username ?? payload?.createdByUsername ?? ""),
    createdAt: String(row.createdAt ?? row.created_at ?? payload?.createdAt ?? payload?.startedAt ?? ""),
  };
}

async function pgUpsertHeatWorkloadTestJob(job) {
  if (!job?.jobId) return null;
  const normalized = normalizeHeatWorkloadTestJobRow({
    ...job,
    payloadJson: safeJsonStringify(job, {}),
    resultJson: safeJsonStringify(job.result || {}, {}),
    stackStatusSummaryJson: safeJsonStringify(job.stackStatusSummary || job.result?.stackStatusSummary || {}, {}),
    hostUsageReportJson: safeJsonStringify(job.hostUsageReport || job.result?.hostUsageReport || {}, {}),
    stacksJson: safeJsonStringify(Array.isArray(job.stacks) ? job.stacks : Array.isArray(job.result?.stacks) ? job.result.stacks : [], []),
  });
  const now = new Date().toISOString();
  const payloadJson = safeJsonStringify(normalized, {});
  const resultJson = safeJsonStringify(normalized.result || {}, {});
  const stackStatusSummaryJson = safeJsonStringify(normalized.stackStatusSummary || {}, {});
  const hostUsageReportJson = safeJsonStringify(normalized.hostUsageReport || {}, {});
  const stacksJson = safeJsonStringify(Array.isArray(normalized.stacks) ? normalized.stacks : [], []);
  const row = (await withClient((c) => c.query(
    `
      INSERT INTO heat_workload_test_jobs (
        job_id, status, phase, message, template_name, project_name, stack_name, stack_id,
        stack_count, created_stack_count, ready_stack_count, failed_stack_count, pending_stack_count,
        hold_seconds, cleanup_due_at, started_at, updated_at, completed_at, error_message,
        result_json, stack_status_summary_json, host_usage_report_json, stacks_json, payload_json,
        created_by_user_id, created_by_username, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
      ON CONFLICT (job_id) DO UPDATE SET
        status=EXCLUDED.status,
        phase=EXCLUDED.phase,
        message=EXCLUDED.message,
        template_name=EXCLUDED.template_name,
        project_name=EXCLUDED.project_name,
        stack_name=EXCLUDED.stack_name,
        stack_id=EXCLUDED.stack_id,
        stack_count=EXCLUDED.stack_count,
        created_stack_count=EXCLUDED.created_stack_count,
        ready_stack_count=EXCLUDED.ready_stack_count,
        failed_stack_count=EXCLUDED.failed_stack_count,
        pending_stack_count=EXCLUDED.pending_stack_count,
        hold_seconds=EXCLUDED.hold_seconds,
        cleanup_due_at=EXCLUDED.cleanup_due_at,
        started_at=EXCLUDED.started_at,
        updated_at=EXCLUDED.updated_at,
        completed_at=EXCLUDED.completed_at,
        error_message=EXCLUDED.error_message,
        result_json=EXCLUDED.result_json,
        stack_status_summary_json=EXCLUDED.stack_status_summary_json,
        host_usage_report_json=EXCLUDED.host_usage_report_json,
        stacks_json=EXCLUDED.stacks_json,
        payload_json=EXCLUDED.payload_json,
        created_by_user_id=COALESCE(EXCLUDED.created_by_user_id, heat_workload_test_jobs.created_by_user_id),
        created_by_username=COALESCE(NULLIF(EXCLUDED.created_by_username, ''), heat_workload_test_jobs.created_by_username)
      WHERE heat_workload_test_jobs.updated_at <= EXCLUDED.updated_at
      RETURNING *
    `,
    [
      normalized.jobId,
      normalized.status || "queued",
      normalized.phase || "queued",
      normalized.message || "",
      normalized.templateName || "",
      normalized.projectName || "",
      normalized.stackName || "",
      normalized.stackId || "",
      normalized.stackCount,
      normalized.createdStackCount,
      normalized.readyStackCount,
      normalized.failedStackCount,
      normalized.pendingStackCount,
      normalized.holdSeconds,
      normalized.cleanupDueAt || null,
      normalized.startedAt || null,
      normalized.updatedAt || now,
      normalized.completedAt || null,
      normalized.errorMessage || "",
      resultJson,
      stackStatusSummaryJson,
      hostUsageReportJson,
      stacksJson,
      payloadJson,
      normalized.createdByUserId || null,
      normalized.createdByUsername || "",
      normalized.createdAt || normalized.startedAt || now,
    ],
  ))).rows[0] || null;
  return normalizeHeatWorkloadTestJobRow(row);
}

async function pgFindHeatWorkloadTestJob(jobId) {
  const normalizedJobId = String(jobId || "").trim();
  if (!normalizedJobId) return null;
  const row = (await withClient((c) => c.query(
    `${HEAT_WORKLOAD_TEST_JOB_SELECT} WHERE job_id=$1`,
    [normalizedJobId],
  ))).rows[0] || null;
  return normalizeHeatWorkloadTestJobRow(row);
}

async function pgListHeatWorkloadTestJobs(options = {}) {
  const limit = Math.max(1, Math.min(100, Number(options?.limit || 10) || 10));
  const status = String(options?.status || "").trim().toLowerCase();
  const params = [];
  let where = "";
  if (status) {
    params.push(status);
    where = `WHERE lower(status)=$${params.length}`;
  }
  params.push(limit);
  const rows = (await withClient((c) => c.query(
    `${HEAT_WORKLOAD_TEST_JOB_SELECT}
     ${where}
     ORDER BY updated_at DESC, started_at DESC, created_at DESC
     LIMIT $${params.length}`,
    params,
  ))).rows;
  return rows.map(normalizeHeatWorkloadTestJobRow).filter(Boolean);
}

export async function runtimeCreateUser(input) { return pgCreateUser(input); }
export async function runtimeFindUserByUsername(username) { return pgFindUserByUsername(username); }
export async function runtimeFindUserByEmail(email) { return pgFindUserByEmail(email); }
export async function runtimeFindUserById(id) { return pgFindUserById(id); }
export async function runtimeFindOauthAccount(provider, providerUserId) { return pgFindOauthAccount(provider, providerUserId); }
export async function runtimeCreateOauthAccount(input) { return pgCreateOauthAccount(input); }
export async function runtimeListUsers() { return pgListUsers(); }
export async function runtimeRecordUserMarketingConsent(input) { return pgRecordUserMarketingConsent(input); }
export async function runtimeCreateArenaSeason(input) { return pgCreateArenaSeason(input); }
export async function runtimeFindArenaSeasonByCode(code) { return pgFindArenaSeasonByCode(code); }
export async function runtimeListArenaSeasons() { return pgListArenaSeasons(); }
export async function runtimeUpdateArenaSeason(id, patch) { return pgUpdateArenaSeason(id, patch); }
export async function runtimeCreateArenaScenario(input) { return pgCreateArenaScenario(input); }
export async function runtimeListArenaScenarios() { return pgListArenaScenarios(); }
export async function runtimeUpdateArenaScenario(id, patch) { return pgUpdateArenaScenario(id, patch); }
export async function runtimeCreateArenaNode(input) { return pgCreateArenaNode(input); }
export async function runtimeListArenaNodesBySeasonId(seasonId) { return pgListArenaNodesBySeasonId(seasonId); }
export async function runtimeFindArenaNodeBySeasonAndCode(seasonId, nodeCode) { return pgFindArenaNodeBySeasonAndCode(seasonId, nodeCode); }
export async function runtimeUpdateArenaNode(id, patch) { return pgUpdateArenaNode(id, patch); }
export async function runtimeCreateArenaSession(input) { return pgCreateArenaSession(input); }
export async function runtimeFindArenaSessionById(id) { return pgFindArenaSessionById(id); }
export async function runtimeFindActiveArenaSessionByUserId(userId) { return pgFindActiveArenaSessionByUserId(userId); }
export async function runtimeListArenaSessions(limit) { return pgListArenaSessions(limit); }
export async function runtimeUpdateArenaSession(id, patch) { return pgUpdateArenaSession(id, patch); }
export async function runtimeCreateArenaEvent(input) { return pgCreateArenaEvent(input); }
export async function runtimeListArenaEventsBySeasonId(seasonId, limit) { return pgListArenaEventsBySeasonId(seasonId, limit); }
export async function runtimeCreateArenaAttempt(input) { return pgCreateArenaAttempt(input); }
export async function runtimeListArenaAttemptsByUserId(userId, limit) { return pgListArenaAttemptsByUserId(userId, limit); }
export async function runtimeListArenaAttempts(limit) { return pgListArenaAttempts(limit); }
export async function runtimeCreateArenaCapture(input) { return pgCreateArenaCapture(input); }
export async function runtimeListArenaCapturesByUserId(userId, limit) { return pgListArenaCapturesByUserId(userId, limit); }
export async function runtimeListArenaCaptures(limit) { return pgListArenaCaptures(limit); }
export async function runtimeCreateCicdCredential(input) { return pgCreateCicdCredential(input); }
export async function runtimeFindCicdCredentialById(id) { return pgFindCicdCredentialById(id); }
export async function runtimeListCicdCredentialsByUser(userId) { return pgListCicdCredentialsByUser(userId); }
export async function runtimeDeleteCicdCredential(id) { return pgDeleteCicdCredential(id); }
export async function runtimeCreateCicdProject(input) { return pgCreateCicdProject(input); }
export async function runtimeFindCicdProjectById(id) { return pgFindCicdProjectById(id); }
export async function runtimeListCicdProjects(limit) { return pgListCicdProjects(limit); }
export async function runtimeListCicdProjectsByUser(userId, limit) { return pgListCicdProjectsByUser(userId, limit); }
export async function runtimeUpdateCicdProject(id, patch) { return pgUpdateCicdProject(id, patch); }
export async function runtimeCreateCicdRun(input) { return pgCreateCicdRun(input); }
export async function runtimeFindCicdRunById(id) { return pgFindCicdRunById(id); }
export async function runtimeListCicdRuns(limit) { return pgListCicdRuns(limit); }
export async function runtimeListCicdRunsByUser(userId, limit) { return pgListCicdRunsByUser(userId, limit); }
export async function runtimeUpdateCicdRun(id, patch) { return pgUpdateCicdRun(id, patch); }
export async function runtimeCreateCicdRunEvent(input) { return pgCreateCicdRunEvent(input); }
export async function runtimeListCicdRunEvents(runId) { return pgListCicdRunEvents(runId); }
export async function runtimeUpsertHeatWorkloadTestJob(job) { return pgUpsertHeatWorkloadTestJob(job); }
export async function runtimeFindHeatWorkloadTestJob(jobId) { return pgFindHeatWorkloadTestJob(jobId); }
export async function runtimeListHeatWorkloadTestJobs(options) { return pgListHeatWorkloadTestJobs(options); }
export async function runtimeEnsureSchema() {
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS request_rate_limits (key_hash TEXT PRIMARY KEY,window_started_at_ms BIGINT NOT NULL,expires_at_ms BIGINT NOT NULL,hit_count INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_request_rate_limits_expires ON request_rate_limits(expires_at_ms)`));
  await withClient((c) => c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS user_source TEXT NOT NULL DEFAULT 'self_signup'`));
  await withClient((c) => c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_reason TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS qna_last_read_at TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_enabled INTEGER NOT NULL DEFAULT 0`));
  await withClient((c) => c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_secret TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS support_message_enabled INTEGER NOT NULL DEFAULT 0`));
  await withClient((c) => c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS self_service_vm_enabled INTEGER NOT NULL DEFAULT 0`));
  await withClient((c) => c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS instructor_share_enabled INTEGER NOT NULL DEFAULT 0`));
  await withClient((c) => c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_permissions_json TEXT NOT NULL DEFAULT '[]'`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS self_service_project_requests (id BIGINT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'requested',requested_project_name TEXT NOT NULL DEFAULT '',project_name TEXT NOT NULL DEFAULT '',network_name TEXT NOT NULL DEFAULT '',subnet_cidr TEXT NOT NULL DEFAULT '',network_requests_json TEXT NOT NULL DEFAULT '[]',note TEXT NOT NULL DEFAULT '',review_note TEXT NOT NULL DEFAULT '',reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL,reviewed_at TEXT)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_self_service_project_requests_user ON self_service_project_requests(user_id, status, created_at DESC)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_self_service_project_requests_project ON self_service_project_requests(project_name)`));
  await withClient((c) => c.query(`ALTER TABLE self_service_project_requests ADD COLUMN IF NOT EXISTS network_name TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE self_service_project_requests ADD COLUMN IF NOT EXISTS subnet_cidr TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE self_service_project_requests ADD COLUMN IF NOT EXISTS network_requests_json TEXT NOT NULL DEFAULT '[]'`));
  await withClient((c) => c.query(`ALTER TABLE self_service_project_requests ADD COLUMN IF NOT EXISTS quota_profile_id TEXT NOT NULL DEFAULT 'basic'`));
  await withClient((c) => c.query(`ALTER TABLE self_service_project_requests ADD COLUMN IF NOT EXISTS requested_quota_json TEXT NOT NULL DEFAULT '{}'`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS zun_containers (id BIGINT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'requested',project_name TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,image_name TEXT NOT NULL,command_text TEXT NOT NULL DEFAULT '',exposed_port INTEGER,container_uuid TEXT,registry_id TEXT NOT NULL DEFAULT '',registry_domain TEXT NOT NULL DEFAULT '',resource_source TEXT NOT NULL DEFAULT '',resource_preset_id TEXT NOT NULL DEFAULT '',addresses_json TEXT NOT NULL DEFAULT '[]',public_domains_json TEXT NOT NULL DEFAULT '[]',error_message TEXT,created_at TEXT NOT NULL,started_at TEXT,stopped_at TEXT)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS magnum_clusters (id BIGINT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'requested',project_name TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,cluster_template_id TEXT NOT NULL,cluster_template_name TEXT NOT NULL DEFAULT '',kubernetes_version TEXT NOT NULL DEFAULT '',node_count INTEGER NOT NULL DEFAULT 1,master_count INTEGER NOT NULL DEFAULT 1,control_plane_flavor TEXT NOT NULL DEFAULT '',worker_flavor TEXT NOT NULL DEFAULT '',cluster_uuid TEXT,api_address TEXT NOT NULL DEFAULT '',api_port INTEGER NOT NULL DEFAULT 6443,external_api_enabled INTEGER NOT NULL DEFAULT 0,external_api_host TEXT NOT NULL DEFAULT '',external_api_port INTEGER,status_reason TEXT NOT NULL DEFAULT '',error_message TEXT,created_at TEXT NOT NULL,started_at TEXT,deleted_at TEXT)`));
  await withClient((c) => c.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS kubernetes_version TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS trove_instances (id BIGINT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'requested',project_name TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,datastore_type TEXT NOT NULL,datastore_version TEXT NOT NULL DEFAULT '',flavor TEXT NOT NULL,size_gb INTEGER NOT NULL DEFAULT 1,instance_uuid TEXT,hostname TEXT NOT NULL DEFAULT '',status_reason TEXT NOT NULL DEFAULT '',error_message TEXT,created_at TEXT NOT NULL,started_at TEXT,deleted_at TEXT)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS resource_deletion_jobs (id TEXT PRIMARY KEY,resource_type TEXT NOT NULL,resource_id TEXT NOT NULL DEFAULT '',user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,project_name TEXT NOT NULL DEFAULT '',resource_name TEXT NOT NULL DEFAULT '',remote_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_resource_deletion_jobs_status_updated ON resource_deletion_jobs(status, updated_at DESC)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_resource_deletion_jobs_project_updated ON resource_deletion_jobs(project_name, updated_at DESC)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS cloud_console_actions (id BIGINT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,project_name TEXT NOT NULL DEFAULT '',operation TEXT NOT NULL,request_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'requested',estimated_monthly_cost INTEGER NOT NULL DEFAULT 0,result_json TEXT NOT NULL DEFAULT '{}',error_message TEXT NOT NULL DEFAULT '',reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL,reviewed_at TEXT,executed_at TEXT)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_cloud_console_actions_user_created ON cloud_console_actions(user_id, created_at DESC)`));
  await withClient((c) => c.query(`ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS registry_id TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS registry_domain TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS resource_source TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS resource_preset_id TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE zun_containers ADD COLUMN IF NOT EXISTS public_domains_json TEXT NOT NULL DEFAULT '[]'`));
  await withClient((c) => c.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS control_plane_flavor TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS worker_flavor TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS api_port INTEGER NOT NULL DEFAULT 6443`));
  await withClient((c) => c.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS external_api_enabled INTEGER NOT NULL DEFAULT 0`));
  await withClient((c) => c.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS external_api_host TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE magnum_clusters ADD COLUMN IF NOT EXISTS external_api_port INTEGER`));
  await withClient((c) => c.query(`ALTER TABLE trove_instances ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE trove_instances ADD COLUMN IF NOT EXISTS database_name TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE trove_instances ADD COLUMN IF NOT EXISTS database_username TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE trove_instances ADD COLUMN IF NOT EXISTS credential_secret_ref TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE trove_instances ADD COLUMN IF NOT EXISTS database_port INTEGER NOT NULL DEFAULT 3306`));
  await withClient((c) => c.query(`UPDATE platform_settings SET value='poc-example.com' WHERE key='magnumProjectName' AND TRIM(COALESCE(value, '')) IN ('', 'magnum')`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_zun_containers_project_status ON zun_containers(project_name, status)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_magnum_clusters_project_status ON magnum_clusters(project_name, status)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_trove_instances_project_status ON trove_instances(project_name, status)`));
  await withClient((c) => c.query(`DELETE FROM zun_containers WHERE LOWER(COALESCE(status, '')) = 'deleted'`));
  await withClient((c) => c.query(`DELETE FROM magnum_clusters WHERE LOWER(COALESCE(status, '')) IN ('deleted', 'delete_complete')`));
  await withClient((c) => c.query(`DELETE FROM trove_instances WHERE LOWER(COALESCE(status, '')) = 'deleted'`));
  await withClient((c) => c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poc_free_access_enabled INTEGER NOT NULL DEFAULT 0`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS oauth_accounts (id BIGINT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,provider TEXT NOT NULL,provider_user_id TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',display_name TEXT NOT NULL DEFAULT '',profile_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(provider,provider_user_id))`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS password_reset_pins (id TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),pin_hash TEXT NOT NULL,issued_by BIGINT REFERENCES users(id),expires_at TEXT NOT NULL,used_at TEXT,attempt_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS user_access_logs (id BIGINT PRIMARY KEY,user_id BIGINT REFERENCES users(id),user_name TEXT NOT NULL DEFAULT '',username TEXT NOT NULL DEFAULT '',event_type TEXT NOT NULL,ip_address TEXT NOT NULL DEFAULT '',user_agent TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_user_access_logs_user_created ON user_access_logs(user_id,created_at DESC)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_user_access_logs_event_created ON user_access_logs(event_type,created_at DESC)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS user_session_devices (session_id TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,ip_address TEXT NOT NULL DEFAULT '',ip_prefix TEXT NOT NULL DEFAULT '',user_agent_hash TEXT NOT NULL DEFAULT '',user_agent TEXT NOT NULL DEFAULT '',first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,warned_at TEXT,restricted_at TEXT,status TEXT NOT NULL DEFAULT 'active')`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_user_session_devices_user_last_seen ON user_session_devices(user_id,last_seen_at)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS user_access_restrictions (id BIGINT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,reason TEXT NOT NULL DEFAULT '',restricted_until TEXT NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,resolved_at TEXT)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_user_access_restrictions_user_until ON user_access_restrictions(user_id,restricted_until)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS terms_versions (id BIGINT PRIMARY KEY,terms_key TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',version TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',content_hash TEXT NOT NULL DEFAULT '',is_active INTEGER NOT NULL DEFAULT 0,created_by BIGINT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,published_at TEXT,UNIQUE(terms_key, version))`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_terms_versions_key_active ON terms_versions(terms_key, is_active)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS user_terms_agreements (id BIGINT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,terms_version_id BIGINT NOT NULL REFERENCES terms_versions(id),terms_key TEXT NOT NULL,terms_title TEXT NOT NULL DEFAULT '',terms_version TEXT NOT NULL,terms_summary TEXT NOT NULL DEFAULT '',terms_body TEXT NOT NULL DEFAULT '',content_hash TEXT NOT NULL DEFAULT '',ip_address TEXT NOT NULL DEFAULT '',user_agent TEXT NOT NULL DEFAULT '',agreed_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`ALTER TABLE user_terms_agreements ADD COLUMN IF NOT EXISTS terms_title TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE user_terms_agreements ADD COLUMN IF NOT EXISTS terms_summary TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE user_terms_agreements ADD COLUMN IF NOT EXISTS terms_body TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_user_terms_agreements_user ON user_terms_agreements(user_id, agreed_at DESC)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS textbooks (id BIGINT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',content_markdown TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',version TEXT NOT NULL DEFAULT '1.0',created_by BIGINT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS course_textbooks (id BIGINT PRIMARY KEY,course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,textbook_id BIGINT NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,sort_order INTEGER NOT NULL DEFAULT 0,required INTEGER NOT NULL DEFAULT 0,visible INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,UNIQUE(course_id,textbook_id))`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_course_textbooks_course_order ON course_textbooks(course_id,sort_order,id)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_course_textbooks_textbook ON course_textbooks(textbook_id)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS user_marketing_consents (id BIGINT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,channel TEXT NOT NULL DEFAULT 'email',purpose TEXT NOT NULL DEFAULT 'marketing',consented INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL DEFAULT '',ip_address TEXT NOT NULL DEFAULT '',user_agent TEXT NOT NULL DEFAULT '',agreed_at TEXT,revoked_at TEXT,created_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_user_marketing_consents_user_created ON user_marketing_consents(user_id, created_at DESC)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS public_quote_inquiries (id BIGINT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'requested',company_name TEXT NOT NULL DEFAULT '',contact_name TEXT NOT NULL DEFAULT '',contact_email TEXT NOT NULL DEFAULT '',contact_phone TEXT NOT NULL DEFAULT '',interest_type TEXT NOT NULL DEFAULT '',course_titles TEXT NOT NULL DEFAULT '',participant_count INTEGER NOT NULL DEFAULT 1,desired_timeline TEXT NOT NULL DEFAULT '',requirements TEXT NOT NULL DEFAULT '',privacy_agreed INTEGER NOT NULL DEFAULT 0,ip_address TEXT NOT NULL DEFAULT '',user_agent TEXT NOT NULL DEFAULT '',admin_note TEXT NOT NULL DEFAULT '',reviewed_by BIGINT REFERENCES users(id),created_at TEXT NOT NULL,reviewed_at TEXT)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_public_quote_inquiries_status_created ON public_quote_inquiries(status, created_at DESC)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_public_quote_inquiries_email_created ON public_quote_inquiries(contact_email, created_at DESC)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS course_quotes (id BIGINT PRIMARY KEY,quote_no TEXT NOT NULL UNIQUE,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'issued',recipient_company_name TEXT NOT NULL DEFAULT '',recipient_name TEXT NOT NULL DEFAULT '',recipient_email TEXT NOT NULL DEFAULT '',recipient_phone TEXT NOT NULL DEFAULT '',subtotal_amount INTEGER NOT NULL DEFAULT 0,discount_rate DOUBLE PRECISION NOT NULL DEFAULT 0,discount_amount INTEGER NOT NULL DEFAULT 0,vat_rate DOUBLE PRECISION NOT NULL DEFAULT 0.1,vat_amount INTEGER NOT NULL DEFAULT 0,total_amount INTEGER NOT NULL DEFAULT 0,currency TEXT NOT NULL DEFAULT 'KRW',pricing_basis_json TEXT NOT NULL DEFAULT '{}',business_snapshot_json TEXT NOT NULL DEFAULT '{}',note TEXT NOT NULL DEFAULT '',issued_at TEXT NOT NULL,valid_until TEXT,sent_at TEXT,sent_by BIGINT REFERENCES users(id) ON DELETE SET NULL,accepted_at TEXT,cancelled_at TEXT,reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,updated_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`ALTER TABLE course_quotes ADD COLUMN IF NOT EXISTS sent_at TEXT`));
  await withClient((c) => c.query(`ALTER TABLE course_quotes ADD COLUMN IF NOT EXISTS sent_by BIGINT REFERENCES users(id) ON DELETE SET NULL`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_course_quotes_user_issued ON course_quotes(user_id, issued_at DESC)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_course_quotes_status_issued ON course_quotes(status, issued_at DESC)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS course_quote_items (id BIGINT PRIMARY KEY,quote_id BIGINT NOT NULL REFERENCES course_quotes(id) ON DELETE CASCADE,course_id BIGINT REFERENCES courses(id) ON DELETE SET NULL,course_title TEXT NOT NULL DEFAULT '',course_slug TEXT NOT NULL DEFAULT '',course_category TEXT NOT NULL DEFAULT '',course_type TEXT NOT NULL DEFAULT 'standard',program_type TEXT NOT NULL DEFAULT '',duration TEXT NOT NULL DEFAULT '',quantity INTEGER NOT NULL DEFAULT 1,unit_price INTEGER NOT NULL DEFAULT 0,line_subtotal INTEGER NOT NULL DEFAULT 0,pricing_note TEXT NOT NULL DEFAULT '',metadata_json TEXT NOT NULL DEFAULT '{}',sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_course_quote_items_quote ON course_quote_items(quote_id, sort_order, id)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS user_messages (id BIGINT PRIMARY KEY,sender_id BIGINT NOT NULL REFERENCES users(id),recipient_id BIGINT NOT NULL REFERENCES users(id),subject TEXT NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,read_at TEXT,sender_archived INTEGER NOT NULL DEFAULT 0,recipient_archived INTEGER NOT NULL DEFAULT 0)`));
  await withClient((c) => c.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS sender_archived INTEGER NOT NULL DEFAULT 0`));
  await withClient((c) => c.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS recipient_archived INTEGER NOT NULL DEFAULT 0`));
  await withClient((c) => c.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS recipient_type TEXT NOT NULL DEFAULT 'user'`));
  await withClient((c) => c.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS recipient_group_key TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS recipient_group_name TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS delivery_group_id TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS cleanup_status TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS cleanup_status_note TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS cleanup_status_updated_at TEXT`));
  await withClient((c) => c.query(`ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS cleanup_status_updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS mail_logs (id TEXT PRIMARY KEY,mail_type TEXT NOT NULL DEFAULT '',provider TEXT NOT NULL DEFAULT '',sender_username TEXT NOT NULL DEFAULT '',recipient_mode TEXT NOT NULL DEFAULT 'manual',recipient_count INTEGER NOT NULL DEFAULT 0,recipients_json TEXT NOT NULL DEFAULT '[]',subject TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'sent',error_message TEXT NOT NULL DEFAULT '',metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS mail_campaigns (id TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',purpose TEXT NOT NULL DEFAULT 'operational',subject TEXT NOT NULL DEFAULT '',body_text TEXT NOT NULL DEFAULT '',recipient_modes_json TEXT NOT NULL DEFAULT '[]',source_file_name TEXT NOT NULL DEFAULT '',source_hash TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',total_count INTEGER NOT NULL DEFAULT 0,queued_count INTEGER NOT NULL DEFAULT 0,accepted_count INTEGER NOT NULL DEFAULT 0,failed_count INTEGER NOT NULL DEFAULT 0,bounced_count INTEGER NOT NULL DEFAULT 0,replied_count INTEGER NOT NULL DEFAULT 0,no_reply_count INTEGER NOT NULL DEFAULT 0,reply_deadline_at TEXT,created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,created_by_username TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,started_at TEXT,completed_at TEXT)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS mail_campaign_deliveries (id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES mail_campaigns(id) ON DELETE CASCADE,source TEXT NOT NULL DEFAULT 'manual',sources_json TEXT NOT NULL DEFAULT '[]',company_name TEXT NOT NULL DEFAULT '',recipient_name TEXT NOT NULL DEFAULT '',user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,email TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'queued',provider TEXT NOT NULL DEFAULT '',message_id TEXT NOT NULL DEFAULT '',attempt_count INTEGER NOT NULL DEFAULT 0,error_message TEXT NOT NULL DEFAULT '',metadata_json TEXT NOT NULL DEFAULT '{}',accepted_at TEXT,bounced_at TEXT,replied_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(campaign_id,email))`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_mail_campaigns_created ON mail_campaigns(created_at DESC,id DESC)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_mail_campaigns_status_created ON mail_campaigns(status,created_at,id)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_mail_campaign_deliveries_campaign_status ON mail_campaign_deliveries(campaign_id,status,created_at,id)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_mail_campaign_deliveries_message ON mail_campaign_deliveries(message_id)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_mail_campaign_deliveries_email ON mail_campaign_deliveries(email,created_at DESC)`));
  await withClient((c) => c.query(`ALTER TABLE qna_posts ADD COLUMN IF NOT EXISTS course_id BIGINT REFERENCES courses(id)`));
  await withClient((c) => c.query(`ALTER TABLE qna_posts ADD COLUMN IF NOT EXISTS lab_request_id BIGINT`));
  await withClient((c) => c.query(`ALTER TABLE qna_posts ADD COLUMN IF NOT EXISTS post_type TEXT NOT NULL DEFAULT 'question'`));
  await withClient((c) => c.query(`ALTER TABLE qna_posts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'`));
  await withClient((c) => c.query(`ALTER TABLE qna_posts ADD COLUMN IF NOT EXISTS accepted_comment_id BIGINT`));
  await withClient((c) => c.query(`ALTER TABLE qna_posts ADD COLUMN IF NOT EXISTS lab_context_json TEXT NOT NULL DEFAULT '{}'`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS qna_helpful_votes (post_id BIGINT NOT NULL REFERENCES qna_posts(id) ON DELETE CASCADE,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY (post_id,user_id))`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_qna_posts_type_status ON qna_posts(post_type,status,created_at DESC)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_qna_posts_course_lab ON qna_posts(course_id,lab_request_id,created_at DESC)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_qna_helpful_votes_post ON qna_helpful_votes(post_id)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS schedule_events (id BIGINT PRIMARY KEY,title TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',start_at TEXT NOT NULL,end_at TEXT NOT NULL,timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',visibility TEXT NOT NULL DEFAULT 'public',status TEXT NOT NULL DEFAULT 'scheduled',course_id BIGINT REFERENCES courses(id),recurrence_json TEXT NOT NULL DEFAULT '{}',created_by BIGINT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS memo TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS instructor_name TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS capacity INTEGER`));
  await withClient((c) => c.query(`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS apply_url TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS apply_method TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS show_on_landing INTEGER NOT NULL DEFAULT 0`));
  await withClient((c) => c.query(`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS promotion_enabled INTEGER NOT NULL DEFAULT 0`));
  await withClient((c) => c.query(`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS promotion_title TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS promotion_message TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS promotion_priority INTEGER NOT NULL DEFAULT 0`));
  await withClient((c) => c.query(`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS badge_label TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS icon_key TEXT NOT NULL DEFAULT 'video'`));
  await withClient((c) => c.query(`ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS recurrence_exceptions_json TEXT NOT NULL DEFAULT '[]'`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_schedule_events_start ON schedule_events(start_at)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_schedule_events_course ON schedule_events(course_id)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_schedule_events_visibility ON schedule_events(visibility)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_schedule_events_status ON schedule_events(status)`));
  await withClient((c) => c.query(`ALTER TABLE qna_comments ADD COLUMN IF NOT EXISTS parent_comment_id BIGINT REFERENCES qna_comments(id)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS arena_seasons (id BIGINT PRIMARY KEY,code TEXT NOT NULL UNIQUE,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled',reset_policy TEXT NOT NULL DEFAULT 'quarterly',started_at TEXT,ends_at TEXT,created_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS arena_scenarios (id BIGINT PRIMARY KEY,code TEXT NOT NULL UNIQUE,title TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',backend_type TEXT NOT NULL DEFAULT 'container',console_type TEXT NOT NULL DEFAULT 'xterm',tier TEXT NOT NULL DEFAULT 'normal',difficulty INTEGER NOT NULL DEFAULT 1,ttl_seconds INTEGER NOT NULL DEFAULT 1200,validator_key TEXT NOT NULL DEFAULT '',image_name TEXT NOT NULL DEFAULT '',flavor_name TEXT NOT NULL DEFAULT '',network_name TEXT NOT NULL DEFAULT '',metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS arena_nodes (id BIGINT PRIMARY KEY,season_id BIGINT NOT NULL REFERENCES arena_seasons(id) ON DELETE CASCADE,scenario_id BIGINT NOT NULL REFERENCES arena_scenarios(id),node_code TEXT NOT NULL,label TEXT NOT NULL,map_x DOUBLE PRECISION NOT NULL DEFAULT 0,map_y DOUBLE PRECISION NOT NULL DEFAULT 0,current_owner_user_id BIGINT REFERENCES users(id),current_owner_handle TEXT NOT NULL DEFAULT '',first_capture_at TEXT,status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL,UNIQUE(season_id,node_code))`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS arena_sessions (id BIGINT PRIMARY KEY,season_id BIGINT NOT NULL REFERENCES arena_seasons(id),node_id BIGINT NOT NULL REFERENCES arena_nodes(id),scenario_id BIGINT NOT NULL REFERENCES arena_scenarios(id),user_id BIGINT NOT NULL REFERENCES users(id),state TEXT NOT NULL DEFAULT 'provisioning',backend_type TEXT NOT NULL DEFAULT 'container',console_type TEXT NOT NULL DEFAULT 'xterm',resource_id TEXT NOT NULL DEFAULT '',resource_name TEXT NOT NULL DEFAULT '',console_url TEXT NOT NULL DEFAULT '',validator_state TEXT NOT NULL DEFAULT 'pending',started_at TEXT NOT NULL,expires_at TEXT NOT NULL,ended_at TEXT,terminated_reason TEXT NOT NULL DEFAULT '',metadata_json TEXT NOT NULL DEFAULT '{}')`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS arena_attempts (id BIGINT PRIMARY KEY,session_id BIGINT NOT NULL UNIQUE REFERENCES arena_sessions(id) ON DELETE CASCADE,season_id BIGINT NOT NULL REFERENCES arena_seasons(id),node_id BIGINT NOT NULL REFERENCES arena_nodes(id),user_id BIGINT NOT NULL REFERENCES users(id),result TEXT NOT NULL DEFAULT 'failed',score INTEGER NOT NULL DEFAULT 0,mmr_delta INTEGER NOT NULL DEFAULT 0,rank_delta INTEGER NOT NULL DEFAULT 0,duration_seconds INTEGER NOT NULL DEFAULT 0,first_try_bonus INTEGER NOT NULL DEFAULT 0,remaining_seconds INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS arena_captures (id BIGINT PRIMARY KEY,season_id BIGINT NOT NULL REFERENCES arena_seasons(id),node_id BIGINT NOT NULL REFERENCES arena_nodes(id),user_id BIGINT NOT NULL REFERENCES users(id),capture_type TEXT NOT NULL DEFAULT 'first_blood',created_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS arena_events (id BIGINT PRIMARY KEY,season_id BIGINT NOT NULL REFERENCES arena_seasons(id),node_id BIGINT REFERENCES arena_nodes(id),user_id BIGINT REFERENCES users(id),event_type TEXT NOT NULL DEFAULT 'system',message TEXT NOT NULL DEFAULT '',payload_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_arena_nodes_season_id ON arena_nodes(season_id)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_arena_sessions_user_state ON arena_sessions(user_id, state)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_arena_events_season_created ON arena_events(season_id, created_at DESC)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS course_survey_responses (id BIGINT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),course_id BIGINT NOT NULL REFERENCES courses(id),phase TEXT NOT NULL,answers_json TEXT NOT NULL DEFAULT '{}',metrics_json TEXT NOT NULL DEFAULT '{}',submitted_at TEXT NOT NULL,updated_at TEXT NOT NULL,llm_feedback_text TEXT NOT NULL DEFAULT '',llm_feedback_model TEXT NOT NULL DEFAULT '',llm_feedback_provider TEXT NOT NULL DEFAULT '',llm_feedback_message_id BIGINT,llm_feedback_delivered INTEGER NOT NULL DEFAULT 0,llm_feedback_generated_by BIGINT,llm_feedback_generated_at TEXT,UNIQUE(user_id,course_id,phase))`));
  await withClient((c) => c.query(`ALTER TABLE course_survey_responses ADD COLUMN IF NOT EXISTS llm_feedback_text TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE course_survey_responses ADD COLUMN IF NOT EXISTS llm_feedback_model TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE course_survey_responses ADD COLUMN IF NOT EXISTS llm_feedback_provider TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE course_survey_responses ADD COLUMN IF NOT EXISTS llm_feedback_message_id BIGINT`));
  await withClient((c) => c.query(`ALTER TABLE course_survey_responses ADD COLUMN IF NOT EXISTS llm_feedback_delivered INTEGER NOT NULL DEFAULT 0`));
  await withClient((c) => c.query(`ALTER TABLE course_survey_responses ADD COLUMN IF NOT EXISTS llm_feedback_generated_by BIGINT`));
  await withClient((c) => c.query(`ALTER TABLE course_survey_responses ADD COLUMN IF NOT EXISTS llm_feedback_generated_at TEXT`));
  await withClient((c) => c.query(`ALTER TABLE course_survey_responses ADD COLUMN IF NOT EXISTS llm_feedback_auto_status TEXT NOT NULL DEFAULT 'none'`));
  await withClient((c) => c.query(`ALTER TABLE course_survey_responses ADD COLUMN IF NOT EXISTS llm_feedback_auto_scheduled_for TEXT`));
  await withClient((c) => c.query(`ALTER TABLE course_survey_responses ADD COLUMN IF NOT EXISTS llm_feedback_auto_attempts INTEGER NOT NULL DEFAULT 0`));
  await withClient((c) => c.query(`ALTER TABLE course_survey_responses ADD COLUMN IF NOT EXISTS llm_feedback_auto_error TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE course_survey_responses ADD COLUMN IF NOT EXISTS llm_feedback_auto_updated_at TEXT`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_course_survey_responses_course_phase ON course_survey_responses(course_id, phase)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_course_survey_responses_user_course ON course_survey_responses(user_id, course_id)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_course_survey_responses_auto_feedback ON course_survey_responses(llm_feedback_auto_status, llm_feedback_auto_scheduled_for)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS marketing_surveys (id BIGINT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',question TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',multi_choice INTEGER NOT NULL DEFAULT 0,show_results INTEGER NOT NULL DEFAULT 1,start_at TEXT NOT NULL,end_at TEXT NOT NULL,created_by BIGINT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS marketing_survey_options (id BIGINT PRIMARY KEY,survey_id BIGINT NOT NULL REFERENCES marketing_surveys(id) ON DELETE CASCADE,label TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL)`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS marketing_survey_submissions (id BIGINT PRIMARY KEY,survey_id BIGINT NOT NULL REFERENCES marketing_surveys(id) ON DELETE CASCADE,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,ip_address TEXT NOT NULL DEFAULT '',user_agent TEXT NOT NULL DEFAULT '',submitted_at TEXT NOT NULL,UNIQUE(survey_id,user_id))`));
  await withClient((c) => c.query(`ALTER TABLE marketing_survey_submissions ADD COLUMN IF NOT EXISTS survey_title TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE marketing_survey_submissions ADD COLUMN IF NOT EXISTS survey_question TEXT NOT NULL DEFAULT ''`));
  await withClient((c) => c.query(`ALTER TABLE marketing_survey_submissions ADD COLUMN IF NOT EXISTS option_labels_json TEXT NOT NULL DEFAULT '[]'`));
  await withClient((c) => c.query(`CREATE TABLE IF NOT EXISTS marketing_survey_submission_choices (id BIGINT PRIMARY KEY,submission_id BIGINT NOT NULL REFERENCES marketing_survey_submissions(id) ON DELETE CASCADE,option_id BIGINT NOT NULL REFERENCES marketing_survey_options(id) ON DELETE CASCADE,created_at TEXT NOT NULL,UNIQUE(submission_id,option_id))`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_marketing_surveys_status_window ON marketing_surveys(status,start_at,end_at)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_marketing_survey_options_survey ON marketing_survey_options(survey_id,sort_order,id)`));
  await withClient((c) => c.query(`CREATE INDEX IF NOT EXISTS idx_marketing_survey_submissions_survey ON marketing_survey_submissions(survey_id,submitted_at DESC)`));
  await withClient((c) => ensureCicdTables(c));
  await withClient((c) => ensureHeatWorkloadTestTables(c));
}
async function pgListLuckyDrawEvents() {
  return (await withClient((c) => c.query(`
    SELECT id, title, description, status, timezone, start_at AS "startAt", end_at AS "endAt",
           daily_attempt_limit AS "dailyAttemptLimit", require_verified_user AS "requireVerifiedUser",
           allow_new_users_only AS "allowNewUsersOnly", new_user_window_days AS "newUserWindowDays",
           allow_dormant_users_only AS "allowDormantUsersOnly", dormant_days AS "dormantDays",
           created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM lucky_draw_events
    ORDER BY created_at DESC, id DESC
  `))).rows.map(normalizeLuckyDrawEventRow);
}

async function pgListCourseSurveyResponsesByUser(userId) {
  return (await withClient((c) => c.query(`
    SELECT r.id, r.user_id AS "userId", u.name AS "userName", u.username,
           r.course_id AS "courseId", c.title AS "courseTitle", r.phase,
           r.answers_json AS "answersJson", r.metrics_json AS "metricsJson",
           r.submitted_at AS "submittedAt", r.updated_at AS "updatedAt",
           r.llm_feedback_text AS "llmFeedbackText",
           r.llm_feedback_model AS "llmFeedbackModel",
           r.llm_feedback_provider AS "llmFeedbackProvider",
           r.llm_feedback_message_id AS "llmFeedbackMessageId",
           r.llm_feedback_delivered AS "llmFeedbackDelivered",
           r.llm_feedback_generated_by AS "llmFeedbackGeneratedBy",
           r.llm_feedback_generated_at AS "llmFeedbackGeneratedAt",
           r.llm_feedback_auto_status AS "llmFeedbackAutoStatus",
           r.llm_feedback_auto_scheduled_for AS "llmFeedbackAutoScheduledFor",
           r.llm_feedback_auto_attempts AS "llmFeedbackAutoAttempts",
           r.llm_feedback_auto_error AS "llmFeedbackAutoError",
           r.llm_feedback_auto_updated_at AS "llmFeedbackAutoUpdatedAt",
           legacy_feedback.body AS "legacyFeedbackBody",
           legacy_feedback.message_id AS "legacyFeedbackMessageId",
           legacy_feedback.created_at AS "legacyFeedbackGeneratedAt",
           legacy_feedback.sender_id AS "legacyFeedbackGeneratedBy"
    FROM course_survey_responses r
    JOIN users u ON u.id = r.user_id
    JOIN courses c ON c.id = r.course_id
    LEFT JOIN LATERAL (
      SELECT m.id AS message_id, m.body, m.created_at, m.sender_id
      FROM user_messages m
      WHERE m.recipient_id = r.user_id
        AND m.subject = ('[AI 해설] ' || c.title || ' ' || CASE WHEN r.phase = 'post' THEN '사후 설문' ELSE '사전 설문' END)
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) legacy_feedback ON TRUE
    WHERE r.user_id = $1
    ORDER BY r.updated_at DESC, r.id DESC
  `, [Number(userId)]))).rows.map(normalizeCourseSurveyResponseRow);
}

async function pgListCourseSurveyResponses() {
  return (await withClient((c) => c.query(`
    SELECT r.id, r.user_id AS "userId", u.name AS "userName", u.username,
           r.course_id AS "courseId", c.title AS "courseTitle", r.phase,
           r.answers_json AS "answersJson", r.metrics_json AS "metricsJson",
           r.submitted_at AS "submittedAt", r.updated_at AS "updatedAt",
           r.llm_feedback_text AS "llmFeedbackText",
           r.llm_feedback_model AS "llmFeedbackModel",
           r.llm_feedback_provider AS "llmFeedbackProvider",
           r.llm_feedback_message_id AS "llmFeedbackMessageId",
           r.llm_feedback_delivered AS "llmFeedbackDelivered",
           r.llm_feedback_generated_by AS "llmFeedbackGeneratedBy",
           r.llm_feedback_generated_at AS "llmFeedbackGeneratedAt",
           r.llm_feedback_auto_status AS "llmFeedbackAutoStatus",
           r.llm_feedback_auto_scheduled_for AS "llmFeedbackAutoScheduledFor",
           r.llm_feedback_auto_attempts AS "llmFeedbackAutoAttempts",
           r.llm_feedback_auto_error AS "llmFeedbackAutoError",
           r.llm_feedback_auto_updated_at AS "llmFeedbackAutoUpdatedAt",
           legacy_feedback.body AS "legacyFeedbackBody",
           legacy_feedback.message_id AS "legacyFeedbackMessageId",
           legacy_feedback.created_at AS "legacyFeedbackGeneratedAt",
           legacy_feedback.sender_id AS "legacyFeedbackGeneratedBy"
    FROM course_survey_responses r
    JOIN users u ON u.id = r.user_id
    JOIN courses c ON c.id = r.course_id
    LEFT JOIN LATERAL (
      SELECT m.id AS message_id, m.body, m.created_at, m.sender_id
      FROM user_messages m
      WHERE m.recipient_id = r.user_id
        AND m.subject = ('[AI 해설] ' || c.title || ' ' || CASE WHEN r.phase = 'post' THEN '사후 설문' ELSE '사전 설문' END)
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) legacy_feedback ON TRUE
    ORDER BY r.updated_at DESC, r.id DESC
  `))).rows.map(normalizeCourseSurveyResponseRow);
}

async function pgListCourseAccessCounts() {
  return (await withClient((c) => c.query(`
    SELECT c.id AS "courseId", c.title AS "courseTitle", COUNT(DISTINCT uca.user_id) AS "accessCount"
    FROM courses c
    LEFT JOIN user_course_access uca ON uca.course_id = c.id
    GROUP BY c.id, c.title
    ORDER BY c.id ASC
  `))).rows.map((row) => ({
    courseId: Number(row.courseId),
    courseTitle: String(row.courseTitle || ""),
    accessCount: Number(row.accessCount || 0),
  }));
}

async function pgUpsertCourseSurveyResponse(input) {
  return withTx(async (c) => {
    const phase = String(input.phase || "").trim().toLowerCase();
    if (!["pre", "post"].includes(phase)) throw new Error("지원하지 않는 설문 단계입니다.");
    const userId = Number(input.userId);
    const courseId = Number(input.courseId);
    const answersJson = JSON.stringify(input.answers || {});
    const metricsJson = JSON.stringify(input.metrics || {});
    const autoStatus = phase === "post" ? "pending" : "none";
    const autoScheduledFor = phase === "post" ? getNextKstSurveyFeedbackRunIso() : null;
    const existing = await c.query(`
      SELECT id FROM course_survey_responses
      WHERE user_id = $1 AND course_id = $2 AND phase = $3
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `, [userId, courseId, phase]);
    const existingId = Number(existing.rows[0]?.id || 0);
    const id = existingId || await nextId(c, "course_survey_responses");
    if (existingId) {
      await c.query(`
        UPDATE course_survey_responses
        SET answers_json = $2,
            metrics_json = $3,
            llm_feedback_text = '',
            llm_feedback_model = '',
            llm_feedback_provider = '',
            llm_feedback_message_id = NULL,
            llm_feedback_delivered = 0,
            llm_feedback_generated_by = NULL,
            llm_feedback_generated_at = NULL,
            llm_feedback_auto_status = $4,
            llm_feedback_auto_scheduled_for = $5,
            llm_feedback_auto_attempts = 0,
            llm_feedback_auto_error = '',
            llm_feedback_auto_updated_at = CURRENT_TIMESTAMP::text,
            updated_at = CURRENT_TIMESTAMP::text
        WHERE id = $1
      `, [id, answersJson, metricsJson, autoStatus, autoScheduledFor]);
    } else {
      await c.query(`
        INSERT INTO course_survey_responses (
          id, user_id, course_id, phase, answers_json, metrics_json,
          llm_feedback_auto_status, llm_feedback_auto_scheduled_for, llm_feedback_auto_updated_at,
          submitted_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text)
      `, [id, userId, courseId, phase, answersJson, metricsJson, autoStatus, autoScheduledFor]);
    }
    return normalizeCourseSurveyResponseRow((await c.query(`
      SELECT r.id, r.user_id AS "userId", u.name AS "userName", u.username,
             r.course_id AS "courseId", co.title AS "courseTitle", r.phase,
             r.answers_json AS "answersJson", r.metrics_json AS "metricsJson",
             r.submitted_at AS "submittedAt", r.updated_at AS "updatedAt",
             r.llm_feedback_text AS "llmFeedbackText",
             r.llm_feedback_model AS "llmFeedbackModel",
             r.llm_feedback_provider AS "llmFeedbackProvider",
             r.llm_feedback_message_id AS "llmFeedbackMessageId",
             r.llm_feedback_delivered AS "llmFeedbackDelivered",
             r.llm_feedback_generated_by AS "llmFeedbackGeneratedBy",
             r.llm_feedback_generated_at AS "llmFeedbackGeneratedAt",
             r.llm_feedback_auto_status AS "llmFeedbackAutoStatus",
             r.llm_feedback_auto_scheduled_for AS "llmFeedbackAutoScheduledFor",
             r.llm_feedback_auto_attempts AS "llmFeedbackAutoAttempts",
             r.llm_feedback_auto_error AS "llmFeedbackAutoError",
             r.llm_feedback_auto_updated_at AS "llmFeedbackAutoUpdatedAt"
      FROM course_survey_responses r
      JOIN users u ON u.id = r.user_id
      JOIN courses co ON co.id = r.course_id
      WHERE r.id = $1
    `, [id])).rows[0] || null);
  });
}

async function pgUpdateCourseSurveyFeedback(input) {
  return withTx(async (c) => {
    const phase = String(input.phase || "").trim().toLowerCase();
    if (!["pre", "post"].includes(phase)) throw new Error("지원하지 않는 설문 단계입니다.");
    const updated = await c.query(`
      UPDATE course_survey_responses
      SET llm_feedback_text = $4,
          llm_feedback_model = $5,
          llm_feedback_provider = $6,
          llm_feedback_message_id = $7,
          llm_feedback_delivered = $8,
          llm_feedback_generated_by = $9,
          llm_feedback_generated_at = CURRENT_TIMESTAMP::text,
          llm_feedback_auto_status = 'generated',
          llm_feedback_auto_error = '',
          llm_feedback_auto_updated_at = CURRENT_TIMESTAMP::text
      WHERE user_id = $1 AND course_id = $2 AND phase = $3
      RETURNING id
    `, [
      Number(input.userId),
      Number(input.courseId),
      phase,
      String(input.text || "").trim(),
      String(input.model || "").trim(),
      String(input.provider || "").trim(),
      input.messageId ? Number(input.messageId) : null,
      input.delivered ? 1 : 0,
      input.generatedBy ? Number(input.generatedBy) : null,
    ]);
    const id = Number(updated.rows[0]?.id || 0);
    if (!id) return null;
    return normalizeCourseSurveyResponseRow((await c.query(`
      SELECT r.id, r.user_id AS "userId", u.name AS "userName", u.username,
             r.course_id AS "courseId", co.title AS "courseTitle", r.phase,
             r.answers_json AS "answersJson", r.metrics_json AS "metricsJson",
             r.submitted_at AS "submittedAt", r.updated_at AS "updatedAt",
             r.llm_feedback_text AS "llmFeedbackText",
             r.llm_feedback_model AS "llmFeedbackModel",
             r.llm_feedback_provider AS "llmFeedbackProvider",
             r.llm_feedback_message_id AS "llmFeedbackMessageId",
             r.llm_feedback_delivered AS "llmFeedbackDelivered",
             r.llm_feedback_generated_by AS "llmFeedbackGeneratedBy",
             r.llm_feedback_generated_at AS "llmFeedbackGeneratedAt",
             r.llm_feedback_auto_status AS "llmFeedbackAutoStatus",
             r.llm_feedback_auto_scheduled_for AS "llmFeedbackAutoScheduledFor",
             r.llm_feedback_auto_attempts AS "llmFeedbackAutoAttempts",
             r.llm_feedback_auto_error AS "llmFeedbackAutoError",
             r.llm_feedback_auto_updated_at AS "llmFeedbackAutoUpdatedAt"
      FROM course_survey_responses r
      JOIN users u ON u.id = r.user_id
      JOIN courses co ON co.id = r.course_id
      WHERE r.id = $1
    `, [id])).rows[0] || null);
  });
}

async function pgListPendingCourseSurveyFeedbackJobs(nowIso = new Date().toISOString(), limit = 10) {
  return (await withClient((c) => c.query(`
    SELECT r.id, r.user_id AS "userId", u.name AS "userName", u.username,
           r.course_id AS "courseId", co.title AS "courseTitle", r.phase,
           r.answers_json AS "answersJson", r.metrics_json AS "metricsJson",
           r.submitted_at AS "submittedAt", r.updated_at AS "updatedAt",
           r.llm_feedback_text AS "llmFeedbackText",
           r.llm_feedback_model AS "llmFeedbackModel",
           r.llm_feedback_provider AS "llmFeedbackProvider",
           r.llm_feedback_message_id AS "llmFeedbackMessageId",
           r.llm_feedback_delivered AS "llmFeedbackDelivered",
           r.llm_feedback_generated_by AS "llmFeedbackGeneratedBy",
           r.llm_feedback_generated_at AS "llmFeedbackGeneratedAt",
           r.llm_feedback_auto_status AS "llmFeedbackAutoStatus",
           r.llm_feedback_auto_scheduled_for AS "llmFeedbackAutoScheduledFor",
           r.llm_feedback_auto_attempts AS "llmFeedbackAutoAttempts",
           r.llm_feedback_auto_error AS "llmFeedbackAutoError",
           r.llm_feedback_auto_updated_at AS "llmFeedbackAutoUpdatedAt"
    FROM course_survey_responses r
    JOIN users u ON u.id = r.user_id
    JOIN courses co ON co.id = r.course_id
    WHERE r.phase = 'post'
      AND r.llm_feedback_auto_status = 'pending'
      AND COALESCE(r.llm_feedback_text, '') = ''
      AND COALESCE(r.llm_feedback_auto_scheduled_for, '') <> ''
      AND r.llm_feedback_auto_scheduled_for <= $1
    ORDER BY r.llm_feedback_auto_scheduled_for ASC, r.updated_at ASC, r.id ASC
    LIMIT $2
  `, [String(nowIso || new Date().toISOString()), Math.max(1, Math.min(50, Number(limit || 10) || 10))]))).rows.map(normalizeCourseSurveyResponseRow);
}

async function pgUpdateCourseSurveyFeedbackAutoStatus(responseId, input = {}) {
  const status = String(input.status || "").trim() || "pending";
  const errorText = String(input.error || "").trim();
  await withClient((c) => c.query(`
    UPDATE course_survey_responses
    SET llm_feedback_auto_status = $2,
        llm_feedback_auto_error = $3,
        llm_feedback_auto_attempts = CASE WHEN $4::integer = 1 THEN llm_feedback_auto_attempts + 1 ELSE llm_feedback_auto_attempts END,
        llm_feedback_auto_updated_at = CURRENT_TIMESTAMP::text
    WHERE id = $1
  `, [Number(responseId), status, errorText, input.incrementAttempts ? 1 : 0]));
}

const MARKETING_SURVEY_SELECT = `
  SELECT s.id, s.title, s.description, s.question, s.status, s.multi_choice AS "multiChoice",
         s.show_results AS "showResults", s.start_at AS "startAt", s.end_at AS "endAt",
         s.created_by AS "createdBy", creator.name AS "createdByName", creator.username AS "createdByUsername",
         s.created_at AS "createdAt", s.updated_at AS "updatedAt",
         COALESCE(vote_totals.total_votes, 0) AS "totalVotes",
         COALESCE(options_json.options_json, '[]') AS "optionsJson"
  FROM marketing_surveys s
  LEFT JOIN users creator ON creator.id = s.created_by
  LEFT JOIN (
    SELECT survey_id, COUNT(*) AS total_votes
    FROM marketing_survey_submissions
    GROUP BY survey_id
  ) vote_totals ON vote_totals.survey_id = s.id
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', o.id,
      'label', o.label,
      'sortOrder', o.sort_order,
      'voteCount', COALESCE(option_votes.vote_count, 0)
    ) ORDER BY o.sort_order ASC, o.id ASC)::text AS options_json
    FROM marketing_survey_options o
    LEFT JOIN (
      SELECT option_id, COUNT(*) AS vote_count
      FROM marketing_survey_submission_choices
      GROUP BY option_id
    ) option_votes ON option_votes.option_id = o.id
    WHERE o.survey_id = s.id
  ) options_json ON TRUE
`;

async function pgFindMarketingSurveyById(id, { userId = null } = {}) {
  const row = (await withClient((c) => c.query(
    `${MARKETING_SURVEY_SELECT} WHERE s.id = $1`,
    [Number(id)],
  ))).rows[0] || null;
  if (row && userId) {
    const mine = (await withClient((c) => c.query(`
      SELECT sub.id AS "mySubmissionId", sub.submitted_at AS "mySubmittedAt",
             COALESCE(json_agg(choice.option_id ORDER BY choice.option_id)::text, '[]') AS "myOptionIdsJson"
      FROM marketing_survey_submissions sub
      LEFT JOIN marketing_survey_submission_choices choice ON choice.submission_id = sub.id
      WHERE sub.survey_id = $1 AND sub.user_id = $2
      GROUP BY sub.id, sub.submitted_at
      LIMIT 1
    `, [Number(id), Number(userId)]))).rows[0] || null;
    if (mine) Object.assign(row, mine);
  }
  return normalizeMarketingSurveyRow(row);
}

async function pgListMarketingSurveys({ includeDrafts = false, userId = null } = {}) {
  const where = includeDrafts ? "" : "WHERE s.status = 'active' AND s.start_at::timestamptz <= CURRENT_TIMESTAMP AND s.end_at::timestamptz >= CURRENT_TIMESTAMP";
  const rows = (await withClient((c) => c.query(`${MARKETING_SURVEY_SELECT} ${where} ORDER BY s.start_at DESC, s.id DESC`))).rows;
  if (userId && rows.length) {
    const surveyIds = rows.map((row) => Number(row.id)).filter(Boolean);
    const mineRows = (await withClient((c) => c.query(`
      SELECT sub.survey_id AS "surveyId", sub.id AS "mySubmissionId", sub.submitted_at AS "mySubmittedAt",
             COALESCE(json_agg(choice.option_id ORDER BY choice.option_id)::text, '[]') AS "myOptionIdsJson"
      FROM marketing_survey_submissions sub
      LEFT JOIN marketing_survey_submission_choices choice ON choice.submission_id = sub.id
      WHERE sub.user_id = $1 AND sub.survey_id = ANY($2::bigint[])
      GROUP BY sub.survey_id, sub.id, sub.submitted_at
    `, [Number(userId), surveyIds]))).rows;
    const mineBySurvey = new Map(mineRows.map((mine) => [Number(mine.surveyId), mine]));
    for (const row of rows) {
      const mine = mineBySurvey.get(Number(row.id));
      if (mine) Object.assign(row, mine);
    }
  }
  return rows.map(normalizeMarketingSurveyRow);
}

async function pgCreateMarketingSurvey(input) {
  const id = await withTx(async (c) => {
    const id = await nextId(c, "marketing_surveys");
    await c.query(`
      INSERT INTO marketing_surveys (id,title,description,question,status,multi_choice,show_results,start_at,end_at,created_by,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text)
    `, [
      id,
      String(input.title || "").trim(),
      String(input.description || "").trim(),
      String(input.question || "").trim(),
      String(input.status || "draft").trim() || "draft",
      Number(Boolean(input.multiChoice)),
      Number(input.showResults !== false),
      String(input.startAt || "").trim(),
      String(input.endAt || "").trim(),
      input.createdBy != null ? Number(input.createdBy) : null,
    ]);
    const labels = Array.isArray(input.options) ? input.options : [];
    for (const [index, label] of labels.entries()) {
      const optionId = await nextId(c, "marketing_survey_options");
      await c.query(
        `INSERT INTO marketing_survey_options (id,survey_id,label,sort_order,created_at) VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP::text)`,
        [optionId, id, String(label || "").trim(), index],
      );
    }
    return id;
  });
  return pgFindMarketingSurveyById(id);
}

async function pgUpdateMarketingSurvey(id, patch) {
  await withTx(async (c) => {
    await c.query(`
      UPDATE marketing_surveys
      SET title = COALESCE($2, title),
          description = COALESCE($3, description),
          question = COALESCE($4, question),
          status = COALESCE($5, status),
          multi_choice = COALESCE($6, multi_choice),
          show_results = COALESCE($7, show_results),
          start_at = COALESCE($8, start_at),
          end_at = COALESCE($9, end_at),
          updated_at = CURRENT_TIMESTAMP::text
      WHERE id = $1
    `, [
      Number(id),
      patch.title == null ? null : String(patch.title || "").trim(),
      patch.description == null ? null : String(patch.description || "").trim(),
      patch.question == null ? null : String(patch.question || "").trim(),
      patch.status == null ? null : String(patch.status || "").trim(),
      patch.multiChoice == null ? null : Number(Boolean(patch.multiChoice)),
      patch.showResults == null ? null : Number(Boolean(patch.showResults)),
      patch.startAt == null ? null : String(patch.startAt || "").trim(),
      patch.endAt == null ? null : String(patch.endAt || "").trim(),
    ]);
    if (Array.isArray(patch.options)) {
      const existingVotes = Number((await c.query(`SELECT COUNT(*) AS count FROM marketing_survey_submissions WHERE survey_id=$1`, [Number(id)])).rows[0]?.count || 0);
      const currentLabels = (await c.query(
        `SELECT label FROM marketing_survey_options WHERE survey_id=$1 ORDER BY sort_order ASC, id ASC`,
        [Number(id)],
      )).rows.map((row) => String(row.label || "").trim());
      const nextLabels = patch.options.map((label) => String(label || "").trim()).filter(Boolean);
      const optionsChanged = currentLabels.length !== nextLabels.length || currentLabels.some((label, index) => label !== nextLabels[index]);
      if (existingVotes > 0 && optionsChanged) throw new Error("이미 투표 기록이 있는 설문은 선택지를 바꿀 수 없습니다.");
      if (!optionsChanged) return;
      await c.query(`DELETE FROM marketing_survey_options WHERE survey_id=$1`, [Number(id)]);
      for (const [index, label] of nextLabels.entries()) {
        const optionId = await nextId(c, "marketing_survey_options");
        await c.query(
          `INSERT INTO marketing_survey_options (id,survey_id,label,sort_order,created_at) VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP::text)`,
          [optionId, Number(id), label, index],
        );
      }
    }
  });
  return pgFindMarketingSurveyById(id);
}

async function pgDeleteMarketingSurvey(id) {
  await withTx(async (c) => {
    const voteCount = Number((await c.query(
      `SELECT COUNT(*) AS count FROM marketing_survey_submissions WHERE survey_id=$1`,
      [Number(id)],
    )).rows[0]?.count || 0);
    if (voteCount > 0) throw new Error("투표 기록이 있는 설문은 삭제할 수 없습니다. 상태를 ended로 변경해 보관해 주세요.");
    await c.query(`DELETE FROM marketing_surveys WHERE id=$1`, [Number(id)]);
  });
}

async function pgSubmitMarketingSurveyVote({ surveyId, userId, optionIds, ipAddress = "", userAgent = "" }) {
  const submittedSurveyId = await withTx(async (c) => {
    const survey = normalizeMarketingSurveyRow((await c.query(`${MARKETING_SURVEY_SELECT} WHERE s.id=$1`, [Number(surveyId)])).rows[0] || null);
    if (!survey) throw new Error("설문을 찾을 수 없습니다.");
    if (survey.status !== "active") throw new Error("진행 중인 설문만 투표할 수 있습니다.");
    if (new Date(survey.startAt).getTime() > Date.now() || new Date(survey.endAt).getTime() < Date.now()) {
      throw new Error("투표 기간이 아닙니다.");
    }
    const selectedIds = Array.from(new Set((Array.isArray(optionIds) ? optionIds : []).map(Number).filter(Boolean)));
    if (!selectedIds.length) throw new Error("선택지를 골라 주세요.");
    if (!survey.multiChoice && selectedIds.length > 1) throw new Error("이 설문은 하나만 선택할 수 있습니다.");
    const allowedIds = new Set(survey.options.map((option) => Number(option.id)));
    if (selectedIds.some((optionId) => !allowedIds.has(optionId))) throw new Error("설문 선택지가 올바르지 않습니다.");
    const existing = Number((await c.query(`SELECT COUNT(*) AS count FROM marketing_survey_submissions WHERE survey_id=$1 AND user_id=$2`, [survey.id, Number(userId)])).rows[0]?.count || 0);
    if (existing > 0) throw new Error("이미 투표한 설문입니다.");
    const selectedOptionLabels = survey.options
      .filter((option) => selectedIds.includes(Number(option.id)))
      .map((option) => option.label);
    const submissionId = await nextId(c, "marketing_survey_submissions");
    await c.query(`
      INSERT INTO marketing_survey_submissions (
        id, survey_id, user_id, survey_title, survey_question, option_labels_json, ip_address, user_agent, submitted_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP::text)
    `, [
      submissionId,
      survey.id,
      Number(userId),
      survey.title,
      survey.question,
      JSON.stringify(selectedOptionLabels),
      String(ipAddress || "").trim(),
      String(userAgent || "").trim(),
    ]);
    for (const optionId of selectedIds) {
      const choiceId = await nextId(c, "marketing_survey_submission_choices");
      await c.query(
        `INSERT INTO marketing_survey_submission_choices (id,submission_id,option_id,created_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP::text)`,
        [choiceId, submissionId, optionId],
      );
    }
    return survey.id;
  });
  return pgFindMarketingSurveyById(submittedSurveyId, { userId });
}

async function pgListMarketingSurveySubmissions(surveyId, limit = 300) {
  return (await withClient((c) => c.query(`
    SELECT sub.id, sub.survey_id AS "surveyId", sub.user_id AS "userId",
           sub.survey_title AS "surveyTitle", sub.survey_question AS "surveyQuestion",
           u.name AS "userName", u.username, u.email,
           COALESCE(json_agg(o.id ORDER BY o.sort_order, o.id)::text, '[]') AS "optionIdsJson",
           CASE
             WHEN sub.option_labels_json IS NOT NULL AND sub.option_labels_json <> '[]' THEN sub.option_labels_json
             ELSE COALESCE(json_agg(o.label ORDER BY o.sort_order, o.id)::text, '[]')
           END AS "optionLabelsJson",
           sub.ip_address AS "ipAddress", sub.user_agent AS "userAgent", sub.submitted_at AS "submittedAt"
    FROM marketing_survey_submissions sub
    JOIN users u ON u.id = sub.user_id
    LEFT JOIN marketing_survey_submission_choices choice ON choice.submission_id = sub.id
    LEFT JOIN marketing_survey_options o ON o.id = choice.option_id
    WHERE sub.survey_id = $1
    GROUP BY sub.id, u.id, u.name, u.username, u.email
    ORDER BY sub.submitted_at DESC, sub.id DESC
    LIMIT $2
  `, [Number(surveyId), Math.max(1, Math.min(1000, Number(limit || 300) || 300))]))).rows.map(normalizeMarketingSurveySubmissionRow);
}

async function pgFindLuckyDrawEventById(id) {
  return normalizeLuckyDrawEventRow((await withClient((c) => c.query(`
    SELECT id, title, description, status, timezone, start_at AS "startAt", end_at AS "endAt",
           daily_attempt_limit AS "dailyAttemptLimit", require_verified_user AS "requireVerifiedUser",
           allow_new_users_only AS "allowNewUsersOnly", new_user_window_days AS "newUserWindowDays",
           allow_dormant_users_only AS "allowDormantUsersOnly", dormant_days AS "dormantDays",
           created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM lucky_draw_events
    WHERE id = $1
  `, [Number(id)]))).rows[0] || null);
}

async function pgFindActiveLuckyDrawEvent(at = new Date().toISOString()) {
  return normalizeLuckyDrawEventRow((await withClient((c) => c.query(`
    SELECT id, title, description, status, timezone, start_at AS "startAt", end_at AS "endAt",
           daily_attempt_limit AS "dailyAttemptLimit", require_verified_user AS "requireVerifiedUser",
           allow_new_users_only AS "allowNewUsersOnly", new_user_window_days AS "newUserWindowDays",
           allow_dormant_users_only AS "allowDormantUsersOnly", dormant_days AS "dormantDays",
           created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM lucky_draw_events
    WHERE status = 'active'
      AND start_at::timestamptz <= $1::timestamptz
      AND end_at::timestamptz >= $1::timestamptz
    ORDER BY start_at DESC, id DESC
    LIMIT 1
  `, [at]))).rows[0] || null);
}

async function pgCreateLuckyDrawEvent(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "lucky_draw_events");
    await c.query(`
      INSERT INTO lucky_draw_events (
        id, title, description, status, timezone, start_at, end_at,
        daily_attempt_limit, require_verified_user, allow_new_users_only, new_user_window_days,
        allow_dormant_users_only, dormant_days, created_by, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text)
    `, [
      id,
      String(input.title || "").trim(),
      String(input.description || "").trim(),
      String(input.status || "draft").trim() || "draft",
      String(input.timezone || "Asia/Seoul").trim() || "Asia/Seoul",
      String(input.startAt || "").trim(),
      String(input.endAt || "").trim(),
      Math.max(1, Number(input.dailyAttemptLimit || 3) || 3),
      Number(Boolean(input.requireVerifiedUser ?? true)),
      Number(Boolean(input.allowNewUsersOnly ?? false)),
      Math.max(1, Number(input.newUserWindowDays || 30) || 30),
      Number(Boolean(input.allowDormantUsersOnly ?? false)),
      Math.max(1, Number(input.dormantDays || 30) || 30),
      input.createdBy != null ? Number(input.createdBy) : null,
    ]);
    return pgFindLuckyDrawEventById(id);
  });
}

async function pgUpdateLuckyDrawEvent(id, patch) {
  await withClient((c) => c.query(`
    UPDATE lucky_draw_events
    SET title = COALESCE($2, title),
        description = COALESCE($3, description),
        status = COALESCE($4, status),
        timezone = COALESCE($5, timezone),
        start_at = COALESCE($6, start_at),
        end_at = COALESCE($7, end_at),
        daily_attempt_limit = COALESCE($8, daily_attempt_limit),
        require_verified_user = COALESCE($9, require_verified_user),
        allow_new_users_only = COALESCE($10, allow_new_users_only),
        new_user_window_days = COALESCE($11, new_user_window_days),
        allow_dormant_users_only = COALESCE($12, allow_dormant_users_only),
        dormant_days = COALESCE($13, dormant_days),
        updated_at = CURRENT_TIMESTAMP::text
    WHERE id = $1
  `, [
    Number(id),
    patch.title == null ? null : String(patch.title || "").trim(),
    patch.description == null ? null : String(patch.description || "").trim(),
    patch.status == null ? null : String(patch.status || "").trim(),
    patch.timezone == null ? null : String(patch.timezone || "").trim(),
    patch.startAt == null ? null : String(patch.startAt || "").trim(),
    patch.endAt == null ? null : String(patch.endAt || "").trim(),
    patch.dailyAttemptLimit == null ? null : Math.max(1, Number(patch.dailyAttemptLimit || 3) || 3),
    patch.requireVerifiedUser == null ? null : Number(Boolean(patch.requireVerifiedUser)),
    patch.allowNewUsersOnly == null ? null : Number(Boolean(patch.allowNewUsersOnly)),
    patch.newUserWindowDays == null ? null : Math.max(1, Number(patch.newUserWindowDays || 30) || 30),
    patch.allowDormantUsersOnly == null ? null : Number(Boolean(patch.allowDormantUsersOnly)),
    patch.dormantDays == null ? null : Math.max(1, Number(patch.dormantDays || 30) || 30),
  ]));
  return pgFindLuckyDrawEventById(id);
}

async function pgDeleteLuckyDrawEvent(id) {
  await withClient((c) => c.query(`DELETE FROM lucky_draw_events WHERE id = $1`, [Number(id)]));
}

async function pgListLuckyDrawRewardsByEvent(eventId) {
  return (await withClient((c) => c.query(`
    SELECT r.id, r.event_id AS "eventId", r.reward_type AS "rewardType", r.label,
           r.course_id AS "courseId", r.coupon_discount_type AS "couponDiscountType",
           r.coupon_discount_value AS "couponDiscountValue", r.coupon_expires_in_days AS "couponExpiresInDays",
           r.probability_weight AS "probabilityWeight",
           r.total_stock AS "totalStock", r.daily_stock AS "dailyStock",
           r.per_user_limit AS "perUserLimit", r.message_text AS "messageText",
           r.is_active AS "isActive", r.created_at AS "createdAt", r.updated_at AS "updatedAt",
           c.title AS "courseTitle"
    FROM lucky_draw_rewards r
    LEFT JOIN courses c ON c.id = r.course_id
    WHERE r.event_id = $1
    ORDER BY r.id ASC
  `, [Number(eventId)]))).rows.map(normalizeLuckyDrawRewardRow);
}

async function pgCreateLuckyDrawReward(input) {
  return withTx(async (c) => {
    const id = await nextId(c, "lucky_draw_rewards");
    await c.query(`
      INSERT INTO lucky_draw_rewards (
        id, event_id, reward_type, label, course_id, probability_weight,
        coupon_discount_type, coupon_discount_value, coupon_expires_in_days,
        total_stock, daily_stock, per_user_limit, message_text, is_active, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text)
    `, [
      id,
      Number(input.eventId),
      String(input.rewardType || "message").trim() || "message",
      String(input.label || "").trim(),
      input.courseId != null ? Number(input.courseId) : null,
      Math.max(1, Number(input.probabilityWeight || 1) || 1),
      String(input.couponDiscountType || "percent").trim() || "percent",
      Math.max(0, Number(input.couponDiscountValue || 0) || 0),
      Math.max(1, Number(input.couponExpiresInDays || 7) || 7),
      input.totalStock == null || input.totalStock === "" ? null : Math.max(0, Number(input.totalStock) || 0),
      input.dailyStock == null || input.dailyStock === "" ? null : Math.max(0, Number(input.dailyStock) || 0),
      Math.max(1, Number(input.perUserLimit || 1) || 1),
      String(input.messageText || "").trim(),
      Number(Boolean(input.isActive ?? true)),
    ]);
    return normalizeLuckyDrawRewardRow((await c.query(`
      SELECT r.id, r.event_id AS "eventId", r.reward_type AS "rewardType", r.label,
             r.course_id AS "courseId", r.coupon_discount_type AS "couponDiscountType",
             r.coupon_discount_value AS "couponDiscountValue", r.coupon_expires_in_days AS "couponExpiresInDays",
             r.probability_weight AS "probabilityWeight",
             r.total_stock AS "totalStock", r.daily_stock AS "dailyStock",
             r.per_user_limit AS "perUserLimit", r.message_text AS "messageText",
             r.is_active AS "isActive", r.created_at AS "createdAt", r.updated_at AS "updatedAt",
             c.title AS "courseTitle"
      FROM lucky_draw_rewards r
      LEFT JOIN courses c ON c.id = r.course_id
      WHERE r.id = $1
    `, [id])).rows[0] || null);
  });
}

async function pgUpdateLuckyDrawReward(id, patch) {
  await withClient((c) => c.query(`
    UPDATE lucky_draw_rewards
    SET reward_type = COALESCE($2, reward_type),
        label = COALESCE($3, label),
        course_id = $4,
        probability_weight = COALESCE($5, probability_weight),
        coupon_discount_type = COALESCE($6, coupon_discount_type),
        coupon_discount_value = COALESCE($7, coupon_discount_value),
        coupon_expires_in_days = COALESCE($8, coupon_expires_in_days),
        total_stock = $9,
        daily_stock = $10,
        per_user_limit = COALESCE($11, per_user_limit),
        message_text = COALESCE($12, message_text),
        is_active = COALESCE($13, is_active),
        updated_at = CURRENT_TIMESTAMP::text
    WHERE id = $1
  `, [
    Number(id),
    patch.rewardType == null ? null : String(patch.rewardType || "").trim(),
    patch.label == null ? null : String(patch.label || "").trim(),
    patch.courseId == null || patch.courseId === "" ? null : Number(patch.courseId),
    patch.probabilityWeight == null ? null : Math.max(1, Number(patch.probabilityWeight || 1) || 1),
    patch.couponDiscountType == null ? null : String(patch.couponDiscountType || "percent").trim(),
    patch.couponDiscountValue == null ? null : Math.max(0, Number(patch.couponDiscountValue || 0) || 0),
    patch.couponExpiresInDays == null ? null : Math.max(1, Number(patch.couponExpiresInDays || 7) || 7),
    patch.totalStock == null || patch.totalStock === "" ? null : Math.max(0, Number(patch.totalStock) || 0),
    patch.dailyStock == null || patch.dailyStock === "" ? null : Math.max(0, Number(patch.dailyStock) || 0),
    patch.perUserLimit == null ? null : Math.max(1, Number(patch.perUserLimit || 1) || 1),
    patch.messageText == null ? null : String(patch.messageText || "").trim(),
    patch.isActive == null ? null : Number(Boolean(patch.isActive)),
  ]));
  return normalizeLuckyDrawRewardRow((await withClient((c) => c.query(`
    SELECT r.id, r.event_id AS "eventId", r.reward_type AS "rewardType", r.label,
           r.course_id AS "courseId", r.coupon_discount_type AS "couponDiscountType",
           r.coupon_discount_value AS "couponDiscountValue", r.coupon_expires_in_days AS "couponExpiresInDays",
           r.probability_weight AS "probabilityWeight",
           r.total_stock AS "totalStock", r.daily_stock AS "dailyStock",
           r.per_user_limit AS "perUserLimit", r.message_text AS "messageText",
           r.is_active AS "isActive", r.created_at AS "createdAt", r.updated_at AS "updatedAt",
           c.title AS "courseTitle"
    FROM lucky_draw_rewards r
    LEFT JOIN courses c ON c.id = r.course_id
    WHERE r.id = $1
  `, [Number(id)]))).rows[0] || null);
}

async function pgListLuckyDrawAttempts(options = {}) {
  const values = [];
  const where = [];
  if (options.eventId != null) {
    values.push(Number(options.eventId));
    where.push(`a.event_id = $${values.length}`);
  }
  if (options.userId != null) {
    values.push(Number(options.userId));
    where.push(`a.user_id = $${values.length}`);
  }
  values.push(Math.max(1, Math.min(500, Number(options.limit || 100) || 100)));
  const attempts = (await withClient((c) => c.query(`
    SELECT a.id, a.event_id AS "eventId", a.reward_id AS "rewardId", a.user_id AS "userId",
           a.attempt_date AS "attemptDate", a.attempt_no AS "attemptNo", a.result_status AS "resultStatus",
           a.grant_id AS "grantId", a.ip_address AS "ipAddress", a.user_agent AS "userAgent",
           a.created_at AS "createdAt", u.name AS "userName", u.username,
           r.label AS "rewardLabel", r.reward_type AS "rewardType"
    FROM lucky_draw_attempts a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN lucky_draw_rewards r ON r.id = a.reward_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT $${values.length}
  `, values))).rows.map(normalizeLuckyDrawAttemptRow);
  const suspiciousMap = new Map();
  for (const attempt of attempts) {
    const ipAddress = String(attempt.ipAddress || "").trim();
    const attemptDate = String(attempt.attemptDate || "").trim();
    const cacheKey = `${ipAddress}::${attemptDate}`;
    if (!ipAddress || suspiciousMap.has(cacheKey)) continue;
    const distinctUsers = Number((await withClient((c) => c.query(`
      SELECT COUNT(DISTINCT user_id) AS count
      FROM lucky_draw_attempts
      WHERE ip_address = $1
        AND attempt_date = $2
    `, [ipAddress, attemptDate]))).rows[0]?.count || 0);
    suspiciousMap.set(cacheKey, distinctUsers >= 4);
  }
  return attempts.map((attempt) => ({
    ...attempt,
    suspicious: suspiciousMap.get(`${String(attempt.ipAddress || "").trim()}::${String(attempt.attemptDate || "").trim()}`) === true,
  }));
}

async function pgListLuckyDrawGrantsByUser(userId, limit = 100) {
  return (await withClient((c) => c.query(`
    SELECT g.id, g.event_id AS "eventId", g.reward_id AS "rewardId", g.user_id AS "userId",
           g.grant_type AS "grantType", g.status, g.label, g.payload_json AS "payloadJson",
           g.created_at AS "createdAt", g.used_at AS "usedAt", g.revoked_at AS "revokedAt",
           r.label AS "rewardLabel", r.reward_type AS "rewardType"
    FROM lucky_draw_grants g
    LEFT JOIN lucky_draw_rewards r ON r.id = g.reward_id
    WHERE g.user_id = $1
    ORDER BY g.created_at DESC, g.id DESC
    LIMIT $2
  `, [Number(userId), Math.max(1, Math.min(300, Number(limit || 100) || 100))]))).rows.map(normalizeLuckyDrawGrantRow);
}

async function pgGetLuckyDrawStats(eventId) {
  const today = formatDateInTimeZone(new Date(), "Asia/Seoul");
  const [participantResult, attemptResult, todayAttemptResult, grantResult, suspiciousResult] = await Promise.all([
    withClient((c) => c.query(`SELECT COUNT(DISTINCT user_id) AS count FROM lucky_draw_attempts WHERE event_id = $1`, [Number(eventId)])),
    withClient((c) => c.query(`SELECT COUNT(*) AS count FROM lucky_draw_attempts WHERE event_id = $1`, [Number(eventId)])),
    withClient((c) => c.query(`SELECT COUNT(*) AS count FROM lucky_draw_attempts WHERE event_id = $1 AND attempt_date = $2`, [Number(eventId), today])),
    withClient((c) => c.query(`
      SELECT g.reward_id AS "rewardId", r.label, r.reward_type AS "rewardType", COUNT(*)::int AS "issuedCount"
      FROM lucky_draw_grants g
      LEFT JOIN lucky_draw_rewards r ON r.id = g.reward_id
      WHERE g.event_id = $1
      GROUP BY g.reward_id, r.label, r.reward_type
      ORDER BY g.reward_id ASC
    `, [Number(eventId)])),
    withClient((c) => c.query(`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT ip_address
        FROM lucky_draw_attempts
        WHERE event_id = $1
          AND attempt_date = $2
          AND ip_address <> ''
        GROUP BY ip_address
        HAVING COUNT(DISTINCT user_id) >= 4
      ) suspicious_ips
    `, [Number(eventId), today])),
  ]);
  return {
    participantCount: Number(participantResult.rows[0]?.count || 0),
    attemptCount: Number(attemptResult.rows[0]?.count || 0),
    todayAttemptCount: Number(todayAttemptResult.rows[0]?.count || 0),
    suspiciousIpCount: Number(suspiciousResult.rows[0]?.count || 0),
    rewardStats: grantResult.rows.map((row) => ({
      rewardId: row.rewardId != null ? Number(row.rewardId) : null,
      label: String(row.label || "").trim(),
      rewardType: String(row.rewardType || "").trim(),
      issuedCount: Math.max(0, Number(row.issuedCount || 0)),
    })),
  };
}

async function pgGetLuckyDrawEventOverview(userId = null, at = new Date().toISOString()) {
  const event = await pgFindActiveLuckyDrawEvent(at);
  if (!event) return { event: null, rewards: [], attempts: [], grants: [], remainingAttempts: 0 };
  const rewards = await pgListLuckyDrawRewardsByEvent(event.id);
  if (userId == null) return { event, rewards, attempts: [], grants: [], remainingAttempts: event.dailyAttemptLimit, isEligible: true, eligibilityMessage: "" };
  const attempts = await pgListLuckyDrawAttempts({ eventId: event.id, userId, limit: 20 });
  const grants = await pgListLuckyDrawGrantsByUser(userId, 20);
  const today = formatDateInTimeZone(new Date(), event.timezone);
  const usedToday = attempts.filter((item) => item.attemptDate === today).length;
  let isEligible = true;
  let eligibilityMessage = "";
  const user = await pgFindUserById(userId);
  if (!user) {
    isEligible = false;
    eligibilityMessage = "사용자 정보를 찾을 수 없습니다.";
  } else if (event.requireVerifiedUser && String(user.status || "").trim().toLowerCase() !== "approved") {
    isEligible = false;
    eligibilityMessage = "승인된 회원만 참여할 수 있습니다.";
  } else if (event.allowNewUsersOnly) {
    const createdAt = new Date(user.createdAt || 0);
    const ageDays = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
    if (!Number.isFinite(createdAt.getTime()) || ageDays >= event.newUserWindowDays) {
      isEligible = false;
      eligibilityMessage = `가입 후 ${event.newUserWindowDays}일 이내 회원만 참여할 수 있습니다.`;
    }
  }
  if (isEligible && event.allowDormantUsersOnly) {
    const recentAccess = (await withClient((c) => c.query(`
      SELECT created_at AS "createdAt"
      FROM user_access_logs
      WHERE user_id = $1
        AND event_type IN ('login', 'session_active')
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `, [Number(userId)]))).rows[0] || null;
    if (recentAccess?.createdAt) {
      const dormantMs = event.dormantDays * 24 * 60 * 60 * 1000;
      const lastAccessAt = new Date(recentAccess.createdAt);
      if (Number.isFinite(lastAccessAt.getTime()) && (Date.now() - lastAccessAt.getTime()) < dormantMs) {
        isEligible = false;
        eligibilityMessage = `${event.dormantDays}일 이상 휴면 상태인 회원만 참여할 수 있습니다.`;
      }
    }
  }
  return {
    event,
    rewards,
    attempts,
    grants: grants.filter((item) => Number(item.eventId) === Number(event.id)),
    remainingAttempts: Math.max(0, event.dailyAttemptLimit - usedToday),
    isEligible,
    eligibilityMessage,
  };
}

async function pgAttemptLuckyDraw({ userId, ipAddress = "", userAgent = "" }) {
  return withTx(async (c) => {
    const eventRow = (await c.query(`
      SELECT id, title, description, status, timezone, start_at AS "startAt", end_at AS "endAt",
             daily_attempt_limit AS "dailyAttemptLimit", require_verified_user AS "requireVerifiedUser",
             allow_new_users_only AS "allowNewUsersOnly", new_user_window_days AS "newUserWindowDays",
             allow_dormant_users_only AS "allowDormantUsersOnly", dormant_days AS "dormantDays",
             created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM lucky_draw_events
      WHERE status = 'active'
        AND start_at::timestamptz <= CURRENT_TIMESTAMP
        AND end_at::timestamptz >= CURRENT_TIMESTAMP
      ORDER BY start_at DESC, id DESC
      LIMIT 1
    `)).rows[0] || null;
    const event = normalizeLuckyDrawEventRow(eventRow);
    if (!event) throw new Error("현재 진행 중인 럭키드로우 이벤트가 없습니다.");

    const userRow = (await c.query(`SELECT id, status, created_at AS "createdAt" FROM users WHERE id = $1`, [Number(userId)])).rows[0] || null;
    if (!userRow) throw new Error("사용자 정보를 찾을 수 없습니다.");
    if (event.requireVerifiedUser && String(userRow.status || "").trim().toLowerCase() !== "approved") {
      throw new Error("승인된 회원만 참여할 수 있습니다.");
    }
    if (event.allowNewUsersOnly) {
      const createdAt = new Date(userRow.createdAt || 0);
      const ageDays = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
      if (!Number.isFinite(createdAt.getTime()) || ageDays >= event.newUserWindowDays) {
        throw new Error(`가입 후 ${event.newUserWindowDays}일 이내 회원만 참여할 수 있습니다.`);
      }
    }
    if (event.allowDormantUsersOnly) {
      const recentAccessRow = (await c.query(`
        SELECT created_at AS "createdAt"
        FROM user_access_logs
        WHERE user_id = $1
          AND event_type IN ('login', 'session_active')
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `, [Number(userId)])).rows[0] || null;
      if (recentAccessRow?.createdAt) {
        const dormantMs = event.dormantDays * 24 * 60 * 60 * 1000;
        const lastAccessAt = new Date(recentAccessRow.createdAt);
        if (Number.isFinite(lastAccessAt.getTime()) && (Date.now() - lastAccessAt.getTime()) < dormantMs) {
          throw new Error(`${event.dormantDays}일 이상 휴면 상태인 회원만 참여할 수 있습니다.`);
        }
      }
    }

    const today = formatDateInTimeZone(new Date(), event.timezone);
    const normalizedIpAddress = String(ipAddress || "").trim();
    const recentAttemptCount = Number((await c.query(`
      SELECT COUNT(*) AS count
      FROM lucky_draw_attempts
      WHERE event_id = $1
        AND user_id = $2
        AND created_at::timestamptz >= (CURRENT_TIMESTAMP - INTERVAL '3 seconds')
    `, [event.id, Number(userId)])).rows[0]?.count || 0);
    if (recentAttemptCount > 0) {
      throw new Error("조금만 천천히 시도해 주세요.");
    }

    const usedToday = Number((await c.query(`
      SELECT COUNT(*) AS count
      FROM lucky_draw_attempts
      WHERE event_id = $1
        AND user_id = $2
        AND attempt_date = $3
    `, [event.id, Number(userId), today])).rows[0]?.count || 0);
    if (usedToday >= event.dailyAttemptLimit) {
      throw new Error("오늘 참여 횟수를 모두 사용했습니다.");
    }
    if (normalizedIpAddress) {
      const sameIpDistinctUsers = Number((await c.query(`
        SELECT COUNT(DISTINCT user_id) AS count
        FROM lucky_draw_attempts
        WHERE event_id = $1
          AND ip_address = $2
          AND attempt_date = $3
      `, [event.id, normalizedIpAddress, today])).rows[0]?.count || 0);
      if (sameIpDistinctUsers >= 5) {
        throw new Error("현재 네트워크에서는 오늘 참여 한도를 초과했습니다.");
      }
    }

    const rewardRows = (await c.query(`
      SELECT r.id, r.event_id AS "eventId", r.reward_type AS "rewardType", r.label,
             r.course_id AS "courseId", r.coupon_discount_type AS "couponDiscountType",
             r.coupon_discount_value AS "couponDiscountValue", r.coupon_expires_in_days AS "couponExpiresInDays",
             r.probability_weight AS "probabilityWeight",
             r.total_stock AS "totalStock", r.daily_stock AS "dailyStock",
             r.per_user_limit AS "perUserLimit", r.message_text AS "messageText",
             r.is_active AS "isActive", r.created_at AS "createdAt", r.updated_at AS "updatedAt",
             c.title AS "courseTitle"
      FROM lucky_draw_rewards r
      LEFT JOIN courses c ON c.id = r.course_id
      WHERE r.event_id = $1
        AND r.is_active = 1
      ORDER BY r.id ASC
    `, [event.id])).rows.map(normalizeLuckyDrawRewardRow);

    const eligibleRewards = [];
    for (const reward of rewardRows) {
      const totalIssued = Number((await c.query(`
        SELECT COUNT(*) AS count
        FROM lucky_draw_grants
        WHERE reward_id = $1
          AND status <> 'revoked'
      `, [reward.id])).rows[0]?.count || 0);
      if (reward.totalStock != null && totalIssued >= reward.totalStock) continue;

      const dailyIssued = Number((await c.query(`
        SELECT COUNT(*) AS count
        FROM lucky_draw_grants
        WHERE reward_id = $1
          AND created_at LIKE $2
          AND status <> 'revoked'
      `, [reward.id, `${today}%`])).rows[0]?.count || 0);
      if (reward.dailyStock != null && dailyIssued >= reward.dailyStock) continue;

      const userIssued = Number((await c.query(`
        SELECT COUNT(*) AS count
        FROM lucky_draw_grants
        WHERE reward_id = $1
          AND user_id = $2
          AND status <> 'revoked'
      `, [reward.id, Number(userId)])).rows[0]?.count || 0);
      if (userIssued >= reward.perUserLimit) continue;
      eligibleRewards.push(reward);
    }

    if (!eligibleRewards.length) {
      throw new Error("현재 지급 가능한 보상이 없습니다.");
    }

    const reward = weightedPick(eligibleRewards);
    const grantId = await nextId(c, "lucky_draw_grants");
    const payload = {};
    let grantType = reward.rewardType;
    if (reward.rewardType === "free_course") {
      if (!reward.courseId) throw new Error("무료 과정 보상에 연결된 과정이 없습니다.");
      const accessId = await nextId(c, "user_course_access");
      const courseAccessDays = (await c.query(`SELECT course_access_days AS "courseAccessDays" FROM courses WHERE id=$1`, [reward.courseId])).rows[0]?.courseAccessDays;
      const accessExpiresAt = resolveCourseAccessExpiryIso(Date.now(), resolveCourseAccessDays(courseAccessDays));
      await c.query(`
        INSERT INTO user_course_access (id, user_id, course_id, granted_via, expires_at, created_at)
        VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP::text)
        ON CONFLICT (user_id, course_id) DO NOTHING
      `, [accessId, Number(userId), reward.courseId, "lucky_draw", accessExpiresAt]);
      payload.courseId = reward.courseId;
      payload.courseTitle = reward.courseTitle;
      payload.expiresAt = accessExpiresAt;
      grantType = "course_entitlement";
    } else if (reward.rewardType === "discount_coupon") {
      if (!reward.courseId) throw new Error("할인 쿠폰 보상에 연결된 과정이 없습니다.");
      const couponId = await nextId(c, "discount_coupons");
      const couponCode = generateDiscountCouponCode("LUCKY");
      const couponExpiresAt = new Date(Date.now() + (Math.max(1, Number(reward.couponExpiresInDays || 7) || 7) * 24 * 60 * 60 * 1000)).toISOString();
      await c.query(`
        INSERT INTO discount_coupons (
          id, code, user_id, course_id, source, discount_type, discount_value,
          max_uses, used_count, status, expires_at, metadata_json, created_at, used_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,CURRENT_TIMESTAMP::text,NULL)
      `, [
        couponId,
        couponCode,
        Number(userId),
        reward.courseId,
        "lucky_draw",
        reward.couponDiscountType || "percent",
        Math.max(0, Number(reward.couponDiscountValue || 0) || 0),
        1,
        "active",
        couponExpiresAt,
        JSON.stringify({
          rewardId: reward.id,
          eventId: event.id,
        }),
      ]);
      const coupon = normalizeDiscountCouponRow((await c.query(`
        SELECT dc.id, dc.code, dc.user_id AS "userId", dc.course_id AS "courseId", dc.source,
               dc.discount_type AS "discountType", dc.discount_value AS "discountValue",
               dc.max_uses AS "maxUses", dc.used_count AS "usedCount", dc.status, dc.expires_at AS "expiresAt",
               dc.metadata_json AS "metadataJson", dc.created_at AS "createdAt", dc.used_at AS "usedAt",
               c.title AS "courseTitle"
        FROM discount_coupons dc
        LEFT JOIN courses c ON c.id = dc.course_id
        WHERE dc.id = $1
      `, [couponId])).rows[0] || null);
      payload.couponId = coupon.id;
      payload.couponCode = coupon.code;
      payload.discountType = coupon.discountType;
      payload.discountValue = coupon.discountValue;
      payload.courseId = coupon.courseId;
      payload.courseTitle = reward.courseTitle;
      payload.expiresAt = coupon.expiresAt;
      grantType = "coupon";
    } else {
      payload.message = reward.messageText || reward.label;
      grantType = "message";
    }

    await c.query(`
      INSERT INTO lucky_draw_grants (
        id, event_id, reward_id, user_id, grant_type, status, label, payload_json, created_at, used_at, revoked_at
      )
      VALUES ($1,$2,$3,$4,$5,'issued',$6,$7,CURRENT_TIMESTAMP::text,NULL,NULL)
    `, [grantId, event.id, reward.id, Number(userId), grantType, reward.label, JSON.stringify(payload)]);

    const attemptId = await nextId(c, "lucky_draw_attempts");
    await c.query(`
      INSERT INTO lucky_draw_attempts (
        id, event_id, reward_id, user_id, attempt_date, attempt_no, result_status, grant_id, ip_address, user_agent, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,'issued',$7,$8,$9,CURRENT_TIMESTAMP::text)
    `, [attemptId, event.id, reward.id, Number(userId), today, usedToday + 1, grantId, normalizedIpAddress, String(userAgent || "").trim()]);

    return {
      event,
      reward,
      grant: normalizeLuckyDrawGrantRow((await c.query(`
        SELECT g.id, g.event_id AS "eventId", g.reward_id AS "rewardId", g.user_id AS "userId",
               g.grant_type AS "grantType", g.status, g.label, g.payload_json AS "payloadJson",
               g.created_at AS "createdAt", g.used_at AS "usedAt", g.revoked_at AS "revokedAt",
               r.label AS "rewardLabel", r.reward_type AS "rewardType"
        FROM lucky_draw_grants g
        LEFT JOIN lucky_draw_rewards r ON r.id = g.reward_id
        WHERE g.id = $1
      `, [grantId])).rows[0] || null),
      remainingAttempts: Math.max(0, event.dailyAttemptLimit - (usedToday + 1)),
    };
  });
}

export async function runtimeUpdateUserAccess(id, patch) { return pgUpdateUserAccess(id, patch); }
export async function runtimeMarkApprovalMailSent(id, sentAt) { return pgMarkApprovalMailSent(id, sentAt); }
export async function runtimeDeleteUser(id) { return pgDeleteUser(id); }
export async function runtimeUpdateUserPassword(id, passwordHash) { return pgUpdateUserPassword(id, passwordHash); }
export async function runtimeUpdateUserProfile(id, patch) { return pgUpdateUserProfile(id, patch); }
export async function runtimeUpdateUserQnaLastReadAt(id, qnaLastReadAt) { return pgUpdateUserQnaLastReadAt(id, qnaLastReadAt); }
export async function runtimeUpdateUserOtp(id, patch) { return pgUpdateUserOtp(id, patch); }
export async function runtimeUpdateUsername(id, username) { return pgUpdateUsername(id, username); }
export async function runtimeCreatePasswordResetPin(input) { return pgCreatePasswordResetPin(input); }
export async function runtimeFindActivePasswordResetPinByUserId(userId) { return pgFindActivePasswordResetPinByUserId(userId); }
export async function runtimeIncrementPasswordResetPinAttempt(id) { return pgIncrementPasswordResetPinAttempt(id); }
export async function runtimeConsumePasswordResetPin(id, usedAt) { return pgConsumePasswordResetPin(id, usedAt); }
export async function runtimeListPasswordResetPins(limit) { return pgListPasswordResetPins(limit); }
export async function runtimeCreateUserAccessLog(input) { return pgCreateUserAccessLog(input); }
export async function runtimeListUserAccessLogs(limit) { return pgListUserAccessLogs(limit); }
export async function runtimeCreateAdminAuditLog(input) { return pgCreateAdminAuditLog(input); }
export async function runtimeListAdminAuditLogs(limit, options) { return pgListAdminAuditLogs(limit, options); }
export async function runtimeUpsertUserSessionDevice(input) { return pgUpsertUserSessionDevice(input); }
export async function runtimeListActiveUserSessionDevices(userId, activeSince) { return pgListActiveUserSessionDevices(userId, activeSince); }
export async function runtimeMarkUserSessionDeviceWarned(sessionId, warnedAt) { return pgMarkUserSessionDeviceWarned(sessionId, warnedAt); }
export async function runtimeGetActiveUserAccessRestriction(userId, nowIso) { return pgGetActiveUserAccessRestriction(userId, nowIso); }
export async function runtimeCreateUserAccessRestriction(input) { return pgCreateUserAccessRestriction(input); }
export async function runtimeResolveActiveAccountSharingRestriction(userId, resolvedAt) { return pgResolveActiveAccountSharingRestriction(userId, resolvedAt); }
export async function runtimeGetUserAccessStats(options) { return pgGetUserAccessStats(options); }
export async function runtimeRecordOpenstackResourceUsageSnapshot(input) { return pgRecordOpenstackResourceUsageSnapshot(input); }
export async function runtimeListOpenstackResourceUsageTrend(options) { return pgListOpenstackResourceUsageTrend(options); }
export async function runtimeGetLlmQuotaStatus(userId, options) { return pgGetLlmQuotaStatus(userId, options); }
export async function runtimeConsumeLlmQuota(userId, options) { return pgConsumeLlmQuota(userId, options); }
export async function runtimeCreateMailLog(input) { return pgCreateMailLog(input); }
export async function runtimeListMailLogs(limit) { return pgListMailLogs(limit); }
export async function runtimeDeleteMailLogsByMetadata(filters) { return pgDeleteMailLogsByMetadata(filters); }
export async function runtimeCreateMailCampaign(input) { return pgCreateMailCampaign(input); }
export async function runtimeFindMailCampaignById(id) { return pgFindMailCampaignById(id); }
export async function runtimeListMailCampaigns(limit) { return pgListMailCampaigns(limit); }
export async function runtimeClaimNextMailCampaign() { return pgClaimNextMailCampaign(); }
export async function runtimeListQueuedMailCampaignDeliveries(campaignId, limit) { return pgListQueuedMailCampaignDeliveries(campaignId, limit); }
export async function runtimeUpdateMailCampaignDelivery(id, patch) { return pgUpdateMailCampaignDelivery(id, patch); }
export async function runtimeRefreshMailCampaign(id) { return pgRefreshMailCampaign(id); }
export async function runtimeRecordMailCampaignEvent(input) { return pgRecordMailCampaignEvent(input); }
export async function runtimeCreateUserNotification(input) { return pgCreateUserNotification(input); }
export async function runtimeListUserNotifications(userId, limit) { return pgListUserNotifications(userId, limit); }
export async function runtimeMarkUserNotificationRead(userId, notificationId, readAt) { return pgMarkUserNotificationRead(userId, notificationId, readAt); }
export async function runtimeMarkAllUserNotificationsRead(userId, readAt) { return pgMarkAllUserNotificationsRead(userId, readAt); }
export async function runtimeDeleteUserNotification(userId, notificationId) { return pgDeleteUserNotification(userId, notificationId); }
export async function runtimeClearUserNotifications(userId) { return pgClearUserNotifications(userId); }
function normalizePlatformStatusOutput(status) {
  if (!status || typeof status !== "object") {
    return status;
  }
  const courseLevels = Array.isArray(status.courseLevelOptions)
    ? status.courseLevelOptions
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .map((item) => (item.includes("?") ? "" : item))
        .filter(Boolean)
    : [];
  const courseProgramTypes = Array.isArray(status.courseProgramTypeOptions)
    ? status.courseProgramTypeOptions
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    : [];
  const hasStatusPortalV2Enabled = Object.prototype.hasOwnProperty.call(status, "userPortalV2Enabled");
  const portalUiMode = normalizePortalUiMode(
    status.portalUiMode,
    hasStatusPortalV2Enabled
      ? (status.userPortalV2Enabled === true ? "switchable" : "legacy")
      : "switchable",
  );
  return {
    ...status,
    llmApiKeyConfigured: Boolean(String(status.llmApiKey || "").trim()),
    googleSearchApiKeyConfigured: Boolean(String(status.googleSearchApiKey || "").trim()),
    labStartDebugEnabled: status.labStartDebugEnabled === true,
    maxConcurrentLabs: clampMaxConcurrentLabs(status.maxConcurrentLabs || 1),
    terminalSessionIdleMinutes: Math.max(1, Number(status.terminalSessionIdleMinutes || status.terminalSessionTtlMinutes || DEFAULT_TERMINAL_SESSION_IDLE_MINUTES) || DEFAULT_TERMINAL_SESSION_IDLE_MINUTES),
    terminalReplayEnabled: status.terminalReplayEnabled !== false,
    terminalFileUploadEnabled: status.terminalFileUploadEnabled === true,
    unusedVmAutoPauseEnabled: status.unusedVmAutoPauseEnabled !== false,
    unusedVmAutoPauseMinutes: Math.max(1440, Number(status.unusedVmAutoPauseMinutes || DEFAULT_UNUSED_VM_AUTO_PAUSE_MINUTES) || DEFAULT_UNUSED_VM_AUTO_PAUSE_MINUTES),
    unusedVmRetentionMinutes: Math.max(1440, Number(status.unusedVmRetentionMinutes || DEFAULT_UNUSED_VM_RETENTION_MINUTES) || DEFAULT_UNUSED_VM_RETENTION_MINUTES),
    labAutoBootFromVolumeOnDiskPressureEnabled: status.labAutoBootFromVolumeOnDiskPressureEnabled !== false,
    labAutoBootFromVolumeDiskThresholdPercent: Math.max(1, Math.min(99, Number(status.labAutoBootFromVolumeDiskThresholdPercent || process.env.LAB_AUTO_BOOT_FROM_VOLUME_DISK_THRESHOLD_PERCENT || 80) || 80)),
    labAutoBootVolumeSizeGb: Math.max(1, Math.min(2048, Number(status.labAutoBootVolumeSizeGb || process.env.LAB_AUTO_BOOT_VOLUME_SIZE_GB || 20) || 20)),
    labAutoBootVolumeType: String(status.labAutoBootVolumeType || "").trim(),
    googleCalendarSyncEnabled: status.googleCalendarSyncEnabled === true,
    googleCalendarIcsUrl: String(status.googleCalendarIcsUrl || "").trim(),
    googleCalendarSyncIntervalMinutes: Math.max(15, Number(status.googleCalendarSyncIntervalMinutes || 60) || 60),
    materialsUploadMaxMb: Math.max(1, Number(status.materialsUploadMaxMb || 80) || 80),
    sshExternalPortStart: Math.max(1, Number(status.sshExternalPortStart || 41000) || 41000),
    sshExternalPortEnd: Math.max(1, Number(status.sshExternalPortEnd || 42999) || 42999),
    labCircuitBreakerMessage: String(status.labCircuitBreakerMessage || "").includes("?")
      ? "현재 랩 생성이 잠시 제한되어 있습니다."
      : (status.labCircuitBreakerMessage || "현재 랩 생성이 잠시 제한되어 있습니다."),
    labCircuitBreakerSource: String(status.labCircuitBreakerSource || "").trim(),
    labCircuitBreakerTriggeredAt: String(status.labCircuitBreakerTriggeredAt || "").trim(),
    labCircuitBreakerMetric: String(status.labCircuitBreakerMetric || "").trim(),
    labCircuitBreakerUsagePercent: Math.max(0, Math.min(100, Number(status.labCircuitBreakerUsagePercent || 0) || 0)),
    labAutoCircuitBreakerEnabled: status.labAutoCircuitBreakerEnabled !== false,
    labAutoCircuitBreakerThresholdPercent: Math.max(50, Math.min(100, Number(status.labAutoCircuitBreakerThresholdPercent || DEFAULT_LAB_AUTO_CIRCUIT_BREAKER_THRESHOLD_PERCENT) || DEFAULT_LAB_AUTO_CIRCUIT_BREAKER_THRESHOLD_PERCENT)),
    siteUpdateInProgress: status.siteUpdateInProgress === true,
    siteUpdateMessage: String(status.siteUpdateMessage || DEFAULT_SITE_UPDATE_MESSAGE).trim() || DEFAULT_SITE_UPDATE_MESSAGE,
    cicdExecutionMode: String(status.cicdExecutionMode || "simulated").trim().toLowerCase() === "jenkins" ? "jenkins" : "simulated",
    jenkinsApiTokenConfigured: Boolean(String(status.jenkinsApiToken || "").trim()),
    jenkinsDefaultFolder: String(status.jenkinsDefaultFolder || "terminal-lab").trim() || "terminal-lab",
    jenkinsJobPrefix: String(status.jenkinsJobPrefix || "tlab-").trim(),
    jenkinsAutoCreateJobs: status.jenkinsAutoCreateJobs !== false,
    userPortalV2Enabled: portalUiMode !== "legacy",
    portalUiMode,
    portalV2TransitionNoticeEnabled: status.portalV2TransitionNoticeEnabled !== false,
    portalV2TransitionNoticeMessage: String(status.portalV2TransitionNoticeMessage || "").trim(),
    supportAvailabilityMode: normalizeSupportAvailabilityMode(status.supportAvailabilityMode),
    supportUnavailableMessage: String(status.supportUnavailableMessage || "현재 관리자가 부재중입니다. 운영지원 대화는 잠시 후 다시 이용해 주세요.").trim() || "현재 관리자가 부재중입니다. 운영지원 대화는 잠시 후 다시 이용해 주세요.",
    pocAdvancedDailyPrices: Object.fromEntries(Object.entries(DEFAULT_POC_ADVANCED_DAILY_PRICES).map(([key, fallback]) => [
      key,
      Math.max(0, Number(status?.pocAdvancedDailyPrices?.[key] ?? fallback) || 0),
    ])),
    courseLevelOptions: courseLevels.length ? courseLevels : ["입문", "초급", "중급", "고급"],
    courseProgramTypeOptions: normalizeCourseProgramTypeOptions(courseProgramTypes),
    standardCourseOverviewDescription: String(status.standardCourseOverviewDescription || "").trim() || DEFAULT_COURSE_OVERVIEWS.standard.description,
    standardCourseOverviewPoints: normalizeCourseOverviewPoints(status.standardCourseOverviewPoints, DEFAULT_COURSE_OVERVIEWS.standard.points),
    iltCourseOverviewDescription: String(status.iltCourseOverviewDescription || "").trim() || DEFAULT_COURSE_OVERVIEWS.ilt.description,
    iltCourseOverviewPoints: normalizeCourseOverviewPoints(status.iltCourseOverviewPoints, DEFAULT_COURSE_OVERVIEWS.ilt.points),
    onlineCourseOverviewDescription: String(status.onlineCourseOverviewDescription || "").trim() || DEFAULT_COURSE_OVERVIEWS.online.description,
    onlineCourseOverviewPoints: normalizeCourseOverviewPoints(status.onlineCourseOverviewPoints, DEFAULT_COURSE_OVERVIEWS.online.points),
    governmentCourseOverviewDescription: String(status.governmentCourseOverviewDescription || "").trim() || DEFAULT_COURSE_OVERVIEWS.government.description,
    governmentCourseOverviewPoints: normalizeCourseOverviewPoints(status.governmentCourseOverviewPoints, DEFAULT_COURSE_OVERVIEWS.government.points),
    courseQuoteAccessMode: normalizeCourseQuoteAccessMode(status.courseQuoteAccessMode),
  };
}
export async function runtimeGetPlatformStatus() {
  return normalizePlatformStatusOutput(await pgGetPlatformStatus());
}
export async function runtimeUpdatePlatformStatus(patch) {
  const current = await pgGetPlatformStatus();
  const inputPatch = patch && typeof patch === "object" ? patch : {};
  const hasPortalUiMode = Object.prototype.hasOwnProperty.call(inputPatch, "portalUiMode");
  const hasPortalV2Enabled = Object.prototype.hasOwnProperty.call(inputPatch, "userPortalV2Enabled");
  patch = { ...current, ...inputPatch };
  const currentHasPortalV2Enabled = Object.prototype.hasOwnProperty.call(current || {}, "userPortalV2Enabled");
  const currentPortalUiMode = normalizePortalUiMode(
    current.portalUiMode,
    currentHasPortalV2Enabled
      ? (current.userPortalV2Enabled === true ? "switchable" : "legacy")
      : "switchable",
  );
  const fallbackPortalUiMode = hasPortalV2Enabled
    ? (patch.userPortalV2Enabled === true ? "switchable" : "legacy")
    : currentPortalUiMode;
  const portalUiMode = normalizePortalUiMode(hasPortalUiMode ? patch.portalUiMode : "", fallbackPortalUiMode);
  const normalizedPatch = {
    ...patch,
    labCircuitBreakerSource: String(patch?.labCircuitBreakerSource ?? current.labCircuitBreakerSource ?? "").trim(),
    labCircuitBreakerTriggeredAt: String(patch?.labCircuitBreakerTriggeredAt ?? current.labCircuitBreakerTriggeredAt ?? "").trim(),
    labCircuitBreakerMetric: String(patch?.labCircuitBreakerMetric ?? current.labCircuitBreakerMetric ?? "").trim(),
    labCircuitBreakerUsagePercent: Math.max(0, Math.min(100, Number(patch?.labCircuitBreakerUsagePercent ?? current.labCircuitBreakerUsagePercent ?? 0) || 0)),
    labAutoCircuitBreakerEnabled: Object.prototype.hasOwnProperty.call(patch || {}, "labAutoCircuitBreakerEnabled")
      ? patch.labAutoCircuitBreakerEnabled !== false
      : current.labAutoCircuitBreakerEnabled !== false,
    labAutoCircuitBreakerThresholdPercent: Math.max(50, Math.min(100, Number(
      patch?.labAutoCircuitBreakerThresholdPercent
        ?? current.labAutoCircuitBreakerThresholdPercent
        ?? DEFAULT_LAB_AUTO_CIRCUIT_BREAKER_THRESHOLD_PERCENT,
    ) || DEFAULT_LAB_AUTO_CIRCUIT_BREAKER_THRESHOLD_PERCENT)),
    labStartDebugEnabled: patch?.labStartDebugEnabled === true,
    maxConcurrentLabs: clampMaxConcurrentLabs(patch?.maxConcurrentLabs || 1),
    terminalSessionIdleMinutes: Math.max(1, Number(patch?.terminalSessionIdleMinutes || patch?.terminalSessionTtlMinutes || DEFAULT_TERMINAL_SESSION_IDLE_MINUTES) || DEFAULT_TERMINAL_SESSION_IDLE_MINUTES),
    terminalReplayEnabled: Object.prototype.hasOwnProperty.call(patch || {}, "terminalReplayEnabled")
      ? patch.terminalReplayEnabled !== false
      : current.terminalReplayEnabled !== false,
    terminalFileUploadEnabled: Object.prototype.hasOwnProperty.call(patch || {}, "terminalFileUploadEnabled")
      ? patch.terminalFileUploadEnabled === true
      : current.terminalFileUploadEnabled === true,
    unusedVmRetentionMinutes: Math.max(1440, Number(patch?.unusedVmRetentionMinutes || DEFAULT_UNUSED_VM_RETENTION_MINUTES) || DEFAULT_UNUSED_VM_RETENTION_MINUTES),
    labAutoBootFromVolumeOnDiskPressureEnabled: Object.prototype.hasOwnProperty.call(patch || {}, "labAutoBootFromVolumeOnDiskPressureEnabled")
      ? patch.labAutoBootFromVolumeOnDiskPressureEnabled !== false
      : current.labAutoBootFromVolumeOnDiskPressureEnabled !== false,
    labAutoBootFromVolumeDiskThresholdPercent: Math.max(1, Math.min(99, Number(patch?.labAutoBootFromVolumeDiskThresholdPercent || current.labAutoBootFromVolumeDiskThresholdPercent || process.env.LAB_AUTO_BOOT_FROM_VOLUME_DISK_THRESHOLD_PERCENT || 80) || 80)),
    labAutoBootVolumeSizeGb: Math.max(1, Math.min(2048, Number(patch?.labAutoBootVolumeSizeGb || current.labAutoBootVolumeSizeGb || process.env.LAB_AUTO_BOOT_VOLUME_SIZE_GB || 20) || 20)),
    labAutoBootVolumeType: String(patch?.labAutoBootVolumeType ?? current.labAutoBootVolumeType ?? "").trim(),
    materialsUploadMaxMb: Math.max(1, Number(patch?.materialsUploadMaxMb || 80) || 80),
    sshExternalPortStart: Math.max(1, Number(patch?.sshExternalPortStart || 41000) || 41000),
    sshExternalPortEnd: Math.max(1, Number(patch?.sshExternalPortEnd || 42999) || 42999),
    labCircuitBreakerMessage: String(patch?.labCircuitBreakerMessage || "").includes("?")
      ? DEFAULT_LAB_CIRCUIT_BREAKER_MESSAGE
      : (patch?.labCircuitBreakerMessage || DEFAULT_LAB_CIRCUIT_BREAKER_MESSAGE),
    siteUpdateInProgress: patch?.siteUpdateInProgress === true,
    siteUpdateMessage: String(patch?.siteUpdateMessage || DEFAULT_SITE_UPDATE_MESSAGE).trim() || DEFAULT_SITE_UPDATE_MESSAGE,
    userPortalV2Enabled: portalUiMode !== "legacy",
    portalUiMode,
    portalV2TransitionNoticeEnabled: Object.prototype.hasOwnProperty.call(patch || {}, "portalV2TransitionNoticeEnabled")
      ? patch.portalV2TransitionNoticeEnabled !== false
      : current.portalV2TransitionNoticeEnabled !== false,
    portalV2TransitionNoticeMessage: String(patch?.portalV2TransitionNoticeMessage ?? current.portalV2TransitionNoticeMessage ?? "").trim(),
    supportAvailabilityMode: normalizeSupportAvailabilityMode(patch?.supportAvailabilityMode ?? current.supportAvailabilityMode),
    supportUnavailableMessage: String(patch?.supportUnavailableMessage ?? current.supportUnavailableMessage ?? "현재 관리자가 부재중입니다. 운영지원 대화는 잠시 후 다시 이용해 주세요.").trim() || "현재 관리자가 부재중입니다. 운영지원 대화는 잠시 후 다시 이용해 주세요.",
    consultingReplyTemplates: Object.prototype.hasOwnProperty.call(patch || {}, "consultingReplyTemplates")
      ? patch.consultingReplyTemplates
      : current.consultingReplyTemplates,
    courseQuoteAccessMode: normalizeCourseQuoteAccessMode(patch?.courseQuoteAccessMode ?? current.courseQuoteAccessMode),
    courseLevelOptions: Array.isArray(patch?.courseLevelOptions)
      ? patch.courseLevelOptions
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .map((item) => (item.includes("?") ? "" : item))
          .filter(Boolean)
      : patch?.courseLevelOptions,
    courseProgramTypeOptions: Array.isArray(patch?.courseProgramTypeOptions)
      ? patch.courseProgramTypeOptions
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : patch?.courseProgramTypeOptions,
  };
  const result = await pgUpdatePlatformStatus(normalizedPatch);
  return normalizePlatformStatusOutput(result);
}
export async function runtimeCreateInviteCode(input) { return pgCreateInviteCode(input); }
export async function runtimeFindInviteCodeById(id) { return pgFindInviteCodeById(id); }
export async function runtimeListInviteCodes() { return pgListInviteCodes(); }
export async function runtimeUpdateInviteCode(id, patch) { return pgUpdateInviteCode(id, patch); }
export async function runtimeDeleteInviteCode(id) { return pgDeleteInviteCode(id); }
export async function runtimeListCourses() { return pgListCourses(); }
export async function runtimeCreateCourse(input) { return pgCreateCourse(input); }
export async function runtimeUpdateCourse(id, input) { return pgUpdateCourse(id, input); }
export async function runtimeDeleteCourse(id) { return pgDeleteCourse(id); }
export async function runtimeListTextbooks() { return pgListTextbooks(); }
export async function runtimeCreateTextbook(input) { return pgCreateTextbook(input); }
export async function runtimeUpdateTextbook(id, input) { return pgUpdateTextbook(id, input); }
export async function runtimeDeleteTextbook(id) { return pgDeleteTextbook(id); }
export async function runtimeListVisibleCoursesByUser(userId) { return pgListVisibleCoursesByUser(userId); }
export async function runtimeFindCourseById(id) { return pgFindCourseById(id); }
export async function runtimeFindCourseByAccessCode(accessCode) { return pgFindCourseByAccessCode(accessCode); }
export async function runtimeFindAvailableInviteCode(code) { return pgFindAvailableInviteCode(code); }
export async function runtimeConsumeInviteCode(id) { return pgConsumeInviteCode(id); }
export async function runtimeGrantUserCourseAccess(userId, courseId, grantedVia, options = {}) { return pgGrantUserCourseAccess(userId, courseId, grantedVia, options); }
export async function runtimeRevokeUserCourseAccess(userId, courseId) { return pgRevokeUserCourseAccess(userId, courseId); }
export async function runtimeGrantCoursePackageItems(input) { return pgGrantCoursePackageItems(input); }
export async function runtimeRevokeCoursePackageByPayment(paymentId) { return pgRevokeCoursePackageByPayment(paymentId); }
export async function runtimeRevokeCoursePackageItemsByUser(userId, packageCourseId) { return pgRevokeCoursePackageItemsByUser(userId, packageCourseId); }
export async function runtimeCreateCourseAccessRequest(userId, courseId, options = {}) { return pgCreateCourseAccessRequest(userId, courseId, options); }
export async function runtimeFindCourseAccessRequestById(id) { return pgFindCourseAccessRequestById(id); }
export async function runtimeListCourseAccessRequests() { return pgListCourseAccessRequests(); }
export async function runtimeUpdateCourseAccessRequestStatus(id, patch) { return pgUpdateCourseAccessRequestStatus(id, patch); }
export async function runtimeUserHasCourseAccess(userId, courseId) { return pgUserHasCourseAccess(userId, courseId); }
export async function runtimeCreatePayment(input) { return pgCreatePayment(input); }
export async function runtimeCreateDiscountCoupon(input) { return pgCreateDiscountCoupon(input); }
export async function runtimeFindDiscountCouponByCode(code) { return pgFindDiscountCouponByCode(code); }
export async function runtimeFindDiscountCouponById(id) { return pgFindDiscountCouponById(id); }
export async function runtimeListDiscountCoupons() { return pgListDiscountCoupons(); }
export async function runtimeListDiscountCouponsByUser(userId) { return pgListDiscountCouponsByUser(userId); }
export async function runtimeUpdateDiscountCoupon(id, patch) { return pgUpdateDiscountCoupon(id, patch); }
export async function runtimeConsumeDiscountCoupon(id) { return pgConsumeDiscountCoupon(id); }
export async function runtimeListTermsVersions() { return pgListTermsVersions(); }
export async function runtimeListActiveTermsVersions() { return pgListActiveTermsVersions(); }
export async function runtimeFindTermsVersionById(id) { return pgFindTermsVersionById(id); }
export async function runtimeCreateTermsVersion(input) { return pgCreateTermsVersion(input); }
export async function runtimeUpdateTermsVersion(id, patch) { return pgUpdateTermsVersion(id, patch); }
export async function runtimeCreateUserTermsAgreements(input) { return pgCreateUserTermsAgreements(input); }
export async function runtimeFindPaymentById(id) { return pgFindPaymentById(id); }
export async function runtimeFindPaymentByOrderId(orderId) { return pgFindPaymentByOrderId(orderId); }
export async function runtimeListPayments() { return pgListPayments(); }
export async function runtimeListPaymentsByUser(userId) { return pgListPaymentsByUser(userId); }
export async function runtimeUpdatePayment(id, patch) { return pgUpdatePayment(id, patch); }
export async function runtimeDeletePayment(id) { return pgDeletePayment(id); }
export async function runtimeGrantExamEntitlement(input) { return pgGrantExamEntitlement(input); }
export async function runtimeListExamEntitlementsByUser(userId) { return pgListExamEntitlementsByUser(userId); }
export async function runtimeListExamEntitlements() { return pgListExamEntitlements(); }
export async function runtimeRevokeExamEntitlement(id, patch) { return pgRevokeExamEntitlement(id, patch); }
export async function runtimeRevokeExamEntitlementsByPayment(paymentId, reason) { return pgRevokeExamEntitlementsByPayment(paymentId, reason); }
export async function runtimeCreateCourseQuote(input) { return pgCreateCourseQuote(input); }
export async function runtimeFindCourseQuoteById(id) { return pgFindCourseQuoteById(id); }
export async function runtimeFindCourseQuoteByQuoteNo(quoteNo) { return pgFindCourseQuoteByQuoteNo(quoteNo); }
export async function runtimeListCourseQuotes() { return pgListCourseQuotes(); }
export async function runtimeListCourseQuotesByUser(userId) { return pgListCourseQuotesByUser(userId); }
export async function runtimeUpdateCourseQuoteStatus(id, patch) { return pgUpdateCourseQuoteStatus(id, patch); }
export async function runtimeCreateLabRequest(input) { return pgCreateLabRequest(input); }
export async function runtimeFindLabRequestById(id) { return pgFindLabRequestById(id); }
export async function runtimeListLabRequests(options) { return pgListLabRequests(options); }
export async function runtimeListLabRequestsPage(options) { return pgListLabRequestsPage(options); }
export async function runtimeListLabRequestsByUser(userId, options) { return pgListLabRequestsByUser(userId, options); }
export async function runtimeCreateTerminalReplaySession(input) { return pgCreateTerminalReplaySession(input); }
export async function runtimeFinishTerminalReplaySession(id, patch) { return pgFinishTerminalReplaySession(id, patch); }
export async function runtimeAppendTerminalReplayEvent(input) { return pgAppendTerminalReplayEvent(input); }
export async function runtimeFindTerminalReplaySessionById(id) { return pgFindTerminalReplaySessionById(id); }
export async function runtimeUpsertTerminalSessionRegistry(input) { return pgUpsertTerminalSessionRegistry(input); }
export async function runtimeFindTerminalSessionRegistryById(id) { return pgFindTerminalSessionRegistryById(id); }
export async function runtimeDeleteTerminalSessionRegistry(id) { return pgDeleteTerminalSessionRegistry(id); }
export async function runtimeDeleteExpiredTerminalSessionRegistry(nowIso) { return pgDeleteExpiredTerminalSessionRegistry(nowIso); }
export async function runtimeListTerminalReplaySessionsByLab(labRequestId, options) { return pgListTerminalReplaySessionsByLab(labRequestId, options); }
export async function runtimeListTerminalReplayEvents(replaySessionId) { return pgListTerminalReplayEvents(replaySessionId); }
export async function runtimeFindLabRequestByPublicSubdomain(subdomain) { return pgFindLabRequestByPublicSubdomain(subdomain); }
export async function runtimeListPublishedLabRoutes() { return pgListPublishedLabRoutes(); }
export async function runtimeArchiveOldLabRequests(options) { return pgArchiveOldLabRequests(options); }
export async function runtimeDeleteLabRequests(ids) { return pgDeleteLabRequests(ids); }
export async function runtimeFindActiveLabByUserId(userId) { return pgFindActiveLabByUserId(userId); }
export async function runtimeTouchLabRequest(id, patch) { return pgTouchLabRequest(id, patch); }
export async function runtimeUpdateLabRequest(id, patch) { return pgUpdateLabRequest(id, patch); }
export async function runtimeListExpiredRunningLabs(expiresBeforeIso, idleBeforeIso) { return pgListExpiredRunningLabs(expiresBeforeIso, idleBeforeIso); }
export async function runtimeCreateConsultingRequest(input) { return pgCreateConsultingRequest(input); }
export async function runtimeFindConsultingRequestById(id) { return pgFindConsultingRequestById(id); }
export async function runtimeListConsultingRequests() { return pgListConsultingRequests(); }
export async function runtimeListConsultingRequestsByUser(userId) { return pgListConsultingRequestsByUser(userId); }
export async function runtimeUpdateConsultingRequest(id, patch) { return pgUpdateConsultingRequest(id, patch); }
export async function runtimeCreatePublicQuoteInquiry(input) { return pgCreatePublicQuoteInquiry(input); }
export async function runtimeFindPublicQuoteInquiryById(id) { return pgFindPublicQuoteInquiryById(id); }
export async function runtimeListPublicQuoteInquiries() { return pgListPublicQuoteInquiries(); }
export async function runtimeUpdatePublicQuoteInquiry(id, patch) { return pgUpdatePublicQuoteInquiry(id, patch); }
export async function runtimeCreateCustomLabRequest(input) { return pgCreateCustomLabRequest(input); }
export async function runtimeFindCustomLabRequestById(id) { return pgFindCustomLabRequestById(id); }
export async function runtimeListCustomLabRequests() { return pgListCustomLabRequests(); }
export async function runtimeListCustomLabRequestsByUser(userId) { return pgListCustomLabRequestsByUser(userId); }
export async function runtimeUpdateCustomLabRequestStatus(id, patch) { return pgUpdateCustomLabRequestStatus(id, patch); }
export async function runtimeUpdateCustomLabRequest(id, patch) { return pgUpdateCustomLabRequest(id, patch); }
export async function runtimeDeleteCustomLabRequest(id) { return pgDeleteCustomLabRequest(id); }
export async function runtimeCreateSelfServiceVm(input) { return pgCreateSelfServiceVm(input); }
export async function runtimeFindSelfServiceVmById(id, options = {}) { return pgFindSelfServiceVmById(id, options); }
export async function runtimeFindActiveSelfServiceVmByUserId(userId) { return pgFindActiveSelfServiceVmByUserId(userId); }
export async function runtimeListSelfServiceVms() { return pgListSelfServiceVms(); }
export async function runtimeListSelfServiceVmsByUser(userId) { return pgListSelfServiceVmsByUser(userId); }
export async function runtimeUpdateSelfServiceVm(id, patch) { return pgUpdateSelfServiceVm(id, patch); }
export async function runtimeWithExternalPortLock(fn) { return pgWithExternalPortLock(fn); }
export async function runtimeWithMetalLbVipAllocationLock(fn) { return pgWithMetalLbVipAllocationLock(fn); }
export async function runtimeCreateSelfServiceProjectRequest(input) { return pgCreateSelfServiceProjectRequest(input); }
export async function runtimeFindSelfServiceProjectRequestById(id) { return pgFindSelfServiceProjectRequestById(id); }
export async function runtimeListSelfServiceProjectRequests() { return pgListSelfServiceProjectRequests(); }
export async function runtimeListSelfServiceProjectRequestsByUser(userId) { return pgListSelfServiceProjectRequestsByUser(userId); }
export async function runtimeUpdateSelfServiceProjectRequest(id, patch) { return pgUpdateSelfServiceProjectRequest(id, patch); }
export async function runtimeDeleteSelfServiceProjectRequests(ids) { return pgDeleteSelfServiceProjectRequests(ids); }
export async function runtimeDeleteSelfServiceVmRecords(ids) { return pgDeleteSelfServiceVmRecords(ids); }
export async function runtimeCreateZunContainer(input) { return pgCreateZunContainer(input); }
export async function runtimeFindZunContainerById(id) { return pgFindZunContainerById(id); }
export async function runtimeListZunContainers() { return pgListZunContainers(); }
export async function runtimeListZunContainersByUser(userId) { return pgListZunContainersByUser(userId); }
export async function runtimeUpdateZunContainer(id, patch) { return pgUpdateZunContainer(id, patch); }
export async function runtimeDeleteZunContainer(id) { return pgDeleteZunContainer(id); }
export async function runtimeCreateMagnumCluster(input) { return pgCreateMagnumCluster(input); }
export async function runtimeFindMagnumClusterById(id) { return pgFindMagnumClusterById(id); }
export async function runtimeListMagnumClusters() { return pgListMagnumClusters(); }
export async function runtimeListMagnumClustersByUser(userId) { return pgListMagnumClustersByUser(userId); }
export async function runtimeUpdateMagnumCluster(id, patch) { return pgUpdateMagnumCluster(id, patch); }
export async function runtimeDeleteMagnumCluster(id) { return pgDeleteMagnumCluster(id); }
export async function runtimeConsumeRequestRateLimit(input) { return pgConsumeRequestRateLimit(input); }
export async function runtimeDeleteExpiredRequestRateLimits(cutoffMs) { return pgDeleteExpiredRequestRateLimits(cutoffMs); }
export async function runtimeCreateTroveInstance(input) { return pgCreateTroveInstance(input); }
export async function runtimeFindTroveInstanceById(id) { return pgFindTroveInstanceById(id); }
export async function runtimeListTroveInstances() { return pgListTroveInstances(); }
export async function runtimeListTroveInstancesByUser(userId) { return pgListTroveInstancesByUser(userId); }
export async function runtimeUpdateTroveInstance(id, patch) { return pgUpdateTroveInstance(id, patch); }
export async function runtimeDeleteTroveInstance(id) { return pgDeleteTroveInstance(id); }
export async function runtimeCreateResourceDeletionJob(input) { return pgCreateResourceDeletionJob(input); }
export async function runtimeFindResourceDeletionJob(id) { return pgFindResourceDeletionJob(id); }
export async function runtimeUpdateResourceDeletionJob(id, patch) { return pgUpdateResourceDeletionJob(id, patch); }
export async function runtimeListResourceDeletionJobs(options) { return pgListResourceDeletionJobs(options); }
export async function runtimeCreateCloudConsoleAction(input) { return pgCreateCloudConsoleAction(input); }
export async function runtimeFindCloudConsoleActionById(id) { return pgFindCloudConsoleActionById(id); }
export async function runtimeListCloudConsoleActions(userId = null) { return pgListCloudConsoleActions(userId); }
export async function runtimeUpdateCloudConsoleAction(id, patch) { return pgUpdateCloudConsoleAction(id, patch); }
export async function runtimeGetInternalImageCacheStatus(options) { return pgGetInternalImageCacheStatus(options); }
export async function runtimeListInternalImageCache(options) { return pgListInternalImageCache(options); }
export async function runtimeReplaceInternalImageCache(options) { return pgReplaceInternalImageCache(options); }
export async function runtimeListWrittenExamAttempts() { return pgListWrittenExamAttempts(); }
export async function runtimeAppendWrittenExamAttempt(input) { return pgAppendWrittenExamAttempt(input); }
export async function runtimeListLabExamAttempts() { return pgListLabExamAttempts(); }
export async function runtimeLoadLabExamConfig(courseId) {
  const result = await withClient((c) => c.query(`
    SELECT c.lab_exam_config_json, e.config_json,
      (SELECT value FROM platform_settings WHERE key=$2) AS settings_config_json
    FROM courses c
    LEFT JOIN lab_exam_configs e ON e.course_id=c.id
    WHERE c.id=$1
  `, [courseId, `lab_exam_config:${Number(courseId)}`]));
  const row = result.rows[0];
  if (!row) return null;
  const settingsConfig = safeJsonParse(row.settings_config_json, null);
  if (settingsConfig && Object.keys(settingsConfig).length) return settingsConfig;
  const courseConfig = safeJsonParse(row.lab_exam_config_json, null);
  if (courseConfig && Object.keys(courseConfig).length) return courseConfig;
  return safeJsonParse(row.config_json, null);
}
export async function runtimeSaveLabExamConfig(courseId, config) {
  const payload = JSON.stringify(config || {});
  return withTx(async (c) => {
    await c.query(`
      INSERT INTO platform_settings (key, value, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP::text)
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at
    `, [`lab_exam_config:${Number(courseId)}`, payload]);
    await c.query(`
      INSERT INTO lab_exam_configs (course_id, config_json, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP::text)
      ON CONFLICT (course_id) DO UPDATE SET config_json=EXCLUDED.config_json, updated_at=EXCLUDED.updated_at
    `, [courseId, payload]);
    const result = await c.query(`UPDATE courses SET lab_exam_config_json=$2 WHERE id=$1 RETURNING lab_exam_config_json`, [courseId, payload]);
    return safeJsonParse(result.rows[0]?.lab_exam_config_json, null);
  });
}
export async function runtimeDeleteLabExamConfig(courseId) {
  return withTx(async (c) => {
    const settingDeleted = await c.query(`DELETE FROM platform_settings WHERE key=$1`, [`lab_exam_config:${Number(courseId)}`]);
    const deleted = await c.query(`DELETE FROM lab_exam_configs WHERE course_id=$1`, [courseId]);
    const cleared = await c.query(`UPDATE courses SET lab_exam_config_json='{}' WHERE id=$1 AND lab_exam_config_json<>'{}'`, [courseId]);
    return settingDeleted.rowCount > 0 || deleted.rowCount > 0 || cleared.rowCount > 0;
  });
}
export async function runtimeAppendLabExamAttempt(input) { return pgAppendLabExamAttempt(input); }
export async function runtimeUpdateLabExamAttempt(id, patch) { return pgUpdateLabExamAttempt(id, patch); }
export async function runtimeDeleteLabExamAttempt(id) { return pgDeleteLabExamAttempt(id); }
export async function runtimeCreateLabExamSession(input) { return pgCreateLabExamSession(input); }
export async function runtimeFindLabExamSessionById(id) { return pgFindLabExamSessionById(id); }
export async function runtimeListLabExamSessions() { return pgListLabExamSessions(); }
export async function runtimeListLabExamSessionsByUser(userId) { return pgListLabExamSessionsByUser(userId); }
export async function runtimeFindActiveLabExamSessionByUserCourse(userId, courseId) { return pgFindActiveLabExamSessionByUserCourse(userId, courseId); }
export async function runtimeClaimLabExamSessionPreparation(id, leaseUntil) { return pgClaimLabExamSessionPreparation(id, leaseUntil); }
export async function runtimeUpdateLabExamSession(id, patch) { return pgUpdateLabExamSession(id, patch); }
export async function runtimeDeleteLabExamSession(id) { return pgDeleteLabExamSession(id); }
export async function runtimeListCertificates() { return pgListCertificates(); }
export async function runtimeAppendCertificate(input) { return pgAppendCertificate(input); }
export async function runtimeCreateNotice(input) { return pgCreateNotice(input); }
export async function runtimeUpdateNotice(id, input) { return pgUpdateNotice(id, input); }
export async function runtimeDeleteNotice(id) { return pgDeleteNotice(id); }
export async function runtimeFindNoticeById(id) { return pgFindNoticeById(id); }
export async function runtimeListNotices() { return pgListNotices(); }
export async function runtimeCreateQnaPost(input) { return pgCreateQnaPost(input); }
export async function runtimeCreateQnaComment(input) { return pgCreateQnaComment(input); }
export async function runtimeFindQnaPostById(id) { return pgFindQnaPostById(id); }
export async function runtimeListQnaPosts() { return pgListQnaPosts(); }
export async function runtimeAnswerQnaPost(id, input) { return pgAnswerQnaPost(id, input); }
export async function runtimeUpdateQnaPostStatus(id, status) { return pgUpdateQnaPostStatus(id, status); }
export async function runtimeAcceptQnaComment(postId, commentId) { return pgAcceptQnaComment(postId, commentId); }
export async function runtimeMarkQnaHelpful(postId, userId) { return pgMarkQnaHelpful(postId, userId); }
export async function runtimeDeleteQnaPost(id) { return pgDeleteQnaPost(id); }
export async function runtimeDeleteQnaComment(id) { return pgDeleteQnaComment(id); }
export async function runtimeListUserMessages(userId) { return pgListUserMessages(userId); }
export async function runtimeListAllUserMessages() { return pgListAllUserMessages(); }
export async function runtimeCreateUserMessage(input) { return pgCreateUserMessage(input); }
export async function runtimeMarkUserMessageRead(userId, messageId, readAt) { return pgMarkUserMessageRead(userId, messageId, readAt); }
export async function runtimeArchiveUserMessage(userId, messageId) { return pgArchiveUserMessage(userId, messageId); }
export async function runtimeDeleteUserMessage(userId, messageId) { return pgDeleteUserMessageForUser(userId, messageId); }
export async function runtimeDeleteUserMessageById(messageId) { return pgDeleteUserMessageById(messageId); }
export async function runtimeUpdateUserMessageCleanupStatus(messageId, input) { return pgUpdateUserMessageCleanupStatus(messageId, input); }
export async function runtimeListLuckyDrawEvents() { return pgListLuckyDrawEvents(); }
export async function runtimeFindLuckyDrawEventById(id) { return pgFindLuckyDrawEventById(id); }
export async function runtimeFindActiveLuckyDrawEvent(at) { return pgFindActiveLuckyDrawEvent(at); }
export async function runtimeCreateLuckyDrawEvent(input) { return pgCreateLuckyDrawEvent(input); }
export async function runtimeUpdateLuckyDrawEvent(id, patch) { return pgUpdateLuckyDrawEvent(id, patch); }
export async function runtimeDeleteLuckyDrawEvent(id) { return pgDeleteLuckyDrawEvent(id); }
export async function runtimeListLuckyDrawRewardsByEvent(eventId) { return pgListLuckyDrawRewardsByEvent(eventId); }
export async function runtimeCreateLuckyDrawReward(input) { return pgCreateLuckyDrawReward(input); }
export async function runtimeUpdateLuckyDrawReward(id, patch) { return pgUpdateLuckyDrawReward(id, patch); }
export async function runtimeListLuckyDrawAttempts(options) { return pgListLuckyDrawAttempts(options); }
export async function runtimeListLuckyDrawGrantsByUser(userId, limit) { return pgListLuckyDrawGrantsByUser(userId, limit); }
export async function runtimeGetLuckyDrawStats(eventId) { return pgGetLuckyDrawStats(eventId); }
export async function runtimeGetLuckyDrawEventOverview(userId, at) { return pgGetLuckyDrawEventOverview(userId, at); }
export async function runtimeAttemptLuckyDraw(input) { return pgAttemptLuckyDraw(input); }
export async function runtimeListCourseSurveyResponsesByUser(userId) { return pgListCourseSurveyResponsesByUser(userId); }
export async function runtimeListCourseSurveyResponses() { return pgListCourseSurveyResponses(); }
export async function runtimeListCourseAccessCounts() { return pgListCourseAccessCounts(); }
export async function runtimeListPendingCourseSurveyFeedbackJobs(nowIso, limit) { return pgListPendingCourseSurveyFeedbackJobs(nowIso, limit); }
export async function runtimeUpsertCourseSurveyResponse(input) { return pgUpsertCourseSurveyResponse(input); }
export async function runtimeUpdateCourseSurveyFeedback(input) { return pgUpdateCourseSurveyFeedback(input); }
export async function runtimeUpdateCourseSurveyFeedbackAutoStatus(responseId, input) { return pgUpdateCourseSurveyFeedbackAutoStatus(responseId, input); }
export async function runtimeListMarketingSurveys(options) { return pgListMarketingSurveys(options); }
export async function runtimeFindMarketingSurveyById(id, options) { return pgFindMarketingSurveyById(id, options); }
export async function runtimeCreateMarketingSurvey(input) { return pgCreateMarketingSurvey(input); }
export async function runtimeUpdateMarketingSurvey(id, patch) { return pgUpdateMarketingSurvey(id, patch); }
export async function runtimeDeleteMarketingSurvey(id) { return pgDeleteMarketingSurvey(id); }
export async function runtimeSubmitMarketingSurveyVote(input) { return pgSubmitMarketingSurveyVote(input); }
export async function runtimeListMarketingSurveySubmissions(surveyId, limit) { return pgListMarketingSurveySubmissions(surveyId, limit); }
export async function runtimeListScheduleEvents(options) { return pgListScheduleEvents(options); }
export async function runtimeListAdminScheduleEvents() { return pgListAdminScheduleEvents(); }
export async function runtimeCreateScheduleEvent(input) { return pgCreateScheduleEvent(input); }
export async function runtimeUpdateScheduleEvent(id, input) { return pgUpdateScheduleEvent(id, input); }
export async function runtimeDeleteScheduleEvent(id) { return pgDeleteScheduleEvent(id); }
export async function runtimeUpsertGoogleScheduleEvent(input, options = {}) { return pgUpsertGoogleScheduleEvent(input, options); }
export async function runtimeExportBackupData() {
  return withClient(async (client) => {
    const tableRows = (await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name <> 'sessions'
      ORDER BY table_name ASC
    `)).rows;
    const tables = {};
    const dumps = {};
    let totalRows = 0;
    let dumpedRows = 0;
    for (const row of tableRows) {
      const tableName = String(row.table_name || "").trim();
      if (!tableName) continue;
      const quotedTableName = quoteIdentifier(tableName);
      const countResult = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${quotedTableName}`);
      const rowCount = Number(countResult.rows[0]?.count || 0);
      const exportPolicy = getBackupTableExportPolicy(tableName);
      const exportLimit = exportPolicy?.mode === "latest" && rowCount > exportPolicy.maxRows
        ? exportPolicy.maxRows
        : null;
      if (!exportPolicy) {
        const dumpPolicy = getBackupTableDumpPolicy(tableName);
        if (dumpPolicy) {
          const dump = await pgExportBackupTableDump(client, tableName, dumpPolicy, rowCount);
          dumpedRows += dump.rowCount;
          dumps[tableName] = dump;
          continue;
        }
      }
      if (!exportLimit && rowCount > BACKUP_MAX_TABLE_ROWS) {
        throw new Error(`백업 테이블 ${tableName} 행 수가 너무 많습니다. 테이블당 최대 ${BACKUP_MAX_TABLE_ROWS}행까지 지원합니다.`);
      }
      const estimatedExportRows = exportLimit ? Math.min(rowCount, exportLimit) : rowCount;
      if (totalRows + estimatedExportRows > BACKUP_MAX_TOTAL_ROWS) {
        throw new Error(`백업 데이터 행 수가 너무 많습니다. 전체 최대 ${BACKUP_MAX_TOTAL_ROWS}행까지 지원합니다.`);
      }
      const result = exportLimit
        ? await client.query(`SELECT * FROM ${quotedTableName} ORDER BY ${exportPolicy.orderBy} LIMIT $1`, [exportLimit])
        : await client.query(`SELECT * FROM ${quotedTableName}`);
      totalRows += result.rows.length;
      tables[tableName] = {
        rowCount: result.rows.length,
        rows: result.rows,
      };
      if (exportLimit) {
        tables[tableName].sourceRowCount = rowCount;
        tables[tableName].exportMode = "latest";
        tables[tableName].exportLimit = exportLimit;
      }
    }
    return {
      exportedAt: new Date().toISOString(),
      tables,
      dumps,
      rowCount: totalRows,
      dumpedRowCount: dumpedRows,
    };
  });
}

function quoteIdentifier(value) {
  return `"${String(value || "").replace(/"/g, "\"\"")}"`;
}

function getBackupTableExportPolicy(tableName) {
  return BACKUP_TABLE_EXPORT_POLICIES[String(tableName || "").trim()] || null;
}

function getBackupTableDumpPolicy(tableName) {
  return BACKUP_TABLE_DUMP_POLICIES[String(tableName || "").trim()] || null;
}

async function pgExportBackupTableDump(client, tableName, policy, sourceRowCount) {
  const quotedTableName = quoteIdentifier(tableName);
  const orderColumnName = String(policy?.orderColumn || "").trim();
  const quotedOrderColumn = quoteIdentifier(orderColumnName);
  const chunkRows = Math.max(1, Number(policy?.chunkRows || BACKUP_DUMP_TABLE_CHUNK_ROWS) || BACKUP_DUMP_TABLE_CHUNK_ROWS);
  const chunks = [];
  let rowCount = 0;
  let lastValue = null;

  while (true) {
    const result = lastValue == null
      ? await client.query(
        `SELECT * FROM ${quotedTableName} ORDER BY ${quotedOrderColumn} ASC LIMIT $1`,
        [chunkRows],
      )
      : await client.query(
        `SELECT * FROM ${quotedTableName} WHERE ${quotedOrderColumn} > $2 ORDER BY ${quotedOrderColumn} ASC LIMIT $1`,
        [chunkRows, lastValue],
      );
    if (!result.rows.length) break;

    rowCount += result.rows.length;
    chunks.push({
      rowCount: result.rows.length,
      rows: result.rows,
    });

    const nextLastValue = result.rows[result.rows.length - 1]?.[orderColumnName];
    if (nextLastValue == null) {
      throw new Error(`백업 덤프 테이블 ${tableName}의 정렬 컬럼 ${orderColumnName} 값을 확인할 수 없습니다.`);
    }
    lastValue = nextLastValue;
    if (result.rows.length < chunkRows) break;
  }

  return {
    format: policy?.format || "json-row-chunks-v1",
    sourceRowCount,
    rowCount,
    orderBy: policy?.orderBy || `${orderColumnName} ASC`,
    chunkRowCount: chunkRows,
    chunks,
  };
}

async function pgListBackupTableNames(client) {
  const rows = (await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name <> 'sessions'
    ORDER BY table_name ASC
  `)).rows;
  return rows
    .map((row) => String(row.table_name || "").trim())
    .filter(Boolean);
}

async function pgListBackupTableDependencies(client) {
  const rows = (await client.query(`
    SELECT
      tc.table_name AS table_name,
      ccu.table_name AS depends_on
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name <> 'sessions'
      AND ccu.table_name <> 'sessions'
  `)).rows;
  return rows.map((row) => ({
    tableName: String(row.table_name || "").trim(),
    dependsOn: String(row.depends_on || "").trim(),
  })).filter((row) => row.tableName && row.dependsOn);
}

function topoSortTables(tableNames, dependencies) {
  const nodes = new Set(tableNames);
  const incomingCounts = new Map();
  const outgoing = new Map();

  for (const name of nodes) {
    incomingCounts.set(name, 0);
    outgoing.set(name, new Set());
  }

  for (const edge of dependencies) {
    if (!nodes.has(edge.tableName) || !nodes.has(edge.dependsOn) || edge.tableName === edge.dependsOn) continue;
    const targets = outgoing.get(edge.dependsOn);
    if (targets && !targets.has(edge.tableName)) {
      targets.add(edge.tableName);
      incomingCounts.set(edge.tableName, (incomingCounts.get(edge.tableName) || 0) + 1);
    }
  }

  const ready = [...nodes].filter((name) => (incomingCounts.get(name) || 0) === 0).sort();
  const ordered = [];

  while (ready.length) {
    const current = ready.shift();
    ordered.push(current);
    for (const next of outgoing.get(current) || []) {
      const remaining = (incomingCounts.get(next) || 0) - 1;
      incomingCounts.set(next, remaining);
      if (remaining === 0) {
        ready.push(next);
        ready.sort();
      }
    }
  }

  if (ordered.length !== nodes.size) {
    return [...nodes].sort();
  }
  return ordered;
}

function isBackupObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getBackupDumpChunks(snapshot) {
  if (Array.isArray(snapshot?.chunks)) return snapshot.chunks;
  if (Array.isArray(snapshot?.rows)) {
    return [{ rowCount: snapshot.rows.length, rows: snapshot.rows }];
  }
  return [];
}

function countBackupDumpRows(snapshot) {
  return getBackupDumpChunks(snapshot).reduce((sum, chunk) => {
    const rows = Array.isArray(chunk?.rows) ? chunk.rows : [];
    return sum + rows.length;
  }, 0);
}

async function pgInsertBackupRows(client, tableName, rows, options = {}) {
  const batchRows = Math.max(1, Number(options.batchRows || 1) || 1);
  let insertedRows = 0;
  let index = 0;

  while (index < rows.length) {
    const row = rows[index];
    index += 1;
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;

    const columns = Object.keys(row);
    if (!columns.length) {
      await client.query(`INSERT INTO ${quoteIdentifier(tableName)} DEFAULT VALUES`);
      insertedRows += 1;
      continue;
    }

    const columnKey = columns.join("\0");
    const batch = [row];
    while (batch.length < batchRows && index < rows.length) {
      const nextRow = rows[index];
      if (!nextRow || typeof nextRow !== "object" || Array.isArray(nextRow)) {
        index += 1;
        continue;
      }
      const nextColumns = Object.keys(nextRow);
      if (nextColumns.join("\0") !== columnKey) break;
      batch.push(nextRow);
      index += 1;
    }

    const values = [];
    const rowPlaceholders = batch.map((batchRow) => {
      const placeholders = columns.map((column) => {
        values.push(batchRow[column]);
        return `$${values.length}`;
      }).join(", ");
      return `(${placeholders})`;
    }).join(", ");

    await client.query(
      `INSERT INTO ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(", ")}) VALUES ${rowPlaceholders}`,
      values,
    );
    insertedRows += batch.length;
  }

  return insertedRows;
}

async function pgImportBackupTableDump(client, tableName, snapshot) {
  let insertedRows = 0;
  for (const chunk of getBackupDumpChunks(snapshot)) {
    const rows = Array.isArray(chunk?.rows) ? chunk.rows : [];
    insertedRows += await pgInsertBackupRows(client, tableName, rows, {
      batchRows: BACKUP_DUMP_INSERT_BATCH_ROWS,
    });
  }
  return insertedRows;
}

export async function runtimeImportBackupData(bundle) {
  const tables = bundle?.database?.tables;
  const dumps = bundle?.database?.dumps || {};
  if (!isBackupObject(tables)) {
    throw new Error("백업 파일의 데이터베이스 테이블 형식이 올바르지 않습니다.");
  }
  if (!isBackupObject(dumps)) {
    throw new Error("백업 파일의 데이터베이스 덤프 형식이 올바르지 않습니다.");
  }

  return withTx(async (client) => {
    const tableNames = await pgListBackupTableNames(client);
    const unknownTables = Object.keys(tables)
      .map((name) => String(name || "").trim())
      .filter(Boolean)
      .filter((name) => !tableNames.includes(name));
    if (unknownTables.length) {
      throw new Error(`백업 파일에 현재 스키마에서 지원하지 않는 테이블이 포함되어 있습니다: ${unknownTables.join(", ")}`);
    }
    const dumpTableNames = Object.keys(dumps)
      .map((name) => String(name || "").trim())
      .filter(Boolean);
    const unknownDumpTables = dumpTableNames.filter((name) => !tableNames.includes(name));
    if (unknownDumpTables.length) {
      throw new Error(`백업 파일에 현재 스키마에서 지원하지 않는 덤프 테이블이 포함되어 있습니다: ${unknownDumpTables.join(", ")}`);
    }
    const unsupportedDumpTables = dumpTableNames.filter((name) => !getBackupTableDumpPolicy(name));
    if (unsupportedDumpTables.length) {
      throw new Error(`백업 파일에 덤프 복원을 지원하지 않는 테이블이 포함되어 있습니다: ${unsupportedDumpTables.join(", ")}`);
    }

    let totalRows = 0;
    for (const [tableName, snapshot] of Object.entries(tables)) {
      const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
      if (rows.length > BACKUP_MAX_TABLE_ROWS) {
        throw new Error(`백업 테이블 ${tableName} 행 수가 너무 많습니다. 테이블당 최대 ${BACKUP_MAX_TABLE_ROWS}행까지 지원합니다.`);
      }
      totalRows += rows.length;
      if (totalRows > BACKUP_MAX_TOTAL_ROWS) {
        throw new Error(`백업 데이터 행 수가 너무 많습니다. 전체 최대 ${BACKUP_MAX_TOTAL_ROWS}행까지 지원합니다.`);
      }
    }
    for (const [tableName, snapshot] of Object.entries(dumps)) {
      const format = String(snapshot?.format || "json-row-chunks-v1").trim();
      if (format !== "json-row-chunks-v1") {
        throw new Error(`백업 덤프 테이블 ${tableName} 형식은 지원하지 않습니다: ${format}`);
      }
      const chunks = getBackupDumpChunks(snapshot);
      if (!chunks.length && Number(snapshot?.rowCount || 0) > 0) {
        throw new Error(`백업 덤프 테이블 ${tableName}의 청크 데이터가 비어 있습니다.`);
      }
    }

    const dependencies = await pgListBackupTableDependencies(client);
    const restoreOrder = topoSortTables(tableNames, dependencies);
    if (tableNames.length) {
      await client.query(`TRUNCATE TABLE ${tableNames.map(quoteIdentifier).join(", ")} RESTART IDENTITY CASCADE`);
    }

    let restoredRows = 0;
    for (const tableName of restoreOrder) {
      if (dumps?.[tableName]) {
        restoredRows += await pgImportBackupTableDump(client, tableName, dumps[tableName]);
        continue;
      }
      const rows = Array.isArray(tables?.[tableName]?.rows) ? tables[tableName].rows : [];
      restoredRows += await pgInsertBackupRows(client, tableName, rows);
    }

    return {
      restoredAt: new Date().toISOString(),
      tableCount: tableNames.length,
      rowCount: restoredRows,
      dumpedRowCount: Object.values(dumps).reduce((sum, snapshot) => sum + countBackupDumpRows(snapshot), 0),
    };
  });
}
