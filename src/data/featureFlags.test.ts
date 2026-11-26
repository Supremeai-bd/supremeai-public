import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INITIAL_FEATURE_FLAGS } from './adminExpansionData';

/**
 * বাংলা মন্তব্য: আগে `featureFlagConsumers.ts` হাতে-লেখা তালিকা দিয়ে বলত কোন ফ্ল্যাগ
 * কোথায় পড়া হয় — কিন্তু ফাইলটা কোথাও import হত না (অর্থাৎ নিজেই ডেড কোড), আর
 * হাতে-লেখা তালিকা কোডের সাথে পিছিয়ে পড়তে পারে। এখন সত্য কোড থেকেই মাপা হয়:
 * Admin Overview-তে দেখানো প্রতিটি ফ্ল্যাগ অন্তত একটি আসল রানটাইম জায়গায়
 * (`featureFlags.<key>` / `runtimeFeatureFlags.<key>`) পড়া হতেই হবে। কেউ আবার
 * ডেড ফ্ল্যাগ যোগ করলে এই টেস্ট লাল হবে।
 */

const ROOT = join(__dirname, '..', '..');
const SCAN_DIRS = ['src', 'functions'];
const SKIP = /(\.test\.|\.d\.ts$|node_modules|[\\/]locales[\\/])/;

function collectSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (SKIP.test(full)) continue;
    if (statSync(full).isDirectory()) collectSources(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const sources = [
  ...SCAN_DIRS.flatMap((d) => collectSources(join(ROOT, d))),
  join(ROOT, 'server.ts'),
]
  .filter((f) => !f.endsWith(join('data', 'adminExpansionData.ts')))
  .map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, 'utf8') }));

function readersOf(key: string): string[] {
  const pattern = new RegExp(
    `[Ff]eatureFlags(\\?)?\\.${key}\\b|[Ff]eatureFlags\\[['"]${key}['"]\\]`
  );
  return sources.filter((s) => pattern.test(s.text)).map((s) => s.file);
}

describe('Admin feature flags — প্রতিটি ফ্ল্যাগ সত্যিই কিছু গেট করে', () => {
  it('অন্তত একটি ফ্ল্যাগ আছে', () => {
    expect(INITIAL_FEATURE_FLAGS.length).toBeGreaterThan(0);
  });

  it.each(INITIAL_FEATURE_FLAGS.map((f) => f.key))('%s রানটাইমে পড়া হয়', (key) => {
    expect(readersOf(key), `${key} কোথাও পড়া হয় না — ডেড ফ্ল্যাগ UI-তে দেখানো যাবে না`).not.toEqual(
      []
    );
  });

  it('অগ্নিপরীক্ষা: অজানা ফ্ল্যাগের কোনো reader পাওয়া যায় না', () => {
    expect(readersOf('some_unwired_flag_xyz')).toEqual([]);
  });
});
