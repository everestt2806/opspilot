<#
.SYNOPSIS
    Khôi phục an toàn profile OpsPilot từ bản sao lưu và manifest.
.DESCRIPTION
    Script xác thực toàn diện tính toàn vẹn của bản sao lưu TRƯỚC KHI thực hiện bất kỳ thay đổi nào
    lên profile hiện tại:
    - Kiểm tra định dạng manifest, phiên bản, danh sách tệp bắt buộc (opspilot.db).
    - Kiểm tra mã băm SHA-256 và kích thước của từng tệp.
    - Phát hiện và từ chối nếu có tệp lạ trên đĩa nhưng không nằm trong manifest (chống injection tệp độc hại/chưa xác minh).
    - Từ chối symlink / path traversal.
    - Nếu thất bại: profile hiện tại hoàn toàn giữ nguyên vị trí và mã băm.
    - Nếu thành công: thực hiện qua thư mục staging, lưu giữ profile cũ tại OpsPilot_PreRestore_<timestamp> và promote an toàn.
.PARAMETER BackupDir
    Thư mục chứa bản sao lưu và backup-manifest.json. Bắt buộc cung cấp.
.PARAMETER TargetProfile
    Đường dẫn profile OpsPilot đích cần phục hồi. Mặc định là $env:APPDATA\OpsPilot.
#>
[CmdletBinding()]
param (
    [Parameter(Mandatory=$true)]
    [string]$BackupDir,

    [Parameter(Mandatory=$false)]
    [string]$TargetProfile = "$env:APPDATA\OpsPilot"
)

$ErrorActionPreference = "Stop"

# 1. Xác thực thư mục sao lưu và sự hiện diện của backup-manifest.json
if (-not (Test-Path -Path $BackupDir -PathType Container)) {
    Write-Error "Thư mục sao lưu không tồn tại hoặc không phải thư mục: $BackupDir"
    exit 1
}

$canonicalBackup = [System.IO.Path]::GetFullPath($BackupDir)
$manifestPath = Join-Path $canonicalBackup "backup-manifest.json"

if (-not (Test-Path -Path $manifestPath -PathType Leaf)) {
    Write-Error "Thư mục sao lưu không hợp lệ: Thiếu backup-manifest.json tại $canonicalBackup."
    exit 1
}

# 2. Đọc và xác thực cấu trúc manifest
Write-Host "Đang đọc và xác thực cấu trúc manifest..."
try {
    $manifestContent = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8)
    $manifest = $manifestContent | ConvertFrom-Json
} catch {
    Write-Error "Tệp backup-manifest.json không phải JSON hợp lệ: $_"
    exit 1
}

if ($null -eq $manifest -or $manifest.format -ne 1) {
    Write-Error "Phiên bản format của manifest không được hỗ trợ (yêu cầu format: 1)."
    exit 1
}

# Manifest items phải là danh sách và KHÔNG ĐƯỢC RỖNG
$items = @($manifest.items)
if ($items.Count -eq 0) {
    Write-Error "Manifest không hợp lệ: Danh sách items rỗng (không có tệp nào được bảo vệ)."
    exit 1
}

# 3. Kiểm tra các tệp bắt buộc (Required Inventory)
# Trong supported populated profile, opspilot.db là bắt buộc phải có trong manifest
$manifestPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$hasDbInManifest = $false

