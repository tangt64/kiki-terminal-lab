# 개발 안내·코드 구조·주석

개발자·유지보수 담당: **Choi Gook Hyun (tangt64)** · 문의: [tang@dustbox.kr](mailto:tang@dustbox.kr)

## 코드 구조

| 경로 | 역할 |
| --- | --- |
| `platform/server/community-bootstrap.js` | 독립 환경·저장 경로 설정, DB 전환, 플랫폼 서버 기동 |
| `platform/server/community-migration.js` | 전용 DB 검사, 0.1 데이터·암호화 접속정보 전환, 초기 설정 |
| `platform/server/index.js` | 현재 일반 사용자·관리자 API와 접속·인프라 연동 |
| `platform/server/db-runtime.js` | 현재 플랫폼의 PostgreSQL 접근과 데이터 계약 |
| `platform/client/src/` | 현재 React 사용자·관리자 UI |
| `platform/shared/community-profile.js` | 교육 기능과 Lab Board의 제외 경계 |
| `server/index.js` | 현재 부트스트랩으로 연결하는 호환 진입점 |
| 나머지 루트 `server/`, `client/` | 이전 0.1 코어, 마이그레이션·회귀 시험의 기반 |
| `installer/install.py` | 설치 ID로 격리한 컨테이너·볼륨·키·백업·업데이트 관리 |
| `installer/package.py` | 파일 허용 목록에 따른 소스 ZIP·SHA-256 목록 생성 |
| `tests/` | 코어·플랫폼 API·SSO 대역·OTP·제외 기능·DB 전환 회귀 시험 |

## 현재 주석 상태

코드에 주석이 포함되어 있습니다. 주로 영문이며 독립 경로 설정, 권한·자원 소유권, 트랜잭션과 동시 작업, 암호화 데이터 전환, 세션 만료, 인스톨러 데이터 보존 등의 이유와 제약을 설명합니다. 모든 함수에 문서 주석이 붙어 있거나 전체 API 명세가 자동 생성되는 상태는 아닙니다.

예를 들어 `server/config.js`는 부모 환경파일을 읽지 않는 경계를, `community-migration.js`는 세션 계약 변경과 전환 완료 표식을, `installer/install.py`는 다른 설치의 자원을 채택하지 않는 이유와 키·백업 보존을 설명합니다. 기능을 바꿀 때 관련 주석·테스트·설치 문서도 함께 맞춥니다.

## 환경과 일반 검사

직접 실행은 Node.js 22.13 이상과 전용 PostgreSQL이 필요합니다. 기본 컨테이너 구성은 Node.js 22·PostgreSQL 17입니다. 설정·실행 명령은 [설치 안내](installation.md)를 따릅니다.

```bash
npm ci
node scripts/check.mjs
npm test
python3 -m unittest discover -s installer -p 'test_*.py'
npm run build
```

## DB 통합 시험

전용 PostgreSQL에 서로 다른 빈 테스트 DB 3개를 준비합니다. 이름은 반드시 `community_test_*` 패턴으로 지정하며, 시험 코드가 스키마·계정·요청 데이터를 생성·수정합니다.

```bash
createdb community_test_core
createdb community_test_platform
createdb community_test_migration

TEST_DATABASE_URL=postgresql://127.0.0.1/community_test_core \
TEST_PLATFORM_DATABASE_URL=postgresql://127.0.0.1/community_test_platform \
TEST_MIGRATION_DATABASE_URL=postgresql://127.0.0.1/community_test_migration \
npm test
```

DB 사용자·비밀번호·포트는 자신의 검증 환경에 맞게 지정합니다.

테스트 DB는 각 실행 전에 빈 상태로 준비합니다. 위 명령의 역할·인증은 자신의 PostgreSQL 설정에 맞춥니다. 실제 OpenStack이나 운영 사용자 데이터를 연결하지 않습니다. 테스트용 비밀번호·가짜 토큰·고정 암호화 키는 테스트 파일에 명시되어 있으며 운영 설정에 사용하지 않습니다.

플랫폼 시험은 SSO 공급자 응답을 테스트 대역으로 처리합니다. 실제 OAuth·SMTP·OpenStack·Kubernetes/CAPO·Jenkins 연결, Linux 컨테이너 설치·재기동·업데이트·백업 복원과 부하 시험은 별도 검증 항목입니다.

## 배포 전 확인

### 공개·운영 전 정리 항목

2026-11-01, 기존 `a189257` 점검에서 발견한 항목을 0.2.2에서 아래와 같이 보완했습니다. 실제 인프라 연결과 과거 배포 이력 정리는 별도 항목으로 구분합니다.

