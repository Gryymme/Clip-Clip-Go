import type {PreviewState} from '../converter/preview.ts';
import type {SelectedFile} from '../converter/selection.ts';
import type { ConversionJob } from '../converter/conversion.ts';
import type { DownloadJob } from '../downloader/model.ts';
export type TaskType = 'Converter' | 'Images to PDF' | 'Merge PDF' | 'Downloader';
export type Status = 'waiting' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';
export interface Progress { stage: string; percent: number | null; destination?: string; conversion?: ConversionJob; download?: DownloadJob; }
export interface Entry extends Progress {
  id: string; type: TaskType; title: string; source: string; destination: string;
  status: Status; error?: string;
  attemptId?:string; startedAt?:number; finishedAt?:number; summary?:string; sourceHost?:string;
  thumbnail?: {category:SelectedFile['category']; state:PreviewState};
}
export interface Execution {
  run: (signal: AbortSignal, update: (progress: Progress) => void) => Promise<void>;
  dispose?: () => Promise<void>;
}
export const finished = (s: Status) => ['completed', 'failed', 'cancelled'].includes(s);
// A scheduler instance owns work, never a component/effect. Public entries contain no execution inputs.
export class Scheduler {
  private entries: Entry[] = [];
  private executions = new Map<string, Execution>();
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private activeId?: string;
  private sequence = 0;
  private sessionId = crypto.randomUUID();
  private terminalListeners = new Set<(entry:Entry)=>void>();
  onTerminal = (listener:(entry:Entry)=>void) => {this.terminalListeners.add(listener);return ()=>{this.terminalListeners.delete(listener);};};
  private stopped = false;
  private keys = new Map<string, string>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = (): readonly Entry[] => this.entries;
  private emit() { this.entries = [...this.entries]; this.listeners.forEach(f => f()); }
  private patch(id: string, change: Partial<Entry>) { this.entries = this.entries.map(e => e.id === id ? {...e, ...change} : e); this.emit(); }
  submitSnapshot<T>(metadata: Omit<Entry, 'id' | 'status' | 'stage' | 'percent'>, payload: T,
    run: (snapshot: T, signal: AbortSignal, update: (progress: Progress) => void) => Promise<void>, key?: string) {
    const snapshot = structuredClone(payload);
    return this.submit(metadata, {run:(signal, update) => run(snapshot, signal, update)}, key);
  }
  submit(metadata: Omit<Entry, 'id' | 'status' | 'stage' | 'percent'>, execution: Execution, key?: string) {
    if (this.stopped) throw Error('The application is closing.');
    if (key && this.keys.has(key)) { void execution.dispose?.().catch(() => {}); return this.keys.get(key)!; }
    const id = `session-${++this.sequence}`;
    if (key) this.keys.set(key, id);
    this.entries.push({...structuredClone(metadata), id, status:'waiting', stage:'Waiting', percent:null});
    this.executions.set(id, execution); this.emit(); void this.pump(); return id;
  }
  private async pump() {
    if (this.activeId || this.stopped) return;
    const next = this.entries.find(e => e.status === 'waiting');
    if (!next) return;
    const {id} = next, execution = this.executions.get(id)!;
    this.activeId = id; const controller = this.controller = new AbortController();
    this.patch(id, {attemptId:`${this.sessionId}-${this.sequence}-${id}`, startedAt:Date.now(), status:'running', stage:'Preparing', percent:null});
    let status: Status = 'completed', error: string | undefined;
    try { await execution.run(controller.signal, p => this.patch(id, {...p, ...(controller.signal.aborted ? {stage:'Cancelling and cleaning up…', percent:null} : {})})); }
    catch (cause) { status = controller.signal.aborted ? 'cancelled' : 'failed'; error = status === 'failed' ? safeError(cause) : undefined; }
    // Runners settle only after native cleanup/publication. A late cancel cannot undo a committed output.
    try { await execution.dispose?.(); } catch { /* Native shutdown also discards remaining tickets. */ }
    this.executions.delete(id);
    for (const [key, value] of this.keys) if (value === id) this.keys.delete(key);
    const terminal:Entry={...this.entries.find(e=>e.id===id)!,finishedAt:Date.now(),status,error,stage:status==='completed'?'Output saved and validated.':status==='cancelled'?'Cancelled.':error!,percent:null};
    this.patch(id,terminal);
    for(const listener of this.terminalListeners){try{listener(terminal);}catch{/* History cannot interrupt scheduling. */}}
    this.activeId = undefined; this.controller = undefined; void this.pump();
  }
  cancel(id: string) {
    const entry = this.entries.find(e => e.id === id);
    if (entry?.status === 'waiting') {
      const execution = this.executions.get(id); this.executions.delete(id);
      void execution?.dispose?.().catch(() => {});
      for (const [key, value] of this.keys) if (value === id) this.keys.delete(key);
      this.patch(id, {status:'cancelled', stage:'Cancelled before starting.'});
    } else if (id === this.activeId && entry?.status === 'running') {
      this.patch(id, {status:'cancelling', stage:'Cancelling and cleaning up…', percent:null}); this.controller?.abort();
    }
  }
  move(id: string, direction: -1 | 1) {
    const waiting = this.entries.filter(e => e.status === 'waiting'), index = waiting.findIndex(e => e.id === id);
    if (index < 0) return;
    const other = waiting[index + direction]; if (!other) return;
    const a = this.entries.findIndex(e => e.id === id), b = this.entries.indexOf(other);
    [this.entries[a], this.entries[b]] = [this.entries[b], this.entries[a]]; this.emit();
  }
  remove(id: string) { const e = this.entries.find(e => e.id === id); if (!e || ['running','cancelling'].includes(e.status)) return; this.cancel(id); this.entries = this.entries.filter(e => e.id !== id); this.emit(); }
  clearFinished() { this.entries = this.entries.filter(e => !finished(e.status)); this.emit(); }
  shutdown() { this.stopped = true; this.entries.filter(e => e.status === 'waiting').forEach(e => this.cancel(e.id)); if (this.activeId) this.cancel(this.activeId); }
}
export function safeError(cause: unknown) {
  const message = typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : 'The job could not be completed.';
  return message.replace(/https?:\/\/[^\s<>"']+/gi, '[redacted URL]').slice(0, 1200);
}
