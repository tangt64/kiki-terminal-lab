// Synthetic report only: no hostnames, credentials, or collected infrastructure data.
export function securityReportFixture(now = Date.now()) {
  const at = new Date(now - 60000).toISOString();
  const startedAt = new Date(now - 180000).toISOString();
  const tools = ['trivy', 'grype', 'openscap'];
  const baseline = Object.fromEntries(['nova_compute', 'neutron_openvswitch_agent', 'openvswitch_vswitchd', 'openvswitch_db'].map(key => [key, 'healthy']));
  const ssh = {permitrootlogin:'no', permitemptypasswords:'no', passwordauthentication:'no', kbdinteractiveauthentication:'no'};
  const explanation = {ruleId:'example.ssh.explicit', reason:'explicit-setting-missing', title:'SSH 명시 설정 확인', evidence:'유효 설정은 no이지만 정적 구성에 명시 설정이 없습니다.', recommendation:'설치 환경의 정책을 검토한 후 명시 설정과 유효 설정을 함께 확인하세요.'};
  return {
    schemaVersion:2, reportId:'synthetic-community-report', observedAt:at, pilotNode:'node1',
    nodes:['node1','node2'].map(id => ({id, observedAt:at, tools:tools.map(id => ({id, installation:'installed', version:'demo-1.0', signature:'verified'}))})),
    scans:['node1','node2'].flatMap(nodeId => tools.map(tool => {
      const host = tool === 'openscap', failed = host && nodeId === 'node2';
      return {id:`${nodeId}-${tool}`, nodeId, tool, status:'completed', scope:host?'host-rules':'fixture', targetLabel:host?'가상 호스트의 예시 규칙':'합성 취약점 검사 예시', startedAt, completedAt:at,
        database:host?null:{builtAt:at,updatedAt:at,valid:true},
        counts:host?{pass:failed?0:1,fail:failed?1:0,error:0,unknown:0,notapplicable:0,notchecked:0,notselected:0}:{critical:0,high:0,medium:1,low:0,negligible:0,unknown:0},
        findings:host?[{id:'example.ssh.explicit',title:'SSH 설정 예시',severity:'info',result:failed?'fail':'pass'}]:[{id:'EXAMPLE-ISSUE',title:'가상 패키지 예시',severity:'medium',package:'example-package',installedVersion:'1.0',fixedVersion:'1.1'}]};
    })),
    baseline:{before:{...baseline},after:{...baseline}},
    verification:{observedAt:at,note:'가상 SSH 상태 · 실제 인프라 검사 결과가 아닙니다.',ssh:{...ssh}},
    assessments:['node1','node2'].map(nodeId => ({nodeId,observedAt:at,
      baseline:{before:{example_service:'healthy',example_exporter:'running'},after:{example_service:'healthy',example_exporter:'running'},continuity:nodeId==='node1'?'verified':'changed',sshConfigUnchanged:nodeId==='node1'},
      verification:{observedAt:at,diagnosedAt:at,note:'합성 데이터의 서비스·SSH 교차 확인',ssh:{...ssh},explanations:nodeId==='node2'?[{...explanation}]:[]}})),
    scopeNote:'화면 및 데이터 계약 검증을 위한 가상 노드 2개입니다. 실제 운영 환경의 안전성을 나타내지 않습니다.',
    limits:{cpuQuotaPercent:25,memoryMaxMiB:256,runtimeMaxSeconds:60}
  };
}
