import { useEffect, useState } from "react";
import { DEFAULT_COURSE_SURVEY_CONFIG } from "./portal-state.js";
import { formatBuildBranch, formatBuildCommit } from "./build-info.js";

let qrCodeLibPromise = null;

function loadQrCodeLib() {
  if (!qrCodeLibPromise) {
    qrCodeLibPromise = import("qrcode").then((module) => module.default || module);
  }
  return qrCodeLibPromise;
}

export function StatusMessage({ tone, message }) {
  if (!message) return null;
  return <div className={`status ${tone ? `is-${tone}` : ""}`}>{message}</div>;
}

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
  if (String(course.courseType || "standard") === "package") return "◆";
  if (String(course.courseType || "standard") === "online") return "▶";
  if (isGovernmentCourse(course, platformStatus)) return "□";
  return "▣";
}

export function getCourseTypeDisplayLabel(course, platformStatus = null) {
  const icon = getCourseDisplayIcon(course, platformStatus);
  if (String(course?.courseType || "standard") === "package") return `${icon} 과정·시험 패키지`;
  if (String(course?.courseType || "standard") === "online") return `${icon} 온라인 과정`;
  if (isGovernmentCourse(course, platformStatus)) return `${icon} 정부 과정`;
  return `${icon} 일반 교육 과정`;
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

export function CoursePriceMeta({ course }) {
  const price = Math.max(0, Number(course?.price || 0));
  const effectivePrice = getCourseEffectivePrice(course);
  const promotionActive = isCoursePromotionActive(course);
  if (!promotionActive) {
    return <span>{formatCoursePrice(price)}</span>;
  }
  return (
    <>
      <span className="status-chip is-warn course-promotion-chip">프로모션</span>
      <span className="course-price-chip is-original">{`정가 ${formatCoursePrice(price)}`}</span>
      <span className="course-price-chip is-effective">{`할인가 ${formatCoursePrice(effectivePrice)}`}</span>
    </>
  );
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

  if (!otpauthUrl) return <div className="hint">OTP 등록 URL이 없습니다.</div>;
  if (!qrDataUrl) return <div className="hint">QR을 준비하는 중입니다.</div>;
  return <img alt={alt} src={qrDataUrl} />;
}

export function Field({ label, value, onChange, type = "text", placeholder = "", readOnly = false, inputRef = null, multiline = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          ref={inputRef}
          readOnly={readOnly}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          ref={inputRef}
          readOnly={readOnly}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={placeholder}
          type={type}
        />
      )}
    </label>
  );
}

export function SiteFooter({ platformStatus }) {
  const footerAdminName = platformStatus?.footerAdminName || "관리자";
  const footerEmail = platformStatus?.footerEmail || "tang@dustbox.kr";
  const footerBusinessInfo = String(platformStatus?.footerBusinessInfo || "").trim();
  const showBusinessInfo = footerBusinessInfo && footerBusinessInfo !== "아직 없어요 :o" && footerBusinessInfo !== "사업자 정보";
  const appVersion = String(platformStatus?.siteVersionNumber || "").trim() || "v1.0";
  const buildBranch = formatBuildBranch();
  const buildCommit = formatBuildCommit();

  return (
    <footer className="site-footer">
      <span>개발: <a className="site-footer-link" href="https://github.com/tangt64" rel="noreferrer" target="_blank">Choi Gook Hyun (tangt64)</a></span>
      <span>{`앱 버전 ${appVersion}`}</span>
      <span>{`빌드 브랜치 ${buildBranch}`}</span>
      <span>{`Git SHA ${buildCommit}`}</span>
      <span>{`관리자: ${footerAdminName}`}</span>
      <span>
        이메일:{" "}
        <a className="site-footer-link" href={`mailto:${footerEmail}`}>
          {footerEmail}
        </a>
      </span>
      {showBusinessInfo ? <span>{`사업자번호: ${footerBusinessInfo}`}</span> : null}
    </footer>
  );
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
