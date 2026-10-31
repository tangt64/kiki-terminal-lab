import { formatDateTime } from "./portal-views.jsx";

export default function NotificationView(props) {
  const notifications = Array.isArray(props.notifications) ? props.notifications : [];
  const unreadCount = notifications.filter((item) => !item.isRead).length;

  return (
    <section className="portal-stack">
      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">알림함</p>
            <h3>승인 및 운영 알림</h3>
          </div>
          <div className="admin-inline-actions">
            <button className="ghost-btn refresh-btn" onClick={props.onRefreshNotifications} type="button">새로고침</button>
            <button className="ghost-btn" disabled={!unreadCount} onClick={props.onMarkAllNotificationsRead} type="button">전체 읽음</button>
            <button className="danger-btn" disabled={!notifications.length} onClick={props.onClearNotifications} type="button">전체 지우기</button>
          </div>
        </div>
        <p className="hint">과정 승인, 결제, 외부 SSH, 자원 변경, 운영 정리 요청 상태를 한곳에서 확인합니다.</p>
        {props.notificationStatus?.message ? <div className={`inline-message ${props.notificationStatus.tone === "error" ? "is-error" : ""}`}>{props.notificationStatus.message}</div> : null}
      </section>

      <div className="qna-board">
        {notifications.length ? notifications.map((item) => (
          <article className={`qna-thread notification-thread ${item.isRead ? "is-read" : "is-unread"}`} key={item.id}>
            <div className="qna-thread-head">
              <strong>{item.title || "알림"}</strong>
              <span>{formatDateTime(item.createdAt)}</span>
            </div>
            <div className="qna-post-body">{item.body || "-"}</div>
            <div className="admin-inline-actions">
              <span className={`status-chip ${item.isRead ? "is-muted" : "is-success"}`}>{item.isRead ? "읽음" : "새 알림"}</span>
              {item.linkSection ? <button className="mini-btn open-btn" onClick={() => props.setSection(item.linkSection)} type="button">관련 화면 열기</button> : null}
              {!item.isRead ? <button className="mini-btn read-btn" onClick={() => props.onMarkNotificationRead(item.id)} type="button">읽음 처리</button> : null}
              <button className="mini-btn danger-btn" onClick={() => props.onDeleteNotification(item.id)} type="button">지우기</button>
            </div>
          </article>
        )) : (
          <section className="simple-panel">
            <p className="hint">아직 도착한 알림이 없습니다.</p>
          </section>
        )}
      </div>
    </section>
  );
}
