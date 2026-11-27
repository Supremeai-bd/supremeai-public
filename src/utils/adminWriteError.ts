import { ApiError } from '../services/apiClient';

/** বাংলা মন্তব্য: ব্যাকএন্ডে রাউট না থাকলে edge 501 {notWired:true} দেয় — সেটা সোজা ভাষায়। */
export function isNotWiredError(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 501) return false;
  const data = err.data as { notWired?: unknown } | null | undefined;
  return Boolean(data && typeof data === 'object' && data.notWired === true);
}

export function adminWriteErrorMessage(err: unknown, fallback: string): string {
  if (isNotWiredError(err)) return 'এই কাজটি এখনো ব্যাকএন্ডে যুক্ত হয়নি — কিছুই বদলায়নি।';
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
