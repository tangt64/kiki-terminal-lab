import { useEffect, useRef, useState } from "react";
import { AdminField, formatDateTime, getQnaStatus, useImeBufferedInput } from "./portal-views.jsx";
function getConsultingRequestStatusLabel(status) {
  switch (String(status || "requested").toLowerCase()) {
    case "reviewing":
      return "검토 중";
    case "answered":
      return "답변 완료";
    case "closed":
      return "종료";
    default:
      return "접수됨";
  }
}
function getQnaDraftKey(postId, parentCommentId = null) {
  return parentCommentId ? `comment:${postId}:${parentCommentId}` : `post:${postId}`;
}
function canDeleteQnaPost(props, post) {
  return Boolean(props.isAdmin) || Number(post.userId || 0) === Number(props.session?.id || 0);
}
function canDeleteQnaComment(props, comment) {
  return Boolean(props.isAdmin) || Number(comment.userId || 0) === Number(props.session?.id || 0);
}
function canManageQnaPost(props, post) {
  return Boolean(props.isAdmin) || Number(post.userId || 0) === Number(props.session?.id || 0);
}
const QNA_POST_TYPES = [{
  value: "question",
  label: "질문"
}, {
  value: "error",
  label: "에러 로그"
}, {
  value: "tip",
  label: "팁/노하우"
}, {
  value: "resource",
  label: "자료공유"
}, {
  value: "project",
  label: "프로젝트"
}, {
  value: "study",
  label: "스터디모집"
}, {
  value: "free",
  label: "자유글"
}, {
  value: "notice",
  label: "공지"
}];
function isTerminalCloudCleanupMessage(item = {}) {
  const text = [item.subject, item.body, item.recipientGroupName, item.recipientName].map(value => String(value || "").toLowerCase()).join(" ");
  return text.includes("터미널 클라우드") && (text.includes("정리 요청") || text.includes("잔여 자원") || text.includes("실패 자원"));
}
function getCleanupStatusMeta(status) {
  switch (String(status || "requested").trim().toLowerCase()) {
    case "working":
      return {
        chipClass: "is-warn",
        description: "운영지원에서 잔여 자원을 확인하고 있습니다.",
        label: "처리 중"
      };
    case "done":
      return {
        chipClass: "is-success",
        description: "관리자가 정리 완료로 표시했습니다.",
        label: "완료"
      };
    case "blocked":
      return {
        chipClass: "is-error",
        description: "추가 확인이 필요해 보류된 상태입니다.",
        label: "보류"
      };
    default:
      return {
        chipClass: "is-muted",
        description: "운영지원 확인을 기다리고 있습니다.",
        label: "요청됨"
      };
  }
}
function isOpenCleanupStatus(status) {
  return String(status || "requested").trim().toLowerCase() !== "done";
}
function getCleanupStatusUpdatedLabel(item = {}) {
  const updatedAt = item.cleanupStatusUpdatedAt;
  if (!updatedAt) return "";
  const actor = item.cleanupStatusUpdatedByName || item.cleanupStatusUpdatedByUsername || "운영지원";
  return `${actor} · ${formatDateTime(updatedAt)} 갱신`;
}
function getQnaPostTypeLabel(value) {
  return QNA_POST_TYPES.find(item => item.value === String(value || "question"))?.label || "질문";
}
function getQnaLatestActivityAt(post) {
  return [post?.createdAt, post?.answeredAt, ...(post?.comments || []).map(comment => comment.createdAt)].map(value => new Date(value || 0).getTime()).filter(value => Number.isFinite(value)).sort((a, b) => b - a)[0] || 0;
}
function QnaCommentThread({
  props,
  post,
  comment,
  comments,
  depth = 0,
  replyOpenMap,
  setReplyOpenMap
}) {
  const replyMapKey = `${post.id}:${comment.id}`;
  const draftKey = getQnaDraftKey(post.id, comment.id);
  const isReplyOpen = Boolean(replyOpenMap[replyMapKey]);
  const childComments = comments.filter(item => Number(item.parentCommentId || 0) === Number(comment.id));
  const isAccepted = Number(post.acceptedCommentId || 0) === Number(comment.id || 0);
  return <div className={`qna-comment qna-comment-depth-${Math.min(depth, 3)} ${isAccepted ? "is-accepted" : ""}`}>
      <div className="qna-comment-meta">
        <span>{comment.userName} ({comment.username})</span>
        {isAccepted ? <span className="status-chip is-success">채택 답변</span> : null}
      </div>
      <div className="qna-comment-body">{comment.body}</div>
      <div className="qna-comment-actions">
        <button className="mini-btn" onClick={() => setReplyOpenMap(current => ({
        ...current,
        [replyMapKey]: !current[replyMapKey]
      }))} type="button">
          {isReplyOpen ? "답글 닫기" : "댓글 쓰기"}
        </button>
        {canDeleteQnaComment(props, comment) ? <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteQnaComment(post.id, comment.id)} type="button">삭제</button> : null}
        {!isAccepted && canManageQnaPost(props, post) ? <button className="mini-btn primary-mini-btn" onClick={() => props.onAcceptQnaComment?.(post.id, comment.id)} type="button">답변 채택</button> : null}
      </div>
      {isReplyOpen ? <div className="nested-reply-block">
          <textarea value={props.qnaCommentDrafts[draftKey] ?? ""} onChange={event => props.setQnaCommentDrafts(current => ({
        ...current,
        [draftKey]: event.target.value
      }))} placeholder="이 댓글 아래에 답글을 입력해 주세요." />
          <button className="mini-btn primary-mini-btn" onClick={() => props.onCreateQnaComment(post.id, comment.id)} type="button">댓글 쓰기</button>
        </div> : null}
      {childComments.length ? <div className="qna-comment-children">
          {childComments.map(child => <QnaCommentThread key={child.id} props={props} post={post} comment={child} comments={comments} depth={depth + 1} replyOpenMap={replyOpenMap} setReplyOpenMap={setReplyOpenMap} />)}
        </div> : null}
    </div>;
}
function QnaThreadCard({
  props,
  post,
  replyOpenMap,
  setReplyOpenMap,
  replyPlaceholder,
  registerButtonClass = "ghost-btn"
}) {
  const rootReplyKey = `post:${post.id}`;
  const rootDraftKey = getQnaDraftKey(post.id);
  const isRootReplyOpen = Boolean(replyOpenMap[rootReplyKey]);
  const topLevelComments = (post.comments || []).filter(comment => !comment.parentCommentId);
  const qnaStatus = getQnaStatus(post);
  const canManage = canManageQnaPost(props, post);
  const helpfulCount = Math.max(0, Number(post.helpfulCount || 0) || 0);
  return <article className="qna-thread" key={post.id}>
      <div className="qna-thread-head">
        <strong>{post.title}</strong>
        <div className="admin-inline-actions">
          <span>{post.userName} ({post.username})</span>
          <span className={`status-chip ${qnaStatus.tone}`}>{qnaStatus.label}</span>
        </div>
      </div>
      <div className="qna-tag-row">
        <span className="status-chip is-muted">{getQnaPostTypeLabel(post.postType)}</span>
        {post.courseTitle ? <span className="status-chip is-muted">{post.courseTitle}</span> : null}
        {post.labRequestId ? <span className="status-chip is-warn">{`랩 #${post.labRequestId}${post.labStatus ? ` · ${post.labStatus}` : ""}`}</span> : null}
        <span className="status-chip is-muted">{`댓글 ${(post.comments || []).length}`}</span>
        <span className="status-chip is-muted">{`도움돼요 ${helpfulCount}`}</span>
      </div>
      {post.courseTitle ? <div className="qna-head"><strong>관련 과정</strong><span>{post.courseTitle}</span></div> : null}
      {post.labRequestId ? <div className="qna-head">
          <strong>연결 랩</strong>
          <span>{[`#${post.labRequestId}`, post.labStackName || post.labContext?.stackName, post.labInstanceIp || post.labContext?.instanceIp].filter(Boolean).join(" · ")}</span>
        </div> : null}
      <div className="qna-post-body">{post.body}</div>
      {post.answerText ? <div className="qna-answer">
          <strong>기존 관리자 답변</strong>
          <p>{post.answerText}</p>
        </div> : null}
      <div className="qna-post-actions">
        <button className="mini-btn" onClick={() => setReplyOpenMap(current => ({
        ...current,
        [rootReplyKey]: !current[rootReplyKey]
      }))} type="button">
          {isRootReplyOpen ? "댓글 닫기" : "댓글 쓰기"}
        </button>
        <button className="mini-btn" onClick={() => props.onMarkQnaHelpful?.(post.id)} type="button">{`도움돼요 ${helpfulCount}`}</button>
        {canManage && String(post.status || "") !== "solved" ? <button className="mini-btn primary-mini-btn" onClick={() => props.onSetQnaStatus?.(post.id, "solved")} type="button">해결됨</button> : null}
        {canManage && String(post.status || "") === "solved" ? <button className="mini-btn" onClick={() => props.onSetQnaStatus?.(post.id, "in_progress")} type="button">다시 열기</button> : null}
        {canDeleteQnaPost(props, post) ? <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteQnaPost(post.id)} type="button">게시글 삭제</button> : null}
      </div>
      {topLevelComments.length ? <div className="qna-comment-list">
          {topLevelComments.map(comment => <QnaCommentThread key={comment.id} props={props} post={post} comment={comment} comments={post.comments || []} replyOpenMap={replyOpenMap} setReplyOpenMap={setReplyOpenMap} />)}
        </div> : <p className="hint">등록된 댓글이 없습니다.</p>}
      {isRootReplyOpen ? <div className="qna-reply-block">
          <textarea value={props.qnaCommentDrafts[rootDraftKey] ?? ""} onChange={event => props.setQnaCommentDrafts(current => ({
        ...current,
        [rootDraftKey]: event.target.value
      }))} placeholder={replyPlaceholder} />
          <button className={registerButtonClass} onClick={() => props.onCreateQnaComment(post.id)} type="button">댓글 쓰기</button>
        </div> : null}
    </article>;
}
export function QnaView(props) {
  const [replyOpenMap, setReplyOpenMap] = useState({});
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortMode, setSortMode] = useState("activity");
  const courseOptions = props.isAdmin ? props.adminCourses || props.courses || [] : props.courses || [];
  const focusedCommunityCourseId = String(props.communityCourseId || "").trim();
  const focusedCommunityCourse = focusedCommunityCourseId ? courseOptions.find(course => String(course.id) === focusedCommunityCourseId) : null;
  const labOptions = (props.isAdmin ? props.adminLabs || props.labs || [] : props.labs || []).filter(lab => lab && (props.isAdmin || Number(lab.userId || props.session?.id || 0) === Number(props.session?.id || 0)));
  const searchInput = useImeBufferedInput(search, setSearch);
  const query = String(search || "").trim().toLowerCase();
  useEffect(() => {
    if (!focusedCommunityCourseId) {
      setCourseFilter("");
      return;
    }
    setCourseFilter(focusedCommunityCourseId);
    props.setQnaForm?.(current => String(current?.courseId || "") === focusedCommunityCourseId ? current : {
      ...current,
      courseId: focusedCommunityCourseId,
      labRequestId: ""
    });
  }, [focusedCommunityCourseId]);
  const communityStats = {
    total: (props.qnaPosts || []).length,
    unsolved: (props.qnaPosts || []).filter(post => getQnaStatus(post).label !== "해결됨").length,
    solved: (props.qnaPosts || []).filter(post => getQnaStatus(post).label === "해결됨").length,
    helpful: (props.qnaPosts || []).reduce((sum, post) => sum + Math.max(0, Number(post.helpfulCount || 0) || 0), 0)
  };
  const visiblePosts = [...(props.qnaPosts || [])].filter(post => {
    const matchesType = !typeFilter || String(post.postType || "question") === typeFilter;
    const matchesCourse = !courseFilter || String(post.courseId || "") === courseFilter;
    const statusLabel = getQnaStatus(post).label;
    const matchesStatus = !statusFilter || statusFilter === "unsolved" && statusLabel !== "해결됨" || statusFilter === "solved" && statusLabel === "해결됨";
    const matchesSearch = !query || [post.title, post.body, post.userName, post.username, post.courseTitle, post.labStackName, post.labInstanceIp, post.labContext?.stackName, post.labContext?.instanceIp, ...(post.comments || []).flatMap(comment => [comment.body, comment.userName, comment.username])].some(value => String(value || "").toLowerCase().includes(query));
    return matchesType && matchesCourse && matchesStatus && matchesSearch;
  }).sort((left, right) => {
    if (sortMode === "helpful") return Number(right.helpfulCount || 0) - Number(left.helpfulCount || 0) || getQnaLatestActivityAt(right) - getQnaLatestActivityAt(left);
    if (sortMode === "comments") return (right.comments || []).length - (left.comments || []).length || getQnaLatestActivityAt(right) - getQnaLatestActivityAt(left);
    if (sortMode === "new") return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
    return getQnaLatestActivityAt(right) - getQnaLatestActivityAt(left);
  });
  return <section className="portal-stack">
      {!props.embeddedInInquiry ? <section className="simple-panel">
          <div className="portal-detail-head">
            <div>
              <p className="card-label">Community</p>
              <h3>통합 커뮤니티</h3>
            </div>
          </div>
          <p className="hint">
            {props.isAdmin ? "기술 질문, 오류, 자료 공유, 공지를 한 게시판에서 관리합니다." : "기술 질문, 오류, 자료 공유를 한곳에 남기고 과정/랩 기준으로 다시 찾아볼 수 있습니다."}
          </p>
        </section> : null}

      {focusedCommunityCourse ? <section className="simple-panel community-course-context">
          <div>
            <p className="card-label">Course Community</p>
            <h3>{focusedCommunityCourse.title}</h3>
            <p className="hint">이 과정에 연결된 질문, 실습 에러, 자료 공유만 먼저 보여줍니다. 필터를 전체 과정으로 바꾸면 통합 커뮤니티 전체 글을 볼 수 있습니다.</p>
          </div>
          <button className="ghost-btn" onClick={() => {
        setCourseFilter("");
        props.onOpenCommunity?.("");
      }} type="button">전체 커뮤니티</button>
        </section> : null}

      <section className="community-summary-grid">
        <article><span>전체 글</span><strong>{communityStats.total}</strong></article>
        <article><span>미해결</span><strong>{communityStats.unsolved}</strong></article>
        <article><span>해결됨</span><strong>{communityStats.solved}</strong></article>
        <article><span>도움돼요</span><strong>{communityStats.helpful}</strong></article>
      </section>

      <form className="qna-form simple-panel" onSubmit={props.onCreateQna}>
        <div className="community-compose-grid">
          <select value={props.qnaForm.postType || "question"} onChange={event => props.setQnaForm(current => ({
          ...current,
          postType: event.target.value
        }))}>
            {QNA_POST_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
          
          
        </div>
        <input value={props.qnaForm.title} onChange={event => props.setQnaForm(current => ({
        ...current,
        title: event.target.value
      }))} placeholder={props.isAdmin ? "관리자 질문 또는 테스트 제목" : "제목"} />
        <textarea value={props.qnaForm.body} onChange={event => props.setQnaForm(current => ({
        ...current,
        body: event.target.value
      }))} placeholder={props.qnaForm.postType === "error" ? "에러 로그, 실행한 명령, 기대한 결과를 함께 남겨 주세요." : props.isAdmin ? "관리자 테스트 문의나 공지성 글을 입력해 주세요." : "내용을 입력해 주세요."} />
        <div className="community-compose-actions">
          
          <button className="primary-btn" type="submit">등록</button>
        </div>
      </form>

      <section className="simple-panel community-filter-panel">
        <div className="admin-history-search">
          <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>
            <option value="">전체 유형</option>
            {QNA_POST_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
          
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
            <option value="">전체 상태</option>
            <option value="unsolved">미해결</option>
            <option value="solved">해결됨</option>
          </select>
          <select value={sortMode} onChange={event => setSortMode(event.target.value)}>
            <option value="activity">최신 댓글순</option>
            <option value="new">최신 글순</option>
            <option value="helpful">도움돼요순</option>
            <option value="comments">댓글 많은순</option>
          </select>
          <input type="search" {...searchInput} placeholder="제목, 내용, 작성자, 에러 로그 검색" />
        </div>
      </section>

      <div className="qna-board">
        {visiblePosts.length ? visiblePosts.map(post => <QnaThreadCard key={post.id} props={props} post={post} replyOpenMap={replyOpenMap} setReplyOpenMap={setReplyOpenMap} replyPlaceholder="댓글을 입력해 주세요." />) : <section className="simple-panel">
            <p className="hint">{(props.qnaPosts || []).length ? "검색 조건에 맞는 글이 없습니다." : "아직 등록된 커뮤니티 글이 없습니다."}</p>
          </section>}
      </div>
    </section>;
}
export function ConsultingRequestView(props) {
  return <section className="portal-stack">
      <form className="simple-panel admin-form" onSubmit={props.onCreateConsultingRequest}>
        <div className="portal-detail-head">
          <div>
            <p className="card-label">상담 및 문의</p>
            <h3>기술 상담 문의</h3>
            <p className="hint">기술 검토, 자원 구성, 운영 방향을 남기면 관리자가 확인한 뒤 이메일로 회신합니다.</p>
          </div>
        </div>
        <div className="stacked-form-cards">
          <section className="settings-panel poc-form-card">
            <div className="settings-panel-head">
              <div>
                <strong>요청 기본 정보</strong>
                <p className="hint">제목, 담당자, 연락처를 먼저 입력해 주세요.</p>
              </div>
            </div>
            <div className="admin-form-grid compact-admin-grid">
              <AdminField label="요청 제목" required><input value={props.consultingForm.title} onChange={event => props.setConsultingForm(current => ({
                ...current,
                title: event.target.value
              }))} placeholder="예: 사내 Kubernetes 구축 상담" /></AdminField>
              <AdminField label="회사명"><input value={props.consultingForm.companyName} onChange={event => props.setConsultingForm(current => ({
                ...current,
                companyName: event.target.value
              }))} placeholder="예: example.com" /></AdminField>
              <AdminField label="담당자명" required><input value={props.consultingForm.contactName} onChange={event => props.setConsultingForm(current => ({
                ...current,
                contactName: event.target.value
              }))} placeholder="예: 홍길동" /></AdminField>
              <AdminField label="연락 이메일" required><input value={props.consultingForm.contactEmail} onChange={event => props.setConsultingForm(current => ({
                ...current,
                contactEmail: event.target.value
              }))} placeholder="예: contact@example.com" /></AdminField>
              <AdminField label="연락처"><input value={props.consultingForm.contactPhone} onChange={event => props.setConsultingForm(current => ({
                ...current,
                contactPhone: event.target.value
              }))} placeholder="예: 010-1234-5678" /></AdminField>
              <AdminField label="요청 유형">
                <select value={props.consultingForm.inquiryType} onChange={event => props.setConsultingForm(current => ({
                ...current,
                inquiryType: event.target.value
              }))}>
                  
                  <option value="기술 컨설팅">기술 컨설팅</option>
                  <option value="고급 랩 구축">고급 랩 구축</option>
                  <option value="교육 환경 설계">교육 환경 설계</option>
                  <option value="보안 / 네트워크 검토">보안 / 네트워크 검토</option>
                  <option value="운영 자동화">운영 자동화</option>
                </select>
              </AdminField>
            </div>
          </section>

          <section className="settings-panel poc-form-card">
            <div className="settings-panel-head">
              <div>
                <strong>배경 및 요구사항</strong>
                <p className="hint">현재 상황, 예산, 일정, 기술 요구사항을 남겨 주세요.</p>
              </div>
            </div>
            <div className="admin-form-grid compact-admin-grid">
              <AdminField label="산업군"><input value={props.consultingForm.industry} onChange={event => props.setConsultingForm(current => ({
                ...current,
                industry: event.target.value
              }))} placeholder="예: 교육 / 공공 / 제조" /></AdminField>
              <AdminField label="예산 범위"><input value={props.consultingForm.budgetRange} onChange={event => props.setConsultingForm(current => ({
                ...current,
                budgetRange: event.target.value
              }))} placeholder="예: 300만 ~ 500만 원" /></AdminField>
              <AdminField label="희망 일정"><input value={props.consultingForm.desiredTimeline} onChange={event => props.setConsultingForm(current => ({
                ...current,
                desiredTimeline: event.target.value
              }))} placeholder="예: 다음 달 고급 랩 시작" /></AdminField>
              <AdminField label="현재 환경">
                <textarea value={props.consultingForm.currentEnvironment} onChange={event => props.setConsultingForm(current => ({
                ...current,
                currentEnvironment: event.target.value
              }))} placeholder="현재 사용 중인 인프라, 운영 방식, 제약사항을 적어 주세요." />
              </AdminField>
              <AdminField label="주요 요구사항" required>
                <textarea value={props.consultingForm.requirements} onChange={event => props.setConsultingForm(current => ({
                ...current,
                requirements: event.target.value
              }))} placeholder="필요한 기능, 규모, 기술 검토 항목을 구체적으로 적어 주세요." />
              </AdminField>
              <AdminField label="추가 메모">
                <textarea value={props.consultingForm.note} onChange={event => props.setConsultingForm(current => ({
                ...current,
                note: event.target.value
              }))} placeholder="회의 가능 시간, 참고 링크, 내부 검토 메모 등을 남길 수 있습니다." />
              </AdminField>
            </div>
          </section>
        </div>
        <div className="portal-actions">
          <button className="primary-btn" type="submit">상담 문의 등록</button>
        </div>
      </form>

      <section className="simple-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">요청 현황</p>
            <h3>내 상담 및 문의</h3>
          </div>
        </div>
        <div className="qna-board">
          {(props.consultingRequests || []).length ? props.consultingRequests.map(request => <article className="qna-thread" key={`consulting-request-${request.id}`}>
              <div className="qna-thread-head">
                <strong>{request.title}</strong>
                <span>{getConsultingRequestStatusLabel(request.status)}</span>
              </div>
              <div className="qna-post-body">
                <div>{`담당자: ${request.contactName || "-"} / 이메일: ${request.contactEmail || "-"}`}</div>
                {request.companyName ? <div>{`회사명: ${request.companyName}`}</div> : null}
                <div>{`요청 유형: ${request.inquiryType || "-"}`}</div>
                {request.industry ? <div>{`산업군: ${request.industry}`}</div> : null}
                {request.currentEnvironment ? <div>{`현재 환경: ${request.currentEnvironment}`}</div> : null}
                <div>{`주요 요구사항: ${request.requirements || "-"}`}</div>
                {request.budgetRange ? <div>{`예산 범위: ${request.budgetRange}`}</div> : null}
                {request.desiredTimeline ? <div>{`희망 일정: ${request.desiredTimeline}`}</div> : null}
                {request.note ? <div>{`추가 메모: ${request.note}`}</div> : null}
                <div>{`접수일: ${formatDateTime(request.createdAt)}`}</div>
                {request.adminNote ? <div>{`관리자 회신: ${request.adminNote}`}</div> : null}
                {request.reviewedAt ? <div>{`최근 검토: ${formatDateTime(request.reviewedAt)}`}</div> : null}
              </div>
            </article>) : <p className="hint">등록된 상담 문의가 없습니다.</p>}
        </div>
      </section>
    </section>;
}
export function MessageInboxView(props) {
  const messages = Array.isArray(props.messages) ? props.messages : [];
  const [search, setSearch] = useState("");
  const searchInput = useImeBufferedInput(search, setSearch);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [showCleanupOnly, setShowCleanupOnly] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState("");
  const recipientSearchInput = useImeBufferedInput(recipientSearch, setRecipientSearch);
  const [showRecipientSearch, setShowRecipientSearch] = useState(false);
  const composeRef = useRef(null);
  const supportGroupName = props.platformStatus?.supportMessageGroupName || "운영지원";
  const supportAvailabilityMode = String(props.platformStatus?.supportAvailabilityMode || "available").trim().toLowerCase() === "away" ? "away" : "available";
  const supportUnavailableMessage = String(props.platformStatus?.supportUnavailableMessage || "").trim() || `현재 ${supportGroupName} 담당자가 부재중입니다.`;
  const userCanBypassSupportAway = ["admin", "administrator", "관리자"].includes(String(props.session?.role || "").trim().toLowerCase()) || Boolean(props.session?.supportMessageEnabled);
  const replyRecipientId = String(props.messageForm.recipientId || "").trim();
  const replyTargetLabel = String(props.messageForm.replyToLabel || "").trim();
  const replyPreview = String(props.messageForm.replyToPreview || "").trim();
  const fallbackSupportRecipient = {
    id: "group:support",
    name: supportGroupName,
    username: "support",
    role: "group",
    recipientType: "group",
    groupKey: "support",
    groupName: supportGroupName,
    memberCount: 0,
    representativeUsername: "",
    representativeName: ""
  };
  const availableRecipients = (props.messageRecipients || []).length ? props.messageRecipients : [fallbackSupportRecipient];
  const query = String(search || "").trim().toLowerCase();
  const recipientQuery = String(recipientSearch || "").trim().toLowerCase();
  const unreadCount = messages.filter(item => Number(item.recipientId) === Number(props.session?.id || 0) && !item.readAt).length;
  const cleanupMessages = messages.filter(isTerminalCloudCleanupMessage);
  const openCleanupCount = cleanupMessages.filter(item => isOpenCleanupStatus(item.cleanupStatus)).length;
  const filteredRecipients = availableRecipients.filter(item => {
    if (!recipientQuery) return true;
    return [item.name, item.username, item.role, item.groupName, item.recipientType === "group" ? "group" : "", item.recipientType === "group" ? supportGroupName : ""].some(value => String(value || "").toLowerCase().includes(recipientQuery));
  });
  const filteredMessages = messages.filter(item => {
    const matchesSearch = !query || [item.subject, item.body, item.senderName, item.senderUsername, item.recipientName, item.recipientUsername, item.recipientGroupName].some(value => String(value || "").toLowerCase().includes(query));
    const isIncomingUnread = Number(item.recipientId) === Number(props.session?.id || 0) && !item.readAt;
    const matchesUnread = !showUnreadOnly || isIncomingUnread;
    const matchesCleanup = !showCleanupOnly || isTerminalCloudCleanupMessage(item);
    return matchesSearch && matchesUnread && matchesCleanup;
  });
  const threadGroups = [];
  const threadMap = new Map();
  filteredMessages.forEach(item => {
    const isIncoming = Number(item.recipientId) === Number(props.session?.id || 0);
    const baseSubject = String(item.subject || "제목 없음").replace(/^(re:\s*)+/i, "").trim() || "제목 없음";
    const counterpartKey = isIncoming ? `user:${item.senderId || item.senderUsername || item.senderName || "unknown"}` : item.recipientType === "group" ? `group:${item.recipientGroupKey || item.recipientGroupName || item.recipientName || "support"}` : `user:${item.recipientId || item.recipientUsername || item.recipientName || "unknown"}`;
    const threadKey = `${baseSubject}::${counterpartKey}`;
    if (!threadMap.has(threadKey)) {
      const group = {
        key: threadKey,
        subject: baseSubject,
        items: []
      };
      threadMap.set(threadKey, group);
      threadGroups.push(group);
    }
    threadMap.get(threadKey).items.push(item);
  });
  const selectedRecipient = availableRecipients.find(item => String(item.id || "").trim() === replyRecipientId) || fallbackSupportRecipient;
  const sendingToSupportGroup = String(selectedRecipient.recipientType || "user") === "group" && String(selectedRecipient.groupKey || "") === "support";
  const supportAwayBlocksSubmit = supportAvailabilityMode === "away" && sendingToSupportGroup && !userCanBypassSupportAway;
  const handleSendMessage = event => {
    if (supportAwayBlocksSubmit) {
      event.preventDefault();
      return;
    }
    props.onSendMessage(event);
  };
  const handleReply = item => {
    props.onStartMessageReply(item);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        composeRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    });
  };
  return <section className="portal-stack">
      {!props.embeddedInInquiry ? <section className="simple-panel">
          <div className="portal-detail-head">
            <div>
              <p className="card-label">쪽지함</p>
              <h3>{`${supportGroupName} 메시지`}</h3>
            </div>
            <div className="admin-inline-actions">
              <button className="ghost-btn refresh-btn" onClick={props.onRefreshMessages} type="button">새로고침</button>
            </div>
          </div>
          <p className="hint">{`공개 커뮤니티 글은 커뮤니티에서, 개별 안내와 ${supportGroupName} 대화는 여기에서 확인합니다.`}</p>
          {supportAvailabilityMode === "away" && !userCanBypassSupportAway ? <div className="inline-message is-info">
              <strong>{`${supportGroupName} 부재중`}</strong>
              <div className="hint">{supportUnavailableMessage}</div>
            </div> : null}
          {props.messageStatus?.message ? <div className={`inline-message ${props.messageStatus.tone === "error" ? "is-error" : ""}`}>{props.messageStatus.message}</div> : null}
        </section> : <section className="simple-panel">
          <div className="portal-detail-head">
            <div>
              <p className="card-label">운영지원 대화</p>
              <h3>{`${supportGroupName} 메시지`}</h3>
            </div>
            <div className="admin-inline-actions">
              <button className="ghost-btn refresh-btn" onClick={props.onRefreshMessages} type="button">새로고침</button>
            </div>
          </div>
          <p className="hint">{`${supportGroupName} 그룹과의 1:1 안내, 회신, 후속 지원 대화를 여기에서 이어갑니다.`}</p>
          {supportAvailabilityMode === "away" && !userCanBypassSupportAway ? <div className="inline-message is-info">
              <strong>{`${supportGroupName} 부재중`}</strong>
              <div className="hint">{supportUnavailableMessage}</div>
            </div> : null}
          {props.messageStatus?.message ? <div className={`inline-message ${props.messageStatus.tone === "error" ? "is-error" : ""}`}>{props.messageStatus.message}</div> : null}
        </section>}

      <form className="qna-form simple-panel" onSubmit={handleSendMessage} ref={composeRef}>
        {props.messageForm.replyToMessageId ? <div className="inline-message is-info">
            <strong>{`회신 대상: ${replyTargetLabel || "선택된 사용자"}`}</strong>
            {replyPreview ? <div className="hint">{replyPreview}</div> : null}
            <div className="admin-inline-actions">
              <span className="hint">회신을 취소하면 일반 새 쪽지 작성 상태로 돌아갑니다.</span>
              <button className="ghost-btn" onClick={props.onCancelMessageReply} type="button">회신 취소</button>
            </div>
          </div> : null}
        <div className="hint">
          {supportAwayBlocksSubmit ? supportUnavailableMessage : `기본 수신 대상은 ${supportGroupName} 그룹입니다.`}
        </div>
        <div className="message-recipient-row">
          <select className="message-recipient-select" value={props.messageForm.recipientId} onChange={event => props.setMessageForm(current => ({
          ...current,
          recipientId: event.target.value
        }))}>
            <option value="">받는사람</option>
            {filteredRecipients.map(item => <option key={item.id} value={item.id}>
                {item.recipientType === "group" ? `${item.groupName || item.name} 그룹${item.representativeUsername ? ` (${item.representativeUsername})` : ""}` : `${item.name} (${item.username})`}
              </option>)}
          </select>
          <button className="ghost-btn open-btn" onClick={() => setShowRecipientSearch(current => !current)} type="button">
            {showRecipientSearch ? "사용자 검색 접기" : "사용자 검색 열기"}
          </button>
        </div>
        {showRecipientSearch ? <input type="search" {...recipientSearchInput} placeholder={`${supportGroupName} 그룹 또는 사용자 검색`} /> : null}
        <input disabled={supportAwayBlocksSubmit} value={props.messageForm.subject} onChange={event => props.setMessageForm(current => ({
        ...current,
        subject: event.target.value
      }))} placeholder="쪽지 제목" />
        <textarea disabled={supportAwayBlocksSubmit} value={props.messageForm.body} onChange={event => props.setMessageForm(current => ({
        ...current,
        body: event.target.value
      }))} placeholder="전달할 내용을 입력해 주세요." />
        <div className="message-compose-meta">
          <span className="status-chip is-muted">{`안읽음 ${unreadCount}건`}</span>
          <span className="status-chip is-muted">{`받는 대상 ${selectedRecipient.recipientType === "group" ? `${selectedRecipient.groupName || selectedRecipient.name} 그룹` : `${selectedRecipient.name} (${selectedRecipient.username})`}`}</span>
          <span className="status-chip is-muted">{`선택 가능 ${filteredRecipients.length}건`}</span>
          <button className="primary-btn" disabled={supportAwayBlocksSubmit} type="submit">{supportAwayBlocksSubmit ? "부재중" : "쪽지 보내기"}</button>
        </div>
      </form>

      <section className="simple-panel">
        <div className="admin-history-search">
          <input type="search" {...searchInput} placeholder="제목, 내용, 사용자명으로 검색" />
          <label className="toggle admin-filter-toggle">
            <input checked={showUnreadOnly} onChange={event => setShowUnreadOnly(event.target.checked)} type="checkbox" />
            <span className="toggle-switch" aria-hidden="true">
              <span className="toggle-thumb" />
            </span>
            <span className="toggle-copy">
              <strong>{showUnreadOnly ? "ON" : "OFF"}</strong>
              <span>{showUnreadOnly ? "안읽음만 보기" : "전체 보기"}</span>
            </span>
          </label>
          <span className="hint">{`표시 ${filteredMessages.length}건 / 전체 ${messages.length}건`}</span>
          <button className={showCleanupOnly ? "primary-btn" : "mini-btn"} disabled={!cleanupMessages.length} onClick={() => setShowCleanupOnly(current => !current)} type="button">
            {showCleanupOnly ? "전체 쪽지 보기" : "정리 요청만 보기"}
          </button>
          {cleanupMessages.length ? <span className={`status-chip ${openCleanupCount ? "is-warn" : "is-success"}`}>{`정리 요청 ${cleanupMessages.length}건 · 진행 ${openCleanupCount}건`}</span> : null}
        </div>
      </section>

      <div className="qna-board">
        {threadGroups.length ? threadGroups.map(group => {
        const latestItem = group.items[0];
        const latestIsIncoming = Number(latestItem.recipientId) === Number(props.session?.id || 0);
        const latestCounterpart = latestIsIncoming ? `${latestItem.senderName || latestItem.senderUsername} (${latestItem.senderUsername})` : latestItem.recipientType === "group" ? `${latestItem.recipientGroupName || latestItem.recipientName || supportGroupName}` : `${latestItem.recipientName || latestItem.recipientUsername} (${latestItem.recipientUsername})`;
        return <section className="message-thread-group simple-panel" key={group.key}>
              <div className="qna-thread-head">
                <strong>{group.subject}</strong>
                <span>{`${group.items.length}건 / 최근 ${formatDateTime(latestItem.createdAt)}`}</span>
              </div>
              <div className="qna-head">
                <strong>{latestIsIncoming ? "최근 보낸 사람" : latestItem.recipientType === "group" ? "최근 받는 그룹" : "최근 받는 사람"}</strong>
                <span>{latestCounterpart}</span>
              </div>
              <div className="message-thread-list">
                {group.items.map(item => {
              const isIncoming = Number(item.recipientId) === Number(props.session?.id || 0);
              const counterpart = isIncoming ? `${item.senderName || item.senderUsername} (${item.senderUsername})` : item.recipientType === "group" ? `${item.recipientGroupName || item.recipientName || supportGroupName}` : `${item.recipientName || item.recipientUsername} (${item.recipientUsername})`;
              const cleanupMeta = isTerminalCloudCleanupMessage(item) ? getCleanupStatusMeta(item.cleanupStatus) : null;
              const cleanupUpdatedLabel = cleanupMeta ? getCleanupStatusUpdatedLabel(item) : "";
              return <article className={`qna-thread notification-thread ${isIncoming && !item.readAt ? "is-unread" : "is-read"}`} key={item.id}>
                      <div className="qna-thread-head">
                        <strong>{item.subject || "제목 없음"}</strong>
                        <span>{formatDateTime(item.createdAt)}</span>
                      </div>
                      <div className="qna-head">
                        <strong>{isIncoming ? "보낸 사람" : item.recipientType === "group" ? "받는 그룹" : "받는 사람"}</strong>
                        <span>{counterpart}</span>
                      </div>
                      <div className="qna-post-body">{item.body || "-"}</div>
                      {cleanupMeta ? <div className="message-cleanup-user-status">
                          <div>
                            <span className={`status-chip ${cleanupMeta.chipClass}`}>{`정리 상태: ${cleanupMeta.label}`}</span>
                            <strong>터미널 클라우드 정리 요청</strong>
                            <span>{cleanupMeta.description}</span>
                          </div>
                          <div>
                            {item.cleanupStatusNote ? <span>{`운영 메모: ${item.cleanupStatusNote}`}</span> : null}
                            {cleanupUpdatedLabel ? <span>{cleanupUpdatedLabel}</span> : null}
                          </div>
                        </div> : null}
                      <div className="admin-inline-actions">
                        <span className={`status-chip ${isIncoming && !item.readAt ? "is-success" : "is-muted"}`}>{isIncoming ? item.readAt ? "읽음" : "안읽음" : "보낸 쪽지"}</span>
                        {isIncoming && !item.readAt ? <button className="mini-btn read-btn" onClick={() => props.onMarkMessageRead(item.id)} type="button">읽음 처리</button> : null}
                        <button className="mini-btn" onClick={() => handleReply(item)} type="button">
                          {Number(props.messageForm.replyToMessageId || 0) === Number(item.id || 0) ? "회신 수정" : "회신"}
                        </button>
                        <button className="mini-btn danger-mini-btn" onClick={() => {
                    if (!window.confirm("이 쪽지를 삭제할까요?")) return;
                    props.onDeleteMessage(item.id);
                  }} type="button">
                          삭제
                        </button>
                        <button className="mini-btn archive-btn" onClick={() => props.onArchiveMessage(item.id)} type="button">보관</button>
                      </div>
                    </article>;
            })}
              </div>
            </section>;
      }) : <section className="simple-panel">
            <p className="hint">{messages.length ? "검색 조건에 맞는 쪽지가 없습니다." : "아직 주고받은 쪽지가 없습니다."}</p>
          </section>}
      </div>
    </section>;
}
export default function InquiryHubView(props) {
  const defaultTab = props.inquiryDefaultTab || (props.section === "messages" ? "support" : props.section === "consulting" ? "service" : "course");
  const [activeTab, setActiveTab] = useState(defaultTab);
  const supportUnreadCount = Math.max(0, Number(props.messageUnreadCount || 0) || 0);
  const courseUnreadCount = Math.max(0, Number(props.qnaUnreadCount || 0) || 0);
  useEffect(() => {
    if (props.section === "messages") {
      setActiveTab("support");
    } else if (props.section === "consulting" || props.section === "customLabs") {
      setActiveTab("service");
    } else if (props.section === "qna") {
      setActiveTab("course");
    }
  }, [props.section]);
  useEffect(() => {
    if (props.inquiryDefaultTab) {
      setActiveTab(props.inquiryDefaultTab);
    }
  }, [props.inquiryDefaultTab]);
  useEffect(() => {
    if (props.communityOnly && activeTab !== "course") setActiveTab("course");
  }, [props.communityOnly, activeTab]);
  const tabs = props.communityOnly ? [{
    key: "course",
    label: "커뮤니티",
    hint: "기술 질문, 오류, 자료 공유",
    badge: courseUnreadCount
  }] : [{
    key: "service",
    label: "상담 및 문의",
    hint: "기술 검토와 운영 상담 문의"
  }, {
    key: "course",
    label: "커뮤니티",
    hint: "기술 질문, 오류, 자료 공유",
    badge: courseUnreadCount
  }, {
    key: "support",
    label: "운영지원 대화",
    hint: "개별 안내와 회신",
    badge: supportUnreadCount
  }];
  return <section className="portal-stack">
      <section className="simple-panel inquiry-hub-panel">
        <div className="portal-detail-head">
          <div>
            <p className="card-label">문의</p>
          <h3>상담 및 문의, 커뮤니티, 운영지원 대화를 한곳에서 확인합니다.</h3>
          </div>
        </div>
        <div className="inquiry-hub-tab-row" role="tablist" aria-label="문의 분류">
          {tabs.map(tabItem => <button aria-selected={activeTab === tabItem.key ? "true" : "false"} className={`tab inquiry-hub-tab ${activeTab === tabItem.key ? "is-active" : ""}`} key={tabItem.key} onClick={() => setActiveTab(tabItem.key)} role="tab" type="button">
              <span>{tabItem.label}</span>
              {tabItem.badge ? <span className="sidebar-badge">{tabItem.badge}</span> : null}
            </button>)}
        </div>
        <p className="hint">{tabs.find(item => item.key === activeTab)?.hint || ""}</p>
      </section>

      {activeTab === "service" ? <ConsultingRequestView {...props} /> : null}
      {activeTab === "course" ? <QnaView {...props} embeddedInInquiry /> : null}
      {activeTab === "support" ? <MessageInboxView {...props} embeddedInInquiry /> : null}
    </section>;
}
