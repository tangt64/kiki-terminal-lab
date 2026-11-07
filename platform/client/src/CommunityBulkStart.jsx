import {useRef,useState} from 'react';
import {runCloudBulkActions,selectBulkStartTargets} from './cloud-bulk-actions.js';
import {useCommunityUiState} from './community-ui-memory.jsx';
import {communityVmSelection} from './community-workspace.js';
export default function CommunityBulkStart({instances,visibleInstances=instances,projectName,busy,onBusy,onAction}){
 const [ids,setIds]=useCommunityUiState(`cloud:${projectName}:vmSelection`,[]);
 const [message,setMessage]=useState('');const lock=useRef(false);
 const stopped=selectBulkStartTargets(instances);
 const summary=communityVmSelection(instances,ids,visibleInstances);
 const selected=summary.targets;
 const visibleIds=new Set(visibleInstances.map(vm=>String(vm.id)));
 async function start(){
  if(busy||lock.current||!selected.length)return;
  if(!window.confirm(`${selected.length}대의 시작 요청을 한 대씩 순서대로 전송합니다. 부팅은 서로 겹칠 수 있습니다.\n${selected.map(vm=>vm.name||vm.id).join('\n')}`))return;
  lock.current=true;onBusy(true);
  try{const results=await runCloudBulkActions({instances:selected,operation:'start',runAction:r=>onAction({...r,projectName}),onProgress:(n,total)=>setMessage(`순차 시작 요청 중 · ${n}/${total}`)});
   setIds(results.filter(r=>r.status==='failed').map(r=>String(r.id)));
   setMessage(`시작 요청 완료 · 성공 ${results.filter(r=>r.status==='success').length} / 승인 대기 ${results.filter(r=>r.status==='pending').length} / 실패 ${results.filter(r=>r.status==='failed').length}`);
  }finally{lock.current=false;onBusy(false);}
 }
 return <section className="community-vm-selection" aria-label="중지 VM 순차 시작"><p>중지된 VM 여러 대를 선택해 순차적으로 시작 요청할 수 있습니다. 기존 권한과 자원 한도가 적용됩니다.</p>
  <p role="status">선택 {summary.selectedCount}대 · 시작 가능 {summary.eligibleCount}대 · 제외 {summary.excludedCount}대 · 현재 필터 밖 {summary.hiddenCount}대</p>
  {stopped.filter(vm=>visibleIds.has(String(vm.id))).map(vm=><label key={vm.id}><input type="checkbox" aria-label={`${vm.name||vm.id} 시작 대상 선택`} disabled={busy} checked={ids.includes(String(vm.id))} onChange={e=>setIds(values=>e.target.checked?[...values,String(vm.id)]:values.filter(id=>id!==String(vm.id)))}/>{vm.name||vm.id}</label>)}
  {ids.length?<details><summary>선택 대상 확인</summary><ul>{ids.map(id=>{const vm=instances.find(vm=>String(vm.id)===id);return <li key={id}>{vm?.name||id}{selected.some(vm=>String(vm.id)===id)?'':' · 제외: 중지 상태가 아니거나 현재 조회되지 않음'}</li>;})}</ul></details>:null}
  {summary.hiddenCount?<p>필터 밖의 선택도 유지됩니다. 시작 전 전체 대상 이름을 확인하세요.</p>:null}
  <button type="button" disabled={busy||!selected.length} title={!selected.length?'시작 가능한 중지 VM을 선택하세요.':undefined} onClick={()=>void start()}>선택 {selected.length}대 순차 시작</button>
  <button type="button" disabled={busy||!ids.length} onClick={()=>setIds([])}>선택 해제</button><p role="status">{message}</p>
 </section>;
}

