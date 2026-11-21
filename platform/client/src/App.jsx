import {CommunityNavigation,CommunityServiceLinks} from './community-workspace.jsx';
import {CommunityUiMemory} from './community-ui-memory.jsx';
import { communitySection } from "../../shared/community-profile.js";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { api, canUseCourseQuotePortal, usePortalApp } from "./portal-state.js";
import { AdminField } from "./admin-field.jsx";
import { formatBuildBranch, formatBuildCommit } from "./build-info.js";

import {KIKIOS_LOGO_MIME_TYPE,getTerminalLabFaviconHref} from "./terminal-lab-logo.jsx";
import { getStandaloneExamCourseIds, isLearningLabResource, isStandaloneExamCourse } from "./course-visibility.js";
const GuideMarkdownBlock = lazy(() => import("./guide-renderer.jsx"));
const InteractiveLogoStage = lazy(() => import("./interactive-logo-stage.jsx"));
const DYNAMIC_IMPORT_RELOAD_KEY = "terminal-lab:dynamic-import-reload-at";
const PORTAL_UI_VERSION_STORAGE_KEY = "terminal-lab:portal-ui-version";
const PORTAL_V2_NOTICE_DISMISS_KEY = "terminal-lab:portal-v2-transition-notice-dismissed";
function readDynamicImportReloadState() {
  if (typeof window === "undefined") return {
    at: 0,
    path: ""
  };
  try {
    const raw = window.sessionStorage?.getItem(DYNAMIC_IMPORT_RELOAD_KEY) || "";
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      at: Number(parsed?.at || 0),
      path: String(parsed?.path || "")
    };
  } catch {
    return {
      at: 0,
      path: ""
    };
  }
}
function writeDynamicImportReloadState(state) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.setItem(DYNAMIC_IMPORT_RELOAD_KEY, JSON.stringify({
      at: Number(state?.at || 0),
      path: String(state?.path || "")
    }));
  } catch {
    // Ignore storage write failures and fall back to the thrown import error.
  }
}
function readPortalUiVersionPreference() {
  if (typeof window === "undefined") return "v2";
  try {
    const stored = window.localStorage?.getItem(PORTAL_UI_VERSION_STORAGE_KEY);
    return stored === "v1" || stored === "v2" ? stored : "v2";
  } catch {
    return "v2";
  }
}
function writePortalUiVersionPreference(version) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(PORTAL_UI_VERSION_STORAGE_KEY, version === "v2" ? "v2" : "v1");
  } catch {
    // Keep the in-memory switch working even if local storage is unavailable.
  }
}
function normalizePortalUiMode(value, fallback = "legacy") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["legacy", "switchable", "v2"].includes(normalized)) return normalized;
  return fallback;
}
function readDismissedPortalV2NoticeKey() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage?.getItem(PORTAL_V2_NOTICE_DISMISS_KEY) || "";
  } catch {
    return "";
  }
}
function writeDismissedPortalV2NoticeKey(value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(PORTAL_V2_NOTICE_DISMISS_KEY, String(value || ""));
  } catch {
    // Dismissal is cosmetic. If storage is blocked, simply show the banner again later.
  }
}
function isDynamicImportError(error) {
  const message = String(error?.message || error || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message);
}
function lazyWithChunkReload(loader) {
  return lazy(() => loader().catch(error => {
    if (typeof window !== "undefined" && isDynamicImportError(error)) {
      const now = Date.now();
      const {
        at: lastReloadAt,
        path: lastReloadPath
      } = readDynamicImportReloadState();
      const currentPath = `${window.location.pathname}${window.location.search}`;
      const sameRouteCooldownActive = Number.isFinite(lastReloadAt) && now - lastReloadAt <= 10000 && lastReloadPath === currentPath;
      if (!sameRouteCooldownActive) {
        writeDynamicImportReloadState({
          at: now,
          path: currentPath
        });
        window.location.reload();
        return new Promise(() => {});
      }
    }
    throw error;
  }));
}

const AdminView = lazyWithChunkReload(() => import("./admin-view.jsx"));

const CicdView = lazyWithChunkReload(() => import("./cicd-view.jsx"));

const InquiryHubView = lazyWithChunkReload(() => import("./inquiry-hub-view.jsx"));
const InternalImageServerView = lazyWithChunkReload(() => import("./infra-views.jsx").then(module => ({
  default: module.InternalImageServerView
})));

const LlmView = lazyWithChunkReload(() => import("./llm-view.jsx"));
const LuckyDrawView = lazyWithChunkReload(() => import("./lucky-draw-view.jsx"));
const MarketingSurveyView = lazyWithChunkReload(() => import("./marketing-survey-view.jsx"));
const MagnumView = lazyWithChunkReload(() => import("./infra-views.jsx").then(module => ({
  default: module.MagnumView
})));

const NoticeView = lazyWithChunkReload(() => import("./notice-view.jsx"));
const NotificationView = lazyWithChunkReload(() => import("./notification-view.jsx"));

const OpsMonitorView = lazyWithChunkReload(() => import("./ops-monitor-view.jsx"));
const PortalLogin = lazyWithChunkReload(() => import("./portal-login-view.jsx"));
const ProfileView = lazyWithChunkReload(() => import("./profile-view.jsx"));

const TerminalView = lazyWithChunkReload(() => import("./terminal-view.jsx"));

const TerminalCloudView = lazyWithChunkReload(() => import("./terminal-cloud-view.jsx"));
function isLocalPreviewHost() {
  if (typeof window === "undefined") return false;
  return ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
}
function getLoadingPreviewMode() {
  if (!isLocalPreviewHost()) return "";
  const params = new URLSearchParams(window.location.search || "");
  const mode = String(params.get("previewLoading") || "").toLowerCase();
  if (mode === "session" || mode === "view" || mode === "all") return mode;
  if (mode === "1" || mode === "true") return "session";
  return "";
}
const ToastStack = lazyWithChunkReload(() => import("./toast-stack.jsx"));

const ZunView = lazyWithChunkReload(() => import("./infra-views.jsx").then(module => ({
  default: module.ZunView
})));
const TroveView = lazyWithChunkReload(() => import("./infra-views.jsx").then(module => ({
  default: module.TroveView
})));
const AiLabView = lazyWithChunkReload(() => import("./ai-lab-view.jsx"));
const ZunContainerConsole = lazyWithChunkReload(() => import("./ai-lab-view.jsx").then(module => ({
  default: module.ZunContainerConsole
})));
function isGovernmentProgramTypeValue(programType) {
  const normalized = String(programType || "").trim().replace(/\s+/g, "");
  return normalized.includes("정부") || normalized.includes("국비");
}
const SECTION_LABELS = {
  notices: "공지사항",
  notifications: "알림함",
  messages: "운영지원 대화",
  offlineSchedule: "강의 일정",
  profile: "내 정보",
  courses: "일반과정 교육신청",
  iltCourses: "ILT 교육신청",
  governmentCourses: "정부지원 교육신청",
  onlineCourses: "온라인 교육신청",
  courseQuotes: "견적서",
  writtenExam: "지식검증",
  labExam: "랩 시험",
  certificates: "자격증",
  terminal: "랩실",
  terminalCloud: "터미널 클라우드",
  internalImageServer: "내부 이미지 서버",
  cicd: "CI/CD 파이프라인",
  resources: "학습 홈",
  surveys: "사전·사후 설문",
  surveyResults: "설문 결과",
  zun: "컨테이너",
  zunConsole: "컨테이너 콘솔",
  magnum: "쿠버네티스 클러스터",
  trove: "데이터베이스",
  aiGpu: "AI 랩",
  consulting: "상담 및 문의",
  llm: "AI 질문",
  qna: "커뮤니티",
  luckyDraw: "무료 강의 뽑기",
  marketingSurveys: "설문 투표",
  opsMonitor: "운영 모니터"
};
const ADVANCED_SECTIONS = ["magnum", "trove", "aiGpu"];
const SIDEBAR_OVERLAY_MEDIA_QUERY = "(max-width: 1120px)";
const SERVICE_READY_MESSAGE = "서비스 준비 중입니다";
const SITE_UPDATE_MESSAGE = "화면과 기능을 더 보기 좋게 다듬고 있어요. 잠시 후 새로고침하면 이어서 사용할 수 있습니다.";
const LEGACY_SITE_UPDATE_MESSAGES = new Set(["업데이트 중!", "업데이트 중", "현재 기능 개선 중 입니다", "현재 기능 개선 중입니다"]);
const SERVICE_READY_TERMINAL_EMOTES = [":)", ":D", "^_^", ">_<", "(o_o)", "(*_*)", "[OK?]", "{...}"];
const SERVICE_READY_TERMINAL_LINES = ["feature.flag=off", "access.scope=limited", "permission=denied", "portal.lock=on", "service.visible=false"];
const ONLINE_CLASS_ALERT_LIMIT = 10;
const ONLINE_CLASS_ALERT_ICONS = {
  video: "▶",
  terminal: "▣",
  calendar: "□",
  check: "✓",
  rocket: "▲",
  cloud: "☁"
};
const SERVICE_ACCESS_RULES = {
  arena: {
    label: "실무 역량 진단",
    enabledKey: "arenaEnabled"
  },
  zun: {
    label: "컨테이너 랩",
    enabledKey: "zunEnabled"
  },
  magnum: {
    label: "쿠버네티스 클러스터",
    enabledKey: "magnumEnabled"
  },
  trove: {
    label: "데이터베이스",
    enabledKey: "troveEnabled"
  },
  aiGpu: {
    label: "AI 랩",
    enabledKey: "aiGpuEnabled"
  },
  llm: {
    label: "AI 질문",
    enabledKey: "llmEnabled"
  }
};
const TERMINAL_CLOUD_LEGACY_SECTION_INTENTS = {};

