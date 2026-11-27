import { z } from 'zod'
import type { VpsRuntimePreparation } from '@shared/ipc'
import type { VpsRepository } from '../db/vpsRepository'
import type { VpsService } from './service'
import type { SshManager, SshVerifiedConnectionIdentity } from '../ssh/manager'
import { AppError } from '../errors'

/** Main-owned fixed program. Never accept shell paths or commands from the renderer. */
export const PREPARE_RUNTIME_COMMAND = `set -eu
installed=0
if ! command -v docker >/dev/null 2>&1; then
  [ "$(id -u)" = 0 ] || exit 41
  . /etc/os-release
  [ "$ID" = ubuntu ] || exit 49
  case "$VERSION_CODENAME" in jammy|noble) ;; *) exit 49 ;; esac
  for package in docker.io docker-compose docker-compose-v2 podman-docker containerd runc; do
    status="$(dpkg-query -W -f='\${Status}' "$package" 2>/dev/null || true)"
    [ "$status" != 'install ok installed' ] || exit 51
  done
  export DEBIAN_FRONTEND=noninteractive
  apt-get update >&2 || exit 43
  apt-get install -y --no-install-recommends ca-certificates curl >&2 || exit 44
  if [ ! -e /etc/apt/sources.list.d/docker.sources ] && [ ! -e /etc/apt/sources.list.d/docker.list ] && [ ! -e /etc/apt/sources.list.d/opspilot-docker.sources ]; then
    [ ! -L /etc/apt/keyrings ] && [ ! -L /etc/apt/sources.list.d ] || exit 50
    install -d -m 0755 /etc/apt/keyrings
    [ ! -L /etc/apt/keyrings/opspilot-docker.asc ] || exit 50
    key="$(mktemp)" || exit 43
    trap 'rm -f -- "$key"' EXIT HUP INT TERM
    curl -fsSL --connect-timeout 15 --max-time 90 https://download.docker.com/linux/ubuntu/gpg -o "$key" || exit 43
    if [ -e /etc/apt/keyrings/opspilot-docker.asc ]; then
      cmp -s "$key" /etc/apt/keyrings/opspilot-docker.asc || exit 50
    else
      install -m 0644 "$key" /etc/apt/keyrings/opspilot-docker.asc
    fi
    architecture="$(dpkg --print-architecture)"
    case "$architecture" in amd64|arm64) ;; *) exit 49 ;; esac
    (set -C; printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/opspilot-docker.asc\n' "$VERSION_CODENAME" "$architecture" > /etc/apt/sources.list.d/opspilot-docker.sources) || exit 50
    rm -f -- "$key"
    trap - EXIT HUP INT TERM
  fi
  apt-get update >&2 || exit 43
  version="$(apt-cache madison docker-ce | awk '$3 ~ /^5:29[.]/ {print $3; exit}')"
  [ -n "$version" ] || exit 44
  apt-get install -y --no-install-recommends "docker-ce=$version" "docker-ce-cli=$version" containerd.io docker-buildx-plugin docker-compose-plugin >&2 || exit 44
  installed=1
fi
docker_version="$(docker --version)" || exit 45
docker info --format '{{.ServerVersion}}' >/dev/null 2>&1 || exit 46
compose_version="$(docker compose version --short 2>/dev/null)" || exit 47
[ ! -L /opt ] && [ ! -L /opt/opspilot ] || exit 48
if [ -e /opt/opspilot ] && [ ! -d /opt/opspilot ]; then exit 48; fi
mkdir -p -m 0755 -- /opt/opspilot || exit 48
probe="$(mktemp /opt/opspilot/.opspilot-ready.XXXXXXXX)" || exit 48
rm -f -- "$probe" || exit 48
printf 'DOCKER_VERSION=%s\nCOMPOSE_VERSION=%s\nINSTALLED_DOCKER=%s\n' "$docker_version" "$compose_version" "$installed"
`

const messages: Record<number, string> = {
  41: 'Cần quyền root để OpsPilot cài Docker. Sửa tài khoản kết nối rồi thử lại.',
  42: 'VPS chưa có curl để tải bộ cài Docker. Cần bổ sung curl trên máy chủ.',
  43: 'VPS chưa tải được bộ cài Docker. Kiểm tra Internet của máy chủ rồi thử lại.',
  44: 'Cài Docker chưa hoàn tất. Kiểm tra máy chủ có tác vụ cài đặt khác đang chạy rồi thử lại.',
  45: 'Docker đã có nhưng chưa chạy được. OpsPilot giữ nguyên bản cài hiện tại.',
  46: 'Chưa truy cập được dịch vụ Docker. Kiểm tra dịch vụ và quyền tài khoản SSH.',
  47: 'Docker đã có nhưng thiếu Compose. Cần bổ sung Compose plugin; OpsPilot giữ nguyên Docker đang phục vụ ứng dụng.',
  48: 'Chưa tạo được thư mục triển khai. Kiểm tra quyền ghi và đường dẫn /opt/opspilot.',
  49: 'Bản Linux này chưa hỗ trợ cài Docker tự động. Có thể kết nối VPS đã có Docker và Compose.',
  50: 'Cấu hình kho cài Docker cần được kiểm tra. OpsPilot giữ nguyên các tệp đã có.',
  51: 'VPS đang có runtime hoặc gói Docker khác. Cần kiểm tra tương thích trước khi cài thêm Docker.'
}

