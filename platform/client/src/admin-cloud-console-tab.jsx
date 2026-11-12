import { useEffect, useMemo, useState } from "react";
import { api } from "./portal-state.js";
import { AdminField } from "./admin-field.jsx";

const won = new Intl.NumberFormat("ko-KR");
const statusLabel = (value) => ({ requested:"승인 대기",executing:"실행 중",completed:"완료",approved:"승인",rejected:"반려",failed:"실패" }[String(value||"").toLowerCase()] || value || "-");
const deletionStatusLabel = (value) => ({ pending:"요청 준비",accepted:"원격 삭제 중",retrying:"상태 재확인",completed:"삭제 완료",failed:"확인 필요" }[String(value||"").toLowerCase()] || value || "-");

export default function AdminCloudConsoleTab(props) {
  const [actions,setActions]=useState([]);
  const [busy,setBusy]=useState("");
  const [notice,setNotice]=useState({tone:"",message:""});
  const [flavorCapacity,setFlavorCapacity]=useState({loading:true,projectName:"",flavors:[],message:""});
  const [resources,setResources]=useState({loading:true,projects:[],message:""});
  const [deletionJobs,setDeletionJobs]=useState({loading:true,jobs:[],summary:{active:0,failed:0,completed:0},message:""});
  const projects=Array.isArray(props.selfServiceProjectRequests)?props.selfServiceProjectRequests:[];
  const pendingProjects=projects.filter((item)=>item.status==="requested");
  const pendingActions=actions.filter((item)=>item.status==="requested");
  const monthlyCost=useMemo(()=>actions.filter((item)=>item.status==="completed").reduce((sum,item)=>sum+Number(item.estimatedMonthlyCost||0),0),[actions]);
  async function refresh(){
    const [actionResult,capacityResult,resourceResult,deletionResult]=await Promise.allSettled([api("/api/cloud-console/actions"),api("/api/admin/cloud-console/flavor-capacity"),api("/api/admin/cloud-console/resources"),api("/api/admin/resource-deletion-jobs")]);
    if(actionResult.status==="fulfilled")setActions(actionResult.value.actions||[]);
    if(capacityResult.status==="fulfilled")setFlavorCapacity({...capacityResult.value,loading:false,message:""});
    else setFlavorCapacity((current)=>({...current,loading:false,message:capacityResult.reason?.message||"Flavor 수용량을 계산하지 못했습니다."}));
    if(resourceResult.status==="fulfilled")setResources({loading:false,projects:resourceResult.value.projects||[],message:""});
    else setResources({loading:false,projects:[],message:resourceResult.reason?.message||"실제 OpenStack 자원을 조회하지 못했습니다."});
    if(deletionResult.status==="fulfilled")setDeletionJobs({loading:false,jobs:deletionResult.value.jobs||[],summary:deletionResult.value.summary||{active:0,failed:0,completed:0},message:""});
    else setDeletionJobs({loading:false,jobs:[],summary:{active:0,failed:0,completed:0},message:deletionResult.reason?.message||"삭제 작업 상태를 불러오지 못했습니다."});
  }
  useEffect(()=>{refresh().catch(()=>{});},[]);
  async function reviewAction(id,decision){setBusy(`action:${id}`);setNotice({tone:"",message:""});try{await api(`/api/admin/cloud-console/actions/${id}/review`,{method:"POST",body:{decision}});setNotice({tone:"success",message:decision==="approve"?"클라우드 작업을 승인했습니다.":"클라우드 작업을 반려했습니다."});await refresh();}catch(error){setNotice({tone:"error",message:error.message||"클라우드 작업을 처리하지 못했습니다."});}finally{setBusy("");}}
  async function reviewProject(id,decision){setBusy(`project:${id}`);setNotice({tone:"",message:""});try{await api(`/api/admin/self-service-project-requests/${id}/review`,{method:"POST",body:{action:decision}});setNotice({tone:"success",message:decision==="approve"?"전용 프로젝트를 승인하고 구성을 시작했습니다.":"전용 프로젝트 요청을 반려했습니다."});await props.loadAdmin?.();}catch(error){const detail=String(error?.payload?.detail||"").trim();setNotice({tone:"error",message:detail?`${error.message} · ${detail}`:(error.message||"프로젝트 요청을 처리하지 못했습니다.")});}finally{setBusy("");}}
  async function manageInstance(projectName,instance,action){const key=`instance:${instance.id}:${action}`;setBusy(key);setNotice({tone:"",message:""});try{const encoded=encodeURIComponent(projectName);if(action==="delete")await api(`/api/cloud-console/instances/${instance.id}?projectName=${encoded}`,{method:"DELETE"});else await api(`/api/cloud-console/instances/${instance.id}/action?projectName=${encoded}`,{method:"POST",body:{action}});setNotice({tone:"success",message:`${instance.name||instance.id} 작업을 요청했습니다.`});await refresh();}catch(error){setNotice({tone:"error",message:error.message||"인스턴스 작업을 처리하지 못했습니다."});}finally{setBusy("");}}
  async function openInstanceConsole(projectName,instance){setBusy(`console:${instance.id}`);try{const result=await api(`/api/cloud-console/instances/${instance.id}/console?projectName=${encodeURIComponent(projectName)}`,{method:"POST",body:{}});if(result.consoleUrl)window.open(result.consoleUrl,"_blank","noopener,noreferrer");}catch(error){setNotice({tone:"error",message:error.message||"콘솔을 열지 못했습니다."});}finally{setBusy("");}}
  async function deleteExtensionResource(projectName,type,item){const id=item.alarm_id||item.id;setBusy(`${type}:${id}`);try{await api(`/api/cloud-console/${type}/${id}?projectName=${encodeURIComponent(projectName)}`,{method:"DELETE"});await refresh();}catch(error){setNotice({tone:"error",message:error.message||"확장 자원을 삭제하지 못했습니다."});}finally{setBusy("");}}
  async function reconcileDeletionJobs(){setBusy("deletion:reconcile");try{const result=await api("/api/admin/resource-deletion-jobs/reconcile",{method:"POST",body:{}});setNotice({tone:"success",message:result.message||"삭제 작업 상태를 재확인했습니다."});await refresh();}catch(error){setNotice({tone:"error",message:error.message||"삭제 작업 상태를 확인하지 못했습니다."});}finally{setBusy("");}}
  function setProjectApprovalMode(value){props.setPlatformStatus?.((current)=>({...current,selfServiceVmProjectAutoApproveEnabled:value==="auto",...(value==="auto"?{selfServiceVmProjectAutoConfigureEnabled:true,selfServiceVmProjectAutoNetworkEnabled:true}:{})}));}
  return <div className="admin-tab-stack">
    <section className="admin-simple-card">
      <div className="admin-section-head"><div><strong>클라우드 콘솔 관리</strong><p className="hint">사용자별 전용 프로젝트와 OpenStack 작업을 관리합니다.</p></div><button className="mini-btn" onClick={()=>{refresh();props.loadAdmin?.();}} type="button">새로고침</button></div>
      {notice.message?<div className={`mini-horizon-status is-${notice.tone||"info"}`}>{notice.message}</div>:null}
      <div className="summary-grid">
        <div className="summary-card"><span>전용 프로젝트</span><strong>{projects.filter((item)=>item.status==="approved").length}</strong></div>
        <div className="summary-card"><span>프로젝트 승인 대기</span><strong>{pendingProjects.length}</strong></div>
        <div className="summary-card"><span>작업 승인 대기</span><strong>{pendingActions.length}</strong></div>
        <div className="summary-card"><span>예상 월 비용</span><strong>{won.format(monthlyCost)}원</strong></div>
      </div>
      <div className="admin-form-grid compact-admin-grid">
        <AdminField label="프로젝트 생성"><select value={props.platformStatus?.selfServiceVmProjectAutoApproveEnabled?"auto":"manual"} onChange={(event)=>setProjectApprovalMode(event.target.value)}><option value="auto">자동 승인·즉시 구성</option><option value="manual">관리자 승인 후 구성</option></select></AdminField>
        <AdminField label="클라우드 작업"><select value={props.platformStatus?.selfServiceVmAutoProvisionEnabled===false?"manual":"auto"} onChange={(event)=>props.setPlatformStatus?.((current)=>({...current,selfServiceVmAutoProvisionEnabled:event.target.value==="auto"}))}><option value="auto">즉시 실행</option><option value="manual">관리자 승인 후 실행</option></select></AdminField>
        <AdminField label="Floating IP"><select value={props.platformStatus?.selfServiceVmFloatingIpEnabled?"enabled":"disabled"} onChange={(event)=>props.setPlatformStatus?.((current)=>({...current,selfServiceVmFloatingIpEnabled:event.target.value==="enabled"}))}><option value="disabled">사용 안 함 (기본)</option><option value="enabled">관리자 허용</option></select></AdminField>
      </div>
      <div className="button-row"><button className="primary-mini-btn" disabled={Boolean(busy)} onClick={()=>props.onSavePlatformSettings?.()} type="button">설정 저장</button></div>
      <div className="hint">자동 승인은 새 프로젝트 요청부터 적용됩니다. 기존 대기 요청은 아래에서 승인해 주세요.</div>
    </section>
    <section className="admin-simple-card">
      <div className="admin-section-head"><div><strong>실제 OpenStack 자원</strong><p className="hint">승인된 사용자 프로젝트를 Nova에서 직접 조회합니다. 작업 이력이 아닌 현재 상태가 기준입니다.</p></div><button className="mini-btn" disabled={resources.loading} onClick={refresh} type="button">새로고침</button></div>
      {resources.message?<div className="mini-horizon-status is-error">{resources.message}</div>:null}
      {resources.loading?<div className="empty-state">프로젝트 자원을 조회하고 있습니다.</div>:resources.projects.length?<div className="admin-list-stack">{resources.projects.map((project)=><article className="admin-list-card" key={project.projectName}><div><strong>{project.projectName}</strong><p className="hint">{project.userName||`사용자 #${project.userId||"-"}`} · 인스턴스 {project.instances.length} · 볼륨 {project.volumes.length} · 사용자 네트워크 {project.networks.filter((item)=>!item.shared&&!item["router:external"]).length} · LB {project.loadBalancers.length} · 공유 {project.shares?.length||0} · 예약 {project.reservations?.length||0} · 알림 {project.alarms?.length||0}</p><p className="hint">Octavia {project.services?.octavia?"사용":"없음"} · Manila {project.services?.manila?"사용":"없음"} · Blazar {project.services?.blazar?"사용":"없음"} · Aodh {project.services?.aodh?"사용":"없음"}</p>{project.warnings?.length?<p className="hint">{project.warnings.join(" · ")}</p>:null}</div><span className={`status-chip ${project.ok?"is-success":"is-failed"}`}>{project.ok?"조회 완료":"조회 실패"}</span>{project.instances.map((instance)=><div className="admin-list-card" key={instance.id}><div><strong>{instance.name||instance.id}</strong><p className="hint">{instance.status||"-"} · {Object.values(instance.addresses||{}).flat().map((item)=>item.addr).filter(Boolean).join(", ")||"IP 없음"}</p></div><div className="button-row"><button className="mini-btn" disabled={Boolean(busy)||String(instance.status).toUpperCase()!=="ACTIVE"} onClick={()=>openInstanceConsole(project.projectName,instance)} type="button">VNC</button>{String(instance.status).toUpperCase()==="SHUTOFF"?<button className="mini-btn" disabled={Boolean(busy)} onClick={()=>manageInstance(project.projectName,instance,"start")} type="button">시작</button>:<button className="mini-btn" disabled={Boolean(busy)} onClick={()=>manageInstance(project.projectName,instance,"stop")} type="button">중지</button>}<button className="mini-btn" disabled={Boolean(busy)} onClick={()=>manageInstance(project.projectName,instance,"reboot")} type="button">재부팅</button><button className="mini-btn danger-mini-btn" disabled={Boolean(busy)} onClick={()=>{if(window.confirm(`${instance.name||instance.id} 인스턴스를 삭제할까요?`))manageInstance(project.projectName,instance,"delete");}} type="button">삭제</button></div></div>)}{[["shares",project.shares],["reservations",project.reservations],["alarms",project.alarms]].flatMap(([type,items])=>(items||[]).map((item)=><div className="admin-list-card" key={`${type}:${item.alarm_id||item.id}`}><div><strong>{item.name||item.alarm_id||item.id}</strong><p className="hint">{type==="shares"?"Manila 공유":type==="reservations"?"Blazar 예약":"Aodh 알림"} · {item.status||item.state||"-"}</p></div><button className="mini-btn danger-mini-btn" disabled={Boolean(busy)} onClick={()=>deleteExtensionResource(project.projectName,type,item)} type="button">삭제</button></div>))}</article>)}</div>:<div className="empty-state">승인된 사용자 프로젝트가 없습니다.</div>}
    </section>
    <section className="admin-simple-card">
      <div className="admin-section-head"><div><strong>클라우드 삭제 작업</strong><p className="hint">사용자 목록에서 숨겨진 뒤에도 원격 삭제가 완료될 때까지 내부적으로 추적합니다.</p></div><button className="mini-btn" disabled={Boolean(busy)||deletionJobs.loading} onClick={reconcileDeletionJobs} type="button">삭제 상태 재확인</button></div>
      {deletionJobs.message?<div className="mini-horizon-status is-error">{deletionJobs.message}</div>:null}
      <div className="summary-grid"><div className="summary-card"><span>삭제 진행</span><strong>{deletionJobs.summary.active||0}</strong></div><div className="summary-card"><span>확인 필요</span><strong>{deletionJobs.summary.failed||0}</strong></div><div className="summary-card"><span>완료</span><strong>{deletionJobs.summary.completed||0}</strong></div></div>
      {deletionJobs.loading?<div className="empty-state">삭제 작업을 확인하고 있습니다.</div>:deletionJobs.jobs.length?<div className="admin-list-stack">{deletionJobs.jobs.slice(0,50).map((job)=><article className="admin-list-card" key={job.id}><div><strong>{job.resourceName||job.remoteId||job.resourceType}</strong><p className="hint">{job.projectName||"프로젝트 없음"} · {job.resourceType} · 시도 {job.attempts||0}회</p>{job.lastError?<p className="hint">{job.lastError}</p>:null}</div><span className={`status-chip is-${job.status}`}>{deletionStatusLabel(job.status)}</span></article>)}</div>:<div className="empty-state">추적 중인 삭제 작업이 없습니다.</div>}
    </section>
    <section className="admin-simple-card">
      <div className="admin-section-head"><div><strong>허용 Flavor 예상 수용량</strong><p className="hint">기준 프로젝트의 남은 인스턴스·vCPU·RAM 쿼터 중 가장 작은 값을 기준으로 계산합니다. 실제 생성 수는 Compute 호스트 상태에 따라 달라질 수 있습니다.</p></div><button className="mini-btn" disabled={flavorCapacity.loading} onClick={refresh} type="button">다시 계산</button></div>
      <div className="hint">기준 프로젝트: {flavorCapacity.projectName||"확인 중"}</div>
      {flavorCapacity.message?<div className="mini-horizon-status is-error">{flavorCapacity.message}</div>:null}
      {flavorCapacity.loading?<div className="empty-state">Flavor 수용량 계산 중...</div>:flavorCapacity.flavors?.length?<div className="admin-list-stack">{flavorCapacity.flavors.map((flavor)=><article className="admin-list-card" key={flavor.name}><div><strong>{flavor.name}</strong><p className="hint">{flavor.vcpus} vCPU · {Math.round(Number(flavor.ramMb||0)/1024)}GB RAM · {flavor.diskGb}GB Disk</p></div><div><strong>{flavor.maxCreatable==null?"계산 불가":`최대 ${flavor.maxCreatable}개`}</strong><p className="hint">{flavor.bottlenecks?.length?`병목: ${flavor.bottlenecks.join(", ")}`:"쿼터 병목 없음"}</p></div></article>)}</div>:<div className="empty-state">표시할 허용 Flavor가 없습니다.</div>}
    </section>
    <section className="admin-simple-card">
      <div className="admin-section-head"><div><strong>전용 프로젝트</strong><p className="hint">승인 시 프로젝트, Quota, 보안그룹, 기본 네트워크와 라우터를 구성합니다.</p></div></div>
      <div className="admin-list-stack">{projects.length?projects.map((item)=><article className="admin-list-card" key={item.id}><div><strong>{item.projectName||item.requestedProjectName}</strong><p className="hint">{item.userName||item.username||`사용자 #${item.userId}`} · {item.networkName||"private"} · {item.subnetCidr||"CIDR 미설정"}</p></div><span className={`status-chip is-${item.status}`}>{statusLabel(item.status)}</span>{item.status==="requested"?<div className="button-row"><button className="primary-mini-btn" disabled={Boolean(busy)} onClick={()=>reviewProject(item.id,"approve")} type="button">승인·구성</button><button className="mini-btn danger-mini-btn" disabled={Boolean(busy)} onClick={()=>reviewProject(item.id,"reject")} type="button">반려</button></div>:null}</article>):<div className="empty-state">전용 프로젝트 요청이 없습니다.</div>}</div>
    </section>
    <section className="admin-simple-card">
      <div className="admin-section-head"><div><strong>클라우드 작업</strong><p className="hint">인스턴스, 볼륨, 네트워크, 라우터, Floating IP, 보안그룹 작업 이력입니다.</p></div></div>
      <div className="admin-list-stack">{actions.length?actions.map((item)=><article className="admin-list-card" key={item.id}><div><strong>{item.operation}</strong><p className="hint">{item.projectName} · {item.userName||item.username||`사용자 #${item.userId}`} · 월 {won.format(item.estimatedMonthlyCost||0)}원</p></div><span className={`status-chip is-${item.status}`}>{statusLabel(item.status)}</span>{item.status==="requested"?<div className="button-row"><button className="primary-mini-btn" disabled={Boolean(busy)} onClick={()=>reviewAction(item.id,"approve")} type="button">승인·실행</button><button className="mini-btn danger-mini-btn" disabled={Boolean(busy)} onClick={()=>reviewAction(item.id,"reject")} type="button">반려</button></div>:null}</article>):<div className="empty-state">클라우드 작업 이력이 없습니다.</div>}</div>
    </section>
  </div>;
}
