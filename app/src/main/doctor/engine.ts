export type DoctorConfidence = 'high' | 'medium' | 'low'

export interface DoctorEvidence {
  step?: string
  errorCode?: string
  logs?: string
  containerState?: {
    status?: string
    exitCode?: number
    health?: string
    oomKilled?: boolean
  }
  diskFreeMb?: number
  inodeFreePct?: number
  listenerPort?: number
  expectedPort?: number
  httpStatusByPath?: Record<string, number>
  dbError?: string
  requiredEnv?: string[]
  presentEnv?: string[]
  dnsStatus?: 'propagated' | 'pending' | 'wrong_target' | 'nxdomain' | 'error'
  externalProbe?: 'reachable' | 'unreachable'
  dockerAvailable?: boolean
  sshTransient?: boolean
  ufwState?: 'active' | 'inactive' | 'unknown' | 'not_checked'
}

export interface DoctorDiagnosis {
  code:
    | 'DISK_FULL'
    | 'RUNTIME_OOM'
    | 'PORT_MISMATCH'
    | 'HEALTHCHECK_PATH'
    | 'DATABASE_NOT_READY'
    | 'MISSING_ENV'
    | 'DEPENDENCY_LOCK'
    | 'RUNTIME_CRASH'
    | 'PORT_BLOCKED_EXTERNAL'
    | 'DNS_PUBLISH_FAILED'
    | 'DOCKER_UNAVAILABLE'
    | 'SSH_TRANSIENT'
    | 'UNKNOWN'
  title: string
  confidence: DoctorConfidence
  evidence: string[]
  fixId: string | null
  verifyProbe: string | null
  safeToAutoFix: boolean
  abstained: boolean
}

interface Rule {
  code: Exclude<DoctorDiagnosis['code'], 'UNKNOWN'>
  title: string
  confidence: DoctorConfidence
  fixId: string | null
  verifyProbe: string | null
  safeToAutoFix: boolean
  required: (evidence: DoctorEvidence) => boolean
  exclusions?: (evidence: DoctorEvidence) => boolean
  explain: (evidence: DoctorEvidence) => string[]
}

