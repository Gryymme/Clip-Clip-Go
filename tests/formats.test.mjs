import test from 'node:test';
import assert from 'node:assert/strict';
import { categorizeFile, identifyFile, normalizeExtension, inputExtensions, inputGroups, outputFormats, outputGroups, outputHelp, isCompatible } from '../src/converter/formats.ts';

const inputCategories = {
  video: ['mp4', 'mkv', 'webm', 'mov'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'ogg'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'heic'],
  document: ['txt', 'pdf', 'md', 'markdown', 'html', 'htm'],
};

test('all supported input extensions are categorized case-insensitively', () => {
  assert.deepEqual([...inputExtensions].sort(), Object.values(inputCategories).flat().sort());
  assert.equal(new Set(inputExtensions).size, inputExtensions.length);
  for (const [category, extensions] of Object.entries(inputCategories)) {
    for (const extension of extensions) {
      assert.equal(categorizeFile(`Review.2026.最終版.${extension.toUpperCase()}`), category);
      assert.equal(categorizeFile(`review.${extension}`), category);
    }
  }
});

test('unknown, absent and misleading final extensions are rejected', () => {
  for (const name of ['report.csv', 'photo.heif', 'movie.mp4.exe', 'report.docx.zip', 'file', 'movie.', '', 'movie.mp4 ']) {
    assert.equal(categorizeFile(name), null, name);
  }
});

test('compatibility matrix permits video outputs and audio extraction only as requested', () => {
  for (const input of inputCategories.video) {
    assert.deepEqual(outputFormats(input), ['mp4', 'mkv', 'webm', 'gif', 'mp3', 'wav', 'flac', 'm4a']);
  }
  for (const input of inputCategories.audio) {
    assert.deepEqual(outputFormats(input), ['mp3', 'wav', 'flac', 'm4a']);
  }
  for (const input of [...inputCategories.video, ...inputCategories.audio]) {
    for (const format of ['mp4', 'mkv', 'webm', 'gif', 'mp3', 'wav', 'flac', 'm4a', 'ogg', 'mov', 'exe', '']) {
      assert.equal(isCompatible(input, format), outputFormats(input).includes(format));
    }
  }
});

test('extension aliases normalize without changing the input filename', () => {
  for (const [extension, format] of [['JPEG', 'jpg'], ['jPeG', 'jpg'], ['JPG', 'jpg'], ['TiF', 'tiff'], ['TIFF', 'tiff']]) {
    assert.equal(normalizeExtension(extension), format);
    assert.deepEqual(identifyFile(`Untouched.${extension}`), { category: 'image', format });
  }
  for (const extension of ['constructor', '__proto__', 'exe', 'jpeg ', '']) assert.equal(normalizeExtension(extension), null);
});

const expectedRoutes = {
  jpg: ['jpg', 'png', 'webp', 'bmp', 'tiff'],
  png: ['jpg', 'png', 'webp', 'bmp', 'tiff'],
  webp: ['jpg', 'png', 'webp', 'bmp', 'tiff'],
  bmp: ['jpg', 'png', 'webp', 'bmp', 'tiff'],
  tiff: ['jpg', 'png', 'webp', 'bmp', 'tiff'],
  heic: ['jpg', 'png', 'webp', 'bmp', 'tiff'],
  txt: ['md', 'html', 'pdf'],
  pdf: ['txt', 'md', 'html', 'png', 'jpg'],
};

for (const [input, expected] of Object.entries(expectedRoutes)) {
  test(`${input.toUpperCase()} offers exactly its implemented routes`, () => {
    assert.deepEqual(outputFormats(input), expected);
    for (const output of [...inputExtensions, 'csv', 'ocr', 'exe', '']) {
      assert.equal(isCompatible(input, output), expected.includes(output), `${input} -> ${output}`);
    }
  });
}

test('UI output groups exactly match route rules and preserve audio extraction grouping', () => {
  for (const extension of inputExtensions) {
    const input = normalizeExtension(extension);
    assert.deepEqual(outputGroups(input).flatMap(group => group.formats), outputFormats(input));
  }
  assert.deepEqual(outputGroups('mov').map(group => group.label), ['Video', 'Extract audio']);
  assert.deepEqual(inputGroups.flatMap(group => group.extensions).sort(), [...inputExtensions].sort());
});

test('redundant reconstruction helpers are absent while PDF rendering notes remain', () => {
  for (const format of ['txt','md','html']) {
    assert.equal(outputHelp('pdf',format),'');
  }
  for (const format of ['png','jpg']) assert.match(outputHelp('pdf',format),/150 DPI/);
  for (const name of ['report.doc','report.docx','report.odt','sheet.xlsx','slides.pptx','notes.rtf','sheet.ods','slides.odp']) assert.equal(identifyFile(name),null);
});
