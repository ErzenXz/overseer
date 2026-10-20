param(
  [ValidateSet("install", "uninstall", "remove")]
  [string]$Action = "install"
)
# Install the Overseer hub on Windows as a hidden Scheduled Task (no admin).
#
#   irm https://liveagent-lime.vercel.app/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://liveagent-lime.vercel.app/install.ps1))) uninstall
#
# Release binaries are checked against the release's checksums.txt. When no
# release exists it builds from source with temporary, checksum-verified Go
# and Node toolchains.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # Invoke-WebRequest is many times faster without the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = if ($env:OVERSEER_REPO) { $env:OVERSEER_REPO } else { "ErzenXz/overseer" }
$Version = if ($env:OVERSEER_VERSION) { $env:OVERSEER_VERSION } else { "latest" }
$Ref = if ($env:OVERSEER_REF) { $env:OVERSEER_REF } else { "main" }
$Addr = if ($env:OVERSEER_ADDR) { $env:OVERSEER_ADDR } else { ":4200" }
$InstallSource = if ($env:OVERSEER_INSTALL_SOURCE) { $env:OVERSEER_INSTALL_SOURCE } else { "auto" }
$GoVersion = if ($env:OVERSEER_GO_VERSION) { $env:OVERSEER_GO_VERSION } else { "1.25.0" }
$NodeMajor = if ($env:OVERSEER_NODE_MAJOR) { [int]$env:OVERSEER_NODE_MAJOR } else { 20 }
$WaitSeconds = if ($null -ne $env:OVERSEER_WAIT_SECONDS) { [int]$env:OVERSEER_WAIT_SECONDS } else { 15 }
$Base = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Overseer" } else { Join-Path $HOME "AppData\Local\Overseer" }
$BinDir = if ($env:OVERSEER_BIN_DIR) { $env:OVERSEER_BIN_DIR } else { Join-Path $Base "bin" }
$DataDir = if ($env:OVERSEER_DATA_DIR) { $env:OVERSEER_DATA_DIR } else { Join-Path $Base "data" }
$Bin = Join-Path $BinDir "overseer.exe"
$PreviousBin = Join-Path $BinDir "overseer.previous.exe"
$Task = if ($env:OVERSEER_SERVICE_NAME) { $env:OVERSEER_SERVICE_NAME } else { "OverseerHub" }
$Runner = Join-Path $BinDir "overseer-hub.ps1"
$InstallerUrl = "https://liveagent-lime.vercel.app/install.ps1"

function Say([string]$Message) { Write-Host "  $Message" }
function Ok([string]$Message) { Write-Host "  OK  $Message" }
# Fail stops the install without closing a pasted-into PowerShell window.
function Fail([string]$Message) { throw [System.Exception]::new("overseer-abort: $Message") }
# Quiet runs a native command whose output and errors don't matter. Windows
# PowerShell 5.1 turns redirected stderr into terminating errors under Stop.
function Quiet([scriptblock]$Command) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try { & $Command 2>&1 | Out-Null } catch { } finally { $ErrorActionPreference = $previous }
}

function Invoke-Download([string]$Uri, [string]$OutFile) {
  Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile
}

function Get-ExpectedChecksum([string]$Content, [string]$Asset) {
  $escaped = [regex]::Escape($Asset)
  $line = ($Content -split "`n" | Where-Object { $_ -match "^[0-9a-fA-F]{64}\s+\*?$escaped\s*$" } | Select-Object -First 1)
  if (-not $line) { Fail "checksums.txt does not list $Asset" }
  return ($line -split "\s+")[0].ToLowerInvariant()
}

function Assert-Checksum([string]$Path, [string]$Expected, [string]$Label) {
  $actual = (Get-FileHash -Algorithm SHA256 $Path).Hash.ToLowerInvariant()
  if ($actual -ne $Expected.ToLowerInvariant()) { Fail "$Label checksum mismatch: the download was corrupted or tampered with" }
}

function Stop-HubTask { Quiet { schtasks.exe /End /TN $Task } }

function Uninstall-Hub {
  Stop-HubTask
  Quiet { schtasks.exe /Delete /TN $Task /F }
  Remove-Item -Force -ErrorAction SilentlyContinue $Bin, $PreviousBin, $Runner, "$Bin.update.json"
  Ok "Stopped and removed the $Task task"
  if ($env:OVERSEER_PURGE -eq "1") {
    $fullData = [IO.Path]::GetFullPath($DataDir)
    $unsafe = @([IO.Path]::GetPathRoot($fullData), [IO.Path]::GetFullPath($HOME), [IO.Path]::GetFullPath($Base))
    if ($unsafe -contains $fullData) { Fail "refusing to purge unsafe data directory: $fullData" }
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $fullData
    Ok "Deleted data in $fullData"
  } else {
    Say "Kept your data in $DataDir (set OVERSEER_PURGE=1 and rerun to delete it)"
  }
}

