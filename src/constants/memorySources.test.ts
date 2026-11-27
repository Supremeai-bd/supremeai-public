import { describe, expect, it } from 'vitest';
import {
  IMPORTABLE_MEMORY_SOURCES,
  MEMORY_SOURCES,
  memorySourceFor,
  parseMemoryText,
} from './memorySources';

describe('parseMemoryText', () => {
  it('splits an AI answer into clean memories, dropping the intro and markdown', () => {
    const text = `Here's what I remember about you:

- **Name:** Rahim
- Lives in Comilla, Bangladesh.
* Prefers short answers
1. Works with React and Tauri
2) Building SupremeAI
---
- Lives in Comilla, Bangladesh`;
    expect(parseMemoryText(text)).toEqual([
      'Name: Rahim',
      'Lives in Comilla, Bangladesh.',
      'Prefers short answers',
      'Works with React and Tauri',
      'Building SupremeAI',
    ]);
  });

  it('accepts a JSON export and Bangla lines', () => {
    expect(parseMemoryText('["আমি কুমিল্লায় থাকি", {"content": "Likes tea"}, 5]')).toEqual([
      'আমি কুমিল্লায় থাকি',
      'Likes tea',
    ]);
  });

  it('caps very long lines and ignores empty input', () => {
    expect(parseMemoryText('')).toEqual([]);
    expect(parseMemoryText('x'.repeat(50), 10)).toEqual(['x'.repeat(10)]);
  });
});

describe('memory sources', () => {
  it('ChatGPT, Claude and Gemini link straight to their memory pages', () => {
    expect(memorySourceFor('chatgpt').memoryPageUrl).toBe(
      'https://chatgpt.com/#settings/Personalization'
    );
    expect(memorySourceFor('claude').memoryPageUrl).toBe('https://claude.ai/settings/capabilities');
    expect(memorySourceFor('gemini').memoryPageUrl).toBe('https://gemini.google.com/saved-info');
  });

  it('every importable source explains what to do; system sources are not importable', () => {
    for (const s of IMPORTABLE_MEMORY_SOURCES) expect(s.steps?.length).toBeGreaterThan(0);
    expect(IMPORTABLE_MEMORY_SOURCES.map((s) => s.id)).not.toContain('supremeai');
    expect(new Set(MEMORY_SOURCES.map((s) => s.id)).size).toBe(MEMORY_SOURCES.length);
  });

  it('unknown sources still get a readable badge', () => {
    expect(memorySourceFor('poe')).toMatchObject({ label: 'Poe', importable: false });
  });
});
