import {hasAdminPermission} from './admin-permissions.js';

const nameOf = value => String(value || '').trim();
const sameName = (a,b) => nameOf(a).toLowerCase() === nameOf(b).toLowerCase();

// This plans the existing community cleanup request; it never mutates resources.
export function projectCleanupPlan({project, requests = [], user, platformStatus = {}, busy = false}) {
  const projectName = nameOf(project?.projectName);
  const denied = reason => ({allowed:false,reason,projectName,requestIds:[],confirmation:`DELETE ${projectName}`});
  if (!hasAdminPermission(user,'admin:cloud')) return denied('클라우드 관리 권한이 필요합니다.');
  if (busy) return denied('다른 작업이 진행 중입니다.');
  if (!projectName || !project.ok || project.pending) return denied('프로젝트 자원 조회가 완료되어야 합니다.');
  const protectedNames = [platformStatus.serviceProjectName,platformStatus.pocProjectName].filter(Boolean);
  if (protectedNames.some(value => sameName(value,projectName))) return denied('서비스·PoC 기본 프로젝트는 보호됩니다.');
  const links = requests.filter(item => item.status === 'approved' && sameName(item.projectName || item.requestedProjectName,projectName));
  const requestIds = [...new Set(links.map(item => Number(item.id)))];
  if (!requestIds.length || requestIds.some(id => !Number.isSafeInteger(id) || id <= 0)) return denied('승인된 프로젝트 연결 기록을 확인해야 합니다.');
  return {allowed:true,reason:'',projectName,requestIds,confirmation:`DELETE ${projectName}`};
}

export function projectCleanupRequest(plan, confirmation) {
  if (!plan?.allowed || String(confirmation || '').trim() !== plan.confirmation) throw new Error('프로젝트 이름이 포함된 확인 문구를 정확히 입력해 주세요.');
  return {ids:[...plan.requestIds],cleanupOpenstackProjects:true,confirmOpenstackProjectCleanup:'DELETE_OPENSTACK_PROJECTS'};
}
