/**
 * বাংলা মন্তব্য: আপলোড করা ছবিকে একটা নির্দিষ্ট "ক্যানোনিকাল" ফরম্যাটে আনা হয় — দুই চোখ সবসময়
 * একই উচ্চতায়, একই দূরত্বে, মুখ মাঝখানে। তাতে 3D অবতারের পলক, চোখের নড়া আর ঠোঁট নাড়ানো ঠিক
 * চোখ-ঠোঁটের জায়গাতেই হয়। FaceMesh ল্যান্ডমার্ক থেকে হিসাব হয়; সব ফাংশন বিশুদ্ধ (pure) ও টেস্টযোগ্য।
 */

export interface Point2 {
  x: number;
  y: number;
}

/** Feature points normalized to the SOURCE image (0..1, origin top-left). */
export interface FaceFeaturePoints {
  /** Eye that appears on the left side of the image. */
  leftEye: { outer: Point2; inner: Point2; top: Point2; bottom: Point2 };
  /** Eye that appears on the right side of the image. */
  rightEye: { outer: Point2; inner: Point2; top: Point2; bottom: Point2 };
  mouth: { left: Point2; right: Point2; top: Point2; bottom: Point2 };
}

/** Feature boxes normalized to the CANONICAL square (0..1, origin top-left). */
export interface FeatureBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanonicalFaceLandmarks {
  version: 1;
  leftEye: FeatureBox;
  rightEye: FeatureBox;
  mouth: FeatureBox;
}

/** Canonical layout: eye line at 40% from top, eyes 26% of the width apart, centred. */
export const CANONICAL_FACE_LAYOUT = {
  size: 512,
  eyeLineY: 0.4,
  eyeDistance: 0.26,
} as const;

/** Canvas-style affine transform: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface AffineTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

// MediaPipe FaceMesh (468-point) indices. "A" = subject's right eye (image left).
const MESH = {
  eyeA: { outer: 33, inner: 133, top: 159, bottom: 145 },
  eyeB: { outer: 263, inner: 362, top: 386, bottom: 374 },
  mouth: { left: 61, right: 291, top: 0, bottom: 17 },
} as const;

const mid = (p: Point2, q: Point2): Point2 => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
const dist = (p: Point2, q: Point2): number => Math.hypot(p.x - q.x, p.y - q.y);

/** Extracts eye & mouth points from a FaceMesh keypoint list (pixel coords of a w×h canvas). */
export function extractFeaturePointsFromMesh(
  keypoints: ReadonlyArray<{ x: number; y: number }> | undefined,
  width: number,
  height: number
): FaceFeaturePoints | null {
  if (!keypoints || keypoints.length < 400 || width <= 0 || height <= 0) return null;
  const pt = (i: number): Point2 | null => {
    const k = keypoints[i];
    if (!k || !Number.isFinite(k.x) || !Number.isFinite(k.y)) return null;
    return { x: k.x / width, y: k.y / height };
  };
  const eye = (ids: { outer: number; inner: number; top: number; bottom: number }) => {
    const outer = pt(ids.outer);
    const inner = pt(ids.inner);
    const top = pt(ids.top);
    const bottom = pt(ids.bottom);
    return outer && inner && top && bottom ? { outer, inner, top, bottom } : null;
  };
  const eyeA = eye(MESH.eyeA);
  const eyeB = eye(MESH.eyeB);
  const mLeft = pt(MESH.mouth.left);
  const mRight = pt(MESH.mouth.right);
  const mTop = pt(MESH.mouth.top);
  const mBottom = pt(MESH.mouth.bottom);
  if (!eyeA || !eyeB || !mLeft || !mRight || !mTop || !mBottom) return null;

  const aCenter = mid(eyeA.outer, eyeA.inner);
  const bCenter = mid(eyeB.outer, eyeB.inner);
  const [leftEye, rightEye] = aCenter.x <= bCenter.x ? [eyeA, eyeB] : [eyeB, eyeA];
  const [left, right] = mLeft.x <= mRight.x ? [mLeft, mRight] : [mRight, mLeft];
  return { leftEye, rightEye, mouth: { left, right, top: mTop, bottom: mBottom } };
}

/**
 * Computes the transform that maps SOURCE pixels to CANONICAL pixels so both eyes land on the
 * canonical eye line, level and at the canonical distance.
 */
