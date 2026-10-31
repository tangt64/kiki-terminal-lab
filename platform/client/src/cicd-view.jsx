import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./portal-state.js";
import { formatDateTime, StatusMessage } from "./portal-views.jsx";

const EMPTY_PROJECT_FORM = {
  name: "",
  repositoryUrl: "",
  branch: "main",
  jenkinsfilePath: "Jenkinsfile",
  description: "",
};

const EMPTY_CREDENTIAL_FORM = {
  name: "",
  credentialType: "ssh_private_key",
  username: "rocky",
  secret: "",
  passphrase: "",
  description: "",
};

const CREDENTIAL_TYPE_LABELS = {
  ssh_private_key: "SSH 개인키",
  username_password: "사용자명/비밀번호",
  secret_text: "비밀 문자열",
};

const CICD_EXAMPLES = [
  {
    title: "Node.js 빌드/테스트",
    code: "npm ci\nnpm run build --if-present\nnpm test --if-present",
  },
  {
    title: "VM 배포 예제",
    code: "chmod +x deploy.sh\n./deploy.sh",
  },
  {
    title: "Kubernetes 배포 예제",
    code: "kubectl apply -f k8s/deployment.yaml\nkubectl rollout status deploy/app -n default",
  },
];

const CICD_USAGE_STEPS = [
  {
    number: "1",
    title: "가상머신 준비",
    description: "Terminal Lab에서 배포 대상 VM을 만든 뒤 내부 IP와 SSH 사용자를 확인합니다. Jenkins 서버에서 VM의 22/tcp에 접근할 수 있어야 합니다.",
  },
  {
    number: "2",
    title: "배포 자격 증명 등록",
    description: "각 사용자가 아래 '내 Jenkins Credentials'에 VM 전용 SSH 키를 등록합니다. 발급된 Credential ID를 Jenkinsfile에 넣고 비밀번호나 개인키는 직접 넣지 않습니다.",
  },
  {
    number: "3",
    title: "저장소 연결",
    description: "Git 저장소에 Jenkinsfile과 deploy.sh를 추가하고, 아래 새 파이프라인에 저장소 주소·브랜치·Jenkinsfile 경로를 등록합니다.",
  },
  {
    number: "4",
    title: "실행 및 확인",
    description: "실행을 누르면 Terminal Lab이 Jenkins 작업을 생성·호출합니다. 빌드와 테스트 후 Jenkins가 VM에 배포하고, 결과는 실행 이력에 자동 반영됩니다.",
  },
];

const VM_DEPLOY_JENKINSFILE = `pipeline {
  agent any
  environment {
    VM_HOST = '192.0.2.100' // 대상 VM 내부 IP
  }
  stages {
    stage('Build & Test') {
      steps { sh 'npm ci && npm test' }
    }
    stage('Deploy VM') {
      steps {
        withCredentials([sshUserPrivateKey(
          credentialsId: 'tlab-u123-my-vm-key-ab12cd34', // 화면에 표시된 ID
          keyFileVariable: 'SSH_KEY',
          usernameVariable: 'SSH_USER'
        )]) {
          sh './deploy.sh "$VM_HOST" "$SSH_USER" "$SSH_KEY"'
        }
      }
    }
  }
}`;

const RUN_STATUS_LABELS = {
  queued: "대기",
  running: "실행 중",
  success: "성공",
  failed: "실패",
  cancelled: "취소",
};

const PROJECT_STATUS_LABELS = {
  active: "활성",
  paused: "일시정지",
  archived: "보관",
};

function getStatusLabel(status, labels = RUN_STATUS_LABELS) {
  const key = String(status || "").trim().toLowerCase();
  return labels[key] || status || "-";
}

function getCicdApiPrefix(adminMode) {
  return adminMode ? "/api/admin/cicd" : "/api/cicd";
}

