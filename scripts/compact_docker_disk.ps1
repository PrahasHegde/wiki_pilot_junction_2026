# Give Docker's unused disk space back to Windows (~20 GB here).
# Docker's disk image (docker_data.vhdx) only ever grows; deleted data inside it stays allocated on C:.
# Run in PowerShell **as Administrator**:   powershell -ExecutionPolicy Bypass -File scripts\compact_docker_disk.ps1
# Safe: stops Docker, compacts the image read-only-attached, starts Docker again. MariaDB data is kept.

$ErrorActionPreference = "Stop"
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Please run this in PowerShell as Administrator." -ForegroundColor Yellow; exit 1
}
$vhdx = Join-Path $env:LOCALAPPDATA "Docker\wsl\disk\docker_data.vhdx"
if (-not (Test-Path $vhdx)) {   # running elevated as another user: find it under the real profile
    $vhdx = Get-ChildItem "C:\Users\*\AppData\Local\Docker\wsl\disk\docker_data.vhdx" -ErrorAction SilentlyContinue |
            Select-Object -First 1 -ExpandProperty FullName
}
"Disk image: $vhdx"
$before = (Get-PSDrive C).Free

"Stopping Docker Desktop and WSL..."
docker desktop stop 2>$null
wsl --shutdown
Start-Sleep -Seconds 5

# diskpart refuses sparse VHDX files: clear the flag first (it is harmless to clear).
fsutil sparse setflag "$vhdx" 0 | Out-Null

$script = Join-Path $env:TEMP "compact_docker.txt"
@"
select vdisk file="$vhdx"
attach vdisk readonly
compact vdisk
detach vdisk
"@ | Set-Content -Encoding ascii $script
"Compacting (a few minutes)..."
diskpart /s $script
Remove-Item $script

"Starting Docker Desktop..."
docker desktop start
$after = (Get-PSDrive C).Free
"Freed {0:N1} GB on C: (now {1:N1} GB free)." -f (($after - $before) / 1GB), ($after / 1GB)
"Then in the project folder:  docker compose up -d --wait"
