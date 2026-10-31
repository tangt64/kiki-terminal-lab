import {
  describeCouponDiscount,
  formatDateTime,
} from "./portal-views.jsx";

export default function LuckyDrawView(props) {
  const overview = props.luckyDrawOverview || { event: null, rewards: [], attempts: [], grants: [], remainingAttempts: 0 };
  const event = overview.event;

  return (
    <section className="portal-stack">
      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">무료 강의 뽑기</p>
            <h3>{event?.title || "오늘의 무료 강의 뽑기"}</h3>
          </div>
          <div className="admin-inline-actions">
            <span className="status-chip is-muted">{`남은 기회 ${Math.max(0, Number(overview.remainingAttempts || 0))}회`}</span>
            <button className="primary-btn" disabled={!event || overview.isEligible === false || Number(overview.remainingAttempts || 0) <= 0} onClick={props.onAttemptLuckyDraw} type="button">
              지금 뽑기
            </button>
          </div>
        </div>
        <p className="hint">{event?.description || "하루 세 번, 오늘의 무료 강의 기회에 도전해 보세요."}</p>
        {props.luckyDrawStatus?.message ? <div className={`inline-message ${props.luckyDrawStatus.tone === "error" ? "is-error" : ""}`}>{props.luckyDrawStatus.message}</div> : null}
        {overview.isEligible === false && overview.eligibilityMessage ? <div className="inline-message is-error">{overview.eligibilityMessage}</div> : null}
        <div className="simple-status-list">
          <div>{`진행 기간: ${formatDateTime(event?.startAt)} ~ ${formatDateTime(event?.endAt)}`}</div>
          <div>{`하루 참여 횟수: ${event?.dailyAttemptLimit || 0}회`}</div>
          <div>{`현재 상태: ${event ? "진행 중" : "준비 중"}`}</div>
          <div>{`대상 조건: ${[
            event?.requireVerifiedUser ? "승인 회원" : null,
            event?.allowNewUsersOnly ? `신규 ${event?.newUserWindowDays || 30}일 이내` : null,
            event?.allowDormantUsersOnly ? `휴면 ${event?.dormantDays || 30}일 이상` : null,
          ].filter(Boolean).join(" / ") || "전체 회원"}`}</div>
        </div>
      </section>

      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">Rewards</p>
            <h3>오늘 받을 수 있는 보상</h3>
          </div>
        </div>
        <div className="qna-board">
          {(overview.rewards || []).length ? overview.rewards.map((reward) => (
            <article className="qna-thread" key={reward.id}>
              <div className="qna-thread-head">
                <strong>{reward.label}</strong>
                <span>{reward.rewardType === "free_course" ? "무료 과정" : reward.rewardType === "discount_coupon" ? "할인 쿠폰" : "메시지 보상"}</span>
              </div>
              <div className="simple-status-list">
                <div>{`가중치: ${reward.probabilityWeight}`}</div>
                <div>{`과정: ${reward.courseTitle || "-"}`}</div>
                {reward.rewardType === "discount_coupon" ? <div>{`혜택: ${describeCouponDiscount(reward)}`}</div> : null}
                {reward.rewardType === "discount_coupon" ? <div>{`쿠폰 만료: 지급 후 ${reward.couponExpiresInDays || 7}일`}</div> : null}
                <div>{`1인 제한: ${reward.perUserLimit}회`}</div>
              </div>
            </article>
          )) : <p className="hint">아직 등록된 보상이 없습니다.</p>}
        </div>
      </section>

      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">History</p>
            <h3>내 참여 기록</h3>
          </div>
        </div>
        <div className="qna-board">
          {(overview.attempts || []).length ? overview.attempts.map((attempt) => (
            <article className="qna-thread" key={attempt.id}>
              <div className="qna-thread-head">
                <strong>{attempt.rewardLabel || "보상 대기"}</strong>
                <span>{formatDateTime(attempt.createdAt)}</span>
              </div>
              <div className="simple-status-list">
                <div>{`시도 순서: ${attempt.attemptNo}회차`}</div>
                <div>{`결과: ${attempt.resultStatus}`}</div>
              </div>
            </article>
          )) : <p className="hint">아직 참여 기록이 없습니다.</p>}
        </div>
      </section>
    </section>
  );
}
