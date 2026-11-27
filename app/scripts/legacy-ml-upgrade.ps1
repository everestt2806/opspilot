param(
    [Parameter(Mandatory=$true)][string]$InstallationDirectory,
    [Parameter(Mandatory=$true)][string]$UserDataDirectory,
    [Parameter(Mandatory=$true)][string]$ExecutableName,
    [Parameter(Mandatory=$true)][string]$PolicyFile
)
$ErrorActionPreference = 'Stop'
$handles = New-Object 'System.Collections.Generic.List[System.IDisposable]'
$stage = $null
$createdProfile = $false

function Reject([string]$Code) { throw $Code }
function PlainPath([string]$Path) {
    if ($Path -notmatch '^[A-Za-z]:[\\/]' -or $Path.StartsWith('\\')) { Reject 'UPGRADE_LOCAL_ABSOLUTE_PATH_REQUIRED' }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd([char]92)
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Reject 'UPGRADE_LINK_REJECTED' }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
    return $full
}
function ReadLocked([string]$Path, [long]$Limit) {
    $null = PlainPath $Path
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $handles.Add($stream)
    if ($stream.Length -gt $Limit) { Reject 'UPGRADE_FILE_LIMIT' }
    $memory = New-Object IO.MemoryStream
    try { $stream.CopyTo($memory); return ,$memory.ToArray() } finally { $memory.Dispose() }
}
function Hash([byte[]]$Bytes) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

