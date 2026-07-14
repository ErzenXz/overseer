param(
  [ValidateSet("install", "uninstall", "remove")]
  [string]$Action = "install"
)
$ErrorActionPreference = "Stop"
$Repo = if ($env:OVERSEER_REPO) { $env:OVERSEER_REPO } else { "ErzenXz/overseer" }
$Version = if ($env:OVERSEER_VERSION) { $env:OVERSEER_VERSION } else { "latest" }
$Addr = if ($env:OVERSEER_ADDR) { $env:OVERSEER_ADDR } else { ":4200" }
$Base = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Overseer" } else { Join-Path $HOME "AppData\Local\Overseer" }
$BinDir = Join-Path $Base "bin"
$DataDir = if ($env:OVERSEER_DATA_DIR) { $env:OVERSEER_DATA_DIR } else { Join-Path $Base "data" }
$Bin = Join-Path $BinDir "overseer.exe"
$PreviousBin = Join-Path $BinDir "overseer.previous.exe"
$Task = "OverseerHub"
$Runner = Join-Path $BinDir "overseer-hub.cmd"

if ($Action -in @("uninstall", "remove")) {
  schtasks.exe /Delete /TN $Task /F 2>$null | Out-Null
  Remove-Item -Force -ErrorAction SilentlyContinue $Bin, $PreviousBin, $Runner
  if ($env:OVERSEER_PURGE -eq "1") { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $DataDir }
  Write-Host "overseer: uninstalled"
  exit 0
}

$RawArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$Arch = switch -Regex ($RawArch.ToLowerInvariant()) {
  "amd64|x64" { "amd64"; break }
  "arm64" { "arm64"; break }
  default { throw "Unsupported architecture: $RawArch" }
}
New-Item -ItemType Directory -Force -Path $BinDir, $DataDir | Out-Null
schtasks.exe /End /TN $Task 2>$null | Out-Null
if ($env:OVERSEER_LOCAL_BINARY) {
  Copy-Item -Force $env:OVERSEER_LOCAL_BINARY $Bin
} else {
  $Url = if ($Version -eq "latest") { "https://github.com/$Repo/releases/latest/download/overseer_windows_$Arch" } else { "https://github.com/$Repo/releases/download/$Version/overseer_windows_$Arch" }
  Write-Host "overseer: downloading Windows/$Arch binary"
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile "$Bin.tmp"
  $ReleaseBase = $Url.Substring(0, $Url.LastIndexOf('/'))
  $Checksums = (Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseBase/checksums.txt").Content
  $Asset = "overseer_windows_$Arch"
  $Line = ($Checksums -split "`n" | Where-Object { $_ -match "^[0-9a-fA-F]{64}\s+\*?$([regex]::Escape($Asset))\s*$" } | Select-Object -First 1)
  if (-not $Line) { throw "checksums.txt does not contain $Asset" }
  $Expected = ($Line -split "\s+")[0].ToLowerInvariant()
  $Actual = (Get-FileHash -Algorithm SHA256 "$Bin.tmp").Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw "release checksum verification failed" }
  Move-Item -Force "$Bin.tmp" $Bin
}

$CmdBin = $Bin.Replace('%', '%%')
$CmdAddr = $Addr.Replace('%', '%%')
$CmdDataDir = $DataDir.Replace('%', '%%')
$RunnerLines = @(
  '@echo off',
  'set "OVERSEER_MANAGED=hub"',
  'set "OVERSEER_WINDOWS_TASK=OverseerHub"',
  "`"$CmdBin`" serve --addr `"$CmdAddr`" --data-dir `"$CmdDataDir`""
)
Set-Content -Path $Runner -Value $RunnerLines -Encoding ASCII
$TaskCommand = "`"$Runner`""
schtasks.exe /Create /TN $Task /SC ONLOGON /TR $TaskCommand /F | Out-Null
schtasks.exe /Run /TN $Task | Out-Null
Write-Host "overseer: installed; open http://localhost:4200"
