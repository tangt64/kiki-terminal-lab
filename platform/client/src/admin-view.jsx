import { isEducationAdminTab } from "../../shared/community-profile.js";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ADMIN_PERMISSION_OPTIONS, isAdminUserRole, navigate, normalizeAdminPermissions } from "./portal-state.js";
import NoticeView from "./notice-view.jsx";
import PortalLogin from "./portal-login-view.jsx";

import { lazyNamedWithChunkReload, lazyWithChunkReload } from "./dynamic-import-reload.js";
import { normalizeConsultingReplyTemplates, renderConsultingReplyTemplateNote, renderConsultingReplyTemplateSubject } from "./consulting-reply-templates.js";

import { AdminField, AdminLuckyDrawTab, AdminSaveDialog, ToastStack, formatCourseDuration, formatCoursePriceLabel, formatDateTime, getCourseProgramType, getCourseProgramTypeDisplay, getQnaStatus, labStatus, useImeBufferedInput } from "./portal-views.jsx";
const ADMIN_PLATFORM_FOCUS_STORAGE_KEY = "admin:platform:focus";




const ADMIN_TAB_LABELS = {
  approvalCenter: "승인 센터",
  notices: "공지사항",
  users: "사용자",
  invites: "추천 / 초대",
  platform: "플랫폼 설정",
  imageMirroring: "이미지 미러링",
  sso: "SSO 로그인",
  terms: "약관 관리",
  arena: "역량 진단 운영",
  monitor: "운영 진단",
  instanceMonitor: "인스턴스 모니터링",
  securityInspection: "보안점검",
  adminManual: "운영 매뉴얼",
  b2bReport: "B2B 리포트",
  auditLogs: "감사 로그",
  accessLogs: "접속 이력",
  mailing: "메일 발송",
  mailLogs: "메일 이력",
  messages: "쪽지 관리",
  consulting: "상담 및 문의",
  access: "과정 요청",
  governmentAccess: "정부과정 신청",
  activity: "활성 분석",
  schedule: "강의 일정",
  luckyDrawAdmin: "쿠폰 / 이벤트",
  marketingSurveys: "설문 투표",
  quotes: "견적서",
  payments: "결제 이력",
  openstackCleanup: "리소스 정리",
  cicd: "CI/CD 파이프라인",
  labs: "랩 요청",
  domains: "도메인",
  sshRequests: "SSH 요청",
  resizeRequests: "리사이즈 요청",
  cloudConsole: "클라우드 콘솔 관리",
  loadBalancers: "로드밸런서 관리",
  aiLabs: "AI 랩 관리",
  zun: "컨테이너 랩",
  magnum: "쿠버네티스 클러스터",
  trove: "데이터베이스",
  curricula: "연도별 커리큘럼",
  courses: "일반 과정",
  iltCourses: "ILT 과정",
  onlineCourses: "온라인 과정",
  examCourses: "시험 과정",
  surveyResults: "설문 결과",
  textbooks: "교재 관리",
  courseCodes: "과정 코드",
  courseLevels: "과정 난이도",
  courseCategories: "과정 카테고리",
  courseProgramTypes: "과정 운영 분류",
  writtenExams: "지식 검증",
  labExams: "실습 시험",
  certificates: "수료증",
  templates: "Heat 템플릿",
  appYamls: "Application YAML",
  cloudInit: "cloud-init",
  logs: "시스템 로그",
  llm: "LLM 설정",
  qna: "커뮤니티 관리"
};
const ADMIN_TAB_GROUPS = [{
  key: "today",
  label: "오늘 처리",
  tabs: ["approvalCenter", "cloudConsole", "instanceMonitor", "messages", "consulting", "qna"]
}, {
  key: "accounts",
  label: "계정 / 권한",
  tabs: ["users"]
}, {
  key: "classes",
  label: "자원 운영",
  tabs: ["zun", "magnum", "trove"]
}, {
  key: "learning",
  label: "운영 문서",
  tabs: ["adminManual"]
}, {
  key: "infra",
  label: "인프라 / 진단",
  tabs: ["cloudConsole", "aiLabs", "loadBalancers", "imageMirroring", "monitor", "securityInspection", "openstackCleanup", "cicd", "b2bReport", "logs", "llm"]
}, {
  key: "marketing",
  label: "마케팅 / 매출",
  tabs: ["activity", "marketingSurveys", "invites", "luckyDrawAdmin", "mailing", "mailLogs"]
}, {
  key: "settings",
  label: "설정 / 감사",
  tabs: ["platform", "sso", "terms", "notices", "auditLogs", "accessLogs"]
}, {
  key: "templates",
  label: "템플릿",
  tabs: ["templates", "appYamls", "cloudInit"]
}];
const ADMIN_TAB_LABELS_CLEAN = ADMIN_TAB_LABELS;
const ADMIN_TAB_GROUPS_CLEAN = ADMIN_TAB_GROUPS;
const ADMIN_FAVORITE_STORAGE_KEY = "terminal-lab-admin-favorites";
const ADMIN_DENSITY_STORAGE_KEY = "terminal-lab-admin-density";
const DEFAULT_ADMIN_FAVORITES = ["approvalCenter", "instanceMonitor", "monitor", "messages", "qna", "users"];
const ADMIN_USER_SEARCH_STORAGE_KEY = "terminal-lab-admin-users-search";




const ADMIN_LONG_WAIT_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const ADMIN_STUCK_PROVISIONING_THRESHOLD_MS = 60 * 60 * 1000;
const ADMIN_ACCESS_DENIED_TERMINAL_LINES = ["auth.scope=user", "admin.permission=false", "route.guard=admin_only", "access.denied=admin", "terminal.lab: permission denied"];
const ADMIN_QUICK_ACTIONS = {
  approvalCenter: ["users", "cloudConsole", "qna", "messages"],
  platform: ["sso", "monitor", "instanceMonitor", "cicd", "templates", "cloudInit"],
  sso: ["platform", "accessLogs", "users"],
  terms: ["platform", "notices", "users"],
  monitor: ["openstackCleanup", "instanceMonitor", "cloudConsole", "platform", "cicd", "accessLogs", "logs", "llm"],
  instanceMonitor: ["monitor", "cloudConsole", "openstackCleanup", "accessLogs"],
  b2bReport: ["monitor", "instanceMonitor"],
  auditLogs: ["accessLogs", "platform", "users"],
  accessLogs: ["auditLogs", "monitor", "instanceMonitor", "users", "mailing"],
  mailing: ["platform", "monitor", "users"],
  mailLogs: ["mailing", "platform", "users"],
  notices: ["qna", "messages", "platform"],
  qna: ["messages", "notices", "users"],
  messages: ["consulting", "qna", "users"],
  consulting: ["messages", "qna", "mailLogs"],
  logs: ["monitor", "instanceMonitor", "llm"],
  llm: ["monitor", "instanceMonitor", "platform"],
  users: ["invites"],
  governmentAccess: [],
  activity: ["mailing", "invites"],
  schedule: [],
  invites: ["luckyDrawAdmin", "users"],
  luckyDrawAdmin: ["invites"],
  access: ["users"],
  quotes: ["users"],
  payments: ["luckyDrawAdmin", "invites"],
  openstackCleanup: ["monitor", "instanceMonitor", "cloudConsole", "zun", "magnum", "trove"],
  cicd: ["templates", "cloudInit", "cloudConsole", "zun", "magnum", "trove"],
  labs: ["instanceMonitor", "openstackCleanup", "cloudConsole"],
  domains: ["cloudConsole"],
  sshRequests: ["cloudConsole"],
  resizeRequests: ["cloudConsole"],
  cloudConsole: ["aiLabs", "loadBalancers", "instanceMonitor", "openstackCleanup", "platform", "users"],
  aiLabs: ["cloudConsole", "zun", "imageMirroring", "platform", "openstackCleanup"],
  loadBalancers: ["cloudConsole", "instanceMonitor", "openstackCleanup", "platform"],
  zun: ["aiLabs", "cloudConsole", "magnum", "trove"],
  magnum: ["zun", "trove", "cloudConsole"],
  trove: ["cloudConsole", "zun", "magnum", "platform"],
  curricula: [],
  courses: ["adminManual"],
  iltCourses: ["adminManual"],
  onlineCourses: ["adminManual"],
  surveyResults: ["messages", "llm"],
  courseCodes: [],
  courseLevels: [],
  courseCategories: [],
  courseProgramTypes: [],
  writtenExams: ["adminManual"],
  labExams: ["adminManual"],
  certificates: ["adminManual"],
  adminManual: ["templates", "cloudInit"],
  templates: ["appYamls", "cloudInit"],
  appYamls: ["templates", "cloudInit", "cloudConsole"],
  cloudInit: ["templates", "appYamls", "cloudConsole"]
};
function normalizeAdminSearchText(value) {
  return String(value || "").trim().toLowerCase();
}
function joinAdminSearchParts(parts) {
  return parts.filter(part => String(part || "").trim()).join(" ");
}
function getAdminCourseSearchTab(course = {}, platformStatus = {}) {
  if (String(course.courseType || "standard") === "online") return "onlineCourses";
  return String(getCourseProgramType(course, platformStatus) || "").trim().toUpperCase() === "ILT" ? "iltCourses" : "courses";
}
function buildAdminGlobalSearchResults(props, tabs, rawQuery) {
  const query = normalizeAdminSearchText(rawQuery);
  if (query.length < 2) return [];
  const results = [];
  const pushResult = entry => {
    const haystack = normalizeAdminSearchText(joinAdminSearchParts([entry.category, entry.title, entry.detail, entry.meta, entry.badge, ...(entry.keywords || [])]));
    if (!haystack.includes(query)) return;
    const title = normalizeAdminSearchText(entry.title);
    const score = title === query ? 0 : title.startsWith(query) ? 1 : haystack.indexOf(query) >= 0 ? 2 : 3;
    results.push({
      ...entry,
      score
    });
  };
  tabs.forEach(tab => pushResult({
    key: `tab-${tab.key}`,
    category: "메뉴",
    title: tab.label,
    detail: tab.groupLabel,
    badge: "관리 화면",
    tab: tab.key,
    keywords: [tab.key]
  }));
  (props.adminUsers || []).forEach(user => pushResult({
    key: `user-${user.id}`,
    category: "사용자",
    title: user.name || user.username || `사용자 #${user.id}`,
    detail: joinAdminSearchParts([user.username, user.email]),
    meta: joinAdminSearchParts([user.role, user.status]),
    badge: ADMIN_TAB_LABELS_CLEAN.users,
    tab: "users",
    keywords: [user.id ? `#${user.id}` : ""]
  }));
  (props.adminCourses || []).forEach(course => {
    const tab = getAdminCourseSearchTab(course, props.platformStatus);
    pushResult({
      key: `course-${course.id}`,
      category: "과정",
      title: course.title || course.name || `과정 #${course.id}`,
      detail: joinAdminSearchParts([course.code, course.slug, course.level, course.category]),
      meta: joinAdminSearchParts([course.courseStatus, getCourseProgramTypeDisplay(getCourseProgramType(course, props.platformStatus))]),
      badge: ADMIN_TAB_LABELS_CLEAN[tab],
      tab,
      keywords: [course.id ? `#${course.id}` : ""]
    });
  });
  (props.adminCourseAccessRequests || []).forEach(request => pushResult({
    key: `access-${request.id}`,
    category: "과정 요청",
    title: request.userName || request.username || `요청 #${request.id}`,
    detail: joinAdminSearchParts([request.courseTitle, request.username, request.email]),
    meta: request.status,
    badge: ADMIN_TAB_LABELS_CLEAN.access,
    tab: "access",
    keywords: [request.id ? `#${request.id}` : ""]
  }));
  (props.adminLabs || []).forEach(lab => pushResult({
    key: `lab-${lab.id}`,
    category: "랩",
    title: lab.courseTitle || lab.stackName || `랩 #${lab.id}`,
    detail: joinAdminSearchParts([lab.userName, lab.username, lab.instanceIp, lab.stackName, lab.stackId]),
    meta: labStatus(lab.status) || lab.status,
    badge: ADMIN_TAB_LABELS_CLEAN.labs,
    tab: "labs",
    keywords: [lab.id ? `#${lab.id}` : "", lab.instanceUuid]
  }));
  (props.selfServiceVms || []).forEach(vm => pushResult({
    key: `self-vm-${vm.id}`,
    category: "클라우드 콘솔",
    title: vm.stackName || vm.name || `VM #${vm.id}`,
    detail: joinAdminSearchParts([vm.userName, vm.username, vm.instanceIp, vm.imageName]),
    meta: labStatus(vm.status) || vm.status,
    badge: ADMIN_TAB_LABELS_CLEAN.selfServiceVms,
    tab: "cloudConsole",
    keywords: [vm.id ? `#${vm.id}` : "", vm.instanceUuid]
  }));
  (props.adminCustomLabRequests || []).forEach(request => pushResult({
    key: `custom-lab-${request.id}`,
    category: "고급 랩",
    title: request.title || request.courseTitle || `고급 랩 #${request.id}`,
    detail: joinAdminSearchParts([request.name, request.username, request.email, request.instanceIp, request.stackName]),
    meta: request.status,
    badge: ADMIN_TAB_LABELS_CLEAN.customLabs,
    tab: "cloudConsole",
    keywords: [request.id ? `#${request.id}` : "", request.stackId]
  }));
  (props.adminLabExamAttempts || []).forEach(attempt => pushResult({
    key: `lab-exam-attempt-${attempt.id}`,
    category: "실습 시험 결과",
    title: attempt.courseTitle || attempt.examTitle || `결과 #${attempt.id}`,
    detail: joinAdminSearchParts([attempt.userName, attempt.username, attempt.status, attempt.reviewStatus]),
    meta: attempt.score != null ? `${attempt.score}/${attempt.totalScore || 100}` : "",
    badge: ADMIN_TAB_LABELS_CLEAN.labExams,
    tab: "labExams",
    keywords: [attempt.id ? `#${attempt.id}` : "", attempt.sessionId]
  }));
  (props.adminPayments || []).forEach(payment => pushResult({
    key: `payment-${payment.id || payment.orderId}`,
    category: "결제",
    title: payment.courseTitle || payment.orderName || `결제 #${payment.id || payment.orderId}`,
    detail: joinAdminSearchParts([payment.buyerName, payment.username, payment.email, payment.orderId]),
    meta: payment.status || payment.paymentStatus,
    badge: ADMIN_TAB_LABELS_CLEAN.payments,
    tab: "payments"
  }));
  (props.adminCourseQuotes || []).forEach(quote => pushResult({
    key: `quote-${quote.id}`,
    category: "견적",
    title: quote.courseTitle || quote.title || `견적 #${quote.id}`,
    detail: joinAdminSearchParts([quote.customerName, quote.companyName, quote.email, quote.phone]),
    meta: quote.status,
    badge: ADMIN_TAB_LABELS_CLEAN.quotes,
    tab: "quotes",
    keywords: [quote.id ? `#${quote.id}` : ""]
  }));
  (props.adminCertificates || []).forEach(certificate => pushResult({
    key: `certificate-${certificate.id}`,
    category: "수료증",
    title: certificate.courseTitle || certificate.title || `수료증 #${certificate.id}`,
    detail: joinAdminSearchParts([certificate.userName, certificate.username, certificate.certificateNo]),
    meta: certificate.status,
    badge: ADMIN_TAB_LABELS_CLEAN.certificates,
    tab: "certificates"
  }));
  (props.qnaPosts || []).forEach(post => pushResult({
    key: `qna-${post.id}`,
    category: "문의",
    title: post.title || `문의 #${post.id}`,
    detail: joinAdminSearchParts([post.authorName, post.authorUsername, post.body]),
    meta: getQnaStatus(post)?.label,
    badge: ADMIN_TAB_LABELS_CLEAN.qna,
    tab: "qna"
  }));
  (props.adminMessages || []).forEach(message => pushResult({
    key: `message-${message.id}`,
    category: "쪽지",
    title: message.subject || `쪽지 #${message.id}`,
    detail: joinAdminSearchParts([message.senderName, message.senderUsername, message.recipientUsername, message.body]),
    meta: message.readAt ? "읽음" : "미확인",
    badge: ADMIN_TAB_LABELS_CLEAN.messages,
    tab: "messages"
  }));
  (props.adminAuditLogs || []).forEach(log => pushResult({
    key: `audit-${log.id}`,
    category: "감사 로그",
    title: log.summary || log.action || `감사 로그 #${log.id}`,
    detail: joinAdminSearchParts([log.username, log.targetType, log.targetId, log.ipAddress]),
    meta: formatDateTime(log.createdAt),
    badge: ADMIN_TAB_LABELS_CLEAN.auditLogs,
    tab: "auditLogs"
  }));
  (props.adminAccessLogs || []).forEach(log => pushResult({
    key: `access-log-${log.id}`,
    category: "접속 로그",
    title: log.userName || log.username || `접속 로그 #${log.id}`,
    detail: joinAdminSearchParts([log.eventType, log.ipAddress, log.userAgent]),
    meta: formatDateTime(log.createdAt),
    badge: ADMIN_TAB_LABELS_CLEAN.accessLogs,
    tab: "accessLogs"
  }));
  return results.sort((left, right) => left.score - right.score || String(left.category).localeCompare(String(right.category), "ko") || String(left.title).localeCompare(String(right.title), "ko")).slice(0, 18);
}
const AdminTemplatesTabLazy = lazyNamedWithChunkReload(() => import("./admin-template-tabs.jsx"), "AdminTemplatesTab");
const AdminApplicationYamlsTabLazy = lazyNamedWithChunkReload(() => import("./admin-template-tabs.jsx"), "AdminApplicationYamlsTab");
const AdminCloudInitTemplatesTabLazy = lazyNamedWithChunkReload(() => import("./admin-template-tabs.jsx"), "AdminCloudInitTemplatesTab");
const AdminCicdTabLazy = lazyNamedWithChunkReload(() => import("./cicd-view.jsx"), "AdminCicdTab");


const AdminLlmTabLazy = lazyNamedWithChunkReload(() => import("./admin-platform-tabs.jsx"), "AdminLlmTab");
const AdminMagnumTabLazy = lazyNamedWithChunkReload(() => import("./admin-platform-tabs.jsx"), "AdminMagnumTab");
const AdminTroveTabLazy = lazyNamedWithChunkReload(() => import("./admin-platform-tabs.jsx"), "AdminTroveTab");
const AdminPlatformTabLazy = lazyNamedWithChunkReload(() => import("./admin-platform-tabs.jsx"), "AdminPlatformTab");
const AdminImageMirroringTabLazy = lazyNamedWithChunkReload(() => import("./admin-platform-tabs.jsx"), "AdminImageMirroringTab");
const AdminSsoTabLazy = lazyNamedWithChunkReload(() => import("./admin-platform-tabs.jsx"), "AdminSsoTab");
const AdminZunTabLazy = lazyNamedWithChunkReload(() => import("./admin-platform-tabs.jsx"), "AdminZunTab");

const AdminAuditLogsTabLazy = lazyNamedWithChunkReload(() => import("./admin-ops-tabs.jsx"), "AdminAuditLogsTab");
const AdminAccessLogsTabLazy = lazyNamedWithChunkReload(() => import("./admin-ops-tabs.jsx"), "AdminAccessLogsTab");
const AdminApiMonitorTabLazy = lazyNamedWithChunkReload(() => import("./admin-ops-tabs.jsx"), "AdminApiMonitorTab");
const AdminInstanceMonitorTabLazy = lazyNamedWithChunkReload(() => import("./admin-ops-tabs.jsx"), "AdminInstanceMonitorTab");
const AdminLogsTabLazy = lazyNamedWithChunkReload(() => import("./admin-ops-tabs.jsx"), "AdminLogsTab");
const AdminMailingTabLazy = lazyNamedWithChunkReload(() => import("./admin-ops-tabs.jsx"), "AdminMailingTab");
const AdminMailLogsTabLazy = lazyNamedWithChunkReload(() => import("./admin-ops-tabs.jsx"), "AdminMailLogsTab");
const AdminOpenstackCleanupTabLazy = lazyNamedWithChunkReload(() => import("./admin-ops-tabs.jsx"), "AdminOpenstackCleanupTab");
const AdminCloudConsoleTabLazy = lazyWithChunkReload(() => import("./admin-cloud-console-tab.jsx"));
const AdminAiLabsTabLazy = lazyWithChunkReload(() => import("./admin-ai-labs-tab.jsx"));
const AdminLoadBalancersTabLazy = lazyWithChunkReload(() => import("./admin-load-balancers-tab.jsx"));
const AdminTermsTabLazy = lazyNamedWithChunkReload(() => import("./admin-terms-tab.jsx"), "AdminTermsTab");
const AdminInvitesTabLazy = lazyNamedWithChunkReload(() => import("./admin-lab-tabs.jsx"), "AdminInvitesTab");



const AdminMarketingActivityTabLazy = lazyNamedWithChunkReload(() => import("./admin-marketing-activity-tab.jsx"), "AdminMarketingActivityTab");
const AdminMarketingSurveysTabLazy = lazyNamedWithChunkReload(() => import("./marketing-survey-view.jsx"), "AdminMarketingSurveysTab");





