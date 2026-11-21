import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import {lazy} from "react";
import { Terminal } from "@xterm/xterm";
import "./xterm.css";
import {AdminField,StatusMessage,VmTabs,deriveLabIpSummary,deriveSelectedNodeIpSummary,deriveVmNodes,formatDateTime,formatTrafficBytes,formatRemainingTime,getCourseBackendDetailLabel,getLabBackendLabel,getLabRuntimeNetworkName,getLabTimeWarning,getNormalizedSshPublicHost,isValidExternalPort,isWindowsLabProfile,isLabExamLocked,getYoutubeEmbedUrl,ipList,labStatus,materialDownloadHref,materialEmbedHref,materialPreviewHref,normalizeSshCopyValue,resolveCourseLabResizeAllowedFlavors,resolveCourseLabResizePolicy} from "./portal-views.jsx";
import { api } from "./portal-state.js";

const GuideMarkdownBlock = lazy(() => import("./guide-renderer.jsx"));

const TERMINAL_AUTO_OPEN_RETRY_BASE_MS = 3000;
const TERMINAL_AUTO_OPEN_RETRY_MAX_MS = 15000;

const wsUrl = (pathname) =>
  `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${pathname}`;





function isVmNodePlanned(node) {
  return node?.planned === true || String(node?.planned || "").trim().toLowerCase() === "true";
}

function getVmNodeSelectionKey(node, index = 0) {
  return String(node?.id || node?.serverName || node?.server_name || node?.resourceName || node?.resource_name || node?.name || node?.fixedIp || node?.floatingIp || node?.ip || `vm-${index + 1}`).trim();
}