foreach ($item in $items) {
    if (-not $item.path -or -not $item.sha256) {
        Write-Error "Mục trong manifest thiếu path hoặc sha256."
        exit 1
    }

    $posixPath = $item.path.Replace('\', '/')
    if ($posixPath.StartsWith('/') -or $posixPath -like "*..*" -or $posixPath -like "*:*") {
        Write-Error "Path traversal hoặc đường dẫn không an toàn trong manifest: $posixPath"
        exit 1
    }

    if ($posixPath -eq "opspilot.db") {
        $hasDbInManifest = $true
    }

    if (-not $manifestPaths.Add($posixPath)) {
        Write-Error "Phát hiện đường dẫn trùng lặp trong manifest items: $posixPath"
        exit 1
    }
}

if (-not $hasDbInManifest) {
    Write-Error "Bản sao lưu không hợp lệ: Thiếu tệp bắt buộc opspilot.db trong manifest items."
    exit 1
}

# Kiểm tra tính hoàn chỉnh của cặp mô hình ML (nếu có state.pkl thì phải có meta.json và ngược lại)
foreach ($p in $manifestPaths) {
    if ($p -like "ml-state/*/state.pkl") {
        $expectedMeta = $p.Replace("state.pkl", "meta.json")
        if (-not $manifestPaths.Contains($expectedMeta)) {
            Write-Error "Bản sao lưu thiếu cặp mô hình ML: Có $p nhưng thiếu $expectedMeta."
            exit 1
        }
    }
    if ($p -like "ml-state/*/meta.json") {
        $expectedPkl = $p.Replace("meta.json", "state.pkl")
        if (-not $manifestPaths.Contains($expectedPkl)) {
            Write-Error "Bản sao lưu thiếu cặp mô hình ML: Có $p nhưng thiếu $expectedPkl."
            exit 1
        }
    }
}

# 4. Xác minh tính toàn vẹn của từng tệp trên đĩa khớp hoàn toàn với manifest
Write-Host "Đang kiểm tra tính toàn vẹn và băm SHA-256 từng tệp..."
foreach ($item in $items) {
    $posixPath = $item.path.Replace('\', '/')
    $diskPath = Join-Path $canonicalBackup ($posixPath.Replace('/', [System.IO.Path]::DirectorySeparatorChar))

    if (-not (Test-Path -Path $diskPath -PathType Leaf)) {
        Write-Error "Tệp được khai báo trong manifest nhưng không tồn tại trên đĩa: $posixPath"
        exit 1
    }

    $fileItem = Get-Item -Path $diskPath -Force
    if ($fileItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        Write-Error "Tệp trong bản sao lưu là symlink/reparse point không an toàn: $posixPath"
        exit 1
    }

    if ($fileItem.Length -ne $item.size) {
        Write-Error "Kích thước tệp không khớp cho $posixPath. Dự kiến: $($item.size), Thực tế: $($fileItem.Length)"
        exit 1
    }

    $actualHash = (Get-FileHash -Path $diskPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $item.sha256.ToLowerInvariant()) {
        Write-Error "Mã băm SHA-256 không khớp cho $posixPath. Dự kiến: $($item.sha256), Thực tế: $actualHash"
        exit 1
    }
}

# 5. Kiểm tra tệp lạ không có trong manifest (Chống unlisted files / data injection)
# Bất kỳ tệp nào trên đĩa trong thư mục sao lưu (trừ backup-manifest.json) PHẢI nằm trong manifest
Write-Host "Kiểm tra tệp dư thừa / không khai báo trong thư mục sao lưu..."
$allDiskFiles = Get-ChildItem -Path $canonicalBackup -Recurse -File -Force
foreach ($df in $allDiskFiles) {
    if ($df.FullName -eq $manifestPath) {
        continue
    }

    $relPosix = $df.FullName.Substring($canonicalBackup.Length + 1).Replace('\', '/')
    if (-not $manifestPaths.Contains($relPosix)) {
        Write-Error "Phát hiện tệp nằm ngoài manifest trong thư mục sao lưu: $relPosix. Sao lưu bị từ chối phục hồi!"
        exit 1
    }
}

Write-Host "Xác minh toàn bộ bản sao lưu thành công: Hợp lệ 100%!"

# ==============================================================================
# 6. GIAI ĐOẠN PHỤC HỒI (CHỈ ĐƯỢC CHẠY KHI TẤT CẢ KIỂM TRA TRÊN ĐÃ PASS)
# ==============================================================================

$canonicalTarget = [System.IO.Path]::GetFullPath($TargetProfile)
$targetParent = [System.IO.Path]::GetDirectoryName($canonicalTarget)

if (-not (Test-Path -Path $targetParent)) {
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
}

$timestampNonce = (Get-Date -Format 'yyyyMMdd_HHmmss') + "_" + [System.IO.Path]::GetRandomFileName().Substring(0, 6)
$stagingDir = Join-Path $targetParent "OpsPilot_RestoreStaging_$timestampNonce"

Write-Host "Chuẩn bị dữ liệu phục hồi tại staging: $stagingDir"
New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

try {
    # 6.1. Copy đúng các tệp trong manifest vào staging
    foreach ($item in $items) {
        $posixPath = $item.path.Replace('\', '/')
        $srcPath = Join-Path $canonicalBackup ($posixPath.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
        $destPath = Join-Path $stagingDir ($posixPath.Replace('/', [System.IO.Path]::DirectorySeparatorChar))

        $destDir = [System.IO.Path]::GetDirectoryName($destPath)
        if (-not (Test-Path -Path $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }

        Copy-Item -Path $srcPath -Destination $destPath -Force
    }

    # 6.2. Lưu giữ profile hiện hữu (Pre-Restore Preservation) nếu tồn tại
    if (Test-Path -Path $canonicalTarget) {
        $preRestoreDir = Join-Path $targetParent "OpsPilot_PreRestore_$timestampNonce"
        Write-Host "Di chuyển và lưu trữ an toàn profile hiện tại vào: $preRestoreDir"
        Move-Item -Path $canonicalTarget -Destination $preRestoreDir
    }

    # 6.3. Promote staging thành profile chính thức
    Write-Host "Áp dụng profile mới vào: $canonicalTarget"
    Move-Item -Path $stagingDir -Destination $canonicalTarget

    Write-Host "Phục hồi profile OpsPilot hoàn tất thành công!"
    exit 0
} catch {
    Write-Error "Lỗi xảy ra trong quá trình staging/promote: $_"
    # Dọn dẹp staging nếu còn
    if (Test-Path -Path $stagingDir) {
        Remove-Item -Path $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    exit 1
}