function Get-ReleaseBinary {
  $url = if ($Version -eq "latest") {
    "https://github.com/$Repo/releases/latest/download/$Asset"
  } else {
    "https://github.com/$Repo/releases/download/$Version/$Asset"
  }
  try {
    Invoke-Download $url $StagedBin
    $releaseBase = $url.Substring(0, $url.LastIndexOf('/'))
    $checksums = [string](Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/checksums.txt").Content
  } catch {
    Remove-Item -Force -ErrorAction SilentlyContinue $StagedBin
    return $false
  }
  Assert-Checksum $StagedBin (Get-ExpectedChecksum $checksums $Asset) "release"
  Ok "Downloaded and verified the $Version release (windows/$Arch)"
  return $true
}

function Ensure-GoToolchain {
  $current = $null
  if (Get-Command go -ErrorAction SilentlyContinue) {
    if ((& go env GOVERSION 2>$null) -match '^go([0-9.]+)') { $current = [version]$Matches[1] }
  }
  if ($current -and $current -ge [version]$GoVersion) { return }
  $manifest = Invoke-RestMethod -UseBasicParsing -Uri "https://go.dev/dl/?mode=json&include=all"
  $release = $manifest | Where-Object { $_.version -eq "go$GoVersion" } | Select-Object -First 1
  $file = $release.files | Where-Object { $_.os -eq "windows" -and $_.arch -eq $Arch -and $_.kind -eq "archive" } | Select-Object -First 1
  if (-not $file) { Fail "could not find Go $GoVersion for windows/$Arch" }
  $archive = Join-Path $TempRoot $file.filename
  Invoke-Download "https://go.dev/dl/$($file.filename)" $archive
  Assert-Checksum $archive $file.sha256 "Go"
  $destination = Join-Path $TempRoot "toolchains"
  Expand-Archive -Force -Path $archive -DestinationPath $destination
  $env:PATH = (Join-Path $destination "go\bin") + ";" + $env:PATH
}

function Ensure-NodeToolchain {
  $current = 0
  if ((Get-Command node -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    $current = [int]((& node --version).TrimStart('v').Split('.')[0])
  }
  if ($current -ge $NodeMajor) { return }
  $baseUrl = "https://nodejs.org/dist/latest-v$NodeMajor.x"
  $sums = [string](Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHASUMS256.txt").Content
  $nodeArch = if ($Arch -eq "amd64") { "x64" } else { $Arch } # Node names 64-bit Intel builds "x64"
  $pattern = "^[0-9a-fA-F]{64}\s+(node-v[0-9.]+-win-$nodeArch\.zip)\s*$"
  $archiveName = $null
  foreach ($line in ($sums -split "`n")) {
    if ($line -match $pattern) { $archiveName = $Matches[1]; break }
  }
  if (-not $archiveName) { Fail "could not find Node $NodeMajor for windows/$Arch" }
  $archive = Join-Path $TempRoot $archiveName
  Invoke-Download "$baseUrl/$archiveName" $archive
  Assert-Checksum $archive (Get-ExpectedChecksum $sums $archiveName) "Node"
  $destination = Join-Path $TempRoot "toolchains\node"
  Expand-Archive -Force -Path $archive -DestinationPath $destination
  $nodeRoot = Get-ChildItem -Path $destination -Directory | Select-Object -First 1
  $env:PATH = $nodeRoot.FullName + ";" + $env:PATH
}

function Build-FromSource {
  $sourceRef = if ($Version -ne "latest") { $Version } else { $Ref }
  Say "No release binary available; falling back to source build of $Repo@$sourceRef (2-5 minutes)"
  Ensure-GoToolchain
  Ensure-NodeToolchain
  $archive = Join-Path $TempRoot "source.zip"
  $extractRoot = Join-Path $TempRoot "source-archive"
  Invoke-Download "https://github.com/$Repo/archive/$sourceRef.zip" $archive
  Expand-Archive -Force -Path $archive -DestinationPath $extractRoot
  $source = Get-ChildItem -Path $extractRoot -Directory | Select-Object -First 1
  if (-not $source) { Fail "the source archive was empty" }

  Push-Location (Join-Path $source.FullName "ui")
  try {
    & npm install --no-audit --no-fund --loglevel=error | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed" }
    & npm run build --silent | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "the UI build failed" }
  } finally { Pop-Location }

  $uiDist = Join-Path $source.FullName "ui\dist"
  $embedded = Join-Path $source.FullName "cmd\overseer\uidist"
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $embedded
  New-Item -ItemType Directory -Force -Path $embedded | Out-Null
  Copy-Item -Recurse -Force (Join-Path $uiDist "*") $embedded

  Push-Location $source.FullName
  try {
    & go build -ldflags "-s -w -X main.version=$sourceRef" -o $StagedBin ./cmd/overseer
    if ($LASTEXITCODE -ne 0) { Fail "the Go build failed" }
  } finally { Pop-Location }
  Ok "Built Overseer from source"
}

function Get-LanAddress {
  if (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue) {
    $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.PrefixOrigin -ne "WellKnown" } |
      Select-Object -First 1 -ExpandProperty IPAddress
    if ($ip) { return $ip }
  }
  return "localhost"
}

function Wait-Hub([string]$Port) {
  for ($i = 0; $i -lt $WaitSeconds; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/me" | Out-Null; return $true } catch { Start-Sleep -Seconds 1 }
  }
  return $false
}

$TempRoot = $null
try {
  if ($InstallSource -notin @("auto", "binary", "source")) { Fail "OVERSEER_INSTALL_SOURCE must be auto, binary, or source" }

  if ($Action -in @("uninstall", "remove")) {
    Write-Host ""
    Write-Host "Removing the Overseer hub"
    Write-Host ""
    Uninstall-Hub
    Write-Host ""
    return
  }

  $RawArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  $Arch = switch -Regex ($RawArch.ToLowerInvariant()) { "amd64|x64" { "amd64"; break } "arm64" { "arm64"; break } default { Fail "unsupported CPU: $RawArch" } }
  $Asset = "overseer_windows_$Arch"
  $TempRoot = Join-Path ([IO.Path]::GetTempPath()) ("overseer-install-" + [Guid]::NewGuid().ToString("N"))
  $StagedBin = Join-Path $TempRoot "overseer.exe"
  New-Item -ItemType Directory -Force -Path $TempRoot, $BinDir, $DataDir | Out-Null

  Write-Host ""
  Write-Host "Installing the Overseer hub"
  Write-Host ""

  if ($env:OVERSEER_LOCAL_BINARY) {
    if (-not (Test-Path -LiteralPath $env:OVERSEER_LOCAL_BINARY -PathType Leaf)) { Fail "local binary not found: $env:OVERSEER_LOCAL_BINARY" }
    Copy-Item -Force $env:OVERSEER_LOCAL_BINARY $StagedBin
    Ok "Using local binary $env:OVERSEER_LOCAL_BINARY"
  } else {
    $downloaded = $false
    if ($InstallSource -ne "source") { $downloaded = Get-ReleaseBinary }
    if (-not $downloaded) {
      if ($InstallSource -eq "binary") { Fail "no release binary is available for windows/$Arch" }
      Build-FromSource
    }
  }

  Stop-HubTask
  if (Test-Path -LiteralPath $Bin) { Copy-Item -Force $Bin $PreviousBin }
  Remove-Item -Force -ErrorAction SilentlyContinue "$Bin.update.json" # a manual install replaces any update in progress
  Move-Item -Force $StagedBin $Bin

  function Quote-PowerShellLiteral([string]$Value) { return $Value.Replace("'", "''") }
  $runnerLines = @(
    '$ErrorActionPreference = ''Stop''',
    '$env:OVERSEER_MANAGED = ''hub''',
    ("`$env:OVERSEER_WINDOWS_TASK = '" + (Quote-PowerShellLiteral $Task) + "'"),
    ("& '" + (Quote-PowerShellLiteral $Bin) + "' serve --addr '" + (Quote-PowerShellLiteral $Addr) + "' --data-dir '" + (Quote-PowerShellLiteral $DataDir) + "'")
  )
  Set-Content -Path $Runner -Value $runnerLines -Encoding UTF8
  # -WindowStyle Hidden keeps a console window off the desktop at every sign-in.
  $taskCommand = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Runner`""
  & schtasks.exe /Create /TN $Task /SC ONLOGON /TR $taskCommand /F | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "could not create the Scheduled Task $Task" }
  & schtasks.exe /Run /TN $Task | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "could not start the Scheduled Task $Task" }
  Ok "Installed the $Task task (starts at sign-in, updates itself)"

  $port = if ($Addr -match ':(\d+)$') { $Matches[1] } else { "4200" }
  $url = if ($Addr.StartsWith(':')) { "http://$(Get-LanAddress)$Addr" } else { "http://$Addr" }
  $state = if (Wait-Hub $port) { "is running" } else { "is installed but has not answered yet" }
  $code = (Get-Content -ErrorAction SilentlyContinue (Join-Path $DataDir "setup-code") | Select-Object -First 1)
  Write-Host ""
  Write-Host "Overseer hub $state."
  Write-Host ""
  if ($code) {
    Write-Host "  Open    $url/?setup=$($code.Trim())"
    Write-Host "  Code    $($code.Trim())   (only for choosing your password the first time)"
  } else {
    Write-Host "  Open    $url"
  }
  Write-Host ""
  Write-Host "  Remove  & ([scriptblock]::Create((irm $InstallerUrl))) uninstall"
  Write-Host ""
} catch {
  $message = $_.Exception.Message -replace '^overseer-abort: ', ''
  Write-Host ""
  Write-Host "  overseer: $message" -ForegroundColor Red
  Write-Host ""
  $global:LASTEXITCODE = 1
} finally {
  if ($TempRoot) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $TempRoot }
}
