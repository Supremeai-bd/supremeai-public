import { apiClient } from './apiClient';
import { memorySourceFor } from '../constants/memorySources';

/**
 * বাংলা মন্তব্য: AI Memory — edge `functions/_lib/userMemories.ts`-এর ক্লায়েন্ট।
 * নিশ্চিত (confirmed) মেমরিগুলো মেমরিতে ক্যাশ থাকে যাতে প্রতিটা চ্যাটের সিস্টেম প্রম্পটে
 * সাথে সাথে যোগ করা যায় — localStorage-এ নয়, তাই লগআউট/অন্য ইউজারে ফাঁস হয় না।
 */

export type MemoryKind = 'fact' | 'decision' | 'task' | 'preference' | 'contact' | 'doc_chunk';

export interface SavedMemory {
  id: string;
  content: string;
  kind: MemoryKind;
  source: string;
  sourceRef: string | null;
  createdBy: string;
  status: 'candidate' | 'confirmed';
  createdAt: string;
  updatedAt: string;
}

export const SAVED_MEMORIES_UPDATED_EVENT = 'supremeai-saved-memories-updated';

let cache: SavedMemory[] = [];

function setCache(next: SavedMemory[]) {
  cache = next;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SAVED_MEMORIES_UPDATED_EVENT, { detail: cache }));
  }
}

const listOf = (res: { memories?: unknown }): SavedMemory[] =>
  Array.isArray(res?.memories) ? (res.memories as SavedMemory[]) : [];

export const userMemoryService = {
  async list(): Promise<SavedMemory[]> {
    const memories = listOf(await apiClient.get<{ memories?: unknown }>('/api/user/memories'));
    setCache(memories);
    return memories;
  },
  async importItems(
    source: string,
    items: string[]
  ): Promise<{ added: number; skipped: number; memories: SavedMemory[] }> {
    const res = await apiClient.post<{ added?: number; skipped?: number; memories?: unknown }>(
      '/api/user/memories',
      { source, items: items.map((content) => ({ content })) }
    );
    const added = listOf(res);
    if (added.length) setCache([...added, ...cache]);
    return { added: Number(res?.added) || 0, skipped: Number(res?.skipped) || 0, memories: added };
  },
  async update(
    id: string,
    patch: Partial<Pick<SavedMemory, 'content' | 'kind'>> & { status?: 'confirmed' }
  ): Promise<SavedMemory | null> {
    const res = await apiClient.patch<{ memory?: SavedMemory }>(
      `/api/user/memories/${encodeURIComponent(id)}`,
      patch
    );
    const saved = res?.memory ?? null;
    if (saved) setCache(cache.map((m) => (m.id === id ? saved : m)));
    return saved;
  },
  async remove(id: string): Promise<void> {
    await apiClient.delete(`/api/user/memories/${encodeURIComponent(id)}`);
    setCache(cache.filter((m) => m.id !== id));
  },
  async clearSource(source: string): Promise<number> {
    const res = await apiClient.delete<{ removed?: number }>(
      `/api/user/memories?source=${encodeURIComponent(source)}`
    );
    setCache(cache.filter((m) => m.source !== source));
    return Number(res?.removed) || 0;
  },
};

/** Synchronous read for the chat prompt builder. */
export function getCachedSavedMemories(): SavedMemory[] {
  return cache;
}

/** Called on sign-out so the next account never sees the previous one's memories. */
export function clearSavedMemoriesCache(): void {
  setCache([]);
}

const PROMPT_MAX_ITEMS = 40;
const PROMPT_MAX_CHARS = 3000;

/**
 * `[SAVED MEMORIES]` block for the system prompt: only confirmed memories, newest first,
 * capped so a huge import can never crowd out the conversation.
 */
export function buildSavedMemoriesPrompt(memories: SavedMemory[]): string {
  const lines: string[] = [];
  let used = 0;
  for (const m of memories) {
    if (m.status !== 'confirmed') continue;
    const line = `- ${m.content.replace(/\s+/g, ' ').trim()} (from ${memorySourceFor(m.source).label})`;
    if (used + line.length > PROMPT_MAX_CHARS || lines.length >= PROMPT_MAX_ITEMS) break;
    lines.push(line);
    used += line.length;
  }
  if (!lines.length) return '';
  return (
    '\n[SAVED MEMORIES — facts the user chose to keep, gathered from their AI assistants. ' +
    'Use them when relevant; never recite them unprompted.]\n' +
    lines.join('\n')
  );
}
