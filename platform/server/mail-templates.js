const MAIL_TEMPLATE_CATALOG = {
  signup_pending: {
    label: "회원가입 접수",
    placeholders: ["name", "username", "signupReason", "targetCourseTitle", "inviteCourseTitle", "welcomeCouponCode", "welcomeCouponBenefitLabel"],
    subject: "[KIKI OS TERMINAL-LAB] 회원가입이 접수되었습니다",
    text: [
      "{name}님, 회원가입이 정상적으로 접수되었습니다.",
      "",
      "아이디: {username}",
      "가입 사유: {signupReason}",
      "현재 상태: 관리자 확인 대기",
      "과정 코드 적용: {targetCourseTitle}",
      "초대장 연결 과정: {inviteCourseTitle}",
      "웰컴 쿠폰: {welcomeCouponCode} ({welcomeCouponBenefitLabel} / 첫 결제 전용)",
    ].join("\n"),
  },
  signup_approved: {
    label: "회원가입 승인",
    placeholders: ["name", "username"],
    subject: "[KIKI OS TERMINAL-LAB] 계정 승인이 완료되었습니다",
    text: [
      "{name}님, 관리자 승인 처리가 완료되었습니다.",
      "",
      "아이디: {username}",
      "이제 서비스에 로그인할 수 있습니다.",
    ].join("\n"),
  },
  purchase_requested: {
    label: "과정 신청 접수",
    placeholders: ["name", "requestLabel", "courseTitle", "formattedPrice", "approvalGuide"],
    subject: "[KIKI OS TERMINAL-LAB] {requestLabel}이 접수되었습니다",
    text: [
      "{name}님, {requestLabel}이 접수되었습니다.",
      "",
      "과정명: {courseTitle}",
      "금액: {formattedPrice}",
      "{approvalGuide}",
    ].join("\n"),
  },
  purchase_request_approved: {
    label: "과정 신청 승인",
    placeholders: ["name", "requestLabel", "courseTitle"],
    subject: "[KIKI OS TERMINAL-LAB] {requestLabel}이 승인되었습니다",
    text: [
      "{name}님, {requestLabel}이 승인되었습니다.",
      "",
      "과정명: {courseTitle}",
      "이제 포털에서 해당 과정을 바로 이용할 수 있습니다.",
    ].join("\n"),
  },
  purchase_request_rejected: {
    label: "과정 신청 반려",
    placeholders: ["name", "requestLabel", "courseTitle", "reviewNote"],
    subject: "[KIKI OS TERMINAL-LAB] {requestLabel}이 반려되었습니다",
    text: [
      "{name}님, {requestLabel}이 반려되었습니다.",
      "",
      "과정명: {courseTitle}",
      "사유: {reviewNote}",
    ].join("\n"),
  },
  signup_welcome_coupon: {
    label: "회원가입 웰컴 쿠폰",
    placeholders: ["name", "couponCode", "benefitLabel", "expiresAt"],
    subject: "[KIKI OS TERMINAL-LAB] 회원가입 웰컴 쿠폰이 도착했습니다",
    text: [
      "{name}님, 회원가입 웰컴 쿠폰이 발급되었습니다.",
      "",
      "쿠폰 코드: {couponCode}",
      "혜택: {benefitLabel} (첫 결제 전용)",
      "대상 과정: 전체 유료 과정",
      "만료일: {expiresAt}",
    ].join("\n"),
  },
  payment_paid: {
    label: "일반 결제 완료",
    placeholders: ["name", "courseTitle", "formattedAmount"],
    subject: "[KIKI OS TERMINAL-LAB] 결제가 완료되었습니다",
    text: [
      "{name}님의 결제가 완료되었습니다.",
      "",
      "과정명: {courseTitle}",
      "결제 금액: {formattedAmount}",
      "이제 해당 과정을 바로 이용할 수 있습니다.",
    ].join("\n"),
  },
  payment_failed: {
    label: "일반 결제 실패",
    placeholders: ["name", "orderId", "failureDetail"],
    subject: "[KIKI OS TERMINAL-LAB] 결제 실패 안내",
    text: [
      "{name}님의 결제가 실패로 기록되었습니다.",
      "",
      "주문번호: {orderId}",
      "{failureDetail}",
    ].join("\n"),
  },
  payment_refunded: {
    label: "일반 결제 환불",
    placeholders: ["name", "reason", "formattedAmount"],
    subject: "[KIKI OS TERMINAL-LAB] 환불 처리되었습니다",
    text: [
      "{name}님의 환불이 처리되었습니다.",
      "",
      "환불 사유: {reason}",
      "환불 금액: {formattedAmount}",
    ].join("\n"),
  },
  custom_lab_payment_paid: {
    label: "PoC 결제 완료",
    placeholders: ["name", "requestTitle", "orderId", "formattedAmount"],
    subject: "[KIKI OS TERMINAL-LAB] PoC 결제가 완료되었습니다",
    text: [
      "{name}님의 PoC 결제가 완료되었습니다.",
      "",
      "요청명: {requestTitle}",
      "주문번호: {orderId}",
      "결제 금액: {formattedAmount}",
      "운영팀이 검토 후 다음 일정을 안내드릴 예정입니다.",
    ].join("\n"),
  },
  custom_lab_payment_failed: {
    label: "PoC 결제 실패",
    placeholders: ["name", "requestTitle", "reason"],
    subject: "[KIKI OS TERMINAL-LAB] PoC 결제가 실패했습니다",
    text: [
      "{name}님의 PoC 결제가 실패로 기록되었습니다.",
      "",
      "요청명: {requestTitle}",
      "사유: {reason}",
      "잠시 후 다시 시도하시거나 운영팀에 문의해 주세요.",
    ].join("\n"),
  },
  custom_lab_quoted: {
    label: "PoC 견적 안내",
    placeholders: ["name", "requestTitle", "formattedQuotedAmount", "reviewNote", "nextStepGuide"],
    subject: "[KIKI OS TERMINAL-LAB] PoC 견적이 등록되었습니다",
    text: [
      "{name}님, PoC 견적이 등록되었습니다.",
      "",
      "요청명: {requestTitle}",
      "견적 금액: {formattedQuotedAmount}",
      "안내: {reviewNote}",
      "{nextStepGuide}",
    ].join("\n"),
  },
  custom_lab_rejected: {
    label: "PoC 구성 반려",
    placeholders: ["name", "requestTitle", "reviewNote"],
    subject: "[KIKI OS TERMINAL-LAB] PoC 구성이 반려되었습니다",
    text: [
      "{name}님, PoC 구성이 반려되었습니다.",
      "",
      "요청명: {requestTitle}",
      "사유: {reviewNote}",
    ].join("\n"),
  },
  course_assigned: {
    label: "관리자 과정 할당",
    placeholders: ["name", "courseTitle"],
    subject: "[KIKI OS TERMINAL-LAB] 과정이 할당되었습니다",
    text: [
      "{name}님께 과정이 할당되었습니다.",
      "",
      "과정명: {courseTitle}",
      "이제 포털에서 해당 과정을 바로 이용할 수 있습니다.",
    ].join("\n"),
  },
  external_ssh_approved: {
    label: "외부 SSH 승인",
    placeholders: ["name", "host", "ports", "sshUser"],
    subject: "[KIKI OS TERMINAL-LAB] 외부 SSH 요청이 승인되었습니다",
    text: [
      "{name}님의 외부 SSH 요청이 승인되었습니다.",
      "",
      "접속 호스트: {host}",
      "포트: {ports}",
      "SSH 사용자: {sshUser}",
    ].join("\n"),
  },
  external_ssh_rejected: {
    label: "외부 SSH 반려",
    placeholders: ["name", "reviewNote"],
    subject: "[KIKI OS TERMINAL-LAB] 외부 SSH 요청이 반려되었습니다",
    text: [
      "{name}님의 외부 SSH 요청이 반려되었습니다.",
      "",
      "사유: {reviewNote}",
    ].join("\n"),
  },
  invite_created: {
    label: "초대장 발급",
    placeholders: ["inviteCode", "courseTitle", "expiresAt"],
    subject: "[KIKI OS TERMINAL-LAB] 초대장이 발급되었습니다",
    text: [
      "KIKI OS TERMINAL-LAB 초대장이 발급되었습니다.",
      "",
      "초대장 코드: {inviteCode}",
      "연결 과정: {courseTitle}",
      "만료 일시: {expiresAt}",
      "회원가입 시 이 코드를 입력해 주세요.",
    ].join("\n"),
  },
  written_exam_result: {
    label: "지식 시험 결과",
    placeholders: ["name", "courseTitle", "examTitle", "score", "totalPoints", "resultLabel"],
    subject: "[KIKI OS TERMINAL-LAB] 지식 시험 결과 - {courseTitle}",
    text: [
      "{name}님의 지식 시험 결과입니다.",
      "",
      "과정명: {courseTitle}",
      "시험명: {examTitle}",
      "점수: {score}/{totalPoints}",
      "결과: {resultLabel}",
    ].join("\n"),
  },
  lab_exam_result: {
    label: "랩 시험 결과",
    placeholders: ["name", "courseTitle", "examTitle", "score", "totalPoints", "resultLabel", "reviewStatusLabel", "reviewNote", "snapshotUrl"],
    subject: "[KIKI OS TERMINAL-LAB] 랩 시험 결과 - {courseTitle}",
    text: [
      "{name}님의 랩 시험 결과입니다.",
      "",
      "과정명: {courseTitle}",
      "시험명: {examTitle}",
      "점수: {score}/{totalPoints}",
      "결과: {resultLabel}",
      "검토 상태: {reviewStatusLabel}",
      "관리자 메모: {reviewNote}",
      "결과 스냅샷: {snapshotUrl}",
    ].join("\n"),
  },
  course_survey_submitted: {
    label: "과정 설문 제출",
    placeholders: ["name", "courseTitle", "phaseLabel", "submittedAt"],
    subject: "[KIKI OS TERMINAL-LAB] {phaseLabel} 설문이 제출되었습니다 - {courseTitle}",
    text: [
      "{name}님의 {phaseLabel} 설문이 정상적으로 제출되었습니다.",
      "",
      "과정명: {courseTitle}",
      "제출 시각: {submittedAt}",
      "소중한 의견을 남겨 주셔서 감사합니다.",
    ].join("\n"),
  },
  certificate_issued: {
    label: "자격증 발급",
    placeholders: ["name", "courseTitle", "certificateCode", "verifyPath"],
    subject: "[KIKI OS TERMINAL-LAB] 자격증이 발급되었습니다 - {courseTitle}",
    text: [
      "{name}님의 자격증이 발급되었습니다.",
      "",
      "과정명: {courseTitle}",
      "자격증 번호: {certificateCode}",
      "검증 URL: {verifyPath}",
    ].join("\n"),
  },
  admin_created_user: {
    label: "관리자 생성 계정 안내",
    placeholders: ["name", "username"],
    subject: "[KIKI OS TERMINAL-LAB] 계정이 생성되었습니다",
    text: [
      "{name}님 계정이 생성되었습니다.",
      "",
      "아이디: {username}",
      "관리자가 생성한 계정입니다. 로그인 후 비밀번호를 변경해 주세요.",
    ].join("\n"),
  },
  admin_test: {
    label: "관리자 테스트 메일",
    placeholders: ["adminNameOrUsername", "sentAt"],
    subject: "[KIKI OS TERMINAL-LAB] 메일 설정 테스트",
    text: [
      "관리자 메일 설정 테스트 메시지입니다.",
      "",
      "보낸 관리자: {adminNameOrUsername}",
      "보낸 시각: {sentAt}",
    ].join("\n"),
  },
};