try {
    $install = PlainPath $InstallationDirectory
    $dataRoot = PlainPath $UserDataDirectory
    if ($dataRoot -eq $install -or $dataRoot.StartsWith($install + '\', [StringComparison]::OrdinalIgnoreCase)) { Reject 'UPGRADE_SEPARATE_PROFILE_REQUIRED' }
    if ($ExecutableName -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._-]*\.exe$') { Reject 'UPGRADE_EXECUTABLE_NAME_REJECTED' }
    $source = Join-Path $install 'resources\ml-service\state'
    if (-not (Test-Path -LiteralPath $source)) {
        Write-Output '{"status":"PASS","outcome":"NO_LEGACY_STATE"}'
        exit 0
    }
    $null = PlainPath $source
    $items = @(Get-ChildItem -LiteralPath $source -Force)
    if ($items.Count -eq 0) { Write-Output '{"status":"PASS","outcome":"EMPTY_LEGACY_STATE"}'; exit 0 }
    if ($items.Count -gt 256) { Reject 'UPGRADE_DEPLOYMENT_LIMIT' }
    $running = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and ($_.ExecutablePath -eq (Join-Path $install $ExecutableName) -or
        $_.ExecutablePath.StartsWith((Join-Path $install 'resources\ml-service') + '\', [StringComparison]::OrdinalIgnoreCase))
    })
    if ($running.Count) { Reject 'UPGRADE_CLOSE_OLD_APP_FIRST' }
    $policy = [Text.Encoding]::UTF8.GetString((ReadLocked $PolicyFile 65536)) | ConvertFrom-Json
    if ($policy.format -ne 1 -or $policy.feature_version -ne 'v1-5metrics-4feats-w20') { Reject 'UPGRADE_POLICY_REJECTED' }
    $service = Join-Path $install 'resources\ml-service'
    foreach ($entry in $policy.source_sha256.PSObject.Properties) {
        if ($entry.Name -notmatch '^(?:[a-z_]+\.py|models/[a-z_]+\.py)$' -or $entry.Value -notmatch '^[a-f0-9]{64}$') { Reject 'UPGRADE_POLICY_REJECTED' }
        if ((Hash (ReadLocked (Join-Path $service $entry.Name) 2097152)) -ne $entry.Value) { Reject 'UPGRADE_LEGACY_SOURCE_UNVERIFIED' }
    }
    foreach ($entry in $policy.packages.PSObject.Properties) {
        if ($entry.Name -notmatch '^[a-z_]+$' -or $entry.Value -notmatch '^\d+(?:\.\d+){1,3}$') { Reject 'UPGRADE_POLICY_REJECTED' }
        $metadata = Join-Path $service ('.venv\Lib\site-packages\' + $entry.Name + '-' + $entry.Value + '.dist-info\METADATA')
        $text = [Text.Encoding]::UTF8.GetString((ReadLocked $metadata 2097152))
        if (-not ($text -match ('(?m)^Version: ' + [regex]::Escape($entry.Value) + '\r?$'))) { Reject 'UPGRADE_LEGACY_LIBRARY_UNVERIFIED' }
    }
    $files = New-Object 'System.Collections.Generic.List[object]'
    [long]$total = 0
    foreach ($item in $items) {
        if (-not $item.PSIsContainer -or $item.Name -notmatch '^[1-9][0-9]{0,14}$') { Reject 'UPGRADE_STATE_LAYOUT_REJECTED' }
        $null = PlainPath $item.FullName
        $leaves = @(Get-ChildItem -LiteralPath $item.FullName -Force)
        if ($leaves.Count -ne 2 -or ((@($leaves.Name | Sort-Object) -join ',') -ne 'meta.json,state.pkl')) { Reject 'UPGRADE_INCOMPLETE_STATE' }
        foreach ($name in @('meta.json', 'state.pkl')) {
            $path = Join-Path $item.FullName $name
            if ((Get-Item -LiteralPath $path -Force).PSIsContainer) { Reject 'UPGRADE_STATE_LAYOUT_REJECTED' }
            $bytes = ReadLocked $path $(if ($name -eq 'meta.json') { 65536 } else { 134217728 })
            $total += $bytes.LongLength
            if ($total -gt 536870912) { Reject 'UPGRADE_TOTAL_LIMIT' }
            if ($name -eq 'meta.json') {
                $meta = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
                if ($meta.feature_version -ne $policy.feature_version -or
                    -not ($meta.train_sample_count -is [int] -or $meta.train_sample_count -is [long]) -or
                    $meta.train_sample_count -lt 150) { Reject 'UPGRADE_MODEL_METADATA_REJECTED' }
            }
            $files.Add(@{relative=$item.Name + '\' + $name; bytes=$bytes; sha256=(Hash $bytes)})
        }
    }
    $target = Join-Path $dataRoot 'ml-state'
    $null = PlainPath $target
    if (Test-Path -LiteralPath $target) {
        foreach ($file in $files) {
            $path = Join-Path $target $file.relative
            if (-not (Test-Path -LiteralPath $path) -or (Hash (ReadLocked $path 134217728)) -ne $file.sha256) { Reject 'UPGRADE_MODEL_CONFLICT_KEEP_OLD_INSTALLATION' }
        }
        Write-Output '{"status":"PASS","outcome":"ALREADY_PRESERVED"}'
        exit 0
    }
    if (-not (Test-Path -LiteralPath $dataRoot)) { $null = New-Item -ItemType Directory -Path $dataRoot; $createdProfile = $true }
    $stage = Join-Path $dataRoot ('.ml-upgrade-' + [guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $stage
    foreach ($file in $files) {
        $path = Join-Path $stage $file.relative
        $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))
        [IO.File]::WriteAllBytes($path, $file.bytes)
        if ((Hash ([IO.File]::ReadAllBytes($path))) -ne $file.sha256) { Reject 'UPGRADE_COPY_VERIFICATION_FAILED' }
    }
    $null = PlainPath $source
    $null = PlainPath $dataRoot
    if (Test-Path -LiteralPath $target) { Reject 'UPGRADE_TARGET_CHANGED' }
    [IO.Directory]::Move($stage, $target)
    $stage = $null
    Write-Output ('{"status":"PASS","outcome":"PRESERVED","deployments":' + $items.Count + ',"bytes":' + $total + '}')
    exit 0
} catch {
    $reason = $_.Exception.Message
    if ($reason -notmatch '^UPGRADE_[A-Z_]+$') { $reason = 'UPGRADE_STATE_PRESERVATION_FAILED' }
    Write-Output ('{"status":"BLOCKED","error":"' + $reason + '"}')
    exit 2
} finally {
    foreach ($handle in $handles) { $handle.Dispose() }
    if ($stage -and (Test-Path -LiteralPath $stage)) {
        $checkedStage = PlainPath $stage
        if ([IO.Path]::GetDirectoryName($checkedStage) -eq $dataRoot -and [IO.Path]::GetFileName($checkedStage) -match '^\.ml-upgrade-[a-f0-9]{32}$') {
            Remove-Item -LiteralPath $checkedStage -Recurse -Force
        }
    }
    if ($createdProfile -and (Test-Path -LiteralPath $dataRoot) -and @(Get-ChildItem -LiteralPath $dataRoot -Force).Count -eq 0) { Remove-Item -LiteralPath $dataRoot }
}
