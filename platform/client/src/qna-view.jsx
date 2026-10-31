import { useState } from "react";
import { getQnaStatus } from "./portal-views.jsx";

function getQnaDraftKey(postId, parentCommentId = null) {
  return parentCommentId ? `comment:${postId}:${parentCommentId}` : `post:${postId}`;
}

function canDeleteQnaPost(props, post) {
  return Boolean(props.isAdmin) || Number(post.userId || 0) === Number(props.session?.id || 0);
}

function canDeleteQnaComment(props, comment) {
  return Boolean(props.isAdmin) || Number(comment.userId || 0) === Number(props.session?.id || 0);
}

function QnaCommentThread({ props, post, comment, comments, depth = 0, replyOpenMap, setReplyOpenMap }) {
  const replyMapKey = `${post.id}:${comment.id}`;
  const draftKey = getQnaDraftKey(post.id, comment.id);
  const isReplyOpen = Boolean(replyOpenMap[replyMapKey]);
  const childComments = comments.filter((item) => Number(item.parentCommentId || 0) === Number(comment.id));
  return (
    <div className={`qna-comment qna-comment-depth-${Math.min(depth, 3)}`}>
      <div className="qna-comment-meta">{comment.userName} ({comment.username})</div>
      <div className="qna-comment-body">{comment.body}</div>
      <div className="qna-comment-actions">
        <button className="mini-btn" onClick={() => setReplyOpenMap((current) => ({ ...current, [replyMapKey]: !current[replyMapKey] }))} type="button">
          {isReplyOpen ? "답글 닫기" : "댓글 쓰기"}
        </button>
        {canDeleteQnaComment(props, comment) ? (
          <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteQnaComment(post.id, comment.id)} type="button">삭제</button>
        ) : null}
      </div>
      {isReplyOpen ? (
        <div className="nested-reply-block">
          <textarea
            value={props.qnaCommentDrafts[draftKey] ?? ""}
            onChange={(event) => props.setQnaCommentDrafts((current) => ({ ...current, [draftKey]: event.target.value }))}
            placeholder="이 댓글 아래에 답글을 입력해 주세요."
          />
          <button className="mini-btn primary-mini-btn" onClick={() => props.onCreateQnaComment(post.id, comment.id)} type="button">댓글 쓰기</button>
        </div>
      ) : null}
      {childComments.length ? (
        <div className="qna-comment-children">
          {childComments.map((child) => (
            <QnaCommentThread
              key={child.id}
              props={props}
              post={post}
              comment={child}
              comments={comments}
              depth={depth + 1}
              replyOpenMap={replyOpenMap}
              setReplyOpenMap={setReplyOpenMap}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function QnaThreadCard({ props, post, replyOpenMap, setReplyOpenMap, replyPlaceholder, registerButtonClass = "ghost-btn" }) {
  const rootReplyKey = `post:${post.id}`;
  const rootDraftKey = getQnaDraftKey(post.id);
  const isRootReplyOpen = Boolean(replyOpenMap[rootReplyKey]);
  const topLevelComments = (post.comments || []).filter((comment) => !comment.parentCommentId);
  const qnaStatus = getQnaStatus(post);
  return (
    <article className="qna-thread" key={post.id}>
      <div className="qna-thread-head">
        <strong>{post.title}</strong>
        <div className="admin-inline-actions">
          <span>{post.userName} ({post.username})</span>
          <span className={`status-chip ${qnaStatus.tone}`}>{qnaStatus.label}</span>
        </div>
      </div>
      {post.courseTitle ? <div className="qna-head"><strong>관련 과정</strong><span>{post.courseTitle}</span></div> : null}
      <div className="qna-post-body">{post.body}</div>
      {post.answerText ? (
        <div className="qna-answer">
          <strong>기존 관리자 답변</strong>
          <p>{post.answerText}</p>
        </div>
      ) : null}
      <div className="qna-post-actions">
        <button className="mini-btn" onClick={() => setReplyOpenMap((current) => ({ ...current, [rootReplyKey]: !current[rootReplyKey] }))} type="button">
          {isRootReplyOpen ? "댓글 닫기" : "댓글 쓰기"}
        </button>
        {canDeleteQnaPost(props, post) ? (
          <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteQnaPost(post.id)} type="button">게시글 삭제</button>
        ) : null}
      </div>
      {topLevelComments.length ? (
        <div className="qna-comment-list">
          {topLevelComments.map((comment) => (
            <QnaCommentThread
              key={comment.id}
              props={props}
              post={post}
              comment={comment}
              comments={post.comments || []}
              replyOpenMap={replyOpenMap}
              setReplyOpenMap={setReplyOpenMap}
            />
          ))}
        </div>
      ) : (
        <p className="hint">등록된 댓글이 없습니다.</p>
      )}
      {isRootReplyOpen ? (
        <div className="qna-reply-block">
          <textarea
            value={props.qnaCommentDrafts[rootDraftKey] ?? ""}
            onChange={(event) => props.setQnaCommentDrafts((current) => ({ ...current, [rootDraftKey]: event.target.value }))}
            placeholder={replyPlaceholder}
          />
          <button className={registerButtonClass} onClick={() => props.onCreateQnaComment(post.id)} type="button">댓글 쓰기</button>
        </div>
      ) : null}
    </article>
  );
}

export default function QnaView(props) {
  const [replyOpenMap, setReplyOpenMap] = useState({});
  const courseOptions = props.isAdmin ? (props.adminCourses || props.courses || []) : (props.courses || []);
  return (
    <section className="portal-stack">
      {!props.embeddedInInquiry ? (
        <section className="simple-panel">
          <div className="portal-detail-head">
            <div>
              <p className="card-label">커뮤니티</p>
              <h3>문의와 댓글</h3>
            </div>
          </div>
          <p className="hint">
            {props.isAdmin
              ? "관리자도 여기에서 문의나 공지성 글을 등록하고 다른 사용자 및 관리자와 댓글 형태로 바로 대화할 수 있습니다."
              : "문의 내용을 등록하면 다른 사용자 및 관리자와 댓글 형태로 바로 대화할 수 있습니다."}
          </p>
        </section>
      ) : null}

      <form className="qna-form simple-panel" onSubmit={props.onCreateQna}>
        <select value={props.qnaForm.courseId || ""} onChange={(event) => props.setQnaForm((current) => ({ ...current, courseId: event.target.value }))}>
          <option value="">과정 미지정</option>
          {courseOptions.map((course) => (
            <option key={course.id} value={course.id}>{course.title}</option>
          ))}
        </select>
        <input value={props.qnaForm.title} onChange={(event) => props.setQnaForm((current) => ({ ...current, title: event.target.value }))} placeholder={props.isAdmin ? "관리자 질문 또는 테스트 제목" : "제목"} />
        <textarea value={props.qnaForm.body} onChange={(event) => props.setQnaForm((current) => ({ ...current, body: event.target.value }))} placeholder={props.isAdmin ? "관리자 테스트 문의나 공지성 질문을 입력해 주세요." : "문의 내용을 입력해 주세요."} />
        <button className="primary-btn" type="submit">등록</button>
      </form>

      <div className="qna-board">
        {props.qnaPosts.length ? props.qnaPosts.map((post) => (
          <QnaThreadCard
            key={post.id}
            props={props}
            post={post}
            replyOpenMap={replyOpenMap}
            setReplyOpenMap={setReplyOpenMap}
            replyPlaceholder="댓글을 입력해 주세요."
          />
        )) : (
          <section className="simple-panel">
            <p className="hint">아직 등록된 문의가 없습니다.</p>
          </section>
        )}
      </div>
    </section>
  );
}
