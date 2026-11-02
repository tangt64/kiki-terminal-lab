import {useRef,useState} from 'react';
import {runCloudBulkActions} from './cloud-bulk-actions.js';
export default function CommunityBulkStart({instances,projectName,busy,onBusy,onAction}){
 const [ids,setIds]=useState([]),[message,setMessage]=useState('');const lock=useRef(false);
 const stopped=instances.filter(vm=>String(vm.status).toUpperCase()==='SHUTOFF');
 const selected=stopped.filter(vm=>ids.includes(String(vm.id)));
 async function start(){
  if(busy||lock.current||!selected.length)return;
  if(!window.confirm(`${selected.length}대의 시작 요청을 한 대씩 순서대로 전송합니다. 부팅은 서로 겹칠 수 있습니다.\n${selected.map(vm=>vm.name||vm.id).join('\n')}`))return;
  lock.current=true;onBusy(true);
  try{const results=await runCloudBulkActions({instances:selected,operation:'start',runAction:r=>onAction({...r,projectName}),onProgress:(n,total)=>setMessage(`순차 시작 요청 중 · ${n}/${total}`)});
   setIds(results.filter(r=>r.status==='failed').map(r=>String(r.id)));
   setMessage(`시작 요청 완료 · 성공 ${results.filter(r=>r.status==='success').length} / 승인 대기 ${results.filter(r=>r.status==='pending').length} / 실패 ${results.filter(r=>r.status==='failed').length}`);
  }finally{lock.current=false;onBusy(false);}
 }
 return <section aria-label="중지 VM 순차 시작"><p>중지된 VM 여러 대를 선택해 순차적으로 시작 요청할 수 있습니다. 기존 권한과 자원 한도가 적용됩니다.</p>
  {stopped.map(vm=><label key={vm.id}><input type="checkbox" disabled={busy} checked={ids.includes(String(vm.id))} onChange={e=>setIds(values=>e.target.checked?[...values,String(vm.id)]:values.filter(id=>id!==String(vm.id)))}/>{vm.name||vm.id}</label>)}
  <button type="button" disabled={busy||!selected.length} onClick={()=>void start()}>선택 {selected.length}대 순차 시작</button><p role="status">{message}</p>
 </section>;
}
