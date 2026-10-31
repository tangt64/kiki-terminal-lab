import { useEffect, useMemo, useState } from "react";
import { api } from "./portal-state.js";
import { AdminField, formatDateTime } from "./portal-views.jsx";

const EMPTY_FORM = {
  title: "",
  description: "",
  question: "",
  status: "draft",
  multiChoice: false,
  showResults: true,
  startAt: "",
  endAt: "",
  optionsText: "다음 실습 주제\n서비스 개선 의견\n신규 강의 요청",
};

function toLocalInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 16);
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromLocalInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}

function getOptionsFromText(value) {
  return Array.from(new Set(String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean)));
}

function votePercent(option, survey) {
  const total = Math.max(0, Number(survey?.totalVotes || 0) || 0);
  if (!total) return 0;
  return Math.round((Number(option.voteCount || 0) / total) * 100);
}

function MarketingSurveyResultBars({ survey, visible = true }) {
  if (!visible) return <p className="hint">결과는 투표 후 또는 관리자 공개 설정에 따라 표시됩니다.</p>;
  return (
    <div className="marketing-survey-bars">
      {(survey.options || []).map((option) => {
        const percent = votePercent(option, survey);
        return (
          <div className="marketing-survey-bar-row" key={option.id}>
            <div className="marketing-survey-bar-label">
              <strong>{option.label}</strong>
              <span>{`${option.voteCount || 0}표 · ${percent}%`}</span>
            </div>
            <div className="marketing-survey-bar-track">
              <div className="marketing-survey-bar-fill" style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MarketingSurveyView() {
  const [surveys, setSurveys] = useState([]);
  const [selectedBySurveyId, setSelectedBySurveyId] = useState({});
  const [status, setStatus] = useState({ tone: "", message: "" });
  const [loading, setLoading] = useState(false);

  async function loadSurveys() {
    setLoading(true);
    try {
      const result = await api("/api/marketing-surveys");
      setSurveys(result.surveys || []);
      setStatus({ tone: "", message: "" });
    } catch (error) {
      setStatus({ tone: "error", message: error.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSurveys();
  }, []);

  async function submitVote(survey) {
    const selected = selectedBySurveyId[survey.id] || [];
    if (!selected.length) {
      setStatus({ tone: "error", message: "선택지를 골라 주세요." });
      return;
    }
    try {
      const result = await api(`/api/marketing-surveys/${survey.id}/vote`, {
        method: "POST",
        body: { optionIds: selected },
      });
      setSurveys((current) => current.map((item) => Number(item.id) === Number(survey.id) ? result.survey : item));
      setStatus({ tone: "success", message: result.message || "투표가 기록되었습니다." });
    } catch (error) {
      setStatus({ tone: "error", message: error.message });
    }
  }

  function toggleOption(survey, optionId) {
    setSelectedBySurveyId((current) => {
      const selected = current[survey.id] || [];
      if (!survey.multiChoice) return { ...current, [survey.id]: [optionId] };
      return {
        ...current,
        [survey.id]: selected.includes(optionId)
          ? selected.filter((id) => id !== optionId)
          : [...selected, optionId],
      };
    });
  }

  return (
    <section className="survey-page marketing-survey-page">
      <div className="survey-hero">
        <div>
          <p className="card-label">Marketing Survey</p>
          <h3>설문 투표</h3>
          <p>진행 중인 설문에 투표하면 선택 기록이 남고, 운영자가 다음 강의와 서비스 개선에 반영합니다.</p>
        </div>
        <div className="survey-hero-metrics">
          <div><span>진행 중</span><strong>{loading ? "-" : surveys.length}</strong></div>
          <div><span>내 참여</span><strong>{surveys.filter((item) => item.mySubmission).length}</strong></div>
        </div>
      </div>

      {status.message ? <div className={`status ${status.tone}`}>{status.message}</div> : null}
      {!surveys.length && !loading ? <div className="empty-state">진행 중인 설문 투표가 없습니다.</div> : null}

      <div className="marketing-survey-list">
        {surveys.map((survey) => {
          const selected = survey.mySubmission?.optionIds || selectedBySurveyId[survey.id] || [];
          const hasVoted = Boolean(survey.mySubmission);
          const canSeeResults = survey.showResults || hasVoted;
          return (
            <article className="survey-form marketing-survey-card" key={survey.id}>
              <div className="survey-form-head">
                <div>
                  <span className="card-label">{survey.multiChoice ? "Multiple Choice" : "Single Choice"}</span>
                  <h3>{survey.title}</h3>
                  {survey.description ? <p className="hint">{survey.description}</p> : null}
                </div>
                <span className={`status-chip ${hasVoted ? "is-success" : ""}`}>{hasVoted ? "투표 완료" : "참여 가능"}</span>
              </div>
              <strong className="marketing-survey-question">{survey.question}</strong>
              <div className="survey-choice-grid">
                {(survey.options || []).map((option) => (
                  <button
                    className={`survey-choice-btn ${selected.includes(option.id) ? "is-selected" : ""}`}
                    disabled={hasVoted}
                    key={option.id}
                    onClick={() => toggleOption(survey, option.id)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="survey-actions">
                <button className="primary-btn" disabled={hasVoted} onClick={() => submitVote(survey)} type="button">투표하기</button>
                <span className="hint">{`${formatDateTime(survey.endAt)} 종료`}</span>
              </div>
              <MarketingSurveyResultBars survey={survey} visible={canSeeResults} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function AdminMarketingSurveysTab() {
  const [surveys, setSurveys] = useState([]);
  const [submissionsBySurveyId, setSubmissionsBySurveyId] = useState({});
  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    startAt: toLocalInputValue(new Date().toISOString()),
    endAt: toLocalInputValue(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()),
  }));
  const [editingId, setEditingId] = useState(null);
  const [status, setStatus] = useState({ tone: "", message: "" });
  const [loading, setLoading] = useState(false);

  const totals = useMemo(() => ({
    surveys: surveys.length,
    active: surveys.filter((survey) => survey.status === "active").length,
    votes: surveys.reduce((sum, survey) => sum + Number(survey.totalVotes || 0), 0),
  }), [surveys]);

  async function loadAdminSurveys() {
    setLoading(true);
    try {
      const result = await api("/api/admin/marketing-surveys");
      setSurveys(result.surveys || []);
      setSubmissionsBySurveyId(result.submissionsBySurveyId || {});
      setStatus({ tone: "", message: "" });
    } catch (error) {
      setStatus({ tone: "error", message: error.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAdminSurveys();
  }, []);

  function resetForm() {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      startAt: toLocalInputValue(new Date().toISOString()),
      endAt: toLocalInputValue(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()),
    });
  }

  function editSurvey(survey) {
    setEditingId(survey.id);
    setForm({
      title: survey.title || "",
      description: survey.description || "",
      question: survey.question || "",
      status: survey.status || "draft",
      multiChoice: Boolean(survey.multiChoice),
      showResults: survey.showResults !== false,
      startAt: toLocalInputValue(survey.startAt),
      endAt: toLocalInputValue(survey.endAt),
      optionsText: (survey.options || []).map((option) => option.label).join("\n"),
    });
  }

  async function saveSurvey(event) {
    event.preventDefault();
    const body = {
      title: form.title,
      description: form.description,
      question: form.question,
      status: form.status,
      multiChoice: form.multiChoice,
      showResults: form.showResults,
      startAt: fromLocalInputValue(form.startAt),
      endAt: fromLocalInputValue(form.endAt),
      options: getOptionsFromText(form.optionsText),
    };
    try {
      const result = await api(editingId ? `/api/admin/marketing-surveys/${editingId}` : "/api/admin/marketing-surveys", {
        method: editingId ? "PATCH" : "POST",
        body,
      });
      setStatus({ tone: "success", message: result.message || "설문을 저장했습니다." });
      resetForm();
      await loadAdminSurveys();
    } catch (error) {
      setStatus({ tone: "error", message: error.message });
    }
  }

  async function deleteSurvey(survey) {
    if (Number(survey.totalVotes || 0) > 0) {
      setStatus({ tone: "error", message: "투표 기록이 있는 설문은 삭제할 수 없습니다. 상태를 ended로 바꿔 보관해 주세요." });
      return;
    }
    if (!window.confirm(`${survey.title} 설문을 삭제할까요?`)) return;
    try {
      const result = await api(`/api/admin/marketing-surveys/${survey.id}`, { method: "DELETE" });
      setStatus({ tone: "success", message: result.message || "설문을 삭제했습니다." });
      await loadAdminSurveys();
    } catch (error) {
      setStatus({ tone: "error", message: error.message });
    }
  }

  return (
    <section className="portal-stack marketing-survey-admin">
      <div className="admin-summary-grid">
        <div className="admin-summary-card"><span className="card-label">설문</span><strong>{totals.surveys}</strong><div className="hint">전체 설문</div></div>
        <div className="admin-summary-card"><span className="card-label">진행</span><strong>{totals.active}</strong><div className="hint">active 상태</div></div>
        <div className="admin-summary-card"><span className="card-label">투표 기록</span><strong>{totals.votes}</strong><div className="hint">제출 기준</div></div>
      </div>

      {status.message ? <div className={`status ${status.tone}`}>{status.message}</div> : null}

      <section className="admin-simple-card">
        <div className="admin-card-header">
          <div>
            <strong>{editingId ? "설문 투표 수정" : "설문 투표 만들기"}</strong>
            <p className="hint">사용자 투표는 제출 기록과 선택 기록으로 저장됩니다.</p>
          </div>
          {editingId ? <button className="ghost-btn" onClick={resetForm} type="button">새 설문</button> : null}
        </div>
        <form className="admin-form" onSubmit={saveSurvey}>
          <div className="admin-form-grid compact-admin-grid">
            <AdminField label="제목" required><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="다음 실습 주제 투표" /></AdminField>
            <AdminField label="상태"><select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="draft">draft</option><option value="active">active</option><option value="ended">ended</option></select></AdminField>
            <AdminField label="질문" required><input value={form.question} onChange={(event) => setForm((current) => ({ ...current, question: event.target.value }))} placeholder="다음에 듣고 싶은 실습 주제는 무엇인가요?" /></AdminField>
            <AdminField label="설명"><textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="투표 목적이나 반영 기준을 적어주세요." /></AdminField>
            <AdminField label="시작"><input type="datetime-local" value={form.startAt} onChange={(event) => setForm((current) => ({ ...current, startAt: event.target.value }))} /></AdminField>
            <AdminField label="종료"><input type="datetime-local" value={form.endAt} onChange={(event) => setForm((current) => ({ ...current, endAt: event.target.value }))} /></AdminField>
            <AdminField label="선택지" required hint="한 줄에 하나씩 입력합니다. 투표 기록이 있으면 선택지는 수정할 수 없습니다."><textarea rows={5} value={form.optionsText} onChange={(event) => setForm((current) => ({ ...current, optionsText: event.target.value }))} /></AdminField>
            <div className="settings-toggle-list">
              <label><input checked={form.multiChoice} onChange={(event) => setForm((current) => ({ ...current, multiChoice: event.target.checked }))} type="checkbox" /> 복수 선택 허용</label>
              <label><input checked={form.showResults} onChange={(event) => setForm((current) => ({ ...current, showResults: event.target.checked }))} type="checkbox" /> 사용자 결과 공개</label>
            </div>
          </div>
          <div className="portal-actions">
            <button className="mini-btn primary-mini-btn" type="submit">{editingId ? "수정 저장" : "설문 생성"}</button>
            <button className="mini-btn" onClick={loadAdminSurveys} type="button">{loading ? "불러오는 중" : "새로고침"}</button>
          </div>
        </form>
      </section>

      <section className="admin-simple-card">
        <div className="admin-card-header"><strong>설문 투표 목록</strong></div>
        <div className="marketing-survey-admin-list">
          {surveys.length ? surveys.map((survey) => {
            const submissions = submissionsBySurveyId[survey.id] || [];
            return (
              <article className="survey-summary-card marketing-survey-admin-card" key={survey.id}>
                <div className="survey-form-head">
                  <div>
                    <span className="card-label">{survey.status}</span>
                    <strong>{survey.title}</strong>
                    <p className="hint">{survey.question}</p>
                  </div>
                  <div className="admin-inline-actions">
                    <button className="mini-btn" onClick={() => editSurvey(survey)} type="button">수정</button>
                    <button className="mini-btn danger-mini-btn" onClick={() => deleteSurvey(survey)} type="button">삭제</button>
                  </div>
                </div>
                <MarketingSurveyResultBars survey={survey} visible />
                <div className="admin-table admin-table-scroll marketing-survey-submission-table">
                  <div className="admin-table-head marketing-survey-submission-grid"><span>사용자</span><span>선택</span><span>투표 시각</span></div>
                  {submissions.length ? submissions.map((submission) => (
                    <div className="admin-table-row marketing-survey-submission-grid" key={submission.id}>
                      <span><strong>{submission.userName || submission.username || "-"}</strong><div className="hint">{submission.email || submission.username || "-"}</div></span>
                      <span>
                        <div>{submission.optionLabels.join(", ") || "-"}</div>
                        {submission.surveyQuestion ? <div className="hint">{submission.surveyQuestion}</div> : null}
                      </span>
                      <span>{formatDateTime(submission.submittedAt)}</span>
                    </div>
                  )) : <div className="empty-state">아직 투표 기록이 없습니다.</div>}
                </div>
              </article>
            );
          }) : <div className="empty-state">등록된 설문 투표가 없습니다.</div>}
        </div>
      </section>
    </section>
  );
}

export default MarketingSurveyView;
