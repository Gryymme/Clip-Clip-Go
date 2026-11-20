param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[System.IO.Compression.ZipFile]::OpenRead($Archive)
try {
  $entry=$zip.GetEntry('deno.exe')
  if($null -eq $entry){throw 'Missing deno.exe'}
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $Destination 'deno.exe'),$false)
} finally {$zip.Dispose()}
