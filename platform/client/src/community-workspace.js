import {selectBulkStartTargets} from './cloud-bulk-actions.js';
export const COMMUNITY_SERVICES = [
  ['zun','컨테이너'],['magnum','Kubernetes'],['trove','데이터베이스'],
  ['aiGpu','AI 환경'],['llm','AI 질문'],['cicd','CI/CD'],['internalImageServer','이미지 서버'],
];
export const COMMUNITY_ADMIN_GROUPS = [
  {key:'today',label:'오늘 처리',tabs:['approvalCenter','messages','consulting','qna']},
  {key:'infra',label:'자원·진단',tabs:['cloudConsole','instanceMonitor','aiLabs','zun','magnum','trove','loadBalancers','imageMirroring','monitor','securityInspection','openstackCleanup','cicd','logs','llm']},
  {key:'accounts',label:'사용자·권한',tabs:['users','invites']},
  {key:'communication',label:'소통·이벤트',tabs:['notices','activity','marketingSurveys','luckyDrawAdmin','mailing','mailLogs']},
  {key:'templates',label:'템플릿·문서',tabs:['templates','appYamls','cloudInit','adminManual']},
  {key:'settings',label:'설정·감사',tabs:['platform','sso','terms','auditLogs','accessLogs']},
];
export function filterCommunityInstances(instances,{query='',status='all',sort='name'}={}) {
  const needle=String(query).trim().toLocaleLowerCase();
  return instances.filter(vm=>(status==='all'||String(vm.status).toUpperCase()===status)&&
    (!needle||[vm.name,vm.id,...Object.values(vm.addresses||{}).flat().map(a=>a.addr)].some(value=>String(value||'').toLocaleLowerCase().includes(needle))))
    .sort((a,b)=>String(sort==='status'?a.status:a.name||a.id).localeCompare(String(sort==='status'?b.status:b.name||b.id),'ko',{numeric:true}));
}
export function communityVmSelection(instances,ids,visibleInstances=instances) {
  const selected=new Set(ids.map(String)),visible=new Set(visibleInstances.map(vm=>String(vm.id)));
  const targets=selectBulkStartTargets(instances).filter(vm=>selected.has(String(vm.id)));
  return {targets,selectedCount:selected.size,eligibleCount:targets.length,hiddenCount:targets.filter(vm=>!visible.has(String(vm.id))).length,excludedCount:selected.size-targets.length};
}
