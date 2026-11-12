# 설치 방법·환경 조건·서버 사양

기준: KIKI OS TERMINAL-LAB Community 0.3.5 Preview, 2026-11-12.

이 문서는 교육 기능과 랩보드를 제외한 일반 사용자·관리자 포털의 설치 안내입니다. 인스톨러는 **포털 앱과 전용 PostgreSQL**을 구성하고, 이미 운영 중인 OpenStack에 연결합니다. OS·컨테이너 엔진·OpenStack 자체를 설치하지 않습니다.

**Podman 또는 Docker로 Linux 컨테이너를 정상 실행할 수 있는 Linux 배포판에서 사용 가능**하며, 현재 CPU 지원 대상은 **64비트 x86_64/amd64만**입니다. 32비트 x86과 ARM64는 지원하지 않습니다. 아래 도구·권한·네트워크 조건도 충족해야 합니다.

현재 OpenStack 기반으로 사용할 수 있으며, **OpenStack과 호환되는 경량 플랫폼도 구성 중**입니다. 경량 플랫폼 연동은 준비 단계입니다. 현재 인스톨러는 기존 OpenStack 환경을 기준으로 하며, 경량 플랫폼 자체를 설치하거나 그 호환성을 검증하는 절차는 제공하지 않습니다.

0.2.2의 권한·교육 제외 수정 내역과 공개 전 남은 검증은 [개발 안내](development.md#공개운영-전-정리-항목)를 확인하세요. 현재 Preview의 설치 성공을 운영 준비 완료로 판단하지 않습니다.

현재 검증 범위는 Windows 환경의 소스 빌드, 전용 PostgreSQL에서의 API·인증 테스트, 데스크톱·모바일 브라우저 확인, 인스톨러 단위 테스트입니다. 아래 Linux 배포 절차의 실제 설치·재부팅·업데이트·백업 복원과 운영 OpenStack 연결은 대상 환경에서 검증해야 합니다. 인증된 OS·동시접속 규모 지원표는 아직 없습니다.

## 1. 구성과 설치 대상

```text
사용자 브라우저
    │ HTTPS / WebSocket
    ▼
TLS 역방향 프록시 ── 선택한 로컬 앱 포트, 기본 4080
    │
    ▼
Community 앱 ─── 전용 PostgreSQL 17
    │             (컨테이너 내부망, 호스트 포트 비공개)
    ├── 전용 앱 데이터 볼륨: 업로드·템플릿·SSH known_hosts
    └── 기존 OpenStack API / VM 콘솔·SSH / 선택 외부 서비스
```

로컬 평가에서는 역방향 프록시 없이 `http://localhost:4080`으로 접속합니다. 이 포털이 관리하는 VM·컨테이너·Kubernetes·DB 인스턴스의 실행 자원은 OpenStack 쪽에 별도로 필요합니다.

| 항목 | 조건 |
| --- | --- |
| 운영 배포 대상 | Podman 또는 Docker로 Linux 컨테이너 실행이 가능한 Linux 배포판. 특정 배포판으로 제한하지 않음 |
| CPU 아키텍처 | 현재 64비트 x86_64/amd64 전용. 32비트 x86·ARM64 미지원 |
| 설치 예시 | Ubuntu Server 24.04 LTS 명령 제공. 다른 배포판은 패키지 관리·엔진·권한·자동 기동 설정을 해당 환경에 맞게 적용 |
| Windows | 네이티브 개발·빌드·API 테스트 수행. 컨테이너 배포 평가는 x86_64/amd64 WSL2 Linux 셸에서 수행하며 전체 설치는 미검증 |
| 호스트 도구 | Python 3.9 이상이라는 코드 요구조건. 신규 운영은 OS가 보안 지원하는 Python 사용 |
| 컨테이너 엔진 | Podman 또는 Docker Engine. 같은 설치 사용자로 이미지 빌드·네트워크·볼륨·컨테이너 생성 가능해야 함 |
| Podman 기능 | rootless 실행, `--userns=keep-id:uid=1000,gid=1000` 지원. 자동 기동을 구성하면 systemd·Quadlet도 필요 |
| Docker 기능 | 실행 중인 Linux 컨테이너 엔진과 접근 가능한 CLI. Docker Compose는 사용하지 않음 |
| 앱 런타임 | 현재 Containerfile은 Node.js 22 / Debian Bookworm, DB 이미지는 PostgreSQL 17 Bookworm |
| 브라우저 | 최신 지원 버전의 Edge 또는 Chrome 우선 검증. JavaScript·쿠키·WebSocket 사용 가능해야 함 |
| 기본 포트 | 호스트의 사용 가능한 TCP 4080. `--port`로 1024~65535 중 변경 가능 |
| 인터넷 | 최초 빌드 시 npm, Debian 패키지 저장소, Docker Hub, registry.k8s.io 접근 필요 |

컨테이너 설치 방식에서는 호스트에 Node.js·npm·PostgreSQL을 별도로 설치하지 않습니다. 폐쇄망 설치는 현재 인스톨러가 자동 준비하지 않으므로 이미지·패키지·의존성 캐시 또는 내부 미러를 먼저 마련해야 합니다.

## 2. 포털 서버 사양

다음 수치는 **부하 시험으로 측정한 최소 사양이나 처리량 보장이 아닌 초기 용량 계획 예시**입니다. 앱과 전용 PostgreSQL을 같은 서버에서 실행하는 경우의 시작점이며, 클라우드 VM 실행 자원은 포함하지 않습니다.

| 용도 | CPU | 메모리 | SSD 여유 공간 |
| --- | --- | --- | --- |
| 가벼운 기능 평가 | 2 vCPU | 4 GiB | 40 GiB 이상 |
| 소규모 운영 시작 | 4 vCPU | 8 GiB | 80 GiB 이상 |
| 업로드·콘솔 세션·운영 작업 증가에 대비 | 8 vCPU | 16 GiB | 160 GiB 이상부터 별도 산정 |

디스크에는 이미지·소스 빌드 캐시·DB·업로드·로그·백업 공간을 고려합니다. ISO 이미지 업로드나 이미지 미러링을 사용하면 전송 파일 크기, 동시 작업, 보관 기간에 맞춰 여유 공간을 추가합니다. 백업은 별도 저장소에도 보관합니다.

동시 사용자 수와 사양의 대응표는 아직 없습니다. 실제 사용 시 앱·DB CPU/메모리, DB 연결 대기, 콘솔 세션 수, 업로드 크기, 디스크·네트워크 사용량을 측정해 조정합니다. 고가용성·여러 앱 인스턴스로의 확장은 기본 인스톨러 범위를 넘어 별도 설계·검증이 필요합니다.

포털 자체에는 GPU나 VM용 KVM 중첩 가상화가 필수 조건이 아닙니다. GPU·가상화·스토리지 용량은 해당 기능을 실행하는 OpenStack 자원 노드에 필요합니다. WSL2나 가상 머신에서 컨테이너 엔진을 구동하는 호스트 조건은 별도로 충족해야 합니다.

## 3. OpenStack과 선택 서비스 조건

현재 OpenStack 기반으로 사용할 수 있으며, 기본 인스톨러는 `--clouds` 파일을 필수로 받습니다. 실제 OpenStack 버전·배포판별 호환성 표는 아직 없으므로 운영 클라우드에서 프로젝트 생성·VM 생성·접속·정리를 검증합니다. 개발 중인 경량 플랫폼의 API·인증·기능별 지원 범위는 검증 후 별도 안내합니다.

| 기능 | 필요한 서비스·구성 |
| --- | --- |
| 기본 클라우드 연결 | Keystone 인증과 서비스 카탈로그 |
| VM·이미지·네트워크 | Nova, Glance, Neutron, 사용 가능한 이미지·Flavor·네트워크 |
| 볼륨·볼륨 부팅·ISO 디스크 작업 | Cinder 및 해당 이미지·부팅 방식 지원 |
| Heat 템플릿 기반 자원·PoC | Heat와 사용할 템플릿·이미지·네트워크 |
| Floating IP | 외부 네트워크, 가용 주소·쿼터, 관리자 허용 설정 |
| VM SSH | 앱 컨테이너에서 VM IP:22 접근, OS 계정·인증정보, SSH 호스트 키 확인 |
| VM VNC | 앱 서버에서 Nova가 반환하는 콘솔 주소로 접근, 프록시의 WebSocket 전달 |
| 선택 OpenStack 서비스 | 기능에 따라 Octavia, Manila, Blazar, Aodh, Designate, Zun, Trove 등 |
| Kubernetes/CAPO | 관리 클러스터·컨트롤러·접근 자격증명·이미지·템플릿 등의 별도 구성 |
| SSO | Google/Kakao/Naver 공급자 앱 등록, Client ID/Secret, 정확히 일치하는 Redirect URI |
| OTP | 관리자 설정과 사용자별 등록, 서버·인증기 기기의 올바른 시간 |
| 메일 | SMTP 서버·발신 주소·인증·네트워크 연결 |
| CI/CD·AI | 사용하는 Jenkins·레지스트리·LLM·GPU 자원을 각각 별도 구성 |

서비스 계정에는 사용하는 기능에 필요한 권한을 부여합니다. 사용자별 프로젝트 자동 구성을 사용한다면 프로젝트 생성, 사용자·역할 할당, 쿼터 설정과 관련 자원 관리 권한이 필요합니다. 프로젝트 이름 `admin`과 관리자 역할은 서로 다른 개념이며, 필요한 실제 권한은 해당 클라우드 정책을 따릅니다.

현재 컨테이너에는 `kubectl v1.30.14`가 포함됩니다. Kubernetes/CAPO 사용 전 실제 관리 클러스터와 클라이언트 버전의 호환성을 확인합니다. 이 문서는 최신 Kubernetes 버전과의 호환을 보증하지 않습니다. [공식 버전 차이 정책](https://kubernetes.io/releases/version-skew-policy/)을 참고합니다.

## 4. 네트워크·포트·도메인

기존 설치의 내부망 주소를 기본 연결 대상으로 사용하지 않습니다. LLM은 기본 비활성이며 주소·모델·인증을 직접 설정한 뒤 활성화합니다. 0.2.1에서 상속한 두 가지 기존 LLM 기본 주소는 0.2.2 마이그레이션이 초기화하며, 설치자가 별도로 지정한 다른 주소는 유지합니다.

선택적인 SSH 허용 규칙과 VM 수명주기 검증에는 다음 값을 명시합니다. CIDR은 앱이 VM·노드로 접속할 때 보이는 운영자 네트워크에 맞춰 지정합니다. 아래 문서용 주소를 실제 운영값으로 사용하지 않습니다.

```bash
# install 명령에 필요한 경우에만 추가
--ssh-source-cidrs '192.0.2.10/32,2001:db8::10/128'
--validation-network '<설치 환경의 OpenStack 네트워크 이름 또는 ID>'
```

직접 실행은 `.env`의 `COMMUNITY_SSH_SOURCE_CIDRS`와 `COMMUNITY_VALIDATION_NETWORK`로 지정합니다. CIDR을 비워 두면 CAPO 기본 템플릿에 추가 SSH 허용 규칙을 생성하지 않으며, ISO 검증용 SSH 규칙 생성은 설정을 요구합니다. VM 수명주기 검증도 프로젝트·허용 이미지·Flavor·네트워크가 설정돼야 실행됩니다. 설치 후 설정을 변경하려면 상태 경로의 `app.env`를 보존·수정하고 `installer/install.py update`로 앱 컨테이너를 재생성합니다.

| 방향 | 주소·포트 | 설명 |
| --- | --- | --- |
| 브라우저 → 운영 포털 | HTTPS 443 | TLS 프록시에서 종료하고 WebSocket 업그레이드 전달 |
| 호스트 프록시 → 앱 | 기본 `127.0.0.1:4080` | 같은 호스트의 프록시를 사용하는 기본 설치 |
| 브라우저 → 로컬 평가 | HTTP 4080 또는 `--port` 값 | 서버 로컬에서 접속. 원격 PC의 localhost는 그 PC 자체를 의미 |
| 앱 → 전용 DB | 컨테이너 내부 TCP 5432 | 인스톨러는 호스트 DB 포트를 게시하지 않음 |
| 앱 → OpenStack | 인증 URL·서비스 카탈로그의 주소/포트 | API가 내부망이면 앱 컨테이너에서도 해당 망에 접근 가능해야 함 |
| 앱 → VM | SSH 22, 반환된 콘솔 주소 등 | 사용할 접속 기능에 따라 라우팅·방화벽 확인 |
| 앱 → 외부 연동 | OAuth/LLM/Jenkins/레지스트리/SMTP의 실제 주소·포트 | 기능별로 허용. SMTP 포트는 서버 설정을 따름 |
| 개발 브라우저 → Vite | 기본 localhost:5180 | 개발 전용. API 프록시 기본 대상은 localhost:4080 |

공개 포털의 DNS·TLS 인증서·역방향 프록시와 사용자 자원용 도메인·TCP 프록시는 운영자가 구성합니다. 인스톨러가 기존 HAProxy/nginx·DNS·방화벽을 수정하지 않습니다.

`--public-url`은 경로가 없는 origin으로 설정합니다. 예: `https://portal.example.com` 또는 `http://localhost:4080`. 포털을 `/terminal-lab` 같은 하위 경로에 설치하는 구성은 이 안내의 대상이 아닙니다.

기본 로컬 바인딩은 외부에 앱 포트를 직접 노출하지 않습니다. `--bind 0.0.0.0`은 다른 호스트에서 앱 포트로 접근해야 하는 경우에만 사용하며, 대상 호스트·방화벽 범위를 함께 구성합니다. `--trust-proxy`는 신뢰하는 한 단계 프록시 뒤에서만 사용합니다.

## 5. Linux 설치 절차

### 5.1 호스트 준비

아래는 x86_64/amd64 Ubuntu Server 24.04의 Podman 평가 구성 예시입니다. Ubuntu는 설치 명령의 예시이며 사용 가능한 Linux 배포판을 제한하는 조건이 아닙니다. 이 명령들은 운영자가 대상 Linux 서버에서 실행합니다. 배포판의 실제 패키지·rootless 설정은 [Podman 설치 문서](https://podman.io/docs/installation)를 따릅니다.

```bash
sudo apt-get update
sudo apt-get install -y python3 ca-certificates curl unzip podman uidmap slirp4netns fuse-overlayfs
python3 --version
podman --version
podman info
```

rootless Podman을 사용하면 설치 사용자에게 subuid/subgid 등 필요한 사용자 네임스페이스 구성이 있어야 합니다. 이후 설치·상태 확인·백업 명령은 동일한 사용자·엔진으로 실행합니다.

Docker를 선택하면 [공식 Engine 설치 절차](https://docs.docker.com/engine/install/ubuntu/)를 따라 설치하고 `docker info`가 성공하는지 확인합니다. 이 앱의 `--engine docker`는 엔진을 설치하거나 접근 권한을 부여하지 않습니다.

### 5.2 소스와 상태 경로 준비

릴리스의 소스 ZIP과 같은 이름의 `.sha256` 파일을 함께 내려받아 검증한 뒤 새 디렉터리에 풉니다. ZIP 안에 인스톨러가 포함됩니다.

```bash
sha256sum -c kiki-terminal-lab-0.3.5.zip.sha256
unzip kiki-terminal-lab-0.3.5.zip
cd kiki-terminal-lab
COMMUNITY_STATE_DIR="$HOME/.local/state/kiki-terminal-lab"
COMMUNITY_CLOUD_FILE="$HOME/.config/kiki-terminal-lab/clouds.yaml"
install -d -m 700 "$HOME/.config/kiki-terminal-lab"
cp deploy/clouds.example.yaml "$COMMUNITY_CLOUD_FILE"
chmod 600 "$COMMUNITY_CLOUD_FILE"
```

소스 디렉터리와 별도의 고정 상태 경로를 사용하면 새 릴리스 디렉터리로 이동해도 설치 정보·키·백업을 이어서 사용할 수 있습니다. `--state-dir`을 생략하면 현재 배포본의 `runtime/deployment/`가 기본값입니다. 아래 모든 예시는 위의 별도 상태 경로를 사용합니다. 새 셸에서도 같은 변수 값을 설정합니다.

### 5.3 clouds.yaml 작성

복사한 파일을 편집기로 열어 실제 서비스 계정으로 변경합니다. `REPLACE_WITH_SERVICE_ACCOUNT_PASSWORD` 같은 예시 값으로 설치하지 않습니다.

```yaml
clouds:
  community:
    auth:
      auth_url: https://identity.example.com:5000/v3
      username: community-service
      password: REPLACE_WITH_SERVICE_ACCOUNT_PASSWORD
      project_name: admin
      user_domain_name: Default
      project_domain_name: Default
    region_name: RegionOne
    interface: public
    identity_api_version: 3
    verify: true
```

`community`는 아래 `--cloud-name`과, 프로젝트 이름은 `--service-project` 및 운영 환경의 값과 맞춥니다. 파일은 서버에만 두며 공개 저장소에 추가하지 않습니다. 파일 형식의 참고 자료는 [OpenStack clouds.yaml 안내](https://docs.openstack.org/openstacksdk/latest/user/config/configuration.html)입니다. 이 앱은 인스톨러에 지정한 파일·클라우드 이름을 사용하며 SDK의 모든 자동 검색·인증 확장을 구현한다는 뜻은 아닙니다.

사설 CA는 설치 명령에 `--ca /secure/openstack-ca.crt`를 추가하면 전용 복사본이 만들어집니다. `clouds.yaml`에도 `cacert`를 넣는 경우 컨테이너 내부 경로 `/app/secrets/openstack-ca.crt`를 사용합니다. 호스트 전용 경로는 컨테이너에서 그대로 읽을 수 없습니다.

### 5.4 로컬 평가 설치

```bash
python3 installer/install.py plan \
  --engine podman \
  --state-dir "$COMMUNITY_STATE_DIR" \
  --public-url http://localhost:4080

python3 installer/install.py install \
  --engine podman \
  --state-dir "$COMMUNITY_STATE_DIR" \
  --clouds "$COMMUNITY_CLOUD_FILE" \
  --cloud-name community \
  --service-project admin \
  --public-url http://localhost:4080
```

`plan`은 계획을 표시하는 읽기 전용 명령이며, 엔진·클라우드 연결·하드웨어를 실제 검사하는 사전 진단은 아닙니다. `install`은 이미지 빌드, 전용 네트워크·DB/파일 볼륨·컨테이너 구성, 초기 관리자 생성, `/api/health` 확인을 진행합니다. 기본 사용자명은 `admin`이며 `--username`으로 바꿀 수 있습니다.

브라우저가 서버와 다른 PC에서 실행된다면 그 PC의 `localhost`로 접속할 수 없습니다. 서버의 TLS 도메인을 구성하거나 평가용 SSH 터널 등을 사용합니다.

예를 들어 공개 URL이 `http://localhost:4080`인 평가 설치에 원격으로 접속하려면, 로컬 PC의 4080이 비어 있는 상태에서 아래 터널을 연 뒤 그 PC의 브라우저로 `http://localhost:4080`에 접속할 수 있습니다. `user@portal-server`는 실제 SSH 계정·서버 주소로 바꿉니다.

```bash
ssh -L 4080:127.0.0.1:4080 user@portal-server
```

### 5.5 운영용 HTTPS 설치

로컬 평가 설치와 운영 설치는 처음 설치할 때 선택하는 대안입니다. 같은 상태 경로에 `install`을 반복 실행하지 않습니다.

DNS·인증서·같은 호스트의 TLS 역방향 프록시를 먼저 준비한 뒤, 운영 도메인을 지정합니다.

```bash
python3 installer/install.py install \
  --engine podman \
  --state-dir "$COMMUNITY_STATE_DIR" \
  --clouds "$COMMUNITY_CLOUD_FILE" \
  --cloud-name community \
  --service-project admin \
  --public-url https://portal.example.com \
  --trust-proxy
```

프록시는 `http://127.0.0.1:4080`으로 전달하고 원래 Host, HTTPS 전달 헤더와 WebSocket 업그레이드를 전달해야 합니다. 프록시가 다른 컨테이너/호스트에 있다면 `127.0.0.1`의 의미가 달라지므로 도달 경로·바인딩을 별도로 설계합니다. 인스톨러가 TLS 프록시를 생성하지는 않습니다.

포트를 4081로 바꾸는 예: `--port 4081`. HTTP 직접 접속 평가에서는 `--public-url http://localhost:4081`도 함께 맞춥니다. 기존 설치의 공개 URL·프록시 신뢰 변경은 상태·환경 설정을 함께 검토해야 하며, 아래의 단순 `update` 예시가 URL 이전을 자동 수행하지는 않습니다.

### 5.6 설치 확인과 최초 설정

```bash
python3 installer/install.py status --state-dir "$COMMUNITY_STATE_DIR"
curl --fail http://127.0.0.1:4080/api/health
cat "$COMMUNITY_STATE_DIR/initial-admin.txt"
```

헬스 응답에서 `ok: true`, `product: kiki-terminal-lab`, DB 연결 상태를 확인합니다. 관리자 비밀번호는 해당 파일에서 확인하고 로그인 후 변경합니다. 운영 도메인에서도 로그인과 새로고침, 세션 유지, WebSocket 연결을 확인합니다.

첫 설정 순서:

1. 관리자에서 서비스 프로젝트·이미지·Flavor·외부 네트워크·쿼터를 실제 OpenStack 값으로 설정합니다.
2. 테스트 사용자를 가입·승인하고 일반 사용자의 관리자 API 접근이 차단되는지 확인합니다.
3. 전용 프로젝트 생성·승인, VM 생성·조회, VNC/SSH, 볼륨·네트워크 작업, 자원 삭제를 시험합니다.
4. 사용할 SSO·OTP·메일·외부 서비스를 각각 설정하고 실제 연결을 확인합니다.
5. 공지·게시판 작성·관리자 알림과 교육·보드 HTTP 경로 및 강사 공유 WebSocket 차단을 확인합니다. 제한 관리자와 일반 사용자의 권한도 나누어 시험합니다.
6. 백업과 별도 검증 환경의 복원을 확인한 뒤 운영합니다.

## 6. SSO·OTP와 선택 기능 설정

SSO 설정은 관리자 → SSO 로그인에서 공급자별로 등록합니다. 예시 콜백:

```text
https://portal.example.com/api/auth/oauth/google/callback
https://portal.example.com/api/auth/oauth/kakao/callback
https://portal.example.com/api/auth/oauth/naver/callback
```

콜백은 앱의 공개 URL과 공급자에 등록한 URI가 일치해야 합니다. 기존 Terminal Lab의 OAuth 키는 포함하지 않습니다. OTP는 사용자가 등록을 완료할 수 있는지 먼저 확인한 뒤 정책을 적용합니다. 서버와 인증기 기기의 시간을 맞춥니다.

메일·Jenkins·레지스트리·LLM·Kubernetes 등은 연결 정보와 자격증명을 별도로 설정합니다. 사용하지 않는 서비스는 활성화하지 않아도 됩니다. VM 공개 도메인·외부 SSH/TCP는 DNS·프록시·방화벽과 VM 네트워크 경로를 함께 구성해야 하며, 설치 옵션만으로 외부 연결 전체가 완성되지는 않습니다.

## 7. 운영·업데이트·백업

```bash
python3 installer/install.py backup --state-dir "$COMMUNITY_STATE_DIR"
python3 installer/install.py stop --state-dir "$COMMUNITY_STATE_DIR"
python3 installer/install.py start --state-dir "$COMMUNITY_STATE_DIR"
python3 installer/install.py status --state-dir "$COMMUNITY_STATE_DIR"
```

업데이트는 새 버전 소스의 루트에서 같은 `--state-dir`을 지정합니다.

### 0.2.x Community에서 KIKI 0.3.0으로 이름 전환

새 설치의 ZIP·폴더·패키지 이름은 `kiki-terminal-lab`입니다. 기존 설치는 원래 `deployment.json`·`app.env`·`database.env`·`secrets/`가 들어 있는 **상태 경로를 그대로 지정**합니다. 아래 예시는 이전 문서의 기본 상태 경로를 사용하며, 실제 경로가 다르면 변경하세요.

```bash
cd kiki-terminal-lab
KIKI_STATE_DIR="$HOME/.local/state/terminal-lab-community"
python3 installer/install.py backup --state-dir "$KIKI_STATE_DIR"
python3 installer/install.py update --state-dir "$KIKI_STATE_DIR"
```

이전 설치에서 소스 폴더 아래 `runtime/deployment/`를 사용했다면 새 소스 폴더의 빈 경로를 지정하지 말고 **이전 폴더의 절대 상태 경로**를 지정합니다. 이름 변경만을 위해 상태·볼륨·키를 복사하거나 기존 설치에 `install`을 다시 실행하지 않습니다. 기존 `tl-community-*` 자원·서비스와 소유권 라벨은 유지되며, 새 설치만 `kiki-terminal-lab-*` 이름을 사용합니다. PostgreSQL DB/사용자·클라우드 별칭·`COMMUNITY_*` 환경변수·DB 마이그레이션 표식은 호환성을 위해 유지합니다. 기존 `clouds.yaml`과 앱 환경변수는 자동 덮어쓰지 않습니다.

0.1에서의 전환은 데이터 스키마 변경도 포함합니다. 실패 후 복구 조건은 [운영 안내](operations.md)를 따릅니다.

```bash
python3 installer/install.py update --state-dir "$COMMUNITY_STATE_DIR"
```

`backup`은 앱을 잠시 중지하고 DB와 업로드·템플릿 등의 파일 백업을 만든 뒤, 원래 실행 중이었다면 앱을 다시 시작합니다. `app.env`의 `SESSION_SECRET`·`CREDENTIAL_KEY`, `database.env`, `deployment.json`, `secrets/`도 보호된 별도 장소에 보관합니다. 복원·이전 버전 전환은 [운영·복구 문서](operations.md)를 따릅니다.

`uninstall`은 컨테이너를 제거하고 데이터 볼륨·키·설정·백업을 보존합니다. `resume`은 설치가 `prepared` 단계에서 실패했을 때 사용하며 키를 재생성하지 않습니다.

Podman 인스톨러는 상태 경로의 `systemd/`에 Quadlet 파일을 내보냅니다. 재부팅 자동 시작은 별도 구성입니다. 기존 CLI 컨테이너와 systemd가 같은 이름으로 동시에 관리하지 않도록 컨테이너 소유권 전환, 사용자 로그인 유지/linger, 시스템 부팅 후 접속을 검증합니다. 생성 파일은 상태 경로·키를 참조하므로 먼저 검토하며 [Quadlet 공식 문서](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)를 따릅니다.

## 8. 소스 직접 실행·개발

컨테이너 설치 대신 직접 실행할 때만 호스트에 Node.js 22.13 이상, npm, 별도 PostgreSQL을 준비합니다. 배포본에 맞춘 DB 기준은 PostgreSQL 17입니다. 네이티브 의존성이 있으므로 Linux에서 필요하면 Python·make·C++ 빌드 도구도 준비합니다. 컨테이너 이미지에 포함된 openssh-client·kubectl·skopeo 등의 기능을 직접 실행 환경에서 쓰려면 해당 도구도 별도 설치합니다.

```bash
npm ci
cp .env.example .env
```

`.env`에 전용 `DATABASE_URL`, 고유한 `SESSION_SECRET`과 64자리 16진수 `CREDENTIAL_KEY`, 고유한 `INITIAL_ADMIN_PASSWORD`, 정확한 `PUBLIC_URL`과 OpenStack 파일 경로를 설정합니다. 키 생성 예:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

첫 값은 새 설치의 `SESSION_SECRET`, 두 번째 값은 `CREDENTIAL_KEY`에 사용합니다. 기존 설치의 키를 바꾸는 명령이 아닙니다. 빈 DB의 초기 관리자 비밀번호는 12자 이상, UTF-8 기준 72바이트 이하로 설정합니다.

```bash
npm run db:migrate
npm run build
npm start
```

프런트 개발은 API를 실행한 상태에서 별도 터미널의 `npm run dev`를 사용합니다. 기본 개발 URL은 `http://localhost:5180`, API 프록시 대상은 `http://127.0.0.1:4080`입니다. API 포트를 변경하면 Vite 프록시도 맞춥니다. 인증·origin 검증이 필요한 흐름은 실제 브라우저 origin과 `PUBLIC_URL`을 일치시켜 확인합니다.

이 문서의 `.env`는 직접 실행용입니다. 인스톨러 배포는 상태 경로의 `app.env`를 사용합니다. 원본 Terminal Lab의 DB·환경파일을 연결하거나 복사해 사용하지 않습니다.

## 9. 자주 발생하는 문제

| 증상 | 확인할 내용 |
| --- | --- |
| `podman/docker is not available` | 호스트 엔진·CLI 설치, 같은 실행 사용자, `podman info` 또는 `docker info` |
| 주소/포트 사용 중 | 4080의 기존 서비스, 다른 `--port`와 공개 URL의 일치 |
| 원격 PC에서 localhost 접속 실패 | localhost가 서버를 가리키는지, TLS 프록시·DNS·터널 구성 |
| 이미지 빌드/다운로드 실패 | 인터넷·DNS·CA·저장공간·내부 미러·컨테이너 엔진 상태 |
| `prepared` 단계에서 설치 실패 | 원래 상태 경로·키를 보존하고 원인을 수정한 후 `resume` |
| DB가 준비되지 않음 | 상태 파일의 전용 DB 컨테이너·볼륨, 엔진 로그, 디스크 |
| HTTPS 로그인 후 세션 유지 실패 | `PUBLIC_URL`, 프록시 신뢰·HTTPS 전달 헤더, Secure 쿠키, 서버 시간 |
| OpenStack 인증 실패 | 지정 clouds 이름·사용자·비밀번호·프로젝트·도메인·CA·API 도달 경로 |
| 프로젝트/VM 생성 실패 | 정책·쿼터·이미지·Flavor·네트워크·스토리지와 실제 API 오류 |
| 터미널/VNC 연결 실패 | 앱 컨테이너에서 VM/콘솔로 가는 네트워크, SSH 키, 프록시 WebSocket 전달 |
| SSO 콜백 실패 | 공급자 설정의 URI와 앱 공개 URL·Client 정보 일치 |
| OTP 코드 오류 | 등록 상태와 서버·인증기 시간 |
| `/board` 또는 교육 API가 404 | 해당 기능은 이 배포본에서 제외한 정상 동작 |

엔진 로그를 확인할 때 컨테이너 이름은 상태 경로의 `deployment.json`에서 찾습니다. 로그·설정·초기 비밀번호·clouds.yaml을 공개 이슈에 그대로 첨부하지 않습니다.


## 네트워크 대역의 명시적 설정 (0.3.5)

새 프로젝트를 요청할 때 설치 환경에 맞는 서브넷 CIDR을 입력합니다. 기존 승인 프로젝트의 저장된 CIDR은 그대로 사용합니다. 선택 CAPO 클러스터를 생성하려면 앱 환경에 `CAPO_POD_CIDR`과 `CAPO_SERVICE_CIDR`을 지정합니다. MetalLB VIP 자동 할당을 사용하면 `METALLB_VIP_POOL_CIDR`도 지정합니다. 미설정 상태에서는 해당 자원 생성을 오류로 안내하며 임의 대역을 선택하지 않습니다. 이 값은 컨테이너 앱 환경에 전달해야 하며 기존 네트워크와 겹치지 않도록 설치자가 결정합니다.
