import type { Activity, Method, Requests, Snapshot, View } from '../../src/shared/types';
import { previewRequest } from './preview';

type HostMessage =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'activity'; entry: Activity }
  | { type: 'error'; message: string }
  | { type: 'view'; view: View }
  | { type: 'pushDialog' };
declare const acquireVsCodeApi:
  | undefined
  | (() => { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void });
const api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
export const isPreview = !api;
const listeners = new Set<(message: HostMessage) => void>();
const pending = new Map<
  string,
  { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
>();
let sequence = 0;
let repository: string | undefined;
export function setRepository(value: string | undefined) {
  repository = value;
}
export function subscribe(listener: (message: HostMessage) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'response') {
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result);
  } else listeners.forEach((listener) => listener(message));
});
export async function request<M extends Method>(
  method: M,
  params: Requests[M]['params'],
): Promise<Requests[M]['result']> {
  if (!api) return previewRequest(method, params) as Promise<Requests[M]['result']>;
  return new Promise((resolve, reject) => {
    const id = String(++sequence);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('操作尚未完成，请检查 Git 控制台后刷新。'));
    }, 150_000);
    pending.set(id, { resolve: (value) => resolve(value as Requests[M]['result']), reject, timer });
    api.postMessage({ id, method, params, repository });
  });
}
export function loadState<T>(fallback: T): T {
  try {
    return (api?.getState() ||
      JSON.parse(sessionStorage.getItem('git-workbench-ui') || 'null') ||
      fallback) as T;
  } catch {
    return fallback;
  }
}
export function saveState(state: unknown) {
  if (api) api.setState(state);
  else sessionStorage.setItem('git-workbench-ui', JSON.stringify(state));
}
