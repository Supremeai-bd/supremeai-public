import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANONICAL_SERVER_MODELS } from './platformCatalog';

const ROOT = path.resolve(__dirname, '../..');

// বাংলা মন্তব্য: SA-02, SA-04, SA-08 এবং SA-12 অডিট ফাইন্ডিংগুলো যেন আর কখনো
// ম্যানুয়ালি ফিক্স করতে না হয়, তার জন্য অটোমেটেড CI গার্ডরেইল টেস্ট।
describe('Automated Audit Guardrails (SA-02, SA-04, SA-08, SA-12)', () => {
  it('SA-02: edge /api/health derives modelsCount from CANONICAL_SERVER_MODELS and avoids hasApiKey leak', () => {
    const healthSrc = fs.readFileSync(path.join(ROOT, 'functions/api/health.ts'), 'utf-8');
    expect(healthSrc).toContain('CANONICAL_SERVER_MODELS');
    expect(healthSrc).not.toMatch(/modelsCount:\s*1\b/);
    expect(healthSrc).not.toContain('hasApiKey');
    expect(healthSrc).toContain('providerReadiness');
    expect(Object.keys(CANONICAL_SERVER_MODELS).length).toBeGreaterThanOrEqual(7);
  });

  it('SA-04: static security.txt, sitemap.xml, and robots.txt sitemap reference exist', () => {
    const securityTxtPath = path.join(ROOT, 'public/.well-known/security.txt');
    const sitemapPath = path.join(ROOT, 'public/sitemap.xml');
    const robotsPath = path.join(ROOT, 'public/robots.txt');

    expect(fs.existsSync(securityTxtPath)).toBe(true);
    const secTxt = fs.readFileSync(securityTxtPath, 'utf-8');
    expect(secTxt).toContain('Contact:');
    expect(secTxt).toContain('Expires:');
    expect(secTxt).toContain('Preferred-Languages: en, bn');

    expect(fs.existsSync(sitemapPath)).toBe(true);
    const sitemap = fs.readFileSync(sitemapPath, 'utf-8');
    expect(sitemap).toContain('<urlset');
    expect(sitemap).toContain('https://supremeai-studio.pages.dev/');

    expect(fs.existsSync(robotsPath)).toBe(true);
    const robots = fs.readFileSync(robotsPath, 'utf-8');
    expect(robots).toContain('Sitemap:');
  });

  it('SA-08: CSP in public/_headers does not allow cdn.tailwindcss.com', () => {
    const headersPath = path.join(ROOT, 'public/_headers');
    const cspLine = fs
      .readFileSync(headersPath, 'utf-8')
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith('Content-Security-Policy:'));
    expect(cspLine).toBeDefined();
    expect(cspLine).not.toContain('cdn.tailwindcss.com');
  });

  it('SA-12: single package manager lockfile (package-lock.json only, no bun.lock)', () => {
    expect(fs.existsSync(path.join(ROOT, 'package-lock.json'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'bun.lock'))).toBe(false);
  });
});
