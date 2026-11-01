import { useEffect, useRef, useState } from "react";
import { api, navigate } from "./portal-state.js";
import TerminalLabLogo from "./terminal-lab-logo.jsx";
import { CONSULTING_REPLY_PLACEHOLDERS, DEFAULT_CONSULTING_REPLY_TEMPLATES, normalizeConsultingReplyTemplates } from "./consulting-reply-templates.js";
import { AdminDisclosureCard, AdminField, AdminSecretInput, PanelStatusMessage, StatusMessage, applyTossTestDefaults, formatCurrency, formatDateTime, getNormalizedSshPublicHost, getYoutubeLoopEmbedUrl, renderZunStatus, safeStringifyJson, useImeBufferedInput } from "./portal-views.jsx";

const OAUTH_PROVIDERS = [
  { key: "Google", label: "Google", provider: "google", className: "is-google", secretRequired: true },
  { key: "Kakao", label: "카카오", provider: "kakao", className: "is-kakao", secretRequired: false },
  { key: "Naver", label: "네이버", provider: "naver", className: "is-naver", secretRequired: true },
];

const DEFAULT_CUSTOM_DOMAIN_GUIDANCE = {
  customDomainGuidanceIntro: "아래와 같이 DNS 레코드 설정이 필요합니다.",
  customDomainGuidanceCnameLabel: "CNAME",
  customDomainGuidanceCnameText: "{domain} → {target}",
  customDomainGuidanceOwnershipLabel: "소유권 확인",
  customDomainGuidanceOwnershipText: "TXT {txtName} 추가",
  customDomainGuidanceRecommendationLabel: "권장 DNS",
  customDomainGuidanceRecommendationText: "Cloudflare DNS 사용 권장(무료), 프록시 활성화, SSL/TLS Full",
  customDomainGuidanceVerificationLabel: "검증 TXT",
  customDomainGuidanceVerificationText: "TXT 레코드가 없으면 서비스에서 도메인을 인식할 수 없습니다.",
};

const ADMIN_API_MONITOR_FOCUS_STORAGE_KEY = "admin:apiMonitor:focus";
const ADMIN_PLATFORM_FOCUS_STORAGE_KEY = "admin:platform:focus";
const ADMIN_V2_RELEASE_FLOW_CHECKS_STORAGE_KEY = "admin:v2Release:manualFlowChecks";
const ADMIN_V2_RELEASE_AUTO_SMOKE_STORAGE_KEY = "admin:v2Release:autoSmokeResults";

function AdminCsvInput({ values, onChange, ...inputProps }) {
  const serialized = (Array.isArray(values) ? values : []).join(", ");
  const [draft, setDraft] = useState(serialized);

  useEffect(() => {
    setDraft(serialized);
  }, [serialized]);

  const commit = () => {
    onChange?.(draft.split(",").map((item) => item.trim()).filter(Boolean));
  };

  return <input {...inputProps} value={draft} onBlur={commit} onChange={(event) => setDraft(event.target.value)} />;
}

export function AdminImageMirroringTab(props) {
  const [sourceImage, setSourceImage] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [mirrors, setMirrors] = useState([]);
  const [selected, setSelected] = useState(null);
  const [catalogBusyId, setCatalogBusyId] = useState("");
  const aiCatalog = Array.isArray(props.platformStatus?.aiContainerImageCatalog) ? props.platformStatus.aiContainerImageCatalog : [];

  const loadMirrors = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/internal-images/mirrors?limit=200", { credentials: "include", cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || "미러링 이력을 불러오지 못했습니다.");
      setMirrors(Array.isArray(payload?.mirrors) ? payload.mirrors : []);
    } catch (error) {
      setMessage(error.message || "미러링 이력을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadMirrors(); }, []);

  const openDetail = async (id) => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/internal-images/mirrors/${encodeURIComponent(id)}`, { credentials: "include", cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || "미러링 상세를 불러오지 못했습니다.");
      setSelected(payload.mirror || null);
    } catch (error) {
      setMessage(error.message || "미러링 상세를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const runMirror = async () => {
    const normalized = sourceImage.trim();
    if (!normalized) { setMessage("미러링할 원본 이미지 이름을 입력해 주세요."); return; }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/internal-images/mirror", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sourceImage: normalized, namespace: props.platformStatus?.containerRegistryDefaultNamespace || "library" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || "이미지 미러링에 실패했습니다.");
      setMessage(payload?.message || "이미지 미러링이 완료되었습니다.");
      setSourceImage("");
      const targetImage = String(payload?.targetImage || "").trim();
      if (targetImage && props.setPlatformStatus) {
        props.setPlatformStatus((current) => ({ ...current, zunAllowedImages: [...new Set([...(current?.zunAllowedImages || []), targetImage])] }));
      }
      await loadMirrors();
    } catch (error) {
      setMessage(error.message || "이미지 미러링에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const mirrorCatalogPreset = async (preset, { refresh = true } = {}) => {
    const response = await fetch("/api/admin/internal-images/mirror", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        presetId: preset.id,
        sourceImage: preset.sourceImage,
        namespace: props.platformStatus?.containerRegistryDefaultNamespace || "library",
        addToAllowed: true,
        async: true,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message || `${preset.label} 미러링에 실패했습니다.`);
    const targetImage = String(payload?.targetImage || preset.targetImage || "").trim();
    if (targetImage && payload?.addedToAllowed && props.setPlatformStatus) {
      props.setPlatformStatus((current) => ({
        ...current,
        zunAllowedImages: [...new Set([...(current?.zunAllowedImages || []), targetImage])],
        aiContainerImageCatalog: (current?.aiContainerImageCatalog || []).map((item) => item.id === preset.id ? { ...item, targetImage, allowed: true } : item),
      }));
    }
    if (refresh) await loadMirrors();
    return { targetImage, pending: Boolean(payload?.pending) };
  };

  const runCatalogMirror = async (preset) => {
    setCatalogBusyId(preset.id);
    setMessage(`${preset.label} 이미지를 내부 레지스트리로 미러링하고 있습니다.`);
    try {
      const result = await mirrorCatalogPreset(preset);
      setMessage(result.pending ? `${preset.label} 미러링을 백그라운드에서 시작했습니다. 완료 후 새로고침하면 사용할 수 있습니다.` : `${preset.label} 미러링 및 허용 목록 등록을 완료했습니다: ${result.targetImage}`);
    } catch (error) {
      setMessage(error.message || `${preset.label} 미러링에 실패했습니다.`);
    } finally {
      setCatalogBusyId("");
    }
  };

  const runRecommendedCatalogMirror = async () => {
    const targets = aiCatalog.filter((preset) => preset.recommended && !preset.allowed);
    if (!targets.length) { setMessage("추천 CPU AI 이미지가 이미 모두 허용되어 있습니다."); return; }
    setCatalogBusyId("recommended");
    try {
      for (const preset of targets) {
        setMessage(`${preset.label} 이미지를 미러링하고 있습니다. (${targets.indexOf(preset) + 1}/${targets.length})`);
        await mirrorCatalogPreset(preset, { refresh: false });
      }
      await loadMirrors();
      setMessage(`추천 CPU AI 이미지 ${targets.length}개의 백그라운드 미러링을 시작했습니다. 완료 후 허용 목록에 자동 등록됩니다.`);
    } catch (error) {
      setMessage(error.message || "추천 AI 이미지 일괄 미러링에 실패했습니다.");
    } finally {
      setCatalogBusyId("");
    }
  };

  return (
    <section className="admin-simple-card">
      <div className="admin-card-header">
        <div><strong>이미지 미러링</strong><div className="hint">외부 이미지를 내부 레지스트리로 복제하고 실행 이력을 조회합니다.</div></div>
        <button className="mini-btn" disabled={loading} onClick={loadMirrors} type="button">새로고침</button>
      </div>
      {aiCatalog.length ? (
        <div className="admin-simple-card">
          <div className="admin-card-header">
            <div><strong>AI 프리빌드 이미지</strong><div className="hint">공식 이미지를 {props.platformStatus?.containerRegistryPublicHost || "registry.example.com"}에 복제하고 컨테이너 랩 허용 목록에 자동 등록합니다.</div></div>
            <button className="mini-btn" disabled={Boolean(catalogBusyId)} onClick={runRecommendedCatalogMirror} type="button">추천 CPU 일괄 설치</button>
          </div>
          <div className="admin-summary-grid">
            {aiCatalog.map((preset) => (
              <article className="admin-summary-card" key={preset.id}>
                <span className="card-label">{preset.gpuRequired ? "GPU" : "CPU"} · 약 {preset.estimatedCompressedGb}GB</span>
                <strong>{preset.label}</strong>
                <small>{preset.description}</small>
                <div className="hint">{preset.targetImage || preset.sourceImage}</div>
                <div className="portal-actions">
                  <span className={`status-chip ${preset.allowed ? "is-success" : preset.gpuRequired && !preset.gpuReady ? "is-warn" : ""}`}>{preset.allowed ? "허용됨" : "미설치"}</span>
                  <button className="mini-btn" disabled={Boolean(catalogBusyId) || preset.allowed} onClick={() => runCatalogMirror(preset)} type="button">
                    {catalogBusyId === preset.id ? "미러링 중" : preset.allowed ? "설치 완료" : "미러링 및 허용"}
                  </button>
                </div>
                {preset.gpuRequired && !preset.gpuReady ? <small>이미지는 설치할 수 있지만 실행 전 Zun GPU Runtime 설정이 필요합니다.</small> : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}
      <div className="admin-toolbar">
        <input aria-label="원본 이미지" placeholder="docker.io/library/nginx:stable" value={sourceImage} onChange={(event) => setSourceImage(event.target.value)} />
        <button className="mini-btn" disabled={loading} onClick={runMirror} type="button">{loading ? "처리 중" : "미러링 실행"}</button>
      </div>
      {message ? <StatusMessage>{message}</StatusMessage> : null}
      <div className="admin-table admin-table-scroll">
        <div className="admin-table-head admin-course-grid"><span>이미지</span><span>상태</span><span>실행 정보</span></div>
        {mirrors.length ? mirrors.map((item) => (
          <button className="admin-table-row admin-course-grid" key={item.id} onClick={() => openDetail(item.id)} type="button">
            <span><strong>{item.sourceImage || "-"}</strong><div className="hint">{item.targetImage || "-"}</div></span>
            <span>{item.status === "success" ? "성공" : "실패"}</span>
            <span><div>{item.adminUsername || "-"}</div><div className="hint">{formatDateTime(item.completedAt)}</div></span>
          </button>
        )) : <div className="hint">이미지 미러링 이력이 없습니다.</div>}
      </div>
      {selected ? (
        <div className="admin-simple-card">
          <div className="admin-card-header"><strong>미러링 상세 #{selected.id}</strong><button className="mini-btn" onClick={() => setSelected(null)} type="button">닫기</button></div>
          <div className="simple-status-list">
            <div>원본: {selected.sourceImage || "-"}</div><div>대상: {selected.targetImage || "-"}</div>
            <div>상태: {selected.status === "success" ? "성공" : "실패"} (code {selected.code ?? "-"})</div>
            <div>실행자: {selected.adminUsername || "-"} · {formatDateTime(selected.completedAt)}</div>
          </div>
          {selected.stdout ? <pre>{selected.stdout}</pre> : null}
          {selected.stderr ? <pre>{selected.stderr}</pre> : null}
        </div>
      ) : null}
    </section>
  );
}

function listCount(value) {
  return Array.isArray(value) ? value.filter(Boolean).length : 0;
}

function areSimpleObjectsEqual(left, right) {
  const leftKeys = Object.keys(left || {});
  const rightKeys = Object.keys(right || {});
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => String(left?.[key] ?? "") === String(right?.[key] ?? ""));
}

function normalizePortalUiMode(value, fallback = "legacy") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["legacy", "switchable", "v2"].includes(normalized)) return normalized;
  return fallback;
}

function getPortalUiMode(platformStatus) {
  return normalizePortalUiMode(
    platformStatus?.portalUiMode,
    platformStatus?.userPortalV2Enabled ? "switchable" : "legacy",
  );
}

function getPortalUiModeSummary(mode) {
  if (mode === "v2") {
    return { label: "v2 완전 전환", hint: "모든 사용자 v2 고정, 전환 버튼 숨김" };
  }
  if (mode === "switchable") {
    return { label: "v2 기본 / v1 호환", hint: "새 접속은 v2로 시작하고 필요 시 v1 전환 허용" };
  }
  return { label: "v1 고정", hint: "기존 사용자 UI만 표시" };
}

function normalizeSupportAvailabilityMode(value, fallback = "available") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["available", "away"].includes(normalized)) return normalized;
  return fallback;
}

function getSupportAvailabilitySummary(mode) {
  if (mode === "away") {
    return { label: "부재중", hint: "일반 사용자의 운영지원 쪽지 발송 차단" };
  }
  return { label: "상담 가능", hint: "운영지원 쪽지 접수 허용" };
}

const LANDING_CUSTOMER_LOGO_LIMIT = 12;

function normalizeAdminCustomerLogos(value) {
  const source = Array.isArray(value) ? value : [];
  return source.slice(0, LANDING_CUSTOMER_LOGO_LIMIT).map((item, index) => ({
    id: String(item?.id || `customer-logo-${index + 1}`).trim() || `customer-logo-${index + 1}`,
    name: String(item?.name || "").trim(),
    imagePath: String(item?.imagePath || item?.image_path || item?.path || "").trim(),
    website: String(item?.website || item?.href || item?.url || "").trim(),
    visible: item?.visible !== false,
  }));
}

function createAdminCustomerLogoDraft() {
  return {
    id: `customer-logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    imagePath: "",
    website: "",
    visible: true,
  };
}

function formatSelfServiceVlanRangeLabel(platformStatus = {}) {
  const requestedMin = Number(platformStatus?.selfServiceVmVlanMin || 4000) || 4000;
  const requestedMax = Number(platformStatus?.selfServiceVmVlanMax || 4094) || 4094;
  const min = Math.max(1, Math.min(4094, requestedMin));
  const max = Math.max(min, Math.min(4094, requestedMax));
  return `${min}-${max}`;
}

function AdminConsultingReplyTemplateSettings(props) {
  const templates = normalizeConsultingReplyTemplates(props.platformStatus?.consultingReplyTemplates);
  const updateTemplate = (groupKey, index, patch) => {
    props.setPlatformStatus((current) => {
      const currentTemplates = normalizeConsultingReplyTemplates(current?.consultingReplyTemplates);
      return {
        ...current,
        consultingReplyTemplates: {
          ...currentTemplates,
          [groupKey]: currentTemplates[groupKey].map((template, templateIndex) => (
            templateIndex === index ? { ...template, ...patch } : template
          )),
        },
      };
    });
  };
  const restoreDefaults = () => {
    props.setPlatformStatus((current) => ({
      ...current,
      consultingReplyTemplates: normalizeConsultingReplyTemplates(DEFAULT_CONSULTING_REPLY_TEMPLATES),
    }));
  };
  const groups = [
    { key: "aiGpu", label: "AI/GPU 예약·견적", hint: "터미널 클라우드 AI/GPU 요청에 먼저 표시됩니다." },
    { key: "general", label: "일반 상담", hint: "강의, 기술 상담, 운영 문의에 사용합니다." },
  ];

  return (
    <div className="settings-panel admin-grid-span admin-consulting-template-settings">
      <div className="settings-panel-head">
        <div>
          <strong>상담 빠른 회신 템플릿</strong>
          <p className="hint">상담 및 문의 화면의 빠른 회신 버튼 문구와 메일 본문을 운영자가 직접 조정합니다.</p>
        </div>
        <button className="mini-btn" onClick={restoreDefaults} type="button">기본값 복원</button>
      </div>
      <div className="admin-template-placeholder-list" aria-label="사용 가능한 치환값">
        {CONSULTING_REPLY_PLACEHOLDERS.map(([token, label]) => (
          <span key={token}><strong>{token}</strong>{label}</span>
        ))}
      </div>
      {groups.map((group) => (
        <div className="admin-consulting-template-group" key={group.key}>
          <div className="admin-consulting-template-group-head">
            <strong>{group.label}</strong>
            <span className="hint">{group.hint}</span>
          </div>
          {templates[group.key].map((template, index) => (
            <div className="admin-consulting-template-row" key={`${group.key}-${template.key}-${index}`}>
              <AdminField label="버튼명">
                <input
                  value={template.label}
                  onChange={(event) => updateTemplate(group.key, index, { label: event.target.value })}
                  placeholder="예: 검토 중"
                />
              </AdminField>
              <AdminField label="적용 상태">
                <select
                  value={template.status}
                  onChange={(event) => updateTemplate(group.key, index, { status: event.target.value })}
                >
                  <option value="requested">접수됨</option>
                  <option value="reviewing">검토 중</option>
                  <option value="answered">답변 완료</option>
                  <option value="closed">종료</option>
                </select>
              </AdminField>
              <AdminField label="메일 제목">
                <input
                  value={template.subject || ""}
                  onChange={(event) => updateTemplate(group.key, index, { subject: event.target.value })}
                  placeholder="[KIKI OS TERMINAL-LAB] 상담 문의 회신 - {{name}}님"
                />
              </AdminField>
              <AdminField label="회신 문구">
                <textarea
                  rows={5}
                  value={template.note}
                  onChange={(event) => updateTemplate(group.key, index, { note: event.target.value })}
                  placeholder="{{name}}님, 요청 내용을 확인했습니다."
                />
              </AdminField>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function getAdminMonitorState(entry, fallbackLabel = "확인 전", fallbackDetail = "최근 API 점검 결과가 아직 없습니다.") {
  const normalizedEntry = entry && typeof entry === "object" ? entry : null;
  if (!normalizedEntry) {
    return { tone: "warn", label: fallbackLabel, detail: fallbackDetail };
  }
  const message = normalizedEntry.message
    || normalizedEntry.dbModeMessage
    || normalizedEntry.error
    || normalizedEntry.projectName
    || normalizedEntry.provider
    || normalizedEntry.model
    || "";
  if (normalizedEntry.enabled === false || normalizedEntry.configured === false) {
    return { tone: "muted", label: "비활성", detail: message || "상태 조회 또는 연동 설정이 꺼져 있습니다." };
  }
  if (normalizedEntry.ok) {
    return { tone: "ready", label: "정상", detail: message || "정상 응답을 확인했습니다." };
  }
  if (normalizedEntry.deferred) {
    return { tone: "muted", label: "확인 대기", detail: message || "자동 요약에서는 상세 API 호출을 생략했습니다. 새로고침으로 실제 상태를 확인해 주세요." };
  }
  return { tone: "danger", label: "점검 필요", detail: message || "오류 상세를 확인해야 합니다." };
}

function uniqueAdminStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function collectAdminOpenstackCertificates(caStatuses = []) {
  const seen = new Set();
  const certificates = [];
  caStatuses
    .flatMap((status) => Array.isArray(status?.certificateDetails) ? status.certificateDetails : [])
    .filter(Boolean)
    .forEach((certificate) => {
      const key = [
        certificate.path,
        certificate.index,
        certificate.fingerprint256,
        certificate.subject,
      ].filter(Boolean).join("|");
      if (seen.has(key)) return;
      seen.add(key);
      certificates.push(certificate);
    });
  return certificates;
}

function collectAdminOpenstackCaStatuses(entries = []) {
  return entries
    .flatMap((item) => [
      item.value?.openstackCaStatus,
      item.key === "openstackCa" ? item.value : null,
    ])
    .filter(Boolean);
}

function getAdminOpenstackDiagnosticText(entry = {}) {
  return [
    entry?.message,
    entry?.detailMessage,
    entry?.error,
    entry?.explanation,
    entry?.code,
    entry?.title,
    entry?.type,
    entry?.detail,
    entry?.details,
    entry?.openstackCaStatus?.error,
    ...(Array.isArray(entry?.mountWarnings) ? entry.mountWarnings : []),
    ...(Array.isArray(entry?.openstackCaStatus?.mountWarnings) ? entry.openstackCaStatus.mountWarnings : []),
    ...(Array.isArray(entry?.openstackCaStatus?.loadedPaths) ? entry.openstackCaStatus.loadedPaths : []),
    ...(Array.isArray(entry?.openstackCaStatus?.checkedPaths) ? entry.openstackCaStatus.checkedPaths : []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function isAdminOpenstackCaTrustIssue(entry = {}) {
  return /unable_to_verify_leaf_signature|unable to verify|unable_to_get_issuer_cert|err_tls_cert_altname_invalid|cert_altname|subject alternative name|hostname.*(does not match|mismatch)|certificate|self.?signed|ca not loaded|openstack ca not loaded|tls|leaf signature|not yet valid/.test(getAdminOpenstackDiagnosticText(entry));
}

function getAdminOpenstackProbeEntries(apiMonitor = {}, platformStatus = {}) {
  return [
    apiMonitor?.openstackCa ? { key: "openstackCa", label: "OpenStack CA", value: apiMonitor.openstackCa } : null,
    { key: "heat", label: "Heat", value: apiMonitor?.heat },
    { key: "quota", label: "Quota", value: apiMonitor?.quota },
    platformStatus?.zunEnabled || apiMonitor?.zun ? { key: "zun", label: "Zun", value: apiMonitor?.zun } : null,
    platformStatus?.magnumEnabled || apiMonitor?.magnum ? { key: "magnum", label: "CAPO", value: apiMonitor?.magnum } : null,
    platformStatus?.troveEnabled || apiMonitor?.trove ? { key: "trove", label: "Trove", value: apiMonitor?.trove } : null,
  ].filter(Boolean);
}

function getAdminOpenstackCaSmoke(apiMonitor = {}, platformStatus = {}) {
  if (platformStatus?.openstackStatusProbesEnabled === false) {
    return {
      tone: "warn",
      label: "조회 중지",
      detail: "OpenStack 상태 조회가 꺼져 있어 CA/TLS 신뢰 체인을 자동 점검하지 못합니다.",
    };
  }
  const entries = getAdminOpenstackProbeEntries(apiMonitor, platformStatus);
  const caStatuses = collectAdminOpenstackCaStatuses(entries);
  const loadedPaths = uniqueAdminStrings(caStatuses.flatMap((status) => Array.isArray(status?.loadedPaths) ? status.loadedPaths : []));
  const checkedPaths = uniqueAdminStrings(caStatuses.flatMap((status) => Array.isArray(status?.checkedPaths) ? status.checkedPaths : []));
  const mountWarnings = uniqueAdminStrings(caStatuses.flatMap((status) => Array.isArray(status?.mountWarnings) ? status.mountWarnings : []));
  const certificates = collectAdminOpenstackCertificates(caStatuses);
  const expiredCount = certificates.filter((certificate) => certificate.expired).length;
  const notYetValidCount = certificates.filter((certificate) => certificate.notYetValid).length;
  const parseErrorCount = certificates.filter((certificate) => certificate.parseError).length;
  const trustIssueEntry = entries.find((item) => isAdminOpenstackCaTrustIssue(item.value));
  if (expiredCount || notYetValidCount || parseErrorCount) {
    return {
      tone: "danger",
      label: expiredCount ? `CA 만료 ${expiredCount}건` : notYetValidCount ? `CA 유효 전 ${notYetValidCount}건` : `CA 파싱 실패 ${parseErrorCount}건`,
      detail: "OpenStack CA 파일은 읽었지만 인증서 유효기간 또는 파싱 상태를 확인해야 합니다.",
    };
  }
  if (trustIssueEntry) {
    return {
      tone: "danger",
      label: `${trustIssueEntry.label} 인증서 오류`,
      detail: mountWarnings[0] || "Keystone 또는 OpenStack API 인증서 체인을 신뢰하지 못하고 있습니다. OPENSTACK_CA_CERT_HOST 마운트, NODE_EXTRA_CA_CERTS, clouds.yaml auth_url 인증서 체인을 함께 확인하세요.",
    };
  }
  if (mountWarnings.length) {
    return {
      tone: "warn",
      label: "CA 경로 경고",
      detail: mountWarnings[0],
    };
  }
  if (caStatuses.some((status) => status?.loaded) || loadedPaths.length) {
    const certificateSummary = certificates.length
      ? ` / 인증서 ${certificates.filter((certificate) => !certificate.parseError).length}개`
      : "";
    const latestReloadedAt = caStatuses.map((status) => status?.reloadedAt).filter(Boolean).sort().at(-1);
    return {
      tone: "ready",
      label: "CA 로드됨",
      detail: `컨테이너 안에서 OpenStack CA를 읽었습니다${loadedPaths.length ? `: ${loadedPaths.join(", ")}` : "."}${certificateSummary}${latestReloadedAt ? ` / 마지막 로드 ${latestReloadedAt}` : ""}`,
    };
  }
  if (entries.some((item) => item.value?.ok)) {
    return {
      tone: "ready",
      label: "API 응답 정상",
      detail: "별도 CA 로드 기록은 없지만 OpenStack API 응답이 정상입니다. 사설 CA 환경이면 배포 env의 CA 경로도 같이 유지하세요.",
    };
  }
  if (checkedPaths.length) {
    return {
      tone: "warn",
      label: "CA 확인 필요",
      detail: `CA 후보 경로는 확인됐지만 로드 기록이 없습니다: ${checkedPaths.join(", ")}`,
    };
  }
  return {
    tone: "warn",
    label: "점검 전",
    detail: "최근 OpenStack API 점검 결과가 없어 CA/TLS 상태를 아직 판단하지 못했습니다.",
  };
}

function getAdminCloudsYamlSmoke(apiMonitor = {}, platformStatus = {}) {
  if (platformStatus?.openstackStatusProbesEnabled === false) {
    return {
      tone: "warn",
      label: "조회 중지",
      detail: "OpenStack 상태 조회가 꺼져 있어 인증 파일 경로를 자동 확인하지 못합니다.",
    };
  }
  const heat = apiMonitor?.heat || {};
  const servicePath = heat.serviceCloudsYamlPath || platformStatus?.serviceCloudsYaml || heat.cloudsYamlPath;
  const consolePath = heat.pocCloudsYamlPath || platformStatus?.pocCloudsYaml || servicePath;
  const items = [
    {
      label: "서비스",
      path: servicePath,
      effectivePath: heat.serviceCloudsYamlEffectivePath || (heat.serviceCloudsYamlReadable ? servicePath : heat.cloudsYamlReadable ? heat.cloudsYamlPath : ""),
    },
    {
      label: "클라우드 콘솔",
      path: consolePath,
      effectivePath: heat.pocCloudsYamlEffectivePath || (heat.pocCloudsYamlReadable
        ? consolePath
        : heat.serviceCloudsYamlReadable ? servicePath : heat.cloudsYamlReadable ? heat.cloudsYamlPath : ""),
    },
  ].map((item) => ({ ...item, readable: Boolean(item.effectivePath), fallbackUsed: Boolean(item.effectivePath && item.effectivePath !== item.path) }));
  const failedItems = items.filter((item) => !item.readable);
  if (failedItems.length) {
    return {
      tone: "danger",
      label: "읽기 실패",
      detail: `${failedItems.map((item) => item.label).join(", ")} 인증 파일을 읽지 못했습니다. Podman 마운트와 파일 권한을 확인하세요.`,
    };
  }
  const readableItems = items.filter((item) => item.readable === true);
  const fallbackItems = readableItems.filter((item) => item.fallbackUsed);
  if (items.length && readableItems.length === items.length) {
    return {
      tone: "ready",
      label: fallbackItems.length ? "폴백 사용" : "읽기 가능",
      detail: `${items.map((item) => `${item.label}: ${item.effectivePath || item.path || "기본값"}${item.fallbackUsed ? " (폴백)" : ""}`).join(" · ")}`,
    };
  }
  if (readableItems.length || heat.ok) {
    return {
      tone: "ready",
      label: "인증 가능",
      detail: readableItems.length
        ? `${readableItems.map((item) => item.label).join(", ")} 인증 파일 읽기 확인됨`
        : "Heat/OpenStack 응답이 정상이라 인증 파일은 동작 중입니다.",
    };
  }
  return {
    tone: "warn",
    label: "점검 전",
    detail: "최근 Heat/OpenStack 점검 결과가 없어 인증 파일 경로 상태를 아직 판단하지 못했습니다.",
  };
}

function getAdminSmokeTone(items = []) {
  if (items.some((item) => item.tone === "danger")) return "danger";
  if (items.some((item) => item.tone === "warn")) return "warn";
  if (items.some((item) => item.tone === "ready")) return "ready";
  return "muted";
}

function formatAdminWorkEstimate(minutes = 0) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (!value) return "추가 작업 없음";
  if (value < 60) return `약 ${value}분`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `약 ${hours}시간 ${rest}분` : `약 ${hours}시간`;
}

function parseAuditMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === "object" && !Array.isArray(metadata)) return metadata;
  try {
    const parsed = JSON.parse(String(metadata || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function buildPortalPolicyHistory(auditLogs = []) {
  return (Array.isArray(auditLogs) ? auditLogs : [])
    .map((log) => ({ ...log, metadata: parseAuditMetadata(log.metadata) }))
    .filter((log) => {
      if (String(log.action || "") !== "platform.update") return false;
      return Object.prototype.hasOwnProperty.call(log.metadata || {}, "portalUiMode")
        || Object.prototype.hasOwnProperty.call(log.metadata || {}, "userPortalV2Enabled")
        || Object.prototype.hasOwnProperty.call(log.metadata || {}, "portalV2TransitionNoticeEnabled")
        || Object.prototype.hasOwnProperty.call(log.metadata || {}, "supportAvailabilityMode");
    })
    .slice(0, 5);
}

function getOauthProviderCounts(platformStatus) {
  const masterEnabled = platformStatus?.oauthEnabled !== false;
  return {
    enabled: masterEnabled ? OAUTH_PROVIDERS.filter((item) => platformStatus?.[`oauth${item.key}Enabled`]).length : 0,
    configured: OAUTH_PROVIDERS.filter((item) => platformStatus?.[`oauth${item.key}Configured`] || platformStatus?.[`oauth${item.key}ClientId`]).length,
  };
}

const ADMIN_TERMINAL_CLOUD_ADVANCED_PRICE_ITEMS = [
  { key: "network", label: "전용 네트워크", detail: "네트워크 1개", fallback: 1200 },
  { key: "router", label: "라우터", detail: "외부 연결 1개", fallback: 800 },
  { key: "floatingIp", label: "Floating IP", detail: "공인 IP 1개", fallback: 1500 },
  { key: "volumeGb", label: "볼륨 GB", detail: "GB당 단가", fallback: 30 },
  { key: "container", label: "컨테이너 랩", detail: "컨테이너 1개", fallback: 3000 },
  { key: "kubernetes", label: "쿠버네티스 클러스터", detail: "클러스터 1개", fallback: 12000 },
  { key: "database", label: "DB 인스턴스", detail: "DB 1개", fallback: 7000 },
  { key: "databaseGb", label: "DB 스토리지 GB", detail: "GB당 단가", fallback: 40 },
  { key: "cicdRun", label: "CI/CD 실행", detail: "파이프라인 실행 1회", fallback: 500 },
];

function normalizeAdminPrice(value, fallback = 0) {
  return Math.max(0, Number(value ?? fallback) || 0);
}

function resolveAdminTerminalCloudAdvancedPrices(platformStatus = {}) {
  const source = platformStatus?.pocAdvancedDailyPrices && typeof platformStatus.pocAdvancedDailyPrices === "object"
    ? platformStatus.pocAdvancedDailyPrices
    : {};
  return Object.fromEntries(ADMIN_TERMINAL_CLOUD_ADVANCED_PRICE_ITEMS.map((item) => [
    item.key,
    normalizeAdminPrice(source[item.key], item.fallback),
  ]));
}

function resolveAdminTerminalCloudFlavors(platformStatus = {}) {
  const names = [
    ...(Array.isArray(platformStatus.selfServiceVmAllowedFlavors) ? platformStatus.selfServiceVmAllowedFlavors : []),
    ...(Array.isArray(platformStatus.pocAllowedFlavors) ? platformStatus.pocAllowedFlavors : []),
  ].map((item) => String(item || "").trim()).filter(Boolean);
  return [...new Set(names)].length ? [...new Set(names)] : ["m1.tiny"];
}

function resolveAdminTerminalCloudFlavorSpec(platformStatus = {}, flavor = "m1.tiny") {
  const spec = platformStatus?.pocFlavorSpecs?.[flavor] || {};
  return {
    vcpu: Math.max(1, Number(spec.vcpu ?? (flavor.includes("medium") ? 4 : flavor.includes("small") ? 2 : 1)) || 1),
    ramGb: Math.max(1, Number(spec.ramGb ?? (flavor.includes("medium") ? 8 : flavor.includes("small") ? 4 : 2)) || 1),
    diskGb: Math.max(1, Number(spec.diskGb ?? (flavor.includes("medium") ? 80 : flavor.includes("small") ? 50 : 20)) || 1),
  };
}

function buildAdminTerminalCloudPricingPreview(platformStatus = {}) {
  const prices = resolveAdminTerminalCloudAdvancedPrices(platformStatus);
  const flavors = resolveAdminTerminalCloudFlavors(platformStatus);
  const flavor = flavors[0] || "m1.tiny";
  const spec = resolveAdminTerminalCloudFlavorSpec(platformStatus, flavor);
  const dailyFlavorPrice = normalizeAdminPrice(platformStatus?.pocFlavorDailyPrices?.[flavor], 0);
  const freeMode = Boolean(platformStatus?.pocFreeModeEnabled);
  const costItems = [];
  const quoteItems = [];
  let monthlyCost = 0;

  const addCost = (label, amount, detail = "") => {
    const normalizedAmount = Math.max(0, Number(amount || 0));
    if (freeMode) {
      costItems.push({ label, amount: 0, detail: detail ? `무료 모드 / ${detail}` : "무료 모드" });
      return;
    }
    if (!normalizedAmount) {
      quoteItems.push({ label, detail: detail || "단가 설정 필요" });
      return;
    }
    monthlyCost += normalizedAmount;
    costItems.push({ label, amount: normalizedAmount, detail });
  };

  addCost(`${flavor} x 1대`, dailyFlavorPrice * 30, `${spec.vcpu}vCPU / RAM ${spec.ramGb}GB / Disk ${spec.diskGb}GB`);
  addCost("부팅 볼륨 20GB", prices.volumeGb * 20 * 30, "볼륨 GB 단가 기준");
  addCost("전용 네트워크", prices.network * 30, "네트워크 요청 샘플");
  addCost("라우터", prices.router * 30, "외부 연결 요청 샘플");
  addCost("Floating IP", prices.floatingIp * 30, "공개 IP 요청 샘플");
  addCost("DB 10GB", (prices.database + (prices.databaseGb * 10)) * 30, "DB 인스턴스 + 스토리지");

  const quota = platformStatus?.selfServiceVmProjectQuota || {};
  const quotaItems = [
    quota.instances ? `VM ${quota.instances}대` : "",
    quota.cores ? `vCPU ${quota.cores}개` : "",
    quota.ram ? `RAM ${Math.round(Number(quota.ram || 0) / 1024)}GB` : "",
    quota.gigabytes ? `Volume ${quota.gigabytes}GB` : "",
    quota.floatingip ? `Floating IP ${quota.floatingip}개` : "",
  ].filter(Boolean);

  return {
    flavor,
    freeMode,
    monthlyCost,
    costItems,
    quoteItems,
    quotaItems,
  };
}

function AdminTerminalCloudPricingPreview({ platformStatus, setPlatformStatus }) {
  const prices = resolveAdminTerminalCloudAdvancedPrices(platformStatus);
  const preview = buildAdminTerminalCloudPricingPreview(platformStatus);
  const policyItems = [
    {
      key: "free-mode",
      tone: platformStatus?.pocFreeModeEnabled ? "success" : "info",
      label: "무료 기준",
      value: platformStatus?.pocFreeModeEnabled ? "전체 무료" : "사용자별 허용",
      detail: platformStatus?.pocFreeModeEnabled
        ? "모든 클라우드 콘솔 견적이 0원으로 표시됩니다."
        : "사용자 메뉴의 고급 랩 무료 허용 계정만 무료로 처리하고, 나머지는 견적/결제 기준을 따릅니다.",
    },
    {
      key: "payment",
      tone: platformStatus?.paymentGatewayEnabled ? (platformStatus?.mailEnabled ? "success" : "warn") : "muted",
      label: "결제 연결",
      value: platformStatus?.paymentGatewayEnabled ? "결제 사용" : "승인 중심",
      detail: platformStatus?.paymentGatewayEnabled
        ? (platformStatus?.mailEnabled ? "결제 완료/실패 알림까지 함께 사용할 수 있습니다." : "유료 흐름 사용 시 메일 또는 대체 알림 경로 확인이 필요합니다.")
        : "운영자가 승인/견적을 확인한 뒤 수동으로 진행하는 흐름입니다.",
    },
    {
      key: "quote",
      tone: preview.quoteItems.length ? "warn" : "success",
      label: "견적 표시",
      value: preview.quoteItems.length ? `${preview.quoteItems.length}개 미정` : "단가 준비",
      detail: preview.quoteItems.length
        ? "단가가 0인 항목은 사용자 화면에서 견적 필요로 표시됩니다."
        : "샘플 요청 기준으로 예상 월 비용을 바로 보여줄 수 있습니다.",
    },
    {
      key: "quota",
      tone: preview.quotaItems.length ? "success" : "warn",
      label: "Quota 기준",
      value: preview.quotaItems.length ? "한도 표시" : "미설정",
      detail: preview.quotaItems.length
        ? "전용 프로젝트 기본 Quota가 요청 전 영향 미리보기에 함께 반영됩니다."
        : "전용 프로젝트 기본 Quota를 설정해야 생성 전 영향 안내가 또렷해집니다.",
    },
  ];
  const updateAdvancedPrice = (key, value) => {
    setPlatformStatus((current) => ({
      ...current,
      pocAdvancedDailyPrices: {
        ...resolveAdminTerminalCloudAdvancedPrices(current || {}),
        [key]: Math.max(0, Number(value || 0) || 0),
      },
    }));
  };
  const totalLabel = preview.freeMode
    ? "무료 모드"
    : preview.monthlyCost
      ? formatCurrency(preview.monthlyCost)
      : preview.quoteItems.length
        ? "견적 필요"
        : "추가 비용 없음";

  return (
    <div className="settings-panel compact-stack admin-grid-span admin-terminal-cloud-pricing-panel">
      <div className="settings-panel-head">
        <div>
          <strong>터미널 클라우드 단가/사용자 미리보기</strong>
          <p className="hint">사용자가 요청 전 영향 미리보기에서 보게 되는 월 비용과 비용 산정 근거를 같은 기준으로 확인합니다.</p>
        </div>
        <span className="admin-terminal-cloud-pricing-badge">30일 환산</span>
      </div>
      <div className="admin-terminal-cloud-pricing-layout">
        <div className="admin-terminal-cloud-price-editor">
          <strong>고급 자원 1일 단가</strong>
          <div className="admin-form-grid compact-admin-grid">
            {ADMIN_TERMINAL_CLOUD_ADVANCED_PRICE_ITEMS.map((item) => (
              <AdminField key={item.key} label={`${item.label} 1일 단가`} hint={item.detail}>
                <div className="admin-currency-input">
                  <input
                    min="0"
                    step={item.key.includes("Gb") ? "10" : "100"}
                    type="number"
                    value={prices[item.key]}
                    onChange={(event) => updateAdvancedPrice(item.key, event.target.value)}
                    placeholder={String(item.fallback)}
                  />
                  <span>원</span>
                </div>
              </AdminField>
            ))}
          </div>
        </div>
        <div className="admin-terminal-cloud-preview-card">
          <div className="admin-terminal-cloud-preview-head">
            <div>
              <span>사용자 화면 미리보기</span>
              <strong>{totalLabel}</strong>
            </div>
            <small>{preview.freeMode ? "클라우드 콘솔 무료 모드가 켜져 있습니다." : `샘플 Flavor: ${preview.flavor}`}</small>
          </div>
          <div className="admin-terminal-cloud-preview-list">
            {preview.costItems.map((item) => (
              <div className="admin-terminal-cloud-preview-row" key={`${item.label}-${item.detail}`}>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <b>{formatCurrency(item.amount)}</b>
              </div>
            ))}
            {preview.quoteItems.map((item) => (
              <div className="admin-terminal-cloud-preview-row is-quote" key={`${item.label}-${item.detail}`}>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <b>견적 필요</b>
              </div>
            ))}
          </div>
          <div className="admin-terminal-cloud-preview-quota">
            {preview.quotaItems.length ? preview.quotaItems.map((item) => <em key={item}>{item}</em>) : <em>전용 프로젝트 Quota 미설정</em>}
          </div>
        </div>
      </div>
      <div className="admin-terminal-cloud-policy-grid" aria-label="터미널 클라우드 비용 정책 운영 기준">
        {policyItems.map((item) => (
          <article className={`is-${item.tone}`} key={item.key}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function AdminSsoSettingsPanel(props) {
  const [oauthSecretVisibility, setOauthSecretVisibility] = useState({});
  const updateOauthField = (providerKey, field, value) => {
    props.setPlatformStatus((current) => ({
      ...current,
      [`oauth${providerKey}${field}`]: value,
    }));
  };

  return (
    <div className="settings-panel compact-stack">
      <AdminField label="SSO 로그인 노출" hint="꺼두면 로그인 화면의 소셜 로그인 버튼을 모두 숨기고 OAuth 시작 API도 차단합니다. 제공사별 설정값은 유지됩니다.">
        <select
          value={props.platformStatus?.oauthEnabled === false ? "disabled" : "enabled"}
          onChange={(event) => props.setPlatformStatus((current) => ({ ...current, oauthEnabled: event.target.value === "enabled" }))}
        >
          <option value="disabled">숨김</option>
          <option value="enabled">노출</option>
        </select>
      </AdminField>
      {props.platformStatus?.oauthEnabled === false ? (
        <div className="hint">현재 SSO 로그인이 전체 숨김 상태입니다. 테스트 설정은 아래에서 유지한 채로 나중에 다시 노출할 수 있습니다.</div>
      ) : null}
      <AdminField label="공통 Redirect URI" hint="비워두면 현재 도메인의 /api/auth/oauth/{provider}/callback 주소를 자동 사용합니다. {provider}는 google, kakao, naver로 치환됩니다.">
        <input
          value={props.platformStatus?.oauthRedirectUri || ""}
          onChange={(event) => props.setPlatformStatus((current) => ({ ...current, oauthRedirectUri: event.target.value }))}
          placeholder="예: https://example.com/api/auth/oauth/{provider}/callback"
        />
      </AdminField>
      <div className="admin-mail-template-grid">
        {OAUTH_PROVIDERS.map((provider) => {
          const enabledKey = `oauth${provider.key}Enabled`;
          const clientIdKey = `oauth${provider.key}ClientId`;
          const clientSecretKey = `oauth${provider.key}ClientSecret`;
          const redirectUriKey = `oauth${provider.key}RedirectUri`;
          const secretVisible = Boolean(oauthSecretVisibility[provider.key]);
          const configured = Boolean(props.platformStatus?.[clientIdKey] && (!provider.secretRequired || props.platformStatus?.[clientSecretKey]));
          return (
            <AdminDisclosureCard
              key={provider.provider}
              title={`${provider.label} SSO`}
              subtitle={`/api/auth/oauth/${provider.provider}`}
              summary={props.platformStatus?.[enabledKey] ? (configured ? "사용 중" : "설정 필요") : "사용 안 함"}
            >
              <div className="settings-panel compact-stack">
                <AdminField label="사용 여부" hint={`${provider.label} 로그인 버튼 노출과 OAuth 시작을 제어합니다.`}>
                  <select
                    value={props.platformStatus?.[enabledKey] ? "enabled" : "disabled"}
                    onChange={(event) => updateOauthField(provider.key, "Enabled", event.target.value === "enabled")}
                  >
                    <option value="disabled">사용 안 함</option>
                    <option value="enabled">사용</option>
                  </select>
                </AdminField>
                <AdminField label="Client ID" hint={`${provider.label} 개발자 콘솔에서 발급받은 Client ID 또는 REST API 키입니다.`}>
                  <input
                    value={props.platformStatus?.[clientIdKey] || ""}
                    onChange={(event) => updateOauthField(provider.key, "ClientId", event.target.value)}
                    placeholder={`${provider.label} Client ID`}
                  />
                </AdminField>
                <AdminField label="Client Secret" hint={provider.secretRequired ? "운영 로그인에는 필수입니다." : "카카오는 앱 설정에 따라 비워둘 수 있습니다."}>
                  <AdminSecretInput
                    value={props.platformStatus?.[clientSecretKey] || ""}
                    onChange={(event) => updateOauthField(provider.key, "ClientSecret", event.target.value)}
                    placeholder={`${provider.label} Client Secret`}
                    visible={secretVisible}
                    onToggleVisibility={() => setOauthSecretVisibility((current) => ({ ...current, [provider.key]: !current[provider.key] }))}
                  />
                </AdminField>
                <AdminField label="Redirect URI" hint="제공사 콘솔에 등록한 Callback URL이 공통값과 다를 때만 입력합니다.">
                  <input
                    value={props.platformStatus?.[redirectUriKey] || ""}
                    onChange={(event) => updateOauthField(provider.key, "RedirectUri", event.target.value)}
                    placeholder={`예: https://example.com/api/auth/oauth/${provider.provider}/callback`}
                  />
                </AdminField>
                <div className="hint">
                  {configured ? "Client 정보가 입력되어 있습니다." : "Client ID와 필요한 Secret을 입력한 뒤 사용으로 전환하세요."}
                </div>
              </div>
            </AdminDisclosureCard>
          );
        })}
      </div>
    </div>
  );
}

export function AdminSsoTab(props) {
  const oauthCounts = getOauthProviderCounts(props.platformStatus);
  return (
    <section className="portal-stack">
      <div className="admin-simple-card">
        <div className="admin-card-header">
          <strong>SSO 로그인 설정</strong>
          <div className="admin-inline-actions">
            <button className="mini-btn save-btn" onClick={props.onSavePlatformSettings} type="button">설정 저장</button>
          </div>
        </div>
        {props.platformStatusDirty ? <div className="hint">저장되지 않은 변경 사항이 있습니다. 편집 중에는 자동 새로고침으로 덮어쓰지 않습니다.</div> : null}
        <div className="admin-summary-grid">
          <article className="admin-summary-item">
            <span>전체 상태</span>
            <strong>{props.platformStatus?.oauthEnabled === false ? "숨김" : "노출"}</strong>
            <div className="hint">로그인 화면 SSO 버튼</div>
          </article>
          <article className="admin-summary-item">
            <span>사용 중</span>
            <strong>{oauthCounts.enabled}개</strong>
            <div className="hint">로그인 버튼에 노출되는 제공사</div>
          </article>
          <article className="admin-summary-item">
            <span>설정됨</span>
            <strong>{oauthCounts.configured}개</strong>
            <div className="hint">Client 정보가 입력된 제공사</div>
          </article>
          <article className="admin-summary-item">
            <span>Redirect URI</span>
            <strong>{props.platformStatus?.oauthRedirectUri ? "직접 설정" : "자동 생성"}</strong>
            <div className="hint">{props.platformStatus?.oauthRedirectUri || "/api/auth/oauth/{provider}/callback"}</div>
          </article>
        </div>
        <AdminDisclosureCard
          defaultOpen
          title="OAuth 제공사 설정"
          subtitle="Google, 카카오, 네이버 OAuth 로그인을 관리자 화면에서 관리합니다."
          summary={`${oauthCounts.enabled}개 사용 / ${oauthCounts.configured}개 설정`}
        >
          <AdminSsoSettingsPanel {...props} />
        </AdminDisclosureCard>
      </div>
    </section>
  );
}

export function AdminPlatformTab(props) {
  const serviceProjectNameInput = useImeBufferedInput(
    props.platformStatus?.serviceProjectName || "",
    (value) => props.setPlatformStatus((current) => ({ ...current, serviceProjectName: value })),
  );
  const serviceCloudsYamlInput = useImeBufferedInput(
    props.platformStatus?.serviceCloudsYaml || "",
    (value) => props.setPlatformStatus((current) => ({ ...current, serviceCloudsYaml: value })),
  );
  const serviceCloudNameInput = useImeBufferedInput(
    props.platformStatus?.serviceCloudName || "",
    (value) => props.setPlatformStatus((current) => ({ ...current, serviceCloudName: value })),
  );
  const serviceAuthUrlInput = useImeBufferedInput(
    props.platformStatus?.serviceAuthUrl || "",
    (value) => props.setPlatformStatus((current) => ({ ...current, serviceAuthUrl: value })),
  );
  const serviceHeatApiUrlInput = useImeBufferedInput(
    props.platformStatus?.serviceHeatApiUrl || "",
    (value) => props.setPlatformStatus((current) => ({ ...current, serviceHeatApiUrl: value })),
  );
  const serviceComputeApiUrlInput = useImeBufferedInput(
    props.platformStatus?.serviceComputeApiUrl || "",
    (value) => props.setPlatformStatus((current) => ({ ...current, serviceComputeApiUrl: value })),
  );
  const serviceNetworkApiUrlInput = useImeBufferedInput(
    props.platformStatus?.serviceNetworkApiUrl || "",
    (value) => props.setPlatformStatus((current) => ({ ...current, serviceNetworkApiUrl: value })),
  );
  const [hideEmptyValidationItems, setHideEmptyValidationItems] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("admin:serviceValidation:hideEmptyItems") === "1";
    } catch {
      return false;
    }
  });
  const [releaseSnapshotStatus, setReleaseSnapshotStatus] = useState("");
  const [v2ReleaseManualFlowChecks, setV2ReleaseManualFlowChecks] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      const parsed = JSON.parse(window.localStorage.getItem(ADMIN_V2_RELEASE_FLOW_CHECKS_STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const [v2ReleaseAutoSmokeRunning, setV2ReleaseAutoSmokeRunning] = useState(false);
  const [v2ReleaseAutoSmokeResults, setV2ReleaseAutoSmokeResults] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(ADMIN_V2_RELEASE_AUTO_SMOKE_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [zunImageSearch, setZunImageSearch] = useState({
    query: "",
    loading: false,
    message: "",
    results: [],
    downloadingImage: "",
  });
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let targetId = "";
    try {
      targetId = window.sessionStorage.getItem(ADMIN_PLATFORM_FOCUS_STORAGE_KEY) || "";
      window.sessionStorage.removeItem(ADMIN_PLATFORM_FOCUS_STORAGE_KEY);
    } catch {
      return undefined;
    }
    if (!targetId) return undefined;
    const timer = window.setTimeout(() => {
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.querySelector?.("input, select, textarea, button")?.focus?.({ preventScroll: true });
    }, 80);
    return () => window.clearTimeout(timer);
  }, []);
  const addZunAllowedImage = (imageName) => {
    const normalized = String(imageName || "").trim();
    if (!normalized) return;
    props.setPlatformStatus((current) => {
      const currentImages = Array.isArray(current?.zunAllowedImages) ? current.zunAllowedImages : [];
      const nextImages = [...currentImages.map((item) => String(item || "").trim()).filter(Boolean)];
      if (!nextImages.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
        nextImages.push(normalized);
      }
      return { ...current, zunAllowedImages: nextImages };
    });
  };
  const runZunImageSearch = async () => {
    const query = String(zunImageSearch.query || "").trim();
    setZunImageSearch((current) => ({ ...current, loading: true, message: "", results: [] }));
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      params.set("limit", "30");
      const response = await fetch(`/api/internal-images/search?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = response.headers.get("content-type")?.includes("application/json") ? await response.json() : {};
      if (!response.ok) throw new Error(payload?.message || "Registry search failed.");
      const results = (Array.isArray(payload.images) ? payload.images : [])
        .map((item) => ({
          name: String(item?.name || "").trim(),
          repository: String(item?.repository || "").trim(),
          tag: String(item?.tag || "").trim(),
        }))
        .filter((item) => item.name);
      setZunImageSearch((current) => ({
        ...current,
        loading: false,
        message: results.length ? `${results.length}개 이미지를 찾았습니다.` : "검색 결과가 없습니다.",
        results,
      }));
    } catch (error) {
      setZunImageSearch((current) => ({
        ...current,
        loading: false,
        message: error.message || "Registry search failed.",
        results: [],
      }));
    }
  };
  const runZunImageDownload = async (imageName) => {
    const normalized = String(imageName || "").trim();
    if (!normalized) return;
    setZunImageSearch((current) => ({ ...current, downloadingImage: normalized, message: "" }));
    try {
      const response = await fetch("/api/admin/internal-images/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ imageName: normalized }),
      });
      const payload = response.headers.get("content-type")?.includes("application/json") ? await response.json() : {};
      if (!response.ok) throw new Error(payload?.message || "Image download failed.");
      setZunImageSearch((current) => ({
        ...current,
        downloadingImage: "",
        message: payload?.message || "이미지 다운로드 요청이 완료되었습니다.",
      }));
      addZunAllowedImage(normalized);
    } catch (error) {
      setZunImageSearch((current) => ({
        ...current,
        downloadingImage: "",
        message: error.message || "이미지 다운로드 요청에 실패했습니다.",
      }));
    }
  };
  const portalUiMode = getPortalUiMode(props.platformStatus);
  const portalUiModeSummary = getPortalUiModeSummary(portalUiMode);
  const siteVersionNumber = String(props.platformStatus?.siteVersionNumber || "").trim() || "v1.0";
  const siteVersionStage = String(props.platformStatus?.siteVersionStage || "").trim() || "Release";
  const siteVersionReady = /^v?1\.0\b/i.test(siteVersionNumber);
  const siteReleaseStageReady = siteVersionStage.toLowerCase() === "release";
  const portalUiStats = props.adminAccessStats?.portalUiStats || {};
  const portalUiRecentDays = Math.max(1, Number(portalUiStats.recentDays || 5) || 5);
  const portalUiLegacyUsers = Math.max(0, Number(portalUiStats.legacyUsers || 0) || 0);
  const selfServiceProjectQuota = props.platformStatus?.selfServiceVmProjectQuota || {};
  const updateSelfServiceProjectQuota = (key, value) => props.setPlatformStatus((current) => ({
    ...current,
    selfServiceVmProjectQuota: {
      ...(current.selfServiceVmProjectQuota || {}),
      [key]: Math.max(0, Number(value || 0) || 0),
    },
  }));
  const portalUiV2Users = Math.max(0, Number(portalUiStats.v2Users || 0) || 0);
  const portalUiUnknownUsers = Math.max(0, Number(portalUiStats.unknownUsers || 0) || 0);
  const supportAvailabilityMode = normalizeSupportAvailabilityMode(props.platformStatus?.supportAvailabilityMode);
  const supportAvailabilitySummary = getSupportAvailabilitySummary(supportAvailabilityMode);
  const portalPolicyHistory = buildPortalPolicyHistory(props.adminAuditLogs);
  const latestPortalPolicyLog = portalPolicyHistory[0] || null;
  const latestPortalPolicyMode = latestPortalPolicyLog
    ? normalizePortalUiMode(latestPortalPolicyLog.metadata?.portalUiMode, latestPortalPolicyLog.metadata?.userPortalV2Enabled ? "switchable" : "legacy")
    : "";
  const latestPortalPolicySupportMode = latestPortalPolicyLog
    ? normalizeSupportAvailabilityMode(latestPortalPolicyLog.metadata?.supportAvailabilityMode, "")
    : "";
  const latestPortalPolicyAdmin = latestPortalPolicyLog?.adminUsername || latestPortalPolicyLog?.actorName || latestPortalPolicyLog?.actorUsername || "관리자";
  const updateCustomDomainGuidance = (key, value) => {
    props.setPlatformStatus((current) => ({
      ...current,
      [key]: value,
    }));
  };
  const resetCustomDomainGuidance = () => {
    props.setPlatformStatus((current) => ({
      ...current,
      ...DEFAULT_CUSTOM_DOMAIN_GUIDANCE,
    }));
  };
  const applyV2ReleaseRecommendedSettings = () => {
    props.setPlatformStatus((current) => ({
      ...current,
      userPortalV2Enabled: true,
      portalUiMode: "switchable",
      portalV2TransitionNoticeEnabled: true,
      openstackStatusProbesEnabled: true,
      siteVersionNumber: "v1.0",
      siteVersionStage: "Release",
      siteVersionCodename: current.siteVersionCodename || "KIKI OS TERMINAL-LAB",
    }));
  };
  const restoreSavedPlatformSettings = () => {
    if (typeof props.loadPlatformStatus === "function") {
      void props.loadPlatformStatus(false, { force: true });
    }
  };
  const landingPreviewType = props.platformStatus?.landingDemoType === "upload" ? "upload" : "youtube";
  const landingPreviewYoutubeUrl = getYoutubeLoopEmbedUrl(props.platformStatus?.landingYoutubeUrl || "");
  const landingPreviewVideoPath = props.platformStatus?.landingVideoPath || "";
  const landingCustomerLogos = normalizeAdminCustomerLogos(props.platformStatus?.landingCustomerLogos);
  const landingVisibleCustomerLogoCount = landingCustomerLogos.filter((logo) => logo.visible !== false && logo.imagePath).length;
  const setLandingCustomerLogos = (updater) => {
    props.setPlatformStatus((current) => {
      const currentLogos = normalizeAdminCustomerLogos(current?.landingCustomerLogos);
      const nextLogos = typeof updater === "function" ? updater(currentLogos) : updater;
      return {
        ...current,
        landingCustomerLogos: normalizeAdminCustomerLogos(nextLogos),
      };
    });
  };
  const serviceValidationActive = props.serviceValidationStatus?.active ? "활성" : "비활성";
  const validationDetails = props.serviceValidationStatus?.details || {};
  const validationResources = props.serviceValidationStatus?.resources || {};
  const mailTemplateCatalog = Array.isArray(props.platformStatus?.mailTemplateCatalog) ? props.platformStatus.mailTemplateCatalog : [];
  const mailTemplates = props.platformStatus?.mailTemplates && typeof props.platformStatus.mailTemplates === "object" ? props.platformStatus.mailTemplates : {};
  const oauthCounts = getOauthProviderCounts(props.platformStatus);
  const heatTemplateOptions = Array.isArray(props.adminHeatTemplates) ? props.adminHeatTemplates : [];
  const mailProviderLabel = props.platformStatus?.mailProvider === "naver"
    ? "네이버 메일"
    : props.platformStatus?.mailProvider === "google"
      ? "Google 메일"
      : props.platformStatus?.mailProvider === "smtp"
        ? "직접 SMTP"
        : "Webhook";
  const makeValidationItem = (text, isEmpty = false) => ({ text, isEmpty });
  const updateMailTemplateField = (templateKey, field, value) => {
    props.setPlatformStatus((current) => ({
      ...current,
      mailTemplates: {
        ...(current?.mailTemplates || {}),
        [templateKey]: {
          subject: field === "subject" ? value : current?.mailTemplates?.[templateKey]?.subject || "",
          text: field === "text" ? value : current?.mailTemplates?.[templateKey]?.text || "",
        },
      },
    }));
  };
  const resetMailTemplate = (templateKey) => {
    props.setPlatformStatus((current) => {
      const nextTemplates = { ...(current?.mailTemplates || {}) };
      delete nextTemplates[templateKey];
      return { ...current, mailTemplates: nextTemplates };
    });
  };
  const validationChecks = [
    { label: "검증용 과정", ok: (validationDetails.courseTitles?.length || 0) > 0, detail: `${validationDetails.courseTitles?.length || 0}개` },
    { label: "공지/템플릿", ok: Boolean(validationResources.notice && validationResources.heatTemplate && validationResources.applicationYaml && validationResources.exceptionApplicationYaml && validationResources.cloudInitTemplate), detail: "공지, Heat, App YAML, cloud-init" },
    { label: "시험 자원", ok: Boolean(validationResources.writtenExam && validationResources.labExam), detail: "지식검증 + 랩 시험" },
    { label: "가상 사용자", ok: Number(validationDetails.demoUserCount || 0) >= 2, detail: `${validationDetails.demoUserCount || 0}명` },
    { label: "랩 샘플", ok: Number(validationDetails.demoLabCount || 0) > 0, detail: `${validationDetails.demoLabCount || 0}건` },
    { label: "다중 VM 랩", ok: Number(validationDetails.demoMultiVmLabCount || 0) > 0, detail: `${validationDetails.demoMultiVmLabCount || 0}건` },
    { label: "공개 URL/SSH/RDP", ok: Number(validationDetails.demoPublishedDomainLabCount || 0) > 0 && Number(validationDetails.demoExternalSshLabCount || 0) > 0 && Number(validationDetails.demoExternalRdpLabCount || 0) > 0, detail: `URL ${validationDetails.demoPublishedDomainLabCount || 0} / SSH ${validationDetails.demoExternalSshLabCount || 0} / RDP ${validationDetails.demoExternalRdpLabCount || 0}` },
    { label: "클라우드 콘솔 샘플", ok: Number(validationDetails.demoCustomLabCount || 0) > 0, detail: `${validationDetails.demoCustomLabCount || 0}건` },
    { label: "클라우드 콘솔 확장 샘플", ok: Number(validationDetails.demoAdvancedCustomLabCount || 0) > 0 && Number(validationDetails.demoMultiInstanceCustomLabCount || 0) > 0, detail: `고급 ${validationDetails.demoAdvancedCustomLabCount || 0} / 다중 ${validationDetails.demoMultiInstanceCustomLabCount || 0}` },
    { label: "Q/A 상태", ok: Number(validationDetails.demoQnaInProgressCount || 0) > 0 && Number(validationDetails.demoQnaAnsweredCount || 0) > 0, detail: `답변중 ${validationDetails.demoQnaInProgressCount || 0} / 완료 ${validationDetails.demoQnaAnsweredCount || 0}` },
    { label: "쪽지 상태", ok: Number(validationDetails.demoUnreadMessageCount || 0) > 0 && Number(validationDetails.demoReadMessageCount || 0) > 0, detail: `안읽음 ${validationDetails.demoUnreadMessageCount || 0} / 읽음 ${validationDetails.demoReadMessageCount || 0}` },
    { label: "알림 상태", ok: Number(validationDetails.demoUnreadNotificationCount || 0) > 0 && Number(validationDetails.demoReadNotificationCount || 0) > 0, detail: `미확인 ${validationDetails.demoUnreadNotificationCount || 0} / 확인 ${validationDetails.demoReadNotificationCount || 0}` },
  ];
  const validationQuickGuide = [
    "1. 검증 자원 생성 후 과정, 시험, 템플릿, 가상 계정 수가 0보다 큰지 확인합니다.",
    "2. 공개 URL, 외부 SSH, 다중 인스턴스 랩과 클라우드 콘솔 샘플이 함께 준비되었는지 확인합니다.",
    "3. 검증 자원 정리 후 생성 개수와 마케팅/메일/랩 샘플 수가 다시 0으로 돌아오는지 확인합니다.",
    "4. 생성 후 정리를 한 번 더 반복해 중복 생성 없이 같은 기준으로 왕복되는지 확인합니다.",
  ];
  const validationSummaryGroups = [
    {
      key: "basic",
      title: "기본",
      summary: `${props.serviceValidationStatus?.createdCount ?? 0}개 / 과정 ${props.serviceValidationStatus?.details?.courseTitles?.length ?? 0}개`,
      items: [
        makeValidationItem(`현재 상태: ${props.serviceValidationStatus?.active ? "검증 자원 생성됨" : "검증 자원 없음"}`, !props.serviceValidationStatus?.active),
        makeValidationItem(`생성 개수: ${props.serviceValidationStatus?.createdCount ?? 0}`, Number(props.serviceValidationStatus?.createdCount ?? 0) === 0),
        makeValidationItem(props.serviceValidationStatus?.summary || "서비스 오픈 전 UI/자료 연결 검증용 임시 자원을 만들 수 있습니다."),
        makeValidationItem(`과정 수: ${props.serviceValidationStatus?.details?.courseTitles?.length ?? 0}`, Number(props.serviceValidationStatus?.details?.courseTitles?.length ?? 0) === 0),
        props.serviceValidationStatus?.details?.courseTitles?.length
          ? makeValidationItem(`과정 목록: ${props.serviceValidationStatus.details.courseTitles.join(", ")}`)
          : makeValidationItem("과정 목록: 없음", true),
        makeValidationItem(`공지: ${props.serviceValidationStatus?.resources?.notice ? props.serviceValidationStatus?.details?.noticeTitle || "생성됨" : "없음"}`, !props.serviceValidationStatus?.resources?.notice),
        makeValidationItem(`Heat 템플릿: ${props.serviceValidationStatus?.resources?.heatTemplate ? props.serviceValidationStatus?.details?.heatTemplateName || "생성됨" : "없음"}`, !props.serviceValidationStatus?.resources?.heatTemplate),
        makeValidationItem(`다중 인스턴스 Heat 템플릿: ${props.serviceValidationStatus?.resources?.multiVmHeatTemplate ? props.serviceValidationStatus?.details?.multiVmHeatTemplateName || "생성됨" : "없음"}`, !props.serviceValidationStatus?.resources?.multiVmHeatTemplate),
        makeValidationItem(`Application YAML: ${props.serviceValidationStatus?.resources?.applicationYaml ? props.serviceValidationStatus?.details?.applicationYamlName || "생성됨" : "없음"}`, !props.serviceValidationStatus?.resources?.applicationYaml),
        makeValidationItem(`예외 Application YAML: ${props.serviceValidationStatus?.resources?.exceptionApplicationYaml ? props.serviceValidationStatus?.details?.exceptionApplicationYamlName || "생성됨" : "없음"}`, !props.serviceValidationStatus?.resources?.exceptionApplicationYaml),
        makeValidationItem(`cloud-init: ${props.serviceValidationStatus?.resources?.cloudInitTemplate ? props.serviceValidationStatus?.details?.cloudInitTemplateName || "생성됨" : "없음"}`, !props.serviceValidationStatus?.resources?.cloudInitTemplate),
        makeValidationItem(`지식검증: ${props.serviceValidationStatus?.resources?.writtenExam ? props.serviceValidationStatus?.details?.writtenExamTitle || "생성됨" : "없음"}`, !props.serviceValidationStatus?.resources?.writtenExam),
        makeValidationItem(`랩 시험: ${props.serviceValidationStatus?.resources?.labExam ? props.serviceValidationStatus?.details?.labExamTitle || "생성됨" : "없음"}`, !props.serviceValidationStatus?.resources?.labExam),
        makeValidationItem(`가상 사용자 수: ${props.serviceValidationStatus?.details?.demoUserCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoUserCount ?? 0) === 0),
        makeValidationItem(`가상 자격증 수: ${props.serviceValidationStatus?.details?.demoCertificateCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoCertificateCount ?? 0) === 0),
        makeValidationItem(`초대장 샘플 수: ${props.serviceValidationStatus?.details?.demoInviteCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoInviteCount ?? 0) === 0),
        makeValidationItem(`과정 신청 샘플 수: ${props.serviceValidationStatus?.details?.demoAccessRequestCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoAccessRequestCount ?? 0) === 0),
      ],
    },
    {
      key: "network",
      title: "네트워크",
      summary: `랩 ${props.serviceValidationStatus?.details?.demoLabCount ?? 0} / 공개 URL ${props.serviceValidationStatus?.details?.demoPublishedDomainLabCount ?? 0}`,
      items: [
        makeValidationItem(`랩 요청 샘플 수: ${props.serviceValidationStatus?.details?.demoLabCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoLabCount ?? 0) === 0),
        makeValidationItem(`랩 승인 대기 샘플 수: ${props.serviceValidationStatus?.details?.pendingLabApprovalCount ?? 0}`, Number(props.serviceValidationStatus?.details?.pendingLabApprovalCount ?? 0) === 0),
        makeValidationItem(`외부 노출 승인 대기 샘플 수: ${props.serviceValidationStatus?.details?.pendingExposureCount ?? 0}`, Number(props.serviceValidationStatus?.details?.pendingExposureCount ?? 0) === 0),
        makeValidationItem(`즉시 공개 과정 수: ${props.serviceValidationStatus?.details?.instantDomainCourseCount ?? 0}`, Number(props.serviceValidationStatus?.details?.instantDomainCourseCount ?? 0) === 0),
        makeValidationItem(`승인형 공개 과정 수: ${props.serviceValidationStatus?.details?.manualDomainCourseCount ?? 0}`, Number(props.serviceValidationStatus?.details?.manualDomainCourseCount ?? 0) === 0),
        makeValidationItem(`다중 인스턴스 과정 수: ${props.serviceValidationStatus?.details?.multiVmCourseCount ?? 0}`, Number(props.serviceValidationStatus?.details?.multiVmCourseCount ?? 0) === 0),
        makeValidationItem(`다중 인스턴스 랩 샘플 수: ${props.serviceValidationStatus?.details?.demoMultiVmLabCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoMultiVmLabCount ?? 0) === 0),
        makeValidationItem(`공개 URL 포함 랩 샘플 수: ${props.serviceValidationStatus?.details?.demoPublishedDomainLabCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoPublishedDomainLabCount ?? 0) === 0),
        makeValidationItem(`외부 SSH 포함 랩 샘플 수: ${props.serviceValidationStatus?.details?.demoExternalSshLabCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoExternalSshLabCount ?? 0) === 0),
        makeValidationItem(`외부 RDP 포함 랩 샘플 수: ${props.serviceValidationStatus?.details?.demoExternalRdpLabCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoExternalRdpLabCount ?? 0) === 0),
        makeValidationItem(`사용자화 가상머신 샘플 수: ${props.serviceValidationStatus?.details?.demoSelfServiceVmCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoSelfServiceVmCount ?? 0) === 0),
        makeValidationItem(`컨테이너 샘플 수: ${props.serviceValidationStatus?.details?.demoContainerCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoContainerCount ?? 0) === 0),
        makeValidationItem(`쿠버네티스 샘플 수: ${props.serviceValidationStatus?.details?.demoMagnumCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoMagnumCount ?? 0) === 0),
        makeValidationItem(`클라우드 콘솔 샘플 수: ${props.serviceValidationStatus?.details?.demoCustomLabCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoCustomLabCount ?? 0) === 0),
        makeValidationItem(`클라우드 콘솔 확장 샘플 수: ${props.serviceValidationStatus?.details?.demoAdvancedCustomLabCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoAdvancedCustomLabCount ?? 0) === 0),
        makeValidationItem(`다중 인스턴스 클라우드 콘솔 샘플 수: ${props.serviceValidationStatus?.details?.demoMultiInstanceCustomLabCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoMultiInstanceCustomLabCount ?? 0) === 0),
        makeValidationItem(`견적 대기 클라우드 콘솔 샘플 수: ${props.serviceValidationStatus?.details?.demoQuotedCustomLabCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoQuotedCustomLabCount ?? 0) === 0),
      ],
    },
    {
      key: "marketing",
      title: "마케팅",
      summary: `결제 ${props.serviceValidationStatus?.details?.demoPaymentCount ?? 0} / 쿠폰 ${props.serviceValidationStatus?.details?.demoMarketingCouponCount ?? 0}`,
      items: [
        makeValidationItem(`결제 샘플 수: ${props.serviceValidationStatus?.details?.demoPaymentCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoPaymentCount ?? 0) === 0),
        makeValidationItem(`마케팅 무료 강의 뽑기 샘플 수: ${props.serviceValidationStatus?.details?.demoMarketingLuckyDrawCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoMarketingLuckyDrawCount ?? 0) === 0),
        makeValidationItem(`마케팅 보상 샘플 수: ${props.serviceValidationStatus?.details?.demoMarketingRewardCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoMarketingRewardCount ?? 0) === 0),
        makeValidationItem(`마케팅 쿠폰 샘플 수: ${props.serviceValidationStatus?.details?.demoMarketingCouponCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoMarketingCouponCount ?? 0) === 0),
        props.serviceValidationStatus?.details?.marketingLuckyDrawTitle
          ? makeValidationItem(`마케팅 이벤트: ${props.serviceValidationStatus.details.marketingLuckyDrawTitle}`)
          : makeValidationItem("마케팅 이벤트: 없음", true),
        makeValidationItem(`메일 이력 샘플 수: ${props.serviceValidationStatus?.details?.demoMailLogCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoMailLogCount ?? 0) === 0),
      ],
    },
    {
      key: "communication",
      title: "커뮤니케이션",
      summary: `Q/A ${props.serviceValidationStatus?.details?.demoQnaCount ?? 0} / 쪽지 ${props.serviceValidationStatus?.details?.demoMessageCount ?? 0}`,
      items: [
        makeValidationItem(`Q/A 샘플 수: ${props.serviceValidationStatus?.details?.demoQnaCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoQnaCount ?? 0) === 0),
        makeValidationItem(`Q/A 답변중 샘플 수: ${props.serviceValidationStatus?.details?.demoQnaInProgressCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoQnaInProgressCount ?? 0) === 0),
        makeValidationItem(`Q/A 답변완료 샘플 수: ${props.serviceValidationStatus?.details?.demoQnaAnsweredCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoQnaAnsweredCount ?? 0) === 0),
        makeValidationItem(`쪽지 샘플 수: ${props.serviceValidationStatus?.details?.demoMessageCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoMessageCount ?? 0) === 0),
        makeValidationItem(`안읽음 쪽지 샘플 수: ${props.serviceValidationStatus?.details?.demoUnreadMessageCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoUnreadMessageCount ?? 0) === 0),
        makeValidationItem(`읽음 쪽지 샘플 수: ${props.serviceValidationStatus?.details?.demoReadMessageCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoReadMessageCount ?? 0) === 0),
        makeValidationItem(`알림 샘플 수: ${props.serviceValidationStatus?.details?.demoNotificationCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoNotificationCount ?? 0) === 0),
        makeValidationItem(`미확인 알림 샘플 수: ${props.serviceValidationStatus?.details?.demoUnreadNotificationCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoUnreadNotificationCount ?? 0) === 0),
        makeValidationItem(`확인 알림 샘플 수: ${props.serviceValidationStatus?.details?.demoReadNotificationCount ?? 0}`, Number(props.serviceValidationStatus?.details?.demoReadNotificationCount ?? 0) === 0),
      ],
    },
  ];
  const countLabel = (count, unit = "개") => (count > 0 ? `${count}${unit}` : "미설정");
  const enabledLabel = (enabled) => (enabled ? "사용" : "중지");
  const terminalRouteSummary = [
    `파일 업로드 ${props.platformStatus?.terminalFileUploadEnabled === true ? "표시" : "숨김"}`,
    `도메인 ${props.platformStatus?.publicDomainRoutesEnabled !== false ? "허용" : "차단"}`,
    `TCP ${props.platformStatus?.publicTcpRoutesEnabled ? "허용" : "차단"}`,
    `SSH ${props.platformStatus?.externalSshRoutesEnabled !== false ? "허용" : "차단"}`,
    `RDP ${props.platformStatus?.externalRdpRoutesEnabled !== false ? "허용" : "차단"}`,
  ].join(" · ");
  const selfServiceReady = Boolean(props.platformStatus?.selfServiceVmServiceEnabled) && !props.platformStatus?.labCircuitBreaker;
  const circuitBreakerSourceLabel = props.platformStatus?.labCircuitBreakerSource === "quota" ? "Quota 자동 차단" : "관리자 수동 차단";
  const circuitBreakerMetricLabel = {
    cores: "vCPU",
    ram: "RAM",
    volumeStorage: "Volume",
  }[props.platformStatus?.labCircuitBreakerMetric] || props.platformStatus?.labCircuitBreakerMetric || "";
  const selfServiceFlavorCount = listCount(props.platformStatus?.selfServiceVmAllowedFlavors);
  const selfServiceImageCount = listCount(props.platformStatus?.selfServiceVmAllowedImages);
  const selfServiceProjectCount = listCount(props.platformStatus?.selfServiceVmAllowedProjects);
  const openstackProjectAutoConfigure = Boolean(props.platformStatus?.selfServiceVmProjectAutoConfigureEnabled);
  const platformImpactItems = [
    {
      key: "portal",
      title: "사용자 포털",
      status: portalUiModeSummary.label,
      tone: portalUiMode === "legacy" ? "muted" : "ready",
      detail: portalUiModeSummary.hint,
      meta: props.platformStatus?.portalV2TransitionNoticeEnabled ? "v2 전환 안내 표시" : "전환 안내 숨김",
    },
    {
      key: "support",
      title: "문의 / 운영지원",
      status: supportAvailabilitySummary.label,
      tone: supportAvailabilityMode === "away" ? "warn" : "ready",
      detail: supportAvailabilitySummary.hint,
      meta: supportAvailabilityMode === "away" ? props.platformStatus?.supportUnavailableMessage || "부재중 안내 사용" : "문의 접수 가능",
    },
    {
      key: "lab",
      title: "클라우드 콘솔",
      status: props.platformStatus?.labCircuitBreaker ? "생성 차단" : enabledLabel(Boolean(props.platformStatus?.selfServiceVmServiceEnabled)),
      tone: props.platformStatus?.labCircuitBreaker ? "danger" : selfServiceReady ? "ready" : "warn",
      detail: props.platformStatus?.labCircuitBreaker
        ? props.platformStatus?.labCircuitBreakerMessage || "사용자 랩 생성 요청이 차단됩니다."
        : `${props.platformStatus?.selfServiceVmAutoProvisionEnabled === false ? "관리자 승인 후 실행" : "즉시 실행"} · 전용 프로젝트 ${openstackProjectAutoConfigure ? "자동 구성" : "수동 연결"}`,
      meta: `Flavor ${countLabel(selfServiceFlavorCount)} / 이미지 ${countLabel(selfServiceImageCount)} / 공용 프로젝트 ${countLabel(selfServiceProjectCount)}`,
    },
    {
      key: "quota",
      title: "전용 프로젝트 Quota",
      status: openstackProjectAutoConfigure ? "승인 시 적용" : "수동 관리",
      tone: openstackProjectAutoConfigure ? "ready" : "muted",
      detail: `인스턴스 ${selfServiceProjectQuota.instances || 0} · vCPU ${selfServiceProjectQuota.cores || 0} · RAM ${selfServiceProjectQuota.ram || 0}MB · 볼륨 ${selfServiceProjectQuota.volumes || 0}`,
      meta: props.platformStatus?.selfServiceVmProjectPrefix || "custom-lab- 접두어 사용",
    },
    {
      key: "extensions",
      title: "확장 랩",
      status: `${[
        props.platformStatus?.zunEnabled,
        props.platformStatus?.magnumEnabled,
        props.platformStatus?.troveEnabled,
        props.platformStatus?.aiGpuEnabled,
      ].filter(Boolean).length}/4 공개`,
      tone: [
        props.platformStatus?.zunEnabled,
        props.platformStatus?.magnumEnabled,
        props.platformStatus?.troveEnabled,
        props.platformStatus?.aiGpuEnabled,
      ].some(Boolean) ? "ready" : "muted",
      detail: `컨테이너 이미지 ${countLabel(listCount(props.platformStatus?.zunAllowedImages))} / DB 엔진 ${countLabel(listCount(props.platformStatus?.troveAllowedDatastores))}`,
      meta: `K8s ${enabledLabel(Boolean(props.platformStatus?.magnumEnabled))} · AI/GPU ${enabledLabel(Boolean(props.platformStatus?.aiGpuEnabled))}`,
    },
    {
      key: "terminal",
      title: "터미널 접속",
      status: props.platformStatus?.externalSshRoutesEnabled === false ? "외부 SSH 차단" : "외부 접속 관리",
      tone: props.platformStatus?.terminalFileUploadEnabled === true || props.platformStatus?.publicTcpRoutesEnabled || props.platformStatus?.publicDomainRoutesEnabled !== false ? "ready" : "muted",
      detail: terminalRouteSummary,
      meta: getNormalizedSshPublicHost(props.platformStatus?.sshPublicHost),
    },
    {
      key: "commerce",
      title: "결제 / 메일",
      status: props.platformStatus?.paymentGatewayEnabled ? "결제 활성" : "결제 비활성",
      tone: props.platformStatus?.paymentGatewayEnabled && !props.platformStatus?.mailEnabled ? "warn" : props.platformStatus?.paymentGatewayEnabled || props.platformStatus?.mailEnabled ? "ready" : "muted",
      detail: `메일 ${props.platformStatus?.mailEnabled ? `${mailProviderLabel} 사용` : "비활성"} · 시험 결과 ${props.platformStatus?.labExamResultMessageEnabled ? "메일 발송" : "메일 미발송"}`,
      meta: props.platformStatus?.paymentGatewayEnabled ? "유료 신청 흐름 노출 가능" : "무료/승인형 흐름 중심",
    },
    {
      key: "security",
      title: "가입 / 보안",
      status: props.platformStatus?.inviteOnlyMode ? "초대 전용" : "회원가입 허용",
      tone: props.platformStatus?.accountSharingProtectionEnabled || props.platformStatus?.otpAdminRequired || props.platformStatus?.otpUserEnabled ? "ready" : "muted",
      detail: `OTP 관리자 ${enabledLabel(Boolean(props.platformStatus?.otpAdminRequired))} · 사용자 ${enabledLabel(Boolean(props.platformStatus?.otpUserEnabled))}`,
      meta: props.platformStatus?.accountSharingProtectionEnabled ? "계정 공유 감지 사용" : "계정 공유 감지 미사용",
    },
  ];
  const platformImpactAttentionCount = platformImpactItems.filter((item) => ["warn", "danger"].includes(item.tone)).length;
  const terminalCloudPricingPreview = buildAdminTerminalCloudPricingPreview(props.platformStatus || {});
  const terminalCloudExtensionEnabledCount = [
    props.platformStatus?.zunEnabled,
    props.platformStatus?.magnumEnabled,
    props.platformStatus?.troveEnabled,
    props.platformStatus?.aiGpuEnabled,
  ].filter(Boolean).length;
  const terminalCloudRoleCount = listCount(props.platformStatus?.selfServiceVmProjectRoleNames);
  const terminalCloudFlavorPreview = countLabel(selfServiceFlavorCount);
  const terminalCloudImagePreview = countLabel(selfServiceImageCount);
  const terminalCloudOpsCards = [
    {
      key: "vm",
      label: "VM 신청",
      value: selfServiceReady ? "사용자 노출" : props.platformStatus?.labCircuitBreaker ? "생성 차단" : "비공개",
      detail: `Flavor ${terminalCloudFlavorPreview} / 이미지 ${terminalCloudImagePreview}`,
      tone: props.platformStatus?.labCircuitBreaker ? "danger" : selfServiceReady && selfServiceFlavorCount && selfServiceImageCount ? "ready" : "warn",
    },
    {
      key: "project",
      label: "전용 프로젝트",
      value: openstackProjectAutoConfigure ? "자동 구성" : "수동 승인",
      detail: `${props.platformStatus?.selfServiceVmProjectPrefix || "custom-lab-"} 접두어 / 역할 ${countLabel(terminalCloudRoleCount)}`,
      tone: openstackProjectAutoConfigure ? (terminalCloudRoleCount ? "ready" : "warn") : "muted",
    },
    {
      key: "network",
      label: "네트워크",
      value: props.platformStatus?.selfServiceVmProjectAutoNetworkEnabled ? "전용망 생성" : "공유망 우선",
      detail: `외부망 ${props.platformStatus?.selfServiceVmProjectExternalNetworkName || "미지정"} / Floating IP ${enabledLabel(Boolean(props.platformStatus?.selfServiceVmFloatingIpEnabled))}`,
      tone: props.platformStatus?.selfServiceVmProjectAutoNetworkEnabled ? "ready" : "muted",
    },
    {
      key: "extensions",
      label: "확장 기능",
      value: `${terminalCloudExtensionEnabledCount}/4 공개`,
      detail: `컨테이너 이미지 ${countLabel(listCount(props.platformStatus?.zunAllowedImages))} / DB 엔진 ${countLabel(listCount(props.platformStatus?.troveAllowedDatastores))}`,
      tone: terminalCloudExtensionEnabledCount ? "ready" : "muted",
    },
    {
      key: "price",
      label: "비용 정책",
      value: props.platformStatus?.pocFreeModeEnabled ? "무료 모드" : terminalCloudPricingPreview.monthlyCost ? formatCurrency(terminalCloudPricingPreview.monthlyCost) : "견적 필요",
      detail: props.platformStatus?.paymentGatewayEnabled ? "결제 흐름 사용" : "승인/무료 중심",
      tone: props.platformStatus?.pocFreeModeEnabled || terminalCloudPricingPreview.monthlyCost ? "ready" : "warn",
    },
  ];
  const terminalCloudOpsChecks = [
    {
      key: "vm-ready",
      tone: selfServiceReady ? "ready" : props.platformStatus?.labCircuitBreaker ? "danger" : "warn",
      title: "사용자 신청 노출",
      detail: selfServiceReady ? "클라우드 콘솔과 터미널 클라우드에서 VM 신청 흐름이 열려 있습니다." : "사용자에게 VM 신청이 제한되거나 생성 차단 상태입니다.",
    },
    {
      key: "flavor-image",
      tone: selfServiceFlavorCount && selfServiceImageCount ? "ready" : "danger",
      title: "Flavor / 이미지 허용 목록",
      detail: selfServiceFlavorCount && selfServiceImageCount ? "사용자가 선택할 기본 사양과 OS 이미지가 준비되어 있습니다." : "허용 Flavor 또는 이미지가 비어 있으면 신청 화면에서 선택이 막힐 수 있습니다.",
    },
    {
      key: "project-auto",
      tone: openstackProjectAutoConfigure ? (terminalCloudRoleCount ? "ready" : "warn") : "muted",
      title: "OpenStack 프로젝트 구성",
      detail: openstackProjectAutoConfigure ? "승인 시 프로젝트 생성, 역할 부여, Quota 적용을 자동으로 시도합니다." : "승인 후 프로젝트 연결과 Quota는 운영자가 직접 확인해야 합니다.",
    },
    {
      key: "container-images",
      tone: props.platformStatus?.zunEnabled ? (listCount(props.platformStatus?.zunAllowedImages) ? "ready" : "warn") : "muted",
      title: "컨테이너 랩 이미지",
      detail: props.platformStatus?.zunEnabled ? "컨테이너 랩은 허용 이미지 목록에서만 실행됩니다." : "컨테이너 랩은 현재 사용자 메뉴에서 숨겨집니다.",
    },
    {
      key: "database",
      tone: props.platformStatus?.troveEnabled
        ? (listCount(props.platformStatus?.troveAllowedDatastores) && listCount(props.platformStatus?.troveAllowedFlavors) && listCount(props.platformStatus?.troveAllowedSizesGb) ? "ready" : "warn")
        : "muted",
      title: "데이터베이스 랩",
      detail: props.platformStatus?.troveEnabled ? "Datastore, Flavor, 볼륨 크기를 모두 설정해야 사용자가 혼동하지 않습니다." : "데이터베이스 랩은 현재 사용자 메뉴에서 숨겨집니다.",
    },
  ];
  const terminalCloudFeatureRouteItems = [
    {
      key: "project",
      feature: "전용 프로젝트 요청",
      userEntry: "클라우드 콘솔 > 프로젝트",
      status: openstackProjectAutoConfigure ? "자동 구성" : "수동 승인",
      tone: openstackProjectAutoConfigure ? (terminalCloudRoleCount ? "ready" : "warn") : "muted",
      adminSetting: "전용 프로젝트 자동 구성, 역할, Quota",
      nextAction: openstackProjectAutoConfigure ? "승인 시 프로젝트 생성/역할/Quota가 함께 실행됩니다." : "승인 후 프로젝트 연결과 Quota를 운영자가 확인해야 합니다.",
      targetId: "admin-platform-lab-settings",
      requirements: [
        { label: "프로젝트 자동 구성", ok: openstackProjectAutoConfigure, detail: openstackProjectAutoConfigure ? "승인 시 OpenStack 프로젝트를 생성합니다." : "수동 승인 후 프로젝트 연결이 필요합니다." },
        { label: `역할 ${countLabel(terminalCloudRoleCount)}`, ok: terminalCloudRoleCount > 0, detail: "member, heat_stack_owner 같은 기본 역할이 필요합니다." },
        { label: terminalCloudPricingPreview.quotaItems.length ? "Quota 기본값 설정" : "Quota 기본값 미설정", ok: terminalCloudPricingPreview.quotaItems.length > 0, detail: "승인 전 예상 자원 영향과 비용 안내에 사용됩니다." },
      ],
    },
    {
      key: "instance",
      feature: "VM / 인스턴스 생성",
      userEntry: "클라우드 콘솔 > 인스턴스",
      status: selfServiceReady ? "사용자 노출" : "제한됨",
      tone: selfServiceReady && selfServiceFlavorCount && selfServiceImageCount ? "ready" : "warn",
      adminSetting: "클라우드 콘솔 공개, 허용 Flavor, 허용 이미지",
      nextAction: selfServiceReady ? "사용자는 이미지와 Flavor를 선택해 HeatStack 생성을 요청합니다." : "서비스 공개 여부와 생성 차단 상태를 먼저 확인하세요.",
      targetId: "admin-platform-lab-settings",
      requirements: [
        { label: "신청 공개", ok: selfServiceReady, detail: props.platformStatus?.labCircuitBreaker ? "생성 차단이 켜져 있습니다." : "사용자 메뉴에서 VM 신청 진입점을 엽니다." },
        { label: `Flavor ${countLabel(selfServiceFlavorCount)}`, ok: selfServiceFlavorCount > 0, detail: "사용자가 선택할 수 있는 사양 목록입니다." },
        { label: `이미지 ${countLabel(selfServiceImageCount)}`, ok: selfServiceImageCount > 0, detail: "관리자가 허용한 OS 이미지에서만 생성합니다." },
      ],
    },
    {
      key: "network",
      feature: "전용 네트워크 / 라우터 / 포트",
      userEntry: "클라우드 콘솔 > 네트워크",
      status: props.platformStatus?.selfServiceVmProjectAutoNetworkEnabled ? "전용망 생성" : "공유망 우선",
      tone: props.platformStatus?.selfServiceVmProjectAutoNetworkEnabled ? "ready" : "muted",
      adminSetting: "전용망 자동 구성, VLAN 범위, 라우터/Floating IP",
      nextAction: props.platformStatus?.selfServiceVmProjectAutoNetworkEnabled ? "사용자 요청의 네트워크 이름/CIDR이 승인 흐름에 함께 전달됩니다." : "기본 net-infra 사용이 우선이며 필요 시 전용망 요청을 검토합니다.",
      targetId: "admin-platform-lab-settings",
      requirements: [
        { label: props.platformStatus?.selfServiceVmProjectAutoNetworkEnabled ? "전용망 자동 생성" : "공유망 우선 정책", ok: true, detail: props.platformStatus?.selfServiceVmProjectAutoNetworkEnabled ? "네트워크 이름/CIDR/라우터 요청을 승인 흐름에 반영합니다." : "기본 네트워크를 먼저 사용하고 필요 시 전용망 요청을 검토합니다." },
        { label: props.platformStatus?.selfServiceVmProjectExternalNetworkName ? "외부망 지정" : "외부망 미지정", ok: !props.platformStatus?.selfServiceVmProjectAutoNetworkEnabled || Boolean(props.platformStatus?.selfServiceVmProjectExternalNetworkName), detail: "전용망 라우터와 Floating IP 연결 기준입니다." },
        { label: `VLAN ${formatSelfServiceVlanRangeLabel(props.platformStatus)}`, ok: true, detail: "사용자가 비워두면 허용 범위에서 자동 배정합니다." },
      ],
    },
    {
      key: "container",
      feature: "컨테이너 랩",
      userEntry: "클라우드 콘솔 > 컨테이너",
      status: props.platformStatus?.zunEnabled ? "공개" : "숨김",
      tone: props.platformStatus?.zunEnabled ? (listCount(props.platformStatus?.zunAllowedImages) ? "ready" : "warn") : "muted",
      adminSetting: "Zun 사용 여부, 허용 컨테이너 이미지",
      nextAction: props.platformStatus?.zunEnabled ? "허용 이미지가 비어 있으면 생성 버튼이 열려도 실행할 수 없습니다." : "사용자 화면에서는 준비 중/운영 문의 흐름으로 안내됩니다.",
      targetId: "admin-platform-lab-settings",
      requirements: [
        { label: props.platformStatus?.zunEnabled ? "Zun 공개" : "Zun 비공개", ok: Boolean(props.platformStatus?.zunEnabled), detail: "공개해야 클라우드 콘솔에서 컨테이너 생성이 열립니다." },
        { label: `허용 이미지 ${countLabel(listCount(props.platformStatus?.zunAllowedImages))}`, ok: !props.platformStatus?.zunEnabled || listCount(props.platformStatus?.zunAllowedImages) > 0, detail: "직접 이미지 입력 대신 허용 목록을 사용합니다." },
      ],
    },
    {
      key: "cluster",
      feature: "Kubernetes 클러스터",
      userEntry: "클라우드 콘솔 > Kubernetes",
      status: props.platformStatus?.magnumEnabled ? (props.platformStatus?.magnumAutoApproveEnabled ? "정책 자동 승인" : "수동 승인") : "숨김",
      tone: props.platformStatus?.magnumEnabled ? "ready" : "muted",
      adminSetting: "CAPO 사용 여부, 공개 클러스터 프로파일",
      nextAction: props.platformStatus?.magnumEnabled ? (props.platformStatus?.magnumAutoApproveEnabled ? "허용 프로파일·노드 한도·Quota 검사를 통과한 요청은 즉시 생성됩니다." : "사용자는 CAPO 프로파일을 선택해 승인 요청을 남깁니다.") : "사용자 화면에서는 준비 중/운영 문의 흐름으로 안내됩니다.",
      targetId: "admin-platform-lab-settings",
      requirements: [
        { label: props.platformStatus?.magnumEnabled ? "CAPO 공개" : "CAPO 비공개", ok: Boolean(props.platformStatus?.magnumEnabled), detail: props.platformStatus?.magnumAutoApproveEnabled ? "정책 조건을 모두 통과한 요청만 자동 승인됩니다." : "공개 시 클러스터 요청은 관리자 승인형으로 접수됩니다." },
        { label: `프로파일 ${countLabel(listCount(props.platformStatus?.magnumAllowedTemplates))}`, ok: !props.platformStatus?.magnumEnabled || listCount(props.platformStatus?.magnumAllowedTemplates) > 0, detail: "프로파일 카드에 OS, 노드, 생성 시간을 함께 안내합니다." },
      ],
    },
    {
      key: "database",
      feature: "데이터베이스 랩",
      userEntry: "클라우드 콘솔 > 데이터베이스",
      status: props.platformStatus?.troveEnabled ? "비용 확인" : "숨김",
      tone: props.platformStatus?.troveEnabled
        ? (listCount(props.platformStatus?.troveAllowedDatastores) && listCount(props.platformStatus?.troveAllowedFlavors) && listCount(props.platformStatus?.troveAllowedSizesGb) ? "ready" : "warn")
        : "muted",
      adminSetting: "Trove 사용 여부, Datastore, DB Flavor, 볼륨 크기",
      nextAction: props.platformStatus?.troveEnabled ? "허용값이 모두 있어야 사용자가 DB 구성을 끝까지 진행할 수 있습니다." : "사용자 화면에서는 준비 중/운영 문의 흐름으로 안내됩니다.",
      targetId: "admin-platform-lab-settings",
      requirements: [
        { label: props.platformStatus?.troveEnabled ? "Trove 공개" : "Trove 비공개", ok: Boolean(props.platformStatus?.troveEnabled), detail: "공개 시 DB 생성 요청은 비용/스토리지 안내와 함께 노출됩니다." },
        { label: `Datastore ${countLabel(listCount(props.platformStatus?.troveAllowedDatastores))}`, ok: !props.platformStatus?.troveEnabled || listCount(props.platformStatus?.troveAllowedDatastores) > 0, detail: "허용 DB 엔진 목록입니다." },
        { label: `DB Flavor/크기 ${countLabel(listCount(props.platformStatus?.troveAllowedFlavors) + listCount(props.platformStatus?.troveAllowedSizesGb))}`, ok: !props.platformStatus?.troveEnabled || (listCount(props.platformStatus?.troveAllowedFlavors) > 0 && listCount(props.platformStatus?.troveAllowedSizesGb) > 0), detail: "생성 전 비용과 Quota 영향을 계산합니다." },
      ],
    },
    {
      key: "gpu",
      feature: "AI 랩",
      userEntry: "연구실/랩 > AI 랩",
      status: props.platformStatus?.aiGpuEnabled ? "VM/Container" : "숨김",
      tone: props.platformStatus?.aiGpuEnabled && (props.platformStatus?.selfServiceVmServiceEnabled || props.platformStatus?.zunEnabled) ? "ready" : props.platformStatus?.aiGpuEnabled ? "warn" : "muted",
      adminSetting: "AI 랩 공개 여부, VM Flavor/이미지, Zun 허용 이미지",
      nextAction: props.platformStatus?.aiGpuEnabled ? "VM 또는 컨테이너 백엔드와 허용 이미지가 있어야 사용자가 AI 랩을 생성할 수 있습니다." : "사용자 화면에서는 준비 중으로 안내됩니다.",
      targetId: "admin-platform-lab-settings",
      requirements: [
        { label: props.platformStatus?.aiGpuEnabled ? "AI 랩 공개" : "AI 랩 비공개", ok: Boolean(props.platformStatus?.aiGpuEnabled), detail: "공개 시 사용자 메뉴에 VM/Container 통합 생성 화면이 표시됩니다." },
        { label: props.platformStatus?.selfServiceVmServiceEnabled || props.platformStatus?.zunEnabled ? "실행 백엔드 연결" : "백엔드 없음", ok: Boolean(props.platformStatus?.selfServiceVmServiceEnabled || props.platformStatus?.zunEnabled), detail: "VM 또는 Zun 중 하나 이상이 활성화되어야 합니다." },
        { label: `GPU Flavor ${countLabel((props.platformStatus?.aiVmFlavorCatalog || []).filter((profile) => profile?.enabled !== false && profile?.gpuEnabled).length)}`, ok: true, detail: "관리자 AI VM Flavor 프로파일에서 GPU/vGPU와 필수 extra_specs를 명시합니다." },
      ],
    },
    {
      key: "cost",
      feature: "무료/유료 정책",
      userEntry: "클라우드 콘솔 > 견적/요청",
      status: props.platformStatus?.pocFreeModeEnabled ? "무료 모드" : props.platformStatus?.paymentGatewayEnabled ? "결제 연결" : "승인/견적",
      tone: props.platformStatus?.pocFreeModeEnabled || props.platformStatus?.paymentGatewayEnabled ? "ready" : "warn",
      adminSetting: "터미널 클라우드 단가, 무료 모드, 결제 사용 여부",
      nextAction: props.platformStatus?.pocFreeModeEnabled ? "사용자에게 0원 기준으로 안내됩니다." : "결제 미연동이면 관리자 승인/견적 메시지가 기준이 됩니다.",
      targetId: "admin-platform-lab-settings",
      requirements: [
        { label: props.platformStatus?.pocFreeModeEnabled ? "무료 승인 모드" : "유료/견적 모드", ok: true, detail: props.platformStatus?.pocFreeModeEnabled ? "허용 사용자 중심의 무료 신청으로 안내합니다." : "견적 또는 결제 연동 기준으로 안내합니다." },
        { label: terminalCloudPricingPreview.monthlyCost ? "예상 비용 계산" : "단가 미설정", ok: props.platformStatus?.pocFreeModeEnabled || terminalCloudPricingPreview.monthlyCost > 0, detail: "생성 전 비용/Quota 영향 고정 안내에 사용됩니다." },
      ],
    },
  ];
  const terminalCloudRouteWarningCount = terminalCloudFeatureRouteItems.reduce(
    (total, item) => total + (item.requirements || []).filter((requirement) => !requirement.ok).length,
    0,
  );
  const terminalCloudReleaseGaps = [
    props.platformStatus?.labCircuitBreaker
      ? {
        key: "circuit-breaker",
        tone: "danger",
        label: "생성 차단 켜짐",
        detail: props.platformStatus?.labCircuitBreakerMessage || "사용자 랩 생성 요청이 차단됩니다.",
        actionLabel: "생성 차단 설정",
        targetId: "admin-platform-lab-settings",
      }
      : null,
    !props.platformStatus?.selfServiceVmServiceEnabled
      ? {
        key: "vm-service",
        tone: "danger",
        label: "클라우드 콘솔 비공개",
        detail: "v2 기본 UI에서 VM 신청 진입점이 막힙니다.",
        actionLabel: "공개 설정",
        targetId: "admin-platform-lab-settings",
      }
      : null,
    !selfServiceFlavorCount
      ? {
        key: "flavors",
        tone: "danger",
        label: "Flavor 허용 목록 없음",
        detail: "사용자가 인스턴스 사양을 선택할 수 없습니다.",
        actionLabel: "Flavor 설정",
        targetId: "admin-platform-lab-settings",
      }
      : null,
    !selfServiceImageCount
      ? {
        key: "images",
        tone: "danger",
        label: "이미지 허용 목록 없음",
        detail: "사용자가 OS 이미지를 선택할 수 없습니다.",
        actionLabel: "이미지 설정",
        targetId: "admin-platform-lab-settings",
      }
      : null,
    openstackProjectAutoConfigure && !terminalCloudRoleCount
      ? {
        key: "project-roles",
        tone: "warn",
        label: "프로젝트 역할 미설정",
        detail: "자동 승인 시 사용자에게 부여할 OpenStack 역할을 확인해야 합니다.",
        actionLabel: "역할 설정",
        targetId: "admin-platform-lab-settings",
      }
      : null,
    !openstackProjectAutoConfigure
      ? {
        key: "project-auto",
        tone: "warn",
        label: "전용 프로젝트 수동 구성",
        detail: "신청량이 늘면 승인 후 프로젝트 연결이 운영 병목이 될 수 있습니다.",
        actionLabel: "자동 구성 설정",
        targetId: "admin-platform-lab-settings",
      }
      : null,
    props.platformStatus?.selfServiceVmProjectAutoNetworkEnabled && !String(props.platformStatus?.selfServiceVmProjectExternalNetworkName || "").trim()
      ? {
        key: "external-network",
        tone: "warn",
        label: "외부 네트워크 미지정",
        detail: "전용망 자동 구성 시 라우터/Floating IP 연결 기준을 확인해야 합니다.",
        actionLabel: "네트워크 설정",
        targetId: "admin-platform-lab-settings",
      }
      : null,
    props.platformStatus?.zunEnabled && !listCount(props.platformStatus?.zunAllowedImages)
      ? {
        key: "zun-images",
        tone: "warn",
        label: "컨테이너 허용 이미지 없음",
        detail: "컨테이너 랩이 공개되어도 사용자가 실행할 이미지를 선택할 수 없습니다.",
        actionLabel: "컨테이너 설정",
        targetId: "admin-platform-lab-settings",
      }
      : null,
    props.platformStatus?.troveEnabled && !(listCount(props.platformStatus?.troveAllowedDatastores) && listCount(props.platformStatus?.troveAllowedFlavors) && listCount(props.platformStatus?.troveAllowedSizesGb))
      ? {
        key: "trove-catalog",
        tone: "warn",
        label: "DB 허용값 일부 누락",
        detail: "Datastore, DB Flavor, 볼륨 크기 허용 목록을 모두 채워야 합니다.",
        actionLabel: "DB 설정",
        targetId: "admin-platform-lab-settings",
      }
      : null,
    !props.platformStatus?.pocFreeModeEnabled && !terminalCloudPricingPreview.monthlyCost
      ? {
        key: "pricing",
        tone: "warn",
        label: "비용 정책 미확정",
        detail: "무료 모드가 아니면 사용자에게 보여줄 예상 비용 또는 견적 기준을 확인해야 합니다.",
        actionLabel: "비용 설정",
        targetId: "admin-platform-lab-settings",
      }
      : null,
  ].filter(Boolean);
  const terminalCloudCriticalGapCount = terminalCloudReleaseGaps.filter((item) => item.tone === "danger").length;
  const terminalCloudWarningGapCount = Math.max(0, terminalCloudReleaseGaps.length - terminalCloudCriticalGapCount);
  const terminalCloudReleaseEtaMinutes = (terminalCloudCriticalGapCount * 20) + (terminalCloudWarningGapCount * 10);
  const terminalCloudReleaseEtaLabel = formatAdminWorkEstimate(terminalCloudReleaseEtaMinutes);
  const terminalCloudReleaseTone = terminalCloudCriticalGapCount ? "danger" : terminalCloudReleaseGaps.length ? "warn" : "ready";
  const terminalCloudReleaseStatus = terminalCloudReleaseGaps.length ? `확인 필요 ${terminalCloudReleaseGaps.length}건` : "준비됨";
  const apiMonitor = props.apiMonitor || {};
  const statusProbesEnabled = props.platformStatus?.openstackStatusProbesEnabled !== false;
  const portalSmoke = getAdminMonitorState(apiMonitor.portal, "포털 미확인", "포털 API 점검 결과가 아직 없습니다.");
  const rawPostgresSmoke = getAdminMonitorState(apiMonitor.postgres, "DB 미확인", "데이터 저장소 점검 결과가 아직 없습니다.");
  const postgresSmoke = rawPostgresSmoke.tone === "danger" && apiMonitor.portal?.ok
    ? { ...rawPostgresSmoke, tone: "warn" }
    : rawPostgresSmoke;
  const heatSmoke = statusProbesEnabled
    ? getAdminMonitorState(apiMonitor.heat, "Heat 미확인", "Heat 상태 점검 결과가 아직 없습니다.")
    : { tone: "warn", label: "조회 중지", detail: "OpenStack 상태 조회가 꺼져 있어 Heat 연결 상태를 확인하지 못합니다." };
  const quotaSmoke = statusProbesEnabled
    ? getAdminMonitorState(apiMonitor.quota, "Quota 미확인", "Quota 상태 점검 결과가 아직 없습니다.")
    : { tone: "warn", label: "조회 중지", detail: "Quota 상태 조회가 꺼져 있어 자원 여유 판단이 약해집니다." };
  const openstackCaSmoke = getAdminOpenstackCaSmoke(apiMonitor, props.platformStatus);
  const cloudsYamlSmoke = getAdminCloudsYamlSmoke(apiMonitor, props.platformStatus);
  const extensionSmokeItems = [
    props.platformStatus?.zunEnabled ? { key: "zun", label: "Zun", state: getAdminMonitorState(apiMonitor.zun, "Zun 미확인") } : null,
    props.platformStatus?.magnumEnabled ? { key: "magnum", label: "CAPO", state: getAdminMonitorState(apiMonitor.magnum, "CAPO 미확인") } : null,
    props.platformStatus?.troveEnabled ? { key: "trove", label: "Trove", state: getAdminMonitorState(apiMonitor.trove, "Trove 미확인") } : null,
  ].filter(Boolean);
  const extensionAttentionItems = extensionSmokeItems.filter((item) => ["warn", "danger"].includes(item.state.tone));
  const extensionSmoke = extensionSmokeItems.length
    ? {
      tone: extensionAttentionItems.length ? getAdminSmokeTone(extensionSmokeItems.map((item) => item.state)) : "ready",
      label: extensionAttentionItems.length ? `확인 ${extensionAttentionItems.length}건` : "정상",
      detail: extensionAttentionItems.length
        ? extensionAttentionItems.map((item) => `${item.label}: ${item.state.label}`).join(" · ")
        : `${extensionSmokeItems.map((item) => item.label).join(", ")} 확장 API 점검 통과`,
    }
    : { tone: "muted", label: "비공개", detail: "컨테이너, Kubernetes, 데이터베이스 확장 API가 사용자 메뉴에서 숨겨져 있습니다." };
  const supportSmoke = supportAvailabilityMode === "away"
    ? { tone: "warn", label: "부재중", detail: "부재중이면 사용자 문의 접수가 막혀 전환 직후 문의 대응이 늦어질 수 있습니다." }
    : { tone: "ready", label: "접수 가능", detail: "사용자 문의와 운영지원 메시지를 받을 수 있습니다." };
  const validationSmoke = props.serviceValidationStatus?.active
    ? { tone: "ready", label: "검증 자원 있음", detail: props.serviceValidationStatus?.summary || "서비스 검증용 샘플 자원이 준비되어 있습니다." }
    : { tone: "muted", label: "미생성", detail: "필수 항목은 아니지만 전환 전 샘플 자원으로 사용자 흐름을 확인할 수 있습니다." };
  const v2ReleaseSmokeChecks = [
    {
      key: "portal",
      title: "포털/API",
      ...portalSmoke,
      targetTab: "monitor",
      monitorFocusKey: "portal",
      actionLabel: "모니터 열기",
    },
    {
      key: "postgres",
      title: "데이터 저장소",
      ...postgresSmoke,
      targetTab: "monitor",
      monitorFocusKey: "postgres",
      actionLabel: "DB 상태 보기",
    },
    {
      key: "heat",
      title: "OpenStack / Heat",
      ...heatSmoke,
      targetTab: "monitor",
      monitorFocusKey: "heat",
      actionLabel: "OpenStack 점검",
    },
    {
      key: "quota",
      title: "Quota / 자원 여유",
      ...quotaSmoke,
      targetTab: "monitor",
      monitorFocusKey: "quota",
      actionLabel: "Quota 보기",
    },
    {
      key: "openstack-ca",
      title: "OpenStack CA/TLS",
      ...openstackCaSmoke,
      targetId: "admin-platform-openstack-scope",
      actionLabel: "CA 경로 확인",
    },
    {
      key: "clouds-yaml",
      title: "OpenStack 인증 파일",
      ...cloudsYamlSmoke,
      targetId: "admin-platform-openstack-scope",
      actionLabel: "인증 파일 확인",
    },
    {
      key: "extensions",
      title: "확장 API",
      ...extensionSmoke,
      targetId: "admin-platform-extensions-settings",
      actionLabel: "확장 설정",
    },
    {
      key: "support",
      title: "운영지원",
      ...supportSmoke,
      targetId: "admin-platform-core-settings",
      actionLabel: "지원 상태",
    },
    {
      key: "validation",
      title: "검증 자원",
      ...validationSmoke,
      targetId: "admin-platform-validation-settings",
      actionLabel: "검증 도구",
    },
  ];
  const v2ReleaseSmokeAttentionCount = v2ReleaseSmokeChecks.filter((item) => ["warn", "danger"].includes(item.tone)).length;
  const v2ReleaseSmokeReadyCount = v2ReleaseSmokeChecks.filter((item) => item.tone === "ready").length;
  const v2ReleaseSmokeTone = getAdminSmokeTone(v2ReleaseSmokeChecks);
  const terminalCloudPolicySmoke = {
    tone: terminalCloudReleaseTone,
    label: terminalCloudReleaseStatus,
    detail: terminalCloudReleaseGaps.length
      ? terminalCloudReleaseGaps.slice(0, 3).map((item) => item.label).join(" · ")
      : "VM 신청, 이미지/Flavor, 전용 프로젝트, 비용 정책이 사용자 흐름과 연결되어 있습니다.",
  };
  const terminalCloudProjectSmoke = {
    tone: openstackProjectAutoConfigure ? (terminalCloudRoleCount ? "ready" : "warn") : "warn",
    label: openstackProjectAutoConfigure ? "자동 구성" : "수동 구성",
    detail: openstackProjectAutoConfigure
      ? `역할 ${countLabel(terminalCloudRoleCount)} · Quota ${terminalCloudPricingPreview.quotaItems.length ? "설정됨" : "확인 필요"}`
      : "프로젝트 요청 승인 후 OpenStack 프로젝트/Quota 연결을 운영자가 직접 처리해야 합니다.",
  };
  const terminalCloudRouteSmoke = {
    tone: terminalCloudRouteWarningCount ? "warn" : "ready",
    label: terminalCloudRouteWarningCount ? `확인 ${terminalCloudRouteWarningCount}건` : "연결 양호",
    detail: terminalCloudRouteWarningCount
      ? "사용자 메뉴와 관리자 설정 사이에 확인이 필요한 요구사항이 있습니다."
      : "사용자 메뉴, 관리자 설정, 공개 상태가 서로 맞물려 있습니다.",
  };
  const terminalCloudAppContainerCommand = 'APP_CONTAINER="${TERMINAL_LAB_APP_CONTAINER:-${POD_NAME:-terminal-lab}-app}"';
  const terminalCloudOpsReadinessGroups = [
    {
      key: "auth",
      title: "인증 / CA",
      description: "Keystone 인증, clouds.yaml, 사설 CA 신뢰 체인을 먼저 확인합니다.",
      checks: [
        { key: "ca", label: "OpenStack CA/TLS", state: openstackCaSmoke, targetId: "admin-platform-openstack-scope", actionLabel: "CA 경로" },
        { key: "clouds", label: "clouds.yaml", state: cloudsYamlSmoke, targetId: "admin-platform-openstack-scope", actionLabel: "인증 파일" },
      ],
      runbook: ["UNABLE_TO_VERIFY_LEAF_SIGNATURE 발생 시 CA 마운트와 NODE_EXTRA_CA_CERTS를 먼저 확인", "DNS 실패는 호스트와 앱 컨테이너의 runtime/dns 결과를 비교", "403/인증 실패는 clouds.yaml scope, domain, 프로젝트 역할 순서로 확인"],
      commands: [
        terminalCloudAppContainerCommand,
        "npm run check:openstack-tls -- --json",
        'podman exec "$APP_CONTAINER" npm run check:openstack-tls',
        'podman exec -e OPENSTACK_TLS_CHECK_JSON=1 "$APP_CONTAINER" npm run check:openstack-tls',
      ],
    },
    {
      key: "api",
      title: "API / Quota",
      description: "Heat 생성과 Quota 조회가 살아 있어야 생성 전 영향 안내가 정확해집니다.",
      checks: [
        { key: "heat", label: "Heat / Keystone", state: heatSmoke, targetTab: "monitor", monitorFocusKey: "heat", actionLabel: "Heat 점검" },
        { key: "quota", label: "Quota 여유", state: quotaSmoke, targetTab: "monitor", monitorFocusKey: "quota", actionLabel: "Quota 점검" },
      ],
      runbook: ["Quota 초과는 프로젝트 기본 Quota와 현재 잔여 자원을 함께 확인", "Heat 실패는 생성 스택명과 Neutron/Cinder 세부 오류를 같이 확인"],
    },
    {
      key: "policy",
      title: "생성 정책",
      description: "사용자 화면에서 어떤 버튼이 열리고 막히는지 결정하는 설정입니다.",
      checks: [
        { key: "policy", label: "VM/이미지/Flavor", state: terminalCloudPolicySmoke, targetId: "admin-platform-lab-settings", actionLabel: "생성 설정" },
        { key: "project", label: "전용 프로젝트", state: terminalCloudProjectSmoke, targetId: "admin-platform-lab-settings", actionLabel: "프로젝트 정책" },
      ],
      runbook: ["이미지 또는 Flavor가 비어 있으면 사용자는 신청을 끝까지 진행할 수 없음", "자동 구성은 역할, Quota, 외부망 설정이 함께 맞아야 안정적"],
    },
    {
      key: "support",
      title: "사용자 연결",
      description: "사용자 메뉴, 확장 기능, 문의 접수 상태가 서로 맞는지 확인합니다.",
      checks: [
        { key: "route", label: "메뉴 연결", state: terminalCloudRouteSmoke, targetId: "admin-platform-lab-settings", actionLabel: "연결표" },
        { key: "support", label: "운영지원", state: supportSmoke, targetId: "admin-platform-core-settings", actionLabel: "지원 상태" },
        { key: "extensions", label: "확장 API", state: extensionSmoke, targetId: "admin-platform-extensions-settings", actionLabel: "확장 설정" },
      ],
      runbook: ["부재중이면 실패/정리 문의 흐름이 막히므로 전환 전 지원 상태 확인", "확장 기능은 공개 여부와 허용 목록을 함께 맞춰야 혼동이 적음"],
    },
  ].map((group) => ({
    ...group,
    tone: getAdminSmokeTone(group.checks.map((item) => item.state)),
    readyCount: group.checks.filter((item) => item.state.tone === "ready").length,
    attentionCount: group.checks.filter((item) => ["warn", "danger"].includes(item.state.tone)).length,
  }));
  const terminalCloudOpsReadinessChecks = terminalCloudOpsReadinessGroups.flatMap((group) => group.checks);
  const terminalCloudOpsReadinessReadyCount = terminalCloudOpsReadinessChecks.filter((item) => item.state.tone === "ready").length;
  const terminalCloudOpsReadinessAttentionCount = terminalCloudOpsReadinessChecks.filter((item) => ["warn", "danger"].includes(item.state.tone)).length;
  const terminalCloudOpsReadinessTone = getAdminSmokeTone(terminalCloudOpsReadinessChecks.map((item) => item.state));
  const v2ReleaseReadinessChecks = [
    {
      key: "release-version",
      tone: siteVersionReady && siteReleaseStageReady ? "ready" : "warn",
      title: "v1.0 릴리즈 표기",
      status: `${siteVersionNumber} / ${siteVersionStage}`,
      detail: siteVersionReady && siteReleaseStageReady
        ? "최종 브랜치 릴리즈 표기와 서비스 단계가 v1.0 릴리즈 기준에 맞습니다."
        : "최종 v1.0 릴리즈 전에는 사이트 버전을 v1.0, 단계를 Release로 맞추는 것을 권장합니다.",
      targetId: "admin-platform-core-settings",
      actionLabel: "버전 설정",
    },
    {
      key: "portal-mode",
      tone: portalUiMode === "legacy" ? "danger" : "ready",
      title: "포털 기본 정책",
      status: portalUiModeSummary.label,
      detail: portalUiMode === "legacy" ? "v2를 기본 UI로 릴리즈하려면 전환 정책을 v2 기본 또는 v2 완전 전환으로 바꿔야 합니다." : `${portalUiModeSummary.hint} · v1 호환 UI 코드는 보전됩니다.`,
      targetId: "admin-platform-core-settings",
      actionLabel: "전환 정책 수정",
    },
    {
      key: "legacy-usage",
      tone: portalUiMode === "v2" && portalUiLegacyUsers ? "warn" : portalUiMode === "legacy" ? "danger" : "ready",
      title: "v1 호환 사용량",
      status: `최근 ${portalUiRecentDays}일 v1 ${portalUiLegacyUsers}명`,
      detail: portalUiMode === "legacy"
        ? "현재는 v1 고정이라 v2 릴리즈 기준과 맞지 않습니다."
        : portalUiMode === "v2" && portalUiLegacyUsers
          ? "완전 전환은 v1/v2 전환 버튼을 숨깁니다. 최근 v1 사용자가 있으면 전환 공지를 먼저 노출하는 것을 권장합니다."
          : portalUiMode === "switchable"
            ? "v2가 기본이고 v1 전환 버튼이 유지되어 기존 사용자 호환을 지원합니다."
            : "최근 v1 사용자가 없거나 완전 전환해도 사용자 혼선 가능성이 낮습니다.",
      targetId: "admin-platform-core-settings",
      actionLabel: "전환 정책 확인",
    },
    {
      key: "transition-notice",
      tone: props.platformStatus?.portalV2TransitionNoticeEnabled === false ? "warn" : "ready",
      title: "전환 안내",
      status: props.platformStatus?.portalV2TransitionNoticeEnabled === false ? "숨김" : "표시",
      detail: props.platformStatus?.portalV2TransitionNoticeEnabled === false ? "전환 직전에는 사용자 혼선을 줄이기 위해 안내 배너 표시를 권장합니다." : "전환 허용 상태에서는 기본 안내를 표시하고, 완전 전환 상태에서는 공지 문구가 있을 때만 표시합니다.",
      targetId: "admin-platform-core-settings",
      actionLabel: "공지 설정",
    },
    {
      key: "terminal-cloud-core",
      tone: terminalCloudReleaseTone,
      title: "클라우드 콘솔 기본 생성",
      status: terminalCloudReleaseStatus,
      detail: terminalCloudReleaseGaps.length
        ? terminalCloudReleaseGaps.slice(0, 3).map((item) => item.label).join(" · ")
        : `VM 신청 ${enabledLabel(selfServiceReady)} · Flavor ${countLabel(selfServiceFlavorCount)} · 이미지 ${countLabel(selfServiceImageCount)}`,
      gaps: terminalCloudReleaseGaps,
      targetId: "admin-platform-lab-settings",
      actionLabel: "생성 설정",
    },
    {
      key: "project-automation",
      tone: openstackProjectAutoConfigure ? (terminalCloudRoleCount ? "ready" : "warn") : "warn",
      title: "전용 프로젝트 승인 흐름",
      status: openstackProjectAutoConfigure ? "자동 구성" : "수동 구성",
      detail: openstackProjectAutoConfigure
        ? `프로젝트 생성, Quota 적용, 역할 ${countLabel(terminalCloudRoleCount)} 부여 흐름을 사용합니다.`
        : "v2 기본 전환 후 신청량이 늘면 수동 프로젝트 연결이 운영 병목이 될 수 있습니다.",
      targetId: "admin-platform-lab-settings",
      actionLabel: "프로젝트 자동화",
    },
    {
      key: "support",
      tone: supportAvailabilityMode === "away" ? "warn" : "ready",
      title: "운영지원 접수",
      status: supportAvailabilitySummary.label,
      detail: supportAvailabilityMode === "away" ? "부재중이면 사용자가 터미널 클라우드 문의를 즉시 남기지 못합니다." : "사용자 문의와 정리 요청이 운영지원으로 접수됩니다.",
      targetId: "admin-platform-core-settings",
      actionLabel: "운영지원 설정",
    },
    {
      key: "status-probes",
      tone: props.platformStatus?.openstackStatusProbesEnabled === false ? "warn" : "ready",
      title: "OpenStack 상태 점검",
      status: props.platformStatus?.openstackStatusProbesEnabled === false ? "중지" : "사용",
      detail: props.platformStatus?.openstackStatusProbesEnabled === false ? "Quota/서비스 상태 확인이 약해져 사용자 화면의 사전 경고 품질이 낮아질 수 있습니다." : "Quota와 OpenStack 서비스 상태를 사용자/관리자 화면에서 점검합니다.",
      targetId: "admin-platform-core-settings",
      actionLabel: "상태 조회 설정",
    },
    {
      key: "mail-payment",
      tone: props.platformStatus?.paymentGatewayEnabled && !props.platformStatus?.mailEnabled ? "warn" : "ready",
      title: "메일 / 결제 연결",
      status: props.platformStatus?.paymentGatewayEnabled ? "결제 흐름 사용" : "승인형 중심",
      detail: props.platformStatus?.paymentGatewayEnabled && !props.platformStatus?.mailEnabled
        ? "유료 흐름을 사용할 경우 승인/결제/결과 알림을 위해 메일 또는 대체 알림 경로를 확인해야 합니다."
        : `메일 ${enabledLabel(Boolean(props.platformStatus?.mailEnabled))} · 결제 ${enabledLabel(Boolean(props.platformStatus?.paymentGatewayEnabled))}`,
      targetId: "admin-platform-mail-settings",
      actionLabel: "메일 설정",
    },
  ];
  const v2ReleaseBlockingCount = v2ReleaseReadinessChecks.filter((item) => item.tone === "danger").length;
  const v2ReleaseAttentionCount = v2ReleaseReadinessChecks.filter((item) => ["warn", "danger"].includes(item.tone)).length;
  const v2ReleaseReadyCount = v2ReleaseReadinessChecks.filter((item) => item.tone === "ready").length;
  const v2ReleaseReadinessTone = v2ReleaseBlockingCount ? "danger" : v2ReleaseAttentionCount ? "warn" : "ready";
  const v2ReleaseReadinessLabel = v2ReleaseBlockingCount ? "전환 전 차단 항목 있음" : v2ReleaseAttentionCount ? "확인 후 전환 권장" : "v1.0 릴리즈 준비 완료";
  const v2ReleaseAttentionItems = v2ReleaseReadinessChecks.filter((item) => ["warn", "danger"].includes(item.tone));
  const v2SmokeAttentionItems = v2ReleaseSmokeChecks.filter((item) => ["warn", "danger"].includes(item.tone));
  const v2ReleaseActionQueue = [
    ...v2ReleaseAttentionItems.map((item) => ({
      ...item,
      source: "릴리즈 준비",
      sourceOrder: 0,
      statusLabel: item.status,
      type: "readiness",
    })),
    ...v2SmokeAttentionItems.map((item) => ({
      ...item,
      source: "운영 점검",
      sourceOrder: 1,
      statusLabel: item.label,
      type: "smoke",
    })),
  ]
    .sort((left, right) => {
      const toneOrder = { danger: 0, warn: 1, muted: 2, ready: 3 };
      return (toneOrder[left.tone] ?? 4) - (toneOrder[right.tone] ?? 4)
        || left.sourceOrder - right.sourceOrder
        || String(left.title).localeCompare(String(right.title), "ko");
    })
    .slice(0, 5);
  const v2ReleaseSnapshotHighlights = [
    {
      label: "릴리즈 표기",
      value: `${siteVersionNumber} / ${siteVersionStage}`,
      tone: siteVersionReady && siteReleaseStageReady ? "ready" : "warn",
    },
    {
      label: "포털 정책",
      value: portalUiModeSummary.label,
      tone: portalUiMode === "legacy" ? "danger" : "ready",
    },
    {
      label: "준비도",
      value: `${v2ReleaseReadyCount}/${v2ReleaseReadinessChecks.length}`,
      tone: v2ReleaseReadinessTone,
    },
    {
      label: "운영 점검",
      value: `${v2ReleaseSmokeReadyCount}/${v2ReleaseSmokeChecks.length}`,
      tone: v2ReleaseSmokeTone,
    },
    {
      label: "클라우드 콘솔",
      value: terminalCloudReleaseStatus,
      tone: terminalCloudReleaseTone,
    },
  ];
  const v2ReleaseRunbookSteps = [
    {
      key: "policy",
      step: "01",
      eyebrow: "전환 정책",
      tone: portalUiMode === "legacy" ? "danger" : portalUiMode === "v2" && portalUiLegacyUsers ? "warn" : "ready",
      title: "v2 기본 전환 정책 확인",
      detail: portalUiMode === "legacy"
        ? "현재 v1 고정입니다. 릴리즈 전 v2 기본 또는 v2 완전 전환으로 바꿔야 합니다."
        : portalUiMode === "v2" && portalUiLegacyUsers
          ? "완전 전환 상태입니다. 최근 v1 사용자가 있으면 공지 문구를 먼저 확인하세요."
          : "v2 기본 전환과 v1 호환 보전 정책이 릴리즈 방향과 맞습니다.",
      actionType: "anchor",
      targetId: "admin-platform-core-settings",
      actionLabel: "정책 확인",
    },
    {
      key: "health",
      step: "02",
      eyebrow: "상태 점검",
      tone: v2ReleaseSmokeTone === "danger" ? "danger" : v2ReleaseSmokeAttentionCount ? "warn" : "ready",
      title: "운영 스모크 체크 실행",
      detail: apiMonitor.checkedAt
        ? `최근 점검 ${formatDateTime(apiMonitor.checkedAt)} 기준입니다. 배포 직전에는 한 번 더 재점검하세요.`
        : "아직 점검 기록이 없습니다. 포털, DB, OpenStack, 확장 API 상태를 먼저 확인하세요.",
      actionType: "refresh",
      actionLabel: "상태 재점검",
    },
    {
      key: "cloud",
      step: "03",
      eyebrow: "터미널 클라우드",
      tone: terminalCloudReleaseTone,
      title: "생성/승인 흐름 확인",
      detail: terminalCloudReleaseGaps.length
        ? `생성 흐름에서 ${terminalCloudReleaseGaps.length}개 확인 항목이 남아 있습니다.`
        : "VM, 이미지, Flavor, 네트워크 기본값이 준비되어 있습니다.",
      actionType: "cloud-queue",
      actionLabel: terminalCloudReleaseGaps.length ? "오류/Quota 보기" : "승인 대기 보기",
    },
    {
      key: "support",
      step: "04",
      eyebrow: "운영지원",
      tone: supportAvailabilityMode === "away" ? "warn" : "ready",
      title: "문의 접수 상태 확인",
      detail: supportAvailabilityMode === "away"
        ? "운영지원이 부재중입니다. 전환 직후 문의 대응이 필요하면 상담 가능으로 바꾸는 것을 권장합니다."
        : "사용자 문의와 정리 요청을 바로 접수할 수 있습니다.",
      actionType: "anchor",
      targetId: "admin-platform-core-settings",
      actionLabel: "지원 설정",
    },
    {
      key: "snapshot",
      step: "05",
      eyebrow: "릴리즈 기록",
      tone: props.platformStatusDirty ? "warn" : "ready",
      title: "점검 요약 보관",
      detail: props.platformStatusDirty
        ? "저장 전 변경이 포함되어 있습니다. 설정 저장 후 최종 점검 파일을 남기세요."
        : "현재 저장된 운영값 기준으로 점검 파일을 보관할 수 있습니다.",
      actionType: "download",
      actionLabel: "점검 파일 저장",
    },
  ];
  const v2ReleaseManualFlowSteps = [
    {
      key: "landing-login",
      title: "랜딩/로그인",
      route: "랜딩 첫 화면 / 로그인 카드",
      detail: "v2 랜딩, 로그인/회원가입 탭, 알림 배지가 겹치지 않는지 확인합니다.",
      criteria: "모바일에서는 로그인 카드가 먼저 보이고, 아이디/비밀번호/OTP 입력이 버튼과 겹치지 않아야 합니다.",
    },
    {
      key: "lab-room",
      title: "랩실",
      route: "사용자 포털 > 랩실",
      detail: "랩 시작, 콘솔, 교안/PDF/DOC, 문의 버튼이 한 화면 흐름에서 자연스럽게 이어지는지 확인합니다.",
      criteria: "콘솔 근처에서 계정, 도메인/TCP/SSH, 랩+교안, 문의 진입을 위아래 이동 없이 찾을 수 있어야 합니다.",
    },
    {
      key: "terminal-cloud",
      title: "터미널 클라우드",
      route: "사용자 포털 > 터미널 클라우드",
      detail: "프로젝트 요청, 인스턴스/네트워크/볼륨 요청, 비용/Quota 안내가 사용자에게 이해되는지 확인합니다.",
      criteria: "승인 프로젝트가 없으면 프로젝트 요청이 먼저 보이고, 승인 후에는 인스턴스/네트워크/컨테이너 작업이 같은 화면에서 열려야 합니다.",
    },
    {
      key: "support",
      title: "운영지원 문의",
      route: "랩실/터미널 클라우드 > 문의",
      detail: "랩실과 터미널 클라우드에서 문의 작성, 부재중 차단, 문의함 이동이 정상인지 확인합니다.",
      criteria: "부재중이면 발송이 막히고, 접수 가능 상태에서는 현재 프로젝트/자원 진단 정보가 문의 초안에 포함되어야 합니다.",
    },
    {
      key: "admin-return",
      title: "관리자 회귀",
      route: "관리자 > 승인 센터 / 사용자화 가상머신 구성 / 문의",
      detail: "승인 센터, 사용자화 가상머신 구성, 쪽지/문의 관리로 요청이 모이는지 확인합니다.",
      criteria: "신청, 정리 요청, 장애/Quota 문의가 관리자 우선 처리 큐와 상세 목록에서 같은 상태로 보여야 합니다.",
    },
  ];
  const v2ReleaseManualFlowDoneCount = v2ReleaseManualFlowSteps.filter((item) => v2ReleaseManualFlowChecks[item.key]).length;
  const v2ReleaseManualFlowTone = v2ReleaseManualFlowDoneCount === v2ReleaseManualFlowSteps.length
    ? "ready"
    : v2ReleaseManualFlowDoneCount
      ? "warn"
      : "muted";
  const v2ReleaseAutoSmokeChecks = [
    {
      key: "health",
      title: "서버 헬스",
      path: "/api/health",
      detail: "백엔드 기본 응답과 배포 프로세스가 살아 있는지 확인합니다.",
      successStatuses: [200],
    },
    {
      key: "session",
      title: "관리자 세션",
      path: "/api/auth/session",
      detail: "현재 브라우저 세션으로 사용자/관리자 상태를 확인합니다.",
      successStatuses: [200],
    },
    {
      key: "platform",
      title: "플랫폼 설정",
      path: "/api/platform-status",
      detail: "v2 전환 정책, 공지, 확장 기능 설정을 불러옵니다.",
      successStatuses: [200],
    },
    {
      key: "courses",
      title: "과정/랩실 데이터",
      path: "/api/courses",
      detail: "사용자 포털 v2의 과정, 랩실, 커뮤니티 진입 데이터를 확인합니다.",
      successStatuses: [200],
    },
    {
      key: "notices",
      title: "공지/알림",
      path: "/api/notices",
      detail: "랜딩과 포털에서 노출되는 공지 데이터를 확인합니다.",
      successStatuses: [200],
    },
    {
      key: "admin-monitor",
      title: "관리자 모니터",
      path: "/api/admin/api-status?light=1",
      detail: "관리자 권한으로 API 모니터 요약을 불러올 수 있는지 확인합니다.",
      successStatuses: [200],
    },
  ];
  const getV2ReleaseAutoSmokeResult = (key) => v2ReleaseAutoSmokeResults.find((item) => item?.key === key) || null;
  const v2ReleaseAutoSmokeCheckedCount = v2ReleaseAutoSmokeChecks.filter((item) => getV2ReleaseAutoSmokeResult(item.key)).length;
  const v2ReleaseAutoSmokeReadyCount = v2ReleaseAutoSmokeChecks.filter((item) => getV2ReleaseAutoSmokeResult(item.key)?.ok).length;
  const v2ReleaseAutoSmokeFailCount = v2ReleaseAutoSmokeChecks.filter((item) => {
    const result = getV2ReleaseAutoSmokeResult(item.key);
    return result && !result.ok;
  }).length;
  const v2ReleaseAutoSmokeCheckedTimes = v2ReleaseAutoSmokeResults
    .map((item) => item?.checkedAt)
    .filter(Boolean)
    .sort();
  const v2ReleaseAutoSmokeLatestAt = v2ReleaseAutoSmokeCheckedTimes[v2ReleaseAutoSmokeCheckedTimes.length - 1];
  const v2ReleaseAutoSmokeTone = v2ReleaseAutoSmokeRunning
    ? "warn"
    : v2ReleaseAutoSmokeFailCount
      ? "danger"
      : v2ReleaseAutoSmokeCheckedCount === v2ReleaseAutoSmokeChecks.length
        ? "ready"
        : v2ReleaseAutoSmokeCheckedCount
          ? "warn"
          : "muted";
  const v2ReleaseSnapshotText = [
    "[KIKI OS TERMINAL-LAB 릴리즈 점검 요약]",
    `생성 시각: ${formatDateTime(new Date().toISOString())}`,
    `릴리즈 표기: ${siteVersionNumber} / ${siteVersionStage}`,
    `사용자 포털 정책: ${portalUiModeSummary.label}`,
    `v1 호환 UI: ${portalUiMode === "v2" ? "전환 버튼 숨김, 코드 보전" : portalUiMode === "switchable" ? "전환 허용" : "v1 고정"}`,
    `최근 ${portalUiRecentDays}일 포털 사용: v1 ${portalUiLegacyUsers}명 / v2 ${portalUiV2Users}명 / 미확인 ${portalUiUnknownUsers}명`,
    `릴리즈 준비도: ${v2ReleaseReadinessLabel} (${v2ReleaseReadyCount}/${v2ReleaseReadinessChecks.length}, 확인 필요 ${v2ReleaseAttentionCount}건)`,
    `운영 스모크 체크: ${v2ReleaseSmokeReadyCount}/${v2ReleaseSmokeChecks.length}, 확인 필요 ${v2ReleaseSmokeAttentionCount}건`,
    `터미널 클라우드 확인: ${terminalCloudReleaseStatus} / 예상 정리 ${terminalCloudReleaseEtaLabel}`,
    `최근 API 점검: ${apiMonitor.checkedAt ? formatDateTime(apiMonitor.checkedAt) : "기록 없음"}`,
    `최근 전환 저장: ${latestPortalPolicyLog ? `${formatDateTime(latestPortalPolicyLog.createdAt)} / ${latestPortalPolicyAdmin}` : "기록 없음"}`,
    `운영지원: ${supportAvailabilitySummary.label}`,
    "",
    "[우선 처리 큐]",
    ...(v2ReleaseActionQueue.length ? v2ReleaseActionQueue.map((item, index) => `${index + 1}. ${item.source} / ${item.title}: ${item.statusLabel} / ${item.detail}`) : ["- 없음"]),
    "",
    "[터미널 클라우드 확인 필요]",
    ...(terminalCloudReleaseGaps.length ? terminalCloudReleaseGaps.map((item) => `- ${item.label}: ${item.detail}`) : ["- 없음"]),
    "",
    "[준비도 확인 필요]",
    ...(v2ReleaseAttentionItems.length ? v2ReleaseAttentionItems.map((item) => `- ${item.title}: ${item.status} / ${item.detail}`) : ["- 없음"]),
    "",
    "[운영 점검 확인 필요]",
    ...(v2SmokeAttentionItems.length ? v2SmokeAttentionItems.map((item) => `- ${item.title}: ${item.label} / ${item.detail}`) : ["- 없음"]),
    "",
    "[릴리즈 실행 순서]",
    ...v2ReleaseRunbookSteps.map((item) => `${item.step}. ${item.title}: ${item.detail}`),
    "",
    `[사용자 플로우 수동 점검] ${v2ReleaseManualFlowDoneCount}/${v2ReleaseManualFlowSteps.length}`,
    ...v2ReleaseManualFlowSteps.map((item) => `- ${v2ReleaseManualFlowChecks[item.key] ? "[확인]" : "[미확인]"} ${item.title}: ${item.route} / ${item.detail} / 기준: ${item.criteria}`),
    "",
    `[브라우저 자동 스모크 테스트] ${v2ReleaseAutoSmokeReadyCount}/${v2ReleaseAutoSmokeChecks.length}${v2ReleaseAutoSmokeLatestAt ? ` / 최근 ${formatDateTime(v2ReleaseAutoSmokeLatestAt)}` : " / 미실행"}`,
    ...(v2ReleaseAutoSmokeCheckedCount
      ? v2ReleaseAutoSmokeChecks.map((item) => {
        const result = getV2ReleaseAutoSmokeResult(item.key);
        return result
          ? `- ${result.ok ? "[통과]" : "[확인 필요]"} ${item.title}: HTTP ${result.status || "-"} / ${result.elapsedMs ?? "-"}ms / ${result.message || item.detail}`
          : `- [미실행] ${item.title}: ${item.detail}`;
      })
      : ["- 아직 실행하지 않음"]),
  ].join("\n");
  const v2ReleasePresetApplied = portalUiMode === "switchable"
    && siteVersionReady
    && siteReleaseStageReady
    && props.platformStatus?.portalV2TransitionNoticeEnabled !== false
    && props.platformStatus?.openstackStatusProbesEnabled !== false;
  const copyV2ReleaseSnapshot = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(v2ReleaseSnapshotText);
      } else if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = v2ReleaseSnapshotText;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      } else {
        throw new Error("clipboard unavailable");
      }
      setReleaseSnapshotStatus("릴리즈 점검 요약을 클립보드에 복사했습니다.");
    } catch {
      setReleaseSnapshotStatus("브라우저에서 자동 복사를 지원하지 않습니다. 아래 요약을 선택해서 복사해 주세요.");
    }
  };
  const downloadV2ReleaseSnapshot = () => {
    try {
      if (typeof window === "undefined" || typeof document === "undefined" || typeof Blob === "undefined" || !window.URL?.createObjectURL) {
        throw new Error("download unavailable");
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const blob = new Blob([`${v2ReleaseSnapshotText}\n`], { type: "text/plain;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `terminal-lab-v1-release-check-${stamp}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setReleaseSnapshotStatus("릴리즈 점검 요약 파일을 내려받았습니다.");
    } catch {
      setReleaseSnapshotStatus("브라우저에서 파일 저장을 지원하지 않습니다. 점검 요약 복사를 사용해 주세요.");
    }
  };
  const openSmokeCheckTarget = (item) => {
    if (item?.targetTab) {
      if (item.monitorFocusKey && typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(ADMIN_API_MONITOR_FOCUS_STORAGE_KEY, item.monitorFocusKey);
        } catch {
          // Ignore storage errors; tab navigation still works.
        }
      }
      props.onOpenAdminTab?.(item.targetTab);
    }
  };
  const openTerminalCloudOpsQueue = (searchParams = {}) => {
    props.onOpenAdminTab?.("selfServiceVms", { searchParams });
  };
  const toggleV2ReleaseManualFlowCheck = (key) => {
    setV2ReleaseManualFlowChecks((current) => ({
      ...current,
      [key]: !current?.[key],
    }));
  };
  const resetV2ReleaseManualFlowChecks = () => {
    setV2ReleaseManualFlowChecks({});
    setReleaseSnapshotStatus("사용자 플로우 수동 점검 표시를 초기화했습니다.");
  };
  const runV2ReleaseAutoSmokeChecks = async () => {
    if (v2ReleaseAutoSmokeRunning) return;
    setV2ReleaseAutoSmokeRunning(true);
    setReleaseSnapshotStatus("브라우저 자동 스모크 테스트를 실행하고 있습니다.");
    const results = [];
    for (const check of v2ReleaseAutoSmokeChecks) {
      const startedAt = Date.now();
      try {
        const separator = check.path.includes("?") ? "&" : "?";
        const response = await fetch(`${check.path}${separator}_smoke=${Date.now()}`, {
          cache: "no-store",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        const elapsedMs = Math.max(0, Date.now() - startedAt);
        const ok = check.successStatuses.includes(response.status);
        results.push({
          key: check.key,
          title: check.title,
          path: check.path,
          status: response.status,
          ok,
          elapsedMs,
          checkedAt: new Date().toISOString(),
          message: ok ? "응답 확인" : `예상 상태 ${check.successStatuses.join(", ")}와 다릅니다.`,
        });
      } catch (error) {
        results.push({
          key: check.key,
          title: check.title,
          path: check.path,
          status: 0,
          ok: false,
          elapsedMs: Math.max(0, Date.now() - startedAt),
          checkedAt: new Date().toISOString(),
          message: error?.message || "요청 실패",
        });
      }
      setV2ReleaseAutoSmokeResults([...results]);
    }
    const failedCount = results.filter((item) => !item.ok).length;
    setReleaseSnapshotStatus(failedCount
      ? `브라우저 자동 스모크 테스트에서 ${failedCount}개 확인 항목이 있습니다.`
      : "브라우저 자동 스모크 테스트를 통과했습니다.");
    setV2ReleaseAutoSmokeRunning(false);
  };
  const clearV2ReleaseAutoSmokeResults = () => {
    setV2ReleaseAutoSmokeResults([]);
    setReleaseSnapshotStatus("브라우저 자동 스모크 테스트 결과를 초기화했습니다.");
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("admin:serviceValidation:hideEmptyItems", hideEmptyValidationItems ? "1" : "0");
    } catch {
      // Ignore storage errors and keep the toggle working in memory.
    }
  }, [hideEmptyValidationItems]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ADMIN_V2_RELEASE_FLOW_CHECKS_STORAGE_KEY, JSON.stringify(v2ReleaseManualFlowChecks || {}));
    } catch {
      // Keep manual release checks in memory when local storage is unavailable.
    }
  }, [v2ReleaseManualFlowChecks]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ADMIN_V2_RELEASE_AUTO_SMOKE_STORAGE_KEY, JSON.stringify(v2ReleaseAutoSmokeResults || []));
    } catch {
      // Keep automatic smoke results in memory when local storage is unavailable.
    }
  }, [v2ReleaseAutoSmokeResults]);
  return (
    <section className="portal-stack">
      <div className="admin-simple-card">
        <div className="admin-card-header">
          <strong>플랫폼 공통 설정</strong>
          <div className="admin-inline-actions">
            <button className="mini-btn save-btn" onClick={props.onSavePlatformSettings} type="button">설정 저장</button>
          </div>
        </div>
        {props.platformStatusDirty ? <div className="hint">저장되지 않은 변경 사항이 있습니다. 편집 중에는 자동 새로고침으로 덮어쓰지 않습니다.</div> : null}
        <div className="admin-summary-grid admin-platform-summary-grid">
          <article className="admin-summary-item">
            <span>서비스 버전</span>
            <strong>{props.platformStatus?.siteVersionNumber || "v1.0"}</strong>
            <div className="hint">{`${props.platformStatus?.siteVersionStage || "Release"} / ${props.platformStatus?.siteVersionCodename || "코드명 미설정"}`}</div>
          </article>
          <article className="admin-summary-item">
            <span>사용자 포털 정책</span>
            <strong>{portalUiModeSummary.label}</strong>
            <div className="hint">{portalUiModeSummary.hint}</div>
          </article>
          <article className={`admin-summary-item ${portalUiLegacyUsers ? "is-warn" : ""}`}>
            <span>v2 전환 현황</span>
            <strong>{`v1 ${portalUiLegacyUsers}명`}</strong>
            <div className="hint">{`최근 ${portalUiRecentDays}일 기준 · v2 ${portalUiV2Users}명 / 미확인 ${portalUiUnknownUsers}명`}</div>
          </article>
          <article className={`admin-summary-item ${supportAvailabilityMode === "away" ? "is-warn" : ""}`}>
            <span>운영지원 상태</span>
            <strong>{supportAvailabilitySummary.label}</strong>
            <div className="hint">{supportAvailabilitySummary.hint}</div>
          </article>
          <article className="admin-summary-item">
            <span>업그레이드 안내</span>
            <strong>{props.platformStatus?.siteUpdateInProgress ? "표시 중" : "숨김"}</strong>
            <div className="hint">{props.platformStatus?.siteUpdateMessage || "화면과 기능을 더 보기 좋게 다듬고 있어요. 잠시 후 새로고침하면 이어서 사용할 수 있습니다."}</div>
          </article>
          <article className={`admin-summary-item ${props.platformStatus?.labCircuitBreaker ? "is-danger" : ""}`}>
            <span>서킷 브레이크</span>
            <strong>{props.platformStatus?.labCircuitBreaker ? "차단 중" : "정상"}</strong>
            <div className="hint">{props.platformStatus?.labCircuitBreaker ? props.platformStatus.labCircuitBreakerMessage : "랩 생성 요청 허용"}</div>
          </article>
          <article className="admin-summary-item">
            <span>기본 프로젝트</span>
            <strong>{props.platformStatus?.serviceProjectName || "service"}</strong>
            <div className="hint">{`클라우드 콘솔 프로젝트: ${props.platformStatus?.pocProjectName || "PoC-example.com"}`}</div>
          </article>
          <article className="admin-summary-item">
            <span>메일 / 결제</span>
            <strong>{props.platformStatus?.mailEnabled ? "메일 활성" : "메일 비활성"}</strong>
            <div className="hint">{props.platformStatus?.paymentGatewayEnabled ? "결제 활성" : "결제 비활성"}</div>
          </article>
          <article className="admin-summary-item">
            <span>외부 SSH / RDP</span>
            <strong>{getNormalizedSshPublicHost(props.platformStatus?.sshPublicHost)}</strong>
            <div className="hint">{`SSH ${props.platformStatus?.sshExternalPortStart || 41000}-${props.platformStatus?.sshExternalPortEnd || 42999} / RDP ${props.platformStatus?.rdpExternalPortStart || 43000}-${props.platformStatus?.rdpExternalPortEnd || 43099} / TCP ${props.platformStatus?.tcpExternalPortStart || 45000}-${props.platformStatus?.tcpExternalPortEnd || 45999}`}</div>
          </article>
          <article className="admin-summary-item">
            <span>랜딩 영상</span>
            <strong>{landingPreviewType === "upload" ? "업로드 파일" : "YouTube"}</strong>
            <div className="hint">{landingPreviewType === "upload" ? props.platformStatus?.landingVideoPath || "파일 없음" : props.platformStatus?.landingYoutubeUrl || "URL 없음"}</div>
          </article>
          <article className="admin-summary-item">
            <span>검증 자원</span>
            <strong>{serviceValidationActive}</strong>
            <div className="hint">{props.serviceValidationStatus?.summary || "검증 자원 상태 확인"}</div>
          </article>
        </div>
        <details className="admin-platform-operations-details">
          <summary>
            <span>
              <strong>운영 진단과 릴리즈 참고</strong>
              <small>터미널 클라우드 운영 요약, 출시 전 작업, 준비도 진단, 영향 미리보기, 변경 이력</small>
            </span>
            <em>열기</em>
          </summary>
          <div className="admin-platform-operations-body">
        <div className={`admin-v2-release-panel is-${v2ReleaseReadinessTone}`}>
          <div className="admin-v2-release-head">
            <div>
              <span className="eyebrow">V2 RELEASE READINESS</span>
              <strong>v1.0 릴리즈 준비도</strong>
              <p className="hint">v2를 기본 사용자 UI로 제공하면서 v1 호환 화면을 보전하기 전에 포털 정책, 클라우드 콘솔, 운영지원, 상태 점검을 한 번에 확인합니다.</p>
              <div className="admin-v2-release-meta">
                <span>{props.platformStatusDirty ? "편집 중 변경 있음" : "저장된 운영값 기준"}</span>
                <span>{latestPortalPolicyLog ? `최근 저장 ${formatDateTime(latestPortalPolicyLog.createdAt)}` : "전환 저장 이력 없음"}</span>
                <span>{latestPortalPolicyLog ? `${latestPortalPolicyAdmin} · ${getPortalUiModeSummary(latestPortalPolicyMode).label}${latestPortalPolicySupportMode ? ` · ${getSupportAvailabilitySummary(latestPortalPolicySupportMode).label}` : ""}` : "설정 저장 후 이력 표시"}</span>
              </div>
            </div>
            <div className="admin-v2-release-score">
              <span>{v2ReleaseReadinessLabel}</span>
              <strong>{`${v2ReleaseReadyCount}/${v2ReleaseReadinessChecks.length}`}</strong>
              <small>{`확인 필요 ${v2ReleaseAttentionCount}건`}</small>
              <div className="admin-v2-release-actions">
                <button className="mini-btn" disabled={v2ReleasePresetApplied} onClick={applyV2ReleaseRecommendedSettings} type="button">v1.0 권장값 적용</button>
                <button className="mini-btn" onClick={copyV2ReleaseSnapshot} type="button">점검 요약 복사</button>
                <button className="mini-btn" onClick={downloadV2ReleaseSnapshot} type="button">점검 파일 저장</button>
                {props.platformStatusDirty ? (
                  <button className="mini-btn" onClick={restoreSavedPlatformSettings} type="button">저장값 복원</button>
                ) : null}
                <button className="mini-btn save-btn" onClick={props.onSavePlatformSettings} type="button">설정 저장</button>
              </div>
            </div>
          </div>
          {props.platformStatusDirty ? (
            <div className="admin-v2-release-unsaved">
              저장 전 변경이 준비도에 반영되어 있습니다. 배포 전에는 설정 저장으로 실제 운영값에 반영하거나 저장값 복원으로 되돌리세요.
            </div>
          ) : null}
          <div className={`admin-v2-release-priority is-${v2ReleaseReadinessTone}`} aria-label="v1.0 릴리즈 우선 처리 큐">
            <div className="admin-v2-release-priority-head">
              <div>
                <span className="eyebrow">PRIORITY QUEUE</span>
                <strong>릴리즈 전 우선 처리</strong>
                <p>차단/주의 항목을 위험도 순서로 모았습니다. 위에서부터 처리하면 v2 기본 전환 전에 확인 흐름이 짧아집니다.</p>
              </div>
              <span>{v2ReleaseActionQueue.length ? `${v2ReleaseActionQueue.length}건` : "모두 준비"}</span>
            </div>
            {v2ReleaseActionQueue.length ? (
              <div className="admin-v2-release-priority-list">
                {v2ReleaseActionQueue.map((item, index) => (
                  <article className={`is-${item.tone}`} key={`${item.type}-${item.key}`}>
                    <b>{index + 1}</b>
                    <div>
                      <span>{item.source}</span>
                      <strong>{item.title}</strong>
                      <em>{item.statusLabel}</em>
                      <p>{item.detail}</p>
                      {item.targetTab ? (
                        <button
                          className="admin-v2-release-link"
                          onClick={() => openSmokeCheckTarget(item)}
                          type="button"
                        >
                          {item.actionLabel || "상세 보기"}
                        </button>
                      ) : item.targetId ? (
                        <a className="admin-v2-release-link" href={`#${item.targetId}`}>{item.actionLabel || "바로 수정"}</a>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="admin-v2-release-priority-clear">
                차단 항목 없이 v2 기본 전환 준비가 정리되어 있습니다. 배포 직전에는 스모크 체크를 한 번 더 실행하고 점검 요약을 보관하세요.
              </div>
            )}
          </div>
          <div className="admin-v2-release-snapshot" aria-label="v1.0 릴리즈 점검 스냅샷">
            <div>
              <span className="eyebrow">RELEASE SNAPSHOT</span>
              <strong>최종 점검 메모</strong>
              <p>배포 직전에 현재 준비도와 운영 스모크 체크 결과를 복사해 릴리즈 기록이나 작업 일지에 남길 수 있습니다.</p>
              {releaseSnapshotStatus ? <small>{releaseSnapshotStatus}</small> : null}
            </div>
            <div className="admin-v2-release-snapshot-grid">
              {v2ReleaseSnapshotHighlights.map((item) => (
                <span className={`is-${item.tone}`} key={item.label}>
                  <em>{item.label}</em>
                  <b>{item.value}</b>
                </span>
              ))}
            </div>
            {releaseSnapshotStatus.includes("지원하지") ? (
              <textarea readOnly value={v2ReleaseSnapshotText} />
            ) : null}
          </div>
          <div className="admin-v2-runbook" aria-label="v1.0 릴리즈 실행 순서">
            <div className="admin-v2-runbook-head">
              <div>
                <span className="eyebrow">RELEASE RUNBOOK</span>
                <strong>배포 직전 확인 순서</strong>
                <p>v2를 기본 UI로 열기 전 운영자가 실제로 눌러볼 순서입니다. 왼쪽부터 처리하고 마지막 점검 파일을 남기면 됩니다.</p>
              </div>
              <span>{`${v2ReleaseRunbookSteps.filter((item) => item.tone === "ready").length}/${v2ReleaseRunbookSteps.length}`}</span>
            </div>
            <div className="admin-v2-runbook-list">
              {v2ReleaseRunbookSteps.map((item) => (
                <article className={`is-${item.tone}`} key={item.key}>
                  <b>{item.step}</b>
                  <div>
                    <span>{item.eyebrow}</span>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                    {item.actionType === "refresh" ? (
                      <button className="admin-v2-release-link" disabled={!props.onRefreshApiMonitor} onClick={props.onRefreshApiMonitor} type="button">{item.actionLabel}</button>
                    ) : item.actionType === "cloud-queue" ? (
                      <button
                        className="admin-v2-release-link"
                        onClick={() => openTerminalCloudOpsQueue(terminalCloudReleaseGaps.length ? { ssProjectOps: "issue", ssVmOps: "issue" } : { ssProjectStatus: "requested", ssProjectOps: "all", ssVmStatus: "requested", ssVmOps: "active" })}
                        type="button"
                      >
                        {item.actionLabel}
                      </button>
                    ) : item.actionType === "download" ? (
                      <button className="admin-v2-release-link" onClick={downloadV2ReleaseSnapshot} type="button">{item.actionLabel}</button>
                    ) : item.targetId ? (
                      <a className="admin-v2-release-link" href={`#${item.targetId}`}>{item.actionLabel}</a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
          <div className={`admin-v2-flow-check is-${v2ReleaseManualFlowTone}`} aria-label="v2 사용자 플로우 수동 점검">
            <div className="admin-v2-flow-check-head">
              <div>
                <span className="eyebrow">USER FLOW CHECK</span>
                <strong>사용자 플로우 수동 점검</strong>
                <p>브라우저에서 실제 사용자처럼 핵심 화면을 열어본 뒤 체크하세요. 체크 상태는 이 브라우저에 저장되고 점검 파일에도 포함됩니다.</p>
              </div>
              <div>
                <strong>{`${v2ReleaseManualFlowDoneCount}/${v2ReleaseManualFlowSteps.length}`}</strong>
                <button className="mini-btn" onClick={resetV2ReleaseManualFlowChecks} type="button">초기화</button>
              </div>
            </div>
            <div className="admin-v2-flow-check-list">
              {v2ReleaseManualFlowSteps.map((item) => {
                const checked = Boolean(v2ReleaseManualFlowChecks[item.key]);
                return (
                  <label className={checked ? "is-checked" : ""} key={item.key}>
                    <input
                      checked={checked}
                      onChange={() => toggleV2ReleaseManualFlowCheck(item.key)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{item.title}</strong>
                      <em>{item.route}</em>
                      <small>{item.detail}</small>
                      <small className="admin-v2-flow-check-criteria">{item.criteria}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className={`admin-v2-auto-smoke is-${v2ReleaseAutoSmokeTone}`} aria-label="v2 브라우저 자동 스모크 테스트">
            <div className="admin-v2-auto-smoke-head">
              <div>
                <span className="eyebrow">BROWSER SMOKE TEST</span>
                <strong>브라우저 자동 스모크 테스트</strong>
                <p>현재 로그인된 관리자 브라우저에서 v2 사용자 흐름에 필요한 핵심 API를 직접 호출합니다. 배포 직전 한 번 실행하면 세션, 과정, 공지, 관리자 모니터 연결을 빠르게 확인할 수 있습니다.</p>
              </div>
              <div>
                <strong>{`${v2ReleaseAutoSmokeReadyCount}/${v2ReleaseAutoSmokeChecks.length}`}</strong>
                <span>{v2ReleaseAutoSmokeRunning ? "실행 중" : v2ReleaseAutoSmokeLatestAt ? `최근 ${formatDateTime(v2ReleaseAutoSmokeLatestAt)}` : "아직 미실행"}</span>
                <button
                  className="mini-btn save-btn"
                  disabled={v2ReleaseAutoSmokeRunning}
                  onClick={runV2ReleaseAutoSmokeChecks}
                  type="button"
                >
                  {v2ReleaseAutoSmokeRunning ? "점검 중" : "자동 테스트 실행"}
                </button>
                {v2ReleaseAutoSmokeCheckedCount ? (
                  <button className="mini-btn" disabled={v2ReleaseAutoSmokeRunning} onClick={clearV2ReleaseAutoSmokeResults} type="button">결과 초기화</button>
                ) : null}
              </div>
            </div>
            <div className="admin-v2-auto-smoke-grid">
              {v2ReleaseAutoSmokeChecks.map((item) => {
                const result = getV2ReleaseAutoSmokeResult(item.key);
                const tone = result ? (result.ok ? "ready" : "danger") : v2ReleaseAutoSmokeRunning ? "warn" : "muted";
                return (
                  <article className={`is-${tone}`} key={item.key}>
                    <span>{result ? (result.ok ? "통과" : "확인 필요") : v2ReleaseAutoSmokeRunning ? "대기 중" : "미실행"}</span>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                    <small>{result ? `HTTP ${result.status || "-"} · ${result.elapsedMs ?? "-"}ms · ${result.message}` : item.path}</small>
                  </article>
                );
              })}
            </div>
          </div>
          <div className="admin-v2-release-grid">
            {v2ReleaseReadinessChecks.map((item) => (
              <article className={`admin-v2-release-check is-${item.tone}`} key={item.key}>
                <span aria-hidden="true" />
                <div>
                  <strong>{item.title}</strong>
                  <em>{item.status}</em>
                  <p>{item.detail}</p>
                  {item.gaps?.length ? (
                    <div className="admin-v2-release-gap-list" aria-label={`${item.title} 확인 항목`}>
                      {item.gaps.map((gap) => (
                        <span className={`is-${gap.tone}`} key={gap.key}>
                          <b>{gap.label}</b>
                          <small>{gap.detail}</small>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {item.targetId ? (
                    <a className="admin-v2-release-link" href={`#${item.targetId}`}>{item.actionLabel || "바로 수정"}</a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          <div className={`admin-v2-smoke-panel is-${v2ReleaseSmokeTone}`}>
            <div className="admin-v2-smoke-head">
              <div>
                <span className="eyebrow">OPERATION SMOKE CHECK</span>
                <strong>운영 스모크 체크</strong>
                <p className="hint">최근 API 모니터와 저장된 설정 기준으로 포털, DB, OpenStack, 확장 기능 연결 상태를 빠르게 확인합니다.</p>
              </div>
              <div className="admin-v2-smoke-summary">
                <strong>{`${v2ReleaseSmokeReadyCount}/${v2ReleaseSmokeChecks.length}`}</strong>
                <span>{v2ReleaseSmokeAttentionCount ? `확인 필요 ${v2ReleaseSmokeAttentionCount}건` : "연결 상태 양호"}</span>
                <small>{apiMonitor.checkedAt ? `최근 점검 ${formatDateTime(apiMonitor.checkedAt)}` : "최근 점검 기록 없음"}</small>
                <button
                  className="mini-btn refresh-btn"
                  disabled={!props.onRefreshApiMonitor}
                  onClick={props.onRefreshApiMonitor}
                  type="button"
                >
                  상태 재점검
                </button>
              </div>
            </div>
            <div className="admin-v2-smoke-grid">
              {v2ReleaseSmokeChecks.map((item) => (
                <article className={`admin-v2-smoke-check is-${item.tone}`} key={item.key}>
                  <span>{item.label}</span>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                  {item.targetTab ? (
                    <button
                      className="admin-v2-release-link"
                      onClick={() => openSmokeCheckTarget(item)}
                      type="button"
                    >
                      {item.actionLabel || "상세 보기"}
                    </button>
                  ) : item.targetId ? (
                    <a className="admin-v2-release-link" href={`#${item.targetId}`}>{item.actionLabel || "설정 보기"}</a>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </div>
        <div className="admin-terminal-cloud-ops-panel">
          <div className="admin-terminal-cloud-ops-head">
            <div>
              <span className="eyebrow">TERMINAL CLOUD</span>
              <strong>터미널 클라우드 운영 요약</strong>
              <p className="hint">v2 클라우드 콘솔과 클라우드 콘솔에 연결되는 VM, 네트워크, 비용, 확장 기능 상태를 한 화면에서 확인합니다.</p>
            </div>
            <div className="admin-inline-actions">
              <button
                className="mini-btn"
                onClick={() => openTerminalCloudOpsQueue({ ssProjectStatus: "requested", ssProjectOps: "all", ssVmStatus: "requested", ssVmOps: "active" })}
                type="button"
              >
                승인 대기 보기
              </button>
              <button
                className="mini-btn"
                onClick={() => openTerminalCloudOpsQueue({ ssProjectOps: "issue", ssVmOps: "issue" })}
                type="button"
              >
                오류/Quota 보기
              </button>
              <button className="mini-btn save-btn" onClick={props.onSavePlatformSettings} type="button">설정 저장</button>
            </div>
          </div>
          <div className="admin-terminal-cloud-ops-grid">
            {terminalCloudOpsCards.map((item) => (
              <article className={`admin-terminal-cloud-ops-card is-${item.tone}`} key={item.key}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </article>
            ))}
          </div>
          <div className="admin-terminal-cloud-ops-checks">
            {terminalCloudOpsChecks.map((item) => (
              <article className={`admin-terminal-cloud-ops-check is-${item.tone}`} key={item.key}>
                <span aria-hidden="true" />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
              </article>
            ))}
          </div>
          <div className={`admin-terminal-cloud-release-gaps is-${terminalCloudReleaseTone}`} aria-label="터미널 클라우드 출시 전 남은 작업">
            <div className="admin-terminal-cloud-release-gaps-head">
              <div>
                <span className="eyebrow">RELEASE QUEUE</span>
                <strong>출시 전 남은 작업</strong>
                <p className="hint">사용자에게 터미널 클라우드를 안정적으로 열기 전에 먼저 확인해야 할 설정과 운영 기준입니다.</p>
              </div>
              <div className="admin-terminal-cloud-release-gaps-count">
                <strong>{terminalCloudReleaseGaps.length}</strong>
                <span>{terminalCloudReleaseGaps.length ? `차단 ${terminalCloudCriticalGapCount}건` : "바로 공개 가능"}</span>
                <small>{`예상 정리 ${terminalCloudReleaseEtaLabel}`}</small>
              </div>
            </div>
            {terminalCloudReleaseGaps.length ? (
              <>
                <div className="admin-terminal-cloud-release-gaps-list">
                  {terminalCloudReleaseGaps.slice(0, 6).map((item, index) => (
                    <article className={`admin-terminal-cloud-release-gap is-${item.tone}`} key={item.key}>
                      <span>{`${index + 1}순위`}</span>
                      <div>
                        <strong>{item.label}</strong>
                        <p>{item.detail}</p>
                      </div>
                      <a className="admin-terminal-cloud-release-gap-action" href={`#${item.targetId || "admin-platform-lab-settings"}`}>
                        {item.actionLabel || "설정 보기"}
                      </a>
                    </article>
                  ))}
                </div>
                {terminalCloudReleaseGaps.length > 6 ? (
                  <p className="admin-terminal-cloud-release-gaps-more">{`외 ${terminalCloudReleaseGaps.length - 6}개 항목은 릴리스 점검 요약에서 확인할 수 있습니다.`}</p>
                ) : null}
              </>
            ) : (
              <div className="admin-terminal-cloud-release-gaps-empty">
                <strong>터미널 클라우드 기본 공개 조건이 준비되었습니다.</strong>
                <p>이제 브라우저 스모크 테스트와 실제 사용자 플로우만 한 번 더 확인하면 됩니다.</p>
              </div>
            )}
          </div>
          <div className={`admin-terminal-cloud-readiness-board is-${terminalCloudOpsReadinessTone}`} aria-label="터미널 클라우드 운영 준비도">
            <div className="admin-terminal-cloud-readiness-head">
              <div>
                <span className="eyebrow">CLOUD OPS READINESS</span>
                <strong>운영 준비도 진단</strong>
                <p className="hint">생성 실패 원인을 인증/CA, API/Quota, 생성 정책, 사용자 연결 순서로 좁혀 봅니다.</p>
              </div>
              <div className="admin-terminal-cloud-readiness-score">
                <strong>{`${terminalCloudOpsReadinessReadyCount}/${terminalCloudOpsReadinessChecks.length}`}</strong>
                <span>{terminalCloudOpsReadinessAttentionCount ? `확인 필요 ${terminalCloudOpsReadinessAttentionCount}건` : "운영 기준 양호"}</span>
                <button
                  className="mini-btn refresh-btn"
                  disabled={!props.onRefreshApiMonitor}
                  onClick={props.onRefreshApiMonitor}
                  type="button"
                >
                  상태 재점검
                </button>
              </div>
            </div>
            <div className="admin-terminal-cloud-readiness-grid">
              {terminalCloudOpsReadinessGroups.map((group) => (
                <article className={`admin-terminal-cloud-readiness-group is-${group.tone}`} key={group.key}>
                  <div className="admin-terminal-cloud-readiness-group-head">
                    <div>
                      <strong>{group.title}</strong>
                      <p>{group.description}</p>
                    </div>
                    <span>{`${group.readyCount}/${group.checks.length}`}</span>
                  </div>
                  <div className="admin-terminal-cloud-readiness-list">
                    {group.checks.map((check) => (
                      <div className={`admin-terminal-cloud-readiness-item is-${check.state.tone}`} key={`${group.key}-${check.key}`}>
                        <span aria-hidden="true" />
                        <div>
                          <strong>{check.label}</strong>
                          <em>{check.state.label}</em>
                          <small>{check.state.detail}</small>
                        </div>
                        {check.targetTab ? (
                          <button className="admin-terminal-cloud-readiness-link" onClick={() => openSmokeCheckTarget(check)} type="button">
                            {check.actionLabel || "상세 보기"}
                          </button>
                        ) : check.targetId ? (
                          <a className="admin-terminal-cloud-readiness-link" href={`#${check.targetId}`}>{check.actionLabel || "설정 보기"}</a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <ul className="admin-terminal-cloud-readiness-runbook" aria-label={`${group.title} 조치 순서`}>
                    {group.runbook.map((step) => <li key={step}>{step}</li>)}
                  </ul>
                  {Array.isArray(group.commands) && group.commands.length ? (
                    <div className="admin-terminal-cloud-readiness-commands" aria-label={`${group.title} 진단 명령`}>
                      <span>진단 명령</span>
                      {group.commands.map((command) => <code key={command}>{command}</code>)}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
          <div className="admin-terminal-cloud-route-map" aria-label="터미널 클라우드 기능 연결표">
            <div className="admin-terminal-cloud-route-head">
              <div>
                <strong>사용자 메뉴와 관리자 설정 연결표</strong>
                <p className="hint">사용자에게 보이는 클라우드 콘솔 기능이 어떤 관리자 설정과 연결되는지 한 번에 확인합니다.</p>
              </div>
              <div className={`admin-terminal-cloud-route-summary ${terminalCloudRouteWarningCount ? "is-warn" : "is-ready"}`}>
                <strong>{terminalCloudRouteWarningCount}</strong>
                <span>설정 확인</span>
                <a className="admin-v2-release-link" href="#admin-platform-lab-settings">공개 설정으로 이동</a>
              </div>
            </div>
            <div className="admin-terminal-cloud-route-grid">
              {terminalCloudFeatureRouteItems.map((item) => (
                <article className={`admin-terminal-cloud-route-card is-${item.tone}`} key={item.key}>
                  <div>
                    <span>{item.userEntry}</span>
                    <strong>{item.feature}</strong>
                  </div>
                  <em>{item.status}</em>
                  <p>{item.adminSetting}</p>
                  <ul className="admin-terminal-cloud-route-checks" aria-label={`${item.feature} 설정 체크`}>
                    {(item.requirements || []).map((requirement) => (
                      <li className={requirement.ok ? "is-ok" : "is-pending"} key={`${item.key}-${requirement.label}`}>
                        <span aria-hidden="true" />
                        <div>
                          <strong>{requirement.label}</strong>
                          <small>{requirement.detail}</small>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <small>{item.nextAction}</small>
                  {item.targetId ? <a className="admin-terminal-cloud-route-card-link" href={`#${item.targetId}`}>관련 설정 열기</a> : null}
                </article>
              ))}
            </div>
          </div>
        </div>
        <div className={`platform-impact-preview ${props.platformStatusDirty ? "is-dirty" : ""}`}>
          <div className="platform-impact-head">
            <div>
              <span className="eyebrow">SAVE IMPACT</span>
              <strong>설정 영향 미리보기</strong>
              <p className="hint">
                {props.platformStatusDirty
                  ? "저장하면 아래 사용자 화면 영향이 적용됩니다. 저장 전에 차단/중지 항목을 확인하세요."
                  : "현재 저장된 설정이 사용자 포털, 랩실, 터미널 클라우드에 미치는 영향입니다."}
              </p>
            </div>
            <div className={`platform-impact-count ${platformImpactAttentionCount ? "is-warn" : ""}`}>
              <strong>{platformImpactAttentionCount}</strong>
              <span>확인 필요</span>
            </div>
          </div>
          <div className="platform-impact-grid">
            {platformImpactItems.map((item) => (
              <article className={`platform-impact-card is-${item.tone}`} key={item.key}>
                <div>
                  <span>{item.title}</span>
                  <strong>{item.status}</strong>
                </div>
                <p>{item.detail}</p>
                <small>{item.meta}</small>
              </article>
            ))}
          </div>
        </div>
        <div className="admin-policy-history">
          <div>
            <strong>포털 전환 변경 이력</strong>
            <p className="hint">최근 저장된 플랫폼 설정 중 v1/v2 전환과 운영지원 상태 변경만 모아 봅니다.</p>
          </div>
          {portalPolicyHistory.length ? (
            <div className="admin-policy-history-list">
              {portalPolicyHistory.map((log) => {
                const mode = normalizePortalUiMode(log.metadata?.portalUiMode, log.metadata?.userPortalV2Enabled ? "switchable" : "legacy");
                const supportMode = normalizeSupportAvailabilityMode(log.metadata?.supportAvailabilityMode, "");
                return (
                  <div className="admin-policy-history-item" key={log.id || `${log.createdAt}-${log.actorUsername || log.actorId || "admin"}`}>
                    <span>{formatDateTime(log.createdAt)}</span>
                    <strong>{getPortalUiModeSummary(mode).label}</strong>
                    {supportMode ? <em>{getSupportAvailabilitySummary(supportMode).label}</em> : null}
                    <small>{log.adminUsername || log.actorName || log.actorUsername || "관리자"}</small>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="hint">아직 전환 정책 변경 이력이 없습니다. 설정 저장 후부터 이곳에 기록됩니다.</p>
          )}
        </div>
          </div>
        </details>
        <AdminDisclosureCard
          id="admin-platform-core-settings"
          defaultOpen
          title="핵심 설정"
          subtitle="서비스 단계, 프로젝트 분리, 메일/결제, API 연결처럼 자주 바꾸는 항목입니다."
          summary="자주 쓰는 운영 설정"
        >
        <div className="admin-form-grid compact-admin-grid">
          <AdminField label="사이트 버전" hint="포털 사이드바와 워크스페이스에 표시할 웹 사이트 버전입니다. 예: v1.2 또는 2026.05">
            <input value={props.platformStatus?.siteVersionNumber || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, siteVersionNumber: event.target.value }))} placeholder="예: v1.2" />
          </AdminField>
          <AdminField label="사이트 단계" hint="랜딩과 포털에 표시할 현재 서비스 단계입니다. Alpha/Beta/Release 중 하나를 사용합니다.">
            <select value={props.platformStatus?.siteVersionStage || "Release"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, siteVersionStage: event.target.value }))}>
              <option value="Alpha">Alpha</option>
              <option value="Beta">Beta</option>
              <option value="Release">Release</option>
            </select>
          </AdminField>
          <AdminField label="코드명" hint="사이트 하단이나 랜딩에 같이 표시할 릴리즈 코드명입니다. 예: Engineer Lab">
            <input value={props.platformStatus?.siteVersionCodename || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, siteVersionCodename: event.target.value }))} placeholder="예: Engineer Lab" />
          </AdminField>
          <AdminField label="사용자 포털 전환 정책" hint="완전 전환을 선택하면 모든 사용자가 v2 화면으로 고정되고 v1/v2 전환 버튼은 숨겨집니다.">
            <select
              value={portalUiMode}
              onChange={(event) => {
                const nextMode = normalizePortalUiMode(event.target.value, "legacy");
                props.setPlatformStatus((current) => ({
                  ...current,
                  portalUiMode: nextMode,
                  userPortalV2Enabled: nextMode !== "legacy",
                }));
              }}
            >
              <option value="legacy">v1 고정</option>
              <option value="switchable">v2 기본 + v1 전환 허용</option>
              <option value="v2">v2 완전 전환</option>
            </select>
          </AdminField>
          <AdminField label="v2 전환 공지" hint="전환 허용 상태에서는 v1 화면 사용자에게 표시하고, 완전 전환 상태에서는 공지 문구가 있을 때만 표시합니다.">
            <select
              value={props.platformStatus?.portalV2TransitionNoticeEnabled === false ? "disabled" : "enabled"}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, portalV2TransitionNoticeEnabled: event.target.value === "enabled" }))}
            >
              <option value="enabled">표시</option>
              <option value="disabled">숨김</option>
            </select>
          </AdminField>
          <AdminField label="v2 전환 공지 문구" hint="전환 허용 상태에서는 비워두면 기본 안내를 표시합니다. 완전 전환 상태에서는 문구가 있을 때만 배너가 표시됩니다.">
            <input
              value={props.platformStatus?.portalV2TransitionNoticeMessage || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, portalV2TransitionNoticeMessage: event.target.value }))}
              placeholder="예: 다음 달부터 v2 포털이 기본 화면으로 전환됩니다."
            />
          </AdminField>
          <AdminField label="운영지원 응답 상태" hint="부재중으로 전환하면 일반 사용자의 운영지원 쪽지 발송 버튼이 비활성화되고 API에서도 접수를 막습니다.">
            <select
              value={supportAvailabilityMode}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, supportAvailabilityMode: normalizeSupportAvailabilityMode(event.target.value) }))}
            >
              <option value="available">상담 가능</option>
              <option value="away">부재중</option>
            </select>
          </AdminField>
          <AdminField label="운영지원 부재중 안내" hint="부재중 상태에서 사용자 문의 화면에 표시하고 발송 차단 응답에도 사용합니다.">
            <input
              value={props.platformStatus?.supportUnavailableMessage || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, supportUnavailableMessage: event.target.value }))}
              placeholder="현재 관리자가 부재중입니다. 운영지원 대화는 잠시 후 다시 이용해 주세요."
            />
          </AdminField>
          <AdminConsultingReplyTemplateSettings
            platformStatus={props.platformStatus}
            setPlatformStatus={props.setPlatformStatus}
          />
          <AdminField label="업그레이드 안내" hint="사용자 포털 상단에 안내만 표시합니다. 기존 기능 사용은 차단하지 않습니다.">
            <select
              value={props.platformStatus?.siteUpdateInProgress ? "enabled" : "disabled"}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, siteUpdateInProgress: event.target.value === "enabled" }))}
            >
              <option value="disabled">숨김</option>
              <option value="enabled">업그레이드 안내 표시</option>
            </select>
          </AdminField>
          <AdminField label="업그레이드 안내 문구" hint="비워두면 기본 업그레이드 안내 문구를 표시합니다. 기존 '업데이트 중!' 문구는 사용자 화면에서 새 안내로 보정됩니다.">
            <input
              value={props.platformStatus?.siteUpdateMessage || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, siteUpdateMessage: event.target.value }))}
              placeholder="화면과 기능을 더 보기 좋게 다듬고 있어요. 잠시 후 새로고침하면 이어서 사용할 수 있습니다."
            />
          </AdminField>
          <div className={`settings-panel compact-stack admin-circuit-panel admin-grid-span ${props.platformStatus?.labCircuitBreaker ? "is-active" : ""}`}>
            <div className="settings-panel-head admin-circuit-panel-head">
              <div>
                <strong>서킷 브레이크</strong>
                <p className="hint">새 랩 생성, 랩 시작/초기화, 사용자화 가상머신 생성을 즉시 차단합니다. Quota 위험 도달 시 자동 실행할 수 있습니다.</p>
              </div>
              <div className="admin-inline-actions">
                <span className={`admin-circuit-status ${props.platformStatus?.labCircuitBreaker ? "is-active" : ""}`}>
                  {props.platformStatus?.labCircuitBreaker ? "차단 중" : "정상"}
                </span>
                <button
                  className={props.platformStatus?.labCircuitBreaker ? "mini-btn" : "mini-btn danger-btn"}
                  onClick={props.onToggleCircuitBreaker}
                  type="button"
                >
                  {props.platformStatus?.labCircuitBreaker ? "랩 생성 재개" : "랩 생성 차단"}
                </button>
              </div>
            </div>
            {props.platformStatus?.labCircuitBreaker ? (
              <div className="global-banner is-danger">
                <strong>{circuitBreakerSourceLabel}</strong>
                <span>{props.platformStatus.labCircuitBreakerMessage}</span>
                {circuitBreakerMetricLabel ? (
                  <small>{`${circuitBreakerMetricLabel} ${props.platformStatus.labCircuitBreakerUsagePercent || 0}% · ${props.platformStatus.labCircuitBreakerTriggeredAt || "차단 시각 확인 중"}`}</small>
                ) : null}
              </div>
            ) : null}
            <div className="admin-form-grid compact-admin-grid">
              <AdminField label="Quota 자동 서킷 브레이크" hint="vCPU, RAM, Volume 중 하나라도 임계값에 도달하면 신규 생성을 자동 차단합니다. 자동 해제하지 않으며 관리자 확인 후 재개합니다.">
                <select
                  value={props.platformStatus?.labAutoCircuitBreakerEnabled === false ? "disabled" : "enabled"}
                  onChange={(event) => props.setPlatformStatus((current) => ({ ...current, labAutoCircuitBreakerEnabled: event.target.value === "enabled" }))}
                >
                  <option value="enabled">자동 차단 사용</option>
                  <option value="disabled">수동 차단만 사용</option>
                </select>
              </AdminField>
              <AdminField label="자동 차단 임계값 (%)" hint="포털 위험 기준과 같은 92%를 권장합니다. 설정 범위는 50~100%입니다.">
                <input
                  max="100"
                  min="50"
                  type="number"
                  value={props.platformStatus?.labAutoCircuitBreakerThresholdPercent || 92}
                  onChange={(event) => props.setPlatformStatus((current) => ({
                    ...current,
                    labAutoCircuitBreakerThresholdPercent: Math.max(50, Math.min(100, Number(event.target.value || 92) || 92)),
                  }))}
                />
              </AdminField>
              <AdminField label="차단 안내 문구" hint="사용자에게 503 응답과 함께 표시됩니다.">
                <textarea
                  rows={3}
                  value={props.platformStatus?.labCircuitBreakerMessage || ""}
                  onChange={(event) => props.setPlatformStatus((current) => ({ ...current, labCircuitBreakerMessage: event.target.value }))}
                  placeholder="더 이상 랩 생성이 불가합니다."
                />
              </AdminField>
              <div className="admin-circuit-actions">
                <div className="hint">문구만 바꿀 때는 문구 저장으로 즉시 반영할 수 있습니다.</div>
                <div className="portal-actions">
                  <button className="mini-btn save-btn" onClick={props.onSaveCircuitBreakerMessage} type="button">문구 저장</button>
                  <button className="mini-btn" onClick={props.onSavePlatformSettings} type="button">전체 설정 저장</button>
                </div>
              </div>
            </div>
          </div>
          <AdminField label="서비스 프로젝트" hint="랩실과 사용자화 가상머신 구성처럼 기본 서비스 자원이 사용할 OpenStack 프로젝트 이름입니다.">
            <input {...serviceProjectNameInput} placeholder="예: service" />
          </AdminField>
          <AdminField label="서비스 clouds.yaml" hint="서비스 프로젝트가 사용할 OpenStack clouds.yaml 파일 경로입니다. 비워두면 기본 OPENSTACK_CLOUDS_YAML을 사용합니다.">
            <input {...serviceCloudsYamlInput} placeholder="예: /app/secrets/service-clouds.yaml" />
          </AdminField>
          <AdminField label="서비스 Cloud 이름" hint="서비스 clouds.yaml 안의 clouds 항목 이름입니다.">
            <input {...serviceCloudNameInput} placeholder="예: openstack" />
          </AdminField>
          <AdminField label="서비스 Keystone/Auth URL" hint="서비스 프로젝트 토큰 발급에 사용할 OpenStack Keystone 주소입니다. 비워두면 clouds.yaml의 auth_url을 사용합니다.">
            <input {...serviceAuthUrlInput} placeholder="예: https://identity.example.com:5000" />
          </AdminField>
          <AdminField label="서비스 Heat API URL" hint="Heat 카탈로그 endpoint를 직접 지정해야 할 때 사용합니다. 비워두면 Keystone 카탈로그에서 찾습니다.">
            <input {...serviceHeatApiUrlInput} placeholder="예: https://identity.example.com:8004/v1/{project_id}" />
          </AdminField>
          <AdminField label="서비스 Compute API URL" hint="Nova/Compute 카탈로그 endpoint를 직접 지정해야 할 때 사용합니다. 비워두면 Keystone 카탈로그에서 찾습니다.">
            <input {...serviceComputeApiUrlInput} placeholder="예: https://identity.example.com:8774/v2.1" />
          </AdminField>
          <AdminField label="서비스 Network API URL" hint="Neutron/Network 카탈로그 endpoint를 직접 지정해야 할 때 사용합니다. 비워두면 Keystone 카탈로그에서 찾습니다.">
            <input {...serviceNetworkApiUrlInput} placeholder="예: https://identity.example.com:9696" />
          </AdminField>
          <AdminField label="서비스 Metric/Gnocchi API URL" hint="Gnocchi/Metric 카탈로그 endpoint를 직접 지정해야 할 때 사용합니다. 비워두면 Keystone 카탈로그에서 찾습니다.">
            <input
              value={props.platformStatus?.serviceMetricApiUrl || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, serviceMetricApiUrl: event.target.value }))}
              placeholder="예: https://identity.example.com:8041"
            />
          </AdminField>
          <AdminField label="OpenStack 상태 조회" hint="끄면 Quota, Heat, Zun, CAPO, Trove 상태 점검 API 호출을 중지합니다. 랩 생성 설정은 유지됩니다.">
            <select
              value={props.platformStatus?.openstackStatusProbesEnabled === false ? "disabled" : "enabled"}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, openstackStatusProbesEnabled: event.target.value === "enabled" }))}
            >
              <option value="disabled">일시 중지</option>
              <option value="enabled">사용</option>
            </select>
          </AdminField>
          <AdminField label="상태 조회 캐시 TTL (분)" hint="OpenStack 상태 조회를 켠 경우 이 주기마다 한 번만 외부 API를 새로 조회합니다. 일반 화면은 캐시된 값을 사용합니다.">
            <input
              min="1"
              max="1440"
              type="number"
              value={props.platformStatus?.openstackStatusCacheTtlMinutes || 10}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                openstackStatusCacheTtlMinutes: Math.max(1, Math.min(1440, Number(event.target.value || 10) || 10)),
              }))}
              placeholder="예: 10"
            />
          </AdminField>
          <AdminField label="관리자 자동 새로고침 (초)" hint="관리자 화면이 백그라운드에서 데이터를 다시 불러오는 간격입니다. 내부망 전환 전에는 60초 이상을 권장합니다.">
            <input
              min="10"
              max="3600"
              type="number"
              value={props.platformStatus?.adminAutoRefreshIntervalSeconds || 60}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                adminAutoRefreshIntervalSeconds: Math.max(10, Math.min(3600, Number(event.target.value || 60) || 60)),
              }))}
              placeholder="예: 60"
            />
          </AdminField>
          <AdminField label="사용자 자동 새로고침 (초)" hint="사용자 포털의 랩, 자원 요청, 상태 정보 자동 갱신 간격입니다. 60초면 운영 부담과 체감 신선도 사이가 무난합니다.">
            <input
              min="10"
              max="3600"
              type="number"
              value={props.platformStatus?.userAutoRefreshIntervalSeconds || 60}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                userAutoRefreshIntervalSeconds: Math.max(10, Math.min(3600, Number(event.target.value || 60) || 60)),
              }))}
              placeholder="예: 60"
            />
          </AdminField>
          <AdminField label="클라우드 콘솔 프로젝트" hint="연구실/랩 클라우드 콘솔과 예외 애플리케이션을 격리해서 운영할 OpenStack 프로젝트 이름입니다.">
            <input value={props.platformStatus?.pocProjectName || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, pocProjectName: event.target.value }))} placeholder="예: PoC-example.com" />
          </AdminField>
          <AdminField label="클라우드 콘솔 clouds.yaml" hint="클라우드 콘솔 프로젝트가 사용할 OpenStack clouds.yaml 파일 경로입니다. 비워두면 기본 OPENSTACK_CLOUDS_YAML을 사용합니다.">
            <input value={props.platformStatus?.pocCloudsYaml || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, pocCloudsYaml: event.target.value }))} placeholder="예: /app/secrets/poc-clouds.yaml" />
          </AdminField>
          <AdminField label="클라우드 콘솔 Cloud 이름" hint="클라우드 콘솔 clouds.yaml 안의 clouds 항목 이름입니다.">
            <input value={props.platformStatus?.pocCloudName || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, pocCloudName: event.target.value }))} placeholder="예: openstack" />
          </AdminField>
          <AdminField label="클라우드 콘솔 Keystone/Auth URL" hint="클라우드 콘솔 프로젝트 토큰 발급에 사용할 OpenStack Keystone 주소입니다. 비워두면 clouds.yaml의 auth_url을 사용합니다.">
            <input value={props.platformStatus?.pocAuthUrl || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, pocAuthUrl: event.target.value }))} placeholder="예: https://identity.example.com:5000" />
          </AdminField>
          <AdminField label="클라우드 콘솔 Heat API URL" hint="클라우드 콘솔 Heat 카탈로그 endpoint를 직접 지정해야 할 때 사용합니다. 비워두면 Keystone 카탈로그에서 찾습니다.">
            <input value={props.platformStatus?.pocHeatApiUrl || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, pocHeatApiUrl: event.target.value }))} placeholder="예: https://identity.example.com:8004/v1/{project_id}" />
          </AdminField>
          <AdminField label="클라우드 콘솔 Metric/Gnocchi API URL" hint="클라우드 콘솔 프로젝트의 Gnocchi/Metric endpoint를 직접 지정해야 할 때 사용합니다. 비워두면 Keystone 카탈로그에서 찾습니다.">
            <input value={props.platformStatus?.pocMetricApiUrl || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, pocMetricApiUrl: event.target.value }))} placeholder="예: https://identity.example.com:8041" />
          </AdminField>
          <AdminField label="클라우드 콘솔 기본 HeatStack 템플릿" hint="클라우드 콘솔 생성/승인 시 요청별 템플릿이 지정되지 않으면 이 Heat 템플릿을 사용합니다.">
            <select
              value={props.platformStatus?.pocDefaultHeatTemplateName || "self-service-vm-dynamic.yaml"}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, pocDefaultHeatTemplateName: event.target.value }))}
            >
              {heatTemplateOptions.some((item) => item.name === "self-service-vm-dynamic.yaml") ? null : (
                <option value="self-service-vm-dynamic.yaml">self-service-vm-dynamic.yaml</option>
              )}
              {heatTemplateOptions.map((template) => (
                <option key={template.name} value={template.name}>{template.name}</option>
              ))}
            </select>
          </AdminField>
          <AdminField label="Zun 프로젝트" hint="컨테이너 실습을 서비스 프로젝트와 분리하고 싶을 때 사용할 OpenStack 프로젝트 이름입니다.">
            <input value={props.platformStatus?.zunProjectName || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, zunProjectName: event.target.value }))} placeholder="예: zun" />
          </AdminField>
          <AdminField label="쿠버네티스 프로젝트 (CAPO)" hint="CAPO 기반 Kubernetes 클러스터를 일반 서비스 자원과 분리해 운영할 OpenStack 프로젝트 이름입니다.">
            <input value={props.platformStatus?.magnumProjectName || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, magnumProjectName: event.target.value }))} placeholder="예: poc-example.com" />
            <small>프로파일은 아래 CAPO 프로파일 항목에서 관리하며, 저장값이 없을 때만 CAPO_CLUSTER_PROFILES_JSON을 사용합니다.</small>
          </AdminField>
          <AdminField label="데이터베이스 프로젝트 (Trove)" hint="Trove 기반 DBaaS 인스턴스를 일반 서비스 자원과 분리해 운영할 OpenStack 프로젝트 이름입니다.">
            <input value={props.platformStatus?.troveProjectName || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, troveProjectName: event.target.value }))} placeholder="예: trove" />
          </AdminField>
          <AdminField label="PG 결제 사용 여부" hint="활성화하면 유료 과정에서 결제 준비 기능을 사용할 수 있습니다. 현재는 공통 PG 연동 골격과 관리자 수동 완료 처리, 웹훅 수신을 지원합니다.">
            <select value={props.platformStatus?.paymentGatewayEnabled ? "enabled" : "disabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, paymentGatewayEnabled: event.target.value === "enabled" }))}>
              <option value="disabled">사용 안 함</option>
              <option value="enabled">사용</option>
            </select>
          </AdminField>
          <AdminField label="PG 제공사" hint="웹 결제창을 사용하려면 `토스페이먼츠`처럼 정확한 제공사를 선택해야 합니다.">
            <select
              value={props.platformStatus?.paymentGatewayProvider || "manual"}
              onChange={(event) => {
                const nextProvider = event.target.value;
                props.setPlatformStatus((current) => {
                  const currentBaseUrl = String(current?.paymentGatewayApiBaseUrl || "").trim();
                  const providerChanged = String(current?.paymentGatewayProvider || "manual") !== nextProvider;
                  let nextBaseUrl = currentBaseUrl;
                  if (providerChanged && (!currentBaseUrl || currentBaseUrl === "https://api.tosspayments.com" || currentBaseUrl === "https://api.portone.io")) {
                    nextBaseUrl = nextProvider === "tosspayments"
                      ? "https://api.tosspayments.com"
                      : nextProvider === "portone"
                        ? "https://api.portone.io"
                        : "";
                  }
                  return {
                    ...current,
                    paymentGatewayProvider: nextProvider,
                    paymentGatewayApiBaseUrl: nextBaseUrl,
                  };
                });
              }}
            >
              <option value="manual">수동 처리</option>
              <option value="tosspayments">토스페이먼츠</option>
              <option value="portone">포트원</option>
            </select>
          </AdminField>
          <div className="hint">
            Toss 테스트 연동은 `test_ck...` 클라이언트 키와 같은 세트의 `test_sk...` 시크릿 키를 함께 사용해야 합니다. 테스트 키와 라이브 키를 섞으면 `INVALID_API_KEY` 오류가 납니다.
          </div>
          <div className="portal-actions">
            <button className="mini-btn" onClick={() => applyTossTestDefaults(props.setPlatformStatus)} type="button">
              토스 테스트 기본값 채우기
            </button>
          </div>
          <AdminField label="PG Merchant ID" hint="PG 상점 ID 또는 가맹점 식별자입니다.">
            <input value={props.platformStatus?.paymentGatewayMerchantId || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, paymentGatewayMerchantId: event.target.value }))} placeholder="예: terminal-lab-merchant" />
          </AdminField>
          <AdminField label="PG API Base URL" hint="PG 서버 API 기본 주소입니다. 필요한 경우에만 입력합니다.">
            <input value={props.platformStatus?.paymentGatewayApiBaseUrl || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, paymentGatewayApiBaseUrl: event.target.value }))} placeholder="예: https://api.portone.io" />
          </AdminField>
          <AdminField label="PG Public Key" hint="토스페이먼츠 결제창 SDK는 API 개별 연동용 `test_ck...` 또는 `live_ck...` 키를 사용합니다. `gck`는 결제위젯 전용입니다.">
            <AdminSecretInput
              value={props.platformStatus?.paymentGatewayPublicKey || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, paymentGatewayPublicKey: event.target.value }))}
              placeholder="예: test_ck_xxx"
              visible={Boolean(props.paymentGatewayKeyVisibility?.publicKey)}
              onToggleVisibility={() => props.setPaymentGatewayKeyVisibility((current) => ({ ...current, publicKey: !current.publicKey }))}
            />
          </AdminField>
          <AdminField label="PG Secret Key" hint="토스페이먼츠 서버 승인 API는 API 개별 연동용 `test_sk...` 또는 `live_sk...` 키를 사용합니다. `gsk`는 결제위젯 전용입니다.">
            <AdminSecretInput
              value={props.platformStatus?.paymentGatewaySecretKey || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, paymentGatewaySecretKey: event.target.value }))}
              placeholder="예: test_sk_xxx"
              visible={Boolean(props.paymentGatewayKeyVisibility?.secretKey)}
              onToggleVisibility={() => props.setPaymentGatewayKeyVisibility((current) => ({ ...current, secretKey: !current.secretKey }))}
            />
          </AdminField>
          <AdminField label="PG Webhook Secret" hint="PG 웹훅 서명 검증 또는 내부 테스트 웹훅 보호용 비밀 값입니다.">
            <AdminSecretInput
              value={props.platformStatus?.paymentGatewayWebhookSecret || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, paymentGatewayWebhookSecret: event.target.value }))}
              placeholder="예: webhook-secret"
              visible={Boolean(props.paymentGatewayKeyVisibility?.webhookSecret)}
              onToggleVisibility={() => props.setPaymentGatewayKeyVisibility((current) => ({ ...current, webhookSecret: !current.webhookSecret }))}
            />
          </AdminField>
          <div className="admin-grid-span">
            <AdminDisclosureCard
              title="SSO 로그인 설정"
              subtitle="Google, 카카오, 네이버 OAuth 로그인을 관리자 화면에서 관리합니다."
              summary={`${oauthCounts.enabled}개 사용 / ${oauthCounts.configured}개 설정`}
            >
              <AdminSsoSettingsPanel {...props} />
            </AdminDisclosureCard>
          </div>
          <div className="admin-grid-span">
            <AdminDisclosureCard
              id="admin-platform-mail-settings"
              title="메일 설정"
              subtitle="SMTP 연결 정보와 거래성 메일 문구를 분리해서 관리합니다."
              summary={`${props.platformStatus?.mailEnabled ? "활성" : "비활성"} / ${mailProviderLabel}`}
            >
              <div className="settings-panel compact-stack">
                <div className="admin-form-grid compact-admin-grid">
                  <AdminField label="메일 사용 여부" hint="활성화하면 회원/초대장/결제/과정/SSH/자격증/시험 결과 메일을 발송합니다.">
                    <select value={props.platformStatus?.mailEnabled ? "enabled" : "disabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, mailEnabled: event.target.value === "enabled" }))}>
                      <option value="disabled">사용 안 함</option>
                      <option value="enabled">사용</option>
                    </select>
                  </AdminField>
                  <AdminField label="사전조사 메일 전송" hint="사전 설문 제출 시 관리자 이메일(@ADMINS)로 응답 내용을 자동 발송합니다.">
                    <select value={props.platformStatus?.preSurveyAdminMailEnabled ? "enabled" : "disabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, preSurveyAdminMailEnabled: event.target.value === "enabled" }))}>
                      <option value="enabled">사용</option>
                      <option value="disabled">사용 안 함</option>
                    </select>
                  </AdminField>
                  <AdminField label="랩 시험 결과 쪽지" hint="끄면 시험 결과는 기록과 알림으로만 남고, 쪽지함에는 새 결과 쪽지를 만들지 않습니다.">
                    <select value={props.platformStatus?.labExamResultMessageEnabled ? "enabled" : "disabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, labExamResultMessageEnabled: event.target.value === "enabled" }))}>
                      <option value="disabled">사용 안 함</option>
                      <option value="enabled">사용</option>
                    </select>
                  </AdminField>
                  <AdminField label="메일 제공자" hint="네이버, Google, 직접 SMTP 또는 Webhook 중 하나를 선택할 수 있습니다.">
                    <select value={props.platformStatus?.mailProvider || "webhook"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, mailProvider: event.target.value }))}>
                      <option value="naver">네이버 메일</option>
                      <option value="google">Google 메일</option>
                      <option value="smtp">SMTP 직접 설정</option>
                      <option value="webhook">Webhook</option>
                    </select>
                  </AdminField>
                  <AdminField label="발신자 이름" hint="메일 제목 영역에 표시할 발신자 이름입니다.">
                    <input value={props.platformStatus?.mailFromName || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, mailFromName: event.target.value }))} placeholder="예: Terminal Lab" />
                  </AdminField>
                  <AdminField label="발신자 이메일" hint="실제 수신자에게 보일 발신자 주소입니다.">
                    <input value={props.platformStatus?.mailFromAddress || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, mailFromAddress: event.target.value }))} placeholder="예: no-reply@example.com" />
                  </AdminField>
                  {props.platformStatus?.mailProvider === "webhook" ? (
                    <>
                      <AdminField label="메일 Webhook URL" hint="사내 메일 게이트웨이나 별도 알림 시스템으로 전달할 Webhook 주소입니다.">
                        <input value={props.platformStatus?.mailWebhookUrl || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, mailWebhookUrl: event.target.value }))} placeholder="예: https://hooks.example.com/mail" />
                      </AdminField>
                      <AdminField label="메일 Webhook Timeout (ms)" hint="Webhook 호출 제한 시간입니다. 기본값은 10000ms입니다.">
                        <input value={props.platformStatus?.mailWebhookTimeoutMs || 10000} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, mailWebhookTimeoutMs: event.target.value }))} placeholder="예: 10000" />
                      </AdminField>
                    </>
                  ) : (
                    <>
                      {props.platformStatus?.mailProvider === "smtp" ? (
                        <>
                          <AdminField label="SMTP 호스트" hint="로컬 Mailpit, MailHog 또는 사내 SMTP 서버 주소입니다.">
                            <input value={props.platformStatus?.mailSmtpHost || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, mailSmtpHost: event.target.value }))} placeholder="예: 127.0.0.1 또는 mailpit.internal" />
                          </AdminField>
                          <AdminField label="SMTP 포트" hint="일반적으로 1025, 587, 465 중 하나를 사용합니다.">
                            <input value={props.platformStatus?.mailSmtpPort || 587} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, mailSmtpPort: event.target.value }))} placeholder="예: 1025" />
                          </AdminField>
                          <AdminField label="SMTP 보안 연결" hint="465는 보통 사용, 1025나 587 테스트 서버는 보통 사용 안 함입니다.">
                            <select value={props.platformStatus?.mailSmtpSecure ? "secure" : "plain"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, mailSmtpSecure: event.target.value === "secure" }))}>
                              <option value="plain">사용 안 함</option>
                              <option value="secure">TLS/SSL 사용</option>
                            </select>
                          </AdminField>
                        </>
                      ) : null}
                      <AdminField label="SMTP 계정" hint={props.platformStatus?.mailProvider === "smtp" ? "로컬 SMTP 테스트면 비워도 되는 서버가 많고, 인증이 필요한 서버면 계정을 입력합니다." : "네이버 또는 Google SMTP 로그인에 사용할 계정입니다."}>
                        <input value={props.platformStatus?.mailSmtpUser || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, mailSmtpUser: event.target.value }))} placeholder="예: account@example.com" />
                      </AdminField>
                      <AdminField label="SMTP 비밀번호" hint={props.platformStatus?.mailProvider === "smtp" ? "인증이 없는 로컬 SMTP라면 비워 둘 수 있습니다." : "앱 비밀번호 또는 SMTP 전용 비밀번호를 입력합니다."}>
                        <input type="password" value={props.platformStatus?.mailSmtpPassword || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, mailSmtpPassword: event.target.value }))} placeholder="SMTP 비밀번호" />
                      </AdminField>
                    </>
                  )}
                </div>
                {props.platformStatus?.paymentGatewayEnabled && !String(props.platformStatus?.paymentGatewayWebhookSecret || "").trim() ? (
                  <div className="hint">
                    테스트 결제 검증은 `successUrl`에서 `/api/payments/confirm`으로 이어지는 흐름만으로도 가능합니다. 실제 운영 전에는 반드시 웹훅 시크릿까지 설정하세요.
                  </div>
                ) : null}
                {props.platformStatus?.mailEnabled ? (
                  <div className="hint">
                    회원/초대장/결제/과정/외부 SSH/자격증/시험 결과 메일과, 설정이 켜져 있으면 사전 설문 관리자 알림 메일도 현재 설정으로 발송됩니다. SMTP를 쓸 때는 앱 비밀번호 또는 SMTP 전용 비밀번호를 권장합니다.
                  </div>
                ) : null}
                <AdminDisclosureCard
                  title="메일 템플릿"
                  subtitle="기본 문구는 유지하고 필요한 항목만 개별로 덮어쓸 수 있습니다."
                  summary={`${mailTemplateCatalog.length}개 템플릿`}
                >
                  <div className="admin-mail-template-grid">
                    {mailTemplateCatalog.length ? mailTemplateCatalog.map((template) => {
                      const currentTemplate = mailTemplates?.[template.key] || {};
                      const placeholderLabel = Array.isArray(template.placeholders) && template.placeholders.length
                        ? template.placeholders.map((item) => `{${item}}`).join(", ")
                        : "없음";
                      const hasOverride = Boolean(String(currentTemplate.subject || "").trim() || String(currentTemplate.text || "").trim());
                      return (
                        <AdminDisclosureCard
                          key={template.key}
                          title={template.label}
                          subtitle={template.key}
                          summary={hasOverride ? "사용자 문구" : "기본값"}
                          actions={hasOverride ? (
                            <button className="mini-btn" type="button" onClick={() => resetMailTemplate(template.key)}>
                              기본값 사용
                            </button>
                          ) : null}
                        >
                          <div className="settings-panel compact-stack">
                            <div className="hint">{`치환 변수: ${placeholderLabel}`}</div>
                            <AdminField label="제목 템플릿" hint={`기본값: ${template.subject || "-"}`}>
                              <input
                                value={currentTemplate.subject || ""}
                                onChange={(event) => updateMailTemplateField(template.key, "subject", event.target.value)}
                                placeholder={template.subject || ""}
                              />
                            </AdminField>
                            <AdminField label="본문 템플릿" hint="줄바꿈과 치환 변수를 그대로 사용할 수 있습니다.">
                              <textarea
                                rows={6}
                                value={currentTemplate.text || ""}
                                onChange={(event) => updateMailTemplateField(template.key, "text", event.target.value)}
                                placeholder={template.text || ""}
                              />
                            </AdminField>
                          </div>
                        </AdminDisclosureCard>
                      );
                    }) : <div className="hint">표시할 메일 템플릿 목록을 불러오지 못했습니다.</div>}
                  </div>
                </AdminDisclosureCard>
              </div>
            </AdminDisclosureCard>
          </div>
            <AdminField label="회원가입 초대장 필수" hint="활성화하면 가입 시 초대장 코드가 없으면 회원가입을 완료할 수 없습니다.">
              <select value={props.platformStatus?.inviteOnlyMode ? "enabled" : "disabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, inviteOnlyMode: event.target.value === "enabled" }))}>
                <option value="disabled">사용 안 함</option>
                <option value="enabled">사용</option>
              </select>
            </AdminField>
            <AdminField label="회원가입 즉시 승인" hint="활성화하면 신규 가입 계정을 관리자 승인 대기 없이 바로 승인 상태로 생성합니다.">
              <select value={props.platformStatus?.signupAutoApproveEnabled ? "enabled" : "disabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, signupAutoApproveEnabled: event.target.value === "enabled" }))}>
                <option value="disabled">관리자 승인 필요</option>
                <option value="enabled">관리자 승인 없이 가입</option>
              </select>
            </AdminField>
            <AdminField label="약관 동의 기능" hint="비활성화하면 회원가입과 로그인 후 서비스 이용 시 약관 동의를 요구하지 않습니다. 기존 약관 버전은 보존됩니다.">
              <select value={props.platformStatus?.termsEnabled === false ? "disabled" : "enabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, termsEnabled: event.target.value === "enabled" }))}>
                <option value="disabled">사용 안 함</option>
                <option value="enabled">사용</option>
              </select>
            </AdminField>
            <AdminField label="회원가입 웰컴쿠폰 자동 발급" hint="활성화하면 신규 회원가입 완료 시 첫 결제 전용 웰컴쿠폰을 자동으로 발급하고 알림/메일을 보냅니다.">
              <select value={props.platformStatus?.signupWelcomeCouponEnabled === false ? "disabled" : "enabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, signupWelcomeCouponEnabled: event.target.value === "enabled" }))}>
                <option value="disabled">사용 안 함</option>
                <option value="enabled">사용</option>
              </select>
            </AdminField>
            <AdminField label="계정 공유 감지" hint="활성화하면 같은 계정의 동시 활성 세션을 IP 대역 중심으로 비교합니다. 다른 네트워크와 다른 기기/브라우저가 함께 반복 감지될 때 24시간 접근을 제한하며, 관리자 계정은 제외됩니다.">
              <select value={props.platformStatus?.accountSharingProtectionEnabled ? "enabled" : "disabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, accountSharingProtectionEnabled: event.target.value === "enabled" }))}>
                <option value="disabled">사용 안 함</option>
                <option value="enabled">사용</option>
              </select>
            </AdminField>
          <div className="settings-panel compact-stack service-visibility-panel admin-grid-span" id="admin-platform-lab-settings">
            <div className="settings-panel-head">
              <div>
                <strong>확장 기능 공개 상태</strong>
                <p className="hint">비활성화한 기능은 일반 사용자에게 준비 중 팝업으로 안내하고, 관리자는 계속 확인할 수 있습니다.</p>
              </div>
            </div>
            <div className="admin-extension-summary-grid">
              <div>
                <span>기본 연구실/랩</span>
                <strong>{props.platformStatus?.selfServiceVmServiceEnabled ? "공개" : "준비 중"}</strong>
                <small>사용자별 권한이 있어야 신청 가능</small>
              </div>
              <div>
                <span>클라우드 확장</span>
                <strong>{[
                  props.platformStatus?.zunEnabled,
                  props.platformStatus?.magnumEnabled,
                  props.platformStatus?.troveEnabled,
                  props.platformStatus?.aiGpuEnabled,
                ].filter(Boolean).length}/4</strong>
                <small>컨테이너, K8s, DB, AI/GPU</small>
              </div>
            </div>
            <AdminField label="공개 범위 / 비공개 사유" hint="릴리스 전 확장 기능을 모두 숨기는 경우, 사용자 노출 범위와 비공개 사유를 기록합니다. 릴리스 점검에서 운영 근거로 사용됩니다.">
              <textarea
                rows={4}
                value={props.platformStatus?.extensionServiceVisibilityNote || ""}
                onChange={(event) => props.setPlatformStatus((current) => ({ ...current, extensionServiceVisibilityNote: event.target.value }))}
                placeholder="예: v1.0 공개 scope는 교육 랩과 랩실 중심입니다. 연구실/랩, PoC, container/Zun, Kubernetes/CAPO, DB/Trove, AI/GPU는 운영 검증 전까지 disabled 상태로 비공개 유지합니다."
              />
            </AdminField>
            <div className="admin-form-grid compact-admin-grid">
              {[
                ["arenaEnabled", "실무 역량 진단"],
                ["selfServiceVmServiceEnabled", "클라우드 콘솔"],
                ["zunEnabled", "컨테이너 랩"],
                ["magnumEnabled", "쿠버네티스 클러스터"],
                ["troveEnabled", "데이터베이스"],
                ["aiGpuEnabled", "AI 랩"],
                ["llmEnabled", "AI 질문"],
              ].map(([key, label]) => (
                <AdminField key={key} label={label}>
                  <select value={props.platformStatus?.[key] ? "enabled" : "disabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, [key]: event.target.value === "enabled" }))}>
                    <option value="disabled">서비스 준비 중</option>
                    <option value="enabled">사용자에게 공개</option>
                  </select>
                </AdminField>
              ))}
            </div>
          </div>
          <AdminField label="클라우드 콘솔 허용 Flavor" hint="클라우드 콘솔에서 사용자가 선택할 수 있는 OpenStack Flavor 허용 목록입니다. 쉼표로 구분합니다.">
            <AdminCsvInput
              values={props.platformStatus?.selfServiceVmAllowedFlavors}
              onChange={(values) => props.setPlatformStatus((current) => ({ ...current, selfServiceVmAllowedFlavors: values }))}
              placeholder="예: m1.tiny, m1.small, m1.medium"
            />
          </AdminField>
          <AdminField label="클라우드 콘솔 허용 이미지" hint="클라우드 콘솔에서 인스턴스 생성 시 선택할 수 있는 이미지 목록입니다. 쉼표로 구분합니다.">
            <AdminCsvInput
              values={props.platformStatus?.selfServiceVmAllowedImages}
              onChange={(values) => props.setPlatformStatus((current) => ({ ...current, selfServiceVmAllowedImages: values }))}
              placeholder="예: lab-rocky-9-2026, ubuntu-24.04"
            />
          </AdminField>
          <AdminField label="클라우드 콘솔 허용 프로젝트" hint="사용자가 클라우드 콘솔에서 선택할 수 있는 공용 OpenStack 프로젝트입니다. 승인된 전용 프로젝트도 사용자별로 표시됩니다.">
            <input
              value={(props.platformStatus?.selfServiceVmAllowedProjects || []).join(", ")}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  selfServiceVmAllowedProjects: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                }))
              }
              placeholder={`예: ${props.platformStatus?.serviceProjectName || "service"}, ${props.platformStatus?.pocProjectName || "PoC-example.com"}`}
            />
          </AdminField>
          <AdminField label="클라우드 콘솔 작업 실행 방식" hint="즉시 실행은 콘솔 작업을 바로 OpenStack에 반영합니다. 수동 승인은 관리자 검토 후 실행합니다.">
            <select
              value={props.platformStatus?.selfServiceVmAutoProvisionEnabled === false ? "manual" : "auto"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                selfServiceVmAutoProvisionEnabled: event.target.value === "auto",
              }))}
            >
              <option value="auto">즉시 실행</option>
              <option value="manual">관리자 승인 후 실행</option>
            </select>
          </AdminField>
          <AdminField label="Cinder volume 부팅 옵션" hint="사용자화 가상머신 신청 화면에서 root disk를 Cinder volume으로 생성하는 옵션을 노출할지 설정합니다.">
            <select
              value={props.platformStatus?.selfServiceVmVolumeBootEnabled ? "enabled" : "disabled"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                selfServiceVmVolumeBootEnabled: event.target.value === "enabled",
              }))}
            >
              <option value="disabled">비활성화</option>
              <option value="enabled">활성화</option>
            </select>
          </AdminField>
          <AdminField label="디스크 압력 시 Cinder 자동 전환" hint="Compute 호스트 디스크 사용률이 임계값 이상이면 일반 랩과 사용자화 VM을 Cinder boot volume 기반으로 생성합니다.">
            <select
              value={props.platformStatus?.labAutoBootFromVolumeOnDiskPressureEnabled === false ? "disabled" : "enabled"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                labAutoBootFromVolumeOnDiskPressureEnabled: event.target.value === "enabled",
              }))}
            >
              <option value="enabled">자동 전환 사용</option>
              <option value="disabled">사용 안 함</option>
            </select>
          </AdminField>
          <AdminField label="호스트 디스크 임계값(%)" hint="Nova hypervisor local disk 사용률이 이 값 이상인 호스트가 있으면 Cinder volume 부팅으로 전환합니다.">
            <input
              min="1"
              max="99"
              type="number"
              value={props.platformStatus?.labAutoBootFromVolumeDiskThresholdPercent || 80}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                labAutoBootFromVolumeDiskThresholdPercent: Math.max(1, Math.min(99, Number(event.target.value || 80) || 80)),
              }))}
            />
          </AdminField>
          <AdminField label="자동 Boot volume 크기(GB)" hint="Heat 템플릿이나 요청 값에 boot volume 크기가 없을 때 사용하는 기본 크기입니다.">
            <input
              min="1"
              max="2048"
              type="number"
              value={props.platformStatus?.labAutoBootVolumeSizeGb || 20}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                labAutoBootVolumeSizeGb: Math.max(1, Math.min(2048, Number(event.target.value || 20) || 20)),
              }))}
            />
          </AdminField>
          <AdminField label="Cinder volume type / backend" hint="특정 Cinder backend를 쓰려면 해당 backend로 매핑된 volume type을 입력합니다. 비워두면 기본 Cinder type을 사용합니다.">
            <input
              value={props.platformStatus?.labAutoBootVolumeType || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                labAutoBootVolumeType: event.target.value,
              }))}
              placeholder="예: ceph-ssd, fast-volume"
            />
          </AdminField>
          <AdminField label="추가 데이터 볼륨 요청" hint="사용자가 OS 디스크 외 데이터 볼륨을 함께 요청할 수 있게 할지 설정합니다.">
            <select
              value={props.platformStatus?.selfServiceVmDataVolumeEnabled ? "enabled" : "disabled"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                selfServiceVmDataVolumeEnabled: event.target.value === "enabled",
              }))}
            >
              <option value="disabled">비활성화</option>
              <option value="enabled">활성화</option>
            </select>
          </AdminField>
          <AdminField label="추가 볼륨 최대 개수">
            <input
              min="1"
              max="10"
              type="number"
              value={props.platformStatus?.selfServiceVmMaxDataVolumeCount || 2}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                selfServiceVmMaxDataVolumeCount: Math.max(1, Math.min(10, Number(event.target.value || 2) || 2)),
              }))}
            />
          </AdminField>
          <AdminField label="추가 볼륨 최대 크기(GB)">
            <input
              min="1"
              max="2048"
              type="number"
              value={props.platformStatus?.selfServiceVmMaxDataVolumeSizeGb || 100}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                selfServiceVmMaxDataVolumeSizeGb: Math.max(1, Math.min(2048, Number(event.target.value || 100) || 100)),
              }))}
            />
          </AdminField>
          <AdminField label="Floating IP 요청" hint="공개 접속 IP가 필요한 경우에만 사용합니다. 프로젝트 Quota와 외부 네트워크가 준비되어 있어야 합니다.">
            <select
              value={props.platformStatus?.selfServiceVmFloatingIpEnabled ? "enabled" : "disabled"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                selfServiceVmFloatingIpEnabled: event.target.value === "enabled",
              }))}
            >
              <option value="disabled">관리자 승인 없이는 비활성화</option>
              <option value="enabled">사용자 요청 허용</option>
            </select>
          </AdminField>
          <AdminField label="전용 프로젝트 자동 구성" hint="전용 OpenStack 프로젝트 요청 승인 시 Keystone 프로젝트 생성, 서비스 계정 역할 부여, 기본 Quota와 보안그룹을 자동 준비합니다.">
            <select
              value={props.platformStatus?.selfServiceVmProjectAutoConfigureEnabled ? "enabled" : "disabled"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                selfServiceVmProjectAutoConfigureEnabled: event.target.value === "enabled",
                selfServiceVmProjectAutoApproveEnabled: event.target.value === "enabled" ? current.selfServiceVmProjectAutoApproveEnabled : false,
              }))}
            >
              <option value="disabled">수동 준비 후 포털 연결</option>
              <option value="enabled">승인 시 OpenStack 자동 구성</option>
            </select>
          </AdminField>
          <AdminField label="전용 프로젝트 사용 승인" hint="자동 구성이 성공하면 관리자 검토 없이 프로젝트를 즉시 승인하고 사용자에게 VM 생성 권한을 부여합니다. 자동 구성 실패 시에는 검토 대기로 안전하게 보관됩니다.">
            <select
              disabled={!props.platformStatus?.selfServiceVmProjectAutoConfigureEnabled}
              value={props.platformStatus?.selfServiceVmProjectAutoApproveEnabled ? "auto" : "manual"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                selfServiceVmProjectAutoApproveEnabled: event.target.value === "auto",
              }))}
            >
              <option value="manual">관리자 승인 후 사용</option>
              <option value="auto">자동 구성 후 즉시 사용</option>
            </select>
          </AdminField>
          <div className="settings-panel admin-grid-span">
            <div className="settings-panel-head">
              <div>
                <strong>자동 구성 사전 점검</strong>
                <p className="hint">실제 프로젝트를 만들기 전에 clouds.yaml 인증, 역할, Quota API 접근 가능 여부를 확인합니다.</p>
              </div>
              <button className="mini-btn test-btn" onClick={props.onTestSelfServiceProjectAutomation} type="button">사전 점검</button>
            </div>
            {props.selfServiceProjectPreflightStatus?.message ? (
              <div className={`inline-message ${props.selfServiceProjectPreflightStatus.tone === "error" ? "is-error" : props.selfServiceProjectPreflightStatus.tone === "success" ? "is-success" : ""}`}>
                {props.selfServiceProjectPreflightStatus.message}
              </div>
            ) : null}
            {props.selfServiceProjectPreflightStatus?.result?.steps?.length ? (
              <div className="simple-status-list">
                {props.selfServiceProjectPreflightStatus.result.steps.map((step) => (
                  <div key={step.key}>{`${step.label || step.key}: ${step.status === "success" ? "완료" : step.status === "warning" ? "주의" : "실패"}${step.detail ? ` · ${step.detail}` : ""}`}</div>
                ))}
              </div>
            ) : null}
          </div>
          <AdminField label="자동 부여 역할" hint="clouds.yaml의 서비스 계정에 새 프로젝트에서 부여할 Keystone 역할입니다. 쉼표로 구분합니다.">
            <input
              value={(props.platformStatus?.selfServiceVmProjectRoleNames || []).join(", ")}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                selfServiceVmProjectRoleNames: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
              }))}
              placeholder="예: member, heat_stack_owner"
            />
          </AdminField>
          <AdminField label="전용 프로젝트 네트워크 자동 생성" hint="끄면 기존 공유 네트워크(net-infra 등)를 사용하는 정책입니다. 켜면 프로젝트별 {프로젝트명}-net private network/subnet/router를 준비합니다.">
            <select
              value={props.platformStatus?.selfServiceVmProjectAutoNetworkEnabled ? "enabled" : "disabled"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                selfServiceVmProjectAutoNetworkEnabled: event.target.value === "enabled",
              }))}
            >
              <option value="disabled">네트워크는 수동/공유망 사용</option>
              <option value="enabled">승인 시 네트워크도 생성</option>
            </select>
          </AdminField>
          <AdminField label="외부 네트워크 이름" hint="네트워크 자동 생성 시 라우터 게이트웨이로 연결할 외부 네트워크입니다. 비워두면 라우터 외부 연결은 생략됩니다.">
            <input
              value={props.platformStatus?.selfServiceVmProjectExternalNetworkName || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                selfServiceVmProjectExternalNetworkName: event.target.value,
              }))}
              placeholder="예: net-external"
            />
          </AdminField>
          <div className="settings-panel admin-grid-span">
            <div className="settings-panel-head">
              <div>
                <strong>전용 프로젝트 기본 Quota</strong>
                <p className="hint">기본형에 적용할 한도입니다. 표준형은 컴퓨트·스토리지 2배, 고성능형은 4배로 계산되며 네트워크·보안 한도는 동일하게 유지됩니다. 0은 해당 항목을 0으로 제한합니다.</p>
              </div>
            </div>
            <div className="admin-form-grid compact-admin-grid">
              {[
                ["instances", "VM 개수"],
                ["cores", "vCPU"],
                ["ram", "RAM(MB)"],
                ["volumes", "Volume 개수"],
                ["gigabytes", "Volume GB"],
                ["snapshots", "Snapshot"],
                ["network", "Network"],
                ["subnet", "Subnet"],
                ["router", "Router"],
                ["port", "Port"],
                ["floatingip", "Floating IP"],
                ["security_group", "Security Group"],
                ["security_group_rule", "Security Rule"],
              ].map(([key, label]) => (
                <AdminField key={key} label={label}>
                  <input
                    min="0"
                    type="number"
                    value={selfServiceProjectQuota[key] ?? ""}
                    onChange={(event) => updateSelfServiceProjectQuota(key, event.target.value)}
                  />
                </AdminField>
              ))}
            </div>
          </div>
          <AdminField label="견적형 VM 허용 이미지" hint="레거시 견적·결제형 VM 신청에서 사용하는 이미지 목록입니다. 실제 클라우드 콘솔 인스턴스 목록과는 별도이며 쉼표로 구분합니다.">
            <AdminCsvInput
              values={props.platformStatus?.pocAllowedImages}
              onChange={(values) => props.setPlatformStatus((current) => ({ ...current, pocAllowedImages: values }))}
              placeholder="예: lab-rocky-9-2026, ubuntu-24.04"
            />
          </AdminField>
          <AdminField label="견적형 VM 허용 Flavor" hint="레거시 견적·결제형 VM 신청에서 사용하는 Flavor 목록입니다. 실제 클라우드 콘솔의 허용 Flavor와는 별도이며 쉼표로 구분합니다.">
            <AdminCsvInput
              values={props.platformStatus?.pocAllowedFlavors}
              onChange={(values) => props.setPlatformStatus((current) => ({ ...current, pocAllowedFlavors: values }))}
              placeholder="예: m1.tiny, m1.small, m1.medium"
            />
          </AdminField>
          <AdminField label="클라우드 콘솔 무료 모드" hint="활성화되어 있는 동안 모든 사용자의 클라우드 콘솔 견적을 0원으로 처리합니다.">
            <select
              value={props.platformStatus?.pocFreeModeEnabled ? "enabled" : "disabled"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                pocFreeModeEnabled: event.target.value === "enabled",
              }))}
            >
              <option value="disabled">유료 견적 사용</option>
              <option value="enabled">전체 무료 처리</option>
            </select>
          </AdminField>
          <div className="settings-panel compact-stack">
            <div className="settings-panel-head">
              <div>
                <strong>클라우드 콘솔 Flavor 단가/사양</strong>
                <p className="hint">허용 Flavor 목록에 있는 항목별 1일 단가와 표시 사양을 관리합니다. 단가는 원화(KRW), 원 단위로 표시됩니다.</p>
              </div>
            </div>
            {(props.platformStatus?.pocAllowedFlavors?.length ? props.platformStatus.pocAllowedFlavors : ["m1.tiny", "m1.small", "m1.medium"]).map((flavor) => {
              const spec = props.platformStatus?.pocFlavorSpecs?.[flavor] || {};
              const price = props.platformStatus?.pocFlavorDailyPrices?.[flavor] || "";
              const updatePrice = (value) => props.setPlatformStatus((current) => ({
                ...current,
                pocFlavorDailyPrices: {
                  ...(current?.pocFlavorDailyPrices || {}),
                  [flavor]: Math.max(0, Number(value || 0) || 0),
                },
              }));
              const updateSpec = (field, value) => props.setPlatformStatus((current) => ({
                ...current,
                pocFlavorSpecs: {
                  ...(current?.pocFlavorSpecs || {}),
                  [flavor]: {
                    ...(current?.pocFlavorSpecs?.[flavor] || {}),
                    [field]: Math.max(1, Number(value || 1) || 1),
                  },
                },
              }));
              return (
                <div className="admin-form-grid compact-admin-grid" key={`poc-flavor-${flavor}`}>
                  <AdminField label={`${flavor} 1일 단가(원화, 원)`}>
                    <div className="admin-currency-input">
                      <input min="0" step="100" type="number" value={price} onChange={(event) => updatePrice(event.target.value)} placeholder="예: 9900" />
                      <span>원</span>
                    </div>
                    <div className="hint">{`${formatCurrency(price)} (원화)`}</div>
                  </AdminField>
                  <AdminField label="vCPU">
                    <input min="1" step="1" type="number" value={spec.vcpu || ""} onChange={(event) => updateSpec("vcpu", event.target.value)} placeholder="2" />
                  </AdminField>
                  <AdminField label="RAM(GB)">
                    <input min="1" step="1" type="number" value={spec.ramGb || ""} onChange={(event) => updateSpec("ramGb", event.target.value)} placeholder="4" />
                  </AdminField>
                  <AdminField label="Disk(GB)">
                    <input min="1" step="1" type="number" value={spec.diskGb || ""} onChange={(event) => updateSpec("diskGb", event.target.value)} placeholder="50" />
                  </AdminField>
                </div>
              );
            })}
          </div>
          <AdminTerminalCloudPricingPreview
            platformStatus={props.platformStatus}
            setPlatformStatus={props.setPlatformStatus}
          />
          <AdminField label="Zun API URL" hint="OpenStack Zun Container API 엔드포인트입니다. 예: http://192.0.2.20:9517/v1">
            <input
              value={props.platformStatus?.zunApiUrl || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, zunApiUrl: event.target.value }))}
              placeholder="http://192.0.2.20:9517/v1"
            />
          </AdminField>
          <AdminField label="내부 이미지 서버 설정" hint="검색은 내부망 레지스트리 URL로 수행하고, 사용자에게 안내할 pull 주소는 표시 Host로 분리해서 관리합니다.">
            <div className="admin-form-grid compact-admin-grid">
              <AdminField label="검색 URL">
                <input
                  value={props.platformStatus?.containerRegistrySearchUrl || ""}
                  onChange={(event) => props.setPlatformStatus((current) => ({ ...current, containerRegistrySearchUrl: event.target.value }))}
                  placeholder="예: https://192.0.2.230"
                />
              </AdminField>
              <AdminField label="표시/Pull Host">
                <input
                  value={props.platformStatus?.containerRegistryPublicHost || ""}
                  onChange={(event) => props.setPlatformStatus((current) => ({ ...current, containerRegistryPublicHost: event.target.value }))}
                  placeholder="registry.example.com"
                />
              </AdminField>
              <AdminField label="기본 namespace">
                <input
                  value={props.platformStatus?.containerRegistryDefaultNamespace || ""}
                  onChange={(event) => props.setPlatformStatus((current) => ({ ...current, containerRegistryDefaultNamespace: event.target.value }))}
                  placeholder="library"
                />
              </AdminField>
              <AdminField label="검색 개수 제한">
                <input
                  min="1"
                  max="100"
                  step="1"
                  type="number"
                  value={props.platformStatus?.containerRegistrySearchLimit || ""}
                  onChange={(event) => props.setPlatformStatus((current) => ({ ...current, containerRegistrySearchLimit: event.target.value }))}
                  placeholder="30"
                />
              </AdminField>
              <AdminField label="검색 Timeout(ms)">
                <input
                  min="1000"
                  step="500"
                  type="number"
                  value={props.platformStatus?.containerRegistrySearchTimeoutMs || ""}
                  onChange={(event) => props.setPlatformStatus((current) => ({ ...current, containerRegistrySearchTimeoutMs: event.target.value }))}
                  placeholder="4000"
                />
              </AdminField>
              <AdminField label="다운로드 명령" hint="보안을 위해 서버 환경변수에서만 변경할 수 있습니다.">
                <input
                  disabled
                  readOnly
                  value={props.platformStatus?.containerRegistryImageDownloadCommand || ""}
                  placeholder="서버에 설정되지 않음"
                />
              </AdminField>
              <AdminField label="미러링 명령" hint="보안을 위해 서버 환경변수에서만 변경할 수 있습니다.">
                <input
                  disabled
                  readOnly
                  value={props.platformStatus?.containerRegistryImageMirrorCommand || ""}
                  placeholder="서버에 설정되지 않음"
                />
              </AdminField>
              <AdminField label="다운로드 Timeout(ms)">
                <input
                  min="1000"
                  step="1000"
                  type="number"
                  value={props.platformStatus?.containerRegistryImageDownloadTimeoutMs || ""}
                  onChange={(event) => props.setPlatformStatus((current) => ({ ...current, containerRegistryImageDownloadTimeoutMs: event.target.value }))}
                  placeholder="600000"
                />
              </AdminField>
            </div>
          </AdminField>
          <AdminField label="컨테이너 랩 허용 이미지" hint="사용자가 컨테이너 랩에서 선택할 수 있는 이미지 목록입니다. 비워두면 컨테이너 생성은 비활성 상태로 안내됩니다.">
            <input
              value={(props.platformStatus?.zunAllowedImages || []).join(", ")}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                zunAllowedImages: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
              }))}
              placeholder="예: docker.io/library/rockylinux:9, docker.io/library/ubuntu:24.04"
            />
            <div className="admin-registry-search">
              <label>
                <span>내부 레지스트리 검색</span>
                <input
                  placeholder="예: ubuntu, nginx, redis"
                  value={zunImageSearch.query}
                  onChange={(event) => setZunImageSearch((current) => ({ ...current, query: event.target.value }))}
                />
              </label>
              <button className="mini-btn" disabled={zunImageSearch.loading} onClick={runZunImageSearch} type="button">
                {zunImageSearch.loading ? "검색 중" : "이미지 검색"}
              </button>
              {zunImageSearch.message ? <small>{zunImageSearch.message}</small> : null}
              {zunImageSearch.results.length ? (
                <div className="admin-registry-results">
                  {zunImageSearch.results.map((image) => {
                    const alreadyAdded = (props.platformStatus?.zunAllowedImages || []).some((item) => String(item || "").trim().toLowerCase() === image.name.toLowerCase());
                    const isDownloading = zunImageSearch.downloadingImage === image.name;
                    return (
                      <div className="admin-registry-result-row" key={image.name}>
                        <button disabled={alreadyAdded} onClick={() => addZunAllowedImage(image.name)} type="button">
                          <strong>{image.name}</strong>
                          <span>{alreadyAdded ? "이미 추가됨" : "허용 이미지에 추가"}</span>
                        </button>
                        <button className="mini-btn" disabled={isDownloading} onClick={() => runZunImageDownload(image.name)} type="button">
                          {isDownloading ? "다운로드 중" : "다운로드 요청"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </AdminField>
          <AdminField label="Zun GPU 컨테이너" hint="Compute 노드의 NVIDIA Container Runtime과 Zun GPU 스케줄링이 준비된 경우에만 활성화합니다.">
            <label className="admin-check-row">
              <input
                checked={Boolean(props.platformStatus?.zunGpuEnabled)}
                onChange={(event) => props.setPlatformStatus((current) => ({ ...current, zunGpuEnabled: event.target.checked }))}
                type="checkbox"
              />
              <span>GPU 프리빌드 이미지 실행 허용</span>
            </label>
            <div className="admin-form-grid compact-admin-grid">
              <label><span>Runtime</span><input disabled={!props.platformStatus?.zunGpuEnabled} value={props.platformStatus?.zunGpuRuntime || "nvidia"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, zunGpuRuntime: event.target.value }))} placeholder="nvidia" /></label>
              <label><span>Scheduler hint</span><input disabled={!props.platformStatus?.zunGpuEnabled} value={props.platformStatus?.zunGpuHint || "type=gpu"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, zunGpuHint: event.target.value }))} placeholder="type=gpu" /></label>
            </div>
          </AdminField>
          <AdminField label="CAPO management endpoint / clusterctl 실행 경로" hint="management cluster 워커가 사용할 endpoint, kubeconfig 경로, 또는 clusterctl 실행 경로입니다.">
            <input
              value={props.platformStatus?.magnumApiUrl || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, magnumApiUrl: event.target.value }))}
              placeholder="http://192.0.2.20:9511/v1"
            />
          </AdminField>
          <AdminField label="CAPO 프로파일" hint="JSON 배열로 관리합니다. 저장 시 ID, Kubernetes 버전/이미지, Flavor, 로드밸런서 포트를 검증합니다.">
            <textarea
              rows={18}
              value={props.platformStatus?.magnumClusterProfilesJson
                ?? JSON.stringify(props.platformStatus?.magnumClusterProfiles || [], null, 2)}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                magnumClusterProfilesJson: event.target.value,
              }))}
              placeholder={'[{"id":"rocky-9-k8s","name":"Rocky 9 Kubernetes 1.30-1.33","kubernetesVersions":{"1.33":{"version":"v1.33.13","image":"rocky-k8s-1.33"}},"controlPlaneFlavor":"m1.medium","workerFlavor":"m1.small","apiServerLoadBalancer":{"enabled":true,"minControlPlaneCount":3}}]'}
            />
            <small>기본적으로 Control plane 3대 이상일 때만 API 서버 로드밸런서를 생성합니다. apiServerLoadBalancer에서 minControlPlaneCount, provider, flavor, availabilityZone, additionalPorts, allowedCIDRs, monitor를 설정합니다.</small>
          </AdminField>
          <AdminField label="CAPO 클러스터 승인 정책" hint="자동 승인은 아래 허용 프로파일과 노드/사용자 한도, Quota 안전 검사를 모두 통과한 요청에만 적용됩니다.">
            <select
              value={props.platformStatus?.magnumAutoApproveEnabled ? "auto" : "manual"}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, magnumAutoApproveEnabled: event.target.value === "auto" }))}
            >
              <option value="manual">관리자 수동 승인</option>
              <option value="auto">정책 기반 자동 승인</option>
            </select>
          </AdminField>
          <AdminField label="CAPO 자동 승인 허용 프로파일 ID" hint="쉼표로 구분합니다. 비어 있으면 모든 요청을 수동 승인 대기로 유지합니다.">
            <input
              value={(props.platformStatus?.magnumAutoApproveProfileIds || []).join(", ")}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, magnumAutoApproveProfileIds: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))}
              placeholder="예: rocky-9-k8s-1.31, ubuntu-24-k8s-1.31"
            />
          </AdminField>
          <AdminField label="CAPO 자동 승인 노드 한도" hint="요청 한 건의 최대 control plane 및 worker 노드 수입니다.">
            <div className="admin-inline-fields">
              <label><span>Control plane</span><input min="1" max="9" type="number" value={props.platformStatus?.magnumAutoApproveMaxMasterCount || 1} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, magnumAutoApproveMaxMasterCount: Number(event.target.value || 1) }))} /></label>
              <label><span>Worker</span><input min="1" max="100" type="number" value={props.platformStatus?.magnumAutoApproveMaxNodeCount || 3} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, magnumAutoApproveMaxNodeCount: Number(event.target.value || 1) }))} /></label>
            </div>
          </AdminField>
          <AdminField label="사용자별 자동 승인 클러스터 한도" hint="삭제·반려·실패 상태를 제외한 기존 클러스터와 승인 대기 요청을 합산합니다.">
            <input min="1" max="20" type="number" value={props.platformStatus?.magnumAutoApproveMaxClustersPerUser || 1} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, magnumAutoApproveMaxClustersPerUser: Number(event.target.value || 1) }))} />
          </AdminField>
          <AdminField label="CAPO 자동 승인 Quota 검사" hint="권장: 조회 실패 또는 자원 안전 차단 상태이면 자동 승인하지 않고 관리자 승인 대기로 유지합니다.">
            <select value={props.platformStatus?.magnumAutoApproveRequireQuota === false ? "off" : "on"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, magnumAutoApproveRequireQuota: event.target.value !== "off" }))}>
              <option value="on">필수 (안전 차단)</option>
              <option value="off">사용 안 함</option>
            </select>
          </AdminField>
          <AdminField label="Trove API URL" hint="OpenStack Trove Database API 엔드포인트입니다. {project_id}, {tenant_id}, $(tenant_id)s placeholder를 사용할 수 있고, /v1.0으로 끝나면 Keystone project id를 자동으로 붙입니다.">
            <input
              value={props.platformStatus?.troveApiUrl || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, troveApiUrl: event.target.value }))}
              placeholder="http://192.0.2.20:8779/v1.0/{project_id}"
            />
          </AdminField>
          <AdminField label="Trove 허용 Datastore" hint="사용자가 선택할 수 있는 datastore 목록입니다. 쉼표로 구분합니다.">
            <input
              value={(props.platformStatus?.troveAllowedDatastores || []).join(", ")}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, troveAllowedDatastores: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))}
              placeholder="mysql, postgresql, mariadb"
            />
          </AdminField>
          <AdminField label="Trove 허용 Flavor" hint="사용자가 선택할 수 있는 DB flavor 목록입니다. 쉼표로 구분합니다.">
            <input
              value={(props.platformStatus?.troveAllowedFlavors || []).join(", ")}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, troveAllowedFlavors: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))}
              placeholder="m1.small, m1.medium"
            />
          </AdminField>
          <AdminField label="Trove 허용 볼륨(GB)" hint="사용자가 선택할 수 있는 DB 볼륨 크기입니다. 쉼표로 구분합니다.">
            <input
              value={(props.platformStatus?.troveAllowedSizesGb || []).join(", ")}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, troveAllowedSizesGb: event.target.value.split(",").map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0) }))}
              placeholder="5, 10, 20"
            />
          </AdminField>
          <AdminField label="사이트 관리자명" hint="푸터와 로그인 화면 하단에 표시할 운영 담당자 이름입니다.">
            <input
              value={props.platformStatus?.footerAdminName || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, footerAdminName: event.target.value }))}
              placeholder="예: 관리자"
            />
          </AdminField>
          <AdminField label="사이트 문의 이메일" hint="푸터와 사이드바 문의 링크에 사용할 대표 이메일 주소입니다.">
            <input
              value={props.platformStatus?.footerEmail || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, footerEmail: event.target.value }))}
              placeholder="예: contact@example.com"
            />
          </AdminField>
          <AdminField label="사업자 정보" hint="사업자번호 또는 안내 문구를 자유롭게 입력합니다. 푸터에 그대로 표시됩니다.">
            <input
              value={props.platformStatus?.footerBusinessInfo || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, footerBusinessInfo: event.target.value }))}
              placeholder="예: 123-45-67890"
            />
          </AdminField>
          <AdminField label="랜딩 영상 유형" hint="랜딩 첫 화면의 데모 영상을 YouTube 또는 업로드 파일 중 어떤 방식으로 보여줄지 선택합니다.">
            <select
              value={props.platformStatus?.landingDemoType || "youtube"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                landingDemoType: event.target.value === "upload" ? "upload" : "youtube",
              }))}
            >
              <option value="youtube">YouTube</option>
              <option value="upload">업로드 파일</option>
            </select>
          </AdminField>
          <AdminField label="랜딩 영상 표시" hint="필요할 때 랜딩 페이지의 데모 영상을 숨길 수 있습니다. 숨겨도 업로드 파일과 URL 설정값은 유지됩니다.">
            <select
              value={props.platformStatus?.landingVideoEnabled === false ? "hidden" : "visible"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                landingVideoEnabled: event.target.value !== "hidden",
              }))}
            >
              <option value="visible">표시</option>
              <option value="hidden">숨김</option>
            </select>
          </AdminField>
          <AdminField label="랜딩 설문 안내" hint="랜딩 페이지의 설문 참여 안내 박스를 필요할 때만 표시합니다. 기본값은 숨김입니다.">
            <select
              value={props.platformStatus?.landingSurveyNoticeEnabled === true ? "visible" : "hidden"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                landingSurveyNoticeEnabled: event.target.value === "visible",
              }))}
            >
              <option value="hidden">숨김</option>
              <option value="visible">표시</option>
            </select>
          </AdminField>
          <AdminField label="랜딩 달력 표시" hint="랜딩 히어로에 공개 강의 일정 달력을 표시할지 선택합니다. 숨기면 일정 API도 호출하지 않습니다.">
            <select
              value={props.platformStatus?.landingScheduleEnabled === false ? "hidden" : "visible"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                landingScheduleEnabled: event.target.value !== "hidden",
              }))}
            >
              <option value="visible">표시</option>
              <option value="hidden">숨김</option>
            </select>
          </AdminField>
          <AdminField label="Google Calendar 자동 동기화" hint="공개 iCal 주소에서 강의 일정을 주기적으로 가져옵니다. 가져온 일정은 이후 상세 내용을 직접 보강할 수 있습니다.">
            <select
              value={props.platformStatus?.googleCalendarSyncEnabled ? "enabled" : "disabled"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                googleCalendarSyncEnabled: event.target.value === "enabled",
              }))}
            >
              <option value="disabled">사용 안 함</option>
              <option value="enabled">사용</option>
            </select>
          </AdminField>
          <AdminField label="Google Calendar iCal URL" hint="Google Calendar 설정의 공개 iCal 주소 또는 비공개 iCal 주소를 입력합니다.">
            <input
              value={props.platformStatus?.googleCalendarIcsUrl || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                googleCalendarIcsUrl: event.target.value,
              }))}
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
            />
          </AdminField>
          <AdminField label="Google Calendar 동기화 주기 (분)" hint="자동 동기화 주기입니다. 최소값은 15분입니다.">
            <input
              min="15"
              step="15"
              type="number"
              value={props.platformStatus?.googleCalendarSyncIntervalMinutes || 60}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                googleCalendarSyncIntervalMinutes: Math.max(15, Number(event.target.value || 15) || 15),
              }))}
              placeholder="예: 60"
            />
          </AdminField>
          <AdminField label="랜딩 공지사항 표시" hint="랜딩 로그인 영역의 공지사항 패널을 표시할지 선택합니다. 기본값은 숨김입니다.">
            <select
              value={props.platformStatus?.landingNoticeEnabled === true ? "visible" : "hidden"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                landingNoticeEnabled: event.target.value === "visible",
              }))}
            >
              <option value="hidden">숨김</option>
              <option value="visible">표시</option>
            </select>
          </AdminField>
          <AdminField label="랜딩 커리큘럼 기본 상태" hint="미리 보는 커리큘럼 섹션을 처음에 접힌 아코디언으로 둘지, 펼친 상태로 둘지 선택합니다.">
            <select
              value={props.platformStatus?.landingCurriculumCollapsedByDefault !== false ? "collapsed" : "expanded"}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                landingCurriculumCollapsedByDefault: event.target.value !== "expanded",
              }))}
            >
              <option value="collapsed">기본 접힘</option>
              <option value="expanded">기본 펼침</option>
            </select>
          </AdminField>
          <AdminField label="랜딩 YouTube URL" hint="YouTube 선택 시 랜딩 데모 영역에 표시할 영상 URL입니다. youtu.be, youtube.com 링크 모두 지원합니다.">
            <input
              value={props.platformStatus?.landingYoutubeUrl || ""}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, landingYoutubeUrl: event.target.value }))}
              placeholder="https://youtu.be/..."
            />
          </AdminField>
          <AdminField label="OTP 관리자 필수" hint="관리자 계정에서 OTP를 우선 운영할지 결정합니다. 이미 등록한 관리자 계정은 로그인 시 OTP를 함께 요구합니다.">
            <select value={props.platformStatus?.otpAdminRequired ? "enabled" : "disabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, otpAdminRequired: event.target.value === "enabled" }))}>
              <option value="disabled">선택</option>
              <option value="enabled">사용</option>
            </select>
          </AdminField>
          <AdminField label="OTP 일반 사용자 허용" hint="추후 일반 사용자도 내 계정에서 OTP를 설정할 수 있도록 허용합니다.">
            <select value={props.platformStatus?.otpUserEnabled ? "enabled" : "disabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, otpUserEnabled: event.target.value === "enabled" }))}>
              <option value="disabled">사용 안 함</option>
              <option value="enabled">사용</option>
            </select>
          </AdminField>
          <AdminField label="OTP 발급자 이름" hint="인증 앱에 표시될 OTP 발급자 이름입니다.">
            <input value={props.platformStatus?.otpIssuerName || "KIKI OS TERMINAL-LAB"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, otpIssuerName: event.target.value }))} placeholder="KIKI OS TERMINAL-LAB" />
          </AdminField>
          <AdminField label="교안 업로드 상한 (MB)" hint="PDF, PPT, DOC 교안과 MP4/WEBM 영상 업로드 시 허용할 최대 파일 크기입니다. base64 전송 오버헤드를 고려해 80MB 이상을 권장합니다.">
            <input
              value={props.platformStatus?.materialsUploadMaxMb || 80}
              onChange={(event) => props.setPlatformStatus((current) => ({ ...current, materialsUploadMaxMb: event.target.value }))}
              placeholder="예: 80"
            />
          </AdminField>
          <AdminField label="과정 난이도 목록" hint="과정 관리에서 선택할 난이도 드롭다운 값입니다. 쉼표로 구분합니다.">
            <input
              value={(props.platformStatus?.courseLevelOptions || []).join(", ")}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                courseLevelOptions: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
              }))}
              placeholder="예: 입문, 초급, 중급, 고급"
            />
          </AdminField>
          <AdminField label="과정 카테고리 목록" hint="과정 관리에서 추천할 카테고리 목록입니다. 쉼표로 구분합니다. 기존 카테고리는 직접 입력으로도 유지할 수 있습니다.">
            <input
              value={(props.platformStatus?.courseCategoryOptions || []).join(", ")}
              onChange={(event) => props.setPlatformStatus((current) => ({
                ...current,
                courseCategoryOptions: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
              }))}
              placeholder="예: linux, k8s, openstack, ai"
            />
          </AdminField>
        </div>
        </AdminDisclosureCard>
        <AdminDisclosureCard
          title="터미널 / 콘솔"
          subtitle="랩실 콘솔, xterm 세션, 파일 업로드, 외부 SSH/RDP, 공개 URL/TCP 설정을 한곳에서 관리합니다."
          summary={`${props.platformStatus?.terminalFileUploadEnabled ? "파일 업로드 표시" : "파일 업로드 숨김"} / SSH ${props.platformStatus?.externalSshRoutesEnabled !== false ? "허용" : "차단"} / URL ${props.platformStatus?.publicDomainRoutesEnabled !== false ? "허용" : "차단"}`}
        >
          <div className="settings-panel">
            <div className="admin-form-grid compact-admin-grid">
              <AdminField label="랩 시작 디버그 모드" hint="활성화하면 랩 시작 요청 시 요청 labId, courseId, fallback 후보 목록을 서버 로그에 남깁니다. 문제 재현 중에만 잠시 켜두는 것을 권장합니다.">
                <select value={props.platformStatus?.labStartDebugEnabled ? "enabled" : "disabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, labStartDebugEnabled: event.target.value === "enabled" }))}>
                  <option value="disabled">사용 안 함</option>
                  <option value="enabled">사용</option>
                </select>
              </AdminField>
              <AdminField label="동시 랩 실행 수" hint="사용자당 동시에 유지할 수 있는 랩 수입니다. 기본값은 1이며, 최대 5개까지 허용할 수 있습니다.">
                <select value={String(props.platformStatus?.maxConcurrentLabs || 1)} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, maxConcurrentLabs: Math.min(5, Math.max(1, Number(event.target.value || 1) || 1)) }))}>
                  <option value="1">1개</option>
                  <option value="2">2개</option>
                  <option value="3">3개</option>
                  <option value="4">4개</option>
                  <option value="5">5개</option>
                </select>
              </AdminField>
              <AdminField label="xterm 세션 대기 시간 (분)" hint="브라우저 터미널에 입력이나 크기 변경이 없으면 실제 연결을 종료할 대기 시간입니다.">
                <input
                  min="1"
                  type="number"
                  value={props.platformStatus?.terminalSessionIdleMinutes || props.platformStatus?.terminalSessionTtlMinutes || 10}
                  onChange={(event) => props.setPlatformStatus((current) => ({
                    ...current,
                    terminalSessionIdleMinutes: Math.max(1, Number(event.target.value || 1) || 1),
                  }))}
                  placeholder="예: 30"
                />
              </AdminField>
              <AdminField label="세션 리플레이 저장" hint="브라우저 터미널 출력 기록을 DB에 저장할지 정합니다. 과정별 설정이 `전역값 따름`이면 이 값이 적용됩니다.">
                <select
                  value={props.platformStatus?.terminalReplayEnabled === false ? "disabled" : "enabled"}
                  onChange={(event) => props.setPlatformStatus((current) => ({
                    ...current,
                    terminalReplayEnabled: event.target.value === "enabled",
                  }))}
                >
                  <option value="enabled">사용</option>
                  <option value="disabled">미사용</option>
                </select>
              </AdminField>
              <AdminField label="가상머신 파일 업로드" hint="기본값은 숨김입니다. 켜면 랩실 콘솔 아래에 현재 VM으로 파일을 전송하는 업로드 UI가 표시됩니다.">
                <select
                  value={props.platformStatus?.terminalFileUploadEnabled === true ? "enabled" : "disabled"}
                  onChange={(event) => props.setPlatformStatus((current) => ({
                    ...current,
                    terminalFileUploadEnabled: event.target.value === "enabled",
                  }))}
                >
                  <option value="disabled">숨김</option>
                  <option value="enabled">표시</option>
                </select>
              </AdminField>
              <AdminField label="미사용 VM 자동 중지" hint="VM 랩이 마지막 사용 후 지정 시간 이상 지나면 삭제하지 않고 먼저 OpenStack 서버를 중지합니다.">
                <select
                  value={props.platformStatus?.unusedVmAutoPauseEnabled === false ? "disabled" : "enabled"}
                  onChange={(event) => props.setPlatformStatus((current) => ({
                    ...current,
                    unusedVmAutoPauseEnabled: event.target.value === "enabled",
                  }))}
                >
                  <option value="enabled">사용</option>
                  <option value="disabled">사용 안 함</option>
                </select>
              </AdminField>
              <AdminField label="미사용 VM 자동 중지 시간 (분)" hint="VM 랩이 마지막 사용 후 이 시간 이상 지나면 자동 중지합니다. 최소값은 1440분이며 기본값은 하루입니다.">
                <input
                  min="1440"
                  step="60"
                  type="number"
                  value={props.platformStatus?.unusedVmAutoPauseMinutes || 1440}
                  onChange={(event) => props.setPlatformStatus((current) => ({
                    ...current,
                    unusedVmAutoPauseMinutes: Math.max(1440, Number(event.target.value || 1440) || 1440),
                  }))}
                  placeholder="예: 1440"
                />
              </AdminField>
              <AdminField label="미사용 VM 자동 제거 시간 (분)" hint="VM 랩이 마지막 사용 후 이 시간 이상 지나면 정리 주기에서 자동 종료합니다. 최소값은 1440분이며 기본값은 10080분입니다.">
                <input
                  min="1440"
                  step="60"
                  type="number"
                  value={props.platformStatus?.unusedVmRetentionMinutes || 10080}
                  onChange={(event) => props.setPlatformStatus((current) => ({
                    ...current,
                    unusedVmRetentionMinutes: Math.max(1440, Number(event.target.value || 1440) || 1440),
                  }))}
                  placeholder="예: 10080"
                />
              </AdminField>
              <AdminField label="공개 도메인 허용" hint="끄면 사용자는 새 공개 도메인 요청을 만들 수 없고, 관리자는 승인할 수 없습니다. 기존 해제는 가능합니다.">
                <select value={props.platformStatus?.publicDomainRoutesEnabled !== false ? "enabled" : "disabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, publicDomainRoutesEnabled: event.target.value === "enabled" }))}>
                  <option value="enabled">사용</option>
                  <option value="disabled">사용 안 함</option>
                </select>
              </AdminField>
              <AdminField label="공개 TCP 허용" hint="기본은 꺼짐입니다. 켜야만 사용자가 TCP 포트 요청을 만들고 관리자가 승인할 수 있습니다.">
                <select value={props.platformStatus?.publicTcpRoutesEnabled ? "enabled" : "disabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, publicTcpRoutesEnabled: event.target.value === "enabled" }))}>
                  <option value="disabled">사용 안 함</option>
                  <option value="enabled">사용</option>
                </select>
              </AdminField>
              <AdminField label="외부 SSH 허용" hint="끄면 사용자는 새 외부 SSH 요청을 만들 수 없고, 관리자는 승인할 수 없습니다. 기존 해제는 가능합니다.">
                <select value={props.platformStatus?.externalSshRoutesEnabled !== false ? "enabled" : "disabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, externalSshRoutesEnabled: event.target.value === "enabled" }))}>
                  <option value="enabled">사용</option>
                  <option value="disabled">사용 안 함</option>
                </select>
              </AdminField>
              <AdminField label="외부 RDP 허용" hint="끄면 사용자는 새 외부 RDP 요청을 만들 수 없고, 관리자는 승인할 수 없습니다. 기존 해제는 가능합니다.">
                <select value={props.platformStatus?.externalRdpRoutesEnabled !== false ? "enabled" : "disabled"} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, externalRdpRoutesEnabled: event.target.value === "enabled" }))}>
                  <option value="enabled">사용</option>
                  <option value="disabled">사용 안 함</option>
                </select>
              </AdminField>
              <AdminField label="외부 SSH 공개 호스트" hint="승인된 외부 SSH/RDP/TCP 접속 시 사용자에게 안내할 호스트명입니다. 예: ssh.example.com">
                <input
                  value={getNormalizedSshPublicHost(props.platformStatus?.sshPublicHost)}
                  onChange={(event) => props.setPlatformStatus((current) => ({ ...current, sshPublicHost: event.target.value }))}
                  placeholder="예: ssh.example.com"
                />
              </AdminField>
              <AdminField label="외부 SSH 포트 범위" hint={`외부 SSH 할당 포트 범위입니다. 서버 허용 범위 ${props.platformStatus?.sshExternalPortMin || 41000}-${props.platformStatus?.sshExternalPortMax || 42999} 안에서 41000-42999 형태로 입력합니다.`}>
                <input
                  value={`${props.platformStatus?.sshExternalPortStart || 41000}-${props.platformStatus?.sshExternalPortEnd || 42999}`}
                  onChange={(event) => {
                    const raw = String(event.target.value || "").trim();
                    const matched = raw.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
                    props.setPlatformStatus((current) => {
                      if (!matched) return { ...current, sshExternalPortRangeText: raw };
                      const start = matched[1];
                      const end = matched[2] || matched[1];
                      return { ...current, sshExternalPortStart: start, sshExternalPortEnd: end, sshExternalPortRangeText: `${start}-${end}` };
                    });
                  }}
                  placeholder="예: 41000-42999"
                />
              </AdminField>
              <AdminField label="외부 RDP 포트 범위" hint={`Windows 랩 GUI 접속에 할당할 외부 RDP 포트 범위입니다. 서버 허용 범위 ${props.platformStatus?.rdpExternalPortMin || 43000}-${props.platformStatus?.rdpExternalPortMax || 43099} 안에서 43000-43099 형태로 입력합니다.`}>
                <input
                  value={`${props.platformStatus?.rdpExternalPortStart || 43000}-${props.platformStatus?.rdpExternalPortEnd || 43099}`}
                  onChange={(event) => {
                    const raw = String(event.target.value || "").trim();
                    const matched = raw.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
                    props.setPlatformStatus((current) => {
                      if (!matched) return { ...current, rdpExternalPortRangeText: raw };
                      const start = matched[1];
                      const end = matched[2] || matched[1];
                      return { ...current, rdpExternalPortStart: start, rdpExternalPortEnd: end, rdpExternalPortRangeText: `${start}-${end}` };
                    });
                  }}
                  placeholder="예: 43000-43099"
                />
              </AdminField>
              <AdminField label="공개 TCP 포트 범위" hint={`임의 TCP 서비스 노출에 할당할 외부 포트 범위입니다. 서버 허용 범위 ${props.platformStatus?.tcpExternalPortMin || 45000}-${props.platformStatus?.tcpExternalPortMax || 45999} 안에서 45000-45999 형태로 입력합니다.`}>
                <input
                  value={`${props.platformStatus?.tcpExternalPortStart || 45000}-${props.platformStatus?.tcpExternalPortEnd || 45999}`}
                  onChange={(event) => {
                    const raw = String(event.target.value || "").trim();
                    const matched = raw.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
                    props.setPlatformStatus((current) => {
                      if (!matched) return { ...current, tcpExternalPortRangeText: raw };
                      const start = matched[1];
                      const end = matched[2] || matched[1];
                      return { ...current, tcpExternalPortStart: start, tcpExternalPortEnd: end, tcpExternalPortRangeText: `${start}-${end}` };
                    });
                  }}
                  placeholder="예: 45000-45999"
                />
              </AdminField>
            </div>
          </div>
        </AdminDisclosureCard>
        <AdminDisclosureCard
          title="과정 안내 문구"
          subtitle="사용자 과정 목록 상단에 표시되는 유형별 안내 문구와 태그를 관리합니다."
          summary={props.platformStatus?.standardCourseOverviewDescription || "일반 과정 안내 문구"}
        >
          <div className="admin-form-grid compact-admin-grid">
            {[
              { key: "standard", label: "일반 과정" },
              { key: "ilt", label: "ILT 과정" },
              { key: "online", label: "온라인 과정" },
              { key: "government", label: "정부 과정" },
            ].map((item) => {
              const descriptionKey = `${item.key}CourseOverviewDescription`;
              const pointsKey = `${item.key}CourseOverviewPoints`;
              return (
                <div className="settings-panel compact-stack" key={item.key}>
                  <AdminField label={`${item.label} 안내 문구`} hint="사용자 과정 목록 상단 카드에 표시됩니다.">
                    <textarea
                      rows={4}
                      value={props.platformStatus?.[descriptionKey] || ""}
                      onChange={(event) => props.setPlatformStatus((current) => ({ ...current, [descriptionKey]: event.target.value }))}
                    />
                  </AdminField>
                  <AdminField label={`${item.label} 태그`} hint="쉼표로 구분하며 최대 4개까지 표시됩니다.">
                    <input
                      value={(props.platformStatus?.[pointsKey] || []).join(", ")}
                      onChange={(event) => props.setPlatformStatus((current) => ({
                        ...current,
                        [pointsKey]: event.target.value.split(",").map((point) => point.trim()).filter(Boolean).slice(0, 4),
                      }))}
                      placeholder="예: 셀프 학습, 강사 비용 제외, ILT 별도 신청"
                    />
                  </AdminField>
                </div>
              );
            })}
          </div>
        </AdminDisclosureCard>
        <AdminDisclosureCard
          title="랜딩 문구"
          subtitle="로그인 전 랜딩 페이지의 핵심 문구를 관리합니다."
          summary={props.platformStatus?.landingHeroTitle || "랜딩 제목 없음"}
        >
          <div className="admin-form-grid compact-admin-grid">
            <AdminField label="랜딩 상단 라벨">
              <input value={props.platformStatus?.landingHeroEyebrow || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, landingHeroEyebrow: event.target.value }))} placeholder="오픈소스 엔지니어링 랩" />
            </AdminField>
            <AdminField label="랜딩 메인 제목">
              <input value={props.platformStatus?.landingHeroTitle || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, landingHeroTitle: event.target.value }))} placeholder="리눅스 인프라 엔지니어를 위한 오픈소스 실습 랩" />
            </AdminField>
            <AdminField label="랜딩 설명" hint="로그인 전 첫 화면의 대표 문구입니다.">
              <textarea rows={4} value={props.platformStatus?.landingHeroCopy || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, landingHeroCopy: event.target.value }))} />
            </AdminField>
            <AdminField label="접속 안내 라벨" hint="로그인/회원가입 카드 상단의 작은 라벨입니다.">
              <input value={props.platformStatus?.landingAuthEyebrow || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, landingAuthEyebrow: event.target.value }))} placeholder="접속 안내" />
            </AdminField>
            <AdminField label="접속 안내 제목">
              <input value={props.platformStatus?.landingAuthTitle || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, landingAuthTitle: event.target.value }))} placeholder="로그인 또는 회원가입" />
            </AdminField>
            <AdminField label="접속 안내 설명">
              <textarea rows={3} value={props.platformStatus?.landingAuthCopy || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, landingAuthCopy: event.target.value }))} placeholder="승인된 계정으로 실습 환경과 교육 자료에 바로 접근할 수 있습니다." />
            </AdminField>
            <AdminField label="무료 운영 문구 제목">
              <input value={props.platformStatus?.landingFreeTitle || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, landingFreeTitle: event.target.value }))} />
            </AdminField>
            <AdminField label="무료 운영 문구 설명">
              <input value={props.platformStatus?.landingFreeSubtitle || ""} onChange={(event) => props.setPlatformStatus((current) => ({ ...current, landingFreeSubtitle: event.target.value }))} />
            </AdminField>
          </div>
        </AdminDisclosureCard>
        <AdminDisclosureCard
          title="브랜드 자산"
          subtitle="랜딩 로고와 브라우저 favicon을 관리자에서 바로 교체합니다."
          summary={`${props.platformStatus?.landingLogoMode === "upload" ? "업로드 로고" : "코드 로고"} / ${props.platformStatus?.faviconPath || "기본 favicon"}`}
        >
          <div className="settings-panel">
            <div className="admin-form-grid compact-admin-grid">
              <AdminField label="랜딩/앱 로고" hint="PNG, SVG, JPG, WEBP 형식을 권장합니다. 사용자 랜딩과 앱 좌측 브랜드에 반영됩니다.">
                <div className="portal-actions">
                  <label className="card-label" htmlFor="landing-logo-mode">로고 표시 방식</label>
                  <select
                    id="landing-logo-mode"
                    value={props.platformStatus?.landingLogoMode === "upload" ? "upload" : "code"}
                    onChange={(event) => props.setPlatformStatus((current) => ({ ...current, landingLogoMode: event.target.value === "upload" ? "upload" : "code" }))}
                  >
                    <option value="code">기본 코드 로고</option>
                    <option value="upload">업로드 이미지 로고</option>
                  </select>
                </div>
                <div className="portal-actions">
                  <label className="ghost-btn file-upload-btn">
                    <input
                      accept="image/png,image/svg+xml,image/jpeg,image/webp,.png,.svg,.jpg,.jpeg,.webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) props.onUploadBrandAsset(file, "logo");
                        event.target.value = "";
                      }}
                      type="file"
                    />
                    {props.landingMediaUploadState?.uploading ? "업로드 중..." : "로고 업로드"}
                  </label>
                </div>
                <div className="simple-status-list compact-status-list">
                  <div>{`현재 표시 모드: ${props.platformStatus?.landingLogoMode === "upload" ? "업로드 이미지" : "기본 코드 로고"}`}</div>
                  <div>{`현재 로고 경로: ${props.platformStatus?.landingLogoPath || "/brand/kikios-dark-blue-app-icon-v7.png"}`}</div>
                  <div>{`현재 로고 형식: ${props.platformStatus?.landingLogoMime || "-"}`}</div>
                </div>
                <div className="landing-brand-preview">
                  {props.platformStatus?.landingLogoMode === "upload" && props.platformStatus?.landingLogoPath ? (
                    <img alt="로고 미리보기" className="landing-brand-preview-logo" src={props.platformStatus.landingLogoPath} />
                  ) : (
                    <TerminalLabLogo className="landing-brand-preview-logo is-code-logo" />
                  )}
                </div>
              </AdminField>
              <AdminField label="Favicon" hint="ICO, PNG, SVG 파일을 권장합니다. 브라우저 탭 아이콘으로 반영됩니다.">
                <div className="portal-actions">
                  <label className="card-label" htmlFor="favicon-mode">favicon 표시 방식</label>
                  <select
                    id="favicon-mode"
                    value={props.platformStatus?.faviconMode === "upload" ? "upload" : "code"}
                    onChange={(event) => props.setPlatformStatus((current) => ({ ...current, faviconMode: event.target.value === "upload" ? "upload" : "code" }))}
                  >
                    <option value="code">기본 코드 favicon</option>
                    <option value="upload">업로드 favicon</option>
                  </select>
                </div>
                <div className="portal-actions">
                  <label className="ghost-btn file-upload-btn">
                    <input
                      accept="image/x-icon,image/vnd.microsoft.icon,image/png,image/svg+xml,.ico,.png,.svg"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) props.onUploadBrandAsset(file, "favicon");
                        event.target.value = "";
                      }}
                      type="file"
                    />
                    {props.landingMediaUploadState?.uploading ? "업로드 중..." : "Favicon 업로드"}
                  </label>
                </div>
                <div className="simple-status-list compact-status-list">
                  <div>{`현재 표시 모드: ${props.platformStatus?.faviconMode === "upload" ? "업로드 자산" : "기본 코드 favicon"}`}</div>
                  <div>{`현재 favicon 경로: ${props.platformStatus?.faviconPath || "/brand/kikios-dark-blue-app-icon-v7.png"}`}</div>
                  <div>{`현재 favicon 형식: ${props.platformStatus?.faviconMime || "-"}`}</div>
                </div>
                <div className="landing-brand-preview">
                  {props.platformStatus?.faviconMode === "upload" && props.platformStatus?.faviconPath ? (
                    <img alt="favicon 미리보기" className="landing-brand-preview-favicon" src={props.platformStatus.faviconPath} />
                  ) : (
                    <TerminalLabLogo className="landing-brand-preview-favicon is-code-logo" />
                  )}
                </div>
              </AdminField>
            </div>
          </div>
        </AdminDisclosureCard>
        <AdminDisclosureCard
          title="고객 로고"
          subtitle="랜딩 페이지에 노출할 고객/도입 기관 로고를 관리합니다."
          summary={`${props.platformStatus?.landingCustomerLogosEnabled === false ? "숨김" : "노출"} / ${landingVisibleCustomerLogoCount}개`}
        >
          <div className="settings-panel landing-customer-logo-editor">
            <div className="admin-form-grid compact-admin-grid">
              <AdminField label="노출 여부">
                <select
                  value={props.platformStatus?.landingCustomerLogosEnabled === false ? "hidden" : "visible"}
                  onChange={(event) => props.setPlatformStatus((current) => ({ ...current, landingCustomerLogosEnabled: event.target.value !== "hidden" }))}
                >
                  <option value="visible">랜딩에 표시</option>
                  <option value="hidden">숨김</option>
                </select>
              </AdminField>
              <AdminField label="섹션 제목">
                <input
                  value={props.platformStatus?.landingCustomerLogosTitle || ""}
                  onChange={(event) => props.setPlatformStatus((current) => ({ ...current, landingCustomerLogosTitle: event.target.value }))}
                  placeholder="함께한 고객"
                />
              </AdminField>
              <AdminField label="로고 추가" hint="업로드하면 목록 맨 아래에 자동으로 추가됩니다. 직접 이미지 경로를 입력해도 됩니다.">
                <div className="portal-actions">
                  <label className="ghost-btn file-upload-btn">
                    <input
                      accept="image/png,image/svg+xml,image/jpeg,image/webp,.png,.svg,.jpg,.jpeg,.webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) props.onUploadBrandAsset(file, "customer-logo");
                        event.target.value = "";
                      }}
                      type="file"
                    />
                    {props.landingMediaUploadState?.uploading ? "업로드 중..." : "고객 로고 업로드"}
                  </label>
                  <button
                    className="mini-btn"
                    disabled={landingCustomerLogos.length >= LANDING_CUSTOMER_LOGO_LIMIT}
                    onClick={() => setLandingCustomerLogos((items) => [...items, createAdminCustomerLogoDraft()])}
                    type="button"
                  >
                    빈 항목 추가
                  </button>
                </div>
              </AdminField>
            </div>
            <div className="landing-customer-logo-admin-list">
              {landingCustomerLogos.length ? landingCustomerLogos.map((logo, index) => (
                <div className="landing-customer-logo-admin-row" key={logo.id || index}>
                  <div className="landing-customer-logo-admin-preview">
                    {logo.imagePath ? <img alt={`${logo.name || "고객"} 로고 미리보기`} src={logo.imagePath} /> : <span>LOGO</span>}
                  </div>
                  <div className="landing-customer-logo-admin-fields">
                    <label>
                      <span>이름</span>
                      <input
                        value={logo.name}
                        onChange={(event) => setLandingCustomerLogos((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, name: event.target.value } : item)))}
                        placeholder="예: Dustbox"
                      />
                    </label>
                    <label>
                      <span>이미지 경로</span>
                      <input
                        value={logo.imagePath}
                        onChange={(event) => setLandingCustomerLogos((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, imagePath: event.target.value } : item)))}
                        placeholder="/landing-media/customer-logo.svg"
                      />
                    </label>
                    <label>
                      <span>링크</span>
                      <input
                        value={logo.website}
                        onChange={(event) => setLandingCustomerLogos((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, website: event.target.value } : item)))}
                        placeholder="https://example.com"
                      />
                    </label>
                  </div>
                  <div className="landing-customer-logo-admin-actions">
                    <label className="toggle-row">
                      <input
                        checked={logo.visible !== false}
                        onChange={(event) => setLandingCustomerLogos((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, visible: event.target.checked } : item)))}
                        type="checkbox"
                      />
                      <span>노출</span>
                    </label>
                    <div className="admin-inline-actions">
                      <button className="mini-btn" disabled={index === 0} onClick={() => setLandingCustomerLogos((items) => {
                        const next = [...items];
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        return next;
                      })} type="button">위</button>
                      <button className="mini-btn" disabled={index >= landingCustomerLogos.length - 1} onClick={() => setLandingCustomerLogos((items) => {
                        const next = [...items];
                        [next[index], next[index + 1]] = [next[index + 1], next[index]];
                        return next;
                      })} type="button">아래</button>
                      <button className="mini-btn danger-mini-btn" onClick={() => setLandingCustomerLogos((items) => items.filter((_item, itemIndex) => itemIndex !== index))} type="button">삭제</button>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="landing-customer-logo-admin-empty">아직 등록된 고객 로고가 없습니다. 로고를 업로드하거나 빈 항목을 추가해 주세요.</div>
              )}
            </div>
          </div>
        </AdminDisclosureCard>
        <AdminDisclosureCard
          title="랜딩 영상"
          subtitle="랜딩 데모 영상 업로드와 미리보기를 관리합니다."
          summary={landingPreviewType === "upload" ? props.platformStatus?.landingVideoPath || "업로드 파일 없음" : props.platformStatus?.landingYoutubeUrl || "YouTube URL 없음"}
        >
        <div className="settings-panel">
          <div className="admin-card-header">
            <div>
              <div className="card-label">랜딩 영상 업로드</div>
              <strong>YouTube 또는 webm/mp4 데모 영상</strong>
            </div>
          </div>
          <div className="simple-status-list">
            <div>{`현재 유형: ${landingPreviewType === "upload" ? "업로드 파일" : "YouTube"}`}</div>
            <div>{`설정 YouTube URL: ${props.platformStatus?.landingYoutubeUrl || "-"}`}</div>
            <div>{`업로드 파일 경로: ${props.platformStatus?.landingVideoPath || "-"}`}</div>
            <div>{`업로드 파일 형식: ${props.platformStatus?.landingVideoMime || "-"}`}</div>
            {props.landingMediaUploadState?.uploading ? <div>{`업로드 중: ${props.landingMediaUploadState.fileName}`}</div> : null}
            <div>mp4는 H.264/AAC, webm은 VP9 코덱을 권장합니다.</div>
          </div>
          <div className="portal-actions">
            <label className="ghost-btn file-upload-btn">
              <input
                accept="video/webm,video/mp4,.webm,.mp4"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) props.onUploadLandingMedia(file);
                  event.target.value = "";
                }}
                type="file"
              />
              {props.landingMediaUploadState?.uploading ? "업로드 중..." : "webm/mp4 업로드"}
            </label>
          </div>
          <div className="landing-admin-preview">
            {landingPreviewType === "upload" && landingPreviewVideoPath ? (
              <video className="landing-admin-preview-media" controls muted playsInline src={landingPreviewVideoPath} />
            ) : landingPreviewYoutubeUrl ? (
              <iframe
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                className="landing-admin-preview-media"
                referrerPolicy="strict-origin-when-cross-origin"
                src={landingPreviewYoutubeUrl}
                title="랜딩 영상 미리보기"
              />
            ) : (
              <div className="hint">미리보기 가능한 랜딩 영상이 아직 없습니다.</div>
            )}
          </div>
        </div>
        </AdminDisclosureCard>
        <AdminDisclosureCard
          title="백업"
          subtitle="PostgreSQL 운영 데이터와 주요 파일 자산을 내보내고 복원합니다."
          summary="JSON / JSON.GZ"
        >
        <div className="settings-panel">
          <div className="simple-status-list compact-status-list">
            <div>포함: DB 테이블, 교안 자료, 예제 파일, 템플릿, 시험 정의, 랜딩 미디어, 서비스 검증 메타</div>
            <div>제외: runtime/haproxy 라우트 맵, 로그인 세션 같은 일시 데이터</div>
            <div>복원 후에는 현재 화면과 로그인 상태가 새로고침될 수 있습니다.</div>
          </div>
          <div className="portal-actions">
            <button className="primary-btn" onClick={props.onExportBackup} type="button">백업 다운로드</button>
            <label className="ghost-btn file-upload-btn">
              <input
                accept="application/json,.json,.gz,.json.gz"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) props.onImportBackup(file);
                  event.target.value = "";
                }}
                type="file"
              />
              백업 복원
            </label>
          </div>
        </div>
        </AdminDisclosureCard>
        <AdminDisclosureCard
          title="도메인 / 외부 접속"
          subtitle="사용자 정의 포트와 외부 SSH/RDP 공개 설정을 묶어서 관리합니다."
          summary={`${getNormalizedSshPublicHost(props.platformStatus?.sshPublicHost)} / SSH ${props.platformStatus?.sshExternalPortStart || 41000}-${props.platformStatus?.sshExternalPortEnd || 42999} / RDP ${props.platformStatus?.rdpExternalPortStart || 43000}-${props.platformStatus?.rdpExternalPortEnd || 43099} / TCP ${props.platformStatus?.tcpExternalPortStart || 45000}-${props.platformStatus?.tcpExternalPortEnd || 45999}`}
        >
        <div className="settings-panel">
          <div className="card-label">공개 도메인 사용자 정의 포트</div>
          <div className="admin-form-grid compact-admin-grid">
            {(props.platformStatus?.customRouteSlots || []).map((slot, index) => (
              <div className="admin-inline-pair" key={slot.id || `custom-slot-${index}`}>
                <AdminField label={`사용자 정의 ${index + 1} 라벨`} hint="사용자 도메인 화면에 노출될 연결 유형 이름입니다. 예: Kubernetes Dashboard, Grafana">
                  <input
                    value={slot.label || ""}
                    onChange={(event) => props.setPlatformStatus((current) => ({
                      ...current,
                      customRouteSlots: (current.customRouteSlots || []).map((currentSlot, currentIndex) => (
                        currentIndex === index ? { ...currentSlot, label: event.target.value } : currentSlot
                      )),
                    }))}
                    placeholder={`예: 대시보드 ${index + 1}`}
                  />
                </AdminField>
                <AdminField label={`사용자 정의 ${index + 1} 포트`} hint="선택한 서비스가 VM 안에서 실제로 리슨하는 포트입니다. HTTP/HTTPS 고정 슬롯 외 추가 서비스용입니다.">
                  <input
                    value={slot.port || ""}
                    onChange={(event) => props.setPlatformStatus((current) => ({
                      ...current,
                      customRouteSlots: (current.customRouteSlots || []).map((currentSlot, currentIndex) => (
                        currentIndex === index ? { ...currentSlot, port: event.target.value } : currentSlot
                      )),
                    }))}
                    placeholder="예: 3000"
                  />
                </AdminField>
              </div>
            ))}
          </div>
        </div>
        <div className="settings-panel">
          <div className="admin-card-header">
            <div>
              <div className="card-label">사용자 도메인 안내문</div>
              <strong>등록 전 확인 박스 문구</strong>
            </div>
            <button className="mini-btn" onClick={resetCustomDomainGuidance} type="button">기본 안내문 복원</button>
          </div>
          <div className="hint">사용자 화면에서 {`{domain}`}, {`{target}`}, {`{txtName}`}은 실제 값으로 치환됩니다.</div>
          <div className="admin-form-grid compact-admin-grid">
            <AdminField label="도입문">
              <textarea
                rows={2}
                value={props.platformStatus?.customDomainGuidanceIntro || ""}
                onChange={(event) => updateCustomDomainGuidance("customDomainGuidanceIntro", event.target.value)}
              />
            </AdminField>
            <AdminField label="CNAME 라벨">
              <input
                value={props.platformStatus?.customDomainGuidanceCnameLabel || ""}
                onChange={(event) => updateCustomDomainGuidance("customDomainGuidanceCnameLabel", event.target.value)}
              />
            </AdminField>
            <AdminField label="CNAME 안내">
              <textarea
                rows={2}
                value={props.platformStatus?.customDomainGuidanceCnameText || ""}
                onChange={(event) => updateCustomDomainGuidance("customDomainGuidanceCnameText", event.target.value)}
              />
            </AdminField>
            <AdminField label="소유권 확인 라벨">
              <input
                value={props.platformStatus?.customDomainGuidanceOwnershipLabel || ""}
                onChange={(event) => updateCustomDomainGuidance("customDomainGuidanceOwnershipLabel", event.target.value)}
              />
            </AdminField>
            <AdminField label="소유권 확인 안내">
              <textarea
                rows={2}
                value={props.platformStatus?.customDomainGuidanceOwnershipText || ""}
                onChange={(event) => updateCustomDomainGuidance("customDomainGuidanceOwnershipText", event.target.value)}
              />
            </AdminField>
            <AdminField label="권장 DNS 라벨">
              <input
                value={props.platformStatus?.customDomainGuidanceRecommendationLabel || ""}
                onChange={(event) => updateCustomDomainGuidance("customDomainGuidanceRecommendationLabel", event.target.value)}
              />
            </AdminField>
            <AdminField label="권장 DNS 안내">
              <textarea
                rows={2}
                value={props.platformStatus?.customDomainGuidanceRecommendationText || ""}
                onChange={(event) => updateCustomDomainGuidance("customDomainGuidanceRecommendationText", event.target.value)}
              />
            </AdminField>
            <AdminField label="검증 TXT 라벨">
              <input
                value={props.platformStatus?.customDomainGuidanceVerificationLabel || ""}
                onChange={(event) => updateCustomDomainGuidance("customDomainGuidanceVerificationLabel", event.target.value)}
              />
            </AdminField>
            <AdminField label="검증 TXT 안내">
              <textarea
                rows={2}
                value={props.platformStatus?.customDomainGuidanceVerificationText || ""}
                onChange={(event) => updateCustomDomainGuidance("customDomainGuidanceVerificationText", event.target.value)}
              />
            </AdminField>
          </div>
        </div>
        </AdminDisclosureCard>
        <AdminDisclosureCard
          id="admin-platform-openstack-scope"
          title="OpenStack 프로젝트 분리"
          subtitle="서비스, 클라우드 콘솔, 컨테이너, 쿠버네티스 자원이 어떤 프로젝트를 쓰는지 확인합니다."
          summary="프로젝트 / 스코프 / 기본값"
        >
        <div className="settings-panel">
          <div className="card-label">프로젝트 분리 기준</div>
          <div className="simple-status-list">
            <div>{`서비스 자원: ${props.platformStatus?.serviceProjectName || "service"}`}</div>
            <div>{`서비스 clouds.yaml: ${props.platformStatus?.serviceCloudsYaml || "기본값"}`}</div>
            <div>{`서비스 Cloud: ${props.platformStatus?.serviceCloudName || "openstack"}`}</div>
            <div>{`서비스 Keystone/Auth URL: ${props.platformStatus?.serviceAuthUrl || "clouds.yaml"}`}</div>
            <div>{`서비스 Heat API URL: ${props.platformStatus?.serviceHeatApiUrl || "카탈로그 자동"}`}</div>
            <div>{`서비스 Compute API URL: ${props.platformStatus?.serviceComputeApiUrl || "카탈로그 자동"}`}</div>
            <div>{`서비스 Network API URL: ${props.platformStatus?.serviceNetworkApiUrl || "카탈로그 자동"}`}</div>
            <div>{`서비스 Metric/Gnocchi API URL: ${props.platformStatus?.serviceMetricApiUrl || "카탈로그 자동"}`}</div>
            <div>{`클라우드 콘솔 자원: ${props.platformStatus?.pocProjectName || "PoC-example.com"}`}</div>
            <div>{`클라우드 콘솔 clouds.yaml: ${props.platformStatus?.pocCloudsYaml || "기본값"}`}</div>
            <div>{`클라우드 콘솔 Cloud: ${props.platformStatus?.pocCloudName || "openstack"}`}</div>
            <div>{`클라우드 콘솔 Keystone/Auth URL: ${props.platformStatus?.pocAuthUrl || "clouds.yaml"}`}</div>
            <div>{`클라우드 콘솔 Heat API URL: ${props.platformStatus?.pocHeatApiUrl || "카탈로그 자동"}`}</div>
            <div>{`클라우드 콘솔 Metric/Gnocchi API URL: ${props.platformStatus?.pocMetricApiUrl || "카탈로그 자동"}`}</div>
            <div>{`클라우드 콘솔 기본 HeatStack: ${props.platformStatus?.pocDefaultHeatTemplateName || "self-service-vm-dynamic.yaml"}`}</div>
            <div>{`클라우드 콘솔 허용 프로젝트: ${(props.platformStatus?.selfServiceVmAllowedProjects || [props.platformStatus?.serviceProjectName || "service"]).join(", ")}`}</div>
            <div>{`클라우드 콘솔 작업 실행 방식: ${props.platformStatus?.selfServiceVmAutoProvisionEnabled === false ? "관리자 승인 후 실행" : "즉시 실행"}`}</div>
            <div>{`전용 프로젝트 자동 구성: ${props.platformStatus?.selfServiceVmProjectAutoConfigureEnabled ? "사용" : "미사용"} / 네트워크 자동 생성: ${props.platformStatus?.selfServiceVmProjectAutoNetworkEnabled ? "사용" : "미사용"}`}</div>
            <div>{`컨테이너: ${props.platformStatus?.zunProjectName || "zun"} / 허용 이미지 ${(props.platformStatus?.zunAllowedImages || []).length || 0}개`}</div>
            <div>{`내부 이미지 서버: ${props.platformStatus?.containerRegistryPublicHost || "미설정"} / namespace ${props.platformStatus?.containerRegistryDefaultNamespace || "library"}`}</div>
            <div>{`CAPO 프로젝트: ${props.platformStatus?.magnumProjectName || "poc-example.com"}`}</div>
          </div>
        </div>
        <div className="settings-panel">
          <div className="card-label">실제 OpenStack 스코프 적용</div>
          <div className="simple-status-list">
            <div>서비스 프로젝트: 랩실, 기본 사용자화 가상머신 구성, Quota 조회</div>
            <div>사용자화 가상머신 구성 허용 프로젝트: 사용자 신청 화면에서 선택 가능한 공용 프로젝트 목록</div>
            <div>컨테이너 프로젝트: 컨테이너 생성, 조회, 시작, 중지, 삭제, API 상태 점검</div>
            <div>쿠버네티스 프로젝트: CAPO 프로파일 조회, 클러스터 요청, 조회, 삭제, 상태 점검</div>
            <div>클라우드 콘솔 프로젝트: 클라우드 콘솔 승인 시 Heat 기반 자원 생성에 사용</div>
          </div>
        </div>
        <div className="settings-panel">
          <div className="card-label">클라우드 콘솔 기본값</div>
          <div className="simple-status-list">
            <div>이미지: lab-rocky-9-2026</div>
            <div>네트워크: net-infra</div>
            <div>보안그룹: example.com</div>
            <div>키페어: lab-key</div>
          </div>
        </div>
        </AdminDisclosureCard>
        <AdminDisclosureCard
          title="OpenStack 수명주기 검증"
          subtitle="설정된 일반 VM의 생성과 정리를 확인합니다."
          summary="설치 환경의 자원을 명시적으로 사용합니다."
        >
        <section id="admin-platform-validation-settings" className="admin-simple-card"><h3>OpenStack 검증</h3><p>설정된 이미지·Flavor와 명시한 네트워크로 VM 생성·정리를 검증합니다.</p><p className="hint">검증 네트워크는 COMMUNITY_VALIDATION_NETWORK로 설정합니다.</p><button className="mini-btn" onClick={props.onRunOpenstackLifecycleTest} type="button">VM 생성·삭제 검증</button>{props.serviceValidationStatus?.message ? <p>{props.serviceValidationStatus.message}</p> : null}</section>
        </AdminDisclosureCard>
      </div>
    </section>
  );
}



function normalizeAdminExtensionStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function isAdminZunIssue(container = {}) {
  const status = normalizeAdminExtensionStatus(container.status || container.state);
  const detail = [container.errorMessage, container.statusReason, container.message].filter(Boolean).join(" ").toLowerCase();
  return ["failed", "error"].includes(status) || /quota|forbidden|denied|failed|error/.test(detail);
}

function isAdminZunActive(container = {}) {
  return ["running", "creating", "starting"].includes(normalizeAdminExtensionStatus(container.status || container.state));
}

function isAdminZunCleanupCandidate(container = {}) {
  const status = normalizeAdminExtensionStatus(container.status || container.state);
  return ["stopped", "failed", "error", "deleted"].includes(status) || isAdminZunIssue(container);
}

function getAdminZunStatusClass(status) {
  const normalized = normalizeAdminExtensionStatus(status);
  if (["running"].includes(normalized)) return "is-success";
  if (["creating", "starting", "stopping"].includes(normalized)) return "is-warn";
  if (["failed", "error"].includes(normalized)) return "is-error";
  return "is-muted";
}

function isAdminMagnumIssue(cluster = {}) {
  const status = normalizeAdminExtensionStatus(cluster.status);
  const detail = [cluster.statusReason, cluster.errorMessage, cluster.message].filter(Boolean).join(" ").toLowerCase();
  return ["failed", "error"].includes(status) || /quota|forbidden|denied|failed|error/.test(detail);
}

function isAdminMagnumActive(cluster = {}) {
  return !["deleted", "failed", "error", "rejected"].includes(normalizeAdminExtensionStatus(cluster.status));
}

function isAdminMagnumCleanupCandidate(cluster = {}) {
  const status = normalizeAdminExtensionStatus(cluster.status);
  return ["deleted", "failed", "error", "rejected"].includes(status) || isAdminMagnumIssue(cluster);
}

function getAdminMagnumStatusClass(status) {
  const normalized = normalizeAdminExtensionStatus(status);
  if (["create_complete", "running", "active"].includes(normalized)) return "is-success";
  if (["requested", "creating", "create_in_progress", "updating", "deleting"].includes(normalized)) return "is-warn";
  if (["failed", "error", "create_failed"].includes(normalized)) return "is-error";
  return "is-muted";
}

function AdminExtensionSetupNotice({ actionLabel = "플랫폼 설정 열기", children, onAction, title }) {
  return (
    <div className="inline-message is-warning admin-extension-setup-notice">
      <div>
        <strong>{title}</strong>
        <div>{children}</div>
      </div>
      {onAction ? <button className="mini-btn" onClick={onAction} type="button">{actionLabel}</button> : null}
    </div>
  );
}

export function AdminZunTab(props) {
  const containers = Array.isArray(props.zunContainers) ? props.zunContainers : [];
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const searchInput = useImeBufferedInput(search, setSearch);
  const zunEnabled = Boolean(props.platformStatus?.zunEnabled);
  const allowedImageCount = listCount(props.platformStatus?.zunAllowedImages);
  const activeContainers = containers.filter(isAdminZunActive);
  const issueContainers = containers.filter(isAdminZunIssue);
  const cleanupContainers = containers.filter(isAdminZunCleanupCandidate);
  const normalizedSearch = String(search || "").trim().toLowerCase();
  const statusOptions = [
    { key: "all", label: "전체", count: containers.length },
    { key: "active", label: "실행/생성", count: activeContainers.length },
    { key: "issue", label: "주의", count: issueContainers.length },
    { key: "cleanup", label: "정리 후보", count: cleanupContainers.length },
  ];
  const filteredContainers = containers.filter((container) => {
    const status = normalizeAdminExtensionStatus(container.status || container.state);
    const statusMatches = statusFilter === "all"
      || (statusFilter === "active" && isAdminZunActive(container))
      || (statusFilter === "issue" && isAdminZunIssue(container))
      || (statusFilter === "cleanup" && isAdminZunCleanupCandidate(container))
      || status === statusFilter;
    const addresses = Array.isArray(container.addresses) ? container.addresses.map((item) => item.address).join(", ") : "";
    const searchText = [
      container.name,
      container.userName,
      container.username,
      container.imageName,
      container.image,
      container.exposedPort,
      container.port,
      addresses,
      container.status,
      container.errorMessage,
      container.id ? `#${container.id}` : "",
    ].filter(Boolean).join(" ").toLowerCase();
    return statusMatches && (!normalizedSearch || searchText.includes(normalizedSearch));
  });

  return (
    <section className="portal-stack">
      <div className="admin-simple-card">
        <div className="admin-card-header">
          <div>
            <strong>컨테이너 현황</strong>
            <div className="hint">Zun 컨테이너 상태, 허용 이미지, 정리 후보를 한 화면에서 확인합니다.</div>
          </div>
          <button className="mini-btn" onClick={() => props.onOpenAdminTab?.("openstackCleanup")} type="button">리소스 정리</button>
        </div>
        <div className="simple-status-list">
          <div>{`사용 여부: ${zunEnabled ? "활성" : "비활성"}`}</div>
          <div>{`Zun API URL: ${props.platformStatus?.zunApiUrl || "-"}`}</div>
          <div>{`총 컨테이너 수: ${containers.length}`}</div>
          <div>{`실행/생성 중: ${activeContainers.length}개 / 주의 ${issueContainers.length}개`}</div>
          <div>{`허용 이미지: ${(props.platformStatus?.zunAllowedImages || []).join(", ") || "-"}`}</div>
        </div>
      </div>
      {!zunEnabled ? (
        <AdminExtensionSetupNotice onAction={() => props.onOpenAdminTab?.("platform")} title="컨테이너 랩이 사용자 화면에서 비활성화되어 있습니다.">
          플랫폼 설정에서 컨테이너 랩 사용 여부와 Zun 프로젝트/API URL을 확인해 주세요.
        </AdminExtensionSetupNotice>
      ) : null}
      {zunEnabled && !allowedImageCount ? (
        <AdminExtensionSetupNotice onAction={() => props.onOpenAdminTab?.("platform")} title="컨테이너 허용 이미지가 비어 있습니다.">
          사용자가 임의 이미지를 입력하지 않도록 운영 이미지 목록을 먼저 등록하는 것을 권장합니다.
        </AdminExtensionSetupNotice>
      ) : null}
      <div className="admin-simple-card">
        <div className="admin-card-header">
          <div>
            <strong>컨테이너 목록</strong>
            <div className="hint">중지/실패 컨테이너는 리소스 정리 센터에서 잔여 영향도 함께 볼 수 있습니다.</div>
          </div>
        </div>
        <div className="admin-history-search">
          <input {...searchInput} placeholder="컨테이너명, 사용자, 이미지, 포트, 주소, 오류 검색" type="search" />
          <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
            {statusOptions.map((option) => <option key={option.key} value={option.key}>{`${option.label} ${option.count}`}</option>)}
          </select>
        </div>
        <div className="admin-table admin-table-scroll">
          <div className="admin-table-head admin-course-grid">
            <span>사용자 / 컨테이너</span>
            <span>상태</span>
            <span>작업</span>
          </div>
          {filteredContainers.length ? filteredContainers.map((container) => {
            const normalizedStatus = normalizeAdminExtensionStatus(container.status || container.state);
            return (
            <div className="admin-table-row admin-course-grid" key={container.id}>
              <span>
                <strong>{container.name}</strong>
                <div className="hint">{`${container.userName || container.username} (${container.username})`}</div>
                <div className="hint">{`이미지: ${container.imageName || container.image || "-"}`}</div>
                <div className="hint">{`포트: ${container.exposedPort || container.port || "-"}`}</div>
                <div className="hint">{`주소: ${container.addresses?.map((item) => item.address).join(", ") || "-"}`}</div>
              </span>
              <span>
                <span className={`status-chip ${getAdminZunStatusClass(container.status)}`}>{renderZunStatus(container.status)}</span>
                {isAdminZunCleanupCandidate(container) ? <div className="hint">리소스 정리 센터에서 포트/라우트 잔여 여부를 확인할 수 있습니다.</div> : null}
                {container.errorMessage ? <div className="hint">{container.errorMessage}</div> : null}
              </span>
              <div className="admin-inline-actions">
                {["stopped", "failed", "error"].includes(normalizedStatus) ? <button className="mini-btn start-btn" onClick={() => props.onStartZunContainer(container.id)} type="button">시작</button> : null}
                {["running", "creating", "starting"].includes(normalizedStatus) ? <button className="mini-btn stop-btn" onClick={() => props.onStopZunContainer(container.id)} type="button">중지</button> : null}
                <button className="mini-btn" onClick={() => props.onRefreshZunContainer(container.id)} type="button">상태 갱신</button>
                <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteZunContainer(container.id)} type="button">삭제</button>
              </div>
            </div>
          );
          }) : <div className="empty-state">{containers.length ? "검색 조건에 맞는 컨테이너가 없습니다." : "등록된 컨테이너가 없습니다."}</div>}
        </div>
      </div>
      <PanelStatusMessage {...props.zunStatus} />
    </section>
  );
}

export function AdminMagnumTab(props) {
  const clusters = Array.isArray(props.magnumClusters) ? props.magnumClusters : [];
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const searchInput = useImeBufferedInput(search, setSearch);
  const magnumEnabled = Boolean(props.platformStatus?.magnumEnabled);
  const capoMonitor = props.apiMonitor?.magnum || {};
  const capoApplyEnabled = Boolean(capoMonitor.applyEnabled);
  const capoClusterctlEnabled = Boolean(capoMonitor.clusterctlEnabled);
  const capoManifestDir = String(capoMonitor.manifestDir || "").trim();
  const magnumApiConfigured = Boolean(String(props.platformStatus?.magnumApiUrl || "").trim() || capoApplyEnabled || capoManifestDir);
  const activeClusters = clusters.filter(isAdminMagnumActive);
  const issueClusters = clusters.filter(isAdminMagnumIssue);
  const cleanupClusters = clusters.filter(isAdminMagnumCleanupCandidate);
  const normalizedSearch = String(search || "").trim().toLowerCase();
  const statusOptions = [
    { key: "all", label: "전체", count: clusters.length },
    { key: "active", label: "진행/동작", count: activeClusters.length },
    { key: "issue", label: "주의", count: issueClusters.length },
    { key: "cleanup", label: "정리 후보", count: cleanupClusters.length },
    { key: "requested", label: "승인 대기", count: clusters.filter((item) => normalizeAdminExtensionStatus(item.status) === "requested").length },
  ];
  const filteredClusters = clusters.filter((cluster) => {
    const status = normalizeAdminExtensionStatus(cluster.status);
    const statusMatches = statusFilter === "all"
      || (statusFilter === "active" && isAdminMagnumActive(cluster))
      || (statusFilter === "issue" && isAdminMagnumIssue(cluster))
      || (statusFilter === "cleanup" && isAdminMagnumCleanupCandidate(cluster))
      || status === statusFilter;
    const searchText = [
      cluster.name,
      cluster.userName,
      cluster.username,
      cluster.clusterTemplateName,
      cluster.clusterTemplateId,
      cluster.clusterUuid,
      cluster.apiAddress,
      cluster.status,
      cluster.statusReason,
      cluster.errorMessage,
      cluster.id ? `#${cluster.id}` : "",
    ].filter(Boolean).join(" ").toLowerCase();
    return statusMatches && (!normalizedSearch || searchText.includes(normalizedSearch));
  });

  return (
    <section className="portal-stack">
      <div className="admin-simple-card">
        <div className="admin-card-header">
          <div>
            <strong>쿠버네티스 클러스터 현황</strong>
            <div className="hint">CAPO 승인 대기, 생성 중, 실패/정리 후보를 같은 기준으로 확인합니다.</div>
          </div>
          <button className="mini-btn" onClick={() => props.onOpenAdminTab?.("openstackCleanup")} type="button">리소스 정리</button>
        </div>
        <div className="simple-status-list">
          <div>{`쿠버네티스 프로젝트: ${props.platformStatus?.magnumProjectName || "poc-example.com"}`}</div>
          <div>{`CAPO management endpoint / clusterctl 실행 경로: ${props.platformStatus?.magnumApiUrl || "-"}`}</div>
          <div>{`승인 정책: ${props.platformStatus?.magnumAutoApproveEnabled ? "정책 기반 자동 승인" : "관리자 수동 승인"}`}</div>
          {props.platformStatus?.magnumAutoApproveEnabled ? <div>{`자동 승인 허용 프로파일 ${(props.platformStatus?.magnumAutoApproveProfileIds || []).length}개 / Control plane ${props.platformStatus?.magnumAutoApproveMaxMasterCount || 1} / Worker ${props.platformStatus?.magnumAutoApproveMaxNodeCount || 3} / 사용자당 ${props.platformStatus?.magnumAutoApproveMaxClustersPerUser || 1}개`}</div> : null}
          {props.platformStatus?.magnumAutoApproveEnabled ? <div>{`Quota 사전 검사: ${props.platformStatus?.magnumAutoApproveRequireQuota === false ? "사용 안 함" : "필수"}`}</div> : null}
          <div>{`CAPO 생성 방식: ${capoClusterctlEnabled ? "clusterctl generate" : "manifest 생성"}${capoApplyEnabled ? " + kubectl apply" : " + 요청 파일 보관"}`}</div>
          {capoManifestDir ? <div>{`CAPO manifest 경로: ${capoManifestDir}`}</div> : null}
          <div>{`총 클러스터 수: ${clusters.length}`}</div>
          <div>{`진행/동작 ${activeClusters.length}개 / 주의 ${issueClusters.length}개`}</div>
        </div>
      </div>
      {!magnumEnabled ? (
        <AdminExtensionSetupNotice onAction={() => props.onOpenAdminTab?.("platform")} title="쿠버네티스 클러스터 메뉴가 사용자 화면에서 비활성화되어 있습니다.">
          플랫폼 설정에서 Kubernetes/CAPO 사용 여부와 프로젝트를 먼저 확인해 주세요.
        </AdminExtensionSetupNotice>
      ) : null}
      {magnumEnabled && !magnumApiConfigured ? (
        <AdminExtensionSetupNotice onAction={() => props.onOpenAdminTab?.("platform")} title="CAPO manifest 요청 파일 생성 모드로 동작합니다.">
          승인 시 manifest 파일을 생성합니다. 즉시 생성까지 자동화하려면 CAPO_APPLY_ENABLED와 management kubeconfig를 설정해 주세요.
        </AdminExtensionSetupNotice>
      ) : null}
      <div className="admin-simple-card">
        <div className="admin-card-header">
          <div>
            <strong>클러스터 목록</strong>
            <div className="hint">실패/삭제 상태는 리소스 정리 센터에서도 함께 표시됩니다.</div>
          </div>
        </div>
        <div className="admin-history-search">
          <input {...searchInput} placeholder="클러스터명, 사용자, CAPO 프로파일, UUID, API 주소, 오류 검색" type="search" />
          <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
            {statusOptions.map((option) => <option key={option.key} value={option.key}>{`${option.label} ${option.count}`}</option>)}
          </select>
        </div>
        <div className="admin-table admin-table-scroll">
          <div className="admin-table-head admin-course-grid">
            <span>사용자 / 클러스터</span>
            <span>상태</span>
            <span>작업</span>
          </div>
          {filteredClusters.length ? filteredClusters.map((cluster) => {
            const normalizedStatus = normalizeAdminExtensionStatus(cluster.status);
            const clusterUuid = cluster.clusterUuid || cluster.cluster_uuid;
            return (
            <div className="admin-table-row admin-course-grid" key={cluster.id}>
              <span>
                <strong>{cluster.name}</strong>
                <div className="hint">{`${cluster.userName || cluster.username} (${cluster.username})`}</div>
                <div className="hint">{`${cluster.clusterTemplateName || cluster.clusterTemplateId} / control-plane ${cluster.masterCount} (${cluster.controlPlaneFlavor || "-"}), worker ${cluster.nodeCount} (${cluster.workerFlavor || "-"})`}</div>
                {cluster.apiAddress ? <div className="hint">{`내부 API https://${cluster.apiAddress}:${cluster.apiPort || 6443}`}</div> : null}
                {cluster.externalApiEnabled && cluster.externalApiHost && cluster.externalApiPort ? <div className="hint">{`외부 API https://${cluster.externalApiHost}:${cluster.externalApiPort}`}</div> : null}
              </span>
              <span>
                <span className={`status-chip ${getAdminMagnumStatusClass(cluster.status)}`}>{cluster.status || "-"}</span>
                {cluster.statusReason ? <div className="hint">{cluster.statusReason}</div> : null}
                {isAdminMagnumCleanupCandidate(cluster) ? <div className="hint">리소스 정리 센터에서 노드/네트워크 잔여 자원 영향을 확인할 수 있습니다.</div> : null}
              </span>
              <span className="admin-inline-actions">
                {normalizedStatus === "requested" ? (
                  <>
                    <button className="mini-btn approve-btn" onClick={() => props.onReviewMagnumCluster(cluster.id, "approve")} type="button">승인</button>
                    <button className="mini-btn reject-btn" onClick={() => props.onReviewMagnumCluster(cluster.id, "reject")} type="button">반려</button>
                  </>
                ) : (
                  <>
                    {clusterUuid ? <button className="mini-btn" onClick={() => props.onRefreshMagnumCluster(cluster.id)} type="button">상태 갱신</button> : null}
                    <button className="mini-btn danger-toggle" onClick={() => props.onDeleteMagnumCluster(cluster.id)} type="button">삭제</button>
                  </>
                )}
              </span>
            </div>
          );
          }) : <div className="empty-state">{clusters.length ? "검색 조건에 맞는 쿠버네티스 클러스터가 없습니다." : "등록된 쿠버네티스 클러스터가 없습니다."}</div>}
        </div>
      </div>
      <PanelStatusMessage {...props.magnumStatus} />
    </section>
  );
}

function normalizeAdminTroveStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function isAdminTroveIssue(instance = {}) {
  const status = normalizeAdminTroveStatus(instance.status);
  const detail = [
    instance.statusReason,
    instance.errorMessage,
    instance.message,
  ].filter(Boolean).join(" ").toLowerCase();
  return ["failed", "error"].includes(status) || /quota|forbidden|denied|failed|error/.test(detail);
}

function isAdminTroveCleanupCandidate(instance = {}) {
  const status = normalizeAdminTroveStatus(instance.status);
  return ["deleted", "terminated", "failed", "error"].includes(status) || isAdminTroveIssue(instance);
}

function getAdminTroveStatusClass(status) {
  const normalized = normalizeAdminTroveStatus(status);
  if (["active", "available", "running"].includes(normalized)) return "is-success";
  if (["build", "building", "creating", "provisioning", "restarting", "resizing"].includes(normalized)) return "is-warn";
  if (["failed", "error"].includes(normalized)) return "is-error";
  if (["deleted", "terminated"].includes(normalized)) return "is-muted";
  return "is-muted";
}

export function AdminTroveTab(props) {
  const instances = Array.isArray(props.troveInstances) ? props.troveInstances : [];
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const searchInput = useImeBufferedInput(search, setSearch);
  const activeInstances = instances.filter((item) => !["deleted", "failed", "error", "terminated"].includes(normalizeAdminTroveStatus(item.status)));
  const issueInstances = instances.filter(isAdminTroveIssue);
  const cleanupInstances = instances.filter(isAdminTroveCleanupCandidate);
  const barbicanSecrets = instances.filter((item) => item.hasCredential);
  const barbicanProjects = new Set(barbicanSecrets.map((item) => String(item.projectName || "").trim()).filter(Boolean));
  const allowedDatastores = Array.isArray(props.platformStatus?.troveAllowedDatastores) ? props.platformStatus.troveAllowedDatastores.filter(Boolean) : [];
  const allowedFlavors = Array.isArray(props.platformStatus?.troveAllowedFlavors) ? props.platformStatus.troveAllowedFlavors.filter(Boolean) : [];
  const allowedSizes = Array.isArray(props.platformStatus?.troveAllowedSizesGb) ? props.platformStatus.troveAllowedSizesGb.filter((item) => Number(item) > 0) : [];
  const troveEnabled = Boolean(props.platformStatus?.troveEnabled);
  const troveApiConfigured = Boolean(String(props.platformStatus?.troveApiUrl || "").trim());
  const troveCatalogReady = allowedDatastores.length && allowedFlavors.length && allowedSizes.length;
  const normalizedSearch = String(search || "").trim().toLowerCase();
  const statusOptions = [
    { key: "all", label: "전체", count: instances.length },
    { key: "active", label: "사용 중", count: activeInstances.length },
    { key: "issue", label: "주의", count: issueInstances.length },
    { key: "cleanup", label: "정리 후보", count: cleanupInstances.length },
  ];
  const filteredInstances = instances.filter((instance) => {
    const status = normalizeAdminTroveStatus(instance.status);
    const statusMatches = statusFilter === "all"
      || (statusFilter === "active" && activeInstances.includes(instance))
      || (statusFilter === "issue" && isAdminTroveIssue(instance))
      || (statusFilter === "cleanup" && isAdminTroveCleanupCandidate(instance))
      || status === statusFilter;
    const searchText = [
      instance.name,
      instance.userName,
      instance.username,
      instance.datastoreType,
      instance.datastoreVersion,
      instance.flavor,
      instance.sizeGb,
      instance.hostname,
      instance.status,
      instance.statusReason,
      instance.errorMessage,
      instance.id ? `#${instance.id}` : "",
    ].filter(Boolean).join(" ").toLowerCase();
    return statusMatches && (!normalizedSearch || searchText.includes(normalizedSearch));
  });

  return (
    <section className="portal-stack">
      <div className="admin-simple-card">
        <div className="admin-card-header">
          <div>
            <strong>데이터베이스 현황</strong>
            <div className="hint">Trove DB 인스턴스, 허용 엔진/사양, 삭제 상태를 한 화면에서 확인합니다.</div>
          </div>
          <button className="mini-btn" onClick={() => props.onOpenAdminTab?.("platform")} type="button">플랫폼 설정</button>
        </div>
        <div className="admin-summary-grid">
          <article className="admin-summary-item">
            <span>사용 여부</span>
            <strong>{troveEnabled ? "활성" : "비활성"}</strong>
            <div className="hint">사용자별 클라우드 콘솔 프로젝트</div>
          </article>
          <article className="admin-summary-item">
            <span>DB 인스턴스</span>
            <strong>{`${instances.length}개`}</strong>
            <div className="hint">{`활성 ${activeInstances.length}개 / 주의 ${issueInstances.length}개`}</div>
          </article>
          <article className="admin-summary-item">
            <span>허용 Datastore</span>
            <strong>{`${allowedDatastores.length}개`}</strong>
            <div className="hint">{allowedDatastores.slice(0, 4).join(", ") || "설정 필요"}</div>
          </article>
          <article className="admin-summary-item">
            <span>허용 사양</span>
            <strong>{`${allowedFlavors.length}개`}</strong>
            <div className="hint">{`볼륨 크기 ${allowedSizes.length}개`}</div>
          </article>
          <article className="admin-summary-item">
            <span>Barbican 자격증명</span>
            <strong>{`${barbicanSecrets.length}개`}</strong>
            <div className="hint">{`프로젝트 ${barbicanProjects.size}개 · 비밀번호 값은 숨김`}</div>
          </article>
        </div>
        <div className="simple-status-list">
          <div>{`Trove API URL: ${props.platformStatus?.troveApiUrl || "-"}`}</div>
          <div>{`허용 Flavor: ${allowedFlavors.join(", ") || "-"}`}</div>
          <div>{`허용 볼륨: ${allowedSizes.length ? allowedSizes.map((size) => `${size}GB`).join(", ") : "-"}`}</div>
        </div>
      </div>
      {!troveEnabled ? (
        <AdminExtensionSetupNotice onAction={() => props.onOpenAdminTab?.("platform")} title="데이터베이스 랩이 사용자 화면에서 비활성화되어 있습니다.">
          플랫폼 설정에서 Trove 사용 여부와 데이터베이스 프로젝트를 먼저 확인해 주세요.
        </AdminExtensionSetupNotice>
      ) : null}
      {troveEnabled && !troveCatalogReady ? (
        <AdminExtensionSetupNotice onAction={() => props.onOpenAdminTab?.("platform")} title="DB 생성 선택지가 충분하지 않습니다.">
          Datastore, Flavor, 볼륨 크기 목록을 모두 등록해야 사용자가 데이터베이스를 신청할 수 있습니다.
        </AdminExtensionSetupNotice>
      ) : null}
      {troveEnabled && !troveApiConfigured ? (
        <AdminExtensionSetupNotice onAction={() => props.onOpenAdminTab?.("platform")} title="Trove API URL이 비어 있습니다.">
          API URL을 비워두면 백엔드 자동 탐색에 의존합니다. 내부 카탈로그가 불안정하면 직접 지정하는 편이 좋습니다.
        </AdminExtensionSetupNotice>
      ) : null}

      <div className="admin-simple-card">
        <div className="admin-card-header">
          <div>
            <strong>DB 인스턴스 목록</strong>
            <div className="hint">실패/삭제 상태는 리소스 정리 센터에서도 함께 표시됩니다.</div>
          </div>
          <button className="mini-btn" onClick={() => props.onOpenAdminTab?.("openstackCleanup")} type="button">리소스 정리</button>
        </div>
        <div className="admin-history-search">
          <input {...searchInput} placeholder="DB명, 사용자, Datastore, Flavor, Host, 오류 검색" type="search" />
          <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
            {statusOptions.map((option) => <option key={option.key} value={option.key}>{`${option.label} ${option.count}`}</option>)}
          </select>
        </div>
        <div className="admin-table admin-table-scroll">
          <div className="admin-table-head admin-course-grid">
            <span>사용자 / DB</span>
            <span>상태</span>
            <span>작업</span>
          </div>
          {filteredInstances.length ? filteredInstances.map((instance) => (
            <div className="admin-table-row admin-course-grid" key={instance.id}>
              <span>
                <strong>{instance.name || `DB #${instance.id}`}</strong>
                <div className="hint">{`${instance.userName || instance.username || "-"}${instance.username ? ` (${instance.username})` : ""}`}</div>
                <div className="hint">{`${instance.datastoreType || "-"}${instance.datastoreVersion ? ` ${instance.datastoreVersion}` : ""} / ${instance.flavor || "-"}`}</div>
                <div className="hint">{`볼륨: ${instance.sizeGb || "-"}GB`}</div>
                {instance.hostname ? <div className="hint">{`Host: ${instance.hostname}`}</div> : null}
              </span>
              <span>
                <span className={`status-chip ${getAdminTroveStatusClass(instance.status)}`}>{instance.status || "-"}</span>
                {isAdminTroveCleanupCandidate(instance) ? <div className="hint">리소스 정리 센터에서 잔여 자원 영향도 함께 확인할 수 있습니다.</div> : null}
                {instance.statusReason ? <div className="hint">{instance.statusReason}</div> : null}
                {instance.errorMessage ? <div className="hint">{instance.errorMessage}</div> : null}
              </span>
              <div className="admin-inline-actions">
                <button className="mini-btn" onClick={() => props.onRefreshTroveInstance?.(instance.id)} type="button">상태 갱신</button>
                <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteTroveInstance?.(instance.id)} type="button">삭제</button>
              </div>
            </div>
          )) : <div className="empty-state">{instances.length ? "검색 조건에 맞는 DB 인스턴스가 없습니다." : "등록된 DB 인스턴스가 없습니다."}</div>}
        </div>
      </div>
      <PanelStatusMessage {...props.troveStatus} />
    </section>
  );
}

export function AdminLlmTab(props) {
  const llmProvider = props.platformStatus?.llmProvider === "ollama-native" ? "ollama-native" : "custom";
  const apiUrlPlaceholder = llmProvider === "ollama-native"
      ? "http://192.0.2.194:11434 또는 http://192.0.2.194:11434/api/chat"
      : "http://192.0.2.10:8000/v1/chat/completions";
  const modelPlaceholder = "model";
  const llmApiKeyConfigured = Boolean(props.platformStatus?.llmApiKeyConfigured);
  const llmApiKeySource = props.platformStatus?.llmApiKeySource || "";
  const googleSearchApiKeyConfigured = Boolean(props.platformStatus?.googleSearchApiKeyConfigured);
  const googleSearchApiKeySource = props.platformStatus?.googleSearchApiKeySource || "";
  return (
    <section className="portal-stack">
      <div className="admin-simple-card">
        <div className="admin-card-header">
          <strong>LLM 연결 설정</strong>
          <div className="admin-inline-actions">
            <button className="mini-btn test-btn" onClick={props.onTestLlm} type="button">연결 테스트</button>
            <button className="mini-btn save-btn" onClick={props.onSaveLlmSettings} type="button">설정 저장</button>
          </div>
        </div>
        <div className="admin-llm-status-grid">
          <div className="admin-llm-status-card">
            <span className="card-label">API Key</span>
            <strong>{llmApiKeyConfigured ? "서버에 설정됨" : "미설정"}</strong>
            <div className="hint">{llmApiKeySource === "db" ? "관리자 화면에 저장된 키를 사용합니다." : "호환 API가 인증을 요구할 때만 입력합니다."}</div>
          </div>
          <div className="admin-llm-status-card">
            <span className="card-label">현재 연결 방식</span>
            <strong>{llmProvider === "ollama-native" ? "Ollama Native" : "내부 LLM"}</strong>
            <div className="hint">{llmProvider === "ollama-native" ? "Ollama /api/chat 네이티브 API로 연결합니다." : "OpenAI 호환 chat/completions API를 내부 주소로 연결하는 모드입니다."}</div>
          </div>
          <div className="admin-llm-status-card">
            <span className="card-label">현재 모델</span>
            <strong>{props.platformStatus?.llmModel || "모델 미설정"}</strong>
            <div className="hint">사용자 AI 질문에서 실제 호출할 저장 모델입니다.</div>
          </div>
          <div className="admin-llm-status-card">
            <span className="card-label">Thinking</span>
            <strong>{props.platformStatus?.llmThinkingMode === "enabled" ? "사용" : props.platformStatus?.llmThinkingMode === "default" ? "모델 기본값" : "끔"}</strong>
            <div className="hint">{props.platformStatus?.llmThinkingMode === "enabled" ? "추론 토큰까지 생성합니다." : "최종 답변 중심으로 빠르게 응답합니다."}</div>
          </div>
          <div className="admin-llm-status-card">
            <span className="card-label">웹 검색</span>
            <strong>{props.platformStatus?.llmWebSearchEnabled !== false ? "사용" : "끔"}</strong>
            <div className="hint">{googleSearchApiKeyConfigured ? "Google 검색 API 키가 설정되어 있습니다." : "Google 검색 API 키가 필요합니다."}</div>
          </div>
        </div>
        <div className="admin-form">
          <AdminField label="연결 방식" hint="OpenAI 호환 내부 LLM 또는 Ollama 네이티브 중 하나를 선택합니다.">
            <select
              value={llmProvider}
              onChange={(event) =>
                props.setPlatformStatus((current) => {
                  const nextProvider = event.target.value === "ollama-native" ? "ollama-native" : "custom";
                  const nextStatus = {
                    ...current,
                    llmProvider: nextProvider,
                  };
                  if (nextProvider === "ollama-native") {
                    if (!String(current?.llmApiUrl || "").trim() || String(current?.llmApiUrl || "").includes("/v1/chat/completions")) {
                      nextStatus.llmApiUrl = "";
                    }
                  }
                  return nextStatus;
                })
              }
            >
              <option value="custom">내부 LLM(OpenAI 호환)</option>
              <option value="ollama-native">Ollama Native</option>
            </select>
          </AdminField>
          <AdminField label="LLM API URL" required hint={llmProvider === "ollama-native" ? "Ollama 서버 기본 주소를 입력하면 서버가 /api/chat으로 호출합니다." : "OpenAI 호환 chat/completions 형식의 LLM API URL입니다. 관리자 연결 테스트에서 바로 확인할 수 있습니다."}>
            <input
              value={props.platformStatus?.llmApiUrl || ""}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  llmApiUrl: event.target.value,
                }))
              }
              placeholder={apiUrlPlaceholder}
            />
          </AdminField>
          <AdminField label="모델 ID" required hint="LLM 서버가 기대하는 모델 이름을 입력합니다.">
            <input
              value={props.platformStatus?.llmModel || ""}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  llmModel: event.target.value,
                }))
              }
              placeholder={modelPlaceholder}
            />
          </AdminField>
          <AdminField label="API Key" hint="호환 API가 별도 API Key를 요구하는 경우에만 입력합니다. 새 키 입력 시 저장값을 교체합니다.">
            <input
              type="password"
              value={props.platformStatus?.llmApiKey || ""}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  llmApiKey: event.target.value,
                  llmApiKeyClearRequested: false,
                }))
              }
              placeholder={llmApiKeyConfigured ? "새 키 입력 시에만 교체" : "필요한 경우만 입력"}
            />
          </AdminField>
          <div className="admin-inline-actions">
              <button
                className="mini-btn"
                onClick={() =>
                  props.setPlatformStatus((current) => ({
                    ...current,
                    llmApiKey: "",
                    llmApiKeyClearRequested: false,
                  }))
                }
                type="button"
              >
                새 키 입력 취소
              </button>
              <button
                className="mini-btn danger-toggle"
                disabled={!llmApiKeyConfigured}
                onClick={() =>
                  props.setPlatformStatus((current) => ({
                    ...current,
                    llmApiKey: "",
                    llmApiKeyClearRequested: true,
                  }))
                }
                type="button"
              >
                저장된 키 삭제
              </button>
              {props.platformStatus?.llmApiKeyClearRequested ? <span className="hint">저장 시 기존 API Key가 삭제됩니다.</span> : null}
            </div>
          <AdminField label="시스템 프롬프트" hint="과정 정보, 랩 정보, 응답 스타일 같은 기본 지시를 미리 넣을 수 있습니다.">
            <textarea
              value={props.platformStatus?.llmSystemPrompt || ""}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  llmSystemPrompt: event.target.value,
                }))
              }
              placeholder="과정과 랩 정보를 고려해서 답변하도록 지시할 수 있습니다."
            />
          </AdminField>
          <AdminField label="일일 질문 제한 사용" hint="무료 운영 단계에서 사용자별 하루 질문 수를 제한합니다. 비활성화하면 제한 없이 사용할 수 있습니다.">
            <label className="toggle">
              <input
                checked={props.platformStatus?.llmDailyQuotaEnabled !== false}
                onChange={(event) =>
                  props.setPlatformStatus((current) => ({
                    ...current,
                    llmDailyQuotaEnabled: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              <span>{props.platformStatus?.llmDailyQuotaEnabled !== false ? "활성" : "비활성"}</span>
            </label>
          </AdminField>
          <AdminField label="기본 하루 질문 수" hint="일반 사용자에게 적용할 기본 하루 질문 횟수입니다. 한국 시간 자정 기준으로 초기화됩니다.">
            <input
              min="1"
              step="1"
              type="number"
              value={String(Math.max(1, Number(props.platformStatus?.llmDailyQuotaLimit || 10) || 10))}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  llmDailyQuotaLimit: Math.max(1, Number(event.target.value || 10) || 10),
                }))
              }
            />
          </AdminField>
          <AdminField label="답변 최대 토큰" hint="일반 AI 질문의 최대 생성 길이입니다. CPU 기반 내부 LLM은 낮게 잡을수록 응답이 빨라집니다.">
            <input
              min="1"
              step="1"
              type="number"
              value={String(Math.max(1, Number(props.platformStatus?.llmMaxTokens || 512) || 512))}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  llmMaxTokens: Math.max(1, Number(event.target.value || 512) || 512),
                }))
              }
            />
          </AdminField>
          <AdminField label="연결 테스트 최대 토큰" hint="관리자 LLM 연결 테스트에서 생성할 최대 길이입니다. 짧게 둘수록 테스트가 빨리 끝납니다.">
            <input
              min="1"
              step="1"
              type="number"
              value={String(Math.max(1, Number(props.platformStatus?.llmAdminTestMaxTokens || 80) || 80))}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  llmAdminTestMaxTokens: Math.max(1, Number(event.target.value || 80) || 80),
                }))
              }
            />
          </AdminField>
          <AdminField label="설문 해설 최대 토큰" hint="사전·사후 설문 AI 해설 생성 길이입니다. CPU 모델에서는 256-384 정도가 응답 시간에 유리합니다.">
            <input
              min="64"
              step="1"
              type="number"
              value={String(Math.max(64, Number(props.platformStatus?.llmSurveyFeedbackMaxTokens || 384) || 384))}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  llmSurveyFeedbackMaxTokens: Math.max(64, Number(event.target.value || 384) || 384),
                }))
              }
            />
          </AdminField>
          <AdminField label="설문 해설 Timeout (ms)" hint="설문 해설 LLM 호출 제한 시간입니다. CPU 기반 Ollama/llama.cpp는 180000-300000ms를 권장합니다.">
            <input
              min="30000"
              step="1000"
              type="number"
              value={String(Math.max(30000, Number(props.platformStatus?.llmSurveyFeedbackTimeoutMs || 300000) || 300000))}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  llmSurveyFeedbackTimeoutMs: Math.max(30000, Number(event.target.value || 300000) || 300000),
                }))
              }
            />
          </AdminField>
          <AdminField label="설문 해설 프롬프트" hint="사전·사후 설문 해설 생성 시 질문과 답변을 어떻게 해석할지 지시합니다. 비워두면 기본 학습 코치 프롬프트를 사용합니다.">
            <textarea
              value={props.platformStatus?.llmSurveyFeedbackPrompt || ""}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  llmSurveyFeedbackPrompt: event.target.value,
                }))
              }
              placeholder="질문 의미와 답변을 함께 보고 학습자에게 도움이 되는 해설을 작성하도록 지시할 수 있습니다."
            />
          </AdminField>
          <AdminField label="설문 해설 추가 옵션(JSON)" hint='Ollama Native는 {"temperature":0.2,"top_p":0.9}처럼 입력하면 options로 전달합니다. 고급 설정이 필요 없으면 비워두세요.'>
            <textarea
              value={props.platformStatus?.llmSurveyFeedbackOptionsJson || ""}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  llmSurveyFeedbackOptionsJson: event.target.value,
                }))
              }
              placeholder='{"temperature":0.2,"top_p":0.9}'
            />
          </AdminField>
          <AdminField label="Thinking 모드" hint="Qwen3, DeepSeek-R1 같은 추론 모델에서 생각 토큰을 생성할지 정합니다. CPU 운영에서는 끄는 쪽이 빠릅니다.">
            <select
              value={props.platformStatus?.llmThinkingMode || "disabled"}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  llmThinkingMode: ["enabled", "default"].includes(event.target.value) ? event.target.value : "disabled",
                }))
              }
            >
              <option value="disabled">끄기 - 빠른 응답</option>
              <option value="enabled">켜기 - 추론 모델 사용</option>
              <option value="default">모델 기본값</option>
            </select>
          </AdminField>
          <AdminField label="Qwen /no_think 지시" hint="Thinking 모드를 끌 때 시스템 프롬프트에 /no_think와 최종 답변만 출력하라는 지시를 자동으로 추가합니다.">
            <label className="toggle">
              <input
                checked={props.platformStatus?.llmNoThinkDirectiveEnabled !== false}
                onChange={(event) =>
                  props.setPlatformStatus((current) => ({
                    ...current,
                    llmNoThinkDirectiveEnabled: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              <span>{props.platformStatus?.llmNoThinkDirectiveEnabled !== false ? "자동 추가" : "추가 안 함"}</span>
            </label>
          </AdminField>
          <AdminField label="웹 검색 보강" hint="최신 정보가 필요하거나 모델이 답을 모를 때 Google 검색 결과를 근거로 다시 요약합니다.">
            <label className="toggle">
              <input
                checked={props.platformStatus?.llmWebSearchEnabled !== false}
                onChange={(event) =>
                  props.setPlatformStatus((current) => ({
                    ...current,
                    llmWebSearchEnabled: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              <span>{props.platformStatus?.llmWebSearchEnabled !== false ? "사용" : "사용 안 함"}</span>
            </label>
          </AdminField>
          <AdminField label="Google 검색 API Key" hint="Google Custom Search JSON API 키입니다. 새 키 입력 시 저장값을 교체합니다.">
            <input
              type="password"
              value={props.platformStatus?.googleSearchApiKey || ""}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  googleSearchApiKey: event.target.value,
                  googleSearchApiKeyClearRequested: false,
                }))
              }
              placeholder={googleSearchApiKeyConfigured ? "새 키 입력 시에만 교체" : "Google Custom Search API Key"}
            />
          </AdminField>
          <div className="admin-inline-actions">
            <button
              className="mini-btn"
              onClick={() =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  googleSearchApiKey: "",
                  googleSearchApiKeyClearRequested: false,
                }))
              }
              type="button"
            >
              검색 키 입력 취소
            </button>
            <button
              className="mini-btn danger-toggle"
              disabled={!googleSearchApiKeyConfigured}
              onClick={() =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  googleSearchApiKey: "",
                  googleSearchApiKeyClearRequested: true,
                }))
              }
              type="button"
            >
              저장된 검색 키 삭제
            </button>
            {props.platformStatus?.googleSearchApiKeyClearRequested ? <span className="hint">저장 시 기존 Google 검색 API Key가 삭제됩니다.</span> : null}
            {googleSearchApiKeyConfigured ? <span className="hint">{googleSearchApiKeySource === "db" ? "관리자 화면에 저장된 키를 사용합니다." : "환경 변수 키를 사용합니다."}</span> : null}
          </div>
          <AdminField label="검색 엔진 ID" hint="Google Programmable Search Engine의 CX 값입니다.">
            <input
              value={props.platformStatus?.googleSearchCx || ""}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  googleSearchCx: event.target.value,
                }))
              }
              placeholder="예: 0123456789abcdefg"
            />
          </AdminField>
          <AdminField label="검색 타임아웃(ms)" hint="Google 검색 API 응답을 기다릴 최대 시간입니다.">
            <input
              min="1000"
              step="500"
              type="number"
              value={String(Math.max(1000, Number(props.platformStatus?.llmWebSearchTimeoutMs || 8000) || 8000))}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  llmWebSearchTimeoutMs: Math.max(1000, Number(event.target.value || 8000) || 8000),
                }))
              }
            />
          </AdminField>
          <AdminField label="검색 결과 수" hint="LLM에 전달할 Google 검색 결과 개수입니다. 1-10개 사이로 제한됩니다.">
            <input
              min="1"
              max="10"
              step="1"
              type="number"
              value={String(Math.min(10, Math.max(1, Number(props.platformStatus?.llmWebSearchResultLimit || 5) || 5)))}
              onChange={(event) =>
                props.setPlatformStatus((current) => ({
                  ...current,
                  llmWebSearchResultLimit: Math.min(10, Math.max(1, Number(event.target.value || 5) || 5)),
                }))
              }
            />
          </AdminField>
          <AdminField label="관리자 제한 제외" hint="관리자 계정은 운영 테스트를 위해 일일 질문 제한을 적용하지 않도록 할 수 있습니다.">
            <label className="toggle">
              <input
                checked={props.platformStatus?.llmDailyQuotaAdminBypass !== false}
                onChange={(event) =>
                  props.setPlatformStatus((current) => ({
                    ...current,
                    llmDailyQuotaAdminBypass: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              <span>{props.platformStatus?.llmDailyQuotaAdminBypass !== false ? "제한 제외" : "제한 적용"}</span>
            </label>
          </AdminField>
          <StatusMessage {...props.llmStatus} />
        </div>
      </div>
    </section>
  );
}