const AdminSecurityInspectionLazy = lazyWithChunkReload(() => import('./admin-security-inspection.jsx'));
const ADMIN_TAB_RENDERERS = {
approvalCenter: props => <AdminApprovalCenterTab {...props} />,
notices: props => <NoticeView {...props} />,
users: props => <AdminUsersTab {...props} />,
invites: props => <AdminInvitesTabLazy {...props} />,
platform: props => <AdminPlatformTabLazy {...props} />,
imageMirroring: props => <AdminImageMirroringTabLazy {...props} />,
sso: props => <AdminSsoTabLazy {...props} />,
terms: props => <AdminTermsTabLazy {...props} />,
monitor: props => <AdminApiMonitorTabLazy {...props} />,
instanceMonitor: props => <AdminInstanceMonitorTabLazy {...props} />,
securityInspection: props => <AdminSecurityInspectionLazy {...props} />,
auditLogs: props => <AdminAuditLogsTabLazy {...props} />,
accessLogs: props => <AdminAccessLogsTabLazy {...props} />,
mailing: props => <AdminMailingTabLazy {...props} />,
mailLogs: props => <AdminMailLogsTabLazy {...props} />,
messages: props => <AdminMessagesTab {...props} />,
consulting: props => <AdminConsultingRequestsTab {...props} />,
activity: props => <AdminMarketingActivityTabLazy {...props} />,
marketingSurveys: props => <AdminMarketingSurveysTabLazy {...props} />,
luckyDrawAdmin: props => <AdminLuckyDrawTab {...props} />,
openstackCleanup: props => <AdminOpenstackCleanupTabLazy {...props} />,
cicd: props => <AdminCicdTabLazy {...props} />,
cloudConsole: props => <AdminCloudConsoleTabLazy {...props} />,
aiLabs: props => <AdminAiLabsTabLazy {...props} />,
loadBalancers: props => <AdminLoadBalancersTabLazy {...props} />,
zun: props => <AdminZunTabLazy {...props} />,
magnum: props => <AdminMagnumTabLazy {...props} />,
trove: props => <AdminTroveTabLazy {...props} />,
adminManual: props => <AdminManualTab {...props} />,
templates: props => <AdminTemplatesTabLazy {...props} />,
appYamls: props => <AdminApplicationYamlsTabLazy {...props} />,
cloudInit: props => <AdminCloudInitTemplatesTabLazy {...props} />,
logs: props => <AdminLogsTabLazy {...props} />,
llm: props => <AdminLlmTabLazy {...props} />,
qna: props => <AdminQnaTab {...props} />
};
function loadAdminFavorites() {
  if (typeof window === "undefined") {
    return DEFAULT_ADMIN_FAVORITES;
  }
  try {
    const raw = window.localStorage.getItem(ADMIN_FAVORITE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_ADMIN_FAVORITES;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return DEFAULT_ADMIN_FAVORITES;
    }
    const safeTabs = parsed.filter(tab => ADMIN_TAB_LABELS_CLEAN[tab]);
    return safeTabs.length ? safeTabs : DEFAULT_ADMIN_FAVORITES;
  } catch {
    return DEFAULT_ADMIN_FAVORITES;
  }
}
function readAdminTabFromUrl() {
  if (typeof window === "undefined") return "approvalCenter";
  const params = new URLSearchParams(window.location.search || "");
  const queryTab = params.get("tab");
  const pathMatch = window.location.pathname.match(/^\/admin\/([^/?#]+)/);
  const tab = queryTab || pathMatch?.[1] || "";
  return ADMIN_TAB_LABELS_CLEAN[tab] ? tab : "approvalCenter";
}
function writeAdminTabToUrl(tab, {
  replace = false,
  searchParams = null
} = {}) {
  if (typeof window === "undefined" || !ADMIN_TAB_LABELS_CLEAN[tab]) return;
  const url = new URL(window.location.href);
  url.pathname = "/admin";
  url.searchParams.set("tab", tab);
  if (searchParams && typeof searchParams === "object") {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (!value || value === "all") {
        url.searchParams.delete(key);
        return;
      }
      url.searchParams.set(key, value);
    });
  }
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", nextUrl);
}
function loadStoredAdminValue(key, fallback = "") {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function storeAdminValue(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(value ?? ""));
  } catch {
    // Best-effort preference storage.
  }
}
function getTimestampMs(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}
function getOldestTimestamp(items, picker = item => item.createdAt || item.requestedAt || item.updatedAt) {
  return items.map(item => getTimestampMs(picker(item))).filter(time => time > 0).sort((left, right) => left - right)[0] || 0;
}
function formatQueueAge(timestampMs) {
  if (!timestampMs) return "대기 시간 미확인";
  const minutes = Math.max(0, Math.floor((Date.now() - timestampMs) / 60000));
  if (minutes < 60) return `${minutes}분 대기`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 대기`;
  return `${Math.floor(hours / 24)}일 대기`;
}
function adminHasOperationIssueSignal(rawItem = {}) {
  const item = rawItem || {};
  return /실패|오류|failed|error|quota|overquota|403|forbidden|clouds\.yaml|neutron|unauthorized|denied/i.test([item.status, item.reviewNote, item.publicReviewNote, item.errorMessage, item.provisioningNote, item.adminNote, item.lastError, item.cleanupLastError, item.advancedConfig?.cleanupLastError, item.openstackProjectSetupError, item.openstackNetworkSetupError].filter(Boolean).join(" "));
}
const ADMIN_OPERATION_ISSUE_CATEGORIES = [{
  key: "quota",
  label: "Quota / 할당량",
  tone: "danger",
  hint: "잔여 자원 정리 또는 Quota 조정이 먼저 필요합니다.",
  pattern: /quota|overquota|exceeded|할당량|리소스 초과/i
}, {
  key: "permission",
  label: "권한 / 403",
  tone: "danger",
  hint: "clouds.yaml 계정 역할과 프로젝트 멤버 권한을 확인합니다.",
  pattern: /403|forbidden|unauthorized|denied|not authorized|권한|거부/i
}, {
  key: "certificate",
  label: "인증서 / Keystone",
  tone: "warn",
  hint: "CA 경로, 인증서 체인, Keystone 인증 URL을 점검합니다.",
  pattern: /keystone|certificate|unable_to_verify|leaf_signature|self signed|cert|ca|clouds\.yaml|인증서|인증/i
}, {
  key: "network",
  label: "Network / Neutron",
  tone: "warn",
  hint: "네트워크, 서브넷, 라우터, 포트, 보안그룹 Quota를 확인합니다.",
  pattern: /neutron|network|subnet|router|floating|security_group|security group|port|trunk|vlan|네트워크|라우터|보안그룹/i
}, {
  key: "compute",
  label: "Compute / Cinder",
  tone: "info",
  hint: "이미지, Flavor, Nova, Cinder 볼륨 상태를 확인합니다.",
  pattern: /nova|compute|flavor|image|glance|cinder|volume|server|인스턴스|볼륨|이미지/i
}, {
  key: "heat",
  label: "Heat / Stack",
  tone: "info",
  hint: "HeatStack 이벤트와 템플릿 파라미터를 먼저 확인합니다.",
  pattern: /heat|stack|orchestration|template|resource signal|스택|템플릿/i
}, {
  key: "unknown",
  label: "기타 오류",
  tone: "ready",
  hint: "상세 로그 확인이 필요합니다.",
  pattern: /.^/
}];
function getAdminOperationIssueText(rawItem = {}) {
  const item = rawItem || {};
  return [item.status, item.reviewNote, item.publicReviewNote, item.errorMessage, item.provisioningNote, item.adminNote, item.lastError, item.cleanupLastError, item.advancedConfig?.cleanupLastError, item.openstackProjectSetupLog, item.openstackProjectSetupError, item.openstackNetworkSetupLog, item.openstackNetworkSetupError].filter(Boolean).join(" ");
}
function getAdminOperationIssueCategory(rawItem = {}) {
  const text = getAdminOperationIssueText(rawItem);
  return ADMIN_OPERATION_ISSUE_CATEGORIES.find(category => category.key !== "unknown" && category.pattern.test(text)) || ADMIN_OPERATION_ISSUE_CATEGORIES[ADMIN_OPERATION_ISSUE_CATEGORIES.length - 1];
}
function getAdminOperationIssueTitle(rawItem = {}) {
  const item = rawItem || {};
  return item.stackName || item.projectName || item.name || item.title || item.courseTitle || item.username || item.userName || "확인 대상 자원";
}



function confirmAdminDangerAction(title, detail) {
  if (typeof window === "undefined") return true;
  const lines = [title, detail, "이 작업은 운영 데이터나 실행 중인 자원에 영향을 줄 수 있습니다."].filter(Boolean);
  return window.confirm(lines.join("\n"));
}
function getAdminGroupKeyForTab(tab) {
  return ADMIN_TAB_GROUPS_CLEAN.find(group => group.tabs.includes(tab))?.key || ADMIN_TAB_GROUPS_CLEAN[0]?.key || "today";
}
function getRandomAdminAccessDeniedLine() {
  return ADMIN_ACCESS_DENIED_TERMINAL_LINES[Math.floor(Math.random() * ADMIN_ACCESS_DENIED_TERMINAL_LINES.length)];
}

function getConsultingRequestStatusLabel(status) {
  switch (String(status || "requested").toLowerCase()) {
    case "reviewing":
      return "검토 중";
    case "answered":
      return "답변 완료";
    case "closed":
      return "종료";
    default:
      return "접수됨";
  }
}
function getConsultingRequestStatusTone(status) {
  switch (String(status || "requested").toLowerCase()) {
    case "reviewing":
      return "is-government";
    case "answered":
      return "is-success";
    case "closed":
      return "is-muted";
    default:
      return "is-warn";
  }
}
function getConsultingRequestSearchText(request) {
  return [request?.title, request?.contactName, request?.contactEmail, request?.userName, request?.email, request?.companyName, request?.inquiryType, request?.industry, request?.currentEnvironment, request?.requirements, request?.budgetRange, request?.desiredTimeline, request?.note, request?.adminNote].filter(Boolean).join(" ").toLowerCase();
}
function isAiGpuConsultingRequest(request) {
  const text = getConsultingRequestSearchText(request);
  return /ai\/gpu|gpu|vgpu|cuda|nvidia|llm|kubeflow/.test(text);
}
function getConsultingRequestLineMap(request) {
  const lineMap = new Map();
  const rawLines = [request?.currentEnvironment, request?.requirements, request?.budgetRange ? `예산 범위: ${request.budgetRange}` : "", request?.desiredTimeline ? `희망 일정: ${request.desiredTimeline}` : ""].filter(Boolean).join("\n").split(/\n+/);
  rawLines.forEach(line => {
    const trimmed = String(line || "").trim();
    const match = trimmed.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (!match) return;
    const label = match[1].trim();
    const value = match[2].trim();
    if (label && value && !lineMap.has(label)) {
      lineMap.set(label, value);
    }
  });
  return lineMap;
}
function getConsultingRequestHighlights(request) {
  const preferredLabels = ["선택 프로젝트", "워크로드", "희망 GPU Flavor", "GPU 수량", "예약 시간", "추가 스토리지", "Floating IP", "드라이버/런타임"];
  const lineMap = getConsultingRequestLineMap(request);
  const highlights = preferredLabels.filter(label => lineMap.has(label)).map(label => ({
    label,
    value: lineMap.get(label)
  }));
  if (lineMap.has("예산 범위")) highlights.push({
    label: "예산 범위",
    value: lineMap.get("예산 범위")
  });
  if (lineMap.has("희망 일정")) highlights.push({
    label: "희망 일정",
    value: lineMap.get("희망 일정")
  });
  return highlights.slice(0, 8);
}
function parseConsultingNumber(value) {
  const number = Number(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(number) ? number : 0;
}
function formatAiGpuUnitValue(value, unit, pattern) {
  const text = String(value || "").trim();
  if (!text || text === "-") return "-";
  if (pattern.test(text)) return text;
  return `${text}${unit}`;
}
function getAiGpuRequestSummary(request) {
  const lineMap = getConsultingRequestLineMap(request);
  return {
    project: lineMap.get("선택 프로젝트") || "-",
    workload: lineMap.get("워크로드") || request?.inquiryType || "AI/GPU",
    flavor: lineMap.get("희망 GPU Flavor") || "GPU/vGPU 협의",
    gpuCount: lineMap.get("GPU 수량") || "1",
    reservationHours: lineMap.get("예약 시간") || "-",
    storage: lineMap.get("추가 스토리지") || "-",
    floatingIp: lineMap.get("Floating IP") || "-",
    runtime: lineMap.get("드라이버/런타임") || "-",
    timeline: request?.desiredTimeline || lineMap.get("희망 일정") || "-",
    budget: request?.budgetRange || lineMap.get("예산 범위") || "-"
  };
}
function getAiGpuReservationStats(requests) {
  return requests.reduce((acc, request) => {
    const status = String(request?.status || "requested").toLowerCase();
    const summary = getAiGpuRequestSummary(request);
    acc.total += 1;
    if (status === "requested") acc.requested += 1;else if (status === "reviewing") acc.reviewing += 1;else if (status === "answered") acc.answered += 1;else if (status === "closed") acc.closed += 1;
    if (["requested", "reviewing"].includes(status)) {
      acc.activeGpuCount += parseConsultingNumber(summary.gpuCount);
      acc.activeHours += parseConsultingNumber(summary.reservationHours);
    }
    return acc;
  }, {
    total: 0,
    requested: 0,
    reviewing: 0,
    answered: 0,
    closed: 0,
    activeGpuCount: 0,
    activeHours: 0
  });
}
function getConsultingReplyTemplates(request, isGpuRequest, platformStatus) {
  const name = request?.contactName || request?.userName || "고객";
  const summary = getAiGpuRequestSummary(request);
  const context = {
    name,
    project: summary.project,
    workload: summary.workload,
    flavor: summary.flavor,
    gpuCount: formatAiGpuUnitValue(summary.gpuCount, "개", /개|ea|gpu/i),
    reservationHours: formatAiGpuUnitValue(summary.reservationHours, "h", /시간|h|hour/i),
    storage: summary.storage,
    floatingIp: summary.floatingIp,
    runtime: summary.runtime,
    timeline: summary.timeline,
    budget: summary.budget
  };
  const templates = normalizeConsultingReplyTemplates(platformStatus?.consultingReplyTemplates);
  return (isGpuRequest ? templates.aiGpu : templates.general).map(template => ({
    ...template,
    subject: renderConsultingReplyTemplateSubject(template, context),
    note: renderConsultingReplyTemplateNote(template, context)
  }));
}
function getConsultingStatCounts(requests) {
  return requests.reduce((acc, request) => {
    const status = String(request?.status || "requested").toLowerCase();
    acc.total += 1;
    if (status === "requested") acc.requested += 1;else if (status === "reviewing") acc.reviewing += 1;else if (status === "answered") acc.answered += 1;else if (status === "closed") acc.closed += 1;
    if (isAiGpuConsultingRequest(request)) acc.aiGpu += 1;
    return acc;
  }, {
    total: 0,
    requested: 0,
    reviewing: 0,
    answered: 0,
    closed: 0,
    aiGpu: 0
  });
}
function AdminConsultingRequestsTab(props) {
  const requests = Array.isArray(props.adminConsultingRequests) ? props.adminConsultingRequests : [];
  const [statusFilter, setStatusFilter] = useState("active");
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const consultingStats = useMemo(() => getConsultingStatCounts(requests), [requests]);
  const aiGpuRequests = useMemo(() => requests.filter(isAiGpuConsultingRequest), [requests]);
  const aiGpuReservationStats = useMemo(() => getAiGpuReservationStats(aiGpuRequests), [aiGpuRequests]);
  const activeAiGpuRequests = useMemo(() => {
    return aiGpuRequests.filter(request => ["requested", "reviewing"].includes(String(request?.status || "requested").toLowerCase())).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [aiGpuRequests]);
  const applyConsultingReplyTemplate = (request, template) => {
    props.setConsultingReviewDrafts(current => ({
      ...current,
      [request.id]: {
        ...current[request.id],
        status: template.status,
        mailSubject: template.subject,
        adminNote: template.note
      }
    }));
  };
  const filteredRequests = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return requests.filter(request => {
      const status = String(request?.status || "requested").toLowerCase();
      const isGpu = isAiGpuConsultingRequest(request);
      if (statusFilter === "active" && !["requested", "reviewing"].includes(status)) return false;
      if (statusFilter !== "all" && statusFilter !== "active" && status !== statusFilter) return false;
      if (typeFilter === "gpu" && !isGpu) return false;
      if (typeFilter === "general" && isGpu) return false;
      if (keyword && !getConsultingRequestSearchText(request).includes(keyword)) return false;
      return true;
    });
  }, [requests, searchText, statusFilter, typeFilter]);
  return <section className="admin-simple-card">
      <div className="admin-card-header">
        <strong>강의 / 기술 상담 문의</strong>
      </div>
      <div className="settings-panel admin-section-note">
        <div className="card-label">회신 흐름</div>
        <div className="simple-status-list">
          <div>사용자가 남긴 강의 및 기술 상담 문의를 확인합니다.</div>
          <div>상태를 답변 완료로 저장하면 회신 내용이 요청자의 이메일로 발송됩니다.</div>
        </div>
      </div>
      <div className="admin-consulting-summary-grid">
        <button className={`admin-consulting-metric ${statusFilter === "active" && typeFilter === "all" ? "is-active" : ""}`} onClick={() => {
        setStatusFilter("active");
        setTypeFilter("all");
      }} type="button">
          <span>처리 필요</span>
          <strong>{consultingStats.requested + consultingStats.reviewing}</strong>
          <small>{`접수 ${consultingStats.requested} · 검토 ${consultingStats.reviewing}`}</small>
        </button>
        <button className={`admin-consulting-metric ${typeFilter === "gpu" ? "is-active" : ""}`} onClick={() => {
        setStatusFilter("all");
        setTypeFilter(typeFilter === "gpu" ? "all" : "gpu");
      }} type="button">
          <span>AI/GPU</span>
          <strong>{consultingStats.aiGpu}</strong>
          <small>예약·견적 요청</small>
        </button>
        <button className={`admin-consulting-metric ${statusFilter === "answered" && typeFilter === "all" ? "is-active" : ""}`} onClick={() => {
        setStatusFilter("answered");
        setTypeFilter("all");
      }} type="button">
          <span>답변 완료</span>
          <strong>{consultingStats.answered}</strong>
          <small>메일 회신 기준</small>
        </button>
        <button className={`admin-consulting-metric ${statusFilter === "all" && typeFilter === "all" ? "is-active" : ""}`} onClick={() => {
        setStatusFilter("all");
        setTypeFilter("all");
      }} type="button">
          <span>전체 문의</span>
          <strong>{consultingStats.total}</strong>
          <small>{`종료 ${consultingStats.closed}`}</small>
        </button>
      </div>
      <div className="self-service-admin-toolbar admin-consulting-toolbar">
        <input aria-label="상담 문의 검색" placeholder="이름, 이메일, 회사, GPU, 프로젝트, 요구사항 검색" value={searchText} onChange={event => setSearchText(event.target.value)} />
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="상태 필터">
          <option value="active">처리 필요</option>
          <option value="all">전체</option>
          <option value="requested">접수됨</option>
          <option value="reviewing">검토 중</option>
          <option value="answered">답변 완료</option>
          <option value="closed">종료</option>
        </select>
        <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)} aria-label="문의 유형 필터">
          <option value="all">전체 유형</option>
          <option value="gpu">AI/GPU</option>
          <option value="general">일반 상담</option>
        </select>
        <button className="mini-btn" onClick={() => {
        setSearchText("");
        setStatusFilter("active");
        setTypeFilter("all");
      }} type="button">초기화</button>
      </div>
      {aiGpuRequests.length ? <div className="admin-ai-gpu-board" aria-label="AI/GPU 예약 보드">
          <div className="admin-ai-gpu-board-head">
            <div>
              <div className="card-label">AI/GPU 예약 보드</div>
              <strong>GPU 자원 검토가 필요한 요청</strong>
              <p className="hint">사용자 터미널 클라우드에서 들어온 AI/GPU 예약·견적 요청을 먼저 확인합니다.</p>
            </div>
            <button className="mini-btn primary-mini-btn" onClick={() => {
          setStatusFilter("active");
          setTypeFilter("gpu");
          setSearchText("");
        }} type="button">AI/GPU 처리 목록</button>
          </div>
          <div className="admin-ai-gpu-stat-grid">
            <span><em>대기</em><strong>{aiGpuReservationStats.requested}</strong></span>
            <span><em>검토 중</em><strong>{aiGpuReservationStats.reviewing}</strong></span>
            <span><em>활성 GPU</em><strong>{`${aiGpuReservationStats.activeGpuCount}개`}</strong></span>
            <span><em>예약 시간</em><strong>{aiGpuReservationStats.activeHours ? `${aiGpuReservationStats.activeHours}h` : "-"}</strong></span>
          </div>
          <div className="admin-ai-gpu-queue">
            {activeAiGpuRequests.length ? activeAiGpuRequests.slice(0, 4).map(request => {
          const summary = getAiGpuRequestSummary(request);
          return <article className="admin-ai-gpu-card" key={`ai-gpu-board-${request.id}`}>
                  <div className="admin-ai-gpu-card-head">
                    <strong>{request.title || "AI/GPU 랩 요청"}</strong>
                    <span className={`status-chip ${getConsultingRequestStatusTone(request.status)}`}>{getConsultingRequestStatusLabel(request.status)}</span>
                  </div>
                  <div className="admin-ai-gpu-meta-grid">
                    <span><em>프로젝트</em><strong>{summary.project}</strong></span>
                    <span><em>Flavor</em><strong>{summary.flavor}</strong></span>
                    <span><em>GPU</em><strong>{formatAiGpuUnitValue(summary.gpuCount, "개", /개|ea|gpu/i)}</strong></span>
                    <span><em>기간</em><strong>{formatAiGpuUnitValue(summary.reservationHours, "h", /시간|h|hour/i)}</strong></span>
                    <span><em>스토리지</em><strong>{summary.storage}</strong></span>
                    <span><em>일정</em><strong>{summary.timeline}</strong></span>
                  </div>
                  <div className="admin-inline-actions">
                    <button className="mini-btn" onClick={() => {
                setStatusFilter("all");
                setTypeFilter("gpu");
                setSearchText(request.contactEmail || request.title || "");
              }} type="button">
                      회신 영역 열기
                    </button>
                  </div>
                </article>;
        }) : <div className="admin-ai-gpu-empty">
                <strong>현재 처리 중인 AI/GPU 요청이 없습니다.</strong>
                <span>답변 완료 또는 종료된 요청은 아래 목록에서 필터를 전체로 바꿔 확인할 수 있습니다.</span>
              </div>}
          </div>
        </div> : null}
      <div className="admin-table admin-table-scroll">
        <div className="admin-table-head admin-consulting-grid">
          <span>요청 정보</span>
          <span>상태 / 일정</span>
          <span>확인 및 회신</span>
        </div>
        {filteredRequests.length ? filteredRequests.map(request => {
        const draft = props.consultingReviewDrafts?.[request.id] || {};
        const selectedStatus = draft.status || request.status || "requested";
        const isGpuRequest = isAiGpuConsultingRequest(request);
        const highlights = getConsultingRequestHighlights(request);
        const replyTemplates = getConsultingReplyTemplates(request, isGpuRequest, props.platformStatus);
        return <div className="admin-table-row admin-consulting-grid" key={`consulting-${request.id}`}>
              <span>
                <div className="admin-consulting-title-line">
                  <strong>{request.title || "상담 문의"}</strong>
                  <span className={`status-chip ${isGpuRequest ? "is-government" : "is-muted"}`}>{isGpuRequest ? "AI/GPU" : "일반"}</span>
                </div>
                <div className="hint">{`${request.contactName || request.userName || "-"} / ${request.contactEmail || request.email || "-"}`}</div>
                {request.companyName ? <div className="hint">{`회사명: ${request.companyName}`}</div> : null}
                <div className="hint">{`요청 유형: ${request.inquiryType || "-"}`}</div>
                {highlights.length ? <div className="admin-consulting-highlight-list" aria-label="요청 핵심 정보">
                    {highlights.map(item => <span key={`${request.id}-${item.label}`}>
                        <em>{item.label}</em>
                        <strong>{item.value}</strong>
                      </span>)}
                  </div> : null}
                <details className="admin-consulting-details">
                  <summary>전체 요청 내용</summary>
                  {request.industry ? <div className="hint">{`산업군: ${request.industry}`}</div> : null}
                  {request.currentEnvironment ? <div className="hint">{`현재 환경: ${request.currentEnvironment}`}</div> : null}
                  <div className="hint">{`주요 요구사항: ${request.requirements || "-"}`}</div>
                  {request.budgetRange ? <div className="hint">{`예산 범위: ${request.budgetRange}`}</div> : null}
                  {request.desiredTimeline ? <div className="hint">{`희망 일정: ${request.desiredTimeline}`}</div> : null}
                  {request.note ? <div className="hint">{`추가 메모: ${request.note}`}</div> : null}
                </details>
              </span>
              <span>
                <span className={`status-chip ${getConsultingRequestStatusTone(request.status)}`}>{getConsultingRequestStatusLabel(request.status)}</span>
                <div className="hint">{`접수일: ${formatDateTime(request.createdAt)}`}</div>
                <div className="hint">{`최근 검토: ${formatDateTime(request.reviewedAt)}`}</div>
                {request.adminNote ? <div className="hint">{`최근 회신: ${request.adminNote}`}</div> : null}
              </span>
              <div className="admin-inline-actions admin-review-stack">
                <select value={selectedStatus} onChange={event => props.setConsultingReviewDrafts(current => ({
              ...current,
              [request.id]: {
                ...current[request.id],
                status: event.target.value
              }
            }))}>
                  <option value="requested">접수됨</option>
                  <option value="reviewing">검토 중</option>
                  <option value="answered">답변 완료</option>
                  <option value="closed">종료</option>
                </select>
                <div className="admin-reply-template-row" aria-label="빠른 회신 템플릿">
                  {replyTemplates.map(template => <button className="mini-btn" key={template.key} onClick={() => applyConsultingReplyTemplate(request, template)} type="button">
                      {template.label}
                    </button>)}
                </div>
                <textarea placeholder="메일로 보낼 회신 내용을 입력하세요." value={draft.adminNote ?? request.adminNote ?? ""} onChange={event => props.setConsultingReviewDrafts(current => ({
              ...current,
              [request.id]: {
                ...current[request.id],
                adminNote: event.target.value
              }
            }))} />
                <AdminField label="메일 제목" hint="답변 완료 상태로 저장할 때만 실제 메일 제목으로 사용됩니다.">
                  <input value={draft.mailSubject ?? ""} onChange={event => props.setConsultingReviewDrafts(current => ({
                ...current,
                [request.id]: {
                  ...current[request.id],
                  mailSubject: event.target.value
                }
              }))} placeholder={`[Terminal Lab] 상담 문의 회신 - ${request.title || "상담 문의"}`} />
                </AdminField>
                <details className="admin-consulting-mail-preview">
                  <summary>발송 전 미리보기</summary>
                  <div><strong>제목</strong><span>{draft.mailSubject || `[Terminal Lab] 상담 문의 회신 - ${request.title || "상담 문의"}`}</span></div>
                  <pre>{draft.adminNote ?? request.adminNote ?? "회신 내용을 입력하거나 빠른 회신 템플릿을 선택해 주세요."}</pre>
                </details>
                <div className="admin-inline-actions">
                  <button className="mini-btn primary-mini-btn" onClick={() => props.onReviewConsultingRequest(request.id)} type="button">
                    {selectedStatus === "answered" ? "저장 및 메일 회신" : "상태 저장"}
                  </button>
                  <button className="mini-btn" onClick={() => navigate("admin", {
                tab: "mailLogs"
              })} type="button">메일 이력 보기</button>
                </div>
              </div>
            </div>;
      }) : <div className="hint">조건에 맞는 상담 문의가 없습니다.</div>}
      </div>
    </section>;
}
export default function AdminView(props) {
  const setAdminTab = value => setRawAdminTab(current => {
    const next = typeof value === "function" ? value(current) : value;
    return isEducationAdminTab(next) ? "approvalCenter" : next;
  });
  const [rawAdminTab, setRawAdminTab] = useState(() => {
    const tab = readAdminTabFromUrl();
    return isEducationAdminTab(tab) ? "approvalCenter" : tab;
  });
  const adminTab = isEducationAdminTab(rawAdminTab) ? "approvalCenter" : rawAdminTab;
  const [mobileAdminNavOpen, setMobileAdminNavOpen] = useState(false);
  const [adminNavFilter, setAdminNavFilter] = useState("");
  const [adminGlobalSearch, setAdminGlobalSearch] = useState("");
  const [workbenchExpanded, setWorkbenchExpanded] = useState(() => readAdminTabFromUrl() === "approvalCenter");
  const [adminDensity, setAdminDensity] = useState(() => loadStoredAdminValue(ADMIN_DENSITY_STORAGE_KEY, "compact") === "comfortable" ? "comfortable" : "compact");
  const [adminAccessDeniedLine] = useState(getRandomAdminAccessDeniedLine);
  const adminNavFilterInput = useImeBufferedInput(adminNavFilter, setAdminNavFilter);
  const adminGlobalSearchInput = useImeBufferedInput(adminGlobalSearch, setAdminGlobalSearch);
  const [adminFavorites, setAdminFavorites] = useState(loadAdminFavorites);
  const [expandedAdminGroup, setExpandedAdminGroup] = useState(() => getAdminGroupKeyForTab(readAdminTabFromUrl()));
  const allAdminTabs = ADMIN_TAB_GROUPS_CLEAN.flatMap(group => group.tabs.map(tab => ({
    key: tab,
    label: ADMIN_TAB_LABELS_CLEAN[tab] || tab,
    groupKey: group.key,
    groupLabel: group.label
  })));
  const adminTabMap = Object.fromEntries(allAdminTabs.map(item => [item.key, item]));
  const normalizedAdminNavFilter = adminNavFilter.trim().toLowerCase();
  const visibleAdminGroups = ADMIN_TAB_GROUPS_CLEAN.map(group => ({
    ...group,
    tabs: group.tabs.filter(tab => {
      if (!normalizedAdminNavFilter) return true;
      return String(ADMIN_TAB_LABELS_CLEAN[tab] || tab).toLowerCase().includes(normalizedAdminNavFilter);
    })
  })).filter(group => group.tabs.length > 0);
  const favoriteTabs = adminFavorites.filter(tab => ADMIN_TAB_LABELS_CLEAN[tab]);
  const quickTabs = (ADMIN_QUICK_ACTIONS[adminTab] || []).filter(tab => ADMIN_TAB_LABELS_CLEAN[tab] && tab !== adminTab);
  const currentTabIsFavorite = favoriteTabs.includes(adminTab);
  const activeTabMeta = adminTabMap[adminTab] || adminTabMap.monitor;
  const activeTabLabel = activeTabMeta?.label || ADMIN_TAB_LABELS_CLEAN[adminTab] || adminTab;
  const activeTabRenderer = ADMIN_TAB_RENDERERS[adminTab] || ADMIN_TAB_RENDERERS.monitor;
  const todayKey = new Date().toISOString().slice(0, 10);
  const isToday = value => String(value || "").slice(0, 10) === todayKey;
  const formatAdminTimestamp = value => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  };
  const pendingUsers = (props.adminUsers || []).filter(user => String(user.status || "").toLowerCase() !== "approved");
  const pendingCourseAccessRequests = (props.adminCourseAccessRequests || []).filter(request => String(request.status || "").toLowerCase() === "requested");
  const pendingLabApprovals = (props.adminLabs || []).filter(lab => String(lab.status || "").toLowerCase() === "pending");
  const adminNowMs = Date.now();
  const getAdminItemAgeMs = (item, picker = value => value?.createdAt || value?.requestedAt || value?.updatedAt) => {
    const timestamp = getTimestampMs(picker(item));
    return timestamp ? Math.max(0, adminNowMs - timestamp) : 0;
  };
  const pendingDomainApprovals = (props.adminLabs || []).filter(lab => {
    if ((lab.requestedPublicTcpRoutes || []).length) return true;
    if (!(lab.requestedPublicDomains || []).length) return false;
    const course = props.adminCourses?.find(item => Number(item.id) === Number(lab.courseId)) || null;
    return String(course?.publicDomainApprovalMode || "manual").trim().toLowerCase() !== "instant";
  });
  const pendingSshApprovals = (props.adminLabs || []).filter(lab => lab.externalSshRequestPending || lab.externalRdpRequestPending);
  const pendingResizeApprovals = (props.adminLabs || []).filter(lab => lab.resizeRequestPending);
  const unansweredQnaPosts = (props.qnaPosts || []).filter(post => !String(post.answerText || "").trim() && !(post.comments || []).length);
  const unreadAdminMessages = (props.adminMessages || []).filter(item => {
    const recipientUsername = String(item.recipientUsername || "").trim().toLowerCase();
    return recipientUsername && !item.readAt && (recipientUsername === String(props.session?.username || "").trim().toLowerCase() || props.adminUsers?.some(user => String(user.username || "").trim().toLowerCase() === recipientUsername && String(user.role || "") === "admin"));
  });
  const selfServiceProjectRequests = Array.isArray(props.selfServiceProjectRequests) ? props.selfServiceProjectRequests : [];
  const selfServiceVms = Array.isArray(props.selfServiceVms) ? props.selfServiceVms : [];
  const adminCustomLabRequests = Array.isArray(props.adminCustomLabRequests) ? props.adminCustomLabRequests : [];
  const normalizeRequestStatus = item => String(item?.status || "").trim().toLowerCase();
  const hasOperationIssueSignal = adminHasOperationIssueSignal;
  const pendingSelfServiceProjectRequests = selfServiceProjectRequests.filter(request => normalizeRequestStatus(request) === "requested");
  const approvedSelfServiceProjectRequests = selfServiceProjectRequests.filter(request => normalizeRequestStatus(request) === "approved");
  const selfServiceVmWaiting = selfServiceVms.filter(vm => ["requested", "approved"].includes(normalizeRequestStatus(vm)));
  const selfServiceVmProvisioning = selfServiceVms.filter(vm => normalizeRequestStatus(vm) === "provisioning");
  const longWaitingSelfServiceProjects = pendingSelfServiceProjectRequests.filter(request => getAdminItemAgeMs(request) >= ADMIN_LONG_WAIT_THRESHOLD_MS);
  const longWaitingSelfServiceVms = selfServiceVmWaiting.filter(vm => getAdminItemAgeMs(vm) >= ADMIN_LONG_WAIT_THRESHOLD_MS);
  const delayedProvisioningSelfServiceVms = selfServiceVmProvisioning.filter(vm => getAdminItemAgeMs(vm, item => item.updatedAt || item.createdAt || item.requestedAt) >= ADMIN_STUCK_PROVISIONING_THRESHOLD_MS);
  const selfServiceVmIssueCount = selfServiceVms.filter(vm => normalizeRequestStatus(vm) === "failed" || hasOperationIssueSignal(vm)).length;
  const selfServiceProjectIssueCount = selfServiceProjectRequests.filter(request => normalizeRequestStatus(request) === "rejected" || hasOperationIssueSignal(request)).length;
  const selfServiceOperationIssueItems = [...selfServiceProjectRequests.filter(request => normalizeRequestStatus(request) === "rejected" || hasOperationIssueSignal(request)).map(request => ({
    ...request,
    sourceType: "프로젝트",
    sourceKey: "project"
  })), ...selfServiceVms.filter(vm => normalizeRequestStatus(vm) === "failed" || hasOperationIssueSignal(vm)).map(vm => ({
    ...vm,
    sourceType: "VM",
    sourceKey: "vm"
  }))].map(item => {
    const category = getAdminOperationIssueCategory(item);
    const rawDetail = getAdminOperationIssueText(item).replace(/[\r\n]+/g, " ").trim();
    return {
      ...item,
      category,
      issueTitle: getAdminOperationIssueTitle(item),
      issueDetail: rawDetail.length > 180 ? `${rawDetail.slice(0, 180)}…` : rawDetail || category.hint
    };
  });
  const selfServiceAttentionCount = longWaitingSelfServiceProjects.length + longWaitingSelfServiceVms.length + delayedProvisioningSelfServiceVms.length;
  const selfServiceAttentionOldestAt = getOldestTimestamp([...longWaitingSelfServiceProjects, ...longWaitingSelfServiceVms, ...delayedProvisioningSelfServiceVms], item => item.createdAt || item.requestedAt || item.updatedAt);
  const selfServiceAttentionLabels = [longWaitingSelfServiceProjects.length ? `전용 프로젝트 ${longWaitingSelfServiceProjects.length}건` : "", longWaitingSelfServiceVms.length ? `VM 승인 대기 ${longWaitingSelfServiceVms.length}건` : "", delayedProvisioningSelfServiceVms.length ? `생성 지연 ${delayedProvisioningSelfServiceVms.length}건` : ""].filter(Boolean);
  const extensionCleanupWatchCount = [...selfServiceVms, ...(props.zunContainers || []), ...(props.magnumClusters || []), ...(props.troveInstances || []), ...adminCustomLabRequests].filter(item => ["failed", "terminated", "deleted", "stopped", "rejected"].includes(normalizeRequestStatus(item))).length;
  const adminPendingSummaries = [{
    key: "users",
    label: "계정 확인",
    count: pendingUsers.length,
    description: "미승인 사용자",
    tab: "users",
    oldestAt: getOldestTimestamp(pendingUsers)
  }, {
    key: "qna",
    label: "미답변 Q&A",
    count: unansweredQnaPosts.length,
    description: "응답이 필요한 공개 문의",
    tab: "qna",
    oldestAt: getOldestTimestamp(unansweredQnaPosts)
  }, {
    key: "messages",
    label: "미확인 쪽지",
    count: unreadAdminMessages.length,
    description: "관리자 확인 대기 쪽지",
    tab: "messages",
    oldestAt: getOldestTimestamp(unreadAdminMessages)
  }].map(item => {
    const tone = item.count >= 5 ? "high" : item.count >= 2 ? "medium" : item.count === 1 ? "low" : "empty";
    return {
      ...item,
      tone
    };
  }).sort((left, right) => Number(right.count > 0) - Number(left.count > 0) || getTimestampMs(left.oldestAt) - getTimestampMs(right.oldestAt) || right.count - left.count);
  const todayRequestSummaries = [{
    key: "users",
    label: "신규 가입",
    count: (props.adminUsers || []).filter(user => isToday(user.createdAt)).length,
    tab: "users"
  }];
  const todayLabOpsSummaries = [{
    key: "self-service-projects",
    label: "전용 프로젝트",
    count: pendingSelfServiceProjectRequests.length,
    description: longWaitingSelfServiceProjects.length ? `장기 대기 ${longWaitingSelfServiceProjects.length}건 · ${props.platformStatus?.selfServiceVmProjectAutoConfigureEnabled ? "자동 구성" : "수동 준비"}` : `${approvedSelfServiceProjectRequests.length}개 승인 · ${props.platformStatus?.selfServiceVmProjectAutoConfigureEnabled ? "자동 구성" : "수동 준비"}`,
    tab: "cloudConsole",
    searchParams: {
      ssProjectStatus: "requested",
      ssProjectOps: longWaitingSelfServiceProjects.length ? "attention" : "all",
      ssVmStatus: "all",
      ssVmOps: "all"
    },
    tone: longWaitingSelfServiceProjects.length ? "high" : pendingSelfServiceProjectRequests.length ? "medium" : "empty"
  }, {
    key: "self-service-vms",
    label: "VM 생성 흐름",
    count: selfServiceVmWaiting.length + selfServiceVmProvisioning.length,
    description: delayedProvisioningSelfServiceVms.length || longWaitingSelfServiceVms.length ? `장기 대기 ${longWaitingSelfServiceVms.length}건 · 생성 지연 ${delayedProvisioningSelfServiceVms.length}건` : `승인 대기 ${selfServiceVmWaiting.length}건 · 생성 중 ${selfServiceVmProvisioning.length}건`,
    tab: "cloudConsole",
    searchParams: {
      ssProjectStatus: "all",
      ssProjectOps: "all",
      ssVmStatus: "all",
      ssVmOps: delayedProvisioningSelfServiceVms.length || longWaitingSelfServiceVms.length ? "attention" : "active"
    },
    tone: delayedProvisioningSelfServiceVms.length || longWaitingSelfServiceVms.length ? "high" : selfServiceVmProvisioning.length ? "medium" : selfServiceVmWaiting.length ? "medium" : "empty"
  }, {
    key: "self-service-issues",
    label: "실패/Quota 점검",
    count: selfServiceVmIssueCount + selfServiceProjectIssueCount,
    description: "저장된 실패 기록 기준 · 403, Quota, 인증, 네트워크 확인",
    tab: "cloudConsole",
    searchParams: {
      ssProjectStatus: "all",
      ssProjectOps: "issue",
      ssVmStatus: "all",
      ssVmOps: "issue"
    },
    tone: selfServiceVmIssueCount + selfServiceProjectIssueCount ? "high" : "empty"
  }, {
    key: "extension-cleanup",
    label: "잔여 자원 정리",
    count: extensionCleanupWatchCount,
    description: "실패/종료 후 OpenStack/Zun/CAPO/Trove 잔여 확인",
    tab: "openstackCleanup",
    tone: extensionCleanupWatchCount ? "medium" : "empty"
  }];
  const lowSurveyCompletionCourses = (props.adminSurveySummary || []).filter(item => Number(item.accessCount || 0) > 0).map(item => ({
    ...item,
    preCompletionRateValue: item.preCompletionRate == null ? 0 : Number(item.preCompletionRate || 0)
  })).sort((left, right) => left.preCompletionRateValue - right.preCompletionRateValue || Number(right.accessCount || 0) - Number(left.accessCount || 0) || String(left.courseTitle || "").localeCompare(String(right.courseTitle || ""), "ko")).slice(0, 5);
  const recentAdminActivities = [...(props.adminCourseAccessRequests || []).filter(request => request.reviewedAt).map(request => ({
    key: `access-${request.id}`,
    label: String(request.status || "").toLowerCase() === "rejected" ? "과정 거절 처리" : "과정 승인 처리",
    detail: `${request.userName || request.username} / ${request.courseTitle}`,
    at: request.reviewedAt,
    tab: "access"
  })), ...(props.adminLabs || []).filter(lab => lab.publicReviewedAt).map(lab => ({
    key: `domain-${lab.id}-${lab.publicReviewedAt}`,
    label: "도메인 처리",
    detail: `${lab.userName || lab.username} / ${lab.courseTitle}`,
    at: lab.publicReviewedAt,
    tab: "domains"
  })), ...(props.adminLabs || []).filter(lab => lab.externalSshReviewedAt).map(lab => ({
    key: `ssh-${lab.id}-${lab.externalSshReviewedAt}`,
    label: "SSH 처리",
    detail: `${lab.userName || lab.username} / ${lab.courseTitle}`,
    at: lab.externalSshReviewedAt,
    tab: "sshRequests"
  })), ...(props.adminLabs || []).filter(lab => lab.resizeReviewedAt).map(lab => ({
    key: `resize-${lab.id}-${lab.resizeReviewedAt}`,
    label: "리사이즈 처리",
    detail: `${lab.userName || lab.username} / ${lab.courseTitle}`,
    at: lab.resizeReviewedAt,
    tab: "resizeRequests"
  }))].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime()).slice(0, 5);
  const recentAdminMessages = (props.adminMessages || []).filter(item => props.adminUsers?.some(user => String(user.username || "").trim().toLowerCase() === String(item.recipientUsername || "").trim().toLowerCase() && String(user.role || "").trim() === "admin")).slice(0, 5);
  const adminGlobalSearchQuery = adminGlobalSearch.trim();
  const adminGlobalSearchResults = buildAdminGlobalSearchResults(props, allAdminTabs, adminGlobalSearch);
  const guardedAdminProps = {
    ...props,
    onBulkDeleteUsers: () => {
      if (!confirmAdminDangerAction("선택한 사용자를 삭제할까요?", `선택 사용자: ${props.selectedUserIds?.length || 0}명`)) return;
      props.onBulkDeleteUsers?.();
    },
    onDeleteUser: user => {
      const label = user?.name || user?.username || "사용자";
      if (!confirmAdminDangerAction("사용자를 삭제할까요?", `${label} 계정과 관련 운영 데이터에 영향을 줄 수 있습니다.`)) return;
      props.onDeleteUser?.(user);
    },
    onDeleteLabRecords: () => {
      if (!confirmAdminDangerAction("선택한 랩 기록을 삭제할까요?", `선택 랩: ${props.selectedLabIds?.length || 0}개`)) return;
      props.onDeleteLabRecords?.();
    },
    onTerminateLab: labId => {
      const lab = (props.adminLabs || []).find(item => Number(item.id) === Number(labId));
      if (!confirmAdminDangerAction("랩을 삭제할까요?", `${lab?.username || "사용자"} / ${lab?.courseTitle || `랩 #${labId}`}`)) return;
      props.onTerminateLab?.(labId, {
        skipConfirm: true
      });
    },
    onTerminateSelfServiceVm: vmId => {
      const vm = (props.selfServiceVms || []).find(item => Number(item.id) === Number(vmId));
      if (!confirmAdminDangerAction("사용자화 가상머신을 삭제할까요?", vm?.stackName || `VM #${vmId}`)) return false;
      return props.onTerminateSelfServiceVm?.(vmId, {
        skipConfirm: true
      });
    },
    onDeleteZunContainer: containerId => {
      const container = (props.zunContainers || []).find(item => Number(item.id) === Number(containerId));
      if (!confirmAdminDangerAction("컨테이너를 삭제할까요?", container?.name || `컨테이너 #${containerId}`)) return false;
      return props.onDeleteZunContainer?.(containerId);
    },
    onDeleteMagnumCluster: clusterId => {
      const cluster = (props.magnumClusters || []).find(item => Number(item.id) === Number(clusterId));
      if (!confirmAdminDangerAction("Kubernetes 클러스터를 삭제할까요?", cluster?.name || `클러스터 #${clusterId}`)) return false;
      return props.onDeleteMagnumCluster?.(clusterId);
    },
    onDeleteTroveInstance: instanceId => {
      const instance = (props.troveInstances || []).find(item => Number(item.id) === Number(instanceId));
      if (!confirmAdminDangerAction("DB 인스턴스를 삭제할까요?", instance?.name || `DB #${instanceId}`)) return false;
      return props.onDeleteTroveInstance?.(instanceId);
    },
    onTerminateAdminCustomLabRequest: requestId => {
      const request = (props.adminCustomLabRequests || []).find(item => Number(item.id) === Number(requestId));
      if (!confirmAdminDangerAction("고급 랩 자원을 삭제할까요?", request?.courseTitle || `고급 랩 요청 #${requestId}`)) return;
      props.onTerminateAdminCustomLabRequest?.(requestId);
    },
    onDeleteAdminCustomLabQuote: requestId => {
      if (!confirmAdminDangerAction("미제출 고급 랩 견적을 삭제할까요?", `요청 #${requestId}`)) return;
      props.onDeleteAdminCustomLabQuote?.(requestId);
    },
    onDeleteInvite: inviteId => {
      if (!confirmAdminDangerAction("초대 코드를 삭제할까요?", `초대 코드 #${inviteId}`)) return;
      props.onDeleteInvite?.(inviteId);
    },
    onTextbookDelete: textbookId => {
      if (!confirmAdminDangerAction("교재를 삭제할까요?", `교재 #${textbookId}`)) return;
      props.onTextbookDelete?.(textbookId);
    },
    onCourseDelete: courseId => {
      const course = (props.adminCourses || []).find(item => Number(item.id) === Number(courseId));
      if (!confirmAdminDangerAction("과정을 삭제할까요?", course?.title || `과정 #${courseId}`)) return;
      props.onCourseDelete?.(courseId);
    },
    onWrittenExamDelete: courseId => {
      if (!confirmAdminDangerAction("지식 검증을 삭제할까요?", `과정 #${courseId}`)) return;
      props.onWrittenExamDelete?.(courseId);
    },
    onLabExamDelete: courseId => {
      if (!confirmAdminDangerAction("실습 시험을 삭제할까요?", `과정 #${courseId}`)) return;
      props.onLabExamDelete?.(courseId);
    },
    onDeleteLabExamAttempt: (attemptId, options = {}) => {
      if (!options.skipConfirm && !confirmAdminDangerAction("실습 시험 기록을 삭제할까요?", `응시 기록 #${attemptId}`)) return;
      props.onDeleteLabExamAttempt?.(attemptId, {
        skipConfirm: true
      });
    },
    onForceEndLabExamSession: (sessionId, options = {}) => {
      const deleteLab = options.deleteLab !== false;
      const action = deleteLab ? "시험 세션을 강제 종료하고 전용 Heat Stack을 삭제할까요?" : "시험 세션을 강제 종료하고 전용 랩을 정지 보관할까요?";
      if (!options.skipConfirm && !confirmAdminDangerAction(action, `세션 #${sessionId} · 미통과 결과 기록`)) return;
      props.onForceEndLabExamSession?.(sessionId, {
        deleteLab
      });
    },
    onDeleteHeatTemplate: name => {
      if (!confirmAdminDangerAction("Heat 템플릿을 삭제할까요?", name)) return;
      props.onDeleteHeatTemplate?.(name);
    },
    onDeleteApplicationYaml: name => {
      if (!confirmAdminDangerAction("Application YAML을 삭제할까요?", name)) return;
      props.onDeleteApplicationYaml?.(name);
    },
    onDeleteCloudInitTemplate: name => {
      if (!confirmAdminDangerAction("cloud-init 템플릿을 삭제할까요?", name)) return;
      props.onDeleteCloudInitTemplate?.(name);
    },
    onDeleteQnaPost: postId => {
      if (!confirmAdminDangerAction("Q&A 게시글을 삭제할까요?", `게시글 #${postId}`)) return;
      props.onDeleteQnaPost?.(postId);
    },
    onDeleteQnaComment: (postId, commentId) => {
      if (!confirmAdminDangerAction("Q&A 댓글을 삭제할까요?", `게시글 #${postId} / 댓글 #${commentId}`)) return;
      props.onDeleteQnaComment?.(postId, commentId);
    },
    onDeleteMessage: messageId => {
      if (!confirmAdminDangerAction("쪽지를 삭제할까요?", `쪽지 #${messageId}`)) return;
      props.onDeleteMessage?.(messageId);
    }
  };
  Object.entries({
    onBulkDeleteUsers: props.onBulkDeleteUsers,
    onDeleteUser: props.onDeleteUser,
    onDeleteLabRecords: props.onDeleteLabRecords,
    onTerminateLab: props.onTerminateLab,
    onTerminateSelfServiceVm: props.onTerminateSelfServiceVm,
    onDeleteZunContainer: props.onDeleteZunContainer,
    onDeleteMagnumCluster: props.onDeleteMagnumCluster,
    onDeleteTroveInstance: props.onDeleteTroveInstance,
    onTerminateAdminCustomLabRequest: props.onTerminateAdminCustomLabRequest,
    onDeleteAdminCustomLabQuote: props.onDeleteAdminCustomLabQuote,
    onDeleteInvite: props.onDeleteInvite,
    onTextbookDelete: props.onTextbookDelete,
    onCourseDelete: props.onCourseDelete,
    onWrittenExamDelete: props.onWrittenExamDelete,
    onLabExamDelete: props.onLabExamDelete,
    onDeleteLabExamAttempt: props.onDeleteLabExamAttempt,
    onForceEndLabExamSession: props.onForceEndLabExamSession,
    onDeleteHeatTemplate: props.onDeleteHeatTemplate,
    onDeleteApplicationYaml: props.onDeleteApplicationYaml,
    onDeleteCloudInitTemplate: props.onDeleteCloudInitTemplate,
    onDeleteQnaPost: props.onDeleteQnaPost,
    onDeleteQnaComment: props.onDeleteQnaComment,
    onDeleteMessage: props.onDeleteMessage
  }).forEach(([key, original]) => {
    if (!original) guardedAdminProps[key] = original;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ADMIN_FAVORITE_STORAGE_KEY, JSON.stringify(favoriteTabs));
  }, [favoriteTabs]);
  useEffect(() => {
    storeAdminValue(ADMIN_DENSITY_STORAGE_KEY, adminDensity);
  }, [adminDensity]);
  useEffect(() => {
    if (ADMIN_TAB_LABELS_CLEAN[adminTab]) return;
    setAdminTab("approvalCenter");
  }, [adminTab]);
  useEffect(() => {
    writeAdminTabToUrl(adminTab, {
      replace: true
    });
  }, []);
  useEffect(() => {
    const onPopState = () => {
      const nextTab = readAdminTabFromUrl();
      setAdminTab(current => current === nextTab ? current : nextTab);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    if (normalizedAdminNavFilter) return;
    setExpandedAdminGroup(getAdminGroupKeyForTab(adminTab));
  }, [adminTab, normalizedAdminNavFilter]);
  useEffect(() => {
    if (![].includes(adminTab)) return;
    void props.loadAdminCourses?.();
    void props.loadAdminHeatTemplates?.();
    if (adminTab === "labExams") void props.loadLabExams?.();
  }, [adminTab]);
  const openAdminTab = (tab, options = {}) => {
    if (!ADMIN_TAB_LABELS_CLEAN[tab]) return;
    setAdminTab(tab);
    writeAdminTabToUrl(tab, options);
    setMobileAdminNavOpen(false);
  };
  const openOperationIssueItem = item => {
    const searchParams = item?.sourceKey === "project" ? {
      ssProjectStatus: "all",
      ssProjectOps: "issue",
      ssVmStatus: "all",
      ssVmOps: "all"
    } : {
      ssProjectStatus: "all",
      ssProjectOps: "all",
      ssVmStatus: "all",
      ssVmOps: "issue"
    };
    openAdminTab("cloudConsole", {
      searchParams
    });
  };
  const openOperationIssueSettings = item => {
    const targetId = ["network"].includes(item?.category?.key) ? "admin-platform-lab-settings" : "admin-platform-openstack-scope";
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(ADMIN_PLATFORM_FOCUS_STORAGE_KEY, targetId);
      } catch {
        // Tab navigation still works when session storage is unavailable.
      }
    }
    openAdminTab("platform");
  };
  const openAdminSearchResult = result => {
    if (!result?.tab) return;
    openAdminTab(result.tab);
    setAdminGlobalSearch("");
  };
  const toggleFavoriteTab = tab => {
    setAdminFavorites(current => {
      if (current.includes(tab)) {
        return current.filter(item => item !== tab);
      }
      return [...current, tab].slice(0, 8);
    });
  };
  const sessionRoleLabel = String(props.session?.role || "").trim() || "없음";
  const sessionStatusLabel = String(props.session?.status || "").trim() || "없음";
  const sessionNameLabel = String(props.session?.name || props.session?.username || "").trim() || "이름 없음";
  const adminAccessReason = !props.session ? "로그인 세션이 없습니다." : !isAdminUserRole(props.session?.role) ? `현재 계정 권한이 관리자(admin)가 아닙니다. 현재 role: ${sessionRoleLabel}` : props.session?.status && String(props.session.status).trim().toLowerCase() !== "approved" ? `계정 상태가 승인되지 않았습니다. 현재 status: ${sessionStatusLabel}` : "세션은 있으나 관리자 화면 진입 조건을 만족하지 못했습니다.";
  if (!props.session) {
    return <PortalLogin {...props} signupCheck={{
      tone: "",
      message: ""
    }} checkUsername={() => {}} />;
  }
  if (!props.isAdmin) {
    return <div className="shell admin-shell">
        <main className="loading-shell admin-access-denied-shell">
          <div className="loading-card admin-access-denied-card">
            <span className="card-label">Access Control</span>
            <h3>관리자 권한이 필요합니다.</h3>
            <div className="service-ready-terminal" aria-hidden="true">
              <span>&gt;</span>
              <strong>{adminAccessDeniedLine}</strong>
              <i>_</i>
            </div>
            <p>현재 계정으로는 관리자 페이지에 접근할 수 없습니다.</p>
            <div className="inline-message is-info admin-access-diagnostic">
              <div>{`계정: ${sessionNameLabel}`}</div>
              <div>{`role: ${sessionRoleLabel}`}</div>
              <div>{`status: ${sessionStatusLabel}`}</div>
              <div>{`원인: ${adminAccessReason}`}</div>
            </div>
            <button className="primary-btn" onClick={() => navigate("/")} type="button">포털로 돌아가기</button>
          </div>
        </main>
      </div>;
  }
  return <div className="shell admin-shell">
      <ToastStack onDismiss={props.dismissToast} toasts={props.toasts} />
      <AdminSaveDialog dialog={props.adminSaveDialog} onClose={props.closeAdminSaveDialog} />
      <main className={["admin-page", adminTab === "users" ? "is-users-tab" : "", adminDensity === "compact" ? "is-compact-density" : ""].filter(Boolean).join(" ")}>
        <div className="admin-layout">
          <aside className={`admin-nav-panel ${mobileAdminNavOpen ? "is-mobile-open" : ""}`}>
            <div className="sidebar-mobile-head">
              <strong>관리 메뉴</strong>
              <button className="ghost-btn" onClick={() => setMobileAdminNavOpen(false)} type="button">닫기</button>
            </div>
            <div className="admin-nav-brand">
              <strong>TERMINAL LAB</strong>
              <span>관리자 콘솔</span>
            </div>
            <label className="admin-nav-search">
              <span className="card-label">빠른 찾기</span>
              <input type="search" {...adminNavFilterInput} placeholder="메뉴 검색" />
            </label>
            {favoriteTabs.length ? <div className="admin-nav-block">
                <div className="admin-nav-group-title">즐겨찾기</div>
                <div className="admin-favorite-list">
                  {favoriteTabs.map(tab => <button key={`favorite-${tab}`} className={`ghost-btn admin-favorite-chip ${adminTab === tab ? "is-active" : ""}`} onClick={() => openAdminTab(tab)} type="button">
                      {ADMIN_TAB_LABELS_CLEAN[tab]}
                    </button>)}
                </div>
              </div> : null}
            {quickTabs.length ? <div className="admin-nav-block">
                <div className="admin-nav-group-title">빠른 이동</div>
                <div className="admin-favorite-list">
                  {quickTabs.map(tab => <button key={`quick-${tab}`} className="ghost-btn admin-favorite-chip" onClick={() => openAdminTab(tab)} type="button">
                      {ADMIN_TAB_LABELS_CLEAN[tab]}
                    </button>)}
                </div>
              </div> : null}
            <div className="admin-nav-groups" role="tablist" aria-label="admin">
              {visibleAdminGroups.map(group => <section className="admin-nav-group" key={group.key}>
                  <button className={`admin-nav-group-title admin-nav-group-toggle ${expandedAdminGroup === group.key || normalizedAdminNavFilter ? "is-expanded" : ""}`} onClick={() => {
                if (normalizedAdminNavFilter) return;
                setExpandedAdminGroup(current => current === group.key ? "" : group.key);
              }} type="button">
                    <span>{group.label}</span>
                    <span>{expandedAdminGroup === group.key || normalizedAdminNavFilter ? "−" : "+"}</span>
                  </button>
                  {expandedAdminGroup === group.key || normalizedAdminNavFilter ? <div className="tabs admin-tabs">
                      {group.tabs.map(tab => <div className="admin-tab-row" key={tab}>
                          <button className={`tab ${adminTab === tab ? "is-active" : ""}`} onClick={() => {
                    openAdminTab(tab);
                  }} type="button">
                            {ADMIN_TAB_LABELS_CLEAN[tab] || tab}
                          </button>
                          <button aria-label={favoriteTabs.includes(tab) ? "즐겨찾기 해제" : "즐겨찾기 추가"} className={`ghost-btn admin-favorite-toggle ${favoriteTabs.includes(tab) ? "is-active" : ""}`} onClick={() => toggleFavoriteTab(tab)} type="button">
                            {favoriteTabs.includes(tab) ? "★" : "☆"}
                          </button>
                        </div>)}
                    </div> : null}
                </section>)}
            </div>
            {!visibleAdminGroups.length ? <div className="hint">검색 결과가 없습니다.</div> : null}
            <div className="admin-nav-note">
              <strong>{activeTabMeta?.groupLabel || "관리 메뉴"}</strong>
              <span>{`${activeTabLabel} 화면입니다. 즐겨찾기는 최대 8개까지 고정할 수 있습니다.`}</span>
            </div>
          </aside>

          <div className={`admin-main-rail ${adminTab === "users" ? "is-users-tab" : ""}`}>
            <header className="admin-topbar">
              <div className="admin-topbar-title-wrap">
                <div>
                  <div className="admin-title">관리자 콘솔</div>
                  <div className="admin-subtitle">{`${activeTabLabel} · ${activeTabMeta?.groupLabel || "관리"}`}</div>
                </div>
              </div>
              <div className="admin-topbar-actions">
                <div className="admin-density-toggle" aria-label="관리자 화면 밀도">
                  <button className={adminDensity === "comfortable" ? "is-active" : ""} onClick={() => setAdminDensity("comfortable")} type="button">읽기</button>
                  <button className={adminDensity === "compact" ? "is-active" : ""} onClick={() => setAdminDensity("compact")} type="button">운영</button>
                </div>
                <button className="ghost-btn mobile-nav-toggle" onClick={() => setMobileAdminNavOpen(true)} type="button">메뉴</button>
                <button className="ghost-btn" onClick={() => navigate("/")} type="button">포털</button>
                <button className="ghost-btn" onClick={props.onLogout} type="button">로그아웃</button>
              </div>
            </header>

            <section className={`admin-content ${adminTab === "users" ? "is-users-tab" : ""}`}>
              {props.platformStatus?.labCircuitBreaker ? <div className="global-banner is-danger">{props.platformStatus.labCircuitBreakerMessage}</div> : null}
              {props.adminStatus ? <div className="inline-message admin-status-line">{props.adminStatus}</div> : null}
              <section className="simple-info-block admin-global-search-panel">
                <div className="admin-card-header">
                  <div>
                    <p className="card-label">전역 검색</p>
                    <strong>관리 데이터 빠른 이동</strong>
                  </div>
                  <div className="admin-inline-actions">
                    {adminGlobalSearchQuery.length >= 2 ? <span className="hint">{`결과 ${adminGlobalSearchResults.length}건`}</span> : <span className="hint">두 글자 이상 입력</span>}
                    <button className="mini-btn" disabled={!adminGlobalSearchQuery} onClick={() => setAdminGlobalSearch("")} type="button">검색 초기화</button>
                  </div>
                </div>
                <div className="admin-history-search">
                  <input type="search" {...adminGlobalSearchInput} placeholder="사용자, 이메일, Stack, IP, 자원 검색" />
                </div>
                {adminGlobalSearchQuery.length >= 2 ? <div className="admin-activity-list">
                    {adminGlobalSearchResults.length ? adminGlobalSearchResults.map(result => <button className="admin-activity-item" key={result.key} onClick={() => openAdminSearchResult(result)} type="button">
                        <strong>{result.title}</strong>
                        <span>{joinAdminSearchParts([result.category, result.detail, result.meta]) || result.category}</span>
                        <small>{result.badge || ADMIN_TAB_LABELS_CLEAN[result.tab] || result.tab}</small>
                      </button>) : <div className="hint">검색 조건에 맞는 관리자 데이터가 없습니다.</div>}
                  </div> : null}
              </section>
              {adminTab === "platform" ? <section className={`admin-workbench-panel ${workbenchExpanded ? "is-expanded" : "is-collapsed"}`}>
                <div className="admin-workbench-head admin-workbench-toggle">
                  <div>
                    <p className="card-label">관리 워크벤치</p>
                    <strong>{activeTabLabel}</strong>
                    <div className="hint">{`${activeTabMeta?.groupLabel || "관리"} 그룹에 포함된 화면입니다.`}</div>
                  </div>
                  <div className="admin-inline-actions">
                    <button className={`ghost-btn admin-favorite-chip ${currentTabIsFavorite ? "is-active" : ""}`} onClick={() => toggleFavoriteTab(adminTab)} type="button">
                      {currentTabIsFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                    </button>
                    <button className="ghost-btn admin-workbench-toggle-button" onClick={() => setWorkbenchExpanded(current => !current)} type="button">
                      <span className="admin-workbench-toggle-icon" aria-hidden="true">{workbenchExpanded ? "−" : "+"}</span>
                      <span>{workbenchExpanded ? "접기" : "펼치기"}</span>
                    </button>
                  </div>
                </div>
                {workbenchExpanded ? <>
                    <div className="quick-actions-grid admin-approval-queue-grid">
                      {adminPendingSummaries.map(item => <button key={item.key} className={`quick-action-card admin-summary-action is-${item.tone}`} onClick={() => openAdminTab(item.tab)} type="button">
                          <span>{item.label}</span>
                          <strong>{item.count}</strong>
                          <small>{item.count ? `${item.description} · ${formatQueueAge(item.oldestAt)}` : item.description}</small>
                        </button>)}
                    </div>
                    <div className="admin-summary-grid">
                      {todayRequestSummaries.map(item => <article className="admin-summary-item" key={item.key}>
                          <span>{item.label}</span>
                          <strong>{item.count}</strong>
                          <small>오늘 들어온 요청</small>
                        </article>)}
                      <article className="admin-summary-item">
                        <span>즐겨찾기</span>
                        <strong>{favoriteTabs.length}</strong>
                        <small>자주 여는 화면 고정</small>
                      </article>
                    </div>
                    <section className="simple-info-block admin-lab-ops-today">
                      <div className="admin-card-header">
                        <div>
                          <p className="card-label">오늘 연구실/랩 운영</p>
                          <strong>확장 랩 이슈를 한 화면에서 확인</strong>
                        </div>
                        <div className="admin-inline-actions">
                          <button className="mini-btn" onClick={() => openAdminTab("cloudConsole")} type="button">클라우드 콘솔</button>
                          <button className="mini-btn" onClick={() => openAdminTab("openstackCleanup")} type="button">리소스 정리</button>
                        </div>
                      </div>
                      <div className="admin-summary-grid admin-lab-ops-today-grid">
                        {todayLabOpsSummaries.map(item => <button className={`admin-summary-action admin-summary-item is-${item.tone}`} key={item.key} onClick={() => openAdminTab(item.tab, {
                      searchParams: item.searchParams
                    })} type="button">
                            <span>{item.label}</span>
                            <strong>{item.count}</strong>
                            <small>{item.description}</small>
                          </button>)}
                      </div>
                      {selfServiceOperationIssueItems.length ? <details className="admin-lab-ops-issue-list" open>
                          <summary>{`문제 항목 ${selfServiceOperationIssueItems.length}건 보기`}</summary>
                          <p className="hint">이 숫자는 실시간 오류 발생 횟수가 아니라 프로젝트와 VM에 저장된 실패 기록 수입니다.</p>
                          <div className="admin-activity-list">
                            {selfServiceOperationIssueItems.slice(0, 12).map(item => <div className="admin-lab-ops-issue-item" key={`${item.sourceKey}-${item.id}`}>
                                <button className="admin-activity-item" onClick={() => openOperationIssueItem(item)} type="button">
                                  <strong>{`${item.category.label} · ${item.issueTitle}`}</strong>
                                  <span>{`${item.sourceType} · ${item.issueDetail}`}</span>
                                  <small>기록 목록에서 확인</small>
                                </button>
                                {["quota", "permission", "certificate", "network"].includes(item.category.key) ? <button className="mini-btn" onClick={() => openOperationIssueSettings(item)} type="button">관련 설정 수정</button> : null}
                              </div>)}
                          </div>
                          {selfServiceOperationIssueItems.length > 12 ? <div className="hint">{`최근 12건 표시 · 나머지 ${selfServiceOperationIssueItems.length - 12}건은 오류 목록에서 확인`}</div> : null}
                        </details> : null}
                      {selfServiceAttentionCount ? <button className="inline-message is-warning admin-lab-ops-wait-alert" onClick={() => openAdminTab("cloudConsole", {
                    searchParams: {
                      ssProjectStatus: "all",
                      ssProjectOps: "attention",
                      ssVmStatus: "all",
                      ssVmOps: "attention"
                    }
                  })} type="button">
                          <strong>{`장기 대기/생성 지연 ${selfServiceAttentionCount}건`}</strong>
                          <span>{`${selfServiceAttentionLabels.join(" · ")} · 가장 오래된 항목 ${formatQueueAge(selfServiceAttentionOldestAt)}`}</span>
                        </button> : null}
                    </section>
                    <section className="simple-info-block admin-survey-watchlist">
                      <div className="admin-card-header">
                        <div>
                          <p className="card-label">설문 참여율</p>
                          <strong>사전 작성률이 낮은 과정</strong>
                        </div>
                        <button className="mini-btn" onClick={() => openAdminTab("courses")} type="button">과정 관리 열기</button>
                      </div>
                      <div className="simple-status-list">
                        {lowSurveyCompletionCourses.length ? lowSurveyCompletionCourses.map((item, index) => <button className="admin-survey-watchlist-item" key={`survey-watch-${item.courseId}`} onClick={() => openAdminTab("courses")} type="button">
                            <span>{`${index + 1}. ${item.courseTitle}`}</span>
                            <strong>{`${Math.round(item.preCompletionRateValue)}%`}</strong>
                            <small>{`사전 ${item.preCount}/${item.accessCount} · 사후 ${item.postCount} · NPS ${item.nps == null ? "-" : Math.round(item.nps)}`}</small>
                          </button>) : <div className="hint">아직 사전 작성률을 집계할 과정이 없습니다.</div>}
                      </div>
                    </section>
                    <section className="admin-workbench-split">
                      <div className="simple-info-block">
                        <div className="admin-card-header">
                          <div>
                            <p className="card-label">최근 처리</p>
                            <strong>관리자 활동</strong>
                          </div>
                          <button className="mini-btn" onClick={() => openAdminTab("auditLogs")} type="button">감사 로그</button>
                        </div>
                        <div className="admin-activity-list">
                          {recentAdminActivities.length ? recentAdminActivities.map(item => <button className="admin-activity-item" key={item.key} onClick={() => openAdminTab(item.tab)} type="button">
                              <strong>{item.label}</strong>
                              <span>{item.detail}</span>
                              <small>{formatAdminTimestamp(item.at)}</small>
                            </button>) : <div className="hint">최근 처리된 승인/반려 활동이 없습니다.</div>}
                        </div>
                      </div>
                      <div className="simple-info-block">
                        <div className="admin-card-header">
                          <div>
                            <p className="card-label">관리자 쪽지</p>
                            <strong>최근 수신 흐름</strong>
                          </div>
                          <button className="mini-btn" onClick={() => openAdminTab("messages")} type="button">쪽지 관리</button>
                        </div>
                        <div className="admin-activity-list">
                          {recentAdminMessages.length ? recentAdminMessages.map(item => <button className={`admin-activity-item ${item.readAt ? "" : "is-unread"}`} key={`admin-message-${item.id}`} onClick={() => openAdminTab("messages")} type="button">
                              <strong>{item.subject || "제목 없음"}</strong>
                              <span>{`${item.senderName || item.senderUsername || "발신자"} → ${item.recipientUsername || "-"}`}</span>
                              <small>{formatAdminTimestamp(item.createdAt)}</small>
                            </button>) : <div className="hint">최근 관리자 쪽지가 없습니다.</div>}
                        </div>
                      </div>
                    </section>
                  </> : null}
              </section> : null}
              <Suspense fallback={<div className="admin-simple-card"><p className="hint">관리 화면을 불러오는 중입니다.</p></div>}>{activeTabRenderer({
                ...guardedAdminProps,
                adminPendingSummaries,
                onOpenAdminTab: openAdminTab
              })}</Suspense>
            </section>
          </div>
        </div>
      </main>
    </div>;
}
function AdminApprovalCenterTab(props) {
  const openTab = props.onOpenAdminTab || (() => {});
  const pendingUsers = (props.adminUsers || []).filter(user => String(user.status || "").toLowerCase() !== "approved");
  const pendingAccess = (props.adminCourseAccessRequests || []).filter(request => String(request.status || "").toLowerCase() === "requested");
  const pendingLabs = (props.adminLabs || []).filter(lab => String(lab.status || "").toLowerCase() === "pending");
  const pendingDomains = (props.adminLabs || []).filter(lab => {
    if ((lab.requestedPublicTcpRoutes || []).length) return true;
    if (!(lab.requestedPublicDomains || []).length) return false;
    const course = props.adminCourses?.find(item => Number(item.id) === Number(lab.courseId)) || null;
    return String(course?.publicDomainApprovalMode || "manual").trim().toLowerCase() !== "instant";
  });
  const pendingSsh = (props.adminLabs || []).filter(lab => lab.externalSshRequestPending || lab.externalRdpRequestPending);
  const pendingResize = (props.adminLabs || []).filter(lab => lab.resizeRequestPending);
  const pendingQna = (props.qnaPosts || []).filter(post => !String(post.answerText || "").trim() && !(post.comments || []).length);
  const unreadMessages = (props.adminMessages || []).filter(item => {
    const recipientUsername = String(item.recipientUsername || "").trim().toLowerCase();
    return recipientUsername && !item.readAt && (recipientUsername === String(props.session?.username || "").trim().toLowerCase() || props.adminUsers?.some(user => String(user.username || "").trim().toLowerCase() === recipientUsername && String(user.role || "") === "admin"));
  });
  const selfServiceProjectRequests = Array.isArray(props.selfServiceProjectRequests) ? props.selfServiceProjectRequests : [];
  const selfServiceVms = Array.isArray(props.selfServiceVms) ? props.selfServiceVms : [];
  const extensionResources = [...selfServiceVms, ...(props.zunContainers || []), ...(props.magnumClusters || []), ...(props.troveInstances || []), ...(props.adminCustomLabRequests || [])];
  const normalizeOpsStatus = item => String(item?.status || "").trim().toLowerCase();
  const getApprovalItemAgeMs = (item, picker = value => value?.createdAt || value?.requestedAt || value?.updatedAt) => {
    const timestamp = getTimestampMs(picker(item));
    return timestamp ? Math.max(0, Date.now() - timestamp) : 0;
  };
  const pendingSelfServiceProjects = selfServiceProjectRequests.filter(item => normalizeOpsStatus(item) === "requested");
  const waitingSelfServiceVms = selfServiceVms.filter(item => ["requested", "approved"].includes(normalizeOpsStatus(item)));
  const provisioningSelfServiceVms = selfServiceVms.filter(item => normalizeOpsStatus(item) === "provisioning");
  const longWaitingSelfServiceProjects = pendingSelfServiceProjects.filter(item => getApprovalItemAgeMs(item) >= ADMIN_LONG_WAIT_THRESHOLD_MS);
  const longWaitingSelfServiceVms = waitingSelfServiceVms.filter(item => getApprovalItemAgeMs(item) >= ADMIN_LONG_WAIT_THRESHOLD_MS);
  const delayedProvisioningSelfServiceVms = provisioningSelfServiceVms.filter(item => getApprovalItemAgeMs(item, value => value.updatedAt || value.createdAt || value.requestedAt) >= ADMIN_STUCK_PROVISIONING_THRESHOLD_MS);
  const selfServiceIssueItems = [...selfServiceProjectRequests.filter(item => ["failed", "rejected", "error"].includes(normalizeOpsStatus(item)) || adminHasOperationIssueSignal(item)), ...selfServiceVms.filter(item => ["failed", "error"].includes(normalizeOpsStatus(item)) || adminHasOperationIssueSignal(item))];
  const cleanupWatchItems = extensionResources.filter(item => ["failed", "terminated", "deleted", "stopped", "rejected"].includes(normalizeOpsStatus(item)) || adminHasOperationIssueSignal(item));
  const operationIssueItems = Array.from(new Map([...selfServiceIssueItems, ...cleanupWatchItems].map((item, index) => {
    const stableKey = [item?.resourceType || item?.type || item?.kind || "resource", item?.id || item?.stackName || item?.projectName || item?.name || item?.title || index, normalizeOpsStatus(item)].join(":");
    return [stableKey, item];
  })).values());
  const issueCategoryCards = ADMIN_OPERATION_ISSUE_CATEGORIES.map(category => {
    const items = operationIssueItems.filter(item => getAdminOperationIssueCategory(item).key === category.key);
    return {
      ...category,
      count: items.length,
      items
    };
  }).filter(category => category.count > 0);
  const operationIssueSamples = issueCategoryCards.flatMap(category => category.items.slice(0, 2).map(item => ({
    item,
    category
  }))).slice(0, 5);
  const priorityGroups = [{
    key: "self-service-issue",
    label: "오류/Quota 우선",
    count: selfServiceIssueItems.length,
    detail: selfServiceIssueItems.length ? "403, Quota, 인증, 네트워크 실패 신호" : "현재 오류 신호 없음",
    tab: "cloudConsole",
    tone: selfServiceIssueItems.length ? "danger" : "ready",
    searchParams: {
      ssProjectStatus: "all",
      ssProjectOps: "issue",
      ssVmStatus: "all",
      ssVmOps: "issue"
    },
    oldestAt: getOldestTimestamp(selfServiceIssueItems, item => item.updatedAt || item.reviewedAt || item.createdAt || item.requestedAt)
  }, {
    key: "self-service-delay",
    label: "장기 대기/지연",
    count: longWaitingSelfServiceProjects.length + longWaitingSelfServiceVms.length + delayedProvisioningSelfServiceVms.length,
    detail: `프로젝트 ${longWaitingSelfServiceProjects.length} / VM 대기 ${longWaitingSelfServiceVms.length} / 생성 지연 ${delayedProvisioningSelfServiceVms.length}`,
    tab: "cloudConsole",
    tone: longWaitingSelfServiceProjects.length + longWaitingSelfServiceVms.length + delayedProvisioningSelfServiceVms.length ? "warn" : "ready",
    searchParams: {
      ssProjectStatus: "all",
      ssProjectOps: "attention",
      ssVmStatus: "all",
      ssVmOps: "attention"
    },
    oldestAt: getOldestTimestamp([...longWaitingSelfServiceProjects, ...longWaitingSelfServiceVms, ...delayedProvisioningSelfServiceVms], item => item.createdAt || item.requestedAt || item.updatedAt)
  }, {
    key: "self-service-pending",
    label: "전용 프로젝트 승인",
    count: pendingSelfServiceProjects.length,
    detail: props.platformStatus?.selfServiceVmProjectAutoConfigureEnabled ? "승인 시 프로젝트/Quota 자동 구성" : "수동 프로젝트 준비 후 승인",
    tab: "cloudConsole",
    tone: pendingSelfServiceProjects.length ? "info" : "ready",
    searchParams: {
      ssProjectStatus: "requested",
      ssProjectOps: "all",
      ssVmStatus: "all",
      ssVmOps: "all"
    },
    oldestAt: getOldestTimestamp(pendingSelfServiceProjects)
  }, {
    key: "cleanup-watch",
    label: "잔여 자원 정리",
    count: cleanupWatchItems.length,
    detail: cleanupWatchItems.length ? "실패/종료 후 자원 회수 후보" : "정리 후보 없음",
    tab: "openstackCleanup",
    tone: cleanupWatchItems.length ? "warn" : "ready",
    oldestAt: getOldestTimestamp(cleanupWatchItems, item => item.updatedAt || item.createdAt || item.requestedAt)
  }];
  const queueGroups = [{
    key: "users",
    title: "계정 승인",
    tab: "users",
    count: pendingUsers.length,
    oldestAt: getOldestTimestamp(pendingUsers),
    items: pendingUsers.slice(0, 4).map(user => ({
      key: `user-${user.id}`,
      title: user.name || user.username || `사용자 #${user.id}`,
      meta: user.username || "-",
      detail: `가입 ${formatDateTime(user.createdAt)}`
    }))
  }, {
    key: "qna",
    title: "Q&A 응답",
    tab: "qna",
    count: pendingQna.length,
    oldestAt: getOldestTimestamp(pendingQna),
    items: pendingQna.slice(0, 4).map(post => ({
      key: `qna-${post.id}`,
      title: post.title || "문의",
      meta: post.userName || post.username || "-",
      detail: `작성 ${formatDateTime(post.createdAt)}`
    }))
  }, {
    key: "messages",
    title: "관리자 쪽지",
    tab: "messages",
    count: unreadMessages.length,
    oldestAt: getOldestTimestamp(unreadMessages),
    items: unreadMessages.slice(0, 4).map(message => ({
      key: `message-${message.id}`,
      title: message.subject || "제목 없음",
      meta: message.senderName || message.senderUsername || "발신자",
      detail: `수신 ${formatDateTime(message.createdAt)}`
    }))
  }].sort((left, right) => Number(right.count > 0) - Number(left.count > 0) || getTimestampMs(left.oldestAt) - getTimestampMs(right.oldestAt) || right.count - left.count);
  const totalPending = queueGroups.reduce((sum, group) => sum + group.count, 0);
  return <section className="portal-stack admin-approval-center">
      <section className="admin-simple-card">
        <div className="admin-card-header">
          <div>
            <p className="card-label">오늘 처리</p>
            <strong>승인 센터</strong>
            <div className="hint">흩어진 승인·응답 대기 업무를 한 화면에서 먼저 훑고 상세 탭으로 이동합니다.</div>
          </div>
          <div className="admin-inline-actions">
            <span className={`status-chip ${totalPending ? "is-warn" : "is-success"}`}>{`대기 ${totalPending}건`}</span>
          </div>
        </div>
        <div className="admin-summary-grid">
          {queueGroups.slice(0, 4).map(group => <button className={`admin-summary-action admin-summary-item ${group.count ? "is-medium" : "is-empty"}`} key={`approval-summary-${group.key}`} onClick={() => openTab(group.tab)} type="button">
              <span>{group.title}</span>
              <strong>{group.count}</strong>
              <small>{group.count ? formatQueueAge(group.oldestAt) : "대기 없음"}</small>
            </button>)}
        </div>
      </section>

      <section className="admin-simple-card admin-approval-priority-board">
        <div className="admin-card-header">
          <div>
            <p className="card-label">운영 우선순위</p>
            <strong>랩/클라우드 먼저 볼 항목</strong>
            <div className="hint">사용자 터미널 클라우드 요청 큐와 연결되는 지연, Quota, 권한, 잔여 자원 신호입니다.</div>
          </div>
          <button className="mini-btn" onClick={() => openTab("cloudConsole")} type="button">클라우드 콘솔</button>
        </div>
        <div className="admin-approval-priority-grid">
          {priorityGroups.map(item => <button className={`admin-approval-priority-card is-${item.tone}`} key={`approval-priority-${item.key}`} onClick={() => openTab(item.tab, {
          searchParams: item.searchParams
        })} type="button">
              <span>{item.label}</span>
              <strong>{item.count}</strong>
              <small>{item.count && item.oldestAt ? `${item.detail} · ${formatQueueAge(item.oldestAt)}` : item.detail}</small>
            </button>)}
        </div>
        {operationIssueItems.length ? <div className="admin-operation-issue-map" aria-label="OpenStack 실패 원인 분류">
            <div className="admin-operation-issue-map-head">
              <div>
                <strong>OpenStack 실패 원인 지도</strong>
                <span>관리자가 먼저 확인할 가능성이 높은 원인을 Quota, 권한, 인증서, 네트워크, Compute, Heat로 묶었습니다.</span>
              </div>
              <button className="mini-btn" onClick={() => openTab("cloudConsole", {
            searchParams: {
              ssProjectStatus: "all",
              ssProjectOps: "issue",
              ssVmStatus: "all",
              ssVmOps: "issue"
            }
          })} type="button">
                오류 요청 보기
              </button>
            </div>
            <div className="admin-operation-issue-grid">
              {issueCategoryCards.map(category => <button className={`admin-operation-issue-card is-${category.tone}`} key={`operation-issue-category-${category.key}`} onClick={() => openTab("cloudConsole", {
            searchParams: {
              ssProjectStatus: "all",
              ssProjectOps: "issue",
              ssVmStatus: "all",
              ssVmOps: "issue"
            }
          })} type="button">
                  <span>{category.label}</span>
                  <strong>{category.count}</strong>
                  <small>{category.hint}</small>
                </button>)}
            </div>
            {operationIssueSamples.length ? <div className="admin-operation-issue-samples">
                {operationIssueSamples.map(({
            item,
            category
          }, index) => <article className="admin-operation-issue-sample" key={`operation-issue-sample-${item?.id || item?.stackName || item?.name || index}`}>
                    <span className={`status-chip is-${category.tone === "danger" ? "error" : category.tone === "warn" ? "warn" : "muted"}`}>{category.label}</span>
                    <div>
                      <strong>{getAdminOperationIssueTitle(item)}</strong>
                      <small>{truncateMiddleText(getAdminOperationIssueText(item) || "상세 오류 메시지 없음", 92)}</small>
                    </div>
                  </article>)}
              </div> : null}
          </div> : null}
      </section>

      <section className="admin-approval-queue-grid">
        {queueGroups.map(group => <article className={`admin-simple-card admin-approval-queue-card ${group.count ? "" : "is-empty"}`} key={`approval-card-${group.key}`}>
            <div className="admin-card-header">
              <div>
                <strong>{group.title}</strong>
                <div className="hint">{group.count ? `${group.count}건 / ${formatQueueAge(group.oldestAt)}` : "대기 항목 없음"}</div>
              </div>
              <button className="mini-btn" onClick={() => openTab(group.tab)} type="button">처리 화면</button>
            </div>
            <div className="simple-status-list">
              {group.items.length ? group.items.map(item => <button className="admin-approval-preview-item" key={item.key} onClick={() => openTab(group.tab)} type="button">
                  <strong>{item.title}</strong>
                  <span>{item.meta}</span>
                  <small>{item.detail}</small>
                </button>) : <div className="hint">현재 처리할 항목이 없습니다.</div>}
            </div>
          </article>)}
      </section>
    </section>;
}
function AdminUsersTab(props) {
  const [detailUserId, setDetailUserId] = useState(null);
  const [userPage, setUserPage] = useState(1);
  const [userActivityFilter, setUserActivityFilter] = useState("all");
  const detailCloseButtonRef = useRef(null);
  const detailReturnFocusRef = useRef(null);
  const userSearchInput = useImeBufferedInput(props.userSearch || "", props.setUserSearch);
  const usersPerPage = 10;
  const totalUsers = props.adminUsers.length;
  const accessStats = props.adminAccessStats || props.apiMonitor?.access || {};
  const totalConnectedUsers = Number(accessStats.totalConnectedUsers ?? 0);
  const currentConnectedUsers = Number(accessStats.currentConnectedUsers ?? 0);
  const activeWithinMinutes = Number(accessStats.activeWithinMinutes || 2);
  const activeWindowMs = Math.max(1, activeWithinMinutes) * 60 * 1000;
  const isUserOnline = user => {
    if (user?.activeNow) return true;
    const lastActiveMs = user?.lastActiveAt ? new Date(user.lastActiveAt).getTime() : 0;
    return Boolean(lastActiveMs && Date.now() - lastActiveMs <= activeWindowMs);
  };
  const searchFilteredUsers = Array.isArray(props.filteredUsers) ? props.filteredUsers : [];
  const onlineFilteredUsers = searchFilteredUsers.filter(isUserOnline);
  const visibleUsers = userActivityFilter === "online" ? onlineFilteredUsers : searchFilteredUsers;
  const filteredUserCount = visibleUsers.length;
  const totalUserPages = Math.max(1, Math.ceil(filteredUserCount / usersPerPage));
  const clampedUserPage = Math.min(userPage, totalUserPages);
  const pageStartIndex = (clampedUserPage - 1) * usersPerPage;
  const pageUsers = visibleUsers.slice(pageStartIndex, pageStartIndex + usersPerPage);
  const currentPageUserIds = pageUsers.map(user => user.id);
  const detailUser = props.adminUsers.find(user => user.id === detailUserId) ?? null;
  const getUserIdKey = id => String(id ?? "");
  const selectedUserIds = Array.isArray(props.selectedUserIds) ? props.selectedUserIds : [];
  const selectedUserIdKeys = new Set(selectedUserIds.map(getUserIdKey));
  const selectedUsers = props.adminUsers.filter(user => selectedUserIdKeys.has(getUserIdKey(user.id)));
  const selectedUserCount = selectedUsers.length;
  const selectedUsersWithoutSupportAccess = selectedUsers.filter(user => !user.supportMessageEnabled).length;
  const selectedUsersWithSupportAccess = selectedUsers.filter(user => user.supportMessageEnabled).length;
  const selectedUsersWithoutLabAccess = selectedUsers.filter(user => !user.selfServiceVmEnabled).length;
  const selectedUsersWithLabAccess = selectedUsers.filter(user => user.selfServiceVmEnabled).length;
  const selectedUsersWithoutFreeAccess = selectedUsers.filter(user => !user.pocFreeAccessEnabled).length;
  const selectedUsersWithFreeAccess = selectedUsers.filter(user => user.pocFreeAccessEnabled).length;
  const canIssueInstructorShare = user => String(user?.role || "").trim().toLowerCase() === "admin" || Boolean(user?.instructorShareEnabled);
  const selectedUsersWithoutInstructorShareAccess = selectedUsers.filter(user => !canIssueInstructorShare(user)).length;
  const selectedUsersWithInstructorShareAccess = selectedUsers.filter(canIssueInstructorShare).length;
  const describeAdminPermissions = user => {
    if (String(user?.role || "").trim().toLowerCase() === "admin") return "전체 관리자(role)";
    const permissions = normalizeAdminPermissions(user?.adminPermissions);
    if (permissions.includes("admin:all")) return "전체 관리자 위임";
    if (permissions.includes("admin:access")) return `관리자 콘솔 접근 · ${permissions.length}개`;
    return permissions.length ? `위임 권한 ${permissions.length}개` : "관리 권한 없음";
  };
  const toggleUserAdminPermission = (user, key) => {
    const current = normalizeAdminPermissions(user?.adminPermissions);
    let next = current.includes(key) ? current.filter(item => item !== key) : [...current, key];
    if (!["admin:access", "admin:all"].includes(key) && !next.includes("admin:access")) {
      next = ["admin:access", ...next];
    }
    return props.onUserPatch(user.id, user.role, user.status, {
      adminPermissions: next
    });
  };
  const isUserSelected = userId => selectedUserIdKeys.has(getUserIdKey(userId));
  const selectedActionUserIds = selectedUsers.map(user => user.id);
  const mergeUserSelection = (current, ids) => {
    const next = [];
    const seen = new Set();
    for (const id of [...(Array.isArray(current) ? current : []), ...(Array.isArray(ids) ? ids : [])]) {
      const key = getUserIdKey(id);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      next.push(id);
    }
    return next;
  };
  const removeUserSelection = (current, ids) => {
    const removeKeys = new Set((Array.isArray(ids) ? ids : []).map(getUserIdKey));
    return (Array.isArray(current) ? current : []).filter(id => !removeKeys.has(getUserIdKey(id)));
  };
  const openUserDetail = (userId, event) => {
    detailReturnFocusRef.current = event.currentTarget;
    setDetailUserId(userId);
  };
  const patchSelectedUsers = async patch => {
    if (!selectedUserCount) return;
    await Promise.all(selectedUsers.map(user => props.onUserPatch(user.id, user.role, user.status, patch)));
  };
  const applyBulkLabAccess = enabled => {
    if (props.onBulkSetSelfServiceVmAccess) return props.onBulkSetSelfServiceVmAccess(selectedActionUserIds, enabled);
    return patchSelectedUsers({
      selfServiceVmEnabled: enabled
    });
  };
  const applyBulkFreeAccess = enabled => {
    if (props.onBulkSetPocFreeAccess) return props.onBulkSetPocFreeAccess(selectedActionUserIds, enabled);
    return patchSelectedUsers({
      pocFreeAccessEnabled: enabled
    });
  };
  const applyBulkSupportAccess = enabled => {
    if (props.onBulkSetSupportMessageAccess) return props.onBulkSetSupportMessageAccess(selectedActionUserIds, enabled);
    return patchSelectedUsers({
      supportMessageEnabled: enabled
    });
  };
  const applyBulkInstructorShareAccess = enabled => patchSelectedUsers({
    instructorShareEnabled: enabled
  });
  useEffect(() => {
    if (props.userSearch || !props.setUserSearch) return;
    const storedSearch = loadStoredAdminValue(ADMIN_USER_SEARCH_STORAGE_KEY, "");
    if (storedSearch) props.setUserSearch(storedSearch);
  }, []);
  useEffect(() => {
    storeAdminValue(ADMIN_USER_SEARCH_STORAGE_KEY, props.userSearch || "");
  }, [props.userSearch]);
  useEffect(() => {
    setUserPage(1);
  }, [props.userSearch, userActivityFilter, filteredUserCount]);
  useEffect(() => {
    if (userPage > totalUserPages) setUserPage(totalUserPages);
  }, [totalUserPages, userPage]);
  useEffect(() => {
    if (!detailUser) return undefined;
    const onKeyDown = event => {
      if (event.key === "Escape") {
        setDetailUserId(null);
      }
    };
    window.requestAnimationFrame(() => detailCloseButtonRef.current?.focus());
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (detailReturnFocusRef.current && document.contains(detailReturnFocusRef.current)) {
        detailReturnFocusRef.current.focus();
      }
    };
  }, [detailUser]);
  const requiredActiveTerms = ["standard_terms", "service_additional_terms"].map(key => (props.activeTerms || []).find(term => term.termsKey === key)).filter(Boolean);
  const detailUserAgreementHashes = new Set((detailUser?.termsAgreements || []).map(term => `${term.termsKey || term.terms_key}:${term.contentHash || term.content_hash}`));
  const detailUserMissingActiveTerms = requiredActiveTerms.length < 2 ? [] : requiredActiveTerms.filter(term => !detailUserAgreementHashes.has(`${term.termsKey}:${term.contentHash}`));
  const detailUserTermsStatus = requiredActiveTerms.length < 2 ? detailUser?.termsAgreementStatus || "활성 약관 미설정" : detailUserMissingActiveTerms.length ? "활성 약관 동의 필요" : "모든 약관 확인 및 동의 하였음";
  const detailAssignCourseId = Number(props.adminCourseAssignForm?.courseId || 0);
  const detailAssignedCourseIds = new Set((detailUser?.enrolledCourses || []).map(course => Number(course.courseId || course.id)).filter(Boolean));
  const detailAssignAlreadyEnrolled = Boolean(detailAssignCourseId && detailAssignedCourseIds.has(detailAssignCourseId));
  const describeUserSource = source => {
    switch (String(source || "")) {
      case "admin_manual":
        return "관리자 생성";
      case "admin_temporary":
        return "관리자 임시 생성";
      case "service_validation":
        return "서비스 검증";
      case "system_default_admin":
        return "시스템 기본 관리자";
      default:
        return "일반 가입";
    }
  };
  return <section className="portal-stack">
        <div className="admin-users-overview-grid">
          <article className="admin-summary-card">
            <span className="card-label">전체 사용자</span>
            <strong>{`${totalUsers}명`}</strong>
            <div className="hint">{props.userSearch ? `검색 결과 ${filteredUserCount}명` : "등록된 계정 수"}</div>
          </article>
          <article className="admin-summary-card">
            <span className="card-label">총 접속 인원</span>
            <strong>{`${totalConnectedUsers}명`}</strong>
            <div className="hint">한 번 이상 접속한 사용자</div>
          </article>
          <article className="admin-summary-card">
            <span className="card-label">현재 접속 인원</span>
            <strong>{`${currentConnectedUsers || onlineFilteredUsers.length}명`}</strong>
            <div className="hint">{`${activeWithinMinutes}분 내 활동 기준`}</div>
            <button className={`mini-btn admin-summary-filter-btn ${userActivityFilter === "online" ? "is-active" : ""}`} onClick={() => setUserActivityFilter(current => current === "online" ? "all" : "online")} type="button">
              {userActivityFilter === "online" ? "전체 사용자 보기" : "접속 사용자만 보기"}
            </button>
          </article>
          <article className="admin-summary-card">
            <span className="card-label">미승인 사용자</span>
            <strong>{`${props.filteredUnapprovedUserIds?.length || 0}명`}</strong>
            <div className="hint">현재 필터 기준</div>
          </article>
        </div>

        <details className="admin-simple-card admin-users-setup-disclosure">
          <summary>
            <span>
              <strong>사용자 생성 도구</strong>
              <small>개별 생성과 임시 사용자 일괄 생성을 펼쳐서 사용합니다.</small>
            </span>
            <span className="admin-disclosure-indicator" aria-hidden="true">펼치기</span>
          </summary>
          <div className="admin-users-setup-grid">
            <section className="admin-users-setup-card">
              <div className="admin-card-header">
              <div>
                <strong>사용자 생성</strong>
                <p className="hint">개별 계정을 바로 추가할 때 사용하는 빠른 생성 폼입니다.</p>
              </div>
              </div>
              <form className="admin-form" onSubmit={props.onCreateAdminUser}>
                <div className="admin-form-grid compact-admin-grid admin-users-setup-fields">
                  <AdminField label="이름" required><input value={props.adminUserForm.name} onChange={event => props.setAdminUserForm(current => ({
                  ...current,
                  name: event.target.value
                }))} placeholder="예: 홍길동" /></AdminField>
                  <AdminField label="이메일"><input value={props.adminUserForm.email} onChange={event => props.setAdminUserForm(current => ({
                  ...current,
                  email: event.target.value
                }))} placeholder="예: user@example.com" /></AdminField>
                  <AdminField label="아이디" required><input value={props.adminUserForm.username} onChange={event => props.setAdminUserForm(current => ({
                  ...current,
                  username: event.target.value
                }))} placeholder="예: student01" /></AdminField>
                  <AdminField label="초기 비밀번호" required><input type="password" value={props.adminUserForm.password} onChange={event => props.setAdminUserForm(current => ({
                  ...current,
                  password: event.target.value
                }))} placeholder="8자 이상" /></AdminField>
                  <AdminField label="권한">
                    <select value={props.adminUserForm.role} onChange={event => props.setAdminUserForm(current => ({
                  ...current,
                  role: event.target.value
                }))}>
                      <option value="student">일반 사용자</option>
                      <option value="admin">관리자</option>
                    </select>
                  </AdminField>
                  <AdminField label="상태">
                    <select value={props.adminUserForm.status} onChange={event => props.setAdminUserForm(current => ({
                  ...current,
                  status: event.target.value
                }))}>
                      <option value="approved">승인</option>
                      <option value="pending">미승인</option>
                    </select>
                  </AdminField>
                </div>
                <div className="admin-inline-actions admin-users-setup-actions">
                  <button className="mini-btn primary-mini-btn" type="submit">사용자 생성</button>
                </div>
              </form>
            </section>

            <section className="admin-users-setup-card">
              <div className="admin-card-header">
                <div>
                  <strong>임시 사용자 일괄 생성</strong>
                  <p className="hint">`user1 ~ user10` 형태로 여러 계정을 빠르게 만들고 임시 생성 분류로 관리합니다.</p>
                </div>
              </div>
              <form className="admin-form" onSubmit={props.onCreateAdminBatchUsers}>
                <div className="admin-form-grid compact-admin-grid admin-users-setup-fields">
                  <AdminField label="아이디 접두어" required><input value={props.adminBatchUserForm.usernamePrefix} onChange={event => props.setAdminBatchUserForm(current => ({
                  ...current,
                  usernamePrefix: event.target.value
                }))} placeholder="예: user" /></AdminField>
                  <AdminField label="이름 접두어"><input value={props.adminBatchUserForm.namePrefix} onChange={event => props.setAdminBatchUserForm(current => ({
                  ...current,
                  namePrefix: event.target.value
                }))} placeholder="예: user" /></AdminField>
                  <AdminField label="시작 번호" required><input type="number" min="1" value={props.adminBatchUserForm.startNumber} onChange={event => props.setAdminBatchUserForm(current => ({
                  ...current,
                  startNumber: event.target.value
                }))} /></AdminField>
                  <AdminField label="끝 번호" required><input type="number" min="1" value={props.adminBatchUserForm.endNumber} onChange={event => props.setAdminBatchUserForm(current => ({
                  ...current,
                  endNumber: event.target.value
                }))} /></AdminField>
                  <AdminField label="초기 비밀번호" required><input type="password" value={props.adminBatchUserForm.password} onChange={event => props.setAdminBatchUserForm(current => ({
                  ...current,
                  password: event.target.value
                }))} placeholder="8자 이상" /></AdminField>
                  <AdminField label="상태">
                    <select value={props.adminBatchUserForm.status} onChange={event => props.setAdminBatchUserForm(current => ({
                  ...current,
                  status: event.target.value
                }))}>
                      <option value="approved">승인</option>
                      <option value="pending">미승인</option>
                    </select>
                  </AdminField>
                </div>
                <div className="admin-inline-actions admin-users-setup-actions">
                  <button className="mini-btn primary-mini-btn" type="submit">임시 사용자 일괄 생성</button>
                </div>
              </form>
            </section>
          </div>
        </details>

        <section className="admin-simple-card admin-users-card">
          <div className="admin-card-header">
            <div>
              <strong>사용자 관리</strong>
              <div className="hint">{filteredUserCount ? `${pageStartIndex + 1}-${Math.min(pageStartIndex + pageUsers.length, filteredUserCount)} / ${filteredUserCount}명 표시` : "표시할 사용자가 없습니다."}</div>
            </div>
            <div className="admin-card-tools">
              <input className="admin-search" {...userSearchInput} placeholder="검색" />
              <button className={`mini-btn ${userActivityFilter === "online" ? "primary-mini-btn" : "neutral-mini-btn"}`} onClick={() => setUserActivityFilter(current => current === "online" ? "all" : "online")} type="button">
                {userActivityFilter === "online" ? `접속 중 ${onlineFilteredUsers.length}명` : "접속 중만 보기"}
              </button>
              <button className="mini-btn neutral-mini-btn" disabled={!props.filteredUnapprovedUserIds?.length} onClick={props.onSelectUnapprovedUsers} type="button">미승인만 선택</button>
              <button className="mini-btn approve-btn" disabled={!props.filteredUnapprovedUserIds?.length} onClick={props.onBulkApproveUnapprovedUsers} type="button">미승인 전체 승인</button>
              <button className="mini-btn primary-mini-btn" disabled={!selectedUserCount} onClick={props.onBulkApprove} type="button">선택 승인</button>
              <button className="mini-btn danger-mini-btn" disabled={!selectedUserCount} onClick={props.onBulkDeleteUsers} type="button">선택 삭제</button>
            </div>
          </div>
          <div className="admin-inline-actions admin-user-toolbar-actions">
            <span className="hint">{`선택 사용자: ${selectedUserCount}명`}</span>
            <span className="hint">{`미승인 사용자: ${props.filteredUnapprovedUserIds?.length || 0}명`}</span>
            {userActivityFilter === "online" ? <span className="status-chip is-online">{`현재 접속 필터 적용 중 · ${filteredUserCount}명`}</span> : null}


          </div>
          <details className="admin-user-bulk-access-panel">
            <summary>
              <span>선택 사용자 권한 일괄 적용</span>
              <small>{selectedUserCount ? `지원 미수신 ${selectedUsersWithoutSupportAccess}명 · 공유 발급 미허용 ${selectedUsersWithoutInstructorShareAccess}명 · 클라우드 사용 해제 ${selectedUsersWithoutLabAccess}명 · 무료 미허용 ${selectedUsersWithoutFreeAccess}명` : "사용자를 선택하면 지원/클라우드/무료 권한을 한 번에 적용할 수 있습니다."}</small>
            </summary>
            <div className="admin-user-bulk-access-grid">
              <div>
                <strong>운영지원 메시지</strong>
                <p className="hint">{selectedUserCount ? `수신 ${selectedUsersWithSupportAccess}명 · 미수신 ${selectedUsersWithoutSupportAccess}명` : "운영지원 그룹 수신 대상을 일괄 조정합니다."}</p>
              </div>
              <div className="admin-inline-actions">
                <button className="mini-btn approve-btn" disabled={!selectedUserCount || !selectedUsersWithoutSupportAccess} onClick={() => applyBulkSupportAccess(true)} type="button">선택 지원 수신 허용</button>
                <button className="mini-btn" disabled={!selectedUserCount || !selectedUsersWithSupportAccess} onClick={() => applyBulkSupportAccess(false)} type="button">선택 지원 수신 해제</button>
              </div>

              <div className="admin-inline-actions">


              </div>
              <div>
                <strong>클라우드 콘솔</strong>
                <p className="hint">{selectedUserCount ? `허용 ${selectedUsersWithLabAccess}명 · 제한 ${selectedUsersWithoutLabAccess}명` : "선택 사용자에게 신청 가능 여부를 일괄 적용합니다."}</p>
              </div>
              <div className="admin-inline-actions">
                <button className="mini-btn approve-btn" disabled={!selectedUserCount || !selectedUsersWithoutLabAccess} onClick={() => applyBulkLabAccess(true)} type="button">선택 클라우드 사용 허용</button>
                <button className="mini-btn" disabled={!selectedUserCount || !selectedUsersWithLabAccess} onClick={() => applyBulkLabAccess(false)} type="button">선택 클라우드 사용 해제</button>
              </div>
              <div>
                <strong>고급 랩 무료 생성</strong>
                <p className="hint">{selectedUserCount ? `무료 허용 ${selectedUsersWithFreeAccess}명 · 유료 기준 ${selectedUsersWithoutFreeAccess}명` : "무료 대상 사용자와 유료 PoC 사용자를 구분합니다."}</p>
              </div>
              <div className="admin-inline-actions">
                <button className="mini-btn approve-btn" disabled={!selectedUserCount || !selectedUsersWithoutFreeAccess} onClick={() => applyBulkFreeAccess(true)} type="button">선택 고급 랩 무료 허용</button>
                <button className="mini-btn" disabled={!selectedUserCount || !selectedUsersWithFreeAccess} onClick={() => applyBulkFreeAccess(false)} type="button">선택 고급 랩 무료 해제</button>
              </div>
            </div>
          </details>

          <div className="admin-table admin-users-table">
            <div className="admin-table-head admin-user-grid">
              <span>
                <input checked={pageUsers.length > 0 && pageUsers.every(user => isUserSelected(user.id))} onChange={event => event.target.checked ? props.setSelectedUserIds(current => mergeUserSelection(current, currentPageUserIds)) : props.setSelectedUserIds(current => removeUserSelection(current, currentPageUserIds))} type="checkbox" />
              </span>
                <span>이름</span>
                <span>아이디</span>
                <span>권한 / 구분</span>
                <span>상태 / 분류</span>
                <span>작업</span>
            </div>

            {pageUsers.map(user => <div className="admin-table-row admin-user-grid" key={user.id}>
                <span>
                  <input checked={isUserSelected(user.id)} onChange={event => event.target.checked ? props.setSelectedUserIds(current => mergeUserSelection(current, [user.id])) : props.setSelectedUserIds(current => removeUserSelection(current, [user.id]))} type="checkbox" />
                </span>
                <span>
                  <button className="link-btn" onClick={event => openUserDetail(user.id, event)} type="button">
                    {user.name}
                  </button>
                  {isUserOnline(user) ? <span className="admin-user-online-badge" title={`${activeWithinMinutes}분 이내 활동이 확인되었습니다.`}>
                      <span aria-hidden="true" />
                      접속 중
                    </span> : user.lastActiveAt ? <div className="hint">{`최근 활동 ${formatDateTime(user.lastActiveAt)}`}</div> : null}
                </span>
                <span>{user.username}</span>
                <span>
                  <div>{user.role === "admin" ? "관리자" : "일반 사용자"}</div>
                  <div className="hint">{describeAdminPermissions(user)}</div>
                  <div className="hint">{user.supportMessageEnabled ? "운영지원 수신" : "일반 사용자"}</div>

                  <div className="hint">{user.selfServiceVmEnabled ? "클라우드 콘솔 허용" : "클라우드 콘솔 제한"}</div>
                  <div className="hint">{user.pocFreeAccessEnabled ? "고급 랩 무료 생성 허용" : "고급 랩 유료 기준"}</div>
                </span>
                <span>
                  <div>{user.status === "approved" ? "승인" : "미승인"}</div>
                  {isUserOnline(user) ? <span className="status-chip is-online">현재 접속</span> : null}
                  {user.accountSharingRestricted ? <>
                      <span className="status-chip is-error">접근 제한</span>
                      <div className="hint">{`해제 예정 ${user.activeAccessRestriction?.restrictedUntil || "-"}`}</div>
                    </> : null}
                  <div className="hint">{describeUserSource(user.userSource)}</div>
                </span>
                <div className="admin-user-row-actions">
                  <div className="admin-inline-actions admin-user-row-actions-primary">
                    {user.accountSharingRestricted ? <button className="mini-btn danger-mini-btn" onClick={() => props.onClearAccountSharingRestriction?.(user)} type="button">제한 해제</button> : null}

                    {user.status === "approved" ? <button className="mini-btn" onClick={() => props.onUserPatch(user.id, user.role, user.status, {
                status: "pending"
              })} type="button">미승인</button> : <button className="mini-btn approve-btn" onClick={() => props.onUserPatch(user.id, user.role, user.status, {
                status: "approved"
              })} type="button">승인</button>}
                    <button className="mini-btn" onClick={event => openUserDetail(user.id, event)} type="button">
                      상세 보기
                    </button>

                  </div>
                  <details className="admin-user-row-actions-secondary">
                    <summary>추가 작업</summary>
                    <div className="admin-inline-actions">
                      <button className="mini-btn" onClick={() => props.onUserPatch(user.id, user.role, user.status, {
                  supportMessageEnabled: !user.supportMessageEnabled
                })} type="button">
                        {user.supportMessageEnabled ? "지원 수신 해제" : "지원 수신"}
                      </button>

                      <button className="mini-btn" onClick={() => props.onUserPatch(user.id, user.role, user.status, {
                  selfServiceVmEnabled: !user.selfServiceVmEnabled
                })} type="button">
                        {user.selfServiceVmEnabled ? "클라우드 사용 해제" : "클라우드 사용 허용"}
                      </button>
                      <button className="mini-btn" onClick={() => props.onUserPatch(user.id, user.role, user.status, {
                  pocFreeAccessEnabled: !user.pocFreeAccessEnabled
                })} type="button">
                        {user.pocFreeAccessEnabled ? "고급 랩 무료 해제" : "고급 랩 무료 허용"}
                      </button>
                      <button className="mini-btn" onClick={() => props.onIssueResetPin(user)} type="button">PIN 발급</button>
                      <button className="mini-btn reset-btn" onClick={() => props.onResetPassword(user)} type="button">비밀번호 초기화</button>
                      <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteUser(user)} type="button">삭제</button>
                    </div>
                    <div className="admin-user-rbac-panel">
                      <strong>관리자 위임 권한</strong>
                      <p className="hint">전체 관리자 role 없이도 필요한 관리자 메뉴 접근을 사용자별로 위임합니다.</p>
                      <div className="admin-user-rbac-grid">
                        {ADMIN_PERMISSION_OPTIONS.map(option => {
                    const permissions = normalizeAdminPermissions(user.adminPermissions);
                    const isRoleAdmin = user.role === "admin";
                    const checked = isRoleAdmin || permissions.includes(option.key);
                    return <label className="admin-user-rbac-option" key={`${user.id}-${option.key}`}>
                              <input checked={checked} disabled={isRoleAdmin} onChange={() => toggleUserAdminPermission(user, option.key)} type="checkbox" />
                              <span>
                                <strong>{option.label}</strong>
                                <small>{option.description}</small>
                              </span>
                            </label>;
                  })}
                      </div>
                    </div>
                  </details>
                </div>
              </div>)}
            {!pageUsers.length ? <div className="admin-table-row admin-users-empty-row">검색 조건에 맞는 사용자가 없습니다.</div> : null}
          </div>

          <div className="admin-users-pagination" aria-label="사용자 페이지">
            <button className="mini-btn" disabled={clampedUserPage <= 1} onClick={() => setUserPage(current => Math.max(1, current - 1))} type="button">이전</button>
            <span>{`${clampedUserPage} / ${totalUserPages}`}</span>
            <button className="mini-btn" disabled={clampedUserPage >= totalUserPages} onClick={() => setUserPage(current => Math.min(totalUserPages, current + 1))} type="button">다음</button>
          </div>

          {props.issuedResetPinInfo ? <div className="simple-info-block">
              <strong>{`${props.issuedResetPinInfo.user?.name || props.issuedResetPinInfo.user?.username || "사용자"} PIN 발급 완료`}</strong>
              <div>{`PIN: ${props.issuedResetPinInfo.pin}`}</div>
              <div>{`만료: ${props.issuedResetPinInfo.expiresAt || "-"}`}</div>
              <p className="hint">PIN은 1회용이며 15분 안에 사용해야 합니다.</p>
            </div> : null}

          {props.adminPasswordResetPins?.length ? <div className="admin-table">
              <div className="admin-card-header">
                <strong>사용 가능한 PIN</strong>
                <span className="hint">만료되거나 사용된 PIN은 자동 정리됩니다.</span>
              </div>
              <div className="admin-table-head admin-user-grid">
                <span>사용자</span>
                <span>아이디</span>
                <span>발급자</span>
                <span>발급 / 만료</span>
                <span>상태</span>
                <span>시도</span>
              </div>
              {props.adminPasswordResetPins.map(item => <div className="admin-table-row admin-user-grid" key={item.id}>
                  <span>{item.name || "-"}</span>
                  <span>{item.username || "-"}</span>
                  <span>{item.issuedByName || item.issuedByUsername || "-"}</span>
                  <span>
                    <div>{item.createdAt || "-"}</div>
                    <div className="hint">{`만료 ${item.expiresAt || "-"}`}</div>
                  </span>
                  <span>{item.usedAt ? "사용 완료" : "사용 가능"}</span>
                  <span>{item.attemptCount ?? 0}</span>
                </div>)}
            </div> : null}

          {detailUser ? <div className="user-detail-modal-backdrop" onMouseDown={() => setDetailUserId(null)} role="presentation">
              <section aria-labelledby="user-detail-modal-title" aria-modal="true" className="simple-panel user-detail-panel user-detail-modal" onMouseDown={event => event.stopPropagation()} role="dialog">
                <div className="admin-card-header">
                <div>
                  <strong id="user-detail-modal-title">사용자 상세 정보</strong>
                  <div className="hint">{`${detailUser.name || "-"} · ${detailUser.username || "-"} · ${detailUser.email || "이메일 없음"}`}</div>
                </div>
                <div className="admin-inline-actions">
                  <button className="mini-btn" onClick={() => setDetailUserId(null)} ref={detailCloseButtonRef} type="button">닫기</button>
                </div>
                </div>
                <div className="user-detail-modal-body">
                  <div className="user-detail-grid">
                <div><span className="card-label">이름</span><strong>{detailUser.name}</strong></div>
                <div className="user-detail-terms-inline">
                  <div className="admin-card-header">
                    <div>
                      <span className="card-label">약관 동의</span>
                      <strong>{detailUserTermsStatus}</strong>
                    </div>
                    <span className="hint">{`${(detailUser.termsAgreements || []).length}건`}</span>
                  </div>
                  {(detailUser.termsAgreements || []).length ? <div className="user-detail-enrollment-list compact">
                      {(detailUser.termsAgreements || []).map((term, index) => <div className="user-detail-enrollment-item" key={`user-terms-${detailUser.id}-${term.termsKey}-${term.version}-${index}`}>
                          <div>
                            <strong>{term.title || (term.termsKey === "standard_terms" ? "표준약관" : "서비스 추가 약관")}</strong>
                            <div className="hint">{`${term.version || "-"} / ${term.agreedAt || "-"}`}</div>
                          </div>
                          <span className="status-pill success">동의</span>
                        </div>)}
                    </div> : <div className="hint">약관 동의 이력이 없습니다. 활성 약관이 있으면 다음 로그인 후 동의 전까지 서비스 이용이 제한됩니다.</div>}
                  {detailUserMissingActiveTerms.length ? <div className="hint danger-text">{`미동의 활성 약관: ${detailUserMissingActiveTerms.map(term => term.title || term.termsKey).join(", ")}`}</div> : null}
                </div>
                <div><span className="card-label">아이디</span><strong>{detailUser.username}</strong></div>
                <div><span className="card-label">이메일</span><strong>{detailUser.email || "-"}</strong></div>
                <div><span className="card-label">권한</span><strong>{detailUser.role === "admin" ? "관리자" : "일반 사용자"}</strong></div>
                <div><span className="card-label">관리자 위임</span><strong>{describeAdminPermissions(detailUser)}</strong></div>
                <div><span className="card-label">상태</span><strong>{detailUser.status === "approved" ? "승인" : "미승인"}</strong></div>
                <div>
                  <span className="card-label">계정 공유 제한</span>
                  <strong>{detailUser.accountSharingRestricted ? "접근 제한 중" : "제한 없음"}</strong>
                  {detailUser.accountSharingRestricted ? <>
                      <div className="hint">{`해제 예정 ${detailUser.activeAccessRestriction?.restrictedUntil || "-"}`}</div>
                      <button className="mini-btn danger-mini-btn" onClick={() => props.onClearAccountSharingRestriction?.(detailUser)} type="button">제한 해제</button>
                    </> : null}
                </div>
                <div><span className="card-label">분류</span><strong>{describeUserSource(detailUser.userSource)}</strong></div>
                <div><span className="card-label">가입일시</span><strong>{detailUser.createdAt || "-"}</strong></div>
                <div><span className="card-label">가입 사유</span><strong>{detailUser.signupReason || "-"}</strong></div>
                <div><span className="card-label">마케팅 이메일</span><strong>{detailUser.marketingEmailConsent ? "수신 동의" : "미동의"}</strong></div>
                <div><span className="card-label">운영지원 메시지</span><strong>{detailUser.supportMessageEnabled ? "수신 가능" : "수신 안 함"}</strong></div>

                <div><span className="card-label">클라우드 콘솔</span><strong>{detailUser.selfServiceVmEnabled ? "사용 가능" : "사용 제한"}</strong></div>
                <div><span className="card-label">고급 랩 무료 생성</span><strong>{detailUser.pocFreeAccessEnabled ? "허용" : "미허용"}</strong></div>
                  </div>

                </div>
              </section>
            </div> : null}
        </section>
      </section>;
}

