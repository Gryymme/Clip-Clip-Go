import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSelection, selectionReducer as reduce, selectionError, formatFileSize } from '../src/converter/selection.ts';

const file = (name = 'movie.MP4') => ({ name, path: `C:\\Media\\${name}`, sizeBytes: '1024' });
const select = (state, chosen) => reduce(reduce(state, { type: 'start' }), { type: 'selected', file: chosen });

test('selection supplies a category and default compatible output', () => {
  assert.deepEqual(initialSelection.file, null);
  assert.equal(initialSelection.output, '');
  const video = select(initialSelection, file());
  assert.equal(video.file.category, 'video');
  assert.equal(video.output, 'mp4');
  const audio = select(initialSelection, file('track.ogg'));
  assert.equal(audio.file.category, 'audio');
  assert.equal(audio.output, 'mp3');
});

test('cancel preserves empty state, or current file and output', () => {
  for (const state of [initialSelection, reduce(select(initialSelection, file()), { type: 'output', format: 'flac' })]) {
    const cancelled = select(state, null);
    assert.deepEqual(cancelled.file, state.file);
    assert.equal(cancelled.output, state.output);
    assert.equal(cancelled.selecting, false);
    assert.equal(cancelled.error, null);
  }
});

test('replacement preserves compatible output and resets an incompatible one', () => {
  const video = reduce(select(initialSelection, file()), { type: 'output', format: 'webm' });
  const audio = select(video, file('track.mp3'));
  assert.equal(audio.output, 'mp3');
  const flac = reduce(audio, { type: 'output', format: 'flac' });
  assert.equal(select(flac, file('other.mov')).output, 'flac');
});

test('unsupported files and native errors keep the previous usable selection', () => {
  for (const before of [initialSelection, select(initialSelection, file())]) {
    const unsupported = select(before, file('report.exe'));
    assert.match(unsupported.error, /Unsupported file extension/);
    assert.deepEqual(unsupported.file, before.file);
    assert.equal(unsupported.output, before.output);
    const failed = reduce(reduce(before, { type: 'start' }), { type: 'failed', message: selectionError({ code: 'missingFile' }) });
    assert.match(failed.error, /could not be found/);
    assert.deepEqual(failed.file, before.file);
    assert.equal(failed.output, before.output);
    assert.equal(failed.selecting, false);
  }
});

test('invalid output, busy changes and unsolicited completion cannot alter selection', () => {
  assert.equal(reduce(initialSelection, { type: 'selected', file: file() }), initialSelection);
  assert.equal(reduce(initialSelection, { type: 'output', format: 'mp4' }), initialSelection);
  const audio = select(initialSelection, file('track.wav'));
  assert.equal(reduce(audio, { type: 'output', format: 'mp4' }), audio);
  const busy = reduce(audio, { type: 'start' });
  assert.equal(reduce(busy, { type: 'output', format: 'flac' }), busy);
  assert.equal(reduce(busy, { type: 'remove' }), busy);
});

test('remove clears file, output and errors; a new selection starts clean', () => {
  const errored = select(select(initialSelection, file()), file('bad.exe'));
  const removed = reduce(errored, { type: 'remove' });
  assert.equal(removed.file, null);
  assert.equal(removed.output, '');
  assert.equal(removed.error, null);
  assert.equal(select(removed, file('new.wav')).output, 'mp3');
});

test('error messages are actionable and hide raw native failures', () => {
  for (const code of ['desktopRequired', 'missingFile', 'notAFile', 'permissionDenied', 'metadataError']) {
    assert.ok(selectionError({ code }).length > 30);
  }
  assert.equal(selectionError('raw stack trace'), selectionError({ code: 'unknown' }));
});

test('file sizes handle zero, singular, large values and exact byte counts', () => {
  assert.equal(formatFileSize('0'), '0 bytes');
  assert.equal(formatFileSize('1'), '1 byte');
  assert.match(formatFileSize('1024'), /1 KiB/);
  assert.match(formatFileSize('18446744073709551615'), /EiB/);
  assert.ok(formatFileSize('9007199254740993').includes(new Intl.NumberFormat().format(9007199254740993n)));
});

test('image aliases retain original metadata and a canonical input format', () => {
  for (const [name, format] of [['最終版本.JpEg', 'jpg'], ['scan.TIF', 'tiff']]) {
    const native = { ...file(name), sizeBytes: '0' };
    const selected = select(initialSelection, native);
    assert.equal(selected.file.category, 'image');
    assert.equal(selected.file.format, format);
    assert.equal(selected.file.name, native.name);
    assert.equal(selected.file.path, native.path);
    assert.equal(selected.file.sizeBytes, native.sizeBytes);
    assert.equal(selected.output, 'jpg');
  }
});

test('unsupported Office selection preserves the previous working file and output', () => {
  const before=select(initialSelection,file('notes.txt'));
  for (const name of ['report.docx','budget.xlsx','slides.odp','old.rtf']) {
    const next=select(before,file(name));
    assert.deepEqual(next.file,before.file);assert.equal(next.output,before.output);
    assert.match(next.error,/Office and OpenDocument files are not supported/);
  }
});
test('replacement across categories retains only still-valid output choices', () => {
  const image = reduce(select(initialSelection, file('photo.jpeg')), { type: 'output', format: 'png' });
  const pdf = select(image, file('report.pdf'));
  assert.equal(pdf.output, 'png');
  assert.equal(select(pdf, file('photo.tif')).output, 'png');
  const audio = select(image, file('music.ogg'));
  assert.equal(audio.output, 'mp3');
  assert.equal(reduce(audio, { type: 'output', format: 'png' }), audio);
});

test('cancel, errors and removal preserve the same guarantees for the new categories', () => {
  for (const name of ['photo.jpeg', 'scan.tif', 'notes.txt', 'readme.markdown', 'page.htm', 'report.pdf']) {
    const original = select(initialSelection, file(name));
    const cancelled = select(original, null);
    assert.deepEqual(cancelled.file, original.file);
    assert.equal(cancelled.output, original.output);
    const failed = reduce(reduce(original, { type: 'start' }), { type: 'failed', message: 'Unable to access file.' });
    assert.deepEqual(failed.file, original.file);
    assert.equal(failed.output, original.output);
    const unsupported = select(original, file('unrelated.zip'));
    assert.deepEqual(unsupported.file, original.file);
    assert.equal(unsupported.output, original.output);
    const removed = reduce(original, { type: 'remove' });
    assert.equal(removed.file, null);
    assert.equal(removed.output, '');
  }
});
