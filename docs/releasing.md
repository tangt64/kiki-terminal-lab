# GitHub·Gitea 한 번에 배포하기

GitHub의 `origin`과 Gitea의 `internal`은 일반 저장소 두 개입니다. GitHub는 공개하고 Gitea는 비공개로 유지합니다. 자동 Pull Mirror를 사용하지 않습니다. 아래 명령 한 번이 양쪽에 현재 브랜치·버전 태그·소스 ZIP·체크섬을 올리고 일치 여부를 확인합니다.

```bash
npm run release:publish
```

## 준비

- 독립 `kiki-terminal-lab` 저장소의 루트에서 실행합니다.
- Git, Node.js 22.13 이상, npm 의존성(`npm ci`), Python 3.9 이상이 필요합니다.
- `origin`은 GitHub, `internal`은 Gitea의 같은 제품 저장소를 가리키는 HTTPS remote여야 합니다. URL에 비밀번호·토큰을 넣지 않습니다.
- 양쪽 저장소가 존재하고 쓰기 권한이 있어야 합니다. GitHub는 공개·비공개를 지원하고 Gitea는 반드시 비공개여야 합니다. Gitea Pull Mirror·보관 저장소에는 배포하지 않습니다.
- 현재 브랜치는 기본 `main`이고 작업 트리는 깨끗해야 합니다. 변경 사항은 먼저 검증하고 커밋합니다.
- 새 배포는 `package.json`·`package-lock.json`의 버전을 함께 올리고 관련 문서·변경 이력도 갱신합니다. 이미 다른 커밋을 가리키는 버전 태그는 재사용하지 않습니다.

Git Credential Manager에 저장된 기존 로그인 정보를 사용합니다. Gitea의 표준 GCM OAuth 갱신 설정은 이 명령에만 적용하며 전역 Git 설정을 바꾸지 않습니다. 토큰은 메모리에서만 사용하고 소스·명령 인자·Git remote URL·배포 결과 파일에 저장하지 않습니다.

환경변수 인증이 필요한 환경에서는 `RELEASE_GITHUB_TOKEN`, `RELEASE_GITEA_TOKEN`을 사용할 수 있습니다. 사용자명이 다른 경우 `RELEASE_GITHUB_USERNAME`, `RELEASE_GITEA_USERNAME`도 지정합니다. 토큰은 비밀 저장소에서 주입하며 소스·셸 이력·채팅에 직접 입력하지 않습니다. Python을 자동으로 찾지 못하면 `RELEASE_PYTHON`에 실행 파일 경로를 설정합니다.

## 수행 순서

1. 두 remote의 fetch/push 주소, 저장소 ID·저장소별 공개 범위·쓰기 권한과 브랜치·태그 충돌을 확인합니다. 원격 브랜치가 갈라졌거나 기존 버전 파일이 다르면 양쪽에 쓰기 전에 중단합니다.
2. JavaScript 구문 검사와 프런트 빌드를 수행합니다. 빌드가 소스를 변경했다면 먼저 커밋해야 합니다.
3. 정확한 Git 커밋의 허용된 소스 파일로 ZIP을 만들고 파일별 SHA-256 목록과 ZIP 체크섬을 생성합니다. 작업 파일의 줄바꿈·수정 시간·미커밋 파일 대신 Git blob을 사용합니다.
4. ZIP의 모든 파일이 해당 커밋과 일치하는지 확인합니다. `.git`·환경파일·운영 데이터·키·런타임·의존성·이전 릴리스는 포함하지 않습니다.
5. `v<package.version>` 태그가 없으면 만들고, 각 서버에 선택한 브랜치와 태그를 함께 push합니다. 강제 push와 전체 ref 미러링은 사용하지 않습니다.
6. 양쪽에 초안 릴리스를 만들고 ZIP·체크섬을 업로드합니다. 실제 다운로드한 파일의 크기·SHA-256을 비교한 뒤 릴리스를 게시합니다. 기본은 Preview입니다.
7. 원격 브랜치·태그, 파일 해시, 저장소 저장소별 공개 범위와 GitHub 공개 다운로드 및 Gitea 비로그인 다운로드 차단을 다시 확인합니다.

양쪽 서버를 하나의 트랜잭션으로 묶을 수는 없습니다. 한쪽 push나 업로드 이후 다른 쪽에서 장애가 나면 성공한 작업은 남습니다. 원인을 해결한 뒤 **같은 명령을 다시 실행**하면 이미 일치하는 파일은 재사용하고 나머지를 이어갑니다. 완성된 릴리스·첨부 파일을 삭제하거나 덮어쓰지 않습니다. 내용이 충돌하면 버전을 올려야 합니다.

첫 성공 이후에는 로컬 결과에 저장된 저장소 ID도 확인하므로, 같은 주소에 다른 저장소가 생기면 중단합니다. 주소나 대상 ID를 의도적으로 바꿨다면 `runtime/release-publish/last-success.json`을 보관하고 새 대상의 이름·권한·비공개 여부를 확인한 뒤 초기화하세요.

## 사전 확인과 재검증

```bash
# 인증·대상·Git ref 사전 확인. 빌드·태그 생성·push·업로드는 하지 않습니다.
npm run release:publish -- --dry-run

# 배포된 현재 버전의 코드·태그·실제 첨부 파일과 비공개 접근을 다시 검증합니다.
npm run release:publish -- --verify-only

# main은 현재 커밋, 릴리스·ZIP은 지정한 과거 태그를 기준으로 검사합니다.
npm run release:publish -- --verify-only --tag v0.3.1
```

재검증 시 로컬 ZIP이 없으면 원격의 같은 파일을 `releases/`에 받아 검사합니다. 원격 저장소에 쓰지는 않습니다. 실패하면 0이 아닌 종료 코드를 반환하므로 배포 작업에서도 오류를 감지할 수 있습니다.

다른 remote·브랜치·Python 또는 배포 설명을 지정할 수도 있습니다.

```bash
npm run release:publish -- --github-remote origin --gitea-remote internal --branch main
npm run release:publish -- --python /usr/bin/python3 --notes-file release-notes.md
# 명시적으로 정식 릴리스를 만들 때만 사용합니다.
npm run release:publish -- --stable
```

상세 결과는 Git·배포 ZIP에서 제외되는 `runtime/release-publish/last-result.json`에 저장됩니다. 마지막 성공 결과는 `last-success.json`에 별도로 보존합니다. 실행 중 다른 배포를 막는 `deployment.lock`이 남았다면 실행 중인 배포가 없는지 확인한 뒤 해당 잠금 파일만 정리합니다.

## ZIP이 필요한가요?

Git으로 설치하는 사용자에게 ZIP은 필수가 아닙니다. 해당 버전 태그를 clone·checkout해서 설치할 수 있습니다. 제공하는 소스 ZIP은 인스톨러와 검증한 소스를 묶고 SHA-256을 확인하기 위한 배포 경로입니다. 의존성과 컨테이너 이미지는 별도로 내려받으므로 오프라인 설치 이미지가 아닙니다.

두 저장소의 릴리스 파일까지 같은 상태로 관리하기 위해 이 명령은 ZIP과 체크섬을 함께 배포합니다. 일반 소스 수정만 하고 배포하지 않을 때에는 이 명령 대신 평소 Git 작업을 사용합니다.
