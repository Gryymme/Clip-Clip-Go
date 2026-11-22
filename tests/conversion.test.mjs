import test from 'node:test';
import assert from 'node:assert/strict';
import { jobIsBusy, mergeJob, displayDuration, isEngineFormat, isMediaFile } from '../src/converter/conversion.ts';
import { initialSelection, selectionReducer } from '../src/converter/selection.ts';

const job = (phase, revision = 1, id = 1) => ({ id, revision, phase, inputPath: 'C:\\Media\\source.mp4', destination: null, format: 'mp4', duration: null, seconds: 0, percent: null, message: phase });

test('only terminal job states unlock the input controls', () => {
  for (const phase of ['validating', 'choosingDestination', 'running', 'verifying', 'cancelling']) assert.equal(jobIsBusy(job(phase)), true);
  for (const phase of ['succeeded', 'failed', 'cancelled']) assert.equal(jobIsBusy(job(phase)), false);
  assert.equal(jobIsBusy(null), false);
});

test('late polling and start responses cannot regress a job or replace a newer job', () => {
  const done = job('succeeded', 8);
  assert.equal(mergeJob(done, job('running', 2)), done);
  assert.equal(mergeJob(done, null), done);
  const next = job('validating', 0, 2);
  assert.equal(mergeJob(done, next), next);
  assert.equal(mergeJob(next, done), next);
});

test('unknown duration stays unknown instead of becoming fabricated progress', () => {
  assert.equal(displayDuration(null), 'Unknown duration');
  assert.equal(displayDuration(NaN), 'Unknown duration');
  assert.equal(displayDuration(0), '0:00');
  assert.equal(displayDuration(3723.5), '62:03');
});

test('only audio/video categories and typed engine formats are convertible', () => {
  for (const category of ['audio', 'video']) assert.equal(isMediaFile({ category }), true);
  for (const category of ['image', 'document']) assert.equal(isMediaFile({ category }), false);
  assert.equal(isMediaFile(null), false);
  for (const format of ['mp4', 'mkv', 'webm', 'gif', 'mp3', 'wav', 'flac', 'm4a']) assert.equal(isEngineFormat(format), true);
  for (const format of ['png', 'pdf', 'csv', 'ogg', '']) assert.equal(isEngineFormat(format), false);
});

test('a locked selection cannot be removed, replaced or reformatted until the job ends', () => {
  const file = { name: 'source.mp4', path: 'C:\\Media\\source.mp4', sizeBytes: '1024' };
  const selected = selectionReducer(selectionReducer(initialSelection, { type: 'start' }), { type: 'selected', file });
  const locked = selectionReducer(selected, { type: 'lock', locked: true });
  for (const action of [{ type: 'start' }, { type: 'remove' }, { type: 'output', format: 'flac' }, { type: 'selected', file: { ...file, name: 'new.mp4' } }, { type: 'failed', message: 'late error' }]) assert.equal(selectionReducer(locked, action), locked);
  const unlocked = selectionReducer(locked, { type: 'lock', locked: false });
  assert.equal(selectionReducer(unlocked, { type: 'output', format: 'flac' }).output, 'flac');
});
