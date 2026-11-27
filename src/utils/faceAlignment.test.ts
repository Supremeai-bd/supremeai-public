import { describe, expect, it } from 'vitest';
import {
  CANONICAL_FACE_LAYOUT,
  applyTransform,
  computeCanonicalTransform,
  extractFeaturePointsFromMesh,
  isPlausibleCanonicalFace,
  landmarksToShaderFeatures,
  mapFeaturesToCanonical,
  type FaceFeaturePoints,
} from './faceAlignment';

/** Builds normalized feature points for a face whose eyes are rotated by `angleDeg` around `center`. */
function makeFace(opts: {
  center: { x: number; y: number };
  eyeHalfDist: number;
  angleDeg?: number;
}): FaceFeaturePoints {
  const a = ((opts.angleDeg ?? 0) * Math.PI) / 180;
  const rot = (dx: number, dy: number) => ({
    x: opts.center.x + dx * Math.cos(a) - dy * Math.sin(a),
    y: opts.center.y + dx * Math.sin(a) + dy * Math.cos(a),
  });
  const d = opts.eyeHalfDist;
  const eye = (cx: number, outerSign: number) => ({
    outer: rot(cx + outerSign * d * 0.3, 0),
    inner: rot(cx - outerSign * d * 0.3, 0),
    top: rot(cx, -d * 0.12),
    bottom: rot(cx, d * 0.12),
  });
  return {
    leftEye: eye(-d, -1),
    rightEye: eye(d, 1),
    mouth: {
      left: rot(-d * 0.7, d * 1.4),
      right: rot(d * 0.7, d * 1.4),
      top: rot(0, d * 1.25),
      bottom: rot(0, d * 1.6),
    },
  };
}

const eyeCenterPx = (f: FaceFeaturePoints, side: 'leftEye' | 'rightEye', w: number, h: number) => ({
  x: ((f[side].outer.x + f[side].inner.x) / 2) * w,
  y: ((f[side].outer.y + f[side].inner.y) / 2) * h,
});

describe('faceAlignment canonical transform', () => {
  const { size, eyeLineY, eyeDistance } = CANONICAL_FACE_LAYOUT;

  it('places both eyes level on the canonical eye line at the canonical distance', () => {
    const f = makeFace({ center: { x: 0.42, y: 0.35 }, eyeHalfDist: 0.08 });
    const t = computeCanonicalTransform(f, 800, 1000)!;
    expect(t).not.toBeNull();
    const l = applyTransform(t, eyeCenterPx(f, 'leftEye', 800, 1000));
    const r = applyTransform(t, eyeCenterPx(f, 'rightEye', 800, 1000));
    expect(l.y).toBeCloseTo(eyeLineY * size, 3);
    expect(r.y).toBeCloseTo(eyeLineY * size, 3);
    expect(r.x - l.x).toBeCloseTo(eyeDistance * size, 3);
    expect((l.x + r.x) / 2).toBeCloseTo(size / 2, 3);
  });

  it('straightens a tilted head', () => {
    const f = makeFace({ center: { x: 0.5, y: 0.45 }, eyeHalfDist: 0.1, angleDeg: 18 });
    const t = computeCanonicalTransform(f, 600, 600)!;
    const l = applyTransform(t, eyeCenterPx(f, 'leftEye', 600, 600));
    const r = applyTransform(t, eyeCenterPx(f, 'rightEye', 600, 600));
    expect(Math.abs(l.y - r.y)).toBeLessThan(1e-6);
    expect(r.x).toBeGreaterThan(l.x);
  });

  it('rejects degenerate eye positions', () => {
    const f = makeFace({ center: { x: 0.5, y: 0.5 }, eyeHalfDist: 0.0001 });
    expect(computeCanonicalTransform(f, 400, 400)).toBeNull();
  });

  it('maps features to plausible canonical boxes and UV shader features', () => {
    const f = makeFace({ center: { x: 0.55, y: 0.4 }, eyeHalfDist: 0.07, angleDeg: -9 });
    const t = computeCanonicalTransform(f, 1024, 768)!;
    const lm = mapFeaturesToCanonical(f, t, 1024, 768);
    expect(lm.leftEye.y).toBeCloseTo(eyeLineY, 4);
    expect(lm.rightEye.x - lm.leftEye.x).toBeCloseTo(eyeDistance, 4);
    expect(lm.mouth.y).toBeGreaterThan(lm.leftEye.y + 0.1);
    expect(isPlausibleCanonicalFace(lm)).toBe(true);

    const sf = landmarksToShaderFeatures(lm)!;
    expect(sf.leftEye[0]).toBeCloseTo(lm.leftEye.x, 6);
    expect(sf.leftEye[1]).toBeCloseTo(1 - lm.leftEye.y, 6);
    expect(sf.mouth[2]).toBeCloseTo(lm.mouth.w / 2, 6);
    // UV origin is bottom-left: mouth sits below the eyes → smaller v
    expect(sf.mouth[1]).toBeLessThan(sf.leftEye[1]);
  });

  it('flags implausible landmarks so the shader stays static', () => {
    const f = makeFace({ center: { x: 0.5, y: 0.4 }, eyeHalfDist: 0.08 });
    const lm = mapFeaturesToCanonical(f, computeCanonicalTransform(f, 500, 500)!, 500, 500);
    expect(isPlausibleCanonicalFace({ ...lm, mouth: { ...lm.mouth, y: lm.leftEye.y } })).toBe(
      false
    );
    expect(isPlausibleCanonicalFace(null)).toBe(false);
    expect(landmarksToShaderFeatures(undefined)).toBeNull();
  });
});

describe('extractFeaturePointsFromMesh', () => {
  it('returns null for missing or short keypoint lists', () => {
    expect(extractFeaturePointsFromMesh(undefined, 100, 100)).toBeNull();
    expect(extractFeaturePointsFromMesh([{ x: 1, y: 1 }], 100, 100)).toBeNull();
  });

  it('normalizes mesh points and orders eyes by image side', () => {
    const kp = Array.from({ length: 468 }, () => ({ x: 50, y: 50 }));
    // Subject's right eye (index 33/133) placed on the image RIGHT to verify side ordering
    kp[33] = { x: 140, y: 80 };
    kp[133] = { x: 120, y: 80 };
    kp[159] = { x: 130, y: 76 };
    kp[145] = { x: 130, y: 84 };
    kp[263] = { x: 60, y: 80 };
    kp[362] = { x: 80, y: 80 };
    kp[386] = { x: 70, y: 76 };
    kp[374] = { x: 70, y: 84 };
    kp[61] = { x: 120, y: 150 };
    kp[291] = { x: 80, y: 150 };
    kp[0] = { x: 100, y: 145 };
    kp[17] = { x: 100, y: 158 };
    const f = extractFeaturePointsFromMesh(kp, 200, 200)!;
    expect(f.leftEye.outer.x).toBeCloseTo(0.3, 6);
    expect(f.rightEye.outer.x).toBeCloseTo(0.7, 6);
    expect(f.mouth.left.x).toBeCloseTo(0.4, 6);
    expect(f.mouth.right.x).toBeCloseTo(0.6, 6);
  });
});
