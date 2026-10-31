import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Suspense, lazy } from "react";
import { Terminal } from "@xterm/xterm";
import "./xterm.css";
import {
  ACTIVE_LAB_STATUSES,
  accessEventLabel,
  AdminField,
  AdminDisclosureCard,
  PanelStatusMessage,
  QuotaSummaryBlock,
  FlavorBadges,
  StatusMessage,
  TrafficUsageBlock,
  VmDiagram,
  VmTabs,
  VmUsageBlock,
  describeCourseLabResizePolicy,
  deriveLabIpSummary,
  deriveSelectedNodeIpSummary,
  deriveVmNodes,
  formatDateTime,
  formatLabRetentionSummary,
  formatTrafficBytes,
  formatRemainingTime,
  getCustomLabAdvancedConfigLines,
  getCustomLabStatusLabel,
  getCourseBackendDetailLabel,
  getLabBackendLabel,
  getLabRuntimeNetworkName,
  getLabTimeWarning,
  getNormalizedSshPublicHost,
  generateRandomPublicSubdomainCandidate,
  isValidExternalPort,
  isWindowsLabProfile,
  isLabExamLocked,
  isGovernmentCourse,
  getYoutubeEmbedUrl,
  ipList,
  labStatus,
  materialDownloadHref,
  materialEmbedHref,
  materialPreviewHref,
  normalizeSshCopyValue,
  safeStringifyJson,
  renderZunStatus,
  resolveCourseLabResizeAllowedFlavors,
  resolveCourseLabResizePolicy,
  useImeBufferedInput,
} from "./portal-views.jsx";
import { api } from "./portal-state.js";

const GuideMarkdownBlock = lazy(() => import("./guide-renderer.jsx"));

const TERMINAL_AUTO_OPEN_RETRY_BASE_MS = 3000;
const TERMINAL_AUTO_OPEN_RETRY_MAX_MS = 15000;

const wsUrl = (pathname) =>
  `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${pathname}`;

function getInitialTerminalPopupTarget() {
  if (typeof window === "undefined") return { nodeId: "", targetHost: "" };
  const params = new URLSearchParams(window.location.search);
  return {
    nodeId: String(params.get("nodeId") || "").trim(),
    targetHost: String(params.get("targetHost") || "").trim(),
  };
}

function getInitialInstructorShareSessionId(){return null;}

function isVmNodePlanned(node) {
  return node?.planned === true || String(node?.planned || "").trim().toLowerCase() === "true";
}

function getVmNodeSelectionKey(node, index = 0) {
  return String(node?.id || node?.serverName || node?.server_name || node?.resourceName || node?.resource_name || node?.name || node?.fixedIp || node?.floatingIp || node?.ip || `vm-${index + 1}`).trim();
}

function getVmNodeOptionLabel(node, index = 0) {
  const name = String(node?.name || node?.serverName || node?.server_name || node?.resourceName || node?.resource_name || node?.id || `VM ${index + 1}`).trim();
  const ip = String(node?.fixedIp || node?.fixed_ip || node?.floatingIp || node?.floating_ip || node?.ip || "").trim();
  return ip ? `${name} / ${ip}` : name;
}

function buildVmNodeConsolePayload(node) {
  if (!node) return { nodeId: "", targetHost: "", serverName: "" };
  return {
    nodeId: String(node.id || "").trim(),
    targetHost: String(node.fixedIp || node.fixed_ip || node.floatingIp || node.floating_ip || node.ip || "").trim(),
    serverName: String(node.serverName || node.server_name || node.resourceName || node.resource_name || node.name || "").trim(),
  };
}

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
const ADMIN_REVIEW_REQUIRED_MESSAGE = "관리자 검토 후 사용이 가능합니다.";
const TERMINAL_EMBEDDED_MATERIAL_KINDS = new Set(["pdf", "ppt", "doc", "video"]);

function getCourseRequiredLabOverrideFields(course) {
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

function normalizeSharedConsoleText(value) {
  let text = String(value || "");
  if (!text) return "";
  text = text
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001bP[\s\S]*?\u001b\\/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[()][A-Za-z0-9]/g, "")
    .replace(/\u001b[@-Z\\-_]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text.replace(/[^\n]\u0008/g, "").replace(/^\u0008+/gm, "");
  }
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/g, "");
}

