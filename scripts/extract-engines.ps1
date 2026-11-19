param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$cacheRoot = Join-Path $projectRoot '.engine-cache'
$archiveFull = [System.IO.Path]::GetFullPath($Archive)
$destinationFull = [System.IO.Path]::GetFullPath($Destination)
if (-not $archiveFull.StartsWith($cacheRoot + '\', [System.StringComparison]::OrdinalIgnoreCase) -or -not $destinationFull.StartsWith($cacheRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Extraction must stay in the project engine cache.' }
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ffmpeg-manifest.json') -Raw | ConvertFrom-Json
$stream = [System.IO.File]::OpenRead($archiveFull)
$hash = [System.Security.Cryptography.SHA256]::Create()
try { $actual = [System.BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
finally { $hash.Dispose(); $stream.Dispose() }
if ($actual -ne $manifest.archive.sha256) { throw 'Archive checksum mismatch; extraction refused.' }
[System.IO.Directory]::CreateDirectory($destinationFull) | Out-Null
$entries = @(@{ Source='bin/ffmpeg.exe'; Name='ffmpeg.exe' }, @{ Source='bin/ffprobe.exe'; Name='ffprobe.exe' })
foreach ($notice in $manifest.archiveNotices) { $entries += @{ Source=$notice.entry; Name=$notice.file } }
$zip = [System.IO.Compression.ZipFile]::OpenRead($archiveFull)
try {
    foreach ($item in $entries) {
        $entry = $zip.GetEntry($manifest.archive.root + '/' + $item.Source)
        if (-not $entry -or $entry.Length -le 0) { throw ('Required archive entry missing: ' + $item.Source) }
        if ([System.IO.Path]::GetFileName($item.Name) -ne $item.Name) { throw 'Only flat, explicitly named extraction entries are allowed.' }
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $destinationFull $item.Name), $false)
    }
} finally { $zip.Dispose() }