export function computeCanonicalTransform(
  features: FaceFeaturePoints,
  sourceWidth: number,
  sourceHeight: number,
  layout: { size: number; eyeLineY: number; eyeDistance: number } = CANONICAL_FACE_LAYOUT
): AffineTransform | null {
  const toPx = (p: Point2): Point2 => ({ x: p.x * sourceWidth, y: p.y * sourceHeight });
  const l = toPx(mid(features.leftEye.outer, features.leftEye.inner));
  const r = toPx(mid(features.rightEye.outer, features.rightEye.inner));
  const eyeDist = dist(l, r);
  if (!Number.isFinite(eyeDist) || eyeDist < 4) return null;

  const angle = Math.atan2(r.y - l.y, r.x - l.x);
  const s = (layout.eyeDistance * layout.size) / eyeDist;
  const cos = Math.cos(-angle) * s;
  const sin = Math.sin(-angle) * s;
  const m = mid(l, r);
  const tx = 0.5 * layout.size;
  const ty = layout.eyeLineY * layout.size;
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: tx - (cos * m.x - sin * m.y),
    f: ty - (sin * m.x + cos * m.y),
  };
}

export function applyTransform(t: AffineTransform, p: Point2): Point2 {
  return { x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f };
}

/** Maps source feature points into canonical feature boxes (normalized 0..1). */
export function mapFeaturesToCanonical(
  features: FaceFeaturePoints,
  transform: AffineTransform,
  sourceWidth: number,
  sourceHeight: number,
  size: number = CANONICAL_FACE_LAYOUT.size
): CanonicalFaceLandmarks {
  const map = (p: Point2): Point2 => {
    const q = applyTransform(transform, { x: p.x * sourceWidth, y: p.y * sourceHeight });
    return { x: q.x / size, y: q.y / size };
  };
  const eyeBox = (e: FaceFeaturePoints['leftEye']): FeatureBox => {
    const outer = map(e.outer);
    const inner = map(e.inner);
    const top = map(e.top);
    const bottom = map(e.bottom);
    const c = mid(outer, inner);
    return {
      x: c.x,
      y: (c.y + mid(top, bottom).y) / 2,
      w: Math.max(0.02, dist(outer, inner)),
      h: Math.max(0.008, dist(top, bottom)),
    };
  };
  const mLeft = map(features.mouth.left);
  const mRight = map(features.mouth.right);
  const mTop = map(features.mouth.top);
  const mBottom = map(features.mouth.bottom);
  const corners = mid(mLeft, mRight);
  return {
    version: 1,
    leftEye: eyeBox(features.leftEye),
    rightEye: eyeBox(features.rightEye),
    mouth: {
      x: corners.x,
      y: (corners.y + mid(mTop, mBottom).y) / 2,
      w: Math.max(0.04, dist(mLeft, mRight)),
      h: Math.max(0.015, dist(mTop, mBottom)),
    },
  };
}

/** Sanity check so a bad detection never drives the animation into the wrong place. */
export function isPlausibleCanonicalFace(lm: CanonicalFaceLandmarks | undefined | null): boolean {
  if (!lm || lm.version !== 1) return false;
  const inRange = (b: FeatureBox) =>
    [b.x, b.y, b.w, b.h].every((v) => Number.isFinite(v)) &&
    b.x > 0.05 &&
    b.x < 0.95 &&
    b.y > 0.05 &&
    b.y < 0.98;
  if (!inRange(lm.leftEye) || !inRange(lm.rightEye) || !inRange(lm.mouth)) return false;
  // Mouth must sit below the eyes and roughly between them
  const eyeY = (lm.leftEye.y + lm.rightEye.y) / 2;
  if (lm.mouth.y <= eyeY + 0.08) return false;
  if (lm.mouth.x < lm.leftEye.x - 0.05 || lm.mouth.x > lm.rightEye.x + 0.05) return false;
  return lm.leftEye.x < lm.rightEye.x;
}

/** Shader-ready feature uniforms in texture UV space (origin bottom-left): [cx, cy, halfW, halfH]. */
export interface FaceShaderFeatures {
  leftEye: [number, number, number, number];
  rightEye: [number, number, number, number];
  mouth: [number, number, number, number];
}

/**
 * Converts canonical landmarks (origin top-left) into UV-space boxes for the portrait shader.
 * Returns null when the landmarks are missing or implausible so the shader stays static.
 */
export function landmarksToShaderFeatures(
  lm: CanonicalFaceLandmarks | undefined | null
): FaceShaderFeatures | null {
  if (!lm || !isPlausibleCanonicalFace(lm)) return null;
  const toUv = (b: FeatureBox): [number, number, number, number] => [
    b.x,
    1 - b.y,
    b.w / 2,
    b.h / 2,
  ];
  return { leftEye: toUv(lm.leftEye), rightEye: toUv(lm.rightEye), mouth: toUv(lm.mouth) };
}
