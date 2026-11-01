import { useEffect, useMemo, useRef, useState } from "react";
import { Field, OtpQrPreview, CoursePriceMeta, SiteFooter, StatusMessage, formatCourseDuration, formatDateTime, getCourseDisplayIcon, getCourseProgramTypeDisplay, getCourseTypeDisplayLabel, getYoutubeLoopEmbedUrl, isGovernmentCourse, resolveCourseSurveyConfig } from "./portal-shared.jsx";
import { Suspense, lazy } from "react";
import { api } from "./portal-state.js";
import { TerminalLabBrand, getTerminalLabFaviconHref } from "./terminal-lab-logo.jsx";
const LANDING_CLASS_LIMIT = 50;
const LOGIN_DIALOG_FOCUSABLE_SELECTOR = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
const GuideMarkdownBlock = lazy(() => import("./guide-renderer.jsx"));
const TEMP_LANDING_STEPS = [{
  number: "01",
  title: "과정 선택",
  copy: "원하는 기술과 난이도를 고르고 실습을 시작합니다."
}, {
  number: "02",
  title: "실습 환경 즉시 생성",
  copy: "격리된 VM과 컨테이너가 브라우저 안에 준비됩니다."
}, {
  number: "03",
  title: "터미널에서 바로 실행",
  copy: "교안을 따라 명령을 실행하고 결과를 바로 확인합니다."
}];
const TEMP_LANDING_COURSES = [{
  id: "linux",
  title: "Linux 운영 기초",
  category: "Linux",
  summary: "Linux 시스템을 이해하고 기본 운영 능력을 갖춥니다."
}, {
  id: "kubernetes",
  title: "Kubernetes 클러스터 실습",
  category: "Kubernetes",
  summary: "클러스터를 직접 구성하고 워크로드를 운영합니다."
}, {
  id: "openstack",
  title: "OpenStack 인프라 운영",
  category: "OpenStack",
  summary: "클라우드 구성 요소를 이해하고 인프라를 관리합니다."
}];
function TemporaryLandingContent({
  courses,
  onLogin,
  onQuote,
  onStart
}) {
  const [courseFilter, setCourseFilter] = useState("전체");
  const courseFilters = ["전체", "Linux", "Kubernetes", "OpenStack", "DevOps"];
  const availableCourses = courses.length ? courses.slice(0, 6).map(course => ({
    ...course,
    category: course.category || (course.title?.toLowerCase().includes("kubernetes") ? "Kubernetes" : course.title?.toLowerCase().includes("openstack") ? "OpenStack" : "Linux")
  })) : TEMP_LANDING_COURSES;
  const filteredCourses = courseFilter === "전체" ? availableCourses : availableCourses.filter(course => String(course.category || "").toLowerCase().includes(courseFilter.toLowerCase()));
  const visibleCourses = (filteredCourses.length ? filteredCourses : availableCourses).slice(0, 3);
  const scrollToId = id => document.getElementById(id)?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
  return <div className="temp-landing">
      <section className="temp-landing-hero">
        <header className="temp-landing-nav">
          <button className="temp-brand" onClick={() => window.scrollTo({
          top: 0,
          behavior: "smooth"
        })} type="button"><span aria-hidden="true">&gt;_</span><strong>KIKI OS TERMINAL-LAB</strong></button>
          <nav aria-label="랜딩 페이지 메뉴"><button onClick={() => scrollToId("temp-platform")} type="button">플랫폼</button><button onClick={() => scrollToId("temp-courses")} type="button">과정</button><button onClick={onQuote} type="button">기업교육</button></nav>
          <div className="temp-nav-actions"><button className="temp-nav-login" onClick={onLogin} type="button">로그인</button><button className="temp-button temp-button-accent" onClick={onStart} type="button">무료로 시작하기</button></div>
        </header>

        <div className="temp-hero-grid">
          <div className="temp-hero-copy">
            <h1>인프라를 배우는 가장 빠른 방법,<br /><em>직접 실행하는 것.</em></h1>
            <p>복잡한 설치 없이 브라우저에서 실습 환경을 열고,<br />실제 터미널과 교안을 한 화면에서 경험하세요.</p>
            <div className="temp-hero-actions"><button className="temp-button temp-button-accent" onClick={onStart} type="button">무료로 시작하기</button><button className="temp-button temp-button-outline" onClick={() => scrollToId("temp-platform")} type="button">실습 환경 둘러보기</button></div>
          </div>

          <div aria-label="터미널랩 실습 환경 미리보기" className="temp-product-window">
            <div className="temp-window-bar"><i /><i /><i /><span>apps.example.com</span></div>
            <div className="temp-product-grid">
              <aside className="temp-lesson-rail">
                <div><strong>01. Kubernetes 기초</strong><span>5 / 9</span></div>
                {["Kubernetes 소개", "kubectl 설치 확인", "클러스터 정보 확인", "노드 확인", "파드 생성", "서비스 생성"].map((step, index) => <button className={index === 4 ? "is-active" : ""} key={step} type="button"><b>{index + 1}</b>{step}</button>)}
              </aside>
              <div className="temp-terminal-pane">
                <div className="temp-terminal-tabs"><strong>터미널 1</strong><span>터미널 2</span></div>
                <div className="temp-terminal-output"><p><b>student@lab:~$</b> kubectl get nodes</p><p>NAME&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;STATUS&nbsp;&nbsp;ROLES</p><p>control-plane&nbsp;&nbsp;Ready&nbsp;&nbsp;&nbsp;control-plane</p><p>worker-1&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Ready&nbsp;&nbsp;&nbsp;&lt;none&gt;</p><p><b>student@lab:~$</b> kubectl run nginx --image=nginx</p><p>pod/nginx created</p><p><b>student@lab:~$</b> kubectl get pods</p><p>nginx&nbsp;&nbsp;1/1&nbsp;&nbsp;<mark>Running</mark>&nbsp;&nbsp;0&nbsp;&nbsp;8s</p><p className="temp-terminal-success">✓ 명령이 성공적으로 실행되었습니다.</p></div>
              </div>
              <aside className="temp-resource-rail">
                <div><strong>실습 환경</strong><span>● 실행 중</span></div><h3>VM</h3>
                {["control-plane", "worker-1", "worker-2"].map(node => <p key={node}><b>{node}</b><span>● Running</span></p>)}
                <h3>컨테이너</h3>{["kube-apiserver", "etcd", "nginx"].map(node => <p key={node}><b>{node}</b><span>● Running</span></p>)}
              </aside>
            </div>
          </div>
        </div>
      </section>

      <section className="temp-workflow-section" id="temp-platform">
        <div className="temp-section-head"><h2>브라우저 하나로 완성하는 실습 경험</h2><p>과정을 고르면 환경이 준비되고, 교안을 따라 명령을 실행하면 결과가 바로 기록됩니다.</p></div>
        <div className="temp-step-rail">{TEMP_LANDING_STEPS.map(step => <article key={step.number}><b>{step.number}</b><div><h3>{step.title}</h3><p>{step.copy}</p></div></article>)}</div>
        <div className="temp-workflow-preview"><aside><strong>리눅스 기초 다루기</strong>{["환경 소개", "파일 및 디렉터리 기본", "현재 디렉터리 확인", "파일 목록 조회", "디렉터리 이동"].map((item, index) => <span className={index === 2 ? "is-active" : ""} key={item}>{index + 1}. {item}</span>)}</aside><div><strong>3. 현재 디렉터리 확인</strong><p>현재 위치한 디렉터리를 확인해 봅니다.</p><code>pwd</code><small>현재 작업 중인 디렉터리의 절대 경로가 출력됩니다.</small></div><pre><b>user@lab-7f3c9d:~$</b> pwd{"\n"}/home/user{"\n\n"}<b>user@lab-7f3c9d:~$</b> ls -la{"\n"}drwxr-xr-x  projects{"\n"}-rw-r--r--  notes.txt{"\n\n"}<mark>✓ 명령이 성공적으로 실행되었습니다.</mark></pre></div>
      </section>

      <section className="temp-ops-section">
        <div className="temp-ops-grid"><div><h2>교육 운영까지,<br />하나의 콘솔에서.</h2><p>수강생의 환경, 진행 상태, 리소스를 실시간으로 확인하고 필요한 순간에 바로 지원하세요.</p></div><div className="temp-ops-table" role="table" aria-label="수강생 실습 현황"><div role="row"><span>수강생</span><span>과정</span><span>환경</span><span>진행률</span><span>상태</span></div>{[["박서준", "리눅스 기초 다루기", "VM", "65%", "실습 중"], ["김민지", "Docker 시작하기", "컨테이너", "100%", "완료"], ["이도윤", "네트워크 이해하기", "VM", "30%", "지원 요청"]].map(row => <div key={row[0]} role="row">{row.map((cell, index) => <span className={index === 4 ? "is-status" : ""} key={cell}>{cell}</span>)}</div>)}</div></div>
        <div className="temp-proof-rail"><span>VM·컨테이너 통합</span><span>과정별 환경 자동화</span><span>실시간 운영 지원</span></div>
      </section>

      <section className="temp-course-section" id="temp-courses">
        <div className="temp-course-intro"><h2>배우고 싶은 기술을,<br />바로 실습하세요.</h2><p>Linux부터 Kubernetes, OpenStack, CI/CD까지 실제 환경으로 익히는 과정을 만나보세요.</p><a href="/?curriculum=2026">전체 과정 보기 <span aria-hidden="true">→</span></a></div>
        <div className="temp-course-browser"><div className="temp-course-filters" role="tablist" aria-label="과정 분류">{courseFilters.map(filter => <button aria-selected={courseFilter === filter} className={courseFilter === filter ? "is-active" : ""} key={filter} onClick={() => setCourseFilter(filter)} role="tab" type="button">{filter}</button>)}</div><div className="temp-course-list">{visibleCourses.map((course, index) => <button key={course.id} onClick={onStart} type="button"><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{course.title}</strong><small>{course.summary || "실제 환경에서 핵심 기술을 직접 실행하며 익힙니다."}</small></span><em>{course.category || "Infrastructure"}</em><i aria-hidden="true">→</i></button>)}</div></div>
      </section>

      <section className="temp-conversion-section"><div><h2>첫 번째 환경을<br />열 준비가 됐나요?</h2><p>회원가입 후 브라우저에서 바로 실습을 시작하세요.</p><div><button className="temp-button temp-button-accent" onClick={onStart} type="button">무료로 시작하기</button><button className="temp-button temp-button-outline" onClick={onQuote} type="button">기업교육 문의</button></div></div></section>
    </div>;
}
function getDialogFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(LOGIN_DIALOG_FOCUSABLE_SELECTOR)).filter(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && element.getAttribute("aria-hidden") !== "true";
  });
}
function getLandingEventRange(event) {
  const start = new Date(event?.startAt);
  const end = new Date(event?.endAt || event?.startAt);
  if (Number.isNaN(start.getTime())) return null;
  const safeEnd = Number.isNaN(end.getTime()) || end < start ? start : end;
  const startDay = new Date(start);
  const endDay = new Date(safeEnd);
  startDay.setHours(0, 0, 0, 0);
  endDay.setHours(0, 0, 0, 0);
  return {
    start,
    end: safeEnd,
    startDay,
    endDay
  };
}
export default function PortalLogin(props) {
  const [previewCourseId, setPreviewCourseId] = useState(null);
  const [showResetPasswordForm, setShowResetPasswordForm] = useState(false);
  const [scheduleSummary, setScheduleSummary] = useState([]);
  const [selectedScheduleEvent, setSelectedScheduleEvent] = useState(null);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [termsModalStep, setTermsModalStep] = useState(0);
  const [curriculumFilter, setCurriculumFilter] = useState("all");
  const [quoteInquiryOpen, setQuoteInquiryOpen] = useState(false);
  const [quoteInquiryBusy, setQuoteInquiryBusy] = useState(false);
  const [quoteInquiryStatus, setQuoteInquiryStatus] = useState({
    tone: "",
    message: ""
  });
  const [quoteInquiryForm, setQuoteInquiryForm] = useState({
    companyName: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    interestType: "기업 교육",
    courseTitles: "",
    participantCount: 10,
    desiredTimeline: "",
    requirements: "",
    privacyAgreed: false,
    website: ""
  });
  const authPanelRef = useRef(null);
  const landingCoursesRef = useRef(null);
  const loginUsernameRef = useRef(null);
  const signupNameRef = useRef(null);
  const termsModalRef = useRef(null);
  const termsModalTriggerRef = useRef(null);
  const pendingAuthShortcutRef = useRef("");
  const landingVideoEnabled = props.platformStatus?.landingVideoEnabled !== false;
  const landingScheduleEnabled = props.platformStatus?.landingScheduleEnabled !== false;
  const landingNoticeEnabled = props.platformStatus?.landingNoticeEnabled === true;
  const landingSurveyNoticeEnabled = props.platformStatus?.landingSurveyNoticeEnabled === true;
  const landingCurriculumCollapsedByDefault = props.platformStatus?.landingCurriculumCollapsedByDefault !== false;
  const landingDemoType = props.platformStatus?.landingDemoType === "upload" ? "upload" : "youtube";
  const configuredYoutubeUrl = props.platformStatus?.landingYoutubeUrl || "";
  const landingDemoUrl = getYoutubeLoopEmbedUrl(configuredYoutubeUrl);
  const landingVideoPath = props.platformStatus?.landingVideoPath || "";
  const useUploadedFavicon = props.platformStatus?.faviconMode === "upload" && Boolean(props.platformStatus?.faviconPath);
  const faviconPath = useUploadedFavicon ? props.platformStatus.faviconPath : getTerminalLabFaviconHref();
  const useUploadedBrandLogo = props.platformStatus?.landingLogoMode === "upload" && Boolean(props.platformStatus?.landingLogoPath);
  const landingHeroEyebrow = props.platformStatus?.landingHeroEyebrow || "오픈소스 엔지니어링 랩";
  const landingHeroTitle = props.platformStatus?.landingHeroTitle || "리눅스 인프라 엔지니어를 위한 오픈소스 실습 랩";
  const landingHeroCopy = props.platformStatus?.landingHeroCopy || "Linux/Kubernetes/OpenStack/CI/CD/DEV 자동화 실습을 브라우저 콘솔과 교안으로 한 흐름에서 제공합니다.";
  const landingAuthEyebrow = props.platformStatus?.landingAuthEyebrow || "접속 안내";
  const landingAuthTitle = props.platformStatus?.landingAuthTitle || "로그인 또는 회원가입";
  const landingAuthCopy = props.platformStatus?.landingAuthCopy || "승인된 계정으로 클라우드와 협업 기능을 이용합니다.";
  const landingFreeTitle = props.platformStatus?.landingFreeTitle || "현재 무료로 운영 중입니다";
  const landingFreeSubtitle = props.platformStatus?.landingFreeSubtitle || "회원가입 후 관리자 승인을 받으면 전체 과정과 랩에 접속할 수 있습니다.";
  const landingCustomerLogosTitle = props.platformStatus?.landingCustomerLogosTitle || "함께한 고객";
  const landingCustomerLogos = (Array.isArray(props.platformStatus?.landingCustomerLogos) ? props.platformStatus.landingCustomerLogos : []).filter(logo => logo?.visible !== false && String(logo?.imagePath || "").trim()).slice(0, 12);
  const showLandingCustomerLogos = props.platformStatus?.landingCustomerLogosEnabled !== false && landingCustomerLogos.length > 0;
  const oauthLoginProviders = props.platformStatus?.oauthEnabled === false ? [] : [{
    key: "Kakao",
    label: "카카오로 로그인",
    href: "/api/auth/oauth/kakao",
    className: "is-kakao"
  }, {
    key: "Naver",
    label: "네이버로 로그인",
    href: "/api/auth/oauth/naver",
    className: "is-naver"
  }, {
    key: "Google",
    label: "Google로 로그인",
    href: "/api/auth/oauth/google",
    className: "is-google"
  }].filter(provider => props.platformStatus?.[`oauth${provider.key}Enabled`] && props.platformStatus?.[`oauth${provider.key}Configured`]);
  const allPublishedCourses = (props.courses || []).filter(course => course.isPublished);
  const previewEligibleCourses = allPublishedCourses.filter(course => String(course.accessScope || "public") !== "code" || isGovernmentCourse(course, props.platformStatus)).sort((left, right) => {
    const leftPreview = left.isLandingPreview ? 1 : 0;
    const rightPreview = right.isLandingPreview ? 1 : 0;
    if (leftPreview !== rightPreview) return rightPreview - leftPreview;
    return Number(right.id || 0) - Number(left.id || 0);
  });
  const publicCourseTickerItems = allPublishedCourses.slice(0, 6).map(course => ({
    label: `${getCourseDisplayIcon(course, props.platformStatus)} ${course.title} · ${course.courseType === "online" ? "온라인" : "오프라인"} · ${course.level || "과정"}`,
    isGovernment: isGovernmentCourse(course, props.platformStatus)
  }));
  const landingPreviewCourses = previewEligibleCourses.filter(course => course.isLandingPreview);
  const governmentPreviewCourses = allPublishedCourses.filter(course => isGovernmentCourse(course, props.platformStatus));
  const prioritizedCurriculumCourses = [];
  const addCurriculumCourse = course => {
    if (!course || prioritizedCurriculumCourses.some(item => Number(item.id) === Number(course.id))) return;
    prioritizedCurriculumCourses.push(course);
  };
  landingPreviewCourses.forEach(addCurriculumCourse);
  previewEligibleCourses.forEach(addCurriculumCourse);
  const normalPreviewCourses = prioritizedCurriculumCourses.filter(course => !isGovernmentCourse(course, props.platformStatus));
  const publicCourses = (() => {
    if (curriculumFilter === "government") {
      return governmentPreviewCourses.slice(0, Math.max(6, governmentPreviewCourses.length));
    }
    if (curriculumFilter === "standard") {
      return normalPreviewCourses.slice(0, 6);
    }
    const firstCourses = prioritizedCurriculumCourses.slice(0, 6);
    if (governmentPreviewCourses.length && !firstCourses.some(course => isGovernmentCourse(course, props.platformStatus))) {
      return [...firstCourses.slice(0, 5), governmentPreviewCourses[0]].filter(Boolean);
    }
    return firstCourses;
  })();
  const previewCourse = publicCourses.find(course => Number(course.id) === Number(previewCourseId)) || publicCourses[0] || null;
  const previewCourseIsGovernment = isGovernmentCourse(previewCourse, props.platformStatus);
  const hasAnyPublicSurveyEnabled = useMemo(() => publicCourses.some(course => {
    const config = resolveCourseSurveyConfig(course);
    return config.pre?.enabled !== false || config.post?.enabled !== false;
  }), [publicCourses]);
  const previewSurveyConfig = useMemo(() => previewCourse ? resolveCourseSurveyConfig(previewCourse) : null, [previewCourse]);
  const previewPreSurveyEnabled = previewSurveyConfig?.pre?.enabled !== false;
  const previewPostSurveyEnabled = previewSurveyConfig?.post?.enabled !== false;
  const showLandingSurveyPrompt = landingSurveyNoticeEnabled && (previewPreSurveyEnabled || previewPostSurveyEnabled);
  const showLandingSurveyNoticePanel = landingSurveyNoticeEnabled && hasAnyPublicSurveyEnabled;
  const [isCurriculumExpanded, setIsCurriculumExpanded] = useState(!landingCurriculumCollapsedByDefault);
  const landingUpcomingScheduleEvents = useMemo(() => {
    const now = Date.now();
    return [...scheduleSummary].filter(event => {
      const range = getLandingEventRange(event);
      return range && range.end.getTime() >= now;
    }).sort((left, right) => {
      const leftRange = getLandingEventRange(left);
      const rightRange = getLandingEventRange(right);
      return (leftRange?.start.getTime() || 0) - (rightRange?.start.getTime() || 0);
    }).slice(0, 3);
  }, [scheduleSummary]);
  const landingMetricCards = [{
    label: "공개 과정",
    value: allPublishedCourses.length ? `${allPublishedCourses.length}개` : "준비 중",
    helper: "일반·온라인·정부지원 과정"
  }, {
    label: "랩실",
    value: "통합 콘솔",
    helper: "터미널·교안·문의 한 화면"
  }, {
    label: "확장 랩",
    value: "VM/CONTAINER",
    helper: "가상머신과 컨테이너 웹 콘솔"
  }];
  useEffect(() => {
    if (!landingScheduleEnabled) {
      setScheduleSummary([]);
      return undefined;
    }
    let cancelled = false;
    api(`/api/public/schedule-summary?limit=${LANDING_CLASS_LIMIT}&landingOnly=true`).then(result => {
      if (!cancelled) setScheduleSummary(result.events || []);
    }).catch(() => {
      if (!cancelled) setScheduleSummary([]);
    });
    return () => {
      cancelled = true;
    };
  }, [landingScheduleEnabled]);
  useEffect(() => {
    let faviconLink = document.querySelector("link[rel='icon']");
    if (!faviconLink) {
      faviconLink = document.createElement("link");
      faviconLink.setAttribute("rel", "icon");
      document.head.appendChild(faviconLink);
    }
    faviconLink.setAttribute("href", faviconPath);
    faviconLink.setAttribute("type", useUploadedFavicon ? String(props.platformStatus?.faviconMime || "image/x-icon") : "image/svg+xml");
  }, [faviconPath, props.platformStatus?.faviconMime, useUploadedFavicon]);
  useEffect(() => {
    if (!publicCourses.length) {
      setPreviewCourseId(null);
      return;
    }
    if (!publicCourses.some(course => Number(course.id) === Number(previewCourseId))) {
      setPreviewCourseId(publicCourses[0].id);
    }
  }, [previewCourseId, publicCourses]);
  useEffect(() => {
    setIsCurriculumExpanded(!landingCurriculumCollapsedByDefault);
  }, [landingCurriculumCollapsedByDefault]);
  useEffect(() => {
    const targetTab = pendingAuthShortcutRef.current;
    if (!targetTab || targetTab !== props.authTab) return undefined;
    const focusTarget = targetTab === "signup" ? signupNameRef.current : loginUsernameRef.current;
    authPanelRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
    const timer = window.setTimeout(() => {
      focusTarget?.focus();
      focusTarget?.select?.();
      pendingAuthShortcutRef.current = "";
    }, 140);
    return () => window.clearTimeout(timer);
  }, [props.authTab]);
  function openAuthPanel(tab) {
    pendingAuthShortcutRef.current = tab;
    props.setAuthTab(tab);
    authPanelRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }
  function scrollToLandingCourses() {
    const target = landingCoursesRef.current || authPanelRef.current;
    target?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
  async function submitPublicQuoteInquiry(event) {
    event.preventDefault();
    if (!quoteInquiryForm.contactName.trim() || !quoteInquiryForm.contactEmail.trim() || !quoteInquiryForm.requirements.trim() || !quoteInquiryForm.privacyAgreed) {
      setQuoteInquiryStatus({
        tone: "error",
        message: "담당자명, 이메일, 요청 내용, 개인정보 수집 동의를 확인해 주세요."
      });
      return;
    }
    setQuoteInquiryBusy(true);
    setQuoteInquiryStatus({
      tone: "info",
      message: "견적 문의를 접수하는 중입니다."
    });
    try {
      const result = await api("/api/public/quote-inquiries", {
        method: "POST",
        body: quoteInquiryForm
      });
      setQuoteInquiryStatus({
        tone: "success",
        message: result.message || "견적 문의를 접수했습니다."
      });
      setQuoteInquiryForm({
        companyName: "",
        contactName: "",
        contactEmail: "",
        contactPhone: "",
        interestType: "기업 교육",
        courseTitles: "",
        participantCount: 10,
        desiredTimeline: "",
        requirements: "",
        privacyAgreed: false,
        website: ""
      });
    } catch (error) {
      setQuoteInquiryStatus({
        tone: "error",
        message: error.message || "견적 문의 접수 중 오류가 발생했습니다."
      });
    } finally {
      setQuoteInquiryBusy(false);
    }
  }
  function openScheduleApply(event) {
    setSelectedScheduleEvent(null);
    if (event?.applyUrl) {
      window.open(event.applyUrl, "_blank", "noopener,noreferrer");
      return;
    }
    openAuthPanel("signup");
  }
  function formatLandingScheduleRange(event) {
    const start = new Date(event?.startAt);
    const end = new Date(event?.endAt || event?.startAt);
    if (Number.isNaN(start.getTime())) return "일정 미정";
    const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      weekday: "short"
    });
    if (Number.isNaN(end.getTime()) || start.toDateString() === end.toDateString()) {
      return dateFormatter.format(start);
    }
    return `${dateFormatter.format(start)} - ${dateFormatter.format(end)}`;
  }
  function formatLandingScheduleTime(event) {
    const start = new Date(event?.startAt);
    const end = new Date(event?.endAt || event?.startAt);
    if (Number.isNaN(start.getTime())) return "";
    const formatter = new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit"
    });
    if (Number.isNaN(end.getTime())) return `${formatter.format(start)} 시작`;
    return `${formatter.format(start)} - ${formatter.format(end)}`;
  }
  function getLandingScheduleStatusLabel(event) {
    if (event?.status === "recruiting") return "모집중";
    if (event?.status === "closed") return "마감";
    if (event?.status === "ended") return "종료";
    if (event?.status === "cancelled") return "취소";
    return "예정";
  }
  function getLandingScheduleBadge(event) {
    if (event?.badgeLabel) return event.badgeLabel;
    const start = new Date(event?.startAt);
    const end = new Date(event?.endAt || event?.startAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return getLandingScheduleStatusLabel(event);
    const startDay = new Date(start);
    const endDay = new Date(end);
    startDay.setHours(0, 0, 0, 0);
    endDay.setHours(0, 0, 0, 0);
    return `${Math.max(1, Math.round((endDay.getTime() - startDay.getTime()) / 86400000) + 1)}일`;
  }
  const termsEnabled = props.platformStatus?.termsEnabled !== false;
  const signupTerms = termsEnabled ? ["standard_terms", "service_additional_terms"].map(key => (props.activeTerms || []).find(term => term.termsKey === key)).filter(Boolean) : [];
  const agreedTermIds = (props.signupForm.termsAgreementIds || []).map(Number);
  const allSignupTermsAgreed = signupTerms.length === 2 && signupTerms.every(term => agreedTermIds.includes(Number(term.id)));
  const activeTermsModalTerm = signupTerms[termsModalStep] || null;
  const openTermsModal = () => {
    termsModalTriggerRef.current = document.activeElement;
    setTermsModalStep(0);
    setTermsModalOpen(true);
  };
  const closeTermsModal = () => {
    setTermsModalOpen(false);
  };
  const confirmAllTerms = () => {
    props.setSignupForm(current => ({
      ...current,
      termsAgreementIds: signupTerms.map(term => term.id)
    }));
    setTermsModalOpen(false);
  };
  useEffect(() => {
    if (!termsModalOpen) return undefined;
    const dialog = termsModalRef.current;
    window.requestAnimationFrame(() => {
      const [firstFocusable] = getDialogFocusableElements(dialog);
      (firstFocusable || dialog)?.focus?.();
    });
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeTermsModal();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusableElements = getDialogFocusableElements(dialog);
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
      termsModalTriggerRef.current?.focus?.();
    };
  }, [termsModalOpen]);
  return <main className="community-auth"><section className="community-auth-intro"><h1><TerminalLabBrand className="auth-product-brand" logoPath={props.platformStatus?.landingLogoMode === "upload" ? props.platformStatus.landingLogoPath : ""} /></h1><p className="community-edition-label">COMMUNITY EDITION</p><p>클라우드·협업·운영을 한곳에서 관리합니다.</p></section><section className="auth-panel" ref={authPanelRef}>
          <div className="auth-panel-head">
            <p className="card-label">{landingAuthEyebrow}</p>
            <h3>{landingAuthTitle}</h3>
            <p>{landingAuthCopy}</p>
          </div>
          <div className="tabs" role="tablist" aria-label="auth">
            <button aria-controls="auth-panel-login" aria-selected={props.authTab === "login" ? "true" : "false"} className={`tab ${props.authTab === "login" ? "is-active" : ""}`} id="auth-tab-login" onClick={() => props.setAuthTab("login")} role="tab" type="button">
              로그인
            </button>
            <button aria-controls="auth-panel-signup" aria-selected={props.authTab === "signup" ? "true" : "false"} className={`tab ${props.authTab === "signup" ? "is-active" : ""}`} id="auth-tab-signup" onClick={() => props.setAuthTab("signup")} role="tab" type="button">
              회원가입
            </button>
          </div>

          <StatusMessage {...props.authStatus} />

          {props.authTab === "login" ? <div aria-labelledby="auth-tab-login" className="auth-tab-panel" id="auth-panel-login" role="tabpanel">
              <form className="auth-form" onSubmit={props.onLogin}>
                <Field inputRef={loginUsernameRef} label="아이디" value={props.loginForm.username} onChange={value => props.setLoginForm(current => ({
            ...current,
            username: value
          }))} />
                <Field label="비밀번호" type="password" value={props.loginForm.password} onChange={value => props.setLoginForm(current => ({
            ...current,
            password: value
          }))} />
                <Field label="OTP 코드" value={props.loginForm.otpCode} onChange={value => props.setLoginForm(current => ({
            ...current,
            otpCode: value
          }))} placeholder="필요한 경우 6자리 입력" />
                <button className="primary-btn" type="submit">로그인</button>
              </form>
              {oauthLoginProviders.length ? <div className="oauth-login-group" aria-label="소셜 로그인">
                  {oauthLoginProviders.map(provider => <a className={`oauth-login-btn ${provider.className}`} href={provider.href} key={provider.href}>{provider.label}</a>)}
                </div> : null}
              {props.pendingOtpEnrollment?.active ? <section className="auth-form auth-reset-form otp-enrollment-panel">
                  <div className="auth-panel-head compact-auth-head">
                    <p className="card-label">관리자 OTP 등록</p>
                    <h4>{`${props.pendingOtpEnrollment.name || props.pendingOtpEnrollment.username} 계정 보호 설정`}</h4>
                    <p>Google Authenticator 같은 앱에서 QR을 등록한 뒤 6자리 코드를 입력해 주세요. 등록이 끝나면 관리자 로그인이 완료됩니다.</p>
                  </div>
                  <div className="otp-setup-grid">
                    <div className="otp-setup-qr">
                      <OtpQrPreview alt="관리자 OTP 등록 QR" otpauthUrl={props.pendingOtpEnrollment.otpauthUrl} />
                    </div>
                    <div className="otp-setup-fields">
                      <Field label="비밀키" value={props.pendingOtpEnrollment.secret} onChange={() => {}} readOnly />
                      <Field label="OTP URL" value={props.pendingOtpEnrollment.otpauthUrl} onChange={() => {}} readOnly />
                      <Field label="OTP 코드" value={props.pendingOtpEnrollment.code} onChange={value => props.setPendingOtpEnrollment(current => ({
                ...current,
                code: value
              }))} placeholder="앱에 표시된 6자리 코드" />
                    </div>
                  </div>
                  <div className="admin-inline-actions">
                    <button className="primary-btn" onClick={props.onConfirmPendingOtpEnrollment} type="button">QR 등록 완료 및 OTP 활성화</button>
                  </div>
                </section> : null}
              <div className="auth-reset-toggle-wrap">
                <button aria-expanded={showResetPasswordForm ? "true" : "false"} className="ghost-btn auth-reset-toggle-btn" onClick={() => setShowResetPasswordForm(current => !current)} type="button">
                  {showResetPasswordForm ? "비밀번호 재설정 닫기" : "관리자 PIN으로 비밀번호 재설정"}
                </button>
              </div>
              {showResetPasswordForm ? <form className="auth-form auth-reset-form" onSubmit={props.onResetPasswordWithPin}>
                  <div className="auth-panel-head compact-auth-head">
                    <p className="card-label">비밀번호 재설정</p>
                    <h4>관리자 발급 PIN으로 초기화</h4>
                    <p>관리자가 발급한 1회용 PIN과 새 비밀번호를 입력해 주세요.</p>
                  </div>
                  <Field label="아이디" value={props.resetPinForm.username} onChange={value => props.setResetPinForm(current => ({
            ...current,
            username: value
          }))} />
                  <Field label="PIN 코드" value={props.resetPinForm.pin} onChange={value => props.setResetPinForm(current => ({
            ...current,
            pin: value
          }))} placeholder="6자리 PIN" />
                  <Field label="새 비밀번호" type="password" value={props.resetPinForm.newPassword} onChange={value => props.setResetPinForm(current => ({
            ...current,
            newPassword: value
          }))} />
                  <Field label="새 비밀번호 확인" type="password" value={props.resetPinForm.confirmPassword} onChange={value => props.setResetPinForm(current => ({
            ...current,
            confirmPassword: value
          }))} />
                  <button className="ghost-btn" type="submit">PIN으로 비밀번호 재설정</button>
                </form> : null}
            </div> : <form aria-labelledby="auth-tab-signup" className="auth-form" id="auth-panel-signup" onSubmit={props.onSignup} role="tabpanel">
                <Field inputRef={signupNameRef} label="이름" value={props.signupForm.name} onChange={value => props.setSignupForm(current => ({
          ...current,
          name: value
        }))} />
                <Field label="이메일" value={props.signupForm.email} onChange={value => props.setSignupForm(current => ({
          ...current,
          email: value
        }))} placeholder="name@example.com" />
                <div className="field-inline">
                  <Field label="아이디" value={props.signupForm.username} onChange={value => props.setSignupForm(current => ({
            ...current,
            username: value
          }))} />
                  <button className="ghost-btn field-inline-btn" onClick={props.checkUsername} type="button">중복 확인</button>
                </div>
                <StatusMessage {...props.signupCheck} />
                <Field label="비밀번호" type="password" value={props.signupForm.password} onChange={value => props.setSignupForm(current => ({
          ...current,
          password: value
        }))} />
                <Field label="비밀번호 확인" type="password" value={props.signupForm.confirmPassword} onChange={value => props.setSignupForm(current => ({
          ...current,
          confirmPassword: value
        }))} />
                <Field label="가입 사유" value={props.signupForm.signupReason} onChange={value => props.setSignupForm(current => ({
          ...current,
          signupReason: value
        }))} placeholder="예: 교육 실습 참여, 개인 학습, 팀 테스트" multiline />
                <Field label="과정 코드" value={props.signupForm.courseCode} onChange={value => props.setSignupForm(current => ({
          ...current,
          courseCode: value
        }))} placeholder="선택 입력" />
                {props.platformStatus?.inviteOnlyMode ? <Field label="초대 코드" value={props.signupForm.inviteCode} onChange={value => props.setSignupForm(current => ({
          ...current,
          inviteCode: value
        }))} placeholder="필수 입력" /> : <Field label="초대 코드" value={props.signupForm.inviteCode} onChange={value => props.setSignupForm(current => ({
          ...current,
          inviteCode: value
        }))} placeholder="선택 입력" />}
                {termsEnabled ? <div className="signup-terms-box">
                  <strong>약관 동의</strong>
                  {signupTerms.length === 2 ? <>
                      <div className={allSignupTermsAgreed ? "terms-confirm-status is-complete" : "terms-confirm-status"}>
                        {allSignupTermsAgreed ? "모든 약관 확인 및 동의 하였음" : "표준약관과 서비스 추가 약관을 확인해 주세요."}
                      </div>
                      <button className="ghost-btn" onClick={openTermsModal} type="button">{allSignupTermsAgreed ? "약관 다시 확인" : "약관 전체 확인"}</button>
                    </> : <p className="hint">회원가입 약관이 아직 준비되지 않았습니다. 관리자에게 문의해 주세요.</p>}
                </div> : null}
                <label className="compact-check signup-marketing-consent">
                  <input checked={props.signupForm.marketingEmailConsent === true} onChange={event => props.setSignupForm(current => ({
            ...current,
            marketingEmailConsent: event.target.checked
          }))} type="checkbox" />
                  <span>
                    <strong>마케팅 정보 이메일 수신 동의 (선택)</strong>
                    <small>쿠폰, 이벤트, 신규 과정 안내를 이메일로 받을 수 있으며 동의하지 않아도 회원가입과 서비스 이용에는 제한이 없습니다.</small>
                  </span>
                </label>
                <button className="primary-btn" type="submit">회원가입</button>
              </form>}
        </section></main>;
}
