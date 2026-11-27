import { describe, expect, it } from 'vitest';
import { pickAutoRole, pickAutoRoleId } from './autoRole';

// বাংলা মন্তব্য: রোল বাছাইয়ের মেনু নেই — মেসেজ দেখে সিস্টেম নিজেই রোল ঠিক করে।
describe('pickAutoRoleId (system picks the role, no role picker)', () => {
  it.each([
    ['Write a short story about a lost cat', 'supreme-writer'],
    ['একটা কবিতা লেখো বর্ষা নিয়ে', 'supreme-writer'],
    ['amar jonno ekta golpo lekho', 'supreme-writer'],
    ['Draft an email to my landlord about the leak', 'supreme-writer'],
  ])('creative writing → Writer: %s', (prompt, role) => {
    expect(pickAutoRoleId(prompt)).toBe(role);
  });

  it.each([
    ['Build a todo app with React and Tailwind', 'supreme-fullstack'],
    ['আমার দোকানের জন্য একটা ওয়েবসাইট বানাও', 'supreme-fullstack'],
    ['ekta portfolio website banao', 'supreme-fullstack'],
    ['create a landing page for my bakery', 'supreme-fullstack'],
  ])('building software → Full-Stack: %s', (prompt, role) => {
    expect(pickAutoRoleId(prompt)).toBe(role);
  });

  it('quick fixes → Fast Code', () => {
    expect(pickAutoRoleId('fix this regex for emails')).toBe('supreme-fast-dev');
    expect(pickAutoRoleId('```js\nconst a = b +\n```')).toBe('supreme-fast-dev');
  });

  it('security and architecture questions get specialists', () => {
    expect(pickAutoRoleId('Is my login form vulnerable to SQL injection?')).toBe(
      'supreme-security'
    );
    expect(pickAutoRoleId('Help me with the system design for a chat service')).toBe(
      'supreme-architect'
    );
  });

  it('a story-writing app is software, not a story', () => {
    expect(pickAutoRoleId('build a story writing app in react')).toBe('supreme-fullstack');
  });

  it('everything else → Generalist', () => {
    expect(pickAutoRoleId('What is the capital of Japan?')).toBe('supreme-general');
    expect(pickAutoRoleId('আজ আবহাওয়া কেমন?')).toBe('supreme-general');
    expect(pickAutoRoleId('')).toBe('supreme-general');
  });

  it('always resolves to a real persona from the shared contract', () => {
    const writer = pickAutoRole('write a poem');
    expect(writer.id).toBe('supreme-writer');
    expect(writer.systemInstruction.length).toBeGreaterThan(20);
  });
});
