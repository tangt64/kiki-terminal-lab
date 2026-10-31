import { useMemo, useState } from "react";
import { AdminField, formatDateTime } from "./portal-views.jsx";

const ACTIVITY_PERIOD_META = {
  weekly: { label: "주간", userField: "activeWeek", hint: "최근 8주 고유 활동 사용자" },
  monthly: { label: "월간", userField: "activeMonth", hint: "최근 12개월 고유 활동 사용자" },
  yearly: { label: "연도별", userField: "activeYear", hint: "최근 4년 고유 활동 사용자" },
};

function getMarketingRecipientHint(mode, counts) {
  return {
    manual: "이메일 또는 아이디를 직접 입력해도, 마케팅 수신 동의가 확인된 사용자만 발송됩니다.",
    "@ALL": `마케팅 이메일 수신 동의자 ${counts.allConsent}명에게 발송합니다.`,
    "@APPROVED": `승인된 마케팅 이메일 수신 동의자 ${counts.approvedConsent}명에게 발송합니다.`,
    "@STUDENTS": `일반 마케팅 이메일 수신 동의자 ${counts.studentConsent}명에게 발송합니다.`,
    "@ACTIVE": "최근 접속한 사용자 중 마케팅 수신 동의가 확인된 계정에게 발송합니다.",
  }[mode] || "마케팅 수신 동의가 확인된 사용자만 발송됩니다.";
}

