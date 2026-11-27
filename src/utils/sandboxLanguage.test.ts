import { describe, expect, it } from 'vitest';
import { resolveSandboxLanguage, sniffSandboxRuntime } from './sandboxLanguage';

describe('sandbox language auto-detection (no manual language picker)', () => {
  it('uses the code-block tag when the code gives no stronger signal', () => {
    expect(resolveSandboxLanguage('js', 'console.log(1 + 1);').runtime).toBe('javascript');
    expect(resolveSandboxLanguage('typescript', 'const a = 1;').runtime).toBe('typescript');
    expect(resolveSandboxLanguage('jsx', 'const x = 1;').runtime).toBe('tsx');
  });

  it('lets the code override a stale tag (e.g. HTML pasted over JS)', () => {
    expect(resolveSandboxLanguage('javascript', '<div class="p-2">Hi</div>').runtime).toBe('html');
    expect(resolveSandboxLanguage('javascript', '{"name": "SupremeAI"}').runtime).toBe('json');
    expect(
      resolveSandboxLanguage(
        'javascript',
        'export default function App() {\n  return <div>Hello</div>;\n}'
      ).runtime
    ).toBe('tsx');
  });

  it('upgrades JS to TypeScript when type annotations appear', () => {
    expect(
      resolveSandboxLanguage('javascript', 'const add = (a: number, b: number) => a + b;').runtime
    ).toBe('typescript');
    expect(resolveSandboxLanguage('', 'interface User {\n  id: string;\n}').runtime).toBe(
      'typescript'
    );
  });

  it('falls back to JavaScript for untagged plain scripts', () => {
    expect(resolveSandboxLanguage('', 'console.log("hi")').runtime).toBe('javascript');
    expect(resolveSandboxLanguage('text', 'let x = 2; x * 3').runtime).toBe('javascript');
  });

  it('marks server-only languages as unsupported in the browser sandbox', () => {
    const py = resolveSandboxLanguage('python', 'print("hello")');
    expect(py.runtime).toBe('unsupported');
    expect(py.originalLang).toBe('python');
  });

  it('sniffs only strong signals', () => {
    expect(sniffSandboxRuntime('')).toBeNull();
    expect(sniffSandboxRuntime('const a = 1')).toBeNull();
    expect(sniffSandboxRuntime('[1, 2, 3]')).toBe('json');
    expect(sniffSandboxRuntime('{ not json')).toBeNull();
    expect(sniffSandboxRuntime('<!DOCTYPE html><html></html>')).toBe('html');
  });
});