const SESSION_LOADING_MESSAGES = [{
  emote: "KEY",
  text: "세션 키를 확인하는 중입니다..."
}, {
  emote: "TTY",
  text: "터미널을 깨우는 중입니다..."
}, {
  emote: "RAM",
  text: "이전 상태를 복원하는 중입니다..."
}, {
  emote: "NET",
  text: "랩 환경과 연결하는 중입니다..."
}, {
  emote: "MAP",
  text: "현재 위치를 포털 안에서 찾는 중입니다..."
}, {
  emote: "CLK",
  text: "세션 정보를 불러오는 중입니다..."
}];
const VIEW_LOADING_MESSAGES = [{
  emote: "UI",
  text: "화면을 불러오는 중입니다..."
}, {
  emote: "BOX",
  text: "필요한 화면 조각을 꺼내는 중입니다..."
}, {
  emote: "CPU",
  text: "인터페이스를 조립하는 중입니다..."
}, {
  emote: "NAV",
  text: "이동할 화면을 찾는 중입니다..."
}, {
  emote: "DB",
  text: "표시할 데이터를 준비하는 중입니다..."
}];
const RARE_SESSION_LOADING_MESSAGES = [{
  emote: "OK",
  text: "커피 한 모금만큼만 기다려 주세요..."
}, {
  emote: "LAB",
  text: "오늘의 터미널 운세를 계산하는 중입니다..."
}, {
  emote: "RUN",
  text: "실습실 불을 켜는 중입니다..."
}];
const RARE_VIEW_LOADING_MESSAGES = [{
  emote: "GPU",
  text: "화면에 작은 반짝임을 얹는 중입니다..."
}, {
  emote: "IO",
  text: "페이지가 숨을 고르는 중입니다..."
}, {
  emote: "LAB",
  text: "새 화면을 실험대 위에 올리는 중입니다..."
}];
const LOADING_DIAGNOSTIC_STEPS = ["세션", "과정", "랩", "교안"];
const SESSION_LOADING_MESSAGE_INTERVAL_MS = 1400;
function getRandomLoadingMessage(messages, rareMessages, previousMessage = null) {
  const messagePool = Math.random() < 0.18 ? rareMessages : messages;
  const candidates = messagePool.length > 1 && previousMessage ? messagePool.filter(message => message.text !== previousMessage.text) : messagePool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
function getRandomServiceReadyEmote() {
  return SERVICE_READY_TERMINAL_EMOTES[Math.floor(Math.random() * SERVICE_READY_TERMINAL_EMOTES.length)];
}
function getRandomServiceReadyTerminalLine() {
  return SERVICE_READY_TERMINAL_LINES[Math.floor(Math.random() * SERVICE_READY_TERMINAL_LINES.length)];
}
function formatHeaderDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}
function getHeaderAlertBadgeMeta(item) {
  if (item?.type === "message") {
    return {
      label: "쪽지",
      className: "is-warn"
    };
  }
  if (item?.category === "terminal_cloud_cleanup") {
    return {
      label: "정리",
      className: item.unread ? "is-warn" : "is-muted"
    };
  }
  return {
    label: "알림",
    className: item?.unread ? "is-success" : "is-muted"
  };
}
function ViewLoadingFallback({
  overlay = true
}) {
  const loadingCard = <TerminalLoadingFallback label="화면 조립 중" messages={VIEW_LOADING_MESSAGES} rareMessages={RARE_VIEW_LOADING_MESSAGES} />;
  return overlay ? <div className="view-loading-overlay">{loadingCard}</div> : loadingCard;
}
function SessionLoadingFallback() {
  return <TerminalLoadingFallback label="세션 동기화 중" messages={SESSION_LOADING_MESSAGES} rareMessages={RARE_SESSION_LOADING_MESSAGES} />;
}
function LoadingPreviewPage({
  mode
}) {
  const showSession = mode !== "view";
  const showView = mode === "view" || mode === "all";
  return <div className="shell">
      <main className="loading-shell loading-preview-shell">
        <div className={`loading-preview-grid ${showSession && showView ? "has-pair" : ""}`}>
          {showSession ? <section className="loading-preview-item" aria-label="세션 로딩 화면 미리보기">
              <span className="card-label">Session Loading</span>
              <SessionLoadingFallback />
            </section> : null}
          {showView ? <section className="loading-preview-item" aria-label="화면 로딩 화면 미리보기">
              <span className="card-label">View Loading</span>
              <ViewLoadingFallback overlay={false} />
            </section> : null}
        </div>
      </main>
    </div>;
}
function TerminalLoadingFallback({
  label,
  messages,
  rareMessages
}) {
  const [loadingMessage, setLoadingMessage] = useState(() => getRandomLoadingMessage(messages, rareMessages));
  const [loadingStep, setLoadingStep] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setLoadingMessage(currentMessage => getRandomLoadingMessage(messages, rareMessages, currentMessage));
      setLoadingStep(currentStep => (currentStep + 1) % LOADING_DIAGNOSTIC_STEPS.length);
    }, SESSION_LOADING_MESSAGE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [messages, rareMessages]);
  return <div className="loading-card session-loading-card">
      <div className="session-loading-signal" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="session-loading-terminal">
        <div className="session-loading-head">
          <span className="session-loading-emote" aria-hidden="true">{loadingMessage.emote}</span>
          <span>{label}</span>
          <i aria-hidden="true">live</i>
        </div>
        <div className="session-loading-copy">
          <span className="session-loading-prefix" aria-hidden="true">&gt;</span>
          <span>{loadingMessage.text}</span>
          <span className="session-loading-cursor" aria-hidden="true">_</span>
        </div>
        <div className="session-loading-rail" aria-hidden="true">
          <span />
        </div>
        <div className="session-loading-steps" aria-label="로딩 점검 단계">
          {LOADING_DIAGNOSTIC_STEPS.map((step, index) => <span className={index === loadingStep ? "is-active" : ""} key={step}>{step}</span>)}
        </div>
      </div>
    </div>;
}
function SiteFooter({
  platformStatus
}) {
  const footerAdminName = platformStatus?.footerAdminName || "관리자";
  const footerEmail = platformStatus?.footerEmail || "tang@dustbox.kr";
  const footerBusinessInfo = String(platformStatus?.footerBusinessInfo || "").trim();
  const showBusinessInfo = footerBusinessInfo && footerBusinessInfo !== "아직 없어요 :o" && footerBusinessInfo !== "사업자 정보";
  const appVersion = String(platformStatus?.siteVersionNumber || "").trim() || "v1.0";
  const buildBranch = formatBuildBranch();
  const buildCommit = formatBuildCommit();
  return <footer className="site-footer">
      <span>개발: <a className="site-footer-link" href="https://github.com/tangt64" rel="noreferrer" target="_blank">Choi Gook Hyun (tangt64)</a></span>
      <span>{`앱 버전 ${appVersion}`}</span>
      <span>{`빌드 브랜치 ${buildBranch}`}</span>
      <span>{`Git SHA ${buildCommit}`}</span>
      <span>{`관리자: ${footerAdminName}`}</span>
      <span>
        이메일{" "}
        <a className="site-footer-link" href={`mailto:${footerEmail}`}>
          {footerEmail}
        </a>
      </span>
      {showBusinessInfo ? <span>{`사업자번호: ${footerBusinessInfo}`}</span> : null}
    </footer>;
}
const FOCUSABLE_SELECTOR = ["a[href]", "button:not([disabled])", "input:not([disabled])", "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])"].join(",");
function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(element => {
    if (element.hasAttribute("disabled")) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}
function focusFirstDialogElement(dialog) {
  const [firstFocusable] = getFocusableElements(dialog);
  (firstFocusable || dialog)?.focus?.();
}
function useDialogFocusTrap(active, dialogRef, {
  onEscape
} = {}) {
  useEffect(() => {
    if (!active) return undefined;
    const dialog = dialogRef.current;
    const previousActiveElement = document.activeElement;
    window.requestAnimationFrame(() => focusFirstDialogElement(dialog));
    function handleKeyDown(event) {
      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusableElements = getFocusableElements(dialog);
      if (!focusableElements.length) {
        event.preventDefault();
        dialog.focus?.();
        return;
      }
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousActiveElement && typeof previousActiveElement.focus === "function") {
        window.requestAnimationFrame(() => previousActiveElement.focus());
      }
    };
  }, [active, dialogRef, onEscape]);
}
function SiteUpdateBanner({
  platformStatus
}) {
  if (!platformStatus?.siteUpdateInProgress) return null;
  const rawMessage = String(platformStatus?.siteUpdateMessage || "").replace(/\s+/g, " ").trim();
  const useDefaultMessage = !rawMessage || LEGACY_SITE_UPDATE_MESSAGES.has(rawMessage);
  const title = useDefaultMessage ? "업그레이드 진행 중" : "운영 안내";
  const message = useDefaultMessage ? SITE_UPDATE_MESSAGE : rawMessage;
  return <div className="global-banner site-update-banner" aria-live="polite">
      <span className="site-update-icon" aria-hidden="true"><span>UP</span></span>
      <span className="site-update-copy">
        <em>{title}</em>
        <strong>{message}</strong>
      </span>
    </div>;
}
function PortalV2TransitionBanner({
  active,
  mode,
  onSwitchToV2,
  platformStatus
}) {
  const [dismissedNoticeKey, setDismissedNoticeKey] = useState(() => readDismissedPortalV2NoticeKey());
  const customMessage = String(platformStatus?.portalV2TransitionNoticeMessage || "").trim();
  const forcedNoticeEnabled = mode === "v2" && Boolean(customMessage);
  const enabled = platformStatus?.portalV2TransitionNoticeEnabled !== false && (mode === "switchable" && !active || forcedNoticeEnabled);
  const message = customMessage || (mode === "v2" ? "사용자 포털이 v2 화면으로 전환되었습니다. 랩실 중심으로 과정, 교안, 터미널을 이어서 사용할 수 있습니다." : "사용자 포털은 v2 화면을 기본으로 제공합니다. 기존 화면을 사용 중이라면 언제든 v2로 다시 전환할 수 있습니다.");
  const noticeKey = `${mode}:${message}`;
  if (!enabled || dismissedNoticeKey === noticeKey) return null;
  return <section className={`portal-transition-banner ${mode === "v2" ? "is-forced" : ""}`}>
      <div>
        <p className="card-label">포털 전환 안내</p>
        <strong>{mode === "v2" ? "v2 포털로 전환되었습니다" : "v2 포털을 기본 화면으로 제공합니다"}</strong>
        <p>{message}</p>
      </div>
      <div className="portal-actions">
        {mode === "switchable" && !active ? <button className="primary-btn" onClick={onSwitchToV2} type="button">v2로 보기</button> : null}
        <button className="ghost-btn" onClick={() => {
        writeDismissedPortalV2NoticeKey(noticeKey);
        setDismissedNoticeKey(noticeKey);
      }} type="button">
          닫기
        </button>
      </div>
    </section>;
}
function TermsConsentGate({
  activeTerms = [],
  authStatus,
  onAcceptActiveTerms,
  onLogout
}) {
  const [step, setStep] = useState(0);
  const dialogRef = useRef(null);
  const requiredTerms = ["standard_terms", "service_additional_terms"].map(key => activeTerms.find(term => term.termsKey === key)).filter(Boolean);
  const currentTerm = requiredTerms[step] || null;
  const canSubmit = requiredTerms.length === 2;
  useDialogFocusTrap(true, dialogRef);
  return <div className="terms-modal-backdrop" role="presentation">
      <section aria-labelledby="terms-consent-title" aria-modal="true" className="terms-modal terms-consent-gate" ref={dialogRef} role="dialog" tabIndex={-1}>
        <div className="terms-modal-head">
          <div>
            <span className="card-label">필수 약관 동의</span>
            <h3 id="terms-consent-title">{currentTerm?.title || "활성 약관 확인"}</h3>
            <p>{`${Math.min(step + 1, requiredTerms.length || 1)} / ${requiredTerms.length || 2} 단계 · ${currentTerm?.version || "버전 미설정"}`}</p>
          </div>
          <button className="mini-btn" onClick={onLogout} type="button">로그아웃</button>
        </div>
        <div className="terms-modal-tabs" role="tablist">
          {requiredTerms.map((term, index) => <button aria-selected={index === step ? "true" : "false"} className={index === step ? "is-active" : ""} key={term.id} onClick={() => setStep(index)} role="tab" type="button">
              {term.termsKey === "standard_terms" ? "표준약관" : "추가 약관"}
            </button>)}
        </div>
        <div className="terms-modal-body">
          {currentTerm ? <>
              <div className="terms-force-message">활성 약관에 동의해야 Terminal Lab 서비스를 계속 사용할 수 있습니다.</div>
              {currentTerm.summary ? <p className="terms-modal-summary">{currentTerm.summary}</p> : null}
              <Suspense fallback={<div className="hint">약관을 불러오는 중입니다.</div>}>
                <GuideMarkdownBlock showToc source={currentTerm.body} />
              </Suspense>
            </> : <p className="hint">활성 약관이 아직 준비되지 않았습니다. 관리자에게 문의해 주세요.</p>}
        </div>
        <div className="terms-modal-actions">
          <StatusLine status={authStatus} />
          <button className="mini-btn" disabled={step === 0} onClick={() => setStep(current => Math.max(0, current - 1))} type="button">이전</button>
          {step < requiredTerms.length - 1 ? <button className="primary-mini-btn" onClick={() => setStep(current => Math.min(requiredTerms.length - 1, current + 1))} type="button">다음 약관</button> : <button className="primary-mini-btn" disabled={!canSubmit} onClick={onAcceptActiveTerms} type="button">모든 약관 확인 및 동의</button>}
        </div>
      </section>
    </div>;
}
function MarketingConsentDecisionGate({
  authStatus,
  onDecideMarketingConsent
}) {
  const dialogRef = useRef(null);
  useDialogFocusTrap(true, dialogRef);
  return <div className="terms-modal-backdrop" role="presentation">
      <section aria-labelledby="marketing-consent-title" aria-modal="true" className="terms-modal marketing-consent-gate" ref={dialogRef} role="dialog" tabIndex={-1}>
        <div className="terms-modal-head">
          <div>
            <span className="card-label">마케팅 수신 동의</span>
            <h3 id="marketing-consent-title">이메일 안내 수신 여부를 선택해 주세요</h3>
            <p>쿠폰, 이벤트, 신규 과정 안내를 이메일로 받을지 결정합니다.</p>
          </div>
        </div>
        <div className="terms-modal-body">
          <div className="terms-force-message">선택 동의 항목입니다. 미동의해도 서비스 이용에는 제한이 없습니다.</div>
          <div className="simple-status-list">
            <div>수신 동의 시 마케팅 쿠폰, 이벤트, 신규 과정 안내 메일을 받을 수 있습니다.</div>
            <div>미동의 시 광고성 안내 메일 대상에서 제외됩니다.</div>
          </div>
        </div>
        <div className="terms-modal-actions">
          <StatusLine status={authStatus} />
          <button className="mini-btn" onClick={() => onDecideMarketingConsent(false)} type="button">동의하지 않음</button>
          <button className="primary-mini-btn" onClick={() => onDecideMarketingConsent(true)} type="button">수신 동의</button>
        </div>
      </section>
    </div>;
}
function StatusLine({
  status
}) {
  if (!status?.message) return null;
  return <span className={`terms-inline-status ${status.tone || ""}`}>{status.message}</span>;
}