export function AdminMarketingActivityTab(props) {
  const [period, setPeriod] = useState("monthly");
  const stats = props.adminAccessStats || {};
  const users = Array.isArray(props.adminUsers) ? props.adminUsers : [];
  const seriesMap = stats.activitySeries || {};
  const chartSeries = Array.isArray(seriesMap[period]) ? seriesMap[period] : [];
  const marketingMailForm = props.marketingMailForm || {};
  const recipientMode = String(marketingMailForm.recipientMode || "@APPROVED").trim() || "@APPROVED";
  const consentUsers = users.filter((user) => user.marketingEmailConsent && String(user.email || "").trim());
  const counts = {
    allConsent: consentUsers.length,
    approvedConsent: consentUsers.filter((user) => user.status === "approved").length,
    studentConsent: consentUsers.filter((user) => user.role !== "admin").length,
  };
  const activeUsers = useMemo(() => {
    const field = ACTIVITY_PERIOD_META[period]?.userField || "activeMonth";
    return users
      .filter((user) => Boolean(user[field]))
      .sort((a, b) => new Date(b.lastActiveAt || 0).getTime() - new Date(a.lastActiveAt || 0).getTime())
      .slice(0, 20);
  }, [period, users]);
  const summaryItems = [
    { label: "현재 활성", value: stats.currentConnectedUsers ?? users.filter((user) => user.activeNow).length, hint: `${Number(stats.activeWithinMinutes || 2)}분 내 활동` },
    { label: "이번 주", value: users.filter((user) => user.activeWeek).length, hint: "주간 활성 사용자" },
    { label: "이번 달", value: stats.monthUsers ?? users.filter((user) => user.activeMonth).length, hint: "월간 활성 사용자" },
    { label: "마케팅 동의", value: counts.allConsent, hint: "이메일 수신 동의 기준" },
  ];
  const chartTitle = period === "yearly" ? "연도별 활성 현황" : `${ACTIVITY_PERIOD_META[period]?.label || "월간"} 활성 추이`;
  const visibleMax = Math.max(1, ...chartSeries.map((item) => Number(item.count || 0)));

  return (
    <section className="portal-stack">
      <div className="admin-summary-grid">
        {summaryItems.map((item) => (
          <div className="admin-summary-card" key={item.label}>
            <span className="card-label">{item.label}</span>
            <strong>{`${Number(item.value || 0)}명`}</strong>
            <div className="hint">{item.hint}</div>
          </div>
        ))}
      </div>

      <section className="admin-simple-card">
        <div className="admin-card-header">
          <div>
            <span className="card-label">마케팅 메일</span>
            <strong>이메일 수신 동의자에게 캠페인 발송</strong>
            <p className="hint">쿠폰, 이벤트, 신규 과정 안내처럼 광고성 성격이 있는 메일은 수신 동의가 확인된 사용자만 대상으로 합니다.</p>
          </div>
        </div>
        <form className="admin-form" onSubmit={props.onSendMarketingMail}>
          <div className="admin-form-grid compact-admin-grid">
            <AdminField label="수신 대상" hint={getMarketingRecipientHint(recipientMode, counts)}>
              <select
                value={recipientMode}
                onChange={(event) => props.setMarketingMailForm((current) => ({ ...current, recipientMode: event.target.value }))}
              >
                <option value="@APPROVED">@APPROVED 승인 동의자</option>
                <option value="@ALL">@ALL 전체 동의자</option>
                <option value="@STUDENTS">@STUDENTS 일반 동의자</option>
                <option value="@ACTIVE">@ACTIVE 최근 접속 동의자</option>
                <option value="manual">직접 입력</option>
              </select>
            </AdminField>
            <AdminField label="직접 입력" hint="직접 입력 모드에서만 사용합니다. 이메일 또는 아이디를 쉼표/줄바꿈으로 구분합니다.">
              <textarea
                disabled={recipientMode !== "manual"}
                onChange={(event) => props.setMarketingMailForm((current) => ({ ...current, to: event.target.value }))}
                placeholder={recipientMode === "manual" ? "user@example.com 또는 user_id" : recipientMode}
                value={marketingMailForm.to || ""}
              />
            </AdminField>
            <AdminField label="제목">
              <input
                onChange={(event) => props.setMarketingMailForm((current) => ({ ...current, subject: event.target.value }))}
                placeholder="예: 5월 신규 과정 및 쿠폰 안내"
                value={marketingMailForm.subject || ""}
              />
            </AdminField>
            <AdminField label="내용">
              <textarea
                onChange={(event) => props.setMarketingMailForm((current) => ({ ...current, text: event.target.value }))}
                placeholder="광고성 안내 내용과 수신거부 방법을 포함해 주세요."
                value={marketingMailForm.text || ""}
              />
            </AdminField>
          </div>
          <div className="simple-status-list">
            <div>발송 전 서버에서 마케팅 수신 동의 여부를 다시 확인합니다.</div>
            <div>미동의 사용자와 동의 이력이 확인되지 않는 직접 입력 주소는 자동 제외됩니다.</div>
          </div>
          <div className="portal-actions">
            <button className="mini-btn primary-mini-btn" type="submit">마케팅 메일 발송</button>
          </div>
        </form>
      </section>

      <section className="admin-simple-card marketing-activity-card">
        <div className="admin-card-header">
          <div>
            <strong>{chartTitle}</strong>
            <p className="hint">{ACTIVITY_PERIOD_META[period]?.hint || "기간별 고유 활동 사용자"}</p>
          </div>
          <div className="admin-inline-actions">
            {Object.entries(ACTIVITY_PERIOD_META).map(([key, item]) => (
              <button className={`mini-btn ${period === key ? "primary-mini-btn" : ""}`} key={key} onClick={() => setPeriod(key)} type="button">
                {item.label}
              </button>
            ))}
            <button className="ghost-btn refresh-btn" onClick={props.onRefreshAdminAccessLogs} type="button">새로고침</button>
          </div>
        </div>
        <div className="marketing-activity-chart" role="img" aria-label={chartTitle}>
          {chartSeries.length ? chartSeries.map((item) => {
            const count = Number(item.count || 0);
            const height = Math.max(6, Math.round((count / visibleMax) * 100));
            return (
              <div className="marketing-activity-bar-item" key={item.key || item.label}>
                <div className="marketing-activity-bar-value">{`${count}명`}</div>
                <div className="marketing-activity-bar-track">
                  <div className="marketing-activity-bar-fill" style={{ height: `${height}%` }} />
                </div>
                <div className="marketing-activity-bar-label">{item.label}</div>
              </div>
            );
          }) : <div className="empty-state">아직 그래프로 표시할 활동 데이터가 없습니다.</div>}
        </div>
      </section>

      <section className="admin-simple-card">
        <div className="admin-card-header">
          <div>
            <strong>활성 사용자</strong>
            <p className="hint">{`${ACTIVITY_PERIOD_META[period]?.label || "월간"} 기준 최근 활동 순으로 최대 20명을 표시합니다.`}</p>
          </div>
        </div>
        <div className="admin-table admin-table-scroll">
          <div className="admin-table-head marketing-activity-user-grid">
            <span>사용자</span>
            <span>상태</span>
            <span>최근 활동</span>
          </div>
          {activeUsers.length ? activeUsers.map((user) => (
            <div className="admin-table-row marketing-activity-user-grid" key={user.id}>
              <span>
                <strong>{user.name || "-"}</strong>
                <div className="hint">{user.username || "-"}</div>
              </span>
              <span>
                <div>{user.activeNow ? "현재 활성" : user.activeWeek ? "이번 주 활동" : user.activeMonth ? "이번 달 활동" : "올해 활동"}</div>
                <div className="hint">{user.marketingEmailConsent ? "마케팅 동의" : "마케팅 미동의"}</div>
              </span>
              <span>
                <div>{user.lastActiveAt ? formatDateTime(user.lastActiveAt) : "-"}</div>
                <div className="hint">{`로그인 ${Number(user.accessLogCount || 0)}회`}</div>
              </span>
            </div>
          )) : <div className="empty-state">선택한 기간에 활동한 사용자가 없습니다.</div>}
        </div>
      </section>
    </section>
  );
}
