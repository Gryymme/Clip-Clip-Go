import test from 'node:test';
import assert from 'node:assert/strict';
import { categorizeFile, inputExtensions, outputFormats, isCompatible } from '../src/converter/formats.ts';

test('all supported input extensions are categorized case-insensitively', () => {
  assert.deepEqual(inputExtensions, ['mp4', 'mkv', 'webm', 'mov', 'mp3', 'wav', 'flac', 'm4a', 'ogg']);
  for (const extension of inputExtensions) {
    const category = ['mp4', 'mkv', 'webm', 'mov'].includes(extension) ? 'video' : 'audio';
    assert.equal(categorizeFile(`Film.2026.最終版.${extension.toUpperCase()}`), category);
  }
});

test('unknown, absent and misleading final extensions are rejected', () => {
  for (const name of ['report.pdf', 'movie.mp4.exe', 'file', 'movie.', '', 'movie.mp4 ']) {
    assert.equal(categorizeFile(name), null, name);
  }
});

test('compatibility matrix permits video outputs and audio extraction only as requested', () => {
  assert.deepEqual(outputFormats('video'), ['mp4', 'mkv', 'webm', 'mp3', 'wav', 'flac', 'm4a']);
  assert.deepEqual(outputFormats('audio'), ['mp3', 'wav', 'flac', 'm4a']);
  for (const category of ['video', 'audio']) {
    for (const format of ['mp4', 'mkv', 'webm', 'mp3', 'wav', 'flac', 'm4a', 'ogg', 'mov', 'exe', '']) {
      assert.equal(isCompatible(category, format), outputFormats(category).includes(format));
    }
  }
});
