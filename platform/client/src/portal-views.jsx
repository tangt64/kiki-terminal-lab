import { useEffect, useRef, useState } from "react";
import { DEFAULT_COURSE_SURVEY_CONFIG } from "./portal-state.js";
import { AdminField } from "./admin-field.jsx";


import { sortVmNodes } from "./vm-node-order.js";






let qrCodeLibPromise = null;

function loadQrCodeLib() {
  if (!qrCodeLibPromise) {
    qrCodeLibPromise = import("qrcode").then((module) => module.default || module);
  }
  return qrCodeLibPromise;
}



export function useImeBufferedInput(value, onCommit) {
  const [draft, setDraft] = useState(String(value ?? ""));
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    if (!isComposing) {
      setDraft(String(value ?? ""));
    }
  }, [value, isComposing]);

  function handleChange(event) {
    const nextValue = event.target.value;
    const composing = Boolean(event.nativeEvent?.isComposing) || isComposing;
    setDraft(nextValue);
    if (!composing) {
      onCommit(nextValue);
    }
  }

  function handleCompositionStart() {
    setIsComposing(true);
  }

  function handleCompositionEnd(event) {
    const nextValue = event.currentTarget.value;
    setIsComposing(false);
    setDraft(nextValue);
    onCommit(nextValue);
  }

  return {
    value: draft,
    onChange: handleChange,
    onCompositionStart: handleCompositionStart,
    onCompositionEnd: handleCompositionEnd,
  };
}

export function generateRandomPublicSubdomainCandidate() {
  return `ai-${Math.random().toString(36).slice(2, 8)}`;
}







export function OtpQrPreview({ otpauthUrl, alt = "OTP QR" }) {
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!otpauthUrl) {
      setQrDataUrl("");
      return undefined;
    }
    loadQrCodeLib()
      .then((QRCodeLib) => QRCodeLib.toDataURL(otpauthUrl, {
        margin: 1,
        width: 220,
        color: { dark: "#0f172a", light: "#ffffff" },
      }))
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [otpauthUrl]);

  if (!qrDataUrl) return null;
  return <img alt={alt} className="otp-qr-image" src={qrDataUrl} />;
}

export const labStatus = (status) => ({
  pending: "승인 대기",
  approved: "시작 가능",
  provisioning: "생성 중",
  running: "실행 중",
  paused: "일시 중지",
  terminating: "종료 중",
  terminated: "종료됨",
  failed: "실패",
}[status] || status || "-");

export const accessEventLabel = (eventType) => ({
  login: "로그인",
  logout: "로그아웃",
  session_active: "활동",
}[String(eventType || "").trim()] || eventType || "-");

export const ACTIVE_LAB_STATUSES = ["pending", "approved", "provisioning", "running", "paused", "terminating"];



export function getCourseProgramType(course, platformStatus) {
  const fallback = Array.isArray(platformStatus?.courseProgramTypeOptions) && platformStatus.courseProgramTypeOptions.length
    ? String(platformStatus.courseProgramTypeOptions[0] || "").trim() || "일반"
    : "일반";
  const normalized = String(course?.programType || fallback).trim() || fallback;
  return isGovernmentProgramType(normalized) ? "정부지원금" : normalized;
}

export function getCourseProgramTypeDisplay(programType) {
  const normalized = String(programType || "").trim();
  if (isGovernmentProgramType(normalized)) return "정부지원금";
  return normalized || "일반";
}

export function isGovernmentProgramType(programType) {
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

export function isGovernmentCourse(course, platformStatus) {
  return isGovernmentProgramType(getCourseProgramType(course, platformStatus));
}





export function getCourseDisplayIcon(courseOrType, platformStatus = null) {
  const course = typeof courseOrType === "object" && courseOrType !== null ? courseOrType : { courseType: courseOrType };
  if (String(course.courseType || "standard") === "package") return "📦";
  if (String(course.courseType || "standard") === "online") return "🌐";
  if (isGovernmentCourse(course, platformStatus)) return "🏢";
  return "🎓";
}

export function getCourseTypeDisplayLabel(course, platformStatus = null) {
  const icon = getCourseDisplayIcon(course, platformStatus);
  if (String(course?.courseType || "standard") === "package") return `${icon} 과정·시험 패키지`;
  if (String(course?.courseType || "standard") === "online") return `${icon} 온라인 과정`;
  if (isGovernmentCourse(course, platformStatus)) return `${icon} 정부 과정`;
  return `${icon} 일반 교육 과정`;
}

export function getQnaStatus(post) {
  const status = String(post?.status || "").trim().toLowerCase();
  if (status === "solved" || post?.acceptedCommentId) return { label: "해결됨", tone: "is-success" };
  if (status === "closed") return { label: "종료", tone: "is-muted" };
  const hasAdminAnswer = Boolean(String(post?.answerText || "").trim());
  const hasComments = Boolean((post?.comments || []).length);
  if (hasAdminAnswer) return { label: "답변완료", tone: "is-success" };
  if (status === "in_progress" || hasComments) return { label: "답변중", tone: "is-warn" };
  return { label: "미답변", tone: "is-error" };
}

export function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function getCourseAccessExpiryStatus(course = {}) {
  const rawExpiresAt = String(course?.enrollmentExpiresAt ?? course?.expiresAt ?? "").trim();
  const defaultDays = Math.max(1, Number(course?.courseAccessDays || course?.courseAccessDefaultDays || 30) || 30);
  const warningDays = Math.max(1, Number(course?.courseAccessExpiringSoonDays || 7) || 7);
  if (!rawExpiresAt) {
    return {
      hasExpiry: false,
      expiresAt: null,
      daysRemaining: null,
      expired: false,
      expiringSoon: false,
      needsExtension: false,
      tone: "is-muted",
      label: "만료일 없음",
      summary: "만료일 없음",
      helper: `기존 수강권입니다. 새 수강권은 이 과정 설정 기준 ${defaultDays}일로 발급됩니다.`,
    };
  }
  const expiresAtMs = new Date(rawExpiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) {
    return {
      hasExpiry: true,
      expiresAt: rawExpiresAt,
      daysRemaining: null,
      expired: false,
      expiringSoon: true,
      needsExtension: true,
      tone: "is-warn",
      label: "확인필요",
      summary: "만료일 확인 필요",
      helper: "만료일 형식을 확인해 주세요.",
    };
  }
  const computedDaysRemaining = Math.ceil((expiresAtMs - Date.now()) / (24 * 60 * 60 * 1000));
  const providedDaysRemaining = course?.enrollmentDaysRemaining;
  const daysRemaining = providedDaysRemaining != null && providedDaysRemaining !== "" && Number.isFinite(Number(providedDaysRemaining))
    ? Number(providedDaysRemaining)
    : computedDaysRemaining;
  const markedExpired = course?.enrollmentExpired === true || String(course?.enrollmentExpired || "").toLowerCase() === "true" || Number(course?.enrollmentExpired) === 1;
  const markedExpiringSoon = course?.enrollmentExpiringSoon === true || String(course?.enrollmentExpiringSoon || "").toLowerCase() === "true" || Number(course?.enrollmentExpiringSoon) === 1;
  const expired = markedExpired || daysRemaining <= 0;
  const expiringSoon = !expired && (markedExpiringSoon || daysRemaining <= warningDays);
  const dateLabel = formatDateTime(rawExpiresAt);
  if (expired) {
    return {
      hasExpiry: true,
      expiresAt: rawExpiresAt,
      daysRemaining,
      expired: true,
      expiringSoon: false,
      needsExtension: true,
      tone: "is-error",
      label: "연장필요",
      summary: `만료됨 · ${dateLabel}`,
      helper: "관리자에게 수강 기간 연장을 요청해 주세요.",
    };
  }
  if (expiringSoon) {
    return {
      hasExpiry: true,
      expiresAt: rawExpiresAt,
      daysRemaining,
      expired: false,
      expiringSoon: true,
      needsExtension: true,
      tone: "is-warn",
      label: "연장필요",
      summary: `${Math.max(1, daysRemaining)}일 남음 · ${dateLabel} 만료`,
      helper: `만료 ${warningDays}일 전부터 연장 요청이 가능합니다.`,
    };
  }
  return {
    hasExpiry: true,
    expiresAt: rawExpiresAt,
    daysRemaining,
    expired: false,
    expiringSoon: false,
    needsExtension: false,
    tone: "is-success",
    label: `${Math.max(1, daysRemaining)}일 남음`,
    summary: `${dateLabel} 만료`,
    helper: `이 과정 수강권은 ${defaultDays}일 단위로 관리됩니다.`,
  };
}

export function safeStringifyJson(value) {
  try {
    return JSON.stringify(value ?? [], null, 2);
  } catch {
    return "[]";
  }
}







export function getNormalizedSshPublicHost(value) {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase();
  if (!normalized || normalized === "example.com") return "ssh.example.com";
  return raw;
}

export function isWindowsLabProfile(courseOrLab) {
  const text = [
    courseOrLab?.osType,
    courseOrLab?.guestOs,
    courseOrLab?.platform,
    courseOrLab?.consoleType,
    courseOrLab?.shellType,
    courseOrLab?.imageName,
    courseOrLab?.heatTemplateName,
    courseOrLab?.title,
    courseOrLab?.courseTitle,
    courseOrLab?.summary,
    courseOrLab?.category,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\bwindows\b|\bwinrm\b|\brdp\b|윈도우|윈도/.test(text);
}

function sanitizeSshHostLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function deriveLabSshHostBase(lab) {
  const rawBase = [
    lab?.publicSubdomain,
    lab?.requestedPublicSubdomain,
    lab?.stackName,
    lab?.courseTitle,
    lab?.userName || lab?.username,
    lab?.id != null ? `lab-${lab.id}` : "",
  ].find((value) => String(value || "").trim());
  return sanitizeSshHostLabel(rawBase || `lab-${lab?.id || "node"}`) || `lab-${lab?.id || "node"}`;
}

function deriveNodeSshHost(lab, node, index) {
  const explicitHost = String(node?.sshHost || node?.externalSshHost || node?.externalSshDomain || "").trim().toLowerCase();
  if (explicitHost) return explicitHost;
  const baseHost = deriveLabSshHostBase(lab);
  return `${baseHost}-node${index + 1}.${String(lab?.labBaseDomain || "apps.example.com").trim().toLowerCase()}`.toLowerCase();
}

export function normalizeSshCopyValue(value) {
  return String(value || "").replace(/(^|[@/:])terminal-lab\.kr(?=[:/\s]|$)/g, "$1ssh.example.com");
}

export function formatCourseDuration(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const compact = raw.replace(/\s+/g, "");
  const tokenRegex = /(\d+)(일|시간|시|분|day|days|hour|hours|hr|hrs|minute|minutes|min|mins)/gi;
  let totalMinutes = 0;
  let matched = false;
  for (const match of compact.matchAll(tokenRegex)) {
    const amount = Number(match[1] || 0);
    const unit = String(match[2] || "").toLowerCase();
    if (!amount) continue;
    matched = true;
    if (unit === "일" || unit === "day" || unit === "days") totalMinutes += amount * 24 * 60;
    else if (unit === "시간" || unit === "시" || unit === "hour" || unit === "hours" || unit === "hr" || unit === "hrs") totalMinutes += amount * 60;
    else if (unit === "분" || unit === "minute" || unit === "minutes" || unit === "min" || unit === "mins") totalMinutes += amount;
  }
  if (!matched) return raw;
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}일`);
  if (hours > 0) parts.push(`${hours}시간`);
  if (minutes > 0) parts.push(`${minutes}분`);
  return parts.length ? parts.join(" ") : raw;
}

export function formatCoursePrice(value) {
  const amount = Math.max(0, Number(value || 0));
  return `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
}

export function isCoursePromotionActive(course, nowMs = Date.now()) {
  if (!course?.promoEnabled) return false;
  const startsAt = Date.parse(course.promoStartsAt || "");
  const endsAt = Date.parse(course.promoEndsAt || "");
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return false;
  return startsAt <= nowMs && nowMs < endsAt;
}

export function getCourseEffectivePrice(course) {
  const price = Math.max(0, Number(course?.price || 0));
  const promoPrice = Math.max(0, Number(course?.promoPrice || 0) || 0);
  return isCoursePromotionActive(course) ? Math.min(price, promoPrice) : price;
}

export function formatCoursePriceLabel(course) {
  const price = Math.max(0, Number(course?.price || 0));
  const effectivePrice = getCourseEffectivePrice(course);
  const promotionActive = isCoursePromotionActive(course);
  if (promotionActive && effectivePrice < price) {
    return `프로모션 ${formatCoursePrice(effectivePrice)} (정가 ${formatCoursePrice(price)})`;
  }
  if (promotionActive) {
    return `프로모션 ${formatCoursePrice(effectivePrice)}`;
  }
  return formatCoursePrice(price);
}



export function formatCurrency(value) {
  const amount = Math.max(0, Number(value || 0));
  return formatCoursePrice(amount);
}



export function describeCouponDiscount(coupon) {
  if (!coupon) return "-";
  const type = String(coupon.discountType || coupon.couponDiscountType || "").trim().toLowerCase();
  const value = Math.max(0, Number(coupon.discountValue ?? coupon.couponDiscountValue ?? 0) || 0);
  const base = type === "fixed" ? `${formatCoursePrice(value)} 할인` : type === "free" ? "전액 무료" : `${value}% 할인`;
  return coupon.metadata?.firstPurchaseOnly ? `${base} (첫 결제 전용)` : base;
}

export function formatTrafficBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const precision = size >= 100 || index === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[index]}`;
}

export function formatLabRetentionSummary(course) {
  if (!course?.labEnabled) return "랩 비활성화";
  const backendPrefix = String(course?.labBackendType || "vm") === "container" ? "컨테이너" : "VM";
  if (String(course.labRetentionMode || "ephemeral") !== "persistent") {
    return `${backendPrefix} / ${course.labApprovalMode === "instant" ? "즉시 시작" : "승인 후 시작"} / 임시 랩`;
  }
  const retentionDays = Math.max(1, Number(course.labRetentionDays || course.labRetentionPreset || 1) || 1);
  return `${backendPrefix} / 유지형 / ${retentionDays}일 / ${course.allowResumeExistingLab ? "재접속 허용" : "재접속 제한"}`;
}

function getContainerConsoleModeLabel(courseOrLab) {
  const mode = String(courseOrLab?.containerConsoleMode || "zun").trim().toLowerCase();
  return mode === "ssh" ? "SSH 터미널" : "Zun 터미널";
}

function normalizeBackendBoolean(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

export function getCourseBackendDetailLabel(courseOrLab) {
  const backend = String(courseOrLab?.labBackendType || "vm").trim().toLowerCase();
  if (isWindowsLabProfile(courseOrLab)) return "VM / Windows / RDP";
  if (backend !== "container") {
    const heatParameters = courseOrLab?.heatParameters && typeof courseOrLab.heatParameters === "object" ? courseOrLab.heatParameters : {};
    const bootFromVolume = [
      courseOrLab?.bootFromVolume,
      courseOrLab?.boot_from_volume,
      heatParameters.boot_from_volume,
      heatParameters.bootFromVolume,
    ].some((value) => normalizeBackendBoolean(value)
    );
    const volumeType = String(courseOrLab?.bootVolumeType || courseOrLab?.boot_volume_type || heatParameters.boot_volume_type || heatParameters.bootVolumeType || "").trim();
    return bootFromVolume ? `볼륨 디스크 VM${volumeType ? ` / ${volumeType}` : ""}` : "임시 디스크 VM";
  }
  const accessMode = String(courseOrLab?.containerAccessMode || "console").trim();
  const accessLabel = accessMode === "ssh"
    ? "SSH 중심"
    : accessMode === "ssh_console"
      ? "콘솔 + SSH"
      : "콘솔 전용";
  return `컨테이너 / ${getContainerConsoleModeLabel(courseOrLab)} / ${accessLabel}`;
}

export function getCourseBackendBadges(courseOrLab) {
  const backend = String(courseOrLab?.labBackendType || "vm").trim().toLowerCase();
  if (isWindowsLabProfile(courseOrLab)) {
    return [
      { label: "VM", tone: "is-muted" },
      { label: "Windows", tone: "is-console-ssh" },
      { label: "RDP 외부접근", tone: "is-warn" },
    ];
  }
  if (backend !== "container") {
    return [
      { label: "VM", tone: "is-muted" },
      { label: "Heat", tone: "is-muted" },
      { label: "SSH 터미널", tone: "is-muted" },
    ];
  }
  const accessMode = String(courseOrLab?.containerAccessMode || "console").trim();
  const consoleMode = String(courseOrLab?.containerConsoleMode || "zun").trim().toLowerCase();
  const requiresPublishedSsh = accessMode === "ssh" || accessMode === "ssh_console" || consoleMode === "ssh";
  return [
    { label: "컨테이너", tone: "is-success" },
    {
      label: requiresPublishedSsh ? "SSH publish 필수" : "Zun 콘솔 전용",
      tone: requiresPublishedSsh ? "is-warn" : "is-console-zun",
    },
    {
      label: consoleMode === "ssh" ? "xterm = SSH" : "xterm = Zun attach",
      tone: consoleMode === "ssh" ? "is-console-ssh" : "is-console-zun",
    },
    {
      label: accessMode === "ssh" ? "외부 SSH 중심" : accessMode === "ssh_console" ? "외부 SSH 허용" : "외부 SSH 미사용",
      tone: accessMode === "console" ? "is-muted" : "is-console-ssh",
    },
  ];
}



export function isLabExamLocked(exam) {
  if (!exam?.latestAttempt) return false;
  const maxAttempts = Math.max(1, Number(exam?.maxAttempts || 1) || 1);
  const attemptCount = Math.max(1, Number(exam?.attemptCount || 1) || 1);
  return !exam?.allowRetake || attemptCount >= maxAttempts;
}

export const renderZunStatus = (status) => ({
  requested: "요청됨",
  provisioning: "생성 중",
  creating: "생성 중",
  running: "실행 중",
  stopped: "중지됨",
  stopping: "중지 중",
  deleted: "삭제됨",
  deleting: "삭제 중",
  failed: "실패",
}[status] || status || "-");

export const ipList = (items = []) =>
  items.length ? items.map((item) => `${item.address}${item.type ? ` (${item.type})` : ""}`).join(", ") : "-";

export function deriveLabIpSummary(lab) {
  const vmNodes = deriveVmNodes(lab);
  if (vmNodes.length) {
    const items = [];
    const seen = new Set();
    for (const node of vmNodes) {
      const fixedIp = String(node.fixedIp || "").trim();
      const floatingIp = String(node.floatingIp || "").trim();
      if (fixedIp) {
        const key = `fixed:${fixedIp}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push({ type: "fixed", address: fixedIp });
        }
      }
      if (floatingIp) {
        const key = `floating:${floatingIp}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push({ type: "floating", address: floatingIp });
        }
      }
    }
    return {
      instanceIp: items.find((item) => item.type === "floating")?.address || items.find((item) => item.type === "fixed")?.address || "",
      instanceIps: items,
    };
  }
  return {
    instanceIp: String(lab?.instanceIp || "").trim(),
    instanceIps: Array.isArray(lab?.instanceIps) ? lab.instanceIps : [],
  };
}

export function deriveSelectedNodeIpSummary(lab, selectedNode = null) {
  if (selectedNode) {
    const items = [];
    if (selectedNode.fixedIp) items.push({ type: "fixed", address: selectedNode.fixedIp });
    if (selectedNode.floatingIp) items.push({ type: "floating", address: selectedNode.floatingIp });
    return {
      instanceIp: selectedNode.floatingIp || selectedNode.fixedIp || "",
      instanceIps: items,
    };
  }
  return deriveLabIpSummary(lab);
}



export const formatRemainingTime = (expiresAt) => {
  if (!expiresAt) return "-";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(diff)) return "-";
  if (diff <= 0) return "만료됨";
  const totalMinutes = Math.ceil(diff / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}시간 ${minutes}분 남음`;
  if (hours > 0) return `${hours}시간 남음`;
  return `${Math.max(1, totalMinutes)}분 남음`;
};

