import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { encoderNames, inside, peImports, requireTarget, sha256, sidecarName } from './engine-tools.mjs';
import {verifyHeicCodec} from './verify-heic-codec.mjs';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const manifestPath = inside(root, 'scripts/ffmpeg-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const options = process.argv.slice(2);
let explicitTarget;
let verifyOnly = false;
for (let i = 0; i < options.length; i++) {
  if (options[i] === '--target' && options[i + 1]) explicitTarget = options[++i];
  else if (options[i] === '--verify-only') verifyOnly = true;
  else throw new Error(`Unknown engine preparation option: ${options[i]}`);
}
const run = (program, args, binary=false) => {
  const result = spawnSync(program, args, { cwd: root, encoding: binary?undefined:'utf8', windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(program)} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  return result.stdout ?? '';
};
const target = requireTarget(explicitTarget ?? process.env.TAURI_ENV_TARGET_TRIPLE ?? process.env.CARGO_BUILD_TARGET ?? run('rustc', ['--print', 'host-tuple']).trim());
if (process.platform !== 'win32') throw new Error('Engine preparation currently requires a Windows build host. Use a Windows x64 CI runner.');
if (target !== manifest.target) throw new Error('Engine manifest target does not match the requested build target.');

async function directory(relative) {
  const folder = inside(root, relative);
  await mkdir(folder, { recursive: true });
  if ((await lstat(folder)).isSymbolicLink() || !(await realpath(folder)).toLowerCase().startsWith(root.toLowerCase() + path.sep)) throw new Error(`Unsafe generated directory: ${folder}`);
  return folder;
}
async function valid(file, expected) {
  try { if ((await lstat(file)).isSymbolicLink()) throw new Error(`Refusing symlink: ${file}`); return await sha256(file) === expected; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
const cache = await directory('.engine-cache');
const binaries = await directory('src-tauri/binaries');
const notices = inside(root, 'third-party/ffmpeg');
for (const [file, expected] of Object.entries(manifest.noticeFiles ?? {})) {
  if (!await valid(inside(notices, file), expected)) throw new Error(`Missing or modified required notice ${file}. Restore the tracked third-party/ffmpeg files before building.`);
}
const entries = Object.entries(manifest.binaries);
let stage;
try {
  const prepared = await Promise.all(entries.map(async ([name, binary]) => valid(inside(binaries, sidecarName(name, target)), binary.sha256)));
  if (!prepared.every(Boolean)) {
    if (verifyOnly) throw new Error('Bundled engines are missing or damaged. Run npm run engines:prepare before compiling.');
    const archive = inside(cache, manifest.archive.fileName);
    try { await access(archive); }
    catch {
      console.log(`Downloading pinned FFmpeg ${manifest.version} for ${target}…`);
      const partial = inside(cache, `${manifest.archive.fileName}.download-${process.pid}`);
      try {
        const response = await fetch(manifest.archive.url, { signal: AbortSignal.timeout(300000) });
        if (!response.ok || !response.body) throw new Error(`Engine archive download failed: HTTP ${response.status}.`);
        await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: 'wx' }));
        if (!await valid(partial, manifest.archive.sha256)) throw new Error('Downloaded archive SHA-256 mismatch. Extraction refused.');
        await rename(partial, archive);
      } finally { await rm(partial, { force: true }); }
    }
    if (!await valid(archive, manifest.archive.sha256)) throw new Error(`Cached archive SHA-256 mismatch. Extraction refused. Remove ${archive} and retry.`);
    console.log('Verified archive SHA-256; extracting only FFmpeg, FFprobe and the two upstream notice files.');
    stage = await mkdtemp(inside(cache, 'extract-'));
    const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', inside(root, 'scripts/extract-engines.ps1'), '-Archive', archive, '-Destination', stage]);
    for (const notice of manifest.archiveNotices) {
      if (!await valid(inside(stage, notice.file), notice.sha256) || !await valid(inside(notices, notice.file), notice.sha256)) throw new Error(`Upstream notice integrity check failed: ${notice.file}`);
    }
    for (const [name, binary] of entries) {
      const extracted = inside(stage, `${name}.exe`);
      if (!await valid(extracted, binary.sha256)) throw new Error(`Extracted ${name} checksum mismatch.`);
      const destination = inside(binaries, sidecarName(name, target));
      if (!await valid(destination, binary.sha256)) {
        const incoming = inside(binaries, `${sidecarName(name, target)}.preparing-${process.pid}`);
        try { await copyFile(extracted, incoming); await rename(incoming, destination); }
        finally { await rm(incoming, { force: true }); }
      }
    }
  } else console.log('Reusing hash-verified project-local sidecars; no download or extraction needed.');

  const imports = {};
  for (const [name] of entries) {
    const file = inside(binaries, sidecarName(name, target));
    const version = run(file, ['-version']);
    if (!version.startsWith(`${name} version ${manifest.version} `)) throw new Error(`Unexpected ${name} version.`);
    imports[name] = await peImports(file);
    if (JSON.stringify(imports[name]) !== JSON.stringify(manifest.systemDllImports[name])) throw new Error(`Unexpected DLL dependencies in ${name}.`);
  }
  const ffmpeg = inside(binaries, sidecarName('ffmpeg', target));
  const version = run(ffmpeg, ['-version']);
  const configuration = version.split(/\r?\n/).find(line => line.startsWith('configuration: '))?.slice(15);
  if (configuration !== manifest.configuration || !configuration.includes('--enable-static') || configuration.includes('--enable-shared') || configuration.includes('--enable-nonfree')) throw new Error('Unexpected or non-redistributable FFmpeg build configuration.');
  const encoders = encoderNames(run(ffmpeg, ['-hide_banner', '-encoders']));
  const missing = manifest.requiredEncoders.filter(name => !encoders.has(name));
  if (missing.length) throw new Error(`Bundled FFmpeg is missing required encoders: ${missing.join(', ')}.`);
  const heic=verifyHeicCodec(ffmpeg,inside(binaries,sidecarName('ffprobe',target)),run);
  console.log(`HEIC verified: ${heic.codec}, primary still, transforms and assembled grid; no additional decoder assets.`);
  await writeFile(inside(cache, 'prepared.json'), JSON.stringify({ target, version: manifest.version, manifestSha256: await sha256(manifestPath), archiveSha256: manifest.archive.sha256, binaries: manifest.binaries, imports, encoders: manifest.requiredEncoders }, null, 2) + '\n');
  console.log(`Prepared ${manifest.version}: both x64 executables, licenses and all ${manifest.requiredEncoders.length} required encoders verified.`);
} finally {
  if (stage) { inside(cache, path.relative(cache, stage)); await rm(stage, { recursive: true, force: true }); }
}
