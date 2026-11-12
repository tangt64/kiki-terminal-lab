# KIKI OS TERMINAL-LAB 인스톨러

현재 배포 버전은 **0.3.5 Preview**입니다. 인스톨러는 함께 배포된 `package.json`에서 버전을 읽어 앱 이미지와 업데이트 버전을 정합니다. `kiki-terminal-lab-0.3.5.zip`에는 설치·패키징 스크립트가 포함됩니다. ZIP 체크섬을 검증한 뒤 실행 예시는 [설치·업데이트 안내](../docs/installation.md)를 따르세요.

Podman 또는 Docker로 Linux 컨테이너를 정상 실행할 수 있는 Linux 배포판에서 사용 가능합니다. 현재 CPU 지원 대상은 **64비트 x86_64/amd64 전용**이며 32비트 x86·ARM64는 지원하지 않습니다. Python과 엔진별 권한·네트워크·볼륨 조건은 [설치 안내](../docs/installation.md)를 따릅니다.

현재 기존 OpenStack 기반으로 사용합니다. OpenStack과 호환되는 경량 플랫폼은 구성 중이며, 이 인스톨러에 해당 플랫폼 자체의 설치 기능은 포함되어 있지 않습니다. 현재 Preview의 [공개·운영 전 정리 항목](../docs/development.md#공개운영-전-정리-항목)도 확인하세요.

- Python 표준 라이브러리만 사용합니다.
- `plan`은 변경 없이 설치 범위를 출력합니다.
- `install`은 새 설치 ID·키·전용 네트워크·DB 볼륨을 만들고 앱을 실행합니다.
- `resume`은 준비 단계에서 실패한 설치를 기존 키로 재시도합니다.
- `status`, `start`, `stop`, `backup`, `update`, `uninstall`은 저장된 설치 ID의 자원만 조작합니다.
- 다른 설치의 컨테이너·네트워크·볼륨은 라벨 검증에서 거부합니다.
- `uninstall`은 DB 볼륨·네트워크·설정·백업을 보존합니다.
- 초기 관리자 비밀번호를 터미널에 출력하지 않고 전용 상태 디렉터리에 저장합니다.
- 기본 HTTP 포트는 4080이며 DB는 호스트 포트에 공개하지 않습니다.

OS·OpenStack·Kolla 설치, 디스크 파티션 변경, 인증서 발급, DNS 등록과 방화벽 변경은 수행하지 않습니다.
선택 SSH 허용 대역은 `--ssh-source-cidrs`, 일반 VM 검증용 네트워크는 `--validation-network`로 직접 지정합니다. 두 값 모두 이전 설치의 주소를 기본값으로 사용하지 않습니다.
오프라인 설치 미디어가 아니므로 최초 설치의 이미지·npm 다운로드에는 네트워크가 필요합니다.

0.3.0 새 설치는 `kiki-terminal-lab-<설치 ID>` 자원명과 KIKI 소유권 라벨, `kiki-terminal-lab-app`·`kiki-terminal-lab-db` Quadlet 이름을 사용합니다. 기존 0.2.x 설치는 새 소스에서 **원래 `--state-dir`**로 `backup`·`update`를 실행하세요. 기존 자원명·라벨·볼륨·키·`tl-community-*` 서비스는 그대로 사용합니다. 상태 파일을 직접 수정하거나 기존 설치에 `install`을 다시 실행하지 않습니다.
