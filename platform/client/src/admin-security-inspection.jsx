import { useEffect, useState } from 'react';
import { api, isAdminUserRole, normalizeAdminPermissions } from './portal-state.js';
import './admin-security-inspection.css';

const names = { trivy: 'Trivy', grype: 'Grype', openscap: 'OpenSCAP' };
const labels = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', negligible: '미미', unknown: '미확인', pass: '통과', fail: '실패', error: '오류', notapplicable: '적용 제외', notchecked: '미검사' };
const date = value => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '미확인';
export function canViewSecurityInspection(session) {
  const p = normalizeAdminPermissions(session?.adminPermissions);
  return isAdminUserRole(session?.role) || p.includes('admin:all') || p.includes('admin:monitor');
}

function NodeAssessment({ assessment: a }) {
  const v = a.verification, b = a.baseline;
  const serviceNames = [...new Set([...Object.keys(b.before), ...Object.keys(b.after)])];
  return <article className="security-verification">
    <h3>{a.nodeId} · 서비스·SSH 교차 확인</h3>
    <p>확인 시각 {date(a.observedAt)} KST · 관찰 상태 <strong>{b.stable ? '유지' : '확인 필요'}</strong></p>
    <p>{b.continuity === 'verified' ? '검사 전후 동일한 컨테이너·시작 시각을 확인했습니다.' : b.continuity === 'changed' ? '검사 전후 컨테이너 변경 또는 재시작이 감지됐습니다.' : '컨테이너 상태의 시점 비교 기록입니다. 재시작 여부는 미확인입니다.'}</p>
    {typeof b.sshConfigUnchanged === 'boolean' && <p>SSH 설정 파일 {b.sshConfigUnchanged ? '변경 없음' : '변경 감지 · 확인 필요'}</p>}
    <details><summary>관찰한 컨테이너 {serviceNames.length}개 보기</summary><ul>{serviceNames.map(name => <li key={name}>{name}: {b.before[name] || 'missing'} → {b.after[name] || 'missing'}</li>)}</ul></details>
    {v && <>
      <h4>SSH 유효 설정</h4><p>{v.note}</p><p>설정 확인 시각 {date(v.observedAt)} KST</p>
      <ul>{Object.entries(v.ssh).map(([key, value]) => <li key={key}><code>{key}</code>: <strong>{value}</strong></li>)}</ul>
      {v.explanations?.length > 0 && <div className="security-rule-explanations"><h4>실패 원인 · 실행 설정은 차단됨 / 구성 기준은 미충족</h4>
        {v.diagnosedAt && <p>분석 시각 {date(v.diagnosedAt)} KST · 기존 검사 결과 유지</p>}
        {v.explanations.map(e => <section key={e.ruleId}><h4>{e.title}</h4><p>{e.evidence}</p><p><strong>권장 대응:</strong> {e.recommendation}</p></section>)}
      </div>}
    </>}
  </article>;
}

