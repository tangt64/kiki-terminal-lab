import { useEffect, useRef, useState } from "react";
import { api } from "./portal-state.js";
import { getStandaloneExamCourseIds, isLearningLabResource, isStandaloneExamCourse } from "./course-visibility.js";
import {
  ACTIVE_LAB_STATUSES,
  FlavorBadges,
  deriveLabIpSummary,
  formatCourseDuration,
  formatRemainingTime,
  getCourseBackendBadges,
  getCourseAccessExpiryStatus,
  getCourseExamInfo,
  getCustomLabStatusLabel,
  getNormalizedSshPublicHost,
  isGovernmentCourse,
  labStatus,
  normalizeSshCopyValue,
  resolveCourseSurveyConfig,
  renderZunStatus,
  deriveVmNodes,
  truncateMiddleText,
} from "./portal-views.jsx";
import "./my-resources-overlay.css";
import KubectlDownloadMenu from "./kubectl-download-menu.jsx";

const MARKETING_SURVEY_DISMISSED_STORAGE_KEY = "terminal-lab:marketing-survey-dismissed-until";
const MARKETING_SURVEY_DISMISS_MS = 24 * 60 * 60 * 1000;
const ADMIN_REVIEW_REQUIRED_MESSAGE = "관리자 검토 후 사용이 가능합니다.";
const RESOURCE_LIFECYCLE_LABELS = {
  requested: "요청됨",
  approved: "승인됨",
  quoted: "견적 확인",
  confirmed: "승인됨",
  paid: "사용 가능",
  provisioning: "생성 중",
  creating: "생성 중",
  building: "생성 중",
  running: "사용 가능",
  active: "사용 가능",
  available: "사용 가능",
  stopping: "종료 중",
  terminating: "종료 중",
  stopped: "중지됨",
  terminated: "종료됨",
  deleted: "종료됨",
  failed: "실패",
  error: "실패",
  rejected: "반려됨",
};

function getResourceLifecycle(status) {
  const normalized = String(status || "").trim().toLowerCase();
  const label = RESOURCE_LIFECYCLE_LABELS[normalized] || status || "대기";
  const tone = ["running", "active", "available", "paid"].includes(normalized)
    ? "is-success"
    : ["provisioning", "creating", "building", "requested", "approved", "quoted", "confirmed"].includes(normalized)
      ? "is-warn"
      : ["failed", "error", "rejected"].includes(normalized)
        ? "is-error"
        : "is-muted";
  return { label, tone, normalized };
}

function getResourceLifecycleStage(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (["failed", "error", "rejected"].includes(normalized)) return "issue";
  if (["running", "active", "available", "paid"].includes(normalized)) return "ready";
  if (["provisioning", "creating", "building"].includes(normalized)) return "build";
  if (["stopping", "terminating", "stopped", "terminated"].includes(normalized)) return "cleanup";
  if (["requested", "approved", "quoted", "confirmed"].includes(normalized)) return "request";
  return "request";
}

function shouldShowWorkbenchResource(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized !== "deleted";
}

function joinResourceDetails(parts) {
  return parts.filter((part) => part !== null && part !== undefined && String(part).trim() !== "").join(" · ");
}

function getResourceWorkbenchGuidance(item = {}) {
  const stage = getResourceLifecycleStage(item.status);
  if (stage === "issue") {
    return {
      tone: "danger",
      label: "확인 필요",
      title: "운영지원 확인 권장",
      detail: "실패/반려된 자원은 같은 요청을 반복하기 전에 오류 원인과 잔여 자원을 먼저 확인하세요.",
      actionLabel: "정리 문의",
    };
  }
  if (stage === "cleanup") {
    return {
      tone: "warn",
      label: "정리 확인",
      title: "잔여 자원 점검",
      detail: "종료 또는 중지 상태입니다. 포트, 볼륨, 보안그룹이 남았는지 확인하면 Quota 누수를 줄일 수 있습니다.",
      actionLabel: "정리 요청",
    };
  }
  if (stage === "build" || stage === "request") {
    return {
      tone: "info",
      label: "진행 중",
      title: stage === "build" ? "생성 대기" : getResourceLifecycle(item.status).label,
      detail: "요청 처리가 진행 중입니다. 같은 자원을 다시 만들기 전에 현재 상태를 확인하세요.",
      actionLabel: "진행 문의",
    };
  }
  return {
    tone: "ready",
    label: "사용 가능",
    title: "사용 중",
    detail: "작업이 끝나면 종료/삭제 버튼으로 비용과 Quota 사용량을 정리하세요.",
    actionLabel: "사용 문의",
  };
}

function isSameCourseId(left, right) {
  if (left == null || right == null || left === "" || right === "") return false;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber === rightNumber;
  }
  return String(left) === String(right);
}

