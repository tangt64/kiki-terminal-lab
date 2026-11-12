import { useEffect, useMemo, useState } from "react";
import { AdminField } from "./admin-field.jsx";
import { api } from "./portal-state.js";

const emptyResources = { loading: true, projects: [], message: "" };
const initialLoadBalancer = { name: "", vipSubnetId: "" };
const initialListener = { loadBalancerId: "", name: "", protocol: "TCP", protocolPort: "80" };
const initialPool = { listenerId: "", name: "", protocol: "TCP", algorithm: "ROUND_ROBIN" };
const initialMember = { poolId: "", name: "", address: "", protocolPort: "80", subnetId: "" };
const initialMonitor = { poolId: "", type: "TCP", delay: "5", timeout: "3", maxRetries: "3", urlPath: "/", expectedCodes: "200" };

function resourceIds(resource, directKey, collectionKey) {
  const direct = String(resource?.[directKey] || "").trim();
  const collection = Array.isArray(resource?.[collectionKey]) ? resource[collectionKey] : [];
  return [...new Set([direct, ...collection.map((item) => String(item?.id || item || "").trim())].filter(Boolean))];
}

function statusTone(value) {
  const normalized = String(value || "").toUpperCase();
  if (["ACTIVE", "ONLINE"].includes(normalized)) return "success";
  if (["ERROR", "DEGRADED", "OFFLINE"].includes(normalized)) return "failed";
  return "pending";
}

function projectQuery(projectName) {
  return `projectName=${encodeURIComponent(projectName)}`;
}

