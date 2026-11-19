import type { OutputFormat } from './formats.ts';
import type { SelectedFile } from './selection.ts';

export const engineFormats = ['mp4', 'mkv', 'webm', 'mp3', 'wav', 'flac', 'm4a'] as const;
export type EngineFormat = (typeof engineFormats)[number];
export interface Availability { format: EngineFormat; available: boolean; reason: string | null }
export interface EngineReport {
  ready: boolean; ffmpegVersion: string | null; ffprobeVersion: string | null;
  folder: string | null; formats: Availability[]; message: string;
}
export interface MediaInfo {
  duration: number | null; video: { index: number; codec: string } | null;
  audio: { index: number; codec: string } | null; container: string; formats: Availability[];
}
export type JobPhase = 'validating' | 'choosingDestination' | 'running' | 'verifying' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled';
export interface ConversionJob {
  id: number; revision: number; phase: JobPhase; inputPath: string; destination: string | null;
  format: EngineFormat; duration: number | null; seconds: number; percent: number | null; message: string;
}
export function isMediaFile(file: SelectedFile | null): boolean { return file?.category === 'audio' || file?.category === 'video'; }
export function isEngineFormat(format: OutputFormat | ''): format is EngineFormat { return (engineFormats as readonly string[]).includes(format); }
export function jobIsBusy(job: ConversionJob | null): boolean {
  return job !== null && !['succeeded', 'failed', 'cancelled'].includes(job.phase);
}
export function mergeJob(previous: ConversionJob | null, next: ConversionJob | null): ConversionJob | null {
  if (!next) return previous;
  if (!previous || next.id > previous.id || (next.id === previous.id && next.revision >= previous.revision)) return next;
  return previous;
}
export function displayDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return 'Unknown duration';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
export function nativeError(error: unknown): string {
  return typeof error === 'string' ? error : 'The native operation could not be completed. Try again in the desktop app.';
}
