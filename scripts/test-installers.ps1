$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$TempRoot = Join-Path ([IO.Path]::GetTempPath()) ("overseer-installer-test-" + [Guid]::NewGuid().ToString("N"))
$SourceTree = Join-Path $TempRoot "source\overseer-main"
$SourceZip = Join-Path $TempRoot "source.zip"
$FakeBinary = Join-Path $TempRoot "fake-overseer.exe"
$InstallBase = Join-Path $TempRoot "Install Root With Spaces"
New-Item -ItemType Directory -Force -Path (Join-Path $SourceTree "ui\dist"), (Join-Path $SourceTree "cmd\overseer\uidist") | Out-Null
Set-Content -Path (Join-Path $SourceTree "ui\dist\index.html") -Value '<!doctype html><title>fixture</title>' -Encoding UTF8
Set-Content -Path (Join-Path $SourceTree "cmd\overseer\uidist\.gitkeep") -Value 'fixture' -Encoding UTF8
Compress-Archive -Path (Join-Path $TempRoot "source\overseer-main") -DestinationPath $SourceZip
if ($IsWindows) {
  $fakeSource = Join-Path $TempRoot "fake-overseer.go"
  Set-Content -Path $fakeSource -Value 'package main; import("fmt"; "os"); func main(){ if len(os.Args)>1 && os.Args[1]=="version" { fmt.Println("overseer test-installer") } }' -Encoding UTF8
  & go build -o $FakeBinary $fakeSource
  if ($LASTEXITCODE -ne 0) { throw "could not build Windows installer fixture" }
} else {
  Set-Content -Path $FakeBinary -Value @('#!/bin/sh', 'if [ "$1" = version ]; then echo "overseer test-installer"; fi') -Encoding UTF8
  & chmod +x $FakeBinary
}

$env:PROCESSOR_ARCHITECTURE = if ($IsWindows) { "AMD64" } else { "ARM64" }
$env:LOCALAPPDATA = $InstallBase
$env:OVERSEER_INSTALL_SOURCE = "auto"
$env:OVERSEER_DATA_DIR = Join-Path $InstallBase "Data & State"
$env:OVERSEER_BIN_DIR = Join-Path $InstallBase "Programs"

function global:Invoke-WebRequest {
  param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile)
  if ($Uri -match '/releases/') { throw "simulated release 404" }
  if ($Uri -match '/archive/') { Copy-Item -Force $SourceZip $OutFile; return }
  throw "unexpected URL in installer test: $Uri"
}
function global:schtasks.exe { $global:LASTEXITCODE = 0 }
function global:go {
  if ($args[0] -eq 'env') { return 'go1.25.0' }
  if ($args[0] -eq 'build') {
    $index = [Array]::IndexOf($args, '-o')
    Copy-Item -Force $FakeBinary $args[$index + 1]
    if (-not $IsWindows) { & chmod +x $args[$index + 1] }
    $global:LASTEXITCODE = 0
    return
  }
  throw "unexpected go invocation: $args"
}
function global:node { return 'v20.19.4' }
function global:npm { $global:LASTEXITCODE = 0 }

try {
  $output = & (Join-Path $Root "scripts\install.ps1") 6>&1 | Out-String
  if ($output -notmatch 'falling back to source build') { throw "Windows installer did not exercise the source fallback" }
  $installed = Join-Path $env:OVERSEER_BIN_DIR "overseer.exe"
  $runner = Join-Path $env:OVERSEER_BIN_DIR "overseer-hub.ps1"
  if (-not (Test-Path $installed)) { throw "Windows binary was not installed" }
  if (-not (Test-Path $runner)) { throw "Windows task runner was not created" }
  $runnerText = Get-Content -Raw $runner
  if ($runnerText -notmatch [regex]::Escape($env:OVERSEER_DATA_DIR)) { throw "Windows task runner lost the data path" }
  & (Join-Path $Root "scripts\install.ps1") uninstall | Out-Null
  if (Test-Path $installed) { throw "Windows uninstall left the binary behind" }
  Write-Host "installer-windows: ok (release 404 -> source fallback -> quoted task -> uninstall)"
} finally {
  Remove-Item Function:\Invoke-WebRequest -ErrorAction SilentlyContinue
  Remove-Item Function:\schtasks.exe -ErrorAction SilentlyContinue
  Remove-Item Function:\go -ErrorAction SilentlyContinue
  Remove-Item Function:\node -ErrorAction SilentlyContinue
  Remove-Item Function:\npm -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $TempRoot
}