export const getLabTimeWarning = (expiresAt, thresholdMinutes = 15) => {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const thresholdMs = Math.max(1, Number(thresholdMinutes || 15) || 15) * 60000;
  if (diff > thresholdMs) return null;
  const remainingText = formatRemainingTime(expiresAt);
  return {
    remainingText,
    message: `남은 랩 시간은 ${remainingText}입니다. 필요한 작업을 저장하고, 더 필요하면 연장해 주세요.`,
  };
};

const QUOTA_LABELS = {
  instances: "인스턴스",
  cores: "vCPU",
  ram: "RAM",
};


















export function getCourseExamInfo(courseId, writtenExams = [], labExams = []) {
  const hasWrittenExam = writtenExams.some((item) => Number(item.courseId) === Number(courseId));
  const hasLabExam = labExams.some((item) => Number(item.courseId) === Number(courseId));
  return {
    hasWrittenExam,
    hasLabExam,
    hasAnyExam: hasWrittenExam || hasLabExam,
  };
}



function getFlavorBadges(flavor) {
  const normalized = String(flavor || "").trim().toLowerCase();
  if (!normalized) return [];
  const badges = [];
  if (normalized.includes("vgpu")) badges.push({ key: "vgpu", label: "vGPU" });
  else if (/(^|[-_.])(gpu|a100|l40|rtx|tesla|cuda)([-_.]|$)/.test(normalized)) badges.push({ key: "gpu", label: "GPU" });
  if (normalized.includes("highperf") || normalized.includes("hpc") || /(^|[-_.])(\d*xlarge|xlarge|2xlarge|4xlarge|8xlarge)([-_.]|$)/.test(normalized) || badges.length) {
    badges.push({ key: "highperf", label: "고성능" });
  }
  return badges.filter((badge, index, array) => array.findIndex((item) => item.key === badge.key) === index);
}

export function FlavorBadges({ flavor }) {
  const badges = getFlavorBadges(flavor);
  if (!badges.length) return null;
  return (
    <span className="flavor-badge-list">
      {badges.map((badge) => (
        <span className={`flavor-badge is-${badge.key}`} key={badge.key}>{badge.label}</span>
      ))}
    </span>
  );
}

function renderQuotaValue(metric) {
  if (!metric) return "-";
  const unit = metric.unit ? ` ${metric.unit}` : "";
  return `${metric.used} / ${metric.limit}${unit}`;
}

function renderTrafficLimitValue(bytes, limitGb) {
  const limit = Math.max(0, Number(limitGb || 0) || 0);
  return `${formatTrafficBytes(bytes)} / ${limit > 0 ? `${limit} GB` : "무제한"}`;
}

function buildTrafficMetrics(course, lab) {
  if (!course?.trafficMonitoringEnabled) {
    return null;
  }
  const dailyLimitBytes = Math.max(0, Number(course.trafficDailyLimitGb || 0) || 0) * 1024 * 1024 * 1024;
  const totalLimitBytes = Math.max(0, Number(course.trafficTotalLimitGb || 0) || 0) * 1024 * 1024 * 1024;
  const dailyBytes = Math.max(0, Number(lab?.trafficDailyBytes || 0) || 0);
  const totalBytes = Math.max(0, Number(lab?.trafficTotalBytes || 0) || 0);
  return {
    daily: {
      label: "오늘 트래픽",
      bytes: dailyBytes,
      limitGb: Math.max(0, Number(course.trafficDailyLimitGb || 0) || 0),
      percent: dailyLimitBytes > 0 ? Math.min(100, Math.round((dailyBytes / dailyLimitBytes) * 100)) : 0,
    },
    total: {
      label: "총 트래픽",
      bytes: totalBytes,
      limitGb: Math.max(0, Number(course.trafficTotalLimitGb || 0) || 0),
      percent: totalLimitBytes > 0 ? Math.min(100, Math.round((totalBytes / totalLimitBytes) * 100)) : 0,
    },
  };
}

