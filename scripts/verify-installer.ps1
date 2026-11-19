param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$installerFull = [IO.Path]::GetFullPath($Installer)
if (-not $installerFull.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($installerFull) -ne '.msi') { throw 'Choose a project-local MSI file.' }
$inspection = Join-Path $root ('.engine-cache/installer-inspection/' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($inspection) | Out-Null
# Read the MSI database and embedded cabinets. This never invokes msiexec or installs anything.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class MsiReadOnly {
  [DllImport("msi.dll", CharSet=CharSet.Unicode, EntryPoint="MsiOpenDatabaseW")] static extern uint Open(string path, IntPtr mode, out uint db);
  [DllImport("msi.dll", CharSet=CharSet.Unicode, EntryPoint="MsiDatabaseOpenViewW")] static extern uint View(uint db, string sql, out uint view);
  [DllImport("msi.dll", EntryPoint="MsiViewExecute")] static extern uint Execute(uint view, uint record);
  [DllImport("msi.dll", EntryPoint="MsiViewFetch")] static extern uint Fetch(uint view, out uint record);
  [DllImport("msi.dll", CharSet=CharSet.Unicode, EntryPoint="MsiRecordGetStringW")] static extern uint GetString(uint record, uint field, StringBuilder value, ref uint length);
  [DllImport("msi.dll", EntryPoint="MsiRecordGetFieldCount")] static extern uint Fields(uint record);
  [DllImport("msi.dll", EntryPoint="MsiRecordReadStream")] static extern uint ReadStream(uint record, uint field, byte[] buffer, ref uint length);
  [DllImport("msi.dll", EntryPoint="MsiCloseHandle")] static extern uint Close(uint handle);
  static void Check(uint code) { if(code != 0) throw new Exception("MSI read failed: " + code); }
  static string Text(uint record, uint field) { uint count=0; GetString(record,field,null,ref count); var text=new StringBuilder((int)count+1); count++; Check(GetString(record,field,text,ref count)); return text.ToString(); }
  public static string[][] Query(string path, string sql) {
    uint db=0,view=0,record=0;
    try { Check(Open(path,IntPtr.Zero,out db)); Check(View(db,sql,out view)); Check(Execute(view,0)); var rows=new List<string[]>();
      uint result; while((result=Fetch(view,out record))==0) { try { var row=new string[Fields(record)]; for(uint i=0;i<row.Length;i++)row[i]=Text(record,i+1); rows.Add(row); } finally { Close(record); record=0; } }
      if(result!=259)Check(result); return rows.ToArray();
    } finally { if(record!=0)Close(record); if(view!=0)Close(view); if(db!=0)Close(db); }
  }
  public static void Cabinet(string path,string name,string output) {
    uint db=0,view=0,record=0;
    try { Check(Open(path,IntPtr.Zero,out db)); Check(View(db,"SELECT `Data` FROM `_Streams` WHERE `Name`='"+name.Replace("'","''")+"'",out view)); Check(Execute(view,0)); Check(Fetch(view,out record));
      using(var file=new FileStream(output,FileMode.CreateNew)) { var buffer=new byte[65536]; while(true) {uint count=(uint)buffer.Length;Check(ReadStream(record,1,buffer,ref count));if(count==0)break;file.Write(buffer,0,(int)count);} }
    } finally { if(record!=0)Close(record); if(view!=0)Close(view); if(db!=0)Close(db); }
  }
}
'@
function FileHash([string]$file) {
    $stream = [IO.File]::OpenRead($file); $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose(); $stream.Dispose() }
}
$payload = Join-Path $inspection 'payload'
[IO.Directory]::CreateDirectory($payload) | Out-Null
$media = [MsiReadOnly]::Query($installerFull, 'SELECT `Cabinet` FROM `Media`')
foreach ($row in $media) {
    if (-not $row[0].StartsWith('#')) { throw 'Expected an embedded MSI cabinet.' }
    $cabinet = Join-Path $inspection ([Guid]::NewGuid().ToString('N') + '.cab')
    [MsiReadOnly]::Cabinet($installerFull, $row[0].Substring(1), $cabinet)
    & (Join-Path $env:SystemRoot 'System32/expand.exe') '-F:*' $cabinet $payload | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect cabinet payload.' }
}
$files = [MsiReadOnly]::Query($installerFull, 'SELECT `File`,`FileName`,`Component_` FROM `File`')
$components = @{}; foreach ($row in [MsiReadOnly]::Query($installerFull, 'SELECT `Component`,`Directory_` FROM `Component`')) { $components[$row[0]] = $row[1] }
$directories = @{}; foreach ($row in [MsiReadOnly]::Query($installerFull, 'SELECT `Directory`,`Directory_Parent`,`DefaultDir` FROM `Directory`')) { $directories[$row[0]] = @($row[1], ($row[2] -split '\|')[-1]) }
function DirectoryPath([string]$id) {
    $parts = @(); $seen = @{}
    while ($id -and $directories.ContainsKey($id)) {
        if ($seen.ContainsKey($id)) { throw 'Invalid MSI directory cycle.' }; $seen[$id] = $true
        $row = $directories[$id]; if ($row[1] -ne '.') { $parts = @($row[1]) + $parts }; $id = $row[0]
    }
    return $parts -join '\'
}
$records = @{}
foreach ($row in $files) {
    $name = ($row[1] -split '\|')[-1]
    $file = Join-Path $payload $row[0]
    if (-not [IO.File]::Exists($file)) { throw ('Cabinet payload missing: ' + $name) }
    if ($records.ContainsKey($name)) { throw ('Ambiguous packaged filename: ' + $name) }
    $records[$name] = @{ name=$name; sha256=(FileHash $file); directory=(DirectoryPath $components[$row[2]]) }
}
$manifest = [IO.File]::ReadAllText((Join-Path $root 'scripts/ffmpeg-manifest.json')) | ConvertFrom-Json
$app = $records['clip-clip-go.exe']; if (-not $app) { throw 'Application executable missing from installer.' }
foreach ($engine in @('ffmpeg','ffprobe')) {
    $item = $records[$engine + '.exe']
    if (-not $item -or $item.sha256 -ne $manifest.binaries.$engine.sha256 -or $item.directory -ne $app.directory) { throw ('Sidecar missing, changed or outside the app directory: ' + $engine) }
}
foreach ($file in [IO.Directory]::GetFiles((Join-Path $root 'third-party/ffmpeg'))) {
    $name = [IO.Path]::GetFileName($file); $item = $records[$name]
    if (-not $item -or $item.sha256 -ne (FileHash $file) -or $item.directory -notmatch 'notices\\ffmpeg$') { throw ('Packaged notice missing, changed or incorrectly located: ' + $name) }
}
$result = @{ installer=$installerFull; sha256=(FileHash $installerFull); files=@($records.Values | Sort-Object name); installed=$false; inspection=$inspection }
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $inspection 'verification.json') -Encoding UTF8
Write-Output ('PASS: MSI payload verified without installation: app, both exact sidecars and all FFmpeg notices (' + $records.Count + ' files).')
Write-Output ('Receipt: ' + (Join-Path $inspection 'verification.json'))
