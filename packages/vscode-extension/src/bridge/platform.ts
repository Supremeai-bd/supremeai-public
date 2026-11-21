export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createSecureStore(): SecureStore {
  const vscode = (globalThis as any).acquireVsCodeApi?.();
  let reqSeq = 0;
  const pending = new Map<number, (value: string | null) => void>();

  if (vscode && typeof window !== 'undefined') {
    window.addEventListener('message', (event: MessageEvent) => {
      const m = event.data;
      if (m && m.type === 'secure_get_result' && typeof m.reqId === 'number') {
        const resolve = pending.get(m.reqId);
        if (resolve) {
          pending.delete(m.reqId);
          resolve(typeof m.value === 'string' ? m.value : null);
        }
      }
    });
  }

  return {
    async get(key: string) {
      if (!vscode || !key) return null;
      const reqId = ++reqSeq;
      return new Promise<string | null>((resolve) => {
        pending.set(reqId, resolve);
        vscode.postMessage({ type: 'secure_get', key, reqId });
        setTimeout(() => {
          if (pending.has(reqId)) {
            pending.delete(reqId);
            resolve(null);
          }
        }, 5000);
      });
    },
    async set(key: string, value: string) {
      vscode?.postMessage({ type: 'secure_set', key, value });
    },
    async remove(key: string) {
      vscode?.postMessage({ type: 'secure_remove', key });
    },
  };
}

export function detectPlatform() {
  return 'extension' as const;
}