function readDismissedMarketingSurveyMap() {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(MARKETING_SURVEY_DISMISSED_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeDismissedMarketingSurveyMap(nextMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(MARKETING_SURVEY_DISMISSED_STORAGE_KEY, JSON.stringify(nextMap || {}));
  } catch {
    // Storage may be unavailable in private contexts. The overlay can still work for the current render.
  }
}

function getMarketingSurveyVotePercent(option, survey) {
  const total = Math.max(0, Number(survey?.totalVotes || 0) || 0);
  if (!total) return 0;
  return Math.round((Number(option?.voteCount || 0) / total) * 100);
}

function hasCourseLearningMaterials(course = {}) {
  return Boolean(
    String(course.youtubeUrl || "").trim()
      || String(course.labGuideMarkdown || "").trim()
      || String(course.commandsMarkdown || "").trim()
      || (Array.isArray(course.courseVideos) && course.courseVideos.length)
      || (Array.isArray(course.materials) && course.materials.length)
      || (Array.isArray(course.textbookAssignments) && course.textbookAssignments.length),
  );
}

function getSurveySubmitted(responses, courseId, phase) {
  return responses.some((item) => isSameCourseId(item.courseId, courseId) && String(item.phase || "").toLowerCase() === phase);
}

function getExamForCourse(items = [], courseId) {
  return items.find((item) => isSameCourseId(item.courseId, courseId)) || null;
}

function getCertificateForCourse(certificates = [], courseId) {
  return certificates.find((item) => isSameCourseId(item.courseId, courseId)) || null;
}

function getJourneyStepClass(status) {
  if (status === "done") return "is-success";
  if (status === "current") return "is-warn";
  if (status === "skipped") return "is-muted";
  return "is-muted";
}

function getJourneyStepLabel(status) {
  if (status === "done") return "완료";
  if (status === "current") return "진행";
  if (status === "skipped") return "해당 없음";
  return "대기";
}

export function MyResourcesView(props) {
  const currentLabCardRef = useRef(null);
  const portalUiV2Active = Boolean(props.portalUiV2Active);
  const [currentLabCardHighlighted, setCurrentLabCardHighlighted] = useState(false);
  const [surveyResponses, setSurveyResponses] = useState([]);
  const [surveyReminderStatus, setSurveyReminderStatus] = useState("");
  const [marketingSurveys, setMarketingSurveys] = useState([]);
  const [marketingSurveyStatus, setMarketingSurveyStatus] = useState("");
  const [marketingSurveyPanelOpen, setMarketingSurveyPanelOpen] = useState(false);
  const [marketingSurveySelections, setMarketingSurveySelections] = useState({});
  const [dismissedMarketingSurveys, setDismissedMarketingSurveys] = useState(() => readDismissedMarketingSurveyMap());
  const activeLab = props.activeLab;
  const activeVm = (props.selfServiceVms || []).find((item) => ["requested", "approved", "provisioning", "running", "terminating"].includes(item.status)) || null;
  const activeContainer = (props.zunContainers || []).find((item) => ["requested", "provisioning", "creating", "running", "stopping"].includes(item.status)) || null;
  const activeMagnumCluster = (props.magnumClusters || []).find((item) => !["deleted", "failed"].includes(String(item.status || "").toLowerCase())) || null;
  const activeTroveInstance = (props.troveInstances || []).find((item) => !["deleted", "failed"].includes(String(item.status || "").toLowerCase())) || null;
  const latestCustomLab = (props.customLabRequests || [])[0] || null;
  const standaloneExamCourseIds = getStandaloneExamCourseIds(props.courses);

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

  function copyQuickValue(value) {
    if (!value) return;
    navigator.clipboard?.writeText(normalizeSshCopyValue(value));
  }

  function openQuickLinks(links = []) {
    const uniqueLinks = Array.from(new Set((Array.isArray(links) ? links : [links]).filter(Boolean)));
    uniqueLinks.forEach((link) => window.open(link, "_blank", "noopener,noreferrer"));
  }

  const enrolledCourses = (props.courses || [])
    .filter((course) => (
      Boolean(course.hasEnrollmentRecord)
      && !course.enrollmentExpired
      && !isStandaloneExamCourse(course)
    ))
    .map((course) => {
      const courseLab = props.labs.find((item) => (
        ACTIVE_LAB_STATUSES.includes(String(item.status || "").toLowerCase())
        && isLearningLabResource(item, standaloneExamCourseIds)
        && isSameCourseId(item.courseId, course.id)
      )) || null;
      const courseLabIpSummary = deriveLabIpSummary(courseLab);
      const courseExamInfo = getCourseExamInfo(course.id, props.writtenExams, props.labExams);
      const courseLabExam = props.labExams.find((item) => isSameCourseId(item.courseId, course.id)) || null;
      const labExamCompleted = Boolean(courseLabExam?.latestAttempt);
      return {
        course,
        courseLab,
        courseLabIpSummary,
        courseExamInfo,
        labExamCompleted,
      };
    })
    .sort((left, right) => {
      const statusWeight = (entry) => {
        const normalized = String(entry.courseLab?.status || "").toLowerCase();
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

  const visibleEnrolledCourses = enrolledCourses.slice(0, 6);
  const focusedCourseEntry = enrolledCourses.find((entry) => isSameCourseId(entry.course.id, props.selectedCourseId))
    || enrolledCourses.find((entry) => isSameCourseId(entry.course.id, activeLab?.courseId))
    || enrolledCourses.find((entry) => entry.courseLab)
    || enrolledCourses[0]
    || null;
  const useCourseDropdown = enrolledCourses.length >= 2;
  const hasExplicitSelectedCourse = enrolledCourses.some((entry) => isSameCourseId(entry.course.id, props.selectedCourseId));
  const selectedSummaryEntry = (useCourseDropdown
    ? enrolledCourses.find((entry) => isSameCourseId(entry.course.id, props.selectedCourseId || focusedCourseEntry?.course?.id))
    : null)
    || focusedCourseEntry
    || null;
  const displayLab = hasExplicitSelectedCourse
    ? (selectedSummaryEntry?.courseLab || null)
    : (selectedSummaryEntry?.courseLab || activeLab || null);
  const displayCourse = selectedSummaryEntry?.course
    || props.activeLabCourse
    || props.courses?.find((course) => isSameCourseId(course.id, displayLab?.courseId))
    || null;
  const displayCourseRevokeBlockedReason = displayLab
    ? "실행 중이거나 대기 중인 랩을 먼저 종료해 주세요."
    : "";
  const publicDomains = displayLab?.publicDomains || [];
  const requestedDomains = displayLab?.requestedPublicDomains || [];
  const requestedPublicTcpRoutes = displayLab?.requestedPublicTcpRoutes || [];
  const displayLabIpSummary = deriveLabIpSummary(displayLab);
  const displayLabExam = props.labExams.find((item) => isSameCourseId(item.courseId, displayCourse?.id || displayLab?.courseId)) || null;
  const displayLabExamCompleted = Boolean(displayLabExam?.latestAttempt);
  const canOpenDisplayTerminal = String(displayLab?.status || "").toLowerCase() === "running" && !displayLabExamCompleted;
  const displayCourseExpiryStatus = getCourseAccessExpiryStatus(displayCourse);
  const displayCourseNeedsExtension = Boolean(displayCourse?.hasEnrollmentRecord && displayCourseExpiryStatus.needsExtension);
  const expiringCourseEntries = enrolledCourses
    .map((entry) => ({ ...entry, expiryStatus: getCourseAccessExpiryStatus(entry.course) }))
    .filter((entry) => entry.course?.hasEnrollmentRecord && entry.expiryStatus.needsExtension)
    .sort((left, right) => {
      const leftDays = Number.isFinite(Number(left.expiryStatus.daysRemaining)) ? Number(left.expiryStatus.daysRemaining) : 9999;
      const rightDays = Number.isFinite(Number(right.expiryStatus.daysRemaining)) ? Number(right.expiryStatus.daysRemaining) : 9999;
      return leftDays - rightDays;
    });
  const firstExpiringCourseEntry = expiringCourseEntries[0] || null;
  const canOpenDisplayCourseTerminal = displayCourse?.hasAccess !== false && canOpenDisplayTerminal;
  const displayLabBackendType = String(displayLab?.labBackendType || displayCourse?.labBackendType || "vm").trim().toLowerCase();
  const displayLabRemoveLabel = displayLabBackendType === "container" ? "컨테이너 제거" : "랩 종료";
  const isDisplayCoursePaymentEnrollment = String(displayCourse?.enrollmentGrantedVia || "").trim().toLowerCase() === "payment";
  const managedLabCourse = ["linux-shell-lab.yaml", "example-lab.yaml", "kubeflow.yaml", "windows-rdp-lab.yaml"].includes(String(displayCourse?.heatTemplateName || "").trim().toLowerCase());
  const requestedDomainUrls = requestedDomains.map((entry) => entry.url).filter(Boolean);
  const publicDomainUrls = publicDomains.map((entry) => entry.url).filter(Boolean);
  const externalSshHost = getNormalizedSshPublicHost(props.platformStatus?.sshPublicHost);
  const externalSshUsername = managedLabCourse
    ? String(displayLab?.terminalSshUser || "").trim()
    : String(displayLab?.terminalSshUser || displayCourse?.terminalSshUser || "").trim();
  const displayVmNodes = deriveVmNodes(displayLab);
  const externalSshTargets = displayLab?.externalSshEnabled
    ? displayVmNodes
      .map((node, index) => {
        const externalPort = Number(node?.externalSshPort ?? (index === 0 ? displayLab?.externalSshPort : null));
        const methods = [];
        if (Number.isInteger(externalPort) && externalSshHost) {
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
          port: Number.isInteger(externalPort) ? externalPort : null,
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
  if (displayLab?.externalSshEnabled && !externalSshTargets.length && Number.isInteger(Number(displayLab?.externalSshPort))) {
    externalSshTargets.push({
      port: Number(displayLab.externalSshPort),
      name: "VM 1",
      sshHost: "",
      methods: [{
        kind: "port",
        label: "포트 방식",
        value: `${externalSshHost}:${Number(displayLab.externalSshPort)}`,
        link: `ssh://${externalSshUsername}@${externalSshHost}:${Number(displayLab.externalSshPort)}`,
        command: `ssh ${externalSshUsername}@${externalSshHost} -p ${Number(displayLab.externalSshPort)}`,
      }],
      links: [`ssh://${externalSshUsername}@${externalSshHost}:${Number(displayLab.externalSshPort)}`],
      commands: [`ssh ${externalSshUsername}@${externalSshHost} -p ${Number(displayLab.externalSshPort)}`],
      label: `VM 1 / 포트 방식`,
    });
  }
  const externalSshLinks = externalSshTargets.flatMap((target) => target.links || []);
  const externalSshCommand = externalSshTargets.flatMap((target) => target.commands || []).join("\n");
  const externalSshLink = externalSshLinks[0] || "";
  const externalSshLabel = externalSshTargets.length
    ? externalSshTargets.length === 1
      ? externalSshTargets[0].label
      : `${externalSshTargets[0].label} (+${externalSshTargets.length - 1})`
    : displayLab?.externalSshRequestPending
      ? "관리자 검토 대기"
      : displayCourse?.externalSshApprovalMode === "disabled"
        ? "사용금지"
      : "사용 안 함";
  const hasAdminReviewRequiredFeature = Boolean(
    requestedDomains.length
    || requestedPublicTcpRoutes.length
    || displayLab?.externalSshRequestPending
    || displayLab?.externalRdpRequestPending,
  );
  const surveyEnabledCourses = enrolledCourses.filter(({ course }) => {
    const surveyConfig = resolveCourseSurveyConfig(course);
    return surveyConfig?.pre?.enabled !== false || surveyConfig?.post?.enabled !== false;
  });
  const preSurveyEnabledCourses = surveyEnabledCourses.filter(({ course }) => resolveCourseSurveyConfig(course)?.pre?.enabled !== false);
  const missingPreSurveyCourses = preSurveyEnabledCourses.filter(({ course }) => !surveyResponses.some((item) => isSameCourseId(item.courseId, course.id) && item.phase === "pre"));
  const nextSurveyCourse = missingPreSurveyCourses.find((entry) => isSameCourseId(entry.course.id, props.selectedCourseId || displayCourse?.id))
    || missingPreSurveyCourses[0]
    || null;
  const activeMarketingSurveys = marketingSurveys
    .filter((survey) => !survey.mySubmission)
    .filter((survey) => Number(dismissedMarketingSurveys[survey.id] || 0) <= Date.now());
  const featuredMarketingSurvey = activeMarketingSurveys[0] || null;
  const featuredMarketingSurveySelections = featuredMarketingSurvey ? marketingSurveySelections[featuredMarketingSurvey.id] || [] : [];
  const journeyEntries = enrolledCourses.map((entry) => {
    const { course, courseLab, courseExamInfo } = entry;
    const surveyConfig = resolveCourseSurveyConfig(course);
    const preEnabled = surveyConfig?.pre?.enabled !== false;
    const postEnabled = surveyConfig?.post?.enabled !== false;
    const preDone = !preEnabled || getSurveySubmitted(surveyResponses, course.id, "pre");
    const postDone = !postEnabled || getSurveySubmitted(surveyResponses, course.id, "post");
    const materialReady = hasCourseLearningMaterials(course);
    const labStatusName = String(courseLab?.status || "").toLowerCase();
    const labCreated = Boolean(courseLab);
    const labRunning = labStatusName === "running";
    const writtenExam = getExamForCourse(props.writtenExams, course.id);
    const labExam = getExamForCourse(props.labExams, course.id);
    const writtenDone = !courseExamInfo.hasWrittenExam || Boolean(writtenExam?.latestAttempt);
    const labDone = !courseExamInfo.hasLabExam || Boolean(labExam?.latestAttempt);
    const examsDone = !courseExamInfo.hasAnyExam || (writtenDone && labDone);
    const certificate = getCertificateForCourse(props.certificates, course.id);
    const certificateEligible = (props.eligibleCertificates || []).some((item) => isSameCourseId(item.id, course.id));
    const steps = [
      { key: "access", label: "신청", status: "done" },
      { key: "preSurvey", label: "사전 설문", status: preEnabled ? (preDone ? "done" : "current") : "skipped", action: preEnabled && !preDone ? "preSurvey" : "" },
      { key: "materials", label: "교재/영상", status: materialReady ? "done" : "skipped", action: "courseDetail" },
      { key: "lab", label: "랩 생성", status: labRunning ? "done" : labCreated ? "current" : "pending", action: labRunning ? "terminal" : "courseDetail" },
      { key: "checkpoint", label: "실습 체크포인트", status: labExam?.latestAttempt ? "done" : labRunning ? "current" : courseExamInfo.hasLabExam ? "pending" : "skipped", action: labRunning ? "terminal" : "labExam" },
      { key: "exam", label: "시험", status: courseExamInfo.hasAnyExam ? (examsDone ? "done" : labCreated ? "current" : "pending") : "skipped", action: courseExamInfo.hasLabExam ? "labExam" : "writtenExam" },
      { key: "certificate", label: "수료증", status: certificate ? "done" : certificateEligible ? "current" : courseExamInfo.hasAnyExam ? "pending" : "skipped", action: certificate ? "certificate" : certificateEligible ? "certificates" : "" },
      { key: "postSurvey", label: "사후 설문", status: postEnabled ? (postDone ? "done" : (examsDone || certificate || labExam?.latestAttempt) ? "current" : "pending") : "skipped", action: postEnabled && !postDone ? "postSurvey" : "" },
    ];
    const applicableSteps = steps.filter((step) => step.status !== "skipped");
    const completedSteps = applicableSteps.filter((step) => step.status === "done");
    const nextStep = applicableSteps.find((step) => step.status === "current") || applicableSteps.find((step) => step.status === "pending") || null;
    return {
      ...entry,
      certificate,
      certificateEligible,
      progress: applicableSteps.length ? Math.round((completedSteps.length / applicableSteps.length) * 100) : 100,
      completedCount: completedSteps.length,
      totalCount: applicableSteps.length,
      nextStep,
      steps,
    };
  });
  const focusedJourneyEntry = journeyEntries.find((entry) => selectedSummaryEntry && isSameCourseId(entry.course.id, selectedSummaryEntry.course.id))
    || journeyEntries[0]
    || null;
  const journeyWatchEntries = journeyEntries
    .filter((entry) => !focusedJourneyEntry || !isSameCourseId(entry.course.id, focusedJourneyEntry.course.id))
    .sort((left, right) => left.progress - right.progress || String(left.course.title || "").localeCompare(String(right.course.title || ""), "ko"))
    .slice(0, 3);
  const journeyAverageProgress = journeyEntries.length
    ? Math.round(journeyEntries.reduce((sum, entry) => sum + entry.progress, 0) / journeyEntries.length)
    : 0;
  function openResourceManagement(legacySection, intent = {}) {
    if (portalUiV2Active) {
      if (typeof props.onOpenTerminalCloudIntent === "function") {
        props.onOpenTerminalCloudIntent({
          action: intent.action || "",
          tab: intent.tab || "",
          sourceSection: "resources",
          closeMobileNav: false,
        });
        return;
      }
      props.setSection?.("terminalCloud");
      return;
    }
    props.setSection?.(legacySection);
  }
  function openCloudConsoleOverview() {
    openResourceManagement("selfServiceVm", { tab: "overview" });
  }
  const labResourceLifecycleItems = [
    activeVm ? { key: "self-vm", label: "사용자 가상머신", title: activeVm.stackName || activeVm.flavor || "사용자 가상머신", status: activeVm.status, cleanup: "가상머신 삭제" } : null,
    activeContainer ? { key: "container", label: "컨테이너", title: activeContainer.name || "컨테이너", status: activeContainer.status, cleanup: "중지/삭제" } : null,
    activeMagnumCluster ? { key: "k8s", label: "쿠버네티스", title: activeMagnumCluster.name || "클러스터", status: activeMagnumCluster.status, cleanup: "클러스터 삭제" } : null,
    activeTroveInstance ? { key: "db", label: "데이터베이스", title: activeTroveInstance.name || "DB 인스턴스", status: activeTroveInstance.status, cleanup: "DB 삭제" } : null,
    latestCustomLab ? { key: "poc", label: "고급 랩 구성", title: latestCustomLab.title || "고급 랩 구성", status: latestCustomLab.status, cleanup: latestCustomLab.status === "running" ? "랩 자원 종료" : "구성 취소" } : null,
  ].filter(Boolean);
  const resourceWorkbenchRows = [
    displayLab ? {
      key: `lab-${displayLab.id || displayLab.stackName || displayCourse?.id || "active"}`,
      kind: "lab",
      icon: "LAB",
      label: "교육 랩",
      title: displayCourse?.title || displayLab.stackName || "교육 랩",
      status: displayLab.status,
      statusText: labStatus(displayLab.status),
      detail: joinResourceDetails([
        `대표 IP ${displayLabIpSummary.instanceIp || "-"}`,
        publicDomains.length || requestedDomains.length ? `도메인 ${publicDomains.length}/${requestedDomains.length}` : "",
        requestedPublicTcpRoutes.length ? `TCP 요청 ${requestedPublicTcpRoutes.length}` : "",
      ]),
      actions: [
        { key: "terminal", label: "터미널", primary: true, disabled: !canOpenDisplayCourseTerminal, onClick: () => props.setSection?.("terminal") },
        { key: "guide", label: "랩+교안", onClick: () => openCourseWorkspace(displayCourse?.id || displayLab.courseId, { openDetail: true }) },
        { key: "remove", label: displayLabRemoveLabel, danger: true, disabled: !displayLab?.id || displayLabExamCompleted, onClick: () => props.onRemoveLab?.(displayLab.id) },
      ],
    } : null,
    ...(props.selfServiceVms || [])
      .filter((item) => shouldShowWorkbenchResource(item.status))
      .map((item) => ({
        key: `self-vm-${item.id || item.stackName}`,
        kind: "vm",
        icon: "VM",
        label: "사용자 가상머신",
        title: item.stackName || item.flavor || "사용자 가상머신",
        status: item.status,
        statusText: labStatus(item.status),
        detail: joinResourceDetails([
          item.projectName ? `프로젝트 ${item.projectName}` : "",
          item.flavor ? `Flavor ${item.flavor}` : "",
          `${item.instanceCount || 1}대`,
          item.instanceIp ? `IP ${item.instanceIp}` : "",
        ]),
        actions: [
          { key: "open", label: "클라우드 콘솔", primary: true, onClick: () => openResourceManagement("selfServiceVm", { action: "instance", tab: "instances" }) },
          { key: "cleanup", label: item.status === "requested" ? "요청 취소" : "삭제 요청", danger: true, disabled: !props.onTerminateSelfServiceVm, onClick: () => props.onTerminateSelfServiceVm?.(item.id) },
        ],
      })),
    ...(props.zunContainers || [])
      .filter((item) => shouldShowWorkbenchResource(item.status))
      .map((item) => {
        const canOpenContainerConsole = ["running", "creating"].includes(String(item.status || "").toLowerCase()) && item.containerUuid && props.onCreateZunContainerTerminalSession;
        return {
          key: `container-${item.id || item.uuid || item.name}`,
          kind: "container",
          icon: "CT",
          label: "컨테이너",
          title: item.name || "컨테이너 랩",
          status: item.status,
          statusText: renderZunStatus(item.status),
          detail: joinResourceDetails([
            item.imageName ? `이미지 ${truncateMiddleText(item.imageName, 34)}` : "",
            item.exposedPort ? `포트 ${item.exposedPort}` : "",
            item.addresses?.length ? `주소 ${item.addresses.map((entry) => entry.address).filter(Boolean).join(", ")}` : "",
          ]),
          actions: [
            { key: "console", label: "웹 콘솔", primary: true, disabled: !canOpenContainerConsole, onClick: () => props.onCreateZunContainerTerminalSession?.(item.id) },
            ["running", "creating"].includes(String(item.status || "").toLowerCase())
              ? { key: "stop", label: "중지", danger: false, disabled: !props.onStopZunContainer, onClick: () => props.onStopZunContainer?.(item.id) }
              : null,
            ["stopped", "failed"].includes(String(item.status || "").toLowerCase())
              ? { key: "start", label: "시작", primary: true, disabled: !props.onStartZunContainer, onClick: () => props.onStartZunContainer?.(item.id) }
              : null,
            { key: "refresh", label: "갱신", disabled: !props.onRefreshZunContainer, onClick: () => props.onRefreshZunContainer?.(item.id) },
            { key: "domain", label: "도메인 추가", disabled: String(item.status || "").toLowerCase() !== "running" || !item.exposedPort || !props.onPublishZunContainerDomain, onClick: () => props.onPublishZunContainerDomain?.(item.id, {}) },
            { key: "delete", label: "삭제", danger: true, disabled: !props.onDeleteZunContainer, onClick: () => props.onDeleteZunContainer?.(item.id) },
          ].filter(Boolean),
        };
      }),
    ...(props.customLabRequests || [])
      .filter((item) => shouldShowWorkbenchResource(item.status))
      .map((item) => ({
        key: `custom-lab-${item.id || item.title}`,
        kind: "poc",
        icon: "PoC",
        label: "고급 랩 구성",
        title: item.title || item.stackName || "고급 랩 구성",
        status: item.status,
        statusText: getCustomLabStatusLabel(item.status),
        detail: joinResourceDetails([
          item.projectName ? `프로젝트 ${item.projectName}` : "",
          item.flavor ? `Flavor ${item.flavor}` : "",
          item.instanceCount ? `${item.instanceCount}대` : "",
          item.estimatedPrice ? `예상 ${item.estimatedPrice}` : "",
        ]),
        actions: [
          { key: "open", label: "클라우드 콘솔", primary: true, onClick: () => openResourceManagement("customLabs", { action: "instance", tab: "instances" }) },
          ["requested", "quoted", "confirmed"].includes(String(item.status || "").toLowerCase())
            ? { key: "cancel", label: "구성 취소", danger: true, disabled: !props.onCancelCustomLabRequest, onClick: () => props.onCancelCustomLabRequest?.(item.id) }
            : null,
          String(item.status || "").toLowerCase() === "running"
            ? { key: "terminate", label: "랩 종료", danger: true, disabled: !props.onTerminateCustomLabRequest, onClick: () => props.onTerminateCustomLabRequest?.(item.id) }
            : null,
        ].filter(Boolean),
      })),
    ...(props.magnumClusters || [])
      .filter((item) => shouldShowWorkbenchResource(item.status))
      .map((item) => ({
        key: `magnum-${item.id || item.name}`,
        kind: "k8s",
        icon: "K8S",
        label: "Kubernetes",
        title: item.name || "쿠버네티스 클러스터",
        status: item.status,
        detail: joinResourceDetails([
          item.clusterTemplateName || item.clusterTemplateId ? `템플릿 ${item.clusterTemplateName || item.clusterTemplateId}` : "",
          `노드 master ${item.masterCount || 1} / worker ${item.nodeCount || 1}`,
          item.apiAddress ? `API ${item.apiAddress}` : "",
        ]),
        actions: [
          { key: "open", label: "클러스터 관리", primary: true, onClick: () => openResourceManagement("magnum", { action: "cluster", tab: "clusters" }) },
          { key: "delete", label: "삭제", danger: true, disabled: !props.onDeleteMagnumCluster, onClick: () => props.onDeleteMagnumCluster?.(item.id) },
        ],
      })),
    ...(props.troveInstances || [])
      .filter((item) => shouldShowWorkbenchResource(item.status))
      .map((item) => ({
        key: `trove-${item.id || item.name}`,
        kind: "db",
        icon: "DB",
        label: "데이터베이스",
        title: item.name || "DB 인스턴스",
        status: item.status,
        detail: joinResourceDetails([
          item.datastoreType ? `Datastore ${item.datastoreType}` : "",
          item.flavor ? `Flavor ${item.flavor}` : "",
          item.sizeGb ? `볼륨 ${item.sizeGb}GB` : "",
          item.hostname ? `Host ${item.hostname}` : "",
        ]),
        actions: [
          { key: "open", label: "DB 관리", primary: true, onClick: () => openResourceManagement("trove", { action: "database", tab: "databases" }) },
          { key: "delete", label: "삭제", danger: true, disabled: !props.onDeleteTroveInstance, onClick: () => props.onDeleteTroveInstance?.(item.id) },
        ],
      })),
  ].filter(Boolean);
  const visibleWorkbenchRows = resourceWorkbenchRows.slice(0, 9);
  const workbenchStageCounts = resourceWorkbenchRows.reduce((summary, item) => {
    const stage = getResourceLifecycleStage(item.status);
    summary[stage] = (summary[stage] || 0) + 1;
    return summary;
  }, {});
  const resourceWorkbenchMetrics = [
    { key: "total", label: "전체 자원", value: resourceWorkbenchRows.length },
    { key: "ready", label: "사용 가능", value: workbenchStageCounts.ready || 0 },
    { key: "progress", label: "진행 중", value: (workbenchStageCounts.request || 0) + (workbenchStageCounts.build || 0) },
    { key: "issue", label: "확인 필요", value: workbenchStageCounts.issue || 0 },
  ];
  const resourceLifecycleStages = [
    { key: "request", label: "요청/승인", value: workbenchStageCounts.request || 0 },
    { key: "build", label: "생성 중", value: workbenchStageCounts.build || 0 },
    { key: "ready", label: "사용 가능", value: workbenchStageCounts.ready || 0 },
    { key: "cleanup", label: "정리/종료", value: workbenchStageCounts.cleanup || 0 },
    { key: "issue", label: "확인 필요", value: workbenchStageCounts.issue || 0 },
  ];
  const resourceWorkbenchIssueRows = resourceWorkbenchRows.filter((item) => getResourceLifecycleStage(item.status) === "issue");
  const resourceWorkbenchCleanupRows = resourceWorkbenchRows.filter((item) => getResourceLifecycleStage(item.status) === "cleanup");
  const resourceWorkbenchProgressRows = resourceWorkbenchRows.filter((item) => ["request", "build"].includes(getResourceLifecycleStage(item.status)));
  const resourceWorkbenchReadyRows = resourceWorkbenchRows.filter((item) => getResourceLifecycleStage(item.status) === "ready");
  const resourceWorkbenchActionRows = [
    ...resourceWorkbenchIssueRows,
    ...resourceWorkbenchCleanupRows,
    ...resourceWorkbenchProgressRows,
  ].slice(0, 4);
  const resourceWorkbenchTriageMetrics = [
    { key: "issue", label: "확인 필요", value: resourceWorkbenchIssueRows.length, tone: "danger" },
    { key: "cleanup", label: "정리 대기", value: resourceWorkbenchCleanupRows.length, tone: "warn" },
    { key: "progress", label: "진행 중", value: resourceWorkbenchProgressRows.length, tone: "info" },
    { key: "ready", label: "사용 가능", value: resourceWorkbenchReadyRows.length, tone: "ready" },
  ];

  function runJourneyAction(entry, action) {
    if (!entry || !action) return;
    if (action === "preSurvey") {
      moveToSurvey(entry.course.id, "pre");
      return;
    }
    if (action === "postSurvey") {
      moveToSurvey(entry.course.id, "post");
      return;
    }
    if (action === "terminal") {
      openCourseWorkspace(entry.course.id, { openTerminal: true });
      return;
    }
    if (action === "writtenExam") {
      props.setSelectedCourseId?.(Number(entry.course.id) || entry.course.id);
      props.setSection?.("writtenExam");
      return;
    }
    if (action === "labExam") {
      props.setSelectedCourseId?.(Number(entry.course.id) || entry.course.id);
      props.setSection?.("labExam");
      return;
    }
    if (action === "certificates" || action === "certificate") {
      props.setSelectedCourseId?.(Number(entry.course.id) || entry.course.id);
      props.setSection?.("certificates");
      return;
    }
    openCourseWorkspace(entry.course.id, { openDetail: true });
  }

  useEffect(() => {
    if (!selectedSummaryEntry?.course?.id) return;
    setCurrentLabCardHighlighted(true);
    const timer = window.setTimeout(() => setCurrentLabCardHighlighted(false), 900);
    return () => window.clearTimeout(timer);
  }, [selectedSummaryEntry?.course?.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadSurveyResponses() {
      try {
        const result = await api("/api/course-surveys");
        if (!cancelled) {
          setSurveyResponses(result.responses || []);
          setSurveyReminderStatus("");
        }
      } catch (error) {
        if (!cancelled) setSurveyReminderStatus(error.message || "설문 응답 현황을 불러오지 못했습니다.");
      }
    }
    loadSurveyResponses();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadMarketingSurveys() {
      try {
        const result = await api("/api/marketing-surveys");
        if (cancelled) return;
        setMarketingSurveys(result.surveys || []);
        setMarketingSurveyStatus("");
      } catch (error) {
        if (!cancelled) setMarketingSurveyStatus(error.message || "설문 투표를 불러오지 못했습니다.");
      }
    }
    loadMarketingSurveys();
    return () => { cancelled = true; };
  }, []);

  function openCourseWorkspace(courseId, options = {}) {
    const normalizedCourseId = Number(courseId || 0) || courseId;
    const targetCourse = enrolledCourses.find((entry) => isSameCourseId(entry.course.id, normalizedCourseId))?.course
      || props.courses?.find((course) => isSameCourseId(course.id, normalizedCourseId))
      || null;
    props.setSelectedCourseId?.(normalizedCourseId);
    if (options.openTerminal) {
      props.setSection?.("terminal");
      return;
    }
    if (options.openDetail) {
      props.setOpenSelectedCourseDetail?.(true);
    }
    props.setSection?.(getLearningSectionForCourse(targetCourse));
  }

  function focusCourseWorkspace(courseId) {
    const normalizedCourseId = Number(courseId || 0) || courseId;
    props.setSelectedCourseId?.(normalizedCourseId);
    if (currentLabCardRef.current) {
      window.requestAnimationFrame(() => {
        currentLabCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      });
    }
  }

  function moveToSurvey(courseId, phase = "pre") {
    const normalizedCourseId = Number(courseId || 0) || courseId;
    props.setSelectedCourseId?.(normalizedCourseId);
    props.setPreferredSurveyPhase?.(phase);
    props.setSection?.("surveys");
  }

  function toggleMarketingSurveyOption(survey, optionId) {
    setMarketingSurveySelections((current) => {
      const selected = current[survey.id] || [];
      if (!survey.multiChoice) return { ...current, [survey.id]: [optionId] };
      return {
        ...current,
        [survey.id]: selected.includes(optionId)
          ? selected.filter((id) => id !== optionId)
          : [...selected, optionId],
      };
    });
  }

  function dismissMarketingSurvey(surveyId) {
    const nextMap = {
      ...readDismissedMarketingSurveyMap(),
      [surveyId]: Date.now() + MARKETING_SURVEY_DISMISS_MS,
    };
    setDismissedMarketingSurveys(nextMap);
    writeDismissedMarketingSurveyMap(nextMap);
    setMarketingSurveyPanelOpen(false);
  }

  async function submitMarketingSurveyVote(survey) {
    const selected = marketingSurveySelections[survey.id] || [];
    if (!selected.length) {
      setMarketingSurveyStatus("선택지를 골라 주세요.");
      return;
    }
    try {
      const result = await api(`/api/marketing-surveys/${survey.id}/vote`, {
        method: "POST",
        body: { optionIds: selected },
      });
      setMarketingSurveys((current) => current.map((item) => Number(item.id) === Number(survey.id) ? result.survey : item));
      setMarketingSurveySelections((current) => ({ ...current, [survey.id]: [] }));
      setMarketingSurveyStatus(result.message || "투표가 기록되었습니다.");
      setMarketingSurveyPanelOpen(false);
    } catch (error) {
      setMarketingSurveyStatus(error.message || "투표를 저장하지 못했습니다.");
    }
  }

  return (
    <section className="portal-stack">
      {featuredMarketingSurvey ? (
        <aside className={`my-learning-marketing-survey-overlay ${marketingSurveyPanelOpen ? "is-open" : ""}`} aria-label="의견 투표">
          {marketingSurveyPanelOpen ? (
            <section className="my-learning-marketing-survey-panel">
              <div className="my-learning-marketing-survey-head">
                <div>
                  <p className="card-label">의견 투표</p>
                  <strong>{featuredMarketingSurvey.title}</strong>
                </div>
                <button className="mini-btn" onClick={() => setMarketingSurveyPanelOpen(false)} type="button">닫기</button>
              </div>
              <p className="hint">{featuredMarketingSurvey.question}</p>
              <div className="my-learning-marketing-survey-options">
                {(featuredMarketingSurvey.options || []).map((option) => (
                  <button
                    className={`survey-choice-btn ${featuredMarketingSurveySelections.includes(option.id) ? "is-selected" : ""}`}
                    key={`marketing-survey-overlay-option-${option.id}`}
                    onClick={() => toggleMarketingSurveyOption(featuredMarketingSurvey, option.id)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {featuredMarketingSurvey.showResults ? (
                <div className="my-learning-marketing-survey-results">
                  {(featuredMarketingSurvey.options || []).map((option) => {
                    const percent = getMarketingSurveyVotePercent(option, featuredMarketingSurvey);
                    return (
                      <div className="my-learning-marketing-survey-result" key={`marketing-survey-overlay-result-${option.id}`}>
                        <span>{option.label}</span>
                        <div><i style={{ width: `${percent}%` }} /></div>
                        <b>{`${option.voteCount || 0}표`}</b>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {marketingSurveyStatus ? <div className="hint">{marketingSurveyStatus}</div> : null}
              <div className="portal-actions my-learning-marketing-survey-actions">
                <button className="primary-btn" onClick={() => submitMarketingSurveyVote(featuredMarketingSurvey)} type="button">투표하기</button>
                <button className="ghost-btn" onClick={() => dismissMarketingSurvey(featuredMarketingSurvey.id)} type="button">나중에</button>
                <button className="ghost-btn" onClick={() => props.setSection?.("marketingSurveys")} type="button">전체 보기</button>
              </div>
            </section>
          ) : (
            <button className="my-learning-marketing-survey-fab" onClick={() => setMarketingSurveyPanelOpen(true)} type="button">
              <span>의견 투표</span>
              <strong>{activeMarketingSurveys.length}</strong>
            </button>
          )}
        </aside>
      ) : null}

      <section className="simple-panel my-learning-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">현재 나의 랩</p>
            <h3>선택한 과정의 실습 상태와 바로가기를 한눈에 살펴보세요</h3>
            <p className="hint">현재 탭의 `내 과정`, 실습 상태, 빠른 이동 버튼을 기준으로 필요한 화면으로 바로 이어갈 수 있습니다.</p>
          </div>
          <div className="portal-chip-row">
            <span className="status-chip is-muted">{`내 과정 ${enrolledCourses.length}개`}</span>
            <span className="status-chip is-muted">{displayLab ? `현재 랩 ${labStatus(displayLab.status)}` : "현재 랩 없음"}</span>
          </div>
        </div>

        {missingPreSurveyCourses.length ? (
          <section className="my-learning-survey-banner">
            <div>
              <p className="card-label">사전 설문 리마인드</p>
              <strong>{`아직 ${missingPreSurveyCourses.length}개 과정의 사전 설문을 작성하지 않았습니다.`}</strong>
              <p className="hint">
                교육 신청 전에도 바로 참여할 수 있으며 현재 수준과 기대 사항을 남겨 두면 과정 설계와 운영 개선에 반영됩니다.
              </p>
              <div className="portal-chip-row">
                {missingPreSurveyCourses.slice(0, 4).map(({ course }) => (
                  <button className="status-chip is-muted my-learning-survey-chip" key={`missing-pre-${course.id}`} onClick={() => moveToSurvey(course.id, "pre")} type="button">
                    {course.title}
                  </button>
                ))}
                {missingPreSurveyCourses.length > 4 ? <span className="status-chip is-muted">{`외 ${missingPreSurveyCourses.length - 4}개`}</span> : null}
              </div>
            </div>
            <div className="portal-actions">
              <button className="primary-btn" disabled={!nextSurveyCourse} onClick={() => nextSurveyCourse && moveToSurvey(nextSurveyCourse.course.id, "pre")} type="button">사전 설문 작성하기</button>
              <button className="ghost-btn" onClick={() => props.setSection?.("surveys")} type="button">설문 전체 보기</button>
            </div>
          </section>
        ) : null}

        {!missingPreSurveyCourses.length && preSurveyEnabledCourses.length ? (
          <section className="my-learning-survey-banner is-complete">
            <div>
              <p className="card-label">사전 설문 완료</p>
              <strong>사전 설문이 활성화된 모든 과정의 작성이 완료되었습니다.</strong>
              <p className="hint">과정 종료 후 설문 화면에서 사후/NPS 설문도 이어서 작성할 수 있습니다.</p>
            </div>
            <div className="portal-actions">
              <button
                className="ghost-btn"
                onClick={() => {
                  props.setPreferredSurveyPhase?.("post");
                  props.setSection?.("surveys");
                }}
                type="button"
              >
                사후/NPS 설문 보기
              </button>
            </div>
          </section>
        ) : null}

        {surveyReminderStatus ? <div className="hint">{surveyReminderStatus}</div> : null}

        {expiringCourseEntries.length ? (
          <section className="course-expiry-summary-banner">
            <div>
              <p className="card-label">수강 기간 알림</p>
              <strong>{`${expiringCourseEntries.length}개 과정에 연장 확인이 필요합니다.`}</strong>
              <p className="hint">만료가 가까운 과정은 랩, 교재, 시험 연결 전에 먼저 연장 상태를 확인하는 것이 좋습니다.</p>
              <div className="course-expiry-summary-list">
                {expiringCourseEntries.slice(0, 4).map(({ course, expiryStatus }) => (
                  <button className="course-expiry-summary-item" key={`expiry-summary-${course.id}`} onClick={() => focusCourseWorkspace(course.id)} type="button">
                    <span>{course.title}</span>
                    <strong>{expiryStatus.summary}</strong>
                  </button>
                ))}
                {expiringCourseEntries.length > 4 ? <span className="status-chip is-warn">{`외 ${expiringCourseEntries.length - 4}개`}</span> : null}
              </div>
            </div>
            <div className="portal-actions">
              <button
                className="primary-btn"
                disabled={!firstExpiringCourseEntry}
                onClick={() => firstExpiringCourseEntry && props.onRequestCourseExtension?.(firstExpiringCourseEntry.course)}
                type="button"
              >
                연장 요청
              </button>
              <button className="ghost-btn" onClick={() => firstExpiringCourseEntry && focusCourseWorkspace(firstExpiringCourseEntry.course.id)} type="button">과정 보기</button>
            </div>
          </section>
        ) : null}

        {focusedJourneyEntry ? (
          <section className="my-learning-journey-dashboard">
            <div className="portal-detail-head">
              <div>
                <p className="card-label">학습 여정 대시보드</p>
                <h4>{focusedJourneyEntry.course.title}</h4>
                <p className="hint">신청부터 설문, 교재/영상, 랩, 시험, 수료증까지 현재 이어갈 작업을 표시합니다.</p>
              </div>
              <div className="portal-chip-row">
                <span className="status-chip is-success">{`${focusedJourneyEntry.progress}%`}</span>
                <span className="status-chip is-muted">{`전체 평균 ${journeyAverageProgress}%`}</span>
              </div>
            </div>
            <div className="my-learning-progress-track" aria-label="학습 여정 진행률">
              <span style={{ width: `${Math.max(0, Math.min(100, focusedJourneyEntry.progress))}%` }} />
            </div>
            <div className="my-learning-journey-steps">
              {focusedJourneyEntry.steps.map((step) => (
                <button
                  className={`my-learning-journey-step ${step.status === "current" ? "is-current" : ""}`}
                  disabled={!step.action}
                  key={`${focusedJourneyEntry.course.id}-${step.key}`}
                  onClick={() => runJourneyAction(focusedJourneyEntry, step.action)}
                  type="button"
                >
                  <span className={`status-chip ${getJourneyStepClass(step.status)}`}>{getJourneyStepLabel(step.status)}</span>
                  <strong>{step.label}</strong>
                </button>
              ))}
            </div>
            <div className="my-learning-next-action">
              <div>
                <p className="card-label">다음 행동</p>
                <strong>{focusedJourneyEntry.nextStep ? focusedJourneyEntry.nextStep.label : "학습 여정 완료"}</strong>
                <p className="hint">
                  {focusedJourneyEntry.nextStep
                    ? `${focusedJourneyEntry.completedCount}/${focusedJourneyEntry.totalCount}단계 완료 · 지금 이어가면 가장 빠르게 다음 단계로 넘어갑니다.`
                    : "수료 흐름이 마무리되었습니다. 수료증과 사후 설문 공유 상태를 확인해 보세요."}
                </p>
              </div>
              <div className="portal-actions">
                <button
                  className="primary-btn"
                  disabled={!focusedJourneyEntry.nextStep?.action}
                  onClick={() => runJourneyAction(focusedJourneyEntry, focusedJourneyEntry.nextStep?.action)}
                  type="button"
                >
                  이어가기
                </button>
                <button className="ghost-btn" onClick={() => props.setSection?.("llm")} type="button">AI 코치 열기</button>
              </div>
            </div>
            {journeyWatchEntries.length ? (
              <div className="my-learning-journey-watchlist">
                {journeyWatchEntries.map((entry) => (
                  <button className="my-learning-journey-watch-item" key={`journey-watch-${entry.course.id}`} onClick={() => focusCourseWorkspace(entry.course.id)} type="button">
                    <span>{entry.course.title}</span>
                    <strong>{`${entry.progress}%`}</strong>
                    <small>{entry.nextStep ? `다음: ${entry.nextStep.label}` : "완료"}</small>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="my-learning-hero">
          <article
            className={`simple-info-block my-learning-hero-card current-lab-card ${currentLabCardHighlighted ? "is-highlighted" : ""}`}
            ref={currentLabCardRef}
          >
            <div className="portal-detail-head">
              <div>
                <p className="card-label">현재 선택한 랩</p>
                <h4>{displayCourse?.title || (displayLab ? displayLab.courseTitle || "선택한 과정" : "실행 중인 랩 없음")}</h4>
              </div>
              <div className="portal-chip-row">
                <span className={`status-chip ${displayLab?.status === "running" ? "is-success" : displayLab ? "is-warn" : "is-muted"}`}>
                  {displayLab ? labStatus(displayLab.status) : "대기"}
                </span>
                {displayCourse?.courseType === "online" ? <span className="status-chip is-muted">온라인 과정</span> : <span className="status-chip is-muted">일반 과정</span>}
                {displayCourse?.hasEnrollmentRecord ? <span className={`status-chip ${displayCourseExpiryStatus.tone}`}>{displayCourseExpiryStatus.label}</span> : null}
              </div>
            </div>
            {displayLab ? (
              <>
                <div className="simple-status-list compact-status-list">
                  <div>{`대표 IP: ${displayLabIpSummary.instanceIp || "-"}`}</div>
                  <div>{`남은 시간: ${formatRemainingTime(displayLab.expiresAt)}`}</div>
                  {displayCourse?.hasEnrollmentRecord ? <div>{`수강 기간: ${displayCourseExpiryStatus.summary}`}</div> : null}
                  <div>{`공개 URL: ${publicDomains.length}개 / 요청 도메인 ${requestedDomains.length}개`}</div>
                  <div>{`외부 SSH: ${externalSshLabel}`}</div>
                </div>
                {displayCourseNeedsExtension ? (
                  <div className={`course-expiry-alert ${displayCourseExpiryStatus.expired ? "is-expired" : ""}`}>
                    <div>
                      <strong>{displayCourseExpiryStatus.expired ? "수강 기간이 만료되었습니다." : "수강 만료가 가까워졌습니다."}</strong>
                      <span>{displayCourseExpiryStatus.summary}</span>
                    </div>
                    <button className="mini-btn primary-mini-btn" onClick={() => props.onRequestCourseExtension?.(displayCourse)} type="button">연장 요청</button>
                  </div>
                ) : null}
                {hasAdminReviewRequiredFeature ? <div className="inline-message is-info">{ADMIN_REVIEW_REQUIRED_MESSAGE}</div> : null}
                {publicDomainUrls.length ? (
                  <div className="my-learning-link-list">
                    <strong>공개 URL</strong>
                    <div className="my-learning-link-stack">
                      {publicDomainUrls.map((url) => (
                        <a className="hint mono-link" href={url} key={url} rel="noreferrer" target="_blank">{url}</a>
                      ))}
                    </div>
                    <div className="portal-actions">
                      <button className="mini-btn" onClick={() => copyQuickValue(publicDomainUrls.join("\n"))} type="button">URL 복사</button>
                      {publicDomainUrls.length === 1 ? <a className="mini-btn" href={publicDomainUrls[0]} rel="noreferrer" target="_blank">URL 열기</a> : null}
                    </div>
                  </div>
                ) : null}
                {requestedDomainUrls.length ? (
                  <div className="my-learning-link-list">
                    <strong>요청 도메인 URL</strong>
                    <span className="hint">{ADMIN_REVIEW_REQUIRED_MESSAGE}</span>
                    <div className="my-learning-link-stack">
                      {requestedDomainUrls.map((url) => (
                        <span className="hint mono-link" key={url}>{url}</span>
                      ))}
                    </div>
                    <div className="portal-actions">
                      <button className="mini-btn" onClick={() => copyQuickValue(requestedDomainUrls.join("\n"))} type="button">요청 URL 복사</button>
                    </div>
                  </div>
                ) : null}
                {displayLab?.externalSshRequestPending ? (
                  <div className="my-learning-link-list">
                    <strong>외부 SSH 요청</strong>
                    <span className="hint">{ADMIN_REVIEW_REQUIRED_MESSAGE}</span>
                  </div>
                ) : null}
                {displayLab?.externalRdpRequestPending ? (
                  <div className="my-learning-link-list">
                    <strong>외부 RDP 요청</strong>
                    <span className="hint">{ADMIN_REVIEW_REQUIRED_MESSAGE}</span>
                  </div>
                ) : null}
                {externalSshCommand ? (
                  <div className="my-learning-link-list">
                    <strong>외부 SSH</strong>
                    <div className="my-learning-link-stack">
                      {externalSshTargets.map((target) => (
                        <div key={`external-ssh-${target.name}-${target.label}`} className="my-learning-link-stack">
                          <strong>{target.name}</strong>
                          {target.methods?.length ? target.methods.map((method) => (
                            <div className="my-learning-method-row" key={`external-ssh-${target.name}-${method.kind}`}>
                              <span className="status-chip is-muted">{method.label}</span>
                              <span className="hint mono-link">{method.command}</span>
                              <span className="hint mono-link">{method.value}</span>
                            </div>
                          )) : target.commands.map((line, index) => (
                            <span className="hint mono-link" key={`external-ssh-${target.name}-${index}`}>{line}</span>
                          ))}
                          {target.links.length ? (
                            <span className="hint mono-link">{target.links.join(" | ")}</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <div className="portal-actions">
                      <button className="mini-btn" onClick={() => copyQuickValue(externalSshCommand)} type="button">{externalSshTargets.length > 1 ? "SSH 전체 복사" : "SSH 복사"}</button>
                      {displayLab?.terminalSshPassword ? <button className="mini-btn" onClick={() => copyQuickValue(displayLab.terminalSshPassword)} type="button">비밀번호 복사</button> : null}
                      {externalSshTargets.length > 1 ? <button className="mini-btn" onClick={() => openQuickLinks(externalSshLinks)} type="button">SSH 전체 열기</button> : null}
                      {externalSshTargets.length === 1 ? <a className="mini-btn" href={externalSshLink} rel="noreferrer" target="_blank">연결</a> : null}
                    </div>
                  </div>
                ) : null}
                {displayLabExamCompleted ? <div className="hint">이 과정은 랩 실습을 이미 완료한 상태입니다. 추가 실습이 필요하면 과정 상세에서 다시 요청해 주세요.</div> : null}
              </>
            ) : (
              <>
                {displayCourse?.hasEnrollmentRecord ? (
                  <div className="simple-status-list compact-status-list">
                    <div>{`수강 기간: ${displayCourseExpiryStatus.summary}`}</div>
                  </div>
                ) : null}
                {displayCourseNeedsExtension ? (
                  <div className={`course-expiry-alert ${displayCourseExpiryStatus.expired ? "is-expired" : ""}`}>
                    <div>
                      <strong>{displayCourseExpiryStatus.expired ? "수강 기간이 만료되었습니다." : "수강 만료가 가까워졌습니다."}</strong>
                      <span>{displayCourseExpiryStatus.summary}</span>
                    </div>
                    <button className="mini-btn primary-mini-btn" onClick={() => props.onRequestCourseExtension?.(displayCourse)} type="button">연장 요청</button>
                  </div>
                ) : null}
                <div className="hint">아직 생성된 랩이 없습니다. 아래 내 과정 카드에서 과정을 선택하고 과정 상세로 이동해 랩을 시작할 수 있습니다.</div>
              </>
            )}
            <div className="admin-inline-actions">
              <button
                className="primary-btn"
                disabled={!displayCourse || !canOpenDisplayCourseTerminal}
                onClick={() => {
                  if (!displayCourse) return;
                  openCourseWorkspace(displayCourse.id, { openTerminal: true });
                }}
                type="button"
              >
                터미널로 이동
              </button>
              <button
                className="ghost-btn"
                disabled={!displayCourse}
                onClick={() => {
                  if (!displayCourse) return;
                  openCourseWorkspace(displayCourse.id, { openDetail: true });
                }}
                type="button"
              >
                과정 상세 보기
              </button>
              <button
                className="ghost-btn"
                disabled={!displayCourse}
                onClick={() => {
                  if (!displayCourse) return;
                  props.setSelectedCourseId?.(Number(displayCourse.id) || displayCourse.id);
                  props.setSection?.("llm");
                }}
                type="button"
              >
                AI 질문
              </button>
              {displayCourseNeedsExtension ? (
                <button
                  className="ghost-btn"
                  onClick={() => displayCourse && props.onRequestCourseExtension?.(displayCourse)}
                  type="button"
                >
                  연장 요청
                </button>
              ) : null}
              <button
                className="ghost-btn danger-ghost-btn"
                disabled={!displayLab || displayLabExamCompleted}
                onClick={() => displayLab && props.onRemoveLab(displayLab.id)}
                type="button"
              >
                {displayLabRemoveLabel}
              </button>
              <button
                className="ghost-btn danger-ghost-btn"
                disabled={!displayCourse || Boolean(displayCourseRevokeBlockedReason)}
                onClick={() => displayCourse && props.onRevokeMyCourseAccess(displayCourse)}
                title={displayCourseRevokeBlockedReason || (isDisplayCoursePaymentEnrollment ? "취소 요청" : "수강 취소")}
                type="button"
              >
                {isDisplayCoursePaymentEnrollment ? "취소 요청" : "수강 취소"}
              </button>
            </div>
            {displayCourseRevokeBlockedReason ? <div className="hint">{displayCourseRevokeBlockedReason}</div> : null}
            {!displayCourseRevokeBlockedReason && isDisplayCoursePaymentEnrollment ? <div className="hint">결제 과정은 취소 사유를 남기면 관리자 승인 후 수강이 종료됩니다.</div> : null}
            {displayCourse && !canOpenDisplayCourseTerminal ? (
              <div className="hint">{displayCourse?.hasAccess === false ? "수강 기간이 만료되어 연장 후 터미널을 사용할 수 있습니다." : "\uD604\uC7AC \uB7A9\uC774 \uC2E4\uD589\uB418\uACE0 \uC788\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uB7A9\uC744 \uC2DC\uC791\uD55C \uB4A4 \uD130\uBBF8\uB110\uB85C \uC774\uB3D9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."}</div>
            ) : displayLab ? (
              <div className="hint">터미널 연결은 `터미널로 이동` 버튼으로 바로 시작할 수 있습니다.</div>
            ) : null}
          </article>

          <article className="simple-info-block my-learning-hero-card">
            <div className="portal-detail-head">
              <div>
                <p className="card-label">내 과정</p>
                <h4>수강 중인 과정 요약</h4>
              </div>
              <div className="portal-chip-row">
                <span className="status-chip is-muted">{`표시 ${visibleEnrolledCourses.length}개`}</span>
                <span className="hint">과정을 선택하면 현재 상태와 이동 가능한 작업을 바로 확인할 수 있습니다.</span>
              </div>
            </div>
            {enrolledCourses.length ? (
              <>
                {useCourseDropdown ? (
                  <div className="my-course-selector">
                    <div className="my-course-selector-head">
                      <label className="card-label" htmlFor="my-course-selector">과정 선택</label>
                      <span className={`status-chip ${selectedSummaryEntry?.courseLab?.status === "running" ? "is-success" : selectedSummaryEntry?.courseLab ? "is-warn" : "is-muted"}`}>
                        {selectedSummaryEntry?.courseLab ? `랩 ${labStatus(selectedSummaryEntry.courseLab.status)}` : "랩 없음"}
                      </span>
                    </div>
                    <select
                      id="my-course-selector"
                      value={String(selectedSummaryEntry?.course?.id || "")}
                      onChange={(event) => focusCourseWorkspace(Number(event.target.value) || event.target.value)}
                      title={selectedSummaryEntry?.course?.title || ""}
                    >
                      {enrolledCourses.map(({ course }) => (
                        <option key={`my-course-option-${course.id}`} value={course.id} title={course.title}>
                          {truncateMiddleText(course.title, 34)}
                        </option>
                      ))}
                    </select>
                    {selectedSummaryEntry?.course ? (
                      <div className="my-course-selector-summary">
                        <strong title={selectedSummaryEntry.course.title}>{selectedSummaryEntry.course.title}</strong>
                        <span>
                          {selectedSummaryEntry.courseLab
                            ? `현재 랩 상태: ${labStatus(selectedSummaryEntry.courseLab.status)}`
                            : "현재 랩 상태: 랩 없음"}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {selectedSummaryEntry ? (() => {
                  const { course, courseLab, courseLabIpSummary, courseExamInfo, labExamCompleted } = selectedSummaryEntry;
                  const isActiveCourse = isSameCourseId(course.id, props.selectedCourseId || activeLab?.courseId);
                  const courseExpiryStatus = getCourseAccessExpiryStatus(course);
                  const courseNeedsExtension = Boolean(course.hasEnrollmentRecord && courseExpiryStatus.needsExtension);
                  const canOpenTerminal = course.hasAccess !== false && String(courseLab?.status || "").toLowerCase() === "running" && !labExamCompleted;
                  const courseLabBackendType = String(courseLab?.labBackendType || course.labBackendType || "vm").trim().toLowerCase();
                  const courseLabRemoveLabel = courseLabBackendType === "container" ? "컨테이너 제거" : "랩 종료";
                  const isPaymentEnrollment = String(course.enrollmentGrantedVia || "").trim().toLowerCase() === "payment";
                  const revokeBlockedReason = courseLab
                    ? "실행 중이거나 대기 중인 랩을 먼저 종료해 주세요."
                    : "";
                  return (
                    <div className={`my-course-summary-list ${useCourseDropdown ? "is-single" : ""}`}>
                      <article
                        className={`my-course-summary-card ${isActiveCourse ? "is-active" : ""}`}
                        key={`my-course-${course.id}`}
                        aria-current={isActiveCourse ? "true" : undefined}
                      >
                        <button className="my-course-summary-main" onClick={() => focusCourseWorkspace(course.id)} type="button">
                          <div className="my-course-summary-head">
                            <div className="my-course-summary-copy">
                              <strong>{course.title}</strong>
                              <div className="hint">{`${course.category || "일반"} / ${course.level || "난이도 미정"}`}</div>
                            </div>
                            <div className="portal-chip-row my-course-summary-state">
                              <span className={`status-chip ${courseLab?.status === "running" ? "is-success" : courseLab ? "is-warn" : "is-muted"}`}>
                                {courseLab ? `랩 ${labStatus(courseLab.status)}` : "랩 없음"}
                              </span>
                              {courseExamInfo.hasAnyExam ? <span className="status-chip is-muted">시험 포함</span> : null}
                              {course.hasEnrollmentRecord ? <span className={`status-chip ${courseExpiryStatus.tone}`}>{courseExpiryStatus.label}</span> : null}
                            </div>
                          </div>
                          <div className="simple-status-list compact-status-list my-course-summary-meta">
                            <div>{`기간: ${formatCourseDuration(course.duration)}`}</div>
                            {course.hasEnrollmentRecord ? <div>{`수강 기간: ${courseExpiryStatus.summary}`}</div> : null}
                            <div>{`대표 IP: ${courseLabIpSummary.instanceIp || "-"}`}</div>
                          </div>
                          <div className="portal-chip-row my-course-summary-badges">
                            {getCourseBackendBadges(courseLab || course).map((chip) => (
                              <span className={`status-chip ${chip.tone || "is-muted"}`} key={`my-course-backend-${course.id}-${chip.label}`}>
                                {chip.label}
                              </span>
                            ))}
                          </div>
                        </button>
                        <div className="portal-actions my-course-summary-actions">
                          <button className={canOpenTerminal ? "mini-btn primary-mini-btn" : "mini-btn"} disabled={!canOpenTerminal} onClick={() => openCourseWorkspace(course.id, { openTerminal: true })} type="button">
                            터미널
                          </button>
                          {courseNeedsExtension ? (
                            <button className="mini-btn primary-mini-btn" onClick={() => props.onRequestCourseExtension?.(course)} type="button">연장 요청</button>
                          ) : null}
                          <button className="mini-btn" onClick={() => openCourseWorkspace(course.id, { openDetail: true })} type="button">과정 상세</button>
                          <button
                            className="mini-btn danger-mini-btn"
                            disabled={!courseLab || labExamCompleted}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (courseLab) props.onRemoveLab(courseLab.id);
                            }}
                            type="button"
                          >
                            {courseLabRemoveLabel}
                          </button>
                          <button className="mini-btn danger-mini-btn" disabled={Boolean(revokeBlockedReason)} onClick={() => props.onRevokeMyCourseAccess(course)} title={revokeBlockedReason || (isPaymentEnrollment ? "취소 요청" : "수강 취소")} type="button">{isPaymentEnrollment ? "취소 요청" : "수강 취소"}</button>
                        </div>
                        {revokeBlockedReason ? <div className="hint">{revokeBlockedReason}</div> : isPaymentEnrollment ? <div className="hint">결제 과정은 취소 사유를 남기면 관리자 승인 후 수강이 종료됩니다.</div> : null}
                        {courseNeedsExtension ? <div className="hint">{courseExpiryStatus.helper}</div> : null}
                      </article>
                    </div>
                  );
                })() : null}
              </>
            ) : <div className="hint">현재 접근 가능한 과정이 없습니다.</div>}
            {enrolledCourses.length > 1 ? (
              <div className="my-course-summary-footer">
                <span className="hint">{`내 과정 ${enrolledCourses.length}개 중 원하는 과정을 선택하면 현재 상태와 바로가기 버튼이 자동으로 바뀝니다.`}</span>
                <button className="mini-btn" onClick={() => props.setSection?.("courses")} type="button">과정 전체 보기</button>
              </div>
            ) : null}
          </article>
        </div>
      </section>

      <section className="portal-stack">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">추가 자원</p>
            <h3>별도로 생성한 실습 자원 현황</h3>
            <p className="hint">현재 내 계정 기준으로 교육 랩, 사용자 가상머신, 컨테이너, 클러스터, 데이터베이스를 빠르게 확인할 수 있습니다.</p>
          </div>
        </div>
        {portalUiV2Active ? (
          <section className="my-resource-workbench" aria-label="내 실습 자원 통합 작업대">
            <div className="my-resource-workbench-head">
              <div>
                <p className="card-label">RESOURCE WORKBENCH</p>
                <h3>내 자원 작업대</h3>
                <p className="hint">교육 랩, 사용자 가상머신, 컨테이너, 클러스터, 데이터베이스를 같은 생명주기와 버튼 흐름으로 확인합니다.</p>
              </div>
              <button className="mini-btn primary-mini-btn" onClick={openCloudConsoleOverview} type="button">
                클라우드 콘솔
              </button>
            </div>
            <div className="my-resource-workbench-summary" aria-label="자원 요약">
              {resourceWorkbenchMetrics.map((item) => (
                <div className={`my-resource-workbench-metric is-${item.key}`} key={`resource-workbench-metric-${item.key}`}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
            <div className="my-resource-lifecycle-flow" aria-label="자원 생명주기">
              {resourceLifecycleStages.map((item) => (
                <div className={`my-resource-lifecycle-node ${item.value ? "is-active" : ""} is-${item.key}`} key={`resource-lifecycle-stage-${item.key}`}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
            <section className={`my-resource-workbench-triage ${resourceWorkbenchActionRows.length ? "has-attention" : "is-calm"}`} aria-label="자원 우선 확인">
              <div className="my-resource-workbench-triage-head">
                <div>
                  <p className="card-label">ACTION GATE</p>
                  <h4>먼저 확인할 자원</h4>
                  <p className="hint">실패, 정리 대기, 생성 중 자원을 먼저 보여줘서 중복 요청과 잔여 자원 누수를 줄입니다.</p>
                </div>
                <div className="my-resource-workbench-triage-actions">
                  <button className="mini-btn primary-mini-btn" onClick={openCloudConsoleOverview} type="button">전체 관리</button>
                  <button className="mini-btn" onClick={() => props.setSection?.("messages")} type="button">운영지원</button>
                </div>
              </div>
              <div className="my-resource-workbench-triage-grid" aria-label="우선 확인 요약">
                {resourceWorkbenchTriageMetrics.map((item) => (
                  <div className={`my-resource-workbench-triage-metric is-${item.tone}`} key={`resource-triage-metric-${item.key}`}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
              {resourceWorkbenchActionRows.length ? (
                <div className="my-resource-workbench-triage-list">
                  {resourceWorkbenchActionRows.map((item) => {
                    const lifecycle = getResourceLifecycle(item.status);
                    const guidance = getResourceWorkbenchGuidance(item);
                    const primaryAction = (item.actions || []).find((action) => !action.disabled && action.primary)
                      || (item.actions || []).find((action) => !action.disabled);
                    return (
                      <article className={`my-resource-workbench-triage-item is-${guidance.tone}`} key={`resource-triage-${item.key}`}>
                        <span className={`my-resource-triage-dot is-${guidance.tone}`}>{item.icon}</span>
                        <div>
                          <div className="my-resource-workbench-triage-title">
                            <strong>{item.title}</strong>
                            <span className={`status-chip ${lifecycle.tone}`}>{item.statusText || lifecycle.label}</span>
                          </div>
                          <small>{`${item.label} · ${guidance.title}`}</small>
                          <p>{guidance.detail}</p>
                        </div>
                        <div className="my-resource-workbench-triage-row-actions">
                          {primaryAction ? (
                            <button
                              className={`mini-btn ${primaryAction.primary ? "primary-mini-btn" : ""} ${primaryAction.danger ? "danger-mini-btn" : ""}`}
                              onClick={primaryAction.onClick}
                              type="button"
                            >
                              {primaryAction.label}
                            </button>
                          ) : null}
                          <button className="mini-btn" onClick={() => props.setSection?.("messages")} type="button">{guidance.actionLabel}</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="my-resource-workbench-triage-empty">
                  <strong>바로 조치할 자원은 없습니다.</strong>
                  <p>사용 가능한 자원은 작업대 카드에서 바로 열 수 있고, 작업 후에는 삭제/종료로 정리할 수 있습니다.</p>
                </div>
              )}
            </section>
            <div className="my-resource-workbench-grid">
              {visibleWorkbenchRows.length ? visibleWorkbenchRows.map((item) => {
                const lifecycle = getResourceLifecycle(item.status);
                const stage = getResourceLifecycleStage(item.status);
                return (
                  <article className={`my-resource-workbench-card is-${item.kind} stage-${stage}`} key={item.key}>
                    <div className="my-resource-workbench-card-top">
                      <span className={`my-resource-kind-icon is-${item.kind}`}>{item.icon}</span>
                      <div>
                        <p className="card-label">{item.label}</p>
                        <h4>{item.title}</h4>
                      </div>
                      <span className={`status-chip ${lifecycle.tone}`}>{item.statusText || lifecycle.label}</span>
                    </div>
                    <p>{item.detail || "상세 정보는 관리 화면에서 확인할 수 있습니다."}</p>
                    <div className="my-resource-workbench-actions">
                      {(item.actions || []).map((action) => (
                        <button
                          className={`mini-btn ${action.primary ? "primary-mini-btn" : ""} ${action.danger ? "danger-mini-btn" : ""}`}
                          disabled={Boolean(action.disabled)}
                          key={`${item.key}-action-${action.key}`}
                          onClick={action.onClick}
                          type="button"
                        >
                          {action.label}
                        </button>
                      ))}
                      <button className="mini-btn" onClick={() => props.setSection?.("messages")} type="button">문의</button>
                    </div>
                  </article>
                );
              }) : (
                <article className="my-resource-workbench-empty">
                  <strong>생성된 실습 자원이 없습니다.</strong>
                  <p>클라우드 콘솔에서 VM, 네트워크, 컨테이너, 클러스터, 데이터베이스를 요청하면 이곳에 모입니다.</p>
                  <button className="mini-btn primary-mini-btn" onClick={openCloudConsoleOverview} type="button">새 자원 신청</button>
                </article>
              )}
            </div>
            {resourceWorkbenchRows.length > visibleWorkbenchRows.length ? (
              <div className="my-resource-workbench-footer">
                <span className="hint">{`표시 ${visibleWorkbenchRows.length}개 / 전체 ${resourceWorkbenchRows.length}개`}</span>
                <button className="mini-btn" onClick={openCloudConsoleOverview} type="button">전체 보기</button>
              </div>
            ) : null}
          </section>
        ) : null}
        <div className="resource-lifecycle-strip">
          {labResourceLifecycleItems.length ? labResourceLifecycleItems.map((item) => {
            const lifecycle = getResourceLifecycle(item.status);
            return (
              <article className="resource-lifecycle-card" key={item.key}>
                <span>{item.label}</span>
                <strong>{item.title}</strong>
                <div className="portal-chip-row">
                  <span className={`status-chip ${lifecycle.tone}`}>{lifecycle.label}</span>
                  <small>{item.cleanup}</small>
                </div>
              </article>
            );
          }) : (
            <article className="resource-lifecycle-card is-empty">
              <span>정리됨</span>
              <strong>현재 남아 있는 확장 자원이 없습니다.</strong>
              <small>생성한 사용자 가상머신, 컨테이너, 클러스터, 데이터베이스, 고급 랩 구성이 이곳에 모입니다.</small>
            </article>
          )}
        </div>
        <div className="resource-grid">
          <article className="simple-panel">
            <div className="portal-detail-head">
              <div>
                <p className="card-label">사용자 가상머신</p>
                <h3>{activeVm ? activeVm.stackName || activeVm.flavor : "생성 중인 VM 없음"}</h3>
              </div>
            </div>
            {activeVm ? (
              <div className="simple-status-list">
                <div>{`상태: ${labStatus(activeVm.status)}`}</div>
                <div>{`Flavor: ${activeVm.flavor}`}</div>
                <FlavorBadges flavor={activeVm.flavor} />
                <div>{`인스턴스: ${activeVm.instanceCount || 1}`}</div>
                <div>{`cloud-init: ${activeVm.cloudInitTemplateName || "-"}`}</div>
                <div>{`IP: ${activeVm.instanceIp || "-"}`}</div>
              </div>
            ) : (
              <div className="hint">현재 생성했거나 예약된 가상머신이 없습니다.</div>
            )}
            <div className="admin-inline-actions">
              <button className="mini-btn" onClick={() => openResourceManagement("selfServiceVm", { action: "instance", tab: "instances" })} type="button">VM 관리</button>
              {activeVm ? <button className="mini-btn danger-mini-btn" onClick={() => props.onTerminateSelfServiceVm(activeVm.id)} type="button">{activeVm.status === "requested" ? "요청 취소" : "가상머신 삭제"}</button> : null}
            </div>
          </article>

          <article className="simple-panel">
            <div className="portal-detail-head">
              <div>
                <p className="card-label">컨테이너</p>
                <h3>{activeContainer ? activeContainer.name : "실행 중인 컨테이너 없음"}</h3>
              </div>
            </div>
            {activeContainer ? (
              <div className="simple-status-list">
                <div>{`상태: ${renderZunStatus(activeContainer.status)}`}</div>
                <div>{`이미지: ${activeContainer.imageName}`}</div>
                <div>{`노출 포트: ${activeContainer.exposedPort || "-"}`}</div>
                <div>{`주소: ${activeContainer.addresses?.map((item) => item.address).join(", ") || "-"}`}</div>
              </div>
            ) : (
              <div className="hint">현재 생성했거나 예약된 컨테이너가 없습니다.</div>
            )}
            <div className="admin-inline-actions">
              {activeContainer?.containerUuid && ["running", "creating"].includes(String(activeContainer.status || "").toLowerCase()) ? <button className="mini-btn primary-mini-btn" onClick={() => props.onCreateZunContainerTerminalSession?.(activeContainer.id)} type="button">웹 콘솔</button> : null}
              {activeContainer && ["running", "creating"].includes(activeContainer.status) ? <button className="mini-btn stop-btn" onClick={() => props.onStopZunContainer(activeContainer.id)} type="button">중지</button> : null}
              {activeContainer && ["stopped", "failed"].includes(activeContainer.status) ? <button className="mini-btn start-btn" onClick={() => props.onStartZunContainer(activeContainer.id)} type="button">시작</button> : null}
              {activeContainer ? <button className="mini-btn" onClick={() => props.onRefreshZunContainer?.(activeContainer.id)} type="button">갱신</button> : null}
              {activeContainer && String(activeContainer.status || "").toLowerCase() === "running" && activeContainer.exposedPort ? <button className="mini-btn" onClick={() => props.onPublishZunContainerDomain?.(activeContainer.id, {})} type="button">도메인 추가</button> : null}
              {activeContainer ? <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteZunContainer?.(activeContainer.id)} type="button">삭제</button> : null}
            </div>
          </article>

          <article className="simple-panel">
            <div className="portal-detail-head">
              <div>
                <p className="card-label">고급 랩 구성</p>
                <h3>{latestCustomLab ? latestCustomLab.title : "진행 중인 구성 없음"}</h3>
              </div>
            </div>
            {latestCustomLab ? (
              <div className="simple-status-list">
                <div>{`상태: ${getCustomLabStatusLabel(latestCustomLab.status)}`}</div>
                <div>{`수량: ${latestCustomLab.instanceCount || 1}`}</div>
                <div>{`사양: ${latestCustomLab.vcpu} vCPU / ${latestCustomLab.ramGb}GB / ${latestCustomLab.diskGb}GB`}</div>
                <div>{`사용 기간: ${latestCustomLab.usagePeriod || "-"}`}</div>
                <div>{`cloud-init: ${latestCustomLab.cloudInitTemplateName || "-"}`}</div>
                {latestCustomLab.instanceIp ? <div>{`IP: ${latestCustomLab.instanceIp}`}</div> : null}
                {latestCustomLab.stackName ? <div>{`Stack: ${latestCustomLab.stackName}`}</div> : null}
              </div>
            ) : (
              <div className="hint">진행 중인 고급 랩 구성이 없습니다.</div>
            )}
            <div className="admin-inline-actions">
              <button className="mini-btn" onClick={() => openResourceManagement("customLabs", { action: "instance", tab: "instances" })} type="button">고급 랩 관리</button>
              {latestCustomLab && ["requested", "quoted", "confirmed"].includes(latestCustomLab.status) ? (
                <button className="mini-btn" onClick={() => props.onCancelCustomLabRequest(latestCustomLab.id)} type="button">구성 취소</button>
              ) : null}
              {latestCustomLab && latestCustomLab.status === "running" ? (
                <button className="mini-btn danger-mini-btn" onClick={() => props.onTerminateCustomLabRequest(latestCustomLab.id)} type="button">고급 랩 종료</button>
              ) : null}
            </div>
          </article>

          <article className="simple-panel">
            <div className="portal-detail-head">
              <div>
                <p className="card-label">쿠버네티스 클러스터</p>
                <h3>{activeMagnumCluster ? activeMagnumCluster.name : "생성 중인 클러스터 없음"}</h3>
              </div>
            </div>
            {activeMagnumCluster ? (
              <div className="simple-status-list">
                <div>{`상태: ${activeMagnumCluster.status}`}</div>
                <div>{`CAPO 프로파일: ${activeMagnumCluster.clusterTemplateName || activeMagnumCluster.clusterTemplateId}`}</div>
                <div>{`노드 수: control-plane ${activeMagnumCluster.masterCount} / worker ${activeMagnumCluster.nodeCount}`}</div>
                <div>{`Flavor: control-plane ${activeMagnumCluster.controlPlaneFlavor || "-"} / worker ${activeMagnumCluster.workerFlavor || "-"}`}</div>
                <div>{`내부 API 주소: ${activeMagnumCluster.apiAddress ? `https://${activeMagnumCluster.apiAddress}:${activeMagnumCluster.apiPort || 6443}` : "-"}`}</div>
                <div>{`외부 API 주소: ${activeMagnumCluster.externalApiEnabled && activeMagnumCluster.externalApiHost && activeMagnumCluster.externalApiPort ? `https://${activeMagnumCluster.externalApiHost}:${activeMagnumCluster.externalApiPort}` : "사용 안 함"}`}</div>
              </div>
            ) : (
              <div className="hint">현재 생성했거나 예약된 쿠버네티스 클러스터가 없습니다.</div>
            )}
            <div className="admin-inline-actions">
              <button className="mini-btn" onClick={() => openResourceManagement("magnum", { action: "cluster", tab: "clusters" })} type="button">클러스터 관리</button>
              {activeMagnumCluster?.clusterUuid ? <button className="mini-btn" onClick={() => props.onDownloadMagnumKubeconfig(activeMagnumCluster.id)} type="button">kubeconfig 다운로드</button> : null}
              {activeMagnumCluster?.clusterUuid ? <KubectlDownloadMenu /> : null}
              {activeMagnumCluster ? <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteMagnumCluster(activeMagnumCluster.id)} type="button">삭제</button> : null}
            </div>
          </article>

          <article className="simple-panel">
            <div className="portal-detail-head">
              <div>
                <p className="card-label">데이터베이스</p>
                <h3>{activeTroveInstance ? activeTroveInstance.name : "생성 중인 DB 없음"}</h3>
              </div>
            </div>
            {activeTroveInstance ? (
              <div className="simple-status-list">
                <div>{`상태: ${getResourceLifecycle(activeTroveInstance.status).label}`}</div>
                <div>{`Datastore: ${activeTroveInstance.datastoreType || "-"}`}</div>
                <div>{`Flavor: ${activeTroveInstance.flavor || "-"}`}</div>
                <div>{`볼륨: ${activeTroveInstance.sizeGb || "-"} GB`}</div>
                <div>{`Hostname: ${activeTroveInstance.hostname || "-"}`}</div>
              </div>
            ) : (
              <div className="hint">현재 생성했거나 예약된 데이터베이스가 없습니다.</div>
            )}
            <div className="admin-inline-actions">
              <button className="mini-btn" onClick={() => openResourceManagement("trove", { action: "database", tab: "databases" })} type="button">DB 관리</button>
              {activeTroveInstance ? <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteTroveInstance(activeTroveInstance.id)} type="button">삭제</button> : null}
            </div>
          </article>
        </div>
      </section>
    </section>
  );
}