export function buildGuestPreviewPreview(course, options = {}) {
  if (!course) return null;
  const normalizedCourse = course;
  const isExplicitPreview = Boolean(options.isExplicitPreview);
  const courseTypeLabel = normalizedCourse.courseType === "online" ? "온라인 과정" : normalizedCourse.courseType === "exam" ? "시험 과정" : normalizedCourse.courseType === "package" ? "과정·시험 패키지" : "일반 과정";
  const priceLabel = formatCoursePriceLabel(normalizedCourse);
  const durationLabel = formatCourseDuration(normalizedCourse.duration);
  const labEnabledLabel = normalizedCourse.labEnabled ? "랩 포함" : "랩 미사용";
  const approvalLabel = normalizedCourse.labApprovalMode === "instant" ? "즉시 시작" : "승인 후 시작";
  const retentionLabel = normalizedCourse.labEnabled ? String(normalizedCourse.labRetentionMode || "ephemeral") === "persistent" ? `${Math.max(1, Number(normalizedCourse.labRetentionDays || normalizedCourse.labRetentionPreset || 1) || 1)}일 유지` : "세션형 랩" : "랩 미사용";
  const terminalUser = String(normalizedCourse.terminalSshUser || "rocky").trim() || "rocky";
  const firstObjective = (normalizedCourse.objectives || [])[0] || "공개 커리큘럼 요약을 먼저 확인";
  const secondObjective = (normalizedCourse.objectives || [])[1] || "학습 목표와 진행 순서를 파악";
  const categoryLabel = normalizedCourse.category || "카테고리 미지정";
  return {
    title: normalizedCourse.title || "공개 과정",
    subtitle: isExplicitPreview ? "과정 관리에서 미리보기 과정으로 체크된 공개 과정을 우선 노출합니다." : "맛보기 과정이 아직 지정되지 않아, 현재 공개 과정 중 하나를 먼저 보여주고 있습니다.",
    badge: isExplicitPreview ? "로그인 없이 확인" : "공개 과정 미리보기",
    description: normalizedCourse.body || normalizedCourse.summary || "과정 흐름과 결과 화면을 로그인 전에 미리 확인할 수 있습니다.",
    chips: [{
      label: courseTypeLabel,
      tone: "is-success"
    }, {
      label: categoryLabel,
      tone: "is-muted"
    }, {
      label: durationLabel,
      tone: "is-muted"
    }, {
      label: labEnabledLabel,
      tone: normalizedCourse.labEnabled ? "is-success" : "is-muted"
    }],
    lines: [{
      label: "선택 과정",
      value: normalizedCourse.title || "공개 과정"
    }, {
      label: "가격",
      value: priceLabel
    }, {
      label: "학습 방식",
      value: "자기 주도형 맛보기"
    }, {
      label: "진행 방식",
      value: normalizedCourse.labEnabled ? `${approvalLabel} / ${retentionLabel}` : "설명과 결과 화면 미리보기"
    }],
    phases: [{
      label: "과정 확인",
      summary: "과정 설명과 전달 목표를 먼저 학습합니다.",
      description: "공개된 과정 설명, 차시, 예상 필요 시간만 먼저 확인합니다. 로그인이나 요청은 아직 하지 않습니다.",
      statusRows: [{
        label: "과정 유형",
        value: courseTypeLabel
      }, {
        label: "카테고리",
        value: categoryLabel
      }, {
        label: "예상 기간",
        value: durationLabel
      }, {
        label: "전달 목표",
        value: firstObjective
      }],
      console: []
    }, {
      label: normalizedCourse.labEnabled ? "접속 준비" : "학습 준비",
      summary: normalizedCourse.labEnabled ? "랩 입장 전에 준비 화면을 보여줍니다." : "랩이 없는 과정은 학습 안내를 보여줍니다.",
      description: normalizedCourse.labEnabled ? "실제 랩 생성 전에 진입 직전 준비 화면을 샘플로 보여줍니다. 상태, 대표 IP, 접속 방식까지 여기서 먼저 확인합니다." : "랩이 없는 과정은 학습 자료와 진행 순서를 중심으로 맛보기 화면을 보여줍니다.",
      statusRows: normalizedCourse.labEnabled ? [{
        label: "상태",
        value: approvalLabel
      }, {
        label: "대표 IP",
        value: "192.0.2.34"
      }, {
        label: "고정 IP",
        value: "192.0.2.34 (fixed)"
      }, {
        label: "외부 SSH",
        value: `${terminalUser}@ssh.example.com:2200`
      }, {
        label: "요청 URL",
        value: "preview.apps.example.com"
      }] : [{
        label: "학습 방식",
        value: "자기 주도형 맛보기"
      }, {
        label: "학습 순서",
        value: secondObjective
      }, {
        label: "안내",
        value: "로그인 후 과정이 활성화됩니다."
      }],
      console: []
    }, {
      label: normalizedCourse.labEnabled ? "결과 화면 확인" : "결과 확인",
      summary: normalizedCourse.labEnabled ? "실제 브라우저 터미널 화면 예시를 봅니다." : "결과 화면을 샘플로 봅니다.",
      description: normalizedCourse.labEnabled ? "마지막 단계에서는 브라우저 터미널이 어떤 모습으로 보이는지 샘플 세션을 보여줍니다. 실제 접속과 이어하기는 로그인 후 가능합니다." : "결과 로그와 학습 흐름은 샘플 세션으로 보여주고, 실제 이어보기는 로그인 후에 이어집니다.",
      console: [{
        prefix: "[연결]",
        text: `${terminalUser}@lab-preview:22`
      }, {
        prefix: "$",
        text: "pwd"
      }, {
        prefix: "-",
        text: "/workspace/lab-preview"
      }, {
        prefix: "$",
        text: "cat mission.txt"
      }, {
        prefix: "-",
        text: secondObjective
      }, {
        prefix: "$",
        text: `whoami # ${terminalUser}`
      }]
    }]
  };
}
export function buildPublicCourseTickerItems(courses) {
  if (Array.isArray(courses) && courses.length) {
    return courses.map(course => ({
      label: `${course.title} · ${course.courseType === "online" ? "온라인" : "일반"} · ${course.level || "과정"}`
    }));
  }
  return [{
    label: "Linux 기초 실습 · 일반 · 입문"
  }, {
    label: "Kubernetes 운영 입문 · 일반 · 초급"
  }, {
    label: "OpenStack 첫 미리보기 · 일반 · 중급"
  }, {
    label: "GPU / vGPU 환경 체험 · 일반 · 중급"
  }, {
    label: "컨테이너 기초 흐름 · 온라인 · 입문"
  }, {
    label: "AI 실습 환경 시작하기 · 온라인 · 초급"
  }];
}
export function truncateMiddleText(value, maxLength = 34) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(10, maxLength - 3))}...`;
}


















function AdminManualTab(props) {
 const sections = [
  ["users", "계정·권한", "일반 사용자 생성·승인·비밀번호 재설정을 처리합니다. 관리자 계정·권한 변경은 전체 관리자만 할 수 있습니다."],
  ["cloudConsole", "클라우드 자원", "전용 프로젝트와 VM·볼륨·네트워크·콘솔 요청을 관리합니다."],
  ["sso", "SSO·OTP", "설치 환경의 공급자 앱과 인증 정책을 설정하고 실제 로그인 흐름을 확인합니다."],
  ["qna", "커뮤니티·지원", "공지·게시물·쪽지·문의와 운영 응답을 관리합니다."],
  ["templates", "배포 템플릿", "Heat·Application YAML·cloud-init을 설치 환경에 맞게 관리합니다."],
  ["platform", "연동·운영", "LLM·메일·OpenStack 주소를 직접 설정합니다. 전체 DB 백업·복원은 전체 관리자 전용입니다."],
  ["securityInspection", "점검·감사", "권한 범위에 따라 보안점검·접속·감사 로그와 운영 상태를 확인합니다."],
 ];
 return <section className="portal-stack"><section className="admin-simple-card"><div className="admin-card-header"><strong>기능별 운영 매뉴얼</strong></div><div className="admin-summary-grid">{sections.map(([tab,title,body])=><article className="admin-summary-card" key={tab}><strong>{title}</strong><p>{body}</p><button className="mini-btn" type="button" onClick={()=>props.onOpenAdminTab?.(tab)}>열기</button></article>)}</div></section></section>;
}





function getQnaDraftKey(postId, parentCommentId = null) {
  return parentCommentId ? `comment:${postId}:${parentCommentId}` : `post:${postId}`;
}
function canDeleteQnaPost(props, post) {
  return Boolean(props.isAdmin) || Number(post.userId || 0) === Number(props.session?.id || 0);
}
function canDeleteQnaComment(props, comment) {
  return Boolean(props.isAdmin) || Number(comment.userId || 0) === Number(props.session?.id || 0);
}
function canManageQnaPost(props, post) {
  return Boolean(props.isAdmin) || Number(post.userId || 0) === Number(props.session?.id || 0);
}
const QNA_POST_TYPES = [{
  value: "question",
  label: "질문"
}, {
  value: "error",
  label: "오류 로그"
}, {
  value: "tip",
  label: "팁/노하우"
}, {
  value: "resource",
  label: "자료 공유"
}, {
  value: "project",
  label: "프로젝트"
}, {
  value: "study",
  label: "스터디 모집"
}, {
  value: "free",
  label: "자유글"
}, {
  value: "notice",
  label: "공지"
}];
function getQnaPostTypeLabel(value) {
  return QNA_POST_TYPES.find(item => item.value === String(value || "question"))?.label || "질문";
}
function QnaCommentThread({
  props,
  post,
  comment,
  comments,
  depth = 0,
  replyOpenMap,
  setReplyOpenMap
}) {
  const replyMapKey = `${post.id}:${comment.id}`;
  const draftKey = getQnaDraftKey(post.id, comment.id);
  const isReplyOpen = Boolean(replyOpenMap[replyMapKey]);
  const childComments = comments.filter(item => Number(item.parentCommentId || 0) === Number(comment.id));
  const isAccepted = Number(post.acceptedCommentId || 0) === Number(comment.id || 0);
  return <div className={`qna-comment qna-comment-depth-${Math.min(depth, 3)} ${isAccepted ? "is-accepted" : ""}`}>
      <div className="qna-comment-meta">
        <span>{comment.userName} ({comment.username})</span>
        {isAccepted ? <span className="status-chip is-success">채택 답변</span> : null}
      </div>
      <div className="qna-comment-body">{comment.body}</div>
      <div className="qna-comment-actions">
        <button className="mini-btn" onClick={() => setReplyOpenMap(current => ({
        ...current,
        [replyMapKey]: !current[replyMapKey]
      }))} type="button">
          {isReplyOpen ? "답글 닫기" : "댓글 쓰기"}
        </button>
        {canDeleteQnaComment(props, comment) ? <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteQnaComment(post.id, comment.id)} type="button">삭제</button> : null}
        {!isAccepted && canManageQnaPost(props, post) ? <button className="mini-btn primary-mini-btn" onClick={() => props.onAcceptQnaComment?.(post.id, comment.id)} type="button">답변 채택</button> : null}
      </div>
      {isReplyOpen ? <div className="nested-reply-block">
          <textarea value={props.qnaCommentDrafts[draftKey] ?? ""} onChange={event => props.setQnaCommentDrafts(current => ({
        ...current,
        [draftKey]: event.target.value
      }))} placeholder="이 댓글 아래에 답글을 입력해 주세요." />
          <button className="mini-btn primary-mini-btn" onClick={() => props.onCreateQnaComment(post.id, comment.id)} type="button">댓글 쓰기</button>
        </div> : null}
      {childComments.length ? <div className="qna-comment-children">
          {childComments.map(child => <QnaCommentThread key={child.id} props={props} post={post} comment={child} comments={comments} depth={depth + 1} replyOpenMap={replyOpenMap} setReplyOpenMap={setReplyOpenMap} />)}
        </div> : null}
    </div>;
}
function QnaThreadCard({
  props,
  post,
  replyOpenMap,
  setReplyOpenMap,
  replyPlaceholder,
  registerButtonClass = "ghost-btn"
}) {
  const rootReplyKey = `post:${post.id}`;
  const rootDraftKey = getQnaDraftKey(post.id);
  const isRootReplyOpen = Boolean(replyOpenMap[rootReplyKey]);
  const topLevelComments = (post.comments || []).filter(comment => !comment.parentCommentId);
  const qnaStatus = getQnaStatus(post);
  const canManage = canManageQnaPost(props, post);
  const helpfulCount = Math.max(0, Number(post.helpfulCount || 0) || 0);
  return <article className="qna-thread" key={post.id}>
      <div className="qna-thread-head">
        <strong>{post.title}</strong>
        <div className="admin-inline-actions">
          <span>{post.userName} ({post.username})</span>
          <span className={`status-chip ${qnaStatus.tone}`}>{qnaStatus.label}</span>
        </div>
      </div>
      <div className="qna-tag-row">
        <span className="status-chip is-muted">{getQnaPostTypeLabel(post.postType)}</span>
        {post.courseTitle ? <span className="status-chip is-muted">{post.courseTitle}</span> : null}
        {post.labRequestId ? <span className="status-chip is-warn">{`랩 #${post.labRequestId}${post.labStatus ? ` · ${post.labStatus}` : ""}`}</span> : null}
        <span className="status-chip is-muted">{`댓글 ${(post.comments || []).length}`}</span>
        <span className="status-chip is-muted">{`도움돼요 ${helpfulCount}`}</span>
      </div>
      {post.courseTitle ? <div className="qna-head"><strong>관련 과정</strong><span>{post.courseTitle}</span></div> : null}
      {post.labRequestId ? <div className="qna-head">
          <strong>연결 랩</strong>
          <span>{[`#${post.labRequestId}`, post.labStackName || post.labContext?.stackName, post.labInstanceIp || post.labContext?.instanceIp].filter(Boolean).join(" · ")}</span>
        </div> : null}
      <div className="qna-post-body">{post.body}</div>
      {post.answerText ? <div className="qna-answer">
          <strong>기존 관리자 답변</strong>
          <p>{post.answerText}</p>
        </div> : null}
      <div className="qna-post-actions">
        <button className="mini-btn" onClick={() => setReplyOpenMap(current => ({
        ...current,
        [rootReplyKey]: !current[rootReplyKey]
      }))} type="button">
          {isRootReplyOpen ? "댓글 닫기" : "댓글 쓰기"}
        </button>
        <button className="mini-btn" onClick={() => props.onMarkQnaHelpful?.(post.id)} type="button">{`도움돼요 ${helpfulCount}`}</button>
        {canManage && String(post.status || "") !== "solved" ? <button className="mini-btn primary-mini-btn" onClick={() => props.onSetQnaStatus?.(post.id, "solved")} type="button">해결됨</button> : null}
        {canManage && String(post.status || "") === "solved" ? <button className="mini-btn" onClick={() => props.onSetQnaStatus?.(post.id, "in_progress")} type="button">다시 열기</button> : null}
        {canDeleteQnaPost(props, post) ? <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteQnaPost(post.id)} type="button">게시글 삭제</button> : null}
      </div>
      {topLevelComments.length ? <div className="qna-comment-list">
          {topLevelComments.map(comment => <QnaCommentThread key={comment.id} props={props} post={post} comment={comment} comments={post.comments || []} replyOpenMap={replyOpenMap} setReplyOpenMap={setReplyOpenMap} />)}
        </div> : <p className="hint">등록된 댓글이 없습니다.</p>}
      {isRootReplyOpen ? <div className="qna-reply-block">
          <textarea value={props.qnaCommentDrafts[rootDraftKey] ?? ""} onChange={event => props.setQnaCommentDrafts(current => ({
        ...current,
        [rootDraftKey]: event.target.value
      }))} placeholder={replyPlaceholder} />
          <button className={registerButtonClass} onClick={() => props.onCreateQnaComment(post.id)} type="button">댓글 쓰기</button>
        </div> : null}
    </article>;
}
function AdminQnaTab(props) {
  const [replyOpenMap, setReplyOpenMap] = useState({});
  const [search, setSearch] = useState("");
  const searchInput = useImeBufferedInput(search, setSearch);
  const [showUnansweredOnly, setShowUnansweredOnly] = useState(false);
  const [courseFilter, setCourseFilter] = useState("");
  const query = String(search || "").trim().toLowerCase();
  const filteredPosts = (props.qnaPosts || []).filter(post => {
    const matchesCourse = !courseFilter || String(post.courseId || "") === String(courseFilter);
    const matchesSearch = !query || [post.title, post.body, post.userName, post.username, post.courseTitle, post.answerText, ...(post.comments || []).flatMap(comment => [comment.body, comment.userName, comment.username])].some(value => String(value || "").toLowerCase().includes(query));
    const hasAnswer = Boolean(String(post.answerText || "").trim()) || Boolean((post.comments || []).length);
    const matchesFilter = !showUnansweredOnly || !hasAnswer;
    return matchesCourse && matchesSearch && matchesFilter;
  });
  return <section className="portal-stack">
      <section className="admin-simple-card admin-course-card">
        <div className="admin-card-header"><strong>커뮤니티 관리</strong></div>
        <p className="hint">과정별 커뮤니티 글을 확인하고, 관리자도 공지성 글이나 댓글 답변을 바로 남길 수 있습니다.</p>
        <form className="qna-form" onSubmit={props.onCreateQna}>
          <div className="community-compose-grid">
            <select value={props.qnaForm.postType || "question"} onChange={event => props.setQnaForm(current => ({
            ...current,
            postType: event.target.value
          }))}>
              {QNA_POST_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <select value={props.qnaForm.courseId || ""} onChange={event => props.setQnaForm(current => ({
            ...current,
            courseId: event.target.value,
            labRequestId: ""
          }))}>
              <option value="">과정 미지정</option>
              {(props.adminCourses || []).map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
            </select>
            <select value={props.qnaForm.labRequestId || ""} onChange={event => {
            const selectedLab = (props.adminLabs || []).find(lab => String(lab.id) === String(event.target.value));
            props.setQnaForm(current => ({
              ...current,
              labRequestId: event.target.value,
              courseId: selectedLab?.courseId ? String(selectedLab.courseId) : current.courseId
            }));
          }}>
              <option value="">랩 연결 없음</option>
              {(props.adminLabs || []).map(lab => <option key={lab.id} value={lab.id}>{`${lab.courseTitle || `과정 #${lab.courseId || "-"}`} · 랩 #${lab.id} · ${lab.status || "상태 없음"}`}</option>)}
            </select>
          </div>
          <input value={props.qnaForm.title} onChange={event => props.setQnaForm(current => ({
          ...current,
          title: event.target.value
        }))} placeholder="관리자 질문 또는 테스트 제목" />
          <textarea value={props.qnaForm.body} onChange={event => props.setQnaForm(current => ({
          ...current,
          body: event.target.value
        }))} placeholder="관리자 테스트 문의나 공지성 질문을 입력해 주세요." />
          <button className="mini-btn primary-mini-btn" type="submit">등록</button>
        </form>
      </section>
      <section className="admin-simple-card admin-course-card">
        <div className="admin-history-search">
          <select value={courseFilter} onChange={event => setCourseFilter(event.target.value)}>
            <option value="">전체 과정</option>
            {(props.adminCourses || []).map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
          </select>
          <input type="search" {...searchInput} placeholder="제목, 내용, 작성자, 댓글로 검색" />
          <label className="admin-filter-inline">
            <input checked={showUnansweredOnly} onChange={event => setShowUnansweredOnly(event.target.checked)} type="checkbox" />
            <span className="hint">미답변만 보기</span>
          </label>
        </div>
        <div className="qna-board admin-table-scroll">
          {filteredPosts.length ? filteredPosts.map(post => <QnaThreadCard key={post.id} props={props} post={post} replyOpenMap={replyOpenMap} setReplyOpenMap={setReplyOpenMap} replyPlaceholder="댓글로 답변을 입력해 주세요." registerButtonClass="mini-btn primary-mini-btn" />) : <div className="hint">{(props.qnaPosts || []).length ? "검색 조건에 맞는 커뮤니티 글이 없습니다." : "아직 등록된 커뮤니티 글이 없습니다."}</div>}
        </div>
      </section>
    </section>;
}
function AdminMessagesTab(props) {
  const [search, setSearch] = useState("");
  const searchInput = useImeBufferedInput(search, setSearch);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [showCleanupOnly, setShowCleanupOnly] = useState(false);
  const [cleanupStatusNotes, setCleanupStatusNotes] = useState({});
  const [recipientSearch, setRecipientSearch] = useState("");
  const recipientSearchInput = useImeBufferedInput(recipientSearch, setRecipientSearch);
  const [showRecipientSearch, setShowRecipientSearch] = useState(false);
  const composeRef = useRef(null);
  const supportGroupName = props.platformStatus?.supportMessageGroupName || "운영지원";
  const supportAvailabilityMode = String(props.platformStatus?.supportAvailabilityMode || "available").trim().toLowerCase() === "away" ? "away" : "available";
  const supportMembers = (props.adminUsers || []).filter(user => String(user.status || "").trim() === "approved" && (String(user.role || "").trim().toLowerCase() === "admin" || Boolean(user.supportMessageEnabled)));
  const fallbackSupportRecipient = {
    id: "group:support",
    name: supportGroupName,
    username: "support",
    role: "group",
    recipientType: "group",
    groupKey: "support",
    groupName: supportGroupName,
    memberCount: 0,
    representativeUsername: "",
    representativeName: ""
  };
  const availableRecipients = (props.messageRecipients || []).length ? props.messageRecipients : [fallbackSupportRecipient];
  const query = String(search || "").trim().toLowerCase();
  const recipientQuery = String(recipientSearch || "").trim().toLowerCase();
  const replyRecipientId = String(props.messageForm.recipientId || "").trim();
  const replyTargetLabel = String(props.messageForm.replyToLabel || "").trim();
  const replyPreview = String(props.messageForm.replyToPreview || "").trim();
  const unreadCount = (props.adminMessages || []).filter(item => !item.readAt).length;
  const isTerminalCloudCleanupMessage = item => {
    const text = [item.subject, item.body, item.recipientGroupName, item.recipientName].map(value => String(value || "").toLowerCase()).join(" ");
    return text.includes("터미널 클라우드") && (text.includes("정리 요청") || text.includes("잔여 자원") || text.includes("실패 자원"));
  };
  const getCleanupMessageTargets = item => {
    if (!isTerminalCloudCleanupMessage(item)) return [];
    const text = [item.subject, item.body].map(value => String(value || "").toLowerCase()).join(" ");
    const targets = [];
    const addTarget = tab => {
      if (!targets.some(target => target.tab === tab)) {
        targets.push({
          tab,
          label: ADMIN_TAB_LABELS_CLEAN[tab] || tab
        });
      }
    };
    if (/(self-vm|self_service|selfservice|heatstack|vm|인스턴스|가상머신|프로젝트|네트워크|포트|볼륨|보안그룹)/.test(text)) addTarget("cloudConsole");
    if (/(octavia|load.?balancer|로드.?밸런서|리스너|헬스.?모니터)/.test(text)) addTarget("loadBalancers");
    if (/(container|zun|컨테이너)/.test(text)) addTarget("zun");
    if (/(kubernetes|k8s|magnum|cluster|클러스터|쿠버네티스)/.test(text)) addTarget("magnum");
    if (/(poc|custom-lab|고급|견적)/.test(text)) addTarget("cloudConsole");
    if (!targets.length) addTarget("cloudConsole");
    return targets;
  };
  const getCleanupStatusMeta = status => {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "working") return {
      label: "처리 중",
      chip: "is-warn"
    };
    if (normalized === "done") return {
      label: "완료",
      chip: "is-success"
    };
    if (normalized === "blocked") return {
      label: "보류",
      chip: "is-error"
    };
    return {
      label: "요청됨",
      chip: "is-muted"
    };
  };
  const getCleanupStatusNoteValue = item => {
    const key = String(item.id || "");
    return Object.prototype.hasOwnProperty.call(cleanupStatusNotes, key) ? cleanupStatusNotes[key] : String(item.cleanupStatusNote || "");
  };
  const cleanupMessages = (props.adminMessages || []).filter(isTerminalCloudCleanupMessage);
  const unreadCleanupCount = cleanupMessages.filter(item => !item.readAt).length;
  const filteredRecipients = availableRecipients.filter(item => {
    if (!recipientQuery) return true;
    return [item.name, item.username, item.role, item.groupName, item.recipientType === "group" ? "group" : "", item.recipientType === "group" ? supportGroupName : ""].some(value => String(value || "").toLowerCase().includes(recipientQuery));
  });
  const selectedRecipient = availableRecipients.find(item => String(item.id || "").trim() === replyRecipientId) || availableRecipients.find(item => String(item.username || "").trim().toLowerCase() === replyRecipientId.toLowerCase()) || null;
  const selectedRecipientLabel = selectedRecipient ? selectedRecipient.recipientType === "group" ? `${selectedRecipient.groupName || selectedRecipient.name} 그룹` : `${selectedRecipient.name} (${selectedRecipient.username})` : replyRecipientId ? `직접 입력: ${replyRecipientId}` : "받는 사람 미선택";
  const filteredMessages = (props.adminMessages || []).filter(item => {
    const matchesSearch = !query || [item.subject, item.body, item.senderName, item.senderUsername, item.recipientName, item.recipientUsername, item.recipientGroupName].some(value => String(value || "").toLowerCase().includes(query));
    const matchesUnread = !showUnreadOnly || !item.readAt;
    const matchesCleanup = !showCleanupOnly || isTerminalCloudCleanupMessage(item);
    return matchesSearch && matchesUnread && matchesCleanup;
  });
  const scrollComposeIntoView = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        composeRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    });
  };
  const handleReply = item => {
    props.onStartMessageReply(item);
    scrollComposeIntoView();
  };
  const buildCleanupReplyTemplate = (item, type) => {
    const subject = String(item.subject || "").startsWith("RE:") ? String(item.subject || "") : `RE: ${item.subject || "정리 요청"}`;
    if (type === "done") {
      return {
        subject,
        body: "요청하신 터미널 클라우드 잔여 자원 정리가 완료되었습니다.\n\n상태 갱신 후에도 같은 자원이 보이면 다시 알려 주세요."
      };
    }
    return {
      subject,
      body: "터미널 클라우드 잔여 자원 정리 요청을 확인했습니다.\n\n현재 HeatStack, 포트, 볼륨, 보안그룹 등 관련 자원을 점검 중입니다. 처리 중 추가 확인이 필요하면 다시 안내드리겠습니다."
    };
  };
  const handleCleanupTemplateReply = (item, type) => {
    const template = buildCleanupReplyTemplate(item, type);
    props.onStartMessageReply(item);
    props.setMessageForm(current => ({
      ...current,
      subject: template.subject,
      body: template.body
    }));
    scrollComposeIntoView();
  };
  const handleCleanupStatusUpdate = (item, status) => {
    const cleanupStatus = String(status || "").trim().toLowerCase();
    props.onUpdateMessageCleanupStatus?.(item.id, cleanupStatus, getCleanupStatusNoteValue(item));
  };
  return <section className="portal-stack">
      <section className="admin-simple-card admin-course-card">
        <div className="admin-card-header"><strong>쪽지 관리</strong></div>
        <div className="admin-form">
          <AdminField label="운영지원 그룹명" hint="사용자 쪽지함과 관리자 쪽지 관리 화면에 표시될 그룹 이름입니다.">
            <input value={props.platformStatus?.supportMessageGroupName || ""} onChange={event => props.setPlatformStatus(current => ({
            ...current,
            supportMessageGroupName: event.target.value
          }))} placeholder="예: 운영지원" />
          </AdminField>
          <AdminField label="운영지원 응답 상태" hint="부재중이면 일반 사용자의 도움 요청 발송을 잠시 막습니다.">
            <select value={supportAvailabilityMode} onChange={event => props.setPlatformStatus(current => ({
            ...current,
            supportAvailabilityMode: event.target.value
          }))}>
              <option value="available">상담 가능</option>
              <option value="away">부재중</option>
            </select>
          </AdminField>
          <AdminField label="부재중 안내 문구" hint="사용자 문의 화면과 발송 차단 메시지에 표시됩니다.">
            <input value={props.platformStatus?.supportUnavailableMessage || ""} onChange={event => props.setPlatformStatus(current => ({
            ...current,
            supportUnavailableMessage: event.target.value
          }))} placeholder="현재 관리자가 부재중입니다. 운영지원 대화는 잠시 후 다시 이용해 주세요." />
          </AdminField>
          <div className="simple-status-list">
            <div>{`현재 그룹명: ${supportGroupName}`}</div>
            <div>{`응답 상태: ${supportAvailabilityMode === "away" ? "부재중" : "상담 가능"}`}</div>
            <div>{`수신 가능 인원: ${supportMembers.length}명`}</div>
            <div>{`구성원: ${supportMembers.length ? supportMembers.map(user => `${user.name || user.username}(${user.username})`).join(", ") : "없음"}`}</div>
          </div>
          <div className="admin-inline-actions">
            <button className="mini-btn primary-mini-btn" onClick={props.onSavePlatformSettings} type="button">그룹 설정 저장</button>
            <button className="mini-btn" onClick={() => props.setSection("users")} type="button">사용자 관리로 이동</button>
          </div>
        </div>
      </section>
      <section className="simple-panel message-ops-summary" aria-label="터미널 클라우드 정리 요청 요약">
        <div>
          <p className="card-label">TERMINAL CLOUD</p>
          <h3>잔여 자원 정리 요청</h3>
          <p className="hint">터미널 클라우드에서 들어온 실패/종료 자원 정리 요청을 모아 보고 바로 처리 안내를 회신합니다.</p>
        </div>
        <div className="message-ops-summary-metrics">
          <span className={`status-chip ${cleanupMessages.length ? "is-warn" : "is-muted"}`}>{`정리 요청 ${cleanupMessages.length}건`}</span>
          <span className={`status-chip ${unreadCleanupCount ? "is-success" : "is-muted"}`}>{`미확인 ${unreadCleanupCount}건`}</span>
        </div>
        <div className="admin-inline-actions">
          <button className={showCleanupOnly ? "primary-btn" : "mini-btn"} onClick={() => setShowCleanupOnly(current => !current)} type="button">
            {showCleanupOnly ? "전체 쪽지 보기" : "정리 요청만 보기"}
          </button>
          <button className="mini-btn" onClick={() => {
          setShowCleanupOnly(true);
          setShowUnreadOnly(true);
        }} type="button">
            미확인 정리 요청
          </button>
          <button className="mini-btn" onClick={() => props.setSection("cloudConsole")} type="button">VM 정리 화면</button>
        </div>
      </section>
      <form className="qna-form simple-panel" onSubmit={props.onSendMessage} ref={composeRef}>
        <div className="portal-detail-head">
          <div>
            <p className="card-label">쪽지 발송</p>
            <h3>{`${supportGroupName} 메시지 보내기`}</h3>
          </div>
          <div className="admin-inline-actions">
            <button className="ghost-btn refresh-btn" onClick={props.onRefreshMessages} type="button">새로고침</button>
          </div>
        </div>
        {props.messageStatus?.message ? <div className={`inline-message ${props.messageStatus.tone === "error" ? "is-error" : ""}`}>{props.messageStatus.message}</div> : null}
        {props.messageForm.replyToMessageId ? <div className="inline-message is-info">
            <strong>{`회신 대상: ${replyTargetLabel || "선택된 사용자"}`}</strong>
            {replyPreview ? <div className="hint">{replyPreview}</div> : null}
            <div className="admin-inline-actions">
              <span className="hint">회신을 취소하면 일반 새 쪽지 작성 상태로 돌아갑니다.</span>
              <button className="ghost-btn" onClick={props.onCancelMessageReply} type="button">회신 취소</button>
            </div>
          </div> : null}
        <div className="hint">{`관리자에서 사용자 또는 ${supportGroupName} 그룹으로 직접 쪽지를 보낼 수 있습니다.`}</div>
        <div className="message-recipient-row">
          <select className="message-recipient-select" value={props.messageForm.recipientId} onChange={event => props.setMessageForm(current => ({
          ...current,
          recipientId: event.target.value
        }))}>
            <option value="">받는사람</option>
            {filteredRecipients.map(item => <option key={item.id} value={item.id}>
                {item.recipientType === "group" ? `${item.groupName || item.name} 그룹${item.representativeUsername ? ` (${item.representativeUsername})` : ""}` : `${item.name} (${item.username})`}
              </option>)}
          </select>
          <button className="ghost-btn open-btn" onClick={() => setShowRecipientSearch(current => !current)} type="button">
            {showRecipientSearch ? "사용자 검색 접기" : "사용자 검색 열기"}
          </button>
        </div>
        {showRecipientSearch ? <input type="search" {...recipientSearchInput} placeholder={`${supportGroupName} 그룹 또는 사용자 검색`} /> : null}
        <AdminField label="직접 입력" hint="드롭다운에 없으면 사용자 번호, 로그인 아이디(username), 이메일을 직접 입력할 수 있습니다.">
          <input value={props.messageForm.recipientId} onChange={event => props.setMessageForm(current => ({
          ...current,
          recipientId: event.target.value
        }))} placeholder="예: 42 또는 user_id 또는 user@example.com" />
        </AdminField>
        <input value={props.messageForm.subject} onChange={event => props.setMessageForm(current => ({
        ...current,
        subject: event.target.value
      }))} placeholder="쪽지 제목" />
        <textarea value={props.messageForm.body} onChange={event => props.setMessageForm(current => ({
        ...current,
        body: event.target.value
      }))} placeholder="전달할 내용을 입력해 주세요." />
        <div className="message-compose-meta">
          <span className="status-chip is-muted">{`받는 대상 ${selectedRecipientLabel}`}</span>
          <span className="status-chip is-muted">{`선택 가능 ${filteredRecipients.length}건`}</span>
          <span className="status-chip is-muted">{`미확인 ${unreadCount}건`}</span>
          <button className="primary-btn" type="submit">쪽지 보내기</button>
        </div>
      </form>
      <section className="admin-simple-card admin-course-card">
        <div className="admin-history-search">
          <input type="search" {...searchInput} placeholder="제목, 내용, 보낸 사람, 받는 사람, 그룹으로 검색" />
          <label className="admin-filter-inline">
            <input checked={showUnreadOnly} onChange={event => setShowUnreadOnly(event.target.checked)} type="checkbox" />
            <span className="hint">미확인만 보기</span>
          </label>
          {showCleanupOnly ? <span className="status-chip is-warn">정리 요청 필터</span> : null}
          <span className="hint">{`표시 ${filteredMessages.length}건 / 전체 ${(props.adminMessages || []).length}건 / 미확인 ${unreadCount}건`}</span>
        </div>
      </section>
      <section className="admin-simple-card admin-course-card">
        <div className="qna-board admin-table-scroll">
          {filteredMessages.length ? filteredMessages.map(item => <article className={`qna-thread notification-thread ${!item.readAt ? "is-unread" : "is-read"}`} key={item.id}>
              {isTerminalCloudCleanupMessage(item) ? (() => {
            const cleanupStatus = item.cleanupStatus || "requested";
            const cleanupMeta = getCleanupStatusMeta(cleanupStatus);
            const cleanupNoteValue = getCleanupStatusNoteValue(item);
            return <div className="message-cleanup-banner">
                  <div>
                    <strong>터미널 클라우드 정리 요청</strong>
                    <span>관련 자원 화면에서 잔여 포트, 볼륨, 보안그룹, HeatStack 상태를 확인하세요.</span>
                    <div className="message-cleanup-status-line">
                      <span className={`status-chip ${cleanupMeta.chip}`}>{cleanupMeta.label}</span>
                      {item.cleanupStatusUpdatedAt ? <span className="hint">
                          {`${formatDateTime(item.cleanupStatusUpdatedAt)} ${item.cleanupStatusUpdatedByName || item.cleanupStatusUpdatedByUsername || "관리자"}`}
                        </span> : null}
                    </div>
                    <div className="message-cleanup-status-controls">
                      <select aria-label="정리 요청 상태" value={cleanupStatus} onChange={event => handleCleanupStatusUpdate(item, event.target.value)}>
                        <option value="requested">요청됨</option>
                        <option value="working">처리 중</option>
                        <option value="done">완료</option>
                        <option value="blocked">보류</option>
                      </select>
                      <input aria-label="정리 요청 처리 메모" value={cleanupNoteValue} onChange={event => {
                    const key = String(item.id || "");
                    setCleanupStatusNotes(current => ({
                      ...current,
                      [key]: event.target.value
                    }));
                  }} placeholder="처리 메모" />
                      <button className="mini-btn" onClick={() => handleCleanupStatusUpdate(item, cleanupStatus)} type="button">메모 저장</button>
                    </div>
                  </div>
                  <div className="message-template-actions">
                    <button className="mini-btn" onClick={() => handleCleanupTemplateReply(item, "working")} type="button">처리 중 안내</button>
                    <button className="mini-btn primary-mini-btn" onClick={() => handleCleanupTemplateReply(item, "done")} type="button">정리 완료 안내</button>
                  </div>
                </div>;
          })() : null}
              <div className="qna-thread-head">
                <strong>{item.subject || "제목 없음"}</strong>
                <div className="admin-inline-actions">
                  <span className={`status-chip ${item.readAt ? "is-muted" : "is-success"}`}>{item.readAt ? "읽음" : "미확인"}</span>
                  <span>{formatDateTime(item.createdAt)}</span>
                </div>
              </div>
              <div className="qna-head">
                <strong>보낸 사람</strong>
                <span>{`${item.senderName || item.senderUsername} (${item.senderUsername})`}</span>
              </div>
              <div className="qna-head">
                <strong>{item.recipientType === "group" ? "받는 그룹" : "받는 사람"}</strong>
                <span>
                  {item.recipientType === "group" ? `${item.recipientGroupName || item.recipientName || supportGroupName} (${item.recipientGroupKey || item.recipientUsername || "support"})` : `${item.recipientName || item.recipientUsername} (${item.recipientUsername})`}
                </span>
              </div>
              <div className="qna-post-body">{item.body || "-"}</div>
              <div className="admin-inline-actions">
                <button className="mini-btn" onClick={() => handleReply(item)} type="button">
                  {Number(props.messageForm.replyToMessageId || 0) === Number(item.id || 0) ? "회신 수정" : "회신"}
                </button>
                {getCleanupMessageTargets(item).map(target => <button className="mini-btn open-btn" key={target.tab} onClick={() => props.setSection(target.tab)} type="button">
                    {`${target.label} 열기`}
                  </button>)}
                <button className="mini-btn danger-mini-btn" onClick={() => {
              if (!window.confirm("이 쪽지를 삭제할까요?")) return;
              props.onDeleteMessage(item.id);
            }} type="button">
                  삭제
                </button>
              </div>
            </article>) : <div className="hint">{(props.adminMessages || []).length ? "검색 조건에 맞는 쪽지가 없습니다." : "아직 도착한 쪽지가 없습니다."}</div>}
        </div>
      </section>
    </section>;
}