function PipelineStatusChip({ status, labels }) {
  const normalized = String(status || "").trim().toLowerCase();
  return <span className={`status-chip cicd-status cicd-status-${normalized || "unknown"}`}>{getStatusLabel(normalized, labels)}</span>;
}

function CicdProjectForm({ disabled, onSubmit }) {
  const [form, setForm] = useState(EMPTY_PROJECT_FORM);

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await onSubmit(form);
    setForm(EMPTY_PROJECT_FORM);
  };

  return (
    <form className="admin-simple-card cicd-project-form" onSubmit={handleSubmit}>
      <div>
        <p className="eyebrow">파이프라인</p>
        <h3>새 파이프라인</h3>
        <p className="hint">Jenkinsfile 경로를 기준으로 Jenkins 작업이 생성되고, 빌드 서버 정보는 내부 설정으로 처리됩니다.</p>
      </div>
      <div className="admin-form-grid">
        <label>
          이름
          <input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="terminal-lab-app" required />
        </label>
        <label>
          Git 저장소
          <input value={form.repositoryUrl} onChange={(event) => updateField("repositoryUrl", event.target.value)} placeholder="https://git.example/lab/app.git" />
        </label>
        <label>
          브랜치
          <input value={form.branch} onChange={(event) => updateField("branch", event.target.value)} placeholder="main" />
        </label>
        <label>
          Jenkinsfile 경로
          <input value={form.jenkinsfilePath} onChange={(event) => updateField("jenkinsfilePath", event.target.value)} placeholder="Jenkinsfile 또는 ci/Jenkinsfile" />
        </label>
        <label className="admin-field-wide">
          설명
          <textarea value={form.description} onChange={(event) => updateField("description", event.target.value)} rows={3} placeholder="VM 이미지 빌드, 컨테이너 빌드, 스테이징 VM/K8s 배포" />
        </label>
      </div>
      <CicdExamplePanel />
      <div className="admin-card-actions">
        <button className="primary-btn" disabled={disabled} type="submit">생성</button>
      </div>
    </form>
  );
}

function CicdExamplePanel() {
  return (
    <div className="cicd-example-panel">
      <div>
        <p className="eyebrow">Jenkinsfile 예제</p>
        <strong>저장소에 아래 흐름 중 필요한 단계만 넣어도 바로 테스트할 수 있습니다.</strong>
      </div>
      <div className="cicd-example-grid">
        {CICD_EXAMPLES.map((example) => (
          <figure className="cicd-example-card" key={example.title}>
            <figcaption>{example.title}</figcaption>
            <pre><code>{example.code}</code></pre>
          </figure>
        ))}
      </div>
    </div>
  );
}

