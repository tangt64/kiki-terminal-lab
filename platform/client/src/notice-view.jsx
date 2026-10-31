import { useEffect, useRef, useState } from "react";
import { AdminField, formatDateTime } from "./portal-views.jsx";

function sortNoticesForDisplay(notices = []) {
  return [...notices].sort((left, right) => {
    if (Boolean(left.isPinned) !== Boolean(right.isPinned)) {
      return Boolean(left.isPinned) ? -1 : 1;
    }
    return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
  });
}

function NoticePinnedToggle({ checked, onChange }) {
  return (
    <label className="toggle admin-filter-toggle">
      <input checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <span className="toggle-switch" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-copy">
        <strong>{checked ? "ON" : "OFF"}</strong>
        <span>상단 고정</span>
      </span>
    </label>
  );
}

export default function NoticeView(props) {
  const [editingNoticeId, setEditingNoticeId] = useState(null);
  const inlineEditorRef = useRef(null);
  const visibleNotices = sortNoticesForDisplay(props.notices || []).slice(0, 5);
  const [featuredNotice, ...timelineNotices] = visibleNotices;

  useEffect(() => {
    if (!editingNoticeId || !inlineEditorRef.current) return;
    inlineEditorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusTarget = inlineEditorRef.current.querySelector("input, textarea");
    focusTarget?.focus();
  }, [editingNoticeId]);

  const updatePinned = (isPinned) => props.setNoticeForm((current) => ({ ...current, isPinned }));
  const startEditingNotice = (notice) => {
    props.onNoticeEdit(notice);
    setEditingNoticeId(notice.id);
  };
  const deleteNotice = (notice) => {
    props.onNoticeDelete(notice.id);
    if (editingNoticeId === notice.id) {
      props.onCancelNoticeEdit();
      setEditingNoticeId(null);
    }
  };
  const renderNoticeActions = (notice) =>
    props.isAdmin ? (
      <div className="admin-inline-actions">
        <button className="mini-btn" onClick={() => startEditingNotice(notice)} type="button">
          수정
        </button>
        <button className="mini-btn danger-mini-btn" onClick={() => deleteNotice(notice)} type="button">
          삭제
        </button>
      </div>
    ) : null;
  const renderNoticeEditor = (notice) =>
    props.isAdmin && editingNoticeId === notice.id ? (
      <form
        className="admin-form simple-panel inline-admin-editor"
        onSubmit={async (event) => {
          const saved = await props.onNoticeSubmit(event);
          if (saved) {
            props.onCancelNoticeEdit();
            setEditingNoticeId(null);
          }
        }}
        ref={inlineEditorRef}
      >
        <div className="admin-card-header">
          <div className="inline-edit-title">
            <strong>공지 수정</strong>
            <span className="status-chip is-success">편집 중</span>
          </div>
          <div className="admin-inline-actions">
            <button className="mini-btn primary-mini-btn" type="submit">저장</button>
            <button
              className="mini-btn"
              onClick={() => {
                props.onCancelNoticeEdit();
                setEditingNoticeId(null);
              }}
              type="button"
            >
              취소
            </button>
          </div>
        </div>
        <AdminField label="제목" required>
          <input value={props.noticeForm.title} onChange={(event) => props.setNoticeForm((current) => ({ ...current, title: event.target.value }))} placeholder="공지 제목" />
        </AdminField>
        <AdminField label="내용" required>
          <textarea value={props.noticeForm.body} onChange={(event) => props.setNoticeForm((current) => ({ ...current, body: event.target.value }))} placeholder="공지 내용" />
        </AdminField>
        <NoticePinnedToggle checked={props.noticeForm.isPinned} onChange={updatePinned} />
      </form>
    ) : null;

  return (
    <section className="portal-stack notice-view">
      {props.isAdmin ? (
        !editingNoticeId ? (
          <form className="simple-panel admin-form" onSubmit={props.onNoticeSubmit}>
            <div className="admin-card-header">
              <strong>공지 등록</strong>
            </div>
            <AdminField label="제목" required>
              <input value={props.noticeForm.title} onChange={(event) => props.setNoticeForm((current) => ({ ...current, title: event.target.value }))} placeholder="공지 제목" />
            </AdminField>
            <AdminField label="내용" required>
              <textarea value={props.noticeForm.body} onChange={(event) => props.setNoticeForm((current) => ({ ...current, body: event.target.value }))} placeholder="공지 내용" />
            </AdminField>
            <NoticePinnedToggle checked={props.noticeForm.isPinned} onChange={updatePinned} />
            <div className="admin-inline-actions">
              <button className="mini-btn primary-mini-btn" type="submit">공지 등록</button>
            </div>
          </form>
        ) : (
          <section className="simple-panel">
            <div className="admin-card-header">
              <strong>공지 관리</strong>
              <div className="admin-inline-actions">
                <span className="hint">목록에서 바로 수정 중입니다.</span>
                <button
                  className="mini-btn"
                  onClick={() => {
                    props.onCancelNoticeEdit();
                    setEditingNoticeId(null);
                  }}
                  type="button"
                >
                  새 공지 작성
                </button>
              </div>
            </div>
          </section>
        )
      ) : null}

      <div className="qna-board notice-board notice-board-timeline">
        {featuredNotice ? (
          <article className={`notice-feature-card ${editingNoticeId === featuredNotice.id ? "is-editing" : ""}`}>
            <div className="notice-feature-mark" aria-hidden="true">
              <span>{featuredNotice.isPinned ? "PIN" : "NEW"}</span>
            </div>
            <div className="notice-feature-content">
              <div className="notice-feature-head">
                <div>
                  <span className="card-label">{featuredNotice.isPinned ? "고정 공지" : "최근 공지"}</span>
                  <strong>{featuredNotice.title || "제목 없는 공지"}</strong>
                </div>
                <span>{formatDateTime(featuredNotice.updatedAt || featuredNotice.createdAt)}</span>
              </div>
              <div className="qna-post-body notice-body">{featuredNotice.body}</div>
              {renderNoticeActions(featuredNotice)}
              {renderNoticeEditor(featuredNotice)}
            </div>
          </article>
        ) : (
          <div className="simple-info-block">등록된 공지사항이 없습니다.</div>
        )}
        {timelineNotices.length ? (
          <div className="notice-timeline-list">
            {timelineNotices.map((notice) => (
              <article className={`notice-timeline-item ${editingNoticeId === notice.id ? "is-editing" : ""}`} key={notice.id}>
                <span className="notice-timeline-dot" aria-hidden="true" />
                <div className="notice-timeline-card">
                  <div className="notice-timeline-head">
                    <strong>{notice.title || "제목 없는 공지"}</strong>
                    <span>{formatDateTime(notice.updatedAt || notice.createdAt)}</span>
                  </div>
                  <div className="qna-post-body notice-body">{notice.body}</div>
                  {renderNoticeActions(notice)}
                  {renderNoticeEditor(notice)}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