export class VpsRuntimePreparationService {
  private readonly active = new Map<
    number,
    { identity: string; promise: Promise<VpsRuntimePreparation> }
  >()

  constructor(
    private readonly ssh: Pick<SshManager, 'execWithHostIdentity'>,
    private readonly repository: Pick<VpsRepository, 'getById'>,
    private readonly service: Pick<VpsService, 'recordDockerInstalled'>
  ) {}

  prepare(raw: { vps_id: number; consent: true }): Promise<VpsRuntimePreparation> {
    const parsed = z
      .strictObject({ vps_id: z.number().int().positive(), consent: z.literal(true) })
      .safeParse(raw)
    if (!parsed.success)
      throw new AppError('VALIDATION', 'Xác nhận máy chủ cần chuẩn bị rồi thử lại.')
    const vps = this.repository.getById(parsed.data.vps_id)
    if (!vps.host_fingerprint)
      throw new AppError('VALIDATION', 'Kết nối và lưu lại VPS trước khi chuẩn bị triển khai.')
    const identity: SshVerifiedConnectionIdentity = {
      vpsId: vps.id,
      host: vps.host,
      port: vps.port,
      hostFingerprint: vps.host_fingerprint,
      username: vps.username,
      authType: vps.auth_type
    }
    const snapshot = JSON.stringify(identity)
    const previous = this.active.get(vps.id)
    if (previous) {
      if (previous.identity !== snapshot)
        throw new AppError(
          'VALIDATION',
          'Thông tin VPS đã đổi trong lúc chuẩn bị. Chờ tác vụ hiện tại kết thúc rồi kiểm tra lại.'
        )
      return previous.promise
    }
    const promise = this.run(identity).finally(() => {
      if (this.active.get(vps.id)?.promise === promise) this.active.delete(vps.id)
    })
    this.active.set(vps.id, { identity: snapshot, promise })
    return promise
  }

  private async run(identity: SshVerifiedConnectionIdentity): Promise<VpsRuntimePreparation> {
    const { result } = await this.ssh.execWithHostIdentity(
      identity.vpsId,
      PREPARE_RUNTIME_COMMAND,
      {
        timeoutMs: 660_000,
        retryOnReconnect: false,
        logCommand: false,
        maxStdoutBytes: 4096,
        maxStderrBytes: 1024 * 1024
      },
      identity
    )
    if (result.code !== 0)
      throw new AppError(
        'DOCKER_MISSING',
        messages[result.code] ?? 'Chưa chuẩn bị xong VPS. Kiểm tra trạng thái máy chủ rồi thử lại.',
        { cause: new Error('VPS_PREPARATION_' + result.code) }
      )
    const values = result.stdout.trim().split('\n')
    if (
      values.length !== 3 ||
      !/^DOCKER_VERSION=Docker version [^\r\n]{1,100}$/.test(values[0]) ||
      !/^COMPOSE_VERSION=v?\d[^\r\n]{0,99}$/.test(values[1]) ||
      !/^INSTALLED_DOCKER=[01]$/.test(values[2])
    ) {
      throw new AppError(
        'VALIDATION',
        'Kết quả chuẩn bị VPS chưa hợp lệ. Kiểm tra máy chủ rồi thử lại.'
      )
    }
    const current = this.repository.getById(identity.vpsId)
    if (
      current.host !== identity.host ||
      current.port !== identity.port ||
      current.host_fingerprint !== identity.hostFingerprint ||
      current.username !== identity.username ||
      current.auth_type !== identity.authType
    ) {
      throw new AppError(
        'VALIDATION',
        'Thông tin kết nối VPS vừa thay đổi. Kiểm tra lại máy chủ trước khi tiếp tục.'
      )
    }
    const dockerVersion = values[0].slice('DOCKER_VERSION=Docker version '.length)
    this.service.recordDockerInstalled(identity.vpsId, dockerVersion)
    return {
      vps_id: identity.vpsId,
      docker_version: dockerVersion,
      compose_version: values[1].slice('COMPOSE_VERSION='.length),
      installed_docker: values[2].endsWith('1'),
      workdir_ready: true,
      checked_at: new Date().toISOString()
    }
  }
}
