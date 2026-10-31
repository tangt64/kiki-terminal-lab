import { useEffect, useState } from "react";
import { api } from "./portal-state.js";
import {
  AdminField,
  OtpQrPreview,
  accessEventLabel,
  formatDateTime,
} from "./portal-views.jsx";

function formatCloudCost(value) {
  return new Intl.NumberFormat("ko-KR").format(Math.max(0, Number(value || 0))) + "원";
}

function CloudUsageCost({ props }) {
  const [cicdRuns, setCicdRuns] = useState([]);
  const activeStatuses = new Set(["requested", "approved", "provisioning", "creating", "building", "running", "active", "available"]);
  const vms = (props.selfServiceVms || []).filter((item) => activeStatuses.has(String(item.status || "").toLowerCase()));
  const labs = (props.customLabRequests || []).filter((item) => activeStatuses.has(String(item.status || "").toLowerCase()));
  const containers = (props.zunContainers || []).filter((item) => activeStatuses.has(String(item.status || "").toLowerCase()));
  const clusters = (props.magnumClusters || []).filter((item) => activeStatuses.has(String(item.status || "").toLowerCase()));
  const databases = (props.troveInstances || []).filter((item) => activeStatuses.has(String(item.status || "").toLowerCase()));
  const prices = props.platformStatus?.pocFlavorDailyPrices || {};
  const advancedPrices = props.platformStatus?.pocAdvancedDailyPrices || {};
  const vmMonthlyCost = vms.reduce((sum, item) => sum + Math.max(0, Number(prices[item.flavor] || 0)) * Math.max(1, Number(item.instanceCount || 1)) * 30, 0);
  const labMonthlyCost = labs.reduce((sum, item) => sum + Math.max(0, Number(item.quotedPrice || item.price || 0)), 0);
  const containerMonthlyCost = containers.length * Math.max(0, Number(advancedPrices.container || 0)) * 30;
  const clusterMonthlyCost = clusters.length * Math.max(0, Number(advancedPrices.kubernetes || 0)) * 30;
  const databaseMonthlyCost = databases.reduce((sum, item) => {
    const sizeGb = Math.max(0, Number(item.sizeGb || item.volumeSizeGb || item.volumeSize || 0));
    return sum + (Math.max(0, Number(advancedPrices.database || 0)) + sizeGb * Math.max(0, Number(advancedPrices.databaseGb || 0))) * 30;
  }, 0);
  const cicdCost = cicdRuns.length * Math.max(0, Number(advancedPrices.cicdRun || 0));
  const paidPayments = (props.payments || []).filter((item) => String(item.status || "").toLowerCase() === "paid");
  const courseCost = paidPayments.reduce((sum, item) => sum + Math.max(0, Number(item.amount || 0)), 0);
  const cloudConsoleCost = vmMonthlyCost + labMonthlyCost;
  const usageSubtotal = courseCost + cloudConsoleCost + containerMonthlyCost + clusterMonthlyCost + databaseMonthlyCost + cicdCost;
  const resourceCount = vms.length + labs.length + containers.length + clusters.length + databases.length + cicdRuns.length;
  const freeMode = Boolean(props.platformStatus?.pocFreeModeEnabled);
  const discountAmount = freeMode ? usageSubtotal : 0;
  const payableTotal = Math.max(0, usageSubtotal - discountAmount);
  const rows = [
    ...paidPayments.map((payment) => ({
      key: `course-${payment.id}`,
      label: payment.courseTitle || `과정 #${payment.courseId}`,
      type: "과정",
      usage: "결제 완료",
      amount: Math.max(0, Number(payment.amount || 0)),
    })),
    { key: "database", label: "데이터베이스", type: "클라우드", usage: `${databases.length}개 · 30일 환산`, amount: databaseMonthlyCost },
    { key: "container", label: "컨테이너 랩", type: "클라우드", usage: `${containers.length}개 · 30일 환산`, amount: containerMonthlyCost },
    { key: "kubernetes", label: "쿠버네티스 클러스터", type: "클라우드", usage: `${clusters.length}개 · 30일 환산`, amount: clusterMonthlyCost },
    { key: "cicd", label: "CI/CD 파이프라인", type: "클라우드", usage: `${cicdRuns.length}회 실행`, amount: cicdCost },
    { key: "cloud-console", label: "클라우드 콘솔", type: "클라우드", usage: `${vms.length + labs.length}개 · 30일 환산`, amount: cloudConsoleCost },
  ];

  useEffect(() => {
    let cancelled = false;
    api("/api/cicd/runs")
      .then((payload) => {
        if (cancelled) return;
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        setCicdRuns((payload.runs || []).filter((run) => {
          const createdAt = new Date(run.createdAt || run.startedAt || 0);
          return Number.isFinite(createdAt.getTime()) && createdAt >= monthStart;
        }));
      })
      .catch(() => { if (!cancelled) setCicdRuns([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="simple-panel profile-cloud-cost">
      <div className="portal-detail-head">
        <div>
          <p className="card-label">클라우드 이용</p>
          <h3>이용 현황 및 비용</h3>
        </div>
        <button className="mini-btn" onClick={() => props.setSection?.("terminalCloud")} type="button">클라우드 콘솔</button>
      </div>
      <div className="profile-cloud-cost-grid">
        <div><span>이용금액</span><strong>{formatCloudCost(usageSubtotal)}</strong></div>
        <div><span>무료 할인</span><strong>{freeMode ? `-${formatCloudCost(discountAmount)}` : "0원"}</strong></div>
        <div><span>최종 청구액</span><strong>{formatCloudCost(payableTotal)}</strong></div>
        <div><span>사용 중 자원</span><strong>{resourceCount + "개"}</strong></div>
      </div>
      <div className="profile-billing-table" role="table" aria-label="과정 및 서비스 비용 상세">
        <div className="profile-billing-row is-head" role="row">
          <span>항목</span><span>사용 기준</span><span>이용금액</span><span>청구액</span>
        </div>
        {rows.map((row) => (
          <div className="profile-billing-row" key={row.key} role="row">
            <span><small>{row.type}</small><strong>{row.label}</strong></span>
            <span>{row.usage}</span>
            <span>{formatCloudCost(row.amount)}</span>
            <strong>{formatCloudCost(freeMode ? 0 : row.amount)}</strong>
          </div>
        ))}
      </div>
      <p className="hint">과정은 결제 완료 금액, 클라우드 자원은 현재 사용량의 30일 환산 예상액입니다. {freeMode ? "무료 운영 기간에는 모든 항목의 최종 청구액이 0원입니다." : "실제 청구액은 사용 기간과 운영 정책에 따라 달라질 수 있습니다."}</p>
    </section>
  );
}

export default function ProfileView(props) {
  return (
    <section className="portal-stack">
      <form className="simple-panel admin-form" onSubmit={props.onProfileSubmit}>
        <div className="portal-detail-head">
          <div>
            <p className="card-label">내 정보</p>
            <h3>사용자 정보 수정</h3>
          </div>
        </div>

        <div className="admin-form-grid compact-admin-grid">
          <AdminField label="이름">
            <input value={props.profileForm.name} onChange={(event) => props.setProfileForm((current) => ({ ...current, name: event.target.value }))} />
          </AdminField>
          <AdminField label="이메일">
            <input value={props.profileForm.email} onChange={(event) => props.setProfileForm((current) => ({ ...current, email: event.target.value }))} placeholder="name@example.com" />
          </AdminField>
          <AdminField label="아이디">
            <input disabled value={props.profileForm.username} />
          </AdminField>
          <AdminField label="권한">
            <input disabled value={props.profileForm.role === "admin" ? "관리자" : "학습자"} />
          </AdminField>
          <AdminField label="상태">
            <input disabled value={props.profileForm.status === "approved" ? "승인" : "미승인"} />
          </AdminField>
          <AdminField label="현재 비밀번호">
            <input type="password" value={props.profileForm.currentPassword} onChange={(event) => props.setProfileForm((current) => ({ ...current, currentPassword: event.target.value }))} placeholder="비밀번호 변경 시 입력" />
          </AdminField>
          <AdminField label="새 비밀번호">
            <input type="password" value={props.profileForm.newPassword} onChange={(event) => props.setProfileForm((current) => ({ ...current, newPassword: event.target.value }))} placeholder="변경하지 않으면 비워두기" />
          </AdminField>
          <AdminField label="새 비밀번호 확인">
            <input type="password" value={props.profileForm.confirmPassword} onChange={(event) => props.setProfileForm((current) => ({ ...current, confirmPassword: event.target.value }))} placeholder="새 비밀번호 확인" />
          </AdminField>
        </div>

        <button className="primary-btn save-btn" type="submit">저장</button>
        <div className="admin-inline-actions">
          <button className="mini-btn danger-mini-btn" onClick={props.onDeleteMyAccount} type="button">회원 탈퇴</button>
        </div>
      </form>

      <CloudUsageCost props={props} />

      <form className="simple-panel admin-form" onSubmit={props.onRedeemCourseCode}>
        <div className="portal-detail-head">
          <div>
            <p className="card-label">과정 코드</p>
            <h3>코드 등록</h3>
          </div>
        </div>
        <AdminField label="과정 코드">
          <input value={props.profileForm.courseCode} onChange={(event) => props.setProfileForm((current) => ({ ...current, courseCode: event.target.value }))} placeholder="과정 코드 입력" />
        </AdminField>
        <button className="ghost-btn" type="submit">코드 등록</button>
      </form>

      {props.session?.role === "admin" || props.platformStatus?.otpUserEnabled ? (
        <section className="simple-panel admin-form">
          <div className="portal-detail-head">
            <div>
              <p className="card-label">보안</p>
              <h3>OTP 설정</h3>
            </div>
            <div className="portal-meta">
              <span>{props.profileForm.otpEnabled ? "활성화됨" : "비활성화됨"}</span>
            </div>
          </div>
          <p className="hint">
            {props.session?.role === "admin" && props.platformStatus?.otpAdminRequired
              ? "관리자 계정은 OTP 등록이 필요합니다. 인증 앱에 비밀키를 등록한 뒤 6자리 코드를 입력해 활성화하세요."
              : "인증 앱에 비밀키를 등록한 뒤 6자리 코드를 입력해 OTP를 활성화할 수 있습니다."}
          </p>
          {props.profileForm.otpSetupSecret ? (
            <div className="detail-block">
              <div className="otp-setup-grid">
                <div className="otp-setup-qr">
                  <OtpQrPreview alt="내 계정 OTP 등록 QR" otpauthUrl={props.profileForm.otpSetupUri} />
                </div>
                <div className="otp-setup-fields">
                  <div><strong>비밀키</strong></div>
                  <div className="hint mono-block">{props.profileForm.otpSetupSecret}</div>
                  <div className="hint mono-block">{props.profileForm.otpSetupUri}</div>
                </div>
              </div>
              <AdminField label="OTP 코드">
                <input value={props.profileForm.otpSetupCode} onChange={(event) => props.setProfileForm((current) => ({ ...current, otpSetupCode: event.target.value }))} placeholder="앱에 표시된 6자리 코드" />
              </AdminField>
              <div className="admin-inline-actions">
                <button className="mini-btn primary-mini-btn" onClick={props.onConfirmOtpSetup} type="button">OTP 활성화</button>
                <button className="mini-btn" onClick={props.onStartOtpSetup} type="button">비밀키 재생성</button>
              </div>
            </div>
          ) : (
            <button className="ghost-btn" onClick={props.onStartOtpSetup} type="button">OTP 설정 시작</button>
          )}
          {props.profileForm.otpEnabled ? (
            <div className="detail-block">
              <AdminField label="OTP 해제 코드">
                <input value={props.profileForm.otpDisableCode} onChange={(event) => props.setProfileForm((current) => ({ ...current, otpDisableCode: event.target.value }))} placeholder="현재 인증 앱 6자리 코드" />
              </AdminField>
              <button className="mini-btn danger-mini-btn" onClick={props.onDisableOtp} type="button">OTP 비활성화</button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">보안</p>
            <h3>최근 접속 이력</h3>
          </div>
        </div>
        {(props.myAccessLogs || []).length ? (
          <div className="admin-table admin-table-scroll">
            <div className="admin-table-head admin-course-grid">
              <span>시각</span>
              <span>이벤트</span>
              <span>접속 정보</span>
            </div>
            {(props.myAccessLogs || []).map((log) => (
              <div className="admin-table-row admin-course-grid" key={log.id}>
                <span>{formatDateTime(log.createdAt)}</span>
                <span>{accessEventLabel(log.eventType)}</span>
                <span>
                  <div className="hint">{`IP: ${log.ipAddress || "-"}`}</div>
                  <div className="hint">{log.userAgent || "-"}</div>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="hint">아직 확인할 접속 이력이 없습니다.</div>
        )}
      </section>
    </section>
  );
}
