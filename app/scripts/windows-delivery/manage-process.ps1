<#
.SYNOPSIS
    Quản lý và kiểm tra quyền sở hữu tiến trình dịch vụ OpsPilot (Port 8765 / ML runtime).
.DESCRIPTION
    Script xác thực quyền sở hữu tiến trình một cách chặt chẽ:
    - Tra cứu PID đang lắng nghe cổng được chỉ định (mặc định 8765).
    - Lấy đường dẫn thực thi canonical của tiến trình.
    - So khớp chính xác đường dẫn với thư mục cài đặt OpsPilot ($InstallDir\...).
    - TUYỆT ĐỐI KHÔNG dùng so khớp chuỗi lỏng lẻo (*ml-runtime*).
    - Từ chối thao tác trên tiến trình ứng dụng khác (ví dụ: D:\UnrelatedApp\ml-runtime\python.exe).
    - Thao tác mặc định là 'Inspect' (chỉ đọc). Thao tác 'Stop' chỉ dừng khi chứng minh được tiến trình thuộc OpsPilot.
.PARAMETER Action
    Hành động cần thực hiện: 'Inspect' (mặc định) hoặc 'Stop'.
.PARAMETER Port
    Cổng dịch vụ nội bộ cần kiểm tra (mặc định: 8765).
.PARAMETER InstallDir
    Thư mục cài đặt gốc của OpsPilot (mặc định: $env:LOCALAPPDATA\Programs\OpsPilot).
#>
[CmdletBinding()]
param (
    [Parameter(Mandatory=$false)]
    [ValidateSet('Inspect', 'Stop')]
    [string]$Action = 'Inspect',

    [Parameter(Mandatory=$false)]
    [int]$Port = 8765,

    [Parameter(Mandatory=$false)]
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\OpsPilot"
)

$ErrorActionPreference = "Stop"

$canonicalInstallDir = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$installPrefix = $canonicalInstallDir + [System.IO.Path]::DirectorySeparatorChar

Write-Host "Kiểm tra cổng $Port với thư mục cài đặt được ủy quyền: $canonicalInstallDir"

$connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $connections -or $connections.Count -eq 0) {
    Write-Host "Cổng $Port đang ở trạng thái rảnh (FREE - không có tiến trình nào lắng nghe)."
    [PSCustomObject]@{
        Port   = $Port
        Status = "FREE"
        PID    = $null
        Path   = $null
        Owned  = $false
    }
    exit 0
}

$results = [System.Collections.Generic.List[PSCustomObject]]::new()
$hasUnownedConflict = $false

foreach ($conn in $connections) {
    $targetPid = $conn.OwningProcess
    if (-not $targetPid -or $targetPid -eq 0) {
        continue
    }

    $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
    $procPath = $null
    if ($proc) {
        try {
            $procPath = $proc.MainModule.FileName
        } catch {
            # Khi thiếu quyền đọc MainModule, truy vấn qua WMI
            try {
                $wmi = Get-CimInstance Win32_Process -Filter "ProcessId = $targetPid" -ErrorAction SilentlyContinue
                if ($wmi) {
                    $procPath = $wmi.ExecutablePath
                }
            } catch {}
        }
    }

    if (-not $procPath) {
        Write-Warning "Không xác định được đường dẫn thực thi cho PID $targetPid."
        $results.Add([PSCustomObject]@{
            Port   = $Port
            Status = "UNKNOWN_NO_PATH"
            PID    = $targetPid
            Path   = $null
            Owned  = $false
        })
        $hasUnownedConflict = $true
        continue
    }

    $canonicalProcPath = [System.IO.Path]::GetFullPath($procPath)
    # Xác thực quyền sở hữu nghiêm ngặt: Phải bắt đầu bằng thư mục cài đặt gốc + ký tự phân cách
    $isOwned = $canonicalProcPath.StartsWith($installPrefix, [System.StringComparison]::OrdinalIgnoreCase)

    $record = [PSCustomObject]@{
        Port      = $Port
        Status    = if ($isOwned) { "OWNED_OPSPILOT_PROCESS" } else { "UNRELATED_PROCESS" }
        PID       = $targetPid
        Path      = $canonicalProcPath
        StartTime = if ($proc) { $proc.StartTime } else { $null }
        Owned     = $isOwned
    }
    $results.Add($record)

    if (-not $isOwned) {
        $hasUnownedConflict = $true
        Write-Warning "CẢNH BÁO: Tiến trình PID $targetPid ($canonicalProcPath) KHÔNG thuộc OpsPilot ($canonicalInstallDir)."
    }
}

