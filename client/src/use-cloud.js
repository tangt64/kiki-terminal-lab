import { useCallback,useEffect,useRef,useState } from 'react';
import { api } from './api.js';

export function useCloud(session,notify){
  const [settings,setSettings]=useState(null);
  const [projects,setProjects]=useState([]);
  const [actions,setActions]=useState([]);
  const [snapshot,setSnapshot]=useState(null);
  const [status,setStatus]=useState({});
  const snapshotRequest=useRef(0);
  const loadProjects=useCallback(async()=>{
    const result=await api(session.role==='admin'?'/api/admin/projects':'/api/cloud-console/project');setProjects(result.projectRequests);return result;
  },[session.id,session.role]);
  const loadActions=useCallback(async()=>{const result=await api('/api/cloud-console/actions');setActions(result.actions);return result;},[session.id]);
  const loadSnapshot=useCallback(async(projectName)=>{
    const sequence=++snapshotRequest.current;
    try{const result=await api('/api/cloud-console/snapshot?'+new URLSearchParams({projectName}));if(sequence===snapshotRequest.current){setSnapshot(result.snapshot);setStatus({});}return result.snapshot;}
    catch(error){if(sequence===snapshotRequest.current)setStatus({tone:'error',message:error.message});throw error;}
  },[session.id]);
  const refresh=useCallback(async()=>{
    const [config]=await Promise.all([api('/api/settings'),loadProjects(),loadActions()]);setSettings(config.settings);
  },[loadProjects,loadActions]);
  useEffect(()=>{void refresh().catch(error=>notify(error.message));},[refresh,notify]);
  const action=useCallback(async({method,path,body={},projectName})=>{
    const result=await api(path,{method,body:{...body,projectName}});
    notify(result.approvalRequired?'관리자 승인 대기로 등록했습니다.':'작업을 완료했습니다.');
    const updates=await Promise.allSettled([loadSnapshot(projectName),loadActions()]);
    if(updates.some(r=>r.status==='rejected'))notify('작업은 접수됐지만 목록을 갱신하지 못했습니다. 새로고침하세요.');
    return result;
  },[loadSnapshot,loadActions,notify]);
  const review=useCallback(async(id,decision)=>{
    await api(`/api/admin/cloud-console/actions/${id}/review`,{method:'POST',body:{action:decision}});await loadActions();notify('작업 요청을 처리했습니다.');
  },[loadActions,notify]);
  return {
    settings,setSettings,projects,actions,snapshot,refresh,
    cloudProps:{session,isAdmin:session.role==='admin',platformStatus:settings||{},selfServiceProjectRequests:projects,cloudConsoleActions:actions,cloudConsoleSnapshot:snapshot,cloudConsoleStatus:status,
      loadCloudConsoleProject:loadProjects,loadCloudConsoleActions:loadActions,loadCloudConsoleSnapshot:loadSnapshot,runCloudConsoleAction:action,reviewCloudConsoleAction:review,
      createCloudConsoleProject:async body=>{const result=await api('/api/cloud-console/project',{method:'POST',body});await loadProjects();notify(result.automaticallyApproved?'프로젝트를 생성했습니다.':'프로젝트 승인 대기로 등록했습니다.');return result;},
      deleteCloudConsoleProject:async body=>{const result=await api('/api/cloud-console/project',{method:'DELETE',body});setSnapshot(null);await loadProjects();notify('프로젝트를 삭제했습니다.');return result;},
      openCloudConsole:body=>api(`/api/cloud-console/instances/${body.serverId}/console`,{method:'POST',body}),
      createCloudConsoleTerminalSession:body=>api(`/api/cloud-console/instances/${body.serverId}/terminal/session`,{method:'POST',body}),
      closeCloudConsoleTerminalSession:id=>api(`/api/cloud-console/terminal/sessions/${id}`,{method:'DELETE'}),
    },
  };
}
