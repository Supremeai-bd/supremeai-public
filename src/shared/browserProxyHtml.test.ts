import { describe, expect, it } from 'vitest';
import {
  decodeBasicEntities,
  isSafeNavigableHref,
  processProxiedHtml,
  stripHtmlTags,
} from './browserProxyHtml';

describe('browserProxyHtml sanitising helpers', () => {
  it('decodes entities in a single pass (no double-unescape)', () => {
    expect(decodeBasicEntities('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
    expect(decodeBasicEntities(' Tom &amp; Jerry &quot;x&quot; &#39;y&#39;&nbsp;')).toBe(
      `Tom & Jerry "x" 'y'`
    );
    expect(decodeBasicEntities('&unknown; &lt;b&gt;')).toBe('&unknown; <b>');
  });

  it('strips nested tag fragments until nothing can reassemble', () => {
    // The inner tags go first, the reassembled <script> pair is then removed too.
    expect(stripHtmlTags('<<b>script>alert(1)<</b>/script>')).toBe('alert(1)');
    expect(stripHtmlTags('a<b>b</b>c')).toBe('abc');
    expect(stripHtmlTags('x < y', ' ')).toBe('x   y');
    expect(stripHtmlTags('a > b')).toBe('a  b');
  });

  it('only allows http(s) navigation targets', () => {
    expect(isSafeNavigableHref('https://example.com/a')).toBe(true);
    expect(isSafeNavigableHref('http://example.com')).toBe(true);
    for (const bad of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'not a url',
    ]) {
      expect(isSafeNavigableHref(bad)).toBe(false);
    }
  });
});

describe('processProxiedHtml', () => {
  const base = 'https://example.com/page';
  const html = `<!doctype html><html><head><title>T</title></head><body>
    <a href="/ok">Go <b>here</b></a>
    <a href="javascript:alert(1)">js</a>
    <a href="data:text/html,hi">data</a>
    <a href="VBScript:x">vb</a>
    <p>Visible</p>
    <script>secret()</script >
    <style>.x{}</style foo>
  </body></html>`;

  it('drops unsafe links and keeps resolved http(s) ones', () => {
    const out = processProxiedHtml(html, base, 'https://studio.example');
    expect(out.extractedLinks).toEqual([{ href: 'https://example.com/ok', text: 'Go here' }]);
  });

  it('removes script/style bodies even with spaced or attributed end tags', () => {
    const out = processProxiedHtml(html, base, 'https://studio.example');
    expect(out.textPreview).toContain('Visible');
    expect(out.textPreview).not.toContain('secret()');
    expect(out.textPreview).not.toContain('.x{}');
    expect(out.textPreview).not.toMatch(/[<>]/);
  });
});