export default function AdminLoadBalancersTab() {
  const [resources, setResources] = useState(emptyResources);
  const [selectedProjectName, setSelectedProjectName] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState({ tone: "", message: "" });
  const [loadBalancerForm, setLoadBalancerForm] = useState(initialLoadBalancer);
  const [listenerForm, setListenerForm] = useState(initialListener);
  const [poolForm, setPoolForm] = useState(initialPool);
  const [memberForm, setMemberForm] = useState(initialMember);
  const [monitorForm, setMonitorForm] = useState(initialMonitor);

  async function refresh() {
    setResources((current) => ({ ...current, loading: true, message: "" }));
    try {
      const result = await api("/api/admin/cloud-console/resources");
      setResources({ loading: false, projects: result.projects || [], message: "" });
    } catch (error) {
      setResources({ loading: false, projects: [], message: error.message || "로드밸런서 자원을 불러오지 못했습니다." });
    }
  }

  useEffect(() => { refresh().catch(() => {}); }, []);

  const availableProjects = useMemo(() => resources.projects.filter((project) => project.services?.octavia || project.loadBalancers?.length), [resources.projects]);
  const selectedProject = availableProjects.find((project) => project.projectName === selectedProjectName) || availableProjects[0] || null;

  useEffect(() => {
    if (!selectedProject?.projectName) return;
    if (selectedProject.projectName !== selectedProjectName) setSelectedProjectName(selectedProject.projectName);
  }, [selectedProject?.projectName, selectedProjectName]);

  const loadBalancers = selectedProject?.loadBalancers || [];
  const listeners = selectedProject?.loadBalancerListeners || [];
  const pools = selectedProject?.loadBalancerPools || [];
  const members = selectedProject?.loadBalancerMembers || [];
  const monitors = selectedProject?.loadBalancerHealthMonitors || [];
  const subnets = selectedProject?.subnets || [];

  useEffect(() => {
    setLoadBalancerForm((current) => ({ ...current, vipSubnetId: subnets.some((item) => item.id === current.vipSubnetId) ? current.vipSubnetId : (subnets[0]?.id || "") }));
    setListenerForm((current) => ({ ...current, loadBalancerId: loadBalancers.some((item) => item.id === current.loadBalancerId) ? current.loadBalancerId : (loadBalancers[0]?.id || "") }));
    setPoolForm((current) => ({ ...current, listenerId: listeners.some((item) => item.id === current.listenerId) ? current.listenerId : (listeners[0]?.id || "") }));
    setMemberForm((current) => ({
      ...current,
      poolId: pools.some((item) => item.id === current.poolId) ? current.poolId : (pools[0]?.id || ""),
      subnetId: subnets.some((item) => item.id === current.subnetId) ? current.subnetId : (subnets[0]?.id || ""),
    }));
    setMonitorForm((current) => ({ ...current, poolId: pools.some((item) => item.id === current.poolId) ? current.poolId : (pools[0]?.id || "") }));
  }, [selectedProjectName, loadBalancers.length, listeners.length, pools.length, subnets.length]);

  async function mutate(key, path, options, successMessage) {
    if (!selectedProject?.projectName) return;
    setBusy(key);
    setNotice({ tone: "", message: "" });
    try {
      await api(path, options);
      setNotice({ tone: "success", message: successMessage });
      await refresh();
    } catch (error) {
      const detail = String(error?.payload?.detail || "").trim();
      setNotice({ tone: "error", message: detail ? `${error.message} · ${detail}` : (error.message || "로드밸런서 작업에 실패했습니다.") });
    } finally {
      setBusy("");
    }
  }

  async function createLoadBalancer(event) {
    event.preventDefault();
    await mutate("create:load-balancer", "/api/admin/cloud-console/load-balancers", { method: "POST", body: { ...loadBalancerForm, projectName: selectedProject.projectName } }, "로드밸런서 생성을 요청했습니다.");
    setLoadBalancerForm((current) => ({ ...current, name: "" }));
  }

  async function createListener(event) {
    event.preventDefault();
    await mutate("create:listener", "/api/admin/cloud-console/load-balancer-listeners", { method: "POST", body: { ...listenerForm, projectName: selectedProject.projectName, protocolPort: Number(listenerForm.protocolPort) } }, "리스너 생성을 요청했습니다.");
    setListenerForm((current) => ({ ...current, name: "" }));
  }

  async function createPool(event) {
    event.preventDefault();
    await mutate("create:pool", "/api/admin/cloud-console/load-balancer-pools", { method: "POST", body: { ...poolForm, projectName: selectedProject.projectName } }, "풀 생성을 요청했습니다.");
    setPoolForm((current) => ({ ...current, name: "" }));
  }

  async function createMember(event) {
    event.preventDefault();
    await mutate("create:member", `/api/admin/cloud-console/load-balancer-pools/${encodeURIComponent(memberForm.poolId)}/members`, { method: "POST", body: { ...memberForm, projectName: selectedProject.projectName, protocolPort: Number(memberForm.protocolPort) } }, "멤버 생성을 요청했습니다.");
    setMemberForm((current) => ({ ...current, name: "", address: "" }));
  }

  async function createMonitor(event) {
    event.preventDefault();
    await mutate("create:monitor", "/api/admin/cloud-console/load-balancer-health-monitors", { method: "POST", body: { ...monitorForm, projectName: selectedProject.projectName, delay: Number(monitorForm.delay), timeout: Number(monitorForm.timeout), maxRetries: Number(monitorForm.maxRetries) } }, "상태 점검 생성을 요청했습니다.");
  }

  function confirmDelete(label, callback) {
    if (window.confirm(`${label} 자원을 삭제할까요? 하위 연결 관계를 먼저 확인해 주세요.`)) callback();
  }

  const totalLoadBalancers = resources.projects.reduce((sum, project) => sum + Number(project.loadBalancers?.length || 0), 0);
  const unhealthyLoadBalancers = resources.projects.flatMap((project) => project.loadBalancers || []).filter((item) => ["ERROR", "DEGRADED", "OFFLINE"].includes(String(item.provisioning_status || item.operating_status || "").toUpperCase())).length;

  return <div className="admin-tab-stack">
    <section className="admin-simple-card">
      <div className="admin-section-head">
        <div><strong>로드밸런서 관리</strong><p className="hint">승인된 사용자 프로젝트의 Octavia 로드밸런서와 하위 자원을 관리합니다.</p></div>
        <button className="mini-btn" disabled={resources.loading || Boolean(busy)} onClick={refresh} type="button">새로고침</button>
      </div>
      {notice.message ? <div className={`mini-horizon-status is-${notice.tone || "info"}`}>{notice.message}</div> : null}
      {resources.message ? <div className="mini-horizon-status is-error">{resources.message}</div> : null}
      <div className="summary-grid">
        <div className="summary-card"><span>Octavia 프로젝트</span><strong>{availableProjects.length}</strong></div>
        <div className="summary-card"><span>로드밸런서</span><strong>{totalLoadBalancers}</strong></div>
        <div className="summary-card"><span>확인 필요</span><strong>{unhealthyLoadBalancers}</strong></div>
      </div>
      <AdminField label="관리 프로젝트">
        <select disabled={resources.loading || !availableProjects.length} value={selectedProject?.projectName || ""} onChange={(event) => setSelectedProjectName(event.target.value)}>
          {!availableProjects.length ? <option value="">Octavia 사용 가능 프로젝트 없음</option> : null}
          {availableProjects.map((project) => <option key={project.projectName} value={project.projectName}>{project.projectName} · {project.userName || `사용자 #${project.userId || "-"}`}</option>)}
        </select>
      </AdminField>
    </section>

    {resources.loading ? <section className="admin-simple-card"><div className="empty-state">Octavia 자원을 조회하고 있습니다.</div></section> : null}
    {!resources.loading && !selectedProject ? <section className="admin-simple-card"><div className="empty-state">관리할 Octavia 프로젝트가 없습니다.</div></section> : null}

    {selectedProject ? <>
      <section className="admin-simple-card">
        <div className="admin-section-head"><div><strong>현재 구성</strong><p className="hint">프로비저닝 상태와 운영 상태를 함께 표시합니다.</p></div></div>
        <div className="admin-list-stack">
          {loadBalancers.length ? loadBalancers.map((item) => {
            const relatedListeners = listeners.filter((listener) => resourceIds(listener, "loadbalancer_id", "loadbalancers").includes(String(item.id)));
            const relatedListenerIds = new Set(relatedListeners.map((listener) => String(listener.id)));
            const relatedPools = pools.filter((pool) => resourceIds(pool, "loadbalancer_id", "loadbalancers").includes(String(item.id)) || resourceIds(pool, "listener_id", "listeners").some((id) => relatedListenerIds.has(id)));
            return <article className="admin-list-card" key={item.id}>
              <div>
                <strong>{item.name || item.id}</strong>
                <p className="hint">VIP {item.vip_address || "할당 중"} · {item.provider || "Octavia"} · 리스너 {relatedListeners.length} · 풀 {relatedPools.length}</p>
              </div>
              <div className="button-row">
                <span className={`status-chip is-${statusTone(item.provisioning_status)}`}>{item.provisioning_status || "-"}</span>
                <span className={`status-chip is-${statusTone(item.operating_status)}`}>{item.operating_status || "-"}</span>
                <button className="mini-btn danger-mini-btn" disabled={Boolean(busy)} onClick={() => confirmDelete(item.name || item.id, () => mutate(`delete:lb:${item.id}`, `/api/admin/cloud-console/load-balancers/${encodeURIComponent(item.id)}?${projectQuery(selectedProject.projectName)}`, { method: "DELETE" }, "로드밸런서를 삭제했습니다."))} type="button">삭제</button>
              </div>
            </article>;
          }) : <div className="empty-state">생성된 로드밸런서가 없습니다.</div>}
        </div>
      </section>

      <section className="admin-simple-card">
        <div className="admin-section-head"><div><strong>구성 요소</strong><p className="hint">삭제는 멤버·상태 점검·풀·리스너 순으로 처리하거나 로드밸런서 cascade 삭제를 사용합니다.</p></div></div>
        <div className="admin-list-stack">
          {listeners.map((item) => <article className="admin-list-card" key={`listener:${item.id}`}><div><strong>{item.name || item.id}</strong><p className="hint">리스너 · {item.protocol || "-"}:{item.protocol_port || "-"} · {item.provisioning_status || "-"}</p></div><button className="mini-btn danger-mini-btn" disabled={Boolean(busy)} onClick={() => confirmDelete(item.name || item.id, () => mutate(`delete:listener:${item.id}`, `/api/admin/cloud-console/load-balancer-listeners/${encodeURIComponent(item.id)}?${projectQuery(selectedProject.projectName)}`, { method: "DELETE" }, "리스너를 삭제했습니다."))} type="button">삭제</button></article>)}
          {pools.map((item) => <article className="admin-list-card" key={`pool:${item.id}`}><div><strong>{item.name || item.id}</strong><p className="hint">풀 · {item.protocol || "-"} · {item.lb_algorithm || "-"} · {item.provisioning_status || "-"}</p></div><button className="mini-btn danger-mini-btn" disabled={Boolean(busy)} onClick={() => confirmDelete(item.name || item.id, () => mutate(`delete:pool:${item.id}`, `/api/admin/cloud-console/load-balancer-pools/${encodeURIComponent(item.id)}?${projectQuery(selectedProject.projectName)}`, { method: "DELETE" }, "풀을 삭제했습니다."))} type="button">삭제</button></article>)}
          {members.map((item) => <article className="admin-list-card" key={`member:${item.id}`}><div><strong>{item.name || item.id}</strong><p className="hint">멤버 · {item.address || "-"}:{item.protocol_port || "-"} · {item.operating_status || item.provisioning_status || "-"}</p></div><button className="mini-btn danger-mini-btn" disabled={Boolean(busy)} onClick={() => confirmDelete(item.name || item.id, () => mutate(`delete:member:${item.id}`, `/api/admin/cloud-console/load-balancer-pools/${encodeURIComponent(item.pool_id)}/members/${encodeURIComponent(item.id)}?${projectQuery(selectedProject.projectName)}`, { method: "DELETE" }, "멤버를 삭제했습니다."))} type="button">삭제</button></article>)}
          {monitors.map((item) => <article className="admin-list-card" key={`monitor:${item.id}`}><div><strong>{item.name || item.id}</strong><p className="hint">상태 점검 · {item.type || "-"} · {item.delay || "-"}초 간격 · {item.provisioning_status || "-"}</p></div><button className="mini-btn danger-mini-btn" disabled={Boolean(busy)} onClick={() => confirmDelete(item.name || item.id, () => mutate(`delete:monitor:${item.id}`, `/api/admin/cloud-console/load-balancer-health-monitors/${encodeURIComponent(item.id)}?${projectQuery(selectedProject.projectName)}`, { method: "DELETE" }, "상태 점검을 삭제했습니다."))} type="button">삭제</button></article>)}
          {!listeners.length && !pools.length && !members.length && !monitors.length ? <div className="empty-state">구성 요소가 없습니다.</div> : null}
        </div>
      </section>

      <section className="admin-simple-card">
        <div className="admin-section-head"><div><strong>로드밸런서 생성</strong><p className="hint">프로젝트 내부 서브넷에 VIP를 생성합니다.</p></div></div>
        <form className="admin-form-grid compact-admin-grid" onSubmit={createLoadBalancer}>
          <AdminField label="이름"><input required value={loadBalancerForm.name} onChange={(event) => setLoadBalancerForm((current) => ({ ...current, name: event.target.value }))} /></AdminField>
          <AdminField label="VIP 서브넷"><select required value={loadBalancerForm.vipSubnetId} onChange={(event) => setLoadBalancerForm((current) => ({ ...current, vipSubnetId: event.target.value }))}><option value="">서브넷 선택</option>{subnets.map((item) => <option key={item.id} value={item.id}>{item.name || item.cidr || item.id} · {item.cidr || "CIDR 없음"}</option>)}</select></AdminField>
          <div className="button-row"><button className="primary-mini-btn" disabled={Boolean(busy) || !subnets.length} type="submit">로드밸런서 생성</button></div>
        </form>
      </section>

      <section className="admin-simple-card">
        <div className="admin-section-head"><div><strong>리스너 생성</strong><p className="hint">클라이언트 요청을 받을 프로토콜과 포트를 지정합니다.</p></div></div>
        <form className="admin-form-grid compact-admin-grid" onSubmit={createListener}>
          <AdminField label="로드밸런서"><select required value={listenerForm.loadBalancerId} onChange={(event) => setListenerForm((current) => ({ ...current, loadBalancerId: event.target.value }))}><option value="">로드밸런서 선택</option>{loadBalancers.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></AdminField>
          <AdminField label="이름"><input required value={listenerForm.name} onChange={(event) => setListenerForm((current) => ({ ...current, name: event.target.value }))} /></AdminField>
          <AdminField label="프로토콜"><select value={listenerForm.protocol} onChange={(event) => setListenerForm((current) => ({ ...current, protocol: event.target.value }))}>{["TCP", "HTTP", "HTTPS", "UDP"].map((item) => <option key={item}>{item}</option>)}</select></AdminField>
          <AdminField label="포트"><input max="65535" min="1" required type="number" value={listenerForm.protocolPort} onChange={(event) => setListenerForm((current) => ({ ...current, protocolPort: event.target.value }))} /></AdminField>
          <div className="button-row"><button className="primary-mini-btn" disabled={Boolean(busy) || !loadBalancers.length} type="submit">리스너 생성</button></div>
        </form>
      </section>

      <section className="admin-simple-card">
        <div className="admin-section-head"><div><strong>풀 생성</strong><p className="hint">리스너가 전달할 백엔드 묶음과 분산 방식을 지정합니다.</p></div></div>
        <form className="admin-form-grid compact-admin-grid" onSubmit={createPool}>
          <AdminField label="리스너"><select required value={poolForm.listenerId} onChange={(event) => setPoolForm((current) => ({ ...current, listenerId: event.target.value }))}><option value="">리스너 선택</option>{listeners.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></AdminField>
          <AdminField label="이름"><input required value={poolForm.name} onChange={(event) => setPoolForm((current) => ({ ...current, name: event.target.value }))} /></AdminField>
          <AdminField label="프로토콜"><select value={poolForm.protocol} onChange={(event) => setPoolForm((current) => ({ ...current, protocol: event.target.value }))}>{["TCP", "HTTP", "HTTPS", "UDP"].map((item) => <option key={item}>{item}</option>)}</select></AdminField>
          <AdminField label="분산 방식"><select value={poolForm.algorithm} onChange={(event) => setPoolForm((current) => ({ ...current, algorithm: event.target.value }))}>{["ROUND_ROBIN", "LEAST_CONNECTIONS", "SOURCE_IP"].map((item) => <option key={item}>{item}</option>)}</select></AdminField>
          <div className="button-row"><button className="primary-mini-btn" disabled={Boolean(busy) || !listeners.length} type="submit">풀 생성</button></div>
        </form>
      </section>

      <section className="admin-simple-card">
        <div className="admin-section-head"><div><strong>멤버 생성</strong><p className="hint">풀에 연결할 프로젝트 내부 IP와 서비스 포트를 입력합니다.</p></div></div>
        <form className="admin-form-grid compact-admin-grid" onSubmit={createMember}>
          <AdminField label="풀"><select required value={memberForm.poolId} onChange={(event) => setMemberForm((current) => ({ ...current, poolId: event.target.value }))}><option value="">풀 선택</option>{pools.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></AdminField>
          <AdminField label="이름"><input value={memberForm.name} onChange={(event) => setMemberForm((current) => ({ ...current, name: event.target.value }))} /></AdminField>
          <AdminField label="IP 주소"><input required value={memberForm.address} onChange={(event) => setMemberForm((current) => ({ ...current, address: event.target.value }))} placeholder="192.0.2.20" /></AdminField>
          <AdminField label="서비스 포트"><input max="65535" min="1" required type="number" value={memberForm.protocolPort} onChange={(event) => setMemberForm((current) => ({ ...current, protocolPort: event.target.value }))} /></AdminField>
          <AdminField label="서브넷"><select required value={memberForm.subnetId} onChange={(event) => setMemberForm((current) => ({ ...current, subnetId: event.target.value }))}><option value="">서브넷 선택</option>{subnets.map((item) => <option key={item.id} value={item.id}>{item.name || item.cidr || item.id}</option>)}</select></AdminField>
          <div className="button-row"><button className="primary-mini-btn" disabled={Boolean(busy) || !pools.length || !subnets.length} type="submit">멤버 생성</button></div>
        </form>
      </section>

      <section className="admin-simple-card">
        <div className="admin-section-head"><div><strong>상태 점검 생성</strong><p className="hint">백엔드 멤버의 가용성을 주기적으로 확인합니다.</p></div></div>
        <form className="admin-form-grid compact-admin-grid" onSubmit={createMonitor}>
          <AdminField label="풀"><select required value={monitorForm.poolId} onChange={(event) => setMonitorForm((current) => ({ ...current, poolId: event.target.value }))}><option value="">풀 선택</option>{pools.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></AdminField>
          <AdminField label="방식"><select value={monitorForm.type} onChange={(event) => setMonitorForm((current) => ({ ...current, type: event.target.value }))}>{["TCP", "HTTP", "HTTPS", "PING"].map((item) => <option key={item}>{item}</option>)}</select></AdminField>
          <AdminField label="간격(초)"><input min="1" required type="number" value={monitorForm.delay} onChange={(event) => setMonitorForm((current) => ({ ...current, delay: event.target.value }))} /></AdminField>
          <AdminField label="타임아웃(초)"><input min="1" required type="number" value={monitorForm.timeout} onChange={(event) => setMonitorForm((current) => ({ ...current, timeout: event.target.value }))} /></AdminField>
          <AdminField label="재시도"><input max="10" min="1" required type="number" value={monitorForm.maxRetries} onChange={(event) => setMonitorForm((current) => ({ ...current, maxRetries: event.target.value }))} /></AdminField>
          {["HTTP", "HTTPS"].includes(monitorForm.type) ? <><AdminField label="URL 경로"><input value={monitorForm.urlPath} onChange={(event) => setMonitorForm((current) => ({ ...current, urlPath: event.target.value }))} /></AdminField><AdminField label="정상 코드"><input value={monitorForm.expectedCodes} onChange={(event) => setMonitorForm((current) => ({ ...current, expectedCodes: event.target.value }))} /></AdminField></> : null}
          <div className="button-row"><button className="primary-mini-btn" disabled={Boolean(busy) || !pools.length} type="submit">상태 점검 생성</button></div>
        </form>
      </section>
    </> : null}
  </div>;
}
