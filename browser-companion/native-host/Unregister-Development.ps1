param([Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$desktopExe = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'src-tauri/target/debug/clip-clip-go.exe')).Path
$nativeHostExe = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'src-tauri/target/debug/clipclipgo-native-host.exe')).Path
$ownedDirectory = [IO.Path]::GetFullPath((Join-Path $projectRoot '.browser-companion/chrome'))
Write-Host 'Removing only verified ClipClipGO-owned development bridge registration and files.'
& $nativeHostExe '--unregister-development' $ExtensionId $desktopExe $ownedDirectory
if ($LASTEXITCODE -ne 0) { throw 'Removal failed. Close the companion connection and read the host error.' }