const RULES: Rule[] = [
  {
    code: 'DISK_FULL',
    title: 'VPS gần hết dung lượng đĩa hoặc inode',
    confidence: 'high',
    fixId: 'prune_owned_images',
    verifyProbe: 'disk_space',
    safeToAutoFix: false,
    required: (e) =>
      /no space left on device|enospc/i.test(e.logs ?? '') ||
      (e.diskFreeMb ?? Infinity) < 2048 ||
      (e.inodeFreePct ?? 100) < 5,
    explain: (e) => [
      `diskFreeMb=${e.diskFreeMb ?? 'unknown'}`,
      `inodeFreePct=${e.inodeFreePct ?? 'unknown'}`
    ]
  },
  {
    code: 'RUNTIME_OOM',
    title: 'Container bị kill vì thiếu bộ nhớ',
    confidence: 'high',
    fixId: null,
    verifyProbe: 'container_state',
    safeToAutoFix: false,
    required: (e) =>
      e.containerState?.oomKilled === true ||
      e.containerState?.exitCode === 137 ||
      /out of memory|oom-kill|oomkiller|kill(?:ed)? process \d+.*?(?:oom|out of memory)|fatal error.*?(?:allocation failed|out of memory)/i.test(
        e.logs ?? ''
      ),
    explain: (e) => [
      `exitCode=${e.containerState?.exitCode ?? 'unknown'}`,
      `oomKilled=${e.containerState?.oomKilled ?? 'unknown'}`,
      ...(/out of memory|oom/i.test(e.logs ?? '') ? ['logs indicate OOM'] : [])
    ]
  },
  {
    code: 'PORT_MISMATCH',
    title: 'App đang listen khác port trong BuildPlan',
    confidence: 'high',
    fixId: 'redeploy_correct_port',
    verifyProbe: 'external_http',
    safeToAutoFix: false,
    required: (e) =>
      (e.listenerPort !== undefined &&
        e.expectedPort !== undefined &&
        e.listenerPort !== e.expectedPort) ||
      Boolean(
        e.expectedPort !== undefined &&
        e.logs &&
        /listening on.*?(?:port|:)\s*(\d+)/i.test(e.logs) &&
        parseInt(e.logs.match(/listening on.*?(?:port|:)\s*(\d+)/i)![1], 10) !== e.expectedPort
      ),
    explain: (e) => [
      `listenerPort=${e.listenerPort ?? 'detected from logs'}`,
      `expectedPort=${e.expectedPort}`
    ]
  },
  {
    code: 'HEALTHCHECK_PATH',
    title: 'Healthcheck path không đúng với ứng dụng',
    confidence: 'high',
    fixId: 'update_healthcheck_path',
    verifyProbe: 'internal_http',
    safeToAutoFix: false,
    required: (e) => e.httpStatusByPath?.['/health'] === 404 && e.httpStatusByPath?.['/'] === 200,
    explain: () => ['/health trả 404 nhưng / trả 200']
  },
  {
    code: 'DATABASE_NOT_READY',
    title: 'Database chưa sẵn sàng hoặc không kết nối được',
    confidence: 'high',
    fixId: 'restart_database_service',
    verifyProbe: 'database_health',
    safeToAutoFix: false,
    required: (e) =>
      /ECONNREFUSED:5432|database.*(not ready|unavailable)|connection refused/i.test(
        e.dbError ?? e.logs ?? ''
      ),
    explain: (e) => [redactText(e.dbError ?? e.logs ?? 'Database connection error')]
  },
  {
    code: 'MISSING_ENV',
    title: 'Thiếu biến môi trường bắt buộc',
    confidence: 'high',
    fixId: 'open_missing_env_form',
    verifyProbe: null,
    safeToAutoFix: false,
    required: (e) => (e.requiredEnv ?? []).some((key) => !(e.presentEnv ?? []).includes(key)),
    explain: (e) => [
      `missing=${(e.requiredEnv ?? []).filter((key) => !(e.presentEnv ?? []).includes(key)).join(', ')}`
    ]
  },
  {
    code: 'DEPENDENCY_LOCK',
    title: 'Lockfile không khớp dependency',
    confidence: 'high',
    fixId: null,
    verifyProbe: null,
    safeToAutoFix: false,
    required: (e) => /npm ci|lockfile|ERESOLVE|integrity checksum/i.test(e.logs ?? ''),
    explain: (e) => [redactText(e.logs ?? 'Dependency installation failed')]
  },
  {
    code: 'RUNTIME_CRASH',
    title: 'Ứng dụng crash hoặc restart liên tục',
    confidence: 'medium',
    fixId: null,
    verifyProbe: 'container_state',
    safeToAutoFix: false,
    required: (e) =>
      e.containerState?.status === 'exited' ||
      /crashloop|uncaughtException|fatal error|process\.exit|Segmentation fault|SIGSEGV|ReferenceError|SyntaxError|TypeError/i.test(
        e.logs ?? ''
      ),
    exclusions: (e) =>
      e.containerState?.oomKilled === true ||
      e.containerState?.exitCode === 137 ||
      /out of memory|oom-kill/i.test(e.logs ?? ''),
    explain: (e) => [redactText((e.logs ?? '').split('\n').slice(-3).join('\n'))]
  },
  {
    code: 'PORT_BLOCKED_EXTERNAL',
    title: 'App healthy nội bộ nhưng bị chặn từ Internet',
    confidence: 'high',
    fixId: 'reconcile_firewall',
    verifyProbe: 'external_http',
    safeToAutoFix: true,
    required: (e) =>
      (e.externalProbe === 'unreachable' && e.containerState?.status === 'running') ||
      (e.ufwState === 'active' && e.externalProbe === 'unreachable'),
    explain: (e) => [
      'container đang running',
      `external probe=${e.externalProbe ?? 'unreachable'}`,
      ...(e.ufwState ? [`ufwState=${e.ufwState}`] : [])
    ]
  },
  {
    code: 'DNS_PUBLISH_FAILED',
    title: 'DNS chưa trỏ đúng hoặc chưa propagation',
    confidence: 'high',
    fixId: 'reconcile_dns',
    verifyProbe: 'https_hostname',
    safeToAutoFix: false,
    required: (e) => e.dnsStatus !== undefined && e.dnsStatus !== 'propagated',
    explain: (e) => [`dnsStatus=${e.dnsStatus}`]
  },
  {
    code: 'DOCKER_UNAVAILABLE',
    title: 'Docker daemon không khả dụng',
    confidence: 'high',
    fixId: 'restart_docker',
    verifyProbe: 'docker_version',
    safeToAutoFix: false,
    required: (e) =>
      e.dockerAvailable === false || /docker daemon.*(down|not running)/i.test(e.logs ?? ''),
    explain: () => ['docker command hoặc daemon không khả dụng']
  },
  {
    code: 'SSH_TRANSIENT',
    title: 'Kết nối SSH tạm thời không ổn định',
    confidence: 'medium',
    fixId: 'retry_with_backoff',
    verifyProbe: 'ssh_command',
    safeToAutoFix: false,
    required: (e) =>
      e.sshTransient === true || /connection reset|timeout|handshake/i.test(e.logs ?? ''),
    explain: () => ['SSH error thuộc nhóm retryable']
  }
]

export function diagnose(evidence: DoctorEvidence): DoctorDiagnosis {
  const matches = RULES.filter((rule) => rule.required(evidence) && !rule.exclusions?.(evidence))
  if (matches.length === 0) {
    return {
      code: 'UNKNOWN',
      title: 'Chưa đủ bằng chứng để kết luận nguyên nhân',
      confidence: 'low',
      evidence: [],
      fixId: null,
      verifyProbe: null,
      safeToAutoFix: false,
      abstained: true
    }
  }

  // Nhiều rule khớp nghĩa là evidence chưa đủ phân biệt. Chỉ auto-fix khi có duy nhất một rule.
  const selected = matches[0]
  const ambiguous = matches.length > 1
  return {
    code: selected.code,
    title: ambiguous ? `Có nhiều khả năng: ${selected.title}` : selected.title,
    confidence: ambiguous ? 'low' : selected.confidence,
    evidence: selected.explain(evidence),
    fixId: ambiguous ? null : selected.fixId,
    verifyProbe: ambiguous ? null : selected.verifyProbe,
    safeToAutoFix: !ambiguous && selected.safeToAutoFix,
    abstained: ambiguous
  }
}

/** Redact secret-like values trước khi ghi Doctor evidence/support bundle. */
export function redactText(value: string): string {
  return value
    .replace(
      /(password|token|secret|api[_-]?key|private[_-]?key|access[_-]?token|auth[_-]?token)\s*([=:])\s*[^\s'";&]+/gi,
      '$1$2***'
    )
    .replace(/Authorization:\s*\*\*\*\s+[A-Za-z0-9._~+/=-]+/gi, 'Authorization: Bearer ***')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
}

export function redactEvidence(evidence: DoctorEvidence): DoctorEvidence {
  return {
    ...evidence,
    logs: evidence.logs ? redactText(evidence.logs) : undefined,
    dbError: evidence.dbError ? redactText(evidence.dbError) : undefined
  }
}
