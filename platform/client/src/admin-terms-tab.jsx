import { useEffect, useMemo, useState } from "react";
import { api } from "./portal-state.js";
import { AdminField, StatusMessage, formatDateTime } from "./portal-views.jsx";

const EMPTY_TERMS_FORM = {
  id: null,
  termsKey: "standard_terms",
  title: "",
  version: "",
  summary: "",
  body: "",
  isActive: true,
};

const TERMS_KEY_LABELS = {
  standard_terms: "표준 약관",
  service_additional_terms: "서비스 추가 약관",
};

function getTermsKeyLabel(key) {
  return TERMS_KEY_LABELS[key] || key || "-";
}

function createVersionStamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function createEmptyForm(termsKey = "standard_terms") {
  return {
    ...EMPTY_TERMS_FORM,
    termsKey: termsKey || "standard_terms",
    version: createVersionStamp(),
    isActive: true,
  };
}

export function AdminTermsTab(props) {
  const [terms, setTerms] = useState([]);
  const [form, setForm] = useState(createEmptyForm());
  const [editorOpen, setEditorOpen] = useState(false);
  const [status, setStatus] = useState({ tone: "", message: "" });
  const [loading, setLoading] = useState(false);
  const activeTerms = useMemo(() => terms.filter((item) => item.isActive), [terms]);
  const groupedTerms = useMemo(() => {
    const groups = new Map();
    terms.forEach((item) => {
      const key = item.termsKey || "standard_terms";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return Array.from(groups.entries());
  }, [terms]);

  async function loadTerms() {
    setLoading(true);
    try {
      const result = await api("/api/admin/terms");
      setTerms(result.terms || []);
      setStatus({ tone: "", message: "" });
    } catch (error) {
      setStatus({ tone: "error", message: error.message || "약관 목록을 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTerms();
  }, []);

  function openCreateForm(termsKey = form.termsKey) {
    setForm(createEmptyForm(termsKey));
    setEditorOpen(true);
  }

  function closeEditor() {
    setForm(createEmptyForm(form.termsKey));
    setEditorOpen(false);
  }

  function editTerm(term) {
    if (term.isActive) {
      setForm({
        id: null,
        termsKey: term.termsKey || "standard_terms",
        title: term.title || "",
        version: createVersionStamp(),
        summary: term.summary || "",
        body: term.body || "",
        isActive: true,
      });
      setEditorOpen(true);
      setStatus({ tone: "warn", message: "활성 약관은 새 버전으로 복사했습니다. 버전을 확인한 뒤 저장해 주세요." });
      return;
    }
    setForm({
      id: term.id,
      termsKey: term.termsKey || "standard_terms",
      title: term.title || "",
      version: term.version || "",
      summary: term.summary || "",
      body: term.body || "",
      isActive: Boolean(term.isActive),
    });
    setEditorOpen(true);
  }

  async function saveTerms(event) {
    event.preventDefault();
    if (!form.title.trim() || !form.version.trim() || !form.body.trim()) {
      setStatus({ tone: "error", message: "약관명, 버전, 본문을 모두 입력해 주세요." });
      return;
    }
    try {
      const payload = {
        termsKey: form.termsKey,
        title: form.title,
        version: form.version,
        summary: form.summary,
        body: form.body,
        isActive: form.isActive,
      };
      const result = form.id
        ? await api(`/api/admin/terms/${form.id}`, { method: "PATCH", body: payload })
        : await api("/api/admin/terms", { method: "POST", body: payload });
      setStatus({ tone: "success", message: result.message || "약관을 저장했습니다." });
      props.setAdminStatus?.(result.message || "약관을 저장했습니다.");
      await loadTerms();
      setForm(createEmptyForm(form.termsKey));
      setEditorOpen(false);
    } catch (error) {
      setStatus({ tone: "error", message: error.message || "약관 저장 중 오류가 발생했습니다." });
    }
  }

  async function updateTermActiveState(term, isActive) {
    try {
      const result = await api(`/api/admin/terms/${term.id}`, {
        method: "PATCH",
        body: {
          termsKey: term.termsKey,
          title: term.title,
          version: term.version,
          summary: term.summary,
          body: term.body,
          isActive,
        },
      });
      const fallback = isActive ? "약관을 활성화했습니다." : "약관을 비활성화했습니다.";
      setStatus({ tone: "success", message: result.message || fallback });
      props.setAdminStatus?.(result.message || fallback);
      await loadTerms();
    } catch (error) {
      setStatus({ tone: "error", message: error.message || (isActive ? "약관 활성화 중 오류가 발생했습니다." : "약관 비활성화 중 오류가 발생했습니다.") });
    }
  }

  return (
    <section className="portal-stack">
      <div className="admin-simple-card">
        <div className="admin-card-header">
          <strong>약관 관리</strong>
          <div className="admin-inline-actions">
            <button className="primary-mini-btn" onClick={() => openCreateForm()} type="button">새 약관 추가</button>
            <button className="mini-btn" onClick={loadTerms} type="button">{loading ? "새로고침 중" : "새로고침"}</button>
          </div>
        </div>
        <p className="hint">회원가입과 기존 사용자 재동의에 사용할 표준 약관과 서비스 추가 약관을 버전별로 관리합니다.</p>
        <StatusMessage {...status} />
        <div className="admin-summary-grid">
          {["standard_terms", "service_additional_terms"].map((key) => {
            const active = activeTerms.find((item) => item.termsKey === key);
            return (
              <article className="admin-summary-item" key={key}>
                <span>{getTermsKeyLabel(key)}</span>
                <strong>{active ? active.version : "미설정"}</strong>
                <div className="hint">{active ? active.title : "활성 약관을 등록해 주세요."}</div>
              </article>
            );
          })}
        </div>
      </div>

      <div className={editorOpen ? "admin-template-columns terms-admin-layout" : "portal-stack terms-admin-layout"}>
        {editorOpen ? (
          <form className="admin-simple-card admin-form" onSubmit={saveTerms}>
            <div className="admin-card-header">
              <strong>{form.id ? "약관 버전 수정" : "새 약관 버전"}</strong>
              <div className="admin-inline-actions">
                <button className="mini-btn" onClick={() => openCreateForm()} type="button">새 버전 작성</button>
                <button className="mini-btn" onClick={closeEditor} type="button">닫기</button>
              </div>
            </div>
            <div className="admin-form-grid compact-admin-grid">
              <AdminField label="약관 종류">
                <select value={form.termsKey} onChange={(event) => openCreateForm(event.target.value)}>
                  <option value="standard_terms">표준 약관</option>
                  <option value="service_additional_terms">서비스 추가 약관</option>
                </select>
              </AdminField>
              <AdminField label="버전">
                <input value={form.version} onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))} placeholder="예: 2026-04-27" />
              </AdminField>
              <AdminField label="약관명">
                <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="예: Terminal Lab 표준약관" />
              </AdminField>
              <AdminField label="상태">
                <select value={form.isActive ? "active" : "draft"} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.value === "active" }))}>
                  <option value="active">저장 후 활성화</option>
                  <option value="draft">비활성 버전으로 저장</option>
                </select>
              </AdminField>
            </div>
            <AdminField label="요약">
              <textarea rows={3} value={form.summary} onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))} placeholder="개정 사유나 주요 변경 내용을 입력하세요." />
            </AdminField>
            <AdminField label="본문">
              <textarea
                className="code-textarea"
                rows={20}
                value={form.body}
                onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
                placeholder={"# Terminal Lab 표준약관\n\n## 제1조 목적\n\n약관의 목적을 입력하세요.\n\n## 제2조 정의\n\n1. **서비스**란 ...\n2. **회원**이란 ...\n\n## 제3조 금지행위\n\n- 비인가 접근\n- 악성코드 유포\n- 과도한 트래픽 발생\n\n```text\n필요한 고지문 또는 예외사항\n```"}
              />
            </AdminField>
            <div className="admin-inline-actions">
              <button className="primary-mini-btn" type="submit">{form.id ? "버전 저장" : "새 버전 저장"}</button>
              <button className="mini-btn" onClick={closeEditor} type="button">취소</button>
            </div>
          </form>
        ) : null}

        <div className="portal-stack">
          {groupedTerms.length ? groupedTerms.map(([key, items]) => (
            <section className="admin-simple-card" key={key}>
              <div className="admin-card-header">
                <strong>{getTermsKeyLabel(key)}</strong>
                <span className="hint">{items.length}개 버전</span>
              </div>
              <div className="admin-table-scroll">
                <table className="admin-log-table">
                  <thead>
                    <tr>
                      <th>상태</th>
                      <th>버전</th>
                      <th>약관명</th>
                      <th>갱신일</th>
                      <th>작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((term) => (
                      <tr key={term.id}>
                        <td>{term.isActive ? "활성" : "비활성"}</td>
                        <td>{term.version}</td>
                        <td>
                          <strong>{term.title}</strong>
                          <div className="hint">{term.summary || "요약 없음"}</div>
                        </td>
                        <td>{formatDateTime(term.updatedAt || term.createdAt)}</td>
                        <td>
                          <div className="admin-inline-actions">
                            <button className="mini-btn" onClick={() => editTerm(term)} type="button">{term.isActive ? "새 버전" : "수정"}</button>
                            {term.isActive ? (
                              <button className="mini-btn danger-mini-btn" onClick={() => updateTermActiveState(term, false)} type="button">비활성화</button>
                            ) : (
                              <button className="mini-btn save-btn" onClick={() => updateTermActiveState(term, true)} type="button">활성화</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )) : (
            <section className="admin-simple-card">
              <p className="hint">등록된 약관 버전이 없습니다. 표준 약관과 서비스 추가 약관을 각각 등록해 주세요.</p>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