function normalizeMailTemplateValue(value) {
  return String(value ?? "").trim();
}

function compactRenderedTemplate(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .filter((line, index, lines) => {
      if (line.trim()) return true;
      const prev = lines[index - 1];
      return prev == null || prev.trim();
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderMailTemplateString(template, variables = {}) {
  return compactRenderedTemplate(
    String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => normalizeMailTemplateValue(variables[key])),
  );
}

export function buildMailFromCatalog(templateKey, variables = {}) {
  const definition = MAIL_TEMPLATE_CATALOG[templateKey];
  if (!definition) {
    return {
      subject: "",
      text: "",
      templateKey,
      templateVariables: { ...variables },
    };
  }
  return {
    subject: renderMailTemplateString(definition.subject, variables),
    text: renderMailTemplateString(definition.text, variables),
    templateKey,
    templateVariables: { ...variables },
  };
}

function buildPurchaseRequestLabel(isGovernmentCourse) {
  return isGovernmentCourse ? "과정 신청" : "과정 구매 요청";
}

function buildPurchaseApprovalGuide(isGovernmentCourse) {
  return isGovernmentCourse
    ? "관리자가 대상자 조건을 확인한 뒤 승인 결과를 안내드릴 예정입니다."
    : "관리자 확인 후 결과를 안내드릴 예정입니다.";
}

export function listMailTemplateCatalog() {
  return Object.entries(MAIL_TEMPLATE_CATALOG).map(([key, value]) => ({
    key,
    label: value.label,
    placeholders: Array.isArray(value.placeholders) ? value.placeholders : [],
    subject: value.subject,
    text: value.text,
  }));
}

export function buildSignupPendingMail({
  name,
  username,
  signupReason,
  targetCourseTitle = "",
  inviteCourseTitle = "",
  welcomeCouponCode = "",
  welcomeCouponBenefitLabel = "",
}) {
  return buildMailFromCatalog("signup_pending", {
    name: String(name || username || "사용자").trim(),
    username: String(username || "").trim(),
    signupReason: String(signupReason || "").trim(),
    targetCourseTitle: String(targetCourseTitle || "").trim(),
    inviteCourseTitle: String(inviteCourseTitle || "").trim(),
    welcomeCouponCode: String(welcomeCouponCode || "").trim(),
    welcomeCouponBenefitLabel: String(welcomeCouponBenefitLabel || "").trim(),
  });
}

export function buildSignupApprovedMail({ name, username }) {
  return buildMailFromCatalog("signup_approved", {
    name: String(name || username || "사용자").trim(),
    username: String(username || "").trim(),
  });
}

export function buildPurchaseRequestedMail({ name, courseTitle, formattedPrice, isGovernmentCourse = false }) {
  return buildMailFromCatalog("purchase_requested", {
    name: String(name || "사용자").trim(),
    requestLabel: buildPurchaseRequestLabel(isGovernmentCourse),
    courseTitle: String(courseTitle || "").trim(),
    formattedPrice: String(formattedPrice || "").trim(),
    approvalGuide: buildPurchaseApprovalGuide(isGovernmentCourse),
  });
}

export function buildPurchaseApprovedMail({ name, courseTitle, isGovernmentCourse = false }) {
  return buildMailFromCatalog("purchase_request_approved", {
    name: String(name || "사용자").trim(),
    requestLabel: buildPurchaseRequestLabel(isGovernmentCourse),
    courseTitle: String(courseTitle || "").trim(),
  });
}

export function buildPurchaseRejectedMail({ name, courseTitle, reviewNote, isGovernmentCourse = false }) {
  return buildMailFromCatalog("purchase_request_rejected", {
    name: String(name || "사용자").trim(),
    requestLabel: buildPurchaseRequestLabel(isGovernmentCourse),
    courseTitle: String(courseTitle || "").trim(),
    reviewNote: String(reviewNote || "").trim(),
  });
}

export function buildSignupWelcomeCouponMail({ name, username, couponCode, benefitLabel, expiresAt }) {
  return buildMailFromCatalog("signup_welcome_coupon", {
    name: String(name || username || "사용자").trim(),
    couponCode: String(couponCode || "").trim(),
    benefitLabel: String(benefitLabel || "").trim(),
    expiresAt: String(expiresAt || "-").trim() || "-",
  });
}

export function buildPaymentPaidMail({ name, courseTitle, formattedAmount }) {
  return buildMailFromCatalog("payment_paid", {
    name: String(name || "사용자").trim(),
    courseTitle: String(courseTitle || "").trim(),
    formattedAmount: String(formattedAmount || "").trim(),
  });
}

export function buildPaymentFailedMail({ name, orderId, failureDetail }) {
  return buildMailFromCatalog("payment_failed", {
    name: String(name || "사용자").trim(),
    orderId: String(orderId || "").trim(),
    failureDetail: String(failureDetail || "").trim(),
  });
}

export function buildPaymentRefundedMail({ name, reason, formattedAmount }) {
  return buildMailFromCatalog("payment_refunded", {
    name: String(name || "사용자").trim(),
    reason: String(reason || "").trim(),
    formattedAmount: String(formattedAmount || "").trim(),
  });
}

export function buildCustomLabPaymentPaidMail({ name, requestTitle, orderId, formattedAmount }) {
  return buildMailFromCatalog("custom_lab_payment_paid", {
    name: String(name || "사용자").trim(),
    requestTitle: String(requestTitle || "").trim(),
    orderId: String(orderId || "").trim(),
    formattedAmount: String(formattedAmount || "").trim(),
  });
}

export function buildCustomLabPaymentFailedMail({ name, requestTitle, reason }) {
  return buildMailFromCatalog("custom_lab_payment_failed", {
    name: String(name || "사용자").trim(),
    requestTitle: String(requestTitle || "").trim(),
    reason: String(reason || "").trim(),
  });
}

export function buildCustomLabQuotedMail({ name, requestTitle, formattedQuotedAmount = "", reviewNote = "" }) {
  const hasQuotedAmount = Boolean(String(formattedQuotedAmount || "").trim());
  return buildMailFromCatalog("custom_lab_quoted", {
    name: String(name || "요청자").trim(),
    requestTitle: String(requestTitle || "").trim(),
    formattedQuotedAmount: String(formattedQuotedAmount || "").trim(),
    reviewNote: String(reviewNote || "").trim(),
    nextStepGuide: hasQuotedAmount
      ? "포털에서 결제를 진행하면 바로 다음 단계를 이어갈 수 있습니다."
      : "운영팀 안내에 따라 다음 단계를 진행해 주세요.",
  });
}

export function buildCustomLabRejectedMail({ name, requestTitle, reviewNote = "" }) {
  return buildMailFromCatalog("custom_lab_rejected", {
    name: String(name || "요청자").trim(),
    requestTitle: String(requestTitle || "").trim(),
    reviewNote: String(reviewNote || "").trim(),
  });
}

export function buildCourseAssignedMail({ name, courseTitle }) {
  return buildMailFromCatalog("course_assigned", {
    name: String(name || "사용자").trim(),
    courseTitle: String(courseTitle || "").trim(),
  });
}

export function buildExternalSshApprovedMail({ name, host, ports = [], sshUser }) {
  return buildMailFromCatalog("external_ssh_approved", {
    name: String(name || "사용자").trim(),
    host: String(host || "").trim(),
    ports: Array.isArray(ports) ? ports.join(", ") : String(ports || "").trim(),
    sshUser: String(sshUser || "").trim(),
  });
}

export function buildExternalSshRejectedMail({ name, reviewNote = "" }) {
  return buildMailFromCatalog("external_ssh_rejected", {
    name: String(name || "사용자").trim(),
    reviewNote: String(reviewNote || "").trim(),
  });
}

export function buildInviteCreatedMail({ inviteCode, courseTitle = "", expiresAt = "" }) {
  return buildMailFromCatalog("invite_created", {
    inviteCode: String(inviteCode || "").trim(),
    courseTitle: String(courseTitle || "").trim(),
    expiresAt: String(expiresAt || "").trim(),
  });
}

export function buildWrittenExamResultMail({ name, courseTitle, examTitle, score, totalPoints, passed }) {
  return buildMailFromCatalog("written_exam_result", {
    name: String(name || "사용자").trim(),
    courseTitle: String(courseTitle || "").trim(),
    examTitle: String(examTitle || "").trim(),
    score: String(score ?? "").trim(),
    totalPoints: String(totalPoints ?? "").trim(),
    resultLabel: passed ? "통과" : "미통과",
  });
}

export function buildLabExamResultMail({ name, courseTitle, examTitle, score, totalPoints, passed, reviewStatus, reviewNote, snapshotUrl }) {
  const normalizedReviewStatus = String(reviewStatus || "pending").trim().toLowerCase();
  const reviewStatusLabel = normalizedReviewStatus === "approved"
    ? "승인"
    : normalizedReviewStatus === "rejected"
      ? "반려"
      : "검토 대기";
  return buildMailFromCatalog("lab_exam_result", {
    name: String(name || "사용자").trim(),
    courseTitle: String(courseTitle || "").trim(),
    examTitle: String(examTitle || "").trim(),
    score: String(score ?? "").trim(),
    totalPoints: String(totalPoints ?? "").trim(),
    resultLabel: passed ? "통과" : "미통과",
    reviewStatusLabel,
    reviewNote: String(reviewNote || "-").trim(),
    snapshotUrl: String(snapshotUrl || "관리자 화면에서 확인").trim(),
  });
}

export function buildCourseSurveySubmittedMail({ name, courseTitle, phase, submittedAt }) {
  return buildMailFromCatalog("course_survey_submitted", {
    name: String(name || "사용자").trim(),
    courseTitle: String(courseTitle || "").trim(),
    phaseLabel: String(phase || "").trim().toLowerCase() === "post" ? "사후/NPS" : "사전",
    submittedAt: String(submittedAt || "").trim(),
  });
}

export function buildCertificateIssuedMail({ name, courseTitle, certificateCode, verifyPath }) {
  return buildMailFromCatalog("certificate_issued", {
    name: String(name || "사용자").trim(),
    courseTitle: String(courseTitle || "").trim(),
    certificateCode: String(certificateCode || "").trim(),
    verifyPath: String(verifyPath || "").trim(),
  });
}

export function buildAdminCreatedUserMail({ name, username }) {
  return buildMailFromCatalog("admin_created_user", {
    name: String(name || username || "사용자").trim(),
    username: String(username || "").trim(),
  });
}

export function buildAdminTestMail({ adminNameOrUsername, sentAt }) {
  return buildMailFromCatalog("admin_test", {
    adminNameOrUsername: String(adminNameOrUsername || "admin").trim(),
    sentAt: String(sentAt || "").trim(),
  });
}

export { MAIL_TEMPLATE_CATALOG };
