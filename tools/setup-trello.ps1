[CmdletBinding()]
param(
  [string]$BoardUrl,
  [string]$PartnerUsername,
  [string]$PartnerEmail,
  [switch]$PlanOnly,
  [switch]$SyncExisting
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoUrl = 'https://github.com/everestt2806/opspilot'

function Get-Emoji([int]$CodePoint) {
  return [char]::ConvertFromUtf32($CodePoint)
}

function Read-SecretText([string]$Prompt) {
  $secureValue = Read-Host -Prompt $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)

  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Get-BoardReference([string]$Value) {
  $match = [regex]::Match($Value, 'trello\.com/b/([^/?#]+)', 'IgnoreCase')
  if ($match.Success) {
    return $match.Groups[1].Value
  }

  if ($Value -match '^[A-Za-z0-9]+$') {
    return $Value
  }

  throw 'Board URL khong hop le. Can URL dang https://trello.com/b/xxxx/opspilot-delivery.'
}

function Invoke-TrelloApi {
  param(
    [ValidateSet('GET', 'POST', 'PUT')]
    [string]$Method,
    [string]$Path,
    [hashtable]$Body
  )

  $request = @{
    Uri = "https://api.trello.com/1/$Path"
    Method = $Method
    Headers = $script:TrelloHeaders
    ErrorAction = 'Stop'
  }

  if ($null -ne $Body) {
    $request.Body = $Body
    $request.ContentType = 'application/x-www-form-urlencoded; charset=utf-8'
  }

  try {
    return Invoke-RestMethod @request
  } catch {
    throw "Trello API $Method /$Path that bai: $($_.Exception.Message)"
  }
}

function ConvertTo-TrelloObjectArray {
  param(
    [AllowNull()]
    [object]$Value,
    [string[]]$RequiredProperties = @('id')
  )

  if ($null -eq $Value) {
    return
  }

  foreach ($candidate in $Value) {
    # Windows PowerShell 5.1 can keep a JSON array returned by
    # Invoke-RestMethod as one nested pipeline object. Flatten it explicitly.
    if ($candidate -is [System.Array]) {
      ConvertTo-TrelloObjectArray -Value $candidate -RequiredProperties $RequiredProperties
      continue
    }

    $hasRequiredProperties = $true
    foreach ($propertyName in $RequiredProperties) {
      if ($null -eq $candidate.PSObject.Properties[$propertyName]) {
        $hasRequiredProperties = $false
        break
      }
    }

    if ($hasRequiredProperties) {
      Write-Output $candidate
    }
  }
}

function New-CardDescription([pscustomobject]$Card) {
  $lines = @(
    "Owner: $($Card.Owner)",
    "Deadline: $($Card.DueLabel)",
    "Branch: $($Card.Branch)",
    "Repo: $repoUrl",
    '',
    'Muc tieu:',
    $Card.Goal
  )

  if ($Card.Scope.Count -gt 0) {
    $lines += ''
    $lines += 'Duoc sua:'
    $lines += @($Card.Scope | ForEach-Object { "- $_" })
  }

  if ($Card.Avoid.Count -gt 0) {
    $lines += ''
    $lines += 'Khong sua trong task nay:'
    $lines += @($Card.Avoid | ForEach-Object { "- $_" })
  }

  $lines += ''
  $lines += 'Quy trinh: Keo sang DANG LAM -> tao branch -> mo PR -> dan link PR -> CHO REVIEW -> merge moi HOAN THANH.'
  return $lines -join [Environment]::NewLine
}

$emojiInbox = Get-Emoji 0x1F4E5
$emojiCalendar = Get-Emoji 0x1F4C5
$emojiHammer = Get-Emoji 0x1F528
$emojiEyes = Get-Emoji 0x1F440
$emojiBlocked = Get-Emoji 0x1F6AB
$emojiDone = Get-Emoji 0x2705
$emojiFlag = Get-Emoji 0x1F3C1
$emojiPin = Get-Emoji 0x1F4CC

$listSpecs = @(
  [pscustomobject]@{ Key = 'Backlog'; Name = "$emojiInbox BACKLOG" },
  [pscustomobject]@{ Key = 'ThisWeek'; Name = "$emojiCalendar TUAN NAY" },
  [pscustomobject]@{ Key = 'Doing'; Name = "$emojiHammer DANG LAM" },
  [pscustomobject]@{ Key = 'Review'; Name = "$emojiEyes CHO REVIEW" },
  [pscustomobject]@{ Key = 'Blocked'; Name = "$emojiBlocked BLOCKED" },
  [pscustomobject]@{ Key = 'Done'; Name = "$emojiDone HOAN THANH" }
)

$labelSpecs = @(
  [pscustomobject]@{ Key = 'A'; Name = 'A - Core/Algorithms'; PreviousNames = @('A - App/Infra'); Color = 'blue' },
  [pscustomobject]@{ Key = 'B'; Name = 'B - UI/Delivery'; PreviousNames = @('B - ML/Monitoring'); Color = 'purple' },
  [pscustomobject]@{ Key = 'Shared'; Name = 'Shared'; Color = 'orange' },
  [pscustomobject]@{ Key = 'Contract'; Name = 'Contract - ca hai duyet'; Color = 'red' },
  [pscustomobject]@{ Key = 'P0'; Name = 'P0 - chan tien do'; Color = 'red' },
  [pscustomobject]@{ Key = 'P1'; Name = 'P1 - quan trong'; Color = 'yellow' },
  [pscustomobject]@{ Key = 'P2'; Name = 'P2 - co the lui'; Color = 'black' }
)

$cards = @(
  [pscustomobject]@{
    Title = "$emojiPin QUY TAC LAM VIEC"; ListKey = 'Backlog'; Owner = 'Both'; Due = $null; DueLabel = 'Khong co'
    Branch = 'Moi task mot branch'; Labels = @('Shared'); Goal = 'Giu mot nguon tien do duy nhat tren Trello va mot nguon code tren GitHub.'
    Scope = @('Trello card', 'GitHub branch/PR'); Avoid = @('Khong dua secret vao card', 'Khong danh Done chi vi da push')
    Done = @('Moi nguoi toi da 1 card DANG LAM', 'Co PR moi sang CHO REVIEW', 'Merge main + test pass moi HOAN THANH', 'Vuong qua 30 phut thi sang BLOCKED')
  },
  [pscustomobject]@{
    Title = "$emojiFlag W1 - Foundation - 10/08-21/08"; PreviousTitles = @("$emojiFlag W1 - Foundation - 10/08-16/08"); ListKey = 'ThisWeek'; Owner = 'Both'; Due = '2026-08-21T23:00:00+07:00'; DueLabel = '21/08/2026'
    Branch = 'Khong ap dung'; Labels = @('Shared', 'P0'); Goal = 'Dat gate W1: SSH, credential, collector va demo app co the test doc lap.'
    Scope = @('Tat ca task W1'); Avoid = @('Khong keo feature W2 vao W1')
    Done = @('App va ML service chay bang mot lenh', 'pnpm try:ssh chay docker --version tren VPS', 'VPS List hien online/RAM/disk', '3 demo app chay Docker local', 'Review cheo va smoke test main')
  },
  [pscustomobject]@{
    Title = "$emojiFlag W2 - Vertical Slice - 22/08-28/08"; PreviousTitles = @("$emojiFlag W2 - Vertical Slice - 17/08-23/08"); ListKey = 'Backlog'; Owner = 'Both'; Due = '2026-08-28T23:00:00+07:00'; DueLabel = '28/08/2026'
    Branch = 'Khong ap dung'; Labels = @('Shared', 'P1'); Goal = 'Express detect -> build VPS -> app chay -> metric dung contract; ML API test doc lap.'
    Scope = @('M3', 'M4 PRECHECK-BUILD', 'M5', 'M7'); Avoid = @('Khong polish UI ngoai Deploy Log khung')
    Done = @('3 detector Tier 1 qua test', 'Express build tren VPS', 'metrics.jsonl dung contract', '4 ML method chay du lieu gia')
  },
  [pscustomobject]@{
    Title = "$emojiFlag W3 - Deploy + Data - 29/08-04/09"; PreviousTitles = @("$emojiFlag W3 - Deploy + Data - 24/08-30/08"); ListKey = 'Backlog'; Owner = 'Both'; Due = '2026-09-04T23:00:00+07:00'; DueLabel = '04/09/2026'
    Branch = 'Khong ap dung'; Labels = @('Shared', 'P1'); Goal = 'Deploy 3 app tu UI va thay metric/score that tren dashboard.'
    Scope = @('M4', 'M6', 'Dashboard v1'); Avoid = @('Khong lam migrate')
    Done = @('Deploy Next/Express/Vite tu UI', 'Metric that vao SQLite', 'Moi sample co 5 score_sample', 'Doi threshold lam alert thay doi')
  },
  [pscustomobject]@{
    Title = "$emojiFlag W4 - MVP 66.7% - 05/09-11/09"; PreviousTitles = @("$emojiFlag W4 - MVP 66.7% - 31/08-06/09"); ListKey = 'Backlog'; Owner = 'Both'; Due = '2026-09-11T23:00:00+07:00'; DueLabel = '11/09/2026'
    Branch = 'Khong ap dung'; Labels = @('Shared', 'P0'); Goal = 'Dat MVP 16/24 FR voi rollback, alert va reconnect.'
    Scope = @('Gate W4'); Avoid = @('Khong them feature ngoai gate')
    Done = @('Smoke UC-01/02/03/04/06/08', 'Rollback dung v(N-1)', 'Fault tao alert va gan nhan', 'Mat SSH roi nap bu khong trung')
  },
  [pscustomobject]@{
    Title = '[Shared] Chot 7 quyet dinh kien truc'; ListKey = 'ThisWeek'; Owner = 'Both'; Due = '2026-08-11T23:00:00+07:00'; DueLabel = '11/08/2026'
    Branch = 'docs/architecture-decisions'; Labels = @('Shared', 'Contract', 'P0'); Goal = 'Tra loi 7 muc readiness trong docs/17 va ghi quyet dinh duoc chap nhan.'
    Scope = @('docs/17-luu-y-kien-truc-va-kha-thi.md', 'DECISIONS.md', 'docs/contracts/** neu ca hai duyet'); Avoid = @('Khong code module sau khi contract con mo')
    Done = @('Chot lifecycle deployment', 'Chot release artifact', 'Chot http_error_rate', 'Chot migrate VERIFY fail', 'Chot attempt_index', 'Chot SSH fingerprint', 'Cap nhat contract + DECISIONS.md')
  },
  [pscustomobject]@{
    Title = '[Shared][Infra] Dung va kiem tra 2 VPS'; ListKey = 'ThisWeek'; Owner = 'A'; Due = '2026-08-15T23:00:00+07:00'; DueLabel = '15/08/2026'
    Branch = 'Khong can code'; Labels = @('A', 'Shared', 'P0'); Goal = 'Hai VPS Ubuntu 24.04 SSH duoc, cung provider/goi/region, snapshot sach.'
    Scope = @('docs/08-vps-setup.md', 'Tai khoan provider'); Avoid = @('Khong ghi IP/password/private key vao Git/Trello')
    Done = @('Tao user deploy', 'SSH key hoat dong', 'Docker hoat dong', '/opt/opspilot ghi duoc', 'Snapshot sach ca 2 VPS')
  },
  [pscustomobject]@{
    Title = '[Shared] Review cheo va smoke gate W1'; ListKey = 'ThisWeek'; Owner = 'Both'; Due = '2026-08-21T23:00:00+07:00'; DueLabel = '21/08/2026'
    Branch = 'Khong ap dung'; Labels = @('Shared', 'P0'); Goal = 'Merge phan A/B, review cheo va xac nhan gate W1 tren main.'
    Scope = @('PR W1', 'docs/smoke-log.md', 'docs/04-timeline.md'); Avoid = @('Khong merge code khong giai thich duoc')
    Done = @('A review PR cua B', 'B review PR cua A', 'Typecheck/lint/test pass', 'Smoke SSH + collector pass', 'Cap nhat cot Thuc te')
  },
  [pscustomobject]@{
    Title = '[A][DB] Repository CRUD VPS + typed IPC'; ListKey = 'ThisWeek'; Owner = 'A'; Due = '2026-08-11T23:00:00+07:00'; DueLabel = '11/08/2026'
    Branch = 'feat/m01-vps-crud'; Labels = @('A', 'P1'); Goal = 'Tao/list/update/delete VPS trong SQLite va goi qua typed IPC.'
    Scope = @('app/src/main/db/**', 'app/src/main/ipc.ts', 'app/src/renderer/src/pages/VpsPage.tsx'); Avoid = @('collector/**', 'ml-service/**', 'docs/contracts/** tru khi co card Contract')
    Done = @('CRUD dung schema', 'Unit test DB/repository', 'IPC tra ApiResult', 'Khong log credential', 'pnpm typecheck + test pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[A][UI] Khung VPS List noi du lieu that'; ListKey = 'ThisWeek'; Owner = 'A'; Due = '2026-08-11T23:00:00+07:00'; DueLabel = '11/08/2026'
    Branch = 'feat/m10-vps-list'; Labels = @('A', 'P1'); Goal = 'VPS List doc SQLite/IPC, co loading, empty va error state.'
    Scope = @('app/src/renderer/src/pages/VpsPage.tsx', 'app/src/renderer/src/components/**'); Avoid = @('collector/**', 'ml-service/**')
    Done = @('List du lieu that', 'Loading/empty/error state', 'Khong truy cap Node tu renderer', 'Typecheck pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[A][M2] Credential encrypt/decrypt + tamper test'; ListKey = 'ThisWeek'; Owner = 'A'; Due = '2026-08-15T23:00:00+07:00'; DueLabel = '15/08/2026'
    Branch = 'feat/m02-credential'; Labels = @('A', 'P0'); Goal = 'Boc Electron safeStorage theo contract va test ciphertext bi sua.'
    Scope = @('app/src/main/crypto/**', 'app/src/main/ipc.ts', 'app/src/main/db/** neu can'); Avoid = @('Khong tu viet AES neu chua co decision', 'Khong log plaintext/private key')
    Done = @('Encrypt/decrypt dung interface', 'Tamper test throw', 'Secret khong vao log', 'Unit test pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[A][M1] SSH connect/exec + timeout/reconnect'; ListKey = 'ThisWeek'; Owner = 'A'; Due = '2026-08-17T23:00:00+07:00'; DueLabel = '17/08/2026'
    Branch = 'feat/m01-ssh-connect-exec'; Labels = @('A', 'P0'); Goal = 'Pool 1 connection/VPS, exec streaming, phan loai loi va reconnect backoff.'
    Scope = @('app/src/main/ssh/**', 'app/scripts/try-ssh.ts'); Avoid = @('collector/**', 'ml-service/**', 'UI ngoai IPC toi thieu')
    Done = @('connect/exec dung interface', 'AUTH_FAILED/TIMEOUT/HOST_UNREACHABLE', 'Timeout huy command', 'Reconnect 1s/2s/4s toi da 3', 'try:ssh chay docker --version')
  },
  [pscustomobject]@{
    Title = '[A][M1] uploadDir/readFileTail + resource check'; ListKey = 'ThisWeek'; Owner = 'A'; Due = '2026-08-19T23:00:00+07:00'; DueLabel = '19/08/2026'
    Branch = 'feat/m01-ssh-files-resource'; Labels = @('A', 'P0'); Goal = 'Upload tar stream, tail theo byte va kiem tra Docker/RAM/disk tren VPS.'
    Scope = @('app/src/main/ssh/**', 'app/scripts/try-ssh.ts'); Avoid = @('Khong sua metric format cua B', 'Khong noi UI truoc khi CLI pass')
    Done = @('uploadDir exclude dung', 'readFile/readFileTail dung nextByte', 'shellQuote input', 'Docker/resource check', 'A doc duoc metrics.jsonl cua B')
  },
  [pscustomobject]@{
    Title = '[B][M5] Collector scaffold + metric contract test'; ListKey = 'ThisWeek'; Owner = 'B'; Due = '2026-08-15T23:00:00+07:00'; DueLabel = '15/08/2026'
    Branch = 'feat/m05-collector-scaffold'; Labels = @('B', 'P0'); Goal = 'Tao khung collector va test mot MetricSample dung metric-format.md.'
    Scope = @('collector/**', 'docs/contracts/metric-format.md chi doc'); Avoid = @('app/src/main/**', 'docs/contracts/**')
    Done = @('collect.py co config interval', 'MetricSample dung field/type', 'Timestamp/seq hop le', 'pytest pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[B][M12] Ba demo app chay Docker local'; ListKey = 'ThisWeek'; Owner = 'B'; Due = '2026-08-16T23:00:00+07:00'; DueLabel = '16/08/2026'
    Branch = 'feat/m12-demo-apps'; Labels = @('B', 'P1'); Goal = 'Next blog, Express API va Vite SPA co Dockerfile va health endpoint local.'
    Scope = @('demo-apps/**'); Avoid = @('app/src/main/**', 'collector/** ngoai config demo')
    Done = @('3 app build image', '3 container start', 'Health endpoint 200', 'README lenh tai hien', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[B][Fixture] Generator metric gia dung contract'; PreviousTitles = @('[B][M7] Generator metric gia dung contract'); ListKey = 'ThisWeek'; Owner = 'B'; Due = '2026-08-17T23:00:00+07:00'; DueLabel = '17/08/2026'
    Branch = 'feat/m07-fake-metrics'; Labels = @('B', 'P1'); Goal = 'Sinh metrics.jsonl baseline/anomaly de ML va poller test doc lap.'
    Scope = @('experiments/fixtures/**', 'experiments/tests/**'); Avoid = @('app/src/main/**', 'ml-service/**', 'docs/contracts/**')
    Done = @('Seq tang dan', 'Timestamp hop le', 'Null metric dung contract', 'Co baseline va anomaly', 'Test format pass')
  },
  [pscustomobject]@{
    Title = '[B][M5] Docker stats + HTTP probe local'; ListKey = 'ThisWeek'; Owner = 'B'; Due = '2026-08-18T23:00:00+07:00'; DueLabel = '18/08/2026'
    Branch = 'feat/m05-collector-probes'; Labels = @('B', 'P0'); Goal = 'Collector doc docker stats va probe app local voi timeout 5s.'
    Scope = @('collector/**'); Avoid = @('app/src/main/**', 'ml-service/models/**')
    Done = @('Parse CPU/memory', 'Probe latency/status', 'Timeout -> container_up=0', 'Test bang demo Express', 'pytest pass')
  },
  [pscustomobject]@{
    Title = '[B][M5] Ghi metrics.jsonl + latest.json'; ListKey = 'ThisWeek'; Owner = 'B'; Due = '2026-08-19T23:00:00+07:00'; DueLabel = '19/08/2026'
    Branch = 'feat/m05-collector-output'; Labels = @('B', 'P0'); Goal = 'Append JSONL va atomic replace latest.json dung contract.'
    Scope = @('collector/**'); Avoid = @('app/src/main/monitor/**', 'docs/contracts/**')
    Done = @('Append 1 dong moi sample', 'latest.json atomic', 'Seq khong reset', 'Khong mat dong khi restart', 'pytest pass')
  },
  [pscustomobject]@{
    Title = '[B][M5] Chay collector Docker tren VPS'; ListKey = 'ThisWeek'; Owner = 'B'; Due = '2026-08-20T23:00:00+07:00'; DueLabel = '20/08/2026'
    Branch = 'feat/m05-collector-docker'; Labels = @('B', 'P0'); Goal = 'Dong goi collector va thu metric that tren VPS.'
    Scope = @('collector/**', 'templates/** neu can mount'); Avoid = @('app/src/main/ssh/**', 'Khong mo port metric')
    Done = @('python:3.12-alpine', 'Docker socket read-only', 'metrics.jsonl co metric that', 'latest.json hop le', 'A doc duoc file qua SSH')
  },
  [pscustomobject]@{
    Title = '[A][M7] ML skeleton test + lenh tai hien'; PreviousTitles = @('[B][M7] ML skeleton test + lenh tai hien'); ListKey = 'ThisWeek'; Owner = 'A'; Due = '2026-08-21T23:00:00+07:00'; DueLabel = '21/08/2026'
    Branch = 'feat/m07-ml-skeleton-tests'; Labels = @('A', 'P1'); Goal = 'Mo rong test health/config/features skeleton va ghi lenh tai hien.'
    Scope = @('ml-service/**'); Avoid = @('app/src/renderer/**', 'Khong doi OpenAPI')
    Done = @('pytest pass', 'health version dung', 'Config deterministic random_state=42', 'README lenh tai hien', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[B][UI] VPS connection + resource states bang typed mock'; ListKey = 'ThisWeek'; Owner = 'B'; Due = '2026-08-21T23:00:00+07:00'; DueLabel = '21/08/2026'
    Branch = 'feat/m10-vps-connection-ui'; Labels = @('B', 'P0'); Goal = 'Dung UI test SSH/Docker va CPU/RAM/disk bang fixture cung type, sau do noi handler that.'
    Scope = @('app/src/renderer/**'); Avoid = @('app/src/main/**', 'app/src/shared/**', 'docs/contracts/**')
    Done = @('Loading/empty/success/error', 'Fixture satisfies typed IPC', 'Khong import Node/Electron', 'Noi window.api.invoke sau PR A', 'Typecheck + component test pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[A][M3] Detector 3 Tier 1 + unit test'; ListKey = 'Backlog'; Owner = 'A'; Due = '2026-08-23T23:00:00+07:00'; DueLabel = '23/08/2026'
    Branch = 'feat/m03-tier1-detectors'; Labels = @('A', 'P0'); Goal = 'Detect Next.js, Express va static SPA dung contract, kem bang chung tung dau hieu.'
    Scope = @('app/src/main/detectors/**'); Avoid = @('app/src/renderer/**', 'docs/contracts/**')
    Done = @('3 detector dung interface', 'Moi detector >=4 case', 'Ket qua co evidence', 'pnpm test + typecheck pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[B][UI] Deploy Wizard shell bang typed mock'; ListKey = 'Backlog'; Owner = 'B'; Due = '2026-08-24T23:00:00+07:00'; DueLabel = '24/08/2026'
    Branch = 'feat/m10-deploy-wizard-ui'; Labels = @('B', 'P1'); Goal = 'Dung wizard chon source, detection, env va precheck bang typed fixture.'
    Scope = @('app/src/renderer/**'); Avoid = @('app/src/main/**', 'app/src/shared/**')
    Done = @('Du 4 buoc va validation', 'Loading/success/error', 'Fixture satisfies contract', 'Khong import Node/Electron', 'Typecheck + component test pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[A][M4] PRECHECK-UPLOAD-RENDER-BUILD Express'; ListKey = 'Backlog'; Owner = 'A'; Due = '2026-08-26T23:00:00+07:00'; DueLabel = '26/08/2026'
    Branch = 'feat/m04-deploy-build'; Labels = @('A', 'P0'); Goal = 'Chay lat cat Express tu precheck den build image tren VPS bang CLI.'
    Scope = @('app/src/main/deploy/**', 'templates/**', 'app/scripts/**'); Avoid = @('app/src/renderer/**', 'collector/**')
    Done = @('State machine PRECHECK-BUILD', 'Event dung contract', 'Fail ghi dung step', 'CLI build Express tren VPS', 'Test + typecheck pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[B][UI] Deploy Log stepper + xterm bang event gia'; ListKey = 'Backlog'; Owner = 'B'; Due = '2026-08-26T23:00:00+07:00'; DueLabel = '26/08/2026'
    Branch = 'feat/m10-deploy-log-ui'; Labels = @('B', 'P1'); Goal = 'Hien stepper va log ANSI tu chuoi deploy event gia dung contract.'
    Scope = @('app/src/renderer/**'); Avoid = @('app/src/main/**', 'docs/contracts/**')
    Done = @('Stepper 7 buoc', 'Log stream/scroll/search', 'Running/success/fail state', 'Fixture dung event contract', 'Typecheck + test pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[A][M7] Train-ingest-replay + 4 methods'; ListKey = 'Backlog'; Owner = 'A'; Due = '2026-08-28T23:00:00+07:00'; DueLabel = '28/08/2026'
    Branch = 'feat/m07-ml-methods'; Labels = @('A', 'P0'); Goal = 'Feature pipeline va API train/ingest/replay chay rule, zscore-EWMA, IForest, OCSVM va ensemble.'
    Scope = @('ml-service/**'); Avoid = @('app/src/renderer/**', 'experiments/**')
    Done = @('API dung OpenAPI', 'random_state=42', 'Replay khong side effect', 'Test du lieu gia pass', '4 method + ensemble co score', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[A][M4] DEPLOY-HEALTHCHECK-RECORD + release'; ListKey = 'Backlog'; Owner = 'A'; Due = '2026-09-01T23:00:00+07:00'; DueLabel = '01/09/2026'
    Branch = 'feat/m04-deploy-record'; Labels = @('A', 'P0'); Goal = 'Hoan tat deploy, healthcheck, record va release artifact theo lifecycle da chot.'
    Scope = @('app/src/main/deploy/**', 'templates/**'); Avoid = @('app/src/renderer/**')
    Done = @('Deploy Express thanh cong', 'Healthcheck timeout dung', 'Deployment/release record dung schema', 'Fail giu log/audit', 'Test + smoke pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[B][UI] Noi Deploy Wizard vao IPC that'; ListKey = 'Backlog'; Owner = 'B'; Due = '2026-09-01T23:00:00+07:00'; DueLabel = '01/09/2026'
    Branch = 'feat/m10-deploy-integration'; Labels = @('B', 'P0'); Goal = 'Thay fixture bang typed IPC/event that va giu du cac state UI.'
    Scope = @('app/src/renderer/**'); Avoid = @('app/src/main/**', 'docs/contracts/**')
    Done = @('Khong con mock o production path', 'Deploy Express tu UI', 'Log event real-time', 'Error theo failed step', 'Typecheck + smoke pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[A][M6] Poller + rule + metric-score IPC'; ListKey = 'Backlog'; Owner = 'A'; Due = '2026-09-04T23:00:00+07:00'; DueLabel = '04/09/2026'
    Branch = 'feat/m06-monitor-poller'; Labels = @('A', 'P0'); Goal = 'Tail metric, dedupe, ghi SQLite, goi ML va phat metric/score/alert typed event.'
    Scope = @('app/src/main/monitor/**', 'app/src/main/ipc.ts', 'app/src/main/db/**'); Avoid = @('app/src/renderer/**', 'collector/**')
    Done = @('Offset/seq khong trung', 'Metric vao SQLite', '5 score moi sample', 'Rule threshold tao alert', 'Test + typecheck pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[B][UI] Dashboard charts + score panel'; ListKey = 'Backlog'; Owner = 'B'; Due = '2026-09-04T23:00:00+07:00'; DueLabel = '04/09/2026'
    Branch = 'feat/m10-dashboard'; Labels = @('B', 'P0'); Goal = 'Dashboard hien metric, score 5 phuong phap va alert tu typed fixture/IPC.'
    Scope = @('app/src/renderer/**'); Avoid = @('app/src/main/**', 'ml-service/**')
    Done = @('Chart metric that', 'Panel 5 method', 'Loading/empty/error', 'Responsive o 1280x800', 'Typecheck + test pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[B][UI] Versions + History + rollback controls'; ListKey = 'Backlog'; Owner = 'B'; Due = '2026-09-07T23:00:00+07:00'; DueLabel = '07/09/2026'
    Branch = 'feat/m10-versions-history'; Labels = @('B', 'P1'); Goal = 'Hien deployment/release history va thao tac rollback co confirm/error state.'
    Scope = @('app/src/renderer/**'); Avoid = @('app/src/main/**')
    Done = @('Timeline/version list', 'Rollback confirm', 'Loading/empty/error', 'Dung typed IPC', 'Typecheck + test pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[A][M4] Redeploy + rollback + retry'; ListKey = 'Backlog'; Owner = 'A'; Due = '2026-09-08T23:00:00+07:00'; DueLabel = '08/09/2026'
    Branch = 'feat/m04-redeploy-rollback'; Labels = @('A', 'P0'); Goal = 'Redeploy tao version moi, rollback dung v(N-1), retry giu audit va release artifact.'
    Scope = @('app/src/main/deploy/**', 'app/src/main/db/**'); Avoid = @('app/src/renderer/**')
    Done = @('Redeploy/rollback CLI pass', 'Version/attempt dung', 'Retry khong mat audit', 'Test nhanh failure branch', 'Smoke VPS pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[B][UI] Alert feedback + action states'; ListKey = 'Backlog'; Owner = 'B'; Due = '2026-09-09T23:00:00+07:00'; DueLabel = '09/09/2026'
    Branch = 'feat/m10-alert-feedback'; Labels = @('B', 'P1'); Goal = 'Hien alert, 5 score va nut danh dau dung/sai voi optimistic/error state an toan.'
    Scope = @('app/src/renderer/**'); Avoid = @('app/src/main/**', 'ml-service/**')
    Done = @('Alert detail ro method/score', 'Dung/sai co confirm state', 'Loi khong mat lua chon', 'Dung typed IPC', 'Typecheck + test pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[A][Integration] Alert lifecycle + reconnect dedupe'; ListKey = 'Backlog'; Owner = 'A'; Due = '2026-09-10T23:00:00+07:00'; DueLabel = '10/09/2026'
    Branch = 'feat/m06-alert-reconnect'; Labels = @('A', 'P0'); Goal = 'Hoan tat feedback/action log va nap bu metric khong trung sau khi mat SSH.'
    Scope = @('app/src/main/monitor/**', 'app/src/main/ipc.ts', 'app/src/main/db/**'); Avoid = @('app/src/renderer/**')
    Done = @('Alert lifecycle dung schema', 'Feedback/action log luu du', 'Reconnect nap bu khong trung', 'Test disconnect/retry pass', 'Smoke VPS pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[B][QA] MVP smoke evidence + demo script'; ListKey = 'Backlog'; Owner = 'B'; Due = '2026-09-11T23:00:00+07:00'; DueLabel = '11/09/2026'
    Branch = 'docs/mvp-smoke-evidence'; Labels = @('B', 'Shared', 'P0'); Goal = 'Chay smoke UC-01/02/03/04/06/08 tren main va luu bang chung demo da che secret.'
    Scope = @('docs/smoke-log.md', 'docs/04-timeline.md', 'anh/video Drive duoc link'); Avoid = @('Khong sua core de lam test pass', 'Khong commit secret/IP kem credential')
    Done = @('16/24 FR co bang chung', 'Lenh tai hien ro', 'Anh/video da che secret', 'Bug co card rieng', 'A review ket qua', 'Mo PR va dan link')
  }
)

if ($PlanOnly) {
  $normalizationFixture = ,@(
    [pscustomobject]@{ id = 'one'; name = 'One' },
    [pscustomobject]@{ id = 'two'; name = 'Two' }
  )
  $normalizedFixture = @(ConvertTo-TrelloObjectArray -Value $normalizationFixture -RequiredProperties @('id', 'name'))
  if ($normalizedFixture.Count -ne 2) {
    throw 'Kiem tra chuan hoa Trello response that bai.'
  }

  $duplicateTitles = @($cards | Group-Object Title | Where-Object { $_.Count -gt 1 })
  if ($duplicateTitles.Count -gt 0) {
    throw "Card title bi trung: $(@($duplicateTitles.Name) -join ', ')"
  }

  $knownListKeys = @($listSpecs.Key)
  $knownLabelKeys = @($labelSpecs.Key)
  foreach ($card in $cards) {
    if ($card.ListKey -notin $knownListKeys) {
      throw "ListKey khong ton tai tren card $($card.Title): $($card.ListKey)"
    }
    foreach ($labelKey in $card.Labels) {
      if ($labelKey -notin $knownLabelKeys) {
        throw "Label key khong ton tai tren card $($card.Title): $labelKey"
      }
    }
  }

  $completedBeforePause = @(
    '[Shared] Chot 7 quyet dinh kien truc',
    '[A][DB] Repository CRUD VPS + typed IPC',
    '[A][UI] Khung VPS List noi du lieu that'
  )
  $resumeAt = [DateTimeOffset]::Parse('2026-08-15T00:00:00+07:00')
  $invalidEarlyCards = @(
    $cards | Where-Object {
      $null -ne $_.Due -and
      [DateTimeOffset]::Parse($_.Due) -lt $resumeAt -and
      $_.Title -notin $completedBeforePause
    }
  )
  if ($invalidEarlyCards.Count -gt 0) {
    throw "Card chua hoan thanh co deadline truoc 15/08: $(@($invalidEarlyCards.Title) -join ', ')"
  }

  Write-Host "Lists: $($listSpecs.Count); labels: $($labelSpecs.Count); cards: $($cards.Count)"
  Write-Host 'Response normalization: pass'
  Write-Host 'Pause deadline guard: pass'
  Write-Host "Sync existing: $($SyncExisting.IsPresent)"
  $cards | Select-Object Title, ListKey, Owner, DueLabel | Format-Table -AutoSize
  exit 0
}

if ([string]::IsNullOrWhiteSpace($BoardUrl)) {
  $BoardUrl = Read-Host 'Dan link board Trello private'
}

$boardReference = Get-BoardReference $BoardUrl
$apiKey = Read-SecretText 'Nhap Trello API key (se khong hien tren man hinh)'
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  throw 'API key khong duoc de trong.'
}

$encodedKey = [Uri]::EscapeDataString($apiKey)
$authorizeUrl = "https://trello.com/1/authorize?expiration=1day&scope=read,write&response_type=token&key=$encodedKey&name=OpsPilot%20Board%20Setup"
Write-Host 'Trinh duyet se mo trang Trello. Bam Allow, sau do copy token ve terminal nay.' -ForegroundColor Cyan
Start-Process $authorizeUrl
$apiToken = Read-SecretText 'Nhap token Trello 1 ngay (se khong hien tren man hinh)'
if ([string]::IsNullOrWhiteSpace($apiToken)) {
  throw 'API token khong duoc de trong.'
}

$script:TrelloHeaders = @{
  Accept = 'application/json'
  Authorization = "OAuth oauth_consumer_key=`"$apiKey`", oauth_token=`"$apiToken`""
}

try {
  $currentMember = Invoke-TrelloApi -Method GET -Path 'members/me?fields=id,username,fullName'
  $board = Invoke-TrelloApi -Method GET -Path "boards/$boardReference"

  if ($board.prefs.permissionLevel -eq 'public') {
    throw 'Board dang PUBLIC. Hay doi Visibility thanh Private hoac Workspace roi chay lai.'
  }

  Write-Host "Board: $($board.name)" -ForegroundColor Green
  Write-Host "Owner API: $($currentMember.fullName) (@$($currentMember.username))"

  $membersResponse = Invoke-TrelloApi -Method GET -Path "boards/$($board.id)/members?fields=id,username,fullName"
  $members = @(ConvertTo-TrelloObjectArray -Value $membersResponse -RequiredProperties @('id', 'username', 'fullName'))
  $partner = $null
  if (-not [string]::IsNullOrWhiteSpace($PartnerUsername)) {
    $partner = $members | Where-Object { $_.username -eq $PartnerUsername } | Select-Object -First 1
  } else {
    $otherMembers = @($members | Where-Object { $_.id -ne $currentMember.id })
    if ($otherMembers.Count -eq 1) {
      $partner = $otherMembers[0]
    }
  }

  if ($null -eq $partner -and -not [string]::IsNullOrWhiteSpace($PartnerEmail)) {
    $encodedPartnerEmail = [Uri]::EscapeDataString($PartnerEmail)
    try {
      $null = Invoke-TrelloApi -Method PUT -Path "boards/$($board.id)/members?email=$encodedPartnerEmail&type=normal" -Body @{ fullName = $PartnerEmail }
      Write-Host 'Da gui/dong bo loi moi nguoi B vao board.'
      $membersResponse = Invoke-TrelloApi -Method GET -Path "boards/$($board.id)/members?fields=id,username,fullName"
      $members = @(ConvertTo-TrelloObjectArray -Value $membersResponse -RequiredProperties @('id', 'username', 'fullName'))
      $otherMembers = @($members | Where-Object { $_.id -ne $currentMember.id })
      if ($otherMembers.Count -eq 1) {
        $partner = $otherMembers[0]
      }
    } catch {
      Write-Warning "Chua moi/assign duoc B qua email: $($_.Exception.Message)"
    } finally {
      $encodedPartnerEmail = $null
    }
  }

  if ($null -eq $partner) {
    Write-Warning 'Khong xac dinh duoc nguoi B. Card B se duoc tao nhung chua assign. Moi B vao board va assign thu cong.'
  } else {
    Write-Host "Nguoi B: $($partner.fullName) (@$($partner.username))"
  }

  $listsResponse = Invoke-TrelloApi -Method GET -Path "boards/$($board.id)/lists?filter=open&fields=id,name,pos"
  $existingLists = @(ConvertTo-TrelloObjectArray -Value $listsResponse -RequiredProperties @('id', 'name'))
  $listIds = @{}
  for ($index = 0; $index -lt $listSpecs.Count; $index++) {
    $spec = $listSpecs[$index]
    $existing = $existingLists | Where-Object { $_.name -eq $spec.Name } | Select-Object -First 1
    if ($null -eq $existing) {
      $existing = Invoke-TrelloApi -Method POST -Path "boards/$($board.id)/lists" -Body @{ name = $spec.Name; pos = 'bottom' }
      Write-Host "Created list: $($spec.Name)"
    }

    $null = Invoke-TrelloApi -Method PUT -Path "lists/$($existing.id)" -Body @{ pos = (($index + 1) * 16384) }
    $listIds[$spec.Key] = $existing.id
  }

  $desiredListNames = @($listSpecs | ForEach-Object { $_.Name })
  $extraLists = @($existingLists | Where-Object { $_.name -notin $desiredListNames })
  if ($extraLists.Count -gt 0) {
    $extraListNames = @($extraLists | ForEach-Object { $_.name })
    Write-Warning "Cac list co san duoc giu nguyen: $($extraListNames -join ', '). Co the archive thu cong neu khong dung."
  }

  $labelsResponse = Invoke-TrelloApi -Method GET -Path "boards/$($board.id)/labels?fields=id,name,color&limit=1000"
  $existingLabels = @(ConvertTo-TrelloObjectArray -Value $labelsResponse -RequiredProperties @('id', 'name'))
  $labelIds = @{}
  foreach ($spec in $labelSpecs) {
    $existing = $existingLabels | Where-Object { $_.name -eq $spec.Name } | Select-Object -First 1
    if ($null -eq $existing -and $SyncExisting -and $null -ne $spec.PSObject.Properties['PreviousNames']) {
      $previousNames = @($spec.PreviousNames)
      $existing = $existingLabels | Where-Object { $_.name -in $previousNames } | Select-Object -First 1
      if ($null -ne $existing) {
        $existing = Invoke-TrelloApi -Method PUT -Path "labels/$($existing.id)" -Body @{ name = $spec.Name; color = $spec.Color }
        Write-Host "Renamed label: $($spec.Name)" -ForegroundColor Green
      }
    }
    if ($null -eq $existing) {
      $existing = Invoke-TrelloApi -Method POST -Path "boards/$($board.id)/labels" -Body @{ name = $spec.Name; color = $spec.Color }
      Write-Host "Created label: $($spec.Name)"
    } elseif ($SyncExisting -and ($existing.name -ne $spec.Name -or $existing.color -ne $spec.Color)) {
      $existing = Invoke-TrelloApi -Method PUT -Path "labels/$($existing.id)" -Body @{ name = $spec.Name; color = $spec.Color }
      Write-Host "Updated label: $($spec.Name)" -ForegroundColor Green
    }
    $labelIds[$spec.Key] = $existing.id
  }

  $cardsResponse = Invoke-TrelloApi -Method GET -Path "boards/$($board.id)/cards/open?fields=id,name,idList,idMembers,idLabels,due,desc"
  $existingCards = @(ConvertTo-TrelloObjectArray -Value $cardsResponse -RequiredProperties @('id', 'name'))
  $createdCount = 0
  $skippedCount = 0
  $updatedCount = 0

  foreach ($card in $cards) {
    $existingCard = $existingCards | Where-Object { $_.name -eq $card.Title } | Select-Object -First 1
    if ($null -eq $existingCard -and $SyncExisting -and $null -ne $card.PSObject.Properties['PreviousTitles']) {
      $previousTitles = @($card.PreviousTitles)
      $existingCard = $existingCards | Where-Object { $_.name -in $previousTitles } | Select-Object -First 1
    }

    $memberIds = @()
    if ($card.Owner -in @('A', 'Both')) {
      $memberIds += $currentMember.id
    }
    if ($card.Owner -in @('B', 'Both') -and $null -ne $partner) {
      $memberIds += $partner.id
    }

    $cardLabelIds = @($card.Labels | ForEach-Object { $labelIds[$_] })
    if ($null -ne $existingCard) {
      if (-not $SyncExisting) {
        Write-Host "Skipped existing card: $($card.Title)"
        $skippedCount++
        continue
      }

      $managedLabelIds = @($labelIds.Values)
      $preservedLabelIds = @($existingCard.idLabels | Where-Object { $_ -notin $managedLabelIds })
      $updatedLabelIds = @($preservedLabelIds + $cardLabelIds | Select-Object -Unique)
      $updateBody = @{
        name = $card.Title
        desc = New-CardDescription $card
        idLabels = $updatedLabelIds -join ','
      }
      if ($memberIds.Count -gt 0) {
        $updateBody.idMembers = $memberIds -join ','
      }
      if ($null -ne $card.Due) {
        $updateBody.due = $card.Due
        $updateBody.dueReminder = 1440
      }

      $null = Invoke-TrelloApi -Method PUT -Path "cards/$($existingCard.id)" -Body $updateBody
      Write-Host "Updated existing card: $($card.Title)" -ForegroundColor Green
      $updatedCount++
      continue
    }

    $body = @{
      idList = $listIds[$card.ListKey]
      name = $card.Title
      desc = New-CardDescription $card
      idLabels = $cardLabelIds -join ','
      pos = 'bottom'
    }
    if ($memberIds.Count -gt 0) {
      $body.idMembers = $memberIds -join ','
    }
    if ($null -ne $card.Due) {
      $body.due = $card.Due
      $body.dueReminder = 1440
    }

    $newCard = Invoke-TrelloApi -Method POST -Path 'cards' -Body $body
    $checklist = Invoke-TrelloApi -Method POST -Path "cards/$($newCard.id)/checklists" -Body @{ name = 'Definition of Done'; pos = 'bottom' }
    foreach ($item in $card.Done) {
      $null = Invoke-TrelloApi -Method POST -Path "checklists/$($checklist.id)/checkItems" -Body @{ name = $item; pos = 'bottom'; checked = 'false' }
    }

    Write-Host "Created card: $($card.Title)" -ForegroundColor Green
    $createdCount++
  }

  Write-Host ''
  Write-Host "Trello setup xong: $($board.url)" -ForegroundColor Green
  Write-Host "Created $createdCount card(s); updated $updatedCount card(s); skipped $skippedCount existing card(s)."
  Write-Host 'Token 1 ngay chi ton tai trong bo nho cua terminal nay.'
} finally {
  $apiToken = $null
  $apiKey = $null
  $encodedKey = $null
  $authorizeUrl = $null
  $PartnerEmail = $null
  $script:TrelloHeaders = $null
}
