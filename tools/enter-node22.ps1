$managedNodeDirectory = Join-Path $env:LOCALAPPDATA 'pnpm\bin'
$managedNode = Join-Path $managedNodeDirectory 'node.exe'

if (-not (Test-Path -LiteralPath $managedNode)) {
    throw 'Chưa có Node 22 do pnpm quản lý. Chạy: pnpm runtime set node 22.23.2 -g'
}

$env:Path = "$managedNodeDirectory;$env:Path"
$nodeVersion = node --version

if (-not $nodeVersion.StartsWith('v22.')) {
    throw "Node đang dùng không phải v22: $nodeVersion"
}

Write-Host "Node $nodeVersion da duoc kich hoat cho terminal hien tai."
