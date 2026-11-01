import { isEducationApi, emptyEducationResponse, communitySection } from "../../shared/community-profile.js";
import {hasAdminPermission, requiredAdminPermission} from '../../shared/admin-permissions.js';
import { useEffect, useMemo, useRef, useState } from "react";

import { createLatestRequestCoordinator } from "./latest-request-coordinator.js";
import { getMarkdownBlockingWarnings } from "./markdown-mdx-safety.js";
import { getStandaloneExamCourseIds, isLearningLabResource, isStandaloneExamCourse } from "./course-visibility.js";

const DEFAULT_CONTAINER_BACKGROUND_COMMAND = "sleep infinity";
const AUTH_SESSION_EXPIRED_EVENT = "terminal-lab:auth-session-expired";
const ACCOUNT_SHARING_WARNING_EVENT = "terminal-lab:account-sharing-warning";
const ACCOUNT_SHARING_WARNING_MESSAGE = "같은 계정이 다른 네트워크에서 동시에 사용 중인 것으로 감지되었습니다. 본인이 아니라면 비밀번호를 변경해 주세요.";
const ADMIN_REVIEW_REQUIRED_MESSAGE = "관리자 검토 후 사용이 가능합니다.";
const MATERIAL_UPLOAD_EXTENSIONS = [".pdf", ".ppt", ".pptx", ".doc", ".docx", ".mp4", ".webm"];
const TERMINAL_READINESS_MAX_WAIT_MS = 90000;
const LAB_TRANSITION_REFRESH_INTERVAL_MS = 3000;
let lastAccountSharingWarningEventAt = 0;
export const DEFAULT_ONLINE_COURSE_NOTICE = "이 과정은 온라인 교육 전용 페이지입니다.";
const DEFAULT_COURSE_OVERVIEWS = {
  standard: {
    description: "일반 과정은 스스로 학습하는 과정입니다. 강사 비용이 제외되어 비교적 저렴하게 이용할 수 있습니다.",
    points: ["셀프 학습", "강사 비용 제외", "저렴한 수강"],
  },
  ilt: {
    description: "ILT 교육은 강사가 기업 또는 기관의 요청에 맞춰 일정과 장소를 협의해 진행하는 기업 전용 강의 과정입니다. 요청이 확정되면 필요한 랩 환경과 교안을 준비하고, 준비가 완료된 과정만 이 메뉴에 공개됩니다.",
    points: ["기업 전용", "강사 진행", "랩·교안 맞춤"],
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

function confirmMarkdownBlockingWarnings(items) {
  const warnings = items.flatMap((item) => getMarkdownBlockingWarnings(item.value, item.label));
  if (!warnings.length) return true;
  const message = [
    "Markdown 내용 중 저장 전에 확인이 필요한 항목이 있습니다.",
    "",
    ...warnings.map((warning) => `- ${warning}`),
    "",
    "그래도 저장할까요?",
  ].join("\n");

  if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
  return window.confirm(message);
}

export function isAdminUserRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return ["admin", "administrator", "관리자"].includes(normalized);
}

export function getCloudSafeErrorMessage(error, fallback = "OpenStack 작업을 완료하지 못했습니다.", { isAdmin = false } = {}) {
  const message = String(error?.message || "").trim();
  if (isAdmin && message) return message;
  const normalized = message.toLowerCase();
  if (/err_tls|certificate|self[- ]signed|unable to verify|hostname.*certificate/.test(normalized)) return "OpenStack 인증서 신뢰 설정을 확인해야 합니다. 관리자에게 문의해 주세요.";
  if (/overquota|quota exceeded|쿼터|한도를 초과/.test(normalized)) return "프로젝트 자원 한도를 초과했습니다. 사용량을 줄이거나 관리자에게 쿼터 조정을 요청해 주세요.";
  if (/ipaddressgenerationfailure|no more ip addresses|ip 주소.*부족/.test(normalized)) return "선택한 네트워크에 사용 가능한 IP 주소가 없습니다. 다른 네트워크를 선택하거나 관리자에게 문의해 주세요.";
  if (/not authorized|forbidden|\b403\b|권한이 없습니다/.test(normalized)) return "현재 프로젝트에서 이 작업을 수행할 권한이 없습니다. 관리자에게 프로젝트 역할을 확인해 달라고 요청해 주세요.";
  if (/bad gateway|cloudflare|<!doctype|<html|\b502\b/.test(normalized)) return "클라우드 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.";
  if (/timeout|timed out|응답 시간이 초과/.test(normalized)) return "클라우드 서비스 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
  if (message && !/openstack api request failed|neutronerror|traceback|\n\s*at\s/.test(normalized) && message.length <= 240) return message;
  return fallback;
}

export const ADMIN_PERMISSION_OPTIONS = [
  { key: "admin:access", label: "관리자 콘솔", description: "관리자 화면에 접근하고 운영 데이터를 조회합니다." },
  { key: "admin:all", label: "전체 관리자 위임", description: "role 관리자와 같은 전체 관리 권한으로 위임합니다." },
  { key: "admin:users", label: "사용자/권한", description: "일반 사용자 승인과 지원 권한을 관리합니다. 관리자 계정·권한 변경은 전체 관리자 전용입니다." },
  { key: "admin:cloud", label: "클라우드 콘솔", description: "전용 프로젝트와 OpenStack 작업 승인 및 비용 이력을 관리합니다." },
  { key: "admin:platform", label: "플랫폼 설정", description: "운영 설정과 서비스 연결 정보를 관리합니다." },
  { key: "admin:ops", label: "운영 진단", description: "백업, 진단, 배포 전 점검 메뉴를 관리합니다." },
  { key: "admin:templates", label: "템플릿", description: "Heat, cloud-init, Application YAML을 관리합니다." },
  { key: "admin:marketing", label: "마케팅/매출", description: "랜딩, 쿠폰, 견적, 결제 관련 메뉴를 관리합니다." },
  { key: "admin:messages", label: "쪽지/상담", description: "쪽지, 상담, 운영 문의 흐름을 관리합니다." },
  { key: "admin:monitor", label: "운영 모니터", description: "실시간 운영 모니터와 자원 상태를 확인합니다." },
];

const ADMIN_PERMISSION_KEYS = new Set(ADMIN_PERMISSION_OPTIONS.map((item) => item.key));

export function normalizeAdminPermissions(value) {
  let source = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source || "[]");
    } catch {
      source = [];
    }
  }
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

export function userHasAdminPermission(user, permission) {
  if (isAdminUserRole(user?.role)) return true;
  const permissions = normalizeAdminPermissions(user?.adminPermissions);
  return permissions.includes("admin:all") || permissions.includes(String(permission || "").trim().toLowerCase());
}

export function userCanAccessAdminConsole(user) {
  return userHasAdminPermission(user, "admin:access");
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

function toDatetimeLocalInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 16);
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDatetimeLocalInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}

function normalizeCourseProgramTypeOptions(options) {
  const source = Array.isArray(options) && options.length ? options : ["일반", "ILT", "정부지원금", "기업", "학교", "검증"];
  const normalized = source
    .map((item) => (isGovernmentProgramTypeValue(item) ? "정부지원금" : String(item || "").trim()))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function normalizeCourseOverviewPoints(value, fallback = []) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  const normalized = source.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 4);
  return normalized.length ? normalized : fallback;
}

export const DEFAULT_COURSE_SURVEY_CONFIG = {
  intro: "사전 설문은 교육 신청 전에도 바로 참여할 수 있으며 난이도와 실습 방향 조정에 활용합니다. 사후 설문은 교육 참여 후 언제든 남길 수 있고 NPS와 운영 개선에 반영합니다.",
  reminders: {
    postMailSubject: "[{courseTitle}] 교육 후 사후 설문 참여 부탁드립니다",
    postMailBody: "{courseTitle} 교육에 참여해 주셔서 감사합니다.\n\n교육 운영 개선과 다음 과정 설계를 위해 사후 설문과 NPS 응답을 부탁드립니다.\n포털 로그인 후 '사전·사후 설문' 메뉴에서 {courseTitle} 과정을 선택해 바로 작성하실 수 있습니다.\n\n짧게라도 남겨 주시면 운영 품질 개선에 큰 도움이 됩니다.\n감사합니다.",
    postNoticeTitle: "[{courseTitle}] 교육 후 사후 설문 안내",
    postNoticeBody: "{courseTitle} 교육에 참여하신 분들은 포털의 '사전·사후 설문' 메뉴에서 사후 설문과 NPS 응답을 남겨 주세요.\n\n운영 개선, 실습 품질 조정, 후속 과정 설계에 반영됩니다.\n짧은 의견도 충분하니 편하게 작성 부탁드립니다.",
  },
  pre: {
    enabled: true,
    title: "사전 수준 진단",
    questions: [
      { id: "preConfidence", type: "scale", label: "현재 본인의 기술 자신감은 어느 정도인가요?", required: true, min: 0, max: 10, lowLabel: "입문", highLabel: "운영·설계 가능" },
      { id: "usedSkills", type: "choice", label: "사용해본 기술을 선택해주세요.", required: true, multi: true, options: ["Kubernetes", "Docker/Podman", "OpenStack", "CI/CD (Jenkins, GitOps)", "AI/ML (Kubeflow, LLM 등)", "없음"] },
      { id: "experienceItems", type: "choice", label: "현재 이해되거나 직접 해본 항목을 선택해주세요.", required: true, multi: true, options: ["Deployment/Service 차이 설명 가능", "Helm Chart 작성 가능", "로그 기반 장애 원인 분석 가능", "YAML 오류 디버깅 경험 있음", "잘 모르겠다"] },
      { id: "blocker", type: "text", label: "지금 가장 막히는 부분을 한 줄로 적어주세요.", required: true, multiline: false, maxLength: 120, placeholder: "예: PVC 때문에 항상 막힘" },
      { id: "expectedFocus", type: "choice", label: "이번 교육에서 가장 기대하는 것을 1개 선택해주세요.", required: true, options: ["실습 위주", "개념 이해", "실무 적용", "자격증 대비", "최신 트렌드"] },
      { id: "goalLevel", type: "choice", label: "교육이 끝났을 때 도달하고 싶은 목표 레벨은 무엇인가요?", required: true, options: ["입문 탈출", "실무 적용", "아키텍처 이해", "전문가"] },
      { id: "preTestAnswer", type: "choice", label: "Pod가 Pending 상태가 되는 흔한 원인으로 가장 적절한 것은?", required: true, options: ["CPU 부족", "PVC 문제", "네트워크 오류", "이미지 없음"] },
    ],
  },
  post: {
    enabled: true,
    title: "사후 NPS 조사",
    questions: [
      { id: "postConfidence", type: "scale", label: "교육 후 현재 본인의 기술 자신감은 어느 정도인가요?", required: true, min: 0, max: 10, lowLabel: "아직 익숙하지 않음", highLabel: "바로 적용 가능" },
      { id: "npsScore", type: "scale", label: "이번 교육을 동료에게 추천할 의향은 어느 정도인가요?", required: true, min: 0, max: 10, lowLabel: "전혀 추천하지 않음", highLabel: "매우 추천함" },
      { id: "contentSatisfaction", type: "scale", label: "교육 내용 만족도", required: true, min: 1, max: 5, lowLabel: "매우 불만족", highLabel: "매우 만족" },
      { id: "instructorSatisfaction", type: "scale", label: "강사 만족도", required: true, min: 1, max: 5, lowLabel: "매우 불만족", highLabel: "매우 만족" },
      { id: "operationSatisfaction", type: "scale", label: "교육 운영 만족도", required: true, min: 1, max: 5, lowLabel: "매우 불만족", highLabel: "매우 만족" },
      { id: "vendorRequest", type: "choice", label: "강의업체에 가장 우선적으로 바라는 점", required: false, options: ["실습 환경 개선", "자료 제공 확대", "녹화/복습 자료 제공", "심화 과정 개설", "일정/운영 안내 강화", "없음"] },
      { id: "instructorRequest", type: "choice", label: "강사에게 가장 바라는 점", required: false, options: ["설명 속도 조절", "실습 시간 확대", "예제 난이도 조정", "질의응답 시간 확대", "자료 공유 강화", "없음"] },
      { id: "review", type: "text", label: "한 줄 리뷰 또는 추가 요청사항", required: false, multiline: true, maxLength: 300, placeholder: "짧게 한 문장으로 적어주셔도 충분합니다." },
    ],
  },
};

const LOCAL_PREVIEW_SAMPLE_MATERIAL_HREF = "/preview-materials/sample-pdf-workbench-guide.pdf";
const LOCAL_PREVIEW_SAMPLE_CURRICULUM = [
  { title: "과정 화면 확인", duration: "15분", description: "카탈로그에서 과정 상세로 이동하고 학습 작업대를 확인합니다." },
  { title: "PDF 교안 미리보기", duration: "20분", description: "PDF 교안이 사이트 안에서 바로 열리는지 확인합니다." },
  { title: "위키 교재 병행", duration: "20분", description: "기존 위키 교재와 첨부 교안을 같은 흐름에서 살펴봅니다." },
];
const LOCAL_PREVIEW_SAMPLE_COURSE = {
  id: 2026052301,
  slug: "sample-pdf-workbench",
  category: "DevOps",
  courseType: "standard",
  packageItems: [],
  programType: "일반",
  title: "PDF 교안 미리보기 샘플 과정",
  summary: "과정 상세에서 PDF 교안과 위키 교재를 함께 보는 흐름을 확인하기 위한 로컬 샘플입니다.",
  price: 0,
  duration: "반일",
  courseAccessDays: 30,
  level: "입문",
  body: "이 과정은 로컬 미리보기에서 학습 작업대, PDF 교안 임베드, 위키 교재 표시를 한 번에 확인하기 위한 임시 샘플 과정입니다.",
  promoEnabled: false,
  promoPrice: 0,
  objectives: [
    "과정 상세의 학습 작업대 구성을 확인합니다.",
    "PDF 교안이 사이트 내부 뷰어에서 바로 열리는지 확인합니다.",
    "기존 위키 교재와 첨부 교안이 함께 노출되는 방식을 점검합니다.",
  ],
  materials: [
    { label: "샘플 PDF 교안", href: LOCAL_PREVIEW_SAMPLE_MATERIAL_HREF },
  ],
  textbooks: [
    {
      id: "preview-sample-wiki",
      slug: "preview-sample-wiki",
      title: "샘플 위키 교재",
      summary: "DOC 호환 위키 교재 영역 확인용 자료입니다.",
      contentMarkdown: [
        "## 샘플 위키 교재",
        "",
        "이 위키 교재는 기존 DOC/위키 흐름이 유지되는지 확인하기 위한 미리보기 자료입니다.",
        "",
        "### 확인 항목",
        "- 과정 상세에서 위키 교재가 PDF 교안과 함께 보이는지 확인",
        "- 랩 교안 모드에서 자료 전환이 자연스러운지 확인",
        "- 교재 본문이 사이트 내부에서 읽기 좋게 표시되는지 확인",
      ].join("\n"),
      required: true,
      visible: true,
    },
  ],
  courseCurriculum: LOCAL_PREVIEW_SAMPLE_CURRICULUM,
  curriculum: LOCAL_PREVIEW_SAMPLE_CURRICULUM,
  courseVideos: [],
  videos: [],
  exampleFiles: [],
  gitRepositories: [],
  labGuideMarkdown: [
    "## 실습 가이드",
    "",
    "1. 과정 상세 화면에서 `학습 작업대` 영역으로 이동합니다.",
    "2. 왼쪽 자료 목록에서 `샘플 PDF 교안`을 선택합니다.",
    "3. 위키 교재와 PDF 교안 사이를 전환하며 레이아웃을 확인합니다.",
  ].join("\n"),
  commandsMarkdown: [
    "## 확인 명령어 예시",
    "",
    "```bash",
    "pwd",
    "ls -al",
    "```",
  ].join("\n"),
  labEnabled: true,
  labApprovalMode: "instant",
  labBackendType: "vm",
  heatTemplateName: "linux-shell-lab.yaml",
  heatStackPrefix: "preview-pdf-lab",
  heatParameters: {
    flavor: "m1.small",
    image: "lab-rocky-9-2026",
    network: "preview-net",
    key_name: "preview-key",
    security_group: "example.com",
  },
  terminalSshUser: "ubuntu",
  terminalSshPort: 22,
  labRetentionMode: "persistent",
  labRetentionPreset: "1",
  labRetentionDays: 1,
  allowResumeExistingLab: true,
  publicDomainApprovalMode: "manual",
  publicTcpApprovalMode: "manual",
  externalSshApprovalMode: "manual",
  externalRdpApprovalMode: "manual",
  isPublished: true,
  isLandingPreview: true,
  courseStatus: "published",
  accessScope: "public",
  hasAccess: true,
  hasEnrollmentRecord: true,
  enrollmentCreatedAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
  enrollmentExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
  enrollmentDaysRemaining: 5,
  enrollmentExpiringSoon: true,
  courseAccessDefaultDays: 30,
  courseAccessExpiringSoonDays: 7,
  createdAt: "2026-05-23T09:00:00.000Z",
  updatedAt: "2026-05-23T09:00:00.000Z",
};

function createLocalPreviewSampleLab() {
  const now = Date.now();
  const previewStatus = getLocalPreviewLabStatusOverride() || "running";
  const previewNodeReady = previewStatus === "running";
  return {
    id: 2026052302,
    userId: 1,
    username: "admin",
    userName: "로컬 관리자",
    courseId: LOCAL_PREVIEW_SAMPLE_COURSE.id,
    courseTitle: LOCAL_PREVIEW_SAMPLE_COURSE.title,
    purpose: "learning",
    status: previewStatus,
    labBackendType: "vm",
    stackName: "preview-pdf-lab-admin",
    stackId: "preview-pdf-lab-stack",
    instanceUuid: "preview-pdf-lab-node-1",
    instanceIp: previewNodeReady ? "192.0.2.17" : "",
    instanceIps: previewNodeReady ? [{ type: "fixed", address: "192.0.2.17" }] : [],
    vmNodes: [
      {
        id: "node-1",
        name: "pdf-workbench",
        role: "workstation",
        status: previewNodeReady ? "running" : previewStatus,
        fixedIp: previewNodeReady ? "192.0.2.17" : "",
        floatingIp: "",
      },
    ],
    currentFlavor: "m1.small",
    terminalSshUser: "ubuntu",
    terminalSshPassword: "",
    terminalSshPort: 22,
    externalSshEnabled: false,
    externalSshRequestPending: false,
    publicDomains: [],
    requestedPublicDomains: [],
    publicTcpRoutes: [],
    requestedPublicTcpRoutes: [],
    trafficMonitoringEnabled: true,
    trafficDailyBytes: 18_400_000,
    trafficTotalBytes: 128_000_000,
    cpuUsagePercent: 18,
    memoryUsagePercent: 32,
    createdAt: new Date(now - 20 * 60_000).toISOString(),
    startedAt: new Date(now - 16 * 60_000).toISOString(),
    updatedAt: new Date(now - 2 * 60_000).toISOString(),
    lastAccessedAt: new Date(now - 2 * 60_000).toISOString(),
    expiresAt: new Date(now + 3 * 60 * 60_000).toISOString(),
  };
}

function isLocalPreviewHost() {
  if (typeof window === "undefined") return false;
  return ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
}

function getLocalPreviewLabStatusOverride() {
  if (!isLocalPreviewHost()) return "";
  const allowedStatuses = new Set(["pending", "approved", "provisioning", "running", "paused", "terminating", "failed"]);
  const status = String(new URLSearchParams(window.location.search || "").get("previewLabStatus") || "").trim().toLowerCase();
  return allowedStatuses.has(status) ? status : "";
}

function withLocalPreviewSampleCourses(courses) {
  const list = Array.isArray(courses) ? courses : [];
  if (!isLocalPreviewHost()) return list;
  if (!list.some((course) => course?.slug === "portal-v2-demo")) return list;
  if (list.some((course) => course?.slug === LOCAL_PREVIEW_SAMPLE_COURSE.slug)) return list;
  return [...list, LOCAL_PREVIEW_SAMPLE_COURSE];
}

function withLocalPreviewSampleLabs(labs) {
  const list = Array.isArray(labs) ? labs : [];
  if (!isLocalPreviewHost()) return list;
  if (list.some((lab) => Number(lab?.courseId) === Number(LOCAL_PREVIEW_SAMPLE_COURSE.id))) return list;
  return [createLocalPreviewSampleLab(), ...list];
}

function cloneCourseSurveyConfig(config) {
  return JSON.parse(JSON.stringify(config || DEFAULT_COURSE_SURVEY_CONFIG));
}

function normalizeCourseSurveyConfig(config) {
  if (!config || typeof config !== "object") return cloneCourseSurveyConfig(DEFAULT_COURSE_SURVEY_CONFIG);
  const defaultConfig = cloneCourseSurveyConfig(DEFAULT_COURSE_SURVEY_CONFIG);
  return {
    ...defaultConfig,
    ...config,
    reminders: {
      ...(defaultConfig.reminders || {}),
      ...(config.reminders || {}),
    },
    pre: {
      ...defaultConfig.pre,
      ...(config.pre || {}),
      enabled: config.pre?.enabled ?? defaultConfig.pre.enabled,
      questions: Array.isArray(config.pre?.questions) && config.pre.questions.length ? config.pre.questions : defaultConfig.pre.questions,
    },
    post: {
      ...defaultConfig.post,
      ...(config.post || {}),
      enabled: config.post?.enabled ?? defaultConfig.post.enabled,
      questions: Array.isArray(config.post?.questions) && config.post.questions.length ? config.post.questions : defaultConfig.post.questions,
    },
  };
}

const EMPTY_COURSE = {
  id: null,
  slug: "",
  category: "",
  courseType: "standard",
  packageItems: [],
  programType: "일반",
  title: "",
  summary: "",
  price: "",
  promoEnabled: false,
  promoPrice: "0",
  promoStartsAt: "",
  promoEndsAt: "",
  duration: "",
  courseAccessDays: "30",
  level: "입문",
  body: "",
  youtubeUrl: "",
  courseCurriculumText: "",
  courseVideosText: "",
  courseRecordingsText: "",
  onlineMeetingUrl: "",
  onlineBoardUrl: "",
  onlineCourseNotice: DEFAULT_ONLINE_COURSE_NOTICE,
  onlineSessionNote: "",
  labGuideMarkdown: "",
  commandsMarkdown: "",
  aiSystemPrompt: "",
  aiQuickPromptsText: "",
  externalToolLinksText: "",
  externalLearningToolsText: "",
  labStartChecklistText: "",
  objectivesText: "",
  materialsText: "",
  exampleFiles: [],
  gitRepositoryLabel: "",
  gitRepositoryHref: "",
  labEnabled: false,
  labApprovalMode: "manual",
  publicDomainApprovalMode: "manual",
  publicTcpApprovalMode: "manual",
  externalSshApprovalMode: "manual",
  externalRdpApprovalMode: "manual",
  externalSshRouteMode: "both",
  labBackendType: "vm",
  containerImageName: "",
  containerCommandText: DEFAULT_CONTAINER_BACKGROUND_COMMAND,
  containerExposedPort: "22",
  containerAccessMode: "console",
  containerConsoleMode: "zun",
  labRetentionMode: "ephemeral",
  labRetentionPreset: "1",
  labRetentionDays: "1",
  allowResumeExistingLab: false,
  labResizePolicy: "requestable",
  labResizeAllowedFlavorsText: "",
  terminalReplayMode: "inherit",
  trafficMonitoringEnabled: true,
  trafficDailyLimitGb: "0",
  trafficTotalLimitGb: "0",
  trafficExceededAction: "warn",
  heatTemplateName: "",
  heatStackPrefix: "",
  labProvisioningTimeoutMinutes: "10",
  heatParametersText: JSON.stringify({
    flavor: "m1.tiny",
    image: "lab-rocky-9-2026",
    network: "net-infra",
    key_name: "lab-key",
    security_group: "example.com",
  }, null, 2),
  heatApiUrl: "",
  terminalSshUser: "",
  terminalSshPort: "22",
  terminalJumpHost: "",
  terminalJumpUser: "",
  isPublished: true,
  isLandingPreview: false,
  courseStatus: "published",
  releaseLabel: "",
  accessScope: "public",
  accessCode: "",
  textbookAssignments: [],
  surveyConfigText: JSON.stringify(DEFAULT_COURSE_SURVEY_CONFIG, null, 2),
};

function parseExternalToolLinksText(value) {
  return lines(value)
    .map((line) => {
      const [label = "", url = "", description = "", required = ""] = line.split("|").map((part) => part.trim());
      return {
        label,
        url,
        description,
        required: /^(1|true|yes|y|required|필수)$/i.test(required),
      };
    })
    .filter((item) => item.label && /^https?:\/\//i.test(item.url))
    .slice(0, 12);
}

function formatExternalToolLinksText(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const label = String(item?.label || "").trim();
      const url = String(item?.url || item?.href || "").trim();
      const description = String(item?.description || "").trim();
      const required = item?.required ? "필수" : "";
      return [label, url, description, required].filter((part, index) => index < 2 || part).join(" | ");
    })
    .filter(Boolean)
    .join("\n");
}

const parseExternalLearningToolsText = parseExternalToolLinksText;
const formatExternalLearningToolsText = formatExternalToolLinksText;

function normalizeRecordingVisibility(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["admin", "관리자", "관리자만"].includes(raw)) return "admin";
  if (["private", "비공개", "숨김"].includes(raw)) return "private";
  return "students";
}

function parseCourseRecordingsText(value) {
  return lines(value)
    .map((line) => {
      const [date = "", title = "", url = "", description = "", visibility = "students"] = line.split("|").map((part) => part.trim());
      return {
        date: date.slice(0, 10),
        title,
        url,
        description,
        visibility: normalizeRecordingVisibility(visibility),
      };
    })
    .filter((item) => item.title && /^https?:\/\//i.test(item.url))
    .slice(0, 80);
}

function formatCourseRecordingsText(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const date = String(item?.date || "").trim().slice(0, 10);
      const title = String(item?.title || "").trim();
      const url = String(item?.url || item?.href || "").trim();
      const description = String(item?.description || "").trim();
      const visibility = normalizeRecordingVisibility(item?.visibility);
      return [date, title, url, description, visibility].filter((part, index) => index < 3 || part).join(" | ");
    })
    .filter(Boolean)
    .join("\n");
}

const EMPTY_TEXTBOOK = {
  id: null,
  slug: "",
  title: "",
  summary: "",
  contentMarkdown: "",
  status: "draft",
  version: "1.0",
};

const EMPTY_QNA = { courseId: "", labRequestId: "", postType: "question", title: "", body: "" };
const EMPTY_MESSAGE = { recipientId: "", subject: "", body: "", replyToMessageId: null, replyToLabel: "", replyToPreview: "" };
const EMPTY_TEMPLATE = { name: "linux-shell-lab.yaml", content: "" };
const DEFAULT_BASIC_APPLICATION_YAML = [
  "clouds:",
  "  openstack:",
  "    auth:",
  "      auth_url: https://identity.example.com:5000",
  '      username: "example.com"',
  "      project_id: REPLACE_WITH_PROJECT_ID",
  '      project_name: "example.com"',
  '      user_domain_name: "vlab-users"',
  '    region_name: "RegionOne"',
  '    interface: "internal"',
  "    identity_api_version: 3",
].join("\n");

const DEFAULT_LLM_SYSTEM_PROMPT = [
  "당신은 Terminal Lab의 실습 도우미입니다.",
  "",
  "목표:",
  "- 사용자가 현재 교육과정, 랩 환경, 터미널, 컨테이너, 쿠버네티스 클러스터를 빠르게 이해하고 문제를 해결하도록 돕습니다.",
  "- 답변은 실습 중심으로 작성합니다.",
  "- 가능한 경우 바로 실행 가능한 명령어, 확인 순서, 점검 포인트를 제공합니다.",
  "",
  "행동 원칙:",
  "- 초보자도 이해할 수 있게 짧고 명확하게 설명합니다.",
  "- 먼저 가장 가능성 높은 원인부터 제시합니다.",
  "- 여러 단계가 필요하면 번호로 나눠 안내합니다.",
  "- 사용자의 현재 과정, 랩, 자원 상태 맥락이 있으면 우선 반영합니다.",
  "- 위험하거나 파괴적인 명령은 주의 문구를 함께 제시합니다.",
  "- 확실하지 않으면 추측이라고 밝히고 확인 방법을 안내합니다.",
  "",
  "제한:",
  "- 존재하지 않는 기능을 있는 것처럼 말하지 않습니다.",
  "- 관리자 권한이 필요한 작업은 일반 사용자 작업과 구분해서 설명합니다.",
  "- 비밀번호, 토큰, 개인키 같은 민감한 정보는 그대로 출력하지 않습니다.",
  "",
  "응답 스타일:",
  "- 한국어로 답변합니다.",
  "- 불필요하게 장황하지 않게 작성합니다.",
  "- 실습, 운영, 시험, 자격증 맥락에 맞는 표현을 사용합니다.",
].join("\n");
const DEFAULT_LLM_SURVEY_FEEDBACK_PROMPT = [
  "당신은 Terminal Lab의 학습 코치입니다.",
  "사전/사후 설문의 질문 의미와 학습자 답변을 함께 보고, 학습자에게 직접 도움이 되는 해설을 작성합니다.",
  "- 각 문항의 질문 의도를 반영해 답변에서 드러난 현재 상태, 강점, 막힌 지점을 해석합니다.",
  "- 다음 실습에서 바로 해볼 수 있는 행동을 구체적으로 제안합니다.",
  "- 점수나 선택지를 비난하지 않고, 격려와 현실적인 조언을 균형 있게 작성합니다.",
  "- 관리자 평가, 개인정보 추정, 합격/불합격 판단은 하지 않습니다.",
].join("\n");
const DEFAULT_LANDING_DEMO_TYPE = "youtube";
const DEFAULT_LANDING_YOUTUBE_URL = "";
const DEFAULT_POC_PROJECT_NAME = "PoC-example.com";
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

function normalizePocProjectName(value) {
  const normalized = String(value || "").trim();
  return !normalized || normalized.toLowerCase() === "poc" ? DEFAULT_POC_PROJECT_NAME : normalized;
}

const DEFAULT_EXCEPTION_APPLICATION_YAML = [
  "clouds:",
  "  openstack:",
  "    auth:",
  "      auth_url: https://identity.example.com:5000",
  '      username: "PoC-example.com"',
  "      project_id: REPLACE_WITH_PROJECT_ID",
  '      project_name: "PoC-example.com"',
  '      user_domain_name: "vlab-users"',
  '    region_name: "RegionOne"',
  '    interface: "internal"',
  "    identity_api_version: 3",
].join("\n");

const EMPTY_APPLICATION_YAML = {
  name: "default-basic-service.yaml",
  content: DEFAULT_BASIC_APPLICATION_YAML,
  category: "basic",
  description: "기본 서비스 OpenStack 설정",
};
const EMPTY_CLOUD_INIT_TEMPLATE = { name: "default-cloud-init.yaml", content: "#cloud-config\npackages: []\nruncmd: []\n", description: "" };
const EMPTY_NOTICE = { id: null, title: "", body: "", isPinned: false };
const EMPTY_LUCKY_DRAW_EVENT_FORM = {
  id: null,
  title: "",
  description: "",
  status: "draft",
  timezone: "Asia/Seoul",
  startAt: "",
  endAt: "",
  dailyAttemptLimit: "3",
  requireVerifiedUser: true,
  allowNewUsersOnly: false,
  newUserWindowDays: "30",
  allowDormantUsersOnly: false,
  dormantDays: "30",
};
const EMPTY_LUCKY_DRAW_REWARD_FORM = {
  id: null,
  eventId: "",
  label: "",
  rewardType: "message",
  courseId: "",
  couponDiscountType: "percent",
  couponDiscountValue: "50",
  couponExpiresInDays: "7",
  probabilityWeight: "1",
  totalStock: "",
  dailyStock: "",
  perUserLimit: "1",
  messageText: "",
  isActive: true,
};
const EMPTY_NOTIFICATION_STATUS = { tone: "", message: "" };
const EMPTY_PUBLIC_ROUTE = { domainType: "managed", subdomain: "", customDomain: "", routeKey: "http", protocol: "http", port: "80", nodeId: "" };
const EMPTY_PUBLIC_TCP_ROUTE = { targetPort: "", nodeId: "" };
const EMPTY_PROFILE = { name: "", email: "", username: "", role: "", status: "", currentPassword: "", newPassword: "", confirmPassword: "", courseCode: "", otpEnabled: false, otpSetupSecret: "", otpSetupUri: "", otpSetupCode: "", otpDisableCode: "" };
const EMPTY_RESET_PIN_FORM = { username: "", pin: "", newPassword: "", confirmPassword: "" };
const EMPTY_PENDING_OTP_ENROLLMENT = { active: false, userId: null, username: "", name: "", role: "", secret: "", otpauthUrl: "", issuerName: "KIKI OS TERMINAL-LAB", code: "" };
const EMPTY_ADMIN_USER_FORM = { name: "", email: "", username: "", password: "", role: "student", status: "approved" };
const EMPTY_ADMIN_BATCH_USER_FORM = { usernamePrefix: "user", namePrefix: "user", startNumber: "1", endNumber: "10", password: "", role: "student", status: "approved" };
const EMPTY_ADMIN_MAIL_FORM = { recipientMode: "manual", to: "", subject: "", text: "" };
const EMPTY_MARKETING_MAIL_FORM = { recipientMode: "@APPROVED", to: "", subject: "", text: "" };
const EMPTY_MAIL_CAMPAIGN_FORM = {
  name: "",
  purpose: "operational",
  recipientModes: [],
  manualRecipients: "",
  csvText: "",
  sourceFileName: "",
  subject: "",
  text: "",
  replyDeadlineDays: "7",
  externalConsentConfirmed: false,
};
const EMPTY_ADMIN_COUPON_FORM = { userId: "", courseId: "", discountType: "percent", discountValue: "50", expiresInDays: "7", maxUses: "1", source: "admin_manual", campaignName: "", reason: "", note: "" };
const EMPTY_CUSTOM_LAB = {
  title: "",
  instanceCount: "1",
  flavor: "m1.small",
  vcpu: "2",
  ramGb: "4",
  diskGb: "50",
  imageName: "",
  usageDays: "7",
  usagePeriod: "7일",
  desiredBudget: "",
  terminalSshUser: "",
  terminalSshPassword: "",
  note: "",
  cloudInitTemplateName: "",
  advancedConfig: {
    enabled: false,
    cloudInit: { mode: "none", content: "", fileName: "" },
    publicIp: { enabled: false, externalNetworkName: "net-external" },
    volumes: { enabled: false, count: "1", sizeGb: "100", volumeType: "" },
    network: { enabled: false, networkName: "", subnetCidr: "10.20.0.0/24", attachRouter: false, externalNetworkName: "net-external" },
    loadBalancer: { enabled: false, protocol: "TCP", listenerPort: "80", targetPort: "80" },
    database: { enabled: false, engine: "postgresql", version: "16", sizeGb: "20", flavorName: "m1.small", name: "" },
  },
};
const EMPTY_CONSULTING_REQUEST = {
  title: "",
  companyName: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  inquiryType: "강의 컨설팅",
  industry: "",
  currentEnvironment: "",
  requirements: "",
  budgetRange: "",
  desiredTimeline: "",
  note: "",
};
const EMPTY_SELF_SERVICE_VM_FORM = {
  projectName: "",
  networkName: "net-infra",
  imageName: "",
  flavor: "m1.tiny",
  instanceCount: "1",
  cloudInitMode: "none",
  cloudInitTemplateName: "",
  cloudInitCustomContent: "",
  cloudInitCustomFileName: "",
  bootFromVolume: false,
  bootVolumeSizeGb: "20",
  bootVolumeType: "",
  dataVolumeEnabled: false,
  dataVolumeCount: "1",
  dataVolumeSizeGb: "20",
  dataVolumeType: "",
  floatingIpRequested: false,
  publicAccessNote: "",
};
const EMPTY_SELF_SERVICE_VM_PREFLIGHT = { checking: false, ok: false, canCreate: true, message: "", detailMessage: "", checks: [] };
const EMPTY_SELF_SERVICE_PROJECT_REQUEST_FORM = { requestedProjectName: "", networkName: "", subnetCidr: "", networkRequests: [], note: "" };
const EMPTY_SELF_SERVICE_PROJECT_PREFLIGHT_STATUS = { tone: "", message: "", result: null };
const EMPTY_ZUN_FORM = {
  name: "",
  imageName: "docker.io/library/rockylinux:9",
  imageSource: "managed",
  customImageName: "",
  registryAuthEnabled: false,
  registryUrl: "",
  registryUsername: "",
  registryPassword: "",
  commandText: DEFAULT_CONTAINER_BACKGROUND_COMMAND,
  exposedPort: "",
};
const EMPTY_MAGNUM_FORM = { name: "", clusterTemplateId: "", clusterTemplateName: "", kubernetesVersion: "", nodeCount: "1", masterCount: "1", controlPlaneFlavor: "", workerFlavor: "" };
const EMPTY_WRITTEN_EXAM_FORM = {
  courseId: "",
  title: "",
  description: "",
  passScore: "60",
  accessPolicyMode: "course_access",
  requiredCourseIds: [],
  requiredCourseMatch: "all",
  allowFree: true,
  allowPromotion: true,
  entitlementDays: "0",
  refundBlocksNewAttempts: true,
  accessGuidance: "",
  questionsText: JSON.stringify([
    {
      id: "q1",
      type: "multiple_choice",
      questionText: "리눅스에서 현재 작업 디렉터리를 확인하는 명령은?",
      choices: ["pwd", "ls", "cd"],
      answerText: "pwd",
      points: 50,
    },
    {
      id: "q2",
      type: "short_answer",
      questionText: "루트 디렉터리 경로를 입력하세요.",
      answerText: "/",
      points: 50,
    },
  ], null, 2),
};
const EMPTY_LAB_EXAM_FORM = {
  courseId: "",
  heatTemplateName: "",
  examKind: "lab",
  title: "",
  description: "",
  scenarioContent: "",
  questionsText: "[]",
  gradingGuide: "",
  operationPolicy: "",
  gradingNodeRole: "",
  requiredNodeCount: "1",
  preflightScript: "",
  isAttemptOpen: true,
  allowRetake: false,
  maxAttempts: "1",
  accessPolicyMode: "course_access",
  requiredCourseIds: [],
  requiredCourseMatch: "all",
  allowFree: true,
  allowPromotion: true,
  entitlementDays: "0",
  refundBlocksNewAttempts: true,
  accessGuidance: "",
  manualReviewRequired: false,
  terminateLabAfterSubmit: true,
  passScore: "60",
  timeoutHours: "1",
  scriptContent: [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "# 자동 주입 변수 예시:",
    "# LAB_USER, LAB_PASSWORD, LAB_PRIMARY_HOST, LAB_NODES_JSON, LAB_PUBLIC_URLS, LAB_EXAM_SCENARIO",
    "# LLM으로 스크립트 초안을 만든 뒤 이 화면의 사전 테스트로 반드시 검증하세요.",
    "# 최종 출력은 마지막 줄에 아래 JSON 형태로 남기는 것을 권장합니다:",
    "# {\"passed\":true,\"score\":100,\"totalPoints\":100,\"messages\":[\"PASS nginx active\"]}",
    "",
    "score=0",
    "messages=()",
    "",
    "if command -v pwd >/dev/null 2>&1; then",
    "  score=$((score + 50))",
    "  messages+=(\"pwd 명령 확인\")",
    "fi",
    "",
    "if test -f /etc/os-release; then",
    "  score=$((score + 50))",
    "  messages+=(\"/etc/os-release 존재\")",
    "fi",
    "",
    "if [ -n \"${LAB_PRIMARY_HOST:-}\" ]; then",
    "  messages+=(\"대상 노드 ${LAB_PRIMARY_HOST} 확인\")",
    "fi",
    "",
    "passed=false",
    "if [ \"$score\" -ge 60 ]; then",
    "  passed=true",
    "fi",
    "",
    "summary=$(printf '%s / ' \"${messages[@]}\" | tr '\"\\\\' '  ')",
    "summary=${summary% / }",
    "printf '{\"passed\":%s,\"score\":%d,\"totalPoints\":100,\"messages\":[\"%s\"]}\\n' \"$passed\" \"$score\" \"$summary\"",
    "if [ \"$passed\" = true ]; then exit 0; fi",
    "exit 1",
  ].join("\n"),
};
const EMPTY_PLATFORM_STATUS = {
  labCircuitBreaker: false,
  labCircuitBreakerMessage: "더 이상 랩 생성이 불가합니다.",
  labCircuitBreakerSource: "",
  labCircuitBreakerTriggeredAt: "",
  labCircuitBreakerMetric: "",
  labCircuitBreakerUsagePercent: 0,
  labAutoCircuitBreakerEnabled: true,
  labAutoCircuitBreakerThresholdPercent: 80,
  siteUpdateInProgress: false,
  siteUpdateMessage: "화면과 기능을 더 보기 좋게 다듬고 있어요. 잠시 후 새로고침하면 이어서 사용할 수 있습니다.",
  labStartDebugEnabled: false,
  maxConcurrentLabs: 1,
  terminalSessionIdleMinutes: 10,
  terminalReplayEnabled: true,
  unusedVmAutoPauseEnabled: true,
  unusedVmAutoPauseMinutes: 1440,
  unusedVmRetentionMinutes: 10080,
  llmProvider: "custom",
  llmApiUrl: "",
  llmModel: "model",
  llmApiKey: "",
  llmApiKeyConfigured: false,
  llmApiKeyClearRequested: false,
  llmSystemPrompt: DEFAULT_LLM_SYSTEM_PROMPT,
  llmEnabled: false,
    llmDailyQuotaEnabled: true,
    llmDailyQuotaLimit: 10,
    llmDailyQuotaAdminBypass: true,
    llmMaxTokens: 512,
    llmAdminTestMaxTokens: 80,
    llmSurveyFeedbackMaxTokens: 384,
    llmSurveyFeedbackTimeoutMs: 300000,
    llmSurveyFeedbackPrompt: DEFAULT_LLM_SURVEY_FEEDBACK_PROMPT,
    llmSurveyFeedbackOptionsJson: "",
    llmThinkingMode: "disabled",
    llmNoThinkDirectiveEnabled: true,
    llmWebSearchEnabled: true,
    llmWebSearchTimeoutMs: 8000,
    llmWebSearchResultLimit: 5,
    googleSearchApiKey: "",
    googleSearchApiKeyConfigured: false,
    googleSearchApiKeyClearRequested: false,
    googleSearchCx: "",
  accountSharingProtectionEnabled: false,
  termsEnabled: true,
  userPortalV2Enabled: true,
  portalUiMode: "switchable",
  portalV2TransitionNoticeEnabled: true,
  portalV2TransitionNoticeMessage: "",
  inviteOnlyMode: false,
  signupAutoApproveEnabled: false,
  signupWelcomeCouponEnabled: true,
  siteVersionNumber: "v1.0",
  siteVersionStage: "Release",
  siteVersionCodename: "Engineer Lab",
  cicdExecutionMode: "simulated",
  jenkinsBaseUrl: "",
  jenkinsUsername: "",
  jenkinsApiToken: "",
  jenkinsApiTokenConfigured: false,
  jenkinsDefaultFolder: "terminal-lab",
  jenkinsJobPrefix: "tlab-",
  jenkinsAutoCreateJobs: true,
  serviceProjectName: "service",
  serviceCloudsYaml: "",
  serviceCloudName: "openstack",
  serviceAuthUrl: "",
  serviceHeatApiUrl: "",
  serviceComputeApiUrl: "",
  serviceNetworkApiUrl: "",
  openstackStatusProbesEnabled: true,
  openstackStatusCacheTtlMinutes: 10,
  adminAutoRefreshIntervalSeconds: 60,
  userAutoRefreshIntervalSeconds: 60,
  pocProjectName: DEFAULT_POC_PROJECT_NAME,
  pocCloudsYaml: "",
  pocCloudName: "openstack",
  pocAuthUrl: "",
  pocHeatApiUrl: "",
  pocDefaultHeatTemplateName: "self-service-vm-dynamic.yaml",
  zunProjectName: "zun",
  magnumProjectName: "poc-example.com",
  magnumClusterProfiles: [],
  magnumClusterProfilesJson: "[]",
  magnumAutoApproveEnabled: false,
  magnumAutoApproveProfileIds: [],
  magnumAutoApproveMaxMasterCount: 1,
  magnumAutoApproveMaxNodeCount: 3,
  magnumAutoApproveMaxClustersPerUser: 1,
  magnumAutoApproveRequireQuota: true,
  troveProjectName: "trove",
  selfServiceVmAllowedFlavors: ["m1.tiny", "m1.small", "m1.medium"],
  aiVmFlavorCatalog: [],
  selfServiceVmAllowedImages: ["lab-rocky-9-2026"],
  selfServiceVmAllowedProjects: ["service"],
  selfServiceVmAutoProvisionEnabled: true,
  selfServiceVmProjectAutoConfigureEnabled: false,
  selfServiceVmProjectAutoApproveEnabled: false,
  selfServiceVmProjectAutoNetworkEnabled: false,
  selfServiceVmProjectRoleNames: ["member", "heat_stack_owner"],
  selfServiceVmProjectExternalNetworkName: "net-external",
  selfServiceVmProjectQuota: {
    instances: 2,
    cores: 4,
    ram: 8192,
    volumes: 2,
    gigabytes: 80,
    snapshots: 2,
    network: 5,
    subnet: 5,
    router: 3,
    port: 30,
    floatingip: 2,
    security_group: 5,
    security_group_rule: 50,
  },
  arenaEnabled: false,
  selfServiceVmServiceEnabled: false,
  selfServiceVmVolumeBootEnabled: false,
  selfServiceVmDataVolumeEnabled: false,
  selfServiceVmMaxDataVolumeCount: 2,
  selfServiceVmMaxDataVolumeSizeGb: 100,
  selfServiceVmFloatingIpEnabled: false,
  labAutoBootFromVolumeOnDiskPressureEnabled: true,
  labAutoBootFromVolumeDiskThresholdPercent: 80,
  labAutoBootVolumeSizeGb: 20,
  labAutoBootVolumeType: "",
  zunAllowedImages: ["docker.io/library/rockylinux:9", "docker.io/library/ubuntu:24.04"],
  pocEnabled: false,
  pocFreeModeEnabled: false,
  pocAllowedImages: ["lab-rocky-9-2026", "ubuntu-24.04"],
  pocAllowedFlavors: ["m1.tiny", "m1.small", "m1.medium"],
  pocFlavorDailyPrices: { "m1.tiny": 5900, "m1.small": 9900, "m1.medium": 19900 },
  pocAdvancedDailyPrices: {
    network: 1200,
    router: 800,
    floatingIp: 1500,
    volumeGb: 30,
    container: 3000,
    kubernetes: 12000,
    database: 7000,
    databaseGb: 40,
    cicdRun: 500,
  },
  pocFlavorSpecs: {
    "m1.tiny": { vcpu: 1, ramGb: 2, diskGb: 20 },
    "m1.small": { vcpu: 2, ramGb: 4, diskGb: 50 },
    "m1.medium": { vcpu: 4, ramGb: 8, diskGb: 80 },
  },
  courseLevelOptions: ["입문", "초급", "중급", "고급", "전문가"],
  courseCategoryOptions: ["linux", "k8s", "openstack", "ai"],
  courseProgramTypeOptions: ["일반", "ILT", "정부지원금", "기업", "학교", "검증"],
  standardCourseOverviewDescription: DEFAULT_COURSE_OVERVIEWS.standard.description,
  standardCourseOverviewPoints: DEFAULT_COURSE_OVERVIEWS.standard.points,
  iltCourseOverviewDescription: DEFAULT_COURSE_OVERVIEWS.ilt.description,
  iltCourseOverviewPoints: DEFAULT_COURSE_OVERVIEWS.ilt.points,
  onlineCourseOverviewDescription: DEFAULT_COURSE_OVERVIEWS.online.description,
  onlineCourseOverviewPoints: DEFAULT_COURSE_OVERVIEWS.online.points,
  governmentCourseOverviewDescription: DEFAULT_COURSE_OVERVIEWS.government.description,
  governmentCourseOverviewPoints: DEFAULT_COURSE_OVERVIEWS.government.points,
  customRouteSlots: [
    { id: "custom1", label: "", port: null },
    { id: "custom2", label: "", port: null },
    { id: "custom3", label: "", port: null },
  ],
  customDomainGuidanceIntro: DEFAULT_CUSTOM_DOMAIN_GUIDANCE.intro,
  customDomainGuidanceCnameLabel: DEFAULT_CUSTOM_DOMAIN_GUIDANCE.cnameLabel,
  customDomainGuidanceCnameText: DEFAULT_CUSTOM_DOMAIN_GUIDANCE.cnameText,
  customDomainGuidanceOwnershipLabel: DEFAULT_CUSTOM_DOMAIN_GUIDANCE.ownershipLabel,
  customDomainGuidanceOwnershipText: DEFAULT_CUSTOM_DOMAIN_GUIDANCE.ownershipText,
  customDomainGuidanceRecommendationLabel: DEFAULT_CUSTOM_DOMAIN_GUIDANCE.recommendationLabel,
  customDomainGuidanceRecommendationText: DEFAULT_CUSTOM_DOMAIN_GUIDANCE.recommendationText,
  customDomainGuidanceVerificationLabel: DEFAULT_CUSTOM_DOMAIN_GUIDANCE.verificationLabel,
  customDomainGuidanceVerificationText: DEFAULT_CUSTOM_DOMAIN_GUIDANCE.verificationText,
  zunApiUrl: "",
  zunEnabled: false,
  magnumApiUrl: "",
  magnumEnabled: false,
  aiGpuEnabled: false,
  troveApiUrl: "",
  troveEnabled: false,
  troveAllowedDatastores: ["mysql", "postgresql", "mariadb"],
  troveAllowedFlavors: ["m1.small", "m1.medium"],
  troveAllowedSizesGb: [5, 10, 20],
  landingVideoEnabled: true,
  landingScheduleEnabled: true,
  googleCalendarSyncEnabled: false,
  googleCalendarIcsUrl: "",
  googleCalendarSyncIntervalMinutes: 60,
  landingNoticeEnabled: false,
  landingSurveyNoticeEnabled: false,
  landingCurriculumCollapsedByDefault: true,
  landingDemoType: DEFAULT_LANDING_DEMO_TYPE,
  landingYoutubeUrl: DEFAULT_LANDING_YOUTUBE_URL,
  landingHeroEyebrow: "오픈소스 엔지니어링 랩",
  landingHeroTitle: "리눅스 인프라 엔지니어를 위한 오픈소스 실습 랩",
  landingHeroCopy: "Linux/Kubernetes/OpenStack/CI/CD/DEV 자동화 실습을 브라우저 콘솔과 교안으로 한 흐름에서 제공합니다.",
  landingAuthEyebrow: "접속 안내",
  landingAuthTitle: "로그인 또는 회원가입",
  landingAuthCopy: "승인된 계정으로 실습 환경과 교육 자료에 바로 접근할 수 있습니다.",
  landingFreeTitle: "현재 무료로 운영 중입니다",
  landingFreeSubtitle: "회원가입 후 관리자 승인을 받으면 공개 과정과 랩 신청을 바로 확인할 수 있습니다.",
  landingCustomerLogosEnabled: true,
  landingCustomerLogosTitle: "함께한 고객",
  landingCustomerLogos: [],
  landingVideoPath: "",
  landingVideoMime: "",
  landingLogoMode: "code",
  landingLogoPath: "",
  landingLogoMime: "",
  faviconMode: "code",
  faviconPath: "",
  faviconMime: "",
  materialsUploadMaxMb: 80,
  publicDomainRoutesEnabled: true,
  externalSshRoutesEnabled: true,
  externalRdpRoutesEnabled: true,
  publicTcpRoutesEnabled: false,
  courseQuoteAccessMode: "enabled",
  sshPublicHost: "ssh.example.com",
  sshExternalPortStart: 41000,
  sshExternalPortEnd: 42999,
  sshExternalPortMin: 41000,
  sshExternalPortMax: 42999,
  rdpExternalPortStart: 43000,
  rdpExternalPortEnd: 43099,
  rdpExternalPortMin: 43000,
  rdpExternalPortMax: 43099,
  tcpExternalPortStart: 45000,
  tcpExternalPortEnd: 45999,
  tcpExternalPortMin: 45000,
  tcpExternalPortMax: 45999,
  paymentGatewayEnabled: false,
  paymentGatewayProvider: "manual",
  paymentGatewayMerchantId: "",
  paymentGatewayApiBaseUrl: "",
  paymentGatewayPublicKey: "",
  paymentGatewaySecretKey: "",
  paymentGatewayWebhookSecret: "",
  oauthGoogleEnabled: false,
  oauthGoogleConfigured: false,
  oauthGoogleClientId: "",
  oauthGoogleClientSecret: "",
  oauthGoogleRedirectUri: "",
  oauthKakaoEnabled: false,
  oauthKakaoConfigured: false,
  oauthKakaoClientId: "",
  oauthKakaoClientSecret: "",
  oauthKakaoRedirectUri: "",
  oauthNaverEnabled: false,
  oauthNaverConfigured: false,
  oauthNaverClientId: "",
  oauthNaverClientSecret: "",
  oauthNaverRedirectUri: "",
  oauthRedirectUri: "",
  mailEnabled: false,
  preSurveyAdminMailEnabled: true,
  mailProvider: "webhook",
  mailFromName: "KIKI OS TERMINAL-LAB",
  mailFromAddress: "",
  mailSmtpHost: "",
  mailSmtpPort: 587,
  mailSmtpSecure: false,
  mailSmtpUser: "",
  mailSmtpPassword: "",
  mailWebhookUrl: "",
  mailWebhookTimeoutMs: 10000,
  mailTemplates: {},
  mailTemplateCatalog: [],
  footerAdminName: "관리자",
  footerEmail: "admin@example.com",
  footerBusinessInfo: "",
  supportMessageGroupName: "운영지원",
  supportAvailabilityMode: "available",
  supportUnavailableMessage: "현재 관리자가 부재중입니다. 운영지원 대화는 잠시 후 다시 이용해 주세요.",
  otpAdminRequired: false,
  otpUserEnabled: false,
  otpIssuerName: "KIKI OS TERMINAL-LAB",
};

export function normalizeCourseQuoteAccessMode(value) {
  const normalized = String(value || "enabled").trim().toLowerCase();
  return ["enabled", "admin_only", "disabled"].includes(normalized) ? normalized : "enabled";
}

export function normalizePortalUiMode(value, fallback = "legacy") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["legacy", "switchable", "v2"].includes(normalized)) return normalized;
  return fallback;
}

export function normalizeSupportAvailabilityMode(value, fallback = "available") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["available", "away"].includes(normalized)) return normalized;
  return fallback;
}

export function canUseCourseQuotePortal(platformStatus, isAdmin = false) {
  const mode = normalizeCourseQuoteAccessMode(platformStatus?.courseQuoteAccessMode);
  if (mode === "enabled") return true;
  if (mode === "admin_only") return Boolean(isAdmin);
  return false;
}

function normalizePaymentGatewayProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "manual") return "manual";
  if (["toss", "tosspayment", "tosspayments", "toss-payments"].includes(normalized)) return "tosspayments";
  if (["portone", "iamport"].includes(normalized)) return "portone";
  return normalized;
}

function isTossApiClientKey(value) {
  return /^(test|live)_ck_/i.test(String(value || "").trim());
}

function isTossApiSecretKey(value) {
  return /^(test|live)_sk_/i.test(String(value || "").trim());
}

function validatePaymentGatewaySettings(status) {
  const provider = normalizePaymentGatewayProvider(status?.paymentGatewayProvider || "manual");
  if (!status?.paymentGatewayEnabled || provider !== "tosspayments") {
    return "";
  }

  const publicKey = String(status?.paymentGatewayPublicKey || "").trim();
  const secretKey = String(status?.paymentGatewaySecretKey || "").trim();

  if (publicKey && !isTossApiClientKey(publicKey)) {
    return "토스페이먼츠 Public Key는 API 개별 연동용 `test_ck...` 또는 `live_ck...` 형식이어야 합니다. `gck` 키는 결제위젯 전용입니다.";
  }

  if (secretKey && !isTossApiSecretKey(secretKey)) {
    return "토스페이먼츠 Secret Key는 API 개별 연동용 `test_sk...` 또는 `live_sk...` 형식이어야 합니다. `gsk` 키는 결제위젯 전용입니다.";
  }

  if (publicKey && secretKey) {
    const publicKeyMode = publicKey.slice(0, 4).toLowerCase();
    const secretKeyMode = secretKey.slice(0, 4).toLowerCase();
    if (publicKeyMode !== secretKeyMode) {
      return "토스페이먼츠 Public Key와 Secret Key는 둘 다 `test_*` 또는 둘 다 `live_*` 세트여야 합니다.";
    }
  }

  return "";
}

function normalizeSshPublicHost(value, fallback = "ssh.example.com") {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase();
  if (!normalized || normalized === "example.com") return fallback;
  return raw;
}

const EMPTY_API_MONITOR = {
  portal: null,
  llm: null,
  zun: null,
  magnum: null,
  trove: null,
  heat: null,
  quota: null,
  access: null,
  checkedAt: "",
};
const EMPTY_TRAFFIC_DEBUG_STATUS = {
  capturing: false,
  tone: "",
  message: "",
  durationSeconds: 30,
  interfaceName: "",
};
const EMPTY_QUOTA_STATUS = { ok: false, metrics: null, message: "", projectName: "" };
const LAB_RESOURCE_PREFLIGHT_WARN_PERCENT = 78;
const LAB_RESOURCE_PREFLIGHT_CRITICAL_PERCENT = 92;
const EMPTY_LLM_QUOTA_STATUS = {
  enabled: true,
  bypassed: false,
  adminBypass: true,
  dailyLimit: 10,
  usedQuestions: 0,
  remainingQuestions: 10,
  canAsk: true,
  usageDate: "",
  timeZone: "Asia/Seoul",
  lastQuestionAt: "",
};

function normalizeBooleanValue(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "on", "enabled"].includes(normalized);
}

function normalizePositiveInteger(value, fallback = 1) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number;
}

function getCourseHeatParameters(course) {
  return course?.heatParameters && typeof course.heatParameters === "object" ? course.heatParameters : {};
}

function getCourseInstanceCount(course) {
  const heatParameters = getCourseHeatParameters(course);
  const nodeCount = Array.isArray(heatParameters.nodes)
    ? heatParameters.nodes.length
    : Array.isArray(heatParameters.servers)
      ? heatParameters.servers.length
      : 0;
  const candidate = heatParameters.instance_count
    ?? heatParameters.instanceCount
    ?? heatParameters.node_count
    ?? heatParameters.nodeCount
    ?? nodeCount
    ?? 1;
  return Math.max(1, Math.min(200, normalizePositiveInteger(candidate, 1)));
}

function getCourseBootVolumeRequirementGb(course) {
  const heatParameters = getCourseHeatParameters(course);
  const bootFromVolume = normalizeBooleanValue(heatParameters.boot_from_volume ?? heatParameters.bootFromVolume);
  if (!bootFromVolume) return 0;
  const perInstanceSizeGb = normalizePositiveInteger(heatParameters.boot_volume_size ?? heatParameters.bootVolumeSizeGb ?? heatParameters.bootVolumeSize, 20);
  return perInstanceSizeGb * getCourseInstanceCount(course);
}

function getQuotaMetricPercent(metric) {
  const explicit = Number(metric?.percent);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, Math.round(explicit)));
  const limit = Number(metric?.limit || 0);
  const used = Number(metric?.used || 0);
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used)) return 0;
  return Math.max(0, Math.min(100, Math.round((Math.max(0, used) / limit) * 100)));
}

function getQuotaMetricRemaining(metric) {
  const limit = Number(metric?.limit || 0);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const used = Math.max(0, Number(metric?.used || 0) || 0);
  return Math.max(0, limit - used);
}

function formatLabResourceAmount(value, unit = "") {
  const number = Math.max(0, Number(value || 0) || 0);
  if (unit === "MB") {
    if (number >= 1024) return `${Math.round(number / 1024)}GB`;
    return `${Math.round(number)}MB`;
  }
  if (unit === "GB") return `${Math.round(number)}GB`;
  return `${Math.round(number)}`;
}

function buildLabResourcePreflightWarning(course, quotaStatus) {
  if (!course || String(course.labBackendType || "vm").trim().toLowerCase() !== "vm") return "";
  const metrics = quotaStatus?.metrics || {};
  if (!metrics || typeof metrics !== "object") return "";
  const volumeMetric = metrics.volumeStorage;
  const requiredVolumeGb = getCourseBootVolumeRequirementGb(course);
  const remainingVolumeGb = getQuotaMetricRemaining(volumeMetric);
  if (requiredVolumeGb > 0 && remainingVolumeGb != null && remainingVolumeGb < requiredVolumeGb) {
    return [
      "현재 실습 프로젝트의 Volume 여유가 부족할 수 있습니다.",
      `이 과정은 Cinder OS 디스크 ${requiredVolumeGb}GB가 필요하지만 남은 Volume은 ${formatLabResourceAmount(remainingVolumeGb, "GB")}입니다.`,
      "랩 생성이 실패할 수 있습니다. 그래도 시작할까요?",
    ].join("\n");
  }
  const highUsageItems = [
    { label: "vCPU", metric: metrics.cores },
    { label: "RAM", metric: metrics.ram },
    { label: "Volume", metric: volumeMetric },
  ]
    .map((item) => ({ ...item, percent: getQuotaMetricPercent(item.metric) }))
    .filter((item) => item.percent >= LAB_RESOURCE_PREFLIGHT_WARN_PERCENT);
  if (!highUsageItems.length) return "";
  const isCritical = highUsageItems.some((item) => item.percent >= LAB_RESOURCE_PREFLIGHT_CRITICAL_PERCENT);
  return [
    isCritical ? "현재 실습 프로젝트 자원이 거의 소진되었습니다." : "현재 실습 프로젝트 자원 사용률이 높습니다.",
    highUsageItems.map((item) => `${item.label} ${item.percent}% 사용`).join(", "),
    "랩 생성이 지연되거나 실패할 수 있습니다. 계속할까요?",
  ].join("\n");
}

const EMPTY_SERVICE_VALIDATION_STATUS = {
  active: false,
  createdCount: 0,
  tone: "",
  message: "",
  resources: {
    course: false,
    notice: false,
    heatTemplate: false,
    multiVmHeatTemplate: false,
    applicationYaml: false,
    cloudInitTemplate: false,
  },
  details: {
    courseTitles: [],
    courseTitle: "",
    noticeTitle: "",
    heatTemplateName: "",
    multiVmHeatTemplateName: "",
    applicationYamlName: "",
    exceptionApplicationYamlName: "",
    cloudInitTemplateName: "",
    writtenExamTitle: "",
    labExamTitle: "",
    demoUserCount: 0,
    demoCertificateCount: 0,
    demoInviteCount: 0,
    demoAccessRequestCount: 0,
    demoLabCount: 0,
    pendingLabApprovalCount: 0,
    pendingExposureCount: 0,
    instantDomainCourseCount: 0,
    manualDomainCourseCount: 0,
    multiVmCourseCount: 0,
    demoMultiVmLabCount: 0,
    demoPublishedDomainLabCount: 0,
    demoExternalSshLabCount: 0,
    demoSelfServiceVmCount: 0,
    demoContainerCount: 0,
    demoMagnumCount: 0,
    demoCustomLabCount: 0,
    demoAdvancedCustomLabCount: 0,
    demoMultiInstanceCustomLabCount: 0,
    demoQuotedCustomLabCount: 0,
    demoQnaCount: 0,
    demoQnaInProgressCount: 0,
    demoQnaAnsweredCount: 0,
    demoPaymentCount: 0,
    demoMarketingLuckyDrawCount: 0,
    demoMarketingRewardCount: 0,
    demoMarketingCouponCount: 0,
    marketingLuckyDrawTitle: "",
    demoMailLogCount: 0,
    demoMessageCount: 0,
    demoUnreadMessageCount: 0,
    demoReadMessageCount: 0,
    demoNotificationCount: 0,
    demoUnreadNotificationCount: 0,
    demoReadNotificationCount: 0,
    demoUsernames: [],
    demoCredentials: [],
    demoPassword: "",
    inviteCode: "",
    paymentOrderId: "",
    pocPaymentOrderId: "",
  },
  summary: "",
};
const EMPTY_ACCESS_STATS = {
  currentConnectedUsers: 0,
  currentInstructorUsers: 0,
  totalConnectedUsers: 0,
  todayUsers: 0,
  monthUsers: 0,
  yearUsers: 0,
  totalLoginEvents: 0,
  activeWithinMinutes: 2,
  activitySeries: { daily: [], weekly: [], monthly: [], yearly: [] },
  recentLogs: [],
};
const EMPTY_TROVE_FORM = {
  name: "",
  databaseName: "",
  datastoreType: "mysql",
  datastoreVersion: "",
  flavor: "m1.small",
  sizeGb: "5",
};
const EMPTY_ADMIN_ARENA_OVERVIEW = {
  overview: {
    season: null,
    nodes: [],
    leaderboard: [],
    events: [],
    activeSession: null,
    stats: {
      totalNodes: 0,
      capturedNodes: 0,
      activeUsers: 0,
      bossOpened: false,
    },
  },
  seasons: [],
  scenarios: [],
  nodes: [],
  sessions: [],
  attempts: [],
  captures: [],
};
const EMPTY_CERTIFICATE_STATUS = { tone: "", message: "" };
const EMPTY_CERTIFICATE_TIER = { key: "starter", label: "준비 중", min: 0 };
const ACTIVE_LAB_STATUSES = ["pending", "approved", "provisioning", "running", "paused", "terminating"];

function resolveRouteKeyForPort(port, customRouteSlots = []) {
  const numericPort = Number(port || 80);
  if (numericPort === 443) return "https";
  if (numericPort === 80) return "http";
  const matchedSlot = (Array.isArray(customRouteSlots) ? customRouteSlots : []).find((slot) => Number(slot?.port) === numericPort);
  return matchedSlot?.id || "http";
}

function inferPublicRouteProtocolForPort(port) {
  const numericPort = Number(port || 0);
  if (numericPort === 443 || numericPort === 8443) return "https";
  if (Number.isInteger(numericPort) && numericPort > 1000 && String(numericPort).endsWith("443")) return "https";
  return "http";
}

function upsertByKey(list, item, key = "id") {
  const target = item?.[key];
  if (target == null) return Array.isArray(list) ? [...list] : [];
  const items = Array.isArray(list) ? list : [];
  const existingIndex = items.findIndex((entry) => String(entry?.[key]) === String(target));
  if (existingIndex === -1) return [...items, item];
  return items.map((entry, index) => (index === existingIndex ? { ...entry, ...item } : entry));
}

function removeByKey(list, targetValue, key = "id") {
  const items = Array.isArray(list) ? list : [];
  return items.filter((entry) => String(entry?.[key]) !== String(targetValue));
}

function isPageVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function subscribeToVisiblePageResume(callback) {
  if (typeof document === "undefined" || typeof document.addEventListener !== "function") {
    return () => {};
  }
  const handleVisibilityChange = () => {
    if (isPageVisible()) callback();
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
}

export function usePortalApp() {
  const [route, setRoute] = useState(getRoute());
  const [popupMode, setPopupMode] = useState(getPopupMode());
  const [section, setSection] = useState(getInitialSection);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [courses, setCourses] = useState([]);
  const [notices, setNotices] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [notificationStatus, setNotificationStatus] = useState(EMPTY_NOTIFICATION_STATUS);
  const [luckyDrawOverview, setLuckyDrawOverview] = useState({ event: null, rewards: [], attempts: [], grants: [], remainingAttempts: 0 });
  const [luckyDrawStatus, setLuckyDrawStatus] = useState(EMPTY_NOTIFICATION_STATUS);
  const [coupons, setCoupons] = useState([]);
  const [messages, setMessages] = useState([]);
  const [messageRecipients, setMessageRecipients] = useState([]);
  const [messageForm, setMessageForm] = useState(EMPTY_MESSAGE);
  const [messageStatus, setMessageStatus] = useState(EMPTY_NOTIFICATION_STATUS);
  const [platformStatus, setPlatformStatusState] = useState(EMPTY_PLATFORM_STATUS);
  const [activeTerms, setActiveTerms] = useState([]);
  const [platformStatusDirty, setPlatformStatusDirty] = useState(false);
  const [paymentGatewayKeyVisibility, setPaymentGatewayKeyVisibility] = useState({
    publicKey: false,
    secretKey: false,
    webhookSecret: false,
  });
  const platformStatusDirtyRef = useRef(false);
  const platformStatusRef = useRef(EMPTY_PLATFORM_STATUS);
  const [selectedCourseId, setSelectedCourseId] = useState(getInitialSelectedCourseId());
  const terminalCourseSelectionTouchedRef = useRef(false);
  const [openSelectedCourseDetail, setOpenSelectedCourseDetail] = useState(false);
  const [preferredSurveyPhase, setPreferredSurveyPhase] = useState("pre");
  const [labs, setLabs] = useState([]);
  const applyingLabCourseIdsRef = useRef(new Set());
  const [applyingLabCourseIds, setApplyingLabCourseIds] = useState([]);
  const startingLabIdsRef = useRef(new Set());
  const [startingLabIds, setStartingLabIds] = useState([]);
  const labParameterOverridePromptRef = useRef(null);
  const [labParameterOverridePrompt, setLabParameterOverridePrompt] = useState(null);
  const [qnaPosts, setQnaPosts] = useState([]);
  const [qnaForm, setQnaForm] = useState(EMPTY_QNA);
  const [qnaCommentDrafts, setQnaCommentDrafts] = useState({});
  const [qnaLastReadAt, setQnaLastReadAt] = useState("");
  const [authTab, setAuthTab] = useState("login");
  const [authStatus, setAuthStatus] = useState({ tone: "", message: "" });
  const [signupCheck, setSignupCheck] = useState({ tone: "", message: "" });
  const [loginForm, setLoginForm] = useState({ username: "", password: "", otpCode: "" });
  const [pendingOtpEnrollment, setPendingOtpEnrollment] = useState(EMPTY_PENDING_OTP_ENROLLMENT);
  const [signupForm, setSignupForm] = useState({ name: "", email: "", username: "", password: "", confirmPassword: "", courseCode: "", inviteCode: "", signupReason: "", termsAgreementIds: [], marketingEmailConsent: false });
  const [resetPinForm, setResetPinForm] = useState(EMPTY_RESET_PIN_FORM);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminUserForm, setAdminUserForm] = useState(EMPTY_ADMIN_USER_FORM);
  const [adminBatchUserForm, setAdminBatchUserForm] = useState(EMPTY_ADMIN_BATCH_USER_FORM);
  const [adminCourseAssignForm, setAdminCourseAssignForm] = useState({ courseId: "" });
  const [adminCourses, setAdminCourses] = useState([]);
  const [adminLabs, setAdminLabs] = useState([]);
  const [adminLabPrecreateReport, setAdminLabPrecreateReport] = useState(null);
  const [adminCourseCinderSmokeReport, setAdminCourseCinderSmokeReport] = useState(null);
  const [labResizeFlavorDrafts, setLabResizeFlavorDrafts] = useState({});
  const [labResizeReviewNotes, setLabResizeReviewNotes] = useState({});
  const [adminCourseAccessRequests, setAdminCourseAccessRequests] = useState([]);
  const [adminSurveyResponses, setAdminSurveyResponses] = useState([]);
  const [adminSurveySummary, setAdminSurveySummary] = useState([]);
  const [adminTextbooks, setAdminTextbooks] = useState([]);
  const [adminHeatTemplates, setAdminHeatTemplates] = useState([]);
  const [adminApplicationYamls, setAdminApplicationYamls] = useState([]);
  const [applicationYamlUploadState, setApplicationYamlUploadState] = useState({ uploading: false, total: 0, completed: 0 });
  const [landingMediaUploadState, setLandingMediaUploadState] = useState({ uploading: false, fileName: "" });
  const [adminCloudInitTemplates, setAdminCloudInitTemplates] = useState([]);
  const [adminLabDomains, setAdminLabDomains] = useState([]);
  const [adminCustomLabRequests, setAdminCustomLabRequests] = useState([]);
  const [adminLuckyDrawEvents, setAdminLuckyDrawEvents] = useState([]);
  const [adminStatus, setAdminStatus] = useState("");
  const [adminSaveDialog, setAdminSaveDialog] = useState({
    open: false,
    tone: "success",
    title: "",
    message: "",
  });
  const [courseForm, setCourseForm] = useState(EMPTY_COURSE);
  const [courseFormInvalidFields, setCourseFormInvalidFields] = useState([]);
  const [courseSubmissionNotice, setCourseSubmissionNotice] = useState("");
  const [textbookForm, setTextbookForm] = useState(EMPTY_TEXTBOOK);
  const [noticeForm, setNoticeForm] = useState(EMPTY_NOTICE);
  const [luckyDrawEventForm, setLuckyDrawEventForm] = useState(EMPTY_LUCKY_DRAW_EVENT_FORM);
  const [luckyDrawRewardForm, setLuckyDrawRewardForm] = useState(EMPTY_LUCKY_DRAW_REWARD_FORM);
  const [heatTemplateForm, setHeatTemplateForm] = useState(EMPTY_TEMPLATE);
  const [applicationYamlForm, setApplicationYamlForm] = useState(EMPTY_APPLICATION_YAML);
  const [cloudInitTemplateForm, setCloudInitTemplateForm] = useState(EMPTY_CLOUD_INIT_TEMPLATE);
  const [userSearch, setUserSearch] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [selectedLabIds, setSelectedLabIds] = useState([]);
  const [courseAccessReviewNotes, setCourseAccessReviewNotes] = useState({});
  const [labDomainReviewNotes, setLabDomainReviewNotes] = useState({});
  const [labTcpReviewNotes, setLabTcpReviewNotes] = useState({});
  const [terminalRequest, setTerminalRequest] = useState({ tone: "", message: "실행 중인 랩이 있으면 여기에서 바로 연결 상태를 확인할 수 있습니다." });
  const [terminalForm, setTerminalForm] = useState({ username: "", password: "" });
  const [terminalSession, setTerminalSession] = useState(null);
  const [terminalSessionBusy, setTerminalSessionBusy] = useState(false);
  const [terminalNonce, setTerminalNonce] = useState(0);
  const terminalSessionRequestRef = useRef(createLatestRequestCoordinator());
  const [terminalUploadState, setTerminalUploadState] = useState({ uploading: false, fileName: "" });
  const [publicRouteForm, setPublicRouteForm] = useState(EMPTY_PUBLIC_ROUTE);
  const [publicTcpRouteForm, setPublicTcpRouteForm] = useState(EMPTY_PUBLIC_TCP_ROUTE);
  const [publicRouteFormDirty, setPublicRouteFormDirty] = useState(false);
  const [publicTcpRouteFormDirty, setPublicTcpRouteFormDirty] = useState(false);

  function clearClientSessionState(targetRoute = route) {
    setPendingOtpEnrollment(EMPTY_PENDING_OTP_ENROLLMENT);
    setSession(null);
    setCourses([]);
    setLabs([]);
    setCourseQuotes([]);
    setCustomLabRequests([]);
    setQnaPosts([]);
    setMessages([]);
    setMessageRecipients([]);
    setMessageForm(EMPTY_MESSAGE);
    setSelectedCourseId(null);
    setOpenSelectedCourseDetail(false);
    setPreferredSurveyPhase("pre");
    setAdminUsers([]);
    setAdminPasswordResetPins([]);
    setAdminCourses([]);
    setAdminLabs([]);
    setAdminCourseAccessRequests([]);
    setAdminSurveyResponses([]);
    setAdminSurveySummary([]);
    setAdminCourseQuotes([]);
    setAdminCustomLabRequests([]);
    setAdminAccessLogs([]);
    setAdminAccessStats(EMPTY_ACCESS_STATS);
    setAdminArenaOverview(EMPTY_ADMIN_ARENA_OVERVIEW);
    setMyAccessLogs([]);
    setSelectedUserIds([]);
    setUserSearch("");
    setCourseForm(EMPTY_COURSE);
    setTerminalSession(null);
    setTerminalSessionBusy(false);
    terminalSessionRequestRef.current.cancel();
    navigate(targetRoute === "admin" ? "/admin" : "/");
  }

  async function verifyActiveSessionForPolling(cancelled = false, { requireAdminRole = false, targetRoute = route } = {}) {
    const result = await api("/api/auth/session");
    if (cancelled) return null;
    const authenticatedUser = result?.authenticated && result?.user ? result.user : null;
    if (!authenticatedUser) {
      clearClientSessionState(targetRoute);
      return null;
    }
    if (requireAdminRole && !userCanAccessAdminConsole(authenticatedUser)) {
      clearClientSessionState("portal");
      return null;
    }
    handleAccountSharingWarning(result.accountSharingWarning);
    setSession((current) => (current?.id === authenticatedUser.id ? { ...current, ...authenticatedUser } : authenticatedUser));
    return authenticatedUser;
  }

  function getInvalidCourseFields(form) {
    const invalidFields = ["slug", "category", "title", "summary", "duration", "level", "body"].filter((field) => !String(form?.[field] || "").trim());
    if (String(form?.courseType || "standard") === "online") {
      if (!String(form?.onlineMeetingUrl || "").trim()) invalidFields.push("onlineMeetingUrl");
      if (!String(form?.onlineBoardUrl || "").trim()) invalidFields.push("onlineBoardUrl");
      if (!String(form?.onlineSessionNote || "").trim()) invalidFields.push("onlineSessionNote");
    }
    if (String(form?.courseType || "standard") === "package" && !(form?.packageItems || []).length) invalidFields.push("packageItems");
    if (form?.promoEnabled) {
      if (!String(form?.promoStartsAt || "").trim()) invalidFields.push("promoStartsAt");
      if (!String(form?.promoEndsAt || "").trim()) invalidFields.push("promoEndsAt");
      const promoStartTime = Date.parse(form?.promoStartsAt || "");
      const promoEndTime = Date.parse(form?.promoEndsAt || "");
      if (Number.isFinite(promoStartTime) && Number.isFinite(promoEndTime) && promoEndTime <= promoStartTime) invalidFields.push("promoEndsAt");
    }
    if (form?.labEnabled) {
      const backendType = String(form?.labBackendType || "vm");
      if (backendType === "container") {
        if (!String(form?.containerImageName || "").trim()) invalidFields.push("containerImageName");
      } else if (backendType === "vm") {
        if (!String(form?.heatTemplateName || "").trim()) invalidFields.push("heatTemplateName");
        if (!String(form?.heatStackPrefix || "").trim()) invalidFields.push("heatStackPrefix");
      }
    }
    return invalidFields;
  }

  useEffect(() => {
    setCourseFormInvalidFields((current) => current.filter((field) => getInvalidCourseFields(courseForm).includes(field)));
  }, [courseForm]);
  const [domainAvailability, setDomainAvailability] = useState({ tone: "", message: "" });
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE);
  const [materialUploadStatus, setMaterialUploadStatus] = useState({ tone: "", message: "" });
  const [exampleUploadStatus, setExampleUploadStatus] = useState({ tone: "", message: "" });
  const [customLabRequests, setCustomLabRequests] = useState([]);
  const [customLabForm, setCustomLabForm] = useState(EMPTY_CUSTOM_LAB);
  const [customLabReviewDrafts, setCustomLabReviewDrafts] = useState({});
  const [consultingRequests, setConsultingRequests] = useState([]);
  const [consultingForm, setConsultingForm] = useState(EMPTY_CONSULTING_REQUEST);
  const [adminConsultingRequests, setAdminConsultingRequests] = useState([]);
  const [adminPublicQuoteInquiries, setAdminPublicQuoteInquiries] = useState([]);
  const [consultingReviewDrafts, setConsultingReviewDrafts] = useState({});
  const [selfServiceVms, setSelfServiceVms] = useState([]);
  const [selfServiceProjectRequests, setSelfServiceProjectRequests] = useState([]);
  const [selfServiceProjectRequestForm, setSelfServiceProjectRequestForm] = useState(EMPTY_SELF_SERVICE_PROJECT_REQUEST_FORM);
  const [selfServiceProjectReviewBusyIds, setSelfServiceProjectReviewBusyIds] = useState([]);
  const [selfServiceProjectPreflightStatus, setSelfServiceProjectPreflightStatus] = useState(EMPTY_SELF_SERVICE_PROJECT_PREFLIGHT_STATUS);
  const [selfServiceVmForm, setSelfServiceVmForm] = useState(EMPTY_SELF_SERVICE_VM_FORM);
  const [selfServiceVmPreflight, setSelfServiceVmPreflight] = useState(EMPTY_SELF_SERVICE_VM_PREFLIGHT);
  const [cloudConsoleSnapshot, setCloudConsoleSnapshot] = useState(null);
  const [cloudConsoleStatus, setCloudConsoleStatus] = useState({ tone: "", message: "" });
  useEffect(() => {
    if (cloudConsoleStatus.tone !== "success" || !cloudConsoleStatus.message) return undefined;
    const timer = window.setTimeout(() => {
      setCloudConsoleStatus((current) => current.tone === "success" && current.message === cloudConsoleStatus.message
        ? { tone: "", message: "" }
        : current);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [cloudConsoleStatus.tone, cloudConsoleStatus.message]);
  const [cloudConsoleActions, setCloudConsoleActions] = useState([]);
  const [zunContainers, setZunContainers] = useState([]);
  const [zunForm, setZunForm] = useState(EMPTY_ZUN_FORM);
  const [zunStatus, setZunStatus] = useState({ tone: "", message: "" });
  const [magnumClusters, setMagnumClusters] = useState([]);
  const [magnumTemplates, setMagnumTemplates] = useState([]);
  const [magnumForm, setMagnumForm] = useState(EMPTY_MAGNUM_FORM);
  const [magnumStatus, setMagnumStatus] = useState({ tone: "", message: "" });
  const [troveInstances, setTroveInstances] = useState([]);
  const [troveDatastores, setTroveDatastores] = useState([]);
  const [troveForm, setTroveForm] = useState(EMPTY_TROVE_FORM);
  const [troveStatus, setTroveStatus] = useState({ tone: "", message: "" });
  const [troveCredentials, setTroveCredentials] = useState({});
  const [writtenExams, setWrittenExams] = useState([]);
  const [writtenExamForm, setWrittenExamForm] = useState(EMPTY_WRITTEN_EXAM_FORM);
  const [writtenExamAnswers, setWrittenExamAnswers] = useState({});
  const [writtenExamStatus, setWrittenExamStatus] = useState({ tone: "", message: "" });
  const [labExams, setLabExams] = useState([]);
  const [labExamSessions, setLabExamSessions] = useState([]);
  const [adminLabExamAttempts, setAdminLabExamAttempts] = useState([]);
  const [adminLabExamSessions, setAdminLabExamSessions] = useState([]);
  const [labExamForm, setLabExamForm] = useState(EMPTY_LAB_EXAM_FORM);
  const [labExamSshPassword, setLabExamSshPassword] = useState("");
  const [labExamStatus, setLabExamStatus] = useState({ tone: "", message: "" });
  const [labExamTestStatus, setLabExamTestStatus] = useState({ tone: "", message: "", result: null });
  const [payments, setPayments] = useState([]);
  const [courseQuotes, setCourseQuotes] = useState([]);
  const [courseQuoteStatus, setCourseQuoteStatus] = useState({ tone: "", message: "" });
  const [adminCoupons, setAdminCoupons] = useState([]);
  const [adminCouponForm, setAdminCouponForm] = useState(EMPTY_ADMIN_COUPON_FORM);
  const [certificates, setCertificates] = useState([]);
  const [certificateLeaderboard, setCertificateLeaderboard] = useState([]);
  const [eligibleCertificates, setEligibleCertificates] = useState([]);
  const [certificateStatus, setCertificateStatus] = useState(EMPTY_CERTIFICATE_STATUS);
  const [myCertificateTier, setMyCertificateTier] = useState(EMPTY_CERTIFICATE_TIER);
  const [adminPayments, setAdminPayments] = useState([]);
  const [adminCourseQuotes, setAdminCourseQuotes] = useState([]);
  const [adminCertificates, setAdminCertificates] = useState([]);
  const [adminMailLogs, setAdminMailLogs] = useState([]);
  const [adminMessages, setAdminMessages] = useState([]);
  const [adminAccessLogs, setAdminAccessLogs] = useState([]);
  const [adminAuditLogs, setAdminAuditLogs] = useState([]);
  const [adminB2bReport, setAdminB2bReport] = useState(null);
  const [adminAccessStats, setAdminAccessStats] = useState(EMPTY_ACCESS_STATS);
  const [adminMailLogsStatus, setAdminMailLogsStatus] = useState({ tone: "", message: "" });
  const [adminAccessLogsStatus, setAdminAccessLogsStatus] = useState({ tone: "", message: "" });
  const [adminInvites, setAdminInvites] = useState([]);
  const [inviteForm, setInviteForm] = useState({ code: "", label: "", recipientEmail: "", maxUses: "1", expiresAt: "", courseId: "" });
  const [mailTestAddress, setMailTestAddress] = useState("");
  const [adminMailForm, setAdminMailForm] = useState(EMPTY_ADMIN_MAIL_FORM);
  const [marketingMailForm, setMarketingMailForm] = useState(EMPTY_MARKETING_MAIL_FORM);
  const [mailCampaignForm, setMailCampaignForm] = useState(EMPTY_MAIL_CAMPAIGN_FORM);
  const [mailCampaignPreview, setMailCampaignPreview] = useState(null);
  const [adminMailCampaigns, setAdminMailCampaigns] = useState([]);
  const [selectedMailCampaign, setSelectedMailCampaign] = useState(null);
  const [mailCampaignStatus, setMailCampaignStatus] = useState({ tone: "", message: "" });
  const [issuedResetPinInfo, setIssuedResetPinInfo] = useState(null);
  const [adminPasswordResetPins, setAdminPasswordResetPins] = useState([]);
  const [adminLogs, setAdminLogs] = useState([]);
  const [apiMonitor, setApiMonitor] = useState(EMPTY_API_MONITOR);
  const [adminInstanceMonitor, setAdminInstanceMonitor] = useState({ ok: false, items: [], totals: {} });
  const [trafficDebugCapture, setTrafficDebugCapture] = useState(null);
  const [trafficDebugStatus, setTrafficDebugStatus] = useState(EMPTY_TRAFFIC_DEBUG_STATUS);
  const [adminArenaOverview, setAdminArenaOverview] = useState(EMPTY_ADMIN_ARENA_OVERVIEW);
  const [myAccessLogs, setMyAccessLogs] = useState([]);
  const [quotaStatus, setQuotaStatus] = useState(EMPTY_QUOTA_STATUS);
  const [llmQuotaStatus, setLlmQuotaStatus] = useState(EMPTY_LLM_QUOTA_STATUS);
  const [serviceValidationStatus, setServiceValidationStatus] = useState(EMPTY_SERVICE_VALIDATION_STATUS);
  const [labSshReviewNotes, setLabSshReviewNotes] = useState({});
  const [llmQuestion, setLlmQuestion] = useState("");
  const [llmMessages, setLlmMessages] = useState([]);
  const [llmStreaming, setLlmStreaming] = useState(false);
  const [llmStatus, setLlmStatus] = useState({ tone: "", message: "" });
  const [toasts, setToasts] = useState([]);
  const adminSnapshotRef = useRef("");
  const adminLoadInFlightRef = useRef(null);
  const adminAutoRefreshInFlightRef = useRef(false);
  const userSnapshotRef = useRef("");
  const lastActiveLabIdRef = useRef(null);
  const adminStatusTimerRef = useRef(null);
  const serviceValidationFeedbackTimerRef = useRef(null);
  const cloudConsoleWarningTimerRef = useRef(null);
  const cloudConsoleWarningSignatureRef = useRef("");

  useEffect(() => () => {
    if (adminStatusTimerRef.current && typeof window !== "undefined") {
      window.clearTimeout(adminStatusTimerRef.current);
      adminStatusTimerRef.current = null;
    }
    if (serviceValidationFeedbackTimerRef.current && typeof window !== "undefined") {
      window.clearTimeout(serviceValidationFeedbackTimerRef.current);
      serviceValidationFeedbackTimerRef.current = null;
    }
    if (cloudConsoleWarningTimerRef.current && typeof window !== "undefined") {
      window.clearTimeout(cloudConsoleWarningTimerRef.current);
      cloudConsoleWarningTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (adminStatusTimerRef.current && typeof window !== "undefined") {
      window.clearTimeout(adminStatusTimerRef.current);
      adminStatusTimerRef.current = null;
    }
    if (!adminStatus || typeof window === "undefined") {
      return undefined;
    }
    adminStatusTimerRef.current = window.setTimeout(() => {
      setAdminStatus((current) => (current === adminStatus ? "" : current));
      adminStatusTimerRef.current = null;
    }, 8000);
    return () => {
      if (adminStatusTimerRef.current) {
        window.clearTimeout(adminStatusTimerRef.current);
        adminStatusTimerRef.current = null;
      }
    };
  }, [adminStatus]);

  function updatePublicRouteForm(updater) {
    setPublicRouteFormDirty(true);
    setPublicRouteForm(updater);
  }

  function updatePublicTcpRouteForm(updater) {
    setPublicTcpRouteFormDirty(true);
    setPublicTcpRouteForm(updater);
  }

  function setPlatformStatus(updater) {
    platformStatusDirtyRef.current = true;
    setPlatformStatusDirty(true);
    setPlatformStatusState(updater);
  }

  useEffect(() => {
    platformStatusRef.current = platformStatus;
  }, [platformStatus]);

  function openAdminSaveDialog(message, tone = "success", title = "") {
    const normalizedTone = tone === "error" ? "error" : tone === "info" ? "info" : "success";
    const normalizedMessage = String(message || "").trim();
    if (!normalizedMessage) return;
    const normalizedTitle = title || (normalizedTone === "error" ? "저장하지 못했습니다" : "저장되었습니다");
    setAdminSaveDialog({
      open: true,
      tone: normalizedTone,
      title: normalizedTitle,
      message: normalizedMessage,
    });
  }

  function closeAdminSaveDialog() {
    setAdminSaveDialog((current) => ({ ...current, open: false }));
  }

  function replacePlatformStatus(nextStatus, { markDirty = false } = {}) {
    platformStatusDirtyRef.current = markDirty;
    setPlatformStatusDirty(markDirty);
    setPlatformStatusState(nextStatus);
  }

  function setServiceValidationFeedback(tone, message) {
    if (serviceValidationFeedbackTimerRef.current && typeof window !== "undefined") {
      window.clearTimeout(serviceValidationFeedbackTimerRef.current);
      serviceValidationFeedbackTimerRef.current = null;
    }
    setServiceValidationStatus((current) => ({
      ...current,
      tone: tone || "",
      message: message || "",
    }));
    if (message && typeof window !== "undefined") {
      serviceValidationFeedbackTimerRef.current = window.setTimeout(() => {
        setServiceValidationStatus((current) => ({
          ...current,
          tone: "",
          message: "",
        }));
        serviceValidationFeedbackTimerRef.current = null;
      }, 8000);
    }
  }

  function safeAdminApi(path, fallback, fallbackMessage, user = session) {
    if (user && path.startsWith('/api/admin/') && !hasAdminPermission(user, requiredAdminPermission('GET', path))) return Promise.resolve(fallback);
    return api(path).catch((error) => ({
      ...fallback,
      __error: error?.message || fallbackMessage,
    }));
  }

  function normalizeMailTemplateConfig(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        const normalizedKey = String(key || "").trim();
        if (!normalizedKey || !item || typeof item !== "object" || Array.isArray(item)) return [];
        const subject = String(item.subject || "").trim();
        const text = String(item.text || "").trim();
        if (!subject && !text) return [];
        return [[normalizedKey, { subject, text }]];
      }),
    );
  }

  async function runSafeRefreshTasks(tasks = []) {
    const results = await Promise.allSettled(tasks);
    return results;
  }

  async function runTaskFactoriesWithConcurrency(taskFactories = [], concurrency = 5) {
    const tasks = taskFactories.filter((task) => typeof task === "function");
    if (!tasks.length) return [];
    const results = new Array(tasks.length);
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(tasks.length, Number(concurrency || 1) || 1));
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < tasks.length) {
        const taskIndex = nextIndex;
        nextIndex += 1;
        results[taskIndex] = await tasks[taskIndex]();
      }
    });
    await Promise.all(workers);
    return results;
  }

  function normalizeAutoRefreshIntervalSeconds(value, fallback = 60) {
    return Math.max(10, Math.min(3600, Number(value || fallback) || fallback));
  }

  function buildPlatformStatusPayload(status = platformStatus) {
    const surveyFeedbackOptions = normalizeLlmSurveyFeedbackOptionsJsonText(status.llmSurveyFeedbackOptionsJson);
    const portalUiMode = normalizePortalUiMode(
      status.portalUiMode,
      status.userPortalV2Enabled ? "switchable" : "legacy",
    );
    return {
      labCircuitBreaker: status.labCircuitBreaker,
      labCircuitBreakerMessage: status.labCircuitBreakerMessage || "더 이상 랩 생성이 불가합니다.",
      labAutoCircuitBreakerEnabled: status.labAutoCircuitBreakerEnabled !== false,
      labAutoCircuitBreakerThresholdPercent: Math.max(50, Math.min(100, Number(status.labAutoCircuitBreakerThresholdPercent || 80) || 80)),
      siteUpdateInProgress: Boolean(status.siteUpdateInProgress),
      siteUpdateMessage: String(status.siteUpdateMessage || "").trim() || EMPTY_PLATFORM_STATUS.siteUpdateMessage,
      labStartDebugEnabled: Boolean(status.labStartDebugEnabled),
      maxConcurrentLabs: Math.min(5, Math.max(1, Number(status.maxConcurrentLabs || 1) || 1)),
      terminalSessionIdleMinutes: Math.max(1, Number(status.terminalSessionIdleMinutes || status.terminalSessionTtlMinutes || 10) || 10),
      terminalReplayEnabled: status.terminalReplayEnabled !== false,
      unusedVmAutoPauseEnabled: status.unusedVmAutoPauseEnabled !== false,
      unusedVmAutoPauseMinutes: Math.max(1440, Number(status.unusedVmAutoPauseMinutes || 1440) || 1440),
      unusedVmRetentionMinutes: Math.max(1440, Number(status.unusedVmRetentionMinutes || 10080) || 10080),
      llmProvider: status.llmProvider === "ollama-native" ? "ollama-native" : "custom",
      llmApiUrl: status.llmApiUrl || "",
      llmModel: status.llmModel || "",
      ...(String(status.llmApiKey || "").trim() ? { llmApiKey: status.llmApiKey } : {}),
      ...(status.llmApiKeyClearRequested ? { llmApiKeyClearRequested: true } : {}),
      llmSystemPrompt: status.llmSystemPrompt || "",
      llmEnabled: status.llmEnabled !== false,
        llmDailyQuotaEnabled: status.llmDailyQuotaEnabled !== false,
        llmDailyQuotaLimit: Math.max(1, Number(status.llmDailyQuotaLimit || 10) || 10),
        llmDailyQuotaAdminBypass: status.llmDailyQuotaAdminBypass !== false,
        llmMaxTokens: Math.max(1, Number(status.llmMaxTokens || 512) || 512),
        llmAdminTestMaxTokens: Math.max(1, Number(status.llmAdminTestMaxTokens || 80) || 80),
        llmSurveyFeedbackMaxTokens: Math.max(64, Number(status.llmSurveyFeedbackMaxTokens || 384) || 384),
        llmSurveyFeedbackTimeoutMs: Math.max(30000, Number(status.llmSurveyFeedbackTimeoutMs || 300000) || 300000),
        llmSurveyFeedbackPrompt: status.llmSurveyFeedbackPrompt || DEFAULT_LLM_SURVEY_FEEDBACK_PROMPT,
        llmSurveyFeedbackOptionsJson: surveyFeedbackOptions.value,
        llmThinkingMode: ["enabled", "default"].includes(status.llmThinkingMode) ? status.llmThinkingMode : "disabled",
        llmNoThinkDirectiveEnabled: status.llmNoThinkDirectiveEnabled !== false,
        llmWebSearchEnabled: status.llmWebSearchEnabled !== false,
        llmWebSearchTimeoutMs: Math.max(1000, Number(status.llmWebSearchTimeoutMs || 8000) || 8000),
        llmWebSearchResultLimit: Math.min(10, Math.max(1, Number(status.llmWebSearchResultLimit || 5) || 5)),
        ...(String(status.googleSearchApiKey || "").trim() ? { googleSearchApiKey: status.googleSearchApiKey } : {}),
        ...(status.googleSearchApiKeyClearRequested ? { googleSearchApiKeyClearRequested: true } : {}),
        googleSearchApiKeyConfigured: Boolean(status.googleSearchApiKeyConfigured),
        googleSearchApiKeySource: status.googleSearchApiKeySource || "",
        googleSearchCx: status.googleSearchCx || "",
      accountSharingProtectionEnabled: Boolean(status.accountSharingProtectionEnabled),
      termsEnabled: status.termsEnabled !== false,
      userPortalV2Enabled: portalUiMode !== "legacy",
      portalUiMode,
      portalV2TransitionNoticeEnabled: status.portalV2TransitionNoticeEnabled !== false,
      portalV2TransitionNoticeMessage: String(status.portalV2TransitionNoticeMessage || "").trim(),
      inviteOnlyMode: status.inviteOnlyMode,
      signupAutoApproveEnabled: Boolean(status.signupAutoApproveEnabled),
      signupWelcomeCouponEnabled: status.signupWelcomeCouponEnabled !== false,
      siteUpdateInProgress: Boolean(status.siteUpdateInProgress),
      siteUpdateMessage: String(status.siteUpdateMessage || "").trim() || EMPTY_PLATFORM_STATUS.siteUpdateMessage,
      siteVersionNumber: status.siteVersionNumber || EMPTY_PLATFORM_STATUS.siteVersionNumber,
      siteVersionStage: status.siteVersionStage,
      siteVersionCodename: status.siteVersionCodename,
      cicdExecutionMode: status.cicdExecutionMode === "jenkins" ? "jenkins" : "simulated",
      jenkinsBaseUrl: status.jenkinsBaseUrl || "",
      jenkinsUsername: status.jenkinsUsername || "",
      ...(String(status.jenkinsApiToken || "").trim() ? { jenkinsApiToken: status.jenkinsApiToken } : {}),
      ...(status.jenkinsApiTokenClearRequested ? { jenkinsApiTokenClearRequested: true } : {}),
      jenkinsDefaultFolder: status.jenkinsDefaultFolder || EMPTY_PLATFORM_STATUS.jenkinsDefaultFolder,
      jenkinsJobPrefix: status.jenkinsJobPrefix || EMPTY_PLATFORM_STATUS.jenkinsJobPrefix,
      jenkinsAutoCreateJobs: status.jenkinsAutoCreateJobs !== false,
      serviceProjectName: status.serviceProjectName || "",
      serviceCloudsYaml: status.serviceCloudsYaml || "",
      serviceCloudName: status.serviceCloudName || "",
      serviceAuthUrl: status.serviceAuthUrl || "",
      serviceHeatApiUrl: status.serviceHeatApiUrl || "",
      serviceComputeApiUrl: status.serviceComputeApiUrl || "",
      serviceNetworkApiUrl: status.serviceNetworkApiUrl || "",
      serviceMetricApiUrl: status.serviceMetricApiUrl || "",
      openstackStatusProbesEnabled: status.openstackStatusProbesEnabled !== false,
      openstackStatusCacheTtlMinutes: Math.max(1, Math.min(1440, Number(status.openstackStatusCacheTtlMinutes || 10) || 10)),
      adminAutoRefreshIntervalSeconds: normalizeAutoRefreshIntervalSeconds(status.adminAutoRefreshIntervalSeconds, 60),
      userAutoRefreshIntervalSeconds: normalizeAutoRefreshIntervalSeconds(status.userAutoRefreshIntervalSeconds, 60),
      pocProjectName: normalizePocProjectName(status.pocProjectName),
      pocCloudsYaml: status.pocCloudsYaml || "",
      pocCloudName: status.pocCloudName || "",
      pocAuthUrl: status.pocAuthUrl || "",
      pocHeatApiUrl: status.pocHeatApiUrl || "",
      pocMetricApiUrl: status.pocMetricApiUrl || "",
      pocDefaultHeatTemplateName: status.pocDefaultHeatTemplateName || EMPTY_PLATFORM_STATUS.pocDefaultHeatTemplateName,
      zunProjectName: status.zunProjectName || "",
      magnumProjectName: status.magnumProjectName || "",
      magnumClusterProfilesJson: String(
        status.magnumClusterProfilesJson
          ?? JSON.stringify(Array.isArray(status.magnumClusterProfiles) ? status.magnumClusterProfiles : [], null, 2),
      ),
      magnumAutoApproveEnabled: Boolean(status.magnumAutoApproveEnabled),
      magnumAutoApproveProfileIds: Array.isArray(status.magnumAutoApproveProfileIds) ? status.magnumAutoApproveProfileIds : [],
      magnumAutoApproveMaxMasterCount: Number(status.magnumAutoApproveMaxMasterCount || 1),
      magnumAutoApproveMaxNodeCount: Number(status.magnumAutoApproveMaxNodeCount || 3),
      magnumAutoApproveMaxClustersPerUser: Number(status.magnumAutoApproveMaxClustersPerUser || 1),
      magnumAutoApproveRequireQuota: status.magnumAutoApproveRequireQuota !== false,
      troveProjectName: status.troveProjectName || "",
      selfServiceVmAllowedFlavors: status.selfServiceVmAllowedFlavors,
      aiVmFlavorCatalog: Array.isArray(status.aiVmFlavorCatalog) ? status.aiVmFlavorCatalog : [],
      selfServiceVmAllowedImages: Array.isArray(status.selfServiceVmAllowedImages) && status.selfServiceVmAllowedImages.length
        ? status.selfServiceVmAllowedImages
        : EMPTY_PLATFORM_STATUS.selfServiceVmAllowedImages,
      selfServiceVmAllowedProjects: Array.isArray(status.selfServiceVmAllowedProjects) && status.selfServiceVmAllowedProjects.length
        ? status.selfServiceVmAllowedProjects
        : [status.serviceProjectName || EMPTY_PLATFORM_STATUS.serviceProjectName],
      selfServiceVmAutoProvisionEnabled: status.selfServiceVmAutoProvisionEnabled !== false,
      selfServiceVmProjectAutoConfigureEnabled: Boolean(status.selfServiceVmProjectAutoConfigureEnabled),
      selfServiceVmProjectAutoApproveEnabled: Boolean(status.selfServiceVmProjectAutoApproveEnabled),
      selfServiceVmProjectAutoNetworkEnabled: Boolean(status.selfServiceVmProjectAutoNetworkEnabled),
      selfServiceVmProjectRoleNames: Array.isArray(status.selfServiceVmProjectRoleNames) && status.selfServiceVmProjectRoleNames.length ? status.selfServiceVmProjectRoleNames : EMPTY_PLATFORM_STATUS.selfServiceVmProjectRoleNames,
      selfServiceVmProjectExternalNetworkName: status.selfServiceVmProjectExternalNetworkName || EMPTY_PLATFORM_STATUS.selfServiceVmProjectExternalNetworkName,
      selfServiceVmProjectQuota: status.selfServiceVmProjectQuota && typeof status.selfServiceVmProjectQuota === "object" ? status.selfServiceVmProjectQuota : EMPTY_PLATFORM_STATUS.selfServiceVmProjectQuota,
      arenaEnabled: Boolean(status.arenaEnabled),
      selfServiceVmServiceEnabled: Boolean(status.selfServiceVmServiceEnabled),
      selfServiceVmVolumeBootEnabled: Boolean(status.selfServiceVmVolumeBootEnabled),
      selfServiceVmDataVolumeEnabled: Boolean(status.selfServiceVmDataVolumeEnabled),
      selfServiceVmMaxDataVolumeCount: Math.max(1, Number(status.selfServiceVmMaxDataVolumeCount || EMPTY_PLATFORM_STATUS.selfServiceVmMaxDataVolumeCount) || EMPTY_PLATFORM_STATUS.selfServiceVmMaxDataVolumeCount),
      selfServiceVmMaxDataVolumeSizeGb: Math.max(1, Number(status.selfServiceVmMaxDataVolumeSizeGb || EMPTY_PLATFORM_STATUS.selfServiceVmMaxDataVolumeSizeGb) || EMPTY_PLATFORM_STATUS.selfServiceVmMaxDataVolumeSizeGb),
      selfServiceVmFloatingIpEnabled: Boolean(status.selfServiceVmFloatingIpEnabled),
      labAutoBootFromVolumeOnDiskPressureEnabled: status.labAutoBootFromVolumeOnDiskPressureEnabled !== false,
      labAutoBootFromVolumeDiskThresholdPercent: Math.max(1, Math.min(99, Number(status.labAutoBootFromVolumeDiskThresholdPercent || EMPTY_PLATFORM_STATUS.labAutoBootFromVolumeDiskThresholdPercent) || EMPTY_PLATFORM_STATUS.labAutoBootFromVolumeDiskThresholdPercent)),
      labAutoBootVolumeSizeGb: Math.max(1, Math.min(2048, Number(status.labAutoBootVolumeSizeGb || EMPTY_PLATFORM_STATUS.labAutoBootVolumeSizeGb) || EMPTY_PLATFORM_STATUS.labAutoBootVolumeSizeGb)),
      labAutoBootVolumeType: String(status.labAutoBootVolumeType || "").trim(),
      zunAllowedImages: Array.isArray(status.zunAllowedImages)
        ? status.zunAllowedImages
        : EMPTY_PLATFORM_STATUS.zunAllowedImages,
      pocEnabled: Boolean(status.pocEnabled),
      pocFreeModeEnabled: Boolean(status.pocFreeModeEnabled),
      pocAllowedImages: Array.isArray(status.pocAllowedImages) && status.pocAllowedImages.length ? status.pocAllowedImages : EMPTY_PLATFORM_STATUS.pocAllowedImages,
      pocAllowedFlavors: Array.isArray(status.pocAllowedFlavors) && status.pocAllowedFlavors.length ? status.pocAllowedFlavors : EMPTY_PLATFORM_STATUS.pocAllowedFlavors,
      pocFlavorDailyPrices: status.pocFlavorDailyPrices && typeof status.pocFlavorDailyPrices === "object" ? status.pocFlavorDailyPrices : EMPTY_PLATFORM_STATUS.pocFlavorDailyPrices,
      pocAdvancedDailyPrices: status.pocAdvancedDailyPrices && typeof status.pocAdvancedDailyPrices === "object"
        ? { ...EMPTY_PLATFORM_STATUS.pocAdvancedDailyPrices, ...status.pocAdvancedDailyPrices }
        : EMPTY_PLATFORM_STATUS.pocAdvancedDailyPrices,
      pocFlavorSpecs: status.pocFlavorSpecs && typeof status.pocFlavorSpecs === "object" ? status.pocFlavorSpecs : EMPTY_PLATFORM_STATUS.pocFlavorSpecs,
      courseLevelOptions: status.courseLevelOptions,
      courseCategoryOptions: Array.isArray(status.courseCategoryOptions) && status.courseCategoryOptions.length ? status.courseCategoryOptions : EMPTY_PLATFORM_STATUS.courseCategoryOptions,
      courseProgramTypeOptions: normalizeCourseProgramTypeOptions(status.courseProgramTypeOptions),
      standardCourseOverviewDescription: String(status.standardCourseOverviewDescription || "").trim() || EMPTY_PLATFORM_STATUS.standardCourseOverviewDescription,
      standardCourseOverviewPoints: normalizeCourseOverviewPoints(status.standardCourseOverviewPoints, EMPTY_PLATFORM_STATUS.standardCourseOverviewPoints),
      iltCourseOverviewDescription: String(status.iltCourseOverviewDescription || "").trim() || EMPTY_PLATFORM_STATUS.iltCourseOverviewDescription,
      iltCourseOverviewPoints: normalizeCourseOverviewPoints(status.iltCourseOverviewPoints, EMPTY_PLATFORM_STATUS.iltCourseOverviewPoints),
      onlineCourseOverviewDescription: String(status.onlineCourseOverviewDescription || "").trim() || EMPTY_PLATFORM_STATUS.onlineCourseOverviewDescription,
      onlineCourseOverviewPoints: normalizeCourseOverviewPoints(status.onlineCourseOverviewPoints, EMPTY_PLATFORM_STATUS.onlineCourseOverviewPoints),
      governmentCourseOverviewDescription: String(status.governmentCourseOverviewDescription || "").trim() || EMPTY_PLATFORM_STATUS.governmentCourseOverviewDescription,
      governmentCourseOverviewPoints: normalizeCourseOverviewPoints(status.governmentCourseOverviewPoints, EMPTY_PLATFORM_STATUS.governmentCourseOverviewPoints),
      customRouteSlots: status.customRouteSlots,
      customDomainGuidanceIntro: status.customDomainGuidanceIntro || EMPTY_PLATFORM_STATUS.customDomainGuidanceIntro,
      customDomainGuidanceCnameLabel: status.customDomainGuidanceCnameLabel || EMPTY_PLATFORM_STATUS.customDomainGuidanceCnameLabel,
      customDomainGuidanceCnameText: status.customDomainGuidanceCnameText || EMPTY_PLATFORM_STATUS.customDomainGuidanceCnameText,
      customDomainGuidanceOwnershipLabel: status.customDomainGuidanceOwnershipLabel || EMPTY_PLATFORM_STATUS.customDomainGuidanceOwnershipLabel,
      customDomainGuidanceOwnershipText: status.customDomainGuidanceOwnershipText || EMPTY_PLATFORM_STATUS.customDomainGuidanceOwnershipText,
      customDomainGuidanceRecommendationLabel: status.customDomainGuidanceRecommendationLabel || EMPTY_PLATFORM_STATUS.customDomainGuidanceRecommendationLabel,
      customDomainGuidanceRecommendationText: status.customDomainGuidanceRecommendationText || EMPTY_PLATFORM_STATUS.customDomainGuidanceRecommendationText,
      customDomainGuidanceVerificationLabel: status.customDomainGuidanceVerificationLabel || EMPTY_PLATFORM_STATUS.customDomainGuidanceVerificationLabel,
      customDomainGuidanceVerificationText: status.customDomainGuidanceVerificationText || EMPTY_PLATFORM_STATUS.customDomainGuidanceVerificationText,
      zunApiUrl: status.zunApiUrl || "",
      zunEnabled: status.zunEnabled,
      magnumApiUrl: status.magnumApiUrl || "",
      magnumEnabled: Boolean(status.magnumEnabled),
      aiGpuEnabled: Boolean(status.aiGpuEnabled),
      troveApiUrl: status.troveApiUrl || "",
      troveEnabled: Boolean(status.troveEnabled),
      troveAllowedDatastores: Array.isArray(status.troveAllowedDatastores) && status.troveAllowedDatastores.length ? status.troveAllowedDatastores : EMPTY_PLATFORM_STATUS.troveAllowedDatastores,
      troveAllowedFlavors: Array.isArray(status.troveAllowedFlavors) && status.troveAllowedFlavors.length ? status.troveAllowedFlavors : EMPTY_PLATFORM_STATUS.troveAllowedFlavors,
      troveAllowedSizesGb: Array.isArray(status.troveAllowedSizesGb) && status.troveAllowedSizesGb.length ? status.troveAllowedSizesGb : EMPTY_PLATFORM_STATUS.troveAllowedSizesGb,
      landingVideoEnabled: status.landingVideoEnabled !== false,
      landingScheduleEnabled: status.landingScheduleEnabled !== false,
      googleCalendarSyncEnabled: Boolean(status.googleCalendarSyncEnabled),
      googleCalendarIcsUrl: String(status.googleCalendarIcsUrl || "").trim(),
      googleCalendarSyncIntervalMinutes: Math.max(15, Number(status.googleCalendarSyncIntervalMinutes || 60) || 60),
      landingNoticeEnabled: status.landingNoticeEnabled === true,
      landingSurveyNoticeEnabled: status.landingSurveyNoticeEnabled === true,
      landingCurriculumCollapsedByDefault: status.landingCurriculumCollapsedByDefault !== false,
      landingDemoType: status.landingDemoType || DEFAULT_LANDING_DEMO_TYPE,
      landingYoutubeUrl: status.landingYoutubeUrl || DEFAULT_LANDING_YOUTUBE_URL,
      landingHeroEyebrow: status.landingHeroEyebrow || EMPTY_PLATFORM_STATUS.landingHeroEyebrow,
      landingHeroTitle: status.landingHeroTitle || EMPTY_PLATFORM_STATUS.landingHeroTitle,
      landingHeroCopy: status.landingHeroCopy || EMPTY_PLATFORM_STATUS.landingHeroCopy,
      landingAuthEyebrow: status.landingAuthEyebrow || EMPTY_PLATFORM_STATUS.landingAuthEyebrow,
      landingAuthTitle: status.landingAuthTitle || EMPTY_PLATFORM_STATUS.landingAuthTitle,
      landingAuthCopy: status.landingAuthCopy || EMPTY_PLATFORM_STATUS.landingAuthCopy,
      landingFreeTitle: status.landingFreeTitle || EMPTY_PLATFORM_STATUS.landingFreeTitle,
      landingFreeSubtitle: status.landingFreeSubtitle || EMPTY_PLATFORM_STATUS.landingFreeSubtitle,
      landingCustomerLogosEnabled: status.landingCustomerLogosEnabled !== false,
      landingCustomerLogosTitle: status.landingCustomerLogosTitle || EMPTY_PLATFORM_STATUS.landingCustomerLogosTitle,
      landingCustomerLogos: Array.isArray(status.landingCustomerLogos) ? status.landingCustomerLogos : EMPTY_PLATFORM_STATUS.landingCustomerLogos,
      standardCourseOverviewDescription: status.standardCourseOverviewDescription || EMPTY_PLATFORM_STATUS.standardCourseOverviewDescription,
      standardCourseOverviewPoints: normalizeCourseOverviewPoints(status.standardCourseOverviewPoints, EMPTY_PLATFORM_STATUS.standardCourseOverviewPoints),
      iltCourseOverviewDescription: status.iltCourseOverviewDescription || EMPTY_PLATFORM_STATUS.iltCourseOverviewDescription,
      iltCourseOverviewPoints: normalizeCourseOverviewPoints(status.iltCourseOverviewPoints, EMPTY_PLATFORM_STATUS.iltCourseOverviewPoints),
      onlineCourseOverviewDescription: status.onlineCourseOverviewDescription || EMPTY_PLATFORM_STATUS.onlineCourseOverviewDescription,
      onlineCourseOverviewPoints: normalizeCourseOverviewPoints(status.onlineCourseOverviewPoints, EMPTY_PLATFORM_STATUS.onlineCourseOverviewPoints),
      governmentCourseOverviewDescription: status.governmentCourseOverviewDescription || EMPTY_PLATFORM_STATUS.governmentCourseOverviewDescription,
      governmentCourseOverviewPoints: normalizeCourseOverviewPoints(status.governmentCourseOverviewPoints, EMPTY_PLATFORM_STATUS.governmentCourseOverviewPoints),
      landingVideoPath: status.landingVideoPath || "",
      landingVideoMime: status.landingVideoMime || "",
      landingLogoMode: status.landingLogoMode === "upload" ? "upload" : "code",
      landingLogoPath: status.landingLogoPath || "",
      landingLogoMime: status.landingLogoMime || "",
      faviconMode: status.faviconMode === "upload" ? "upload" : "code",
      faviconPath: status.faviconPath || "",
      faviconMime: status.faviconMime || "",
      materialsUploadMaxMb: Math.max(1, Number(status.materialsUploadMaxMb || 80) || 80),
      publicDomainRoutesEnabled: status.publicDomainRoutesEnabled !== false,
      externalSshRoutesEnabled: status.externalSshRoutesEnabled !== false,
      externalRdpRoutesEnabled: status.externalRdpRoutesEnabled !== false,
      publicTcpRoutesEnabled: Boolean(status.publicTcpRoutesEnabled),
      courseQuoteAccessMode: normalizeCourseQuoteAccessMode(status.courseQuoteAccessMode),
      sshPublicHost: normalizeSshPublicHost(status.sshPublicHost, "ssh.example.com"),
      sshExternalPortStart: Math.max(1, Number(status.sshExternalPortStart || 41000) || 41000),
      sshExternalPortEnd: Math.max(1, Number(status.sshExternalPortEnd || 42999) || 42999),
      rdpExternalPortStart: Math.max(1, Number(status.rdpExternalPortStart || 43000) || 43000),
      rdpExternalPortEnd: Math.max(1, Number(status.rdpExternalPortEnd || 43099) || 43099),
      tcpExternalPortStart: Math.max(1, Number(status.tcpExternalPortStart || 45000) || 45000),
      tcpExternalPortEnd: Math.max(1, Number(status.tcpExternalPortEnd || 45999) || 45999),
      paymentGatewayEnabled: Boolean(status.paymentGatewayEnabled),
      paymentGatewayProvider: normalizePaymentGatewayProvider(status.paymentGatewayProvider || "manual"),
      paymentGatewayMerchantId: status.paymentGatewayMerchantId || "",
      paymentGatewayApiBaseUrl: status.paymentGatewayApiBaseUrl || "",
      paymentGatewayPublicKey: status.paymentGatewayPublicKey || "",
      paymentGatewaySecretKey: status.paymentGatewaySecretKey || "",
      paymentGatewayWebhookSecret: status.paymentGatewayWebhookSecret || "",
      oauthGoogleEnabled: Boolean(status.oauthGoogleEnabled),
      oauthGoogleClientId: status.oauthGoogleClientId || "",
      oauthGoogleClientSecret: status.oauthGoogleClientSecret || "",
      oauthGoogleRedirectUri: status.oauthGoogleRedirectUri || "",
      oauthKakaoEnabled: Boolean(status.oauthKakaoEnabled),
      oauthKakaoClientId: status.oauthKakaoClientId || "",
      oauthKakaoClientSecret: status.oauthKakaoClientSecret || "",
      oauthKakaoRedirectUri: status.oauthKakaoRedirectUri || "",
      oauthNaverEnabled: Boolean(status.oauthNaverEnabled),
      oauthNaverClientId: status.oauthNaverClientId || "",
      oauthNaverClientSecret: status.oauthNaverClientSecret || "",
      oauthNaverRedirectUri: status.oauthNaverRedirectUri || "",
      oauthRedirectUri: status.oauthRedirectUri || "",
      mailEnabled: Boolean(status.mailEnabled),
      preSurveyAdminMailEnabled: status.preSurveyAdminMailEnabled !== false,
      mailProvider: status.mailProvider || "webhook",
      mailFromName: status.mailFromName || "",
      mailFromAddress: status.mailFromAddress || "",
      mailSmtpHost: status.mailSmtpHost || "",
      mailSmtpPort: Math.max(1, Number(status.mailSmtpPort || 587) || 587),
      mailSmtpSecure: Boolean(status.mailSmtpSecure),
      mailSmtpUser: status.mailSmtpUser || "",
      mailSmtpPassword: status.mailSmtpPassword || "",
      mailWebhookUrl: status.mailWebhookUrl || "",
      mailWebhookTimeoutMs: Math.max(1000, Number(status.mailWebhookTimeoutMs || 10000) || 10000),
      mailTemplates: normalizeMailTemplateConfig(status.mailTemplates),
      mailTemplateCatalog: Array.isArray(status.mailTemplateCatalog) ? status.mailTemplateCatalog : [],
      footerAdminName: status.footerAdminName || EMPTY_PLATFORM_STATUS.footerAdminName,
      footerEmail: status.footerEmail || EMPTY_PLATFORM_STATUS.footerEmail,
      footerBusinessInfo: status.footerBusinessInfo || EMPTY_PLATFORM_STATUS.footerBusinessInfo,
      supportMessageGroupName: status.supportMessageGroupName || EMPTY_PLATFORM_STATUS.supportMessageGroupName,
      supportAvailabilityMode: normalizeSupportAvailabilityMode(status.supportAvailabilityMode, EMPTY_PLATFORM_STATUS.supportAvailabilityMode),
      supportUnavailableMessage: String(status.supportUnavailableMessage || "").trim() || EMPTY_PLATFORM_STATUS.supportUnavailableMessage,
      otpAdminRequired: Boolean(status.otpAdminRequired),
      otpUserEnabled: Boolean(status.otpUserEnabled),
      otpIssuerName: status.otpIssuerName || EMPTY_PLATFORM_STATUS.otpIssuerName,
    };
  }

  function buildLlmSettingsPayload(status = platformStatus) {
    const apiKey = String(status.llmApiKey || "").trim();
    const googleSearchApiKey = String(status.googleSearchApiKey || "").trim();
    const surveyFeedbackOptions = normalizeLlmSurveyFeedbackOptionsJsonText(status.llmSurveyFeedbackOptionsJson);
    return {
      llmProvider: status.llmProvider === "ollama-native" ? "ollama-native" : "custom",
      llmApiUrl: status.llmApiUrl || "",
      llmModel: status.llmModel || "",
      ...(apiKey ? { llmApiKey: apiKey } : {}),
      llmApiKeyClearRequested: Boolean(status.llmApiKeyClearRequested),
      llmSystemPrompt: status.llmSystemPrompt || "",
      llmAdminTestMaxTokens: Math.max(1, Number(status.llmAdminTestMaxTokens || 80) || 80),
      llmSurveyFeedbackMaxTokens: Math.max(64, Number(status.llmSurveyFeedbackMaxTokens || 384) || 384),
      llmSurveyFeedbackTimeoutMs: Math.max(30000, Number(status.llmSurveyFeedbackTimeoutMs || 300000) || 300000),
      llmSurveyFeedbackPrompt: status.llmSurveyFeedbackPrompt || DEFAULT_LLM_SURVEY_FEEDBACK_PROMPT,
      llmSurveyFeedbackOptionsJson: surveyFeedbackOptions.value,
      llmThinkingMode: ["enabled", "default"].includes(status.llmThinkingMode) ? status.llmThinkingMode : "disabled",
      llmNoThinkDirectiveEnabled: status.llmNoThinkDirectiveEnabled !== false,
      llmWebSearchEnabled: status.llmWebSearchEnabled !== false,
      llmWebSearchTimeoutMs: Math.max(1000, Number(status.llmWebSearchTimeoutMs || 8000) || 8000),
      llmWebSearchResultLimit: Math.min(10, Math.max(1, Number(status.llmWebSearchResultLimit || 5) || 5)),
      ...(googleSearchApiKey ? { googleSearchApiKey } : {}),
      googleSearchApiKeyClearRequested: Boolean(status.googleSearchApiKeyClearRequested),
      googleSearchCx: status.googleSearchCx || "",
    };
  }

  function validateLlmSurveyFeedbackOptionsJson(status = platformStatus) {
    const normalized = normalizeLlmSurveyFeedbackOptionsJsonText(status.llmSurveyFeedbackOptionsJson);
    if (!normalized.error) return "";
    return normalized.error === "shape"
      ? '설문 해설 추가 옵션은 {"temperature":0.2,"top_p":0.9}처럼 JSON 객체로 입력해 주세요.'
      : '설문 해설 추가 옵션 JSON 형식이 올바르지 않습니다. 예: {"temperature":0.2,"top_p":0.9}';
  }

  function normalizeLlmSurveyFeedbackOptionsJsonText(value) {
    let raw = String(value || "").trim();
    if (!raw) return { value: "", error: "" };
    raw = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");

    const candidates = [
      raw,
      raw.replace(/'/g, '"'),
      raw.replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, '$1"$2"$3'),
      raw
        .replace(/'/g, '"')
        .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, '$1"$2"$3'),
    ];
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { value: "", error: "shape" };
        }
        return { value: JSON.stringify(parsed, null, 2), error: "" };
      } catch {
        // Try the next common paste format.
      }
    }
    return { value: "", error: "syntax" };
  }

  const isAdmin = userCanAccessAdminConsole(session);
  function canLoadSelfServiceVms(user = session) {
    if (!user) return false;
    if (userCanAccessAdminConsole(user)) return true;
    return platformStatusRef.current?.selfServiceVmServiceEnabled === true;
  }

  useEffect(() => {
    if (!canLoadSelfServiceVms() || (!isAdmin && !session?.selfServiceVmEnabled)) {
      setSelfServiceVmPreflight(EMPTY_SELF_SERVICE_VM_PREFLIGHT);
      return undefined;
    }
    const serviceProjectName = String(platformStatus?.serviceProjectName || "").trim().toLowerCase();
    const allowedProjects = (Array.isArray(platformStatus?.selfServiceVmAllowedProjects)
      ? platformStatus.selfServiceVmAllowedProjects
      : [])
      .filter((projectName) => isAdmin || String(projectName || "").trim().toLowerCase() !== serviceProjectName);
    const projectName = selfServiceVmForm.projectName || allowedProjects[0] || "";
    const networkName = selfServiceVmForm.networkName || "net-infra";
    const flavor = selfServiceVmForm.flavor || platformStatus?.selfServiceVmAllowedFlavors?.[0] || "";
    if (!projectName || !flavor) {
      setSelfServiceVmPreflight(EMPTY_SELF_SERVICE_VM_PREFLIGHT);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSelfServiceVmPreflight((current) => ({ ...current, checking: true, message: "선택한 프로젝트의 남은 자원을 확인하고 있습니다." }));
      try {
        const params = new URLSearchParams({
          projectName,
          networkName,
          flavor,
          instanceCount: String(selfServiceVmForm.instanceCount || 1),
          bootFromVolume: String(Boolean(platformStatus?.selfServiceVmVolumeBootEnabled && selfServiceVmForm.bootFromVolume)),
          bootVolumeSizeGb: String(selfServiceVmForm.bootVolumeSizeGb || 20),
          dataVolumeEnabled: String(Boolean(platformStatus?.selfServiceVmDataVolumeEnabled && selfServiceVmForm.dataVolumeEnabled)),
          dataVolumeCount: String(selfServiceVmForm.dataVolumeCount || 0),
          dataVolumeSizeGb: String(selfServiceVmForm.dataVolumeSizeGb || 0),
          floatingIpRequested: String(Boolean(platformStatus?.selfServiceVmFloatingIpEnabled && selfServiceVmForm.floatingIpRequested)),
        });
        const result = await api(`/api/self-service-vms/preflight?${params.toString()}`);
        if (!cancelled) {
          setSelfServiceVmPreflight({ checking: false, ...(result.preflight || EMPTY_SELF_SERVICE_VM_PREFLIGHT) });
        }
      } catch (error) {
        if (!cancelled) {
          setSelfServiceVmPreflight({
            ...EMPTY_SELF_SERVICE_VM_PREFLIGHT,
            checking: false,
            ok: false,
            canCreate: true,
            message: error.message || "프로젝트 자원 상태를 확인하지 못했습니다.",
          });
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    session?.id,
    session?.role,
    session?.selfServiceVmEnabled,
    isAdmin,
    platformStatus?.selfServiceVmServiceEnabled,
    platformStatus?.selfServiceVmAllowedProjects,
    platformStatus?.selfServiceVmAllowedFlavors,
    platformStatus?.serviceProjectName,
    platformStatus?.selfServiceVmVolumeBootEnabled,
    platformStatus?.selfServiceVmDataVolumeEnabled,
    platformStatus?.selfServiceVmFloatingIpEnabled,
    selfServiceVmForm.projectName,
    selfServiceVmForm.networkName,
    selfServiceVmForm.flavor,
    selfServiceVmForm.instanceCount,
    selfServiceVmForm.bootFromVolume,
    selfServiceVmForm.bootVolumeSizeGb,
    selfServiceVmForm.dataVolumeEnabled,
    selfServiceVmForm.dataVolumeCount,
    selfServiceVmForm.dataVolumeSizeGb,
    selfServiceVmForm.floatingIpRequested,
  ]);

  const standaloneExamCourseIds = useMemo(() => getStandaloneExamCourseIds(courses), [courses]);

  const publicRouteOptions = useMemo(() => {
    const customSlots = Array.isArray(platformStatus?.customRouteSlots) ? platformStatus.customRouteSlots : [];
    return [
      { key: "http", label: "HTTP", protocol: "http", port: "80", fixed: true },
      { key: "https", label: "HTTPS", protocol: "https", port: "443", fixed: true },
      ...customSlots
        .filter((slot) => Number.isInteger(Number(slot?.port)) && Number(slot.port) > 0)
        .map((slot, index) => ({
          key: slot.id || `custom${index + 1}`,
          label: String(slot.label || `사용자 정의 ${index + 1}`).trim() || `사용자 정의 ${index + 1}`,
          protocol: inferPublicRouteProtocolForPort(slot.port),
          port: String(Number(slot.port)),
          fixed: false,
        })),
    ];
  }, [platformStatus?.customRouteSlots]);
  const selectedCourse = useMemo(() => (
    courses.find((item) => Number(item.id) === Number(selectedCourseId) && !isStandaloneExamCourse(item))
      ?? courses.find((item) => !isStandaloneExamCourse(item))
      ?? null
  ), [courses, selectedCourseId]);
  const terminalCourses = useMemo(() => (
    (courses || []).filter((course) => (
      !isStandaloneExamCourse(course)
      && (isAdmin || (Boolean(course.hasEnrollmentRecord) && !course.enrollmentExpired))
    ))
  ), [courses, isAdmin]);
  const terminalCourseIds = useMemo(() => new Set(
    terminalCourses
      .map((course) => Number(course.id))
      .filter(Boolean)
  ), [terminalCourses]);
  const firstAvailableLearningLab = useMemo(() => (
    labs.find((item) => {
      const courseId = Number(item.courseId || 0);
      return ACTIVE_LAB_STATUSES.includes(String(item.status || "").toLowerCase())
        && isLearningLabResource(item, standaloneExamCourseIds)
        && (!terminalCourseIds.size || terminalCourseIds.has(courseId));
    }) ?? null
  ), [labs, standaloneExamCourseIds, terminalCourseIds]);
  const selectedTerminalCourse = useMemo(() => {
    const selected = terminalCourses.find((item) => Number(item.id) === Number(selectedCourseId)) ?? null;
    if (selected) {
      const selectedHasActiveLearningLab = labs.some((item) => (
        ACTIVE_LAB_STATUSES.includes(String(item.status || "").toLowerCase())
        && isLearningLabResource(item, standaloneExamCourseIds)
        && Number(item.courseId) === Number(selected.id)
      ));
      if (terminalCourseSelectionTouchedRef.current || selectedHasActiveLearningLab || !firstAvailableLearningLab) {
        return selected;
      }
    }
    const activeCourseId = Number(firstAvailableLearningLab?.courseId || 0);
    const activeCourse = activeCourseId
      ? (terminalCourses.find((item) => Number(item.id) === activeCourseId)
        ?? courses.find((item) => Number(item.id) === activeCourseId)
        ?? null)
      : null;
    return activeCourse
      ?? selected
      ?? terminalCourses[0]
      ?? selectedCourse
      ?? null;
  }, [courses, firstAvailableLearningLab, labs, selectedCourse, selectedCourseId, standaloneExamCourseIds, terminalCourses]);
  const selectedTerminalCourseId = Number(selectedTerminalCourse?.id || 0);
  const selectedCourseLab = useMemo(() => (
    labs.find((item) => (
      ACTIVE_LAB_STATUSES.includes(String(item.status || "").toLowerCase())
      && isLearningLabResource(item, standaloneExamCourseIds)
      && Number(item.courseId) === selectedTerminalCourseId
    )) ?? null
  ), [labs, selectedTerminalCourseId, standaloneExamCourseIds]);
  const selectedPopupLab = useMemo(() => {
    if (popupMode !== "terminal") return null;
    const popupLabId = getInitialSelectedLabId();
    if (!popupLabId) return null;
    return labs.find((item) => Number(item.id) === popupLabId)
      ?? (isAdmin ? adminLabs.find((item) => Number(item.id) === popupLabId) : null)
      ?? null;
  }, [adminLabs, isAdmin, labs, popupMode]);
  const activeLab = useMemo(() => {
    if (selectedPopupLab) return selectedPopupLab;
    if (selectedCourseLab) return selectedCourseLab;
    if (selectedTerminalCourseId && terminalCourseSelectionTouchedRef.current) return null;
    return firstAvailableLearningLab;
  }, [firstAvailableLearningLab, selectedCourseLab, selectedPopupLab, selectedTerminalCourseId]);
  const hasTransitioningLab = useMemo(
    () => labs.some((item) => ["provisioning", "terminating"].includes(String(item.status || "").toLowerCase())),
    [labs],
  );
  useEffect(() => {
    terminalCourseSelectionTouchedRef.current = false;
  }, [session?.id]);
  useEffect(() => {
    if (terminalCourseSelectionTouchedRef.current) return;
    if (selectedCourseLab) return;
    const nextCourseId = Number(firstAvailableLearningLab?.courseId || 0);
    if (!nextCourseId || Number(selectedCourseId || 0) === nextCourseId) return;
    setSelectedCourseId(nextCourseId);
  }, [firstAvailableLearningLab?.courseId, selectedCourseId, selectedCourseLab]);
  const activeLabCourse = useMemo(() => courses.find((item) => Number(item.id) === Number(activeLab?.courseId)) ?? null, [courses, activeLab?.courseId]);
  const qnaUnreadCount = useMemo(() => {
    const currentUserId = Number(session?.id || 0);
    if (!currentUserId || !qnaLastReadAt) return 0;
    const lastReadTime = new Date(qnaLastReadAt).getTime();
    if (!Number.isFinite(lastReadTime) || lastReadTime <= 0) return 0;
    let unread = 0;
    for (const post of qnaPosts || []) {
      const postCreatedAt = new Date(post.createdAt || 0).getTime();
      if (Number.isFinite(postCreatedAt) && postCreatedAt > lastReadTime && Number(post.userId || 0) !== currentUserId) {
        unread += 1;
      }
      for (const comment of post.comments || []) {
        const commentCreatedAt = new Date(comment.createdAt || 0).getTime();
        if (Number.isFinite(commentCreatedAt) && commentCreatedAt > lastReadTime && Number(comment.userId || 0) !== currentUserId) {
          unread += 1;
        }
      }
    }
    return unread;
  }, [qnaLastReadAt, qnaPosts, session?.id]);
  const notificationUnreadCount = useMemo(
    () => (notifications || []).filter((item) => !item.isRead).length,
    [notifications],
  );
  const messageUnreadCount = useMemo(
    () => (messages || []).filter((item) => Number(item.recipientId) === Number(session?.id || 0) && !item.readAt).length,
    [messages, session?.id],
  );
  const activeRequiredTerms = useMemo(
    () => (platformStatus?.termsEnabled === false ? [] : ["standard_terms", "service_additional_terms"].map((key) => activeTerms.find((term) => term.termsKey === key)).filter(Boolean)),
    [activeTerms, platformStatus?.termsEnabled],
  );
  const missingRequiredTerms = useMemo(() => {
    if (!session || isAdminUserRole(session.role) || activeRequiredTerms.length < 2) return [];
    const agreementHashes = new Set((session.termsAgreements || []).map((item) => `${item.termsKey || item.terms_key}:${item.contentHash || item.content_hash}`));
    return activeRequiredTerms.filter((term) => !agreementHashes.has(`${term.termsKey}:${term.contentHash}`));
  }, [activeRequiredTerms, session]);
  const termsConsentRequired = missingRequiredTerms.length > 0;
  const marketingConsentDecisionRequired = Boolean(
    session
      && !isAdminUserRole(session.role)
      && !termsConsentRequired
      && session.marketingEmailConsentDecided !== true,
  );
  const selectedWrittenExam = useMemo(() => {
    if (session?.role === "admin") {
      return writtenExams.find((item) => String(item.courseId) === String(writtenExamForm.courseId)) ?? null;
    }
    return writtenExams.find((item) => String(item.courseId) === String(selectedCourseId)) ?? writtenExams[0] ?? null;
  }, [selectedCourseId, session?.role, writtenExamForm.courseId, writtenExams]);
  const selectedLabExam = useMemo(() => {
    if (session?.role === "admin") {
      return labExams.find((item) => String(item.courseId) === String(labExamForm.courseId)) ?? null;
    }
    return labExams.find((item) => String(item.courseId) === String(selectedCourseId)) ?? labExams[0] ?? null;
  }, [labExamForm.courseId, labExams, selectedCourseId, session?.role]);

  function pushToast(message, tone = "info") {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3500);
  }

  function handleAccountSharingWarning(warning) {
    const message = String(warning?.message || "").trim();
    if (message) pushToast(message, "error");
  }

  function dismissToast(id) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    if (!query) return adminUsers;
    return adminUsers.filter((user) => [
      user.name,
      user.username,
      user.role,
      user.status,
      user.accountSharingRestricted ? "계정 공유 제한 접근 제한" : "",
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [adminUsers, userSearch]);
  const filteredUnapprovedUserIds = useMemo(
    () => filteredUsers
      .filter((user) => String(user.status || "").trim().toLowerCase() !== "approved")
      .map((user) => user.id),
    [filteredUsers],
  );

  useEffect(() => {
    const onPopState = () => {
      setRoute(getRoute());
      setPopupMode(getPopupMode());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => {
      clearClientSessionState("portal");
      setAuthStatus({ tone: "error", message: "세션이 만료되어 랜딩 페이지로 이동했습니다. 다시 로그인해 주세요." });
    };
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [route]);

  useEffect(() => {
    const handleAccountSharingWarningEvent = (event) => {
      handleAccountSharingWarning(event.detail);
    };
    window.addEventListener(ACCOUNT_SHARING_WARNING_EVENT, handleAccountSharingWarningEvent);
    return () => window.removeEventListener(ACCOUNT_SHARING_WARNING_EVENT, handleAccountSharingWarningEvent);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const oauthParams = new URLSearchParams(window.location.search || "");
        const oauthStatus = oauthParams.get("oauth");
        if (oauthStatus) {
          const messages = {
            success: "SSO 로그인이 완료되었습니다.",
            pending: "SSO 계정이 생성되었습니다. 관리자 승인 후 로그인할 수 있습니다.",
            error: oauthParams.get("message")
              ? `SSO 로그인 실패: ${oauthParams.get("message")}`
              : "SSO 로그인 중 오류가 발생했습니다.",
          };
          setAuthTab("login");
          setAuthStatus({ tone: oauthStatus === "error" ? "error" : "success", message: messages[oauthStatus] || messages.error });
          oauthParams.delete("oauth");
          oauthParams.delete("message");
          const nextSearch = oauthParams.toString();
          window.history.replaceState({}, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash || ""}`);
        }
        const [result] = await Promise.all([
          api("/api/auth/session"),
          runSafeRefreshTasks([
            loadNotices(cancelled),
            loadPlatformStatus(cancelled),
            loadCurrentTerms(cancelled),
          ]),
        ]);
        const authenticatedUser = result?.authenticated && result?.user ? result.user : null;
        if (!cancelled && authenticatedUser) {
          setSession(authenticatedUser);
          handleAccountSharingWarning(result.accountSharingWarning);
          setPendingOtpEnrollment(EMPTY_PENDING_OTP_ENROLLMENT);
          await loadCourses(cancelled, authenticatedUser);
          if (!cancelled) {
            setLoading(false);
            void refreshAll(authenticatedUser, cancelled);
          }
        } else if (!cancelled) {
          if (result?.recoveryMode) {
            setAuthStatus({
              tone: "error",
              message: result.message || "데이터베이스 연결이 불가능해 제한 모드로 실행 중입니다.",
            });
          }
          await loadCourses(cancelled);
        }
      } catch (error) {
        if (!cancelled && [401, 503].includes(Number(error?.status))) {
          if (Number(error?.status) === 503) {
            setAuthStatus({
              tone: "error",
              message: error.message || "서버가 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.",
            });
          }
          await loadCourses(cancelled);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (session?.role !== "admin") return;
    const fallbackCourseId = String(writtenExams[0]?.courseId || adminCourses[0]?.id || "");
    if (!fallbackCourseId) return;
    setWrittenExamForm((current) => (current.courseId ? current : { ...current, courseId: fallbackCourseId }));
  }, [adminCourses, session?.role, writtenExams]);

  useEffect(() => {
    if (session?.role !== "admin") return;
    const fallbackCourseId = String(labExams[0]?.courseId || adminCourses[0]?.id || "");
    if (!fallbackCourseId) return;
    setLabExamForm((current) => (current.courseId ? current : { ...current, courseId: fallbackCourseId }));
  }, [adminCourses, labExams, session?.role]);

  useEffect(() => {
    if (!session) return;
    const runningLab = labs.find((lab) => lab.status === "running" && isLearningLabResource(lab, standaloneExamCourseIds));
    if (!runningLab) return;
    const timer = window.setInterval(() => api(`/api/labs/${runningLab.id}/heartbeat`, { method: "POST" }).catch(() => {}), 120000);
    return () => window.clearInterval(timer);
  }, [labs, session, standaloneExamCourseIds]);

  useEffect(() => {
    if (!session || route === "admin" || (!hasTransitioningLab && !startingLabIds.length)) return;
    let stopped = false;
    const refreshTransitioningLabs = () => {
      if (!isPageVisible()) return;
      void loadLabs(stopped).catch(() => {
        // Keep the last known lab state and retry on the next short polling tick.
      });
    };
    const timer = window.setInterval(refreshTransitioningLabs, LAB_TRANSITION_REFRESH_INTERVAL_MS);
    const unsubscribeVisibleResume = subscribeToVisiblePageResume(refreshTransitioningLabs);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      unsubscribeVisibleResume();
    };
  }, [hasTransitioningLab, route, session?.id, startingLabIds.length]);

  useEffect(() => {
    if (!session) {
      setProfileForm(EMPTY_PROFILE);
      setQnaLastReadAt("");
      setLlmQuotaStatus(EMPTY_LLM_QUOTA_STATUS);
      return;
    }

    setQnaLastReadAt(String(session.qnaLastReadAt || ""));
    setProfileForm({
      name: session.name || "",
      email: session.email || "",
      username: session.username || "",
      role: session.role || "",
      status: session.status || "",
      otpEnabled: Boolean(session.otpEnabled),
      otpSetupSecret: "",
      otpSetupUri: "",
      otpSetupCode: "",
      otpDisableCode: "",
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
      courseCode: "",
    });
  }, [session]);

  useEffect(() => {
    if (!session || route === "admin" || section !== "qna") return;
    let cancelled = false;
    (async () => {
      try {
        const result = await api("/api/auth/qna/read", { method: "POST" });
        if (cancelled) return;
        const stamp = String(result?.qnaLastReadAt || result?.user?.qnaLastReadAt || "");
        if (stamp) setQnaLastReadAt(stamp);
        if (result?.user) {
          setSession((current) => (current ? { ...current, ...result.user } : current));
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [qnaPosts, route, section, session?.id]);

  useEffect(() => {
    if (!activeLab) {
      const hasRunningCustomLab = customLabRequests.some((request) => String(request.status || "").toLowerCase() === "running");
      if (hasRunningCustomLab && (publicRouteFormDirty || publicTcpRouteFormDirty)) {
        return;
      }
      setPublicRouteForm(EMPTY_PUBLIC_ROUTE);
      setPublicTcpRouteForm(EMPTY_PUBLIC_TCP_ROUTE);
      setPublicRouteFormDirty(false);
      setPublicTcpRouteFormDirty(false);
      lastActiveLabIdRef.current = null;
      setDomainAvailability({ tone: "", message: "" });
      setTerminalRequest({ tone: "", message: "실행 중인 랩이 있으면 여기에서 바로 연결 상태를 확인할 수 있습니다." });
      setTerminalForm((current) => ({
        ...current,
        username: selectedCourse?.terminalSshUser || "",
        password: "",
      }));
      return;
    }

    const managedLabCourse = ["linux-shell-lab.yaml", "example-lab.yaml", "kubeflow.yaml"].includes(String(activeLabCourse?.heatTemplateName || "").trim().toLowerCase());
    const labChanged = Number(lastActiveLabIdRef.current || 0) !== Number(activeLab.id || 0);

    if (labChanged) {
      lastActiveLabIdRef.current = Number(activeLab.id || 0);
      setPublicRouteFormDirty(false);
      setPublicTcpRouteFormDirty(false);
    }

    setTerminalForm((current) => ({
      ...current,
      username: managedLabCourse
        ? String(activeLab.terminalSshUser || "")
        : activeLab.terminalSshUser || activeLabCourse?.terminalSshUser || selectedCourse?.terminalSshUser || current.username || "",
      password: managedLabCourse
        ? String(activeLab.terminalSshPassword || "")
        : activeLab.terminalSshPassword || current.password || "",
    }));
    if (!publicRouteFormDirty || labChanged) {
      const defaultDomainEntry = (Array.isArray(activeLab.requestedPublicDomains) && activeLab.requestedPublicDomains[0])
        || (Array.isArray(activeLab.publicDomains) && activeLab.publicDomains[0])
        || null;
      setPublicRouteForm({
        domainType: defaultDomainEntry?.domainType || "managed",
        subdomain: activeLab.requestedPublicSubdomain || activeLab.publicSubdomain || "",
        customDomain: defaultDomainEntry?.domainType === "custom" ? defaultDomainEntry.fqdn || "" : "",
        routeKey: resolveRouteKeyForPort(activeLab.requestedPublicPort || activeLab.publicPort, platformStatus?.customRouteSlots),
        protocol: activeLab.requestedPublicProtocol || activeLab.publicProtocol || "http",
        port: activeLab.requestedPublicPort ? String(activeLab.requestedPublicPort) : activeLab.publicPort ? String(activeLab.publicPort) : "80",
        nodeId: String(defaultDomainEntry?.nodeId || ""),
      });
    }
    if (!publicTcpRouteFormDirty || labChanged) {
      setPublicTcpRouteForm(EMPTY_PUBLIC_TCP_ROUTE);
    }
    setDomainAvailability({ tone: "", message: "" });
  }, [activeLab?.id, activeLab?.courseId, activeLab?.publicSubdomain, activeLab?.publicProtocol, activeLab?.publicPort, activeLab?.requestedPublicSubdomain, activeLab?.requestedPublicProtocol, activeLab?.requestedPublicPort, activeLab?.publicDomains?.[0]?.nodeId, activeLab?.requestedPublicDomains?.[0]?.nodeId, activeLab?.terminalSshUser, activeLab?.terminalSshPassword, activeLabCourse?.heatTemplateName, activeLabCourse?.terminalSshUser, selectedCourse?.terminalSshUser, platformStatus?.customRouteSlots, publicRouteFormDirty, publicTcpRouteFormDirty, customLabRequests]);

  useEffect(() => {
    if (route !== "admin" || !session || session.role !== "admin") return;

    let stopped = false;
    const intervalMs = normalizeAutoRefreshIntervalSeconds(platformStatus?.adminAutoRefreshIntervalSeconds, 60) * 1000;
    const refreshAdminView = async () => {
      if (!isPageVisible() || adminAutoRefreshInFlightRef.current || adminLoadInFlightRef.current) return;
      adminAutoRefreshInFlightRef.current = true;
      try {
          const activeUser = await verifyActiveSessionForPolling(stopped, { requireAdminRole: true, targetRoute: "admin" });
          if (!activeUser || stopped) return;
          await loadAdminOperationalSnapshot(stopped);
          if (stopped) return;
          await runTaskFactoriesWithConcurrency([
            () => loadNotices(stopped),
            () => loadNotifications(stopped, { silent: true }),
            () => loadMessages(stopped, { silent: true }),
            () => loadLuckyDraw(stopped),
            () => loadPlatformStatus(stopped),
          ], 3);
      } catch {
        // ignore polling errors and keep existing screen state
      } finally {
        adminAutoRefreshInFlightRef.current = false;
      }
    };

    const timer = window.setInterval(refreshAdminView, intervalMs);
    const unsubscribeVisibleResume = subscribeToVisiblePageResume(() => {
      void refreshAdminView();
    });
    return () => {
      stopped = true;
      window.clearInterval(timer);
      unsubscribeVisibleResume();
    };
  }, [route, session?.id, session?.role, platformStatus?.adminAutoRefreshIntervalSeconds]);

  useEffect(() => {
    if (route === "admin" || section !== "opsMonitor" || !session || session.role !== "admin") return;

    let stopped = false;
    const intervalMs = normalizeAutoRefreshIntervalSeconds(platformStatus?.adminAutoRefreshIntervalSeconds, 60) * 1000;
    const refreshOpsMonitor = async () => {
      if (!isPageVisible() || adminAutoRefreshInFlightRef.current || adminLoadInFlightRef.current) return;
      adminAutoRefreshInFlightRef.current = true;
      try {
        const activeUser = await verifyActiveSessionForPolling(stopped, { requireAdminRole: true, targetRoute: route });
        if (!activeUser || stopped) return;
        await loadAdminOperationalSnapshot(stopped);
        if (stopped) return;
        await Promise.all([
          loadAccessStats(stopped),
          loadPlatformStatus(stopped),
        ]);
      } catch {
        // Keep the monitor visible with the last known data when a polling tick fails.
      } finally {
        adminAutoRefreshInFlightRef.current = false;
      }
    };

    void refreshOpsMonitor();
    const timer = window.setInterval(refreshOpsMonitor, intervalMs);
    const unsubscribeVisibleResume = subscribeToVisiblePageResume(() => {
      void refreshOpsMonitor();
    });
    return () => {
      stopped = true;
      window.clearInterval(timer);
      unsubscribeVisibleResume();
    };
  }, [route, section, session?.id, session?.role, platformStatus?.adminAutoRefreshIntervalSeconds]);

  useEffect(() => {
    if (!adminLuckyDrawEvents.length) return;
    setLuckyDrawRewardForm((current) => (current.eventId ? current : { ...current, eventId: String(adminLuckyDrawEvents[0].id || "") }));
  }, [adminLuckyDrawEvents]);

  useEffect(() => {
    if (!session || route === "admin") return;

    let stopped = false;
    const intervalMs = normalizeAutoRefreshIntervalSeconds(platformStatus?.userAutoRefreshIntervalSeconds, 60) * 1000;
    const refreshUserView = async () => {
      if (!isPageVisible()) return;
      try {
          const activeUser = await verifyActiveSessionForPolling(stopped, { targetRoute: "portal" });
          if (!activeUser || stopped) return;
          await Promise.all([
            loadLabs(stopped),
            loadLuckyDraw(stopped),
            loadCustomLabRequests(stopped),
            loadConsultingRequests(stopped),
            loadNotifications(stopped, { silent: true }),
            loadMessages(stopped, { silent: true }),
            loadSelfServiceVms(stopped),
            loadZunContainers(stopped),
            loadMagnumClusters(stopped),
            loadTroveInstances(stopped),
            loadPlatformStatus(stopped),
            loadQuotaStatus(stopped),
            loadAccessStats(stopped),
            loadMyAccessLogs(stopped),
          ]);
      } catch {
        // ignore polling errors
      }
    };

    const timer = window.setInterval(refreshUserView, intervalMs);
    const unsubscribeVisibleResume = subscribeToVisiblePageResume(() => {
      void refreshUserView();
    });
    return () => {
      stopped = true;
      window.clearInterval(timer);
      unsubscribeVisibleResume();
    };
  }, [route, session?.id, platformStatus?.userAutoRefreshIntervalSeconds]);

  useEffect(() => {
    if (!session || route === "admin" || platformStatus?.recoveryMode) return;
    const events = new EventSource("/api/events", { withCredentials: true });
    const onCoursesUpdated = () => {
      void loadCourses();
      void loadWrittenExams();
      void loadLabExams();
      if (isAdmin) void loadAdminCourses();
    };
    const onTextbooksUpdated = () => {
      if (isAdmin) void loadAdminTextbooks();
      void loadCourses();
    };
    const onWrittenExamsUpdated = () => {
      void loadWrittenExams();
    };
    const onLabExamsUpdated = () => {
      void loadLabExams();
    };
    const onLabsUpdated = () => {
      void loadLabs();
      if (isAdmin) void loadAdminLabs();
    };
    const onPlatformStatusUpdated = () => {
      void loadPlatformStatus(false, { force: true });
      void loadQuotaStatus(false);
    };
    events.addEventListener("courses-updated", onCoursesUpdated);
    events.addEventListener("labs-updated", onLabsUpdated);
    events.addEventListener("platform-status-updated", onPlatformStatusUpdated);
    events.addEventListener("textbooks-updated", onTextbooksUpdated);
    events.addEventListener("written-exams-updated", onWrittenExamsUpdated);
    events.addEventListener("lab-exams-updated", onLabExamsUpdated);
    events.onerror = () => {
      // EventSource reconnects automatically.
    };
    return () => {
      events.removeEventListener("courses-updated", onCoursesUpdated);
      events.removeEventListener("labs-updated", onLabsUpdated);
      events.removeEventListener("platform-status-updated", onPlatformStatusUpdated);
      events.removeEventListener("textbooks-updated", onTextbooksUpdated);
      events.removeEventListener("written-exams-updated", onWrittenExamsUpdated);
      events.removeEventListener("lab-exams-updated", onLabExamsUpdated);
      events.close();
    };
  }, [route, session?.id, platformStatus?.recoveryMode]);

  const paymentCallbackRef = useRef("");

  useEffect(() => {
    if (!session || route === "admin") return;
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = String(params.get("paymentStatus") || "").trim().toLowerCase();
    const customLabPaymentStatus = String(params.get("customLabPaymentStatus") || "").trim().toLowerCase();
    if (!paymentStatus && !customLabPaymentStatus) return;
    const paymentKey = String(params.get("paymentKey") || "").trim();
    const orderId = String(params.get("orderId") || "").trim();
    const amount = Number(params.get("amount") || 0);
    const customLabRequestId = Number(params.get("customLabRequestId") || 0);
    const code = String(params.get("code") || params.get("errorCode") || "").trim();
    const message = String(params.get("message") || params.get("errorMessage") || "").trim();
    const signature = `${paymentStatus}:${customLabPaymentStatus}:${customLabRequestId}:${orderId}:${paymentKey}:${amount}:${code}:${message}`;
    if (paymentCallbackRef.current === signature) return;
    paymentCallbackRef.current = signature;

    (async () => {
      try {
        if (customLabPaymentStatus === "success" && customLabRequestId > 0) {
          const result = await api(`/api/custom-lab-requests/${customLabRequestId}/payment/confirm`, {
            method: "POST",
            body: { orderId, paymentKey, amount },
          });
          setAuthStatus({ tone: "success", message: result.message || "고급 랩 결제가 완료되었습니다." });
          pushToast(result.message || "고급 랩 결제가 완료되었습니다.", "success");
          setSection("customLabs");
          await runSafeRefreshTasks([loadCustomLabRequests(), isAdmin ? loadAdmin() : Promise.resolve()]);
        } else if (customLabPaymentStatus === "fail" && customLabRequestId > 0) {
          const result = await api(`/api/custom-lab-requests/${customLabRequestId}/payment/fail`, {
            method: "POST",
            body: { orderId, code, message },
          });
          setAuthStatus({ tone: "error", message: result.message || "고급 랩 결제에 실패했습니다." });
          pushToast(message || result.message || "고급 랩 결제에 실패했습니다.", "error");
          await runSafeRefreshTasks([loadCustomLabRequests(), isAdmin ? loadAdmin() : Promise.resolve()]);
        } else if (paymentStatus === "success") {
          const result = await api("/api/payments/confirm", {
            method: "POST",
            body: { orderId, paymentKey, amount },
          });
          setAuthStatus({ tone: "success", message: result.message || "결제가 완료되었습니다." });
          pushToast(result.message || "결제가 완료되었습니다.", "success");
          setSection("courses");
          if (result.payment?.courseId) {
            setSelectedCourseId(Number(result.payment.courseId));
          }
          await runSafeRefreshTasks([loadPayments(), loadCourses(), loadWrittenExams(), loadLabExams(), loadCertificates()]);
        } else if (paymentStatus === "fail") {
          const result = await api("/api/payments/fail", {
            method: "POST",
            body: { orderId, code, message },
          });
          setAuthStatus({ tone: "error", message: result.message || "결제에 실패했습니다." });
          pushToast(message || result.message || "결제에 실패했습니다.", "error");
          await loadPayments();
        }
      } catch (error) {
        setAuthStatus({ tone: "error", message: error.message || "결제 처리 중 오류가 발생했습니다." });
        pushToast(error.message || "결제 처리 중 오류가 발생했습니다.", "error");
      } finally {
        clearPaymentQuery();
      }
    })();
  }, [route, session?.id]);

  useEffect(() => {
    if (!session || !isAdmin) return;
    const snapshot = JSON.stringify({
      labs: (adminLabs || []).map((item) => [item.id, item.status, item.publicRequestPending, item.publicEnabled, item.requestedPublicUrl, item.publicUrl]),
      access: (adminCourseAccessRequests || []).map((item) => [item.id, item.status]),
      custom: (adminCustomLabRequests || []).map((item) => [item.id, item.status, item.quotedPrice]),
      zun: (zunContainers || []).map((item) => [item.id, item.status, item.containerUuid]),
      magnum: (magnumClusters || []).map((item) => [item.id, item.status, item.clusterUuid, item.apiAddress]),
      trove: (troveInstances || []).map((item) => [item.id, item.status, item.instanceUuid, item.hostname]),
    });
    if (adminSnapshotRef.current && adminSnapshotRef.current !== snapshot) {
      pushToast("관리자 화면 정보가 자동으로 갱신되었습니다.");
    }
    adminSnapshotRef.current = snapshot;
  }, [session?.id, isAdmin, adminLabs, adminCourseAccessRequests, adminCustomLabRequests, zunContainers, magnumClusters, troveInstances]);

  useEffect(() => {
    if (!session || route === "admin") return;
    const snapshot = JSON.stringify({
      labs: (labs || []).map((item) => [item.id, item.status, item.publicRequestPending, item.publicEnabled, item.requestedPublicUrl, item.publicUrl]),
      custom: (customLabRequests || []).map((item) => [item.id, item.status, item.quotedPrice]),
      zun: (zunContainers || []).map((item) => [item.id, item.status, item.containerUuid]),
      magnum: (magnumClusters || []).map((item) => [item.id, item.status, item.clusterUuid, item.apiAddress]),
      trove: (troveInstances || []).map((item) => [item.id, item.status, item.instanceUuid, item.hostname]),
    });
    if (userSnapshotRef.current && userSnapshotRef.current !== snapshot) {
      pushToast("변경된 요청 상태가 반영되었습니다.");
    }
    userSnapshotRef.current = snapshot;
  }, [session?.id, route, labs, customLabRequests, zunContainers, magnumClusters, troveInstances]);

  async function refreshAll(user = session, cancelled = false) {
    await runSafeRefreshTasks([
      loadCourses(cancelled, user),
      loadNotices(cancelled),
      loadNotifications(cancelled),
      loadLuckyDraw(cancelled),
      loadCoupons(cancelled),
      loadMessages(cancelled),
      loadMessageRecipients(cancelled),
      loadPlatformStatus(cancelled),
      loadCurrentTerms(cancelled),
      loadQuotaStatus(cancelled, user),
      loadLlmQuotaStatus(cancelled, user),
      loadAccessStats(cancelled, user),
      loadLabs(cancelled),
      loadCustomLabRequests(cancelled),
      loadConsultingRequests(cancelled),
      loadSelfServiceVms(cancelled),
      loadCloudInitTemplates(cancelled),
      loadZunContainers(cancelled),
      loadMagnumClusters(cancelled),
      loadTroveInstances(cancelled),
      loadWrittenExams(cancelled),
      loadLabExams(cancelled, user),
      loadPayments(cancelled),
      loadCourseQuotes(cancelled),
      loadCertificates(cancelled),
      loadQna(cancelled, user),
      loadMyAccessLogs(cancelled),
      userCanAccessAdminConsole(user) ? loadAdmin(cancelled, user) : Promise.resolve(),
    ]);
  }
  async function loadCourses(cancelled = false, user = session) {
    const result = await api(user ? "/api/courses" : "/api/public/courses");
    if (cancelled) return;
    const nextCourses = withLocalPreviewSampleCourses(result.courses);
    setCourses(nextCourses);
    setSelectedCourseId((current) => {
      if (!current) return nextCourses[0]?.id ?? null;
      return nextCourses.some((item) => Number(item.id) === Number(current))
        ? current
        : (nextCourses[0]?.id ?? null);
    });
  }
  async function loadLabs(cancelled = false) {
    const result = await api("/api/labs");
    const nextLabs = withLocalPreviewSampleLabs(result.labs);
    if (!cancelled) setLabs(nextLabs);
    return nextLabs;
  }
  async function loadCustomLabRequests(cancelled = false) {
    const result = await api("/api/custom-lab-requests");
    if (!cancelled) setCustomLabRequests(result.requests);
  }
  async function loadConsultingRequests(cancelled = false) {
    const result = await api("/api/consulting-requests");
    if (!cancelled) setConsultingRequests(result.requests);
  }
  async function loadAdminConsultingRequests(cancelled = false) {
    const result = await api("/api/admin/consulting-requests");
    if (!cancelled) setAdminConsultingRequests(result.requests);
  }
  async function loadCloudConsoleProject() {
    const result = await api("/api/cloud-console/project");
    if (Array.isArray(result.projectRequests)) setSelfServiceProjectRequests(result.projectRequests);
    return result;
  }

  async function createCloudConsoleProject({ networkName = "private", subnetCidr = "192.168.10.0/24", quotaProfileId = "basic", requestedQuota = null } = {}) {
    setCloudConsoleStatus({ tone: "info", message: "전용 OpenStack 프로젝트를 준비하는 중입니다." });
    try {
      const result = await api("/api/cloud-console/project", { method: "POST", body: { networkName, subnetCidr, quotaProfileId, requestedQuota } });
      if (Array.isArray(result.projectRequests)) setSelfServiceProjectRequests(result.projectRequests);
      setCloudConsoleStatus({ tone: result.automaticallyApproved ? "success" : "warning", message: result.message });
      return result;
    } catch (error) {
      if (Array.isArray(error.payload?.projectRequests)) setSelfServiceProjectRequests(error.payload.projectRequests);
      const userMessage = getCloudSafeErrorMessage(error, "전용 프로젝트를 준비하지 못했습니다.", { isAdmin: isAdminUserRole(session?.role) });
      error.userMessage = userMessage;
      setCloudConsoleStatus({ tone: "error", message: userMessage });
      throw error;
    }
  }

  async function deleteCloudConsoleProject({ projectName, confirmProjectName } = {}) {
    setCloudConsoleStatus({ tone: "warning", message: "전용 OpenStack 프로젝트와 포함된 자원을 삭제하는 중입니다." });
    try {
      const result = await api("/api/cloud-console/project", { method: "DELETE", body: { projectName, confirmProjectName } });
      if (Array.isArray(result.projectRequests)) setSelfServiceProjectRequests(result.projectRequests);
      setCloudConsoleSnapshot(null);
      setCloudConsoleStatus({ tone: "success", message: result.message });
      return result;
    } catch (error) {
      const userMessage = getCloudSafeErrorMessage(error, "전용 프로젝트를 삭제하지 못했습니다.", { isAdmin: isAdminUserRole(session?.role) });
      error.userMessage = userMessage;
      setCloudConsoleStatus({ tone: "error", message: userMessage });
      throw error;
    }
  }

  async function loadCloudConsoleActions() {
    const result = await api("/api/cloud-console/actions");
    setCloudConsoleActions(result.actions || []);
    return result.actions || [];
  }

  async function runCloudConsoleAction({ method = "POST", path = "", body = {}, projectName = "" } = {}) {
    setCloudConsoleStatus({ tone: "info", message: "OpenStack 작업을 처리하는 중입니다." });
    try {
      const result = await api(path, { method, body: { ...body, projectName } });
      setCloudConsoleStatus({ tone: result.approvalRequired ? "warning" : "success", message: result.message || (result.approvalRequired ? "관리자 승인 대기로 등록했습니다." : "OpenStack 작업을 완료했습니다.") });
      const refreshResults = await Promise.allSettled([loadCloudConsoleSnapshot(projectName), loadCloudConsoleActions()]);
      if (refreshResults.some((entry) => entry.status === "rejected")) {
        setCloudConsoleStatus({ tone: "warning", message: result.approvalRequired ? "관리자 승인 대기로 등록했습니다. 목록은 새로고침해 주세요." : "OpenStack 작업은 완료됐지만 목록 갱신에 실패했습니다. 새로고침해 주세요." });
      }
      return result;
    } catch (error) {
      const userMessage = getCloudSafeErrorMessage(error, "OpenStack 작업을 완료하지 못했습니다.", { isAdmin: isAdminUserRole(session?.role) });
      error.userMessage = userMessage;
      setCloudConsoleStatus({ tone: "error", message: userMessage });
      throw error;
    }
  }

  async function createCloudConsoleTerminalSession({ serverId = "", projectName = "", username = "", password = "" } = {}) {
    setCloudConsoleStatus({ tone: "info", message: "xterm SSH 연결을 준비하는 중입니다." });
    try {
      const result = await api(`/api/cloud-console/instances/${encodeURIComponent(serverId)}/terminal/session`, { method: "POST", body: { projectName, username, password } });
      setCloudConsoleStatus({ tone: "success", message: result.message || "xterm SSH 연결을 준비했습니다." });
      return result;
    } catch (error) {
      setCloudConsoleStatus({ tone: "error", message: error.message || "xterm SSH 연결을 준비하지 못했습니다." });
      throw error;
    }
  }

  async function closeCloudConsoleTerminalSession(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return null;
    try {
      const result = await api("/api/cloud-console/terminal/sessions/" + encodeURIComponent(normalizedSessionId), { method: "DELETE" });
      setCloudConsoleStatus({ tone: "success", message: result.message || "xterm 연결을 종료했습니다." });
      return result;
    } catch (error) {
      if (Number(error.status || error.statusCode || 0) !== 404) setCloudConsoleStatus({ tone: "error", message: error.message || "xterm 연결을 종료하지 못했습니다." });
      return null;
    }
  }

  async function openCloudConsole({ serverId = "", projectName = "" } = {}) {
    setCloudConsoleStatus({ tone: "info", message: "가상머신 콘솔을 준비하는 중입니다." });
    try {
      const result = await api(`/api/cloud-console/instances/${encodeURIComponent(serverId)}/console`, { method: "POST", body: { projectName } });
      setCloudConsoleStatus({ tone: "success", message: "가상머신 VNC 콘솔을 준비했습니다." });
      return result;
    } catch (error) {
      setCloudConsoleStatus({ tone: "error", message: error.message || "가상머신 콘솔을 열지 못했습니다." });
      throw error;
    }
  }

  async function reviewCloudConsoleAction(actionId, decision, note = "") {
    const result = await api(`/api/admin/cloud-console/actions/${actionId}/review`, { method: "POST", body: { decision, note } });
    await Promise.all([loadCloudConsoleActions(), cloudConsoleSnapshot?.projectName ? loadCloudConsoleSnapshot(cloudConsoleSnapshot.projectName) : Promise.resolve()]);
    return result;
  }

  async function loadCloudConsoleSnapshot(projectName = "") {
    const normalizedProjectName = String(projectName || "").trim();
    if (!normalizedProjectName) {
      setCloudConsoleSnapshot(null);
      return null;
    }
    try {
      const params = new URLSearchParams({ projectName: normalizedProjectName });
      const result = await api(`/api/cloud-console/snapshot?${params.toString()}`);
      const snapshot = result.snapshot || null;
      const warnings = Array.isArray(snapshot?.warnings) ? snapshot.warnings.filter(Boolean) : [];
      const warningSignature = warnings.length ? `${normalizedProjectName}|${warnings.join("|")}` : "";
      const isNewWarning = Boolean(warningSignature) && warningSignature !== cloudConsoleWarningSignatureRef.current;
      if (!warningSignature) cloudConsoleWarningSignatureRef.current = "";
      setCloudConsoleSnapshot(snapshot ? { ...snapshot, warnings: isNewWarning ? warnings : [] } : null);
      if (isNewWarning) {
        cloudConsoleWarningSignatureRef.current = warningSignature;
        setCloudConsoleStatus({ tone: "warning", message: "일부 OpenStack 자원을 불러오지 못했습니다." });
        if (cloudConsoleWarningTimerRef.current && typeof window !== "undefined") window.clearTimeout(cloudConsoleWarningTimerRef.current);
        if (typeof window !== "undefined") cloudConsoleWarningTimerRef.current = window.setTimeout(() => {
          setCloudConsoleSnapshot((current) => current?.projectName === normalizedProjectName ? { ...current, warnings: [] } : current);
          setCloudConsoleStatus((current) => current.message === "일부 OpenStack 자원을 불러오지 못했습니다." ? { tone: "", message: "" } : current);
          cloudConsoleWarningTimerRef.current = null;
        }, 6000);
      }
      return snapshot;
    } catch (error) {
      setCloudConsoleStatus({ tone: "error", message: error.message || "OpenStack 자원을 불러오지 못했습니다." });
      throw error;
    }
  }

  async function loadSelfServiceVms(cancelled = false) {
    if (!canLoadSelfServiceVms()) {
      if (!cancelled) {
        setSelfServiceVms([]);
        setSelfServiceProjectRequests([]);
      }
      return;
    }
    let result;
    try {
      result = await api("/api/self-service-vms");
    } catch (error) {
      if (error?.status === 403 || error?.status === 503) {
        if (!cancelled) {
          setSelfServiceVms([]);
          setSelfServiceProjectRequests(error.payload?.projectRequests || []);
        }
        return;
      }
      throw error;
    }
    if (!cancelled) {
      setSelfServiceVms(result.vms || []);
      setSelfServiceProjectRequests(result.projectRequests || []);
      const allowedProjects = Array.isArray(result.allowedProjects) ? result.allowedProjects : [];
      const allowedImages = Array.isArray(result.allowedImages) && result.allowedImages.length ? result.allowedImages : EMPTY_PLATFORM_STATUS.selfServiceVmAllowedImages;
      if (!platformStatusDirtyRef.current) {
        setPlatformStatusState((current) => ({
          ...current,
          selfServiceVmAllowedFlavors: result.allowedFlavors || current.selfServiceVmAllowedFlavors,
          selfServiceVmAllowedImages: allowedImages,
          selfServiceVmAllowedProjects: allowedProjects,
        }));
      }
      setSelfServiceVmForm((current) => ({
        projectName: allowedProjects.includes(current.projectName) ? current.projectName : allowedProjects[0] || "",
        networkName: current.networkName || "net-infra",
        imageName: allowedImages.includes(current.imageName) ? current.imageName : allowedImages[0] || "",
        flavor: current.flavor || result.allowedFlavors?.[0] || "m1.tiny",
        instanceCount: current.instanceCount || "1",
        cloudInitMode: current.cloudInitMode || (current.cloudInitCustomContent ? "custom" : current.cloudInitTemplateName ? "template" : "none"),
        cloudInitTemplateName: current.cloudInitTemplateName || "",
        cloudInitCustomContent: current.cloudInitCustomContent || "",
        cloudInitCustomFileName: current.cloudInitCustomFileName || "",
        bootFromVolume: Boolean(current.bootFromVolume),
        bootVolumeSizeGb: current.bootVolumeSizeGb || "20",
        bootVolumeType: current.bootVolumeType || "",
        dataVolumeEnabled: Boolean(current.dataVolumeEnabled),
        dataVolumeCount: current.dataVolumeCount || "1",
        dataVolumeSizeGb: current.dataVolumeSizeGb || "20",
        dataVolumeType: current.dataVolumeType || "",
        floatingIpRequested: Boolean(current.floatingIpRequested),
        publicAccessNote: current.publicAccessNote || "",
      }));
    }
  }
  async function loadCloudInitTemplates(cancelled = false) {
    const result = await api("/api/cloud-init-templates").catch(() => ({ items: [] }));
    if (!cancelled) {
      setAdminCloudInitTemplates(result.items || []);
      setCustomLabForm((current) => ({ ...current, cloudInitTemplateName: current.cloudInitTemplateName || "" }));
      setSelfServiceVmForm((current) => ({ ...current, cloudInitTemplateName: current.cloudInitTemplateName || "" }));
    }
  }
  async function loadZunContainers(cancelled = false) {
    const result = await api("/api/zun/containers");
    if (!cancelled) setZunContainers(result.containers || []);
  }
  async function loadMagnumClusters(cancelled = false) {
    const [clustersResult, templatesResult] = await Promise.all([
      api("/api/magnum/clusters"),
      api("/api/magnum/templates").catch(() => ({ templates: [] })),
    ]);
    if (cancelled) return;
    const templates = templatesResult.templates || [];
    setMagnumClusters(clustersResult.clusters || []);
    setMagnumTemplates(templates);
    if (templatesResult.available === false && templatesResult.message) {
      setMagnumStatus({ tone: "warn", message: templatesResult.message });
    }
    setMagnumForm((current) => {
      const selected = templates.find((item) => item.id === current.clusterTemplateId);
      const fallback = templates[0] || null;
      const template = selected || fallback;
      const versions = Array.isArray(template?.kubernetesVersions) ? template.kubernetesVersions : [];
      const allowedControlPlaneFlavors = Array.isArray(template?.allowedControlPlaneFlavors) ? template.allowedControlPlaneFlavors : [];
      const allowedWorkerFlavors = Array.isArray(template?.allowedWorkerFlavors) ? template.allowedWorkerFlavors : [];
      const currentVersionAllowed = versions.some((entry) => entry.minor === current.kubernetesVersion || entry.version === current.kubernetesVersion);
      const currentControlPlaneFlavorAllowed = allowedControlPlaneFlavors.includes(current.controlPlaneFlavor);
      const currentWorkerFlavorAllowed = allowedWorkerFlavors.includes(current.workerFlavor);
      return {
        ...current,
        clusterTemplateId: template?.id || "",
        clusterTemplateName: template?.name || "",
        kubernetesVersion: currentVersionAllowed
          ? current.kubernetesVersion
          : template?.defaultKubernetesVersion || versions[0]?.minor || "",
        controlPlaneFlavor: currentControlPlaneFlavorAllowed
          ? current.controlPlaneFlavor
          : template?.masterFlavorId || allowedControlPlaneFlavors[0] || "",
        workerFlavor: currentWorkerFlavorAllowed
          ? current.workerFlavor
          : template?.flavorId || allowedWorkerFlavors[0] || "",
      };
    });
  }
  async function loadTroveInstances(cancelled = false) {
    const [instancesResult, datastoresResult] = await Promise.all([
      api("/api/trove/instances"),
      api("/api/trove/datastores").catch(() => ({ datastores: [] })),
    ]);
    if (cancelled) return;
    const datastores = datastoresResult.datastores || [];
    setTroveInstances(instancesResult.instances || []);
    setTroveDatastores(datastores);
    if (datastoresResult.available === false && datastoresResult.message) {
      setTroveStatus({ tone: "warn", message: datastoresResult.message });
    }
    setTroveForm((current) => ({
      ...current,
      datastoreType: current.datastoreType || datastores[0]?.name || platformStatus.troveAllowedDatastores?.[0] || "mysql",
      flavor: current.flavor || platformStatus.troveAllowedFlavors?.[0] || "m1.small",
      sizeGb: current.sizeGb || String(platformStatus.troveAllowedSizesGb?.[0] || 5),
    }));
  }
  async function loadWrittenExams(cancelled = false) {
    const result = await api(session?.role === "admin" ? "/api/admin/written-exams" : "/api/written-exams");
    if (cancelled) return;
    const exams = result.exams || [];
    setWrittenExams(exams);
  }
  async function loadLabExams(cancelled = false, user = session) {
    const isAdminView = typeof window !== "undefined" && window.location.pathname === "/admin";
    const result = await api(user?.role === "admin" || isAdminView ? "/api/admin/lab-exams" : "/api/lab-exams");
    if (cancelled) return;
    setLabExams(result.exams || []);
    setLabExamSessions(result.sessions || []);
    if (user?.role === "admin" || isAdminView) {
      setAdminLabExamAttempts(result.attempts || []);
      setAdminLabExamSessions(result.sessions || []);
    }
  }
  async function loadCertificates(cancelled = false) {
    const result = await api("/api/certificates");
    if (cancelled) return;
    setCertificates(result.certificates || []);
    setCertificateLeaderboard(result.leaderboard || []);
    setEligibleCertificates(result.eligibleCourses || []);
    setMyCertificateTier(result.myTier || EMPTY_CERTIFICATE_TIER);
  }
  async function loadPayments(cancelled = false) {
    const result = await api(session?.role === "admin" ? "/api/admin/payments" : "/api/payments");
    if (cancelled) return;
    if (session?.role === "admin") {
      setAdminPayments(result.payments || []);
    } else {
      setPayments(result.payments || []);
    }
  }
  async function loadCourseQuotes(cancelled = false) {
    if (!canUseCourseQuotePortal(platformStatusRef.current, isAdmin)) {
      if (!cancelled) setCourseQuotes([]);
      return [];
    }
    const result = await api("/api/course-quotes");
    if (cancelled) return result.quotes || [];
    setCourseQuotes(result.quotes || []);
    return result.quotes || [];
  }
  async function loadNotices(cancelled = false) {
    const result = await api("/api/notices");
    if (!cancelled) setNotices(result.notices);
  }
  async function loadNotifications(cancelled = false, options = {}) {
    if (!session) return;
    const silent = Boolean(options?.silent);
    try {
      const result = await api("/api/notifications?limit=100");
      if (!cancelled) {
        setNotifications(result.notifications || []);
        if (!silent) setNotificationStatus(EMPTY_NOTIFICATION_STATUS);
      }
    } catch (error) {
      if (!cancelled && !silent) {
        setNotifications([]);
        setNotificationStatus({ tone: "error", message: error.message || "알림을 불러오지 못했습니다." });
      }
    }
  }
  async function loadLuckyDraw(cancelled = false) {
    if (!session) return;
    try {
      const result = await api("/api/lucky-draw");
      if (!cancelled) {
        setLuckyDrawOverview(result || { event: null, rewards: [], attempts: [], grants: [], remainingAttempts: 0 });
        setLuckyDrawStatus(EMPTY_NOTIFICATION_STATUS);
      }
    } catch (error) {
      if (!cancelled) {
        setLuckyDrawOverview({ event: null, rewards: [], attempts: [], grants: [], remainingAttempts: 0 });
        setLuckyDrawStatus({ tone: "error", message: error.message || "무료 강의 뽑기 정보를 불러오지 못했습니다." });
      }
    }
  }
  async function loadCoupons(cancelled = false) {
    if (!session) return;
    try {
      const result = await api("/api/coupons");
      if (!cancelled) setCoupons(result.coupons || []);
    } catch {
      if (!cancelled) setCoupons([]);
    }
  }
  async function loadAdminCoupons(cancelled = false) {
    try {
      const result = await api("/api/admin/coupons");
      if (!cancelled) setAdminCoupons(result.coupons || []);
    } catch {
      if (!cancelled) setAdminCoupons([]);
    }
  }
  async function loadMessages(cancelled = false, options = {}) {
    if (!session) return;
    const silent = Boolean(options?.silent);
    try {
      const result = await api("/api/messages");
      if (!cancelled) {
        setMessages(result.messages || []);
        if (!silent) setMessageStatus(EMPTY_NOTIFICATION_STATUS);
      }
    } catch (error) {
      if (!cancelled && !silent) {
        setMessages([]);
        setMessageStatus({ tone: "error", message: error.message || "쪽지함을 불러오지 못했습니다." });
      }
    }
  }
  async function loadMessageRecipients(cancelled = false) {
    if (!session) return;
    try {
      const result = await api("/api/messages/recipients");
      if (!cancelled) {
        const recipients = Array.isArray(result.recipients) ? result.recipients : [];
        const normalizedRecipients = recipients.length
          ? recipients
          : [{
              id: "group:support",
              name: platformStatus?.supportMessageGroupName || "운영지원",
              username: "support",
              role: "group",
              recipientType: "group",
              groupKey: "support",
              groupName: platformStatus?.supportMessageGroupName || "운영지원",
              memberCount: 0,
              representativeUsername: "",
              representativeName: "",
            }];
        const supportRecipient = normalizedRecipients.find((item) => String(item.id || "").trim() === "group:support");
        setMessageRecipients(normalizedRecipients);
        setMessageForm((current) => {
          const currentRecipientId = String(current?.recipientId || "").trim();
          if (currentRecipientId) return current;
          if (supportRecipient) {
            return { ...current, recipientId: "group:support" };
          }
          return current;
        });
      }
    } catch {
      if (!cancelled) setMessageRecipients([]);
    }
  }
  async function loadPlatformStatus(cancelled = false, options = {}) {
    const result = await api("/api/platform-status");
    if (!cancelled && (!platformStatusDirtyRef.current || options.force)) replacePlatformStatus(result, { markDirty: false });
  }
  async function loadCurrentTerms(cancelled = false) {
    const result = await api("/api/terms/current").catch(() => ({ terms: [] }));
    if (!cancelled) setActiveTerms(result.termsEnabled === false ? [] : result.terms || []);
  }
  async function loadQuotaStatus(cancelled = false, user = session) {
    if (!user) return;
    const result = await api("/api/quota-status");
    if (!cancelled) {
      setQuotaStatus(result || EMPTY_QUOTA_STATUS);
      if (result?.circuitBreaker && !platformStatusDirtyRef.current) {
        setPlatformStatusState((current) => ({
          ...current,
          labCircuitBreaker: Boolean(result.circuitBreaker.blocked),
          labCircuitBreakerMessage: result.circuitBreaker.blocked
            ? result.circuitBreaker.message || current.labCircuitBreakerMessage
            : current.labCircuitBreaker ? "" : current.labCircuitBreakerMessage,
          labCircuitBreakerSource: result.circuitBreaker.blocked ? result.circuitBreaker.source || "quota" : "",
          labCircuitBreakerTriggeredAt: result.circuitBreaker.blocked ? result.circuitBreaker.triggeredAt || current.labCircuitBreakerTriggeredAt : "",
          labCircuitBreakerMetric: result.circuitBreaker.blocked ? result.circuitBreaker.metric || current.labCircuitBreakerMetric : "",
          labCircuitBreakerUsagePercent: result.circuitBreaker.blocked ? result.circuitBreaker.usagePercent || current.labCircuitBreakerUsagePercent : 0,
          labAutoCircuitBreakerEnabled: result.circuitBreaker.autoEnabled !== false,
          labAutoCircuitBreakerThresholdPercent: result.circuitBreaker.thresholdPercent || current.labAutoCircuitBreakerThresholdPercent,
        }));
      }
    }
  }
  async function loadLlmQuotaStatus(cancelled = false, user = session) {
    if (!user) return;
    const result = await api("/api/llm/quota-status");
    if (!cancelled) setLlmQuotaStatus(result || EMPTY_LLM_QUOTA_STATUS);
  }
  async function loadAccessStats(cancelled = false, user = session) {
    if (!user) return;
    try {
      const result = await api("/api/access-stats");
      if (cancelled) return;
      const nextStats = { ...EMPTY_ACCESS_STATS, ...(result || {}) };
      setAdminAccessStats((current) => ({ ...current, ...nextStats }));
      setApiMonitor((current) => ({
        ...(current || EMPTY_API_MONITOR),
        access: { ...((current || EMPTY_API_MONITOR).access || {}), ...nextStats },
      }));
    } catch {
      if (!cancelled) setAdminAccessStats((current) => current || EMPTY_ACCESS_STATS);
    }
  }
  async function loadApiMonitor(cancelled = false, force = false) {
    const result = await api(force ? "/api/admin/api-status?force=1" : "/api/admin/api-status");
    if (!cancelled) setApiMonitor(result || EMPTY_API_MONITOR);
  }
  async function loadAdminInstanceMonitor(cancelled = false, force = false) {
    const result = await api(force ? "/api/admin/instance-monitor?force=1" : "/api/admin/instance-monitor");
    if (!cancelled) setAdminInstanceMonitor(result || { ok: false, items: [], totals: {} });
  }
  async function loadMyAccessLogs(cancelled = false) {
    if (!session) return;
    try {
      const result = await api("/api/auth/access-logs?limit=20");
      if (!cancelled) setMyAccessLogs(result.logs || []);
    } catch {
      if (!cancelled) setMyAccessLogs([]);
    }
  }
  async function onRefreshNotifications() {
    try {
      await loadNotifications();
      pushToast("알림을 새로고침했습니다.", "success");
      setNotificationStatus({ tone: "success", message: "알림을 새로고침했습니다." });
    } catch (error) {
      setNotificationStatus({ tone: "error", message: error.message || "알림을 새로고침하지 못했습니다." });
      pushToast(error.message || "알림을 새로고침하지 못했습니다.", "error");
    }
  }
  async function onMarkNotificationRead(notificationId) {
    try {
      const result = await api(`/api/notifications/${notificationId}/read`, { method: "POST" });
      setNotifications(result.notifications || []);
      setNotificationStatus(EMPTY_NOTIFICATION_STATUS);
    } catch (error) {
      setNotificationStatus({ tone: "error", message: error.message || "알림 읽음 처리 중 오류가 발생했습니다." });
      pushToast(error.message || "알림 읽음 처리 중 오류가 발생했습니다.", "error");
    }
  }
  async function onMarkAllNotificationsRead() {
    try {
      const result = await api("/api/notifications/read-all", { method: "POST" });
      setNotifications(result.notifications || []);
      setNotificationStatus({ tone: "success", message: result.message || "모든 알림을 읽음 처리했습니다." });
      pushToast(result.message || "모든 알림을 읽음 처리했습니다.", "success");
    } catch (error) {
      setNotificationStatus({ tone: "error", message: error.message || "전체 읽음 처리 중 오류가 발생했습니다." });
      pushToast(error.message || "전체 읽음 처리 중 오류가 발생했습니다.", "error");
    }
  }
  async function onDeleteNotification(notificationId) {
    try {
      const result = await api(`/api/notifications/${notificationId}`, { method: "DELETE" });
      setNotifications(result.notifications || []);
      setNotificationStatus({ tone: "success", message: result.message || "알림을 지웠습니다." });
      pushToast(result.message || "알림을 지웠습니다.", "success");
    } catch (error) {
      setNotificationStatus({ tone: "error", message: error.message || "알림 삭제 중 오류가 발생했습니다." });
      pushToast(error.message || "알림 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onClearNotifications() {
    try {
      const result = await api("/api/notifications", { method: "DELETE" });
      setNotifications(result.notifications || []);
      setNotificationStatus({ tone: "success", message: result.message || "알림을 모두 지웠습니다." });
      pushToast(result.message || "알림을 모두 지웠습니다.", "success");
    } catch (error) {
      setNotificationStatus({ tone: "error", message: error.message || "알림 전체 삭제 중 오류가 발생했습니다." });
      pushToast(error.message || "알림 전체 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onAttemptLuckyDraw() {
    try {
      const result = await api("/api/lucky-draw/attempt", { method: "POST" });
      await runSafeRefreshTasks([loadLuckyDraw(), loadCourses(), loadCoupons(), loadNotifications()]);
      setLuckyDrawStatus({ tone: "success", message: result.reward?.label || result.message || "무료 강의 뽑기 참여가 완료되었습니다." });
      pushToast(result.reward?.label || result.message || "무료 강의 뽑기 참여가 완료되었습니다.", "success");
    } catch (error) {
      setLuckyDrawStatus({ tone: "error", message: error.message || "무료 강의 뽑기 참여에 실패했습니다." });
      pushToast(error.message || "무료 강의 뽑기 참여에 실패했습니다.", "error");
    }
  }
  async function onSaveLuckyDrawEvent(event) {
    event.preventDefault();
    try {
      const normalizedStartAt = luckyDrawEventForm.startAt ? new Date(luckyDrawEventForm.startAt).toISOString() : "";
      const normalizedEndAt = luckyDrawEventForm.endAt ? new Date(luckyDrawEventForm.endAt).toISOString() : "";
      const body = {
        title: luckyDrawEventForm.title,
        description: luckyDrawEventForm.description,
        status: luckyDrawEventForm.status,
        timezone: luckyDrawEventForm.timezone,
        startAt: normalizedStartAt,
        endAt: normalizedEndAt,
        dailyAttemptLimit: Number(luckyDrawEventForm.dailyAttemptLimit || 3),
        requireVerifiedUser: luckyDrawEventForm.requireVerifiedUser,
        allowNewUsersOnly: luckyDrawEventForm.allowNewUsersOnly,
        newUserWindowDays: Number(luckyDrawEventForm.newUserWindowDays || 30),
        allowDormantUsersOnly: luckyDrawEventForm.allowDormantUsersOnly,
        dormantDays: Number(luckyDrawEventForm.dormantDays || 30),
      };
      const result = luckyDrawEventForm.id
        ? await api(`/api/admin/lucky-draw/events/${luckyDrawEventForm.id}`, { method: "PATCH", body })
        : await api("/api/admin/lucky-draw/events", { method: "POST", body });
      setAdminStatus(result.message || "무료 강의 뽑기 이벤트를 저장했습니다.");
      pushToast(result.message || "무료 강의 뽑기 이벤트를 저장했습니다.", "success");
      setLuckyDrawEventForm(EMPTY_LUCKY_DRAW_EVENT_FORM);
      await runSafeRefreshTasks([loadAdminLuckyDraw(), loadLuckyDraw()]);
      return true;
    } catch (error) {
      setAdminStatus(error.message || "무료 강의 뽑기 이벤트 저장 중 오류가 발생했습니다.");
      pushToast(error.message || "무료 강의 뽑기 이벤트 저장 중 오류가 발생했습니다.", "error");
      return false;
    }
  }
  function onCancelLuckyDrawEventEdit() {
    setLuckyDrawEventForm(EMPTY_LUCKY_DRAW_EVENT_FORM);
  }
  function onEditLuckyDrawEvent(item) {
    if (!item) return;
    const toLocalInput = (value) => {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      const pad = (number) => String(number).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    setLuckyDrawEventForm({
      id: item.id,
      title: item.title || "",
      description: item.description || "",
      status: item.status || "draft",
      timezone: item.timezone || "Asia/Seoul",
      startAt: toLocalInput(item.startAt),
      endAt: toLocalInput(item.endAt),
      dailyAttemptLimit: String(item.dailyAttemptLimit || 3),
      requireVerifiedUser: item.requireVerifiedUser !== false,
      allowNewUsersOnly: item.allowNewUsersOnly === true,
      newUserWindowDays: String(item.newUserWindowDays || 30),
      allowDormantUsersOnly: item.allowDormantUsersOnly === true,
      dormantDays: String(item.dormantDays || 30),
    });
  }
  async function onDeleteLuckyDrawEvent(id) {
    try {
      const result = await api(`/api/admin/lucky-draw/events/${id}`, { method: "DELETE" });
      setAdminStatus(result.message || "무료 강의 뽑기 이벤트를 삭제했습니다.");
      pushToast(result.message || "무료 강의 뽑기 이벤트를 삭제했습니다.", "success");
      if (String(luckyDrawEventForm.id || "") === String(id)) {
        setLuckyDrawEventForm(EMPTY_LUCKY_DRAW_EVENT_FORM);
      }
      if (String(luckyDrawRewardForm.eventId || "") === String(id)) {
        setLuckyDrawRewardForm(EMPTY_LUCKY_DRAW_REWARD_FORM);
      }
      await runSafeRefreshTasks([loadAdminLuckyDraw(), loadLuckyDraw()]);
    } catch (error) {
      setAdminStatus(error.message || "무료 강의 뽑기 이벤트 삭제 중 오류가 발생했습니다.");
      pushToast(error.message || "무료 강의 뽑기 이벤트 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  function onStartLuckyDrawRewardCreate(item) {
    setLuckyDrawRewardForm({
      ...EMPTY_LUCKY_DRAW_REWARD_FORM,
      eventId: String(item?.id || ""),
    });
  }
  function onEditLuckyDrawReward(item, eventId = null) {
    if (!item) return;
    setLuckyDrawRewardForm({
      id: item.id ?? null,
      eventId: String(eventId ?? item.eventId ?? ""),
      label: item.label || "",
      rewardType: item.rewardType || "message",
      courseId: item.courseId != null ? String(item.courseId) : "",
      couponDiscountType: item.couponDiscountType || "percent",
      couponDiscountValue: String(item.couponDiscountValue ?? 0),
      couponExpiresInDays: String(item.couponExpiresInDays ?? 7),
      probabilityWeight: String(item.probabilityWeight ?? 1),
      totalStock: item.totalStock == null ? "" : String(item.totalStock),
      dailyStock: item.dailyStock == null ? "" : String(item.dailyStock),
      perUserLimit: String(item.perUserLimit ?? 1),
      messageText: item.messageText || "",
      isActive: item.isActive !== false,
    });
  }
  function onCancelLuckyDrawRewardCreate() {
    setLuckyDrawRewardForm(EMPTY_LUCKY_DRAW_REWARD_FORM);
  }
  async function onSaveLuckyDrawReward(event) {
    event.preventDefault();
    try {
      const body = {
        rewardType: luckyDrawRewardForm.rewardType,
        label: luckyDrawRewardForm.label,
        courseId: luckyDrawRewardForm.courseId ? Number(luckyDrawRewardForm.courseId) : null,
        couponDiscountType: luckyDrawRewardForm.couponDiscountType,
        couponDiscountValue: Number(luckyDrawRewardForm.couponDiscountValue || 0),
        couponExpiresInDays: Number(luckyDrawRewardForm.couponExpiresInDays || 7),
        probabilityWeight: Number(luckyDrawRewardForm.probabilityWeight || 1),
        totalStock: luckyDrawRewardForm.totalStock === "" ? null : Number(luckyDrawRewardForm.totalStock),
        dailyStock: luckyDrawRewardForm.dailyStock === "" ? null : Number(luckyDrawRewardForm.dailyStock),
        perUserLimit: Number(luckyDrawRewardForm.perUserLimit || 1),
        messageText: luckyDrawRewardForm.messageText,
        isActive: luckyDrawRewardForm.isActive,
      };
      const result = luckyDrawRewardForm.id
        ? await api(`/api/admin/lucky-draw/rewards/${luckyDrawRewardForm.id}`, { method: "PATCH", body })
        : await api(`/api/admin/lucky-draw/events/${luckyDrawRewardForm.eventId}/rewards`, { method: "POST", body });
      setAdminStatus(result.message || (luckyDrawRewardForm.id ? "보상을 수정했습니다." : "보상을 추가했습니다."));
      pushToast(result.message || (luckyDrawRewardForm.id ? "보상을 수정했습니다." : "보상을 추가했습니다."), "success");
      setLuckyDrawRewardForm(EMPTY_LUCKY_DRAW_REWARD_FORM);
      await runSafeRefreshTasks([loadAdminLuckyDraw(), loadLuckyDraw()]);
      return true;
    } catch (error) {
      setAdminStatus(error.message || (luckyDrawRewardForm.id ? "보상 수정 중 오류가 발생했습니다." : "보상 추가 중 오류가 발생했습니다."));
      pushToast(error.message || (luckyDrawRewardForm.id ? "보상 수정 중 오류가 발생했습니다." : "보상 추가 중 오류가 발생했습니다."), "error");
      return false;
    }
  }
  async function onRefreshMessages() {
    try {
      await runSafeRefreshTasks([loadMessages(), loadMessageRecipients()]);
      setMessageStatus({ tone: "success", message: "쪽지함을 새로고침했습니다." });
      pushToast("쪽지함을 새로고침했습니다.", "success");
    } catch (error) {
      setMessageStatus({ tone: "error", message: error.message || "쪽지함을 새로고침하지 못했습니다." });
      pushToast(error.message || "쪽지함을 새로고침하지 못했습니다.", "error");
    }
  }
  function onStartMessageReply(message) {
    if (!message) return;
    const currentUserId = Number(session?.id || 0);
    const senderId = Number(message.senderId || 0);
    const recipientId = Number(message.recipientId || 0);
    const recipientType = String(message.recipientType || "").trim().toLowerCase();
    const recipientGroupKey = String(message.recipientGroupKey || "").trim().toLowerCase();
    const sentByCurrentUser = currentUserId > 0 && senderId === currentUserId;
    const addressedToCurrentUser = currentUserId > 0 && recipientId === currentUserId;
    const addressedToSupportGroup = recipientType === "group" && recipientGroupKey === "support";
    const isIncoming = !sentByCurrentUser && (addressedToCurrentUser || addressedToSupportGroup);
    const replyRecipientId = String(
      isIncoming
        ? message.senderId
        : message.recipientType === "group"
          ? `group:${message.recipientGroupKey || "support"}`
          : message.recipientId,
    ).trim();
    const counterpartLabel = isIncoming
      ? `${message.senderName || message.senderUsername} (${message.senderUsername})`
      : message.recipientType === "group"
        ? `${message.recipientGroupName || message.recipientName || platformStatus?.supportMessageGroupName || "운영지원"} 그룹`
        : `${message.recipientName || message.recipientUsername} (${message.recipientUsername})`;
    const quotedBody = String(message.body || "").trim();
    setMessageForm({
      recipientId: replyRecipientId,
      subject: String(message.subject || "").startsWith("RE:") ? String(message.subject || "") : `RE: ${message.subject || "쪽지"}`,
      body: quotedBody ? `\n\n---\n${quotedBody}` : "",
      replyToMessageId: Number(message.id || 0) || null,
      replyToLabel: counterpartLabel,
      replyToPreview: quotedBody.slice(0, 180),
    });
    setMessageStatus(EMPTY_NOTIFICATION_STATUS);
  }
  function onCancelMessageReply() {
    setMessageForm((current) => ({
      ...current,
      subject: "",
      body: "",
      replyToMessageId: null,
      replyToLabel: "",
      replyToPreview: "",
    }));
  }
  async function onSendDirectMessage(payload = {}) {
    const recipientId = String(payload.recipientId || "").trim();
    const subject = String(payload.subject || "").trim();
    const body = String(payload.body || "").trim();
    if (!recipientId) {
      const error = new Error("받는 사람을 선택해 주세요.");
      setMessageStatus({ tone: "error", message: error.message });
      throw error;
    }
    if (!subject || !body) {
      const error = new Error("제목과 내용을 모두 입력해 주세요.");
      setMessageStatus({ tone: "error", message: error.message });
      throw error;
    }
    try {
      const result = await api("/api/messages", {
        method: "POST",
        body: {
          recipientId,
          subject,
          body,
        },
      });
      setMessages(result.messages || []);
      if (isAdmin) {
        const adminResult = await api("/api/admin/messages").catch(() => ({ messages: [] }));
        setAdminMessages(adminResult.messages || []);
      }
      setMessageStatus({ tone: "success", message: result.message || "쪽지를 보냈습니다." });
      pushToast(result.message || "쪽지를 보냈습니다.", "success");
      return result;
    } catch (error) {
      setMessageStatus({ tone: "error", message: error.message || "쪽지를 보내지 못했습니다." });
      pushToast(error.message || "쪽지를 보내지 못했습니다.", "error");
      throw error;
    }
  }
  async function onSendMessage(event) {
    event?.preventDefault?.();
    try {
      const recipientId = String(messageForm.recipientId || "").trim();
      await onSendDirectMessage(messageForm);
      setMessageForm((current) => ({ ...EMPTY_MESSAGE, recipientId: current.recipientId || String(recipientId) }));
    } catch {
      // onSendDirectMessage already updates message status and toast.
    }
  }
  async function onMarkMessageRead(messageId) {
    try {
      const result = await api(`/api/messages/${messageId}/read`, { method: "POST" });
      setMessages(result.messages || []);
      setMessageStatus(EMPTY_NOTIFICATION_STATUS);
    } catch (error) {
      setMessageStatus({ tone: "error", message: error.message || "쪽지를 읽음 처리하지 못했습니다." });
      pushToast(error.message || "쪽지를 읽음 처리하지 못했습니다.", "error");
    }
  }
  async function onArchiveMessage(messageId) {
    try {
      const result = await api(`/api/messages/${messageId}/archive`, { method: "POST" });
      setMessages(result.messages || []);
      setMessageStatus({ tone: "success", message: result.message || "쪽지를 보관했습니다." });
      pushToast(result.message || "쪽지를 보관했습니다.", "success");
      if (isAdmin) {
        const adminResult = await api("/api/admin/messages").catch(() => ({ messages: [] }));
        setAdminMessages(adminResult.messages || []);
      }
    } catch (error) {
      setMessageStatus({ tone: "error", message: error.message || "쪽지를 보관하지 못했습니다." });
      pushToast(error.message || "쪽지를 보관하지 못했습니다.", "error");
    }
  }
  async function onDeleteMessage(messageId) {
    try {
      if (isAdmin) {
        const result = await api(`/api/admin/messages/${messageId}/delete`, { method: "POST" });
        setAdminMessages(result.messages || []);
        setMessageStatus({ tone: "success", message: result.message || "쪽지를 삭제했습니다." });
        pushToast(result.message || "쪽지를 삭제했습니다.", "success");
      } else {
        const result = await api(`/api/messages/${messageId}/delete`, { method: "POST" });
        setMessages(result.messages || []);
        setMessageStatus({ tone: "success", message: result.message || "쪽지를 삭제했습니다." });
        pushToast(result.message || "쪽지를 삭제했습니다.", "success");
      }
    } catch (error) {
      setMessageStatus({ tone: "error", message: error.message || "쪽지를 삭제하지 못했습니다." });
      pushToast(error.message || "쪽지를 삭제하지 못했습니다.", "error");
    }
  }
  async function onUpdateMessageCleanupStatus(messageId, cleanupStatus, cleanupStatusNote = "") {
    try {
      const result = await api(`/api/admin/messages/${messageId}/cleanup-status`, {
        method: "POST",
        body: { cleanupStatus, cleanupStatusNote },
      });
      setAdminMessages(result.messages || []);
      setMessageStatus({ tone: "success", message: result.message || "정리 요청 상태를 저장했습니다." });
      pushToast(result.message || "정리 요청 상태를 저장했습니다.", "success");
    } catch (error) {
      setMessageStatus({ tone: "error", message: error.message || "정리 요청 상태를 저장하지 못했습니다." });
      pushToast(error.message || "정리 요청 상태를 저장하지 못했습니다.", "error");
    }
  }
  async function loadAdminAccessLogs(cancelled = false) {
    try {
      const result = await api("/api/admin/access-logs?limit=200");
      if (!cancelled) {
        setAdminAccessLogs(result.logs || []);
        setAdminAccessLogsStatus({ tone: "", message: "" });
      }
    } catch (error) {
      if (!cancelled) {
        setAdminAccessLogs([]);
        setAdminAccessLogsStatus({ tone: "error", message: error.message || "접속 이력을 불러오지 못했습니다." });
      }
    }
  }
  async function loadAdminMailLogs(cancelled = false) {
    try {
      const result = await api("/api/admin/mail-logs");
      if (!cancelled) {
        setAdminMailLogs(result.logs || []);
        setAdminMailLogsStatus({ tone: "", message: "" });
      }
    } catch (error) {
      if (!cancelled) {
        setAdminMailLogs([]);
        setAdminMailLogsStatus({ tone: "error", message: error.message || "메일 이력을 불러오지 못했습니다." });
      }
    }
  }
  async function loadAdminMailCampaigns(cancelled = false) {
    try {
      const result = await api("/api/admin/mail-campaigns?limit=50");
      if (!cancelled) setAdminMailCampaigns(result.campaigns || []);
    } catch (error) {
      if (!cancelled) {
        setAdminMailCampaigns([]);
        setMailCampaignStatus({ tone: "error", message: error.message || "메일 캠페인을 불러오지 못했습니다." });
      }
    }
  }
  async function loadMailCampaignDetail(campaignId) {
    try {
      const result = await api(`/api/admin/mail-campaigns/${campaignId}`);
      setSelectedMailCampaign(result.campaign || null);
      return result.campaign || null;
    } catch (error) {
      setMailCampaignStatus({ tone: "error", message: error.message || "메일 캠페인 상세를 불러오지 못했습니다." });
      return null;
    }
  }
  async function loadAdminAccessStats(cancelled = false) {
    try {
      const result = await api("/api/admin/access-stats");
      if (!cancelled) {
        setAdminAccessStats(result || EMPTY_ACCESS_STATS);
        setAdminAccessLogsStatus({ tone: "", message: "" });
      }
    } catch (error) {
      if (!cancelled) {
        setAdminAccessStats(EMPTY_ACCESS_STATS);
        setAdminAccessLogsStatus((current) => current.message ? current : { tone: "error", message: error.message || "접속 통계를 불러오지 못했습니다." });
      }
    }
  }
  async function loadAdminLuckyDraw(cancelled = false) {
    try {
      const result = await api("/api/admin/lucky-draw/events");
      if (!cancelled) setAdminLuckyDrawEvents(result.events || []);
    } catch {
      if (!cancelled) setAdminLuckyDrawEvents([]);
    }
  }
  async function onRefreshAdminMailLogs() {
    try {
      await loadAdminMailLogs();
      setAdminStatus("메일 이력을 새로고침했습니다.");
      pushToast("메일 이력을 새로고침했습니다.", "success");
    } catch (error) {
      setAdminStatus(error.message || "메일 이력을 새로고침하지 못했습니다.");
      pushToast(error.message || "메일 이력을 새로고침하지 못했습니다.", "error");
    }
  }
  async function onRefreshAdminAccessLogs() {
    try {
      await runSafeRefreshTasks([loadAdminAccessLogs(), loadAdminAccessStats()]);
      setAdminStatus("접속 이력을 새로고침했습니다.");
      pushToast("접속 이력을 새로고침했습니다.", "success");
    } catch (error) {
      setAdminStatus(error.message || "접속 이력을 새로고침하지 못했습니다.");
      pushToast(error.message || "접속 이력을 새로고침하지 못했습니다.", "error");
    }
  }
  async function loadServiceValidationStatus(cancelled = false) {
    const result = await api("/api/admin/service-validation-status");
    if (!cancelled) {
      setServiceValidationStatus((current) => ({
        ...EMPTY_SERVICE_VALIDATION_STATUS,
        ...result,
        tone: current?.tone || "",
        message: current?.message || "",
      }));
    }
  }
  async function loadQna(cancelled = false, user = session) {
    if (!user) return;
    const result = await api("/api/qna");
    if (!cancelled) setQnaPosts(result.posts);
  }
  async function loadAdminSnapshot(cancelled = false, user = session) {
    const snapshotApi = (path, fallback, message) => safeAdminApi(path, fallback, message, user);
    const [usersResult, pinsResult, coursesResult, textbooksResult, labsResult, activeLabsResult, accessRequestsResult, surveyResult, paymentsResult, quotesResult, heatTemplatesResult, applicationYamlsResult, cloudInitTemplatesResult, labDomainsResult, customLabRequestsResult, consultingRequestsResult, logsResult, auditLogsResult, b2bReportResult, apiStatusResult, instanceMonitorResult, invitesResult, selfServiceVmResult, zunContainersResult, magnumClustersResult, troveInstancesResult, serviceValidationResult, certificatesResult, mailLogsResult, messagesResult, accessLogsResult, accessStatsResult, luckyDrawResult, couponsResult, arenaOverviewResult] = await runTaskFactoriesWithConcurrency([
      () => snapshotApi("/api/admin/users", { users: [] }, "사용자 목록을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/password-reset-pins", { pins: [] }, "비밀번호 재설정 PIN 목록을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/courses", { courses: [] }, "과정 목록을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/textbooks", { textbooks: [] }, "교재 목록을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/labs?limit=250", { labs: [] }, "랩 요청 목록을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/labs?activeOnly=true&limit=250", { labs: [] }, "실행 중인 랩 목록을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/course-access-requests", { requests: [] }, "과정 승인 요청을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/course-surveys", { responses: [], summary: [] }, "과정 설문을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/payments", { payments: [] }, "결제 이력을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/course-quotes", { quotes: [] }, "견적서 이력을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/heat-templates", { templates: [] }, "Heat 템플릿을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/application-yamls", { items: [] }, "Application YAML 목록을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/cloud-init-templates", { items: [] }, "cloud-init 템플릿을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/lab-domains", { routes: [] }, "도메인 승인 목록을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/custom-lab-requests", { requests: [] }, "고급 랩 요청을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/consulting-requests", { requests: [] }, "운영지원 요청을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/logs", { logs: [] }, "시스템 로그를 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/audit-logs?limit=200", { logs: [] }, "관리자 감사 로그를 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/reports/b2b-summary", { report: null }, "B2B 리포트를 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/api-status?light=1", { ...EMPTY_API_MONITOR }, "서비스 대시보드를 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/instance-monitor", { ok: false, items: [], totals: {} }, "인스턴스 모니터링 데이터를 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/invites", { invites: [] }, "초대 코드를 불러오지 못했습니다."),
      () => snapshotApi("/api/self-service-vms", { vms: [] }, "사용자화 가상머신 목록을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/zun-containers", { containers: [] }, "컨테이너 목록을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/magnum-clusters", { clusters: [] }, "쿠버네티스 클러스터 목록을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/trove-instances", { instances: [] }, "DB 인스턴스 목록을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/service-validation-status", { ...EMPTY_SERVICE_VALIDATION_STATUS }, "검증 자원 상태를 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/certificates", { certificates: [] }, "자격증 목록을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/mail-logs", { logs: [] }, "메일 이력을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/messages", { messages: [] }, "쪽지 이력을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/access-logs?limit=200", { logs: [] }, "접속 이력을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/access-stats", { ...EMPTY_ACCESS_STATS }, "접속 통계를 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/lucky-draw/events", { events: [] }, "무료 강의 뽑기 이벤트를 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/coupons", { coupons: [] }, "쿠폰 목록을 불러오지 못했습니다."),
      () => snapshotApi("/api/admin/arena/overview", { ...EMPTY_ADMIN_ARENA_OVERVIEW }, "아레나 개요를 불러오지 못했습니다."),
    ], 5);
    if (cancelled) return;
    const heatTemplates = heatTemplatesResult.templates || [];
    const cloudInitTemplates = cloudInitTemplatesResult.items || [];
    setAdminUsers(usersResult.users || []);
    setAdminPasswordResetPins(pinsResult.pins || []);
    setAdminCourses(coursesResult.courses || []);
    setAdminTextbooks(textbooksResult.textbooks || []);
    setAdminLabs([...(labsResult.labs || []), ...(activeLabsResult.labs || [])].reduce((labs, lab) => (
      labs.some((item) => Number(item.id) === Number(lab.id)) ? labs : [...labs, lab]
    ), []));
    setAdminCourseAccessRequests(accessRequestsResult.requests || []);
    setAdminSurveyResponses(surveyResult.responses || []);
    setAdminSurveySummary(surveyResult.summary || []);
    setAdminPayments(paymentsResult.payments || []);
    setAdminCourseQuotes(quotesResult.quotes || []);
    setAdminHeatTemplates(heatTemplates);
    setAdminApplicationYamls(applicationYamlsResult.items || []);
    setAdminCloudInitTemplates(cloudInitTemplates);
    setAdminLabDomains(labDomainsResult.routes || []);
    setAdminCustomLabRequests(customLabRequestsResult.requests || []);
    setAdminConsultingRequests(consultingRequestsResult.requests || []);
    setAdminPublicQuoteInquiries(consultingRequestsResult.publicQuoteInquiries || []);
    setAdminLogs(logsResult.logs || []);
    setAdminAuditLogs(auditLogsResult.logs || []);
    setAdminB2bReport(b2bReportResult.report || null);
    setApiMonitor(apiStatusResult || EMPTY_API_MONITOR);
    setAdminInstanceMonitor(instanceMonitorResult || { ok: false, items: [], totals: {} });
    setAdminInvites(invitesResult.invites || []);
    setSelfServiceVms(selfServiceVmResult.vms || []);
    setSelfServiceProjectRequests(selfServiceVmResult.projectRequests || []);
    setZunContainers(zunContainersResult.containers || []);
    setMagnumClusters(magnumClustersResult.clusters || []);
    setTroveInstances(troveInstancesResult.instances || []);
    setServiceValidationStatus((current) => ({
      ...EMPTY_SERVICE_VALIDATION_STATUS,
      ...serviceValidationResult,
      tone: current?.tone || "",
      message: current?.message || "",
    }));
    setAdminCertificates(certificatesResult.certificates || []);
    setAdminMailLogs(mailLogsResult.logs || []);
    setAdminMessages(messagesResult.messages || []);
    setAdminAccessLogs(accessLogsResult.logs || []);
    setAdminAccessStats(accessStatsResult || EMPTY_ACCESS_STATS);
    setAdminLuckyDrawEvents(luckyDrawResult.events || []);
    setAdminCoupons(couponsResult.coupons || []);
    setAdminArenaOverview(arenaOverviewResult || EMPTY_ADMIN_ARENA_OVERVIEW);
    const adminLoadErrorCount = [
      usersResult,
      pinsResult,
      coursesResult,
      textbooksResult,
      labsResult,
      accessRequestsResult,
      paymentsResult,
      quotesResult,
      heatTemplatesResult,
      applicationYamlsResult,
      cloudInitTemplatesResult,
      labDomainsResult,
      customLabRequestsResult,
      consultingRequestsResult,
      logsResult,
      auditLogsResult,
      b2bReportResult,
      apiStatusResult,
      invitesResult,
      selfServiceVmResult,
      zunContainersResult,
      magnumClustersResult,
      serviceValidationResult,
      certificatesResult,
      mailLogsResult,
      messagesResult,
      accessLogsResult,
      accessStatsResult,
      luckyDrawResult,
      couponsResult,
      arenaOverviewResult,
    ].filter((item) => item?.__error).length;
    if (adminLoadErrorCount > 0) {
      setAdminStatus(`일부 관리자 데이터를 불러오지 못했습니다. (${adminLoadErrorCount}건)`);
    } else {
      setAdminStatus((current) => current.startsWith("일부 관리자 데이터를 불러오지 못했습니다.") ? "" : current);
    }
    setAdminMailLogsStatus(mailLogsResult.__error ? { tone: "error", message: mailLogsResult.__error } : { tone: "", message: "" });
    setAdminAccessLogsStatus(
      accessLogsResult.__error
        ? { tone: "error", message: accessLogsResult.__error }
        : accessStatsResult.__error
          ? { tone: "error", message: accessStatsResult.__error }
          : { tone: "", message: "" },
    );
    setHeatTemplateForm((current) => current.content ? current : (heatTemplates[0] ?? EMPTY_TEMPLATE));
    setCloudInitTemplateForm((current) => current.content ? current : (cloudInitTemplates[0] ?? EMPTY_CLOUD_INIT_TEMPLATE));
  }

  async function loadAdminOperationalSnapshot(cancelled = false) {
    const [labsResult, activeLabsResult, accessRequestsResult, labDomainsResult, customLabRequestsResult, selfServiceVmResult, instanceMonitorResult, accessStatsResult] = await runTaskFactoriesWithConcurrency([
      () => safeAdminApi("/api/admin/labs?limit=250", { labs: [] }, "랩 요청 목록을 불러오지 못했습니다."),
      () => safeAdminApi("/api/admin/labs?activeOnly=true&limit=250", { labs: [] }, "실행 중인 랩 목록을 불러오지 못했습니다."),
      () => safeAdminApi("/api/admin/course-access-requests", { requests: [] }, "과정 승인 요청을 불러오지 못했습니다."),
      () => safeAdminApi("/api/admin/lab-domains", { routes: [] }, "도메인 승인 목록을 불러오지 못했습니다."),
      () => safeAdminApi("/api/admin/custom-lab-requests", { requests: [] }, "고급 랩 요청을 불러오지 못했습니다."),
      () => safeAdminApi("/api/self-service-vms", { vms: [] }, "사용자화 가상머신 목록을 불러오지 못했습니다."),
      () => safeAdminApi("/api/admin/instance-monitor", { ok: false, items: [], totals: {} }, "인스턴스 모니터링 데이터를 불러오지 못했습니다."),
      () => safeAdminApi("/api/admin/access-stats", { ...EMPTY_ACCESS_STATS }, "접속 통계를 불러오지 못했습니다."),
    ], 4);
    if (cancelled) return;
    if (!labsResult.__error) setAdminLabs([...(labsResult.labs || []), ...(activeLabsResult.labs || [])].reduce((labs, lab) => (
      labs.some((item) => Number(item.id) === Number(lab.id)) ? labs : [...labs, lab]
    ), []));
    if (!accessRequestsResult.__error) setAdminCourseAccessRequests(accessRequestsResult.requests || []);
    if (!labDomainsResult.__error) setAdminLabDomains(labDomainsResult.routes || []);
    if (!customLabRequestsResult.__error) setAdminCustomLabRequests(customLabRequestsResult.requests || []);
    if (!selfServiceVmResult.__error) {
      setSelfServiceVms(selfServiceVmResult.vms || []);
      setSelfServiceProjectRequests(selfServiceVmResult.projectRequests || []);
    }
    if (!instanceMonitorResult.__error) setAdminInstanceMonitor(instanceMonitorResult || { ok: false, items: [], totals: {} });
    if (!accessStatsResult.__error) setAdminAccessStats(accessStatsResult || EMPTY_ACCESS_STATS);
  }

  async function loadAdmin(cancelled = false, user = session) {
    if (adminLoadInFlightRef.current) {
      return adminLoadInFlightRef.current;
    }

    const pending = loadAdminSnapshot(cancelled, user);
    adminLoadInFlightRef.current = pending;
    try {
      return await pending;
    } finally {
      if (adminLoadInFlightRef.current === pending) {
        adminLoadInFlightRef.current = null;
      }
    }
  }

  async function loadAdminApplicationYamls(cancelled = false) {
    const result = await api("/api/admin/application-yamls");
    if (!cancelled) {
      setAdminApplicationYamls(result.items || []);
    }
    return result.items || [];
  }

  async function loadAdminHeatTemplates(cancelled = false) {
    const result = await api("/api/admin/heat-templates");
    if (!cancelled) {
      setAdminHeatTemplates(result.templates || []);
    }
    return result.templates || [];
  }

  async function loadAdminCloudInitTemplates(cancelled = false) {
    const result = await api("/api/admin/cloud-init-templates");
    if (!cancelled) {
      setAdminCloudInitTemplates(result.items || []);
    }
    return result.items || [];
  }

  async function loadAdminArenaOverview(cancelled = false) {
    try {
      const result = await api("/api/admin/arena/overview");
      if (!cancelled) {
        setAdminArenaOverview(result || EMPTY_ADMIN_ARENA_OVERVIEW);
      }
      return result || EMPTY_ADMIN_ARENA_OVERVIEW;
    } catch {
      if (!cancelled) {
        setAdminArenaOverview(EMPTY_ADMIN_ARENA_OVERVIEW);
      }
      return EMPTY_ADMIN_ARENA_OVERVIEW;
    }
  }

  async function loadAdminInvites(cancelled = false) {
    const result = await api("/api/admin/invites");
    if (!cancelled) {
      setAdminInvites(result.invites || []);
    }
    return result.invites || [];
  }

  async function loadAdminCourses(cancelled = false) {
    const result = await api("/api/admin/courses");
    if (!cancelled) {
      setAdminCourses(result.courses || []);
    }
    return result.courses || [];
  }
  async function loadAdminUsers(cancelled = false) {
    const result = await api("/api/admin/users");
    if (!cancelled) {
      setAdminUsers(result.users || []);
    }
    return result.users || [];
  }
  async function loadAdminLabs(cancelled = false, options = null) {
    let isCancelled = Boolean(cancelled);
    let loadOptions = options || {};
    if (cancelled && typeof cancelled === "object") {
      isCancelled = false;
      loadOptions = cancelled;
    }
    const params = new URLSearchParams({ limit: "250" });
    if (loadOptions.includeArchived) params.set("includeArchived", "1");
    if (loadOptions.archivedOnly) params.set("archivedOnly", "1");
    const result = await api(`/api/admin/labs?${params.toString()}`);
    if (!isCancelled) {
      setAdminLabs(result.labs || []);
    }
    return result.labs || [];
  }
  async function loadAdminTextbooks(cancelled = false) {
    const result = await api("/api/admin/textbooks");
    if (!cancelled) {
      setAdminTextbooks(result.textbooks || []);
    }
    return result.textbooks || [];
  }

  function normalizeUserRole(role) {
    const normalized = String(role || "").trim().toLowerCase();
    if (normalized === "관리자") return "admin";
    if (normalized === "학습자") return "student";
    if (normalized === "admin") return "admin";
    if (normalized === "student") return "student";
    return normalized;
  }

  function normalizeUserStatus(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "승인") return "approved";
    if (normalized === "미승인" || normalized === "대기") return "pending";
    return normalized;
  }

  async function onLogin(event) {
    event.preventDefault();
    if (!loginForm.username.trim() || !loginForm.password) return setAuthStatus({ tone: "error", message: "아이디와 비밀번호를 입력해 주세요." });
    try {
      const result = await api("/api/auth/login", { method: "POST", body: loginForm });
      const authenticatedUser = result?.user;
      if (!authenticatedUser) throw new Error("로그인 응답에서 사용자 정보를 받지 못했습니다. 다시 시도해 주세요.");
      setSession(authenticatedUser);
      handleAccountSharingWarning(result.accountSharingWarning);
      setPendingOtpEnrollment(EMPTY_PENDING_OTP_ENROLLMENT);
      setLoginForm({ username: "", password: "", otpCode: "" });
      setAuthStatus({ tone: "success", message: "로그인되었습니다." });
      pushToast("로그인되었습니다.", "success");
      await refreshAll(authenticatedUser);
      if (!userCanAccessAdminConsole(authenticatedUser)) setSection("resources");
      if (route === "admin" && !userCanAccessAdminConsole(authenticatedUser)) navigate("/");
    } catch (error) {
      if (error?.payload?.requiresOtpEnrollment) {
        setPendingOtpEnrollment({
          active: true,
          userId: error.payload?.user?.id || null,
          username: error.payload?.user?.username || loginForm.username.trim(),
          name: error.payload?.user?.name || "",
          role: error.payload?.user?.role || "",
          secret: error.payload?.setup?.secret || "",
          otpauthUrl: error.payload?.setup?.otpauthUrl || "",
          issuerName: error.payload?.setup?.issuerName || platformStatus.otpIssuerName || "KIKI OS TERMINAL-LAB",
          code: "",
        });
        setAuthStatus({ tone: "error", message: error.message });
        pushToast(error.message || "관리자 OTP 등록이 필요합니다.", "error");
        return;
      }
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "로그인 중 오류가 발생했습니다.", "error");
    }
  }
  async function onConfirmPendingOtpEnrollment() {
    if (!pendingOtpEnrollment.active) return;
    try {
      const result = await api("/api/auth/otp/setup/confirm", {
        method: "POST",
        body: { code: pendingOtpEnrollment.code },
      });
      const authenticatedUser = result?.user;
      if (!authenticatedUser) throw new Error("OTP 등록 응답에서 사용자 정보를 받지 못했습니다. 다시 시도해 주세요.");
      setSession(authenticatedUser);
      setPendingOtpEnrollment(EMPTY_PENDING_OTP_ENROLLMENT);
      setLoginForm({ username: "", password: "", otpCode: "" });
      setAuthStatus({ tone: "success", message: result.message || "OTP 등록이 완료되었습니다." });
      pushToast(result.message || "OTP 등록이 완료되었습니다.", "success");
      await refreshAll(authenticatedUser);
      if (!userCanAccessAdminConsole(authenticatedUser)) setSection("resources");
      if (route === "admin" && !userCanAccessAdminConsole(authenticatedUser)) navigate("/");
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "OTP 등록 중 오류가 발생했습니다.", "error");
    }
  }
  async function checkUsername() {
    const username = signupForm.username.trim();
    if (!username) return setSignupCheck({ tone: "error", message: "먼저 아이디를 입력해 주세요." });
    try {
      const result = await api(`/api/auth/check-username?username=${encodeURIComponent(username)}`);
      setSignupCheck({ tone: result.available ? "success" : "error", message: result.message });
    } catch (error) {
      setSignupCheck({ tone: "error", message: error.message });
    }
  }
  async function onSignup(event) {
    event.preventDefault();
    if (!signupForm.name.trim() || !signupForm.email.trim() || !signupForm.username.trim() || !signupForm.password || !signupForm.signupReason.trim()) return setAuthStatus({ tone: "error", message: "모든 항목을 입력해 주세요." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupForm.email.trim())) return setAuthStatus({ tone: "error", message: "유효한 이메일 주소를 입력해 주세요." });
    if (signupForm.password.length < 8) return setAuthStatus({ tone: "error", message: "비밀번호는 8자 이상이어야 합니다." });
    if (signupForm.password !== signupForm.confirmPassword) return setAuthStatus({ tone: "error", message: "비밀번호 확인이 일치하지 않습니다." });
    if (signupForm.signupReason.trim().length > 500) return setAuthStatus({ tone: "error", message: "가입 사유는 500자 이내로 입력해 주세요." });
    const termsEnabled = platformStatus?.termsEnabled !== false;
    const requiredTerms = termsEnabled ? ["standard_terms", "service_additional_terms"].map((key) => activeTerms.find((term) => term.termsKey === key)).filter(Boolean) : [];
    if (termsEnabled && requiredTerms.length < 2) return setAuthStatus({ tone: "error", message: "회원가입 약관이 아직 준비되지 않았습니다. 관리자에게 문의해 주세요." });
    const agreedTermIds = new Set((signupForm.termsAgreementIds || []).map((item) => Number(item)));
    if (termsEnabled && !requiredTerms.every((term) => agreedTermIds.has(Number(term.id)))) return setAuthStatus({ tone: "error", message: "표준약관과 서비스 추가 약관에 모두 동의해 주세요." });
    try {
      const result = await api("/api/auth/signup", {
        method: "POST",
        body: {
          name: signupForm.name,
          email: signupForm.email,
          username: signupForm.username,
          password: signupForm.password,
          courseCode: signupForm.courseCode,
          inviteCode: signupForm.inviteCode,
          signupReason: signupForm.signupReason,
          termsAgreementIds: termsEnabled ? requiredTerms.map((term) => term.id) : [],
          marketingEmailConsent: signupForm.marketingEmailConsent === true,
        },
      });
      setSignupForm({ name: "", email: "", username: "", password: "", confirmPassword: "", courseCode: "", inviteCode: "", signupReason: "", termsAgreementIds: [], marketingEmailConsent: false });
      setSignupCheck({ tone: "", message: "" });
      setAuthTab("login");
      const signupMessage = result?.welcomeCoupon?.code
        ? `${result.message || "회원가입이 완료되었습니다."} 웰컴 쿠폰 ${result.welcomeCoupon.code}도 함께 발급되었어요.`
        : result?.message || "회원가입이 완료되었습니다.";
      setAuthStatus({ tone: "success", message: signupMessage });
      pushToast(signupMessage, "success");
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "회원가입 중 오류가 발생했습니다.", "error");
    }
  }
  async function onAcceptActiveTerms() {
    if (platformStatus?.termsEnabled === false) {
      return true;
    }
    const requiredTerms = ["standard_terms", "service_additional_terms"].map((key) => activeTerms.find((term) => term.termsKey === key)).filter(Boolean);
    if (requiredTerms.length < 2) {
      const message = "활성 약관이 아직 준비되지 않았습니다. 관리자에게 문의해 주세요.";
      setAuthStatus({ tone: "error", message });
      pushToast(message, "error");
      return false;
    }
    try {
      const result = await api("/api/terms/agree", {
        method: "POST",
        body: { termsAgreementIds: requiredTerms.map((term) => term.id) },
      });
      if (result.user) setSession(result.user);
      setAuthStatus({ tone: "success", message: result.message || "약관 동의가 완료되었습니다." });
      pushToast(result.message || "약관 동의가 완료되었습니다.", "success");
      await refreshAll(result.user || session);
      return true;
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "약관 동의 처리 중 오류가 발생했습니다.", "error");
      return false;
    }
  }
  async function onDecideMarketingConsent(marketingEmailConsent) {
    try {
      const result = await api("/api/user/marketing-consent", {
        method: "POST",
        body: { marketingEmailConsent: marketingEmailConsent === true },
      });
      if (result.user) setSession(result.user);
      setAuthStatus({ tone: "success", message: result.message || "마케팅 이메일 수신 여부를 저장했습니다." });
      pushToast(result.message || "마케팅 이메일 수신 여부를 저장했습니다.", "success");
      await refreshAll(result.user || session);
      return true;
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "마케팅 이메일 수신 여부 저장 중 오류가 발생했습니다.", "error");
      return false;
    }
  }
  async function onResetPasswordWithPin(event) {
    event.preventDefault();
    if (!resetPinForm.username.trim() || !resetPinForm.pin.trim() || !resetPinForm.newPassword) {
      return setAuthStatus({ tone: "error", message: "아이디, PIN, 새 비밀번호를 모두 입력해 주세요." });
    }
    if (resetPinForm.newPassword.length < 8) {
      return setAuthStatus({ tone: "error", message: "새 비밀번호는 8자 이상이어야 합니다." });
    }
    if (resetPinForm.newPassword !== resetPinForm.confirmPassword) {
      return setAuthStatus({ tone: "error", message: "새 비밀번호 확인이 일치하지 않습니다." });
    }
    try {
      const result = await api("/api/auth/reset-password-with-pin", {
        method: "POST",
        body: {
          username: resetPinForm.username,
          pin: resetPinForm.pin,
          newPassword: resetPinForm.newPassword,
        },
      });
      setResetPinForm(EMPTY_RESET_PIN_FORM);
      setAuthStatus({ tone: "success", message: result.message || "비밀번호를 재설정했습니다." });
      pushToast(result.message || "비밀번호를 재설정했습니다.", "success");
      setAuthTab("login");
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "비밀번호 재설정 중 오류가 발생했습니다.", "error");
    }
  }
  async function onLogout() {
    try { await api("/api/auth/logout", { method: "POST" }); } finally {
      clearClientSessionState(route);
    }
  }
  async function onApplyLab(courseId) {
    const normalizedCourseId = Number(courseId);
    if (!Number.isFinite(normalizedCourseId) || normalizedCourseId <= 0) {
      return;
    }
    if (applyingLabCourseIdsRef.current.has(normalizedCourseId)) {
      return;
    }
    applyingLabCourseIdsRef.current.add(normalizedCourseId);
    setApplyingLabCourseIds(Array.from(applyingLabCourseIdsRef.current));
    try {
      const result = await api("/api/labs", { method: "POST", body: { courseId: normalizedCourseId } });
      let resolvedLab = result?.lab || null;
      if (resolvedLab?.id) {
        setLabs((current) => [resolvedLab, ...current.filter((item) => item.id !== resolvedLab?.id)]);
      }
      const [latestLabs] = await Promise.all([loadLabs(), loadCourses()]);
      if (!resolvedLab?.id) {
        resolvedLab = (latestLabs || []).find((item) =>
          Number(item.courseId) === normalizedCourseId
          && isLearningLabResource(item, standaloneExamCourseIds)
          && ["pending", "approved", "provisioning", "running", "paused", "terminating"].includes(String(item.status || "").toLowerCase()),
        ) || null;
      }
      if (resolvedLab?.id) {
        setLabs((current) => [resolvedLab, ...current.filter((item) => item.id !== resolvedLab?.id)]);
      }
      const message = result?.message || (resolvedLab?.id ? "랩 신청이 등록되었습니다." : "랩 요청 결과를 받아왔지만 랩 상태를 아직 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.");
      setAuthStatus({ tone: "success", message });
      pushToast(message, "success");
    } catch (error) {
      const message = error?.message || "랩 요청 처리 중 오류가 발생했습니다.";
      const normalizedMessage = /failed to fetch|networkerror|load failed/i.test(String(message))
        ? "랩 요청을 서버로 보내지 못했습니다. 브라우저 네트워크, 세션 상태, 프록시 연결을 확인해 주세요."
        : message;
      setAuthStatus({ tone: "error", message: normalizedMessage });
      pushToast(normalizedMessage, "error");
    } finally {
      applyingLabCourseIdsRef.current.delete(normalizedCourseId);
      setApplyingLabCourseIds(Array.from(applyingLabCourseIdsRef.current));
    }
  }
  function addStartingLabIds(ids) {
    const validIds = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
    if (!validIds.length) return;
    validIds.forEach((id) => startingLabIdsRef.current.add(id));
    setStartingLabIds(Array.from(startingLabIdsRef.current));
  }
  function removeStartingLabIds(ids) {
    const validIds = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
    if (!validIds.length) return;
    validIds.forEach((id) => startingLabIdsRef.current.delete(id));
    setStartingLabIds(Array.from(startingLabIdsRef.current));
  }
  function getCourseRequiredLabOverrides(course) {
    const heatParameters = course?.heatParameters && typeof course.heatParameters === "object" ? course.heatParameters : {};
    const source = Array.isArray(course?.requiredLabOverrides)
      ? course.requiredLabOverrides
      : Array.isArray(heatParameters.requiredLabOverrides)
        ? heatParameters.requiredLabOverrides
        : Array.isArray(heatParameters.labParameterOverrideSchema)
          ? heatParameters.labParameterOverrideSchema
          : [];
    const seen = new Set();
    return source
      .map((item) => (item && typeof item === "object" ? item : {}))
      .map((item) => {
        const key = String(item.key || item.name || "").trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
        return {
          key,
          label: String(item.label || item.title || key).trim() || key,
          type: String(item.type || "text").trim().toLowerCase(),
          required: item.required !== false,
          description: String(item.description || item.helper || item.help || "").trim(),
          placeholder: String(item.placeholder || "").trim(),
          multiline: item.multiline === true,
        };
      })
      .filter(Boolean)
      .filter((item) => {
        const lower = item.key.toLowerCase();
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
      });
  }
  function requestLabParameterOverridesForCourse(course) {
    const fields = getCourseRequiredLabOverrides(course);
    if (!fields.length) return Promise.resolve(null);
    const courseTitle = String(course?.title || "선택한 과정").trim();
    return new Promise((resolve, reject) => {
      labParameterOverridePromptRef.current?.reject?.(new Error("새 랩 시작 요청으로 이전 입력이 취소되었습니다."));
      labParameterOverridePromptRef.current = { resolve, reject };
      setLabParameterOverridePrompt({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        courseTitle,
        fields,
      });
    });
  }
  function onSubmitLabParameterOverrides(values = {}) {
    const pending = labParameterOverridePromptRef.current;
    if (!pending) return;
    labParameterOverridePromptRef.current = null;
    setLabParameterOverridePrompt(null);
    pending.resolve(values && Object.keys(values).length ? values : null);
  }
  function onCancelLabParameterOverrides() {
    const pending = labParameterOverridePromptRef.current;
    labParameterOverridePromptRef.current = null;
    setLabParameterOverridePrompt(null);
    pending?.reject?.(new Error("랩 시작이 취소되었습니다."));
  }
  async function onStartLab(labId, courseId = null) {
    const initiallyRequestedLabId = Number(labId);
    if (Number.isInteger(initiallyRequestedLabId) && initiallyRequestedLabId > 0 && startingLabIdsRef.current.has(initiallyRequestedLabId)) {
      return;
    }
    addStartingLabIds([initiallyRequestedLabId]);
    let targetLabId = initiallyRequestedLabId;
    try {
      setTerminalSession(null);
      let latestLabs = await loadLabs();
      if (courseId != null) {
        const latestMatchingLab = (latestLabs || []).find((item) =>
          Number(item.courseId) === Number(courseId) && isLearningLabResource(item, standaloneExamCourseIds) && ["approved", "paused"].includes(String(item.status || "").toLowerCase()));
        if (latestMatchingLab?.id) {
          targetLabId = Number(latestMatchingLab.id);
          addStartingLabIds([targetLabId]);
        }
      }

      if (!Number.isInteger(targetLabId) || targetLabId <= 0) {
        setAuthStatus({ tone: "error", message: "시작할 수 있는 최신 랩 정보를 찾지 못했습니다. 목록을 새로고침해 주세요." });
        return;
      }

      const targetLab = (latestLabs || []).find((item) => Number(item.id) === targetLabId) || null;
      const targetCourseId = Number(courseId ?? targetLab?.courseId ?? 0);
      const targetCourse = (courses || []).find((item) => Number(item.id) === targetCourseId) || null;
      let labParameterOverrides = null;
      const preflightWarning = buildLabResourcePreflightWarning(targetCourse, quotaStatus);
      if (preflightWarning && typeof window !== "undefined" && !window.confirm(preflightWarning)) {
        const message = "랩 시작을 취소했습니다.";
        setAuthStatus({ tone: "info", message });
        pushToast(message, "info");
        return;
      }

      if (["approved", "failed"].includes(String(targetLab?.status || "").toLowerCase())) {
        try {
          labParameterOverrides = await requestLabParameterOverridesForCourse(targetCourse);
        } catch (error) {
          const message = error?.message || "랩 시작이 취소되었습니다.";
          setAuthStatus({ tone: "info", message });
          pushToast(message, "info");
          return;
        }
      }

      try {
        const result = await api(`/api/labs/${targetLabId}/start`, {
          method: "POST",
          body: {
            ...(courseId != null ? { courseId } : {}),
            ...(labParameterOverrides ? { labParameterOverrides } : {}),
          },
        });
        setLabs((current) => current.map((lab) => (Number(lab.id) === targetLabId ? result.lab : lab)));
        await loadLabs();
        setAuthStatus({ tone: "success", message: result.message || "랩 생성을 시작했습니다." });
        pushToast(result.message || "랩 생성을 시작했습니다.", "success");
      } catch (error) {
        if (Number(error?.status) === 404) {
          latestLabs = await loadLabs();
          if (courseId != null) {
            const retryLab = (latestLabs || []).find((item) =>
              Number(item.courseId) === Number(courseId) && isLearningLabResource(item, standaloneExamCourseIds) && ["approved", "paused"].includes(String(item.status || "").toLowerCase()));
            const retryLabId = Number(retryLab?.id || 0);
            if (retryLabId > 0 && retryLabId !== targetLabId) {
              const retryResult = await api(`/api/labs/${retryLabId}/start`, {
                method: "POST",
                body: {
                  courseId,
                  ...(labParameterOverrides ? { labParameterOverrides } : {}),
                },
              });
              setLabs((current) => current.map((lab) => (Number(lab.id) === retryLabId ? retryResult.lab : lab)));
              await loadLabs();
              setAuthStatus({ tone: "success", message: retryResult.message || "최신 랩 정보로 다시 맞춘 뒤 랩을 시작했습니다." });
              pushToast(retryResult.message || "최신 랩 정보로 다시 맞춘 뒤 랩을 시작했습니다.", "success");
              return;
            }
          }
        }
        throw error;
      }
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "랩 시작 중 오류가 발생했습니다.", "error");
    } finally {
      removeStartingLabIds([initiallyRequestedLabId, targetLabId]);
    }
  }
  async function onPurchaseCourse(courseId) {
    const targetCourse = (courses || []).find((item) => Number(item.id) === Number(courseId));
    const isGovernmentCourse = isGovernmentProgramTypeValue(targetCourse?.programType);
    const requiresApprovalCourse = targetCourse?.courseType === "online" || isGovernmentCourse || targetCourse?.accessScope === "code";
    if (targetCourse && Number(targetCourse.price || 0) > 0 && platformStatus?.paymentGatewayEnabled && !requiresApprovalCourse) {
      await onPrepareCoursePayment(courseId);
      return;
    }
    try {
      const result = await api(`/api/courses/${courseId}/purchase-request`, { method: "POST" });
      setCourses(withLocalPreviewSampleCourses(result.courses || []));
      await runSafeRefreshTasks([loadWrittenExams(), loadLabExams()]);
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || (isGovernmentCourse ? "과정 신청이 접수되었습니다." : "수강신청이 접수되었습니다."), "success");
      if (isAdmin) {
        await loadAdmin();
      }
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || (isGovernmentCourse ? "과정 신청 중 오류가 발생했습니다." : "수강신청 중 오류가 발생했습니다."), "error");
    }
  }
  async function onPrepareCoursePayment(courseId) {
    try {
      const myCoupons = (coupons || []).filter((item) => {
        if (String(item.status || "").toLowerCase() !== "active") return false;
        if (Number(item.usedCount || 0) >= Number(item.maxUses || 1)) return false;
        if (item.courseId != null && Number(item.courseId) !== Number(courseId)) return false;
        if (item.expiresAt) {
          const expiresAt = new Date(item.expiresAt);
          if (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) return false;
        }
        return true;
      });
      const suggestedCode = myCoupons[0]?.code || "";
      const couponPrompt = myCoupons.length
        ? `사용할 쿠폰 코드를 입력해 주세요.\n사용 가능: ${myCoupons.map((item) => `${item.code} (${item.courseTitle || "전체 과정"})`).join(", ")}`
        : "사용할 쿠폰 코드가 있으면 입력해 주세요. 없으면 비워두고 확인하세요.";
      const couponInput = window.prompt(couponPrompt, suggestedCode);
      if (couponInput == null) return;
      const couponCode = String(couponInput || "").trim().toUpperCase();
      const result = await api(`/api/courses/${courseId}/payment/prepare`, { method: "POST", body: { couponCode } });
      setAuthStatus({ tone: "success", message: result.message });
      await runSafeRefreshTasks([loadPayments(), loadCourses(), loadCoupons()]);
      const checkout = result.checkout || {};
      const provider = normalizePaymentGatewayProvider(checkout.provider || "");
      if (provider === "coupon") {
        await runSafeRefreshTasks([loadWrittenExams(), loadLabExams(), loadCertificates(), isAdmin ? loadAdmin() : Promise.resolve()]);
        pushToast(result.message || "쿠폰 적용이 완료되었습니다.", "success");
        return;
      }
      if (provider === "tosspayments") {
        const clientKey = String(checkout.publicKey || "").trim();
        if (!clientKey) {
          throw new Error("토스 결제 클라이언트 키가 설정되지 않았습니다.");
        }
        const TossPayments = await ensureTossPaymentsSdk();
        const tossPayments = TossPayments(clientKey);
        const payment = tossPayments.payment({ customerKey: `terminal-lab-user-${session?.id || "guest"}` });
        const origin = window.location.origin;
        const baseSuccess = `${origin}/?paymentStatus=success`;
        const baseFail = `${origin}/?paymentStatus=fail`;
        await payment.requestPayment({
          method: "CARD",
          amount: {
            currency: checkout.currency || "KRW",
            value: Number(checkout.amount || 0),
          },
          orderId: checkout.orderId,
          orderName: checkout.orderName || checkout.courseTitle || "Terminal Lab 과정 결제",
          successUrl: baseSuccess,
          failUrl: baseFail,
          customerEmail: session?.email || undefined,
          customerName: session?.name || session?.username || undefined,
        });
        return;
      }
      throw new Error(`현재 PG 제공사(${provider || "미설정"})는 웹 결제창을 지원하지 않습니다.`);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "결제 준비 중 오류가 발생했습니다.", "error");
    }
  }
  async function onCreateCourseQuote(payload) {
    if (!canUseCourseQuotePortal(platformStatus, isAdmin)) {
      const message = "현재 견적서 발행 기능은 관리자 설정에서 비활성화되어 있습니다.";
      setCourseQuoteStatus({ tone: "error", message });
      pushToast(message, "error");
      throw new Error(message);
    }
    try {
      const result = await api("/api/course-quotes", {
        method: "POST",
        body: payload,
      });
      setCourseQuoteStatus({ tone: "success", message: result.message || "공식 견적서를 발행했습니다." });
      pushToast(result.message || "공식 견적서를 발행했습니다.", "success");
      await runSafeRefreshTasks([loadCourseQuotes(), isAdmin ? loadAdmin() : Promise.resolve()]);
      return result.quote;
    } catch (error) {
      setCourseQuoteStatus({ tone: "error", message: error.message || "견적서 발행 중 오류가 발생했습니다." });
      pushToast(error.message || "견적서 발행 중 오류가 발생했습니다.", "error");
      throw error;
    }
  }
  async function onCreateAdminCourseQuote(payload) {
    try {
      const result = await api("/api/admin/course-quotes", {
        method: "POST",
        body: payload,
      });
      setAdminStatus(result.message || "관리자 견적서를 발행했습니다.");
      pushToast(result.message || "관리자 견적서를 발행했습니다.", "success");
      await runSafeRefreshTasks([loadAdmin(), loadCourseQuotes()]);
      return result.quote;
    } catch (error) {
      setAdminStatus(error.message || "관리자 견적서 발행 중 오류가 발생했습니다.");
      pushToast(error.message || "관리자 견적서 발행 중 오류가 발생했습니다.", "error");
      throw error;
    }
  }
  async function onUpdateCourseQuoteStatus(quoteId, status) {
    try {
      const result = await api(`/api/admin/course-quotes/${quoteId}`, {
        method: "PATCH",
        body: { status },
      });
      setAdminStatus(result.message || "견적서 상태를 저장했습니다.");
      pushToast(result.message || "견적서 상태를 저장했습니다.", "success");
      await runSafeRefreshTasks([loadCourseQuotes(), loadAdmin()]);
      return result.quote;
    } catch (error) {
      setAdminStatus(error.message || "견적서 상태 저장 중 오류가 발생했습니다.");
      pushToast(error.message || "견적서 상태 저장 중 오류가 발생했습니다.", "error");
      throw error;
    }
  }
  async function onConfirmPayment(paymentId) {
    try {
      const result = await api(`/api/payments/${paymentId}/confirm`, { method: "POST" });
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "결제 완료 처리를 마쳤습니다.", "success");
      await runSafeRefreshTasks([loadPayments(), loadCourses(), loadWrittenExams(), loadLabExams(), loadCertificates(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "결제 완료 처리 중 오류가 발생했습니다.", "error");
    }
  }
  async function onCancelPayment(paymentId) {
    try {
      const result = await api(`/api/payments/${paymentId}/cancel`, { method: "POST" });
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "결제를 취소했습니다.", "success");
      await runSafeRefreshTasks([loadPayments(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "결제 취소 중 오류가 발생했습니다.", "error");
    }
  }
  async function onRevokeMyCourseAccess(course) {
    if (!course?.id) return;
    const isPaymentEnrollment = String(course.enrollmentGrantedVia || "").trim().toLowerCase() === "payment";
    const reason = window.prompt(
      isPaymentEnrollment ? "수강 취소 요청 사유를 입력해 주세요." : "수강 취소 사유를 입력해 주세요. 비워두면 바로 취소합니다.",
      "",
    );
    if (reason == null) return;
    const trimmedReason = String(reason || "").trim();
    if (isPaymentEnrollment && !trimmedReason) {
      setAuthStatus({ tone: "error", message: "수강 취소 사유를 입력해 주세요." });
      pushToast("수강 취소 사유를 입력해 주세요.", "error");
      return;
    }
    if (!window.confirm(`${course.title || "선택한 과정"} ${isPaymentEnrollment ? "수강 취소를 요청" : "수강을 취소"}할까요?`)) return;
    try {
      const result = await api(`/api/courses/${course.id}/revoke-access`, {
        method: "POST",
        body: { reason: trimmedReason },
      });
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || (isPaymentEnrollment ? "수강 취소 요청을 접수했습니다." : "수강 과정을 취소했습니다."), "success");
      await runSafeRefreshTasks([loadCourses(), loadLabs(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "수강 취소 중 오류가 발생했습니다.", "error");
    }
  }
  async function onRequestCourseExtension(course) {
    if (!course?.id) return;
    const reason = window.prompt(
      `${course.title || "선택한 과정"} 수강 기간 연장 사유를 입력해 주세요. 비워두면 기본 요청으로 접수합니다.`,
      "",
    );
    if (reason == null) return;
    try {
      const result = await api(`/api/courses/${course.id}/extend-access`, {
        method: "POST",
        body: { reason: String(reason || "").trim() },
      });
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "수강 기간 연장 요청을 접수했습니다.", "success");
      await runSafeRefreshTasks([loadCourses(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "수강 기간 연장 요청 중 오류가 발생했습니다.", "error");
    }
  }
  async function onRefundPayment(paymentId) {
    const cancelReason = window.prompt("환불 사유를 입력해 주세요.", "관리자 요청 환불");
    if (cancelReason == null) return;
    const cancelAmountText = window.prompt("부분 환불 금액을 입력하세요. 전액 환불이면 비워두세요.", "");
    const cancelAmount = String(cancelAmountText || "").trim() ? Number(cancelAmountText) : 0;
    try {
      const result = await api(`/api/payments/${paymentId}/refund`, {
        method: "POST",
        body: {
          cancelReason,
          cancelAmount: Number.isFinite(cancelAmount) && cancelAmount > 0 ? cancelAmount : undefined,
        },
      });
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "환불 처리를 완료했습니다.", "success");
      await runSafeRefreshTasks([loadPayments(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "환불 처리 중 오류가 발생했습니다.", "error");
    }
  }
  async function onCreateAdminCoupon(event) {
    event.preventDefault();
    try {
      if (!adminCouponForm.userId) throw new Error("쿠폰을 받을 회원을 선택해 주세요.");
      const result = await api("/api/admin/coupons", {
        method: "POST",
        body: {
          userId: Number(adminCouponForm.userId),
          courseId: adminCouponForm.courseId ? Number(adminCouponForm.courseId) : null,
          discountType: adminCouponForm.discountType,
          discountValue: Number(adminCouponForm.discountValue || 0),
          expiresInDays: Number(adminCouponForm.expiresInDays || 7),
          maxUses: Number(adminCouponForm.maxUses || 1),
          source: adminCouponForm.source || "admin_manual",
          campaignName: adminCouponForm.campaignName || "",
          reason: adminCouponForm.reason || "",
          note: adminCouponForm.note || "",
        },
      });
      setAdminStatus(result.message || "쿠폰을 발급했습니다.");
      pushToast(result.message || "쿠폰을 발급했습니다.", "success");
      setAdminCouponForm(EMPTY_ADMIN_COUPON_FORM);
      await runSafeRefreshTasks([loadAdminCoupons(), loadCoupons()]);
    } catch (error) {
      setAdminStatus(error.message || "쿠폰 발급 중 오류가 발생했습니다.");
      pushToast(error.message || "쿠폰 발급 중 오류가 발생했습니다.", "error");
    }
  }
  async function onToggleAdminCoupon(couponId, enabled) {
    try {
      const result = await api(`/api/admin/coupons/${couponId}`, {
        method: "PATCH",
        body: { status: enabled ? "active" : "inactive" },
      });
      setAdminStatus(result.message || "쿠폰 상태를 변경했습니다.");
      pushToast(result.message || "쿠폰 상태를 변경했습니다.", "success");
      await runSafeRefreshTasks([loadAdminCoupons(), loadCoupons()]);
    } catch (error) {
      setAdminStatus(error.message || "쿠폰 상태 변경 중 오류가 발생했습니다.");
      pushToast(error.message || "쿠폰 상태 변경 중 오류가 발생했습니다.", "error");
    }
  }
  async function onProfileSubmit(event) {
    event.preventDefault();
    if (!profileForm.name.trim()) return setAuthStatus({ tone: "error", message: "이름을 입력해 주세요." });
    if (profileForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileForm.email.trim())) {
      return setAuthStatus({ tone: "error", message: "유효한 이메일 주소를 입력해 주세요." });
    }
    if (profileForm.newPassword && profileForm.newPassword !== profileForm.confirmPassword) {
      return setAuthStatus({ tone: "error", message: "새 비밀번호 확인이 일치하지 않습니다." });
    }
    try {
      const result = await api("/api/auth/profile", {
        method: "PATCH",
        body: {
          name: profileForm.name,
          email: profileForm.email,
          currentPassword: profileForm.currentPassword,
          newPassword: profileForm.newPassword,
        },
      });
      setSession(result.user);
      setProfileForm((current) => ({
        ...current,
        name: result.user.name,
        email: result.user.email || "",
        otpEnabled: Boolean(result.user.otpEnabled),
        otpSetupSecret: "",
        otpSetupUri: "",
        otpSetupCode: "",
        otpDisableCode: "",
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      }));
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "내 정보를 수정했습니다.", "success");
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "내 정보 수정 중 오류가 발생했습니다.", "error");
    }
  }
  async function onDeleteMyAccount() {
    const currentPassword = String(profileForm.currentPassword || "");
    if (!currentPassword) {
      setAuthStatus({ tone: "error", message: "회원 탈퇴를 위해 현재 비밀번호를 입력해 주세요." });
      return;
    }
    if (!window.confirm("정말로 회원 탈퇴하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;

    try {
      const result = await api("/api/auth/profile", {
        method: "DELETE",
        body: { currentPassword },
      });
      setAuthStatus({ tone: "success", message: result.message });
      setSession(null);
      setCourses([]);
      setLabs([]);
      setCustomLabRequests([]);
      setQnaPosts([]);
      setSelectedCourseId(null);
      setOpenSelectedCourseDetail(false);
      setAdminUsers([]);
      setAdminPasswordResetPins([]);
      setAdminCourses([]);
      setAdminLabs([]);
      setAdminCourseAccessRequests([]);
      setAdminSurveyResponses([]);
      setAdminSurveySummary([]);
      setPreferredSurveyPhase("pre");
      setAdminCustomLabRequests([]);
      setAdminAccessLogs([]);
      setAdminAccessStats(EMPTY_ACCESS_STATS);
      setAdminArenaOverview(EMPTY_ADMIN_ARENA_OVERVIEW);
      setMyAccessLogs([]);
      setSelectedUserIds([]);
      setUserSearch("");
      setCourseForm(EMPTY_COURSE);
      setTerminalSession(null);
      pushToast(result.message || "회원 탈퇴가 완료되었습니다.", "success");
      clearClientSessionState("portal");
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "회원 탈퇴 중 오류가 발생했습니다.", "error");
    }
  }
  async function onStartOtpSetup() {
    try {
      const result = await api("/api/auth/otp/setup/start", { method: "POST" });
      setProfileForm((current) => ({
        ...current,
        otpSetupSecret: result.setup?.secret || "",
        otpSetupUri: result.setup?.otpauthUrl || "",
        otpSetupCode: "",
      }));
      setAuthStatus({ tone: "success", message: result.message || "OTP 설정을 시작했습니다." });
      pushToast(result.message || "OTP 설정을 시작했습니다.", "success");
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "OTP 설정 시작 중 오류가 발생했습니다.", "error");
    }
  }
  async function onConfirmOtpSetup() {
    if (!profileForm.otpSetupSecret) {
      setAuthStatus({ tone: "error", message: "먼저 OTP 설정을 시작해 주세요." });
      return;
    }
    try {
      const result = await api("/api/auth/otp/setup/confirm", {
        method: "POST",
        body: { code: profileForm.otpSetupCode },
      });
      setSession(result.user);
      setProfileForm((current) => ({
        ...current,
        otpEnabled: Boolean(result.user?.otpEnabled),
        otpSetupSecret: "",
        otpSetupUri: "",
        otpSetupCode: "",
      }));
      setAuthStatus({ tone: "success", message: result.message || "OTP를 활성화했습니다." });
      pushToast(result.message || "OTP를 활성화했습니다.", "success");
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "OTP 활성화 중 오류가 발생했습니다.", "error");
    }
  }
  async function onDisableOtp() {
    if (!profileForm.currentPassword) {
      setAuthStatus({ tone: "error", message: "OTP 해제를 위해 현재 비밀번호를 입력해 주세요." });
      return;
    }
    try {
      const result = await api("/api/auth/otp/disable", {
        method: "POST",
        body: {
          currentPassword: profileForm.currentPassword,
          code: profileForm.otpDisableCode,
        },
      });
      setSession(result.user);
      setProfileForm((current) => ({
        ...current,
        otpEnabled: false,
        otpSetupSecret: "",
        otpSetupUri: "",
        otpSetupCode: "",
        otpDisableCode: "",
        currentPassword: "",
      }));
      setAuthStatus({ tone: "success", message: result.message || "OTP를 비활성화했습니다." });
      pushToast(result.message || "OTP를 비활성화했습니다.", "success");
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "OTP 비활성화 중 오류가 발생했습니다.", "error");
    }
  }
  async function onRedeemCourseCode(event) {
    event.preventDefault();
    const courseCode = String(profileForm.courseCode || "").trim();
    if (!courseCode) return setAuthStatus({ tone: "error", message: "과정 코드를 입력해 주세요." });
    try {
      const result = await api("/api/courses/redeem-code", { method: "POST", body: { courseCode } });
      setCourses(withLocalPreviewSampleCourses(result.courses || []));
      setProfileForm((current) => ({ ...current, courseCode: "" }));
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "과정 코드를 등록했습니다.", "success");
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "과정 코드 등록 중 오류가 발생했습니다.", "error");
    }
  }
  async function onToggleCircuitBreaker() {
    try {
      const nextEnabled = !platformStatus.labCircuitBreaker;
      const result = await api("/api/admin/platform-status", {
        method: "PUT",
        body: buildPlatformStatusPayload({ ...platformStatus, labCircuitBreaker: nextEnabled }),
      });
      replacePlatformStatus(result.status, { markDirty: false });
      setAdminStatus(result.message);
      await loadPlatformStatus(false, { force: true });
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onSaveCircuitBreakerMessage() {
    try {
      const result = await api("/api/admin/platform-status", {
        method: "PUT",
        body: buildPlatformStatusPayload(),
      });
      replacePlatformStatus(result.status, { markDirty: false });
      const message = "서킷 브레이크 메시지를 저장했습니다.";
      setAdminStatus(message);
      openAdminSaveDialog(message);
      await loadPlatformStatus(false, { force: true });
    } catch (error) {
      setAdminStatus(error.message);
      openAdminSaveDialog(error.message, "error");
    }
  }
  async function onSaveLlmSettings() {
    try {
      const optionsValidationMessage = validateLlmSurveyFeedbackOptionsJson();
      if (optionsValidationMessage) {
        setAdminStatus(optionsValidationMessage);
        openAdminSaveDialog(optionsValidationMessage, "error");
        return;
      }
      const result = await api("/api/admin/platform-status", {
        method: "PUT",
        body: buildPlatformStatusPayload(),
      });
      replacePlatformStatus(result.status, { markDirty: false });
      const message = "LLM 설정을 저장했습니다.";
      setAdminStatus(message);
      openAdminSaveDialog(message);
      await loadPlatformStatus(false, { force: true });
    } catch (error) {
      setAdminStatus(error.message);
      openAdminSaveDialog(error.message, "error");
    }
  }
  async function onSavePlatformSettings() {
      try {
        const validationMessage = validatePaymentGatewaySettings(platformStatus);
        if (validationMessage) {
          setAdminStatus(validationMessage);
          openAdminSaveDialog(validationMessage, "error");
          return;
        }
        const optionsValidationMessage = validateLlmSurveyFeedbackOptionsJson();
        if (optionsValidationMessage) {
          setAdminStatus(optionsValidationMessage);
          openAdminSaveDialog(optionsValidationMessage, "error");
          return;
        }
        const result = await api("/api/admin/platform-status", {
          method: "PUT",
          body: buildPlatformStatusPayload(),
      });
      replacePlatformStatus(result.status, { markDirty: false });
      const message = "플랫폼 설정을 저장했습니다.";
      setAdminStatus(message);
      openAdminSaveDialog(message);
      await loadPlatformStatus(false, { force: true });
    } catch (error) {
      setAdminStatus(error.message);
      openAdminSaveDialog(error.message, "error");
    }
  }
  async function onTestLlm() {
    try {
      const draftSettings = buildLlmSettingsPayload();
      const result = await api("/api/admin/llm/test", {
        method: "POST",
        body: { question: "연결 테스트", settings: draftSettings },
      });
      setLlmStatus({
        tone: "success",
        message: result.answer
          ? `연결 성공(${result.model || draftSettings.llmModel || "모델 미설정"}): ${result.answer}`
          : result.message,
      });
      setAdminStatus("");
    } catch (error) {
      const detail = String(error?.payload?.detail || "").trim();
      const message = detail ? `${error.message}\n${detail}` : error.message;
      setLlmStatus({ tone: "error", message });
      setAdminStatus("");
    }
  }
  async function onTestMail() {
    try {
      const result = await api("/api/admin/mail/test", {
        method: "POST",
        body: { to: String(mailTestAddress || "").trim() },
      });
      if (Array.isArray(result.logs)) {
        setAdminMailLogs(result.logs);
      } else {
        await loadAdminMailLogs();
      }
      setAdminStatus(result.message || "테스트 메일을 발송했습니다.");
      pushToast(result.message || "테스트 메일을 발송했습니다.", "success");
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "테스트 메일 발송 중 오류가 발생했습니다.", "error");
    }
  }
  async function onVerifyMailConnection() {
    try {
      const result = await api("/api/admin/mail/verify", {
        method: "POST",
      });
      if (Array.isArray(result.logs)) {
        setAdminMailLogs(result.logs);
      } else {
        await loadAdminMailLogs();
      }
      setAdminStatus(result.message || "SMTP 연결 확인이 완료되었습니다.");
      pushToast(result.message || "SMTP 연결 확인이 완료되었습니다.", "success");
    } catch (error) {
      const detail = String(error?.payload?.diagnostics?.response || "").trim();
      const message = detail ? `${error.message}\n${detail}` : error.message;
      setAdminStatus(message);
      pushToast(error.message || "SMTP 연결 확인 중 오류가 발생했습니다.", "error");
    }
  }
  async function onSendAdminMail(event) {
    event?.preventDefault?.();
    try {
      const recipientMode = String(adminMailForm.recipientMode || "manual").trim() || "manual";
      const recipientLabel = {
        "@ALL": "전체 사용자",
        "@APPROVED": "승인 사용자",
        "@STUDENTS": "일반 사용자",
        "@ADMINS": "관리자",
        "@ACTIVE": "최근 접속 사용자",
        manual: "직접 입력",
      }[recipientMode] || recipientMode;
      if (typeof window !== "undefined" && !window.confirm(`${recipientLabel} 대상으로 메일을 발송할까요?`)) {
        return;
      }
      const result = await api("/api/admin/mail/send", {
        method: "POST",
        body: {
          recipientMode,
          to: adminMailForm.to,
          subject: adminMailForm.subject,
          text: adminMailForm.text,
        },
      });
      if (Array.isArray(result.logs)) {
        setAdminMailLogs(result.logs);
      } else {
        await loadAdminMailLogs();
      }
      setAdminMailForm(EMPTY_ADMIN_MAIL_FORM);
      setAdminStatus(result.message || "관리자 메일링을 발송했습니다.");
      pushToast(result.message || "관리자 메일링을 발송했습니다.", "success");
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "관리자 메일링 발송 중 오류가 발생했습니다.", "error");
    }
  }
  async function onSendMarketingMail(event) {
    event?.preventDefault?.();
    try {
      const recipientMode = String(marketingMailForm.recipientMode || "@APPROVED").trim() || "@APPROVED";
      const recipientLabel = {
        "@ALL": "전체 마케팅 수신 동의자",
        "@APPROVED": "승인된 마케팅 수신 동의자",
        "@STUDENTS": "일반 마케팅 수신 동의자",
        "@ACTIVE": "최근 접속한 마케팅 수신 동의자",
        manual: "직접 입력한 동의자",
      }[recipientMode] || recipientMode;
      if (typeof window !== "undefined" && !window.confirm(`${recipientLabel} 대상으로 마케팅 메일을 발송할까요?`)) {
        return;
      }
      const result = await api("/api/admin/mail/send", {
        method: "POST",
        body: {
          mailPurpose: "marketing",
          recipientMode,
          to: marketingMailForm.to,
          subject: marketingMailForm.subject,
          text: marketingMailForm.text,
        },
      });
      if (Array.isArray(result.logs)) {
        setAdminMailLogs(result.logs);
      } else {
        await loadAdminMailLogs();
      }
      setMarketingMailForm(EMPTY_MARKETING_MAIL_FORM);
      setAdminStatus(result.message || "마케팅 메일을 발송했습니다.");
      pushToast(result.message || "마케팅 메일을 발송했습니다.", "success");
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "마케팅 메일 발송 중 오류가 발생했습니다.", "error");
    }
  }
  function buildMailCampaignPayload() {
    return {
      name: mailCampaignForm.name,
      purpose: mailCampaignForm.purpose,
      recipientModes: mailCampaignForm.recipientModes,
      manualRecipients: mailCampaignForm.manualRecipients,
      csvText: mailCampaignForm.csvText,
      sourceFileName: mailCampaignForm.sourceFileName,
      subject: mailCampaignForm.subject,
      text: mailCampaignForm.text,
      replyDeadlineDays: mailCampaignForm.replyDeadlineDays,
      externalConsentConfirmed: mailCampaignForm.externalConsentConfirmed,
    };
  }
  async function onPreviewMailCampaign(event) {
    event?.preventDefault?.();
    try {
      setMailCampaignStatus({ tone: "", message: "대상을 확인하고 있습니다." });
      const result = await api("/api/admin/mail-campaigns/preview", {
        method: "POST",
        body: buildMailCampaignPayload(),
      });
      setMailCampaignPreview(result);
      setMailCampaignStatus({ tone: "success", message: `중복 제거 후 ${result.totalCount || 0}명의 발송 대상을 확인했습니다.` });
    } catch (error) {
      setMailCampaignPreview(null);
      setMailCampaignStatus({ tone: "error", message: error.message || "메일 대상을 확인하지 못했습니다." });
    }
  }
  async function onCreateMailCampaign(event) {
    event?.preventDefault?.();
    try {
      if (!mailCampaignPreview?.totalCount) {
        setMailCampaignStatus({ tone: "error", message: "대상 미리보기를 먼저 실행해 주세요." });
        return;
      }
      if (typeof window !== "undefined" && !window.confirm(`${mailCampaignPreview.totalCount}명에게 개별 메일 발송을 시작할까요?`)) return;
      const result = await api("/api/admin/mail-campaigns", {
        method: "POST",
        body: buildMailCampaignPayload(),
      });
      setMailCampaignStatus({ tone: "success", message: result.message || "메일 캠페인을 발송 대기열에 등록했습니다." });
      setMailCampaignForm(EMPTY_MAIL_CAMPAIGN_FORM);
      setMailCampaignPreview(null);
      await loadAdminMailCampaigns();
      pushToast(result.message || "메일 캠페인을 등록했습니다.", "success");
    } catch (error) {
      setMailCampaignStatus({ tone: "error", message: error.message || "메일 캠페인을 등록하지 못했습니다." });
      pushToast(error.message || "메일 캠페인 등록 중 오류가 발생했습니다.", "error");
    }
  }
  async function onRecordMailCampaignEvent(campaignId, email, eventType) {
    try {
      const result = await api(`/api/admin/mail-campaigns/${campaignId}/events`, {
        method: "POST",
        body: { email, eventType },
      });
      setMailCampaignStatus({ tone: "success", message: result.message || "메일 상태를 반영했습니다." });
      await loadAdminMailCampaigns();
      if (String(selectedMailCampaign?.id || "") === String(campaignId || "")) await loadMailCampaignDetail(campaignId);
    } catch (error) {
      setMailCampaignStatus({ tone: "error", message: error.message || "메일 상태를 반영하지 못했습니다." });
    }
  }
  async function onCreateServiceValidationResources() {
    try {
      const result = await api("/api/admin/service-validation/setup", { method: "POST" });
      setAdminStatus(result.message);
      setServiceValidationStatus({
        ...EMPTY_SERVICE_VALIDATION_STATUS,
        ...(result.status || EMPTY_SERVICE_VALIDATION_STATUS),
        tone: "success",
        message: result.message || "검증 자원을 생성했습니다.",
      });
      setServiceValidationFeedback("success", result.message || "검증 자원을 생성했습니다.");
      pushToast(result.message, "success");
      await runSafeRefreshTasks([loadCourses(), loadNotices(), loadAdmin(), loadPlatformStatus()]);
    } catch (error) {
      setAdminStatus(error.message);
      setServiceValidationFeedback("error", error.message || "검증 자원 생성 중 오류가 발생했습니다.");
    }
  }
  async function onCleanupServiceValidationResources() {
    try {
      const result = await api("/api/admin/service-validation/cleanup", { method: "POST" });
      setAdminStatus(result.message);
      setServiceValidationStatus({
        ...EMPTY_SERVICE_VALIDATION_STATUS,
        ...(result.status || EMPTY_SERVICE_VALIDATION_STATUS),
        tone: "success",
        message: result.message || "검증 자원을 정리했습니다.",
      });
      setServiceValidationFeedback("success", result.message || "검증 자원을 정리했습니다.");
      pushToast(result.message, "success");
      await runSafeRefreshTasks([loadCourses(), loadNotices(), loadAdmin(), loadPlatformStatus()]);
    } catch (error) {
      setAdminStatus(error.message);
      setServiceValidationFeedback("error", error.message || "검증 자원 정리 중 오류가 발생했습니다.");
    }
  }
  async function onRunOpenstackLifecycleTest() {
    try {
      setServiceValidationFeedback("info", "OpenStack VM 생성/삭제 테스트를 실행 중입니다.");
      const result = await api("/api/admin/service-validation/openstack-lifecycle-test", { method: "POST" });
      const detail = result.result?.stackName ? ` (${result.result.stackName})` : "";
      const message = `${result.message || "OpenStack VM 생성/삭제 테스트를 완료했습니다."}${detail}`;
      setAdminStatus(message);
      setServiceValidationStatus({
        ...EMPTY_SERVICE_VALIDATION_STATUS,
        ...(result.status || EMPTY_SERVICE_VALIDATION_STATUS),
        tone: "success",
        message,
        lifecycleTest: result.result || null,
      });
      pushToast(message, "success");
      await runSafeRefreshTasks([loadPlatformStatus()]);
    } catch (error) {
      setAdminStatus(error.message);
      setServiceValidationFeedback("error", error.message || "OpenStack VM 생성/삭제 테스트 중 오류가 발생했습니다.");
    }
  }
  function onWrittenExamEdit(exam) {
    setWrittenExamForm({
      courseId: String(exam.courseId || ""),
      title: exam.title || "",
      description: exam.description || "",
      passScore: String(exam.passScore || 60),
      accessPolicyMode: exam.accessPolicy?.mode || "course_access",
      requiredCourseIds: Array.isArray(exam.accessPolicy?.requiredCourseIds) ? exam.accessPolicy.requiredCourseIds.map(String) : [],
      requiredCourseMatch: exam.accessPolicy?.requiredCourseMatch === "any" ? "any" : "all",
      allowFree: exam.accessPolicy?.allowFree !== false,
      allowPromotion: exam.accessPolicy?.allowPromotion !== false,
      entitlementDays: String(exam.accessPolicy?.entitlementDays || 0),
      refundBlocksNewAttempts: exam.accessPolicy?.refundBlocksNewAttempts !== false,
      accessGuidance: exam.accessPolicy?.guidance || "",
      questionsText: JSON.stringify(exam.questions || [], null, 2),
    });
  }
  function onCancelWrittenExamEdit() {
    setWrittenExamForm(EMPTY_WRITTEN_EXAM_FORM);
  }
  async function onWrittenExamSave(event) {
    event?.preventDefault?.();
    if (!writtenExamForm.courseId) {
      setAdminStatus("과정을 먼저 선택해 주세요.");
      return false;
    }
    try {
      const questions = JSON.parse(writtenExamForm.questionsText || "[]");
      const result = await api(`/api/admin/written-exams/${writtenExamForm.courseId}`, {
        method: "PUT",
        body: {
          title: writtenExamForm.title,
          description: writtenExamForm.description,
          passScore: Number(writtenExamForm.passScore || 60),
          accessPolicy: {
            mode: writtenExamForm.accessPolicyMode || "course_access",
            requiredCourseIds: (writtenExamForm.requiredCourseIds || []).map(Number).filter(Boolean),
            requiredCourseMatch: writtenExamForm.requiredCourseMatch || "all",
            allowFree: writtenExamForm.allowFree !== false,
            allowPromotion: writtenExamForm.allowPromotion !== false,
            entitlementDays: Number(writtenExamForm.entitlementDays || 0),
            refundBlocksNewAttempts: writtenExamForm.refundBlocksNewAttempts !== false,
            guidance: writtenExamForm.accessGuidance || "",
          },
          questions,
        },
      });
      setAdminStatus(result.message);
      pushToast(result.message, "success");
      setWrittenExams((current) => upsertByKey(current, result.exam, "courseId"));
      void loadWrittenExams();
      return true;
    } catch (error) {
      setAdminStatus(error.message);
      return false;
    }
  }
  async function onWrittenExamDelete(courseId) {
    try {
      const result = await api(`/api/admin/written-exams/${courseId}`, { method: "DELETE" });
      setAdminStatus(result.message);
      pushToast(result.message, "success");
      setWrittenExams((current) => removeByKey(current, courseId, "courseId"));
      setWrittenExamForm((current) => String(current.courseId) === String(courseId) ? {
        ...EMPTY_WRITTEN_EXAM_FORM,
        courseId: String(courseId),
      } : current);
      void loadWrittenExams();
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onSubmitWrittenExam(courseId) {
    try {
      const result = await api(`/api/written-exams/${courseId}/submit`, {
        method: "POST",
        body: { answers: writtenExamAnswers[courseId] || {} },
      });
      setWrittenExamStatus({
        tone: result.attempt?.passed ? "success" : "info",
        message: `${result.message} (${result.attempt?.score || 0}/${result.attempt?.totalPoints || 0})`,
      });
      pushToast(result.message, result.attempt?.passed ? "success" : "info");
      await loadWrittenExams();
    } catch (error) {
      setWrittenExamStatus({ tone: "error", message: error.message });
    }
  }
  async function onClaimExamEntitlement(courseId) {
    try {
      const result = await api(`/api/exams/${courseId}/entitlements/claim`, { method: "POST" });
      pushToast(result.message, "success");
      await runSafeRefreshTasks([loadCourses(), loadWrittenExams(), loadLabExams()]);
      return result;
    } catch (error) {
      pushToast(error.message, "error");
      throw error;
    }
  }
  async function onClaimCourseAcquisition(courseId) {
    try {
      const result = await api(`/api/courses/${courseId}/acquisition/claim`, { method: "POST" });
      pushToast(result.message, "success");
      await runSafeRefreshTasks([loadCourses(), loadWrittenExams(), loadLabExams()]);
      return result;
    } catch (error) {
      pushToast(error.message, "error");
      throw error;
    }
  }
  function onLabExamEdit(exam) {
    setLabExamForm({
      courseId: String(exam.courseId || ""),
      heatTemplateName: exam.heatTemplateName || "",
      examKind: exam.examKind || "lab",
      title: exam.title || "",
        description: exam.description || "",
        scenarioContent: exam.scenarioContent || "",
        questionsText: JSON.stringify(Array.isArray(exam.questions) ? exam.questions : [], null, 2),
        gradingGuide: exam.gradingGuide || "",
        operationPolicy: exam.operationPolicy || "",
        gradingNodeRole: exam.gradingNodeRole || "",
        requiredNodeCount: String(exam.requiredNodeCount || 1),
        preflightScript: exam.preflightScript || "",
        isAttemptOpen: exam.isAttemptOpen !== false,
        allowRetake: Boolean(exam.allowRetake),
        maxAttempts: String(exam.maxAttempts || 1),
        accessPolicyMode: exam.accessPolicy?.mode || "course_access",
        requiredCourseIds: Array.isArray(exam.accessPolicy?.requiredCourseIds) ? exam.accessPolicy.requiredCourseIds.map(String) : [],
        requiredCourseMatch: exam.accessPolicy?.requiredCourseMatch === "any" ? "any" : "all",
        allowFree: exam.accessPolicy?.allowFree !== false,
        allowPromotion: exam.accessPolicy?.allowPromotion !== false,
        entitlementDays: String(exam.accessPolicy?.entitlementDays || 0),
        refundBlocksNewAttempts: exam.accessPolicy?.refundBlocksNewAttempts !== false,
        accessGuidance: exam.accessPolicy?.guidance || "",
        manualReviewRequired: Boolean(exam.manualReviewRequired),
        terminateLabAfterSubmit: Boolean(exam.terminateLabAfterSubmit),
        passScore: String(exam.passScore || 60),
        timeoutHours: String(Number(((Number(exam.timeoutSeconds || 3600) / 3600).toFixed(2)))),
        scriptContent: exam.scriptContent || EMPTY_LAB_EXAM_FORM.scriptContent,
    });
  }
  function onCancelLabExamEdit() {
    setLabExamForm(EMPTY_LAB_EXAM_FORM);
  }
  async function onLabExamSave(event) {
    event?.preventDefault?.();
    if (!labExamForm.courseId) {
      setAdminStatus("과정을 먼저 선택해 주세요.");
      return false;
    }
    let questions = [];
    try {
      questions = JSON.parse(String(labExamForm.questionsText || "[]"));
      if (!Array.isArray(questions)) throw new Error("array");
    } catch {
      setAdminStatus("문제 목록 JSON 형식을 확인해 주세요.");
      return false;
    }
    if (!confirmMarkdownBlockingWarnings([
      { label: "시험 시나리오", value: labExamForm.scenarioContent },
      ...questions.map((question, index) => ({ label: question?.title || `문제 ${index + 1}`, value: question?.content || "" })),
    ])) {
      setAdminStatus("Markdown 코드 블록을 확인한 뒤 다시 저장해 주세요.");
      return false;
    }
    try {
      const result = await api(`/api/admin/lab-exams/${labExamForm.courseId}`, {
        method: "PUT",
        body: {
            title: labExamForm.title,
            heatTemplateName: labExamForm.heatTemplateName,
            examKind: labExamForm.examKind,
            description: labExamForm.description,
            scenarioContent: labExamForm.scenarioContent,
            questions,
            gradingGuide: labExamForm.gradingGuide,
            operationPolicy: labExamForm.operationPolicy,
            gradingNodeRole: labExamForm.gradingNodeRole,
            requiredNodeCount: Number(labExamForm.requiredNodeCount || 1),
            preflightScript: labExamForm.preflightScript,
            isAttemptOpen: labExamForm.isAttemptOpen !== false,
            allowRetake: Boolean(labExamForm.allowRetake),
            maxAttempts: Number(labExamForm.maxAttempts || 1),
            accessPolicy: {
              mode: labExamForm.accessPolicyMode || "course_access",
              requiredCourseIds: (labExamForm.requiredCourseIds || []).map(Number).filter(Boolean),
              requiredCourseMatch: labExamForm.requiredCourseMatch || "all",
              allowFree: labExamForm.allowFree !== false,
              allowPromotion: labExamForm.allowPromotion !== false,
              entitlementDays: Number(labExamForm.entitlementDays || 0),
              refundBlocksNewAttempts: labExamForm.refundBlocksNewAttempts !== false,
              guidance: labExamForm.accessGuidance || "",
            },
            manualReviewRequired: Boolean(labExamForm.manualReviewRequired),
            terminateLabAfterSubmit: Boolean(labExamForm.terminateLabAfterSubmit),
            passScore: Number(labExamForm.passScore || 60),
          timeoutHours: Number(labExamForm.timeoutHours || 1),
          scriptContent: labExamForm.scriptContent,
        },
      });
      setAdminStatus(result.message);
      if (result.validation) {
        setLabExamTestStatus({
          tone: result.validation.valid ? (result.validation.warningCount ? "warn" : "success") : "error",
          message: result.message,
          result: null,
          validation: result.validation,
        });
      }
      pushToast(result.message, "success");
      setLabExams((current) => upsertByKey(current, result.exam, "courseId"));
      void loadLabExams();
      return true;
    } catch (error) {
      if (error.payload?.validation) {
        setLabExamTestStatus({
          tone: "error",
          message: error.message,
          result: null,
          validation: error.payload.validation,
        });
      }
      setAdminStatus(error.message);
      return false;
    }
  }
  async function onLabExamDelete(courseId) {
    try {
      const result = await api(`/api/admin/lab-exams/${courseId}`, { method: "DELETE" });
      setAdminStatus(result.message);
      pushToast(result.message, "success");
      setLabExams((current) => removeByKey(current, courseId, "courseId"));
      setLabExamForm((current) => String(current.courseId) === String(courseId) ? {
        ...EMPTY_LAB_EXAM_FORM,
        courseId: String(courseId),
      } : current);
      void loadLabExams();
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onSubmitLabExam(courseId, options = {}) {
    try {
      const labRequestId = Number(options?.labRequestId || 0) || null;
      const result = await api(`/api/lab-exams/${courseId}/submit`, {
        method: "POST",
        body: {
          ...(labRequestId ? { labRequestId } : {}),
          sshPassword: labExamSshPassword,
        },
      });
      setLabExamStatus({
        tone: result.attempt?.passed ? "success" : "info",
        message: `${result.message} (${result.attempt?.score || 0}/${result.attempt?.totalPoints || 0})`,
      });
      setTerminalSession(null);
      pushToast(result.message, result.attempt?.passed ? "success" : "info");
      await runSafeRefreshTasks([loadLabExams(), loadCertificates()]);
    } catch (error) {
      setLabExamStatus({ tone: "error", message: error.message });
    }
  }
  async function onStartLabExam(courseId, options = {}) {
    try {
      setLabExamStatus({ tone: "info", message: "시험 전용 랩을 준비하고 있습니다." });
      const result = await api(`/api/lab-exams/${courseId}/sessions/start`, {
        method: "POST",
        body: options?.preview ? { preview: true } : {},
      });
      const lab = result.lab || null;
      if (result.session) {
        setLabExamSessions((current) => upsertByKey(current, result.session, "id"));
        if (isAdmin) setAdminLabExamSessions((current) => upsertByKey(current, result.session, "id"));
      }
      setLabExamStatus({ tone: "success", message: result.message || "시험 전용 랩이 준비되었습니다." });
      if (lab) {
        setLabs((current) => upsertByKey(current, lab, "id"));
        if (isAdmin) setAdminLabs((current) => upsertByKey(current, lab, "id"));
        setSelectedCourseId(String(lab.courseId || courseId || ""));
      }
      pushToast(result.message || "시험 전용 랩이 준비되었습니다.", "success");
      await runSafeRefreshTasks([loadLabs(), loadLabExams(), ...(isAdmin ? [loadAdmin()] : [])]);
      return result;
    } catch (error) {
      setLabExamStatus({ tone: "error", message: error.message });
      pushToast(error.message, "error");
      return null;
    }
  }
  async function onLabExamConsoleReady(sessionId) {
    try {
      const result = await api(`/api/lab-exam-sessions/${sessionId}/console-ready`, { method: "POST" });
      if (result.session) setLabExamSessions((current) => upsertByKey(current, result.session, "id"));
      if (result.lab) setLabs((current) => upsertByKey(current, result.lab, "id"));
      setLabExamStatus({ tone: "success", message: result.message });
      return result;
    } catch (error) {
      setLabExamStatus({ tone: "error", message: error.message });
      return null;
    }
  }
  async function onRebuildLabExamSession(sessionId) {
    try {
      setLabExamStatus({ tone: "info", message: "시험 전용 랩을 재구성하고 있습니다." });
      setTerminalSession(null);
      const result = await api(`/api/lab-exam-sessions/${sessionId}/rebuild`, { method: "POST" });
      if (result.session) {
        setLabExamSessions((current) => upsertByKey(current, result.session, "id"));
        if (isAdmin) setAdminLabExamSessions((current) => upsertByKey(current, result.session, "id"));
      }
      setLabExamStatus({ tone: "success", message: result.message });
      pushToast(result.message, "success");
      await runSafeRefreshTasks([loadLabs(), loadLabExams(), ...(isAdmin ? [loadAdmin()] : [])]);
      return result;
    } catch (error) {
      setLabExamStatus({ tone: "error", message: error.message });
      pushToast(error.message, "error");
      return null;
    }
  }
  async function onFinishLabExamSession(sessionId, options = {}) {
    try {
      setLabExamStatus({ tone: "info", message: "시험을 종료하고 채점 중입니다." });
      const result = await api(`/api/lab-exam-sessions/${sessionId}/finish`, {
        method: "POST",
        body: {
          reason: options?.reason || "submitted",
          ...(options?.screenCapture ? { screenCapture: options.screenCapture } : {}),
        },
      });
      setLabExamStatus({
        tone: result.attempt?.passed ? "success" : "info",
        message: `${result.message} (${result.attempt?.score || 0}/${result.attempt?.totalPoints || 0})`,
      });
      setTerminalSession(null);
      pushToast(result.message || "채점이 완료되었습니다.", result.attempt?.passed ? "success" : "info");
      await runSafeRefreshTasks([
        loadLabs(),
        loadLabExams(),
        loadCertificates(),
        loadNotifications(),
        loadMessages(),
      ]);
      return result;
    } catch (error) {
      setLabExamStatus({ tone: "error", message: error.message });
      pushToast(error.message, "error");
      return null;
    }
  }
  async function onReviewLabExamAttempt(attemptId, reviewStatus, reviewNote = "") {
    try {
      const result = await api(`/api/admin/lab-exam-attempts/${attemptId}/review`, {
        method: "PATCH",
        body: { reviewStatus, reviewNote },
      });
      setAdminStatus(result.message);
      pushToast(result.message, "success");
      await loadLabExams();
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message, "error");
    }
  }
  async function onResendLabExamResultMail(attemptId) {
    try {
      const result = await api(`/api/admin/lab-exam-attempts/${attemptId}/resend-mail`, { method: "POST" });
      setAdminStatus(result.message);
      pushToast(result.message, "success");
      await loadLabExams();
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message, "error");
    }
  }
  async function onUpdateLabExamAttemptManualResult(attemptId, payload = {}) {
    try {
      const result = await api(`/api/admin/lab-exam-attempts/${attemptId}/manual-result`, {
        method: "PATCH",
        body: payload,
      });
      setAdminStatus(result.message);
      pushToast(result.message, payload.resend ? "success" : "info");
      await runSafeRefreshTasks([loadLabExams(), loadNotifications(), loadMessages()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message, "error");
    }
  }
  async function onGenerateLabExamAttemptLlmReport(attemptId, payload = {}) {
    try {
      const result = await api(`/api/admin/lab-exam-attempts/${attemptId}/llm-report`, {
        method: "POST",
        body: payload,
      });
      pushToast(result.message, "success");
      return result.report || "";
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message, "error");
      return "";
    }
  }
  async function onRegradeLabExamAttempt(attemptId) {
    const confirmed = window.confirm("이 결과를 현재 시험 전용 랩 상태로 다시 채점할까요? 중지되었거나 종료 표시된 시험 랩은 먼저 다시 시작한 뒤 채점합니다.");
    if (!confirmed) return;
    try {
      const result = await api(`/api/admin/lab-exam-attempts/${attemptId}/regrade`, { method: "POST" });
      setAdminStatus(result.message);
      pushToast(result.message, result.attempt?.passed ? "success" : "info");
      await runSafeRefreshTasks([loadLabExams(), loadNotifications(), loadMessages()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message, "error");
    }
  }
  async function onCreateManualLabExamResult(sessionId) {
    const rawScore = window.prompt("임시 점수를 입력해 주세요. 예: 80/100", "0/100");
    if (rawScore == null) return;
    const scoreMatch = String(rawScore || "").trim().match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?$/);
    if (!scoreMatch) {
      pushToast("점수 형식이 올바르지 않습니다. 예: 80/100", "error");
      return;
    }
    const score = Number(scoreMatch[1] || 0);
    const totalPoints = Number(scoreMatch[2] || 100);
    const reviewNote = window.prompt("사용자에게 전달할 강사/AI 코멘트를 입력해 주세요.", "시험 서버 장애로 관리자가 임시 결과를 등록했습니다.");
    if (reviewNote == null) return;
    const confirmed = window.confirm(`${score}/${totalPoints} 점으로 임시 결과를 저장하고 사용자에게 메일/쪽지를 발송할까요?`);
    if (!confirmed) return;
    try {
      const result = await api(`/api/admin/lab-exam-sessions/${sessionId}/manual-result`, {
        method: "POST",
        body: {
          score,
          totalPoints,
          reviewNote,
        },
      });
      setAdminStatus(result.message);
      pushToast(result.message, "success");
      if (result.attempt) {
        setAdminLabExamAttempts((current) => upsertByKey(current, result.attempt, "id"));
      }
      if (result.session) {
        setAdminLabExamSessions((current) => upsertByKey(current, result.session, "id"));
        setLabExamSessions((current) => upsertByKey(current, result.session, "id"));
      }
      await runSafeRefreshTasks([loadLabExams(), loadNotifications(), loadMessages()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message, "error");
    }
  }
  async function onForceEndLabExamSession(sessionId, options = {}) {
    const deleteLab = options.deleteLab !== false;
    try {
      const result = await api(`/api/admin/lab-exam-sessions/${sessionId}/force-end`, { method: "POST", body: { deleteLab } });
      setAdminStatus(result.message);
      pushToast(result.message, "success");
      if (result.attempt) {
        setAdminLabExamAttempts((current) => upsertByKey(current, result.attempt, "id"));
      }
      if (result.session) {
        setAdminLabExamSessions((current) => upsertByKey(current, result.session, "id"));
        setLabExamSessions((current) => upsertByKey(current, result.session, "id"));
      }
      if (result.lab) {
        setLabs((current) => upsertByKey(current, result.lab, "id"));
      }
      await runSafeRefreshTasks([loadLabExams(), loadLabs(), loadAdmin(), loadNotifications(), loadMessages()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message, "error");
    }
  }
  async function onAdminLabPowerAction(labRequestId, action) {
    const labId = Number(labRequestId || 0);
    const normalizedAction = String(action || "").toLowerCase() === "resume" ? "resume" : "pause";
    if (!labId) return;
    const label = normalizedAction === "resume" ? "다시 시작" : "중지";
    const confirmed = window.confirm(`이 랩을 ${label}할까요?`);
    if (!confirmed) return;
    try {
      const result = await api(`/api/admin/labs/${labId}/${normalizedAction}`, { method: "POST" });
      setAdminStatus(result.message);
      pushToast(result.message, "success");
      await runSafeRefreshTasks([loadLabs(), loadLabExams(), loadAdmin()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message, "error");
    }
  }
  async function onWarnInstanceUsage(item = {}) {
    const type = String(item.type || "").trim();
    const id = Number(item.id || 0) || 0;
    if (!type || !id) {
      setAdminStatus("경고를 보낼 인스턴스를 선택해 주세요.");
      return;
    }
    const targetLabel = item.userName || item.username || item.title || `인스턴스 #${id}`;
    const confirmed = window.confirm(`${targetLabel}에게 사용량 경고를 보낼까요? 이메일과 쪽지로 안내됩니다.`);
    if (!confirmed) return;
    try {
      const result = await api("/api/admin/instance-monitor/warn", {
        method: "POST",
        body: { type, id },
      });
      setAdminStatus(result.message);
      pushToast(result.message, result.mailErrorMessage ? "info" : "success");
      await runSafeRefreshTasks([loadMessages(), loadAdminMailLogs(), loadAdminInstanceMonitor(false)]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message, "error");
    }
  }
  async function onSendAutoInstanceWarnings() {
    const confirmed = window.confirm("자동 경고 후보에게 사용량 경고 쪽지와 이메일을 발송할까요? 최근 발송 대상은 쿨다운으로 제외됩니다.");
    if (!confirmed) return;
    try {
      const result = await api("/api/admin/instance-monitor/auto-warn", { method: "POST" });
      setAdminStatus(result.message);
      pushToast(result.message, result.failed ? "info" : "success");
      await runSafeRefreshTasks([loadMessages(), loadAdminMailLogs(), loadAdminInstanceMonitor(false)]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message, "error");
    }
  }
  async function onDeleteLabExamAttempt(attemptId, options = {}) {
    if (!options.skipConfirm) {
      const confirmed = window.confirm("이 채점 결과를 삭제할까요? 삭제하면 해당 사용자는 제출 횟수 한도 내에서 다시 응시할 수 있습니다.");
      if (!confirmed) return;
    }
    try {
      const result = await api(`/api/admin/lab-exam-attempts/${attemptId}`, { method: "DELETE" });
      setAdminStatus(result.message);
      pushToast(result.message, "success");
      await runSafeRefreshTasks([loadLabExams(), loadCertificates()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message, "error");
    }
  }
  async function onBulkRemoveLabExamItems({ attemptIds = [], sessionIds = [] } = {}, options = {}) {
    const normalizedAttemptIds = [...new Set(attemptIds.map((id) => String(id || "").trim()).filter(Boolean))];
    const normalizedSessionIds = [...new Set(sessionIds.map((id) => String(id || "").trim()).filter(Boolean))];
    const total = normalizedAttemptIds.length + normalizedSessionIds.length;
    if (!total) {
      pushToast("제거할 시험 기록 또는 시험 세션을 선택해 주세요.", "error");
      return null;
    }
    if (!options.skipConfirm) {
      const confirmed = window.confirm(`선택한 시험 기록 ${normalizedAttemptIds.length}건과 시험 세션 ${normalizedSessionIds.length}건을 제거할까요? 진행 중 세션의 전용 랩도 함께 삭제됩니다.`);
      if (!confirmed) return null;
    }
    try {
      const result = await api("/api/admin/lab-exams/bulk-remove", {
        method: "POST",
        body: { attemptIds: normalizedAttemptIds, sessionIds: normalizedSessionIds },
      });
      setAdminStatus(result.message);
      pushToast(result.message, result.failed?.length ? "info" : "success");
      await runSafeRefreshTasks([loadLabExams(), loadLabs(), loadAdmin(), loadCertificates()]);
      return result;
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message, "error");
      return null;
    }
  }
  async function onValidateLabExamScript() {
    if (!labExamForm.courseId) {
      const message = "과정을 먼저 선택해 주세요.";
      setLabExamTestStatus({ tone: "error", message, result: null, validation: null });
      setAdminStatus(message);
      return;
    }
    try {
      setLabExamTestStatus({ tone: "info", message: "채점 스크립트를 저장 전 검증하고 있습니다.", result: null, validation: null });
      const timeoutSeconds = Math.min(24 * 60 * 60, Math.max(5 * 60, Math.round(Number(labExamForm.timeoutHours || 1) * 3600) || 3600));
      const result = await api(`/api/admin/lab-exams/${labExamForm.courseId}/validate-script`, {
        method: "POST",
        body: {
          scriptContent: labExamForm.scriptContent,
          preflightScript: labExamForm.preflightScript,
          passScore: Number(labExamForm.passScore || 60),
          timeoutSeconds,
        },
      });
      const validation = result.validation || null;
      const tone = validation?.valid ? (validation.warningCount ? "warn" : "success") : "error";
      setLabExamTestStatus({
        tone,
        message: result.message,
        result: null,
        validation,
      });
      setAdminStatus(result.message);
      pushToast(result.message, validation?.valid ? "success" : "error");
    } catch (error) {
      setLabExamTestStatus({ tone: "error", message: error.message, result: null, validation: null });
      setAdminStatus(error.message);
      pushToast(error.message, "error");
    }
  }
  async function onTestLabExamScript(labRequestId) {
    if (!labExamForm.courseId) {
      const message = "과정을 먼저 선택해 주세요.";
      setLabExamTestStatus({ tone: "error", message, result: null, validation: null });
      setAdminStatus(message);
      return;
    }
    try {
      setLabExamTestStatus({ tone: "info", message: "채점 스크립트를 테스트하고 있습니다.", result: null, validation: null });
      const timeoutSeconds = Math.min(300, Math.max(10, Math.round(Number(labExamForm.timeoutHours || 1) * 3600) || 120));
      const result = await api(`/api/admin/lab-exams/${labExamForm.courseId}/test`, {
        method: "POST",
        body: {
          labRequestId,
          scriptContent: labExamForm.scriptContent,
          scenarioContent: labExamForm.scenarioContent,
          timeoutSeconds,
        },
      });
      setLabExamTestStatus({
        tone: result.result?.passed ? "success" : "warn",
        message: `${result.message} (${result.result?.score || 0}/${result.result?.totalPoints || 0})`,
        result: result.result || null,
        validation: null,
      });
      setAdminStatus(result.message);
      pushToast(result.message, result.result?.passed ? "success" : "info");
    } catch (error) {
      setLabExamTestStatus({ tone: "error", message: error.message, result: null, validation: null });
      setAdminStatus(error.message);
      pushToast(error.message, "error");
    }
  }
  async function onPreflightLabExam(labRequestId) {
    if (!labExamForm.courseId || !labRequestId) {
      const message = "과정과 실행 중인 랩을 선택해 주세요.";
      setLabExamTestStatus({ tone: "error", message, result: null, validation: null });
      return;
    }
    try {
      setLabExamTestStatus({ tone: "info", message: "시험 랩 환경을 점검하고 있습니다.", result: null, validation: null });
      const result = await api(`/api/admin/lab-exams/${labExamForm.courseId}/preflight`, {
        method: "POST",
        body: {
          ...labExamForm,
          labRequestId,
          requiredNodeCount: Number(labExamForm.requiredNodeCount || 1),
          passScore: Number(labExamForm.passScore || 60),
          timeoutHours: Number(labExamForm.timeoutHours || 1),
          sshPassword: labExamSshPassword,
        },
      });
      setLabExamTestStatus({
        tone: result.result?.passed ? "success" : "warn",
        message: result.message,
        result: result.result || null,
        validation: null,
      });
      setAdminStatus(result.message);
      pushToast(result.message, result.result?.passed ? "success" : "info");
    } catch (error) {
      setLabExamTestStatus({ tone: "error", message: error.message, result: null, validation: null });
      setAdminStatus(error.message);
      pushToast(error.message, "error");
    }
  }
  async function onIssueCertificate(courseId) {
    try {
      const result = await api(`/api/certificates/${courseId}/issue`, { method: "POST" });
      setCertificateStatus({ tone: "success", message: result.message });
      pushToast(result.message, "success");
      await loadCertificates();
    } catch (error) {
      setCertificateStatus({ tone: "error", message: error.message });
    }
  }
  async function onRefreshApiMonitor() {
    try {
      await runSafeRefreshTasks([loadApiMonitor(false, true), loadAdminInstanceMonitor(false, true)]);
      setAdminStatus("API 상태를 새로고침했습니다.");
      pushToast("API 상태를 새로고침했습니다.", "success");
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onStartTrafficDebugCapture(options = {}) {
    const parsedDuration = Number.parseInt(options.durationSeconds, 10);
    const durationSeconds = Math.max(5, Math.min(90, Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 30));
    const interfaceName = String(options.interfaceName || "").trim();
    setTrafficDebugStatus({
      capturing: true,
      tone: "info",
      message: `${durationSeconds}초 동안 outgoing 트래픽을 캡처합니다. 관리자 화면은 그대로 두고 다른 탭에서 재현 동작을 실행해 주세요.`,
      durationSeconds,
      interfaceName,
    });
    try {
      const result = await api("/api/admin/traffic-debug/capture", {
        method: "POST",
        body: { durationSeconds, interfaceName },
      });
      setTrafficDebugCapture(result);
      setTrafficDebugStatus({
        capturing: false,
        tone: result?.network?.available === false ? "info" : "success",
        message: result?.message || "outgoing 트래픽 디버그 캡처가 완료되었습니다.",
        durationSeconds: result?.durationSeconds || durationSeconds,
        interfaceName: result?.interfaceName || interfaceName,
      });
      pushToast("outgoing 트래픽 디버그 캡처가 완료되었습니다.", "success");
      return result;
    } catch (error) {
      setTrafficDebugStatus({
        capturing: false,
        tone: "error",
        message: error.message || "outgoing 트래픽 캡처 중 오류가 발생했습니다.",
        durationSeconds,
        interfaceName,
      });
      pushToast(error.message || "outgoing 트래픽 캡처 중 오류가 발생했습니다.", "error");
      return null;
    }
  }
  async function onAskLlm(event) {
    event.preventDefault();
    if (llmStreaming) return;
    const question = String(llmQuestion || "").trim();
    if (!question) {
      setLlmStatus({ tone: "error", message: "질문을 입력해 주세요." });
      return;
    }
    if (llmQuotaStatus?.enabled && !llmQuotaStatus?.bypassed && llmQuotaStatus?.canAsk === false) {
      setLlmStatus({ tone: "error", message: "오늘 AI 질문 한도를 모두 사용했습니다." });
        return;
      }
      const userMessage = { id: `${Date.now()}-q`, role: "user", text: question };
      const assistantMessageId = `${Date.now()}-a`;
      const history = [];
      setLlmMessages((current) => [
        ...current,
        userMessage,
        { id: assistantMessageId, role: "assistant", text: "" },
      ]);
      setLlmQuestion("");
        setLlmStatus({ tone: "", message: "" });
        setLlmStreaming(true);
        let streamedAnswer = "";
        let streamedThinking = "";
        let renderedAnswer = "";
        let renderFrame = 0;
        const buildAssistantStreamText = () => {
          const thinkingText = streamedThinking.trimEnd();
          const answerText = streamedAnswer;
          if (thinkingText && answerText.trim()) {
            return `>>> thinking\n${thinkingText}\n\n>>> ai\n${answerText}`;
          }
          if (thinkingText) {
            return `>>> thinking\n${thinkingText}`;
          }
          return answerText;
        };
        const hasStreamedOutput = () => Boolean(streamedAnswer.trim() || streamedThinking.trim());
        const renderAssistantText = (text) => {
          renderedAnswer = text;
          setLlmMessages((current) => current.map((message) => (
            message.id === assistantMessageId
              ? { ...message, text }
              : message
          )));
        };
        const scheduleAssistantRender = () => {
          if (renderFrame) return;
          const scheduler = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
            ? window.requestAnimationFrame
            : (callback) => window.setTimeout(callback, 16);
          renderFrame = scheduler(() => {
            renderFrame = 0;
            const nextText = buildAssistantStreamText();
            if (renderedAnswer !== nextText) {
              renderAssistantText(nextText);
            }
          });
        };
        const flushAssistantRender = () => {
          if (renderFrame && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
            window.cancelAnimationFrame(renderFrame);
          }
          renderFrame = 0;
          const nextText = buildAssistantStreamText();
          if (renderedAnswer !== nextText) {
            renderAssistantText(nextText);
          }
        };
        try {
        const targetCourseId = Number(selectedCourseId || activeLab?.courseId || 0) || null;
        await streamApi("/api/llm/chat/stream", {
          body: {
            question,
            courseId: targetCourseId,
            history,
          },
            onEvent: async (streamEvent) => {
              if (streamEvent?.type === "thinking") {
                streamedThinking += String(streamEvent.text || "");
                scheduleAssistantRender();
              }
              if (streamEvent?.type === "delta") {
                streamedAnswer += String(streamEvent.text || "");
                scheduleAssistantRender();
              }
              if (streamEvent?.type === "done") {
                const finalAnswer = String(streamEvent.answer || "");
                const finalThinking = String(streamEvent.thinking || "");
                if (!streamedAnswer.trim() && finalAnswer.trim()) {
                  streamedAnswer = finalAnswer;
                }
                if (!streamedThinking.trim() && finalThinking.trim()) {
                  streamedThinking = finalThinking;
                }
                flushAssistantRender();
                if (streamEvent?.quota) {
                  setLlmQuotaStatus(streamEvent.quota);
                }
              if (!hasStreamedOutput()) {
                setLlmMessages((current) => current.map((message) => (
                  message.id === assistantMessageId
                    ? { ...message, text: streamEvent.answer || "LLM이 빈 응답을 반환했습니다. 관리자 LLM 설정에서 모델 ID와 API URL을 확인해 주세요.", tone: "error" }
                    : message
                )));
              }
            }
            if (streamEvent?.type === "error") {
              const errorThinking = String(streamEvent.thinking || "");
              if (!streamedThinking.trim() && errorThinking.trim()) {
                streamedThinking = errorThinking;
                flushAssistantRender();
              }
              throw new Error(streamEvent.message || "LLM API 연결에 실패했습니다.");
            }
          },
        });
        if (!streamedAnswer.trim()) {
          await loadLlmQuotaStatus();
        }
        } catch (error) {
          flushAssistantRender();
          setLlmMessages((current) => current.map((message) => (
            message.id === assistantMessageId && !hasStreamedOutput()
              ? { ...message, text: error.message, tone: "error" }
            : message
        )));
        if (hasStreamedOutput()) {
          setLlmMessages((current) => [
            ...current,
            { id: `${Date.now()}-e`, role: "assistant", text: error.message, tone: "error" },
          ]);
        }
        if (error?.payload?.quota) {
          setLlmQuotaStatus(error.payload.quota);
        }
          setLlmStatus({ tone: "error", message: error.message });
        } finally {
          flushAssistantRender();
          setLlmStreaming(false);
        }
    }
  function onResetLlmConversation() {
    setLlmMessages([]);
    setLlmStatus({ tone: "", message: "" });
    pushToast("AI 대화를 초기화했습니다.", "success");
  }
  function onSelectTerminalCourse(courseId) {
    const nextCourseId = Number(courseId) || courseId || null;
    terminalCourseSelectionTouchedRef.current = true;
    setSelectedCourseId(nextCourseId);
    setTerminalSession(null);
    setTerminalRequest({ tone: "", message: "선택한 과정 기준으로 터미널 정보를 갱신했습니다. 실행 중인 랩은 연결 버튼으로 다시 연결해 주세요." });
  }
  function onClearTerminalSession(message = "터미널 세션이 만료되었습니다. 다시 연결해 주세요.") {
    terminalSessionRequestRef.current.cancel();
    setTerminalSession(null);
    setTerminalSessionBusy(false);
    setTerminalRequest({ tone: "info", message });
  }
  async function onCreateTerminalSession(overrides = {}) {
    const safeOverrides = overrides
      && typeof overrides === "object"
      && !("nativeEvent" in overrides)
      && !("preventDefault" in overrides)
      && !("currentTarget" in overrides)
      && !("target" in overrides)
      ? overrides
      : {};
    const replacePendingRequest = Boolean(safeOverrides.replacePending || safeOverrides.supersedePending);
    const {
      replacePending: _replacePending,
      supersedePending: _supersedePending,
      keepSection: _keepSection,
      stayOnCurrentSection: _stayOnCurrentSection,
      ...requestOverrides
    } = safeOverrides;
    const initialReplayMetadata = getInitialTerminalReplayMetadata();
    const requestedReplayMetadata = safeOverrides.replayMetadata && typeof safeOverrides.replayMetadata === "object"
      ? safeOverrides.replayMetadata
      : {};
    const replayMetadata = {
      ...initialReplayMetadata,
      ...requestedReplayMetadata,
    };
    const stayOnCurrentSection = Boolean(safeOverrides.stayOnCurrentSection || safeOverrides.keepSection);
    const hasReplayMetadata = Object.values(replayMetadata).some((value) => String(value || "").trim());
    const popupLabId = popupMode === "terminal" ? getInitialSelectedLabId() : 0;
    const targetLabId = Number(safeOverrides.labId || selectedCourseLab?.id || activeLab?.id || popupLabId || 0);
    const targetLab = labs.find((item) => Number(item.id) === targetLabId) || selectedCourseLab || activeLab || null;
    const targetCourseId = Number(safeOverrides.courseId || targetLab?.courseId || selectedCourseId || 0);
    const targetCourse = courses.find((item) => Number(item.id) === targetCourseId) || selectedCourse || null;
    const requestTargetKey = [
      targetLabId || "no-lab",
      String(safeOverrides.nodeId || "").trim() || String(safeOverrides.targetHost || "").trim() || "default",
    ].join(":");
    const requestStart = terminalSessionRequestRef.current.begin({
      key: requestTargetKey,
      replace: replacePendingRequest,
    });
    if (!requestStart.started) {
      setTerminalRequest({ tone: "info", message: "이미 터미널 연결 상태를 확인하고 있습니다. 잠시만 기다려 주세요." });
      return { retryable: true };
    }
    const activeRequest = requestStart.request;
    const targetBackendType = String(targetLab?.labBackendType || targetCourse?.labBackendType || "").trim().toLowerCase();
    const preparingMessage = targetBackendType === "container"
      ? "컨테이너 터미널 상태를 확인하고 있습니다. 콘솔이 준비되면 자동으로 연결됩니다."
      : "터미널 연결 상태를 확인하고 있습니다. SSH가 준비되면 자동으로 연결됩니다. 보통 10~30초 정도 걸립니다.";
    setTerminalSessionBusy(true);
    try {
      setTerminalRequest({ tone: "info", message: preparingMessage });
      const terminalRequestBody = {
        ...terminalForm,
        ...(targetCourseId ? { courseId: targetCourseId } : {}),
        ...(targetLabId ? { labId: targetLabId } : {}),
        ...requestOverrides,
        ...(hasReplayMetadata ? { replayMetadata } : {}),
      };
      const readinessStartedAt = Date.now();
      while (true) {
        const readiness = await api("/api/terminal/readiness", {
          method: "POST",
          body: terminalRequestBody,
          signal: activeRequest.controller.signal,
        });
        if (!terminalSessionRequestRef.current.isCurrent(activeRequest)) {
          return { cancelled: true, retryable: false };
        }
        if (readiness?.message) {
          setTerminalRequest({ tone: "info", message: readiness.message });
        }
        if (readiness?.ready) break;
        if (Date.now() - readinessStartedAt > TERMINAL_READINESS_MAX_WAIT_MS) {
          throw new Error("터미널 연결 확인 시간이 길어지고 있습니다. 잠시 후 다시 연결해 주세요.");
        }
        await waitForMs(Math.max(1000, Math.min(5000, Number(readiness?.retryAfterMs || 2000))));
        if (!terminalSessionRequestRef.current.isCurrent(activeRequest)) {
          return { cancelled: true, retryable: false };
        }
      }
      const result = await api("/api/terminal/session", {
        method: "POST",
        body: terminalRequestBody,
        signal: activeRequest.controller.signal,
      });
      if (!terminalSessionRequestRef.current.isCurrent(activeRequest)) {
        return { cancelled: true, retryable: false };
      }
      const successMessage = String(result?.message || `${result.targetLabel} 연결을 준비했습니다.`);
      if (!stayOnCurrentSection) setSection("terminal");
      setTerminalSession(result);
      setTerminalNonce((value) => value + 1);
      setTerminalRequest({ tone: "success", message: successMessage });
      pushToast(successMessage, "success");
      return result;
    } catch (error) {
      if (error?.name === "AbortError" || !terminalSessionRequestRef.current.isCurrent(activeRequest)) {
        return { cancelled: true, retryable: false };
      }
      const bootPending = error?.payload?.code === "VM_BOOT_NOT_READY" || Number(error?.status || 0) === 425;
      const message = error.message || (bootPending ? "터미널 연결 확인이 아직 끝나지 않았습니다. 잠시 후 다시 연결해 주세요." : "터미널 연결 준비 중 오류가 발생했습니다.");
      const status = Number(error?.status || 0);
      const retryable = bootPending
        || /터미널 연결 확인 시간이 길어지고 있습니다|failed to fetch|networkerror|load failed/i.test(String(message))
        || status === 408
        || status === 429
        || status >= 500;
      setTerminalRequest({ tone: bootPending ? "info" : "error", message });
      pushToast(message, bootPending ? "info" : "error");
      return { retryable };
    } finally {
      if (terminalSessionRequestRef.current.finish(activeRequest)) {
        setTerminalSessionBusy(false);
      }
    }
  }
  async function onCreateCustomLabTerminalSession(requestId, overrides = {}) {
    const targetRequestId = Number(requestId || 0);
    if (!targetRequestId) {
      const message = "고급 랩 요청을 찾을 수 없습니다.";
      setTerminalRequest({ tone: "error", message });
      pushToast(message, "error");
      return;
    }
    const safeOverrides = overrides && typeof overrides === "object" ? overrides : {};
    const stayOnCurrentSection = Boolean(safeOverrides.stayOnCurrentSection || safeOverrides.keepSection);
    try {
      setTerminalRequest({ tone: "info", message: "고급 랩 콘솔 연결을 준비하고 있습니다. 기존 콘솔은 연결 전까지 유지됩니다." });
      const result = await api(`/api/custom-lab-requests/${targetRequestId}/terminal/session`, {
        method: "POST",
        body: {
          ...safeOverrides,
        },
      });
      const successMessage = String(result?.message || `${result.targetLabel} 연결을 준비했습니다.`);
      if (!stayOnCurrentSection) setSection("customLabs");
      setTerminalSession(result);
      setTerminalNonce((value) => value + 1);
      setTerminalRequest({ tone: "success", message: successMessage });
      pushToast(successMessage, "success");
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message });
      pushToast(error.message || "고급 랩 콘솔 연결 준비 중 오류가 발생했습니다.", "error");
    }
  }
  async function onUploadLabFile(file, labId = null, overrides = {}) {
    if (!file) return;
    const targetLabId = Number(labId || activeLab?.id || 0);
    if (!targetLabId) {
      setTerminalRequest({ tone: "error", message: "업로드할 랩을 찾을 수 없습니다." });
      return;
    }
    try {
      setTerminalUploadState({ uploading: true, fileName: file.name });
      const formData = new FormData();
      formData.append("file", file, file.name);
      if (overrides?.nodeId) formData.append("nodeId", String(overrides.nodeId));
      if (overrides?.targetHost) formData.append("targetHost", String(overrides.targetHost));
      const result = await api(`/api/labs/${targetLabId}/upload`, {
        method: "POST",
        body: formData,
      });
      const remotePath = result.upload?.remotePath || `~/uploads/${file.name}`;
      setTerminalRequest({ tone: "success", message: `${file.name} 업로드 완료 (${remotePath})` });
      pushToast(`${file.name} 업로드 완료`, "success");
      await loadLabs();
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message || "파일 업로드 중 오류가 발생했습니다." });
      pushToast(error.message || "파일 업로드 중 오류가 발생했습니다.", "error");
    } finally {
      setTerminalUploadState({ uploading: false, fileName: "" });
    }
  }
  function onOpenTerminalPopup(labOverride = null, options = {}) {
    const popupUrl = new URL(window.location.href);
    const safeLabOverride = labOverride
      && typeof labOverride === "object"
      && !("nativeEvent" in labOverride)
      && !("preventDefault" in labOverride)
      && !("currentTarget" in labOverride)
      && !("target" in labOverride)
      ? labOverride
      : null;
    const targetLab = safeLabOverride || activeLab || selectedCourseLab || null;
    const targetCourseId = Number(targetLab?.courseId || selectedCourseId || 0);
    const targetLabId = Number(targetLab?.id || 0);
    popupUrl.pathname = "/";
    popupUrl.searchParams.set("popup", "terminal");
    if (targetCourseId) popupUrl.searchParams.set("courseId", String(targetCourseId));
    if (targetLabId) popupUrl.searchParams.set("labId", String(targetLabId));
    const replayMetadata = options?.replayMetadata && typeof options.replayMetadata === "object" ? options.replayMetadata : {};
    if (String(replayMetadata.purpose || "").trim()) popupUrl.searchParams.set("replayPurpose", String(replayMetadata.purpose || "").trim());
    if (String(replayMetadata.labExamCourseId || "").trim()) popupUrl.searchParams.set("labExamCourseId", String(replayMetadata.labExamCourseId || "").trim());
    if (String(replayMetadata.labExamTitle || "").trim()) popupUrl.searchParams.set("labExamTitle", String(replayMetadata.labExamTitle || "").trim());
    if (String(replayMetadata.labExamKind || "").trim()) popupUrl.searchParams.set("labExamKind", String(replayMetadata.labExamKind || "").trim());
    if (String(replayMetadata.labRequestId || "").trim()) popupUrl.searchParams.set("replayLabRequestId", String(replayMetadata.labRequestId || "").trim());
    const nodeId = String(options?.nodeId || "").trim();
    const targetHost = String(options?.targetHost || "").trim();
    if (nodeId) popupUrl.searchParams.set("nodeId", nodeId);
    if (targetHost) popupUrl.searchParams.set("targetHost", targetHost);
    const openInNewTab = Boolean(options?.newTab);
    const popup = openInNewTab
      ? window.open(popupUrl.toString(), "_blank")
      : window.open(popupUrl.toString(), "terminal-lab-console", "popup=yes,width=1440,height=960,resizable=yes,scrollbars=yes");
    if (!popup) {
      pushToast("브라우저 팝업이 차단되어 콘솔 창을 열 수 없습니다.", "error");
      return;
    }
    if (openInNewTab) popup.opener = null;
    popup.focus?.();
    pushToast(openInNewTab ? "웹 터미널 새 탭을 열었습니다." : "콘솔 새 창을 열었습니다.", "success");
  }
  async function onOpenVncConsole(labId = null, overrides = {}) {
    const targetLabId = Number(labId || activeLab?.id || 0);
    if (!targetLabId) {
      pushToast("VNC 콘솔을 열 랩을 찾을 수 없습니다.", "error");
      return;
    }
    try {
      const result = await api(`/api/labs/${targetLabId}/console/vnc`, {
        method: "POST",
        body: {
          nodeId: String(overrides?.nodeId || "").trim(),
          targetHost: String(overrides?.targetHost || "").trim(),
          serverName: String(overrides?.serverName || "").trim(),
        },
      });
      const popup = window.open(result.url, "terminal-lab-vnc-console", "popup=yes,width=1440,height=960,resizable=yes,scrollbars=yes");
      if (!popup) {
        throw new Error("브라우저 팝업이 차단되어 VNC 콘솔을 열 수 없습니다.");
      }
      popup.focus?.();
      setTerminalRequest({ tone: "success", message: result.message || `${result.targetLabel} VNC 콘솔을 열었습니다.` });
      pushToast(result.message || `${result.targetLabel} VNC 콘솔을 열었습니다.`, "success");
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message || "VNC 콘솔을 열지 못했습니다." });
      pushToast(error.message || "VNC 콘솔을 열지 못했습니다.", "error");
    }
  }
  async function onSendVncClipboard(labId = null, payload = {}) {
    const targetLabId = Number(labId || activeLab?.id || 0);
    if (!targetLabId) {
      pushToast("VNC 콘솔을 찾을 랩이 없습니다.", "error");
      throw new Error("VNC 콘솔을 찾을 랩이 없습니다.");
    }
    const text = String(payload?.text || "").trimEnd();
    if (!text) {
      pushToast("VNC 콘솔에 보낼 텍스트를 입력해 주세요.", "error");
      throw new Error("VNC 콘솔에 보낼 텍스트를 입력해 주세요.");
    }
    try {
      const result = await api(`/api/labs/${targetLabId}/console/vnc/clipboard`, {
        method: "POST",
        body: {
          nodeId: String(payload?.nodeId || "").trim(),
          targetHost: String(payload?.targetHost || "").trim(),
          serverName: String(payload?.serverName || "").trim(),
          text,
          mode: String(payload?.mode || "clipboard").trim(),
        },
      });
      setTerminalRequest({ tone: "success", message: result.message || "VNC 콘솔로 텍스트를 보냈습니다." });
      pushToast(result.message || "VNC 콘솔로 텍스트를 보냈습니다.", "success");
      return result;
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message || "VNC 콘솔로 텍스트를 보내지 못했습니다." });
      pushToast(error.message || "VNC 콘솔로 텍스트를 보내지 못했습니다.", "error");
      throw error;
    }
  }
  async function onExtendLab(labId) {
    try {
      const targetLabId = Number(labId || activeLab?.id || 0);
      if (!targetLabId) throw new Error("연장할 랩을 찾을 수 없습니다.");
      const result = await api(`/api/labs/${targetLabId}/extend`, { method: "POST" });
      if (result.lab) {
        setLabs((current) => current.map((item) => (Number(item.id) === Number(result.lab.id) ? result.lab : item)));
      }
      await loadLabs();
      setTerminalRequest({ tone: "success", message: result.message || "랩 사용 시간을 연장했습니다." });
      pushToast(result.message || "랩 사용 시간을 연장했습니다.", "success");
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message });
      pushToast(error.message, "error");
    }
  }
  async function onPauseLab(labId) {
    try {
      const targetLabId = Number(labId || activeLab?.id || 0);
      if (!targetLabId) throw new Error("일시 중지할 랩을 찾을 수 없습니다.");
      const result = await api(`/api/labs/${targetLabId}/pause`, { method: "POST" });
      if (result.lab) {
        setLabs((current) => current.map((item) => (Number(item.id) === Number(result.lab.id) ? result.lab : item)));
      }
      setTerminalSession(null);
      setTerminalRequest({ tone: "success", message: result.message || "유지형 랩을 일시 중지했습니다." });
      pushToast(result.message || "유지형 랩을 일시 중지했습니다.", "success");
      await loadLabs();
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message });
      pushToast(error.message || "유지형 랩 일시 중지 중 오류가 발생했습니다.", "error");
    }
  }
  async function onResetLab(labId) {
    const targetLabId = Number(labId || activeLab?.id || 0);
    if (!targetLabId) {
      pushToast("초기화할 랩을 찾을 수 없습니다.", "error");
      return;
    }
    const targetLab = labs.find((item) => Number(item.id) === Number(targetLabId)) || activeLab || null;
    const targetCourse = courses.find((item) => Number(item.id) === Number(targetLab?.courseId || 0)) || null;
    const isContainerLab = String(targetLab?.labBackendType || targetCourse?.labBackendType || "vm") === "container";
    const resetConfirmMessage = isContainerLab
      ? "컨테이너를 재생성하면 현재 컨테이너와 작업 내용이 삭제되고 새 컨테이너로 다시 준비됩니다. 계속할까요?"
      : "랩을 초기화하면 현재 VM과 작업 내용이 삭제되고 새 랩으로 다시 준비됩니다. 계속할까요?";
    if (!window.confirm(resetConfirmMessage)) return;
    try {
      const result = await api(`/api/labs/${targetLabId}/reset`, { method: "POST" });
      const successMessage = result.message || (isContainerLab ? "컨테이너를 재생성했습니다." : "랩을 초기화했습니다.");
      if (result.lab) {
        setLabs((current) => [result.lab, ...current.filter((item) => Number(item.id) !== Number(targetLabId) && Number(item.id) !== Number(result.lab.id))]);
      }
      setTerminalSession(null);
      setTerminalRequest({ tone: "success", message: successMessage });
      setAuthStatus({ tone: "success", message: successMessage });
      pushToast(successMessage, "success");
      await loadLabs();
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message });
      pushToast(error.message || (isContainerLab ? "컨테이너 재생성 중 오류가 발생했습니다." : "랩 초기화 중 오류가 발생했습니다."), "error");
    }
  }
  async function onRebuildLabWithVolume(labId) {
    const targetLabId = Number(labId || activeLab?.id || 0);
    if (!targetLabId) {
      pushToast("재구성할 랩을 찾을 수 없습니다.", "error");
      return;
    }
    const targetLab = labs.find((item) => Number(item.id) === Number(targetLabId)) || activeLab || null;
    const targetCourse = courses.find((item) => Number(item.id) === Number(targetLab?.courseId || 0)) || null;
    const isContainerLab = String(targetLab?.labBackendType || targetCourse?.labBackendType || "vm") === "container";
    if (isContainerLab) {
      pushToast("컨테이너 랩은 볼륨 디스크 재구성을 지원하지 않습니다.", "error");
      return;
    }
    const bootVolumeSizeGb = Math.max(1, Math.min(2048, Number.parseInt(platformStatus?.labAutoBootVolumeSizeGb, 10) || 20));
    const bootVolumeType = String(platformStatus?.labAutoBootVolumeType || "").trim();
    const volumeText = `Cinder volume ${bootVolumeSizeGb}GB${bootVolumeType ? ` / ${bootVolumeType}` : ""}`;
    if (!window.confirm(`현재 VM과 작업 내용이 삭제되고 ${volumeText} 기반 새 VM으로 다시 생성됩니다. 계속할까요?`)) return;
    try {
      const result = await api(`/api/labs/${targetLabId}/reset`, {
        method: "POST",
        body: {
          bootFromVolume: true,
          bootVolumeSizeGb,
          bootVolumeType,
        },
      });
      const successMessage = result.message || "볼륨 디스크 기반으로 랩을 다시 생성했습니다.";
      if (result.lab) {
        setLabs((current) => [result.lab, ...current.filter((item) => Number(item.id) !== Number(targetLabId) && Number(item.id) !== Number(result.lab.id))]);
      }
      setTerminalSession(null);
      setTerminalRequest({ tone: "success", message: successMessage });
      setAuthStatus({ tone: "success", message: successMessage });
      pushToast(successMessage, "success");
      await loadLabs();
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message });
      pushToast(error.message || "볼륨 디스크 재구성 중 오류가 발생했습니다.", "error");
    }
  }
  async function onRemoveLab(labId) {
    const targetLabId = Number(labId || activeLab?.id || 0);
    if (!targetLabId) {
      pushToast("제거할 랩을 찾을 수 없습니다.", "error");
      return;
    }
    const targetLab = labs.find((item) => Number(item.id) === Number(targetLabId)) || activeLab || null;
    const targetCourse = courses.find((item) => Number(item.id) === Number(targetLab?.courseId || 0)) || null;
    const isContainerLab = String(targetLab?.labBackendType || targetCourse?.labBackendType || "vm") === "container";
    const removeConfirmMessage = isContainerLab
      ? "컨테이너를 제거하면 현재 컨테이너와 작업 내용이 삭제됩니다. 새 컨테이너는 자동으로 생성되지 않습니다. 계속할까요?"
      : "랩을 종료하면 현재 VM과 작업 내용이 삭제됩니다. 계속할까요?";
    if (!window.confirm(removeConfirmMessage)) return;
    try {
      const result = await api(`/api/labs/${targetLabId}/remove`, { method: "POST" });
      const successMessage = result.message || (isContainerLab ? "컨테이너를 제거했습니다." : "랩을 종료했습니다.");
      setLabs((current) => current.map((item) => (Number(item.id) === Number(targetLabId) ? { ...item, ...(result.lab || {}), status: result.lab?.status || "terminated" } : item)));
      setTerminalSession(null);
      setTerminalRequest({ tone: "success", message: successMessage });
      setAuthStatus({ tone: "success", message: successMessage });
      pushToast(successMessage, "success");
      await loadLabs();
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message });
      pushToast(error.message || (isContainerLab ? "컨테이너 제거 중 오류가 발생했습니다." : "랩 종료 중 오류가 발생했습니다."), "error");
    }
  }
  async function onResetLabSshHostKey(labId, nodeId, nodeLabel = "") {
    const targetLabId = Number(labId || activeLab?.id || 0);
    const normalizedNodeId = String(nodeId || "").trim();
    if (!targetLabId || !normalizedNodeId) {
      pushToast("SSH 호스트 키를 초기화할 노드를 찾을 수 없습니다.", "error");
      return null;
    }
    const targetLabel = String(nodeLabel || "선택 VM").trim() || "선택 VM";
    const confirmed = window.confirm(
      `${targetLabel}의 저장된 SSH 호스트 키 기록만 삭제합니다. 다음 연결에서 현재 VM의 키를 새로 확인합니다. VM 대상이 맞는지 확인했나요?`,
    );
    if (!confirmed) return null;

    terminalSessionRequestRef.current.cancel();
    setTerminalSessionBusy(false);
    try {
      const result = await api(`/api/labs/${targetLabId}/nodes/${encodeURIComponent(normalizedNodeId)}/ssh-host-key/reset`, {
        method: "POST",
      });
      const activeTerminalNodeId = String(terminalSession?.nodeId || "").trim();
      if (
        Number(terminalSession?.labId || 0) === targetLabId
        && (!activeTerminalNodeId || activeTerminalNodeId === normalizedNodeId)
      ) {
        setTerminalSession(null);
      }
      const successMessage = result.message || `${targetLabel}의 SSH 호스트 키 기록을 초기화했습니다.`;
      setTerminalRequest({ tone: "success", message: successMessage });
      pushToast(successMessage, "success");
      return result;
    } catch (error) {
      const message = error.message || "SSH 호스트 키 기록을 초기화하지 못했습니다.";
      setTerminalRequest({ tone: "error", message });
      pushToast(message, "error");
      return null;
    }
  }
  async function onRebootLabNode(labId, nodeId, nodeLabel = "") {
    const targetLabId = Number(labId || activeLab?.id || 0);
    const normalizedNodeId = String(nodeId || "").trim();
    if (!targetLabId || !normalizedNodeId) {
      pushToast("재부팅할 VM을 찾을 수 없습니다.", "error");
      return null;
    }
    const targetLabel = String(nodeLabel || "선택 VM").trim() || "선택 VM";
    if (!window.confirm(`${targetLabel}을(를) 일반 재부팅할까요?\n실행 중인 작업과 터미널 연결이 잠시 중단됩니다.`)) {
      return null;
    }

    terminalSessionRequestRef.current.cancel();
    setTerminalSessionBusy(false);
    try {
      const result = await api(`/api/labs/${targetLabId}/nodes/${encodeURIComponent(normalizedNodeId)}/reboot`, {
        method: "POST",
      });
      if (result.lab) {
        setLabs((current) => current.map((item) => (
          Number(item.id) === Number(result.lab.id) ? result.lab : item
        )));
        if (isAdmin) {
          setAdminLabs((current) => current.map((item) => (
            Number(item.id) === Number(result.lab.id) ? result.lab : item
          )));
        }
      }
      if (
        Number(terminalSession?.labId || 0) === targetLabId
        && String(terminalSession?.nodeId || "").trim() === normalizedNodeId
      ) {
        setTerminalSession(null);
      }
      const message = result.message || `${targetLabel}에 일반 재부팅을 요청했습니다.`;
      setTerminalRequest({ tone: "success", message });
      pushToast(message, "success");
      await loadLabs();
      return result;
    } catch (error) {
      const message = error.message || "선택한 VM을 재부팅하지 못했습니다.";
      setTerminalRequest({ tone: "error", message });
      pushToast(message, "error");
      return null;
    }
  }
  async function onRebuildLabNode(labId, nodeId, nodeLabel = "") {
    const targetLabId = Number(labId || activeLab?.id || 0);
    const normalizedNodeId = String(nodeId || "").trim();
    if (!targetLabId || !normalizedNodeId) {
      pushToast("재생성할 노드를 찾을 수 없습니다.", "error");
      return;
    }
    const targetLabel = String(nodeLabel || "선택 VM").trim() || "선택 VM";
    if (!window.confirm(`${targetLabel}을(를) 재생성하면 해당 인스턴스가 다시 설치됩니다. 계속할까요?`)) return;
    try {
      const result = await api(`/api/labs/${targetLabId}/nodes/${encodeURIComponent(normalizedNodeId)}/rebuild`, { method: "POST" });
      if (result.lab) {
        setLabs((current) => current.map((item) => (Number(item.id) === Number(result.lab.id) ? result.lab : item)));
      }
      if (String(terminalSession?.nodeId || "").trim() === normalizedNodeId) {
        setTerminalSession(null);
      }
      setTerminalRequest({ tone: "success", message: result.message || `${targetLabel} 재생성을 완료했습니다.` });
      pushToast(result.message || `${targetLabel} 재생성을 완료했습니다.`, "success");
      await loadLabs();
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message });
      pushToast(error.message || "노드 재생성 중 오류가 발생했습니다.", "error");
    }
  }
async function onCheckLabDomain(labOverride = null) {
  const targetLab = labOverride?.id ? labOverride : activeLab;
  const isCustomLab = String(targetLab?.resourceType || "").toLowerCase() === "custom-lab";
  const domainType = String(publicRouteForm.domainType || "managed") === "custom" ? "custom" : "managed";
  if (domainType === "custom") {
    const customDomain = String(publicRouteForm.customDomain || "").trim();
    if (!customDomain) {
      setDomainAvailability({ tone: "error", message: "사용자 도메인을 입력해 주세요. 예: app.example.com" });
      return;
    }
    try {
      const excludeQuery = targetLab ? (isCustomLab ? `&customLabRequestId=${targetLab.id}` : `&labId=${targetLab.id}`) : "";
      const result = await api(`/api/lab-domains/check?domainType=custom&customDomain=${encodeURIComponent(customDomain)}${excludeQuery}`);
      const verification = result.verification || {};
      setDomainAvailability({
        tone: result.available && result.verified ? "success" : result.available ? "warn" : "error",
        message: [
          result.message,
          verification.name && verification.value ? `TXT ${verification.name} = ${verification.value}` : "",
        ].filter(Boolean).join(" / "),
      });
    } catch (error) {
      setDomainAvailability({ tone: "error", message: error.message });
    }
    return;
  }
  const subdomain = String(publicRouteForm.subdomain || "").trim();
  if (!subdomain) {
    setDomainAvailability({ tone: "success", message: "서브도메인을 비워두면 요청 시 랜덤 값이 자동으로 생성됩니다." });
    return;
  }
    try {
      const excludeQuery = targetLab ? (isCustomLab ? `&customLabRequestId=${targetLab.id}` : `&labId=${targetLab.id}`) : "";
      const result = await api(`/api/lab-domains/check?subdomain=${encodeURIComponent(subdomain)}${excludeQuery}`);
      setDomainAvailability({ tone: result.available ? "success" : "error", message: result.message });
    } catch (error) {
      setDomainAvailability({ tone: "error", message: error.message });
    }
  }
  async function onPublishLabDomain(labOverride = null) {
      const targetLab = labOverride?.id ? labOverride : activeLab;
      if (!targetLab) return;
      const isCustomLab = String(targetLab?.resourceType || "").toLowerCase() === "custom-lab";
      try {
        const explicitNodes = Array.isArray(targetLab?.vmNodes) ? targetLab.vmNodes.filter(Boolean) : [];
        const domainType = String(publicRouteForm.domainType || "managed") === "custom" ? "custom" : "managed";
        const requestedSubdomain = String(publicRouteForm.subdomain || "").trim();
        const requestedCustomDomain = String(publicRouteForm.customDomain || "").trim();
        const requestedPort = Number(publicRouteForm.port || 80);
        const requestedProtocol = String(publicRouteForm.protocol || "http").toLowerCase() === "https" ? "https" : "http";
        const requestedNodeId = String(publicRouteForm.nodeId || "").trim();
        if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
          throw new Error("공개 도메인으로 연결할 대상 포트를 1-65535 범위로 입력해 주세요.");
        }
        if (explicitNodes.length > 1 && !requestedNodeId) {
          throw new Error("멀티 서버 랩에서는 공개할 대상 서버를 먼저 선택해 주세요.");
        }
        let availability = null;
        if (domainType === "custom") {
          if (!requestedCustomDomain) throw new Error("사용자 도메인을 입력해 주세요. 예: app.example.com");
          const excludeQuery = isCustomLab ? `customLabRequestId=${targetLab.id}` : `labId=${targetLab.id}`;
          availability = await api(`/api/lab-domains/check?domainType=custom&customDomain=${encodeURIComponent(requestedCustomDomain)}&${excludeQuery}`);
          const verification = availability.verification || {};
          setDomainAvailability({
            tone: availability.available && availability.verified ? "success" : availability.available ? "warn" : "error",
            message: [
              availability.message,
              verification.name && verification.value ? `TXT ${verification.name} = ${verification.value}` : "",
            ].filter(Boolean).join(" / "),
          });
          if (!availability.available || !availability.verified) {
            setTerminalRequest({ tone: "error", message: availability.message });
            return;
          }
        } else if (requestedSubdomain) {
          const excludeQuery = isCustomLab ? `customLabRequestId=${targetLab.id}` : `labId=${targetLab.id}`;
          availability = await api(`/api/lab-domains/check?subdomain=${encodeURIComponent(requestedSubdomain)}&${excludeQuery}`);
          setDomainAvailability({ tone: availability.available ? "success" : "error", message: availability.message });
          if (!availability.available) {
            setTerminalRequest({ tone: "error", message: availability.message });
            return;
          }
        } else {
          setDomainAvailability({ tone: "success", message: "빈 서브도메인으로 요청하여 랜덤 도메인을 자동 생성합니다." });
        }
        const result = await api(isCustomLab ? `/api/custom-lab-requests/${targetLab.id}/domain` : `/api/labs/${targetLab.id}/domain`, {
          method: "POST",
          body: {
          domainType,
          subdomain: requestedSubdomain,
          customDomain: requestedCustomDomain,
          protocol: requestedProtocol,
          port: requestedPort,
          nodeId: requestedNodeId,
        },
      });
        setPublicRouteFormDirty(false);
        const updatedLab = result.request || result.lab;
        const reviewRequired = Boolean(updatedLab?.publicRequestPending);
        const message = reviewRequired ? ADMIN_REVIEW_REQUIRED_MESSAGE : (result.message || "공개 도메인 승인 요청이 접수되었습니다.");
        if (isCustomLab) {
          setCustomLabRequests((current) => current.map((request) => (Number(request.id) === Number(targetLab.id) ? result.request || result.lab : request)));
        } else {
          setLabs((current) => current.map((lab) => (lab.id === targetLab.id ? result.lab : lab)));
        }
        await runSafeRefreshTasks([isCustomLab ? loadCustomLabRequests() : loadLabs(), isAdmin ? loadAdmin() : Promise.resolve()]);
        setTerminalRequest({ tone: "success", message });
        setDomainAvailability({
          tone: "success",
          message: reviewRequired
            ? ADMIN_REVIEW_REQUIRED_MESSAGE
            : (result.availability?.message || (requestedSubdomain ? "도메인 확인 후 요청이 접수되었습니다." : "랜덤 도메인 생성 요청이 접수되었습니다.")),
        });
        pushToast(message, "success");
      } catch (error) {
        setTerminalRequest({ tone: "error", message: error.message });
        pushToast(error.message || "공개 도메인 요청 중 오류가 발생했습니다.", "error");
      }
  }
  async function onUnpublishLabDomain(subdomain = "", options = {}, labOverride = null) {
      const targetLab = labOverride?.id ? labOverride : activeLab;
      if (!targetLab) return;
      const isCustomLab = String(targetLab?.resourceType || "").toLowerCase() === "custom-lab";
      const normalizedSubdomain = typeof subdomain === "string" ? subdomain : "";
      try {
          const result = await api(isCustomLab ? `/api/custom-lab-requests/${targetLab.id}/domain` : `/api/labs/${targetLab.id}/domain`, {
            method: "DELETE",
            body: normalizedSubdomain ? {
              subdomain: normalizedSubdomain,
              domainType: options?.domainType || "",
              fqdn: options?.fqdn || "",
              customDomain: options?.customDomain || "",
            } : {},
          });
          setPublicRouteFormDirty(false);
          if (isCustomLab) {
            setCustomLabRequests((current) => current.map((request) => (Number(request.id) === Number(targetLab.id) ? result.request || result.lab : request)));
          } else {
            setLabs((current) => current.map((lab) => (lab.id === targetLab.id ? result.lab : lab)));
          }
          await runSafeRefreshTasks([isCustomLab ? loadCustomLabRequests() : loadLabs(), isAdmin ? loadAdmin() : Promise.resolve()]);
          setTerminalRequest({ tone: "success", message: "공개 도메인 연결을 해제했습니다." });
        setDomainAvailability({ tone: "", message: "" });
        pushToast(result.message || "공개 도메인 연결을 해제했습니다.", "success");
      } catch (error) {
        setTerminalRequest({ tone: "error", message: error.message });
        pushToast(error.message || "공개 도메인 해제 중 오류가 발생했습니다.", "error");
      }
  }
  async function onRequestLabPublicPort() {
    if (!activeLab) return;
    try {
      const targetPort = Number(publicTcpRouteForm.targetPort || 0);
      const nodeId = String(publicTcpRouteForm.nodeId || "").trim();
      if (!Number.isInteger(targetPort) || targetPort <= 0) {
        throw new Error("공개할 내부 TCP 포트를 입력해 주세요.");
      }
      const result = await api(`/api/labs/${activeLab.id}/public-port`, {
        method: "POST",
        body: { targetPort, nodeId },
      });
      setPublicTcpRouteFormDirty(false);
      setLabs((current) => current.map((lab) => (lab.id === activeLab.id ? result.lab : lab)));
      setPublicTcpRouteForm(EMPTY_PUBLIC_TCP_ROUTE);
      await runSafeRefreshTasks([loadLabs(), isAdmin ? loadAdmin() : Promise.resolve()]);
      const message = result.lab?.publicTcpRequestPending ? ADMIN_REVIEW_REQUIRED_MESSAGE : (result.message || "외부 TCP 포트 노출 요청이 접수되었습니다.");
      setTerminalRequest({ tone: "success", message });
      pushToast(message, "success");
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message });
      pushToast(error.message || "외부 TCP 포트 요청 중 오류가 발생했습니다.", "error");
    }
  }
  async function onReleaseLabPublicPort(targetPort = null, externalPort = null, route = {}) {
      if (!activeLab) return;
      const normalizedTargetPort = typeof targetPort === "number" || typeof targetPort === "string" ? Number(targetPort) : undefined;
      const normalizedExternalPort = typeof externalPort === "number" || typeof externalPort === "string" ? Number(externalPort) : undefined;
      const nodeId = String(route?.nodeId || "").trim();
      const targetHost = String(route?.targetHost || "").trim();
      try {
        const result = await api(`/api/labs/${activeLab.id}/public-port`, {
          method: "DELETE",
          body: {
            targetPort: Number.isInteger(normalizedTargetPort) ? normalizedTargetPort : undefined,
            externalPort: Number.isInteger(normalizedExternalPort) ? normalizedExternalPort : undefined,
            nodeId: nodeId || undefined,
            targetHost: targetHost || undefined,
          },
        });
      setPublicTcpRouteFormDirty(false);
      setLabs((current) => current.map((lab) => (lab.id === activeLab.id ? result.lab : lab)));
      await runSafeRefreshTasks([loadLabs(), isAdmin ? loadAdmin() : Promise.resolve()]);
      setTerminalRequest({ tone: "success", message: result.message || "외부 TCP 포트 노출을 해제했습니다." });
      pushToast(result.message || "외부 TCP 포트 노출을 해제했습니다.", "success");
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message });
      pushToast(error.message || "외부 TCP 포트 해제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onRequestExternalSsh() {
    if (!activeLab) return;
    try {
      const result = await api(`/api/labs/${activeLab.id}/external-ssh`, { method: "POST" });
      setLabs((current) => current.map((lab) => (lab.id === activeLab.id ? result.lab : lab)));
      await runSafeRefreshTasks([loadLabs(), isAdmin ? loadAdmin() : Promise.resolve()]);
      const message = result.lab?.externalSshRequestPending ? ADMIN_REVIEW_REQUIRED_MESSAGE : (result.message || "외부 SSH 요청이 접수되었습니다.");
      setTerminalRequest({ tone: "success", message });
      pushToast(message, "success");
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message });
      pushToast(error.message || "외부 SSH 요청 중 오류가 발생했습니다.", "error");
    }
  }
  async function onReleaseExternalSsh() {
    if (!activeLab) return;
    try {
      const result = await api(`/api/labs/${activeLab.id}/external-ssh`, { method: "DELETE" });
      setLabs((current) => current.map((lab) => (lab.id === activeLab.id ? result.lab : lab)));
      await runSafeRefreshTasks([loadLabs(), isAdmin ? loadAdmin() : Promise.resolve()]);
      setTerminalRequest({ tone: "success", message: result.message });
      pushToast(result.message || "외부 SSH 할당을 해제했습니다.", "success");
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message });
      pushToast(error.message || "외부 SSH 해제 중 오류가 발생했습니다.", "error");
      }
    }
    async function onRequestExternalRdp() {
      if (!activeLab) return;
      try {
        const result = await api(`/api/labs/${activeLab.id}/external-rdp`, { method: "POST" });
        setLabs((current) => current.map((lab) => (lab.id === activeLab.id ? result.lab : lab)));
        await runSafeRefreshTasks([loadLabs(), isAdmin ? loadAdmin() : Promise.resolve()]);
        const message = result.lab?.externalRdpRequestPending ? ADMIN_REVIEW_REQUIRED_MESSAGE : (result.message || "외부 RDP 요청이 접수되었습니다.");
        setTerminalRequest({ tone: "success", message });
        pushToast(message, "success");
      } catch (error) {
        setTerminalRequest({ tone: "error", message: error.message });
        pushToast(error.message || "외부 RDP 요청 중 오류가 발생했습니다.", "error");
      }
    }
    async function onReleaseExternalRdp() {
      if (!activeLab) return;
      try {
        const result = await api(`/api/labs/${activeLab.id}/external-rdp`, { method: "DELETE" });
        setLabs((current) => current.map((lab) => (lab.id === activeLab.id ? result.lab : lab)));
        await runSafeRefreshTasks([loadLabs(), isAdmin ? loadAdmin() : Promise.resolve()]);
        setTerminalRequest({ tone: "success", message: result.message });
        pushToast(result.message || "외부 RDP 할당을 해제했습니다.", "success");
      } catch (error) {
        setTerminalRequest({ tone: "error", message: error.message });
        pushToast(error.message || "외부 RDP 해제 중 오류가 발생했습니다.", "error");
      }
    }
    async function onApproveLabDomain(labId, domain = "", resource = null) {
    const domainEntry = domain && typeof domain === "object" ? domain : null;
    const subdomain = domainEntry ? domainEntry.subdomain : domain;
    const isCustomLabDomain = resource?.resourceType === "custom-lab"
      || (adminCustomLabRequests || []).some((request) =>
        Number(request.id) === Number(labId)
        && (request.requestedPublicDomains || []).some((entry) => String(entry.subdomain || "") === String(subdomain || "")));
    const noteKey = subdomain ? `${isCustomLabDomain ? "custom-lab" : "lab"}:${labId}:${subdomain}` : labId;
    try {
      const result = await api(isCustomLabDomain ? `/api/admin/custom-lab-requests/${labId}/approve-domain` : `/api/admin/labs/${labId}/approve-domain`, {
        method: "POST",
        body: {
          reviewNote: labDomainReviewNotes[noteKey] || labDomainReviewNotes[subdomain ? `${labId}:${subdomain}` : labId] || "",
          subdomain,
          domainType: domainEntry?.domainType || "",
          fqdn: domainEntry?.fqdn || "",
        },
      });
      if (isCustomLabDomain) {
        setAdminCustomLabRequests((current) => current.map((request) => (request.id === labId ? result.request || result.lab : request)));
      } else {
        setAdminLabs((current) => current.map((lab) => (lab.id === labId ? result.lab : lab)));
      }
      setLabDomainReviewNotes((current) => ({ ...current, [noteKey]: "", [subdomain ? `${labId}:${subdomain}` : labId]: "" }));
      await runSafeRefreshTasks([loadAdmin(), loadLabs(), loadCustomLabRequests()]);
      setAdminStatus(result.message || "공개 도메인 요청을 승인했습니다.");
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onApproveExternalSsh(labId) {
    try {
      const result = await api(`/api/admin/labs/${labId}/approve-external-ssh`, {
        method: "POST",
        body: { reviewNote: labSshReviewNotes[labId] || "" },
      });
      setAdminLabs((current) => current.map((lab) => (lab.id === labId ? result.lab : lab)));
      setLabSshReviewNotes((current) => ({ ...current, [labId]: "" }));
      await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
      setAdminStatus(result.message);
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
    async function onRejectExternalSsh(labId) {
      try {
        const result = await api(`/api/admin/labs/${labId}/reject-external-ssh`, {
          method: "POST",
          body: { reviewNote: labSshReviewNotes[labId] || "" },
      });
      setAdminLabs((current) => current.map((lab) => (lab.id === labId ? result.lab : lab)));
      setLabSshReviewNotes((current) => ({ ...current, [labId]: "" }));
      await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
      setAdminStatus(result.message);
    } catch (error) {
        setAdminStatus(error.message);
      }
    }
    async function onApproveExternalRdp(labId) {
      try {
        const result = await api(`/api/admin/labs/${labId}/approve-external-rdp`, {
          method: "POST",
          body: { reviewNote: labSshReviewNotes[`rdp-${labId}`] || "" },
        });
        setAdminLabs((current) => current.map((lab) => (lab.id === labId ? result.lab : lab)));
        setLabSshReviewNotes((current) => ({ ...current, [`rdp-${labId}`]: "" }));
        await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
        setAdminStatus(result.message);
      } catch (error) {
        setAdminStatus(error.message);
      }
    }
    async function onRejectExternalRdp(labId) {
      try {
        const result = await api(`/api/admin/labs/${labId}/reject-external-rdp`, {
          method: "POST",
          body: { reviewNote: labSshReviewNotes[`rdp-${labId}`] || "" },
        });
        setAdminLabs((current) => current.map((lab) => (lab.id === labId ? result.lab : lab)));
        setLabSshReviewNotes((current) => ({ ...current, [`rdp-${labId}`]: "" }));
        await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
        setAdminStatus(result.message);
      } catch (error) {
        setAdminStatus(error.message);
      }
    }
    async function onRejectLabDomain(labId, domain = "", resource = null) {
    const domainEntry = domain && typeof domain === "object" ? domain : null;
    const subdomain = domainEntry ? domainEntry.subdomain : domain;
    const isCustomLabDomain = resource?.resourceType === "custom-lab"
      || (adminCustomLabRequests || []).some((request) =>
        Number(request.id) === Number(labId)
        && (request.requestedPublicDomains || []).some((entry) => String(entry.subdomain || "") === String(subdomain || "")));
    const noteKey = subdomain ? `${isCustomLabDomain ? "custom-lab" : "lab"}:${labId}:${subdomain}` : labId;
    try {
      const result = await api(isCustomLabDomain ? `/api/admin/custom-lab-requests/${labId}/reject-domain` : `/api/admin/labs/${labId}/reject-domain`, {
        method: "POST",
        body: {
          reviewNote: labDomainReviewNotes[noteKey] || labDomainReviewNotes[subdomain ? `${labId}:${subdomain}` : labId] || "",
          subdomain,
          domainType: domainEntry?.domainType || "",
          fqdn: domainEntry?.fqdn || "",
        },
      });
      if (isCustomLabDomain) {
        setAdminCustomLabRequests((current) => current.map((request) => (request.id === labId ? result.request || result.lab : request)));
      } else {
        setAdminLabs((current) => current.map((lab) => (lab.id === labId ? result.lab : lab)));
      }
      setLabDomainReviewNotes((current) => ({ ...current, [noteKey]: "", [subdomain ? `${labId}:${subdomain}` : labId]: "" }));
      await runSafeRefreshTasks([loadAdmin(), loadLabs(), loadCustomLabRequests()]);
      setAdminStatus(result.message || "공개 도메인 요청을 반려했습니다.");
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onApprovePublicPort(labId, targetPort = null, route = {}) {
    try {
      const routeKey = String(route?.nodeId || route?.targetHost || "").trim();
      const reviewKey = targetPort != null ? `${labId}:${targetPort}${routeKey ? `:${routeKey}` : ""}` : String(labId);
      const result = await api(`/api/admin/labs/${labId}/approve-public-port`, {
        method: "POST",
        body: {
          reviewNote: labTcpReviewNotes[reviewKey] || "",
          targetPort: targetPort != null ? Number(targetPort) : undefined,
          nodeId: route?.nodeId || undefined,
          targetHost: route?.targetHost || undefined,
        },
      });
      setAdminLabs((current) => current.map((lab) => (lab.id === labId ? result.lab : lab)));
      setLabTcpReviewNotes((current) => ({ ...current, [reviewKey]: "" }));
      await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
      setAdminStatus(result.message || "외부 TCP 포트 요청을 승인했습니다.");
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onRejectPublicPort(labId, targetPort = null, route = {}) {
    try {
      const routeKey = String(route?.nodeId || route?.targetHost || "").trim();
      const reviewKey = targetPort != null ? `${labId}:${targetPort}${routeKey ? `:${routeKey}` : ""}` : String(labId);
      const result = await api(`/api/admin/labs/${labId}/reject-public-port`, {
        method: "POST",
        body: {
          reviewNote: labTcpReviewNotes[reviewKey] || "",
          targetPort: targetPort != null ? Number(targetPort) : undefined,
          nodeId: route?.nodeId || undefined,
          targetHost: route?.targetHost || undefined,
        },
      });
      setAdminLabs((current) => current.map((lab) => (lab.id === labId ? result.lab : lab)));
      setLabTcpReviewNotes((current) => ({ ...current, [reviewKey]: "" }));
      await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
      setAdminStatus(result.message || "외부 TCP 포트 요청을 반려했습니다.");
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onCreateQna(event) {
    event.preventDefault();
    if (!qnaForm.title.trim() || !qnaForm.body.trim()) return;
    try {
      await api("/api/qna", {
        method: "POST",
        body: {
          courseId: qnaForm.courseId || null,
          labRequestId: qnaForm.labRequestId || null,
          postType: qnaForm.postType || "question",
          title: qnaForm.title,
          body: qnaForm.body,
        },
      });
      setQnaForm(EMPTY_QNA);
      await loadQna();
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
    }
  }
  function getQnaCommentDraftKey(postId, parentCommentId = null) {
    return parentCommentId ? `comment:${postId}:${parentCommentId}` : `post:${postId}`;
  }
  async function onCreateQnaComment(postId, parentCommentId = null) {
    const draftKey = getQnaCommentDraftKey(postId, parentCommentId);
    const body = String(qnaCommentDrafts[draftKey] || "").trim();
    if (!body) return;
    try {
      await api(`/api/qna/${postId}/comments`, { method: "POST", body: { body, parentCommentId } });
      setQnaCommentDrafts((current) => ({ ...current, [draftKey]: "" }));
      await loadQna(false, session);
      pushToast("댓글을 등록했습니다.", "success");
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "댓글 등록 중 오류가 발생했습니다.", "error");
    }
  }
  async function onMarkQnaHelpful(postId) {
    try {
      const result = await api(`/api/qna/${postId}/helpful`, { method: "POST" });
      await loadQna(false, session);
      pushToast(result.message || "도움돼요를 반영했습니다.", "success");
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "도움돼요 반영 중 오류가 발생했습니다.", "error");
    }
  }
  async function onSetQnaStatus(postId, status) {
    try {
      const result = await api(`/api/qna/${postId}/status`, { method: "PATCH", body: { status } });
      await loadQna(false, session);
      pushToast(result.message || "게시글 상태를 변경했습니다.", "success");
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "게시글 상태 변경 중 오류가 발생했습니다.", "error");
    }
  }
  async function onAcceptQnaComment(postId, commentId) {
    try {
      const result = await api(`/api/qna/${postId}/comments/${commentId}/accept`, { method: "POST" });
      await loadQna(false, session);
      pushToast(result.message || "답변을 채택했습니다.", "success");
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "답변 채택 중 오류가 발생했습니다.", "error");
    }
  }
  async function onDeleteQnaPost(postId) {
    try {
      const result = await api(`/api/qna/${postId}`, { method: "DELETE" });
      await loadQna(false, session);
      pushToast(result.message || "게시글을 삭제했습니다.", "success");
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "게시글 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onDeleteQnaComment(postId, commentId) {
    try {
      const result = await api(`/api/qna/${postId}/comments/${commentId}`, { method: "DELETE" });
      await loadQna(false, session);
      pushToast(result.message || "댓글을 삭제했습니다.", "success");
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "댓글 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  function onNoticeEdit(notice) {
    setNoticeForm({ id: notice.id, title: notice.title, body: notice.body, isPinned: Boolean(notice.isPinned) });
  }
  function onCancelNoticeEdit() {
    setNoticeForm(EMPTY_NOTICE);
  }
  async function onNoticeSubmit(event) {
    event.preventDefault();
    const title = String(noticeForm.title || "").trim();
    const body = String(noticeForm.body || "").trim();
    if (!title || !body) {
      setAdminStatus("제목과 내용을 모두 입력해 주세요.");
      return false;
    }
    try {
      const result = await api(noticeForm.id ? `/api/admin/notices/${noticeForm.id}` : "/api/admin/notices", {
        method: noticeForm.id ? "PUT" : "POST",
        body: { title, body, isPinned: Boolean(noticeForm.isPinned) },
      });
      setNoticeForm(EMPTY_NOTICE);
      setNotices((current) => upsertByKey(current, result.notice, "id"));
      setAdminStatus(result.message);
      openAdminSaveDialog(result.message || (noticeForm.id ? "공지사항을 수정했습니다." : "공지사항을 등록했습니다."));
      void loadNotices();
      return true;
    } catch (error) {
      setAdminStatus(error.message);
      openAdminSaveDialog(error.message, "error");
      return false;
    }
  }
  async function onNoticeDelete(noticeId) {
    try {
      setNotices((current) => removeByKey(current, noticeId, "id"));
      const result = await api(`/api/admin/notices/${noticeId}`, { method: "DELETE" });
      setNoticeForm((current) => (current.id === noticeId ? EMPTY_NOTICE : current));
      setAdminStatus(result.message);
      void loadNotices();
    } catch (error) {
      void loadNotices();
      setAdminStatus(error.message);
    }
  }
  async function onUserPatch(userId, role, status, patch) {
    try {
      const currentUser = (adminUsers || []).find((item) => Number(item.id) === Number(userId));
      const nextRole = normalizeUserRole(patch.role ?? role);
      const nextStatus = String((patch.status ?? status) || "").trim().toLowerCase();
      const body = {
        role: nextRole,
        status: normalizeUserStatus(nextStatus),
        supportMessageEnabled: patch.supportMessageEnabled ?? currentUser?.supportMessageEnabled ?? false,
        selfServiceVmEnabled: patch.selfServiceVmEnabled ?? currentUser?.selfServiceVmEnabled ?? false,
        pocFreeAccessEnabled: patch.pocFreeAccessEnabled ?? currentUser?.pocFreeAccessEnabled ?? false,
        instructorShareEnabled: patch.instructorShareEnabled ?? currentUser?.instructorShareEnabled ?? false,
      };
      if (patch.adminPermissions !== undefined) {
        body.adminPermissions = normalizeAdminPermissions(patch.adminPermissions);
      }
      await api(`/api/admin/users/${userId}/access`, {
        method: "PATCH",
        body,
      });
      await loadAdmin();
      if (patch.selfServiceVmEnabled !== undefined) {
        setAdminStatus(patch.selfServiceVmEnabled ? "사용자화 가상머신 구성 사용을 허용했습니다." : "사용자화 가상머신 구성 사용을 제한했습니다.");
      } else if (patch.pocFreeAccessEnabled !== undefined) {
        setAdminStatus(patch.pocFreeAccessEnabled ? "고급 랩 무료 생성을 허용했습니다." : "고급 랩 무료 생성을 해제했습니다.");
      } else if (patch.supportMessageEnabled !== undefined) {
        setAdminStatus(patch.supportMessageEnabled ? "운영지원 메시지 수신을 활성화했습니다." : "운영지원 메시지 수신을 해제했습니다.");
      } else if (patch.instructorShareEnabled !== undefined) {
        setAdminStatus(patch.instructorShareEnabled ? "강사 콘솔 공유 발급을 허용했습니다." : "강사 콘솔 공유 발급을 해제했습니다.");
      } else if (patch.adminPermissions !== undefined) {
        setAdminStatus("관리자 위임 권한을 업데이트했습니다.");
      } else {
        setAdminStatus(nextStatus === "pending" ? "미승인 상태로 변경했습니다." : "승인 상태로 변경했습니다.");
      }
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onBulkSetSelfServiceVmAccess(userIds, enabled) {
    const targetIds = new Set((Array.isArray(userIds) ? userIds : []).map((id) => Number(id)).filter(Boolean));
    const targetUsers = (adminUsers || []).filter((user) => targetIds.has(Number(user.id)));
    if (!targetUsers.length) {
      setAdminStatus("사용자를 선택해 주세요.");
      return;
    }
    try {
      await Promise.all(targetUsers.map((user) => api(`/api/admin/users/${user.id}/access`, {
        method: "PATCH",
        body: {
          role: normalizeUserRole(user.role),
          status: normalizeUserStatus(user.status),
          supportMessageEnabled: Boolean(user.supportMessageEnabled),
          selfServiceVmEnabled: Boolean(enabled),
          pocFreeAccessEnabled: Boolean(user.pocFreeAccessEnabled),
          instructorShareEnabled: Boolean(user.instructorShareEnabled),
        },
      })));
      await loadAdmin();
      const message = enabled
        ? `${targetUsers.length}명의 사용자화 가상머신 구성 사용을 허용했습니다.`
        : `${targetUsers.length}명의 사용자화 가상머신 구성 사용을 제한했습니다.`;
      setAdminStatus(message);
      pushToast(message, "success");
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "사용자화 가상머신 구성 권한 일괄 변경 중 오류가 발생했습니다.", "error");
    }
  }
  async function onBulkSetPocFreeAccess(userIds, enabled) {
    const targetIds = new Set((Array.isArray(userIds) ? userIds : []).map((id) => Number(id)).filter(Boolean));
    const targetUsers = (adminUsers || []).filter((user) => targetIds.has(Number(user.id)));
    if (!targetUsers.length) {
      setAdminStatus("사용자를 선택해 주세요.");
      return;
    }
    try {
      await Promise.all(targetUsers.map((user) => api(`/api/admin/users/${user.id}/access`, {
        method: "PATCH",
        body: {
          role: normalizeUserRole(user.role),
          status: normalizeUserStatus(user.status),
          supportMessageEnabled: Boolean(user.supportMessageEnabled),
          selfServiceVmEnabled: Boolean(user.selfServiceVmEnabled),
          pocFreeAccessEnabled: Boolean(enabled),
          instructorShareEnabled: Boolean(user.instructorShareEnabled),
        },
      })));
      await loadAdmin();
      const message = enabled
        ? `${targetUsers.length}명의 고급 랩 무료 생성을 허용했습니다.`
        : `${targetUsers.length}명의 고급 랩 무료 생성을 해제했습니다.`;
      setAdminStatus(message);
      pushToast(message, "success");
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "고급 랩 무료 권한 일괄 변경 중 오류가 발생했습니다.", "error");
    }
  }
  async function onBulkSetSupportMessageAccess(userIds, enabled) {
    const targetIds = new Set((Array.isArray(userIds) ? userIds : []).map((id) => Number(id)).filter(Boolean));
    const targetUsers = (adminUsers || []).filter((user) => targetIds.has(Number(user.id)));
    if (!targetUsers.length) {
      setAdminStatus("사용자를 선택해 주세요.");
      return;
    }
    try {
      await Promise.all(targetUsers.map((user) => api(`/api/admin/users/${user.id}/access`, {
        method: "PATCH",
        body: {
          role: normalizeUserRole(user.role),
          status: normalizeUserStatus(user.status),
          supportMessageEnabled: Boolean(enabled),
          selfServiceVmEnabled: Boolean(user.selfServiceVmEnabled),
          pocFreeAccessEnabled: Boolean(user.pocFreeAccessEnabled),
          instructorShareEnabled: Boolean(user.instructorShareEnabled),
        },
      })));
      await loadAdmin();
      const message = enabled
        ? `${targetUsers.length}명의 운영지원 메시지 수신을 허용했습니다.`
        : `${targetUsers.length}명의 운영지원 메시지 수신을 해제했습니다.`;
      setAdminStatus(message);
      pushToast(message, "success");
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "운영지원 수신 권한 일괄 변경 중 오류가 발생했습니다.", "error");
    }
  }
  async function onDeleteUser(user) {
    if (!window.confirm(`${user.username} 사용자를 삭제할까요?`)) return;
    try {
      await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
      setSelectedUserIds((current) => current.filter((id) => Number(id) !== Number(user.id)));
      await loadAdmin();
      setAdminStatus("사용자를 삭제했습니다.");
      pushToast("사용자를 삭제했습니다.", "success");
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "사용자 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onBulkDeleteUsers() {
    const selectedUserIdSet = new Set((selectedUserIds || []).map((id) => Number(id)).filter(Boolean));
    const targetUsers = adminUsers.filter((user) => selectedUserIdSet.has(Number(user.id)));
    if (!targetUsers.length) {
      setAdminStatus("삭제할 사용자를 선택해 주세요.");
      return;
    }
    const removableUsers = targetUsers.filter((user) => Number(user.id) !== Number(session?.id || 0));
    if (!removableUsers.length) {
      setAdminStatus("현재 로그인한 관리자 계정은 삭제할 수 없습니다.");
      return;
    }
    const skippedCount = targetUsers.length - removableUsers.length;
    const confirmMessage = skippedCount
      ? `${removableUsers.length}명의 사용자를 삭제합니다. 현재 로그인한 관리자 계정 ${skippedCount}명은 제외됩니다. 계속할까요?`
      : `${removableUsers.length}명의 사용자를 삭제할까요?`;
    if (!window.confirm(confirmMessage)) return;
    try {
      await Promise.all(removableUsers.map((user) => api(`/api/admin/users/${user.id}`, { method: "DELETE" })));
      setSelectedUserIds((current) => current.filter((id) => !removableUsers.some((user) => Number(user.id) === Number(id))));
      await loadAdmin();
      const message = skippedCount
        ? `${removableUsers.length}명의 사용자를 삭제했고 ${skippedCount}명은 제외했습니다.`
        : `${removableUsers.length}명의 사용자를 삭제했습니다.`;
      setAdminStatus(message);
      pushToast(message, "success");
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "일괄 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onResetPassword(user) {
    const password = window.prompt(`${user.username} 사용자의 새 비밀번호를 입력해 주세요.`, "Temp12345!");
    if (!password) return;
    try {
      await api(`/api/admin/users/${user.id}/reset-password`, { method: "POST", body: { password } });
      setAdminStatus(`비밀번호를 초기화했습니다. 새 비밀번호: ${password}`);
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onIssueResetPin(user) {
    try {
      const result = await api(`/api/admin/users/${user.id}/issue-reset-pin`, { method: "POST" });
      setIssuedResetPinInfo(result);
      setAdminPasswordResetPins((current) => [result, ...current.filter((item) => String(item.id) !== String(result.id))].slice(0, 30));
      setAdminStatus(result.message || "비밀번호 재설정 PIN을 발급했습니다.");
      pushToast(result.message || "비밀번호 재설정 PIN을 발급했습니다.", "success");
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "PIN 발급 중 오류가 발생했습니다.", "error");
    }
  }
  async function onClearAccountSharingRestriction(user) {
    if (!user?.id) return;
    if (!window.confirm(`${user.username} 계정의 24시간 접근 제한을 해제할까요?`)) return;
    try {
      const result = await api(`/api/admin/users/${user.id}/account-sharing-restriction/resolve`, { method: "POST" });
      await loadAdmin();
      setAdminStatus(result.message || "계정 공유 접근 제한을 해제했습니다.");
      pushToast(result.message || "계정 공유 접근 제한을 해제했습니다.", "success");
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "계정 공유 제한 해제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onBulkApprove() {
    const selectedUserIdSet = new Set((selectedUserIds || []).map((id) => Number(id)).filter(Boolean));
    const targetUserIds = adminUsers
      .filter((user) => selectedUserIdSet.has(Number(user.id)))
      .map((user) => user.id);
    if (!targetUserIds.length) return setAdminStatus("승인할 사용자를 선택해 주세요.");
    try {
      const result = await api("/api/admin/users/bulk-approve", { method: "POST", body: { userIds: targetUserIds } });
      setAdminUsers((current) => current.map((user) => result.users.find((item) => Number(item.id) === Number(user.id)) ?? user));
      setSelectedUserIds([]);
      setAdminStatus(result.message);
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  function onSelectUnapprovedUsers() {
    if (!filteredUnapprovedUserIds.length) {
      setAdminStatus("현재 목록에 비승인 사용자가 없습니다.");
      return;
    }
    setSelectedUserIds((current) => Array.from(new Set([...current, ...filteredUnapprovedUserIds])));
    setAdminStatus(`비승인 사용자 ${filteredUnapprovedUserIds.length}명을 선택했습니다.`);
  }
  async function onBulkApproveUnapprovedUsers() {
    if (!filteredUnapprovedUserIds.length) {
      setAdminStatus("현재 목록에 비승인 사용자가 없습니다.");
      return;
    }
    try {
      const result = await api("/api/admin/users/bulk-approve", { method: "POST", body: { userIds: filteredUnapprovedUserIds } });
      setAdminUsers((current) => current.map((user) => result.users.find((item) => item.id === user.id) ?? user));
      setSelectedUserIds((current) => current.filter((id) => !filteredUnapprovedUserIds.some((targetId) => Number(targetId) === Number(id))));
      setAdminStatus(result.message || `비승인 사용자 ${filteredUnapprovedUserIds.length}명을 승인했습니다.`);
      pushToast(result.message || `비승인 사용자 ${filteredUnapprovedUserIds.length}명을 승인했습니다.`, "success");
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "비승인 사용자 일괄 승인 중 오류가 발생했습니다.", "error");
    }
  }
  async function onCourseSubmit(event) {
    event.preventDefault();
    const invalidFields = getInvalidCourseFields(courseForm);
    if (invalidFields.length) {
      setCourseFormInvalidFields(invalidFields);
      setAdminStatus("과정 필수 항목을 모두 입력해 주세요.");
      return;
    }
    if (!confirmMarkdownBlockingWarnings([
      { label: "실습 가이드", value: courseForm.labGuideMarkdown },
      { label: "실습 명령어", value: courseForm.commandsMarkdown },
    ])) {
      setAdminStatus("Markdown 코드 블록을 확인한 뒤 다시 저장해 주세요.");
      return;
    }
    let heatParameters = {};
    try { heatParameters = JSON.parse(courseForm.heatParametersText || "{}"); } catch { return setAdminStatus("Heat 파라미터 JSON 형식이 올바르지 않습니다."); }
    let surveyConfig = {};
    try { surveyConfig = JSON.parse(courseForm.surveyConfigText || "{}"); } catch { return setAdminStatus("설문 설정 JSON 형식이 올바르지 않습니다."); }
    surveyConfig = normalizeCourseSurveyConfig(surveyConfig);
    const payload = {
      slug: courseForm.slug,
      category: courseForm.category,
      courseType: courseForm.courseType,
      packageItems: (courseForm.packageItems || []).map(Number).filter(Boolean),
      programType: isGovernmentProgramTypeValue(courseForm.programType) ? "정부지원금" : courseForm.programType,
      title: courseForm.title,
      summary: courseForm.summary,
      price: Math.max(0, Number(courseForm.price || 0)),
      promoEnabled: Boolean(courseForm.promoEnabled),
      promoPrice: Math.max(0, Number(courseForm.promoPrice || 0)),
      promoStartsAt: fromDatetimeLocalInput(courseForm.promoStartsAt),
      promoEndsAt: fromDatetimeLocalInput(courseForm.promoEndsAt),
      duration: courseForm.duration,
      courseAccessDays: Math.max(1, Number(courseForm.courseAccessDays || 30)),
      level: courseForm.level,
      body: courseForm.body,
      youtubeUrl: courseForm.youtubeUrl,
      courseCurriculum: lines(courseForm.courseCurriculumText).map((value) => {
        const [title, duration = "", description = ""] = value.split("|").map((part) => part.trim());
        return { title, duration, description };
      }).filter((item) => item.title),
      courseVideos: lines(courseForm.courseVideosText).map((value) => {
        const [title, url, description = ""] = value.split("|").map((part) => part.trim());
        return { title, url, description };
      }).filter((item) => item.title && item.url),
      courseRecordings: parseCourseRecordingsText(courseForm.courseRecordingsText),
      onlineMeetingUrl: courseForm.onlineMeetingUrl,
      onlineBoardUrl: courseForm.onlineBoardUrl,
      onlineCourseNotice: courseForm.onlineCourseNotice,
      onlineSessionNote: courseForm.onlineSessionNote,
      labGuideMarkdown: courseForm.labGuideMarkdown,
      commandsMarkdown: courseForm.commandsMarkdown,
      aiSystemPrompt: courseForm.aiSystemPrompt,
      aiQuickPrompts: lines(courseForm.aiQuickPromptsText),
      externalToolLinks: parseExternalToolLinksText(courseForm.externalToolLinksText),
      externalLearningTools: parseExternalLearningToolsText(courseForm.externalLearningToolsText),
      labStartChecklist: lines(courseForm.labStartChecklistText).slice(0, 20),
      objectives: lines(courseForm.objectivesText),
      materials: lines(courseForm.materialsText).map((value) => { const [label, href] = value.split("|").map((part) => part.trim()); return { label, href }; }),
      textbookAssignments: (Array.isArray(courseForm.textbookAssignments) ? courseForm.textbookAssignments : [])
        .map((item, index) => ({
          textbookId: Number(item.textbookId || item.id),
          sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
          required: Boolean(item.required),
          visible: item.visible == null ? true : Boolean(item.visible),
        }))
        .filter((item) => item.textbookId > 0),
      exampleFiles: (Array.isArray(courseForm.exampleFiles) ? courseForm.exampleFiles : [])
        .map((item) => ({
          label: String(item?.label || "").trim(),
          href: String(item?.href || "").trim(),
        }))
        .filter((item) => item.label && item.href),
      gitRepositories: String(courseForm.gitRepositoryLabel || "").trim() && String(courseForm.gitRepositoryHref || "").trim()
        ? [{ label: String(courseForm.gitRepositoryLabel || "").trim(), href: String(courseForm.gitRepositoryHref || "").trim() }]
        : [],
      labEnabled: courseForm.labEnabled,
      labApprovalMode: courseForm.labApprovalMode,
      publicDomainApprovalMode: courseForm.publicDomainApprovalMode,
      publicTcpApprovalMode: courseForm.publicTcpApprovalMode,
      externalSshApprovalMode: courseForm.externalSshApprovalMode,
      externalRdpApprovalMode: courseForm.externalRdpApprovalMode,
      externalSshRouteMode: courseForm.externalSshRouteMode,
      labBackendType: courseForm.labBackendType,
      containerImageName: courseForm.containerImageName,
      containerCommandText: courseForm.containerCommandText,
      containerExposedPort: courseForm.containerExposedPort === "" ? null : Math.max(1, Number(courseForm.containerExposedPort || 22)),
      containerAccessMode: courseForm.containerAccessMode,
      containerConsoleMode: courseForm.containerConsoleMode,
      labRetentionMode: courseForm.labRetentionMode,
      labRetentionPreset: courseForm.labRetentionPreset,
      labRetentionDays: Math.max(1, Number(courseForm.labRetentionDays || 1)),
      allowResumeExistingLab: courseForm.allowResumeExistingLab,
      labResizePolicy: courseForm.labResizePolicy,
      labResizeAllowedFlavors: String(courseForm.labResizeAllowedFlavorsText || "").split(",").map((item) => item.trim()).filter(Boolean),
      terminalReplayMode: courseForm.terminalReplayMode || "inherit",
      trafficMonitoringEnabled: courseForm.trafficMonitoringEnabled,
      trafficDailyLimitGb: Math.max(0, Number(courseForm.trafficDailyLimitGb || 0)),
      trafficTotalLimitGb: Math.max(0, Number(courseForm.trafficTotalLimitGb || 0)),
      trafficExceededAction: courseForm.trafficExceededAction,
      heatTemplateName: courseForm.heatTemplateName,
      heatApiUrl: courseForm.heatApiUrl,
      heatStackPrefix: courseForm.heatStackPrefix,
      labProvisioningTimeoutMinutes: Math.max(1, Math.min(120, Math.round(Number(courseForm.labProvisioningTimeoutMinutes || 10) || 10))),
      heatParameters: {
        ...heatParameters,
        labProvisioningTimeoutMinutes: Math.max(1, Math.min(120, Math.round(Number(courseForm.labProvisioningTimeoutMinutes || 10) || 10))),
      },
      terminalSshUser: courseForm.terminalSshUser,
      terminalSshPort: Number(courseForm.terminalSshPort || 22),
      terminalJumpHost: courseForm.terminalJumpHost,
      terminalJumpUser: courseForm.terminalJumpUser,
      isPublished: courseForm.isPublished,
      isLandingPreview: courseForm.isLandingPreview,
      courseStatus: courseForm.courseStatus,
      releaseLabel: courseForm.releaseLabel,
      accessScope: courseForm.accessScope,
      accessCode: courseForm.accessCode,
      surveyConfig,
    };
    try {
      const result = await api(courseForm.id ? `/api/admin/courses/${courseForm.id}` : "/api/admin/courses", { method: courseForm.id ? "PUT" : "POST", body: payload });
      setAdminCourses((current) => upsertByKey(current, result.course, "id"));
      setCourses((current) => upsertByKey(current, result.course, "id"));
      const editingCourse = Boolean(courseForm.id);
      setCourseForm(EMPTY_COURSE);
      setCourseFormInvalidFields([]);
      const cleanupCount = Math.max(0, Number(result.policyCleanup?.cleanedLabs || 0) || 0);
      const message = editingCourse
        ? cleanupCount
          ? `과정을 수정했습니다. 사용금지 정책으로 랩 ${cleanupCount}개의 외부 연결과 대기 요청을 정리했습니다.`
          : "과정을 수정했습니다."
        : "과정을 등록했습니다.";
      setAdminStatus(message);
      if (editingCourse) {
        openAdminSaveDialog(message);
      }
      if (!editingCourse) {
        setCourseSubmissionNotice(result.slugAdjusted
          ? `새로운 과정 등록이 되었습니다.\n슬러그는 ${result.course?.slug || result.requestedSlug || payload.slug}로 저장되었습니다.`
          : "새로운 과정 등록이 되었습니다.");
      }
      const refreshTasks = [loadCourses(), loadAdminCourses(), loadPlatformStatus(false, { force: true })];
      if (cleanupCount) refreshTasks.push(loadLabs(), loadAdminLabs(), loadNotifications());
      void runSafeRefreshTasks(refreshTasks);
    } catch (error) {
      if (error.message === "과정 필수 항목을 모두 입력해 주세요.") {
        setCourseFormInvalidFields(getInvalidCourseFields(courseForm));
      }
      setAdminStatus(error.message);
      openAdminSaveDialog(error.message, "error");
    }
  }
  async function onTextbookSubmit(event) {
    event.preventDefault();
    const title = String(textbookForm.title || "").trim();
    if (!title) {
      setAdminStatus("교재 제목을 입력해 주세요.");
      return;
    }
    if (!confirmMarkdownBlockingWarnings([{ label: "교재 본문", value: textbookForm.contentMarkdown }])) {
      setAdminStatus("Markdown 코드 블록을 확인한 뒤 다시 저장해 주세요.");
      return;
    }
    const payload = {
      slug: textbookForm.slug || title,
      title,
      summary: textbookForm.summary,
      contentMarkdown: textbookForm.contentMarkdown,
      status: textbookForm.status,
      version: textbookForm.version,
    };
    try {
      const result = await api(textbookForm.id ? `/api/admin/textbooks/${textbookForm.id}` : "/api/admin/textbooks", {
        method: textbookForm.id ? "PUT" : "POST",
        body: payload,
      });
      setAdminTextbooks((current) => upsertByKey(current, result.textbook, "id"));
      setTextbookForm(EMPTY_TEXTBOOK);
      setAdminStatus(textbookForm.id ? "교재를 수정했습니다." : "교재를 등록했습니다.");
      openAdminSaveDialog(textbookForm.id ? "교재를 수정했습니다." : "교재를 등록했습니다.");
      void runSafeRefreshTasks([loadAdminTextbooks(), loadAdminCourses(), loadCourses()]);
    } catch (error) {
      setAdminStatus(error.message);
      openAdminSaveDialog(error.message, "error");
    }
  }
  function onTextbookEdit(textbook) {
    setTextbookForm({
      id: textbook.id,
      slug: textbook.slug || "",
      title: textbook.title || "",
      summary: textbook.summary || "",
      contentMarkdown: textbook.contentMarkdown || "",
      status: textbook.status || "draft",
      version: textbook.version || "1.0",
    });
  }
  function onCancelTextbookEdit() {
    setTextbookForm(EMPTY_TEXTBOOK);
  }
  async function onTextbookDelete(textbookId) {
    try {
      setAdminTextbooks((current) => removeByKey(current, textbookId, "id"));
      await api(`/api/admin/textbooks/${textbookId}`, { method: "DELETE" });
      setTextbookForm((current) => (Number(current.id) === Number(textbookId) ? EMPTY_TEXTBOOK : current));
      setAdminStatus("교재를 삭제했습니다.");
      void runSafeRefreshTasks([loadAdminTextbooks(), loadAdminCourses(), loadCourses()]);
    } catch (error) {
      void runSafeRefreshTasks([loadAdminTextbooks(), loadAdminCourses(), loadCourses()]);
      setAdminStatus(error.message);
    }
  }
  function onCourseEdit(course) {
    setCourseFormInvalidFields([]);
    setCourseForm({
      id: course.id, slug: course.slug, category: course.category, courseType: course.courseType || "standard", packageItems: Array.isArray(course.packageItems) ? course.packageItems.map(String) : [], programType: isGovernmentProgramTypeValue(course.programType) ? "정부지원금" : course.programType || "일반", title: course.title, summary: course.summary, price: String(Math.max(0, Number(course.price || 0))), promoEnabled: Boolean(course.promoEnabled), promoPrice: String(Math.max(0, Number(course.promoPrice || 0))), promoStartsAt: toDatetimeLocalInput(course.promoStartsAt), promoEndsAt: toDatetimeLocalInput(course.promoEndsAt), duration: course.duration, courseAccessDays: String(Math.max(1, Number(course.courseAccessDays || course.courseAccessDefaultDays || 30) || 30)), level: course.level, body: course.body,
      youtubeUrl: course.youtubeUrl || "",
      courseCurriculumText: (course.courseCurriculum || []).map((item) => `${item.title || ""}${item.duration ? ` | ${item.duration}` : ""}${item.description ? ` | ${item.description}` : ""}`).join("\n"),
      courseVideosText: (course.courseVideos || []).map((item) => `${item.title || ""} | ${item.url || ""}${item.description ? ` | ${item.description}` : ""}`).join("\n"),
      courseRecordingsText: formatCourseRecordingsText(course.courseRecordings),
      onlineMeetingUrl: course.onlineMeetingUrl || "",
      onlineBoardUrl: course.onlineBoardUrl || "",
      onlineCourseNotice: course.onlineCourseNotice || DEFAULT_ONLINE_COURSE_NOTICE,
      onlineSessionNote: course.onlineSessionNote || "",
      labGuideMarkdown: course.labGuideMarkdown || "",
      commandsMarkdown: course.commandsMarkdown || "",
      aiSystemPrompt: course.aiSystemPrompt || "",
      aiQuickPromptsText: (course.aiQuickPrompts || []).join("\n"),
      externalToolLinksText: formatExternalToolLinksText(course.externalToolLinks),
      externalLearningToolsText: formatExternalLearningToolsText(course.externalLearningTools),
      labStartChecklistText: (course.labStartChecklist || []).join("\n"),
        objectivesText: (course.objectives || []).join("\n"),
        materialsText: (course.materials || []).map((item) => `${item.label} | ${item.href}`).join("\n"),
        textbookAssignments: (course.textbooks || []).map((item, index) => ({
          textbookId: Number(item.textbookId || item.id),
          sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
          required: Boolean(item.required),
          visible: item.visible == null ? true : Boolean(item.visible),
        })).filter((item) => item.textbookId > 0),
        exampleFiles: Array.isArray(course.exampleFiles) ? course.exampleFiles.map((item) => ({
          label: String(item?.label || "").trim(),
          href: String(item?.href || "").trim(),
        })) : [],
        gitRepositoryLabel: String(course.gitRepositories?.[0]?.label || "").trim(),
        gitRepositoryHref: String(course.gitRepositories?.[0]?.href || "").trim(),
        labEnabled: Boolean(course.labEnabled), labApprovalMode: course.labApprovalMode || "manual", publicDomainApprovalMode: course.publicDomainApprovalMode || "manual", publicTcpApprovalMode: course.publicTcpApprovalMode || "manual", externalSshApprovalMode: course.externalSshApprovalMode || "manual", externalRdpApprovalMode: course.externalRdpApprovalMode || "manual", externalSshRouteMode: course.externalSshRouteMode === "domain" ? "domain" : "both", labBackendType: course.labBackendType || "vm", containerImageName: course.containerImageName || "", containerCommandText: course.containerCommandText || "", containerExposedPort: course.containerExposedPort == null ? "22" : String(course.containerExposedPort || 22), containerAccessMode: course.containerAccessMode || "console", containerConsoleMode: course.containerConsoleMode || "zun", heatTemplateName: course.heatTemplateName || "", heatApiUrl: course.heatApiUrl || "", heatStackPrefix: course.heatStackPrefix || "",
        labRetentionMode: course.labRetentionMode || "ephemeral",
        labRetentionPreset: course.labRetentionPreset || "1",
        labRetentionDays: String(Math.max(1, Number(course.labRetentionDays || 1) || 1)),
        allowResumeExistingLab: Boolean(course.allowResumeExistingLab),
        labResizePolicy: course.labResizePolicy || "requestable",
        labResizeAllowedFlavorsText: Array.isArray(course.labResizeAllowedFlavors) ? course.labResizeAllowedFlavors.join(", ") : "",
        terminalReplayMode: ["enabled", "disabled"].includes(String(course.terminalReplayMode || "")) ? course.terminalReplayMode : "inherit",
        trafficMonitoringEnabled: Boolean(course.trafficMonitoringEnabled),
        trafficDailyLimitGb: String(Math.max(0, Number(course.trafficDailyLimitGb || 0))),
        trafficTotalLimitGb: String(Math.max(0, Number(course.trafficTotalLimitGb || 0))),
        trafficExceededAction: course.trafficExceededAction || "warn",
        labProvisioningTimeoutMinutes: String(Math.max(1, Math.min(120, Number(course.labProvisioningTimeoutMinutes || course.heatParameters?.labProvisioningTimeoutMinutes || 10) || 10))),
        heatParametersText: JSON.stringify(Object.fromEntries(
          Object.entries(course.heatParameters || {}).filter(([key]) => key !== "labProvisioningTimeoutMinutes"),
        ), null, 2), terminalSshUser: course.terminalSshUser || "", terminalSshPort: String(course.terminalSshPort || 22), terminalJumpHost: course.terminalJumpHost || "", terminalJumpUser: course.terminalJumpUser || "",
      isPublished: Boolean(course.isPublished), isLandingPreview: Boolean(course.isLandingPreview), courseStatus: course.courseStatus || "published", releaseLabel: course.releaseLabel || "", accessScope: course.accessScope || "public", accessCode: course.accessCode || "", surveyConfigText: JSON.stringify(normalizeCourseSurveyConfig(course.surveyConfig), null, 2),
    });
  }
  function createCourseAccessCode(seedSource) {
    const slugSeed = String(seedSource || "COURSE")
      .replace(/[^a-zA-Z0-9가-힣]/g, "")
      .slice(0, 6)
      .toUpperCase();
    const randomSuffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${slugSeed || "COURSE"}-${randomSuffix}`;
  }
  function createOnlineCourseSlug(course) {
    const baseSlug = String(course?.slug || course?.title || "course")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9가-힣_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "course";
    return baseSlug.endsWith("-online") ? baseSlug : `${baseSlug}-online`;
  }
  function createIltCourseSlug(course) {
    const baseSlug = String(course?.slug || course?.title || "course")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9가-힣_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "course";
    return baseSlug.endsWith("-ilt") ? `${baseSlug}-copy` : `${baseSlug}-ilt`;
  }
  function createIltCourseTitle(course) {
    const baseTitle = String(course?.title || "새 과정").trim() || "새 과정";
    return /\bILT\b|Instructor\s*Led\s*Training/i.test(baseTitle) ? baseTitle : `${baseTitle} (ILT)`;
  }
  function createCourseCopySlug(course) {
    const baseSlug = String(course?.slug || course?.title || "course")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9가-힣_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "course";
    return `${baseSlug}-copy`;
  }
  function createCourseCopyTitle(course) {
    const baseTitle = String(course?.title || "새 과정").trim() || "새 과정";
    return `${baseTitle} (복사본)`;
  }
  function onCloneCourseAsOnlineDraft(course) {
    if (!course) {
      setAdminStatus("복사할 과정을 찾을 수 없습니다.");
      return;
    }
    setCourseFormInvalidFields([]);
    setCourseSubmissionNotice("");
    setCourseForm({
      id: null,
      slug: createOnlineCourseSlug(course),
      category: course.category || "",
      courseType: "online",
      programType: isGovernmentProgramTypeValue(course.programType) ? "정부지원금" : course.programType || "일반",
      title: String(course.title || "").includes("(온라인)") ? course.title : `${course.title || "새 과정"} (온라인)`,
      summary: course.summary || "",
      price: String(Math.max(0, Number(course.price || 0))),
      promoEnabled: false,
      promoPrice: "0",
      promoStartsAt: "",
      promoEndsAt: "",
      duration: course.duration || "",
      courseAccessDays: String(Math.max(1, Number(course.courseAccessDays || course.courseAccessDefaultDays || 30) || 30)),
      level: course.level || "입문",
      body: course.body || "",
      youtubeUrl: course.youtubeUrl || "",
      courseCurriculumText: (course.courseCurriculum || []).map((item) => `${item.title || ""}${item.duration ? ` | ${item.duration}` : ""}${item.description ? ` | ${item.description}` : ""}`).join("\n"),
      courseVideosText: (course.courseVideos || []).map((item) => `${item.title || ""} | ${item.url || ""}${item.description ? ` | ${item.description}` : ""}`).join("\n"),
      courseRecordingsText: formatCourseRecordingsText(course.courseRecordings),
      onlineMeetingUrl: "",
      onlineBoardUrl: "",
      onlineCourseNotice: course.onlineCourseNotice || DEFAULT_ONLINE_COURSE_NOTICE,
      onlineSessionNote: "",
      labGuideMarkdown: course.labGuideMarkdown || "",
      commandsMarkdown: course.commandsMarkdown || "",
      aiSystemPrompt: course.aiSystemPrompt || "",
      aiQuickPromptsText: (course.aiQuickPrompts || []).join("\n"),
      externalToolLinksText: formatExternalToolLinksText(course.externalToolLinks),
      externalLearningToolsText: formatExternalLearningToolsText(course.externalLearningTools),
      labStartChecklistText: (course.labStartChecklist || []).join("\n"),
      objectivesText: (course.objectives || []).join("\n"),
      materialsText: (course.materials || []).map((item) => `${item.label} | ${item.href}`).join("\n"),
      textbookAssignments: (course.textbooks || []).map((item, index) => ({
        textbookId: Number(item.textbookId || item.id),
        sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
        required: Boolean(item.required),
        visible: item.visible == null ? true : Boolean(item.visible),
      })).filter((item) => item.textbookId > 0),
      exampleFiles: Array.isArray(course.exampleFiles) ? course.exampleFiles.map((item) => ({
        label: String(item?.label || "").trim(),
        href: String(item?.href || "").trim(),
      })) : [],
      gitRepositoryLabel: String(course.gitRepositories?.[0]?.label || "").trim(),
      gitRepositoryHref: String(course.gitRepositories?.[0]?.href || "").trim(),
      labEnabled: false,
      labApprovalMode: "manual",
      publicDomainApprovalMode: "manual",
      publicTcpApprovalMode: "manual",
      externalSshApprovalMode: "manual",
      externalRdpApprovalMode: "manual",
      externalSshRouteMode: "both",
      labBackendType: "vm",
      containerImageName: "",
      containerCommandText: "",
      containerExposedPort: "22",
      containerAccessMode: "console",
      containerConsoleMode: "zun",
      heatTemplateName: "",
      heatApiUrl: "",
      heatStackPrefix: "",
      labProvisioningTimeoutMinutes: "10",
      labRetentionMode: "ephemeral",
      labRetentionPreset: "1",
      labRetentionDays: "1",
      allowResumeExistingLab: false,
      labResizePolicy: "disabled",
      labResizeAllowedFlavorsText: "",
      terminalReplayMode: "inherit",
      trafficMonitoringEnabled: false,
      trafficDailyLimitGb: "0",
      trafficTotalLimitGb: "0",
      trafficExceededAction: "warn",
      heatParametersText: "{}",
      terminalSshUser: "",
      terminalSshPort: "22",
      terminalJumpHost: "",
      terminalJumpUser: "",
      isPublished: false,
      isLandingPreview: false,
      courseStatus: "published",
      releaseLabel: "",
      accessScope: "private",
      accessCode: "",
      surveyConfigText: JSON.stringify(normalizeCourseSurveyConfig(course.surveyConfig), null, 2),
      onlineCopySourceCourseId: course.id,
    });
    setAdminStatus(`${course.title || "선택한 과정"}을 온라인 과정 초안으로 복사했습니다. 링크와 세션 안내를 입력한 뒤 저장해 주세요.`);
    pushToast("온라인 과정 초안을 준비했습니다.", "success");
  }
  function buildExistingCoursePayload(course, overrides = {}) {
    return {
      slug: overrides.slug ?? course.slug ?? "",
      category: overrides.category ?? course.category ?? "",
      courseType: overrides.courseType ?? course.courseType ?? "standard",
      programType: isGovernmentProgramTypeValue(overrides.programType ?? course.programType) ? "정부지원금" : overrides.programType ?? course.programType ?? "일반",
      title: overrides.title ?? course.title ?? "",
      summary: overrides.summary ?? course.summary ?? "",
      price: overrides.price ?? course.price ?? 0,
      promoEnabled: overrides.promoEnabled ?? Boolean(course.promoEnabled),
      promoPrice: overrides.promoPrice ?? Math.max(0, Number(course.promoPrice || 0)),
      promoStartsAt: fromDatetimeLocalInput(overrides.promoStartsAt ?? course.promoStartsAt ?? ""),
      promoEndsAt: fromDatetimeLocalInput(overrides.promoEndsAt ?? course.promoEndsAt ?? ""),
      duration: overrides.duration ?? course.duration ?? "",
      courseAccessDays: Math.max(1, Number(overrides.courseAccessDays ?? course.courseAccessDays ?? course.courseAccessDefaultDays ?? 30) || 30),
      level: overrides.level ?? course.level ?? "",
      body: overrides.body ?? course.body ?? "",
      youtubeUrl: overrides.youtubeUrl ?? course.youtubeUrl ?? "",
      courseCurriculum: overrides.courseCurriculum ?? course.courseCurriculum ?? [],
      courseVideos: overrides.courseVideos ?? course.courseVideos ?? [],
      courseRecordings: overrides.courseRecordings ?? course.courseRecordings ?? [],
      onlineMeetingUrl: overrides.onlineMeetingUrl ?? course.onlineMeetingUrl ?? "",
      onlineBoardUrl: overrides.onlineBoardUrl ?? course.onlineBoardUrl ?? "",
      onlineCourseNotice: overrides.onlineCourseNotice ?? course.onlineCourseNotice ?? DEFAULT_ONLINE_COURSE_NOTICE,
      onlineSessionNote: overrides.onlineSessionNote ?? course.onlineSessionNote ?? "",
      labGuideMarkdown: overrides.labGuideMarkdown ?? course.labGuideMarkdown ?? "",
      commandsMarkdown: overrides.commandsMarkdown ?? course.commandsMarkdown ?? "",
      aiSystemPrompt: overrides.aiSystemPrompt ?? course.aiSystemPrompt ?? "",
      aiQuickPrompts: overrides.aiQuickPrompts ?? course.aiQuickPrompts ?? [],
      externalToolLinks: overrides.externalToolLinks ?? course.externalToolLinks ?? [],
      externalLearningTools: overrides.externalLearningTools ?? course.externalLearningTools ?? [],
      labStartChecklist: overrides.labStartChecklist ?? course.labStartChecklist ?? [],
      objectives: overrides.objectives ?? course.objectives ?? [],
      materials: overrides.materials ?? course.materials ?? [],
      textbookAssignments: overrides.textbookAssignments ?? (course.textbooks || []).map((item, index) => ({
        textbookId: Number(item.textbookId || item.id),
        sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
        required: Boolean(item.required),
        visible: item.visible == null ? true : Boolean(item.visible),
      })).filter((item) => item.textbookId > 0),
      exampleFiles: overrides.exampleFiles ?? course.exampleFiles ?? [],
      gitRepositories: overrides.gitRepositories ?? course.gitRepositories ?? [],
      labEnabled: overrides.labEnabled ?? Boolean(course.labEnabled),
      labApprovalMode: overrides.labApprovalMode ?? course.labApprovalMode ?? "manual",
      publicDomainApprovalMode: overrides.publicDomainApprovalMode ?? course.publicDomainApprovalMode ?? "manual",
      publicTcpApprovalMode: overrides.publicTcpApprovalMode ?? course.publicTcpApprovalMode ?? "manual",
      externalSshApprovalMode: overrides.externalSshApprovalMode ?? course.externalSshApprovalMode ?? "manual",
      externalRdpApprovalMode: overrides.externalRdpApprovalMode ?? course.externalRdpApprovalMode ?? "manual",
      externalSshRouteMode: overrides.externalSshRouteMode
        ? (String(overrides.externalSshRouteMode || "").trim().toLowerCase() === "domain" ? "domain" : "both")
        : (String(course.externalSshRouteMode || "both").trim().toLowerCase() === "domain" ? "domain" : "both"),
      labBackendType: overrides.labBackendType ?? course.labBackendType ?? "vm",
      containerImageName: overrides.containerImageName ?? course.containerImageName ?? "",
      containerCommandText: overrides.containerCommandText ?? course.containerCommandText ?? "",
      containerExposedPort: overrides.containerExposedPort ?? course.containerExposedPort ?? 22,
      containerAccessMode: overrides.containerAccessMode ?? course.containerAccessMode ?? "console",
      containerConsoleMode: overrides.containerConsoleMode ?? course.containerConsoleMode ?? "zun",
      labRetentionMode: overrides.labRetentionMode ?? course.labRetentionMode ?? "ephemeral",
      labRetentionPreset: overrides.labRetentionPreset ?? course.labRetentionPreset ?? "1",
      labRetentionDays: Math.max(1, Number(overrides.labRetentionDays ?? course.labRetentionDays ?? 1) || 1),
      allowResumeExistingLab: overrides.allowResumeExistingLab ?? Boolean(course.allowResumeExistingLab),
      labResizePolicy: overrides.labResizePolicy ?? course.labResizePolicy ?? "requestable",
      labResizeAllowedFlavors: overrides.labResizeAllowedFlavors ?? course.labResizeAllowedFlavors ?? [],
      terminalReplayMode: overrides.terminalReplayMode ?? course.terminalReplayMode ?? "inherit",
      trafficMonitoringEnabled: overrides.trafficMonitoringEnabled ?? Boolean(course.trafficMonitoringEnabled),
      trafficDailyLimitGb: Math.max(0, Number(overrides.trafficDailyLimitGb ?? course.trafficDailyLimitGb ?? 0)),
      trafficTotalLimitGb: Math.max(0, Number(overrides.trafficTotalLimitGb ?? course.trafficTotalLimitGb ?? 0)),
      trafficExceededAction: overrides.trafficExceededAction ?? course.trafficExceededAction ?? "warn",
      heatTemplateName: overrides.heatTemplateName ?? course.heatTemplateName ?? "",
      heatApiUrl: overrides.heatApiUrl ?? course.heatApiUrl ?? "",
      heatStackPrefix: overrides.heatStackPrefix ?? course.heatStackPrefix ?? "",
      labProvisioningTimeoutMinutes: Math.max(1, Math.min(120, Number(
        overrides.labProvisioningTimeoutMinutes
          ?? course.labProvisioningTimeoutMinutes
          ?? course.heatParameters?.labProvisioningTimeoutMinutes
          ?? 10,
      ) || 10)),
      heatParameters: overrides.heatParameters ?? course.heatParameters ?? {},
      terminalSshUser: overrides.terminalSshUser ?? course.terminalSshUser ?? "",
      terminalSshPort: Number(overrides.terminalSshPort ?? course.terminalSshPort ?? 22),
      terminalJumpHost: overrides.terminalJumpHost ?? course.terminalJumpHost ?? "",
      terminalJumpUser: overrides.terminalJumpUser ?? course.terminalJumpUser ?? "",
      isPublished: overrides.isPublished ?? Boolean(course.isPublished),
      isLandingPreview: overrides.isLandingPreview ?? Boolean(course.isLandingPreview),
      courseStatus: overrides.courseStatus ?? course.courseStatus ?? "published",
      releaseLabel: overrides.releaseLabel ?? course.releaseLabel ?? "",
      accessScope: overrides.accessScope ?? course.accessScope ?? "public",
      accessCode: overrides.accessCode ?? course.accessCode ?? "",
      surveyConfig: overrides.surveyConfig ?? course.surveyConfig ?? DEFAULT_COURSE_SURVEY_CONFIG,
    };
  }
  async function onCloneCourse(course) {
    if (!course) {
      setAdminStatus("복제할 과정을 찾을 수 없습니다.");
      return;
    }
    const payload = buildExistingCoursePayload(course, {
      slug: createCourseCopySlug(course),
      title: createCourseCopyTitle(course),
      isPublished: false,
      isLandingPreview: false,
      accessScope: "private",
      accessCode: "",
    });
    try {
      setAdminStatus("과정을 복제하는 중입니다...");
      const result = await api("/api/admin/courses", { method: "POST", body: payload });
      setAdminCourses((current) => upsertByKey(current, result.course, "id"));
      setCourses((current) => upsertByKey(current, result.course, "id"));
      setCourseFormInvalidFields([]);
      const savedSlug = result.course?.slug || payload.slug;
      const message = result.slugAdjusted
        ? `과정을 복제했습니다. 슬러그는 ${savedSlug}로 저장되었습니다.`
        : "과정을 복제했습니다. 공개 전 제목과 노출 설정을 확인해 주세요.";
      setAdminStatus(message);
      pushToast("과정 복제가 완료되었습니다.", "success");
      void runSafeRefreshTasks([loadCourses(), loadAdminCourses(), loadPlatformStatus(false, { force: true })]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "과정 복제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onCloneCourseAsIlt(course) {
    if (!course) {
      setAdminStatus("복제할 과정을 찾을 수 없습니다.");
      return;
    }
    if (String(course.courseType || "standard") === "online") {
      setAdminStatus("ILT 복제는 일반 과정에서만 사용할 수 있습니다.");
      return;
    }
    const payload = buildExistingCoursePayload(course, {
      slug: createIltCourseSlug(course),
      courseType: "standard",
      programType: "ILT",
      title: createIltCourseTitle(course),
      promoEnabled: false,
      promoPrice: 0,
      promoStartsAt: "",
      promoEndsAt: "",
      isPublished: false,
      isLandingPreview: false,
      accessScope: "private",
      accessCode: "",
    });
    try {
      setAdminStatus("ILT 과정으로 복제하는 중입니다...");
      const result = await api("/api/admin/courses", { method: "POST", body: payload });
      setAdminCourses((current) => upsertByKey(current, result.course, "id"));
      setCourses((current) => upsertByKey(current, result.course, "id"));
      setCourseFormInvalidFields([]);
      setCourseForm((current) => (current.id ? current : EMPTY_COURSE));
      const savedSlug = result.course?.slug || payload.slug;
      const message = result.slugAdjusted
        ? `ILT 과정으로 복제했습니다. 슬러그는 ${savedSlug}로 저장되었습니다.`
        : "ILT 과정으로 복제했습니다. 공개 전 가격과 일정 정보를 확인해 주세요.";
      setAdminStatus(message);
      pushToast("ILT 과정 복제가 완료되었습니다.", "success");
      void runSafeRefreshTasks([loadCourses(), loadAdminCourses(), loadPlatformStatus(false, { force: true })]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "ILT 과정 복제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onUpdateCourseAccessCode(courseId, accessCode) {
    const course = adminCourses.find((item) => Number(item.id) === Number(courseId));
    if (!course) {
      setAdminStatus("과정을 찾을 수 없습니다.");
      return;
    }
    try {
      const result = await api(`/api/admin/courses/${course.id}`, {
        method: "PUT",
        body: buildExistingCoursePayload(course, { accessCode }),
      });
      setAdminCourses((current) => upsertByKey(current, result.course, "id"));
      setCourses((current) => upsertByKey(current, result.course, "id"));
      setCourseForm((current) => (Number(current.id) === Number(course.id) ? { ...current, accessCode } : current));
      setAdminStatus(accessCode ? "과정 코드를 저장했습니다." : "과정 코드를 제거했습니다.");
      pushToast(accessCode ? "과정 코드를 저장했습니다." : "과정 코드를 제거했습니다.", "success");
      void runSafeRefreshTasks([loadCourses(), loadAdminCourses()]);
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  function onGenerateCourseAccessCode(courseId = null) {
    if (courseId != null) {
      const course = adminCourses.find((item) => Number(item.id) === Number(courseId));
      if (!course) {
        setAdminStatus("과정을 찾을 수 없습니다.");
        return;
      }
      const generated = createCourseAccessCode(course.slug || course.title || "COURSE");
      void onUpdateCourseAccessCode(course.id, generated);
      return;
    }
    const generated = createCourseAccessCode(courseForm.slug || courseForm.title || "COURSE");
    setCourseForm((current) => ({
      ...current,
      accessCode: generated,
    }));
    pushToast("과정 코드를 자동 생성했습니다.", "success");
  }
  async function onCourseDelete(courseId) {
    try {
      setAdminCourses((current) => removeByKey(current, courseId, "id"));
      setCourses((current) => removeByKey(current, courseId, "id"));
      setWrittenExams((current) => removeByKey(current, courseId, "courseId"));
      setLabExams((current) => removeByKey(current, courseId, "courseId"));
      await api(`/api/admin/courses/${courseId}`, { method: "DELETE" });
      setAdminStatus("과정을 삭제했습니다.");
      setCourseFormInvalidFields([]);
      setCourseForm((current) => (current.id === courseId ? EMPTY_COURSE : current));
      void runSafeRefreshTasks([loadCourses(), loadAdminCourses(), loadWrittenExams(), loadLabExams()]);
    } catch (error) {
      void runSafeRefreshTasks([loadCourses(), loadAdminCourses(), loadWrittenExams(), loadLabExams()]);
      setAdminStatus(error.message);
    }
  }
  function onHeatTemplateEdit(template) {
    setHeatTemplateForm({ name: template.name, content: template.content });
  }
  function onCancelHeatTemplateEdit() {
    setHeatTemplateForm(EMPTY_TEMPLATE);
  }
  async function onUploadHeatTemplate(file, options = {}) {
    if (!file) return;
    const lowerName = String(file.name || "").toLowerCase();
    if (!lowerName.endsWith(".yaml") && !lowerName.endsWith(".yml")) {
      setAdminStatus("YAML 템플릿 파일만 업로드할 수 있습니다.");
      return;
    }

    try {
      const contentBase64 = await fileToBase64(file);
      const result = await api("/api/admin/heat-templates", {
        method: "POST",
        body: {
          fileName: file.name,
          contentBase64,
          overwrite: Boolean(options?.overwrite),
        },
      });
      setAdminHeatTemplates((current) => upsertByKey(current, {
        ...(current.find((item) => item.name === result.template?.name) || {}),
        ...result.template,
      }, "name"));
      const message = result.message || (result.replaced ? "기존 Heat 템플릿을 덮어썼습니다." : "Heat 템플릿을 업로드했습니다.");
      setAdminStatus(message);
      openAdminSaveDialog(message, "success", result.replaced ? "템플릿 덮어쓰기 완료" : "템플릿 업로드 완료");
      setHeatTemplateForm(result.template);
      void loadAdminHeatTemplates();
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onHeatTemplateSave(event) {
    event.preventDefault();
    const name = String(heatTemplateForm.name || "").trim();
    const content = String(heatTemplateForm.content || "");
    if (!name) {
      setAdminStatus("템플릿 파일명을 입력해 주세요.");
      return false;
    }
    if (!content.trim()) {
      setAdminStatus("템플릿 내용을 입력해 주세요.");
      return false;
    }
    try {
      const existingTemplate = adminHeatTemplates.find((item) => String(item.name || "").trim() === name);
      const isOverwrite = Boolean(existingTemplate);
      const result = existingTemplate
        ? await api(`/api/admin/heat-templates/${encodeURIComponent(name)}`, { method: "PUT", body: { content } })
        : await api("/api/admin/heat-templates", { method: "POST", body: { fileName: name, content } });
      setAdminHeatTemplates((current) => upsertByKey(current, {
        ...(current.find((item) => item.name === result.template?.name) || {}),
        ...result.template,
      }, "name"));
      const replaced = result.replaced ?? isOverwrite;
      const message = result.message || (replaced ? "기존 Heat 템플릿을 덮어썼습니다." : "Heat 템플릿을 저장했습니다.");
      setAdminStatus(message);
      openAdminSaveDialog(message, "success", replaced ? "템플릿 덮어쓰기 완료" : "템플릿 저장 완료");
      setHeatTemplateForm(result.template);
      void loadAdminHeatTemplates();
      return true;
    } catch (error) {
      setAdminStatus(error.message);
      openAdminSaveDialog(error.message, "error");
      return false;
    }
  }
  async function onDeleteHeatTemplate(name) {
    if (!name) return;
    const previousTemplates = adminHeatTemplates;
    const previousForm = heatTemplateForm;
    try {
      setAdminHeatTemplates((current) => removeByKey(current, name, "name"));
      setHeatTemplateForm((current) => (current.name === name ? EMPTY_TEMPLATE : current));
      const result = await api(`/api/admin/heat-templates/${encodeURIComponent(name)}`, { method: "DELETE" });
      setAdminStatus(result.message || "Heat 템플릿을 삭제했습니다.");
      void loadAdminHeatTemplates();
    } catch (error) {
      setAdminHeatTemplates(previousTemplates);
      setHeatTemplateForm(previousForm);
      void loadAdminHeatTemplates();
      setAdminStatus(error.message);
    }
  }
  async function onCheckHeatTemplateCapacity(input = {}) {
    try {
      const result = await api("/api/admin/heat-templates/capacity-check", {
        method: "POST",
        body: input,
      });
      return result;
    } catch (error) {
      setAdminStatus(error.message || "Heat 템플릿 수용량 계산에 실패했습니다.");
      throw error;
    }
  }
  async function onRunHeatTemplateWorkloadTest(input = {}) {
    try {
      const result = await api("/api/admin/heat-templates/workload-test", {
        method: "POST",
        body: input,
      });
      setAdminStatus(result.message || result.result?.message || "Heat 템플릿 임시 실행 테스트를 완료했습니다.");
      return result.result || result;
    } catch (error) {
      setAdminStatus(error.message);
      throw error;
    }
  }
  async function onGetHeatTemplateWorkloadTest(jobId = "") {
    return api(`/api/admin/heat-templates/workload-test/${encodeURIComponent(jobId)}`);
  }
  async function onListHeatTemplateWorkloadTests(input = {}) {
    const params = new URLSearchParams();
    if (input.limit) params.set("limit", String(input.limit));
    if (input.status) params.set("status", String(input.status));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return api(`/api/admin/heat-templates/workload-test${suffix}`);
  }
  function onApplicationYamlEdit(item) {
    setApplicationYamlForm({
      name: item.name,
      content: item.content,
      category: item.category || "basic",
      description: item.description || "",
    });
  }
  function onCancelApplicationYamlEdit() {
    setApplicationYamlForm(EMPTY_APPLICATION_YAML);
  }
  function onCloudInitTemplateEdit(item) {
    setCloudInitTemplateForm({
      name: item.name,
      content: item.content,
      description: item.description || "",
    });
  }
  function onCancelCloudInitTemplateEdit() {
    setCloudInitTemplateForm(EMPTY_CLOUD_INIT_TEMPLATE);
  }
  async function onUploadApplicationYaml(input) {
    const files = Array.isArray(input)
      ? input
      : Array.from(input?.length ? input : input ? [input] : []);
    if (!files.length) return;

    const invalidExtension = files.find((file) => {
      const lowerName = String(file?.name || "").toLowerCase();
      return !lowerName.endsWith(".yaml") && !lowerName.endsWith(".yml");
    });
    if (invalidExtension) {
      setAdminStatus(`YAML 파일만 업로드할 수 있습니다. (${invalidExtension.name})`);
      return;
    }

    const blockedFile = files.find((file) => ["clouds.yaml", "clouds.yml"].includes(String(file?.name || "").toLowerCase()));
    if (blockedFile) {
      setAdminStatus("clouds.yaml은 OpenStack 인증 파일이라 Application YAML로 업로드할 수 없습니다. 다른 파일명으로 저장해 주세요.");
      return;
    }

    setApplicationYamlUploadState({ uploading: true, total: files.length, completed: 0 });
    const uploadedItems = [];
    const failed = [];

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        try {
          const contentBase64 = await fileToBase64(file);
          const result = await api("/api/admin/application-yamls", {
            method: "POST",
            body: {
              fileName: file.name,
              contentBase64,
              category: applicationYamlForm.category,
              description: applicationYamlForm.description,
            },
          });
          uploadedItems.push(result.item);
        } catch (error) {
          failed.push(`${file.name}: ${error.message}`);
        } finally {
          setApplicationYamlUploadState({ uploading: true, total: files.length, completed: index + 1 });
        }
      }

      await loadAdminApplicationYamls();

      if (uploadedItems.length) {
        setApplicationYamlForm(uploadedItems[uploadedItems.length - 1]);
      }

      if (uploadedItems.length && !failed.length) {
        setAdminStatus(
          uploadedItems.length === 1
            ? "Application YAML을 업로드했습니다."
            : `Application YAML ${uploadedItems.length}개를 업로드했습니다.`,
        );
      } else if (uploadedItems.length && failed.length) {
        setAdminStatus(`일부 업로드만 완료했습니다. 성공 ${uploadedItems.length}개, 실패 ${failed.length}개`);
      } else if (failed.length) {
        setAdminStatus(failed[0]);
      }
    } finally {
      setApplicationYamlUploadState({ uploading: false, total: files.length, completed: files.length });
    }
  }
  async function onApplicationYamlSave(event) {
    event.preventDefault();
    const name = String(applicationYamlForm.name || "").trim();
    const content = String(applicationYamlForm.content || "");
    if (!name) {
      setAdminStatus("Application YAML 파일명을 입력해 주세요.");
      return false;
    }
    if (!content.trim()) {
      setAdminStatus("Application YAML 내용을 입력해 주세요.");
      return false;
    }
    if (["clouds.yaml", "clouds.yml"].includes(name.toLowerCase())) {
      setAdminStatus("clouds.yaml은 OpenStack 인증 파일이라 Application YAML로 저장할 수 없습니다.");
      return false;
    }
    try {
      const existingItem = adminApplicationYamls.find((item) => String(item.name || "").trim() === name);
      const result = existingItem
        ? await api(`/api/admin/application-yamls/${encodeURIComponent(name)}`, {
            method: "PUT",
            body: {
              content,
              category: applicationYamlForm.category,
              description: applicationYamlForm.description,
            },
          })
        : await api("/api/admin/application-yamls", {
            method: "POST",
            body: {
              fileName: name,
              content,
              category: applicationYamlForm.category,
              description: applicationYamlForm.description,
            },
          });
      setAdminApplicationYamls((current) => upsertByKey(current, result.item, "name"));
      setAdminStatus(result.message || "Application YAML을 저장했습니다.");
      openAdminSaveDialog(result.message || "Application YAML을 저장했습니다.");
      setApplicationYamlForm(result.item);
      void loadAdminApplicationYamls();
      return true;
    } catch (error) {
      setAdminStatus(error.message);
      openAdminSaveDialog(error.message, "error");
      return false;
    }
  }
  async function onDeleteApplicationYaml(name) {
    if (!name) return;
    const previousItems = adminApplicationYamls;
    const previousForm = applicationYamlForm;
    try {
      setAdminApplicationYamls((current) => current.filter((item) => item.name !== name));
      setApplicationYamlForm((current) => (current.name === name ? EMPTY_APPLICATION_YAML : current));
      const result = await api(`/api/admin/application-yamls/${encodeURIComponent(name)}`, { method: "DELETE" });
      setAdminStatus(result.message || "Application YAML을 삭제했습니다.");
      void loadAdminApplicationYamls();
    } catch (error) {
      setAdminApplicationYamls(previousItems);
      setApplicationYamlForm(previousForm);
      void loadAdminApplicationYamls();
      setAdminStatus(error.message);
    }
  }
  async function onUploadCloudInitTemplate(file) {
    if (!file) return;
    const lowerName = String(file.name || "").toLowerCase();
    if (!lowerName.endsWith(".yaml") && !lowerName.endsWith(".yml")) {
      setAdminStatus("cloud-init YAML 파일만 업로드할 수 있습니다.");
      return;
    }
    try {
      const contentBase64 = await fileToBase64(file);
      const result = await api("/api/admin/cloud-init-templates", {
        method: "POST",
        body: {
          fileName: file.name,
          contentBase64,
          description: cloudInitTemplateForm.description,
        },
      });
      setAdminCloudInitTemplates((current) => upsertByKey(current, result.item, "name"));
      setAdminStatus(result.message || "cloud-init 템플릿을 업로드했습니다.");
      setCloudInitTemplateForm(result.item);
      void loadAdminCloudInitTemplates();
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onCloudInitTemplateSave(event) {
    event.preventDefault();
    const name = String(cloudInitTemplateForm.name || "").trim();
    const content = String(cloudInitTemplateForm.content || "");
    if (!name) {
      setAdminStatus("cloud-init 템플릿 파일명을 입력해 주세요.");
      return false;
    }
    if (!content.trim()) {
      setAdminStatus("cloud-init 템플릿 내용을 입력해 주세요.");
      return false;
    }
    try {
      const existingItem = adminCloudInitTemplates.find((item) => String(item.name || "").trim() === name);
      const result = existingItem
        ? await api(`/api/admin/cloud-init-templates/${encodeURIComponent(name)}`, {
            method: "PUT",
            body: {
              content,
              description: cloudInitTemplateForm.description,
            },
          })
        : await api("/api/admin/cloud-init-templates", {
            method: "POST",
            body: {
              fileName: name,
              content,
              description: cloudInitTemplateForm.description,
            },
          });
      setAdminCloudInitTemplates((current) => upsertByKey(current, result.item, "name"));
      setAdminStatus(result.message || "cloud-init 템플릿을 저장했습니다.");
      openAdminSaveDialog(result.message || "cloud-init 템플릿을 저장했습니다.");
      setCloudInitTemplateForm(result.item);
      void loadAdminCloudInitTemplates();
      return true;
    } catch (error) {
      setAdminStatus(error.message);
      openAdminSaveDialog(error.message, "error");
      return false;
    }
  }
  async function onDeleteCloudInitTemplate(name) {
    if (!name) return;
    const previousTemplates = adminCloudInitTemplates;
    const previousForm = cloudInitTemplateForm;
    try {
      setAdminCloudInitTemplates((current) => removeByKey(current, name, "name"));
      setCloudInitTemplateForm((current) => (current.name === name ? EMPTY_CLOUD_INIT_TEMPLATE : current));
      const result = await api(`/api/admin/cloud-init-templates/${encodeURIComponent(name)}`, { method: "DELETE" });
      setAdminStatus(result.message || "cloud-init 템플릿을 삭제했습니다.");
      void loadAdminCloudInitTemplates();
    } catch (error) {
      setAdminCloudInitTemplates(previousTemplates);
      setCloudInitTemplateForm(previousForm);
      void loadAdminCloudInitTemplates();
      setAdminStatus(error.message);
    }
  }
  async function onUploadMaterial(file, label = "") {
    if (!file) return;
    const lowerName = String(file.name || "").toLowerCase();
    if (!MATERIAL_UPLOAD_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
      setMaterialUploadStatus({ tone: "error", message: "PDF, PPT, DOC, MP4, WEBM 교안 파일만 업로드할 수 있습니다." });
      return;
    }
    const maxMaterialUploadMb = Math.max(1, Number(platformStatus?.materialsUploadMaxMb || 80) || 80);
    if (file.size > maxMaterialUploadMb * 1024 * 1024) {
      setMaterialUploadStatus({ tone: "error", message: `교안 파일이 너무 큽니다. ${maxMaterialUploadMb}MB 이하 파일로 다시 시도해 주세요.` });
      return;
    }

    try {
      const contentBase64 = await fileToBase64(file);
      const result = await api("/api/admin/materials", {
        method: "POST",
        body: {
          fileName: file.name,
          label: label || file.name.replace(/\.[^.]+$/i, ""),
          contentBase64,
        },
      });

      const line = `${result.material.label} | ${result.material.href}`;
      setCourseForm((current) => ({
        ...current,
        materialsText: current.materialsText ? `${current.materialsText}\n${line}` : line,
      }));
      setMaterialUploadStatus({ tone: "success", message: `${result.material.fileName} 업로드가 완료되었습니다.` });
      setAdminStatus(result.message);
    } catch (error) {
      setMaterialUploadStatus({ tone: "error", message: error.message });
      setAdminStatus(error.message);
    }
  }
  async function onUploadExampleFile(file, label = "") {
    if (!file) return;
    const lowerName = String(file.name || "").toLowerCase();
    const allowedExtensions = [".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".txt", ".md", ".sh", ".yaml", ".yml", ".json", ".py", ".js", ".ts", ".csv"];
    if (!allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
      setExampleUploadStatus({ tone: "error", message: "zip, tgz, txt, md, sh, yaml, json, py, js 같은 예제 파일만 업로드할 수 있습니다." });
      return;
    }
    const maxUploadMb = Math.max(1, Number(platformStatus?.materialsUploadMaxMb || 80) || 80);
    if (file.size > maxUploadMb * 1024 * 1024) {
      setExampleUploadStatus({ tone: "error", message: `예제 파일이 너무 큽니다. ${maxUploadMb}MB 이하 파일로 다시 시도해 주세요.` });
      return;
    }
    try {
      const contentBase64 = await fileToBase64(file);
      const result = await api("/api/admin/example-files", {
        method: "POST",
        body: {
          fileName: file.name,
          label: label || file.name,
          contentBase64,
        },
      });
      setCourseForm((current) => ({
        ...current,
        exampleFiles: [
          ...(Array.isArray(current.exampleFiles) ? current.exampleFiles : []),
          {
            label: String(result.exampleFile.label || result.exampleFile.fileName || "").trim(),
            href: String(result.exampleFile.href || "").trim(),
          },
        ]
          .filter((item) => item.label && item.href)
          .filter((item, index, items) => items.findIndex((candidate) => candidate.href === item.href) === index),
      }));
      setExampleUploadStatus({ tone: "success", message: `${result.exampleFile.fileName} 업로드가 완료되었습니다.` });
      setAdminStatus(result.message);
    } catch (error) {
      setExampleUploadStatus({ tone: "error", message: error.message });
      setAdminStatus(error.message);
    }
  }
  async function onUploadLandingMedia(file) {
    if (!file) return;
    const mimeType = String(file.type || "").toLowerCase();
    const lowerName = String(file.name || "").toLowerCase();
    if (!(mimeType === "video/webm" || mimeType === "video/mp4" || lowerName.endsWith(".webm") || lowerName.endsWith(".mp4"))) {
      setAdminStatus("webm(vp9) 또는 mp4 랜딩 영상만 업로드할 수 있습니다.");
      return;
    }

    try {
      setLandingMediaUploadState({ uploading: true, fileName: file.name });
      const formData = new FormData();
      formData.append("file", file, file.name);
      const result = await api("/api/admin/landing-media", {
        method: "POST",
        body: formData,
      });
      replacePlatformStatus(result.status, { markDirty: false });
      setAdminStatus(result.message || "랜딩 영상을 업로드했습니다.");
      pushToast(result.message || "랜딩 영상을 업로드했습니다.", "success");
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "랜딩 영상 업로드 중 오류가 발생했습니다.", "error");
    } finally {
      setLandingMediaUploadState({ uploading: false, fileName: "" });
    }
  }
  async function onUploadBrandAsset(file, assetType) {
    if (!file) return;
    const normalizedAssetType = assetType === "favicon" ? "favicon" : assetType === "customer-logo" ? "customer-logo" : "logo";
    const mimeType = String(file.type || "").toLowerCase();
    const lowerName = String(file.name || "").toLowerCase();
    const allowed = normalizedAssetType === "favicon"
      ? ["image/x-icon", "image/vnd.microsoft.icon", "image/png", "image/svg+xml"]
      : ["image/png", "image/svg+xml", "image/jpeg", "image/webp"];
    const allowedExtensions = normalizedAssetType === "favicon"
      ? [".ico", ".png", ".svg"]
      : [".png", ".svg", ".jpg", ".jpeg", ".webp"];
    if (!allowed.includes(mimeType) && !allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
      const message = normalizedAssetType === "favicon"
        ? "favicon은 ico, png, svg 파일만 업로드할 수 있습니다."
        : normalizedAssetType === "customer-logo"
          ? "고객 로고는 png, svg, jpg, webp 파일만 업로드할 수 있습니다."
        : "로고는 png, svg, jpg, webp 파일만 업로드할 수 있습니다.";
      setAdminStatus(message);
      pushToast(message, "error");
      return;
    }

    try {
      setLandingMediaUploadState({ uploading: true, fileName: file.name });
      const formData = new FormData();
      formData.append("file", file, file.name);
      formData.append("assetType", normalizedAssetType);
      const result = await api("/api/admin/landing-brand-media", {
        method: "POST",
        body: formData,
      });
      replacePlatformStatus(result.status, { markDirty: false });
      setAdminStatus(result.message || "브랜드 자산을 업로드했습니다.");
      pushToast(result.message || "브랜드 자산을 업로드했습니다.", "success");
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "브랜드 자산 업로드 중 오류가 발생했습니다.", "error");
    } finally {
      setLandingMediaUploadState({ uploading: false, fileName: "" });
    }
  }
  async function onExportBackup() {
    try {
      const response = await fetch("/api/admin/backups/export", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        let message = "백업 파일을 생성하지 못했습니다.";
        try {
          const payload = await response.json();
          message = payload?.message || message;
        } catch {
        }
        throw new Error(message);
      }
      const disposition = String(response.headers.get("content-disposition") || "");
      const matchedFileName = disposition.match(/filename="([^"]+)"/i);
      const fileName = matchedFileName?.[1] || `terminal-lab-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json.gz`;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      const fileSizeMb = blob.size ? (blob.size / 1024 / 1024).toFixed(1) : "0.0";
      setAdminStatus(`백업 파일을 생성해 다운로드했습니다. (${fileSizeMb}MB)`);
      pushToast(`백업 파일을 다운로드했습니다. (${fileSizeMb}MB)`, "success");
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "백업 파일 생성 중 오류가 발생했습니다.", "error");
    }
  }
  async function onImportBackup(file) {
    if (!file) {
      setAdminStatus("복원할 백업 파일을 선택해 주세요.");
      return;
    }
    if (typeof window !== "undefined" && !window.confirm("백업 복원은 현재 운영 데이터를 덮어쓸 수 있습니다. 계속할까요?")) {
      return;
    }
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/admin/backups/restore", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!response.ok) {
        let message = "백업 파일을 복원하지 못했습니다.";
        try {
          const payload = await response.json();
          message = payload?.message || message;
        } catch {
        }
        throw new Error(message);
      }
      const payload = await response.json().catch(() => ({}));
      const message = payload?.message || "백업 파일을 복원했습니다.";
      setAdminStatus(message);
      pushToast(message, "success");
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          window.location.reload();
        }, 400);
      }
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "백업 파일 복원 중 오류가 발생했습니다.", "error");
    }
  }
  async function onCreateAdminUser(event) {
    event?.preventDefault?.();
    const name = String(adminUserForm.name || "").trim();
    const email = String(adminUserForm.email || "").trim();
    const username = String(adminUserForm.username || "").trim();
    const password = String(adminUserForm.password || "");
    if (!name || !username || !password) {
      setAdminStatus("이름, 아이디, 비밀번호를 입력해 주세요.");
      return;
    }
    try {
      const result = await api("/api/admin/users", {
        method: "POST",
        body: {
          name,
          email,
          username,
          password,
          role: adminUserForm.role || "student",
          status: adminUserForm.status || "approved",
        },
      });
      setAdminUsers((current) => upsertByKey(current, result.user, "id"));
      setAdminUserForm(EMPTY_ADMIN_USER_FORM);
      setAdminStatus(result.message || "사용자를 생성했습니다.");
      pushToast(result.message || "사용자를 생성했습니다.", "success");
      void loadAdmin();
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "사용자 생성 중 오류가 발생했습니다.", "error");
    }
  }
  async function onCreateAdminBatchUsers(event) {
    event?.preventDefault?.();
    if (!String(adminBatchUserForm.usernamePrefix || "").trim() || !String(adminBatchUserForm.password || "")) {
      setAdminStatus("아이디 접두어와 초기 비밀번호를 입력해 주세요.");
      return;
    }
    try {
      const result = await api("/api/admin/users/batch-create", {
        method: "POST",
        body: {
          usernamePrefix: adminBatchUserForm.usernamePrefix,
          namePrefix: adminBatchUserForm.namePrefix,
          startNumber: Number(adminBatchUserForm.startNumber || 1),
          endNumber: Number(adminBatchUserForm.endNumber || 1),
          password: adminBatchUserForm.password,
          role: adminBatchUserForm.role,
          status: adminBatchUserForm.status,
        },
      });
      setAdminUsers((current) => {
        let next = [...current];
        for (const user of result.users || []) {
          next = upsertByKey(next, user, "id");
        }
        return next;
      });
      setAdminBatchUserForm(EMPTY_ADMIN_BATCH_USER_FORM);
      setAdminStatus(result.message || "임시 사용자를 생성했습니다.");
      pushToast(result.message || "임시 사용자를 생성했습니다.", "success");
      void loadAdmin();
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "임시 사용자 생성 중 오류가 발생했습니다.", "error");
    }
  }
  async function onAssignCoursesToUsers(options = {}) {
    const explicitUserIds = Array.isArray(options?.userIds)
      ? options.userIds.map((id) => Number(id)).filter(Boolean)
      : [];
    const courseId = Number(options?.courseId || adminCourseAssignForm.courseId || 0);
    const selectedUserIdSet = new Set((selectedUserIds || []).map((id) => Number(id)).filter(Boolean));
    const targetUserIds = explicitUserIds.length
      ? explicitUserIds
      : adminUsers
        .filter((user) => selectedUserIdSet.has(Number(user.id)))
        .map((user) => user.id);
    if (!targetUserIds.length || !courseId) {
      setAdminStatus("선택한 사용자와 과정을 확인해 주세요.");
      return;
    }
    try {
      const result = await api("/api/admin/course-access/assign", {
        method: "POST",
        body: {
          userIds: targetUserIds,
          courseId,
        },
      });
      setAdminStatus(result.message || "과정 권한을 할당했습니다.");
      pushToast(result.message || "과정 권한을 할당했습니다.", "success");
      setAdminCourseAssignForm({ courseId: "" });
      await runSafeRefreshTasks([loadAdminUsers(), loadCourses(), loadLabs()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "과정 할당 중 오류가 발생했습니다.", "error");
    }
  }
  async function onAdminRevokeUserCourseAccess(userId, course) {
    if (!userId || !course?.courseId) return;
    if (!window.confirm(`${course.title || "선택한 과정"} 수강을 취소할까요?`)) return;
    try {
      const result = await api(`/api/admin/users/${userId}/courses/${course.courseId}/revoke-access`, { method: "POST" });
      setAdminStatus(result.message || "사용자 수강 과정을 취소했습니다.");
      pushToast(result.message || "사용자 수강 과정을 취소했습니다.", "success");
      await runSafeRefreshTasks([loadAdmin(), loadCourses(), loadLabs()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "사용자 수강 취소 중 오류가 발생했습니다.", "error");
    }
  }
  async function onAdminForceRevokeUserCourseAccess(user) {
    const enrolledCourses = Array.isArray(user?.enrolledCourses) ? user.enrolledCourses : [];
    if (!user?.id || !enrolledCourses.length) {
      setAdminStatus("현재 취소할 수강 과정이 없습니다.");
      pushToast("현재 취소할 수강 과정이 없습니다.", "error");
      return;
    }
    let selectedCourse = enrolledCourses[0];
    if (enrolledCourses.length > 1) {
      const courseChoices = enrolledCourses.map((course, index) => `${index + 1}. ${course.title || `과정 #${course.courseId}`}`).join("\n");
      const selectedIndexText = window.prompt(`취소할 과정을 선택해 주세요.\n${courseChoices}`, "1");
      if (selectedIndexText == null) return;
      const selectedIndex = Number(selectedIndexText);
      if (!Number.isInteger(selectedIndex) || selectedIndex < 1 || selectedIndex > enrolledCourses.length) {
        setAdminStatus("올바른 과정 번호를 입력해 주세요.");
        pushToast("올바른 과정 번호를 입력해 주세요.", "error");
        return;
      }
      selectedCourse = enrolledCourses[selectedIndex - 1];
    }
    await onAdminRevokeUserCourseAccess(user.id, selectedCourse);
  }
  async function onApproveLab(labId) {
    try {
      await api(`/api/admin/labs/${labId}/approve`, { method: "POST" });
      setAdminStatus("랩을 생성 대기 상태로 승인했습니다.");
      await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onBulkApproveLabs() {
    if (!selectedLabIds.length) return setAdminStatus("승인할 랩 요청을 선택해 주세요.");
    try {
      const result = await api("/api/admin/labs/bulk-approve", { method: "POST", body: { labIds: selectedLabIds } });
      setSelectedLabIds([]);
      setAdminStatus(result.message);
      await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onPrecreateCourseLabs(courseId, options = {}) {
    const selectedCourseId = Number(courseId || 0);
    const course = (adminCourses || []).find((item) => Number(item.id) === selectedCourseId);
    if (!selectedCourseId || !course) {
      setAdminStatus("랩을 사전 생성할 과정을 선택해 주세요.");
      pushToast("랩을 사전 생성할 과정을 선택해 주세요.", "error");
      return null;
    }
    const selectedOnly = Boolean(options.selectedOnly);
    const explicitSelectedIds = Array.isArray(options.selectedUserIds)
      ? options.selectedUserIds.map((id) => Number(id)).filter(Boolean)
      : [];
    const selectedIds = selectedOnly
      ? (explicitSelectedIds.length ? explicitSelectedIds : (selectedUserIds || []).map((id) => Number(id)).filter(Boolean))
      : [];
    if (selectedOnly && !selectedIds.length) {
      setAdminStatus("선택 사용자 대상으로 생성하려면 랩 요청 화면에서 사용자를 선택해 주세요.");
      pushToast("선택된 사용자가 없습니다.", "error");
      return null;
    }
    const actionLabel = options.startNow === false ? "생성 대기 랩 요청을 만들까요?" : "랩 자원 생성을 바로 시작할까요?";
    const targetLabel = selectedOnly ? `선택 사용자 ${selectedIds.length}명` : "해당 과정 수강생 전체";
    const bootFromVolume = options.startNow !== false && Boolean(options.bootFromVolume);
    const bootVolumeSizeGb = Math.max(1, Math.min(2048, Number.parseInt(options.bootVolumeSizeGb, 10) || Number(platformStatus?.labAutoBootVolumeSizeGb || 20) || 20));
    const bootVolumeType = String(options.bootVolumeType || platformStatus?.labAutoBootVolumeType || "").trim();
    const bootVolumeLabel = bootFromVolume ? `\nOS 디스크: Cinder volume ${bootVolumeSizeGb}GB${bootVolumeType ? ` / ${bootVolumeType}` : ""}` : "";
    if (!window.confirm(`${course.title || "선택한 과정"} / ${targetLabel}\n${actionLabel}${bootVolumeLabel}`)) return null;
    try {
      const result = await api("/api/admin/labs/bulk-precreate", {
        method: "POST",
        body: {
          courseId: selectedCourseId,
          userIds: selectedOnly ? selectedIds : [],
          target: selectedOnly ? "selected" : "enrolled",
          startNow: options.startNow !== false,
          bootFromVolume,
          bootVolumeSizeGb,
          bootVolumeType,
        },
      });
      const message = result.message || `랩 사전 생성 완료: 생성 ${result.created || 0}건 / 시작 ${result.started || 0}건 / 건너뜀 ${result.skipped || 0}건`;
      setAdminLabPrecreateReport({
        ...result,
        courseTitle: course.title || "",
        targetLabel,
        createdAt: new Date().toISOString(),
      });
      setAdminStatus(message);
      pushToast(message, Number(result.failed || 0) ? "error" : "success");
      await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
      return result;
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "랩 사전 생성 중 오류가 발생했습니다.", "error");
      return null;
    }
  }
  async function onArchiveOldLabRequests() {
    if (!window.confirm("종료/실패된 오래된 랩 요청 기록을 활성 목록에서 아카이브로 옮길까요?")) return null;
    try {
      const result = await api("/api/admin/labs/archive-old", {
        method: "POST",
        body: {},
      });
      const message = result.message || `오래된 랩 요청 ${result.archivedCount || 0}건을 보관했습니다.`;
      setAdminStatus(message);
      pushToast(message, "success");
      await loadAdminLabs();
      return result;
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "오래된 랩 요청 보관 중 오류가 발생했습니다.", "error");
      return null;
    }
  }
  async function onBulkPowerCourseLabs(courseId, action) {
    const selectedCourseId = Number(courseId || 0);
    const course = (adminCourses || []).find((item) => Number(item.id) === selectedCourseId);
    const normalizedAction = String(action || "").toLowerCase() === "resume" ? "resume" : "pause";
    if (!selectedCourseId || !course) {
      setAdminStatus("임시 중지/재개할 과정을 선택해 주세요.");
      pushToast("임시 중지/재개할 과정을 선택해 주세요.", "error");
      return null;
    }
    const actionLabel = normalizedAction === "resume" ? "중지된 랩을 다시 시작할까요?" : "실행 중인 랩을 임시 중지할까요?";
    const detailLabel = normalizedAction === "resume"
      ? "기존 VM/컨테이너를 다시 시작합니다. 삭제된 랩은 복구 대상이 아닙니다."
      : "VM/컨테이너는 삭제하지 않고 stop 상태로 전환합니다. 공개 포트와 외부 접속 설정은 정리됩니다.";
    if (!window.confirm(`${course.title || "선택한 과정"}\n${actionLabel}\n${detailLabel}`)) return null;
    try {
      const result = await api("/api/admin/labs/bulk-power-course", {
        method: "POST",
        body: { courseId: selectedCourseId, action: normalizedAction },
      });
      const message = result.message || (normalizedAction === "resume" ? "과정 랩을 다시 시작했습니다." : "과정 랩을 임시 중지했습니다.");
      setAdminStatus(message);
      pushToast(message, Number(result.failed || 0) ? "error" : "success");
      await runSafeRefreshTasks([loadAdmin(), loadLabs(), loadLabExams()]);
      return result;
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "과정 랩 임시 중지/재개 중 오류가 발생했습니다.", "error");
      return null;
    }
  }
  async function onRunCourseCinderBootSmoke(options = {}) {
    const bootVolumeSizeGb = Math.max(1, Math.min(2048, Number.parseInt(options.bootVolumeSizeGb, 10) || Number(platformStatus?.labAutoBootVolumeSizeGb || 20) || 20));
    const bootVolumeType = String(options.bootVolumeType || platformStatus?.labAutoBootVolumeType || "").trim();
    const bootVolumeLabel = `Cinder volume ${bootVolumeSizeGb}GB${bootVolumeType ? ` / ${bootVolumeType}` : ""}`;
    if (!window.confirm(`등록된 Heat 기반 과정마다 ${bootVolumeLabel} Stack 생성 요청 후 삭제 스모크를 실행할까요?`)) return null;
    try {
      setAdminStatus("전체 과정 Cinder volume 부팅 스모크를 실행하고 있습니다.");
      const result = await api("/api/admin/labs/cinder-boot-smoke", {
        method: "POST",
        body: {
          bootVolumeSizeGb,
          bootVolumeType,
        },
      });
      setAdminCourseCinderSmokeReport({
        ...result,
        createdAt: new Date().toISOString(),
      });
      const message = result.message || "Cinder volume 부팅 스모크를 완료했습니다.";
      setAdminStatus(message);
      pushToast(message, Number(result.failed || 0) ? "error" : "success");
      return result;
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "Cinder volume 부팅 스모크 중 오류가 발생했습니다.", "error");
      return null;
    }
  }
  async function onDeleteLabRecords() {
    if (!selectedLabIds.length) return setAdminStatus("삭제할 기록을 선택해 주세요.");
    try {
      const result = await api("/api/admin/labs/delete-records", { method: "POST", body: { labIds: selectedLabIds } });
      setSelectedLabIds([]);
      setAdminStatus(result.message);
      await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onTerminateLab(labId, options = {}) {
    if (!options.skipConfirm && !window.confirm("이 작업은 랩과 연결된 가상머신을 종료하고 삭제할 수 있습니다. 계속할까요?")) return;
    try {
      await api(`/api/admin/labs/${labId}/terminate`, { method: "POST" });
      setAdminStatus("랩과 연결된 자원을 삭제했습니다.");
      await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onTerminateCourseLabs(courseId) {
    const selectedCourseId = Number(courseId || 0);
    const course = (adminCourses || []).find((item) => Number(item.id) === selectedCourseId);
    if (!selectedCourseId || !course) {
      setAdminStatus("일괄 종료할 과정을 선택해 주세요.");
      return;
    }
    const courseLabs = (adminLabs || []).filter((lab) => {
      const status = String(lab.status || "").toLowerCase();
      return Number(lab.courseId) === selectedCourseId && !["terminated", "deleted", "cleanup_done"].includes(status);
    });
    if (!courseLabs.length) {
      setAdminStatus("해당 과정에서 종료할 랩이 없습니다.");
      return;
    }
    const confirmed = window.confirm(`${course.title || "선택한 과정"}의 랩 ${courseLabs.length}건을 종료하고 연결 자원을 정리할까요?`);
    if (!confirmed) return;
    try {
      const result = await api("/api/admin/labs/bulk-terminate-course", {
        method: "POST",
        body: { courseId: selectedCourseId },
      });
      setSelectedLabIds([]);
      const failedText = Number(result.failed || 0) > 0 ? ` 실패 ${result.failed}건은 로그를 확인해 주세요.` : "";
      const message = result.message ? `${result.message}${failedText}` : `과정 랩 ${result.terminated || 0}건을 종료했습니다.${failedText}`;
      setAdminStatus(message);
      pushToast(message, Number(result.failed || 0) > 0 ? "error" : "success");
      await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "과정 랩 일괄 종료 중 오류가 발생했습니다.", "error");
    }
  }
  async function onResizeLab(labId, flavor) {
    const nextFlavor = String(flavor || "").trim();
    if (!nextFlavor) {
      setAdminStatus("변경할 Flavor를 선택해 주세요.");
      return;
    }
    if (!window.confirm(`랩 Flavor를 ${nextFlavor}(으)로 변경할까요? 리사이즈 중에는 잠시 접속이 불안정할 수 있습니다.`)) return;
    try {
      const result = await api(`/api/admin/labs/${labId}/resize`, {
        method: "POST",
        body: { flavor: nextFlavor },
      });
      setLabResizeFlavorDrafts((current) => ({ ...current, [labId]: nextFlavor }));
      setAdminStatus(result.message || "랩 Flavor를 변경했습니다.");
      pushToast(result.message || "랩 Flavor를 변경했습니다.", "success");
      await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "랩 Flavor 변경 중 오류가 발생했습니다.", "error");
    }
  }
  async function onRequestLabResize(flavor) {
    const nextFlavor = String(flavor || "").trim();
    if (!activeLab) return;
    if (!nextFlavor) {
      setTerminalRequest({ tone: "error", message: "변경할 Flavor를 선택해 주세요." });
      return;
    }
    try {
      const result = await api(`/api/labs/${activeLab.id}/resize-request`, {
        method: "POST",
        body: { flavor: nextFlavor },
      });
      setLabs((current) => current.map((lab) => (lab.id === activeLab.id ? result.lab : lab)));
      setTerminalRequest({ tone: "success", message: result.message || "랩 사양 변경 요청이 접수되었습니다." });
      pushToast(result.message || "랩 사양 변경 요청이 접수되었습니다.", "success");
      await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message });
      pushToast(error.message || "랩 사양 변경 요청 중 오류가 발생했습니다.", "error");
    }
  }
  async function onCancelLabResizeRequest() {
    if (!activeLab) return;
    try {
      const result = await api(`/api/labs/${activeLab.id}/resize-request`, { method: "DELETE" });
      setLabs((current) => current.map((lab) => (lab.id === activeLab.id ? result.lab : lab)));
      setTerminalRequest({ tone: "success", message: result.message || "랩 사양 변경 요청을 취소했습니다." });
      pushToast(result.message || "랩 사양 변경 요청을 취소했습니다.", "success");
      await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
    } catch (error) {
      setTerminalRequest({ tone: "error", message: error.message });
      pushToast(error.message || "랩 사양 변경 요청 취소 중 오류가 발생했습니다.", "error");
    }
  }
  async function onApproveLabResize(labId, reviewNote = "") {
    try {
      const result = await api(`/api/admin/labs/${labId}/approve-resize`, {
        method: "POST",
        body: { reviewNote },
      });
      setAdminStatus(result.message || "랩 사양 변경 요청을 승인했습니다.");
      pushToast(result.message || "랩 사양 변경 요청을 승인했습니다.", "success");
      await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "랩 사양 변경 승인 중 오류가 발생했습니다.", "error");
    }
  }
  async function onRejectLabResize(labId, reviewNote = "") {
    try {
      const result = await api(`/api/admin/labs/${labId}/reject-resize`, {
        method: "POST",
        body: { reviewNote },
      });
      setAdminStatus(result.message || "랩 사양 변경 요청을 반려했습니다.");
      pushToast(result.message || "랩 사양 변경 요청을 반려했습니다.", "success");
      await runSafeRefreshTasks([loadAdmin(), loadLabs()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "랩 사양 변경 반려 중 오류가 발생했습니다.", "error");
    }
  }
  async function onApproveCourseAccessRequest(requestId) {
    try {
      const result = await api(`/api/admin/course-access-requests/${requestId}/approve`, { method: "POST" });
      setAdminStatus(result.message);
      setCourseAccessReviewNotes((current) => {
        if (!(requestId in current)) return current;
        const next = { ...current };
        delete next[requestId];
        return next;
      });
      pushToast(result.message || "과정 요청을 승인했습니다.", "success");
      await runSafeRefreshTasks([loadAdmin(), loadCourses()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "과정 요청 승인 중 오류가 발생했습니다.", "error");
    }
  }
  async function onRejectCourseAccessRequest(requestId, reviewNote = "") {
    try {
      const result = await api(`/api/admin/course-access-requests/${requestId}/reject`, {
        method: "POST",
        body: { reviewNote },
      });
      setAdminStatus(result.message);
      setCourseAccessReviewNotes((current) => {
        if (!(requestId in current)) return current;
        const next = { ...current };
        delete next[requestId];
        return next;
      });
      pushToast(result.message || "과정 요청을 거절했습니다.", "success");
      await runSafeRefreshTasks([loadAdmin(), loadCourses()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "과정 요청 거절 중 오류가 발생했습니다.", "error");
    }
  }
  async function onCreateConsultingRequest(event) {
    event.preventDefault();
    if (!consultingForm.title.trim() || !consultingForm.contactName.trim() || !consultingForm.contactEmail.trim() || !consultingForm.requirements.trim()) {
      const message = "문의 제목, 담당자명, 연락 이메일, 주요 요구사항을 입력해 주세요.";
      setAuthStatus({ tone: "error", message });
      pushToast(message, "error");
      return;
    }
    try {
      const result = await api("/api/consulting-requests", {
        method: "POST",
        body: {
          title: consultingForm.title,
          companyName: consultingForm.companyName,
          contactName: consultingForm.contactName,
          contactEmail: consultingForm.contactEmail,
          contactPhone: consultingForm.contactPhone,
          inquiryType: consultingForm.inquiryType,
          industry: consultingForm.industry,
          currentEnvironment: consultingForm.currentEnvironment,
          requirements: consultingForm.requirements,
          budgetRange: consultingForm.budgetRange,
          desiredTimeline: consultingForm.desiredTimeline,
          note: consultingForm.note,
        },
      });
      setConsultingForm(EMPTY_CONSULTING_REQUEST);
      setAuthStatus({ tone: "success", message: result.message || "상담 문의를 등록했습니다." });
      pushToast(result.message || "상담 문의를 등록했습니다.", "success");
      await runSafeRefreshTasks([loadConsultingRequests(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "상담 문의 등록 중 오류가 발생했습니다.", "error");
    }
  }
  async function onReviewConsultingRequest(requestId) {
    const draft = consultingReviewDrafts[requestId] || {};
    try {
      const result = await api(`/api/admin/consulting-requests/${requestId}/review`, {
        method: "POST",
        body: {
          status: draft.status || "reviewing",
          adminNote: draft.adminNote || "",
          mailSubject: draft.mailSubject || "",
        },
      });
      setAdminStatus(result.message || "상담 문의 상태를 저장했습니다.");
      setConsultingReviewDrafts((current) => {
        const next = { ...current };
        delete next[requestId];
        return next;
      });
      await runSafeRefreshTasks([loadAdmin(), loadConsultingRequests()]);
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onReviewPublicQuoteInquiry(inquiryId) {
    const draft = consultingReviewDrafts[`public:${inquiryId}`] || {};
    try {
      const result = await api(`/api/admin/public-quote-inquiries/${inquiryId}/review`, {
        method: "POST",
        body: {
          status: draft.status || "reviewing",
          adminNote: draft.adminNote || "",
        },
      });
      setAdminStatus(result.message || "공개 견적 문의 상태를 저장했습니다.");
      setConsultingReviewDrafts((current) => {
        const next = { ...current };
        delete next[`public:${inquiryId}`];
        return next;
      });
      await loadAdmin();
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onCreateCustomLabRequest(event) {
    event.preventDefault();
    if (!customLabForm.title.trim()) {
      const message = "구성 이름을 입력해 주세요.";
      setAuthStatus({ tone: "error", message });
      pushToast(message, "error");
      return;
    }
    const requestedTerminalSshUser = String(customLabForm.terminalSshUser || "").trim();
    const requestedTerminalSshPassword = String(customLabForm.terminalSshPassword || "");
    if ((requestedTerminalSshUser || requestedTerminalSshPassword) && (!requestedTerminalSshUser || !requestedTerminalSshPassword)) {
      const message = "고급 랩 접속 계정을 직접 지정하려면 아이디와 비밀번호를 모두 입력해 주세요.";
      setAuthStatus({ tone: "error", message });
      pushToast(message, "error");
      return;
    }
    if (requestedTerminalSshPassword && (requestedTerminalSshPassword.length < 8 || requestedTerminalSshPassword.length > 128)) {
      const message = `고급 랩 접속 비밀번호는 8자 이상 128자 이하로 입력해 주세요. 현재 ${requestedTerminalSshPassword.length}자입니다.`;
      setAuthStatus({ tone: "error", message });
      pushToast(message, "error");
      return;
    }
    const customLabAdvancedConfig = customLabForm.advancedConfig || {};
    const customLabAdvancedRootEnabled = Boolean(customLabAdvancedConfig.enabled);
    const customLabNetworkEnabled = Boolean(customLabAdvancedConfig.network?.enabled);
    const customLabAdvancedEnabled = Boolean(
      customLabAdvancedRootEnabled
      || customLabNetworkEnabled
      || customLabAdvancedConfig.cloudInit?.mode === "custom",
    );
    if (customLabAdvancedRootEnabled && customLabAdvancedConfig.volumes?.enabled) {
      if (Number(customLabForm.advancedConfig?.volumes?.count || 0) < 1 || Number(customLabForm.advancedConfig?.volumes?.sizeGb || 0) < 1) {
        const message = "추가 볼륨을 사용하려면 개수와 크기를 1 이상으로 입력해 주세요.";
        setAuthStatus({ tone: "error", message });
        pushToast(message, "error");
        return;
      }
    }
    if (customLabNetworkEnabled) {
      if (!String(customLabAdvancedConfig.network?.networkName || "").trim() || !String(customLabAdvancedConfig.network?.subnetCidr || "").trim()) {
        const message = "네트워크 생성을 요청하려면 네트워크 이름과 서브넷 CIDR을 입력해 주세요.";
        setAuthStatus({ tone: "error", message });
        pushToast(message, "error");
        return;
      }
    }
    if (customLabAdvancedRootEnabled && customLabAdvancedConfig.loadBalancer?.enabled) {
      if (!customLabNetworkEnabled) {
        const message = "로드밸런서를 사용하려면 전용 네트워크도 함께 활성화해 주세요.";
        setAuthStatus({ tone: "error", message });
        pushToast(message, "error");
        return;
      }
      if (Number(customLabForm.advancedConfig?.loadBalancer?.listenerPort || 0) < 1 || Number(customLabForm.advancedConfig?.loadBalancer?.targetPort || 0) < 1) {
        const message = "로드밸런서를 사용하려면 리스너 포트와 대상 포트를 입력해 주세요.";
        setAuthStatus({ tone: "error", message });
        pushToast(message, "error");
        return;
      }
    }
    if (customLabAdvancedRootEnabled && customLabAdvancedConfig.database?.enabled) {
      if (
        !String(customLabForm.advancedConfig?.database?.engine || "").trim()
        || !String(customLabForm.advancedConfig?.database?.version || "").trim()
        || !String(customLabForm.advancedConfig?.database?.flavorName || "").trim()
        || Number(customLabForm.advancedConfig?.database?.sizeGb || 0) < 1
      ) {
        const message = "데이터베이스를 사용하려면 엔진, 버전, 용량, flavor를 입력해 주세요.";
        setAuthStatus({ tone: "error", message });
        pushToast(message, "error");
        return;
      }
    }
    try {
      const hasPocFreeAccess = Boolean(platformStatus?.pocFreeModeEnabled) || Boolean(session?.pocFreeAccessEnabled);
      const shouldUsePrepaidCustomLabFlow = hasPocFreeAccess || Boolean(platformStatus?.paymentGatewayEnabled);
      const result = await api(shouldUsePrepaidCustomLabFlow ? "/api/custom-lab-requests/prepaid" : "/api/custom-lab-requests", {
        method: "POST",
        body: {
          title: customLabForm.title,
          instanceCount: Number(customLabForm.instanceCount || 1),
          flavor: customLabForm.flavor || platformStatus?.pocAllowedFlavors?.[0] || platformStatus?.selfServiceVmAllowedFlavors?.[0] || "m1.small",
          vcpu: Number(customLabForm.vcpu || 0),
          ramGb: Number(customLabForm.ramGb || 0),
          diskGb: Number(customLabForm.diskGb || 0),
          imageName: customLabForm.imageName || platformStatus?.pocAllowedImages?.[0] || "lab-rocky-9-2026",
          usageDays: Number(customLabForm.usageDays || 1),
          usagePeriod: customLabForm.usagePeriod || `${Math.max(1, Number(customLabForm.usageDays || 1))}일`,
          desiredBudget: Math.max(0, Number(customLabForm.desiredBudget || 0)),
          terminalSshUser: requestedTerminalSshUser,
          terminalSshPassword: requestedTerminalSshPassword,
          note: customLabForm.note,
          advancedConfig: {
            enabled: customLabAdvancedEnabled,
            standard: {
              flavor: customLabForm.flavor || platformStatus?.pocAllowedFlavors?.[0] || platformStatus?.selfServiceVmAllowedFlavors?.[0] || "m1.small",
              usageDays: Number(customLabForm.usageDays || 1),
            },
            cloudInit: {
              mode: customLabForm.advancedConfig?.cloudInit?.mode === "custom" ? "custom" : "none",
              content: customLabForm.advancedConfig?.cloudInit?.content || "",
              fileName: customLabForm.advancedConfig?.cloudInit?.fileName || "",
            },
            publicIp: {
              enabled: Boolean(customLabAdvancedRootEnabled && customLabForm.advancedConfig?.publicIp?.enabled),
              externalNetworkName: customLabForm.advancedConfig?.publicIp?.externalNetworkName || customLabForm.advancedConfig?.network?.externalNetworkName || "",
            },
            volumes: {
              enabled: Boolean(customLabAdvancedRootEnabled && customLabForm.advancedConfig?.volumes?.enabled),
              count: Number(customLabForm.advancedConfig?.volumes?.count || 0),
              sizeGb: Number(customLabForm.advancedConfig?.volumes?.sizeGb || 0),
              volumeType: customLabForm.advancedConfig?.volumes?.volumeType || "",
            },
            network: {
              enabled: customLabNetworkEnabled,
              networkName: customLabForm.advancedConfig?.network?.networkName || "",
              subnetCidr: customLabForm.advancedConfig?.network?.subnetCidr || "",
              attachRouter: Boolean(customLabForm.advancedConfig?.network?.attachRouter),
              externalNetworkName: customLabForm.advancedConfig?.network?.externalNetworkName || "",
            },
            loadBalancer: {
              enabled: Boolean(customLabAdvancedRootEnabled && customLabForm.advancedConfig?.loadBalancer?.enabled),
              protocol: customLabForm.advancedConfig?.loadBalancer?.protocol || "TCP",
              listenerPort: Number(customLabForm.advancedConfig?.loadBalancer?.listenerPort || 0),
              targetPort: Number(customLabForm.advancedConfig?.loadBalancer?.targetPort || 0),
            },
            database: {
              enabled: Boolean(customLabAdvancedRootEnabled && customLabForm.advancedConfig?.database?.enabled),
              engine: customLabForm.advancedConfig?.database?.engine || "",
              version: customLabForm.advancedConfig?.database?.version || "",
              sizeGb: Number(customLabForm.advancedConfig?.database?.sizeGb || 0),
              flavorName: customLabForm.advancedConfig?.database?.flavorName || "",
              name: customLabForm.advancedConfig?.database?.name || "",
            },
          },
          cloudInitTemplateName: customLabForm.cloudInitTemplateName,
        },
      });
      setCustomLabForm(EMPTY_CUSTOM_LAB);
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || (shouldUsePrepaidCustomLabFlow ? "고급 랩 견적을 생성했습니다." : "고급 랩 관리자 견적 요청을 등록했습니다."), "success");
      await runSafeRefreshTasks([loadCustomLabRequests(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "고급 랩 구성 중 오류가 발생했습니다.", "error");
    }
  }
  async function onReviewCustomLabRequest(requestId, status) {
    const draft = customLabReviewDrafts[requestId] || {};
    try {
      const result = await api(`/api/admin/custom-lab-requests/${requestId}/review`, {
        method: "POST",
        body: {
            status,
            quotedPrice: draft.quotedPrice || "",
            reviewNote: draft.reviewNote || "",
            cloudInitTemplateName: draft.cloudInitTemplateName || "",
            heatTemplateName: draft.heatTemplateName || "",
            applicationYamlName: draft.applicationYamlName || "",
          },
        });
        setCustomLabReviewDrafts((current) => ({ ...current, [requestId]: { quotedPrice: "", reviewNote: "", cloudInitTemplateName: "", heatTemplateName: "", applicationYamlName: "" } }));
      setAdminStatus(result.message);
      await runSafeRefreshTasks([loadAdmin(), loadCustomLabRequests()]);
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onConfirmCustomLabRequest(requestId) {
    try {
      const result = await api(`/api/custom-lab-requests/${requestId}/confirm`, { method: "POST" });
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "고급 랩 진행을 확정했습니다.", "success");
      await runSafeRefreshTasks([loadCustomLabRequests(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "고급 랩 확정 중 오류가 발생했습니다.", "error");
    }
  }
  async function onCreateCustomLabKeypair(requestId) {
    if (!window.confirm("SSH private key는 지금 한 번만 다운로드됩니다. 계속할까요?")) return;
    try {
      const result = await api(`/api/custom-lab-requests/${requestId}/keypair`, { method: "POST" });
      const keypair = result.keypair || {};
      if (keypair.privateKey) {
        downloadTextFile(keypair.fileName || `${keypair.name || `poc-${requestId}-key`}.pem`, keypair.privateKey);
      }
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "SSH keypair를 생성했습니다.", "success");
      await runSafeRefreshTasks([loadCustomLabRequests(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "SSH keypair 생성 중 오류가 발생했습니다.", "error");
    }
  }
  async function onPrepareCustomLabPayment(requestId) {
    try {
      const result = await api(`/api/custom-lab-requests/${requestId}/payment/prepare`, { method: "POST" });
      const checkout = result.payment || {};
        const provider = normalizePaymentGatewayProvider(checkout.provider || "");
      if (provider === "tosspayments") {
        const clientKey = String(checkout.publicKey || "").trim();
        if (!clientKey) {
          throw new Error("토스 결제 클라이언트 키가 설정되지 않았습니다.");
        }
        const TossPayments = await ensureTossPaymentsSdk();
        const tossPayments = TossPayments(clientKey);
        const payment = tossPayments.payment({ customerKey: `terminal-lab-user-${session?.id || "guest"}-poc` });
        const origin = window.location.origin;
        const baseSuccess = `${origin}/?customLabPaymentStatus=success&customLabRequestId=${requestId}`;
        const baseFail = `${origin}/?customLabPaymentStatus=fail&customLabRequestId=${requestId}`;
        await payment.requestPayment({
          method: "CARD",
          amount: {
            currency: checkout.currency || "KRW",
            value: Number(checkout.amount || 0),
          },
          orderId: checkout.orderId,
          orderName: checkout.orderName || "Terminal Lab 고급 랩 결제",
          successUrl: baseSuccess,
          failUrl: baseFail,
          customerEmail: session?.email || undefined,
          customerName: session?.name || session?.username || undefined,
        });
        return;
      }
        throw new Error(`현재 PG 제공사(${provider || "미설정"})는 고급 랩 웹 결제창을 지원하지 않습니다.`);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "고급 랩 결제 준비 중 오류가 발생했습니다.", "error");
    }
  }
  async function onCancelCustomLabRequest(requestId) {
    try {
      const result = await api(`/api/custom-lab-requests/${requestId}/cancel`, { method: "POST" });
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "고급 랩 요청을 취소했습니다.", "success");
      await runSafeRefreshTasks([loadCustomLabRequests(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "고급 랩 구성 취소 중 오류가 발생했습니다.", "error");
    }
  }
  async function onTerminateCustomLabRequest(requestId) {
    if (!window.confirm("이 작업은 고급 랩과 연결된 자원을 삭제할 수 있습니다. 계속할까요?")) return;
    try {
      const result = await api(`/api/custom-lab-requests/${requestId}/terminate`, { method: "POST" });
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "고급 랩과 연결된 자원을 삭제했습니다.", "success");
      await runSafeRefreshTasks([loadCustomLabRequests(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "고급 랩 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onDeleteCustomLabRequest(requestId) {
    if (!window.confirm("이 고급 랩 기록을 목록에서 삭제할까요? 실행 중인 자원은 먼저 삭제해야 합니다.")) return;
    try {
      const result = await api(`/api/custom-lab-requests/${requestId}`, { method: "DELETE" });
      setCustomLabRequests((current) => current.filter((request) => Number(request.id) !== Number(requestId)));
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "고급 랩 기록을 삭제했습니다.", "success");
      await runSafeRefreshTasks([loadCustomLabRequests(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "고급 랩 기록 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onTerminateAdminCustomLabRequest(requestId) {
    if (!window.confirm("이 작업은 고급 랩과 연결된 자원을 삭제할 수 있습니다. 계속할까요?")) return;
    try {
      const result = await api(`/api/admin/custom-lab-requests/${requestId}/terminate`, { method: "POST" });
      setAdminStatus(result.message);
      await runSafeRefreshTasks([loadAdmin(), loadCustomLabRequests()]);
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onDeleteAdminCustomLabQuote(requestId) {
    if (!window.confirm("사용자 결제가 제출되지 않은 고급 랩 견적서를 삭제할까요?")) return;
    try {
      const result = await api(`/api/admin/custom-lab-requests/${requestId}`, { method: "DELETE" });
      setAdminCustomLabRequests((current) => current.filter((request) => Number(request.id) !== Number(requestId)));
      setCustomLabRequests((current) => current.filter((request) => Number(request.id) !== Number(requestId)));
      setAdminStatus(result.message || "고급 랩 견적서를 삭제했습니다.");
      pushToast(result.message || "고급 랩 견적서를 삭제했습니다.", "success");
      await runSafeRefreshTasks([loadAdmin(), loadCustomLabRequests()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "고급 랩 견적서 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onCreateInvite(event) {
    event.preventDefault();
    if (!inviteForm.code.trim()) return setAdminStatus("초대장 코드를 입력해 주세요.");
    try {
      const result = await api("/api/admin/invites", {
        method: "POST",
        body: {
          code: inviteForm.code,
          label: inviteForm.label,
          recipientEmail: inviteForm.recipientEmail,
          maxUses: Number(inviteForm.maxUses || 1),
          expiresAt: inviteForm.expiresAt || null,
          courseId: inviteForm.courseId ? Number(inviteForm.courseId) : null,
        },
      });
      setAdminInvites((current) => upsertByKey(current, result.invite, "id"));
      setInviteForm({ code: "", label: "", recipientEmail: "", maxUses: "1", expiresAt: "", courseId: "" });
      setAdminStatus("초대장 코드를 등록했습니다.");
      void loadAdminInvites();
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  function onGenerateInviteCode() {
    const code = `INV-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    setInviteForm((current) => ({ ...current, code }));
    pushToast("초대장 코드 초안을 생성했습니다.", "success");
  }
  async function onToggleInvite(inviteId, enabled) {
    try {
      const result = await api(`/api/admin/invites/${inviteId}`, { method: "PATCH", body: { enabled } });
      setAdminInvites((current) => upsertByKey(current, result.invite, "id"));
      void loadAdminInvites();
      setAdminStatus(enabled ? "초대장 코드를 활성화했습니다." : "초대장 코드를 비활성화했습니다.");
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onDeleteInvite(inviteId) {
    try {
      setAdminInvites((current) => removeByKey(current, inviteId, "id"));
      await api(`/api/admin/invites/${inviteId}`, { method: "DELETE" });
      void loadAdminInvites();
      setAdminStatus("초대장 코드를 삭제했습니다.");
    } catch (error) {
      void loadAdminInvites();
      setAdminStatus(error.message);
    }
  }
  async function onRequestSelfServiceVmAccess(options = {}) {
    const requestDedicatedProject = Boolean(options.requestDedicatedProject);
    const requestDedicatedNetworkOnly = Boolean(options.requestDedicatedNetworkOnly);
    const requestQuote = Boolean(options.requestQuote);
    const projectAutoApproveEnabled = Boolean(platformStatus?.selfServiceVmProjectAutoApproveEnabled && platformStatus?.selfServiceVmProjectAutoConfigureEnabled);
    const requestedProjectName = String(options.requestedProjectName || "").trim();
    const networkName = String(options.networkName || "").trim();
    const subnetCidr = String(options.subnetCidr || "").trim();
    const networkRequests = Array.isArray(options.networkRequests) ? options.networkRequests : [];
    const note = String(options.note || "").trim();
    const warning = [
      projectAutoApproveEnabled && requestDedicatedProject ? "OpenStack 자동 구성 후 즉시 사용할 수 있습니다." : "관리자에게 메세지 전달 필요.",
      "상황에 따라서 비용 청구가 될 수 있음.",
      requestDedicatedNetworkOnly ? `기존 전용 프로젝트: ${requestedProjectName || "-"}` : "",
      requestDedicatedProject && !requestDedicatedNetworkOnly ? `전용 OpenStack 프로젝트 요청: ${requestedProjectName || "-"}` : "",
      requestDedicatedProject && networkName ? `전용 네트워크 생성 요청: ${networkName} / ${subnetCidr || "-"}` : "",
      requestQuote ? "견적/유료 생성 요청 포함" : "",
      requestDedicatedProject && note.includes("[전용 네트워크 요청]") ? "라우터/VLAN/Trunk/QoS/방화벽 그룹 요청 옵션 포함" : "",
      "",
      requestQuote ? "관리자에게 견적 요청을 보낼까요?" : requestDedicatedNetworkOnly ? "전용 네트워크 생성 요청을 보낼까요?" : requestDedicatedProject ? (projectAutoApproveEnabled ? "전용 프로젝트를 자동 구성할까요?" : "전용 프로젝트 요청을 보낼까요?") : "권한 요청을 보낼까요?",
    ].filter(Boolean).join("\n");
    if (typeof window !== "undefined" && !window.confirm(warning)) return { cancelled: true };
    try {
      const result = await api("/api/self-service-vms/access-request", {
        method: "POST",
        body: { requestDedicatedProject, requestDedicatedNetworkOnly, requestQuote, requestedProjectName, networkName, subnetCidr, networkRequests, note },
      });
      if (Array.isArray(result.messages)) setMessages(result.messages);
      if (Array.isArray(result.projectRequests)) setSelfServiceProjectRequests(result.projectRequests);
      if (requestDedicatedProject) setSelfServiceProjectRequestForm(EMPTY_SELF_SERVICE_PROJECT_REQUEST_FORM);
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "관리자에게 사용자화 가상머신 구성 권한 요청을 전달했습니다.", "success");
      await runSafeRefreshTasks([
        loadMessages(),
        loadNotifications(),
        loadSelfServiceVms(),
        isAdmin ? loadAdmin() : Promise.resolve(),
      ]);
      return result;
    } catch (error) {
      if (Array.isArray(error.payload?.projectRequests)) setSelfServiceProjectRequests(error.payload.projectRequests);
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "사용자화 가상머신 구성 권한 요청 중 오류가 발생했습니다.", "error");
      return null;
    }
  }
  async function onCancelSelfServiceProjectRequest(requestId) {
    if (typeof window !== "undefined" && !window.confirm("검토 중인 전용 프로젝트 요청을 취소할까요?")) {
      return { cancelled: true };
    }
    try {
      const result = await api(`/api/self-service-project-requests/${requestId}/cancel`, { method: "POST" });
      if (Array.isArray(result.projectRequests)) setSelfServiceProjectRequests(result.projectRequests);
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "전용 프로젝트 요청을 취소했습니다.", "success");
      await runSafeRefreshTasks([loadSelfServiceVms(), isAdmin ? loadAdmin() : Promise.resolve()]);
      return result;
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "전용 프로젝트 요청 취소 중 오류가 발생했습니다.", "error");
      return null;
    }
  }
  async function onReviewSelfServiceProjectRequest(requestId, action, options = {}) {
    const numericRequestId = Number(requestId);
    setSelfServiceProjectReviewBusyIds((current) => [...new Set([...current, numericRequestId])]);
    try {
      const result = await api(`/api/admin/self-service-project-requests/${requestId}/review`, {
        method: "POST",
        body: {
          action,
          projectName: options.projectName,
          reviewNote: options.reviewNote || "",
          skipAutoConfigure: Boolean(options.skipAutoConfigure),
        },
      });
      setAdminStatus(result.message);
      pushToast(result.message || "전용 프로젝트 요청을 처리했습니다.", "success");
      await runSafeRefreshTasks([loadSelfServiceVms(), loadAdmin()]);
    } catch (error) {
      const stepMessage = Array.isArray(error.payload?.steps) && error.payload.steps.length
        ? `\n${error.payload.steps.map((step) => `${step.label || step.key}: ${step.status}${step.detail ? ` - ${step.detail}` : ""}`).join("\n")}`
        : "";
      setAdminStatus(`${error.message}${stepMessage}`);
      pushToast(error.message || "전용 프로젝트 요청 처리 중 오류가 발생했습니다.", "error");
    } finally {
      setSelfServiceProjectReviewBusyIds((current) => current.filter((id) => Number(id) !== numericRequestId));
    }
  }
  async function onTestSelfServiceProjectAutomation() {
    setSelfServiceProjectPreflightStatus({ tone: "info", message: "전용 프로젝트 자동 구성 사전 점검 중입니다.", result: null });
    try {
      const result = await api("/api/admin/self-service-projects/preflight", { method: "POST" });
      setSelfServiceProjectPreflightStatus({ tone: "success", message: result.message, result: result.result || null });
      setAdminStatus(result.message);
      pushToast(result.message || "전용 프로젝트 자동 구성 사전 점검을 통과했습니다.", "success");
    } catch (error) {
      const result = error.payload?.result || null;
      setSelfServiceProjectPreflightStatus({ tone: "error", message: error.message, result });
      setAdminStatus(error.message);
      pushToast(error.message || "전용 프로젝트 자동 구성 사전 점검에 실패했습니다.", "error");
    }
  }
  async function onCreateSelfServiceVm(eventOrPayload) {
    const isSubmitEvent = Boolean(eventOrPayload && typeof eventOrPayload.preventDefault === "function");
    if (isSubmitEvent) eventOrPayload.preventDefault();
    const form = isSubmitEvent || !eventOrPayload || typeof eventOrPayload !== "object"
      ? selfServiceVmForm
      : { ...selfServiceVmForm, ...eventOrPayload };
    const serviceProjectName = String(platformStatus?.serviceProjectName || "").trim().toLowerCase();
    const allowedProjects = (Array.isArray(platformStatus?.selfServiceVmAllowedProjects)
      ? platformStatus.selfServiceVmAllowedProjects
      : [])
      .filter((projectName) => isAdmin || String(projectName || "").trim().toLowerCase() !== serviceProjectName);
    const isAdminCinderBootTest = Boolean(isAdmin && form.cinderBootTest);
    const requestedProjectName = String(form.projectName || "").trim();
    const requestedProjectAllowed = allowedProjects.some(
      (projectName) => String(projectName || "").trim().toLowerCase() === requestedProjectName.toLowerCase(),
    );
    const selectedProjectName = isAdminCinderBootTest && requestedProjectName
      ? requestedProjectName
      : requestedProjectAllowed
        ? form.projectName
        : allowedProjects[0] || "";
    if (!selectedProjectName) {
      const message = "전용 OpenStack 프로젝트가 승인/생성된 뒤 사용자화 가상머신을 만들 수 있습니다.";
      setAuthStatus({ tone: "error", message });
      pushToast(message, "error");
      return null;
    }
    if (isSubmitEvent && selfServiceVmPreflight?.canCreate === false) {
      const message = [selfServiceVmPreflight.message, selfServiceVmPreflight.detailMessage].filter(Boolean).join(" ");
      setAuthStatus({ tone: "error", message });
      pushToast(message || "선택한 프로젝트의 자원이 부족합니다.", "error");
      return null;
    }
    try {
      const result = await api("/api/self-service-vms", {
        method: "POST",
        body: {
          projectName: selectedProjectName,
          networkName: form.networkName || "net-infra",
          imageName: form.imageName || platformStatus?.selfServiceVmAllowedImages?.[0] || "",
          flavor: form.flavor,
          instanceCount: Number(form.instanceCount || 1),
          cloudInitMode: form.cloudInitMode || (form.cloudInitCustomContent ? "custom" : form.cloudInitTemplateName ? "template" : "none"),
          cloudInitTemplateName: form.cloudInitTemplateName,
          cloudInitCustomContent: form.cloudInitCustomContent,
          cloudInitCustomFileName: form.cloudInitCustomFileName,
          bootFromVolume: Boolean(platformStatus?.selfServiceVmVolumeBootEnabled && form.bootFromVolume),
          bootVolumeSizeGb: Number(form.bootVolumeSizeGb || 20),
          bootVolumeType: form.bootVolumeType,
          cinderBootTest: Boolean(form.cinderBootTest),
          dataVolumeEnabled: Boolean(platformStatus?.selfServiceVmDataVolumeEnabled && form.dataVolumeEnabled),
          dataVolumeCount: Number(form.dataVolumeCount || 1),
          dataVolumeSizeGb: Number(form.dataVolumeSizeGb || 20),
          dataVolumeType: form.dataVolumeType,
          floatingIpRequested: Boolean(platformStatus?.selfServiceVmFloatingIpEnabled && form.floatingIpRequested),
          publicAccessNote: form.publicAccessNote,
        },
      });
      setSelfServiceVmForm((current) => ({ ...current, networkName: "net-infra", instanceCount: "1", cloudInitMode: "none", cloudInitTemplateName: "", cloudInitCustomContent: "", cloudInitCustomFileName: "", bootFromVolume: false, bootVolumeSizeGb: "20", dataVolumeEnabled: false, dataVolumeCount: "1", dataVolumeSizeGb: "20", dataVolumeType: "", floatingIpRequested: false, publicAccessNote: "" }));
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "사용자화 가상머신 요청이 등록되었습니다.", "success");
      await runSafeRefreshTasks([loadSelfServiceVms(), isAdmin ? loadAdmin() : Promise.resolve()]);
      return result;
    } catch (error) {
      await runSafeRefreshTasks([loadSelfServiceVms(), isAdmin ? loadAdmin() : Promise.resolve()]);
      if (form.__returnError) {
        throw error;
      }
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "사용자화 가상머신 요청 중 오류가 발생했습니다.", "error");
      return null;
    }
  }
  async function onCheckSelfServiceVmPreflight(payload = {}) {
    const projectName = String(payload.projectName || "").trim();
    const flavor = String(payload.flavor || platformStatus?.selfServiceVmAllowedFlavors?.[0] || "").trim();
    if (!projectName || !flavor) {
      return {
        preflight: {
          ok: false,
          canCreate: false,
          message: "프로젝트와 Flavor를 먼저 선택해 주세요.",
          projectName,
          checks: [],
        },
      };
    }
    const params = new URLSearchParams({
      projectName,
      networkName: String(payload.networkName || "net-infra"),
      flavor,
      instanceCount: String(payload.instanceCount || 1),
      bootFromVolume: String(Boolean(platformStatus?.selfServiceVmVolumeBootEnabled && payload.bootFromVolume)),
      bootVolumeSizeGb: String(payload.bootVolumeSizeGb || 20),
      dataVolumeEnabled: String(Boolean(platformStatus?.selfServiceVmDataVolumeEnabled && payload.dataVolumeEnabled)),
      dataVolumeCount: String(payload.dataVolumeCount || 0),
      dataVolumeSizeGb: String(payload.dataVolumeSizeGb || 0),
      floatingIpRequested: String(Boolean(platformStatus?.selfServiceVmFloatingIpEnabled && payload.floatingIpRequested)),
    });
    return api(`/api/self-service-vms/preflight?${params.toString()}`);
  }
  async function onReviewSelfServiceVm(vmId, action, reviewNote = "") {
    try {
      const result = await api(`/api/admin/self-service-vms/${vmId}/review`, {
        method: "POST",
        body: { action, reviewNote },
      });
      setAdminStatus(result.message);
      await runSafeRefreshTasks([loadSelfServiceVms(), loadAdmin()]);
    } catch (error) {
      setAdminStatus(error.message);
    }
  }
  async function onRequestSelfServiceVmExternalSsh(vmId) {
    try {
      const result = await api(`/api/self-service-vms/${vmId}/request-external-ssh`, { method: "POST" });
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "외부 SSH 요청을 접수했습니다.", "success");
      await runSafeRefreshTasks([loadSelfServiceVms(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "외부 SSH 요청 중 오류가 발생했습니다.", "error");
    }
  }
  async function onReleaseSelfServiceVmExternalSsh(vmId, options = {}) {
    if (!options.skipConfirm && !window.confirm("외부 SSH 요청 또는 할당을 해제할까요?")) return;
    try {
      const result = await api(`/api/self-service-vms/${vmId}/release-external-ssh`, { method: "POST" });
      setAuthStatus({ tone: "success", message: result.message });
      if (isAdmin) setAdminStatus(result.message);
      pushToast(result.message || "외부 SSH를 해제했습니다.", "success");
      await runSafeRefreshTasks([loadSelfServiceVms(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      if (isAdmin) setAdminStatus(error.message);
      pushToast(error.message || "외부 SSH 해제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onApproveSelfServiceVmExternalSsh(vmId, reviewNote = "") {
    try {
      const result = await api(`/api/admin/self-service-vms/${vmId}/approve-external-ssh`, {
        method: "POST",
        body: { reviewNote },
      });
      setAdminStatus(result.message);
      pushToast(result.message || "외부 SSH 요청을 승인했습니다.", "success");
      await runSafeRefreshTasks([loadSelfServiceVms(), loadAdmin()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "외부 SSH 승인 중 오류가 발생했습니다.", "error");
    }
  }
  async function onRejectSelfServiceVmExternalSsh(vmId, reviewNote = "") {
    try {
      const result = await api(`/api/admin/self-service-vms/${vmId}/reject-external-ssh`, {
        method: "POST",
        body: { reviewNote },
      });
      setAdminStatus(result.message);
      pushToast(result.message || "외부 SSH 요청을 반려했습니다.", "success");
      await runSafeRefreshTasks([loadSelfServiceVms(), loadAdmin()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "외부 SSH 반려 중 오류가 발생했습니다.", "error");
    }
  }
  async function onTerminateSelfServiceVm(vmId, options = {}) {
    if (!options.skipConfirm && !window.confirm("이 작업은 사용자화 가상머신을 종료하고 삭제할 수 있습니다. 계속할까요?")) return;
    try {
      const result = await api(`/api/self-service-vms/${vmId}/terminate`, { method: "POST" });
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || "사용자화 가상머신을 삭제했습니다.", "success");
      await runSafeRefreshTasks([loadSelfServiceVms(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || "사용자화 가상머신 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  function getVmPowerActionLabel(action) {
    if (action === "soft-reboot") return "일반 리부팅";
    if (action === "hard-reboot") return "강제 리부팅";
    if (action === "stop") return "전원 끄기";
    return "전원 작업";
  }
  async function onPowerActionSelfServiceVm(vmId, action, options = {}) {
    const label = getVmPowerActionLabel(action);
    if (!options.skipConfirm && !window.confirm(`사용자화 가상머신에 ${label}을 실행할까요?`)) return;
    try {
      const result = await api(`/api/self-service-vms/${vmId}/power-action`, {
        method: "POST",
        body: { action },
      });
      if (result.vm) {
        setSelfServiceVms((current) => current.map((item) => (Number(item.id) === Number(result.vm.id) ? result.vm : item)));
      }
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || `${label}을 실행했습니다.`, "success");
      await runSafeRefreshTasks([loadSelfServiceVms(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || `${label} 실행 중 오류가 발생했습니다.`, "error");
    }
  }
  async function onPowerActionLab(labId, action, options = {}) {
    const label = getVmPowerActionLabel(action);
    if (!options.skipConfirm && !window.confirm(`랩 VM에 ${label}을 실행할까요?`)) return;
    try {
      const result = await api(`/api/labs/${labId}/power-action`, {
        method: "POST",
        body: { action },
      });
      if (result.lab) {
        setLabs((current) => current.map((item) => (Number(item.id) === Number(result.lab.id) ? result.lab : item)));
        if (isAdmin) {
          setAdminLabs((current) => current.map((item) => (Number(item.id) === Number(result.lab.id) ? result.lab : item)));
        }
      }
      if (action === "stop") setTerminalSession(null);
      setAuthStatus({ tone: "success", message: result.message });
      pushToast(result.message || `${label}을 실행했습니다.`, "success");
      await runSafeRefreshTasks([loadLabs(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setAuthStatus({ tone: "error", message: error.message });
      pushToast(error.message || `${label} 실행 중 오류가 발생했습니다.`, "error");
    }
  }
  async function onDeleteSelfServiceProjectRecords(ids, options = {}) {
    const targetIds = Array.isArray(ids) ? ids.map((id) => Number(id)).filter(Boolean) : [];
    if (!targetIds.length) {
      setAdminStatus("삭제할 전용 프로젝트 요청 기록을 선택해 주세요.");
      return;
    }
    if (!window.confirm(`${targetIds.length}건의 전용 프로젝트 요청/승인 연결을 제거할까요?\n승인된 항목은 사용자 프로젝트 선택 목록에서 사라집니다.`)) return;
    const cleanupOpenstackProjects = options.cleanupOpenstackProjects === true
      || window.confirm("v1.2 OpenStack 자동 정리를 함께 실행할까요?\n\n확인을 누르면 선택한 전용 프로젝트의 Heat Stack, VM, 네트워크, 볼륨 등 잔여 자원을 정리한 뒤 Keystone 프로젝트까지 삭제합니다.\n취소를 누르면 기존처럼 Terminal Lab 승인/연결 기록만 제거합니다.");
    try {
      const result = await api("/api/admin/self-service-project-requests/delete-records", {
        method: "POST",
        body: {
          ids: targetIds,
          cleanupOpenstackProjects,
          ...(cleanupOpenstackProjects ? { confirmOpenstackProjectCleanup: "DELETE_OPENSTACK_PROJECTS" } : {}),
        },
      });
      setAdminStatus(result.message);
      pushToast(result.message || "전용 프로젝트 요청 기록을 삭제했습니다.", "success");
      await runSafeRefreshTasks([loadSelfServiceVms(), loadAdmin()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "전용 프로젝트 요청 기록 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onDeleteSelfServiceVmRecords(ids) {
    const targetIds = Array.isArray(ids) ? ids.map((id) => Number(id)).filter(Boolean) : [];
    if (!targetIds.length) {
      setAdminStatus("삭제할 사용자화 가상머신 기록을 선택해 주세요.");
      return;
    }
    if (!window.confirm(`${targetIds.length}건의 실패/종료된 사용자화 가상머신 기록을 삭제할까요?`)) return;
    try {
      const result = await api("/api/admin/self-service-vms/delete-records", {
        method: "POST",
        body: { ids: targetIds },
      });
      setAdminStatus(result.message);
      pushToast(result.message || "사용자화 가상머신 기록을 삭제했습니다.", "success");
      await runSafeRefreshTasks([loadSelfServiceVms(), loadAdmin()]);
    } catch (error) {
      setAdminStatus(error.message);
      pushToast(error.message || "사용자화 가상머신 기록 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onCreateZunContainer(eventOrPayload) {
    const isSubmitEvent = Boolean(eventOrPayload && typeof eventOrPayload.preventDefault === "function");
    if (isSubmitEvent) eventOrPayload.preventDefault();
    const form = isSubmitEvent || !eventOrPayload || typeof eventOrPayload !== "object"
      ? zunForm
      : { ...zunForm, ...eventOrPayload };
    const allowedZunImages = Array.isArray(platformStatus?.zunAllowedImages)
      ? platformStatus.zunAllowedImages
      : EMPTY_PLATFORM_STATUS.zunAllowedImages;
    const useCustomImage = form.imageSource === "custom";
    const imageName = useCustomImage
      ? String(form.customImageName || "").trim()
      : allowedZunImages.includes(form.imageName) ? form.imageName : allowedZunImages[0] || "";
    if (!form.name.trim() || !imageName) {
      setZunStatus({ tone: "error", message: useCustomImage ? "컨테이너 이름과 이미지 주소를 입력해 주세요." : "컨테이너 이름과 허용 이미지를 선택해 주세요." });
      return null;
    }
    if (form.registryAuthEnabled && (!form.registryUrl.trim() || !form.registryUsername.trim() || !form.registryPassword)) {
      setZunStatus({ tone: "error", message: "사설 레지스트리 URL과 아이디, 비밀번호 또는 토큰을 모두 입력해 주세요." });
      return null;
    }
    try {
      const result = await api("/api/zun/containers", {
        method: "POST",
        body: {
          name: form.name,
          imageName,
          useCustomImage,
          registry: form.registryAuthEnabled ? {
            enabled: true,
            url: form.registryUrl,
            username: form.registryUsername,
            password: form.registryPassword,
          } : { enabled: false },
          commandText: form.commandText,
          exposedPort: form.exposedPort ? Number(form.exposedPort) : null,
          presetId: String(form.presetId || "").trim(),
          resourceSource: String(form.resourceSource || "").trim(),
          resourcePresetId: String(form.resourcePresetId || "").trim(),
        },
      });
      setZunForm((current) => ({
        ...EMPTY_ZUN_FORM,
        imageName: imageName || current.imageName || EMPTY_ZUN_FORM.imageName,
        commandText: current.commandText || EMPTY_ZUN_FORM.commandText,
      }));
      setZunStatus({ tone: "success", message: result.message });
      pushToast(result.message || "컨테이너 생성을 요청했습니다.", "success");
      await runSafeRefreshTasks([loadZunContainers(), isAdmin ? loadAdmin() : Promise.resolve()]);
      return result;
    } catch (error) {
      setZunForm((current) => ({ ...current, registryPassword: "" }));
      setZunStatus({ tone: "error", message: error.message });
      pushToast(error.message || "컨테이너 생성 중 오류가 발생했습니다.", "error");
      return null;
    }
  }
  async function onCreateZunContainerTerminalSession(containerId, options = {}) {
    try {
      setZunStatus({ tone: "info", message: "컨테이너 웹 콘솔을 준비하고 있습니다." });
      const result = await api(`/api/zun/containers/${containerId}/terminal/session`, { method: "POST" });
      if (options.navigate !== false) {
        const container = zunContainers.find((item) => (
          String(item?.id || "") === String(containerId || "")
          || String(item?.containerUuid || item?.uuid || "") === String(containerId || "")
        ));
        const returnSection = String(options.returnSection || (
          String(container?.resourceSource || "").toLowerCase() === "ai-lab" ? "aiGpu" : "zun"
        )).trim() || "zun";
        setSection("zunConsole");
        setTerminalSession({ ...result, returnSection });
        setTerminalNonce((value) => value + 1);
        setTerminalRequest({ tone: "success", message: result.message || "컨테이너 웹 콘솔 연결을 준비했습니다." });
      }
      setZunStatus({ tone: "success", message: result.message || "컨테이너 웹 콘솔 연결을 준비했습니다." });
      pushToast(result.message || "컨테이너 웹 콘솔 연결을 준비했습니다.", "success");
      await runSafeRefreshTasks([loadZunContainers(), isAdmin ? loadAdmin() : Promise.resolve()]);
      return result;
    } catch (error) {
      setZunStatus({ tone: "error", message: error.message });
      pushToast(error.message || "컨테이너 웹 콘솔 준비 중 오류가 발생했습니다.", "error");
      if (options.throwOnError) throw error;
      return null;
    }
  }
  function onCloseZunContainerConsole() {
    const returnSection = String(terminalSession?.returnSection || "zun").trim() || "zun";
    setTerminalSession(null);
    setTerminalSessionBusy(false);
    setSection(returnSection);
  }
  async function onStartZunContainer(containerId) {
    try {
      const result = await api(`/api/zun/containers/${containerId}/start`, { method: "POST" });
      setZunStatus({ tone: "success", message: result.message });
      pushToast(result.message || "컨테이너를 시작했습니다.", "success");
      await runSafeRefreshTasks([loadZunContainers(), isAdmin ? loadAdmin() : Promise.resolve()]);
      return result;
    } catch (error) {
      setZunStatus({ tone: "error", message: error.message });
      pushToast(error.message || "컨테이너 시작 중 오류가 발생했습니다.", "error");
    }
  }
  async function onStopZunContainer(containerId) {
    try {
      const result = await api(`/api/zun/containers/${containerId}/stop`, { method: "POST" });
      setZunStatus({ tone: "success", message: result.message });
      pushToast(result.message || "컨테이너를 중지했습니다.", "success");
      await runSafeRefreshTasks([loadZunContainers(), isAdmin ? loadAdmin() : Promise.resolve()]);
      return result;
    } catch (error) {
      setZunStatus({ tone: "error", message: error.message });
      pushToast(error.message || "컨테이너 중지 중 오류가 발생했습니다.", "error");
    }
  }
  async function onRefreshZunContainer(containerId) {
    try {
      const result = await api(`/api/zun/containers/${containerId}/refresh`, { method: "POST" });
      setZunStatus({ tone: "success", message: result.message });
      pushToast(result.message || "컨테이너 상태를 갱신했습니다.", "success");
      await runSafeRefreshTasks([loadZunContainers(), isAdmin ? loadAdmin() : Promise.resolve()]);
      return result;
    } catch (error) {
      setZunStatus({ tone: "error", message: error.message });
      pushToast(error.message || "컨테이너 상태 갱신 중 오류가 발생했습니다.", "error");
    }
  }
  async function onDeleteZunContainer(containerId) {
    try {
      const result = await api(`/api/zun/containers/${containerId}`, { method: "DELETE" });
      setZunStatus({ tone: "success", message: result.message });
      pushToast(result.message || "컨테이너를 삭제했습니다.", "success");
      await runSafeRefreshTasks([loadZunContainers(), isAdmin ? loadAdmin() : Promise.resolve()]);
      return result;
    } catch (error) {
      setZunStatus({ tone: "error", message: error.message });
      pushToast(error.message || "컨테이너 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onPublishZunContainerDomain(containerId, payload = {}) {
    try {
      const result = await api(`/api/zun/containers/${containerId}/domains`, { method: "POST", body: payload });
      setZunStatus({ tone: "success", message: result.message });
      pushToast(result.message || "컨테이너 외부 도메인을 연결했습니다.", "success");
      await runSafeRefreshTasks([loadZunContainers(), isAdmin ? loadAdmin() : Promise.resolve()]);
      return result;
    } catch (error) {
      setZunStatus({ tone: "error", message: error.message });
      pushToast(error.message || "컨테이너 외부 도메인 연결 중 오류가 발생했습니다.", "error");
      return null;
    }
  }
  async function onUnpublishZunContainerDomain(containerId, domain) {
    try {
      const key = String(domain?.fqdn || domain?.subdomain || domain || "").trim();
      const result = await api(`/api/zun/containers/${containerId}/domains/${encodeURIComponent(key)}`, { method: "DELETE" });
      setZunStatus({ tone: "success", message: result.message });
      pushToast(result.message || "컨테이너 외부 도메인을 해제했습니다.", "success");
      await runSafeRefreshTasks([loadZunContainers(), isAdmin ? loadAdmin() : Promise.resolve()]);
      return result;
    } catch (error) {
      setZunStatus({ tone: "error", message: error.message });
      pushToast(error.message || "컨테이너 외부 도메인 해제 중 오류가 발생했습니다.", "error");
      return null;
    }
  }
  async function onCreateMagnumCluster(eventOrPayload) {
    const isSubmitEvent = Boolean(eventOrPayload && typeof eventOrPayload.preventDefault === "function");
    if (isSubmitEvent) eventOrPayload.preventDefault();
    const form = isSubmitEvent || !eventOrPayload || typeof eventOrPayload !== "object"
      ? magnumForm
      : { ...magnumForm, ...eventOrPayload };
    if (!form.name.trim()) {
      setMagnumStatus({ tone: "error", message: "클러스터 이름을 입력해 주세요." });
      return null;
    }
    if (!form.clusterTemplateId) {
      setMagnumStatus({
        tone: "error",
        message: magnumTemplates.length
          ? "CAPO 프로파일을 선택해 주세요."
          : "현재 생성 가능한 CAPO 프로파일이 없습니다. 관리자 설정을 확인해 주세요.",
      });
      return null;
    }
    try {
      const result = await api("/api/magnum/clusters", {
        method: "POST",
        body: {
          name: form.name.trim(),
          databaseName: String(form.databaseName || form.name).trim(),
          clusterTemplateId: form.clusterTemplateId,
          clusterTemplateName: form.clusterTemplateName,
          kubernetesVersion: String(form.kubernetesVersion || "").trim(),
          nodeCount: Number(form.nodeCount || 1),
          masterCount: Number(form.masterCount || 1),
          controlPlaneFlavor: String(form.controlPlaneFlavor || "").trim(),
          workerFlavor: String(form.workerFlavor || "").trim(),
        },
      });
      setMagnumStatus({ tone: "success", message: result.message });
      pushToast(result.message || "CAPO 기반 Kubernetes 클러스터 요청이 접수되었습니다.", "success");
      setMagnumForm((current) => ({
        ...EMPTY_MAGNUM_FORM,
        clusterTemplateId: current.clusterTemplateId,
        clusterTemplateName: current.clusterTemplateName,
        kubernetesVersion: current.kubernetesVersion,
        nodeCount: "1",
        masterCount: "1",
        controlPlaneFlavor: current.controlPlaneFlavor,
        workerFlavor: current.workerFlavor,
      }));
      await runSafeRefreshTasks([loadMagnumClusters(), isAdmin ? loadAdmin() : Promise.resolve()]);
      return result;
    } catch (error) {
      setMagnumStatus({ tone: "error", message: error.message });
      pushToast(error.message || "쿠버네티스 클러스터 요청 중 오류가 발생했습니다.", "error");
      return null;
    }
  }
  async function onReviewMagnumCluster(clusterId, action) {
    try {
      const result = await api(`/api/admin/magnum-clusters/${clusterId}/review`, {
        method: "POST",
        body: { action },
      });
      setMagnumStatus({ tone: "success", message: result.message });
      await runSafeRefreshTasks([loadMagnumClusters(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setMagnumStatus({ tone: "error", message: error.message });
    }
  }
  async function onRefreshMagnumCluster(clusterId) {
    try {
      const result = await api(`/api/magnum/clusters/${clusterId}/refresh`, { method: "POST" });
      setMagnumStatus({ tone: "success", message: result.message });
      pushToast(result.message || "쿠버네티스 클러스터 상태를 갱신했습니다.", "success");
      await runSafeRefreshTasks([loadMagnumClusters(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setMagnumStatus({ tone: "error", message: error.message });
      pushToast(error.message || "쿠버네티스 클러스터 상태 갱신 중 오류가 발생했습니다.", "error");
    }
  }
  async function onDownloadMagnumKubeconfig(clusterId) {
    try {
      const response = await fetch(`/api/magnum/clusters/${clusterId}/kubeconfig`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || `kubeconfig 다운로드에 실패했습니다. (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      const disposition = String(response.headers.get("content-disposition") || "");
      const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `capo-cluster-${clusterId}.kubeconfig`;
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
      setMagnumStatus({ tone: "success", message: "kubeconfig 다운로드를 시작했습니다." });
      pushToast("외부 API 주소가 반영된 kubeconfig를 다운로드했습니다.", "success");
      await runSafeRefreshTasks([loadMagnumClusters(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setMagnumStatus({ tone: "error", message: error.message });
      pushToast(error.message || "kubeconfig 다운로드 중 오류가 발생했습니다.", "error");
    }
  }
  async function onDeleteMagnumCluster(clusterId) {
    try {
      const result = await api(`/api/magnum/clusters/${clusterId}`, { method: "DELETE" });
      setMagnumStatus({ tone: "success", message: result.message });
      pushToast(result.message || "쿠버네티스 클러스터를 삭제했습니다.", "success");
      await runSafeRefreshTasks([loadMagnumClusters(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setMagnumStatus({ tone: "error", message: error.message });
      pushToast(error.message || "쿠버네티스 클러스터 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onCreateTroveInstance(eventOrPayload) {
    const isSubmitEvent = Boolean(eventOrPayload && typeof eventOrPayload.preventDefault === "function");
    if (isSubmitEvent) eventOrPayload.preventDefault();
    const form = isSubmitEvent || !eventOrPayload || typeof eventOrPayload !== "object"
      ? troveForm
      : { ...troveForm, ...eventOrPayload };
    if (!form.name.trim() || !form.datastoreType || !form.flavor) {
      setTroveStatus({ tone: "error", message: "DB 이름, datastore, flavor를 입력해 주세요." });
      return null;
    }
    try {
      const result = await api("/api/trove/instances", {
        method: "POST",
        body: {
          name: form.name.trim(),
          datastoreType: form.datastoreType,
          datastoreVersion: form.datastoreVersion,
          flavor: form.flavor,
          sizeGb: Number(form.sizeGb || 5),
        },
      });
      setTroveStatus({ tone: "success", message: result.message });
      pushToast(result.message || "Trove DB 인스턴스 생성을 요청했습니다.", "success");
      setTroveForm((current) => ({ ...EMPTY_TROVE_FORM, datastoreType: current.datastoreType, flavor: current.flavor, sizeGb: current.sizeGb }));
      await runSafeRefreshTasks([loadTroveInstances(), isAdmin ? loadAdmin() : Promise.resolve()]);
      return result;
    } catch (error) {
      setTroveStatus({ tone: "error", message: error.message });
      pushToast(error.message || "Trove DB 인스턴스 생성 중 오류가 발생했습니다.", "error");
      return null;
    }
  }
  async function onRefreshTroveInstance(instanceId) {
    try {
      const result = await api(`/api/trove/instances/${instanceId}/refresh`, { method: "POST" });
      setTroveStatus({ tone: "success", message: result.message });
      pushToast(result.message || "Trove DB 인스턴스 상태를 갱신했습니다.", "success");
      await runSafeRefreshTasks([loadTroveInstances(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setTroveStatus({ tone: "error", message: error.message });
      pushToast(error.message || "Trove DB 인스턴스 상태 갱신 중 오류가 발생했습니다.", "error");
    }
  }
  async function onDeleteTroveInstance(instanceId) {
    try {
      const result = await api(`/api/trove/instances/${instanceId}`, { method: "DELETE" });
      setTroveStatus({ tone: "success", message: result.message });
      pushToast(result.message || "Trove DB 인스턴스를 삭제했습니다.", "success");
      await runSafeRefreshTasks([loadTroveInstances(), isAdmin ? loadAdmin() : Promise.resolve()]);
    } catch (error) {
      setTroveStatus({ tone: "error", message: error.message });
      pushToast(error.message || "Trove DB 인스턴스 삭제 중 오류가 발생했습니다.", "error");
    }
  }
  async function onRevealTroveCredentials(instanceId) {
    try {
      const result = await api(`/api/trove/instances/${instanceId}/credentials`, { method: "POST" });
      setTroveCredentials((current) => ({ ...current, [instanceId]: result.credential }));
      setTroveStatus({ tone: "success", message: "Barbican에서 DB 접속 정보를 불러왔습니다." });
    } catch (error) {
      setTroveStatus({ tone: "error", message: error.message });
    }
  }

  return {
    route, popupMode, navigate, section, setSection, loading, session, isAdmin, courses, courseQuotes, courseQuoteStatus, notices, notifications, notificationStatus, notificationUnreadCount, luckyDrawOverview, luckyDrawStatus, messages, messageRecipients, messageForm, setMessageForm, messageStatus, messageUnreadCount, selectedCourseId, setSelectedCourseId, openSelectedCourseDetail, setOpenSelectedCourseDetail, preferredSurveyPhase, setPreferredSurveyPhase, selectedCourse, selectedCourseLab, labs, applyingLabCourseIds, startingLabIds, activeLab, activeLabCourse, qnaPosts, qnaForm, setQnaForm, qnaCommentDrafts, setQnaCommentDrafts, qnaUnreadCount,
    authTab, setAuthTab, authStatus, signupCheck, loginForm, setLoginForm, pendingOtpEnrollment, setPendingOtpEnrollment, signupForm, setSignupForm, activeTerms, activeRequiredTerms, missingRequiredTerms, termsConsentRequired, marketingConsentDecisionRequired, resetPinForm, setResetPinForm, adminUsers, adminUserForm, setAdminUserForm, adminBatchUserForm, setAdminBatchUserForm, adminCourseAssignForm, setAdminCourseAssignForm, adminCourses, adminTextbooks, textbookForm, setTextbookForm, adminLabs, adminLabPrecreateReport, adminCourseCinderSmokeReport, labResizeFlavorDrafts, setLabResizeFlavorDrafts, labResizeReviewNotes, setLabResizeReviewNotes, adminCourseAccessRequests, adminSurveyResponses, adminSurveySummary, courseAccessReviewNotes, setCourseAccessReviewNotes, adminHeatTemplates, adminApplicationYamls, applicationYamlUploadState, adminCloudInitTemplates, adminLabDomains, adminCustomLabRequests, adminConsultingRequests, adminPublicQuoteInquiries, adminLuckyDrawEvents, adminStatus, setAdminStatus, adminSaveDialog, closeAdminSaveDialog, courseForm, setCourseForm, courseFormInvalidFields, setCourseFormInvalidFields, courseSubmissionNotice, setCourseSubmissionNotice, noticeForm, setNoticeForm, luckyDrawEventForm, setLuckyDrawEventForm, luckyDrawRewardForm, setLuckyDrawRewardForm, adminCouponForm, setAdminCouponForm, heatTemplateForm, setHeatTemplateForm, applicationYamlForm, setApplicationYamlForm, cloudInitTemplateForm, setCloudInitTemplateForm, userSearch, setUserSearch, selectedUserIds, setSelectedUserIds, selectedLabIds, setSelectedLabIds, filteredUsers, filteredUnapprovedUserIds, platformStatus, platformStatusDirty, setPlatformStatus, paymentGatewayKeyVisibility, setPaymentGatewayKeyVisibility, profileForm, setProfileForm, materialUploadStatus, exampleUploadStatus, serviceValidationStatus, mailTestAddress, setMailTestAddress, adminMailForm, setAdminMailForm, marketingMailForm, setMarketingMailForm, mailCampaignForm, setMailCampaignForm, mailCampaignPreview, adminMailCampaigns, selectedMailCampaign, mailCampaignStatus, adminMailLogs, adminMessages, adminMailLogsStatus, adminAccessLogs, adminAccessLogsStatus, adminAccessStats, myAccessLogs, issuedResetPinInfo, adminPasswordResetPins,
    terminalRequest, terminalForm, setTerminalForm, terminalSession, terminalSessionBusy, terminalNonce, terminalUploadState, publicRouteForm, setPublicRouteForm: updatePublicRouteForm, publicTcpRouteForm, setPublicTcpRouteForm: updatePublicTcpRouteForm, publicRouteOptions, domainAvailability, setDomainAvailability, labParameterOverridePrompt, onClearTerminalSession, onCloseZunContainerConsole,
    customLabRequests, customLabForm, setCustomLabForm, customLabReviewDrafts, setCustomLabReviewDrafts, consultingRequests, consultingForm, setConsultingForm, consultingReviewDrafts, setConsultingReviewDrafts, selfServiceVms, selfServiceProjectRequests, selfServiceProjectRequestForm, setSelfServiceProjectRequestForm, selfServiceProjectReviewBusyIds, selfServiceProjectPreflightStatus, selfServiceVmForm, setSelfServiceVmForm, selfServiceVmPreflight, cloudConsoleSnapshot, cloudConsoleStatus, cloudConsoleActions, loadCloudConsoleSnapshot, loadCloudConsoleActions, loadCloudConsoleProject, createCloudConsoleProject, deleteCloudConsoleProject, runCloudConsoleAction, openCloudConsole, createCloudConsoleTerminalSession, closeCloudConsoleTerminalSession, reviewCloudConsoleAction, zunContainers, zunForm, setZunForm, zunStatus, magnumClusters, magnumTemplates, magnumForm, setMagnumForm, magnumStatus, troveInstances, troveDatastores, troveForm, setTroveForm, troveStatus, troveCredentials, writtenExams, writtenExamForm, setWrittenExamForm, selectedWrittenExam, writtenExamAnswers, setWrittenExamAnswers, writtenExamStatus, setWrittenExamStatus, onClaimExamEntitlement, onClaimCourseAcquisition, labExams, labExamSessions, adminLabExamAttempts, adminLabExamSessions, labExamForm, setLabExamForm, selectedLabExam, labExamSshPassword, setLabExamSshPassword, labExamStatus, setLabExamStatus, labExamTestStatus, payments, coupons, adminCoupons, certificates, certificateLeaderboard, eligibleCertificates, certificateStatus, myCertificateTier, adminPayments, adminCourseQuotes, adminCertificates, adminInvites, inviteForm, setInviteForm, adminLogs, adminAuditLogs, adminB2bReport, apiMonitor, adminInstanceMonitor, trafficDebugCapture, trafficDebugStatus, adminArenaOverview, quotaStatus, llmQuotaStatus, llmQuestion, setLlmQuestion, llmMessages, llmStreaming, llmStatus, toasts, dismissToast,
    onLogin, onSignup, onAcceptActiveTerms, onDecideMarketingConsent, onResetPasswordWithPin, checkUsername, onLogout, onApplyLab, onStartLab, onSubmitLabParameterOverrides, onCancelLabParameterOverrides, onPurchaseCourse, onPrepareCoursePayment, onCreateCourseQuote, onCreateAdminCourseQuote, onUpdateCourseQuoteStatus, onConfirmPayment, onCancelPayment, onRevokeMyCourseAccess, onRequestCourseExtension, onRefundPayment, onCreateAdminCoupon, onToggleAdminCoupon, onProfileSubmit, onDeleteMyAccount, onStartOtpSetup, onConfirmOtpSetup, onConfirmPendingOtpEnrollment, onDisableOtp, onRedeemCourseCode, onSelectTerminalCourse, onCreateTerminalSession, onCreateCustomLabTerminalSession, onUploadLabFile, onOpenTerminalPopup, onOpenVncConsole, onSendVncClipboard, onExtendLab, onPauseLab, onResetLab, onRebuildLabWithVolume, onRemoveLab, onResetLabSshHostKey, onRebootLabNode, onRebuildLabNode, onCheckLabDomain, onPublishLabDomain, onUnpublishLabDomain, onRequestLabPublicPort, onReleaseLabPublicPort, onApproveLabDomain, onRejectLabDomain, onApprovePublicPort, onRejectPublicPort, onCreateQna, onCreateQnaComment, onMarkQnaHelpful, onSetQnaStatus, onAcceptQnaComment, onDeleteQnaPost, onDeleteQnaComment, onNoticeEdit, onCancelNoticeEdit, onNoticeSubmit, onNoticeDelete, onAttemptLuckyDraw, onSaveLuckyDrawEvent, onCancelLuckyDrawEventEdit, onEditLuckyDrawEvent, onDeleteLuckyDrawEvent, onStartLuckyDrawRewardCreate, onEditLuckyDrawReward, onCancelLuckyDrawRewardCreate, onSaveLuckyDrawReward, onCreateAdminUser, onCreateAdminBatchUsers, onAssignCoursesToUsers, onAdminRevokeUserCourseAccess, onAdminForceRevokeUserCourseAccess, onUserPatch, onBulkSetSelfServiceVmAccess, onBulkSetPocFreeAccess, onBulkSetSupportMessageAccess, onDeleteUser, onBulkDeleteUsers, onResetPassword, onIssueResetPin, onClearAccountSharingRestriction, onBulkApprove, onSelectUnapprovedUsers, onBulkApproveUnapprovedUsers, onCourseSubmit, onCourseEdit, onCloneCourse, onCloneCourseAsOnlineDraft, onCloneCourseAsIlt, onCourseDelete, onTextbookSubmit, onTextbookEdit, onCancelTextbookEdit, onTextbookDelete, onWrittenExamEdit, onCancelWrittenExamEdit, onWrittenExamSave, onLabExamEdit, onCancelLabExamEdit, onLabExamSave, onHeatTemplateEdit, onCancelHeatTemplateEdit, onHeatTemplateSave, onUploadHeatTemplate, onDeleteHeatTemplate, onCheckHeatTemplateCapacity, onRunHeatTemplateWorkloadTest, onGetHeatTemplateWorkloadTest, onListHeatTemplateWorkloadTests, onApplicationYamlEdit, onCancelApplicationYamlEdit, onApplicationYamlSave, onUploadApplicationYaml, onDeleteApplicationYaml, onCloudInitTemplateEdit, onCancelCloudInitTemplateEdit, onCloudInitTemplateSave, onUploadCloudInitTemplate, onDeleteCloudInitTemplate, onUploadMaterial, onUploadExampleFile, onUploadLandingMedia, onApproveLab, onBulkApproveLabs, onPrecreateCourseLabs, onArchiveOldLabRequests, onBulkPowerCourseLabs, onRunCourseCinderBootSmoke, onDeleteLabRecords, onTerminateLab, onTerminateCourseLabs, onResizeLab, onRequestLabResize, onCancelLabResizeRequest, onApproveLabResize, onRejectLabResize, onApproveCourseAccessRequest, onRejectCourseAccessRequest, onToggleCircuitBreaker, onSaveCircuitBreakerMessage, onCreateConsultingRequest, onReviewConsultingRequest, onReviewPublicQuoteInquiry, onCreateCustomLabRequest, onReviewCustomLabRequest, onTerminateAdminCustomLabRequest, onDeleteAdminCustomLabQuote, onPrepareCustomLabPayment, onConfirmCustomLabRequest, onCreateCustomLabKeypair, onCancelCustomLabRequest, onTerminateCustomLabRequest, onRequestSelfServiceVmAccess, onCancelSelfServiceProjectRequest, onReviewSelfServiceProjectRequest, onDeleteSelfServiceProjectRecords, onRefreshNotifications, onMarkNotificationRead, onMarkAllNotificationsRead, onDeleteNotification, onClearNotifications, onRefreshMessages, onStartMessageReply, onCancelMessageReply, onSendDirectMessage, onSendMessage, onMarkMessageRead, onArchiveMessage, onDeleteMessage, onUpdateMessageCleanupStatus, loadAdmin, loadAdminLabs, loadCourses, loadLabExams, loadNotices, loadNotifications, loadLuckyDraw, loadMessages, loadMessageRecipients, loadPlatformStatus, loadLabs, loadCourseQuotes, loadCustomLabRequests, loadConsultingRequests, loadQna, loadAdminTextbooks,
    onDeleteCustomLabRequest,
    loadAdminCourses, loadAdminHeatTemplates,
    onSavePlatformSettings, onSaveLlmSettings, onTestLlm, onTestMail, onVerifyMailConnection, onSendAdminMail, onSendMarketingMail, onPreviewMailCampaign, onCreateMailCampaign, onRecordMailCampaignEvent, loadAdminMailCampaigns, loadMailCampaignDetail, onRefreshAdminMailLogs, onRefreshAdminAccessLogs, onCreateServiceValidationResources, onCleanupServiceValidationResources, onRunOpenstackLifecycleTest, onTestSelfServiceProjectAutomation, onWrittenExamEdit, onWrittenExamSave, onWrittenExamDelete, onSubmitWrittenExam, onLabExamEdit, onLabExamSave, onLabExamDelete, onSubmitLabExam, onStartLabExam, onFinishLabExamSession, onReviewLabExamAttempt, onResendLabExamResultMail, onUpdateLabExamAttemptManualResult, onGenerateLabExamAttemptLlmReport, onRegradeLabExamAttempt, onCreateManualLabExamResult, onForceEndLabExamSession, onBulkRemoveLabExamItems, onAdminLabPowerAction, onWarnInstanceUsage, onSendAutoInstanceWarnings, onDeleteLabExamAttempt, onValidateLabExamScript, onTestLabExamScript, onIssueCertificate, onRefreshApiMonitor, onStartTrafficDebugCapture, onAskLlm, onResetLlmConversation, onCreateInvite, onGenerateInviteCode, onToggleInvite, onDeleteInvite, onCreateSelfServiceVm, onCheckSelfServiceVmPreflight, onReviewSelfServiceVm, onRequestSelfServiceVmExternalSsh, onReleaseSelfServiceVmExternalSsh, onApproveSelfServiceVmExternalSsh, onRejectSelfServiceVmExternalSsh, onTerminateSelfServiceVm, onPowerActionSelfServiceVm, onPowerActionLab, onDeleteSelfServiceVmRecords, onCreateZunContainer, onCreateZunContainerTerminalSession, onStartZunContainer, onStopZunContainer, onRefreshZunContainer, onDeleteZunContainer, onPublishZunContainerDomain, onUnpublishZunContainerDomain, onCreateMagnumCluster, onReviewMagnumCluster, onRefreshMagnumCluster, onDownloadMagnumKubeconfig, onDeleteMagnumCluster, onCreateTroveInstance, onRefreshTroveInstance, onDeleteTroveInstance, onRevealTroveCredentials, onGenerateCourseAccessCode, onUpdateCourseAccessCode, loadCoupons, loadAdminCoupons, loadAdminArenaOverview,
    onPreflightLabExam, onLabExamConsoleReady, onRebuildLabExamSession,
    labDomainReviewNotes, setLabDomainReviewNotes, labTcpReviewNotes, setLabTcpReviewNotes, labSshReviewNotes, setLabSshReviewNotes,
    onRequestExternalSsh, onReleaseExternalSsh, onRequestExternalRdp, onReleaseExternalRdp, onApproveExternalSsh, onRejectExternalSsh, onApproveExternalRdp, onRejectExternalRdp, landingMediaUploadState, onUploadBrandAsset, onExportBackup, onImportBackup,
  };
}

export function getRoute() {
  if (window.location.pathname.startsWith("/arena-preview")) return "arena-preview";
  return window.location.pathname.startsWith("/admin") ? "admin" : "portal";
}

export function getPopupMode() {
  return "";
}

function originalGetInitialSection() {
  if (window.location.pathname.startsWith("/ops-monitor")) return "opsMonitor";
  return "notices";
}

function getInitialSelectedCourseId() {
  const courseId = Number(new URLSearchParams(window.location.search).get("courseId") || 0);
  return courseId > 0 ? courseId : null;
}

function getInitialSelectedLabId() {
  const labId = Number(new URLSearchParams(window.location.search).get("labId") || 0);
  return labId > 0 ? labId : null;
}

function getInitialTerminalReplayMetadata() {
  const params = new URLSearchParams(window.location.search);
  const metadata = {
    purpose: String(params.get("replayPurpose") || "").trim(),
    labExamCourseId: String(params.get("labExamCourseId") || "").trim(),
    labExamTitle: String(params.get("labExamTitle") || "").trim(),
    labExamKind: String(params.get("labExamKind") || "").trim(),
    labRequestId: String(params.get("replayLabRequestId") || "").trim(),
  };
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value));
}

export function navigate(pathname) {
  if (window.location.pathname !== pathname) window.history.pushState({}, "", pathname);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

let tossSdkPromise = null;

function downloadTextFile(fileName, content) {
  if (typeof document === "undefined") return;
  const blob = new Blob([String(content || "")], { type: "application/x-pem-file;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = String(fileName || "poc-key.pem").replace(/[\\/]/g, "-");
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ensureTossPaymentsSdk() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("브라우저 환경에서만 토스 SDK를 불러올 수 있습니다."));
  }
  if (typeof window.TossPayments === "function") {
    return Promise.resolve(window.TossPayments);
  }
  if (tossSdkPromise) return tossSdkPromise;
  tossSdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-sdk="tosspayments-v2"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.TossPayments), { once: true });
      existing.addEventListener("error", () => reject(new Error("토스 결제 SDK를 불러오지 못했습니다.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.tosspayments.com/v2/standard";
    script.async = true;
    script.dataset.sdk = "tosspayments-v2";
    script.onload = () => resolve(window.TossPayments);
    script.onerror = () => reject(new Error("토스 결제 SDK를 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
  return tossSdkPromise;
}

function clearPaymentQuery() {
  const nextUrl = `${window.location.pathname}${window.location.hash || ""}`;
  window.history.replaceState({}, "", nextUrl);
}

export function lines(value) {
  return String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const [, base64 = ""] = result.split(",");
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("파일을 읽는 중 오류가 발생했습니다."));
    reader.readAsDataURL(file);
  });
}

function waitForMs(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

const API_READ_CONCURRENCY = 6;
let activeApiReadRequests = 0;
const queuedApiReadRequests = [];

function shouldThrottleApiRead(path, options = {}) {
  const method = String(options.method || "GET").trim().toUpperCase();
  const normalizedPath = String(path || "");
  // Terminal handshakes remain outside the queue so an open console is never
  // delayed behind a background dashboard refresh.
  return method === "GET"
    && normalizedPath.startsWith("/api/")
    && !normalizedPath.startsWith("/api/terminal/")
    && normalizedPath !== "/api/auth/session";
}

function runNextApiReadRequest() {
  if (activeApiReadRequests >= API_READ_CONCURRENCY) return;
  const next = queuedApiReadRequests.shift();
  if (!next) return;
  activeApiReadRequests += 1;
  void next.run()
    .then(next.resolve, next.reject)
    .finally(() => {
      activeApiReadRequests -= 1;
      runNextApiReadRequest();
    });
}

function scheduleApiReadRequest(run) {
  return new Promise((resolve, reject) => {
    queuedApiReadRequests.push({ run, resolve, reject });
    runNextApiReadRequest();
  });
}

export async function api(path, options = {}) {
if (isEducationApi(path)) { if (options.method && options.method !== "GET") throw new Error("교육 기능은 Community에 포함되지 않습니다."); return emptyEducationResponse(); }
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = isFormData ? { ...(options.headers || {}) } : { "Content-Type": "application/json", ...(options.headers || {}) };
  const request = () => fetch(path, {
    method: options.method || "GET",
    headers,
    credentials: "include",
    cache: options.cache || "no-store",
    body: options.body ? (isFormData ? options.body : JSON.stringify(options.body)) : undefined,
    signal: options.signal,
  });
  const response = await (shouldThrottleApiRead(path, options)
    ? scheduleApiReadRequest(request)
    : request());
  const isJsonResponse = response.headers.get("content-type")?.includes("application/json");
  const responseText = isJsonResponse ? "" : await response.text();
  const payload = isJsonResponse ? await response.json() : null;
  if (response.ok && String(path || "").startsWith("/api/") && response.status !== 204 && !isJsonResponse) {
    const error = new Error("백엔드 API 서버가 연결되지 않았습니다. 로컬 확인 시 API 서버와 Vite 개발 서버를 함께 실행해 주세요.");
    error.status = 502;
    error.payload = null;
    throw error;
  }
  if (!response.ok) {
    const isOtpChallenge = Boolean(payload?.requiresOtp || payload?.requiresOtpEnrollment);
    const isPortalAuthFailure = ["AUTH_REQUIRED", "AUTH_SESSION_EXPIRED"].includes(String(payload?.code || ""));
    if (response.status === 401 && isPortalAuthFailure && path !== "/api/auth/session" && !isOtpChallenge && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT, { detail: { path } }));
    }
    const safeResponseText = responseText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
    const fallbackMessage = response.status === 404 && !payload
      ? "요청을 처리할 수 없습니다. 서버 기능이 아직 반영되지 않았습니다."
      : safeResponseText || `요청 처리 중 오류가 발생했습니다. (HTTP ${response.status})`;
    const error = new Error(payload?.message || fallbackMessage);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  if (response.headers.get("X-Account-Sharing-Warning") === "true" && typeof window !== "undefined") {
    const now = Date.now();
    if (now - lastAccountSharingWarningEventAt > 30000) {
      lastAccountSharingWarningEventAt = now;
      window.dispatchEvent(new CustomEvent(ACCOUNT_SHARING_WARNING_EVENT, {
        detail: {
          message: ACCOUNT_SHARING_WARNING_MESSAGE,
          path,
        },
      }));
    }
  }
  return payload;
}

async function streamApi(path, { body = null, onEvent = null } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      },
      credentials: "include",
      cache: "no-store",
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new Error(error?.message || "AI 스트리밍 연결에 실패했습니다. 서버 또는 프록시 연결을 확인해 주세요.");
  }

  if (!response.ok) {
    const payload = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
    const error = new Error(payload?.message || "요청 처리 중 오류가 발생했습니다.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = JSON.parse(trimmed);
      if (typeof onEvent === "function") {
        await onEvent(event);
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    const event = JSON.parse(buffer.trim());
    if (typeof onEvent === "function") {
      await onEvent(event);
    }
  }
}

export { EMPTY_COURSE };
export { DEFAULT_BASIC_APPLICATION_YAML, DEFAULT_EXCEPTION_APPLICATION_YAML };

function getInitialSection(){return communitySection(originalGetInitialSection());}