export function SecurityInspectionPanel({ loadSnapshot }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [node, setNode] = useState('all');
  const [tool, setTool] = useState('all');
  useEffect(() => {
    let current = true;
    setBusy(true); setView(null); setError('');
    Promise.resolve().then(loadSnapshot).then(data => {
      if (data?.schemaVersion !== 2 || data.executionEnabled !== false || !['pilot-report', 'unavailable'].includes(data.mode)
        || (data.mode === 'pilot-report' && (!Array.isArray(data.report?.nodes) || !Array.isArray(data.report?.scans)))) throw Error('Invalid report');
      if (current) setView(data);
    }).catch(() => { if (current) setError('점검 기록을 조회하지 못했습니다. 권한과 서버 연결을 확인하세요.'); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [loadSnapshot, revision]);
  const report = view?.report;
  const nodes = report?.nodes.filter(n => node === 'all' || n.id === node) || [];
  const scans = report?.scans.filter(s => (node === 'all' || s.nodeId === node) && (tool === 'all' || s.tool === tool)) || [];
  const assessments = !report ? [] : report.assessments?.length ? report.assessments : [{ nodeId: report.pilotNode,
    observedAt: report.observedAt, baseline: { ...report.baseline, continuity: 'unverified' }, verification: report.verification }];
  const visibleAssessments = assessments.filter(a => node === 'all' || a.nodeId === node);
  const completedNodes = report?.nodes.filter(n => ['trivy', 'grype', 'openscap'].every(t => report.scans.some(s => s.nodeId === n.id && s.tool === t && s.status === 'completed'))).length || 0;
  const installedNodes = report?.nodes.filter(n => n.tools.every(t => t.installation === 'installed' && t.signature === 'verified')).length || 0;
  return <section className="security-inspection" aria-labelledby="security-title" aria-busy={busy}>
    <header className="security-heading"><div><small>SECURITY · LIMITED</small><h2 id="security-title">보안점검</h2><p>노드별 설치 상태와 한정된 시험 검사 결과</p></div>
      <button type="button" disabled={busy} onClick={() => setRevision(v => v + 1)}>기록 다시 조회</button></header>
    <div className="security-notice"><strong>조회 전용 · 제한 검사 결과</strong><p>다시 조회하면 저장된 기록을 읽습니다. 서버에 접속해 검사하거나 자동 교정하지 않습니다.</p></div>
    {busy && <p role="status">점검 기록을 불러오는 중입니다…</p>}
    {error && <p role="alert" className="security-error">{error}</p>}
    {view?.mode === 'unavailable' && <p role="status">수집된 검사 기록이 없습니다. 설치·보안 상태는 미확인입니다.</p>}
    {report && <>
      <p>최근 수집 시각 <strong>{date(report.observedAt)} KST</strong> · 노드별 검사 시각은 아래 기록에서 확인하세요.</p>
      {view.stale && <p role="status" className="security-notice">24시간이 지난 검사 기록이 있습니다. 현재 상태를 판단하려면 재점검이 필요합니다.</p>}
      <div className="security-metrics">
        <article><span>제한 검사 완료 노드</span><strong>{completedNodes} / {report.nodes.length}</strong><small>세 도구의 완료 기록 기준</small></article>
        <article><span>설치 확인 노드</span><strong>{installedNodes} / {report.nodes.length}</strong><small>노드별 세 도구 버전·서명 확인</small></article>
        <article><span>검사 전후 관찰 상태</span><strong>{assessments.filter(a => a.baseline.stable).length} / {assessments.length} 유지</strong><small>노드별 실행 중 서비스 비교</small></article>
      </div>
      <p className="security-notice">{report.scopeNote}</p>
      <div className="security-filters"><label>노드 <select value={node} onChange={e => setNode(e.target.value)}><option value="all">전체 노드</option>{report.nodes.map(n => <option key={n.id}>{n.id}</option>)}</select></label>
        <label>도구 <select value={tool} onChange={e => setTool(e.target.value)}><option value="all">전체 도구</option>{Object.entries(names).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
      <h3>설치 기록</h3><div className="security-table-wrap"><table><thead><tr><th>노드 · 확인 시각</th>{Object.entries(names).filter(([id]) => tool === 'all' || id === tool).map(([id, name]) => <th key={id}>{name}</th>)}</tr></thead>
        <tbody>{nodes.map(n => <tr key={n.id}><th scope="row">{n.id}<small>{date(n.observedAt)}</small></th>{n.tools.filter(t => tool === 'all' || t.id === tool).map(t => <td key={t.id}>{t.installation === 'installed' ? <><strong>설치됨 · {t.version}</strong><small>서명 {t.signature === 'verified' ? '검증 완료' : '미확인'}</small></> : t.installation === 'not-installed' ? '미설치' : '미확인'}</td>)}</tr>)}</tbody></table></div>
      <h3>검사 결과</h3>
      {scans.length === 0 && <p role="status">선택한 조건의 검사 기록이 없습니다.</p>}
      <div className="security-scans">{scans.map(s => <article key={s.id}>
        <header className="security-heading"><h4>{s.nodeId} · {names[s.tool]}</h4><span className="security-badge">{s.scope === 'fixture' ? '시험 데이터 탐지 검증' : '실제 호스트 · 일부 규칙'}</span></header>
        <p>{s.targetLabel}</p><p><strong>{s.status === 'completed' ? '검사 완료' : '검사 실패'}</strong> · {date(s.completedAt)} KST</p>
        {s.database ? <p>DB 기준 {date(s.database.builtAt)} · {s.database.valid && !s.database.stale ? '유효' : 'DB 확인 필요'}</p> : null}
        <div className="security-counts">{Object.entries(s.counts).filter(([k]) => k !== 'notselected').map(([k, v]) => <span key={k}>{labels[k] || k} <strong>{v}</strong></span>)}</div>
        {s.scope === 'fixture' && <p className="security-fixture-warning">이 결과는 시험 데이터의 취약점입니다. {s.nodeId}에서 실제 발견된 CVE 수가 아닙니다.</p>}
        <details><summary>검사 근거 {s.findingCount}건 보기</summary>{s.truncated && <p>처음 100건을 표시합니다. 전체 근거는 검사 원본에 보관됩니다.</p>}
          {s.findings.length ? <ul>{s.findings.map((f, i) => <li key={`${f.id}-${i}`}><strong>{f.id}</strong> · {f.result ? labels[f.result] || f.result : labels[f.severity] || f.severity}<br />{f.title}{f.package && <p>{f.package} {f.installedVersion} · 수정 버전 {f.fixedVersion || '미확인'}</p>}</li>)}</ul> : <p>표시할 발견사항이 없습니다. 검사 범위와 DB 상태를 함께 확인하세요.</p>}</details>
      </article>)}</div>
      <div className="security-assessments">{visibleAssessments.map(a => <NodeAssessment key={a.nodeId} assessment={a} />)}</div>
      <details><summary>실행 한도와 관찰 범위</summary><p>CPU {report.limits.cpuQuotaPercent}% · 메모리 {report.limits.memoryMaxMiB} MiB · 최대 {report.limits.runtimeMaxSeconds}초</p>
        <p>서비스 비교는 검사 직전 실행 중 컨테이너의 상태 관찰입니다. 전체 OpenStack 기능 시험을 의미하지 않습니다.</p></details>
    </>}
  </section>;
}

const loadSnapshot = () => api('/api/admin/security-inspection');
export default function AdminSecurityInspection({ session }) {
  if (!canViewSecurityInspection(session)) return <p role="alert">보안점검 조회에는 운영 모니터 관리자 권한이 필요합니다.</p>;
  return <SecurityInspectionPanel key={session?.id} loadSnapshot={loadSnapshot} />;
}
