import './cloud-cleanup-scope.css';

const SCOPES = {
  records:{title:'기록 제거',removes:'포털의 프로젝트 요청·승인 연결 기록을 제거합니다.',preserves:'기본 동작은 실제 VM·볼륨·네트워크·프로젝트를 보존합니다.',note:'추가 확인에서 OpenStack 자동 정리를 선택하면 실제 자원과 프로젝트도 삭제됩니다. 기록만 제거하려면 추가 정리를 취소하세요.'},
  instance:{title:'인스턴스 정리',removes:'펼친 자원 목록의 삭제 버튼으로 해당 VM 한 대를 삭제합니다.',preserves:'프로젝트와 네트워크는 유지합니다. 볼륨은 기존 연결·자동 삭제 설정에 따라 영향을 받을 수 있습니다.',note:'커뮤니티의 기존 개별 VM 삭제 절차입니다. 프로젝트 전체 삭제와 범위가 다르며, 임시·로컬 디스크 데이터는 사라집니다.'},
  project:{title:'프로젝트 전체 삭제',removes:'VM·볼륨·프로젝트 소유 네트워크 등 지원되는 잔여 자원을 정리한 뒤 Keystone 프로젝트와 포털 연결을 제거합니다.',preserves:'사용자 계정과 별도로 보관되는 기록은 삭제 대상이 아닙니다.',note:'볼륨 데이터도 삭제됩니다. 진행 중인 포털 VM·컨테이너·DB·클러스터 등은 기존 보호 검사에서 차단될 수 있습니다. 실패 시 일부 정리가 이미 완료됐을 수 있으며 자동 원복되지 않습니다.'},
};
export function CloudCleanupScope({mode}) {
  const scope=SCOPES[mode];
  return <div className={`cloud-cleanup-scope is-${mode}`} role="note" aria-label={`${scope.title} 범위`}><strong>{scope.title}</strong><p>{scope.removes}</p><p className="cloud-cleanup-preserved">{scope.preserves}</p><p className="cloud-cleanup-caution">{scope.note}</p></div>;
}
export default function CloudCleanupGuide() {
  return <section className="cloud-cleanup-guide" aria-label="정리 작업별 삭제 범위 안내"><div className="cloud-cleanup-guide-heading"><strong>무엇을 제거하나요?</strong><span>기록·인스턴스·프로젝트의 범위가 다릅니다.</span></div><div className="cloud-cleanup-guide-grid">{Object.keys(SCOPES).map(mode=><CloudCleanupScope key={mode} mode={mode}/>)}</div><p className="cloud-cleanup-policy">프로젝트 전체 삭제는 승인된 연결 기록과 클라우드 관리 권한이 필요합니다. 서비스·PoC 기본 프로젝트 보호와 기존 자원 검사를 유지합니다. 검색·표시 범위와 관계없이 프로젝트 전체가 대상이며, 버튼을 누르면 먼저 확인 창이 열립니다.</p></section>;
}