function buildVmNodeConsolePayload(node) {
  if (!node) return { nodeId: "", targetHost: "", serverName: "" };
  return {
    nodeId: String(node.id || "").trim(),
    targetHost: String(node.fixedIp || node.fixed_ip || node.floatingIp || node.floating_ip || node.ip || "").trim(),
    serverName: String(node.serverName || node.server_name || node.resourceName || node.resource_name || node.name || "").trim(),
  };
}



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
  const isTerminalPopup = false;
  const isEmbeddedMode = true;
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

  const autoOpenedLabIdRef = useRef(null);
  const autoOpenTargetKeyRef = useRef("");
  const autoOpenRetryTimerRef = useRef(null);
  const autoOpenRetryAttemptsRef = useRef(0);


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


  const [activeTerminalResourceKey, setActiveTerminalResourceKey] = useState("");
  const [terminalLearningPanelSize, setTerminalLearningPanelSize] = useState("balanced");
  const [requestedResizeFlavor, setRequestedResizeFlavor] = useState("");
  const [selectedVmNodeId, setSelectedVmNodeId] = useState("");
  const [consoleSwitchState, setConsoleSwitchState] = useState(null);
  const [consoleSwitchElapsedSeconds, setConsoleSwitchElapsedSeconds] = useState(0);




  const [terminalSocketOpen, setTerminalSocketOpen] = useState(false);
  const [replayModalOpen, setReplayModalOpen] = useState(false);

  const [replayData, setReplayData] = useState(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [labSupportModalOpen, setLabSupportModalOpen] = useState(false);
  const [labSupportDraft, setLabSupportDraft] = useState({ subject: "", body: "" });
  const [labSupportStatus, setLabSupportStatus] = useState({ tone: "", message: "" });
  const [labSupportSending, setLabSupportSending] = useState(false);





  const [instructorShareOutput, setInstructorShareOutput] = useState("");




  const [instructorShareViewerOpen, setInstructorShareViewerOpen] = useState(false);


  const [labTimeTick, setLabTimeTick] = useState(0);
  const [terminalAutoOpenRetryTick, setTerminalAutoOpenRetryTick] = useState(0);
  const instructorSharePreviewRef = useRef(null);
  const instructorShareDetachedRef = useRef(null);

  const terminalActionMenuCloseTimersRef = useRef(new Map());

  const selectedCourse = null;
  const supportGroupName = props.platformStatus?.supportMessageGroupName || "운영지원";
  const supportAvailabilityMode = String(props.platformStatus?.supportAvailabilityMode || "available").trim().toLowerCase() === "away" ? "away" : "available";
  const supportUnavailableMessage = String(props.platformStatus?.supportUnavailableMessage || "").trim()
    || `현재 ${supportGroupName} 담당자가 부재중입니다.`;
  const userCanBypassSupportAway = Boolean(props.isAdmin) || Boolean(props.session?.supportMessageEnabled);
  const supportAwayBlocksSubmit = supportAvailabilityMode === "away" && !userCanBypassSupportAway;
  const activeLabCourse = null;
  const externalSshUseDisabled = activeLabCourse?.externalSshApprovalMode === "disabled";
  const externalRdpUseDisabled = activeLabCourse?.externalRdpApprovalMode === "disabled";
  const activeLabExam = []?.find((item) => Number(item.courseId) === Number(props.activeLab?.courseId)) || null;
  const labExamCompleted = isLabExamLocked(activeLabExam);
  const activeLabCount = ([] || []).filter((item) => ["pending", "approved", "provisioning", "running", "paused", "terminating"].includes(String(item.status || "").toLowerCase())).length;
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




  const vmNodes = deriveVmNodes(props.activeLab);
  const initialPopupTarget = { nodeId: "", targetHost: "" };
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
  const activeLabBackendSource = props.activeLab;
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
  const terminalDisplayItems = terminalInfoItems.filter((item) => (
          (item.label === "상태" || item.label === "대표 IP" || item.label === "선택 VM 대표 IP" || item.label === "전체 IP" || item.label === "선택 VM 전체 IP" || item.label === "모든 MAC 주소" || item.label === "선택 VM 모든 MAC" || item.label === "SSH 아이디" || item.label === "노드 접속 정보" || item.label === "SSH 비밀번호" || item.label === "Windows 아이디" || item.label === "Windows 비밀번호" || item.label === (isWindowsLab ? "외부 RDP" : "외부 SSH") || item.label === "공개 URL")
          && !hiddenEmbeddedInfoLabels.has(item.label)
        ));
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
  const terminalCourseOptions = [];
  const selectedCourseOption = terminalCourseOptions.find((entry) => Number(entry.course.id) === Number(selectedCourse?.id)) || null;
  const terminalSelectedCourseOption = selectedCourseOption || terminalCourseOptions[0] || null;
  const labRoomEnrollmentDisabled = !props.loading && !props.isAdmin && terminalCourseOptions.length === 0;
  const terminalSelectedCourse = terminalSelectedCourseOption?.course || (props.isAdmin ? selectedCourse : null);
  const terminalSelectedCourseLab = terminalSelectedCourseOption
    ? terminalSelectedCourseOption.lab
    : (props.isAdmin ? null : null);
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




  function copyTerminalValue(value) {
    if (!value) return;
    navigator.clipboard?.writeText(normalizeSshCopyValue(value));
  }



  function closeInstructorShareSocket(){return null;}



















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
    const activeLabExam = []?.find((item) => Number(item.courseId) === Number(props.activeLab?.courseId)) || null;
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
  }, [initialPopupTarget.nodeId, initialPopupTarget.targetHost, isWindowsLab, props.activeLab, props.autoOpenTerminal, [], props.onCreateTerminalSession, props.terminalSession, terminalAutoOpenRetryTick, terminalSessionBusy, vmNodes]);

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






  function renderTerminalLearningPanel(){return null;}

  function renderTerminalLearningNudge(){return null;}

  function renderInstructorSharePanel(){return null;}

  function renderTerminalConsoleActionBar() {
    return null;






  }

  function renderVncClipboardPanel() {
    return null;


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
        className={`portal-stack terminal-view-shell ${labRoomEnrollmentDisabled ? "is-enrollment-disabled" : ""} ${"embedded-terminal-view"} ${""}`}
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
          {null}

        {null}

        {null}

        <div className="terminal-lab-topbar">
          {null}
          {<details
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
            </details>}
          {hasPendingRequestedDomains && !isTerminalPopup ? (
            <div className="terminal-lab-flow-hint">
              관리자 검토 후 사용이 가능합니다. 요청 URL은 승인 후 자동으로 `공개 URL` 카드로 이동하며, 그때부터 바로 열기와 복사가 가능합니다.
            </div>
          ) : null}
        </div>
        {renderTerminalLearningNudge()}
        {terminalNoticeItems.length ? (
          <div className="terminal-notice-stack" aria-label="터미널 상태 안내">
            {[]}
          </div>
        ) : null}
        {null}
        {null}
        {null}
        {renderTerminalConsoleActionBar()}
        {renderVncClipboardPanel()}
        {renderInstructorSharePanel()}
        {null}
        {renderTerminalNodeSwitchBar()}
        <div className={`terminal-learning-workbench ${isTerminalLearningMode ? `is-active is-size-${terminalLearningPanelSize}` : "is-single"}`}>
          {null}
          <div className="terminal-learning-console" ref={terminalCaptureFrameRef}>
            <div
              aria-busy={consoleSwitchState ? "true" : undefined}
              className={`terminal-embed terminal-shell ${isWindowsLab ? "is-windows-rdp-only" : ""} ${terminalConsoleReadiness ? "is-console-blocked" : ""} ${"is-embedded"}`}
            >
              <div className={`terminal-root ${"is-embedded"}`} ref={terminalRootRef} />
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
        {null}
        {null}
          {<div className="portal-actions embedded-terminal-actions">
              <button className="mini-btn primary-mini-btn terminal-open-btn" disabled={!props.activeLab || isWindowsLab || props.activeLab.status !== "running" || labExamCompleted || terminalSessionBusy || !selectedNodeSshConnectable} onClick={() => connectSelectedVm()} type="button">{isWindowsLab ? "Windows RDP 사용" : terminalSessionBusy ? "연결 확인 중" : `현재 ${labBackendLabel} 연결`}</button>
              <button className="mini-btn terminal-console-btn" disabled={!props.activeLab || isWindowsLab || props.activeLab.status !== "running" || labExamCompleted || !selectedVmNode || !selectedNodeSshConnectable} onClick={() => openSelectedVmTerminalPopup()} type="button">콘솔 분리</button>
              <button className="mini-btn terminal-support-btn" onClick={openLabSupportMessage} type="button">문의 남기기</button>
            </div>}
          {null}
          {null}
          {null}
        </div>

          {null}
        </section>
      );
  }











export default function GeneralResourceTerminal(props){return props.activeLab?.resourceType === "custom-lab" || props.terminalSession?.resourceType === "custom-lab" ? <ResourceTerminal {...props} selectedCourse={null} activeLabCourse={null} courses={[]}/> : null;}
