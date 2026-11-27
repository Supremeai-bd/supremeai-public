import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type SavedMemory,
  buildSavedMemoriesPrompt,
  clearSavedMemoriesCache,
  getCachedSavedMemories,
  userMemoryService,
} from './userMemoryService';
import { apiClient } from './apiClient';

const mem = (over: Partial<SavedMemory>): SavedMemory => ({
  id: 'm1',
  content: 'Lives in Comilla',
  kind: 'fact',
  source: 'chatgpt',
  sourceRef: null,
  createdBy: 'user',
  status: 'confirmed',
  createdAt: '',
  updatedAt: '',
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
  clearSavedMemoriesCache();
});

describe('buildSavedMemoriesPrompt', () => {
  it('lists confirmed memories with their source and skips pending ones', () => {
    const prompt = buildSavedMemoriesPrompt([
      mem({}),
      mem({ id: 'm2', content: 'Secret candidate', status: 'candidate' }),
      mem({ id: 'm3', content: 'Prefers Bangla', source: 'claude' }),
    ]);
    expect(prompt).toContain('[SAVED MEMORIES');
    expect(prompt).toContain('- Lives in Comilla (from ChatGPT)');
    expect(prompt).toContain('- Prefers Bangla (from Claude)');
    expect(prompt).not.toContain('Secret candidate');
  });

  it('is empty when there is nothing, and capped for huge imports', () => {
    expect(buildSavedMemoriesPrompt([])).toBe('');
    const many = Array.from({ length: 200 }, (_, i) =>
      mem({ id: `m${i}`, content: `Fact ${i} ${'x'.repeat(50)}` })
    );
    const prompt = buildSavedMemoriesPrompt(many);
    expect(prompt.split('\n').filter((l) => l.startsWith('- ')).length).toBeLessThanOrEqual(40);
    expect(prompt.length).toBeLessThan(3400);
  });
});

describe('userMemoryService cache', () => {
  it('list fills the chat cache; remove and clearSource keep it in sync; sign-out empties it', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      memories: [mem({}), mem({ id: 'm2', source: 'claude' })],
    });
    await userMemoryService.list();
    expect(getCachedSavedMemories()).toHaveLength(2);

    vi.spyOn(apiClient, 'delete').mockResolvedValue({ removed: 1 });
    await userMemoryService.remove('m1');
    expect(getCachedSavedMemories().map((m) => m.id)).toEqual(['m2']);
    await userMemoryService.clearSource('claude');
    expect(getCachedSavedMemories()).toEqual([]);

    vi.spyOn(apiClient, 'post').mockResolvedValue({
      added: 1,
      skipped: 0,
      memories: [mem({ id: 'm9' })],
    });
    const res = await userMemoryService.importItems('chatgpt', ['Lives in Comilla']);
    expect(res.added).toBe(1);
    expect(apiClient.post).toHaveBeenCalledWith('/api/user/memories', {
      source: 'chatgpt',
      items: [{ content: 'Lives in Comilla' }],
    });
    expect(getCachedSavedMemories()).toHaveLength(1);
    clearSavedMemoriesCache();
    expect(getCachedSavedMemories()).toEqual([]);
  });
});
