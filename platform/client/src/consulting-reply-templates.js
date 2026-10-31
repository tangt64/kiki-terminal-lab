export const CONSULTING_REPLY_PLACEHOLDERS = [
  ["{{name}}", "요청자 이름"],
  ["{{project}}", "선택 프로젝트"],
  ["{{workload}}", "워크로드"],
  ["{{flavor}}", "희망 GPU Flavor"],
  ["{{gpuCount}}", "GPU 수량"],
  ["{{reservationHours}}", "예약 시간"],
  ["{{storage}}", "추가 스토리지"],
  ["{{floatingIp}}", "Floating IP"],
  ["{{runtime}}", "런타임"],
  ["{{timeline}}", "희망 일정"],
  ["{{budget}}", "예산 범위"],
];

export const DEFAULT_CONSULTING_REPLY_TEMPLATES = {
  aiGpu: [
    {
      key: "gpu-reviewing",
      label: "검토 중",
      status: "reviewing",
      subject: "[Terminal Lab] AI/GPU 예약·견적 요청 검토 중 - {{project}}",
      note: [
        "{{name}}님, AI/GPU 예약·견적 요청을 확인했습니다.",
        "",
        "선택 프로젝트: {{project}}",
        "희망 Flavor: {{flavor}}",
        "GPU 수량: {{gpuCount}}",
        "희망 기간: {{reservationHours}}",
        "",
        "GPU Quota, 예약 가능 시간, 비용 정책을 확인한 뒤 회신드리겠습니다.",
      ].join("\n"),
    },
    {
      key: "gpu-more-info",
      label: "추가 정보 요청",
      status: "answered",
      subject: "[Terminal Lab] AI/GPU 자원 검토를 위한 추가 정보 요청",
      note: [
        "{{name}}님, AI/GPU 자원 검토를 위해 추가 정보가 필요합니다.",
        "",
        "아래 내용을 알려주시면 예약 가능 여부와 비용을 더 정확히 확인할 수 있습니다.",
        "- 필요한 GPU 모델 또는 최소 VRAM",
        "- 사용 예정 기간과 시간대",
        "- 데이터 크기와 스토리지 필요 용량",
        "- CUDA/드라이버/컨테이너 이미지 요구사항",
        "- 외부 접속 또는 Floating IP 필요 여부",
        "",
        "정보를 확인하는 대로 다음 단계로 진행하겠습니다.",
      ].join("\n"),
    },
    {
      key: "gpu-quote-ready",
      label: "견적 안내",
      status: "answered",
      subject: "[Terminal Lab] AI/GPU 랩 구성 검토 결과 안내 - {{project}}",
      note: [
        "{{name}}님, 요청하신 AI/GPU 랩 구성 검토가 완료되었습니다.",
        "",
        "대상 프로젝트: {{project}}",
        "검토 Flavor: {{flavor}}",
        "GPU 수량: {{gpuCount}}",
        "예약 시간: {{reservationHours}}",
        "",
        "운영 정책과 비용 조건을 확인한 뒤 진행 가능 범위를 안내드립니다.",
        "진행을 원하시면 회신해 주세요.",
      ].join("\n"),
    },
  ],
  general: [
    {
      key: "general-reviewing",
      label: "검토 중",
      status: "reviewing",
      subject: "[Terminal Lab] 상담 문의 검토 중 - {{name}}님",
      note: [
        "{{name}}님, 남겨주신 상담 문의를 확인했습니다.",
        "",
        "요청 내용을 검토한 뒤 가능한 일정과 진행 방법을 안내드리겠습니다.",
      ].join("\n"),
    },
    {
      key: "general-more-info",
      label: "추가 정보 요청",
      status: "answered",
      subject: "[Terminal Lab] 상담 문의 추가 정보 요청",
      note: [
        "{{name}}님, 상담 문의 검토를 위해 추가 정보가 필요합니다.",
        "",
        "원하시는 진행 일정, 대상 인원, 필요한 기술 범위, 예산 범위를 알려주시면 더 정확히 안내드리겠습니다.",
      ].join("\n"),
    },
    {
      key: "general-answered",
      label: "답변 완료",
      status: "answered",
      subject: "[Terminal Lab] 상담 문의 회신 - {{name}}님",
      note: [
        "{{name}}님, 문의 주신 내용에 대해 회신드립니다.",
        "",
        "요청하신 내용은 진행 가능 여부와 운영 일정을 확인한 뒤 안내드릴 수 있습니다.",
        "세부 일정 협의가 필요하면 편하신 시간을 알려주세요.",
      ].join("\n"),
    },
  ],
};

function normalizeTemplateStatus(value, fallback = "reviewing") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["requested", "reviewing", "answered", "closed"].includes(normalized) ? normalized : fallback;
}

function normalizeTemplateList(value, defaults) {
  const source = Array.isArray(value) && value.length ? value : defaults;
  return source.slice(0, 6).map((item, index) => {
    const fallback = defaults[index] || defaults[0] || {};
    const key = String(item?.key || fallback.key || `template-${index + 1}`).trim();
    const label = String(item?.label || fallback.label || `템플릿 ${index + 1}`).trim();
    const note = String(item?.note || fallback.note || "").trim();
    return {
      key: key || `template-${index + 1}`,
      label: label || `템플릿 ${index + 1}`,
      status: normalizeTemplateStatus(item?.status, fallback.status || "reviewing"),
      subject: String(item?.subject || fallback.subject || "").trim(),
      note,
    };
  });
}

export function normalizeConsultingReplyTemplates(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    aiGpu: normalizeTemplateList(source.aiGpu, DEFAULT_CONSULTING_REPLY_TEMPLATES.aiGpu),
    general: normalizeTemplateList(source.general, DEFAULT_CONSULTING_REPLY_TEMPLATES.general),
  };
}

export function renderConsultingReplyTemplateNote(template, context = {}) {
  return renderConsultingReplyTemplateText(template?.note, context);
}

export function renderConsultingReplyTemplateSubject(template, context = {}) {
  return renderConsultingReplyTemplateText(template?.subject, context);
}

export function renderConsultingReplyTemplateText(value, context = {}) {
  return String(value || "").trim().replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const value = context[key];
    if (value === null || value === undefined || value === "") return "-";
    return String(value);
  });
}
