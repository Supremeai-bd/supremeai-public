import { describe, expect, it } from 'vitest';
import { computePhotoPortraitMaps } from './hologramAvatar';

// বাংলা মন্তব্য: নিজের ছবির অবতার — ছবির আসল রঙ ও মুখ অক্ষুণ্ণ থাকবে, শুধু কিনারা নরম হবে।
describe('computePhotoPortraitMaps (uploaded photo avatar)', () => {
  const size = 64;
  const src = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    src[i * 4] = 200; // warm skin-like tone
    src[i * 4 + 1] = 150;
    src[i * 4 + 2] = 120;
    src[i * 4 + 3] = 255;
  }
  const { color, depth } = computePhotoPortraitMaps(src, size);
  const px = (x: number, y: number) => (y * size + x) * 4;

  it('keeps the face centre fully opaque with near-original colours (no hologram recolouring)', () => {
    const c = px(size / 2, size / 2);
    expect(color[c + 3]).toBe(255);
    expect(Math.abs(color[c] - 200)).toBeLessThanOrEqual(12);
    expect(Math.abs(color[c + 1] - 150)).toBeLessThanOrEqual(12);
    expect(Math.abs(color[c + 2] - 120)).toBeLessThanOrEqual(16);
  });

  it('fades the corners out so the photo sits in a soft oval', () => {
    expect(color[px(0, 0) + 3]).toBe(0);
    expect(color[px(size - 1, size - 1) + 3]).toBe(0);
  });

  it('builds a smooth depth dome that peaks near the centre and never depends on image noise', () => {
    const centre = depth[px(size / 2, size / 2)];
    const cheek = depth[px(Math.round(size * 0.25), size / 2)];
    expect(centre).toBeGreaterThan(cheek);
    expect(depth[px(0, 0)]).toBe(0);
  });
});
