<#
.SYNOPSIS
    Sao lưu an toàn profile OpsPilot (Database SQLite, protected key, ML state, Local Storage).
.DESCRIPTION
    Script thực hiện sao lưu nhất quán dữ liệu profile người dùng, kiểm tra tính toàn vẹn các cặp mô hình,
    tạo manifest chuẩn với mã băm SHA-256 cho từng tệp và từ chối các tệp không hợp lệ.
.PARAMETER SourceProfile
    Đường dẫn profile nguồn OpsPilot. Mặc định là $env:APPDATA\OpsPilot.
.PARAMETER BackupTarget
    Thư mục lưu trữ bản sao lưu. Bắt buộc cung cấp.
.PARAMETER Force
    Ghi đè thư mục đích nếu đã tồn tại.
#>
[CmdletBinding()]
param (
    [Parameter(Mandatory=$false)]
    [string]$SourceProfile = "$env:APPDATA\OpsPilot",

    [Parameter(Mandatory=$true)]
    [string]$BackupTarget,

    [switch]$Force
)

$ErrorActionPreference = "Stop"

# 1. Xác thực đường dẫn profile nguồn
if (-not (Test-Path -Path $SourceProfile -PathType Container)) {
    Write-Error "Profile nguồn không tồn tại hoặc không phải thư mục: $SourceProfile"
    exit 1
}

$canonicalSource = [System.IO.Path]::GetFullPath($SourceProfile)
$canonicalTarget = [System.IO.Path]::GetFullPath($BackupTarget)

# Không cho phép sao lưu đè chính thư mục nguồn hoặc thư mục con của nguồn
if ($canonicalTarget.StartsWith($canonicalSource + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -or
    $canonicalTarget -eq $canonicalSource) {
    Write-Error "Thư mục đích không được nằm trong hoặc trùng với thư mục nguồn."
    exit 1
}

# 2. Chuẩn bị thư mục đích
if (Test-Path -Path $canonicalTarget) {
    $existing = Get-ChildItem -Path $canonicalTarget -Force
    if ($existing.Count -gt 0 -and -not $Force) {
        Write-Error "Thư mục đích đã tồn tại và không rỗng. Sử dụng -Force để ghi đè: $canonicalTarget"
        exit 1
    }
} else {
    New-Item -ItemType Directory -Path $canonicalTarget -Force | Out-Null
}

Write-Host "Bắt đầu sao lưu profile OpsPilot từ: $canonicalSource"
Write-Host "Thư mục lưu trữ sao lưu: $canonicalTarget"

# 3. Danh mục các thành phần cần sao lưu
# Định nghĩa các tệp/thư mục hợp lệ trong profile OpsPilot
$manifestEntries = [System.Collections.Generic.List[PSCustomObject]]::new()

function Copy-And-RegisterFile {
    param (
        [string]$RelativePath
    )
    $src = Join-Path $canonicalSource $RelativePath
    if (-not (Test-Path -Path $src -PathType Leaf)) {
        return
    }

    # Kiểm tra liên kết mềm (symlink / reparse point)
    $srcItem = Get-Item -Path $src -Force
    if ($srcItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        Write-Error "Phát hiện symlink không an toàn tại nguồn: $RelativePath. Sao lưu bị từ chối."
        exit 1
    }

    $dest = Join-Path $canonicalTarget $RelativePath
    $destDir = [System.IO.Path]::GetDirectoryName($dest)
    if (-not (Test-Path -Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }

    Copy-Item -Path $src -Destination $dest -Force

    $destItem = Get-Item -Path $dest -Force
    $hash = (Get-FileHash -Path $dest -Algorithm SHA256).Hash.ToLowerInvariant()
    $posixPath = $RelativePath.Replace('\', '/')

    $manifestEntries.Add([PSCustomObject]@{
        path   = $posixPath
        size   = $destItem.Length
        sha256 = $hash
    })
}

function Copy-And-RegisterDirectory {
    param (
        [string]$RelativeDir
    )
    $srcDir = Join-Path $canonicalSource $RelativeDir
    if (-not (Test-Path -Path $srcDir -PathType Container)) {
        return
    }

    $files = Get-ChildItem -Path $srcDir -Recurse -File -Force
    foreach ($file in $files) {
        if ($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            Write-Error "Phát hiện symlink không an toàn trong thư mục $RelativeDir. Sao lưu bị từ chối."
            exit 1
        }
        $fileRel = $file.FullName.Substring($canonicalSource.Length + 1)
        Copy-And-RegisterFile -RelativePath $fileRel
    }
}

# 3.1. Database SQLite & Journal (WAL/SHM)
$hasDb = Test-Path -Path (Join-Path $canonicalSource "opspilot.db") -PathType Leaf
if ($hasDb) {
    Copy-And-RegisterFile -RelativePath "opspilot.db"
    Copy-And-RegisterFile -RelativePath "opspilot.db-wal"
    Copy-And-RegisterFile -RelativePath "opspilot.db-shm"
} else {
    Write-Warning "Profile nguồn không có opspilot.db (Fresh profile chưa khởi tạo database)."
}

# 3.2. Protected DPAPI Master Key
$hasKey = Test-Path -Path (Join-Path $canonicalSource "credential-master-key.protected") -PathType Leaf
if ($hasKey) {
    Copy-And-RegisterFile -RelativePath "credential-master-key.protected"
} else {
    Write-Warning "Profile nguồn không có credential-master-key.protected."
}

# 3.3. ML State: Mô hình huấn luyện & Metadata
$mlStateDir = Join-Path $canonicalSource "ml-state"
if (Test-Path -Path $mlStateDir -PathType Container) {
    # Kiểm tra tính toàn vẹn cặp state.pkl và meta.json cho từng deployment model
    $subDirs = Get-ChildItem -Path $mlStateDir -Directory -Force
    foreach ($sd in $subDirs) {
        $pklPath = Join-Path $sd.FullName "state.pkl"
        $metaPath = Join-Path $sd.FullName "meta.json"
        $hasPkl = Test-Path -Path $pklPath -PathType Leaf
        $hasMeta = Test-Path -Path $metaPath -PathType Leaf
        if ($hasPkl -and -not $hasMeta) {
            Write-Error "ML state không hoàn chỉnh tại $($sd.Name): Có state.pkl nhưng thiếu meta.json."
            exit 1
        }
        if ($hasMeta -and -not $hasPkl) {
            Write-Error "ML state không hoàn chỉnh tại $($sd.Name): Có meta.json nhưng thiếu state.pkl."
            exit 1
        }
    }
    Copy-And-RegisterDirectory -RelativeDir "ml-state"
}

# 3.4. Local Storage (Cấu hình UI / session)
$storageDir = Join-Path $canonicalSource "Local Storage"
if (Test-Path -Path $storageDir -PathType Container) {
    Copy-And-RegisterDirectory -RelativeDir "Local Storage"
}

# 4. Ghi backup-manifest.json
$manifestObj = [PSCustomObject]@{
    format         = 1
    created_at     = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    source_profile = $canonicalSource
    user_domain    = $env:USERDOMAIN
    user_name      = $env:USERNAME
    items_count    = $manifestEntries.Count
    items          = @($manifestEntries | Sort-Object -Property path)
}

$manifestJson = $manifestObj | ConvertTo-Json -Depth 5
$manifestPath = Join-Path $canonicalTarget "backup-manifest.json"
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, [System.Text.Encoding]::UTF8)

Write-Host "Sao lưu thành công! Đã ghi $($manifestEntries.Count) tệp vào $manifestPath."
exit 0