function CicdUsageGuide() {
  return (
    <details className="admin-simple-card cicd-usage-guide" open>
      <summary>
        <span>
          <span className="eyebrow">사용 방법</span>
          <strong>Terminal Lab 가상머신과 파이프라인 연결하기</strong>
        </span>
        <span className="cicd-guide-summary-hint">안내 열기/접기</span>
      </summary>

      <div className="cicd-connection-flow" aria-label="CI/CD 가상머신 배포 흐름">
        <span>Git 저장소</span><i aria-hidden="true">→</i>
        <span>Terminal Lab</span><i aria-hidden="true">→</i>
        <span>Jenkins</span><i aria-hidden="true">→</i>
        <span>가상머신 내부 IP:22</span>
      </div>

      <div className="cicd-usage-step-grid">
        {CICD_USAGE_STEPS.map((step) => (
          <article key={step.number}>
            <span className="cicd-step-number">{step.number}</span>
            <div>
              <h4>{step.title}</h4>
              <p>{step.description}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="cicd-vm-guide-grid">
        <div className="cicd-vm-guide-note">
          <p className="eyebrow">연동 기준</p>
          <h4>VM을 파이프라인에 연결하는 방식</h4>
          <ul>
            <li>파이프라인이 VM을 자동 선택하지 않습니다. 저장소의 Jenkinsfile에서 대상 VM 내부 IP를 지정합니다.</li>
            <li>Jenkins에서 VM 보안그룹의 SSH 22/tcp로 접근할 수 있어야 합니다.</li>
            <li>외부 웹 터미널 포트보다 내부 IP를 사용하면 경로가 단순하고 접근 범위를 제한하기 쉽습니다.</li>
            <li>운영 배포 키는 VM별 또는 과정별로 분리하고 Jenkins Credentials에서 관리합니다.</li>
          </ul>
        </div>
        <figure className="cicd-vm-code-card">
          <figcaption>Jenkinsfile VM 배포 예제</figcaption>
          <pre><code>{VM_DEPLOY_JENKINSFILE}</code></pre>
        </figure>
      </div>
    </details>
  );
}

function CicdCredentialManager({ busy, credentials, onCreate, onDelete }) {
  const [form, setForm] = useState(EMPTY_CREDENTIAL_FORM);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    await onCreate(form);
    setForm(EMPTY_CREDENTIAL_FORM);
  };
  return (
    <section className="admin-simple-card cicd-credential-manager">
      <div className="cicd-card-head">
        <div>
          <p className="eyebrow">사용자별 보안</p>
          <h3>내 Jenkins Credentials</h3>
          <p className="hint">등록한 비밀 값은 Jenkins로 즉시 전달되며 다시 표시되지 않습니다. 다른 사용자는 목록과 Credential ID에 접근할 수 없습니다.</p>
        </div>
        <span className="status-chip">{credentials.length}/20</span>
      </div>
      <form className="admin-form-grid cicd-credential-form" onSubmit={submit}>
        <label>
          이름
          <input required maxLength={80} value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="스테이징 VM 배포 키" />
        </label>
        <label>
          종류
          <select value={form.credentialType} onChange={(event) => update("credentialType", event.target.value)}>
            <option value="ssh_private_key">SSH 개인키</option>
            <option value="username_password">사용자명/비밀번호</option>
            <option value="secret_text">비밀 문자열</option>
          </select>
        </label>
        {form.credentialType !== "secret_text" ? (
          <label>
            사용자명
            <input required value={form.username} onChange={(event) => update("username", event.target.value)} placeholder="rocky" />
          </label>
        ) : null}
        <label className="admin-field-wide">
          {form.credentialType === "ssh_private_key" ? "PEM 개인키" : form.credentialType === "username_password" ? "비밀번호" : "비밀 문자열"}
          {form.credentialType === "ssh_private_key" ? (
            <textarea required rows={6} value={form.secret} onChange={(event) => update("secret", event.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
          ) : (
            <input required type="password" value={form.secret} onChange={(event) => update("secret", event.target.value)} autoComplete="new-password" />
          )}
        </label>
        {form.credentialType === "ssh_private_key" ? (
          <label>
            키 암호 (선택)
            <input type="password" value={form.passphrase} onChange={(event) => update("passphrase", event.target.value)} autoComplete="new-password" />
          </label>
        ) : null}
        <label className="admin-field-wide">
          설명
          <input maxLength={300} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="과정 또는 대상 VM 용도" />
        </label>
        <div className="admin-card-actions admin-field-wide">
          <button className="primary-btn" disabled={busy || credentials.length >= 20} type="submit">Credential 등록</button>
        </div>
      </form>
      <div className="cicd-credential-list">
        {credentials.length ? credentials.map((credential) => (
          <article key={credential.id}>
            <div>
              <strong>{credential.name}</strong>
              <small>{CREDENTIAL_TYPE_LABELS[credential.credentialType] || credential.credentialType}{credential.username ? ` · ${credential.username}` : ""}</small>
              <code>{credential.jenkinsCredentialId}</code>
            </div>
            <button className="mini-btn danger-mini-btn" disabled={busy} onClick={() => onDelete(credential)} type="button">삭제</button>
          </article>
        )) : <div className="empty-state">등록된 Credential이 없습니다.</div>}
      </div>
    </section>
  );
}

function CicdProjectCard({ adminMode, busyId, project, onOpenRun, onTrigger, onStatusChange }) {
  const stages = Array.isArray(project.stages) ? project.stages : [];
  return (
    <article className="admin-simple-card cicd-project-card">
      <div className="cicd-card-head">
        <div>
          <p className="eyebrow">Jenkins</p>
          <h3>{project.name}</h3>
          <p className="hint">{project.repositoryUrl || "저장소 미지정"} · {project.branch || "main"}</p>
        </div>
        <PipelineStatusChip status={project.status} labels={PROJECT_STATUS_LABELS} />
      </div>
      {project.description ? <p className="cicd-project-description">{project.description}</p> : null}
      <div className="cicd-stage-strip" aria-label={project.name+" 단계"}>
        {stages.map((stage) => (
          <span className="cicd-stage-pill" key={stage.key}>{stage.label || stage.key}</span>
        ))}
      </div>
      <dl className="cicd-meta-list">
        <div><dt>소유자</dt><dd>{project.userName || project.username || "-"}</dd></div>
        <div><dt>Jenkinsfile</dt><dd>{project.jenkinsfilePath || "Jenkinsfile"}</dd></div>
        <div><dt>수정</dt><dd>{formatDateTime(project.updatedAt)}</dd></div>
      </dl>
      <div className="admin-card-actions">
        <button className="primary-btn" disabled={busyId === project.id || project.status !== "active"} onClick={() => onTrigger(project)} type="button">실행</button>
        <button className="mini-btn" onClick={() => onOpenRun(project)} type="button">최근 실행</button>
        {adminMode ? (
          <select className="cicd-status-select" value={project.status || "active"} onChange={(event) => onStatusChange(project, event.target.value)}>
            <option value="active">활성</option>
            <option value="paused">일시정지</option>
            <option value="archived">보관</option>
          </select>
        ) : null}
      </div>
    </article>
  );
}

function CicdRunList({ runs, selectedRunId, onSelectRun }) {
  if (!runs.length) {
    return <div className="empty-state">실행 이력이 없습니다.</div>;
  }
  return (
    <div className="cicd-run-list">
      {runs.map((run) => (
        <button className={`cicd-run-row ${String(selectedRunId) === String(run.id) ? "active" : ""}`} key={run.id} onClick={() => onSelectRun(run)} type="button">
          <span>
            <strong>{run.projectName || `실행 #${run.id}`}</strong>
            <small>{run.sourceBranch || run.projectBranch || "main"} · {formatDateTime(run.createdAt)}</small>
          </span>
          <PipelineStatusChip status={run.status} />
        </button>
      ))}
    </div>
  );
}

function CicdRunDetail({ run }) {
  if (!run) {
    return <div className="empty-state">실행을 선택해 주세요.</div>;
  }
  const events = Array.isArray(run.events) ? run.events : [];
  return (
    <article className="admin-simple-card cicd-run-detail">
      <div className="cicd-card-head">
        <div>
          <p className="eyebrow">실행 #{run.id}</p>
          <h3>{run.projectName || "파이프라인 실행"}</h3>
          <p className="hint">{run.summary || "요약 없음"} · {run.currentStage || "단계"}</p>
        </div>
        <PipelineStatusChip status={run.status} />
      </div>
      <dl className="cicd-meta-list">
        <div><dt>트리거</dt><dd>{run.triggerType === "manual" ? "수동" : run.triggerType || "수동"}</dd></div>
        <div><dt>브랜치</dt><dd>{run.sourceBranch || run.projectBranch || "-"}</dd></div>
        <div><dt>시작</dt><dd>{formatDateTime(run.startedAt)}</dd></div>
        <div><dt>종료</dt><dd>{formatDateTime(run.finishedAt)}</dd></div>
      </dl>
      <div className="cicd-event-list">
        {events.length ? events.map((event) => (
          <div className="cicd-event-row" key={event.id}>
            <PipelineStatusChip status={event.status} />
            <span>
              <strong>{event.stage || "이벤트"}</strong>
              <small>{event.message}</small>
            </span>
            <time>{formatDateTime(event.createdAt)}</time>
          </div>
        )) : <div className="empty-state">스테이지 이벤트가 없습니다.</div>}
      </div>
    </article>
  );
}

function JenkinsSettingsCard({ platformStatus = {}, setPlatformStatus, onSavePlatformSettings }) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [testError, setTestError] = useState("");
  const update = (patch) => {
    if (typeof setPlatformStatus !== "function") return;
    setPlatformStatus((current) => ({ ...current, ...patch }));
  };
  const testConnection = async () => {
    setTesting(true);
    setTestResult("");
    setTestError("");
    try {
      const payload = await api("/api/admin/cicd/jenkins/test", { method: "POST", body: {} });
      const detail = payload.result?.version ? `Jenkins ${payload.result.version}` : payload.message;
      setTestResult(detail || "Jenkins 연결을 확인했습니다.");
    } catch (error) {
      setTestError(error.message || "Jenkins 연결 확인에 실패했습니다.");
    } finally {
      setTesting(false);
    }
  };
  return (
    <article className="admin-simple-card cicd-jenkins-settings">
      <div className="cicd-card-head">
        <div>
          <p className="eyebrow">실행 엔진</p>
          <h3>Jenkins 연동</h3>
          <p className="hint">Jenkins를 사용해 Terminal Lab이 작업을 만들고 빌드를 실행합니다. 사용자 화면에는 Jenkins URL을 노출하지 않습니다.</p>
        </div>
        <PipelineStatusChip
          labels={{ jenkins: "Jenkins", simulated: "모의 실행" }}
          status={platformStatus.cicdExecutionMode === "jenkins" ? "jenkins" : "simulated"}
        />
      </div>
      <div className="admin-form-grid">
        <label>
          실행 모드
          <select value={platformStatus.cicdExecutionMode === "jenkins" ? "jenkins" : "simulated"} onChange={(event) => update({ cicdExecutionMode: event.target.value })}>
            <option value="simulated">모의 실행</option>
            <option value="jenkins">Jenkins</option>
          </select>
        </label>
        <label>
          Jenkins URL
          <input value={platformStatus.jenkinsBaseUrl || ""} onChange={(event) => update({ jenkinsBaseUrl: event.target.value })} placeholder="https://jenkins.example/" />
        </label>
        <label>
          사용자
          <input value={platformStatus.jenkinsUsername || ""} onChange={(event) => update({ jenkinsUsername: event.target.value })} placeholder="terminal-lab" />
        </label>
        <label>
          API 토큰
          <input type="password" value={platformStatus.jenkinsApiToken || ""} onChange={(event) => update({ jenkinsApiToken: event.target.value })} placeholder={platformStatus.jenkinsApiTokenConfigured ? "저장된 토큰 사용 중" : "Jenkins API 토큰"} />
        </label>
        <label>
          기본 폴더
          <input value={platformStatus.jenkinsDefaultFolder || "terminal-lab"} onChange={(event) => update({ jenkinsDefaultFolder: event.target.value })} placeholder="terminal-lab" />
        </label>
        <label>
          작업 이름 접두사
          <input value={platformStatus.jenkinsJobPrefix || ""} onChange={(event) => update({ jenkinsJobPrefix: event.target.value })} placeholder="tlab-" />
        </label>
        <label>
          작업 생성
          <select value={platformStatus.jenkinsAutoCreateJobs === false ? "disabled" : "enabled"} onChange={(event) => update({ jenkinsAutoCreateJobs: event.target.value === "enabled" })}>
            <option value="enabled">자동 생성</option>
            <option value="disabled">기존 작업만 사용</option>
          </select>
        </label>
      </div>
      <div className="admin-card-actions">
        <button className="mini-btn save-btn" onClick={onSavePlatformSettings} type="button">설정 저장</button>
        <button className="mini-btn" disabled={testing} onClick={testConnection} type="button">연결 테스트</button>
      </div>
      <StatusMessage tone="success" message={testResult} />
      <StatusMessage tone="error" message={testError} />
    </article>
  );
}

function CicdDashboard({ adminMode = false, platformStatus = {}, setPlatformStatus, onSavePlatformSettings }) {
  const [projects, setProjects] = useState([]);
  const [runs, setRuns] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const prefix = getCicdApiPrefix(adminMode);

  const stats = useMemo(() => {
    const activeProjects = projects.filter((project) => project.status === "active").length;
    const successfulRuns = runs.filter((run) => run.status === "success").length;
    const runningRuns = runs.filter((run) => run.status === "running" || run.status === "queued").length;
    return { activeProjects, successfulRuns, runningRuns };
  }, [projects, runs]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [projectPayload, runPayload, credentialPayload] = await Promise.all([
        api(`${prefix}/projects`),
        api(`${prefix}/runs`),
        api("/api/cicd/credentials"),
      ]);
      const nextProjects = Array.isArray(projectPayload.projects) ? projectPayload.projects : [];
      const nextRuns = Array.isArray(runPayload.runs) ? runPayload.runs : [];
      setProjects(nextProjects);
      setRuns(nextRuns);
      setCredentials(Array.isArray(credentialPayload.credentials) ? credentialPayload.credentials : []);
      setSelectedRun((current) => current || nextRuns[0] || null);
    } catch (loadError) {
      setError(loadError.message || "CI/CD 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [prefix]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!selectedRun || !["queued", "running"].includes(selectedRun.status)) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const payload = await api(prefix + "/runs/" + selectedRun.id);
        const nextRun = payload.run || selectedRun;
        setSelectedRun(nextRun);
        setRuns((current) => current.map((item) => String(item.id) === String(nextRun.id) ? { ...item, ...nextRun } : item));
      } catch (pollError) {
        setError(pollError.message || "실행 상태를 갱신하지 못했습니다.");
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [prefix, selectedRun?.id, selectedRun?.status]);

  const createProject = async (form) => {
    setBusyId("create");
    setMessage("");
    setError("");
    try {
      await api("/api/cicd/projects", { method: "POST", body: form });
      setMessage("파이프라인이 생성되었습니다.");
      await loadData();
    } catch (createError) {
      setError(createError.message || "파이프라인 생성에 실패했습니다.");
      throw createError;
    } finally {
      setBusyId("");
    }
  };

  const createCredential = async (form) => {
    setBusyId("credential");
    setMessage("");
    setError("");
    try {
      await api("/api/cicd/credentials", { method: "POST", body: form });
      setMessage("Credential이 등록되었습니다. 비밀 값은 다시 표시되지 않습니다.");
      await loadData();
    } catch (credentialError) {
      setError(credentialError.message || "Credential 등록에 실패했습니다.");
      throw credentialError;
    } finally {
      setBusyId("");
    }
  };

  const deleteCredential = async (credential) => {
    if (!window.confirm(`${credential.name} Credential을 삭제할까요? 사용 중인 Jenkinsfile이 더 이상 배포할 수 없게 됩니다.`)) return;
    setBusyId("credential");
    setMessage("");
    setError("");
    try {
      await api(`/api/cicd/credentials/${credential.id}`, { method: "DELETE" });
      setMessage(`${credential.name} Credential이 삭제되었습니다.`);
      await loadData();
    } catch (credentialError) {
      setError(credentialError.message || "Credential 삭제에 실패했습니다.");
    } finally {
      setBusyId("");
    }
  };

  const triggerRun = async (project) => {
    setBusyId(project.id);
    setMessage("");
    setError("");
    try {
      const payload = await api(`${prefix}/projects/${project.id}/runs`, {
        method: "POST",
        body: { triggerType: "manual", sourceBranch: project.branch || "main" },
      });
      setSelectedRun(payload.run || null);
      setMessage(payload.run?.status === "success"
        ? `${project.name} 파이프라인 실행이 완료되었습니다.`
        : `${project.name} 파이프라인 실행 요청이 등록되었습니다.`);
      await loadData();
    } catch (runError) {
      setError(runError.message || "파이프라인 실행에 실패했습니다.");
    } finally {
      setBusyId("");
    }
  };

  const selectRun = async (run) => {
    setSelectedRun(run);
    try {
      const payload = await api(`${prefix}/runs/${run.id}`);
      setSelectedRun(payload.run || run);
    } catch (detailError) {
      setError(detailError.message || "실행 상세를 불러오지 못했습니다.");
    }
  };

  const openLatestRunForProject = async (project) => {
    const latest = runs.find((run) => String(run.projectId) === String(project.id));
    if (latest) {
      await selectRun(latest);
    } else {
      setSelectedRun(null);
      setMessage("아직 실행 이력이 없습니다.");
    }
  };

  const updateProjectStatus = async (project, status) => {
    setBusyId(project.id);
    setMessage("");
    setError("");
    try {
      await api(`${prefix}/projects/${project.id}`, { method: "PATCH", body: { status } });
      setMessage(`${project.name} 상태가 변경되었습니다.`);
      await loadData();
    } catch (statusError) {
      setError(statusError.message || "상태 변경에 실패했습니다.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="portal-stack cicd-view">
      <div className="portal-section-header">
        <div>
          <p className="eyebrow">CI/CD</p>
          <h2>{adminMode ? "CI/CD 파이프라인 운영" : "CI/CD 파이프라인"}</h2>
        </div>
        <button className="mini-btn" disabled={loading} onClick={loadData} type="button">새로고침</button>
      </div>

      <div className="cicd-stat-grid">
        <div><strong>{projects.length}</strong><span>파이프라인</span></div>
        <div><strong>{stats.activeProjects}</strong><span>활성</span></div>
        <div><strong>{stats.successfulRuns}</strong><span>성공 실행</span></div>
        <div><strong>{stats.runningRuns}</strong><span>대기/진행</span></div>
      </div>

      <CicdUsageGuide />

      <CicdCredentialManager
        busy={busyId === "credential"}
        credentials={credentials}
        onCreate={createCredential}
        onDelete={deleteCredential}
      />

      <StatusMessage tone="success" message={message} />
      <StatusMessage tone="error" message={error} />

      {adminMode ? (
        <JenkinsSettingsCard
          onSavePlatformSettings={onSavePlatformSettings}
          platformStatus={platformStatus}
          setPlatformStatus={setPlatformStatus}
        />
      ) : null}

      {!adminMode ? <CicdProjectForm disabled={busyId === "create"} onSubmit={createProject} /> : null}

      <div className="cicd-layout-grid">
        <div className="portal-stack">
          <div className="portal-section-header compact">
            <h3>파이프라인</h3>
          </div>
          {loading ? <div className="empty-state">불러오는 중...</div> : null}
          {!loading && !projects.length ? <div className="empty-state">등록된 파이프라인이 없습니다.</div> : null}
          {!loading && projects.map((project) => (
            <CicdProjectCard
              adminMode={adminMode}
              busyId={busyId}
              key={project.id}
              onOpenRun={openLatestRunForProject}
              onStatusChange={updateProjectStatus}
              onTrigger={triggerRun}
              project={project}
            />
          ))}
        </div>
        <div className="portal-stack">
          <div className="portal-section-header compact">
            <h3>실행 이력</h3>
          </div>
          <CicdRunList onSelectRun={selectRun} runs={runs} selectedRunId={selectedRun?.id} />
          <CicdRunDetail run={selectedRun} />
        </div>
      </div>
    </section>
  );
}

export function AdminCicdTab(props) {
  return <CicdDashboard adminMode {...props} />;
}

export default function CicdView() {
  return <CicdDashboard />;
}