function getTerminalHrefFileName(href) {
  const withoutQuery = String(href || "").trim().split(/[?#]/)[0] || "";
  const fileName = withoutQuery.split("/").filter(Boolean).pop() || "";
  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

function getTerminalHrefExtension(href) {
  const fileName = getTerminalHrefFileName(href).toLowerCase();
  const match = fileName.match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function getTerminalMaterialKind(href) {
  const extension = getTerminalHrefExtension(href);
  if (extension === "pdf") return "pdf";
  if (extension === "ppt" || extension === "pptx") return "ppt";
  if (extension === "doc" || extension === "docx") return "doc";
  if (extension === "mp4" || extension === "webm") return "video";
  return "file";
}

function getTerminalResourceBadge(kind) {
  if (kind === "guide") return "가이드";
  if (kind === "commands") return "명령어";
  if (kind === "textbook") return "위키";
  if (kind === "pdf") return "PDF";
  if (kind === "ppt") return "PPT";
  if (kind === "doc") return "DOC";
  if (kind === "video") return "영상";
  return "자료";
}

function buildTerminalLearningResources(course) {
  if (!course) return [];
  const guideResources = [
    String(course.labGuideMarkdown || "").trim() ? {
      key: `guide-lab-${course.id || "course"}`,
      kind: "guide",
      title: "실습 가이드",
      summary: "랩 진행 순서와 체크포인트",
      contentMarkdown: course.labGuideMarkdown,
    } : null,
    String(course.commandsMarkdown || "").trim() ? {
      key: `guide-commands-${course.id || "course"}`,
      kind: "commands",
      title: "실습 명령어",
      summary: "복사해서 실행할 명령어 모음",
      contentMarkdown: course.commandsMarkdown,
    } : null,
  ].filter(Boolean);
  const textbookResources = (Array.isArray(course.textbooks) ? course.textbooks : [])
    .map((textbook, index) => ({
      key: `textbook-${textbook.id || index}`,
      kind: "textbook",
      title: String(textbook.title || `교재 ${index + 1}`).trim(),
      summary: String(textbook.summary || (textbook.required ? "필수 위키 교재" : "위키 교재")).trim(),
      contentMarkdown: textbook.contentMarkdown || "",
    }))
    .filter((item) => item.title || String(item.contentMarkdown || "").trim());
  const materialResources = (Array.isArray(course.materials) ? course.materials : [])
    .map((item, index) => {
      const href = String(item?.href || "").trim();
      const fileName = getTerminalHrefFileName(href);
      const extension = getTerminalHrefExtension(href);
      const kind = getTerminalMaterialKind(href);
      const title = String(item?.label || fileName || `교안 ${index + 1}`).trim();
      return {
        key: `material-${index}-${title}-${href}`,
        kind,
        title,
        summary: extension ? `${extension.toUpperCase()} 교안${fileName ? ` · ${fileName}` : ""}` : "첨부 교안",
        href,
        previewHref: materialPreviewHref(href),
        embedHref: materialEmbedHref(href, kind),
        downloadHref: materialDownloadHref(href),
        canEmbed: TERMINAL_EMBEDDED_MATERIAL_KINDS.has(kind) && Boolean(href),
      };
    })
    .filter((item) => item.title && item.href);
  const courseVideos = (Array.isArray(course.courseVideos) ? course.courseVideos : [])
    .map((video, index) => ({
      title: String(video?.title || `영상 ${index + 1}`).trim(),
      url: String(video?.url || "").trim(),
      description: String(video?.description || "").trim(),
    }))
    .filter((video) => video.title || video.url);
  const videoPlaylist = courseVideos.length
    ? courseVideos
    : String(course.youtubeUrl || "").trim()
      ? [{ title: course.title || "학습 영상", url: course.youtubeUrl, description: "" }]
      : [];
  const videoResources = videoPlaylist
    .map((video, index) => ({
      key: `video-${index}-${video.title || video.url}`,
      kind: "video",
      title: video.title || `영상 ${index + 1}`,
      summary: video.description || "학습 영상",
      url: video.url,
      embedUrl: getYoutubeEmbedUrl(video.url),
    }))
    .filter((item) => item.url);

  return [
    ...guideResources,
    ...textbookResources,
    ...materialResources,
    ...videoResources,
  ];
}

function inferPublicRouteProtocolForPort(port) {
  const numericPort = Number(port || 0);
  if (numericPort === 443 || numericPort === 8443) return "https";
  if (Number.isInteger(numericPort) && numericPort > 1000 && String(numericPort).endsWith("443")) return "https";
  return "http";
}

function validateManagedSubdomainInput(value) {
  const rawValue = String(value || "").trim();
  const normalized = rawValue.toLowerCase();
  if (!rawValue) return { ok: true, normalized: "", message: "" };
  if (normalized.length > 40) {
    return { ok: false, normalized, message: "서브도메인은 40자 이하로 입력해 주세요." };
  }
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    return { ok: false, normalized, message: "서브도메인은 영문 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다." };
  }
  if (normalized.startsWith("-") || normalized.endsWith("-")) {
    return { ok: false, normalized, message: "서브도메인은 하이픈(-)으로 시작하거나 끝날 수 없습니다." };
  }
  return { ok: true, normalized, message: "" };
}

function renderCustomDomainGuidanceText(template, replacements) {
  return String(template || "")
    .replace(/\{domain\}/g, replacements.domain)
    .replace(/\{target\}/g, replacements.target)
    .replace(/\{txtName\}/g, replacements.txtName);
}

function buildRdpFileContent({ host, port, username }) {
  return [
    `full address:s:${host}:${port}`,
    username ? `username:s:${username}` : "",
    "prompt for credentials:i:1",
    "authentication level:i:2",
    "enablecredsspsupport:i:1",
    "redirectclipboard:i:0",
    "redirectprinters:i:0",
    "drivestoredirect:s:",
    "screen mode id:i:2",
  ].filter(Boolean).join("\r\n");
}

function downloadTextFile(filename, content, type = "application/octet-stream") {
  const blob = new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function renderApiMonitorTone(entry) {
  if (!entry) return { label: "확인 전", className: "is-muted" };
  if (entry.ok) return { label: "정상", className: "is-success" };
  if (entry.deferred) return { label: "확인 대기", className: "is-muted" };
  if (entry.enabled === false || entry.configured === false) return { label: "미설정", className: "is-muted" };
  return { label: "오류", className: "is-error" };
}

function getTerminalVisibleText(terminal) {
  const activeBuffer = terminal?.buffer?.active;
  if (!activeBuffer) return "";
  const rowCount = Math.max(1, Number(terminal.rows || 24) || 24);
  const start = Math.max(0, Number(activeBuffer.viewportY || activeBuffer.baseY || 0) || 0);
  const lines = [];
  for (let index = start; index < start + rowCount; index += 1) {
    const line = activeBuffer.getLine(index);
    if (line) lines.push(line.translateToString(true).replace(/\s+$/g, ""));
  }
  return lines.join("\n").trimEnd();
}

function renderTerminalTextCapture(text, rootElement) {
  const lines = String(text || "").split("\n").slice(-42);
  const width = 1280;
  const lineHeight = 22;
  const padding = 28;
  const height = Math.max(420, padding * 2 + lines.length * lineHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const background = rootElement ? window.getComputedStyle(rootElement).backgroundColor : "#111827";
  context.fillStyle = background && background !== "rgba(0, 0, 0, 0)" ? background : "#111827";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#e5e7eb";
  context.font = "18px Consolas, 'Courier New', monospace";
  context.textBaseline = "top";
  lines.forEach((line, index) => {
    context.fillText(line || " ", padding, padding + index * lineHeight);
  });
  return {
    dataUrl: canvas.toDataURL("image/png"),
    width,
    height,
    source: "browser-terminal-text",
    capturedAt: new Date().toISOString(),
  };
}

function captureTerminalConsoleImage(rootElement, terminal) {
  if (!rootElement) {
    return {
      available: false,
      reason: "시험 콘솔 화면을 찾을 수 없습니다.",
      source: "browser-console",
      capturedAt: new Date().toISOString(),
    };
  }
  const rootRect = rootElement.getBoundingClientRect();
  const width = Math.max(1, Math.round(rootRect.width || 0));
  const height = Math.max(1, Math.round(rootRect.height || 0));
  const sourceCanvases = Array.from(rootElement.querySelectorAll("canvas"))
    .filter((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  if (sourceCanvases.length && width > 1 && height > 1) {
    try {
      const maxWidth = 1600;
      const maxHeight = 1000;
      const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      const scale = Math.min(pixelRatio, maxWidth / width, maxHeight / height, 2);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (context) {
        const background = window.getComputedStyle(rootElement).backgroundColor;
        context.scale(scale, scale);
        context.fillStyle = background && background !== "rgba(0, 0, 0, 0)" ? background : "#111827";
        context.fillRect(0, 0, width, height);
        sourceCanvases.forEach((sourceCanvas) => {
          const rect = sourceCanvas.getBoundingClientRect();
          context.drawImage(
            sourceCanvas,
            rect.left - rootRect.left,
            rect.top - rootRect.top,
            rect.width,
            rect.height,
          );
        });
        return {
          dataUrl: canvas.toDataURL("image/png"),
          width: canvas.width,
          height: canvas.height,
          source: "browser-console-canvas",
          capturedAt: new Date().toISOString(),
        };
      }
    } catch {
      // Fall through to the text capture path when a canvas cannot be read.
    }
  }
  const textSnapshot = renderTerminalTextCapture(getTerminalVisibleText(terminal), rootElement);
  if (textSnapshot?.dataUrl) return textSnapshot;
  return {
    available: false,
    reason: "캡처 가능한 콘솔 캔버스나 터미널 텍스트가 없습니다.",
    source: "browser-console",
    capturedAt: new Date().toISOString(),
  };
}



function ResourceTerminal(props) {
  const isTerminalPopup = props.popupMode === "terminal";
  const isEmbeddedMode = Boolean(props.embeddedMode);
  const terminalCaptureFrameRef = useRef(null);
  const terminalRootRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const socketRef = useRef(null);
  const replayRootRef = useRef(null);
  const replayTerminalRef = useRef(null);
  const replayFitAddonRef = useRef(null);
  const replayTimersRef = useRef([]);
  const replayPlaybackRef = useRef({ positionMs: 0, baseAt: 0, speed: 1 });
  const instructorShareSocketRef = useRef(null);
  const autoOpenedLabIdRef = useRef(null);
  const autoOpenTargetKeyRef = useRef("");
  const autoOpenRetryTimerRef = useRef(null);
  const autoOpenRetryAttemptsRef = useRef(0);
  const terminalRouteDetailsRef = useRef(null);
  const [showTerminalPassword, setShowTerminalPassword] = useState(false);
  const [terminalLayoutMode, setTerminalLayoutMode] = useState("default");
  const [terminalInfoCollapsed, setTerminalInfoCollapsed] = useState(true);
  const [terminalUsageOverlayVisible, setTerminalUsageOverlayVisible] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem("terminalUsageOverlayHidden") !== "1";
    } catch {
      return true;
    }
  });
  const [terminalRouteDetailsOpen, setTerminalRouteDetailsOpen] = useState(false);
  const [terminalRouteDetailsTab, setTerminalRouteDetailsTab] = useState("domain");
  const [activeTerminalResourceKey, setActiveTerminalResourceKey] = useState("");
  const [terminalLearningPanelSize, setTerminalLearningPanelSize] = useState("balanced");
  const [requestedResizeFlavor, setRequestedResizeFlavor] = useState("");
  const [selectedVmNodeId, setSelectedVmNodeId] = useState("");
  const [consoleSwitchState, setConsoleSwitchState] = useState(null);
  const [consoleSwitchElapsedSeconds, setConsoleSwitchElapsedSeconds] = useState(0);
  const [aiTerminalInstruction, setAiTerminalInstruction] = useState("");
  const [aiTerminalPlan, setAiTerminalPlan] = useState(null);
  const [aiTerminalPlanning, setAiTerminalPlanning] = useState(false);
  const [aiTerminalStatus, setAiTerminalStatus] = useState({ tone: "", message: "" });
  const [terminalSocketOpen, setTerminalSocketOpen] = useState(false);
  const [replayModalOpen, setReplayModalOpen] = useState(false);
  const [replayStatus, setReplayStatus] = useState({ tone: "", message: "" });
  const [replayData, setReplayData] = useState(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [labSupportModalOpen, setLabSupportModalOpen] = useState(false);
  const [labSupportDraft, setLabSupportDraft] = useState({ subject: "", body: "" });
  const [labSupportStatus, setLabSupportStatus] = useState({ tone: "", message: "" });
  const [labSupportSending, setLabSupportSending] = useState(false);
  const [vncClipboardText, setVncClipboardText] = useState("");
  const [vncClipboardSending, setVncClipboardSending] = useState(false);
  const [vncClipboardStatus, setVncClipboardStatus] = useState({ tone: "", message: "" });
  const [vmRebooting, setVmRebooting] = useState(false);
  const [instructorShareSessionId, setInstructorShareSessionId] = useState("");
  const [instructorShareOutput, setInstructorShareOutput] = useState("");
  const [instructorShareConnected, setInstructorShareConnected] = useState(false);
  const [instructorShareOnline, setInstructorShareOnline] = useState(false);
  const [instructorShareStatus, setInstructorShareStatus] = useState({ tone: "", message: "" });
  const [instructorShareMetadata, setInstructorShareMetadata] = useState({});
  const [instructorShareViewerOpen, setInstructorShareViewerOpen] = useState(false);
  const [instructorShareTokenInfo, setInstructorShareTokenInfo] = useState(null);
  const [instructorShareTokenCreating, setInstructorShareTokenCreating] = useState(false);
  const [labTimeTick, setLabTimeTick] = useState(0);
  const [terminalAutoOpenRetryTick, setTerminalAutoOpenRetryTick] = useState(0);
  const instructorSharePreviewRef = useRef(null);
  const instructorShareDetachedRef = useRef(null);
  const instructorShareKeepAliveRef = useRef(null);
  const terminalActionMenuCloseTimersRef = useRef(new Map());
  const initialPopupTargetRef = useRef(getInitialTerminalPopupTarget());
  const selectedCourse = props.selectedCourse || null;
  const supportGroupName = props.platformStatus?.supportMessageGroupName || "운영지원";
  const supportAvailabilityMode = String(props.platformStatus?.supportAvailabilityMode || "available").trim().toLowerCase() === "away" ? "away" : "available";
  const supportUnavailableMessage = String(props.platformStatus?.supportUnavailableMessage || "").trim()
    || `현재 ${supportGroupName} 담당자가 부재중입니다.`;
  const userCanBypassSupportAway = Boolean(props.isAdmin) || Boolean(props.session?.supportMessageEnabled);
  const supportAwayBlocksSubmit = supportAvailabilityMode === "away" && !userCanBypassSupportAway;
  const activeLabCourse = props.courses?.find((item) => Number(item.id) === Number(props.activeLab?.courseId)) || null;
  const externalSshUseDisabled = activeLabCourse?.externalSshApprovalMode === "disabled";
  const externalRdpUseDisabled = activeLabCourse?.externalRdpApprovalMode === "disabled";
  const activeLabExam = props.labExams?.find((item) => Number(item.courseId) === Number(props.activeLab?.courseId)) || null;
  const labExamCompleted = isLabExamLocked(activeLabExam);
  const activeLabCount = (props.labs || []).filter((item) => ["pending", "approved", "provisioning", "running", "paused", "terminating"].includes(String(item.status || "").toLowerCase())).length;
  const maxConcurrentLabs = Math.max(1, Number(props.platformStatus?.maxConcurrentLabs || 1) || 1);
  const isAdminUnlimitedLabs = Boolean(props.isAdmin);
  const canExtendLab = !labExamCompleted && (
    (activeLabCourse?.labRetentionMode === "persistent" && ["running", "paused"].includes(String(props.activeLab?.status || "").toLowerCase()))
    || props.activeLab?.status === "running"
  );
  const activeLabTimeWarning = getLabTimeWarning(props.activeLab?.expiresAt);
  void labTimeTick;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("terminalUsageOverlayHidden", terminalUsageOverlayVisible ? "0" : "1");
    } catch {
      // Ignore storage failures from private mode or restrictive browser policies.
    }
  }, [terminalUsageOverlayVisible]);

  useEffect(() => {
    const timer = window.setInterval(() => setLabTimeTick((current) => current + 1), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const canPauseLab = activeLabCourse?.labRetentionMode === "persistent" && props.activeLab?.status === "running" && !labExamCompleted;
  const canResetLab = !labExamCompleted && ["approved", "running", "paused", "failed"].includes(String(props.activeLab?.status || "").toLowerCase());
  const normalizedActiveLabTemplateName = String(activeLabCourse?.heatTemplateName || "").trim().toLowerCase();
  const managedLabCourse = normalizedActiveLabTemplateName.startsWith("linux-shell-lab")
    || ["example-lab.yaml", "kubeflow.yaml", "windows-rdp-lab.yaml"].includes(normalizedActiveLabTemplateName);
  const isWindowsLab = isWindowsLabProfile(activeLabCourse) || isWindowsLabProfile(props.activeLab);
  const useIssuedCredentials = Boolean(managedLabCourse || (isWindowsLab && props.activeLab?.terminalSshUser));
  const managedLabCredentialsReady = Boolean(props.activeLab?.terminalSshUser && props.activeLab?.terminalSshPassword);
  const resizePolicy = resolveCourseLabResizePolicy(activeLabCourse);
  const allowedResizeFlavors = resolveCourseLabResizeAllowedFlavors(activeLabCourse, props.platformStatus);

  useEffect(() => () => {
    terminalActionMenuCloseTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    terminalActionMenuCloseTimersRef.current.clear();
    if (autoOpenRetryTimerRef.current) {
      window.clearTimeout(autoOpenRetryTimerRef.current);
      autoOpenRetryTimerRef.current = null;
    }
  }, []);

  function clearTerminalActionMenuCloseTimer(menuKey) {
    const timerId = terminalActionMenuCloseTimersRef.current.get(menuKey);
    if (timerId) clearTimeout(timerId);
    terminalActionMenuCloseTimersRef.current.delete(menuKey);
  }

  function scheduleTerminalActionMenuClose(event, menuKey) {
    const menuElement = event.currentTarget;
    const nextTarget = event.relatedTarget;
    if (nextTarget && typeof Node !== "undefined" && nextTarget instanceof Node && menuElement.contains(nextTarget)) {
      return;
    }
    clearTerminalActionMenuCloseTimer(menuKey);
    const timerId = window.setTimeout(() => {
      if (menuElement.matches(":hover") || menuElement.contains(document.activeElement)) {
        terminalActionMenuCloseTimersRef.current.delete(menuKey);
        return;
      }
      menuElement.open = false;
      terminalActionMenuCloseTimersRef.current.delete(menuKey);
    }, 1100);
    terminalActionMenuCloseTimersRef.current.set(menuKey, timerId);
  }
  const vmNodes = deriveVmNodes(props.activeLab);
  const initialPopupTarget = isTerminalPopup ? initialPopupTargetRef.current : { nodeId: "", targetHost: "" };
  const vncTargetNodes = vmNodes.filter((node) => !isVmNodePlanned(node));
  const selectableVmNodes = vncTargetNodes.length ? vncTargetNodes : vmNodes;
  const selectedVmNode = selectableVmNodes.find((node, index) => getVmNodeSelectionKey(node, index) === String(selectedVmNodeId || ""))
    || selectableVmNodes.find((node) => String(node.id || "") === String(selectedVmNodeId || ""))
    || selectableVmNodes[0]
    || null;
  const selectedVmNodeIndex = selectedVmNode ? Math.max(0, selectableVmNodes.indexOf(selectedVmNode)) : 0;
  const selectedVmNodeKey = selectedVmNode ? getVmNodeSelectionKey(selectedVmNode, selectedVmNodeIndex) : "";
  const activeLabStatus = String(props.activeLab?.status || "").toLowerCase();
  const selectedNodeAccessMode = String(selectedVmNode?.accessMode || "").trim().toLowerCase();
  const selectedNodeConsoleAccess = String(selectedVmNode?.consoleAccess || "").trim().toLowerCase();
  const selectedNodeRole = String(selectedVmNode?.role || "").trim().toLowerCase();
  const selectedNodePlanned = isVmNodePlanned(selectedVmNode);
  const selectedNodeWantsVnc = selectedNodeAccessMode === "vnc" || selectedNodeConsoleAccess === "vnc";
  const selectedNodeSshConnectable = Boolean(selectedVmNode && !selectedNodePlanned && !selectedNodeWantsVnc && selectedNodeRole !== "bootstrap" && selectedNodeRole !== "control-plane" && selectedNodeRole !== "compute" && selectedNodeRole !== "infra");
  const selectedNodeVncConnectable = Boolean(selectedVmNode && !selectedNodePlanned);
  const activeLabHasRunningVm = Boolean(activeLabStatus === "running" && selectedVmNode);
  const isOpenShiftUpiPhysicalLab = normalizedActiveLabTemplateName === "openshift-upi-physical-lab.yaml";
  const canManageExternalSsh = activeLabStatus === "running"
    || (isOpenShiftUpiPhysicalLab && activeLabStatus === "provisioning");
  const activeLabHasExternalSshVm = Boolean(canManageExternalSsh && selectedVmNode);
  const activeLabIpSummary = deriveLabIpSummary(props.activeLab);
  const selectedVmIpSummary = deriveSelectedNodeIpSummary(props.activeLab, selectedVmNode);
  const showSelectedVmIpSummary = vmNodes.length > 1 && selectedVmNode;
  const terminalLoginUsername = String(props.activeLab?.terminalSshUser || props.terminalForm?.username || activeLabCourse?.terminalSshUser || "").trim();
  const nodeAccessLines = vmNodes.map((node, index) => {
    const nodeName = String(node?.name || `VM ${index + 1}`).trim();
    const nodeIp = String(node?.fixedIp || node?.floatingIp || "").trim() || "-";
    return `${nodeName} / ${nodeIp}${terminalLoginUsername ? ` / ${terminalLoginUsername}` : ""}`;
  });
  const requestedDomains = props.activeLab?.requestedPublicDomains || [];
  const requestedPublicTcpRoutes = props.activeLab?.requestedPublicTcpRoutes || [];
  const publicTcpRoutes = props.activeLab?.publicTcpRoutes || [];
  const requestedDomainUrls = requestedDomains.map((entry) => entry.url).filter(Boolean);
  const publicDomainUrls = (props.activeLab?.publicDomains || []).map((entry) => entry.url).filter(Boolean);
  const primaryRequestedDomainUrl = requestedDomainUrls[0] || "";
  const primaryPublicDomainUrl = publicDomainUrls[0] || "";
  const hasPendingRequestedDomains = requestedDomainUrls.length > 0;
  const externalSshHost = getNormalizedSshPublicHost(props.platformStatus?.sshPublicHost);
  const externalSshUsername = managedLabCourse
    ? String(props.activeLab?.terminalSshUser || "").trim()
    : String(props.activeLab?.terminalSshUser || props.terminalForm?.username || activeLabCourse?.terminalSshUser || "").trim();
  const externalSshTargets = activeLabHasExternalSshVm && props.activeLab?.externalSshEnabled
    ? vmNodes
      .filter((node) => {
        const accessMode = String(node?.accessMode || node?.access_mode || node?.consoleAccess || node?.console_access || "").trim().toLowerCase();
        return !accessMode || ["ssh", "terminal", "ssh_console"].includes(accessMode);
      })
      .map((node, index) => {
        const externalPort = Number(node?.externalSshPort ?? (index === 0 ? props.activeLab?.externalSshPort : null));
        const methods = [];
        if (isValidExternalPort(externalPort) && externalSshHost) {
          methods.push({
            kind: "port",
            label: "포트 방식",
            value: `${externalSshHost}:${externalPort}`,
            link: `ssh://${externalSshUsername}@${externalSshHost}:${externalPort}`,
            command: `ssh ${externalSshUsername}@${externalSshHost} -p ${externalPort}`,
          });
        }
        if (!methods.length) return null;
        return {
          port: isValidExternalPort(externalPort) ? externalPort : null,
          name: String(node?.name || `VM ${index + 1}`),
          sshHost: externalSshHost,
          methods,
          links: methods.map((item) => item.link).filter(Boolean),
          commands: methods.map((item) => item.command).filter(Boolean),
          label: `${String(node?.name || `VM ${index + 1}`)} / ${methods.map((item) => item.label).join(" + ")}`,
        };
      })
      .filter(Boolean)
    : [];
  if (activeLabHasExternalSshVm && props.activeLab?.externalSshEnabled && !externalSshTargets.length && isValidExternalPort(props.activeLab?.externalSshPort)) {
    externalSshTargets.push({
      port: Number(props.activeLab.externalSshPort),
      name: "VM 1",
      sshHost: "",
      methods: [{
        kind: "port",
        label: "포트 방식",
        value: `${externalSshHost}:${Number(props.activeLab.externalSshPort)}`,
        link: `ssh://${externalSshUsername}@${externalSshHost}:${Number(props.activeLab.externalSshPort)}`,
        command: `ssh ${externalSshUsername}@${externalSshHost} -p ${Number(props.activeLab.externalSshPort)}`,
      }],
      links: [`ssh://${externalSshUsername}@${externalSshHost}:${Number(props.activeLab.externalSshPort)}`],
      commands: [`ssh ${externalSshUsername}@${externalSshHost} -p ${Number(props.activeLab.externalSshPort)}`],
      label: `VM 1 / 포트 방식`,
    });
  }
  const externalSshCommand = externalSshTargets.flatMap((target) => target.commands || []).join("\n");
  const externalSshPassword = String(props.activeLab?.terminalSshPassword || "").trim();
  const externalSshLabel = externalSshTargets.length
    ? externalSshTargets.length === 1
      ? externalSshTargets[0].label
      : `${externalSshTargets[0].label} (+${externalSshTargets.length - 1})`
    : props.activeLab?.externalSshRequestPending
      ? "관리자 승인 대기"
      : externalSshUseDisabled
        ? "사용금지"
      : activeLabCourse?.externalSshApprovalMode === "instant"
        ? "즉시 사용 가능"
        : "미사용";
  const externalRdpEnabled = Boolean(props.activeLab?.externalRdpEnabled);
  const externalRdpPending = Boolean(props.activeLab?.externalRdpRequestPending);
  const externalRdpUsername = String(
    props.activeLab?.terminalRdpUser
    || props.activeLab?.windowsUser
    || props.activeLab?.terminalSshUser
    || props.terminalForm?.username
    || activeLabCourse?.terminalSshUser
    || "Administrator",
  ).trim();
  const externalRdpPassword = String(props.activeLab?.terminalRdpPassword || props.activeLab?.terminalSshPassword || "").trim();
  const showEmbeddedCredentials = Boolean(isEmbeddedMode && props.showEmbeddedCredentials);
  const externalRdpTargets = isWindowsLab && externalRdpEnabled
    ? vmNodes
      .map((node, index) => {
        const externalPort = Number(
          node?.externalRdpPort
          ?? props.activeLab?.externalRdpPort
        );
        if (!isValidExternalPort(externalPort) || !externalSshHost) return null;
        const name = String(node?.name || `VM ${index + 1}`);
        const value = `${externalSshHost}:${externalPort}`;
        return {
          port: externalPort,
          name,
          value,
          command: `mstsc /v:${value}`,
          rdpFile: buildRdpFileContent({ host: externalSshHost, port: externalPort, username: externalRdpUsername }),
          label: `${name} / RDP 포트`,
        };
      })
      .filter(Boolean)
    : [];
  const externalRdpCommands = externalRdpTargets.map((target) => target.command).join("\n");
  const externalRdpLabel = externalRdpTargets.length
    ? externalRdpTargets.length === 1
      ? externalRdpTargets[0].label
      : `${externalRdpTargets[0].label} (+${externalRdpTargets.length - 1})`
    : externalRdpPending
      ? "관리자 승인 대기"
      : externalRdpUseDisabled
        ? "사용금지"
      : activeLabCourse?.externalRdpApprovalMode === "instant"
        ? "즉시 사용 가능"
        : "미사용";
  const terminalSessionBusy = Boolean(props.terminalSessionBusy);
  const externalAccessInfoItem = isWindowsLab
    ? {
        label: "외부 RDP",
        value: externalRdpTargets.length ? externalRdpTargets.map((target) => target.value).join(", ") : externalRdpLabel,
        actions: externalRdpCommands ? [
          { label: externalRdpTargets.length > 1 ? "RDP 전체 복사" : "RDP 복사", type: "copy", value: externalRdpCommands },
          ...(externalRdpPassword ? [{ label: "비밀번호 복사", type: "copy", value: externalRdpPassword }] : []),
          ...(externalRdpTargets.length === 1 ? [{
            label: ".rdp 파일",
            type: "download",
            filename: `${String(props.activeLab?.stackName || props.activeLab?.courseTitle || "windows-lab").replace(/[^a-z0-9_-]+/gi, "-")}.rdp`,
            value: externalRdpTargets[0].rdpFile,
            mimeType: "application/x-rdp",
          }] : []),
        ] : [],
      }
    : {
        label: "외부 SSH",
        value: externalSshLabel,
        actions: externalSshCommand ? [
          { label: externalSshTargets.length > 1 ? "SSH 전체 복사" : "SSH 복사", type: "copy", value: externalSshCommand },
          ...(externalSshPassword ? [{ label: "비밀번호 복사", type: "copy", value: externalSshPassword }] : []),
          {
            label: "웹 터미널 열기",
            type: "web-terminal",
            disabled: !props.activeLab?.externalSshEnabled || props.activeLab?.status !== "running" || terminalSessionBusy || !selectedVmNode,
            onClick: openExternalSshInBrowser,
          },
        ] : [],
      };
  const activeLabBackendSource = activeLabCourse ? { ...activeLabCourse, ...(props.activeLab || {}) } : props.activeLab;
  const selectedVmNetworkInterfaces = Array.isArray(selectedVmNode?.networkInterfaces)
    ? selectedVmNode.networkInterfaces
    : [];
  const selectedVmMacLines = selectedVmNetworkInterfaces
    .filter((entry) => entry?.macAddress)
    .map((entry, index) => `${entry.portName || `NIC ${index + 1}`}: ${entry.macAddress}${entry.fixedIp ? ` (${entry.fixedIp})` : ""}`);
  const terminalInfoItems = [
    { label: "상태", value: props.activeLab ? labStatus(props.activeLab.status) : "실행 중인 랩이 없습니다" },
    { label: "백엔드", value: activeLabBackendSource ? getCourseBackendDetailLabel(activeLabBackendSource) : "-" },
    {
      label: showSelectedVmIpSummary ? "선택 VM 대표 IP" : "대표 IP",
      value: (showSelectedVmIpSummary ? selectedVmIpSummary.instanceIp : activeLabIpSummary.instanceIp) || "-",
    },
    {
      label: showSelectedVmIpSummary ? "선택 VM 전체 IP" : "전체 IP",
      value: ipList(showSelectedVmIpSummary ? selectedVmIpSummary.instanceIps : activeLabIpSummary.instanceIps),
    },
    {
      label: showSelectedVmIpSummary ? "선택 VM 모든 MAC" : "모든 MAC 주소",
      value: selectedVmMacLines.length ? selectedVmMacLines.join(", ") : selectedVmNode?.macAddress || "-",
      actions: selectedVmMacLines.length
        ? [{ label: "전체 복사", type: "copy", value: selectedVmMacLines.join("\n") }]
        : selectedVmNode?.macAddress
          ? [{ label: "복사", type: "copy", value: selectedVmNode.macAddress }]
          : [],
    },
    ...(showEmbeddedCredentials ? [
      { label: isWindowsLab ? "Windows 아이디" : "SSH 아이디", value: props.activeLab?.terminalSshUser || "-" },
      {
        label: "노드 접속 정보",
        value: nodeAccessLines.length ? nodeAccessLines.join(", ") : "-",
        actions: nodeAccessLines.length ? [{ label: "복사", type: "copy", value: nodeAccessLines.join("\n") }] : [],
      },
      {
        label: isWindowsLab ? "Windows 비밀번호" : "SSH 비밀번호",
        value: props.activeLab?.terminalSshPassword || "자격증명 준비 중",
        actions: props.activeLab?.terminalSshPassword ? [{ label: "복사", type: "copy", value: props.activeLab.terminalSshPassword }] : [],
      },
    ] : []),
    { label: "남은 시간", value: formatRemainingTime(props.activeLab?.expiresAt) },
    externalAccessInfoItem,
    {
      label: "요청 URL",
      value: requestedDomainUrls.length ? requestedDomainUrls.join(", ") : "-",
      actions: primaryRequestedDomainUrl ? [{ label: "복사", type: "copy", value: primaryRequestedDomainUrl }] : [],
    },
    {
      label: "공개 URL",
      value: publicDomainUrls.length ? publicDomainUrls.join(", ") : "-",
      links: publicDomainUrls,
      href: primaryPublicDomainUrl,
      actions: publicDomainUrls.length
        ? [
            { label: "복사", type: "copy", value: publicDomainUrls.join("\n") },
            ...(publicDomainUrls.length === 1 ? [{ label: "열기", type: "link", value: primaryPublicDomainUrl }] : []),
          ]
        : [],
    },
  ];
  const hiddenEmbeddedInfoLabels = new Set(props.hideExternalAccessInfo ? [isWindowsLab ? "외부 RDP" : "외부 SSH", "공개 URL"] : []);
  const terminalDisplayItems = isTerminalPopup
    ? terminalInfoItems.filter((item) => item.label === (isWindowsLab ? "외부 RDP" : "외부 SSH") || item.label === "요청 URL")
    : isEmbeddedMode
      ? terminalInfoItems.filter((item) => (
          (item.label === "상태" || item.label === "대표 IP" || item.label === "선택 VM 대표 IP" || item.label === "전체 IP" || item.label === "선택 VM 전체 IP" || item.label === "모든 MAC 주소" || item.label === "선택 VM 모든 MAC" || item.label === "SSH 아이디" || item.label === "노드 접속 정보" || item.label === "SSH 비밀번호" || item.label === "Windows 아이디" || item.label === "Windows 비밀번호" || item.label === (isWindowsLab ? "외부 RDP" : "외부 SSH") || item.label === "공개 URL")
          && !hiddenEmbeddedInfoLabels.has(item.label)
        ))
      : terminalInfoItems;
  const labBackendLabel = getLabBackendLabel(activeLabCourse, props.activeLab);
  const isContainerLab = labBackendLabel === "컨테이너";
  const containerNetworkName = getLabRuntimeNetworkName(activeLabCourse);
  const resetLabLabel = isContainerLab ? "컨테이너 재생성" : "랩 초기화";
  const domainConnectLabel = isContainerLab ? "공개 URL 연결" : "도메인 연결";
  const publicDomainRoutesEnabled = props.platformStatus?.publicDomainRoutesEnabled !== false;
  const externalSshRoutesEnabled = props.platformStatus?.externalSshRoutesEnabled !== false;
  const externalRdpRoutesEnabled = props.platformStatus?.externalRdpRoutesEnabled !== false;
  const terminalReconnectLabel = props.activeLab?.status === "paused"
    ? (isContainerLab ? "컨테이너 실행 재개" : "랩 재개")
    : isWindowsLab
      ? "Windows RDP 사용"
      : `현재 ${labBackendLabel} 연결`;
  const externalSshActionLabel = props.activeLab?.externalSshEnabled
    ? (isContainerLab ? "컨테이너 SSH 해제" : "외부 SSH 해제")
    : props.activeLab?.externalSshRequestPending
      ? (isContainerLab ? "컨테이너 SSH 요청 취소" : "외부 SSH 요청 취소")
      : externalSshUseDisabled
        ? (isContainerLab ? "컨테이너 SSH 사용금지" : "외부 SSH 사용금지")
      : activeLabCourse?.externalSshApprovalMode === "instant"
        ? (isContainerLab ? "컨테이너 SSH 바로 사용" : "외부 SSH 바로 사용")
        : (isContainerLab ? "컨테이너 SSH 요청" : "외부 SSH 요청");
  const externalRdpActionLabel = props.activeLab?.externalRdpEnabled
    ? "외부 RDP 해제"
    : props.activeLab?.externalRdpRequestPending
      ? "외부 RDP 요청 취소"
      : externalRdpUseDisabled
        ? "외부 RDP 사용금지"
      : activeLabCourse?.externalRdpApprovalMode === "instant"
        ? "외부 RDP 바로 사용"
        : "외부 RDP 요청";
  const externalSshActionBlocked = externalSshUseDisabled && !props.activeLab?.externalSshEnabled && !props.activeLab?.externalSshRequestPending;
  const externalRdpActionBlocked = externalRdpUseDisabled && !props.activeLab?.externalRdpEnabled && !props.activeLab?.externalRdpRequestPending;
  const externalAccessActionDisabled = !props.activeLab
    || (isWindowsLab ? props.activeLab.status !== "running" : !canManageExternalSsh)
    || labExamCompleted
    || (isWindowsLab
      ? externalRdpActionBlocked || (!externalRdpRoutesEnabled && !props.activeLab?.externalRdpEnabled && !props.activeLab?.externalRdpRequestPending)
      : externalSshActionBlocked || (!externalSshRoutesEnabled && !props.activeLab?.externalSshEnabled && !props.activeLab?.externalSshRequestPending));
  const externalAccessAction = isWindowsLab
    ? (props.activeLab?.externalRdpEnabled || props.activeLab?.externalRdpRequestPending ? props.onReleaseExternalRdp : props.onRequestExternalRdp)
    : (props.activeLab?.externalSshEnabled || props.activeLab?.externalSshRequestPending ? props.onReleaseExternalSsh : props.onRequestExternalSsh);
  const externalAccessActionText = isWindowsLab ? externalRdpActionLabel : externalSshActionLabel;
  const externalAccessCopyValue = isWindowsLab ? externalRdpCommands : externalSshCommand;
  const externalAccessValue = isWindowsLab
    ? (externalRdpTargets.length ? externalRdpTargets.map((target) => `${target.name}: ${target.value}`).join(", ") : externalRdpLabel)
    : (externalSshTargets.length
      ? externalSshTargets.flatMap((target) => (target.methods || []).map((method) => `${target.name}: ${method.value}`)).join(", ")
      : externalSshLabel);
  const publicTcpHost = getNormalizedSshPublicHost(props.platformStatus?.sshPublicHost);
  const publicTcpCopyValue = publicTcpRoutes.map((entry) => `${publicTcpHost}:${entry.externalPort}`).filter(Boolean).join("\n");
  const publicTcpSummary = publicTcpRoutes.length
    ? publicTcpRoutes.map((entry) => `${publicTcpHost}:${entry.externalPort} -> ${entry.targetPort}`).join(", ")
    : requestedPublicTcpRoutes.length
      ? requestedPublicTcpRoutes.map((entry) => `내부 ${entry.targetPort} 승인 대기`).join(", ")
      : "미설정";
  const consoleDomainSummary = publicDomainUrls.length
    ? publicDomainUrls[0]
      : requestedDomainUrls.length
        ? `${requestedDomainUrls[0]} 승인 대기`
        : "미설정";
  const consoleRouteDetailsAvailable = Boolean(props.publicRouteForm && props.setPublicRouteForm);
  const openTerminalRouteDetails = (options = {}) => {
    if (!consoleRouteDetailsAvailable) return;
    setTerminalRouteDetailsTab(options.tab === "tcp" ? "tcp" : "domain");
    if (options.randomDomain) {
      props.setPublicRouteForm((current) => ({
        ...current,
        domainType: "managed",
        customDomain: "",
        subdomain: "",
      }));
      props.setDomainAvailability?.({
        tone: "success",
        message: "서브도메인을 비워두면 요청 시 랜덤 도메인이 자동 생성됩니다.",
      });
    }
    setTerminalRouteDetailsOpen(true);
    window.requestAnimationFrame(() => {
      terminalRouteDetailsRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    });
  };
  const startingLabIds = new Set((props.startingLabIds || []).map((id) => String(id)));
  const isStartingActiveLab = Boolean(props.activeLab?.id && startingLabIds.has(String(props.activeLab.id)));
  const activeLabActionBusy = isStartingActiveLab || terminalSessionBusy || ["pending", "provisioning", "terminating"].includes(activeLabStatus);
  const canStartActiveLab = Boolean(props.activeLab && !activeLabActionBusy && ["approved", "failed"].includes(activeLabStatus));
  const canResumeActiveLab = Boolean(props.activeLab && !activeLabActionBusy && activeLabStatus === "paused");
  const activeLabPrimaryLabel = canStartActiveLab
    ? (isContainerLab ? "컨테이너 실행" : "랩 시작")
    : isStartingActiveLab
      ? "시작 요청 중"
      : activeLabStatus === "provisioning"
        ? (isContainerLab ? "컨테이너 생성 중" : "랩 생성 중")
        : activeLabStatus === "pending"
          ? "승인 대기"
            : activeLabStatus === "terminating"
              ? "종료 중"
              : terminalSessionBusy && activeLabStatus === "running"
              ? "연결 확인 중"
              : terminalReconnectLabel;
  const activeLabPrimaryDisabled = Boolean(
    !props.activeLab
    || labExamCompleted
    || activeLabActionBusy
    || (!canStartActiveLab && !canResumeActiveLab && (isWindowsLab || activeLabStatus !== "running" || !selectedNodeSshConnectable)),
  );
  const terminalCourseOptions = (props.courses || [])
    .filter((course) => props.isAdmin || (Boolean(course.hasEnrollmentRecord) && !course.enrollmentExpired))
    .map((course) => {
      const courseLab = (props.labs || []).find((item) => (
        ACTIVE_LAB_STATUSES.includes(String(item.status || "").toLowerCase())
        && Number(item.courseId) === Number(course.id)
      )) || null;
      return {
        course,
        lab: courseLab,
        label: `${course.title || `과정 #${course.id}`}${courseLab ? ` / 랩 ${labStatus(courseLab.status)}` : " / 랩 없음"}`,
      };
    })
    .sort((left, right) => {
      const statusWeight = (entry) => {
        const normalized = String(entry.lab?.status || "").toLowerCase();
        if (normalized === "running") return 5;
        if (normalized === "paused") return 4;
        if (normalized === "approved") return 3;
        if (normalized === "pending" || normalized === "provisioning") return 2;
        return 1;
      };
      const weightGap = statusWeight(right) - statusWeight(left);
      if (weightGap !== 0) return weightGap;
      return String(left.course.title || "").localeCompare(String(right.course.title || ""), "ko");
    });
  const selectedCourseOption = terminalCourseOptions.find((entry) => Number(entry.course.id) === Number(selectedCourse?.id)) || null;
  const terminalSelectedCourseOption = selectedCourseOption || terminalCourseOptions[0] || null;
  const labRoomEnrollmentDisabled = !props.loading && !props.isAdmin && terminalCourseOptions.length === 0;
  const terminalSelectedCourse = terminalSelectedCourseOption?.course || (props.isAdmin ? selectedCourse : null);
  const terminalSelectedCourseLab = terminalSelectedCourseOption
    ? terminalSelectedCourseOption.lab
    : (props.isAdmin ? props.selectedCourseLab : null);
  const activeLabOverrideFields = getCourseRequiredLabOverrideFields(activeLabCourse);
  const selectedCourseOverrideFields = getCourseRequiredLabOverrideFields(terminalSelectedCourse);
  const selectedCourseLabStatus = String(terminalSelectedCourseLab?.status || "").toLowerCase();
  const isStartingSelectedCourseLab = Boolean(terminalSelectedCourseLab?.id && startingLabIds.has(String(terminalSelectedCourseLab.id)));
  const isApplyingSelectedCourseLab = Boolean(
    terminalSelectedCourse?.id
    && (props.applyingLabCourseIds || []).some((id) => Number(id) === Number(terminalSelectedCourse.id)),
  );
  const selectedCourseLabActionBusy = isApplyingSelectedCourseLab || isStartingSelectedCourseLab || ["pending", "provisioning", "terminating"].includes(selectedCourseLabStatus);
  const selectedCourseStatusLabel = terminalSelectedCourseLab
    ? `랩 ${labStatus(terminalSelectedCourseLab.status)}`
    : terminalSelectedCourse?.labEnabled
      ? "랩 없음"
      : "랩 미사용";
  const terminalLearningCourse = terminalSelectedCourse || activeLabCourse || null;
  const courseExternalToolLinks = Array.isArray(terminalLearningCourse?.externalToolLinks)
    ? terminalLearningCourse.externalToolLinks
    : [];
  const courseExternalLearningTools = Array.isArray(terminalLearningCourse?.externalLearningTools)
    ? terminalLearningCourse.externalLearningTools
    : [];
  const courseExternalLinkCount = courseExternalToolLinks.length + courseExternalLearningTools.length;
  const courseLabStartChecklist = Array.isArray(terminalLearningCourse?.labStartChecklist)
    ? terminalLearningCourse.labStartChecklist
    : [];
  const showCourseAiToolPanel = Boolean(courseExternalLinkCount || courseLabStartChecklist.length);
  const terminalLearningResources = buildTerminalLearningResources(terminalLearningCourse);
  const terminalLearningResourceSignature = terminalLearningResources.map((resource) => resource.key).join("|");
  const activeTerminalResource = terminalLearningResources.find((resource) => resource.key === activeTerminalResourceKey)
    || terminalLearningResources[0]
    || null;
  const terminalLearningEnabled = Boolean(props.portalUiV2Active && !isTerminalPopup && !isEmbeddedMode && props.activeLab);
  const isTerminalLearningMode = terminalLearningEnabled && terminalLayoutMode === "learning";
  const terminalLearningKindLabels = Array.from(new Set(terminalLearningResources.map((resource) => getTerminalResourceBadge(resource.kind))))
    .filter(Boolean)
    .slice(0, 4);
  const terminalLearningResourceSummary = terminalLearningResources.length
    ? `${terminalLearningResources.length}개 자료 · ${terminalLearningKindLabels.join(" / ")}`
    : "연결된 교안 없음";
  const openLabSupportMessage = () => {
    const lab = terminalSelectedCourseLab || props.activeLab || null;
    const course = terminalSelectedCourse || activeLabCourse || null;
    const nodeLabel = selectedVmNode
      ? `${selectedVmNode.name || selectedVmNode.id || "선택 VM"} / ${selectedVmNode.fixedIp || selectedVmNode.floatingIp || "-"}`
      : "선택 없음";
    const bodyLines = [
      "문의 내용을 아래에 적어주세요.",
      "",
      "문제 상황:",
      "- ",
      "",
      "시도한 내용:",
      "- ",
      "",
      "--- 랩 정보 ---",
      `과정: ${course?.title || "-"}`,
      `랩 ID: ${lab?.id || "-"}`,
      `랩 상태: ${labStatus(lab?.status) || lab?.status || "-"}`,
      `백엔드: ${activeLabBackendSource ? getCourseBackendDetailLabel(activeLabBackendSource) : "-"}`,
      `Stack: ${lab?.stackName || "-"} / ${lab?.stackId || "-"}`,
      `대표 IP: ${activeLabIpSummary.instanceIp || "-"}`,
      `전체 IP: ${ipList(activeLabIpSummary.instanceIps) || "-"}`,
      `선택 VM: ${nodeLabel}`,
      `현재 Flavor: ${lab?.currentFlavor || "-"}`,
      `접속 대상: ${props.terminalSession?.targetLabel || "대기 중"}`,
      `콘솔 상태: ${terminalSocketOpen ? "연결됨" : "대기/미연결"}`,
      `외부 접속: ${isWindowsLab ? externalRdpLabel : externalSshLabel}`,
      `현재 교안: ${activeTerminalResource?.title || "선택 없음"}`,
      `작성 시각: ${new Date().toLocaleString("ko-KR")}`,
      "",
      "※ 비밀번호, 개인키, 개인정보는 적지 마세요.",
    ];
    setLabSupportDraft({
      subject: `[랩 문의] ${course?.title || "과정"} / ${labStatus(lab?.status) || lab?.status || "랩"}`,
      body: bodyLines.join("\n"),
    });
    setLabSupportStatus(supportAwayBlocksSubmit
      ? { tone: "error", message: supportUnavailableMessage }
      : { tone: "", message: "" });
    setLabSupportModalOpen(true);
  };
  const submitLabSupportMessage = async (event) => {
    event?.preventDefault?.();
    if (supportAwayBlocksSubmit) {
      setLabSupportStatus({ tone: "error", message: supportUnavailableMessage });
      return;
    }
    const subject = String(labSupportDraft.subject || "").trim();
    const body = String(labSupportDraft.body || "").trim();
    if (!subject || !body) {
      setLabSupportStatus({ tone: "error", message: "제목과 문의 내용을 모두 입력해 주세요." });
      return;
    }
    try {
      setLabSupportSending(true);
      setLabSupportStatus({ tone: "", message: "" });
      const result = await api("/api/messages", {
        method: "POST",
        body: {
          recipientId: "group:support",
          subject,
          body,
        },
      });
      await props.loadMessages?.();
      setLabSupportStatus({ tone: "success", message: result.message || `${supportGroupName}에 문의를 보냈습니다.` });
      window.setTimeout(() => {
        setLabSupportModalOpen(false);
        setLabSupportStatus({ tone: "", message: "" });
      }, 900);
    } catch (error) {
      setLabSupportStatus({ tone: "error", message: error.message || "문의 전송 중 오류가 발생했습니다." });
    } finally {
      setLabSupportSending(false);
    }
  };
  const renderLabSupportModal = () => {
    if (!labSupportModalOpen) return null;
    return (
      <div
        aria-modal="true"
        className="portal-modal-backdrop terminal-support-modal-backdrop"
        onClick={() => !labSupportSending && setLabSupportModalOpen(false)}
        role="dialog"
      >
        <form className="portal-modal-card terminal-support-modal" onClick={(event) => event.stopPropagation()} onSubmit={submitLabSupportMessage}>
          <div className="terminal-support-modal-head">
            <div>
              <p className="card-label">랩 작업대 문의</p>
              <h3>{`${supportGroupName}에 바로 문의하기`}</h3>
              <p className="hint">현재 랩, 선택 VM, 콘솔 상태, 교안 정보가 자동으로 포함됩니다.</p>
            </div>
            <button className="mini-btn" disabled={labSupportSending} onClick={() => setLabSupportModalOpen(false)} type="button">닫기</button>
          </div>
          {supportAwayBlocksSubmit ? (
            <div className="inline-message is-error">
              <strong>{`${supportGroupName} 부재중`}</strong>
              <span>{supportUnavailableMessage}</span>
            </div>
          ) : null}
          <AdminField label="제목" required>
            <input
              disabled={labSupportSending || supportAwayBlocksSubmit}
              onChange={(event) => setLabSupportDraft((current) => ({ ...current, subject: event.target.value }))}
              value={labSupportDraft.subject}
            />
          </AdminField>
          <AdminField label="문의 내용" required>
            <textarea
              disabled={labSupportSending || supportAwayBlocksSubmit}
              onChange={(event) => setLabSupportDraft((current) => ({ ...current, body: event.target.value }))}
              rows={14}
              value={labSupportDraft.body}
            />
          </AdminField>
          <div className="hint">비밀번호, 개인키, 개인정보는 입력하지 마세요.</div>
          <StatusMessage {...labSupportStatus} />
          <div className="portal-actions terminal-support-modal-actions">
            <button className="ghost-btn" disabled={labSupportSending} onClick={() => setLabSupportModalOpen(false)} type="button">취소</button>
            <button className="primary-btn" disabled={labSupportSending || supportAwayBlocksSubmit} type="submit">
              {labSupportSending ? "전송 중" : "문의 보내기"}
            </button>
          </div>
        </form>
      </div>
    );
  };
  const terminalLayoutOptions = [
    { value: "default", label: "기본" },
    props.portalUiV2Active ? {
      value: "learning",
      label: "랩+교안",
      disabled: !props.activeLab,
      title: props.activeLab ? "콘솔과 교안을 동시에 봅니다." : "랩을 신청하거나 실행하면 사용할 수 있습니다.",
    } : null,
    { value: "compact", label: "컴팩트" },
    { value: "wide", label: "크게" },
  ].filter(Boolean);
  const terminalLearningPanelSizeOptions = [
    { value: "terminal", label: "콘솔 크게" },
    { value: "balanced", label: "반반" },
    { value: "materials", label: "교안 크게" },
  ];
  const selectedCourseHasAccess = props.isAdmin || terminalSelectedCourse?.hasAccess !== false;
  const selectedCourseIsContainer = String(terminalSelectedCourse?.labBackendType || "vm") === "container";
  const canRequestSelectedCourseLab = Boolean(
    terminalSelectedCourse
    && selectedCourseHasAccess
    && terminalSelectedCourse.labEnabled
    && !terminalSelectedCourseLab
    && !isApplyingSelectedCourseLab
    && !props.platformStatus?.labCircuitBreaker
    && (isAdminUnlimitedLabs || activeLabCount < maxConcurrentLabs)
  );
  const canStartSelectedCourseLab = Boolean(
    terminalSelectedCourse
    && selectedCourseHasAccess
    && !selectedCourseLabActionBusy
    && ["approved", "paused", "failed"].includes(selectedCourseLabStatus)
    && !props.platformStatus?.labCircuitBreaker
  );
  const selectedCourseLabIsActiveLab = Boolean(
    props.activeLab?.id
    && terminalSelectedCourseLab?.id
    && Number(props.activeLab.id) === Number(terminalSelectedCourseLab.id)
  );
  const triggerTerminalReadinessStart = () => {
    if (canStartSelectedCourseLab && (!props.activeLab || !selectedCourseLabIsActiveLab)) {
      props.onStartLab(terminalSelectedCourseLab?.id, terminalSelectedCourse?.id);
      return;
    }
    if (props.activeLab && (canStartActiveLab || canResumeActiveLab)) {
      props.onStartLab(props.activeLab.id, activeLabCourse?.id);
      return;
    }
    if (canStartSelectedCourseLab) {
      props.onStartLab(terminalSelectedCourseLab?.id, terminalSelectedCourse?.id);
    }
  };
  const terminalEmptyTitle = terminalSelectedCourse?.title || "선택한 과정";
  const terminalEmptyDescription = !terminalSelectedCourse
    ? "먼저 과정을 선택하면 이 작업대에서 랩 요청, 콘솔, 외부 SSH, 공개 URL 흐름을 바로 이어서 사용할 수 있습니다."
    : !terminalSelectedCourse.labEnabled
      ? "이 과정은 랩을 사용하지 않는 과정입니다. 과정 상세에서 자료와 안내를 먼저 확인해 주세요."
      : !selectedCourseHasAccess
        ? "이 과정은 접근 권한이 필요합니다. 과정 상세에서 신청 또는 승인 상태를 먼저 확인해 주세요."
        : terminalSelectedCourseLab
          ? "이 과정의 랩이 아직 실행 전 상태입니다. 아래 버튼으로 요청 또는 시작 흐름을 이어갈 수 있습니다."
          : "이 과정의 랩이 아직 없습니다. 아래 버튼으로 바로 요청하거나 과정 상세에서 준비 상태를 확인해 주세요.";
  const terminalEmptyPrimaryLabel = isApplyingSelectedCourseLab
    ? "랩 요청 중"
    : isStartingSelectedCourseLab
      ? "시작 요청 중"
      : selectedCourseLabStatus === "provisioning"
        ? (selectedCourseIsContainer ? "컨테이너 생성 중" : "랩 생성 중")
        : selectedCourseLabStatus === "pending"
          ? "승인 대기"
          : selectedCourseLabStatus === "terminating"
            ? "종료 중"
            : canRequestSelectedCourseLab
              ? (selectedCourseIsContainer ? "컨테이너 요청" : "랩 요청")
              : canStartSelectedCourseLab
                ? (selectedCourseIsContainer ? "컨테이너 실행" : "랩 시작")
                : "";
  const terminalEmptyPrimaryDisabled = Boolean(selectedCourseLabActionBusy || (!canRequestSelectedCourseLab && !canStartSelectedCourseLab));
  const activeLabNeedsStartSecret = canStartActiveLab && activeLabOverrideFields.length > 0;
  const selectedCourseNeedsStartSecret = canStartSelectedCourseLab && selectedCourseOverrideFields.length > 0;
  const startSecretHintText = (fields) => fields.length
    ? `시작 시 ${fields.map((field) => field.label).join(", ")} 입력이 필요합니다. 입력값은 저장하지 않습니다.`
    : "";
  const renderCourseAiToolPanel = () => {
    if (!showCourseAiToolPanel) return null;
    return (
      <div className="terminal-ai-tool-panel">
        <div className="terminal-ai-tool-panel-head">
          <div>
            <span className="card-label">외부 학습 도구</span>
            <strong>외부 AI/학습 도구를 열고 같은 랩 흐름으로 실습합니다.</strong>
          </div>
          <span className="status-chip is-success">{courseExternalLinkCount ? `${courseExternalLinkCount}개 링크` : "체크리스트"}</span>
        </div>
        {courseExternalToolLinks.length ? (
          <>
            <div className="terminal-ai-tool-section-title">외부 AI 도구</div>
            <div className="terminal-ai-tool-links">
              {courseExternalToolLinks.map((item, index) => (
                <a href={item.url} key={`${item.url}-${index}`} rel="noreferrer" target="_blank">
                  <strong>{item.label}</strong>
                  {item.required ? <span className="status-chip is-warn">필수</span> : null}
                  {item.description ? <small>{item.description}</small> : null}
                </a>
              ))}
            </div>
          </>
        ) : null}
        {courseExternalLearningTools.length ? (
          <>
            <div className="terminal-ai-tool-section-title">외부 학습 도구</div>
            <div className="terminal-ai-tool-links">
              {courseExternalLearningTools.map((item, index) => (
                <a href={item.url} key={`${item.url}-${index}`} rel="noreferrer" target="_blank">
                  <strong>{item.label}</strong>
                  {item.required ? <span className="status-chip is-warn">필수</span> : null}
                  {item.description ? <small>{item.description}</small> : null}
                </a>
              ))}
            </div>
          </>
        ) : null}
        {courseLabStartChecklist.length ? (
          <ul className="terminal-ai-tool-checklist">
            {courseLabStartChecklist.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
          </ul>
        ) : null}
      </div>
    );
  };
  const aiTerminalSocketReady = Boolean(
    !isWindowsLab
    && props.terminalSession?.wsPath
    && terminalSocketOpen
  );
  const canUseAiTerminalPlanner = Boolean(
    !isWindowsLab
    && props.activeLab
    && props.activeLab.status === "running"
    && !labExamCompleted
  );
  const terminalNoticeItems = [];
  if (!isTerminalPopup && !isEmbeddedMode) {
    if (activeLabTimeWarning) {
      terminalNoticeItems.push({
        key: "lab-time-warning",
        tone: "warn",
        label: "시간",
        message: activeLabTimeWarning.message,
        sticky: true,
      });
    }
    if (labExamCompleted) {
      terminalNoticeItems.push({
        key: "lab-exam-completed",
        tone: "error",
        label: "제한",
        message: "랩 시험 제출이 완료되어 터미널, 외부 SSH, 새 공개 도메인 요청이 제한되었습니다.",
      });
    }
    if (activeLabCourse?.labRetentionMode === "persistent") {
      terminalNoticeItems.push({
        key: "persistent-lab",
        tone: "info",
        label: "유지형",
        message: "유지형 랩은 일시 중지 후 같은 과정에서 다시 시작할 수 있으며, 필요하면 12시간씩 연장할 수 있습니다.",
      });
    }
    if (isContainerLab) {
      terminalNoticeItems.push({
        key: "container-lab",
        tone: "info",
        label: "컨테이너",
        message: "컨테이너 과정은 VM 재구성이나 VNC 대신 컨테이너 재생성, 컨테이너 SSH, 공개 URL 흐름으로 사용합니다.",
      });
    }
    if (!isContainerLab && resizePolicy === "admin_only") {
      terminalNoticeItems.push({
        key: "resize-admin-only",
        tone: "warn",
        label: "사양 변경",
        message: "이 과정의 랩 사양 변경은 관리자만 직접 처리할 수 있습니다.",
      });
    }
    if (!isContainerLab && resizePolicy === "disabled") {
      terminalNoticeItems.push({
        key: "resize-disabled",
        tone: "info",
        label: "사양 변경",
        message: "이 과정은 랩 사양 변경을 지원하지 않습니다.",
      });
    }
    if (!isContainerLab && props.activeLab?.resizeReviewedBy) {
      terminalNoticeItems.push({
        key: "resize-reviewed",
        tone: "info",
        label: "검토",
        message: `최근 사양 변경 검토: ${props.activeLab.resizeReviewedBy}${props.activeLab.resizeReviewedAt ? ` / ${props.activeLab.resizeReviewedAt}` : ""}${props.activeLab.resizeReviewNote ? ` / ${props.activeLab.resizeReviewNote}` : ""}`,
      });
    }
    if (requestedDomains.length || requestedPublicTcpRoutes.length || props.activeLab?.externalSshRequestPending || props.activeLab?.externalRdpRequestPending) {
      terminalNoticeItems.push({
        key: "admin-review-required",
        tone: "info",
        label: "검토",
        message: ADMIN_REVIEW_REQUIRED_MESSAGE,
      });
    }
    if (useIssuedCredentials) {
      terminalNoticeItems.push(managedLabCredentialsReady
        ? {
            key: "issued-credentials",
            tone: "success",
            label: "계정",
            message: isWindowsLab
              ? "이 랩에는 Windows 접속용 임시 계정이 자동 발급되었습니다. 외부 RDP와 콘솔 접속에 같은 자격증명을 사용합니다."
              : "이 랩에는 전용 임시 Linux 계정이 자동 발급되었습니다. 아래 자격증명으로만 접속할 수 있습니다.",
          }
        : {
            key: "legacy-credentials",
            tone: "warn",
            label: "계정",
            message: "이 랩은 예전 방식으로 생성되어 전용 임시 계정 정보가 없습니다. 새 랩을 다시 생성하면 랜덤 계정과 비밀번호가 함께 발급됩니다.",
          });
    } else if (props.activeLab?.terminalSshUser) {
      terminalNoticeItems.push({
        key: "configured-credentials",
        tone: "success",
        label: "계정",
        message: isWindowsLab
          ? "이 랩에는 Windows 접속용 계정이 설정되어 있습니다."
          : "이 랩에는 전용 임시 Linux 계정이 자동 발급되었습니다.",
      });
    }
  }

  function getLearningSectionForCourse(course) {
    if (!course) return "courses";
    if (String(course.courseType || "").trim().toLowerCase() === "online") {
      return "onlineCourses";
    }
    if (isGovernmentCourse(course, props.platformStatus)) {
      return "governmentCourses";
    }
    return "courses";
  }

  function copyTerminalValue(value) {
    if (!value) return;
    navigator.clipboard?.writeText(normalizeSshCopyValue(value));
  }

  function normalizeInstructorShareId(){return null;}

  function closeInstructorShareSocket(){return null;}

  function connectInstructorShare(){return null;}

  function copyInstructorShareOutput(){return null;}

  function downloadInstructorShareOutput(){return null;}

  function createInstructorShareSession(){return null;}

  function copyInstructorSharePublishId(){return null;}

  function copyInstructorShareCommand(){return null;}

  function copyInstructorShareFallbackCommand(){return null;}

  function openInstructorShareViewer(){return null;}

  function openInstructorShareStandaloneWindow(){return null;}

  function openTerminalLinks(links = []) {
    const uniqueLinks = Array.from(new Set((Array.isArray(links) ? links : [links]).filter(Boolean)));
    uniqueLinks.forEach((link) => window.open(link, "_blank", "noopener,noreferrer"));
  }

  useEffect(() => () => {
    closeInstructorShareSocket({ resetState: false });
  }, []);

  useEffect(() => {
    if (!instructorShareOutput) return undefined;
    const frame = window.requestAnimationFrame(() => {
      [instructorSharePreviewRef.current, instructorShareDetachedRef.current].forEach((element) => {
        if (!element) return;
        element.scrollTop = element.scrollHeight;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [instructorShareOutput, instructorShareViewerOpen]);

  useEffect(() => {
    if (!instructorShareViewerOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setInstructorShareViewerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [instructorShareViewerOpen]);

  useEffect(() => {
    if (!terminalLearningResources.length) {
      setActiveTerminalResourceKey("");
      return;
    }
    setActiveTerminalResourceKey((current) => (
      terminalLearningResources.some((resource) => resource.key === current)
        ? current
        : terminalLearningResources[0].key
    ));
  }, [terminalLearningResourceSignature]);

  useEffect(() => {
    if (terminalLayoutMode !== "learning") return;
    if (props.portalUiV2Active && props.activeLab) return;
    setTerminalLayoutMode("default");
  }, [props.portalUiV2Active, props.activeLab?.id, terminalLayoutMode]);

  useEffect(() => {
    if (!props.activeLab) {
      setRequestedResizeFlavor("");
      return;
    }
    setRequestedResizeFlavor(props.activeLab.requestedResizeFlavor || props.activeLab.currentFlavor || allowedResizeFlavors[0] || "");
  }, [props.activeLab?.id, props.activeLab?.requestedResizeFlavor, props.activeLab?.currentFlavor, allowedResizeFlavors]);

  useEffect(() => {
    if (!consoleSwitchState) {
      setConsoleSwitchElapsedSeconds(0);
      return undefined;
    }
    const updateElapsed = () => {
      setConsoleSwitchElapsedSeconds(Math.max(0, Math.floor((Date.now() - consoleSwitchState.startedAt) / 1000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [consoleSwitchState]);

  useEffect(() => {
    setConsoleSwitchState(null);
  }, [props.activeLab?.id]);

  useEffect(() => {
    if (!vmNodes.length) {
      setSelectedVmNodeId("");
      return;
    }
    setSelectedVmNodeId((current) => {
      if (current && vmNodes.some((node, index) => getVmNodeSelectionKey(node, index) === String(current))) return current;
      const preferredNodeId = terminalSessionBusy
        ? ""
        : String(props.terminalSession?.nodeId || initialPopupTarget.nodeId || "").trim();
      const preferredIndex = vmNodes.findIndex((node) => String(node.id || "") === preferredNodeId);
      if (preferredIndex >= 0) return getVmNodeSelectionKey(vmNodes[preferredIndex], preferredIndex);
      return getVmNodeSelectionKey(vmNodes[0], 0);
    });
  }, [vmNodes, props.terminalSession?.nodeId, initialPopupTarget.nodeId, terminalSessionBusy]);

  useEffect(() => {
    if (!terminalRootRef.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "Consolas, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.25,
      theme: { background: "#111827", foreground: "#e5e7eb", cursor: "#f9fafb" },
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    const fitTerminal = () => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          fitAddon.fit();
          terminal.scrollToBottom();
        });
      });
    };
    terminal.loadAddon(fitAddon);
    terminal.open(terminalRootRef.current);
    fitTerminal();
    terminal.writeln("\uD130\uBBF8\uB110\uC774 \uC900\uBE44\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    const onResize = () => fitTerminal();
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          fitTerminal();
        })
      : null;
    resizeObserver?.observe(terminalRootRef.current);
    window.addEventListener("resize", onResize);
    const initialFitTimer = window.setTimeout(() => {
      fitTerminal();
    }, 80);
    return () => {
      window.clearTimeout(initialFitTimer);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onResize);
      socketRef.current?.close();
      terminalRef.current = null;
      fitAddonRef.current = null;
      terminal.dispose();
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;

    socketRef.current?.close();
    setTerminalSocketOpen(false);
    terminal.clear();

    if (!props.terminalSession?.wsPath) {
      terminal.writeln("\uC2E4\uD589 \uC911\uC778 \uB7A9\uC774 \uC788\uC73C\uBA74 \uC774 \uD654\uBA74\uC5D0\uC11C \uD130\uBBF8\uB110\uC744 \uC5F4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
      return;
    }

    let disposed = false;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    let terminalSessionEnded = false;
    let lastReconnectNoticeAt = 0;
    let sessionRefreshRequested = false;

    function scheduleReconnect() {
      if (disposed || terminalSessionEnded) return;
      const delayMs = Math.min(10000, 1500 + reconnectAttempts * 1500);
      reconnectAttempts += 1;
      const now = Date.now();
      if (now - lastReconnectNoticeAt > 5000) {
        terminal.writeln(`\r\n[\uC7AC\uC5F0\uACB0] ${Math.round(delayMs / 1000)}\uCD08 \uD6C4 \uB2E4\uC2DC \uC5F0\uACB0\uD569\uB2C8\uB2E4.`);
        lastReconnectNoticeAt = now;
      }
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectSocket();
      }, delayMs);
    }

    function connectSocket() {
      if (disposed || terminalSessionEnded) return;
      const socket = new WebSocket(wsUrl(props.terminalSession.wsPath));
      socketRef.current = socket;
      let socketOpened = false;
      const socketOpenTimeout = window.setTimeout(() => {
        if (socket.readyState !== WebSocket.CONNECTING) return;
        terminal.writeln("\r\n[연결 지연] WebSocket 연결 응답이 없어 새 연결을 준비합니다.");
        socket.close();
      }, 10000);

      socket.addEventListener("open", () => {
        window.clearTimeout(socketOpenTimeout);
        socketOpened = true;
        reconnectAttempts = 0;
        setTerminalSocketOpen(true);
        window.requestAnimationFrame(() => {
          if (socket.readyState !== WebSocket.OPEN) return;
          fitAddon.fit();
          terminal.scrollToBottom();
          socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
        });
        terminal.writeln(`\uB300\uC0C1: ${props.terminalSession.targetLabel}`);
      });

      socket.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "data" || payload.type === "output") terminal.write(payload.data);
          if (payload.type === "status") terminal.writeln(`\r\n[안내] ${payload.message}`);
          if (payload.type === "exit") {
            terminalSessionEnded = true;
            terminal.writeln("\r\n[세션 종료]");
          }
          if (payload.type === "error") terminal.writeln(`\r\n[\uC624\uB958] ${payload.message}`);
        } catch {
          terminal.write(event.data);
        }
      });

      socket.addEventListener("close", (event) => {
        window.clearTimeout(socketOpenTimeout);
        if (socketRef.current === socket) {
          setTerminalSocketOpen(false);
        }
        if (disposed) return;
        if (terminalSessionEnded) return;
        if (!socketOpened && !sessionRefreshRequested && props.activeLab?.status === "running" && typeof props.onCreateTerminalSession === "function") {
          sessionRefreshRequested = true;
          const closeCode = Number(event?.code || 0);
          terminal.writeln(`\r\n[세션 갱신] WebSocket 연결에 실패해 새 터미널 세션을 준비합니다.${closeCode ? ` (code=${closeCode})` : ""}`);
          const node = selectedVmNode || vmNodes[0] || null;
          if (node) {
            props.onCreateTerminalSession({
              labId: props.activeLab?.id,
              courseId: props.activeLab?.courseId,
              nodeId: node.id,
              targetHost: node.fixedIp || node.floatingIp || "",
            });
            return;
          }
        }
        terminal.writeln("\r\n[\uC5F0\uACB0 \uC885\uB8CC]");
        scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        if (!disposed && !socketOpened) {
          terminal.writeln("\r\n[연결 오류] 터미널 WebSocket 연결을 확인하고 있습니다.");
        }
      });
    }

    connectSocket();

    const disposableData = terminal.onData((data) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
    });

    const disposableResize = terminal.onResize(({ cols, rows }) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", cols, rows }));
    });

    const keepAliveTimer = window.setInterval(() => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "ping", at: Date.now() }));
      }
    }, 30000);

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      window.clearInterval(keepAliveTimer);
      disposableData.dispose();
      disposableResize.dispose();
      setTerminalSocketOpen(false);
      socketRef.current?.close();
    };
  }, [props.terminalSession]);

  useEffect(() => {
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;
    if (!fitAddon || !terminal) return;
    const timer = window.setTimeout(() => {
      fitAddon.fit();
      terminal.scrollToBottom();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [selectedVmNode?.id, props.terminalSession?.wsPath, props.activeLab?.id, terminalLayoutMode, terminalLearningPanelSize]);

  useEffect(() => {
    if (!props.autoOpenTerminal || !props.activeLab || props.activeLab.status !== "running" || isWindowsLab) {
      autoOpenTargetKeyRef.current = "";
      return;
    }
    if (terminalSessionBusy) return;
    const activeLabExam = props.labExams?.find((item) => Number(item.courseId) === Number(props.activeLab?.courseId)) || null;
    if (!props.isAdmin && isLabExamLocked(activeLabExam)) return;
    const popupNodeId = String(initialPopupTarget.nodeId || "").trim();
    const popupTargetHost = String(initialPopupTarget.targetHost || "").trim();
    const initialNode = vmNodes.find((node) => String(node.id || "") === popupNodeId)
      || vmNodes.find((node) => popupTargetHost && [node.fixedIp, node.floatingIp].some((ip) => String(ip || "").trim() === popupTargetHost))
      || vmNodes[0]
      || null;
    const autoOpenKey = `${props.activeLab.id}:${initialNode?.id || popupTargetHost || "default"}`;
    if (autoOpenTargetKeyRef.current !== autoOpenKey) {
      autoOpenRetryAttemptsRef.current = 0;
      if (autoOpenRetryTimerRef.current) {
        window.clearTimeout(autoOpenRetryTimerRef.current);
        autoOpenRetryTimerRef.current = null;
      }
    }
    autoOpenTargetKeyRef.current = autoOpenKey;
    const terminalSessionLabId = Number(props.terminalSession?.labId || 0);
    const terminalSessionNodeId = String(props.terminalSession?.nodeId || "").trim();
    if (props.terminalSession?.wsPath && terminalSessionLabId === Number(props.activeLab.id) && (!initialNode?.id || terminalSessionNodeId === String(initialNode.id || ""))) {
      autoOpenedLabIdRef.current = autoOpenKey;
      autoOpenRetryAttemptsRef.current = 0;
      if (autoOpenRetryTimerRef.current) {
        window.clearTimeout(autoOpenRetryTimerRef.current);
        autoOpenRetryTimerRef.current = null;
      }
      return;
    }
    if (autoOpenedLabIdRef.current === autoOpenKey) return;
    autoOpenedLabIdRef.current = autoOpenKey;
    const request = props.onCreateTerminalSession({
      labId: props.activeLab.id,
      courseId: props.activeLab.courseId,
      ...(initialNode ? { nodeId: initialNode.id, targetHost: initialNode.fixedIp || initialNode.floatingIp || "" } : {}),
      ...(!initialNode && popupTargetHost ? { targetHost: popupTargetHost } : {}),
    });
    Promise.resolve(request).then((result) => {
      if (result?.wsPath || autoOpenTargetKeyRef.current !== autoOpenKey) return;
      if (result?.retryable === false) return;
      autoOpenRetryAttemptsRef.current += 1;
      const retryDelayMs = Math.min(
        TERMINAL_AUTO_OPEN_RETRY_MAX_MS,
        TERMINAL_AUTO_OPEN_RETRY_BASE_MS * autoOpenRetryAttemptsRef.current,
      );
      if (autoOpenRetryTimerRef.current) window.clearTimeout(autoOpenRetryTimerRef.current);
      autoOpenRetryTimerRef.current = window.setTimeout(() => {
        autoOpenRetryTimerRef.current = null;
        if (autoOpenTargetKeyRef.current !== autoOpenKey) return;
        autoOpenedLabIdRef.current = null;
        setTerminalAutoOpenRetryTick((current) => current + 1);
      }, retryDelayMs);
    }).catch(() => {
      if (autoOpenTargetKeyRef.current !== autoOpenKey) return;
      if (autoOpenRetryTimerRef.current) window.clearTimeout(autoOpenRetryTimerRef.current);
      autoOpenRetryTimerRef.current = window.setTimeout(() => {
        autoOpenRetryTimerRef.current = null;
        if (autoOpenTargetKeyRef.current !== autoOpenKey) return;
        autoOpenedLabIdRef.current = null;
        setTerminalAutoOpenRetryTick((current) => current + 1);
      }, TERMINAL_AUTO_OPEN_RETRY_BASE_MS);
    });
  }, [initialPopupTarget.nodeId, initialPopupTarget.targetHost, isWindowsLab, props.activeLab, props.autoOpenTerminal, props.labExams, props.onCreateTerminalSession, props.terminalSession, terminalAutoOpenRetryTick, terminalSessionBusy, vmNodes]);

  useEffect(() => {
    if (typeof props.onScreenCaptureReady !== "function") return undefined;
    props.onScreenCaptureReady(() => captureTerminalConsoleImage(terminalCaptureFrameRef.current || terminalRootRef.current, terminalRef.current));
    return () => props.onScreenCaptureReady(null);
  }, [props.onScreenCaptureReady, props.activeLab?.id, props.terminalSession?.wsPath]);

  useEffect(() => {
    if (typeof props.onConsoleReady !== "function" || !props.terminalSession?.wsPath) return;
    props.onConsoleReady({ labId: props.activeLab?.id, wsPath: props.terminalSession.wsPath });
  }, [props.onConsoleReady, props.activeLab?.id, props.terminalSession?.wsPath]);

  function connectSelectedVm(node = selectedVmNode, options = {}) {
    if (isWindowsLab) return;
    if (!node) return;
    const safeOptions = options && typeof options === "object" ? options : {};
    const replacePendingRequest = Boolean(safeOptions.replacePending || safeOptions.supersedePending);
    if (terminalSessionBusy && !replacePendingRequest) return;
    const nodeAccessMode = String(node.accessMode || "").trim().toLowerCase();
    const nodeConsoleAccess = String(node.consoleAccess || "").trim().toLowerCase();
    const nodePlanned = isVmNodePlanned(node);
    if (nodePlanned || nodeAccessMode === "vnc" || nodeConsoleAccess === "vnc") return;
    return props.onCreateTerminalSession({
      labId: props.activeLab?.id,
      courseId: props.activeLab?.courseId,
      ...buildVmNodeConsolePayload(node),
      ...safeOptions,
    });
  }

  async function switchVmConsole(node) {
    if (!node || terminalSessionBusy || consoleSwitchState) return;
    const selectionKey = getVmNodeSelectionKey(node, vmNodes.indexOf(node));
    setSelectedVmNodeId(selectionKey);

    const nodeAccessMode = String(node?.accessMode || "").trim().toLowerCase();
    const nodeConsoleAccess = String(node?.consoleAccess || "").trim().toLowerCase();
    const nodePlanned = isVmNodePlanned(node);
    if (
      props.activeLab?.status !== "running"
      || nodePlanned
      || nodeAccessMode === "vnc"
      || nodeConsoleAccess === "vnc"
    ) return;

    const nodeId = String(node.id || selectionKey).trim();
    setConsoleSwitchState({
      nodeId,
      label: String(node.name || `선택 ${labBackendLabel}`).trim(),
      startedAt: Date.now(),
    });
    try {
      await connectSelectedVm(node, {
        replacePending: true,
        keepSection: true,
        stayOnCurrentSection: true,
      });
    } finally {
      setConsoleSwitchState((current) => (
        current?.nodeId === nodeId ? null : current
      ));
    }
  }

  function recheckSelectedVmConsoleStatus() {
    if (!props.activeLab || props.activeLab.status !== "running" || labExamCompleted || !selectedVmNode || !selectedNodeSshConnectable) return;
    connectSelectedVm(selectedVmNode, { keepSection: true, stayOnCurrentSection: true });
  }

  async function resetSelectedVmSshHostKey() {
    if (
      typeof props.onResetLabSshHostKey !== "function"
      || !props.activeLab
      || props.activeLab.status !== "running"
      || labExamCompleted
      || !selectedVmNode
      || !selectedNodeSshConnectable
    ) return;
    const result = await props.onResetLabSshHostKey(
      props.activeLab.id,
      selectedVmNode.id,
      selectedVmNode.name || `선택 ${labBackendLabel}`,
    );
    if (!result?.reset) return;
    connectSelectedVm(selectedVmNode, {
      replacePending: true,
      keepSection: true,
      stayOnCurrentSection: true,
    });
  }

  async function rebootSelectedVm() {
    if (
      vmRebooting
      || typeof props.onRebootLabNode !== "function"
      || !props.activeLab
      || props.activeLab.status !== "running"
      || labExamCompleted
      || isContainerLab
      || !selectedVmNode
      || selectedNodePlanned
    ) return;

    setVmRebooting(true);
    try {
      await props.onRebootLabNode(
        props.activeLab.id,
        selectedVmNode.id,
        selectedVmNode.name || `선택 ${labBackendLabel}`,
      );
    } finally {
      setVmRebooting(false);
    }
  }

  function openSelectedVmTerminalPopup({ newTab = false } = {}) {
    if (isWindowsLab || !props.activeLab || props.activeLab.status !== "running" || !selectedVmNode || !selectedNodeSshConnectable) return;
    props.onOpenTerminalPopup?.(props.activeLab, {
      ...buildVmNodeConsolePayload(selectedVmNode),
      newTab,
    });
  }

  function openExternalSshInBrowser() {
    if (isWindowsLab || !props.activeLab?.externalSshEnabled) return;
    openSelectedVmTerminalPopup({ newTab: true });
  }

  async function readBrowserClipboardForVnc() {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
        throw new Error("브라우저 클립보드 읽기를 지원하지 않습니다.");
      }
      const text = await navigator.clipboard.readText();
      setVncClipboardText(text || "");
      setVncClipboardStatus({ tone: "success", message: text ? "브라우저 클립보드 내용을 가져왔습니다." : "브라우저 클립보드가 비어 있습니다." });
    } catch (error) {
      setVncClipboardStatus({ tone: "error", message: error.message || "브라우저 클립보드를 읽지 못했습니다. 직접 입력해 주세요." });
    }
  }

  async function sendVncClipboard(mode = "clipboard") {
    const text = String(vncClipboardText || "");
    if (!props.activeLab?.id || !selectedVmNode || !selectedNodeVncConnectable || !text.trim()) {
      setVncClipboardStatus({ tone: "error", message: "VNC 콘솔에 보낼 텍스트를 입력해 주세요." });
      return;
    }
    setVncClipboardSending(true);
    setVncClipboardStatus({ tone: "info", message: mode === "type" ? "VNC 콘솔에 키 입력을 보내는 중입니다." : "VNC 클립보드로 전송 중입니다." });
    try {
      const result = await props.onSendVncClipboard?.(props.activeLab.id, {
        ...buildVmNodeConsolePayload(selectedVmNode),
        text,
        mode,
      });
      setVncClipboardStatus({ tone: "success", message: result?.message || "VNC 콘솔로 텍스트를 보냈습니다." });
    } catch (error) {
      setVncClipboardStatus({ tone: "error", message: error.message || "VNC 콘솔로 텍스트를 보내지 못했습니다." });
    } finally {
      setVncClipboardSending(false);
    }
  }

  async function requestAiTerminalPlan(event) {
    event.preventDefault();
    const instruction = String(aiTerminalInstruction || "").trim();
    if (!instruction) {
      setAiTerminalStatus({ tone: "error", message: "AI에게 요청할 작업을 입력해 주세요." });
      return;
    }
    if (!canUseAiTerminalPlanner) {
      setAiTerminalStatus({ tone: "error", message: "실행 중인 Linux/컨테이너 터미널 랩에서만 AI 작업 계획을 만들 수 있습니다." });
      return;
    }
    setAiTerminalPlanning(true);
    setAiTerminalStatus({ tone: "info", message: "AI가 실행 전 점검용 명령 계획을 만들고 있습니다." });
    try {
      const response = await fetch("/api/llm/terminal-plan", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction,
          courseId: terminalSelectedCourse?.id || props.activeLab?.courseId || null,
        }),
      });
      const payload = response.headers.get("content-type")?.includes("application/json")
        ? await response.json()
        : null;
      if (!response.ok) {
        throw new Error(payload?.message || "AI 작업 계획 생성에 실패했습니다.");
      }
      setAiTerminalPlan(payload.plan || null);
      setAiTerminalStatus({ tone: "success", message: "실행 전에 명령을 확인해 주세요. 승인하면 현재 터미널에 입력됩니다." });
    } catch (error) {
      setAiTerminalStatus({ tone: "error", message: error.message });
    } finally {
      setAiTerminalPlanning(false);
    }
  }

  function runAiTerminalPlan() {
    const commands = Array.isArray(aiTerminalPlan?.commands) ? aiTerminalPlan.commands : [];
    if (!commands.length) {
      setAiTerminalStatus({ tone: "error", message: "실행할 AI 명령 계획이 없습니다." });
      return;
    }
    if (!aiTerminalSocketReady) {
      setAiTerminalStatus({ tone: "error", message: "먼저 터미널 연결 버튼을 눌러 현재 랩 콘솔을 열어 주세요." });
      return;
    }
    if (aiTerminalPlan.risk === "high" && !window.confirm("위험도가 높은 명령이 포함되어 있습니다. 현재 터미널에 입력할까요?")) {
      return;
    }
    const terminal = terminalRef.current;
    terminal?.writeln("\r\n[AI 작업] 승인된 명령을 터미널에 입력합니다.");
    commands.forEach((command, index) => {
      window.setTimeout(() => {
        if (socketRef.current?.readyState !== WebSocket.OPEN) return;
        socketRef.current.send(JSON.stringify({ type: "input", data: `${String(command || "").trim()}\r` }));
      }, index * 180);
    });
    setAiTerminalStatus({ tone: "success", message: `${commands.length}개 명령을 현재 터미널에 입력했습니다.` });
  }

  function clearReplayTimers() {
    replayTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    replayTimersRef.current = [];
  }

  function writeReplayEvent(terminal, event) {
    const payload = event?.payload || {};
    if (event?.type === "output" || event?.type === "data") terminal.write(String(payload.data || ""));
    if (event?.type === "status") terminal.writeln(`\r\n[안내] ${payload.message || ""}`);
    if (event?.type === "error") terminal.writeln(`\r\n[오류] ${payload.message || ""}`);
    if (event?.type === "exit") terminal.writeln("\r\n[세션 종료]");
    if (event?.type === "resize" && payload.cols && payload.rows) {
      try {
        terminal.resize(Number(payload.cols || 120), Number(payload.rows || 32));
      } catch {
        // xterm can reject resize before the element is fully measured.
      }
    }
  }

  function renderReplayUntil(positionMs) {
    const terminal = replayTerminalRef.current;
    if (!terminal || !replayData?.events?.length) return;
    terminal.clear();
    replayData.events
      .filter((event) => Number(event.offsetMs || 0) <= positionMs)
      .forEach((event) => writeReplayEvent(terminal, event));
    terminal.scrollToBottom();
  }

  function playReplay(fromMs = replayPlaybackRef.current.positionMs || 0, speed = replaySpeed) {
    const terminal = replayTerminalRef.current;
    const events = Array.isArray(replayData?.events) ? replayData.events : [];
    if (!terminal || !events.length) return;
    clearReplayTimers();
    setReplayPlaying(true);
    replayPlaybackRef.current = {
      positionMs: Math.max(0, Number(fromMs || 0)),
      baseAt: performance.now() - (Math.max(0, Number(fromMs || 0)) / Math.max(0.25, Number(speed || 1))),
      speed: Math.max(0.25, Number(speed || 1)),
    };
    events
      .filter((event) => Number(event.offsetMs || 0) >= Number(fromMs || 0))
      .forEach((event) => {
        const delay = Math.max(0, (Number(event.offsetMs || 0) - Number(fromMs || 0)) / Math.max(0.25, Number(speed || 1)));
        const timer = window.setTimeout(() => {
          replayPlaybackRef.current.positionMs = Number(event.offsetMs || 0);
          writeReplayEvent(terminal, event);
          terminal.scrollToBottom();
        }, delay);
        replayTimersRef.current.push(timer);
      });
    const durationMs = Number(replayData?.replay?.durationMs || events[events.length - 1]?.offsetMs || 0);
    const doneTimer = window.setTimeout(() => {
      replayPlaybackRef.current.positionMs = durationMs;
      setReplayPlaying(false);
    }, Math.max(0, (durationMs - Number(fromMs || 0)) / Math.max(0.25, Number(speed || 1))) + 40);
    replayTimersRef.current.push(doneTimer);
  }

  function pauseReplay() {
    const playback = replayPlaybackRef.current;
    const nextPosition = Math.max(0, (performance.now() - Number(playback.baseAt || performance.now())) * Number(playback.speed || 1));
    replayPlaybackRef.current = { ...playback, positionMs: nextPosition };
    clearReplayTimers();
    setReplayPlaying(false);
  }

  function restartReplay() {
    clearReplayTimers();
    replayPlaybackRef.current = { positionMs: 0, baseAt: 0, speed: replaySpeed };
    replayTerminalRef.current?.clear();
    setReplayPlaying(false);
    window.setTimeout(() => playReplay(0, replaySpeed), 20);
  }

  async function openLatestReplay() {
    if (!props.activeLab?.id) {
      setReplayStatus({ tone: "error", message: "리플레이를 볼 랩이 없습니다." });
      return;
    }
    setReplayStatus({ tone: "info", message: "최근 세션 리플레이를 불러오는 중입니다." });
    try {
      const listResponse = await fetch(`/api/labs/${props.activeLab.id}/replays?limit=1`, { credentials: "include" });
      const listPayload = await listResponse.json();
      if (!listResponse.ok) throw new Error(listPayload?.message || "리플레이 목록을 불러오지 못했습니다.");
      const latest = Array.isArray(listPayload.replays) ? listPayload.replays[0] : null;
      if (!latest) {
        setReplayStatus({ tone: "error", message: "아직 저장된 리플레이가 없습니다. 터미널을 한 번 연결한 뒤 다시 시도해 주세요." });
        return;
      }
      const detailResponse = await fetch(`/api/terminal-replays/${encodeURIComponent(latest.id)}`, { credentials: "include" });
      const detailPayload = await detailResponse.json();
      if (!detailResponse.ok) throw new Error(detailPayload?.message || "리플레이를 불러오지 못했습니다.");
      clearReplayTimers();
      replayPlaybackRef.current = { positionMs: 0, baseAt: 0, speed: replaySpeed };
      setReplayData(detailPayload);
      setReplayModalOpen(true);
      setReplayStatus({ tone: "success", message: "최근 리플레이를 열었습니다." });
    } catch (error) {
      setReplayStatus({ tone: "error", message: error.message });
    }
  }

  useEffect(() => {
    if (!replayModalOpen || !replayRootRef.current) return undefined;
    const terminal = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontFamily: "Consolas, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.25,
      theme: { background: "#0b1020", foreground: "#e5e7eb", cursor: "#f9fafb" },
      scrollback: 10000,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(replayRootRef.current);
    replayTerminalRef.current = terminal;
    replayFitAddonRef.current = fitAddon;
    window.requestAnimationFrame(() => {
      fitAddon.fit();
      terminal.writeln("[리플레이 준비]");
      playReplay(0, replaySpeed);
    });
    const onResize = () => window.requestAnimationFrame(() => fitAddon.fit());
    window.addEventListener("resize", onResize);
    return () => {
      clearReplayTimers();
      window.removeEventListener("resize", onResize);
      replayTerminalRef.current = null;
      replayFitAddonRef.current = null;
      terminal.dispose();
      setReplayPlaying(false);
    };
  }, [replayModalOpen, replayData?.replay?.id]);

  const embeddedInfoSummary = terminalDisplayItems
    .filter((item) => ["상태", "대표 IP", "선택 VM 대표 IP", "SSH 아이디", "Windows 아이디"].includes(item.label))
    .map((item) => `${item.label} ${item.value || "-"}`)
    .join(" · ");
  const clampPercent = (value) => Math.max(0, Math.min(100, Number(value || 0) || 0));
  const buildTrafficOverlayMetric = (label, bytes, limitGb) => {
    const safeBytes = Math.max(0, Number(bytes || 0) || 0);
    const safeLimitGb = Math.max(0, Number(limitGb || 0) || 0);
    const limitBytes = safeLimitGb * 1024 * 1024 * 1024;
    const percent = limitBytes > 0 ? clampPercent(Math.round((safeBytes / limitBytes) * 100)) : 0;
    return {
      key: label,
      label,
      value: safeLimitGb > 0 ? `${percent}%` : "-",
      detail: `${formatTrafficBytes(safeBytes)} / ${safeLimitGb > 0 ? `${safeLimitGb} GB` : "무제한"}`,
      percent,
      tone: percent >= 85 ? "danger" : percent >= 60 ? "warn" : "safe",
    };
  };
  const diskUsageBytes = Math.max(0, Number(props.activeLab?.diskReadBytes || 0) || 0) + Math.max(0, Number(props.activeLab?.diskWriteBytes || 0) || 0);
  const terminalUsageOverlayItems = props.activeLab ? [
    {
      key: "cpu",
      label: "CPU",
      value: `${clampPercent(props.activeLab.cpuUsagePercent)}%`,
      detail: activeLabCourse?.heatParameters?.flavor || props.activeLab.currentFlavor || "실습 VM",
      percent: clampPercent(props.activeLab.cpuUsagePercent),
      tone: clampPercent(props.activeLab.cpuUsagePercent) >= 85 ? "danger" : clampPercent(props.activeLab.cpuUsagePercent) >= 60 ? "warn" : "safe",
    },
    {
      key: "memory",
      label: "Mem",
      value: `${clampPercent(props.activeLab.memoryUsagePercent)}%`,
      detail: props.activeLab.vmMetricsCheckedAt ? "실제 사용률" : "수집 대기",
      percent: clampPercent(props.activeLab.memoryUsagePercent),
      tone: clampPercent(props.activeLab.memoryUsagePercent) >= 85 ? "danger" : clampPercent(props.activeLab.memoryUsagePercent) >= 60 ? "warn" : "safe",
    },
    {
      key: "disk",
      label: "Disk",
      value: formatTrafficBytes(diskUsageBytes),
      detail: `R ${formatTrafficBytes(props.activeLab.diskReadBytes)} / W ${formatTrafficBytes(props.activeLab.diskWriteBytes)}`,
      percent: 0,
      tone: "neutral",
    },
    ...(activeLabCourse?.trafficMonitoringEnabled ? [
      buildTrafficOverlayMetric("오늘", props.activeLab.trafficDailyBytes, activeLabCourse.trafficDailyLimitGb),
      buildTrafficOverlayMetric("총", props.activeLab.trafficTotalBytes, activeLabCourse.trafficTotalLimitGb),
    ] : []),
  ] : [];
  const terminalConsoleReadiness = (() => {
    if (isWindowsLab) return null;
    const status = props.activeLab ? activeLabStatus : selectedCourseLabStatus;
    const labLabel = selectedCourseIsContainer || isContainerLab ? "컨테이너" : "랩";
    const courseTitle = activeLabCourse?.title || terminalSelectedCourse?.title || "선택한 과정";
    const startFlowSteps = [
      { label: "요청 접수", detail: "시작 명령 전달" },
      { label: "환경 생성", detail: `${labLabel} 자원 준비` },
      { label: "터미널 연결", detail: "연결 가능 여부 확인" },
    ];
    const terminationFlowSteps = [
      { label: "종료 요청", detail: "종료 명령 전달" },
      { label: "자원 정리", detail: "인스턴스와 연결 해제" },
      { label: "종료 완료", detail: "사용 자원 반환" },
    ];
    const terminalRequestMessage = String(props.terminalRequest?.message || "");
    if (consoleSwitchState) {
      const elapsedSeconds = Math.max(0, consoleSwitchElapsedSeconds);
      const estimatedWaitLabel = elapsedSeconds < 30
        ? `경과 ${elapsedSeconds}초 · 보통 10~30초`
        : `경과 ${elapsedSeconds}초 · 연결 확인 중`;
      return {
        tone: "loading",
        variant: "switching",
        icon: "🚀",
        badge: "전환 중",
        title: "가상머신 콘솔 전환 중",
        message: `${consoleSwitchState.label}의 연결 상태를 확인하고 있습니다. 버튼을 다시 누르지 않아도 준비되는 즉시 자동으로 전환됩니다.`,
        detailLabel: "전환 대상",
        detail: consoleSwitchState.label,
        countLabel: estimatedWaitLabel,
        flowSteps: [
          { label: "대상 선택", detail: consoleSwitchState.label },
          { label: "연결 확인", detail: "SSH와 세션 준비" },
          { label: "콘솔 전환", detail: "자동 연결" },
        ],
        currentStep: 1,
      };
    }
    const isBootReadinessChecking = Boolean(
      props.activeLab
      && status === "running"
      && terminalSessionBusy
      && !props.terminalSession?.wsPath
      && /부팅|SSH|콘솔|터미널 상태|터미널 연결|연결을 확인/.test(terminalRequestMessage),
    );
    if (isBootReadinessChecking) {
      const isContainerReadiness = labLabel === "컨테이너";
      return {
        tone: "loading",
        icon: "",
        badge: isContainerReadiness ? "콘솔 확인" : "연결 확인",
        title: isContainerReadiness ? "컨테이너 터미널 상태를 확인하고 있습니다" : "VM 터미널 연결을 확인하고 있습니다",
        message: isContainerReadiness
          ? "콘솔이 준비되면 자동으로 터미널을 연결합니다."
          : "SSH 포트와 터미널 세션이 준비되면 자동으로 연결합니다. 보통 10~30초 정도 걸립니다.",
        detail: courseTitle,
        flowSteps: startFlowSteps,
        currentStep: 2,
      };
    }
    if (isApplyingSelectedCourseLab && !props.activeLab) {
      return {
        tone: "loading",
        icon: "",
        badge: "요청 중",
        title: `${labLabel} 요청을 등록하는 중입니다`,
        message: "요청을 서버에 보내고 있습니다. 버튼을 다시 누르지 않아도 곧 상태가 갱신됩니다.",
        detail: courseTitle,
        flowSteps: startFlowSteps,
        currentStep: 0,
      };
    }
    if (isStartingActiveLab || isStartingSelectedCourseLab) {
      return {
        tone: "loading",
        icon: "",
        badge: "시작 중",
        title: `${labLabel} 시작 요청을 처리 중입니다`,
        message: "시작 명령을 보냈습니다. 생성이 시작될 때까지 잠시만 기다려 주세요.",
        detail: courseTitle,
        flowSteps: startFlowSteps,
        currentStep: 0,
      };
    }
    if (status === "provisioning") {
      return {
        tone: "loading",
        icon: "",
        badge: "생성 중",
        title: `${labLabel} 자원을 생성하고 있습니다`,
        message: "VM, 네트워크, 접속 정보를 준비하는 중입니다. 완료되면 터미널 연결 버튼이 활성화됩니다.",
        detail: courseTitle,
        flowSteps: startFlowSteps,
        currentStep: 1,
      };
    }
    if (status === "pending") {
      return {
        tone: "wait",
        icon: "⏰",
        badge: "승인 대기",
        title: "관리자 승인 후 시작할 수 있습니다",
        message: "요청은 접수되었습니다. 승인되면 랩 시작 버튼이 활성화됩니다.",
        detail: courseTitle,
      };
    }
    if (status === "approved") {
      const canUseInlineStart = Boolean((props.activeLab && canStartActiveLab) || (!props.activeLab && canStartSelectedCourseLab));
      return {
        tone: "ready",
        icon: "✅",
        badge: "시작 가능",
        title: `${labLabel} 시작 준비가 완료되었습니다`,
        message: canUseInlineStart
          ? `아래 ${labLabel} 시작 버튼을 한 번만 누르면 생성 절차가 시작됩니다.`
          : `${labLabel} 시작 버튼이 활성화되면 생성 절차를 시작할 수 있습니다.`,
        detail: courseTitle,
        actionLabel: canUseInlineStart ? `${labLabel} 시작` : "",
        actionDisabled: !canUseInlineStart,
        onAction: triggerTerminalReadinessStart,
      };
    }
    if (status === "paused") {
      return {
        tone: "wait",
        icon: "⏸",
        badge: "일시 중지",
        title: `${labLabel}이 일시 중지되어 있습니다`,
        message: `상단의 ${labLabel} 재개 버튼을 누르면 같은 환경으로 다시 연결합니다.`,
        detail: courseTitle,
      };
    }
    if (status === "terminating") {
      return {
        tone: "wait",
        icon: "",
        badge: "종료 중",
        title: `${labLabel}을 종료하고 있습니다`,
        message: "자원 정리 중에는 새 작업을 받을 수 없습니다. 종료가 완료될 때까지 기다려 주세요.",
        detail: courseTitle,
        flowSteps: terminationFlowSteps,
        currentStep: 1,
      };
    }
    if (status === "failed") {
      return {
        tone: "error",
        icon: "!",
        badge: "실패",
        title: `${labLabel} 시작에 실패했습니다`,
        message: "다시 시작하거나 초기화가 필요할 수 있습니다. 문제가 반복되면 관리자에게 문의해 주세요.",
        detail: courseTitle,
      };
    }
    if (!props.activeLab && terminalSelectedCourse?.labEnabled) {
      return {
        tone: "ready",
        icon: "✅",
        badge: "준비 전",
        title: `${labLabel}을 요청하면 콘솔이 준비됩니다`,
        message: "아직 실행 중인 랩이 없습니다. 랩 요청 또는 시작 후 이 영역에서 진행 상태를 확인할 수 있습니다.",
        detail: courseTitle,
      };
    }
    return null;
  })();
  const showTerminalUsageOverlay = Boolean(!isTerminalPopup && !isEmbeddedMode && !isWindowsLab && props.activeLab?.status === "running" && !terminalConsoleReadiness && terminalUsageOverlayItems.length);
  const renderTerminalConsoleStatusOverlay = () => terminalConsoleReadiness ? (
    <div
      aria-atomic="true"
      aria-live="polite"
      className={`terminal-console-status-overlay is-${terminalConsoleReadiness.tone}${terminalConsoleReadiness.variant ? ` is-${terminalConsoleReadiness.variant}` : ""}`}
      role="status"
    >
      <div className="terminal-console-status-card">
        <div className="terminal-console-status-loader" aria-hidden="true">
          {terminalConsoleReadiness.icon ? (
            <span className="terminal-console-status-main-icon">{terminalConsoleReadiness.icon}</span>
          ) : (
            <>
              <span />
              <span />
              <span />
            </>
          )}
        </div>
        <div className="terminal-console-status-copy">
          <div className="terminal-console-status-meta">
            <span className="status-chip is-muted">
              <i aria-hidden="true" />
              {terminalConsoleReadiness.badge}
            </span>
            {terminalConsoleReadiness.countLabel ? (
              <span className="terminal-console-status-count">
                {terminalConsoleReadiness.countLabel}
              </span>
            ) : terminalConsoleReadiness.flowSteps?.length ? (
              <span className="terminal-console-status-count">
                {Math.min((terminalConsoleReadiness.currentStep ?? 0) + 1, terminalConsoleReadiness.flowSteps.length)}
                <span aria-hidden="true"> / </span>
                {terminalConsoleReadiness.flowSteps.length} 단계
              </span>
            ) : null}
          </div>
          <strong>{terminalConsoleReadiness.title}</strong>
          <p>{terminalConsoleReadiness.message}</p>
          <small className="terminal-console-status-detail">
            <span>{terminalConsoleReadiness.detailLabel || "현재 과정"}</span>
            {terminalConsoleReadiness.detail}
          </small>
          {terminalConsoleReadiness.actionLabel ? (
            <div className="terminal-console-status-actions">
              <button
                className="primary-btn"
                disabled={terminalConsoleReadiness.actionDisabled}
                onClick={terminalConsoleReadiness.onAction}
                type="button"
              >
                {terminalConsoleReadiness.actionLabel}
              </button>
            </div>
          ) : null}
        </div>
        {terminalConsoleReadiness.flowSteps?.length ? (
          <ol
            aria-label="터미널 준비 단계"
            className="terminal-console-status-flow"
            style={{
              "--flow-progress": `${(
                (terminalConsoleReadiness.currentStep ?? 0)
                / Math.max(terminalConsoleReadiness.flowSteps.length - 1, 1)
              ) * 66.666}%`,
            }}
          >
            {terminalConsoleReadiness.flowSteps.map((step, index) => {
              const stepState = index < terminalConsoleReadiness.currentStep
                ? "complete"
                : index === terminalConsoleReadiness.currentStep
                  ? "active"
                  : "pending";
              return (
                <li
                  aria-current={stepState === "active" ? "step" : undefined}
                  className={`is-${stepState}`}
                  key={`${step.label}-${index}`}
                >
                  <span className="terminal-console-status-step-marker" aria-hidden="true">
                    {stepState === "complete" ? "✓" : index + 1}
                  </span>
                  <span className="terminal-console-status-step-copy">
                    <strong>{step.label}</strong>
                    <small>{step.detail}</small>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </div>
  ) : null;
  const renderTerminalUsageOverlay = () => {
    if (!showTerminalUsageOverlay) return null;
    if (!terminalUsageOverlayVisible) {
      return (
        <button
          aria-label="콘솔 사용량 오버레이 다시 표시"
          className="terminal-usage-overlay-restore"
          onClick={() => setTerminalUsageOverlayVisible(true)}
          type="button"
        >
          사용량 보기
        </button>
      );
    }
    return (
      <aside aria-label="콘솔 사용량 요약" className="terminal-usage-overlay" tabIndex={0}>
        <div className="terminal-usage-overlay-head">
          <strong>Usage</strong>
          <div className="terminal-usage-overlay-head-actions">
            <span>{props.activeLab?.vmMetricsCheckedAt || props.activeLab?.trafficCheckedAt || "수집 대기"}</span>
            <button
              aria-label="콘솔 사용량 오버레이 숨기기"
              className="terminal-usage-overlay-hide"
              onClick={() => setTerminalUsageOverlayVisible(false)}
              type="button"
            >
              숨김
            </button>
          </div>
        </div>
        <div className="terminal-usage-overlay-grid">
          {terminalUsageOverlayItems.map((item) => (
            <div className={`terminal-usage-overlay-item is-${item.tone}`} key={item.key}>
              <div>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
              <div className="terminal-usage-overlay-meter" aria-hidden="true">
                <span style={{ width: `${item.percent}%` }} />
              </div>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      </aside>
    );
  };
  const renderTerminalInfoCard = (item) => (
    <div className="terminal-lab-info-card" key={item.label}>
      <span className="terminal-lab-info-label">{item.label}</span>
      {item.links?.length ? (
        <div className="terminal-lab-info-link-list">
          {item.links.map((link) => (
            <a className="terminal-lab-info-link" href={link} key={`${item.label}-${link}`} rel="noreferrer" target="_blank">{link}</a>
          ))}
        </div>
      ) : item.href ? (
        <a className="terminal-lab-info-link" href={item.href} rel="noreferrer" target="_blank">{item.value}</a>
      ) : (
        <strong>{item.value}</strong>
      )}
      {item.actions?.length ? (
        <div className="terminal-lab-info-actions">
          {item.actions.map((action) => action.type === "link" ? (
            <a className="mini-btn" href={action.value} key={`${item.label}-${action.label}`} rel="noreferrer" target="_blank">{action.label}</a>
          ) : action.type === "web-terminal" ? (
            <button className="mini-btn" disabled={action.disabled} key={`${item.label}-${action.label}`} onClick={action.onClick} type="button">{action.label}</button>
          ) : action.type === "links" ? (
            <button className="mini-btn" key={`${item.label}-${action.label}`} onClick={() => openTerminalLinks(action.value)} type="button">{action.label}</button>
          ) : action.type === "download" ? (
            <button className="mini-btn" key={`${item.label}-${action.label}`} onClick={() => downloadTextFile(action.filename || "connection.rdp", action.value || "", action.mimeType || "text/plain")} type="button">{action.label}</button>
          ) : (
            <button className="mini-btn" key={`${item.label}-${action.label}`} onClick={() => copyTerminalValue(action.value)} type="button">{action.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
  const renderConsoleAccessDock = () => {
    if (!props.activeLab) return null;
    const showConnectionCards = activeLabHasRunningVm || (!isWindowsLab && canManageExternalSsh);
    if (!showConnectionCards && !activeLabNeedsStartSecret) return null;

    const credentialTitle = isWindowsLab ? "Windows 계정" : "SSH 계정";
    const passwordTitle = isWindowsLab ? "Windows 비밀번호" : "SSH 비밀번호";
    const credentialPassword = useIssuedCredentials ? props.activeLab?.terminalSshPassword || "" : props.terminalForm?.password || "";
    const credentialUser = useIssuedCredentials ? props.activeLab?.terminalSshUser || "-" : props.terminalForm?.username || "";
    const accessSummaryItems = [
      { label: credentialTitle, value: credentialUser || "-" },
      { label: isWindowsLab ? "외부 RDP" : "외부 SSH", value: externalAccessValue || "미사용" },
      { label: "공개 URL", value: consoleDomainSummary || "미설정" },
      { label: "공개 TCP", value: publicTcpSummary || "미설정" },
    ];

    return (
      <details className="terminal-console-access-dock" aria-label="콘솔 주변 접속 정보">
        <summary className="terminal-console-access-summary">
          <div>
            <span className="card-label">접속 바로가기</span>
            <strong>계정, 외부 연결, 공개 URL/TCP</strong>
          </div>
          {showConnectionCards ? (
            <div className="terminal-console-access-summary-list">
              {accessSummaryItems.map((item) => (
                <span key={item.label}>
                  <b>{item.label}</b>
                  <em>{item.value}</em>
                </span>
              ))}
            </div>
          ) : null}
          <span className="terminal-console-access-toggle-label">상세</span>
        </summary>
        <div className="terminal-console-access-body">
          {activeLabNeedsStartSecret ? (
            <div className="terminal-secret-start-panel">
              <div>
                <span className="card-label">랩 시작 Secret</span>
                <strong>생성 전에 추가 입력이 필요합니다.</strong>
                <p>{startSecretHintText(activeLabOverrideFields)}</p>
              </div>
              <button
                className="primary-btn"
                disabled={activeLabPrimaryDisabled}
                onClick={() => props.onStartLab(props.activeLab?.id, activeLabCourse?.id)}
                type="button"
              >
                Secret 입력 후 시작
              </button>
            </div>
          ) : null}
          {showConnectionCards ? (
          <div className="terminal-console-access-grid">
          <article className="terminal-console-access-card is-credential">
            <span>{credentialTitle}</span>
            {useIssuedCredentials ? (
              <>
                <strong>{credentialUser}</strong>
                <small>{managedLabCredentialsReady ? `${passwordTitle}: ${showTerminalPassword ? credentialPassword : "?".repeat(Math.max(10, String(credentialPassword || "").length))}` : "자격증명 준비 중"}</small>
                <div className="terminal-console-access-actions">
                  <button className="mini-btn" disabled={!credentialUser || credentialUser === "-"} onClick={() => copyTerminalValue(credentialUser)} type="button">아이디 복사</button>
                  <button className="mini-btn" disabled={!managedLabCredentialsReady} onClick={() => setShowTerminalPassword((current) => !current)} type="button">{showTerminalPassword ? "숨기기" : "보기"}</button>
                  <button className="mini-btn" disabled={!managedLabCredentialsReady} onClick={() => copyTerminalValue(credentialPassword)} type="button">비밀번호 복사</button>
                </div>
              </>
            ) : (
              <div className="terminal-console-access-form">
                <div className="inline-input-action">
                  <input value={props.terminalForm.username} onChange={(event) => props.setTerminalForm((current) => ({ ...current, username: event.target.value }))} placeholder={isWindowsLab ? "Windows 사용자" : "SSH 사용자"} />
                  <button className="mini-btn" disabled={!String(props.terminalForm.username || "").trim()} onClick={() => copyTerminalValue(props.terminalForm.username)} type="button">복사</button>
                </div>
                <div className="inline-input-action has-three">
                  <input value={props.terminalForm.password} onChange={(event) => props.setTerminalForm((current) => ({ ...current, password: event.target.value }))} placeholder="비밀번호" type={showTerminalPassword ? "text" : "password"} />
                  <button className="mini-btn" onClick={() => setShowTerminalPassword((current) => !current)} type="button">{showTerminalPassword ? "숨기기" : "보기"}</button>
                  <button className="mini-btn" disabled={!props.terminalForm.password} onClick={() => copyTerminalValue(props.terminalForm.password)} type="button">복사</button>
                </div>
              </div>
            )}
          </article>
          <article className="terminal-console-access-card">
            <span>{isWindowsLab ? "외부 RDP" : "외부 SSH"}</span>
            <strong>{externalAccessValue || "미사용"}</strong>
            <div className="terminal-console-access-actions">
              <button className={props.activeLab?.externalSshEnabled || props.activeLab?.externalRdpEnabled ? "mini-btn" : "mini-btn is-primary"} disabled={externalAccessActionDisabled} onClick={externalAccessAction} type="button">{externalAccessActionText}</button>
              <button className="mini-btn" disabled={!externalAccessCopyValue} onClick={() => copyTerminalValue(externalAccessCopyValue)} type="button">복사</button>
              {!isWindowsLab ? <button className="mini-btn" disabled={!props.activeLab?.externalSshEnabled || props.activeLab?.status !== "running" || terminalSessionBusy || !selectedVmNode} onClick={openExternalSshInBrowser} type="button">웹 터미널</button> : null}
            </div>
          </article>
          <article className="terminal-console-access-card">
            <span>공개 URL</span>
            {primaryPublicDomainUrl ? (
              <a href={primaryPublicDomainUrl} rel="noreferrer" target="_blank">{consoleDomainSummary}</a>
            ) : (
              <strong>{consoleDomainSummary}</strong>
            )}
            <div className="terminal-console-access-actions">
              <button className="mini-btn" disabled={!primaryPublicDomainUrl && !primaryRequestedDomainUrl} onClick={() => copyTerminalValue(primaryPublicDomainUrl || primaryRequestedDomainUrl)} type="button">복사</button>
              {primaryPublicDomainUrl ? <a className="mini-btn" href={primaryPublicDomainUrl} rel="noreferrer" target="_blank">열기</a> : null}
              <button className="mini-btn is-primary" disabled={!consoleRouteDetailsAvailable} onClick={() => openTerminalRouteDetails({ randomDomain: true, tab: "domain" })} type="button">{primaryPublicDomainUrl || primaryRequestedDomainUrl ? "관리" : "랜덤 요청"}</button>
            </div>
          </article>
          <article className="terminal-console-access-card">
            <span>공개 TCP</span>
            <strong>{publicTcpSummary}</strong>
            <div className="terminal-console-access-actions">
              <button className="mini-btn" disabled={!publicTcpCopyValue} onClick={() => copyTerminalValue(publicTcpCopyValue)} type="button">복사</button>
              <button className="mini-btn" disabled={!consoleRouteDetailsAvailable} onClick={() => openTerminalRouteDetails({ tab: "tcp" })} type="button">설정</button>
            </div>
          </article>
        </div>
          ) : null}
        {showConnectionCards && consoleRouteDetailsAvailable ? (
          <details
            className="terminal-console-access-details"
            onToggle={(event) => setTerminalRouteDetailsOpen(event.currentTarget.open)}
            open={terminalRouteDetailsOpen}
            ref={terminalRouteDetailsRef}
          >
            <summary>
              <span>도메인/TCP 상세 설정</span>
              <span className="terminal-console-access-summary-meta">
                <small>URL 요청, TCP 포트 요청, 해제</small>
                <span className="terminal-console-access-toggle-label">{terminalRouteDetailsOpen ? "닫기" : "열기"}</span>
              </span>
            </summary>
            <DomainView {...props} activeExposureTab={terminalRouteDetailsTab} setActiveExposureTab={setTerminalRouteDetailsTab} />
          </details>
        ) : null}
        </div>
      </details>
    );
  };

  function renderTerminalLearningActions(){return null;}

  function renderTerminalLearningViewer(){return null;}

  function renderTerminalLearningPanel(){return null;}

  function renderTerminalLearningNudge(){return null;}

  function renderInstructorSharePanel(){return null;}

  function renderTerminalConsoleActionBar() {
    if (isTerminalPopup || isEmbeddedMode || !props.activeLab) return null;
    const externalActionLabel = isWindowsLab ? externalRdpActionLabel : externalSshActionLabel;
    const externalActionDisabled = !props.activeLab || (isWindowsLab ? props.activeLab.status !== "running" : !canManageExternalSsh) || labExamCompleted || (isWindowsLab
      ? externalRdpActionBlocked || (!externalRdpRoutesEnabled && !props.activeLab?.externalRdpEnabled && !props.activeLab?.externalRdpRequestPending)
      : externalSshActionBlocked || (!externalSshRoutesEnabled && !props.activeLab?.externalSshEnabled && !props.activeLab?.externalSshRequestPending));
    const externalActionHandler = isWindowsLab
      ? (props.activeLab?.externalRdpEnabled || props.activeLab?.externalRdpRequestPending ? props.onReleaseExternalRdp : props.onRequestExternalRdp)
      : (props.activeLab?.externalSshEnabled || props.activeLab?.externalSshRequestPending ? props.onReleaseExternalSsh : props.onRequestExternalSsh);
  const consoleRefreshDisabled = !props.activeLab
    || isWindowsLab
    || props.activeLab.status !== "running"
    || labExamCompleted
    || terminalSessionBusy
    || !selectedVmNode
    || !selectedNodeSshConnectable;

    return (
      <div className="terminal-console-action-bar" aria-label="콘솔 작업">
        <div className="terminal-console-primary-actions">
          <button
            className="primary-btn terminal-open-btn"
            disabled={activeLabPrimaryDisabled}
            onClick={canStartActiveLab || canResumeActiveLab ? () => props.onStartLab(props.activeLab?.id, activeLabCourse?.id) : () => connectSelectedVm()}
            type="button"
          >
            {activeLabPrimaryLabel}
          </button>
          {activeLabNeedsStartSecret ? <span className="terminal-secret-start-hint">{startSecretHintText(activeLabOverrideFields)}</span> : null}
          {selectableVmNodes.length > 1 ? (
            <label className="terminal-vnc-target-control">
              <span>VNC 대상</span>
              <select
                disabled={Boolean(consoleSwitchState) || terminalSessionBusy}
                value={selectedVmNodeKey}
                onChange={(event) => setSelectedVmNodeId(event.target.value)}
              >
                {selectableVmNodes.map((node, index) => {
                  const key = getVmNodeSelectionKey(node, index);
                  return (
                    <option key={key} value={key}>
                      {getVmNodeOptionLabel(node, index)}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : null}
          <div className="terminal-console-segment" aria-label="콘솔 전환">
            <button className="ghost-btn terminal-console-btn" disabled={!props.activeLab || isWindowsLab || props.activeLab.status !== "running" || labExamCompleted || !selectedVmNode || !selectedNodeSshConnectable} onClick={() => openSelectedVmTerminalPopup()} type="button">분리</button>
            <button className="ghost-btn" disabled={!props.activeLab || isWindowsLab || isContainerLab || props.activeLab.status !== "running" || labExamCompleted || !selectedNodeVncConnectable} onClick={() => props.onOpenVncConsole(props.activeLab?.id, buildVmNodeConsolePayload(selectedVmNode))} type="button">VNC</button>
            <button
              className="ghost-btn terminal-console-refresh-btn"
              disabled={consoleRefreshDisabled}
              onClick={recheckSelectedVmConsoleStatus}
              type="button"
            >
              {terminalSessionBusy ? "확인 중" : "상태 확인"}
            </button>
          </div>
        </div>
        <div className="terminal-console-menu-actions">
          <details
            className="terminal-action-menu"
            onFocus={() => clearTerminalActionMenuCloseTimer("more")}
            onBlur={(event) => scheduleTerminalActionMenuClose(event, "more")}
            onMouseEnter={() => clearTerminalActionMenuCloseTimer("more")}
            onMouseLeave={(event) => scheduleTerminalActionMenuClose(event, "more")}
          >
            <summary aria-label="더보기 메뉴 열기">더보기</summary>
            <div className="terminal-action-menu-panel">
              {terminalLearningEnabled ? (
                <button
                  className="ghost-btn"
                  onClick={() => setTerminalLayoutMode(isTerminalLearningMode ? "default" : "learning")}
                  type="button"
                >
                  {isTerminalLearningMode ? "콘솔만 보기" : "랩+교안 열기"}
                </button>
              ) : null}
              <button className="ghost-btn" onClick={() => props.setSection?.("llm")} type="button">AI 질문</button>
              <button className="ghost-btn" disabled={!canExtendLab} onClick={() => props.onExtendLab(props.activeLab?.id)} type="button">{activeLabCourse?.labRetentionMode === "persistent" ? "12시간 연장" : "30분 연장"}</button>
              <button className="ghost-btn terminal-domain-btn" disabled={!consoleRouteDetailsAvailable} onClick={() => openTerminalRouteDetails({ randomDomain: true, tab: "domain" })} type="button">{domainConnectLabel}</button>
              <button className="ghost-btn terminal-ssh-btn" disabled={externalActionDisabled} onClick={externalActionHandler} type="button">{externalActionLabel}</button>
              {!isContainerLab ? (
                <button
                  className="ghost-btn"
                  disabled={
                    vmRebooting
                    || !props.activeLab
                    || props.activeLab.status !== "running"
                    || labExamCompleted
                    || !selectedVmNode
                    || selectedNodePlanned
                    || typeof props.onRebootLabNode !== "function"
                  }
                  onClick={rebootSelectedVm}
                  type="button"
                >
                  {vmRebooting ? "재부팅 요청 중" : `선택 ${labBackendLabel} 재부팅`}
                </button>
              ) : null}
              {!isContainerLab ? (
                <button
                  className="ghost-btn"
                  disabled={!props.activeLab || props.activeLab.status !== "running" || labExamCompleted || vmNodes.length < 2 || !selectedVmNode}
                  onClick={() => props.onRebuildLabNode(props.activeLab?.id, selectedVmNode?.id, selectedVmNode?.name || `선택 ${labBackendLabel}`)}
                  type="button"
                >
                  {`선택 ${labBackendLabel} 재생성`}
                </button>
              ) : null}
            </div>
          </details>
          <details
            className="terminal-action-menu is-danger"
            onFocus={() => clearTerminalActionMenuCloseTimer("danger")}
            onBlur={(event) => scheduleTerminalActionMenuClose(event, "danger")}
            onMouseEnter={() => clearTerminalActionMenuCloseTimer("danger")}
            onMouseLeave={(event) => scheduleTerminalActionMenuClose(event, "danger")}
          >
            <summary aria-label="위험 작업 메뉴 열기">위험 작업</summary>
            <div className="terminal-action-menu-panel">
              <button className="ghost-btn" disabled={!canPauseLab} onClick={() => props.onPauseLab(props.activeLab?.id)} type="button">{isContainerLab ? "컨테이너 일시 중지" : "일시 중지"}</button>
              {!isContainerLab && !isWindowsLab ? (
                <button
                  className="ghost-btn reset-btn"
                  disabled={!props.activeLab || props.activeLab.status !== "running" || labExamCompleted || !selectedVmNode || !selectedNodeSshConnectable || typeof props.onResetLabSshHostKey !== "function"}
                  onClick={resetSelectedVmSshHostKey}
                  type="button"
                >
                  선택 VM SSH 호스트 키 기록 초기화
                </button>
              ) : null}
              <button className="ghost-btn reset-btn" disabled={!canResetLab} onClick={() => props.onResetLab(props.activeLab?.id)} type="button">{resetLabLabel}</button>
              {!isContainerLab && !isWindowsLab ? (
                <button className="ghost-btn reset-btn" disabled={!canResetLab} onClick={() => props.onRebuildLabWithVolume?.(props.activeLab?.id)} type="button">볼륨 디스크로 가상머신 재구성</button>
              ) : null}
              <button className="ghost-btn reset-btn" disabled={!props.activeLab || labExamCompleted} onClick={() => props.onRemoveLab(props.activeLab?.id)} type="button">
                {isContainerLab ? "컨테이너 제거" : isWindowsLab ? "가상머신 종료" : "랩 종료"}
              </button>
            </div>
          </details>
        </div>
      </div>
    );
  }

  function renderVncClipboardPanel() {
    if (isTerminalPopup || isEmbeddedMode || isWindowsLab || isContainerLab || !props.activeLab || props.activeLab.status !== "running" || labExamCompleted || !selectedNodeVncConnectable) return null;
    const disabled = vncClipboardSending || !String(vncClipboardText || "").trim() || !props.onSendVncClipboard;
    return (
      <div className="vnc-clipboard-panel" aria-label="VNC 클립보드 도구">
        <div className="vnc-clipboard-head">
          <div>
            <span className="card-label">VNC 클립보드</span>
            <strong>{selectedVmNode?.name ? `${selectedVmNode.name}로 텍스트 보내기` : "VNC 콘솔로 텍스트 보내기"}</strong>
            <p className="hint">클립보드 전송은 게스트 OS 지원이 필요합니다. 콘솔 입력창에는 키 입력 붙여넣기를 사용하세요.</p>
          </div>
          <button className="mini-btn" onClick={readBrowserClipboardForVnc} type="button">브라우저 클립보드 읽기</button>
        </div>
        <textarea
          aria-label="VNC 콘솔에 보낼 텍스트"
          onChange={(event) => setVncClipboardText(event.target.value)}
          placeholder="VNC 콘솔에 보낼 텍스트를 입력하거나 브라우저 클립보드에서 가져오세요."
          rows={3}
          value={vncClipboardText}
        />
        <div className="vnc-clipboard-actions">
          <button className="ghost-btn" disabled={disabled} onClick={() => sendVncClipboard("clipboard")} type="button">
            {vncClipboardSending ? "전송 중" : "클립보드로 전송"}
          </button>
          <button className="primary-btn" disabled={disabled} onClick={() => sendVncClipboard("type")} type="button">
            {vncClipboardSending ? "전송 중" : "키 입력으로 붙여넣기"}
          </button>
          <button className="ghost-btn" disabled={!vncClipboardText || vncClipboardSending} onClick={() => setVncClipboardText("")} type="button">비우기</button>
        </div>
        <StatusMessage {...vncClipboardStatus} />
      </div>
    );
  }

  function renderTerminalNodeSwitchBar() {
    if (!vmNodes.length) return null;
    return (
      <div
        aria-busy={consoleSwitchState ? "true" : undefined}
        className={`terminal-node-switchbar${consoleSwitchState ? " is-switching" : ""}`}
        aria-label="터미널 대상 선택"
      >
        <VmTabs
          activeNodeId={selectedVmNode?.id || selectedVmNodeKey || ""}
          disabled={Boolean(consoleSwitchState) || terminalSessionBusy}
          nodes={vmNodes}
          showNodeIp
          onSelect={switchVmConsole}
        />
      </div>
    );
  }

    return (
      <section
        aria-disabled={labRoomEnrollmentDisabled ? "true" : undefined}
        className={`portal-stack terminal-view-shell ${labRoomEnrollmentDisabled ? "is-enrollment-disabled" : ""} ${isEmbeddedMode ? "embedded-terminal-view" : ""} ${!isEmbeddedMode && !isTerminalPopup ? `is-terminal-layout-${terminalLayoutMode}` : ""}`}
      >
        {labRoomEnrollmentDisabled ? (
          <div className="terminal-enrollment-disabled-overlay" role="status" aria-live="polite">
            <div className="terminal-enrollment-disabled-panel">
              <span className="terminal-enrollment-disabled-icon" aria-hidden="true">!</span>
              <strong>랩 실행이 불가능 합니다</strong>
              <p>신청한 과정이 없습니다. 과정 신청 및 수강 권한을 확인한 후 랩실을 이용해 주세요.</p>
            </div>
          </div>
        ) : null}
        {renderLabSupportModal()}
        <div className="simple-panel">
          {!isTerminalPopup && !isEmbeddedMode ? (
          <div className={`portal-detail-head terminal-detail-head ${isContainerLab ? "container-terminal-head" : ""}`}>
            <div className={isContainerLab ? "container-terminal-head-copy" : ""}>
              <p className="card-label">{isWindowsLab ? "Windows 접속" : isContainerLab ? "컨테이너 작업대" : "랩 작업대"}</p>
              <h3>{isWindowsLab ? "외부 RDP 접속 정보" : isContainerLab ? "컨테이너 실습 작업대" : "브라우저 실습 작업대"}</h3>
              {isWindowsLab ? <p className="hint">Windows 랩은 브라우저 SSH 콘솔을 열지 않고 외부 RDP와 발급 계정으로 접속합니다.</p> : <p className="hint">과정 선택, 랩 시작, 콘솔, 교안, 영상, 외부 연결을 한 화면에서 이어갑니다.</p>}
          </div>
            {terminalCourseOptions.length ? (
              <div className="terminal-course-switch">
                <div className="terminal-course-switch-head">
                  <label className="card-label" htmlFor="terminal-course-switch">과정 선택</label>
                  <span className={`status-chip ${terminalSelectedCourseLab?.status === "running" ? "is-success" : terminalSelectedCourseLab ? "is-warn" : "is-muted"}`}>
                    {selectedCourseStatusLabel}
                  </span>
                </div>
                <select
                  id="terminal-course-switch"
                  value={String(terminalSelectedCourseOption?.course?.id || "")}
                  onChange={(event) => {
                    const nextCourseId = Number(event.target.value) || event.target.value;
                    if (typeof props.onSelectTerminalCourse === "function") {
                      props.onSelectTerminalCourse(nextCourseId);
                    } else {
                      props.setSelectedCourseId?.(nextCourseId);
                    }
                  }}
                  title={terminalSelectedCourseOption?.course?.title || terminalSelectedCourse?.title || ""}
                >
                  {terminalCourseOptions.map(({ course, label }) => (
                    <option key={`terminal-course-option-${course.id}`} value={course.id} title={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
        </div>
          ) : null}

        {!isTerminalPopup && !isEmbeddedMode && !props.activeLab ? (
          <div className="simple-info-block terminal-empty-state">
            <div className="portal-detail-head">
              <div>
                <p className="card-label">랩 작업대 준비</p>
                <h4>{terminalEmptyTitle}</h4>
              </div>
            </div>
            <p className="terminal-empty-copy">{terminalEmptyDescription}</p>
            <div className="simple-status-list compact-status-list terminal-empty-status">
              <div>{`선택 과정: ${terminalEmptyTitle}`}</div>
              <div>{`랩 사용: ${terminalSelectedCourse?.labEnabled ? "가능" : "미사용"}`}</div>
              <div>{`접근 상태: ${!terminalSelectedCourse ? "과정 선택 필요" : selectedCourseHasAccess ? "사용 가능" : "권한 필요"}`}</div>
              <div>{`현재 상태: ${terminalSelectedCourseLab ? labStatus(terminalSelectedCourseLab.status) : "랩 없음"}`}</div>
            </div>
            {props.portalUiV2Active ? (
              <div className="terminal-learning-empty-callout">
                <div>
                  <span className="card-label">랩+교안 모드</span>
                  <strong>랩을 시작하면 콘솔과 교안을 한 화면에서 볼 수 있습니다.</strong>
                  <p className="hint">위키 교재는 그대로 표시하고, DOC/PPT/PDF 교안과 영상은 미리보기와 다운로드를 함께 제공합니다.</p>
                  <small>{terminalLearningResourceSummary}</small>
                </div>
                <span className="status-chip is-muted">랩 실행 후 활성화</span>
              </div>
            ) : null}
            {renderCourseAiToolPanel()}
            <div className="portal-actions terminal-empty-actions">
              {terminalEmptyPrimaryLabel ? (
                <button
                  className="primary-btn"
                  disabled={terminalEmptyPrimaryDisabled}
                  onClick={() => {
                    if (!terminalSelectedCourse) return;
                    if (canRequestSelectedCourseLab) {
                      props.onApplyLab(terminalSelectedCourse.id);
                      return;
                    }
                    if (canStartSelectedCourseLab) {
                      props.onStartLab(terminalSelectedCourseLab?.id, terminalSelectedCourse.id);
                    }
                  }}
                  type="button"
                >
                  {terminalEmptyPrimaryLabel}
                </button>
              ) : null}
              {selectedCourseNeedsStartSecret ? <span className="terminal-secret-start-hint">{startSecretHintText(selectedCourseOverrideFields)}</span> : null}
              <button
                className="ghost-btn"
                disabled={!terminalSelectedCourse}
                onClick={() => {
                  if (!terminalSelectedCourse) return;
                  props.setSelectedCourseId?.(Number(terminalSelectedCourse.id) || terminalSelectedCourse.id);
                  props.setOpenSelectedCourseDetail?.(true);
                  props.setSection?.(getLearningSectionForCourse(terminalSelectedCourse));
                }}
                type="button"
              >
                과정 상세 보기
              </button>
            <button className="ghost-btn" onClick={() => props.setSection?.("resources")} type="button">학습 홈으로 돌아가기</button>
            </div>
          </div>
        ) : null}

        {!isTerminalPopup && !isEmbeddedMode && props.activeLab ? renderCourseAiToolPanel() : null}

        <div className="terminal-lab-topbar">
          {!isEmbeddedMode && !isTerminalPopup ? (
            <div className="terminal-layout-switch" aria-label="랩 작업대 화면 모드">
              {terminalLayoutOptions.map(({ value, label, disabled, title }) => (
                <button
                  className={`mini-btn${terminalLayoutMode === value ? " primary-mini-btn" : ""}`}
                  disabled={disabled}
                  key={value}
                  onClick={() => setTerminalLayoutMode(value)}
                  title={title || label}
                  type="button"
                >
                  {label}
                </button>
              ))}
              {props.portalUiV2Active && !props.activeLab ? (
                <span className="terminal-layout-hint">랩 실행 후 랩+교안 사용 가능</span>
              ) : null}
            </div>
          ) : null}
          {!isTerminalPopup ? (
            <details
              className="embedded-terminal-info-disclosure terminal-info-disclosure"
              onToggle={(event) => setTerminalInfoCollapsed(!event.currentTarget.open)}
              open={!terminalInfoCollapsed}
            >
              <summary className="embedded-terminal-info-summary">
                <strong>접속 정보</strong>
                <span>{embeddedInfoSummary || "상태, IP, Flavor 등 세부 정보를 확인합니다."}</span>
              </summary>
              <div className="terminal-lab-info-grid embedded-terminal-info-grid">
                {terminalDisplayItems.map(renderTerminalInfoCard)}
              </div>
            </details>
          ) : (
            <div className="terminal-lab-info-grid">
              {terminalDisplayItems.map(renderTerminalInfoCard)}
            </div>
          )}
          {hasPendingRequestedDomains && !isTerminalPopup ? (
            <div className="terminal-lab-flow-hint">
              관리자 검토 후 사용이 가능합니다. 요청 URL은 승인 후 자동으로 `공개 URL` 카드로 이동하며, 그때부터 바로 열기와 복사가 가능합니다.
            </div>
          ) : null}
        </div>
        {renderTerminalLearningNudge()}
        {terminalNoticeItems.length ? (
          <div className="terminal-notice-stack" aria-label="터미널 상태 안내">
            {terminalNoticeItems.map((item) => (
              <div className={`terminal-notice is-${item.tone}${item.sticky ? " is-sticky" : ""}`} key={item.key}>
                <span className={`status-chip is-${item.tone === "info" ? "muted" : item.tone}`}>{item.label}</span>
                <span>{item.message}</span>
              </div>
            ))}
          </div>
        ) : null}
        {!isEmbeddedMode ? <PanelStatusMessage {...props.terminalRequest} /> : null}
        {!isTerminalPopup && !isEmbeddedMode ? (
          <div className="terminal-replay-toolbar is-compact">
            <div>
              <span className="card-label">세션 리플레이</span>
              <p className="hint">최근 터미널 화면 확인</p>
            </div>
            <div className="terminal-replay-actions">
              <button
                className="ghost-btn terminal-console-refresh-btn"
                disabled={!props.activeLab || isWindowsLab || props.activeLab.status !== "running" || labExamCompleted || terminalSessionBusy || !selectedVmNode}
                onClick={recheckSelectedVmConsoleStatus}
                type="button"
              >
                {terminalSessionBusy ? "확인 중" : "콘솔 다시 그리기"}
              </button>
              <button className="ghost-btn" disabled={!props.activeLab} onClick={openLatestReplay} type="button">최근 리플레이 보기</button>
            </div>
          </div>
        ) : null}
        {!isTerminalPopup && !isEmbeddedMode ? <StatusMessage {...replayStatus} /> : null}
        {renderTerminalConsoleActionBar()}
        {renderVncClipboardPanel()}
        {renderInstructorSharePanel()}
        {!isTerminalPopup && !isEmbeddedMode ? renderConsoleAccessDock() : null}
        {renderTerminalNodeSwitchBar()}
        <div className={`terminal-learning-workbench ${isTerminalLearningMode ? `is-active is-size-${terminalLearningPanelSize}` : "is-single"}`}>
          {!isTerminalPopup && !isEmbeddedMode && props.activeLab ? (
            <button
              aria-label="랩 문의 남기기"
              className={`terminal-learning-support-fab${isTerminalLearningMode ? " is-learning-mode" : ""}`}
              onClick={openLabSupportMessage}
              title="현재 랩 정보와 함께 운영지원 문의를 남깁니다."
              type="button"
            >
              <span aria-hidden="true" className="terminal-learning-support-fab-icon">?</span>
              <span className="terminal-learning-support-fab-text">문의</span>
            </button>
          ) : null}
          <div className="terminal-learning-console" ref={terminalCaptureFrameRef}>
            <div
              aria-busy={consoleSwitchState ? "true" : undefined}
              className={`terminal-embed terminal-shell ${isWindowsLab ? "is-windows-rdp-only" : ""} ${terminalConsoleReadiness ? "is-console-blocked" : ""} ${isTerminalPopup ? "is-fill" : isEmbeddedMode ? "is-embedded" : "is-fixed"}`}
            >
              <div className={`terminal-root ${isTerminalPopup ? "is-fill" : isEmbeddedMode ? "is-embedded" : "is-fixed"}`} ref={terminalRootRef} />
              {renderTerminalUsageOverlay()}
              {renderTerminalConsoleStatusOverlay()}
              {isWindowsLab ? (
                <div className="terminal-rdp-overlay" aria-live="polite">
                  <div className="terminal-rdp-overlay-panel">
                    <span className="card-label">Windows RDP</span>
                    <strong>RDP로 접근하세요</strong>
                    <p>Windows 랩은 브라우저 SSH 콘솔을 제공하지 않습니다. 외부 RDP 카드의 주소와 발급된 Windows 계정으로 접속해 주세요.</p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          {isTerminalLearningMode ? renderTerminalLearningPanel() : null}
        </div>
        {replayModalOpen ? (
          <div className="terminal-replay-modal" role="dialog" aria-modal="true" aria-label="터미널 세션 리플레이">
            <div className="terminal-replay-dialog">
              <div className="portal-detail-head terminal-replay-head">
                <div>
                  <p className="card-label">세션 리플레이</p>
                  <h4>{replayData?.replay?.targetLabel || replayData?.replay?.nodeName || "터미널 기록"}</h4>
                  <p className="hint">{replayData?.replay?.startedAt ? `시작: ${formatDateTime(replayData.replay.startedAt)}` : ""}</p>
                </div>
                <div className="terminal-replay-actions">
                  <select
                    aria-label="재생 배속"
                    value={String(replaySpeed)}
                    onChange={(event) => {
                      const nextSpeed = Number(event.target.value) || 1;
                      setReplaySpeed(nextSpeed);
                      if (replayPlaying) {
                        pauseReplay();
                        window.setTimeout(() => playReplay(replayPlaybackRef.current.positionMs, nextSpeed), 20);
                      }
                    }}
                  >
                    <option value="0.5">0.5x</option>
                    <option value="1">1x</option>
                    <option value="2">2x</option>
                    <option value="4">4x</option>
                  </select>
                  <button className="ghost-btn" onClick={replayPlaying ? pauseReplay : () => playReplay(replayPlaybackRef.current.positionMs, replaySpeed)} type="button">
                    {replayPlaying ? "일시정지" : "재생"}
                  </button>
                  <button className="ghost-btn" onClick={restartReplay} type="button">처음부터</button>
                  <button className="ghost-btn" onClick={() => setReplayModalOpen(false)} type="button">닫기</button>
                </div>
              </div>
              <div className="terminal-replay-root" ref={replayRootRef} />
            </div>
          </div>
        ) : null}
        {!isTerminalPopup && !isEmbeddedMode ? (
          <form className="ai-terminal-panel" onSubmit={requestAiTerminalPlan}>
            <div className="portal-detail-head">
              <div>
                <p className="card-label">AI 터미널 작업</p>
                <h4>자연어로 실행 계획 만들기</h4>
              </div>
              <span className={`status-chip ${aiTerminalSocketReady ? "is-success" : "is-muted"}`}>
                {aiTerminalSocketReady ? "터미널 연결됨" : "터미널 대기"}
              </span>
            </div>
            <div className="ai-terminal-composer">
              <input
                disabled={!canUseAiTerminalPlanner || aiTerminalPlanning}
                onChange={(event) => setAiTerminalInstruction(event.target.value)}
                placeholder="예: kubeflow 설치하고 싶어"
                value={aiTerminalInstruction}
              />
              <button className="primary-btn" disabled={!canUseAiTerminalPlanner || aiTerminalPlanning} type="submit">
                {aiTerminalPlanning ? "계획 생성 중" : "계획 만들기"}
              </button>
            </div>
            <StatusMessage {...aiTerminalStatus} />
            {aiTerminalPlan ? (
              <div className={`ai-terminal-plan is-${aiTerminalPlan.risk || "low"}`}>
                <div className="ai-terminal-plan-head">
                  <strong>{aiTerminalPlan.summary}</strong>
                  <span className={`status-chip ${aiTerminalPlan.risk === "high" ? "is-error" : aiTerminalPlan.risk === "medium" ? "is-warn" : "is-success"}`}>
                    {`위험도 ${aiTerminalPlan.risk || "low"}`}
                  </span>
                </div>
                {aiTerminalPlan.warnings?.length ? (
                  <ul className="ai-terminal-warning-list">
                    {aiTerminalPlan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                ) : null}
                <ol className="ai-terminal-command-list">
                  {aiTerminalPlan.commands?.map((command, index) => (
                    <li key={`${command}-${index}`}>
                      <code>{command}</code>
                    </li>
                  ))}
                </ol>
                <div className="portal-actions ai-terminal-actions">
                  <button className="primary-btn" disabled={!aiTerminalSocketReady} onClick={runAiTerminalPlan} type="button">현재 터미널에 입력</button>
                  <button className="ghost-btn" onClick={() => setAiTerminalPlan(null)} type="button">계획 지우기</button>
                </div>
              </div>
            ) : null}
          </form>
        ) : null}
        {!isTerminalPopup && !isEmbeddedMode ? <div className="simple-status-list terminal-detail-list">
          <div>{`랩 정책: ${formatLabRetentionSummary(activeLabCourse || {})}`}</div>
          <div>{`동시 랩 사용: ${activeLabCount} / ${maxConcurrentLabs}`}</div>
          {isContainerLab ? (
            <>
              <div>{`컨테이너 네트워크: ${getLabRuntimeNetworkName(activeLabCourse || props.activeLab || {})}`}</div>
              <div>공개 URL 조건: HAProxy/앱이 접근 가능한 내부망에 컨테이너가 연결되어 있어야 합니다.</div>
              <div>재생성 동작: 기존 컨테이너 종료 후 같은 과정으로 다시 생성합니다.</div>
            </>
          ) : (
            <>
              <div>{`사양 변경 정책: ${activeLabCourse ? describeCourseLabResizePolicy(activeLabCourse, props.platformStatus) : "-"}`}</div>
              <div>{`사양 변경 요청: ${props.activeLab?.resizeRequestPending ? `${props.activeLab?.requestedResizeFlavor || "-"} / 관리자 승인 대기` : "없음"}`}</div>
            </>
          )}
          <div>{`랩 시험 접근: ${labExamCompleted ? "제출 완료로 제한" : "사용 가능"}`}</div>
          <div>{`선택 ${labBackendLabel}: ${selectedVmNode?.name || "선택 없음"}`}</div>
          <div>{`\uC5F0\uACB0 \uB300\uC0C1: ${props.terminalSession?.targetLabel || "\uB300\uAE30 \uC911"}`}</div>
        </div> : null}
          {!isTerminalPopup && isEmbeddedMode ? (
            <div className="portal-actions embedded-terminal-actions">
              <button className="mini-btn primary-mini-btn terminal-open-btn" disabled={!props.activeLab || isWindowsLab || props.activeLab.status !== "running" || labExamCompleted || terminalSessionBusy || !selectedNodeSshConnectable} onClick={() => connectSelectedVm()} type="button">{isWindowsLab ? "Windows RDP 사용" : terminalSessionBusy ? "연결 확인 중" : `현재 ${labBackendLabel} 연결`}</button>
              <button className="mini-btn terminal-console-btn" disabled={!props.activeLab || isWindowsLab || props.activeLab.status !== "running" || labExamCompleted || !selectedVmNode || !selectedNodeSshConnectable} onClick={() => openSelectedVmTerminalPopup()} type="button">콘솔 분리</button>
              <button className="mini-btn terminal-support-btn" onClick={openLabSupportMessage} type="button">문의 남기기</button>
            </div>
          ) : null}
          {!isTerminalPopup && !isEmbeddedMode && !isContainerLab && resizePolicy === "requestable" && allowedResizeFlavors.length ? (
            <div className="lab-resize-request-panel admin-form-grid compact-admin-grid">
              <AdminField label="랩 사양 변경 요청" hint="허용된 Flavor 중 하나를 선택해 관리자 승인형 업그레이드를 요청합니다.">
                <div className="inline-input-action">
                  <select value={requestedResizeFlavor} onChange={(event) => setRequestedResizeFlavor(event.target.value)}>
                    {allowedResizeFlavors.map((flavor) => (
                      <option key={flavor} value={flavor}>{flavor}</option>
                    ))}
                  </select>
                  <button
                    className={props.activeLab?.resizeRequestPending ? "ghost-btn" : "primary-btn"}
                    disabled={!props.activeLab || props.activeLab.status !== "running" || labExamCompleted || !requestedResizeFlavor || (!props.activeLab?.resizeRequestPending && requestedResizeFlavor === (props.activeLab?.currentFlavor || ""))}
                    onClick={props.activeLab?.resizeRequestPending ? props.onCancelLabResizeRequest : () => props.onRequestLabResize(requestedResizeFlavor)}
                    type="button"
                  >
                    {props.activeLab?.resizeRequestPending ? "사양 변경 요청 취소" : "사양 변경 요청"}
                  </button>
                </div>
              </AdminField>
            </div>
          ) : null}
          {!isTerminalPopup && !isEmbeddedMode && !showTerminalUsageOverlay ? <VmUsageBlock compact course={activeLabCourse} lab={props.activeLab} /> : null}
          {!isTerminalPopup && !isEmbeddedMode && !showTerminalUsageOverlay ? <TrafficUsageBlock compact course={activeLabCourse} lab={props.activeLab} /> : null}
        </div>

          {!isTerminalPopup && !isEmbeddedMode && props.platformStatus?.terminalFileUploadEnabled === true ? <div className="lab-upload-card">
            <div className="portal-detail-head">
              <div>
                <p className="card-label">파일 업로드</p>
                <h4>현재 랩 인스턴스로 전송</h4>
              </div>
            </div>
            <div className="simple-status-list compact-status-list">
              <div>업로드 경로: ~/uploads</div>
              <div>전송 방식: SSH 자격증명을 사용한 서버 중계 업로드</div>
              {props.terminalUploadState?.uploading ? <div>{`업로드 중: ${props.terminalUploadState.fileName}`}</div> : null}
            </div>
            <div className="portal-actions">
              <label className="ghost-btn file-upload-btn">
                <input
                  disabled={!props.activeLab || props.activeLab.status !== "running" || labExamCompleted || props.terminalUploadState?.uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      props.onUploadLabFile(file, props.activeLab?.id, {
                        nodeId: selectedVmNode?.id || "",
                        targetHost: selectedVmNode?.fixedIp || selectedVmNode?.floatingIp || "",
                      });
                    }
                    event.target.value = "";
                  }}
                  type="file"
                />
                {props.terminalUploadState?.uploading ? "업로드 중..." : "파일 업로드"}
              </label>
            </div>
          </div> : null}
        </section>
      );
  }









function ResourceDomains(props) {
  const vmNodes = deriveVmNodes(props.activeLab);
  const selectedNodeId = String(props.publicRouteForm?.nodeId || "").trim();
  const requiresNodeSelection = vmNodes.length > 1;
  const selectedNode = selectedNodeId
    ? vmNodes.find((node) => String(node.id || "") === selectedNodeId) || null
    : (requiresNodeSelection ? null : vmNodes[0] || null);
  const routeTarget = selectedNode?.fixedIp || selectedNode?.floatingIp || props.activeLab?.instanceIps?.find((item) => item.type === "fixed")?.address
    || props.activeLab?.instanceIp
    || "-";
  const selectedTcpNodeId = String(props.publicTcpRouteForm?.nodeId || "").trim();
  const selectedTcpNode = selectedTcpNodeId
    ? vmNodes.find((node) => String(node.id || "") === selectedTcpNodeId) || null
    : (requiresNodeSelection ? null : vmNodes[0] || null);
  const tcpRouteTarget = selectedTcpNode?.fixedIp || selectedTcpNode?.floatingIp || props.activeLab?.instanceIps?.find((item) => item.type === "fixed")?.address
    || props.activeLab?.instanceIp
    || "-";
  const publicDomains = props.activeLab?.publicDomains || [];
  const requestedDomains = props.activeLab?.requestedPublicDomains || [];
  const publicTcpRoutes = props.activeLab?.publicTcpRoutes || [];
  const requestedPublicTcpRoutes = props.activeLab?.requestedPublicTcpRoutes || [];
  const existingDomainCount = publicDomains.length + requestedDomains.length;
  const existingTcpCount = publicTcpRoutes.length + requestedPublicTcpRoutes.length;
  const totalExposureCount = existingDomainCount + existingTcpCount;
  const domainStatusLabel = requestedDomains.length ? "관리자 승인 대기" : publicDomains.length ? "공개 중" : "미설정";
  const activeLabExam = props.labExams?.find((item) => Number(item.courseId) === Number(props.activeLab?.courseId)) || null;
  const labExamCompleted = isLabExamLocked(activeLabExam);
  const activeLabCourse = props.courses?.find((item) => Number(item.id) === Number(props.activeLab?.courseId)) || null;
  const publicDomainRoutesEnabled = props.platformStatus?.publicDomainRoutesEnabled !== false;
  const publicTcpRoutesEnabled = Boolean(props.platformStatus?.publicTcpRoutesEnabled);
  const publicDomainUseDisabled = activeLabCourse?.publicDomainApprovalMode === "disabled";
  const publicTcpUseDisabled = activeLabCourse?.publicTcpApprovalMode === "disabled";
  const publicTcpTargetPort = Number(props.publicTcpRouteForm?.targetPort || 0);
  const publicDomainTargetPort = Number(props.publicRouteForm?.port || 0);
  const allowedPublicRoutePorts = (props.platformStatus?.allowedPublicRoutePorts || []).map((port) => Number(port)).filter((port) => Number.isInteger(port));
  const publicDomainTargetPortAllowed = !allowedPublicRoutePorts.length || allowedPublicRoutePorts.includes(publicDomainTargetPort);
  const canUsePublicTcp = props.activeLab?.resourceType !== "custom-lab" && Boolean(props.onRequestLabPublicPort) && Boolean(props.publicTcpRouteForm) && Boolean(props.setPublicTcpRouteForm);
  const canRequestPublicTcp = Boolean(
    canUsePublicTcp
    && publicTcpRoutesEnabled
    && !publicTcpUseDisabled
    && props.activeLab
    && props.activeLab.status === "running"
    && Number.isInteger(publicTcpTargetPort)
    && publicTcpTargetPort >= 1
    && publicTcpTargetPort <= 65535
    && totalExposureCount < 7
    && !labExamCompleted
    && (!requiresNodeSelection || selectedTcpNode)
  );
  const canRequestDomain = Boolean(
    props.activeLab
    && props.activeLab.status === "running"
    && publicDomainRoutesEnabled
    && !publicDomainUseDisabled
    && routeTarget !== "-"
    && Number.isInteger(publicDomainTargetPort)
    && publicDomainTargetPort >= 1
    && publicDomainTargetPort <= 65535
    && publicDomainTargetPortAllowed
    && totalExposureCount < 7
    && !labExamCompleted
    && (!requiresNodeSelection || selectedNode)
  );
  const isRandomDomainRequest = !String(props.publicRouteForm?.subdomain || "").trim();
  const domainType = String(props.publicRouteForm?.domainType || "managed") === "custom" ? "custom" : "managed";
  const isCustomDomainRequest = domainType === "custom";
  const managedSubdomainValidation = validateManagedSubdomainInput(props.publicRouteForm?.subdomain);
  const hasInvalidManagedSubdomain = !isCustomDomainRequest && !managedSubdomainValidation.ok;
  const isAdminCustomLabDomainPublisher = props.session?.role === "admin" && props.activeLab?.resourceType === "custom-lab";
  const customDomain = String(props.publicRouteForm?.customDomain || "").trim();
  const domainRoutingHost = String(props.platformStatus?.labBaseDomain || "apps.example.com").trim();
  const customDomainTxtName = customDomain ? `_terminal-lab-challenge.${customDomain}` : "_terminal-lab-challenge.<사용자 도메인>";
  const customDomainGuidanceReplacements = {
    domain: customDomain || "<사용자 도메인>",
    target: domainRoutingHost,
    txtName: customDomainTxtName,
  };
  const customDomainGuidance = {
    intro: props.platformStatus?.customDomainGuidanceIntro || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.intro,
    cnameLabel: props.platformStatus?.customDomainGuidanceCnameLabel || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.cnameLabel,
    cnameText: props.platformStatus?.customDomainGuidanceCnameText || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.cnameText,
    ownershipLabel: props.platformStatus?.customDomainGuidanceOwnershipLabel || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.ownershipLabel,
    ownershipText: props.platformStatus?.customDomainGuidanceOwnershipText || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.ownershipText,
    recommendationLabel: props.platformStatus?.customDomainGuidanceRecommendationLabel || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.recommendationLabel,
    recommendationText: props.platformStatus?.customDomainGuidanceRecommendationText || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.recommendationText,
    verificationLabel: props.platformStatus?.customDomainGuidanceVerificationLabel || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.verificationLabel,
    verificationText: props.platformStatus?.customDomainGuidanceVerificationText || DEFAULT_CUSTOM_DOMAIN_GUIDANCE.verificationText,
  };
  const customDomainGuidanceRows = [
    ["cnameLabel", "cnameText", true],
    ["ownershipLabel", "ownershipText", true],
    ["recommendationLabel", "recommendationText", false],
    ["verificationLabel", "verificationText", false],
  ].map(([labelKey, textKey, isCode]) => ({
    label: customDomainGuidance[labelKey],
    text: renderCustomDomainGuidanceText(customDomainGuidance[textKey], customDomainGuidanceReplacements),
    isCode,
  }));
  const requestReadinessLabel = !publicDomainRoutesEnabled
    ? "관리자 비활성화"
    : publicDomainUseDisabled
      ? "과정 사용금지"
    : !props.activeLab
    ? "실행 중인 랩 없음"
    : props.activeLab.status !== "running"
      ? "랩 실행 상태 아님"
      : labExamCompleted
        ? "랩 시험 제출 완료"
        : requiresNodeSelection && !selectedNode
          ? "대상 서버 선택 필요"
          : routeTarget === "-"
            ? "fixed IP 미준비"
            : totalExposureCount >= 7
              ? "외부 노출 최대 7개 도달"
              : !publicDomainTargetPortAllowed
                ? "대상 포트 허용 필요"
              : hasInvalidManagedSubdomain
                ? "서브도메인 형식 확인 필요"
              : isCustomDomainRequest
                ? (customDomain ? "사용자 도메인 요청 가능" : "사용자 도메인 입력 필요")
                : isRandomDomainRequest ? "랜덤 도메인 요청 가능" : "직접 지정 도메인 요청 가능";
  const publicTcpReadinessLabel = !canUsePublicTcp
    ? "사용할 수 없음"
    : !publicTcpRoutesEnabled
      ? "관리자 비활성화"
      : publicTcpUseDisabled
        ? "과정 사용금지"
        : !props.activeLab
          ? "실행 중인 랩 없음"
          : props.activeLab.status !== "running"
            ? "랩 실행 상태 아님"
            : labExamCompleted
              ? "랩 시험 제출 완료"
              : totalExposureCount >= 7
                ? "외부 노출 최대 7개 도달"
                : !Number.isInteger(publicTcpTargetPort) || publicTcpTargetPort < 1 || publicTcpTargetPort > 65535
                  ? "내부 TCP 포트 입력 필요"
                  : requiresNodeSelection && !selectedTcpNode
                    ? "대상 서버 선택 필요"
                  : "TCP 포트 요청 가능";
  const publicTcpReadinessDetail = publicTcpReadinessLabel === "TCP 포트 요청 가능"
    ? "입력한 내부 TCP 포트를 외부 포트 대역으로 요청할 수 있습니다."
    : publicTcpReadinessLabel === "내부 TCP 포트 입력 필요"
      ? "외부에 공개할 내부 서비스 포트를 1-65535 범위로 입력해 주세요."
      : publicTcpReadinessLabel === "대상 서버 선택 필요"
        ? "외부 TCP 포트를 연결할 가상머신을 먼저 선택해 주세요."
      : publicTcpReadinessLabel === "관리자 비활성화"
        ? "관리자 설정에서 공개 TCP 포트 기능이 비활성화되어 있습니다."
        : publicTcpReadinessLabel === "과정 사용금지"
          ? "이 과정에서는 공개 TCP 포트 요청을 허용하지 않습니다."
          : publicTcpReadinessLabel;
  const activeExposureTab = props.activeExposureTab === "tcp" && canUsePublicTcp ? "tcp" : "domain";
  const setActiveExposureTab = typeof props.setActiveExposureTab === "function" ? props.setActiveExposureTab : () => {};
  const selectedNodeLabel = selectedNode
    ? `${selectedNode.name || "기본 노드"} (${routeTarget})`
    : (requiresNodeSelection ? "대상 서버 선택 필요" : "기본 대상");
  const selectedTcpNodeLabel = selectedTcpNode
    ? `${selectedTcpNode.name || "기본 노드"} (${tcpRouteTarget})`
    : (requiresNodeSelection ? "대상 서버 선택 필요" : "기본 대상");
  const formatDomainNodeLabel = (entry) => {
    const nodeName = String(entry?.nodeName || "").trim();
    const targetHost = String(entry?.targetHost || "").trim();
    if (nodeName && targetHost) return `${nodeName} (${targetHost})`;
    if (nodeName) return nodeName;
    if (targetHost) return targetHost;
    return "기본 대상";
  };
  const formatTcpNodeLabel = (entry) => {
    const nodeName = String(entry?.nodeName || "").trim();
    const targetHost = String(entry?.targetHost || "").trim();
    if (nodeName && targetHost) return `${nodeName} (${targetHost})`;
    if (nodeName) return nodeName;
    if (targetHost) return targetHost;
    return "기본 대상";
  };
  const onPortChange = (event) => {
      const nextPort = event.target.value;
      const inferredProtocol = inferPublicRouteProtocolForPort(nextPort);
      const matchingRouteOption = (props.publicRouteOptions || []).find((option) => Number(option.port) === Number(nextPort));
      const nextProtocol = matchingRouteOption?.protocol || inferredProtocol;
      props.setDomainAvailability({ tone: "", message: "" });
      props.setPublicRouteForm((current) => ({
        ...current,
        routeKey: matchingRouteOption?.key || (nextProtocol === "https" && String(current.routeKey || "http") === "http" ? "https" : current.routeKey || "http"),
        port: nextPort,
        protocol: nextProtocol,
      }));
  };
  const onProtocolChange = (event) => {
    const nextProtocol = event.target.value === "https" ? "https" : "http";
    props.setDomainAvailability({ tone: "", message: "" });
    props.setPublicRouteForm((current) => ({
      ...current,
      protocol: nextProtocol,
    }));
  };
  const onRouteOptionChange = (event) => {
    const nextKey = event.target.value;
    const selectedOption = (props.publicRouteOptions || []).find((item) => item.key === nextKey);
    props.setDomainAvailability({ tone: "", message: "" });
    if (!selectedOption) return;
    props.setPublicRouteForm((current) => ({
      ...current,
      routeKey: selectedOption.key,
      protocol: selectedOption.protocol,
      port: selectedOption.port,
    }));
  };
  const onSubdomainChange = (event) => {
    props.setDomainAvailability({ tone: "", message: "" });
    props.setPublicRouteForm((current) => ({ ...current, subdomain: event.target.value }));
  };
  const onCustomDomainChange = (event) => {
    props.setDomainAvailability({ tone: "", message: "" });
    props.setPublicRouteForm((current) => ({ ...current, customDomain: event.target.value }));
  };
  const onDomainTypeChange = (event) => {
    const nextType = event.target.value === "custom" ? "custom" : "managed";
    props.setDomainAvailability({ tone: "", message: "" });
    props.setPublicRouteForm((current) => ({ ...current, domainType: nextType }));
  };
  const onNodeChange = (event) => {
    const nextNodeId = String(event.target.value || "");
    const nextSubdomain = generateRandomPublicSubdomainCandidate();
    const hasExistingDomains = publicDomains.length > 0 || requestedDomains.length > 0;
    props.setDomainAvailability({
      tone: "success",
      message: hasExistingDomains
        ? "기존 공개 URL은 유지하고, 선택한 대상 서버로 새 랜덤 도메인 후보를 준비했습니다."
        : "대상 서버가 바뀌어 새 랜덤 도메인 후보를 준비했습니다.",
    });
    props.setPublicRouteForm((current) => ({
      ...current,
      domainType: "managed",
      customDomain: "",
      nodeId: nextNodeId,
      subdomain: nextSubdomain,
    }));
  };
  const onTcpNodeChange = (event) => {
    const nextNodeId = String(event.target.value || "");
    props.setPublicTcpRouteForm((current) => ({
      ...current,
      nodeId: nextNodeId,
    }));
  };
  const prepareManagedSubdomainAction = () => {
    if (isCustomDomainRequest) return true;
    if (!managedSubdomainValidation.ok) {
      props.setDomainAvailability({
        tone: "error",
        message: managedSubdomainValidation.message,
      });
      return false;
    }
    if (managedSubdomainValidation.normalized !== String(props.publicRouteForm?.subdomain || "").trim()) {
      props.setPublicRouteForm((current) => ({ ...current, subdomain: managedSubdomainValidation.normalized }));
    }
    return true;
  };
  const handleCheckDomain = () => {
    if (!prepareManagedSubdomainAction()) return;
    props.onCheckLabDomain(props.activeLab);
  };
  const handlePublishDomain = () => {
    if (!prepareManagedSubdomainAction()) return;
    props.onPublishLabDomain(props.activeLab);
  };

  return (
      <section className="portal-stack">
          <div className="simple-panel domain-config-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">{activeExposureTab === "tcp" ? "공개 TCP" : "\uACF5\uAC1C \uB3C4\uBA54\uC778"}</p>
            <h3>{activeExposureTab === "tcp" ? "외부 TCP 포트" : "\uC678\uBD80 \uB300\uC2DC\uBCF4\uB4DC URL"}</h3>
          </div>
          {props.activeLab?.publicUrl ? <a className="ghost-btn" href={props.activeLab.publicUrl} rel="noreferrer" target="_blank">{"URL \uC5F4\uAE30"}</a> : null}
        </div>

        <div className="domain-config-tabs" role="tablist" aria-label="외부 접속 설정">
          <button
            aria-selected={activeExposureTab === "domain"}
            className={`domain-config-tab${activeExposureTab === "domain" ? " is-active" : ""}`}
            onClick={() => setActiveExposureTab("domain")}
            role="tab"
            type="button"
          >
            <span>공개 URL</span>
            <small>{requestReadinessLabel}</small>
          </button>
          {canUsePublicTcp ? (
            <button
              aria-selected={activeExposureTab === "tcp"}
              className={`domain-config-tab${activeExposureTab === "tcp" ? " is-active" : ""}`}
              onClick={() => setActiveExposureTab("tcp")}
              role="tab"
              type="button"
            >
              <span>TCP 포트</span>
              <small>{publicTcpReadinessLabel}</small>
            </button>
          ) : null}
        </div>

        {activeExposureTab === "domain" ? (
        <>
          <div className="admin-form-grid compact-admin-grid">
            <AdminField label={"도메인 방식"}>
              <select value={domainType} onChange={onDomainTypeChange}>
                <option value="managed">지원 서브도메인</option>
                <option value="custom">사용자 도메인</option>
              </select>
            </AdminField>
            {isCustomDomainRequest ? (
              <AdminField label={"사용자 도메인"}><input value={customDomain} onChange={onCustomDomainChange} placeholder="예: app.example.com" /></AdminField>
            ) : (
              <>
                <AdminField label={"\uC11C\uBE0C\uB3C4\uBA54\uC778"}><input value={props.publicRouteForm.subdomain} onChange={onSubdomainChange} placeholder="비워두면 랜덤 도메인 자동 요청" /></AdminField>
                <AdminField label={"\uAE30\uBCF8 \uB3C4\uBA54\uC778"}><input disabled value={props.platformStatus?.labBaseDomain || "apps.example.com"} /></AdminField>
              </>
            )}
            <AdminField label={"공개 방식"}>
              <select value={props.publicRouteForm.routeKey || (props.publicRouteForm.port === "443" ? "https" : "http")} onChange={onRouteOptionChange}>
                {(props.publicRouteOptions || []).map((option) => (
                  <option key={option.key} value={option.key}>{`${option.label} (${option.port})`}</option>
                ))}
              </select>
            </AdminField>
          <AdminField label={"대상 서버"}>
            <select value={selectedNodeId} onChange={onNodeChange}>
              <option value="">{requiresNodeSelection ? "대상 서버를 선택하세요" : "기본 노드"}</option>
              {vmNodes.map((node, index) => (
                <option key={node.id || index} value={node.id || `node-${index + 1}`}>{`${node.name || `노드 ${index + 1}`} (${node.fixedIp || node.floatingIp || "-"})`}</option>
              ))}
            </select>
          </AdminField>
          <AdminField label={"대상 포트 번호"} hint="HTTP 서비스 포트나 Kubernetes NodePort를 직접 입력합니다. 예: 80, 8080, 30000"><input value={props.publicRouteForm.port} onChange={onPortChange} placeholder="예: 30000" /></AdminField>
        </div>

            <details className="domain-advanced-settings">
              <summary>고급 연결 설정</summary>
              <div className="admin-form-grid compact-admin-grid">
                <AdminField label={"대상 프로토콜"}>
                  <select value={String(props.publicRouteForm.protocol || "http").toLowerCase() === "https" ? "https" : "http"} onChange={onProtocolChange}>
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                  </select>
                </AdminField>
              </div>
              <p className="hint domain-guidance-inline">대부분은 공개 방식 선택값을 그대로 사용하면 됩니다. 내부 앱이 HTTPS로만 응답할 때만 변경해 주세요.</p>
            </details>

            {isCustomDomainRequest ? (
              <div className="domain-guidance-box">
                <strong>사용자 도메인 등록 전 확인</strong>
                <p>{customDomainGuidance.intro}</p>
                <div className="domain-guidance-list">
                  {customDomainGuidanceRows.map((row) => (
                    <div key={row.label}>
                      <span>{row.label}</span>
                      {row.isCode ? <code>{row.text}</code> : row.text}
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className="hint domain-guidance-inline">서브도메인 공란 시 랜덤 도메인으로 요청되며, 대상 포트는 입력한 값 그대로 승인 후 라우팅됩니다.</p>}
            {Number.isInteger(publicDomainTargetPort) && publicDomainTargetPort >= 1 && !publicDomainTargetPortAllowed ? (
              <p className="hint domain-guidance-inline">{`대상 포트 ${publicDomainTargetPort}는 현재 공개 도메인 허용 포트가 아닙니다. 관리자 설정의 사용자 정의 포트에 추가해야 라우팅됩니다.`}</p>
            ) : null}
            {hasInvalidManagedSubdomain ? (
              <p className="hint domain-guidance-inline is-error">{managedSubdomainValidation.message}</p>
            ) : null}
            {requestedDomains.length || requestedPublicTcpRoutes.length ? <p className="hint domain-guidance-inline">{ADMIN_REVIEW_REQUIRED_MESSAGE}</p> : null}

            <div className="simple-status-list compact-status-list domain-summary-list">
              <div><span>공개 상태</span>{domainStatusLabel}</div>
              <div><span>외부 노출</span>{`${totalExposureCount}/7`}</div>
              <div className="domain-summary-wide"><span>공개 URL</span>{publicDomains.length ? publicDomains.map((entry) => entry.url).join(", ") : "등록된 공개 URL이 없습니다."}</div>
              {requestedDomains.length ? <div className="domain-summary-wide"><span>요청 URL</span>{requestedDomains.map((entry) => entry.url).join(", ")}</div> : null}
              <div className="domain-summary-wide"><span>연결</span>{`${String(props.publicRouteForm.protocol || "http").toUpperCase()} ${selectedNodeLabel}:${props.publicRouteForm.port || "-"} / ${requestReadinessLabel}`}</div>
              {props.activeLab?.publicReviewedBy ? <div className="domain-summary-wide"><span>최근 검토</span>{`${props.activeLab.publicReviewedBy}${props.activeLab.publicReviewedAt ? ` / ${props.activeLab.publicReviewedAt}` : ""}`}</div> : null}
              {props.activeLab?.publicReviewNote ? <div className="domain-summary-wide"><span>검토 메모</span>{props.activeLab.publicReviewNote}</div> : null}
          </div>

          {requiresNodeSelection && !selectedNode ? <div className="hint">도메인을 신청하려면 먼저 이 URL을 연결할 서버를 선택해 주세요.</div> : null}

          {labExamCompleted ? <div className="hint">랩 시험 제출이 완료되어 새 공개 도메인 요청은 제한됩니다.</div> : null}

          <StatusMessage {...props.domainAvailability} />

          <div className="portal-actions domain-action-bar domain-primary-action-bar">
            <button className="ghost-btn domain-action-btn domain-check-btn" disabled={!publicDomainRoutesEnabled || publicDomainUseDisabled || hasInvalidManagedSubdomain} onClick={handleCheckDomain} type="button">{publicDomainUseDisabled ? "도메인 사용금지" : isCustomDomainRequest ? "사용자 도메인 확인" : isRandomDomainRequest ? "랜덤 도메인 확인" : "도메인 확인"}</button>
            <button className="primary-btn add-btn domain-action-btn domain-request-btn" disabled={!canRequestDomain || hasInvalidManagedSubdomain || (isCustomDomainRequest && !customDomain)} onClick={handlePublishDomain} type="button">{publicDomainUseDisabled ? "도메인 사용금지" : isAdminCustomLabDomainPublisher ? (isCustomDomainRequest ? "사용자 도메인 게시" : isRandomDomainRequest ? "랜덤 도메인 게시" : "도메인 확인 후 게시") : isCustomDomainRequest ? "사용자 도메인 요청" : isRandomDomainRequest ? "랜덤 도메인 요청" : "도메인 확인 후 추가"}</button>
            <button className="ghost-btn release-btn domain-action-btn domain-release-btn" disabled={!publicDomains.length && !requestedDomains.length} onClick={() => props.onUnpublishLabDomain("", {}, props.activeLab)} type="button">모든 도메인 해제</button>
          </div>

            {publicDomains.length ? (
              <div className="simple-panel domain-list-panel">
                <strong>현재 공개 도메인</strong>
                {publicDomains.map((entry) => (
                  <div className="domain-list-item" key={`public-${entry.subdomain}`}>
                    <div className="domain-list-item-copy">
                      <a className="domain-list-link" href={entry.url} rel="noreferrer" target="_blank">{entry.url}</a>
                      <span className="domain-list-meta">{`내부 ${entry.protocol.toUpperCase()} ${entry.port} / 대상 ${formatDomainNodeLabel(entry)}`}</span>
                    </div>
                    <div className="domain-list-actions">
                      <button className="ghost-btn release-btn" onClick={() => props.onUnpublishLabDomain(entry.subdomain, entry, props.activeLab)} type="button">해제</button>
                    </div>
                  </div>
              ))}
            </div>
          ) : null}

            {requestedDomains.length ? (
              <div className="simple-panel domain-list-panel">
                <strong>승인 대기 도메인</strong>
                {requestedDomains.map((entry) => (
                  <div className="domain-list-item" key={`requested-${entry.subdomain}`}>
                    <div className="domain-list-item-copy">
                      <span className="domain-list-link is-pending">{entry.url}</span>
                      <span className="domain-list-meta">{`내부 ${entry.protocol.toUpperCase()} ${entry.port} / 대상 ${formatDomainNodeLabel(entry)} / ${ADMIN_REVIEW_REQUIRED_MESSAGE}`}</span>
                    </div>
                    <div className="domain-list-actions">
                      <button className="ghost-btn" onClick={() => props.onUnpublishLabDomain(entry.subdomain, entry, props.activeLab)} type="button">요청 취소</button>
                    </div>
                  </div>
              ))}
            </div>
          ) : null}
        </>
        ) : null}

            {activeExposureTab === "tcp" && canUsePublicTcp ? (
              <div className="simple-panel domain-list-panel">
                <strong>공개 TCP 포트</strong>
                <div className="admin-form-grid compact-admin-grid">
                  <AdminField label="대상 서버" hint="공개 URL과 동일하게 노출할 가상머신을 선택합니다.">
                    <select value={selectedTcpNodeId} onChange={onTcpNodeChange}>
                      <option value="">{requiresNodeSelection ? "대상 서버를 선택하세요" : "기본 노드"}</option>
                      {vmNodes.map((node, index) => (
                        <option key={node.id || index} value={node.id || `node-${index + 1}`}>{`${node.name || `노드 ${index + 1}`} (${node.fixedIp || node.floatingIp || "-"})`}</option>
                      ))}
                    </select>
                  </AdminField>
                  <AdminField label="내부 TCP 포트" hint="예: 3306, 6379, 8080처럼 HTTP가 아닌 TCP 서비스 포트입니다.">
                    <input
                      value={props.publicTcpRouteForm?.targetPort || ""}
                      onChange={(event) => props.setPublicTcpRouteForm((current) => ({ ...current, targetPort: event.target.value }))}
                      placeholder="예: 3306"
                    />
                  </AdminField>
                </div>
                <div className="simple-status-list compact-status-list">
                  <div><span>할당 대역</span>{`${props.platformStatus?.tcpExternalPortStart || 45000}-${props.platformStatus?.tcpExternalPortEnd || 45999}`}</div>
                  <div><span>연결 대상</span>{`${selectedTcpNodeLabel}:${props.publicTcpRouteForm?.targetPort || "-"}`}</div>
                  <div><span>공개 TCP</span>{publicTcpRoutes.length ? publicTcpRoutes.map((entry) => `${entry.externalPort}->${formatTcpNodeLabel(entry)}:${entry.targetPort}`).join(", ") : "미설정"}</div>
                  {requestedPublicTcpRoutes.length ? <div><span>TCP 요청</span>{requestedPublicTcpRoutes.map((entry) => `${formatTcpNodeLabel(entry)}:${entry.targetPort}`).join(", ")}</div> : null}
                  <div><span>요청 가능</span>{publicTcpReadinessLabel}</div>
                </div>
                <p className={`hint domain-guidance-inline${canRequestPublicTcp ? "" : " is-warn"}`}>{publicTcpReadinessDetail}</p>
                {publicTcpRoutes.length ? (
                  <div className="domain-list-panel">
                    {publicTcpRoutes.map((entry) => (
                      <div className="domain-list-item" key={`tcp-${entry.externalPort}-${entry.targetPort}`}>
                        <div className="domain-list-item-copy">
                          <span className="domain-list-link">{`${getNormalizedSshPublicHost(props.platformStatus?.sshPublicHost)}:${entry.externalPort}`}</span>
                          <span className="domain-list-meta">{`대상 ${formatTcpNodeLabel(entry)} / 내부 TCP ${entry.targetPort}`}</span>
                        </div>
                        <div className="domain-list-actions">
                          <button className="ghost-btn release-btn" onClick={() => props.onReleaseLabPublicPort?.(entry.targetPort, entry.externalPort, entry)} type="button">해제</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {requestedPublicTcpRoutes.length ? (
                  <div className="domain-list-panel">
                    {requestedPublicTcpRoutes.map((entry) => (
                      <div className="domain-list-item" key={`tcp-requested-${entry.targetPort}-${entry.nodeId || entry.targetHost || "default"}`}>
                        <div className="domain-list-item-copy">
                          <span className="domain-list-link is-pending">{`${formatTcpNodeLabel(entry)}:${entry.targetPort}`}</span>
                          <span className="domain-list-meta">{`내부 TCP ${entry.targetPort} / ${ADMIN_REVIEW_REQUIRED_MESSAGE}`}</span>
                        </div>
                        <div className="domain-list-actions">
                          <button className="ghost-btn" onClick={() => props.onReleaseLabPublicPort?.(entry.targetPort, null, entry)} type="button">요청 취소</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="portal-actions domain-action-bar">
                  <button className="primary-btn add-btn domain-action-btn" disabled={!canRequestPublicTcp} onClick={props.onRequestLabPublicPort} type="button">{publicTcpUseDisabled ? "TCP 사용금지" : "TCP 포트 요청"}</button>
                </div>
              </div>
            ) : null}
          </div>
      </section>
    );
  }

export default function GeneralResourceTerminal(props){return props.activeLab?.resourceType === "custom-lab" || props.terminalSession?.resourceType === "custom-lab" ? <ResourceTerminal {...props} selectedCourse={null} activeLabCourse={null} courses={[]}/> : null;}
export function DomainView(props){return props.activeLab?.resourceType === "custom-lab" ? <ResourceDomains {...props}/> : null;}