export function TrafficUsageBlock({ course, lab, compact = false }) {
  const metrics = buildTrafficMetrics(course, lab);
  if (!metrics) return null;
  const items = [metrics.daily, metrics.total];

  return (
    <div className={`quota-panel ${compact ? "is-compact" : ""}`}>
      <div className="quota-head">
        <strong>트래픽 사용량</strong>
        <span>{lab?.trafficExceeded ? "한도 초과" : "정상"}</span>
      </div>
      <div className="quota-list">
        {items.map((metric) => (
          <div className="quota-item" key={metric.label}>
            <div className="quota-item-head">
              <span>{metric.label}</span>
              <strong>{metric.limitGb > 0 ? `${metric.percent}%` : "-"}</strong>
            </div>
            <div className="quota-meter">
              <div className={`quota-meter-fill ${metric.percent >= 85 ? "is-danger" : metric.percent >= 60 ? "is-warn" : "is-safe"}`} style={{ width: `${metric.limitGb > 0 ? metric.percent : 0}%` }} />
            </div>
            <div className="quota-item-meta">
              <span>{renderTrafficLimitValue(metric.bytes, metric.limitGb)}</span>
              <span>{course?.trafficExceededAction === "terminate" ? "초과 시 종료" : course?.trafficExceededAction === "pause" ? "초과 시 일시 중지" : "초과 시 경고"}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="hint">{`마지막 집계: ${lab?.trafficCheckedAt || "수집 대기"}`}</div>
    </div>
  );
}

export function VmUsageBlock({ course, lab, compact = false }) {
  if (!course?.labEnabled || !lab) return null;
  return (
    <div className={`quota-panel ${compact ? "is-compact" : ""}`}>
      <div className="quota-head">
        <strong>내 VM 사용량</strong>
        <span>{lab?.vmMetricsCheckedAt || "수집 대기"}</span>
      </div>
      <div className="quota-list">
        <div className="quota-item">
          <div className="quota-item-head">
            <span>vCPU 사용률</span>
            <strong>{`${Math.max(0, Number(lab?.cpuUsagePercent || 0))}%`}</strong>
          </div>
          <div className="quota-meter">
            <div className={`quota-meter-fill ${Number(lab?.cpuUsagePercent || 0) >= 85 ? "is-danger" : Number(lab?.cpuUsagePercent || 0) >= 60 ? "is-warn" : "is-safe"}`} style={{ width: `${Math.max(0, Math.min(100, Number(lab?.cpuUsagePercent || 0) || 0))}%` }} />
          </div>
          <div className="quota-item-meta">
            <span>{course?.heatParameters?.flavor || "실습 VM"}</span>
            <span>실제 사용률</span>
          </div>
        </div>
        <div className="quota-item">
          <div className="quota-item-head">
            <span>vMem 사용률</span>
            <strong>{`${Math.max(0, Number(lab?.memoryUsagePercent || 0))}%`}</strong>
          </div>
          <div className="quota-meter">
            <div className={`quota-meter-fill ${Number(lab?.memoryUsagePercent || 0) >= 85 ? "is-danger" : Number(lab?.memoryUsagePercent || 0) >= 60 ? "is-warn" : "is-safe"}`} style={{ width: `${Math.max(0, Math.min(100, Number(lab?.memoryUsagePercent || 0) || 0))}%` }} />
          </div>
          <div className="quota-item-meta">
            <span>{lab?.vmMetricsCheckedAt ? "메모리 사용률 집계" : "수집 대기"}</span>
            <span>실제 사용률</span>
          </div>
        </div>
        <div className="quota-item">
          <div className="quota-item-head">
            <span>vDisk I/O</span>
            <strong>{formatTrafficBytes((Number(lab?.diskReadBytes || 0) || 0) + (Number(lab?.diskWriteBytes || 0) || 0))}</strong>
          </div>
          <div className="quota-item-meta">
            <span>{`읽기 ${formatTrafficBytes(lab?.diskReadBytes)}`}</span>
            <span>{`쓰기 ${formatTrafficBytes(lab?.diskWriteBytes)}`}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function QuotaSummaryBlock({ quotaStatus, compact = false }) {
  if (!quotaStatus?.metrics) {
    return <div className={`quota-panel ${compact ? "is-compact" : ""}`}><div className="hint">{quotaStatus?.message || "Quota 정보를 불러오지 못했습니다."}</div></div>;
  }

  return (
    <div className={`quota-panel ${compact ? "is-compact" : ""}`}>
      <div className="quota-head">
        <strong>프로젝트 사용률</strong>
        <span>{quotaStatus.projectName || "-"}</span>
      </div>
      <div className="quota-list">
        {Object.entries(quotaStatus.metrics).map(([key, metric]) => (
          <div className="quota-item" key={key}>
            <div className="quota-item-head">
              <span>{QUOTA_LABELS[key] || key}</span>
              <strong>{metric.percent}%</strong>
            </div>
            <div className="quota-meter">
              <div className="quota-meter-fill" style={{ width: `${metric.percent}%` }} />
            </div>
            <div className="quota-item-meta">
              <span>{renderQuotaValue(metric)}</span>
              <span>{metric.remaining != null ? `남음 ${metric.remaining}${metric.unit ? ` ${metric.unit}` : ""}` : "무제한"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}



export function isValidExternalPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

const VM_TAB_COLORS = [
  { accent: "#2563eb", bg: "#eff6ff", activeBg: "#dbeafe", text: "#1e3a8a" },
  { accent: "#059669", bg: "#ecfdf5", activeBg: "#d1fae5", text: "#065f46" },
  { accent: "#d97706", bg: "#fffbeb", activeBg: "#fef3c7", text: "#92400e" },
  { accent: "#7c3aed", bg: "#f5f3ff", activeBg: "#ede9fe", text: "#5b21b6" },
  { accent: "#0891b2", bg: "#ecfeff", activeBg: "#cffafe", text: "#155e75" },
  { accent: "#e11d48", bg: "#fff1f2", activeBg: "#ffe4e6", text: "#9f1239" },
];
const VM_TAB_ICONS = ["💻", "🖥️", "🧪", "🧭", "🧱", "🛰️", "⚙️", "🔐"];

function pickVmTabIcon(node, index) {
  const identity = `${node?.id || ""}|${node?.name || ""}|${node?.fixedIp || ""}|${node?.floatingIp || ""}|${index}`;
  let hash = 0;
  for (let position = 0; position < identity.length; position += 1) {
    hash = ((hash << 5) - hash + identity.charCodeAt(position)) | 0;
  }
  return VM_TAB_ICONS[Math.abs(hash) % VM_TAB_ICONS.length];
}

function normalizeVmNodeIdentity(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function hasVmNodeAddress(node) {
  return Boolean(String(node?.fixedIp || "").trim() || String(node?.floatingIp || "").trim());
}

function isAuxiliaryNetworkVmNode(node) {
  const id = normalizeVmNodeIdentity(node?.id);
  const name = normalizeVmNodeIdentity(node?.name);
  const serverId = String(node?.serverId || node?.server_id || node?.instanceUuid || node?.instance_uuid || "").trim();
  const fixedIp = String(node?.fixedIp || node?.fixed_ip || node?.ip || "").trim();
  const identity = [id, name].filter(Boolean).join(" ");
  if (!identity || serverId) return false;
  const compactIdentity = identity.replace(/\s+/g, "-");
  // The Kubernetes lab stores a second NIC as nodeN_kubernetes_internal.
  // It is an address of the primary node, not a console-capable VM.
  if (/(^|[-_])(?:kubernetes|k8s)[-_]internal(?:[-_]|$)/.test(compactIdentity)) {
    return true;
  }
  if (/(^|[-_])(helper|bootstrap|control-?\d*|compute-?\d*|infra-?\d*|reserved-?lb)[-_](tunnel|internal|storage)(?:[-_]|$)/.test(compactIdentity)) {
    return true;
  }
  if (/(^|[-_])(tunnel|internal|storage)[-_]port(?:[-_]|$)/.test(compactIdentity)) {
    return true;
  }
  return /[_-](dev|devnet)(?:\s|$)/.test(identity)
    && (!fixedIp || fixedIp.startsWith("192.168.10."));
}

function mergeVmNode(target, source) {
  const targetHasAddress = hasVmNodeAddress(target);
  const sourceHasAddress = hasVmNodeAddress(source);
  return {
    ...target,
    id: sourceHasAddress && !targetHasAddress ? source.id : target.id || source.id,
    serverId: target.serverId || source.serverId,
    name: target.name || source.name,
    role: target.role || source.role,
    status: target.status || source.status,
    planned: target.planned === true ? target.planned : source.planned,
    accessMode: target.accessMode || source.accessMode,
    consoleAccess: target.consoleAccess || source.consoleAccess,
    macAddress: target.macAddress || source.macAddress,
    networkInterfaces: target.networkInterfaces?.length ? target.networkInterfaces : source.networkInterfaces,
    fixedIp: target.fixedIp || source.fixedIp,
    floatingIp: target.floatingIp || source.floatingIp,
    tunnelIp: target.tunnelIp || source.tunnelIp,
    internalIp: target.internalIp || source.internalIp,
    storageIp: target.storageIp || source.storageIp,
    externalSshPort: target.externalSshPort || source.externalSshPort,
    externalRdpPort: target.externalRdpPort || source.externalRdpPort,
    sshHost: target.sshHost || source.sshHost,
  };
}

function dedupeVmNodes(nodes) {
  const merged = [];
  const indexes = new Map();

  const remember = (node, index) => {
    [
      node.id ? `id:${normalizeVmNodeIdentity(node.id)}` : "",
      node.name ? `name:${normalizeVmNodeIdentity(node.name)}` : "",
      node.fixedIp ? `fixed:${normalizeVmNodeIdentity(node.fixedIp)}` : "",
      node.floatingIp ? `floating:${normalizeVmNodeIdentity(node.floatingIp)}` : "",
    ].filter(Boolean).forEach((key) => indexes.set(key, index));
  };

  nodes.forEach((node) => {
    const candidates = [
      node.fixedIp ? `fixed:${normalizeVmNodeIdentity(node.fixedIp)}` : "",
      node.floatingIp ? `floating:${normalizeVmNodeIdentity(node.floatingIp)}` : "",
      node.name ? `name:${normalizeVmNodeIdentity(node.name)}` : "",
      node.id ? `id:${normalizeVmNodeIdentity(node.id)}` : "",
    ].filter(Boolean);
    const existingIndex = candidates.map((key) => indexes.get(key)).find((index) => index != null);
    if (existingIndex == null) {
      const nextIndex = merged.length;
      merged.push(node);
      remember(node, nextIndex);
      return;
    }
    merged[existingIndex] = mergeVmNode(merged[existingIndex], node);
    remember(merged[existingIndex], existingIndex);
  });

  return merged.map((node, index) => ({
    ...node,
    colorIndex: index % VM_TAB_COLORS.length,
  }));
}

export function deriveVmNodes(lab) {
  const explicit = Array.isArray(lab?.vmNodes) ? lab.vmNodes.filter((node) => node && !isAuxiliaryNetworkVmNode(node)) : [];
  if (explicit.length) {
    return dedupeVmNodes(sortVmNodes(explicit).map((node, index) => ({
      id: node.id || `node-${index + 1}`,
      serverId: node.serverId || node.server_id || node.instanceUuid || node.instance_uuid || "",
      name: node.name || `노드 ${index + 1}`,
      role: node.role || "lab",
      status: node.status || lab?.status || "running",
      planned: node.planned === true || String(node.planned || "").trim().toLowerCase() === "true",
      accessMode: String(node.accessMode || node.access_mode || "").trim(),
      consoleAccess: String(node.consoleAccess || node.console_access || "").trim(),
      macAddress: String(node.macAddress || node.mac_address || node.mac || "").trim(),
      networkInterfaces: (Array.isArray(node.networkInterfaces) ? node.networkInterfaces : Array.isArray(node.network_interfaces) ? node.network_interfaces : [])
        .map((entry) => ({
          portId: String(entry?.portId || entry?.port_id || "").trim(),
          portName: String(entry?.portName || entry?.port_name || entry?.name || "").trim(),
          networkId: String(entry?.networkId || entry?.network_id || "").trim(),
          fixedIp: String(entry?.fixedIp || entry?.fixed_ip || entry?.ipAddress || entry?.ip_address || "").trim(),
          macAddress: String(entry?.macAddress || entry?.mac_address || entry?.mac || "").trim(),
        }))
        .filter((entry) => entry.portId || entry.fixedIp || entry.macAddress),
      fixedIp: node.fixedIp || "",
      floatingIp: node.floatingIp || "",
      externalSshPort: isValidExternalPort(node.externalSshPort) ? Number(node.externalSshPort) : null,
      externalRdpPort: isValidExternalPort(node.externalRdpPort) ? Number(node.externalRdpPort) : null,
      sshHost: deriveNodeSshHost(lab, node, index),
    })));
  }

  const ips = Array.isArray(lab?.instanceIps) ? lab.instanceIps : [];
  if (ips.length) {
    return dedupeVmNodes([{
      id: "node-1",
      serverId: lab?.instanceUuid || lab?.instance_uuid || "",
      name: lab?.stackName || lab?.courseTitle || "실습 노드",
      role: "lab",
      status: lab?.status || "running",
      macAddress: String(lab?.macAddress || lab?.mac_address || "").trim(),
      fixedIp: ips.find((item) => item.type === "fixed")?.address || lab?.instanceIp || "",
      floatingIp: ips.find((item) => item.type === "floating")?.address || "",
      externalSshPort: isValidExternalPort(lab?.externalSshPort) ? Number(lab.externalSshPort) : null,
      externalRdpPort: isValidExternalPort(lab?.externalRdpPort) ? Number(lab.externalRdpPort) : null,
      sshHost: deriveNodeSshHost(lab, {}, 0),
    }]);
  }

  if (lab?.instanceIp) {
    return dedupeVmNodes([{
      id: "node-1",
      serverId: lab?.instanceUuid || lab?.instance_uuid || "",
      name: lab?.stackName || lab?.courseTitle || "실습 노드",
      role: "lab",
      status: lab?.status || "running",
      macAddress: String(lab?.macAddress || lab?.mac_address || "").trim(),
      fixedIp: lab.instanceIp,
      floatingIp: "",
      externalSshPort: isValidExternalPort(lab?.externalSshPort) ? Number(lab.externalSshPort) : null,
      externalRdpPort: isValidExternalPort(lab?.externalRdpPort) ? Number(lab.externalRdpPort) : null,
      sshHost: deriveNodeSshHost(lab, {}, 0),
    }]);
  }

  return [];
}

export function VmDiagram({ activeLab, terminalTargetLabel, selectedNodeId = "", onSelectNode }) {
  const nodes = deriveVmNodes(activeLab);

  if (!activeLab) {
    return null;
  }

  return (
    <div className="vm-diagram">
      <div className="vm-diagram-head">
        <div>
          <p className="card-label">가상머신 구성</p>
          <h4>현재 랩 인스턴스</h4>
        </div>
        <span className="vm-diagram-count">{`${nodes.length || 0}대`}</span>
      </div>
      <div className="vm-diagram-grid">
        {nodes.length ? nodes.map((node, index) => {
          const isTarget = terminalTargetLabel && (terminalTargetLabel.includes(node.fixedIp) || terminalTargetLabel.includes(node.name));
          const isSelected = String(selectedNodeId || "") === String(node.id || "");
          return (
            <button className={`vm-node-card ${isTarget ? "is-target" : ""} ${isSelected ? "is-selected" : ""}`} key={node.id || index} onClick={() => onSelectNode?.(node)} type="button">
              <div className="vm-node-hero">
                <div className="vm-node-icon" aria-hidden="true">
                  <svg fill="none" viewBox="0 0 64 64">
                    <rect x="10" y="10" width="44" height="30" rx="6"></rect>
                    <path d="M22 50h20"></path>
                    <path d="M28 40v10"></path>
                    <path d="M36 40v10"></path>
                    <circle cx="20" cy="25" r="2.5"></circle>
                    <circle cx="28" cy="25" r="2.5"></circle>
                    <circle cx="36" cy="25" r="2.5"></circle>
                  </svg>
                </div>
                <div className="vm-node-headline">
                  <span className="vm-node-index">{`VM ${index + 1}`}</span>
                  <div className="vm-node-title-row">
                    <strong>{node.name || `노드 ${index + 1}`}</strong>
                    <span className="vm-node-badge">{labStatus(node.status || activeLab.status)}</span>
                  </div>
                  <dl className="vm-node-network-summary" aria-label={`${node.name || `노드 ${index + 1}`} 네트워크 정보`}>
                    {node.networkInterfaces?.length ? node.networkInterfaces.map((networkInterface, interfaceIndex) => (
                      <div key={networkInterface.portId || `${networkInterface.macAddress}-${interfaceIndex}`}>
                        <dt>{networkInterface.portName || `NIC ${interfaceIndex + 1}`}</dt>
                        <dd>{[networkInterface.fixedIp, networkInterface.macAddress].filter(Boolean).join(" · ") || "-"}</dd>
                      </div>
                    )) : (
                      <>
                        <div>
                          <dt>IP</dt>
                          <dd>{node.fixedIp || node.floatingIp || "-"}</dd>
                        </div>
                        <div>
                          <dt>MAC</dt>
                          <dd>{node.macAddress || "-"}</dd>
                        </div>
                      </>
                    )}
                  </dl>
                </div>
              </div>
            </button>
          );
        }) : (
          <div className="vm-node-empty">아직 인스턴스 정보가 준비되지 않았습니다.</div>
        )}
      </div>
    </div>
  );
}



export function StatusMessage({ tone, message }) {
  if (!message) return null;
  return <div className={`status ${tone ? `is-${tone}` : ""}`}>{message}</div>;
}

export function getLabBackendLabel(course, lab) {
  const backend = String(course?.labBackendType || lab?.labBackendType || "vm").trim().toLowerCase();
  if (backend === "container") return "컨테이너";
  return "VM";
}

export function getLabRuntimeNetworkName(course) {
  const explicitNetwork = String(course?.heatParameters?.network || "").trim();
  return explicitNetwork || "기본 네트워크";
}

export function PanelStatusMessage(props) {
  if (!props?.message) return null;
  return (
    <section className="simple-panel status-panel">
      <StatusMessage {...props} />
    </section>
  );
}



export function resolveCourseLabResizePolicy(course) {
  const policy = String(course?.labResizePolicy || "").trim().toLowerCase();
  if (policy === "disabled" || policy === "admin_only" || policy === "requestable") return policy;
  return course?.labEnabled ? "requestable" : "disabled";
}

export function resolveCourseLabResizeAllowedFlavors(course, platformStatus) {
  const courseFlavors = Array.isArray(course?.labResizeAllowedFlavors)
    ? course.labResizeAllowedFlavors.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (courseFlavors.length) return courseFlavors;
  return Array.isArray(platformStatus?.selfServiceVmAllowedFlavors) ? platformStatus.selfServiceVmAllowedFlavors : [];
}

export function describeCourseLabResizePolicy(course, platformStatus) {
  const policy = resolveCourseLabResizePolicy(course);
  const allowedFlavors = resolveCourseLabResizeAllowedFlavors(course, platformStatus);
  if (policy === "disabled") return "사양 변경 불가";
  if (policy === "admin_only") return `관리자만 변경 가능${allowedFlavors.length ? ` / ${allowedFlavors.join(", ")}` : ""}`;
  return `사용자 요청 가능${allowedFlavors.length ? ` / ${allowedFlavors.join(", ")}` : ""}`;
}



export function VmTabs({ nodes = [], activeNodeId = "", onSelect, showNodeIp = false, disabled = false }) {
  if (!nodes.length) return null;
  return (
    <div aria-busy={disabled ? "true" : undefined} className={`tabs vm-tabs${disabled ? " is-disabled" : ""}`}>
      {nodes.map((node, index) => {
        const nodeName = node.name || `VM ${index + 1}`;
        const nodeIp = node.fixedIp || node.floatingIp || "";
        const nodeLabel = showNodeIp && nodeIp ? `${nodeName} / ${nodeIp}` : nodeName;
        const color = VM_TAB_COLORS[(node.colorIndex ?? index) % VM_TAB_COLORS.length];
        const icon = pickVmTabIcon(node, index);
        return (
          <button
            className={`tab ${String(activeNodeId || "") === String(node.id || "") ? "is-active" : ""}`}
            disabled={disabled}
            key={node.id || index}
            onClick={() => onSelect?.(node)}
            style={{
              "--vm-tab-accent": color.accent,
              "--vm-tab-bg": color.bg,
              "--vm-tab-active-bg": color.activeBg,
              "--vm-tab-text": color.text,
            }}
            title={nodeLabel}
            type="button"
          >
            <span className="vm-tab-label">
              <span className="vm-tab-icon" aria-hidden="true">{icon}</span>
              <span className="vm-tab-text">{nodeLabel}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ToastStack({ toasts = [], onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          className={`toast-item ${toast.tone ? `is-${toast.tone}` : ""}`}
          onClick={() => onDismiss?.(toast.id)}
          type="button"
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}



export function AdminSaveDialog({ dialog, onClose }) {
  if (!dialog?.open) return null;
  return (
    <div className="inline-notice-backdrop" role="presentation">
      <div className="inline-notice-card course-submit-notice" role="dialog" aria-modal="true" aria-label={dialog.title || "저장 결과"}>
        <strong>{dialog.title || "저장 결과"}</strong>
        <p>{dialog.message}</p>
        <div className="admin-inline-actions">
          <button className={`mini-btn ${dialog.tone === "error" ? "danger-mini-btn" : "primary-mini-btn"}`} onClick={onClose} type="button">확인</button>
        </div>
      </div>
    </div>
  );
}

export { AdminField };

export function AdminSecretInput({ value, onChange, placeholder = "", visible = false, onToggleVisibility }) {
  return (
    <div className="inline-form-field">
      <input type={visible ? "text" : "password"} value={value} onChange={onChange} placeholder={placeholder} />
      <button className="mini-btn" onClick={onToggleVisibility} type="button">
        {visible ? "숨기기" : "보기"}
      </button>
    </div>
  );
}

export function applyTossTestDefaults(setPlatformStatus) {
  setPlatformStatus((current) => ({
    ...current,
    paymentGatewayEnabled: true,
    paymentGatewayProvider: "tosspayments",
    paymentGatewayApiBaseUrl: "https://api.tosspayments.com",
  }));
}

export function AdminDisclosureCard({
  id = "",
  title,
  subtitle = "",
  summary = "",
  defaultOpen = false,
  actions = null,
  children,
}) {
  const detailsRef = useRef(null);
  const [isOpen, setIsOpen] = useState(Boolean(defaultOpen));
  useEffect(() => {
    setIsOpen(Boolean(defaultOpen));
  }, [defaultOpen]);
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;
    const openFromHash = () => {
      let hashId = "";
      try {
        hashId = window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : "";
      } catch {
        hashId = window.location.hash ? window.location.hash.slice(1) : "";
      }
      if (!hashId) return;
      const target = document.getElementById(hashId);
      const shouldOpen = Boolean((id && hashId === id) || (target && detailsRef.current?.contains(target)));
      if (!shouldOpen) return;
      setIsOpen(true);
      window.setTimeout(() => {
        detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [id]);
  return (
    <details
      id={id || undefined}
      className="admin-disclosure-card accordion-scroll-target"
      open={isOpen}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setIsOpen(nextOpen);
        if (nextOpen) {
          window.setTimeout(() => {
            detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 60);
        }
      }}
      ref={detailsRef}
    >
      <summary className="admin-disclosure-summary">
        <div className="admin-disclosure-head">
          <strong>{title}</strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        <div className="admin-disclosure-meta">
          {summary ? <span className="hint">{summary}</span> : null}
          {actions ? <span onClick={(event) => event.stopPropagation()}>{actions}</span> : null}
        </div>
      </summary>
      <div className="admin-disclosure-content">{children}</div>
    </details>
  );
}

export function materialDownloadHref(href) {
  const prefix = "/materials/";
  if (!String(href || "").startsWith(prefix)) return href;
  const fileName = href.slice(prefix.length);
  return `/api/materials/download/${encodeURIComponent(fileName)}`;
}

export function materialPreviewHref(href) {
  const prefix = "/materials/";
  if (!String(href || "").startsWith(prefix)) return href;
  const fileName = href.slice(prefix.length);
  return `/api/materials/view/${encodeURIComponent(fileName)}`;
}

function appendPdfViewerHash(href) {
  const value = String(href || "").trim();
  if (!value) return value;
  const hashIndex = value.indexOf("#");
  const base = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const currentHash = hashIndex >= 0 ? value.slice(hashIndex + 1) : "";
  const currentParts = currentHash.split("&").map((part) => part.trim()).filter(Boolean);
  const existingKeys = new Set(currentParts.map((part) => part.split("=")[0].toLowerCase()));
  const viewerParts = [
    "toolbar=0",
    "navpanes=0",
    "pagemode=none",
    "scrollbar=1",
    "view=FitH",
    "zoom=page-width",
  ].filter((part) => !existingKeys.has(part.split("=")[0].toLowerCase()));
  return `${base}#${[...currentParts, ...viewerParts].join("&")}`;
}

export function materialEmbedHref(href, kind) {
  const previewHref = materialPreviewHref(href);
  return String(kind || "").toLowerCase() === "pdf" ? appendPdfViewerHash(previewHref) : previewHref;
}

export function getYoutubeEmbedUrl(input) {
  const value = String(input || "").trim();
  if (!value) return "";

  try {
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      const videoId = url.searchParams.get("v");
      if (videoId) return `https://www.youtube.com/embed/${videoId}`;

      const segments = url.pathname.split("/").filter(Boolean);
      if (segments[0] === "embed" && segments[1]) {
        return `https://www.youtube.com/embed/${segments[1]}`;
      }
      if ((segments[0] === "shorts" || segments[0] === "live") && segments[1]) {
        return `https://www.youtube.com/embed/${segments[1]}`;
      }
      return "";
    }
    if (host === "youtu.be") {
      const videoId = url.pathname.replace(/\//g, "");
      return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
    }
  } catch {
    return "";
  }

  return "";
}

export function getYoutubeLoopEmbedUrl(input) {
  const embedUrl = getYoutubeEmbedUrl(input);
  if (!embedUrl) return "";

  try {
    const parsed = new URL(embedUrl);
    const videoId = parsed.pathname.split("/").filter(Boolean).pop();
    if (!videoId) return embedUrl;
    parsed.searchParams.set("autoplay", "1");
    parsed.searchParams.set("mute", "1");
    parsed.searchParams.set("loop", "1");
    parsed.searchParams.set("controls", "0");
    parsed.searchParams.set("rel", "0");
    parsed.searchParams.set("playlist", videoId);
    parsed.searchParams.set("playsinline", "1");
    return parsed.toString();
  } catch {
    return embedUrl;
  }
}























export function truncateMiddleText(value, maxLength = 34) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(10, maxLength - 3))}...`;
}







































































































export function getCustomLabStatusLabel(status) {
  switch (status) {
    case "requested":
      return "구성 접수";
    case "quoted":
      return "결제 대기";
    case "confirmed":
      return "결제 완료";
    case "provisioning":
      return "자원 생성 중";
    case "running":
      return "실행 중";
    case "terminating":
      return "종료 중";
    case "terminated":
      return "종료됨";
    case "approved":
      return "승인";
    case "cancelled":
      return "사용자 취소";
    case "failed":
      return "생성 실패";
    default:
      return "반려";
  }
}

export function getCustomLabAdvancedConfigLines(config) {
  const advanced = config && typeof config === "object" ? config : {};
  if (advanced.standard?.flavor) {
    const usage = Number(advanced.standard.usageDays || 0) > 0 ? ` / ${advanced.standard.usageDays}일` : "";
    const dailyPrice = Number(advanced.standard.dailyPrice || 0) > 0 ? ` / 1일 ${formatCurrency(advanced.standard.dailyPrice)}` : "";
    return [
      `표준 구성: ${advanced.standard.flavor}${usage}${dailyPrice}`,
      ...getCustomLabAdvancedConfigLines({ ...advanced, standard: null }),
    ];
  }
  const volumes = advanced.volumes && typeof advanced.volumes === "object" ? advanced.volumes : {};
  const network = advanced.network && typeof advanced.network === "object" ? advanced.network : {};
  const publicIp = advanced.publicIp && typeof advanced.publicIp === "object" ? advanced.publicIp : {};
  const cloudInit = advanced.cloudInit && typeof advanced.cloudInit === "object" ? advanced.cloudInit : {};
  const keypair = advanced.keypair && typeof advanced.keypair === "object" ? advanced.keypair : {};
  const lines = [];
  if (cloudInit.mode === "custom") {
    lines.push(`cloud-init: 직접 입력${cloudInit.fileName ? ` / ${cloudInit.fileName}` : ""}`);
  }
  if (keypair.name) {
    lines.push(`SSH 키페어: ${keypair.name}${keypair.fingerprint ? ` / ${keypair.fingerprint}` : ""}`);
  }
  if (advanced.enabled && publicIp.enabled) {
    lines.push(`공인 IP: 사용 / 외부망 ${publicIp.externalNetworkName || network.externalNetworkName || "net-external"}`);
  }
  if (advanced.enabled && volumes.enabled && Number(volumes.count) > 0 && Number(volumes.sizeGb) > 0) {
    lines.push(`고급 볼륨: ${volumes.count}개 / ${volumes.sizeGb}GB${volumes.volumeType ? ` / ${volumes.volumeType}` : ""}`);
  }
  if (advanced.enabled && network.enabled && network.networkName && network.subnetCidr) {
    lines.push(`고급 네트워크: ${network.networkName} / ${network.subnetCidr}`);
    if (network.attachRouter) {
      lines.push(`고급 라우터 연결: 사용 / 외부망 ${network.externalNetworkName || "net-external"}`);
    }
  }
  if (advanced.enabled && advanced.loadBalancer?.enabled && Number(advanced.loadBalancer.listenerPort) > 0 && Number(advanced.loadBalancer.targetPort) > 0) {
    lines.push(`고급 로드밸런서: ${(advanced.loadBalancer.protocol || "TCP").toUpperCase()} ${advanced.loadBalancer.listenerPort} -> ${advanced.loadBalancer.targetPort}`);
  }
  if (advanced.enabled && advanced.database?.enabled && advanced.database.engine && advanced.database.version && advanced.database.flavorName) {
    lines.push(`고급 데이터베이스: ${advanced.database.engine} ${advanced.database.version} / ${advanced.database.sizeGb}GB / ${advanced.database.flavorName}`);
  }
  return lines;
}







export function cloneSurveyConfig(config) {
  return JSON.parse(JSON.stringify(config || DEFAULT_COURSE_SURVEY_CONFIG));
}

export function resolveCourseSurveyConfig(course) {
  const config = course?.surveyConfig;
  if (!config || typeof config !== "object") return cloneSurveyConfig(DEFAULT_COURSE_SURVEY_CONFIG);
  const defaultConfig = cloneSurveyConfig(DEFAULT_COURSE_SURVEY_CONFIG);
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





































export function AdminLuckyDrawTab(props) {
  const adminCoupons = Array.isArray(props.adminCoupons) ? props.adminCoupons : [];
  const [editingEventId, setEditingEventId] = useState(null);
  const [rewardEditorEventId, setRewardEditorEventId] = useState(null);
  const editingEventRef = useRef(null);
  const rewardEditorRef = useRef(null);
  const [couponStatusFilter, setCouponStatusFilter] = useState("all");
  const [couponSourceFilter, setCouponSourceFilter] = useState("all");
  const [couponEventFilter, setCouponEventFilter] = useState("all");
  const [couponSearch, setCouponSearch] = useState("");
  const couponSearchInput = useImeBufferedInput(couponSearch, setCouponSearch);
  const normalizedCouponSearch = String(couponSearch || "").trim().toLowerCase();
  const periodSummaries = [
    { key: "7d", label: "최근 7일", days: 7 },
    { key: "30d", label: "최근 30일", days: 30 },
  ].map((period) => {
    const windowStart = Date.now() - (period.days * 24 * 60 * 60 * 1000);
    const issued = adminCoupons.filter((coupon) => {
      const createdAt = new Date(coupon.createdAt || 0).getTime();
      return Number.isFinite(createdAt) && createdAt >= windowStart;
    });
    const redeemed = adminCoupons.filter((coupon) => {
      const usedAt = new Date(coupon.usedAt || 0).getTime();
      return Number.isFinite(usedAt) && usedAt >= windowStart;
    });
    const conversionRate = issued.length ? Math.round((redeemed.length / issued.length) * 100) : 0;
    return {
      ...period,
      issuedCount: issued.length,
      redeemedCount: redeemed.length,
      conversionRate,
    };
  });
  const campaignSummaries = Object.values(adminCoupons.reduce((accumulator, coupon) => {
    const campaignName = String(coupon.metadata?.campaignName || "").trim() || "기타 캠페인";
    const current = accumulator[campaignName] || { name: campaignName, total: 0, used: 0, active: 0, expired: 0 };
    const isExpired = coupon.expiresAt ? new Date(coupon.expiresAt).getTime() <= Date.now() : false;
    const status = String(coupon.status || "").toLowerCase();
    current.total += 1;
    if (status === "used") current.used += 1;
    else if (isExpired) current.expired += 1;
    else if (status === "active") current.active += 1;
    accumulator[campaignName] = current;
    return accumulator;
  }, {})).sort((left, right) => right.total - left.total).slice(0, 6);
  const campaignConversionRank = Object.values(adminCoupons.reduce((accumulator, coupon) => {
    const campaignName = String(coupon.metadata?.campaignName || "").trim() || "기타 캠페인";
    const current = accumulator[campaignName] || { name: campaignName, issued: 0, redeemed: 0 };
    current.issued += 1;
    if (String(coupon.status || "").toLowerCase() === "used") current.redeemed += 1;
    accumulator[campaignName] = current;
    return accumulator;
  }, {}))
    .map((item) => ({ ...item, conversionRate: item.issued ? Math.round((item.redeemed / item.issued) * 100) : 0 }))
    .sort((left, right) => right.conversionRate - left.conversionRate || right.redeemed - left.redeemed)
    .slice(0, 5);
  const courseUsageRank = Object.values(adminCoupons.reduce((accumulator, coupon) => {
    const courseName = String(coupon.courseTitle || "").trim() || "전체 과정";
    const current = accumulator[courseName] || { name: courseName, issued: 0, redeemed: 0 };
    current.issued += 1;
    if (String(coupon.status || "").toLowerCase() === "used") current.redeemed += 1;
    accumulator[courseName] = current;
    return accumulator;
  }, {}))
    .map((item) => ({ ...item, redemptionRate: item.issued ? Math.round((item.redeemed / item.issued) * 100) : 0 }))
    .sort((left, right) => right.redeemed - left.redeemed || right.redemptionRate - left.redemptionRate)
    .slice(0, 5);
  const filteredAdminCoupons = adminCoupons.filter((coupon) => {
    const isExpired = coupon.expiresAt ? new Date(coupon.expiresAt).getTime() <= Date.now() : false;
    const couponStatus = String(coupon.status || "").toLowerCase();
    const statusKey = couponStatus === "used" ? "used" : couponStatus === "inactive" ? "inactive" : isExpired ? "expired" : "active";
    if (couponStatusFilter !== "all" && statusKey !== couponStatusFilter) return false;
    if (couponSourceFilter !== "all" && String(coupon.source || "") !== couponSourceFilter) return false;
    if (couponEventFilter !== "all" && Number(coupon.metadata?.eventId || 0) !== Number(couponEventFilter)) return false;
    if (normalizedCouponSearch) {
      const haystack = [
        coupon.code,
        coupon.userName,
        coupon.username,
        coupon.courseTitle,
        coupon.source,
        coupon.metadata?.campaignName,
        coupon.metadata?.reason,
        coupon.metadata?.note,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(normalizedCouponSearch)) return false;
    }
    return true;
  });
  const dailyTrend = Array.from({ length: 14 }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (13 - index));
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    const issuedCount = adminCoupons.filter((coupon) => {
      const createdAt = new Date(coupon.createdAt || 0).getTime();
      return Number.isFinite(createdAt) && createdAt >= day.getTime() && createdAt < nextDay.getTime();
    }).length;
    const redeemedCount = adminCoupons.filter((coupon) => {
      const usedAt = new Date(coupon.usedAt || 0).getTime();
      return Number.isFinite(usedAt) && usedAt >= day.getTime() && usedAt < nextDay.getTime();
    }).length;
    return {
      key: day.toISOString(),
      label: `${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
      issuedCount,
      redeemedCount,
    };
  });
  const maxDailyTrendValue = Math.max(1, ...dailyTrend.flatMap((item) => [item.issuedCount, item.redeemedCount]));
  function downloadCouponCsv() {
    const rows = [
      ["코드", "상태", "회원명", "아이디", "과정", "혜택", "출처", "캠페인", "사유", "메모", "사용횟수", "최대횟수", "발급일", "만료일", "사용일"],
      ...filteredAdminCoupons.map((coupon) => {
        const isExpired = coupon.expiresAt ? new Date(coupon.expiresAt).getTime() <= Date.now() : false;
        const statusLabel = String(coupon.status || "").toLowerCase() === "used" ? "사용 완료" : isExpired ? "만료" : String(coupon.status || "").toLowerCase() === "inactive" ? "비활성" : "사용 가능";
        return [
          coupon.code || "",
          statusLabel,
          coupon.userName || "",
          coupon.username || "",
          coupon.courseTitle || "전체 과정",
          describeCouponDiscount(coupon),
          coupon.source || "",
          String(coupon.metadata?.campaignName || ""),
          String(coupon.metadata?.reason || ""),
          String(coupon.metadata?.note || ""),
          String(coupon.usedCount || 0),
          String(coupon.maxUses || 1),
          coupon.createdAt || "",
          coupon.expiresAt || "",
          coupon.usedAt || "",
        ];
      }),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `coupon-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }
  const isEditingEvent = editingEventId != null;
  useEffect(() => {
    if (editingEventId == null || !editingEventRef.current) return;
    editingEventRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    const firstInput = editingEventRef.current.querySelector("input, textarea, select");
    if (typeof firstInput?.focus === "function") {
      firstInput.focus({ preventScroll: true });
    }
  }, [editingEventId]);
  useEffect(() => {
    if (rewardEditorEventId == null || !rewardEditorRef.current) return;
    rewardEditorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    const firstInput = rewardEditorRef.current.querySelector("input, textarea, select");
    if (typeof firstInput?.focus === "function") {
      firstInput.focus({ preventScroll: true });
    }
  }, [rewardEditorEventId, props.luckyDrawRewardForm?.id]);
  return (
    <section className="portal-stack">
      {!isEditingEvent ? (
      <form className="simple-panel admin-form" onSubmit={props.onSaveLuckyDrawEvent}>
        <div className="portal-detail-head">
          <div>
            <p className="card-label">쿠폰 / 이벤트</p>
            <h3>새 이벤트 만들기</h3>
          </div>
        </div>
        <AdminField hint="사용자 화면에 노출되는 이벤트 이름입니다. 혜택 성격이 바로 보이게 짧게 적는 편이 좋습니다." label="이벤트 이름" required><input value={props.luckyDrawEventForm.title} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, title: event.target.value }))} placeholder="오늘의 무료 강의 뽑기" /></AdminField>
        <AdminField hint="이벤트 소개 문구입니다. 참여 횟수나 혜택 방향을 한 줄로 안내할 때 좋습니다." label="안내 문구"><textarea value={props.luckyDrawEventForm.description} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, description: event.target.value }))} placeholder="하루 세 번, 오늘의 무료 강의 기회에 도전하세요" /></AdminField>
        <div className="admin-grid two-col">
          <AdminField hint="이 시각부터 사용자가 참여할 수 있습니다." label="시작일시" required><input type="datetime-local" value={props.luckyDrawEventForm.startAt} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, startAt: event.target.value }))} /></AdminField>
          <AdminField hint="이 시각이 지나면 이벤트 참여가 자동으로 막힙니다." label="종료일시" required><input type="datetime-local" value={props.luckyDrawEventForm.endAt} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, endAt: event.target.value }))} /></AdminField>
        </div>
        <div className="admin-grid two-col">
          <AdminField hint="작성중은 비공개, 진행중은 노출/참여 가능, 일시중지는 잠시 중단, 종료는 마감 상태입니다." label="상태">
            <select value={props.luckyDrawEventForm.status} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, status: event.target.value }))}>
              <option value="draft">작성중</option>
              <option value="active">진행중</option>
              <option value="paused">일시중지</option>
              <option value="ended">종료</option>
            </select>
          </AdminField>
          <AdminField hint="회원 1명이 하루에 몇 번까지 뽑기 가능한지 정합니다. 보통 1~3회를 권장합니다." label="하루 참여 횟수"><input value={props.luckyDrawEventForm.dailyAttemptLimit} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, dailyAttemptLimit: event.target.value }))} /></AdminField>
        </div>
        <label className="toggle compact-toggle">
          <input checked={props.luckyDrawEventForm.requireVerifiedUser} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, requireVerifiedUser: event.target.checked }))} type="checkbox" />
          <span className="toggle-switch" aria-hidden="true">
            <span className="toggle-thumb" />
          </span>
          <span className="toggle-copy">
            <strong>{props.luckyDrawEventForm.requireVerifiedUser ? "ON" : "OFF"}</strong>
            <span>{props.luckyDrawEventForm.requireVerifiedUser ? "승인된 회원만 참여" : "전체 회원 참여 가능"}</span>
          </span>
        </label>
        <div className="admin-grid two-col">
          <label className="toggle compact-toggle">
            <input checked={props.luckyDrawEventForm.allowNewUsersOnly} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, allowNewUsersOnly: event.target.checked }))} type="checkbox" />
            <span className="toggle-switch" aria-hidden="true">
              <span className="toggle-thumb" />
            </span>
            <span className="toggle-copy">
              <strong>{props.luckyDrawEventForm.allowNewUsersOnly ? "ON" : "OFF"}</strong>
              <span>{props.luckyDrawEventForm.allowNewUsersOnly ? "신규 회원만" : "신규 여부 무관"}</span>
            </span>
          </label>
          <AdminField hint="가입 후 이 일수 안에 있는 회원만 신규 회원으로 간주합니다." label="신규 기준(일)">
            <input value={props.luckyDrawEventForm.newUserWindowDays} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, newUserWindowDays: event.target.value }))} />
          </AdminField>
        </div>
        <div className="admin-grid two-col">
          <label className="toggle compact-toggle">
            <input checked={props.luckyDrawEventForm.allowDormantUsersOnly} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, allowDormantUsersOnly: event.target.checked }))} type="checkbox" />
            <span className="toggle-switch" aria-hidden="true">
              <span className="toggle-thumb" />
            </span>
            <span className="toggle-copy">
              <strong>{props.luckyDrawEventForm.allowDormantUsersOnly ? "ON" : "OFF"}</strong>
              <span>{props.luckyDrawEventForm.allowDormantUsersOnly ? "휴면 복귀 회원만" : "휴면 여부 무관"}</span>
            </span>
          </label>
          <AdminField hint="최근 활동이 이 일수 이상 없던 회원만 휴면 복귀 대상으로 봅니다." label="휴면 기준(일)">
            <input value={props.luckyDrawEventForm.dormantDays} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, dormantDays: event.target.value }))} />
          </AdminField>
        </div>
        <button className="mini-btn primary-mini-btn" type="submit">{props.luckyDrawEventForm.id ? "이벤트 수정" : "이벤트 만들기"}</button>
      </form>
      ) : null}

      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">Events</p>
            <h3>이벤트 목록</h3>
          </div>
        </div>
        <div className="qna-board">
          {(props.adminLuckyDrawEvents || []).length ? props.adminLuckyDrawEvents.map((item) => (
            <article className="qna-thread" key={item.id}>
              <div className="qna-thread-head">
                <strong>{item.title}</strong>
                <span>{item.status}</span>
              </div>
              <div className="simple-status-list">
                <div>{`기간: ${formatDateTime(item.startAt)} ~ ${formatDateTime(item.endAt)}`}</div>
                <div>{`참여자: ${item.stats?.participantCount || 0}명 / 총 시도: ${item.stats?.attemptCount || 0}회 / 오늘 ${item.stats?.todayAttemptCount || 0}회`}</div>
                <div>{`의심 IP: ${item.stats?.suspiciousIpCount || 0}건`}</div>
                <div>{`보상 수: ${(item.rewards || []).length}개`}</div>
                <div>{`타게팅: ${[
                  item.requireVerifiedUser ? "승인 회원" : null,
                  item.allowNewUsersOnly ? `신규 ${item.newUserWindowDays || 30}일` : null,
                  item.allowDormantUsersOnly ? `휴면 ${item.dormantDays || 30}일` : null,
                ].filter(Boolean).join(" / ") || "전체 회원"}`}</div>
              </div>
              <div className="admin-inline-actions">
                <button className="mini-btn" onClick={() => {
                  props.onEditLuckyDrawEvent(item);
                  setEditingEventId(item.id);
                  setRewardEditorEventId(null);
                }} type="button">수정</button>
                <button className="mini-btn" onClick={() => {
                  props.onStartLuckyDrawRewardCreate(item);
                  setRewardEditorEventId(item.id);
                  setEditingEventId(null);
                }} type="button">보상 추가</button>
                <button className="mini-btn danger-mini-btn" onClick={async () => {
                  if (!window.confirm(`'${item.title}' 이벤트를 삭제할까요? 연결된 보상과 참여 기록도 함께 제거됩니다.`)) return;
                  await props.onDeleteLuckyDrawEvent(item.id);
                  setEditingEventId((current) => (Number(current) === Number(item.id) ? null : current));
                  setRewardEditorEventId((current) => (Number(current) === Number(item.id) ? null : current));
                }} type="button">삭제</button>
              </div>
              {editingEventId != null && Number(editingEventId) === Number(item.id) ? (
                <form className="simple-panel admin-form inline-luckydraw-editor" onSubmit={async (event) => {
                  const saved = await props.onSaveLuckyDrawEvent(event);
                  if (saved) setEditingEventId(null);
                }} ref={editingEventRef}>
                  <div className="portal-detail-head">
                    <div>
                      <p className="card-label">무료 강의 뽑기 이벤트</p>
                      <h3>{`이벤트 수정: ${item.title}`}</h3>
                    </div>
                    <div className="admin-inline-actions">
                      <button className="mini-btn" onClick={() => {
                        props.onCancelLuckyDrawEventEdit();
                        setEditingEventId(null);
                      }} type="button">취소</button>
                    </div>
                  </div>
                  <AdminField hint="사용자 화면에 노출되는 이벤트 이름입니다." label="이벤트 이름" required><input value={props.luckyDrawEventForm.title} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, title: event.target.value }))} placeholder="오늘의 무료 강의 뽑기" /></AdminField>
                  <AdminField hint="이벤트 소개 문구입니다." label="안내 문구"><textarea value={props.luckyDrawEventForm.description} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, description: event.target.value }))} placeholder="하루 세 번, 오늘의 무료 강의 기회에 도전하세요" /></AdminField>
                  <div className="admin-grid two-col">
                    <AdminField hint="이 시각부터 사용자가 참여할 수 있습니다." label="시작일시" required><input type="datetime-local" value={props.luckyDrawEventForm.startAt} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, startAt: event.target.value }))} /></AdminField>
                    <AdminField hint="이 시각이 지나면 이벤트 참여가 자동으로 막힙니다." label="종료일시" required><input type="datetime-local" value={props.luckyDrawEventForm.endAt} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, endAt: event.target.value }))} /></AdminField>
                  </div>
                  <div className="admin-grid two-col">
                    <AdminField hint="작성중은 비공개, 진행중은 노출/참여 가능, 일시중지는 잠시 중단, 종료는 마감 상태입니다." label="상태">
                      <select value={props.luckyDrawEventForm.status} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, status: event.target.value }))}>
                        <option value="draft">작성중</option>
                        <option value="active">진행중</option>
                        <option value="paused">일시중지</option>
                        <option value="ended">종료</option>
                      </select>
                    </AdminField>
                    <AdminField hint="회원 1명이 하루에 몇 번까지 뽑기 가능한지 정합니다." label="하루 참여 횟수"><input value={props.luckyDrawEventForm.dailyAttemptLimit} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, dailyAttemptLimit: event.target.value }))} /></AdminField>
                  </div>
                  <label className="toggle compact-toggle">
                    <input checked={props.luckyDrawEventForm.requireVerifiedUser} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, requireVerifiedUser: event.target.checked }))} type="checkbox" />
                    <span className="toggle-switch" aria-hidden="true">
                      <span className="toggle-thumb" />
                    </span>
                    <span className="toggle-copy">
                      <strong>{props.luckyDrawEventForm.requireVerifiedUser ? "ON" : "OFF"}</strong>
                      <span>{props.luckyDrawEventForm.requireVerifiedUser ? "승인된 회원만 참여" : "전체 회원 참여 가능"}</span>
                    </span>
                  </label>
                  <div className="admin-grid two-col">
                    <label className="toggle compact-toggle">
                      <input checked={props.luckyDrawEventForm.allowNewUsersOnly} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, allowNewUsersOnly: event.target.checked }))} type="checkbox" />
                      <span className="toggle-switch" aria-hidden="true">
                        <span className="toggle-thumb" />
                      </span>
                      <span className="toggle-copy">
                        <strong>{props.luckyDrawEventForm.allowNewUsersOnly ? "ON" : "OFF"}</strong>
                        <span>{props.luckyDrawEventForm.allowNewUsersOnly ? "신규 회원만" : "신규 여부 무관"}</span>
                      </span>
                    </label>
                    <AdminField hint="가입 후 이 일수 안에 있는 회원만 신규 회원으로 간주합니다." label="신규 기준(일)">
                      <input value={props.luckyDrawEventForm.newUserWindowDays} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, newUserWindowDays: event.target.value }))} />
                    </AdminField>
                  </div>
                  <div className="admin-grid two-col">
                    <label className="toggle compact-toggle">
                      <input checked={props.luckyDrawEventForm.allowDormantUsersOnly} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, allowDormantUsersOnly: event.target.checked }))} type="checkbox" />
                      <span className="toggle-switch" aria-hidden="true">
                        <span className="toggle-thumb" />
                      </span>
                      <span className="toggle-copy">
                        <strong>{props.luckyDrawEventForm.allowDormantUsersOnly ? "ON" : "OFF"}</strong>
                        <span>{props.luckyDrawEventForm.allowDormantUsersOnly ? "휴면 복귀 회원만" : "휴면 여부 무관"}</span>
                      </span>
                    </label>
                    <AdminField hint="최근 활동이 이 일수 이상 없던 회원만 휴면 복귀 대상으로 봅니다." label="휴면 기준(일)">
                      <input value={props.luckyDrawEventForm.dormantDays} onChange={(event) => props.setLuckyDrawEventForm((current) => ({ ...current, dormantDays: event.target.value }))} />
                    </AdminField>
                  </div>
                  <div className="admin-inline-actions">
                    <button className="mini-btn primary-mini-btn" type="submit">이벤트 저장</button>
                    <button className="mini-btn" onClick={() => {
                      props.onCancelLuckyDrawEventEdit();
                      setEditingEventId(null);
                    }} type="button">취소</button>
                  </div>
                </form>
              ) : null}
              <div className="simple-panel inline-luckydraw-related">
                <div className="portal-detail-head">
                  <div>
                    <p className="card-label">Rewards</p>
                    <h3>{`이 이벤트의 보상 ${(item.rewards || []).length}개`}</h3>
                  </div>
                </div>
                {(item.rewards || []).length ? (
                  <div className="simple-status-list">
                    {item.rewards.map((reward) => {
                      const rewardStat = (item.stats?.rewardStats || []).find((stat) => Number(stat.rewardId) === Number(reward.id));
                      return (
                        <div className="inline-luckydraw-reward-row" key={reward.id}>
                          <span>{`${reward.label} / ${reward.rewardType === "discount_coupon" ? describeCouponDiscount(reward) : reward.rewardType === "free_course" ? "무료 과정" : "메시지"} / 가중치 ${reward.probabilityWeight} / 지급 ${rewardStat?.issuedCount || 0}회`}</span>
                          <button className="mini-btn" onClick={() => {
                            props.onEditLuckyDrawReward(reward, item.id);
                            setRewardEditorEventId(item.id);
                            setEditingEventId(null);
                          }} type="button">보상 수정</button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="hint">아직 이 이벤트에 연결된 보상이 없습니다.</p>
                )}
              </div>
              {rewardEditorEventId != null && Number(rewardEditorEventId) === Number(item.id) ? (
                <form className="simple-panel admin-form inline-luckydraw-editor" onSubmit={async (event) => {
                  const saved = await props.onSaveLuckyDrawReward(event);
                  if (saved) setRewardEditorEventId(null);
                }} ref={rewardEditorRef}>
                  <div className="portal-detail-head">
                    <div>
                      <p className="card-label">Add Reward</p>
                      <h3>{`${props.luckyDrawRewardForm.id ? "보상 수정" : "보상 추가"}: ${item.title}`}</h3>
                    </div>
                    <div className="admin-inline-actions">
                      <button className="mini-btn" onClick={() => {
                        props.onCancelLuckyDrawRewardCreate();
                        setRewardEditorEventId(null);
                      }} type="button">취소</button>
                    </div>
                  </div>
                  <div className="hint">{`대상 이벤트: ${item.title}`}</div>
                  <div className="admin-grid two-col">
                    <AdminField hint="당첨 결과 화면과 관리자 목록에 보이는 보상 이름입니다." label="보상 이름" required><input value={props.luckyDrawRewardForm.label} onChange={(event) => props.setLuckyDrawRewardForm((current) => ({ ...current, label: event.target.value }))} placeholder="유료 과정 무료 수강권" /></AdminField>
                    <AdminField hint="메시지는 안내만, 무료 과정은 즉시 과정 지급, 할인 쿠폰은 결제 시 쓸 쿠폰을 발급합니다." label="보상 종류">
                      <select value={props.luckyDrawRewardForm.rewardType} onChange={(event) => props.setLuckyDrawRewardForm((current) => ({ ...current, rewardType: event.target.value }))}>
                        <option value="message">메시지 보상</option>
                        <option value="free_course">무료 과정</option>
                        <option value="discount_coupon">할인 쿠폰</option>
                      </select>
                    </AdminField>
                  </div>
                  <div className="admin-grid two-col">
                    <AdminField hint="무료 과정 또는 특정 과정 전용 쿠폰일 때 연결할 과정을 고릅니다." label="과정">
                      <select value={props.luckyDrawRewardForm.courseId} onChange={(event) => props.setLuckyDrawRewardForm((current) => ({ ...current, courseId: event.target.value }))}>
                        <option value="">과정 선택</option>
                        {(props.adminCourses || []).map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
                      </select>
                    </AdminField>
                    <AdminField hint="메시지형 보상일 때 사용자에게 보여줄 문구입니다." label="메시지">
                      <input value={props.luckyDrawRewardForm.messageText} onChange={(event) => props.setLuckyDrawRewardForm((current) => ({ ...current, messageText: event.target.value }))} placeholder="오늘의 응원 메시지" />
                    </AdminField>
                  </div>
                  <div className="admin-grid three-col">
                    <AdminField hint="숫자가 클수록 다른 보상보다 더 자주 당첨됩니다." label="가중치"><input value={props.luckyDrawRewardForm.probabilityWeight} onChange={(event) => props.setLuckyDrawRewardForm((current) => ({ ...current, probabilityWeight: event.target.value }))} /></AdminField>
                    <AdminField hint="이 보상을 전체 기간 동안 몇 개까지 지급할지 제한합니다. 비우면 제한하지 않습니다." label="전체 수량"><input value={props.luckyDrawRewardForm.totalStock} onChange={(event) => props.setLuckyDrawRewardForm((current) => ({ ...current, totalStock: event.target.value }))} /></AdminField>
                    <AdminField hint="하루 기준으로 몇 개까지 지급할지 제한합니다. 비우면 일일 제한이 없습니다." label="일일 수량"><input value={props.luckyDrawRewardForm.dailyStock} onChange={(event) => props.setLuckyDrawRewardForm((current) => ({ ...current, dailyStock: event.target.value }))} /></AdminField>
                  </div>
                  {props.luckyDrawRewardForm.rewardType === "discount_coupon" ? (
                    <div className="admin-grid three-col">
                      <AdminField hint="정률은 %, 정액은 원 단위, 전액 무료는 결제 금액을 0원으로 만듭니다." label="할인 방식">
                        <select value={props.luckyDrawRewardForm.couponDiscountType} onChange={(event) => props.setLuckyDrawRewardForm((current) => ({ ...current, couponDiscountType: event.target.value }))}>
                          <option value="percent">정률 할인</option>
                          <option value="fixed">정액 할인</option>
                          <option value="free">전액 무료</option>
                        </select>
                      </AdminField>
                      <AdminField hint="정률이면 퍼센트, 정액이면 원 금액입니다. 전액 무료는 값이 사실상 무시됩니다." label="할인 값">
                        <input value={props.luckyDrawRewardForm.couponDiscountValue} onChange={(event) => props.setLuckyDrawRewardForm((current) => ({ ...current, couponDiscountValue: event.target.value }))} />
                      </AdminField>
                      <AdminField hint="당첨 후 며칠 안에 쿠폰을 사용해야 하는지 정합니다." label="쿠폰 만료(일)">
                        <input value={props.luckyDrawRewardForm.couponExpiresInDays} onChange={(event) => props.setLuckyDrawRewardForm((current) => ({ ...current, couponExpiresInDays: event.target.value }))} />
                      </AdminField>
                    </div>
                  ) : null}
                  {props.luckyDrawRewardForm.rewardType === "discount_coupon" ? <div className="hint">여기서 정률/정액/전액 무료와 할인 값을 설정하면 당첨 시 해당 조건의 쿠폰이 발급됩니다.</div> : null}
                  <AdminField hint="같은 회원이 이 보상을 최대 몇 번까지 받을 수 있는지 제한합니다." label="1인당 최대 획득"><input value={props.luckyDrawRewardForm.perUserLimit} onChange={(event) => props.setLuckyDrawRewardForm((current) => ({ ...current, perUserLimit: event.target.value }))} /></AdminField>
                  <div className="admin-inline-actions">
                    <button className="mini-btn primary-mini-btn" disabled={!props.luckyDrawRewardForm.eventId} type="submit">{props.luckyDrawRewardForm.id ? "보상 수정" : "보상 저장"}</button>
                    <button className="mini-btn" onClick={() => {
                      props.onCancelLuckyDrawRewardCreate();
                      setRewardEditorEventId(null);
                    }} type="button">취소</button>
                  </div>
                </form>
              ) : null}
              {item.attempts?.length ? (
                <div className="qna-board">
                  {item.attempts.map((attempt) => (
                    <article className="qna-thread" key={attempt.id}>
                      <div className="qna-thread-head">
                        <strong>{`${attempt.userName || attempt.username} / ${attempt.rewardLabel || "대기"}`}</strong>
                        <span>{formatDateTime(attempt.createdAt)}</span>
                      </div>
                      <div className="simple-status-list">
                        <div>{`시도 ${attempt.attemptNo}회차 / ${attempt.resultStatus}`}</div>
                        <div>{`IP: ${attempt.ipAddress || "-"}`}</div>
                        <div>{attempt.suspicious ? "의심 패턴 감지" : "정상 패턴"}</div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </article>
          )) : <p className="hint">아직 등록된 무료 강의 뽑기 이벤트가 없습니다.</p>}
        </div>
      </section>

      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">Manual Coupon</p>
            <h3>관리자 수동 발급</h3>
          </div>
        </div>
        <form className="admin-form" onSubmit={props.onCreateAdminCoupon}>
          <div className="admin-grid three-col">
            <AdminField hint="쿠폰을 발급받을 실제 회원입니다." label="회원" required>
              <select value={props.adminCouponForm.userId} onChange={(event) => props.setAdminCouponForm((current) => ({ ...current, userId: event.target.value }))}>
                <option value="">회원 선택</option>
                {(props.adminUsers || []).map((user) => (
                  <option key={user.id} value={user.id}>{`${user.name || "-"} (${user.username})`}</option>
                ))}
              </select>
            </AdminField>
            <AdminField hint="특정 과정에만 쓰게 하려면 선택하고, 비워두면 전체 유료 과정에 쓸 수 있습니다." label="과정">
              <select value={props.adminCouponForm.courseId} onChange={(event) => props.setAdminCouponForm((current) => ({ ...current, courseId: event.target.value }))}>
                <option value="">전체 과정</option>
                {(props.adminCourses || []).map((course) => (
                  <option key={course.id} value={course.id}>{course.title}</option>
                ))}
              </select>
            </AdminField>
            <AdminField hint="관리자 내부 추적용 코드입니다. 기본값을 그대로 써도 되고 필요하면 캠페인 구분값을 넣어도 됩니다." label="출처 메모">
              <input value={props.adminCouponForm.source} onChange={(event) => props.setAdminCouponForm((current) => ({ ...current, source: event.target.value }))} placeholder="예: admin_manual" />
            </AdminField>
          </div>
          <div className="admin-grid two-col">
            <AdminField hint="쿠폰이 어떤 마케팅 캠페인용인지 구분하는 이름입니다. 보고서와 검색에 활용됩니다." label="캠페인명">
              <input value={props.adminCouponForm.campaignName} onChange={(event) => props.setAdminCouponForm((current) => ({ ...current, campaignName: event.target.value }))} placeholder="예: 4월 웨비나 리드 전환" />
            </AdminField>
            <AdminField hint="왜 이 쿠폰을 발급했는지 남기는 운영 메모입니다. 사용자 알림/메일에도 일부 반영될 수 있습니다." label="발급 사유">
              <input value={props.adminCouponForm.reason} onChange={(event) => props.setAdminCouponForm((current) => ({ ...current, reason: event.target.value }))} placeholder="예: 웨비나 리드 후속 혜택" />
            </AdminField>
          </div>
          <div className="admin-grid two-col">
            <AdminField hint="운영자끼리만 확인하는 세부 메모입니다. 실험군, 고객 응대 맥락 등을 적어두면 좋습니다." label="내부 메모">
              <input value={props.adminCouponForm.note} onChange={(event) => props.setAdminCouponForm((current) => ({ ...current, note: event.target.value }))} placeholder="예: 4월 캠페인 A/B 그룹" />
            </AdminField>
          </div>
          <div className="admin-grid three-col">
            <AdminField hint="정률은 %, 정액은 원 단위, 전액 무료는 무료 등록용으로 씁니다." label="할인 방식">
              <select value={props.adminCouponForm.discountType} onChange={(event) => props.setAdminCouponForm((current) => ({ ...current, discountType: event.target.value }))}>
                <option value="percent">정률 할인</option>
                <option value="fixed">정액 할인</option>
                <option value="free">전액 무료</option>
              </select>
            </AdminField>
            <AdminField hint="정률이면 퍼센트, 정액이면 원 금액입니다. 전액 무료 선택 시 값은 중요하지 않습니다." label="할인 값">
              <input value={props.adminCouponForm.discountValue} onChange={(event) => props.setAdminCouponForm((current) => ({ ...current, discountValue: event.target.value }))} />
            </AdminField>
            <AdminField hint="발급 후 며칠 동안 사용할 수 있는지 설정합니다. 보통 3~7일을 많이 씁니다." label="만료(일)">
              <input value={props.adminCouponForm.expiresInDays} onChange={(event) => props.setAdminCouponForm((current) => ({ ...current, expiresInDays: event.target.value }))} />
            </AdminField>
          </div>
          <div className="admin-grid two-col">
            <AdminField hint="한 쿠폰으로 몇 번까지 결제할 수 있는지 정합니다. 일반적으로 1회를 권장합니다." label="사용 가능 횟수">
              <input value={props.adminCouponForm.maxUses} onChange={(event) => props.setAdminCouponForm((current) => ({ ...current, maxUses: event.target.value }))} />
            </AdminField>
          </div>
          <button className="mini-btn primary-mini-btn" type="submit">수동 쿠폰 발급</button>
        </form>
      </section>

      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">Conversion</p>
            <h3>기간별 전환 현황</h3>
          </div>
        </div>
        <div className="admin-summary-grid">
          {periodSummaries.map((period) => (
            <article className="admin-summary-item" key={period.key}>
              <span>{period.label}</span>
              <strong>{`${period.conversionRate}%`}</strong>
              <div className="hint">{`발급 ${period.issuedCount} / 사용 ${period.redeemedCount}`}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">Trend</p>
            <h3>일자별 추이</h3>
          </div>
        </div>
        <div className="qna-board">
          {dailyTrend.map((day) => (
            <article className="qna-thread" key={day.key}>
              <div className="qna-thread-head">
                <strong>{day.label}</strong>
                <span>{`발급 ${day.issuedCount} / 사용 ${day.redeemedCount}`}</span>
              </div>
              <div className="simple-status-list">
                <div>
                  <div className="hint">발급</div>
                  <div className="quota-meter">
                    <div className="quota-meter-fill is-safe" style={{ width: `${Math.round((day.issuedCount / maxDailyTrendValue) * 100)}%` }} />
                  </div>
                </div>
                <div>
                  <div className="hint">사용</div>
                  <div className="quota-meter">
                    <div className="quota-meter-fill is-warn" style={{ width: `${Math.round((day.redeemedCount / maxDailyTrendValue) * 100)}%` }} />
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">Campaigns</p>
            <h3>캠페인 요약</h3>
          </div>
        </div>
        <div className="admin-summary-grid">
          {campaignSummaries.length ? campaignSummaries.map((campaign) => (
            <article className="admin-summary-item" key={campaign.name}>
              <span>{campaign.name}</span>
              <strong>{`${campaign.total}건`}</strong>
              <div className="hint">{`사용 ${campaign.used} / 사용 가능 ${campaign.active} / 만료 ${campaign.expired}`}</div>
            </article>
          )) : <div className="hint">아직 집계할 캠페인 쿠폰이 없습니다.</div>}
        </div>
      </section>

      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">Ranking</p>
            <h3>전환/사용 순위</h3>
          </div>
        </div>
        <div className="admin-grid two-col">
          <div className="simple-info-block">
            <p className="card-label">캠페인별 전환율</p>
            <div className="simple-status-list">
              {campaignConversionRank.length ? campaignConversionRank.map((campaign, index) => (
                <div key={campaign.name}>{`${index + 1}. ${campaign.name} / ${campaign.conversionRate}% / 사용 ${campaign.redeemed} / 발급 ${campaign.issued}`}</div>
              )) : <div>아직 집계할 캠페인이 없습니다.</div>}
            </div>
          </div>
          <div className="simple-info-block">
            <p className="card-label">과정별 쿠폰 사용</p>
            <div className="simple-status-list">
              {courseUsageRank.length ? courseUsageRank.map((course, index) => (
                <div key={course.name}>{`${index + 1}. ${course.name} / 사용 ${course.redeemed} / 발급 ${course.issued} / 사용률 ${course.redemptionRate}%`}</div>
              )) : <div>아직 집계할 과정이 없습니다.</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">Coupons</p>
            <h3>쿠폰 발급/사용 현황</h3>
          </div>
          <div className="admin-inline-actions">
            <span className="status-chip is-muted">{`전체 ${adminCoupons.length}건`}</span>
            <span className="status-chip is-muted">{`표시 ${filteredAdminCoupons.length}건`}</span>
            <button className="ghost-btn" onClick={downloadCouponCsv} type="button">CSV 다운로드</button>
          </div>
        </div>
        <div className="admin-grid compact-admin-grid">
          <AdminField label="검색">
            <input {...couponSearchInput} placeholder="코드, 회원, 과정, 캠페인, 사유, 메모 검색" />
          </AdminField>
        </div>
        <div className="admin-grid three-col">
          <AdminField label="상태 필터">
            <select value={couponStatusFilter} onChange={(event) => setCouponStatusFilter(event.target.value)}>
              <option value="all">전체</option>
              <option value="active">사용 가능</option>
              <option value="inactive">비활성</option>
              <option value="used">사용 완료</option>
              <option value="expired">만료</option>
            </select>
          </AdminField>
          <AdminField label="출처 필터">
            <select value={couponSourceFilter} onChange={(event) => setCouponSourceFilter(event.target.value)}>
              <option value="all">전체</option>
              <option value="lucky_draw">무료 강의 뽑기</option>
              <option value="signup_welcome">회원가입 웰컴</option>
              <option value="admin_manual">관리자 수동 발급</option>
            </select>
          </AdminField>
          <AdminField label="이벤트 필터">
            <select value={couponEventFilter} onChange={(event) => setCouponEventFilter(event.target.value)}>
              <option value="all">전체</option>
              {(props.adminLuckyDrawEvents || []).map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
          </AdminField>
        </div>
        <div className="qna-board">
          {filteredAdminCoupons.length ? filteredAdminCoupons.map((coupon) => {
            const isExpired = coupon.expiresAt ? new Date(coupon.expiresAt).getTime() <= Date.now() : false;
            const couponStatus = String(coupon.status || "").toLowerCase();
            return (
              <article className="qna-thread" key={coupon.id}>
                <div className="qna-thread-head">
                  <strong>{coupon.code}</strong>
                  <span>{couponStatus === "used" ? "사용 완료" : isExpired ? "만료" : couponStatus === "inactive" ? "비활성" : "사용 가능"}</span>
                </div>
                <div className="simple-status-list">
                  <div>{`회원: ${coupon.userName || "-"}${coupon.username ? ` (${coupon.username})` : ""}`}</div>
                  <div>{`과정: ${coupon.courseTitle || "전체 과정"}`}</div>
                  <div>{`혜택: ${describeCouponDiscount(coupon)}`}</div>
                  <div>{`사용 횟수: ${coupon.usedCount || 0} / ${coupon.maxUses || 1}`}</div>
                  <div>{`출처: ${coupon.source || "-"}`}</div>
                  <div>{`캠페인: ${coupon.metadata?.campaignName || "-"}`}</div>
                  <div>{`사유: ${coupon.metadata?.reason || "-"}`}</div>
                  <div>{`메모: ${coupon.metadata?.note || "-"}`}</div>
                  <div>{`발급일: ${formatDateTime(coupon.createdAt)}`}</div>
                  <div>{`만료일: ${coupon.expiresAt ? formatDateTime(coupon.expiresAt) : "-"}`}</div>
                  <div>{`사용일: ${coupon.usedAt ? formatDateTime(coupon.usedAt) : "-"}`}</div>
                </div>
                <div className="admin-inline-actions">
                  {String(coupon.status || "").toLowerCase() !== "used" ? (
                    <button
                      className="mini-btn"
                      onClick={() => props.onToggleAdminCoupon(coupon.id, couponStatus !== "active")}
                      type="button"
                    >
                      {couponStatus === "active" ? "비활성화" : "재활성화"}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          }) : <p className="hint">조건에 맞는 쿠폰이 없습니다.</p>}
        </div>
      </section>
    </section>
  );
}
