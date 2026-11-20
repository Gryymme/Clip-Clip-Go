import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requireTarget, sidecarName, inside, verifyHash, encoderNames } from '../scripts/engine-tools.mjs';

test('sidecars require the Windows x64 MSVC target and Tauri suffix', () => {
  assert.equal(sidecarName('ffmpeg', 'x86_64-pc-windows-msvc'), 'ffmpeg-x86_64-pc-windows-msvc.exe');
  for (const target of ['aarch64-pc-windows-msvc', 'x86_64-pc-windows-gnu', 'x86_64-unknown-linux-gnu', '']) assert.throws(() => requireTarget(target), /Unsupported engine target/);
});
test('generated paths cannot escape their owning directory', () => {
  const root = path.resolve('.engine-cache');
  assert.equal(inside(root, 'archive.zip'), path.join(root, 'archive.zip'));
  assert.throws(() => inside(root, '..', 'README.md'), /outside/);
});
test('hash validation accepts exact content and rejects damage before extraction', async () => {
  const root = path.resolve('.engine-cache/tests');
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, 'checksum-'));
  try {
    const file = path.join(dir, 'fixture');
    await writeFile(file, 'verified');
    const hash = createHash('sha256').update('verified').digest('hex');
    await verifyHash(file, hash);
    await writeFile(file, 'damaged');
    await assert.rejects(verifyHash(file, hash), /SHA-256 mismatch/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('encoder parser ignores legends and accepts actual audio/video encoders', () => {
  assert.deepEqual([...encoderNames(' V..... = Video\n V....D libx264 description\n A....D aac description\n S..... ass description')], ['libx264', 'aac']);
});
test('pinned engine manifest and nonrecursive Tauri preparation hooks agree', async () => {
  const manifest = JSON.parse(await readFile(new URL('../scripts/ffmpeg-manifest.json', import.meta.url)));
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.match(manifest.archive.sha256, /^[a-f0-9]{64}$/);
  assert.ok(!manifest.archive.url.includes('latest'));
  assert.equal(manifest.source.completeCorrespondingSourceAssembled, false);
  assert.deepEqual(config.bundle.externalBin, ['binaries/ffmpeg', 'binaries/ffprobe', 'binaries/yt-dlp', 'binaries/deno']);
  assert.ok(config.bundle.resources['../third-party/ffmpeg/']);
  assert.equal(config.build.beforeDevCommand, 'npm run desktop:dev');
  assert.equal(config.build.beforeBuildCommand, 'npm run desktop:build');
  assert.equal(pkg.scripts['desktop:dev'], 'npm run engines:prepare && npm run downloader:prepare && npm run pdf:prepare && npm run dev');
  assert.equal(pkg.scripts['desktop:build'], 'npm run engines:prepare && npm run downloader:prepare && npm run pdf:prepare && npm run build');
});