if ($Action -eq 'Inspect') {
    $results | Format-Table -AutoSize
    exit 0
}

if ($Action -eq 'Stop') {
    if ($hasUnownedConflict) {
        Write-Error "TỪ CHỐI DỪNG: Cổng $Port đang bị chiếm dụng bởi tiến trình không thuộc OpsPilot. Nghiêm cấm dừng tiến trình của bên thứ ba!"
        exit 1
    }

    foreach ($res in $results) {
        if ($res.Owned -and $res.PID) {
            # Kiểm tra nghiêm ngặt lại trạng thái tiến trình tại thời điểm dừng (chống PID reuse / giả mạo)
            $procToStop = Get-Process -Id $res.PID -ErrorAction SilentlyContinue
            if (-not $procToStop) {
                Write-Host "Tiến trình PID $($res.PID) đã tự thoát trước khi dừng."
                continue
            }

            # Kiểm tra thời gian khởi động (StartTime) xem PID có bị tái sử dụng cho tiến trình khác không
            if ($res.StartTime -and $procToStop.StartTime -and $res.StartTime -ne $procToStop.StartTime) {
                Write-Error "TỪ CHỐI DỪNG: Phát hiện PID reuse! Tiến trình PID $($res.PID) hiện tại có StartTime ($($procToStop.StartTime)) khác với snapshot ban đầu ($($res.StartTime))."
                exit 1
            }

            # Xác thực lại đường dẫn thực thi tại thời điểm dừng
            $currentPath = $null
            try {
                $currentPath = $procToStop.MainModule.FileName
            } catch {
                try {
                    $wmi = Get-CimInstance Win32_Process -Filter "ProcessId = $($res.PID)" -ErrorAction SilentlyContinue
                    if ($wmi) { $currentPath = $wmi.ExecutablePath }
                } catch {}
            }

            if (-not $currentPath) {
                Write-Error "TỪ CHỐI DỪNG: Không thể xác minh lại đường dẫn thực thi của PID $($res.PID) tại thời điểm dừng."
                exit 1
            }

            $canonicalCurrentPath = [System.IO.Path]::GetFullPath($currentPath)
            if (-not $canonicalCurrentPath.StartsWith($installPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                Write-Error "TỪ CHỐI DỪNG: Đường dẫn thực thi tại thời điểm dừng ($canonicalCurrentPath) không thuộc installation được ủy quyền ($canonicalInstallDir)!"
                exit 1
            }

            # Xác thực lại xem PID này còn đang lắng nghe cổng không
            $currentConn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $res.PID }
            if (-not $currentConn) {
                Write-Host "Tiến trình PID $($res.PID) không còn lắng nghe trên cổng $Port nữa."
            }

            Write-Host "Đang dừng an toàn tiến trình sở hữu OpsPilot PID $($res.PID) ($canonicalCurrentPath)..."
            # Thử đóng lịch sự trước
            $procToStop.CloseMainWindow() | Out-Null
            Start-Sleep -Milliseconds 500
            if (-not $procToStop.HasExited) {
                Stop-Process -Id $res.PID -Force -ErrorAction SilentlyContinue
            }
            Write-Host "Đã giải phóng tiến trình PID $($res.PID)."
        }
    }

    # Xác nhận lại cổng đã được giải phóng
    Start-Sleep -Milliseconds 300
    $remaining = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($remaining) {
        Write-Warning "Cổng $Port vẫn còn kết nối sau khi dừng."
        exit 1
    } else {
        Write-Host "Cổng $Port đã được giải phóng hoàn toàn."
        exit 0
    }
}
