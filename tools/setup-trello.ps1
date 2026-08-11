[CmdletBinding()]
param(
  [string]$BoardUrl,
  [string]$PartnerUsername,
  [string]$PartnerEmail,
  [switch]$PlanOnly
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
  [pscustomobject]@{ Key = 'A'; Name = 'A - App/Infra'; Color = 'blue' },
  [pscustomobject]@{ Key = 'B'; Name = 'B - ML/Monitoring'; Color = 'purple' },
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
    Title = "$emojiFlag W1 - Foundation - 10/08-16/08"; ListKey = 'ThisWeek'; Owner = 'Both'; Due = '2026-08-16T23:00:00+07:00'; DueLabel = '16/08/2026'
    Branch = 'Khong ap dung'; Labels = @('Shared', 'P0'); Goal = 'Dat gate W1: SSH, credential, collector va demo app co the test doc lap.'
    Scope = @('Tat ca task W1'); Avoid = @('Khong keo feature W2 vao W1')
    Done = @('App va ML service chay bang mot lenh', 'pnpm try:ssh chay docker --version tren VPS', 'VPS List hien online/RAM/disk', '3 demo app chay Docker local', 'Review cheo va smoke test main')
  },
  [pscustomobject]@{
    Title = "$emojiFlag W2 - Vertical Slice - 17/08-23/08"; ListKey = 'Backlog'; Owner = 'Both'; Due = '2026-08-23T23:00:00+07:00'; DueLabel = '23/08/2026'
    Branch = 'Khong ap dung'; Labels = @('Shared', 'P1'); Goal = 'Express detect -> build VPS -> app chay -> metric dung contract; ML API test doc lap.'
    Scope = @('M3', 'M4 PRECHECK-BUILD', 'M5', 'M7'); Avoid = @('Khong polish UI ngoai Deploy Log khung')
    Done = @('3 detector Tier 1 qua test', 'Express build tren VPS', 'metrics.jsonl dung contract', '4 ML method chay du lieu gia')
  },
  [pscustomobject]@{
    Title = "$emojiFlag W3 - Deploy + Data - 24/08-30/08"; ListKey = 'Backlog'; Owner = 'Both'; Due = '2026-08-30T23:00:00+07:00'; DueLabel = '30/08/2026'
    Branch = 'Khong ap dung'; Labels = @('Shared', 'P1'); Goal = 'Deploy 3 app tu UI va thay metric/score that tren dashboard.'
    Scope = @('M4', 'M6', 'Dashboard v1'); Avoid = @('Khong lam migrate')
    Done = @('Deploy Next/Express/Vite tu UI', 'Metric that vao SQLite', 'Moi sample co 5 score_sample', 'Doi threshold lam alert thay doi')
  },
  [pscustomobject]@{
    Title = "$emojiFlag W4 - MVP 66.7% - 31/08-06/09"; ListKey = 'Backlog'; Owner = 'Both'; Due = '2026-09-06T23:00:00+07:00'; DueLabel = '06/09/2026'
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
    Title = '[Shared][Infra] Dung va kiem tra 2 VPS'; ListKey = 'ThisWeek'; Owner = 'A'; Due = '2026-08-12T23:00:00+07:00'; DueLabel = '12/08/2026'
    Branch = 'Khong can code'; Labels = @('A', 'Shared', 'P0'); Goal = 'Hai VPS Ubuntu 24.04 SSH duoc, cung provider/goi/region, snapshot sach.'
    Scope = @('docs/08-vps-setup.md', 'Tai khoan provider'); Avoid = @('Khong ghi IP/password/private key vao Git/Trello')
    Done = @('Tao user deploy', 'SSH key hoat dong', 'Docker hoat dong', '/opt/opspilot ghi duoc', 'Snapshot sach ca 2 VPS')
  },
  [pscustomobject]@{
    Title = '[Shared] Review cheo va smoke gate W1'; ListKey = 'ThisWeek'; Owner = 'Both'; Due = '2026-08-15T23:00:00+07:00'; DueLabel = '15/08/2026'
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
    Title = '[A][UI] Khung VPS List noi du lieu that'; ListKey = 'ThisWeek'; Owner = 'A'; Due = '2026-08-15T23:00:00+07:00'; DueLabel = '15/08/2026'
    Branch = 'feat/m10-vps-list'; Labels = @('A', 'P1'); Goal = 'VPS List doc SQLite/IPC, co loading, empty va error state.'
    Scope = @('app/src/renderer/src/pages/VpsPage.tsx', 'app/src/renderer/src/components/**'); Avoid = @('collector/**', 'ml-service/**')
    Done = @('List du lieu that', 'Loading/empty/error state', 'Khong truy cap Node tu renderer', 'Typecheck pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[A][M2] Credential encrypt/decrypt + tamper test'; ListKey = 'ThisWeek'; Owner = 'A'; Due = '2026-08-12T23:00:00+07:00'; DueLabel = '12/08/2026'
    Branch = 'feat/m02-credential'; Labels = @('A', 'P0'); Goal = 'Boc Electron safeStorage theo contract va test ciphertext bi sua.'
    Scope = @('app/src/main/crypto/**', 'app/src/main/ipc.ts', 'app/src/main/db/** neu can'); Avoid = @('Khong tu viet AES neu chua co decision', 'Khong log plaintext/private key')
    Done = @('Encrypt/decrypt dung interface', 'Tamper test throw', 'Secret khong vao log', 'Unit test pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[A][M1] SSH connect/exec + timeout/reconnect'; ListKey = 'ThisWeek'; Owner = 'A'; Due = '2026-08-13T23:00:00+07:00'; DueLabel = '13/08/2026'
    Branch = 'feat/m01-ssh-connect-exec'; Labels = @('A', 'P0'); Goal = 'Pool 1 connection/VPS, exec streaming, phan loai loi va reconnect backoff.'
    Scope = @('app/src/main/ssh/**', 'app/scripts/try-ssh.ts'); Avoid = @('collector/**', 'ml-service/**', 'UI ngoai IPC toi thieu')
    Done = @('connect/exec dung interface', 'AUTH_FAILED/TIMEOUT/HOST_UNREACHABLE', 'Timeout huy command', 'Reconnect 1s/2s/4s toi da 3', 'try:ssh chay docker --version')
  },
  [pscustomobject]@{
    Title = '[A][M1] uploadDir/readFileTail + resource check'; ListKey = 'ThisWeek'; Owner = 'A'; Due = '2026-08-14T23:00:00+07:00'; DueLabel = '14/08/2026'
    Branch = 'feat/m01-ssh-files-resource'; Labels = @('A', 'P0'); Goal = 'Upload tar stream, tail theo byte va kiem tra Docker/RAM/disk tren VPS.'
    Scope = @('app/src/main/ssh/**', 'app/scripts/try-ssh.ts'); Avoid = @('Khong sua metric format cua B', 'Khong noi UI truoc khi CLI pass')
    Done = @('uploadDir exclude dung', 'readFile/readFileTail dung nextByte', 'shellQuote input', 'Docker/resource check', 'A doc duoc metrics.jsonl cua B')
  },
  [pscustomobject]@{
    Title = '[B][M5] Collector scaffold + metric contract test'; ListKey = 'ThisWeek'; Owner = 'B'; Due = '2026-08-11T23:00:00+07:00'; DueLabel = '11/08/2026'
    Branch = 'feat/m05-collector-scaffold'; Labels = @('B', 'P0'); Goal = 'Tao khung collector va test mot MetricSample dung metric-format.md.'
    Scope = @('collector/**', 'docs/contracts/metric-format.md chi doc'); Avoid = @('app/src/main/**', 'docs/contracts/**')
    Done = @('collect.py co config interval', 'MetricSample dung field/type', 'Timestamp/seq hop le', 'pytest pass', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[B][M12] Ba demo app chay Docker local'; ListKey = 'ThisWeek'; Owner = 'B'; Due = '2026-08-11T23:00:00+07:00'; DueLabel = '11/08/2026'
    Branch = 'feat/m12-demo-apps'; Labels = @('B', 'P1'); Goal = 'Next blog, Express API va Vite SPA co Dockerfile va health endpoint local.'
    Scope = @('demo-apps/**'); Avoid = @('app/src/main/**', 'collector/** ngoai config demo')
    Done = @('3 app build image', '3 container start', 'Health endpoint 200', 'README lenh tai hien', 'Mo PR va dan link')
  },
  [pscustomobject]@{
    Title = '[B][M7] Generator metric gia dung contract'; ListKey = 'ThisWeek'; Owner = 'B'; Due = '2026-08-11T23:00:00+07:00'; DueLabel = '11/08/2026'
    Branch = 'feat/m07-fake-metrics'; Labels = @('B', 'P1'); Goal = 'Sinh metrics.jsonl baseline/anomaly de ML va poller test doc lap.'
    Scope = @('ml-service/scripts/**', 'ml-service/tests/**'); Avoid = @('app/src/main/**', 'docs/contracts/**')
    Done = @('Seq tang dan', 'Timestamp hop le', 'Null metric dung contract', 'Co baseline va anomaly', 'Test format pass')
  },
  [pscustomobject]@{
    Title = '[B][M5] Docker stats + HTTP probe local'; ListKey = 'ThisWeek'; Owner = 'B'; Due = '2026-08-12T23:00:00+07:00'; DueLabel = '12/08/2026'
    Branch = 'feat/m05-collector-probes'; Labels = @('B', 'P0'); Goal = 'Collector doc docker stats va probe app local voi timeout 5s.'
    Scope = @('collector/**'); Avoid = @('app/src/main/**', 'ml-service/models/**')
    Done = @('Parse CPU/memory', 'Probe latency/status', 'Timeout -> container_up=0', 'Test bang demo Express', 'pytest pass')
  },
  [pscustomobject]@{
    Title = '[B][M5] Ghi metrics.jsonl + latest.json'; ListKey = 'ThisWeek'; Owner = 'B'; Due = '2026-08-13T23:00:00+07:00'; DueLabel = '13/08/2026'
    Branch = 'feat/m05-collector-output'; Labels = @('B', 'P0'); Goal = 'Append JSONL va atomic replace latest.json dung contract.'
    Scope = @('collector/**'); Avoid = @('app/src/main/monitor/**', 'docs/contracts/**')
    Done = @('Append 1 dong moi sample', 'latest.json atomic', 'Seq khong reset', 'Khong mat dong khi restart', 'pytest pass')
  },
  [pscustomobject]@{
    Title = '[B][M5] Chay collector Docker tren VPS'; ListKey = 'ThisWeek'; Owner = 'B'; Due = '2026-08-14T23:00:00+07:00'; DueLabel = '14/08/2026'
    Branch = 'feat/m05-collector-docker'; Labels = @('B', 'P0'); Goal = 'Dong goi collector va thu metric that tren VPS.'
    Scope = @('collector/**', 'templates/** neu can mount'); Avoid = @('app/src/main/ssh/**', 'Khong mo port metric')
    Done = @('python:3.12-alpine', 'Docker socket read-only', 'metrics.jsonl co metric that', 'latest.json hop le', 'A doc duoc file qua SSH')
  },
  [pscustomobject]@{
    Title = '[B][M7] ML skeleton test + lenh tai hien'; ListKey = 'ThisWeek'; Owner = 'B'; Due = '2026-08-15T23:00:00+07:00'; DueLabel = '15/08/2026'
    Branch = 'feat/m07-ml-skeleton-tests'; Labels = @('B', 'P1'); Goal = 'Mo rong test health/config/features skeleton va ghi lenh tai hien.'
    Scope = @('ml-service/**'); Avoid = @('app/src/main/**', 'Khong doi OpenAPI')
    Done = @('pytest pass', 'health version dung', 'Config deterministic random_state=42', 'README lenh tai hien', 'Mo PR va dan link')
  }
)

if ($PlanOnly) {
  Write-Host "Lists: $($listSpecs.Count); labels: $($labelSpecs.Count); cards: $($cards.Count)"
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

  $members = @(Invoke-TrelloApi -Method GET -Path "boards/$($board.id)/members?fields=id,username,fullName")
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
      $members = @(Invoke-TrelloApi -Method GET -Path "boards/$($board.id)/members?fields=id,username,fullName")
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

  $existingLists = @(Invoke-TrelloApi -Method GET -Path "boards/$($board.id)/lists?filter=open&fields=id,name,pos")
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
    Write-Warning "Cac list co san duoc giu nguyen: $($extraLists.name -join ', '). Co the archive thu cong neu khong dung."
  }

  $existingLabels = @(Invoke-TrelloApi -Method GET -Path "boards/$($board.id)/labels?fields=id,name,color&limit=1000")
  $labelIds = @{}
  foreach ($spec in $labelSpecs) {
    $existing = $existingLabels | Where-Object { $_.name -eq $spec.Name } | Select-Object -First 1
    if ($null -eq $existing) {
      $existing = Invoke-TrelloApi -Method POST -Path "boards/$($board.id)/labels" -Body @{ name = $spec.Name; color = $spec.Color }
      Write-Host "Created label: $($spec.Name)"
    }
    $labelIds[$spec.Key] = $existing.id
  }

  $existingCards = @(Invoke-TrelloApi -Method GET -Path "boards/$($board.id)/cards/open?fields=id,name,idList")
  $createdCount = 0
  $skippedCount = 0

  foreach ($card in $cards) {
    $existingCard = $existingCards | Where-Object { $_.name -eq $card.Title } | Select-Object -First 1
    if ($null -ne $existingCard) {
      Write-Host "Skipped existing card: $($card.Title)"
      $skippedCount++
      continue
    }

    $memberIds = @()
    if ($card.Owner -in @('A', 'Both')) {
      $memberIds += $currentMember.id
    }
    if ($card.Owner -in @('B', 'Both') -and $null -ne $partner) {
      $memberIds += $partner.id
    }

    $cardLabelIds = @($card.Labels | ForEach-Object { $labelIds[$_] })
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
  Write-Host "Created $createdCount card(s); skipped $skippedCount existing card(s)."
  Write-Host 'Token 1 ngay chi ton tai trong bo nho cua terminal nay.'
} finally {
  $apiToken = $null
  $apiKey = $null
  $encodedKey = $null
  $authorizeUrl = $null
  $PartnerEmail = $null
  $script:TrelloHeaders = $null
}
