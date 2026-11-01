# 기여 안내

버그 수정, 문서 개선, 일반 사용자·관리자 기능 개선을 환영합니다. 개발자·유지보수 담당은 Choi Gook Hyun (tangt64), 문의는 [tang@dustbox.kr](mailto:tang@dustbox.kr)입니다.

## 시작하기

1. [설치 안내](docs/installation.md)와 [개발 안내](docs/development.md)를 읽습니다.
2. 기능 제안이나 일반 오류는 [GitHub Issues](https://github.com/tangt64/kiki-terminal-lab/issues)에 남깁니다. 변경 범위가 크면 구현 전에 목적과 영향을 설명합니다.
3. 저장소를 fork하고 작업 브랜치에서 수정합니다. 한 PR에는 관련된 변경을 묶고 무관한 서식 변경은 피합니다.
4. 변경 목적, 사용자에게 달라지는 동작, 검증 결과와 남은 제한을 PR에 설명합니다.

## 범위와 구현 기준

- 교육 과정·교육 랩실·시험·수료증·교육 결제와 Lab Board는 이 배포본의 범위 밖입니다.
- 계정·관리자 권한, 사용자 자원 소유권, 승인 흐름을 유지합니다. 브라우저의 숨김 처리만으로 권한을 제한하지 않습니다.
- 원본 Terminal Lab 저장소나 기존 운영 DB·환경파일을 참조하지 않는 독립성을 유지합니다.
- 환경파일, clouds.yaml, 개인키, 인증서 키, DB 덤프, 업로드, 로그, 실제 OAuth/SMTP/API 자격증명을 커밋하지 않습니다.
- 주석은 복잡한 판단의 이유, 데이터·권한 경계, 실패·재시도 조건을 설명합니다. 코드와 다른 설명이나 단순히 코드를 반복하는 주석은 피합니다.
- 기존 저작권·라이선스 고지를 보존하며, 새 의존성을 추가하면 라이선스와 배포 고지도 확인합니다.

## 검증

버전 배포는 [GitHub·Gitea 배포 안내](docs/releasing.md)를 따릅니다. `npm run release:publish`는 두 비공개 저장소와 배포 파일을 검증하며, 기존 버전을 덮어쓰지 않습니다.

```bash
npm ci
node scripts/check.mjs
npm test
python3 -m unittest discover -s installer -p 'test_*.py'
npm run build
```

환경변수 없는 일반 테스트는 DB 통합 시험을 건너뜁니다. `TEST_DATABASE_URL`, `TEST_PLATFORM_DATABASE_URL`, `TEST_MIGRATION_DATABASE_URL`은 서로 다른 폐기 가능한 `community_test_*` DB를 지정해야 합니다. 운영 DB를 사용하지 않습니다. 상세 내용은 [개발 안내](docs/development.md)에 있습니다.

UI 변경은 실제 브라우저에서 대상 동작을 확인합니다. OpenStack·SSO·메일 등의 테스트 대역 결과와 실제 외부 서비스 연결 결과를 구분해 기록합니다. 인스톨러 변경은 별도 Linux 검증 환경에서 데이터 보존·업데이트·복원을 확인합니다.

보안상 민감한 문제는 공개 이슈에 재현 비밀이나 공격 세부를 게시하기 전에 [SUPPORT.md](SUPPORT.md)의 비공개 연락 방법을 사용하세요. 기여 코드는 프로젝트의 MIT 라이선스로 제공할 권리가 있는 코드여야 합니다.