| 항목 | 현재 상태와 필요한 작업 |
| --- | --- |
| 관리자 권한 검사 | 서버 공통 경계에서 기능별 권한 검사. 역할 변경·권한 위임·관리자 계정 변경·전체 백업은 전체 관리자 전용. 역할 별칭·생성·일괄 작업·재설정/PIN·설정 조회의 우회 차단과 일반 사용자 관리 동작을 테스트 DB에서 확인 |
| 교육 진입점 | 교육 보고서·교육 랩 터미널·강사 공유 WebSocket·서비스 검증용 과정 생성 구현 제거. 제거 대상 HTTP 경로·팝업·공유 WebSocket 차단 시험 통과. 일반 클라우드 콘솔·Zun·PoC 자원 터미널과 VM 수명주기 검증 유지 |
| 교육 콘텐츠 | 현재 소스에서 31개 과정 원문 데이터·사용하지 않는 교육 화면·교육용 매뉴얼/검증 시드를 제거. 공통 쿼리 호환 테이블과 비활성 호환 코드·빈 스텁은 유지. 과거 커밋과 v0.2.1 릴리스 정리는 별도이며 정리 전 저장소 비공개 유지 |
| 운영 기본값 | 기존 사설 LLM·SSH 허용 호스트와 추가 연락처 제거. SSH는 명시적 CIDR만 사용하고 LLM은 설정 후 활성화. 알려진 이전 LLM 기본 주소만 마이그레이션에서 초기화하며 다른 명시 설정은 보존 |
| 환경 검증 | 지원 대상인 x86_64/amd64에서 실제 Linux 설치·재시작·업데이트·백업 복원, 사용 OpenStack 버전·서비스별 연동 검증 결과 기록 필요 |
| 개발 중인 경량 플랫폼 | OpenStack 호환 경량 플랫폼 구성 중. 공개 전에 API·인증·서비스별 지원 범위와 검증 버전을 별도로 안내해야 하며 현재 지원 완료로 표시하지 않음 |

검증: JavaScript 구문 검사, 전용 PostgreSQL DB 3개를 사용하는 Node 테스트 42개, 인스톨러 테스트 7개, 프런트 빌드 및 데모 화면 브라우저 확인을 수행했습니다. 실제 OpenStack/SSO 공급자/SMTP 연결, Linux 컨테이너 설치·복원과 부하 시험은 수행하지 않았습니다.

현재 저장소는 비공개로 유지합니다. 과거 Git 이력·릴리스에 포함된 교육 콘텐츠와 이전 기본값까지 정리한 뒤 공개 여부를 별도로 결정합니다. 현재 파일 수정만으로 이미 생성된 커밋이나 ZIP이 바뀌지는 않습니다. 실제 운영 데이터·비밀키·자격증명을 예제나 화면에 추가하지 않습니다.

### 관리자 권한과 호환성

`admin:access`는 콘솔 접근 권한이며, 일반 사용자 관리·클라우드·설정·운영·템플릿·마케팅·쪽지·모니터 작업에는 해당 기능 권한이 필요합니다. 전체 관리자 역할 또는 `admin:all`은 기존 관리 작업을 수행할 수 있습니다. 제한된 사용자 관리자는 일반 계정의 생성·승인·지원 플래그·비밀번호/PIN·삭제를 처리할 수 있지만 관리자 계정과 위임 권한은 변경할 수 없습니다. 백업은 계정·자격증명 전체를 포함하므로 내보내기와 복원 모두 전체 관리자 전용입니다. 설정의 비밀값은 전체 관리자 또는 명시적 `admin:platform` 권한에만 제공합니다.

파일 허용 목록에 새 배포 파일을 추가하고 운영 데이터가 포함되지 않는지 확인합니다. `node_modules`, `.git`, `.env`, `data`, `runtime`, `secrets`, `backups`, `dist`, 이전 릴리스는 소스 ZIP에서 제외합니다. `package.json`의 `private: true`는 실수로 npm 레지스트리에 게시하는 것을 막는 설정이며 GitHub 저장소 공개 여부와는 별개입니다.

기존 소스 ZIP이 있으면 다른 경로에 보관한 뒤 `python3 installer/package.py`로 새 패키지를 생성합니다. 생성된 해시 목록을 확인하고 새 디렉터리에 풀어 의존성 설치·빌드를 검증합니다. 같은 버전의 공개 릴리스를 배포한 뒤에는 내용을 덮어쓰지 말고 새 버전으로 배포합니다.

공개 프로젝트가 커지면 CI 자동화, 실제 Linux 설치 검증, API 문서, 부하 측정에 따른 사양표를 추가하는 것이 다음 우선순위입니다. 커밋·태그에는 비밀이나 운영 파일이 포함되지 않아야 합니다.