function getLabOverrideFieldHelper(field) {
  if (field?.description) return field.description;
  if (field?.type === "openshift-pull-secret") return "Red Hat Hybrid Cloud Console에서 받은 pull secret JSON 원문을 붙여넣어 주세요.";
  if (field?.type === "ssh-public-key") return "공개키만 입력하세요. 개인키는 입력하지 마세요.";
  return "랩 생성에 필요한 값을 입력해 주세요.";
}
function LabParameterOverrideModal({
  prompt,
  onSubmit,
  onCancel
}) {
  const dialogRef = useRef(null);
  const fields = Array.isArray(prompt?.fields) ? prompt.fields : [];
  const [values, setValues] = useState({});
  const [status, setStatus] = useState({
    tone: "",
    message: ""
  });
  useDialogFocusTrap(Boolean(prompt), dialogRef, {
    onEscape: onCancel
  });
  useEffect(() => {
    setValues({});
    setStatus({
      tone: "",
      message: ""
    });
  }, [prompt?.id]);
  if (!prompt) return null;
  function updateValue(key, value) {
    setValues(current => ({
      ...current,
      [key]: value
    }));
    if (status.message) setStatus({
      tone: "",
      message: ""
    });
  }
  function submit(event) {
    event.preventDefault();
    const resolved = {};
    for (const field of fields) {
      const value = String(values[field.key] || "").trim();
      if (!value && field.required !== false) {
        setStatus({
          tone: "error",
          message: `${field.label || field.key} 값을 입력해 주세요.`
        });
        return;
      }
      if (value) resolved[field.key] = value;
    }
    onSubmit?.(resolved);
  }
  return <div className="portal-modal-backdrop lab-secret-modal-backdrop" onClick={onCancel} role="presentation">
      <form aria-labelledby="lab-secret-modal-title" aria-modal="true" className="portal-modal-card lab-secret-modal" onClick={event => event.stopPropagation()} onSubmit={submit} ref={dialogRef} role="dialog" tabIndex={-1}>
        <div className="terminal-support-modal-head">
          <div>
            <p className="card-label">랩 시작 Secret</p>
            <h3 id="lab-secret-modal-title">{prompt.courseTitle || "선택한 과정"}</h3>
            <p className="hint">입력값은 이번 랩 생성 요청에만 사용되며 Terminal Lab에 저장하지 않습니다.</p>
          </div>
          <button className="mini-btn" onClick={onCancel} type="button">닫기</button>
        </div>
        <div className="lab-secret-field-list">
          {fields.map(field => {
          const useTextarea = field.multiline || field.type === "openshift-pull-secret";
          return <AdminField key={field.key} label={field.label || field.key} required={field.required !== false}>
                {useTextarea ? <textarea autoComplete="off" onChange={event => updateValue(field.key, event.target.value)} placeholder={field.placeholder || getLabOverrideFieldHelper(field)} rows={field.type === "openshift-pull-secret" ? 10 : 5} spellCheck={false} value={values[field.key] || ""} /> : <input autoComplete="off" onChange={event => updateValue(field.key, event.target.value)} placeholder={field.placeholder || getLabOverrideFieldHelper(field)} spellCheck={false} type={field.type === "password" || field.secret ? "password" : "text"} value={values[field.key] || ""} />}
                <p className="hint">{getLabOverrideFieldHelper(field)}</p>
              </AdminField>;
        })}
        </div>
        {status.message ? <div className={`inline-message ${status.tone === "error" ? "is-error" : ""}`}>{status.message}</div> : null}
        <div className="portal-actions terminal-support-modal-actions">
          <button className="ghost-btn" onClick={onCancel} type="button">취소</button>
          <button className="primary-btn" type="submit">저장하지 않고 랩 시작</button>
        </div>
      </form>
    </div>;
}
function RecentNoticeStrip({
  notices = [],
  onViewAll
}) {
  const recentNotices = [...notices].sort((left, right) => {
    if (Boolean(left.isPinned) !== Boolean(right.isPinned)) {
      return Boolean(left.isPinned) ? -1 : 1;
    }
    return new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime();
  }).slice(0, 2);
  if (!recentNotices.length) return null;
  return <section className="recent-notice-strip" aria-label="최근 공지사항">
      <div className="recent-notice-head">
        <div>
          <span className="card-label">Notice</span>
          <strong>최근 공지사항</strong>
        </div>
        <button className="ghost-btn" onClick={onViewAll} type="button">전체 보기</button>
      </div>
      <div className="recent-notice-list">
        {recentNotices.map(notice => <button className="recent-notice-item" key={notice.id} onClick={onViewAll} type="button">
            <span>{formatHeaderDateTime(notice.updatedAt || notice.createdAt)}</span>
            <strong>{notice.title || "제목 없는 공지"}</strong>
            <p>{notice.body || "내용이 없습니다."}</p>
          </button>)}
      </div>
    </section>;
}
export default function App() {
  const rawPortalApp = usePortalApp();
  const rawApp = {
    ...rawPortalApp,
    section: communitySection(rawPortalApp.section)
  };
  const app = rawApp;
  const publicCurriculumMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("curriculum") === "2026";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarOverlayMode, setSidebarOverlayMode] = useState(false);
  const [inquiryDefaultTab, setInquiryDefaultTab] = useState("course");
  const [communityCourseId, setCommunityCourseId] = useState("");
  const [showAdvancedMenu, setShowAdvancedMenu] = useState(false);
  const [serviceReadyNotice, setServiceReadyNotice] = useState(null);
  const [alertMenuOpen, setAlertMenuOpen] = useState(false);
  const [alertFilter, setAlertFilter] = useState("all");
  const [showAlertUnreadOnly, setShowAlertUnreadOnly] = useState(false);
  const [freshAlertPulse, setFreshAlertPulse] = useState(false);
  const [portalUiVersion, setPortalUiVersion] = useState(() => readPortalUiVersionPreference());
  const [terminalCloudIntent, setTerminalCloudIntent] = useState(null);
  const alertMenuRef = useRef(null);
  const mobileNavButtonRef = useRef(null);
  const sidebarRef = useRef(null);
  const previousUnreadRef = useRef(0);
  const lastPortalUiReportRef = useRef("");
  const useUploadedBrandLogo = app.platformStatus?.landingLogoMode === "upload" && Boolean(app.platformStatus?.landingLogoPath);
  const useUploadedFavicon = app.platformStatus?.faviconMode === "upload" && Boolean(app.platformStatus?.faviconPath);
  const portalUiMode = normalizePortalUiMode(app.platformStatus?.portalUiMode, app.platformStatus?.userPortalV2Enabled ? "switchable" : "legacy");
  const portalV2Forced = portalUiMode === "v2";
  const portalUiSwitchable = portalUiMode === "switchable";
  const portalV2Allowed = portalUiSwitchable || portalV2Forced;
  const portalUiV2Active = portalV2Forced || portalUiSwitchable && portalUiVersion === "v2";
  const loadingPreviewMode = getLoadingPreviewMode();
  function openServiceReadyNotice(serviceKey, options = {}) {
    const rule = SERVICE_ACCESS_RULES[serviceKey] || {};
    setServiceReadyNotice({
      label: rule.label || SECTION_LABELS[serviceKey] || "서비스",
      emote: getRandomServiceReadyEmote(),
      terminalLine: options.terminalLine || getRandomServiceReadyTerminalLine()
    });
  }
  function isServiceOpen(serviceKey) {
    if (app.isAdmin) return true;
    const rule = SERVICE_ACCESS_RULES[serviceKey];
    if (!rule?.enabledKey) return true;
    return app.platformStatus?.[rule.enabledKey] !== false && Boolean(app.platformStatus?.[rule.enabledKey]);
  }
  const courseQuotesOpen = canUseCourseQuotePortal(app.platformStatus, app.isAdmin);
  const learningSectionKeys = ["resources", "curriculum2026", "courses", "iltCourses", "governmentCourses", "onlineCourses", "courseQuotes", "terminal", ...(portalUiV2Active ? ["terminalCloud"] : []), "cicd", ...(portalUiV2Active ? ["trove", "zun"] : ["selfServiceVm", "zun", "magnum", "trove"]), "aiGpu", ...(!portalUiV2Active ? ["customLabs"] : []), "surveys", "surveyResults", "llm"];
  function openServiceSection(serviceKey, openAction) {
    setMobileNavOpen(false);
    if (!isServiceOpen(serviceKey)) {
      openServiceReadyNotice(serviceKey);
      return;
    }
    openAction();
  }
  function openTerminalCloudIntent(intent = {}) {
    setTerminalCloudIntent({
      action: intent.action || "",
      tab: intent.tab || "",
      sourceSection: intent.sourceSection || "portal",
      nonce: Date.now()
    });
    switchSection(app, setMobileNavOpen, "terminalCloud", {
      closeMobileNav: intent.closeMobileNav !== false
    });
  }
  function openTrovePanel(panel = "create") {
    openServiceSection("trove", () => {
      switchSection(app, setMobileNavOpen, "trove", {
        closeMobileNav: false
      });
      window.setTimeout(() => {
        document.getElementById(`trove-${panel}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }, 0);
    });
  }
  function openCourseQuoteSection() {
    setMobileNavOpen(false);
    if (!courseQuotesOpen) {
      openServiceReadyNotice("courseQuotes", {
        terminalLine: "quote.access=admin_only"
      });
      return;
    }
    switchSection(app, setMobileNavOpen, "courseQuotes", {
      closeMobileNav: false
    });
  }
  function handleArenaAccess() {
    openServiceSection("arena", () => app.navigate("/arena-preview"));
  }
  function switchPortalUiVersion(version) {
    const nextVersion = version === "v2" ? "v2" : "v1";
    setPortalUiVersion(nextVersion);
    writePortalUiVersionPreference(nextVersion);
  }
  function openInquirySection(tab = "course", options = {}) {
    const {
      closeMobileNav = true
    } = options;
    const nextTab = ["service", "support", "course"].includes(tab) ? tab : "course";
    if (closeMobileNav) setMobileNavOpen(false);
    setInquiryDefaultTab(nextTab);
    if (nextTab !== "course") setCommunityCourseId("");
    app.setSection(nextTab === "support" ? "messages" : nextTab === "service" ? "consulting" : "qna");
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });
      });
    }
  }
  function openCommunitySection(courseId = "", options = {}) {
    const {
      closeMobileNav = true
    } = options;
    const normalizedCourseId = courseId ? String(courseId) : "";
    if (closeMobileNav) setMobileNavOpen(false);
    setInquiryDefaultTab("course");
    setCommunityCourseId(normalizedCourseId);
    if (normalizedCourseId) {
      app.setSelectedCourseId?.(normalizedCourseId);
      app.setQnaForm?.(current => ({
        ...current,
        courseId: normalizedCourseId,
        labRequestId: ""
      }));
    } else {
      app.setQnaForm?.(current => ({
        ...current,
        courseId: "",
        labRequestId: ""
      }));
    }
    app.setSection("qna");
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });
      });
    }
  }
  useEffect(() => {
    const faviconHref = useUploadedFavicon ? app.platformStatus.faviconPath : getTerminalLabFaviconHref();
    let faviconLink = document.querySelector("link[rel='icon']");
    if (!faviconLink) {
      faviconLink = document.createElement("link");
      faviconLink.setAttribute("rel", "icon");
      document.head.appendChild(faviconLink);
    }
    faviconLink.setAttribute("href", faviconHref);
    faviconLink.setAttribute("type", useUploadedFavicon ? String(app.platformStatus?.faviconMime || "image/x-icon") : KIKIOS_LOGO_MIME_TYPE);
  }, [app.platformStatus?.faviconMime, app.platformStatus?.faviconPath, useUploadedFavicon]);
  useEffect(() => {
    if (portalV2Forced && portalUiVersion !== "v2") {
      switchPortalUiVersion("v2");
      return;
    }
    if (!portalV2Allowed && portalUiVersion === "v2") {
      switchPortalUiVersion("v1");
    }
  }, [portalUiVersion, portalV2Allowed, portalV2Forced]);
  useEffect(() => {
    if (!portalUiV2Active && app.section === "terminalCloud") {
      app.setSection?.("resources");
      return;
    }
    const legacyCloudIntent = TERMINAL_CLOUD_LEGACY_SECTION_INTENTS[app.section];
    if (portalUiV2Active && legacyCloudIntent) {
      setTerminalCloudIntent({
        ...legacyCloudIntent,
        sourceSection: app.section,
        nonce: Date.now()
      });
      app.setSection?.("terminalCloud");
    }
  }, [app.section, app.setSection, portalUiV2Active]);
  useEffect(() => {
    if (!app.session?.id || app.isAdmin) return;
    const version = portalUiV2Active ? "v2" : "v1";
    const reportKey = `${app.session.id}:${version}:${portalUiMode}`;
    if (lastPortalUiReportRef.current === reportKey) return;
    lastPortalUiReportRef.current = reportKey;
    api("/api/user/portal-ui-version", {
      method: "POST",
      body: {
        version,
        mode: portalUiMode
      }
    }).catch(() => {
      // UI telemetry should never interrupt learning flow.
    });
  }, [app.isAdmin, app.session?.id, portalUiMode, portalUiV2Active]);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mediaQuery = window.matchMedia(SIDEBAR_OVERLAY_MEDIA_QUERY);
    const updateSidebarMode = () => setSidebarOverlayMode(mediaQuery.matches);
    updateSidebarMode();
    mediaQuery.addEventListener?.("change", updateSidebarMode);
    return () => mediaQuery.removeEventListener?.("change", updateSidebarMode);
  }, []);
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const shouldHideSidebar = sidebarOverlayMode && !mobileNavOpen;
    if (shouldHideSidebar) {
      sidebar.setAttribute("inert", "");
    } else {
      sidebar.removeAttribute("inert");
    }
  }, [mobileNavOpen, sidebarOverlayMode]);
  useEffect(() => {
    if (!mobileNavOpen || !sidebarOverlayMode) return undefined;
    const sidebar = sidebarRef.current;
    window.requestAnimationFrame(() => {
      getFocusableElements(sidebar)[0]?.focus();
    });
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNavOpen(false);
        return;
      }
      if (event.key !== "Tab" || !sidebar) return;
      const focusableElements = getFocusableElements(sidebar);
      if (!focusableElements.length) return;
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      mobileNavButtonRef.current?.focus?.();
    };
  }, [mobileNavOpen, sidebarOverlayMode]);
  useEffect(() => {
    if (!alertMenuOpen) return undefined;
    function handlePointerDown(event) {
      if (alertMenuRef.current && !alertMenuRef.current.contains(event.target)) {
        setAlertMenuOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setAlertMenuOpen(false);
        window.requestAnimationFrame(() => document.getElementById("portal-alert-button")?.focus());
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [alertMenuOpen]);
  const notificationUnreadCount = Math.max(0, Number(app.notificationUnreadCount || 0));
  const messageUnreadCount = Math.max(0, Number(app.messageUnreadCount || 0));
  const totalUnreadAlerts = notificationUnreadCount + messageUnreadCount;
  const sidebarAlertCountLabel = totalUnreadAlerts > 99 ? "99+" : String(totalUnreadAlerts);
  const recentAlertItems = useMemo(() => {
    const notificationItems = (app.notifications || []).slice(0, 5).map(item => ({
      key: `notification:${item.id}`,
      id: item.id,
      type: "notification",
      category: item.type || "system",
      title: item.title || "알림",
      body: item.body || "",
      createdAt: item.createdAt || "",
      unread: !item.isRead,
      section: item.linkSection || "notifications"
    }));
    const messageItems = (app.messages || []).filter(item => Number(item.recipientId) === Number(app.session?.id || 0)).slice(0, 5).map(item => ({
      key: `message:${item.id}`,
      id: item.id,
      type: "message",
      title: item.subject || "쪽지",
      body: item.body || "",
      createdAt: item.createdAt || "",
      unread: !item.readAt,
      section: "messages"
    }));
    return [...notificationItems, ...messageItems].sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()).slice(0, 5);
  }, [app.messages, app.notifications, app.session?.id]);
  const filteredAlertItems = useMemo(() => recentAlertItems.filter(item => {
    const matchesType = alertFilter === "all" || item.type === alertFilter;
    const matchesUnread = !showAlertUnreadOnly || item.unread;
    return matchesType && matchesUnread;
  }), [alertFilter, recentAlertItems, showAlertUnreadOnly]);
  useEffect(() => {
    const previousUnreadCount = previousUnreadRef.current;
    previousUnreadRef.current = totalUnreadAlerts;
    if (totalUnreadAlerts > previousUnreadCount && totalUnreadAlerts > 0) {
      setFreshAlertPulse(true);
      const timer = window.setTimeout(() => setFreshAlertPulse(false), 4200);
      return () => window.clearTimeout(timer);
    }
    if (totalUnreadAlerts <= 0) {
      setFreshAlertPulse(false);
    }
    return undefined;
  }, [totalUnreadAlerts]);
  useEffect(() => {
    if (ADVANCED_SECTIONS.includes(app.section)) {
      setShowAdvancedMenu(true);
    }
  }, [app.section]);
  useEffect(() => {
    if (!app.isAdmin && SERVICE_ACCESS_RULES[app.section] && !isServiceOpen(app.section)) {
      openServiceReadyNotice(app.section);
      app.setSection("resources");
    }
    if (app.section === "courseQuotes" && !courseQuotesOpen) {
      openServiceReadyNotice("courseQuotes", {
        terminalLine: "quote.access=admin_only"
      });
      app.setSection("resources");
    }
  }, [app.isAdmin, app.platformStatus, app.section, courseQuotesOpen]);
  const portalApp = useMemo(() => ({
    ...app,
    inquiryDefaultTab,
    communityCourseId,
    onOpenInquiryTab: openInquirySection,
    onOpenCommunity: openCommunitySection,
    onOpenCourseCommunity: openCommunitySection
  }), [app, inquiryDefaultTab, communityCourseId]);
  function openSidebarAlertShortcut() {
    if (messageUnreadCount > 0 && notificationUnreadCount <= 0) {
      openInquirySection("support");
      return;
    }
    switchSection(portalApp, setMobileNavOpen, "notifications");
  }
  if (loadingPreviewMode) {
    return <LoadingPreviewPage mode={loadingPreviewMode} />;
  }

if (portalApp.loading) {
    return <div className="shell">
        <main className="loading-shell">
          <SessionLoadingFallback />
        </main>
      </div>;
  }
  if (portalApp.route === "admin") {
    return <Suspense fallback={<ViewLoadingFallback />}>
        <AdminView {...portalApp} />
      </Suspense>;
  }

if (!portalApp.session) {
    return <Suspense fallback={<ViewLoadingFallback />}>
        <PortalLogin {...portalApp} />
      </Suspense>;
  }
  if (portalApp.termsConsentRequired && !portalApp.isAdmin) {
    return <div className="shell">
        <Suspense fallback={null}>
          <ToastStack onDismiss={app.dismissToast} toasts={app.toasts} />
        </Suspense>
        <TermsConsentGate activeTerms={portalApp.activeTerms} authStatus={portalApp.authStatus} onAcceptActiveTerms={portalApp.onAcceptActiveTerms} onLogout={portalApp.onLogout} />
      </div>;
  }
  if (portalApp.marketingConsentDecisionRequired && !portalApp.isAdmin) {
    return <div className="shell">
        <Suspense fallback={null}>
          <ToastStack onDismiss={app.dismissToast} toasts={app.toasts} />
        </Suspense>
        <MarketingConsentDecisionGate authStatus={portalApp.authStatus} onDecideMarketingConsent={portalApp.onDecideMarketingConsent} />
      </div>;
  }
  const sectionLabel = ["resources", "terminalCloud"].includes(portalApp.section) ? "클라우드 콘솔" : SECTION_LABELS[portalApp.section] || SECTION_LABELS.notices;
  const versionLabel = portalUiV2Active ? "v2.0" : "v1.0";
  const sidebarHidden = sidebarOverlayMode && !mobileNavOpen;
  const compactWorkspaceOverview = !["resources", "terminal", "llm"].includes(portalApp.section);
  return <CommunityUiMemory key={String(portalApp.session.id)}><div className={`shell community-modern-workspace ${portalUiV2Active ? "portal-ui-v2" : ""}`}>
      <a className="skip-link" href="#portal-workspace">본문으로 건너뛰기</a>
      <Suspense fallback={null}>
        <ToastStack onDismiss={app.dismissToast} toasts={app.toasts} />
      </Suspense>
      <LabParameterOverrideModal onCancel={portalApp.onCancelLabParameterOverrides} onSubmit={portalApp.onSubmitLabParameterOverrides} prompt={portalApp.labParameterOverridePrompt} />
      {serviceReadyNotice ? <div className="inline-notice-backdrop" onClick={() => setServiceReadyNotice(null)} role="presentation">
          <section aria-label="서비스 준비 안내" className="inline-notice-card service-ready-dialog" onClick={event => event.stopPropagation()}>
            <span className="card-label">{serviceReadyNotice.label}</span>
            <h3>{SERVICE_READY_MESSAGE}</h3>
            <div className="service-ready-terminal" aria-hidden="true">
              <span>&gt;</span>
              <strong>{serviceReadyNotice.emote}</strong>
              <code> {serviceReadyNotice.terminalLine || "feature.flag=off"}</code>
              <i>_</i>
            </div>
            <p>관리자가 이 기능을 공개하면 바로 사용할 수 있습니다.</p>
            <div className="inline-notice-actions">
              <button className="primary-btn" onClick={() => setServiceReadyNotice(null)} type="button">
                확인
              </button>
            </div>
          </section>
        </div> : null}
      <main className="app-shell">
        {sidebarOverlayMode && mobileNavOpen ? <div className="sidebar-backdrop" onClick={() => setMobileNavOpen(false)} role="presentation" /> : null}
        <CommunityNavigation section={portalApp.section} isAdmin={portalApp.isAdmin} onNavigate={key=>switchSection(portalApp,setMobileNavOpen,key)} onLogout={portalApp.onLogout} onAdmin={()=>portalApp.navigate('/admin')} onCommunity={()=>openCommunitySection()} onSupport={()=>openInquirySection('support')}/>


        <section className="workspace" id="portal-workspace" tabIndex={-1}>
          <header className="workspace-header">
            <div>
              <h2>{sectionLabel}</h2>
              <div className="workspace-version">{versionLabel}</div>
            </div>
            <div className="workspace-header-actions">
              {portalUiSwitchable ? <div className="portal-ui-version-toggle" aria-label="사용자 포털 인터페이스 선택" role="group">
                  <button aria-pressed={!portalUiV2Active} className={!portalUiV2Active ? "is-active" : ""} onClick={() => switchPortalUiVersion("v1")} type="button">
                    v1.0
                  </button>
                  <button aria-pressed={portalUiV2Active} className={portalUiV2Active ? "is-active" : ""} onClick={() => switchPortalUiVersion("v2")} type="button">
                    v2.0
                  </button>
                </div> : null}
              <div className="header-alert-wrap" ref={alertMenuRef}>
                <button aria-controls={alertMenuOpen ? "portal-alert-menu" : undefined} aria-expanded={alertMenuOpen ? "true" : "false"} aria-haspopup="dialog" aria-label={`알림함 열기${totalUnreadAlerts ? `, 안읽음 ${totalUnreadAlerts}건` : ""}`} className={`header-alert-btn ${totalUnreadAlerts ? "has-unread" : ""} ${totalUnreadAlerts ? "is-ringing" : ""} ${freshAlertPulse ? "is-fresh-ringing" : ""}`} id="portal-alert-button" onClick={() => setAlertMenuOpen(current => !current)} type="button">
                  <span className="header-alert-icon" aria-hidden="true">🔔</span>
                  <span>알림</span>
                  {totalUnreadAlerts ? <span className="header-alert-badge">{totalUnreadAlerts}</span> : null}
                </button>
                {alertMenuOpen ? <div aria-labelledby="portal-alert-title" className="header-alert-menu" id="portal-alert-menu" role="dialog">
                    <div className="header-alert-menu-head">
                      <strong id="portal-alert-title">최근 알림</strong>
                      <button className="ghost-btn" onClick={() => {
                    setAlertMenuOpen(false);
                    switchSection(portalApp, setMobileNavOpen, "notifications");
                  }} type="button">
                        전체 보기
                      </button>
                    </div>
                    <div className="header-alert-filters">
                      <div className="header-alert-tablist" role="tablist" aria-label="알림 필터">
                        {[{
                      key: "all",
                      label: "전체"
                    }, {
                      key: "notification",
                      label: "알림"
                    }, {
                      key: "message",
                      label: "쪽지"
                    }].map(filter => <button aria-controls="portal-alert-panel" aria-selected={alertFilter === filter.key ? "true" : "false"} className={`header-alert-tab ${alertFilter === filter.key ? "is-active" : ""}`} id={`portal-alert-tab-${filter.key}`} key={filter.key} onClick={() => setAlertFilter(filter.key)} role="tab" tabIndex={alertFilter === filter.key ? 0 : -1} type="button">
                            {filter.label}
                          </button>)}
                      </div>
                      <label className="toggle header-alert-toggle">
                        <input checked={showAlertUnreadOnly} onChange={event => setShowAlertUnreadOnly(event.target.checked)} type="checkbox" />
                        <span className="toggle-switch" aria-hidden="true">
                          <span className="toggle-thumb" />
                        </span>
                        <span className="toggle-copy">
                          <strong>{showAlertUnreadOnly ? "ON" : "OFF"}</strong>
                          <span>{showAlertUnreadOnly ? "미확인만 보기" : "전체 보기"}</span>
                        </span>
                      </label>
                    </div>
                    <div aria-labelledby={`portal-alert-tab-${alertFilter}`} className="header-alert-menu-list" id="portal-alert-panel" role="tabpanel">
                      {filteredAlertItems.length ? filteredAlertItems.map(item => {
                    const badgeMeta = getHeaderAlertBadgeMeta(item);
                    return <div className={`header-alert-item ${item.unread ? "is-unread" : ""}`} key={item.key}>
                            <button className="header-alert-item-main" onClick={() => {
                        setAlertMenuOpen(false);
                        if (item.section === "messages") {
                          openInquirySection("support", {
                            closeMobileNav: false
                          });
                        } else if (item.section === "qna") {
                          openInquirySection("course", {
                            closeMobileNav: false
                          });
                        } else if (item.section === "consulting") {
                          openInquirySection("service", {
                            closeMobileNav: false
                          });
                        } else {
                          switchSection(portalApp, setMobileNavOpen, item.section, {
                            closeMobileNav: false
                          });
                        }
                      }} type="button">
                              <div className="header-alert-item-head">
                                <span className={`status-chip ${badgeMeta.className}`}>{badgeMeta.label}</span>
                                <span className="hint">{formatHeaderDateTime(item.createdAt)}</span>
                              </div>
                              <strong>{item.title}</strong>
                              <span>{item.body || "내용이 없습니다."}</span>
                            </button>
                            {item.unread ? <div className="header-alert-item-actions">
                                <button className="mini-btn primary-mini-btn" onClick={async event => {
                          event.stopPropagation();
                          if (item.type === "message") {
                            await app.onMarkMessageRead(item.id);
                          } else {
                            await app.onMarkNotificationRead(item.id);
                          }
                        }} type="button">
                                  읽음 처리
                                </button>
                              </div> : null}
                          </div>;
                  }) : <div className="header-alert-empty">
                          {recentAlertItems.length ? "현재 필터에 맞는 항목이 없습니다." : "아직 최근 알림이 없습니다."}
                        </div>}
                    </div>
                    <div className="header-alert-menu-actions">
                      <button className="ghost-btn" onClick={() => {
                    setAlertMenuOpen(false);
                    openInquirySection("support", {
                      closeMobileNav: false
                    });
                  }} type="button">
                        문의 열기
                      </button>
                    </div>
                  </div> : null}
              </div>
              <button aria-controls="portal-sidebar" aria-expanded={mobileNavOpen ? "true" : "false"} className="ghost-btn mobile-nav-toggle" onClick={() => setMobileNavOpen(true)} ref={mobileNavButtonRef} type="button">
                메뉴
              </button>
              {portalApp.section === "terminal" ? <div className="session-badge">
                  <span className="session-badge-icon" aria-hidden="true">⚡</span>
                  <span>{portalApp.activeLab ? `현재 랩 상태: ${renderLabStatus(portalApp.activeLab.status)}` : "실행 중인 랩이 없습니다"}</span>
                </div> : null}
            </div>
          </header>
          <CommunityServiceLinks section={portalApp.section} onInstances={()=>openTerminalCloudIntent({tab:'instances'})} onServices={()=>openTerminalCloudIntent({tab:'services'})} onService={key=>{const action=()=>switchSection(portalApp,setMobileNavOpen,key);if(['zun','magnum','trove','aiGpu','llm'].includes(key))openServiceSection(key,action);else action();}}/>

          {portalUiV2Active ? <LabSwitcherDock app={portalApp} setMobileNavOpen={setMobileNavOpen} /> : null}

          <PortalV2TransitionBanner active={portalUiV2Active} mode={portalUiMode} onSwitchToV2={() => switchPortalUiVersion("v2")} platformStatus={portalApp.platformStatus} />

          {portalUiV2Active ? null : null}

          {["resources","terminalCloud","zun","magnum","trove","aiGpu","llm","cicd","internalImageServer","zunConsole","opsMonitor"].includes(portalApp.section) ? null : <UserWorkspaceOverview app={portalApp} compact={compactWorkspaceOverview} onOpenServiceSection={openServiceSection} portalUiV2Active={portalUiV2Active} setMobileNavOpen={setMobileNavOpen} />}

          {portalApp.section === "resources" ? <RecentNoticeStrip notices={portalApp.notices} onViewAll={() => switchSection(portalApp, setMobileNavOpen, "notices", {
          closeMobileNav: false
        })} /> : null}

          <SiteUpdateBanner platformStatus={portalApp.platformStatus} />
          {portalApp.platformStatus.labCircuitBreaker ? <div className="global-banner is-danger">{portalApp.platformStatus.labCircuitBreakerMessage}</div> : null}

          <Suspense fallback={<ViewLoadingFallback />}>
            {portalApp.section === "notices" ? <NoticeView {...portalApp} /> : null}

            {portalApp.section === "notifications" ? <NotificationView {...portalApp} /> : null}
            {portalApp.section === "profile" ? <ProfileView {...portalApp} /> : null}









            {portalApp.section === "terminal" ? <TerminalView {...portalApp} autoOpenTerminal portalUiV2Active={portalUiV2Active} /> : null}
            {portalApp.section === "luckyDraw" ? <LuckyDrawView {...portalApp} /> : null}
            {portalApp.section === "marketingSurveys" ? <MarketingSurveyView {...portalApp} /> : null}
            {portalApp.section === "opsMonitor" && portalApp.isAdmin ? <OpsMonitorView {...portalApp} /> : null}
            {portalApp.section === "opsMonitor" && !portalApp.isAdmin ? <div className="global-banner is-danger">운영 모니터는 관리자만 사용할 수 있습니다.</div> : null}
            {portalApp.section === "resources" ? <TerminalCloudView {...portalApp} terminalCloudIntent={terminalCloudIntent} onOpenTerminalCloudIntent={openTerminalCloudIntent} portalUiV2Active={portalUiV2Active} /> : null}


            {portalApp.section === "terminalCloud" ? <TerminalCloudView {...portalApp} terminalCloudIntent={terminalCloudIntent} /> : null}
            {portalApp.section === "internalImageServer" ? <InternalImageServerView {...portalApp} /> : null}
            {portalApp.section === "cicd" ? <CicdView {...portalApp} /> : null}
            {portalApp.section === "zun" ? <ZunView {...portalApp} /> : null}
            {portalApp.section === "zunConsole" ? portalApp.terminalSession?.wsPath ? <ZunContainerConsole session={portalApp.terminalSession} onClose={portalApp.onCloseZunContainerConsole} /> : <div className="simple-panel"><p className="hint">열려 있는 컨테이너 콘솔이 없습니다.</p><button className="mini-btn" onClick={portalApp.onCloseZunContainerConsole} type="button">컨테이너로 돌아가기</button></div> : null}
            {portalApp.section === "magnum" ? <MagnumView {...portalApp} /> : null}
            {portalApp.section === "trove" ? <TroveView {...portalApp} /> : null}
            {portalApp.section === "aiGpu" ? <AiLabView {...portalApp} /> : null}
            {portalApp.section === "llm" ? <LlmView {...portalApp} /> : null}
            {["qna", "messages", "consulting"].includes(portalApp.section) ? <InquiryHubView {...portalApp} communityOnly={portalApp.section === "qna"} /> : null}
          </Suspense>
        </section>
      </main>
      <SiteFooter platformStatus={app.platformStatus} />
    </div></CommunityUiMemory>;
}










function switchSection(app, setMobileNavOpen, section, options = {}) {
  const {
    closeMobileNav = true
  } = options;
  if (closeMobileNav) setMobileNavOpen(false);
  app.setSection(section);
  if (typeof window !== "undefined") {
    window.requestAnimationFrame(() => {
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    });
  }
}
function openTerminalSection(app, setMobileNavOpen, options = {}) {
  const activeLabCourseId = Number(app.activeLab?.courseId || 0);
  const selectedCourseId = Number(app.selectedCourseId || 0);
  if (activeLabCourseId && !selectedCourseId) app.setSelectedCourseId?.(activeLabCourseId);
  switchSection(app, setMobileNavOpen, "terminal", options);
}
const LAB_SWITCHER_STATUSES = ["pending", "approved", "provisioning", "running", "paused", "terminating"];
function getLabSwitcherEntries(app) {
  const courses = app.courses || [];
  const standaloneExamCourseIds = getStandaloneExamCourseIds(courses);
  return (app.labs || []).filter(lab => LAB_SWITCHER_STATUSES.includes(String(lab.status || "").toLowerCase()) && isLearningLabResource(lab, standaloneExamCourseIds)).map(lab => ({
    lab,
    course: courses.find(course => Number(course.id) === Number(lab.courseId) && !isStandaloneExamCourse(course)) || null
  })).sort((left, right) => {
    const statusWeight = entry => {
      const normalized = String(entry.lab?.status || "").toLowerCase();
      if (normalized === "running") return 6;
      if (normalized === "paused") return 5;
      if (normalized === "approved") return 4;
      if (normalized === "provisioning") return 3;
      if (normalized === "pending") return 2;
      if (normalized === "terminating") return 1;
      return 0;
    };
    const weightGap = statusWeight(right) - statusWeight(left);
    if (weightGap !== 0) return weightGap;
    const leftTitle = left.course?.title || left.lab?.courseTitle || "";
    const rightTitle = right.course?.title || right.lab?.courseTitle || "";
    return String(leftTitle).localeCompare(String(rightTitle), "ko");
  });
}
function getLabSwitcherTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "running") return "is-success";
  if (normalized === "paused" || normalized === "approved") return "is-warn";
  if (normalized === "provisioning" || normalized === "pending" || normalized === "terminating") return "is-muted";
  return "is-muted";
}
function getLabSwitcherBackendLabel(lab, course) {
  const backend = String(lab?.labBackendType || course?.labBackendType || "vm").trim().toLowerCase();
  if (backend === "container") return "컨테이너";
  return "VM";
}
function formatLabSwitcherRemaining(expiresAt) {
  if (!expiresAt) return "만료 정보 없음";
  const time = new Date(expiresAt).getTime();
  if (!Number.isFinite(time)) return "만료 정보 없음";
  const remainingMs = time - Date.now();
  if (remainingMs <= 0) return "만료됨";
  const totalMinutes = Math.ceil(remainingMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes % 1440 / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}일 ${hours}시간 남음`;
  if (hours > 0) return `${hours}시간 ${minutes}분 남음`;
  return `${minutes}분 남음`;
}
function getLabSwitcherIp(lab) {
  const instanceIp = String(lab?.instanceIp || "").trim();
  if (instanceIp) return instanceIp;
  const ips = Array.isArray(lab?.instanceIps) ? lab.instanceIps : [];
  const preferred = ips.find(item => String(item?.type || "").toLowerCase() === "floating") || ips.find(item => String(item?.type || "").toLowerCase() === "fixed") || ips[0];
  return String(preferred?.address || "").trim();
}
function LabSwitcherDock({
  app,
  setMobileNavOpen
}) {
  const entries = getLabSwitcherEntries(app);
  if (entries.length < 2) return null;
  const maxConcurrentLabs = Math.max(1, Number(app.platformStatus?.maxConcurrentLabs || 1) || 1);
  const activeLabId = Number(app.activeLab?.id || 0);
  const activeCourseId = Number(app.activeLab?.courseId || app.selectedCourseId || 0);
  const runningCount = entries.filter(entry => String(entry.lab.status || "").toLowerCase() === "running").length;
  const selectedEntry = entries.find(entry => Number(entry.lab.id) === activeLabId) || entries.find(entry => Number(entry.lab.courseId) === activeCourseId) || entries[0];
  const selectedTitle = selectedEntry?.course?.title || selectedEntry?.lab?.courseTitle || "선택한 랩";
  const quotaLabel = app.isAdmin ? `${entries.length}개 활성` : `${entries.length}/${maxConcurrentLabs}`;
  function selectLab(entry, section = "terminal") {
    const courseId = Number(entry.lab.courseId) || entry.lab.courseId;
    if (courseId) app.setSelectedCourseId?.(courseId);
    switchSection(app, setMobileNavOpen, section, {
      closeMobileNav: false
    });
  }
  return <section className="lab-switcher-dock" aria-label="실행 중인 랩 전환">
      <div className="lab-switcher-head">
        <div>
          <p className="card-label">Running Labs</p>
          <h3>실행 중인 랩 전환</h3>
          <p className="hint">{`현재 선택: ${selectedTitle} · 실행 ${runningCount}개`}</p>
        </div>
        <div className="lab-switcher-meta">
          <span className="status-chip is-success">{quotaLabel}</span>
          <button className="mini-btn" onClick={() => switchSection(app, setMobileNavOpen, "resources", {
          closeMobileNav: false
        })} type="button">
            학습 홈
          </button>
        </div>
      </div>
      <div className="lab-switcher-list">
        {entries.map(entry => {
        const {
          lab,
          course
        } = entry;
        const isActive = Number(lab.id) === activeLabId || !activeLabId && Number(lab.courseId) === activeCourseId;
        const title = course?.title || lab.courseTitle || `랩 #${lab.id}`;
        const ip = getLabSwitcherIp(lab);
        const publicCount = (lab.publicDomains || []).length;
        const requestedCount = (lab.requestedPublicDomains || []).length + (lab.requestedPublicTcpRoutes || []).length;
        const backendLabel = getLabSwitcherBackendLabel(lab, course);
        const toneClass = getLabSwitcherTone(lab.status);
        return <article className={`lab-switcher-card ${isActive ? "is-active" : ""}`} key={`lab-switcher-${lab.id}`}>
              <button className="lab-switcher-main" onClick={() => selectLab(entry, "terminal")} type="button">
                <span className={`lab-switcher-status-dot ${toneClass}`} aria-hidden="true" />
                <span className="lab-switcher-copy">
                  <strong title={title}>{title}</strong>
                  <small>{`${backendLabel} · ${formatLabSwitcherRemaining(lab.expiresAt)}`}</small>
                </span>
                <span className={`status-chip ${toneClass}`}>{renderLabStatus(lab.status)}</span>
              </button>
              <div className="lab-switcher-facts">
                <span>{`IP ${ip || "-"}`}</span>
                <span>{`URL ${publicCount}${requestedCount ? ` / 요청 ${requestedCount}` : ""}`}</span>
                <span>{`ID ${lab.id}`}</span>
              </div>
              <div className="lab-switcher-actions">
                <button className="mini-btn primary-mini-btn" onClick={() => selectLab(entry, "terminal")} type="button">
                  작업대
                </button>
                <button className="mini-btn" onClick={() => {
              const courseId = Number(lab.courseId) || lab.courseId;
              if (courseId) app.setSelectedCourseId?.(courseId);
              app.setOpenSelectedCourseDetail?.(true);
              switchSection(app, setMobileNavOpen, "resources", {
                closeMobileNav: false
              });
            }} type="button">
                  상태 보기
                </button>
              </div>
            </article>;
      })}
      </div>
    </section>;
}

function getSoonExpiringCourse(courses = [], thresholdDays = 7) {
  const nowMs = Date.now();
  return (courses || []).filter(course => !isStandaloneExamCourse(course)).map(course => {
    const expiresAt = course.enrollmentExpiresAt || course.expiresAt || course.accessExpiresAt || "";
    const expiresMs = expiresAt ? new Date(expiresAt).getTime() : 0;
    return {
      course,
      expiresAt,
      expiresMs,
      daysLeft: expiresMs ? Math.ceil((expiresMs - nowMs) / (24 * 60 * 60 * 1000)) : null
    };
  }).filter(item => item.course?.hasEnrollmentRecord && item.expiresMs > nowMs && item.daysLeft != null && item.daysLeft <= thresholdDays).sort((a, b) => a.expiresMs - b.expiresMs)[0] || null;
}
function UserWorkspaceOverview({
  app,
  compact = false,
  onOpenServiceSection,
  portalUiV2Active = false,
  setMobileNavOpen
}) {
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [scheduleSummary, setScheduleSummary] = useState([]);
  const activeLab = app.activeLab;
  const activeLabEntries = getLabSwitcherEntries(app);
  const activeLabCount = activeLabEntries.length;
  const activeVm = app.selfServiceVms.find(item => ["requested", "approved", "provisioning", "running", "terminating"].includes(item.status)) || null;
  const activeCustomLab = portalUiV2Active ? app.customLabRequests.find(item => !["deleted", "failed", "rejected", "cancelled", "canceled", "terminated"].includes(String(item.status || "").toLowerCase())) || null : null;
  const activeContainer = app.zunContainers.find(item => ["requested", "provisioning", "creating", "running", "stopping"].includes(item.status)) || null;
  const activeCluster = app.magnumClusters.find(item => !["deleted", "failed"].includes(String(item.status || "").toLowerCase())) || null;
  const activeDatabase = app.troveInstances.find(item => !["deleted", "failed"].includes(String(item.status || "").toLowerCase())) || null;
  const activeResources = [activeVm ? {
    type: "사용자화 가상머신",
    name: activeVm.stackName || `self-vm-${activeVm.id}`
  } : null, activeCustomLab ? {
    type: "연구실/랩 클라우드 콘솔",
    name: activeCustomLab.stackName || activeCustomLab.title || `poc-${activeCustomLab.id}`
  } : null, activeContainer ? {
    type: "컨테이너",
    name: activeContainer.name || `container-${activeContainer.id}`
  } : null, activeCluster ? {
    type: "Kubernetes",
    name: activeCluster.name || `cluster-${activeCluster.id}`
  } : null, activeDatabase ? {
    type: "데이터베이스",
    name: activeDatabase.name || `database-${activeDatabase.id}`
  } : null].filter(Boolean);
  const activeResourceCount = activeResources.length;
  const primaryActiveResource = activeResources[0] || null;
  const activeResourceValue = primaryActiveResource ? `${primaryActiveResource.name} · ${primaryActiveResource.type}` : "없음";
  const activeResourceHint = primaryActiveResource ? `${activeResourceCount}개 활성${activeResourceCount > 1 ? ` / ${activeResources.slice(1).map(item => `${item.name} · ${item.type}`).join(", ")}` : ""}` : "실행 중인 사용자화 자원이 없습니다.";
  const eligibleCertificateCount = Array.isArray(app.eligibleCertificates) ? app.eligibleCertificates.length : 0;
  const learningCatalogCourses = (app.courses || []).filter(course => !isStandaloneExamCourse(course));
  const governmentCourseCount = learningCatalogCourses.filter(course => String(course.courseType || "standard") === "standard" && isGovernmentProgramTypeValue(course.programType || "일반")).length;
  const iltCourseCount = learningCatalogCourses.filter(course => String(course.courseType || "standard") === "standard" && String(course.programType || "").trim().toLowerCase() === "ilt").length;
  const onlineCourseCount = learningCatalogCourses.filter(course => String(course.courseType || "standard") === "online").length;
  const generalCourseCount = learningCatalogCourses.filter(course => {
    const type = String(course.courseType || "standard").trim().toLowerCase();
    return (type === "standard" || type === "package") && !isGovernmentProgramTypeValue(course.programType || "일반") && String(course.programType || "").trim().toLowerCase() !== "ilt";
  }).length;
  const pendingResourceCount = [...app.selfServiceVms, ...(portalUiV2Active ? app.customLabRequests : []), ...app.zunContainers, ...app.magnumClusters, ...app.troveInstances].filter(item => ["requested", "approved", "provisioning", "creating", "building"].includes(String(item.status || "").toLowerCase())).length;
  const unreadInquiryCount = Math.max(0, Number(app.messageUnreadCount || 0)) + Math.max(0, Number(app.qnaUnreadCount || 0));
  const requestedResourceGraph = useMemo(() => buildRequestedResourceGraph(app), [app.selfServiceVms, app.customLabRequests, app.zunContainers, app.magnumClusters, app.troveInstances]);
  const showRequestedResourceGraph = app.section === "terminal" || app.section === "resources";
  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const to = new Date(now);
    to.setMonth(to.getMonth() + 2);
    const params = new URLSearchParams({
      from: now.toISOString(),
      to: to.toISOString(),
      limit: String(ONLINE_CLASS_ALERT_LIMIT),
      courseType: "online"
    });
    api(`/api/schedule-events?${params.toString()}`).then(result => {
      if (!cancelled) setScheduleSummary(result.events || []);
    }).catch(() => {
      if (!cancelled) setScheduleSummary([]);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const quickActions = [{
    key: "resources",
    label: "내 자원",
    desc: "내 프로젝트와 자원 상태를 확인",
    section: "resources",
    icon: "📚",
    eyebrow: "이어가기",
    statusLabel: activeLab || pendingResourceCount ? "확인 필요" : "정리됨",
    statusTone: activeLab || pendingResourceCount ? "info" : "muted"
  }, ...(iltCourseCount ? [] : []), ...(governmentCourseCount ? [] : []), ...(portalUiV2Active ? [{
    key: "terminalCloud",
    label: "클라우드 콘솔",
    desc: "전용 프로젝트, VM, 네트워크, DB 요청과 상태를 한곳에서 처리",
    section: "terminalCloud",
    tone: "terminal",
    icon: "CL",
    eyebrow: "클라우드",
    statusLabel: pendingResourceCount ? `${pendingResourceCount}건 진행` : activeResourceCount ? `${activeResourceCount}개 자원` : "요청 가능",
    statusTone: pendingResourceCount ? "info" : activeResourceCount ? "success" : "muted"
  }] : []), {
    key: "cicd",
    label: "CI/CD 파이프라인",
    desc: "Source, Build, Test, Deploy 흐름과 실행 이력을 확인",
    section: "cicd",
    tone: "terminal",
    icon: "CI",
    eyebrow: "파이프라인",
    statusLabel: "구성 가능",
    statusTone: "muted"
  }, {
    key: "llm",
    label: "AI 질문",
    desc: "실습 중 막힌 내용, 오류 메시지, 다음 단계 진행을 바로 질문",
    section: "llm",
    icon: "AI",
    eyebrow: "질문",
    statusLabel: app.llmMessages?.length ? `${app.llmMessages.length}건` : "질문 가능",
    statusTone: app.llmMessages?.length ? "info" : "muted"
  }, {
    key: "consulting",
    label: "상담 및 문의",
    desc: "강의 설계와 기술 컨설팅 요청을 바로 등록",
    section: "consulting",
    icon: "✉",
    eyebrow: "상담",
    statusLabel: app.messageUnreadCount ? `${app.messageUnreadCount}건` : "문의 가능",
    statusTone: app.messageUnreadCount ? "warning" : "muted"
  }, {
    key: "inquiry",
    label: "커뮤니티",
    desc: "기술 질문, 오류, 자료 공유를 한곳에서 확인",
    section: "qna",
    icon: "Q",
    eyebrow: "커뮤니티",
    statusLabel: unreadInquiryCount ? `${unreadInquiryCount}건` : "새 글 확인",
    statusTone: unreadInquiryCount ? "warning" : "muted"
  }];
  const summaryItems = [{
    key: "resource",
    label: "생성된 자원",
    value: activeResourceValue,
    hint: activeResourceHint
  }, {
    key: "assistant",
    label: "AI 대화",
    value: `${app.llmMessages?.length || 0}건`,
    hint: app.llmMessages?.length ? "최근 대화가 남아 있습니다." : "실습 중 궁금한 점을 바로 물어보세요."
  }];
  const onlineClassAlerts = scheduleSummary.filter(event => event.promotionEnabled || ["recruiting", "scheduled"].includes(String(event.status || ""))).slice(0, ONLINE_CLASS_ALERT_LIMIT);
  const expiringCourse = getSoonExpiringCourse(app.courses || []);
  const todayTaskItems = [activeLab ? {
    key: "active-lab",
    eyebrow: "이어가기",
    title: activeLab.courseTitle || "진행 중인 랩",
    detail: "랩실에서 콘솔과 교안을 바로 이어갑니다.",
    tone: "is-primary",
    onClick: () => openTerminalSection(app, setMobileNavOpen)
  } : null, expiringCourse ? {
    key: "expiring-course",
    eyebrow: "연장 필요",
    title: expiringCourse.course.title || "과정 만료 임박",
    detail: `${Math.max(1, expiringCourse.daysLeft)}일 후 접근 기간이 만료됩니다.`,
    tone: "is-warn",
    onClick: () => switchSection(app, setMobileNavOpen, "resources", {
      closeMobileNav: false
    })
  } : null, pendingResourceCount ? {
    key: "pending-resource",
    eyebrow: "생성 중",
    title: `자원 ${pendingResourceCount}개 준비 중`,
    detail: portalUiV2Active ? "클라우드 콘솔에서 VM과 네트워크 생성 상태를 확인하세요." : "사용자화 VM, 컨테이너, 클러스터 생성 상태를 확인하세요.",
    tone: "is-info",
    onClick: () => switchSection(app, setMobileNavOpen, portalUiV2Active ? "terminalCloud" : "resources", {
      closeMobileNav: false
    })
  } : null, unreadInquiryCount ? {
    key: "unread-inquiry",
    eyebrow: "문의",
    title: `미확인 답변 ${unreadInquiryCount}건`,
    detail: "커뮤니티 글과 운영지원 답변을 확인하세요.",
    tone: "is-success",
    onClick: () => {
      if (typeof app.onOpenInquiryTab === "function") {
        app.onOpenInquiryTab(app.messageUnreadCount ? "support" : "course");
        return;
      }
      if (typeof app.onOpenCommunity === "function") {
        app.onOpenCommunity("", {
          closeMobileNav: false
        });
        return;
      }
      switchSection(app, setMobileNavOpen, "qna", {
        closeMobileNav: false
      });
    }
  } : null, scheduleSummary[0] ? {
    key: "schedule",
    eyebrow: "강의 일정",
    title: scheduleSummary[0].title || "다가오는 강의",
    detail: `${formatHeaderDateTime(scheduleSummary[0].startAt)} 시작`,
    tone: "is-muted",
    onClick: () => switchSection(app, setMobileNavOpen, "offlineSchedule", {
      closeMobileNav: false
    })
  } : null, eligibleCertificateCount ? {
    key: "certificate",
    eyebrow: "수료증",
    title: `발급 가능 ${eligibleCertificateCount}건`,
    detail: "완료한 과정의 수료증을 확인하세요.",
    tone: "is-muted",
    onClick: () => switchSection(app, setMobileNavOpen, "certificates", {
      closeMobileNav: false
    })
  } : null].filter(Boolean).slice(0, 4);
  const preserveLlmOverviewChrome = app.section === "llm";
  const compactSummaryText = summaryItems.slice(0, 3).map(item => `${item.label}: ${item.value}`).join(" · ");
  function getOnlineClassCta(event) {
    if (event.status === "recruiting") return "수강신청";
    const now = Date.now();
    const start = new Date(event.startAt).getTime();
    const end = new Date(event.endAt).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end) return "강의실 보기";
    return "일정 보기";
  }
  const quickActionsPanel = <details className="quick-actions-panel quick-actions-accordion" open={quickActionsOpen} onToggle={event => setQuickActionsOpen(event.currentTarget.open)}>
      <summary className="quick-actions-summary">
        <div className="quick-actions-head">
          <div>
            <p className="card-label">{preserveLlmOverviewChrome ? "Quick Actions" : "바로가기"}</p>
            <h3>{compact ? "요약과 자주 여는 작업" : "자주 여는 작업"}</h3>
            {compact ? <p className="quick-actions-preview">{compactSummaryText}</p> : null}
          </div>
          {preserveLlmOverviewChrome ? <div className="workspace-version">자원 요청과 운영 도구로 바로 이동할 수 있습니다.</div> : <div className="quick-actions-meta">
              <span className="workspace-version">자원 요청과 운영 도구로 바로 이동할 수 있습니다.</span>
              <span className="quick-actions-toggle-label">{quickActionsOpen ? "접기" : "펼치기"}</span>
            </div>}
        </div>
      </summary>
      {compact ? <div className="workspace-summary-strip is-inside-quick-actions">
          {summaryItems.map(item => <article className="workspace-summary-card" key={item.key}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.hint}</small>
            </article>)}
        </div> : null}
      <div className="quick-actions-grid">
        {quickActions.map(action => <button aria-current={app.section === action.section ? "page" : undefined} className={`quick-action-card ${action.tone ? `is-${action.tone}` : ""} ${app.section === action.section ? "is-active" : ""}`} key={action.key} onClick={() => {
        if (["consulting", "inquiry"].includes(action.key) && typeof app.onOpenInquiryTab === "function") {
          app.onOpenInquiryTab(action.key === "consulting" ? "service" : "course");
          return;
        }
        if (action.key === "terminal") {
          openTerminalSection(app, setMobileNavOpen);
          return;
        }
        if (action.key === "selfServiceVm") {
          if (typeof onOpenServiceSection === "function") {
            onOpenServiceSection("selfServiceVm", () => switchSection(app, setMobileNavOpen, action.section, {
              closeMobileNav: false
            }));
            return;
          }
          switchSection(app, setMobileNavOpen, action.section, {
            closeMobileNav: false
          });
          return;
        }
        if (action.key === "llm") {
          onOpenServiceSection?.("llm", () => switchSection(app, setMobileNavOpen, action.section, {
            closeMobileNav: false
          }));
          return;
        }
        switchSection(app, setMobileNavOpen, action.section);
      }} type="button">
            {action.icon ? <span className="quick-action-card-topline">
                <span className={`quick-action-card-icon ${action.tone ? `is-${action.tone}` : ""}`} aria-hidden="true">{action.icon}</span>
                {action.eyebrow ? <span className="quick-action-card-eyebrow">{action.eyebrow}</span> : null}
                {portalUiV2Active && action.statusLabel ? <span className={`quick-action-card-status is-${action.statusTone || "muted"}`}>{action.statusLabel}</span> : null}
              </span> : null}
            <strong>{action.label}</strong>
            <span>{action.desc}</span>
          </button>)}
      </div>
    </details>;
  if (compact) {
    return <section className="workspace-overview is-compact">
        {quickActionsPanel}
      </section>;
  }
  return <section className="workspace-overview">
      <section className="today-task-panel" aria-label="오늘 해야 할 일">
        <div className="today-task-head">
          <div>
            <p className="card-label">Today</p>
            <h3>오늘 해야 할 일</h3>
          </div>
          <span className="status-chip is-muted">{todayTaskItems.length ? `${todayTaskItems.length}건` : "정리됨"}</span>
        </div>
        <div className="today-task-grid">
          {todayTaskItems.length ? todayTaskItems.map(item => <button className={`today-task-card ${item.tone || ""}`} key={item.key} onClick={item.onClick} type="button">
              <span>{item.eyebrow}</span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </button>) : <article className="today-task-card is-empty">
              <span>대기 없음</span>
              <strong>오늘은 바로 시작해도 좋습니다</strong>
              <small>만료 임박 과정, 생성 중 자원, 미확인 문의가 없습니다.</small>
            </article>}
        </div>
      </section>
      <div className="workspace-summary-strip">
        {summaryItems.map(item => <article className="workspace-summary-card" key={item.key}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.hint}</small>
          </article>)}
      </div>

      {onlineClassAlerts.length ? <section className="online-class-alert-strip" aria-label="온라인 클래스 알림">
          <div className="online-class-alert-head">
            <div>
              <p className="card-label">Online Class</p>
              <h3>모집/진행 중인 온라인 클래스</h3>
            </div>
            <span className="status-chip is-online">{`${onlineClassAlerts.length}개`}</span>
          </div>
          <div className="online-class-alert-grid">
            {onlineClassAlerts.map(event => <button className="online-class-alert-card" key={event.occurrenceId || event.id} onClick={() => switchSection(app, setMobileNavOpen, "offlineSchedule", {
          closeMobileNav: false
        })} type="button">
                <span className="online-class-alert-icon" aria-hidden="true">{ONLINE_CLASS_ALERT_ICONS[event.iconKey] || ONLINE_CLASS_ALERT_ICONS.video}</span>
                <span>
                  <strong>{event.promotionTitle || event.title}</strong>
                  <small>{event.promotionMessage || `${formatHeaderDateTime(event.startAt)} 시작`}</small>
                </span>
                <b>{getOnlineClassCta(event)}</b>
              </button>)}
          </div>
        </section> : null}

      {showRequestedResourceGraph ? <section className="requested-resource-panel">
          <div className="requested-resource-head">
            <div>
              <p className="card-label">Requested Resources</p>
              <h3>요청 자원 그래프</h3>
            </div>
            <strong>{`${requestedResourceGraph.totalUnits}개 자원`}</strong>
          </div>
          <div className="requested-resource-chart" aria-label="사용자가 요청한 자원 유형별 그래프">
            {requestedResourceGraph.types.map(item => <div className="requested-resource-row" key={item.key}>
                <div className="requested-resource-row-label">
                  <strong>{item.label}</strong>
                  <span>{`${item.units}개 / 요청 ${item.requests}건`}</span>
                </div>
                <div className="requested-resource-track">
                  <span className={`requested-resource-bar is-${item.key}`} style={{
              width: `${item.percent}%`
            }} />
                </div>
              </div>)}
          </div>
          <div className="requested-resource-status-grid">
            {requestedResourceGraph.statuses.map(item => <div className={`requested-resource-status is-${item.key}`} key={item.key}>
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </div>)}
          </div>
        </section> : null}

      {quickActionsPanel}
    </section>;
}
function buildRequestedResourceGraph(app) {
  const resourceTypes = [{
    key: "vm",
    label: "사용자화 가상머신",
    items: app.selfServiceVms || [],
    getUnits: item => Number(item.instanceCount || 1)
  }, {
    key: "poc",
    label: "클라우드 콘솔",
    items: app.customLabRequests || [],
    getUnits: item => Number(item.instanceCount || 1)
  }, {
    key: "container",
    label: "컨테이너",
    items: app.zunContainers || [],
    getUnits: () => 1
  }, {
    key: "cluster",
    label: "Kubernetes",
    items: app.magnumClusters || [],
    getUnits: item => Number(item.masterCount || 0) + Number(item.nodeCount || 0) || 1
  }, {
    key: "database",
    label: "데이터베이스",
    items: app.troveInstances || [],
    getUnits: () => 1
  }];
  const statusBuckets = [{
    key: "pending",
    label: "대기"
  }, {
    key: "provisioning",
    label: "생성 중"
  }, {
    key: "running",
    label: "실행"
  }, {
    key: "done",
    label: "종료"
  }, {
    key: "failed",
    label: "실패"
  }];
  const statuses = Object.fromEntries(statusBuckets.map(item => [item.key, 0]));
  const types = resourceTypes.map(type => {
    const items = Array.isArray(type.items) ? type.items : [];
    const units = items.reduce((sum, item) => {
      statuses[normalizeRequestedResourceStatus(item.status)] += 1;
      const nextUnits = Number(type.getUnits(item));
      return sum + (Number.isFinite(nextUnits) && nextUnits > 0 ? nextUnits : 1);
    }, 0);
    return {
      key: type.key,
      label: type.label,
      requests: items.length,
      units,
      percent: 0
    };
  });
  const peakUnits = Math.max(1, ...types.map(item => item.units));
  return {
    totalUnits: types.reduce((sum, item) => sum + item.units, 0),
    types: types.map(item => ({
      ...item,
      percent: item.units > 0 ? Math.max(8, Math.round(item.units / peakUnits * 100)) : 0
    })),
    statuses: statusBuckets.map(item => ({
      ...item,
      count: statuses[item.key] || 0
    }))
  };
}
function normalizeRequestedResourceStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (["requested", "pending", "approved", "quoted"].includes(normalized)) return "pending";
  if (["provisioning", "creating", "starting", "stopping", "terminating"].includes(normalized)) return "provisioning";
  if (["running", "active", "available", "paid"].includes(normalized)) return "running";
  if (["terminated", "deleted", "cancelled", "canceled", "completed"].includes(normalized)) return "done";
  if (["failed", "error", "rejected"].includes(normalized)) return "failed";
  return "pending";
}
function renderLabStatus(status) {
  if (status === "pending") return "승인 대기";
  if (status === "approved") return "시작 가능";
  if (status === "provisioning") return "생성 중";
  if (status === "running") return "실행 중";
  if (status === "paused") return "일시 중지";
  if (status === "terminating") return "종료 중";
  if (status === "terminated") return "종료됨";
  if (status === "failed") return "실패";
  return status || "-";
}
