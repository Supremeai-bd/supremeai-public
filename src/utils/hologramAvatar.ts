import maleHologramImg from '../assets/images/avatar_hologram_male_1794610533388.jpg';
import type { LiveVoiceName } from '../hooks/useLiveVoiceSession';
import { detectClientFaceInCanvas, type NormalizedFaceBox } from './clientFaceDetection';
import { schedulePreferencesPatch } from '../services/userPreferencesSyncBus';
import { buildVoiceTtsSyncSnapshotFromStorage } from './speechUtils';

export type AvatarPresetId = 'female' | 'male' | 'custom';

export interface CustomFaceTraits {
  skinHex?: string;
  hairHex?: string;
  eyeHex?: string;
  lipHex?: string;
  genderCue?: 'female' | 'male';
  hairStyle?: 'short' | 'medium' | 'long';
  hasGlasses?: boolean;
  faceFound?: boolean;
}

export interface AvatarPreference {
  preset: AvatarPresetId;
  customImageDataUrl: string | null;
  customImageName?: string;
  customTraits?: CustomFaceTraits;
}

export interface AvatarPresetMeta {
  id: Exclude<AvatarPresetId, 'custom'>;
  label: string;
  subtitle: string;
  imageSrc: string;
}

export const AVATAR_PRESETS: AvatarPresetMeta[] = [
  {
    id: 'female',
    label: 'Aria (Female)',
    subtitle: '3D avatar with eye gaze, blinking & lip sync',
    imageSrc: '/assets/aistudio/image_b5b290a6.png',
  },
  {
    id: 'male',
    label: 'Orion (Male)',
    subtitle: '3D avatar with eye gaze, blinking & lip sync',
    imageSrc: maleHologramImg,
  },
];

const STORAGE_KEY = 'supremeai_voice_avatar_pref_v1';
const VOICE_STORAGE_KEY = 'supremeai_live_voice_name_v1';
export const VOICE_AVATAR_SYNC_EVENT = 'supremeai:voice-avatar-updated';

const VALID_VOICES: LiveVoiceName[] = ['Zephyr', 'Puck', 'Kore', 'Charon', 'Fenrir'];

export function loadVoicePreference(): LiveVoiceName {
  try {
    const raw = localStorage.getItem(VOICE_STORAGE_KEY) as LiveVoiceName | null;
    if (raw && VALID_VOICES.includes(raw)) return raw;
  } catch {
    // Ignore storage issues
  }
  return 'Zephyr';
}

export function saveVoicePreference(voice: LiveVoiceName, syncRemote: boolean = true): void {
  try {
    localStorage.setItem(VOICE_STORAGE_KEY, voice);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(VOICE_AVATAR_SYNC_EVENT));
    }
  } catch {
    // Ignore storage issues
  }
  if (syncRemote) {
    schedulePreferencesPatch({
      voice_tts_config: buildVoiceTtsSyncSnapshotFromStorage({ voicePersona: voice }),
    });
  }
}

export function loadAvatarPreference(): AvatarPreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { preset: 'female', customImageDataUrl: null };
    }
    const parsed = JSON.parse(raw) as Partial<AvatarPreference>;
    const preset: AvatarPresetId =
      parsed.preset === 'male' || parsed.preset === 'custom' || parsed.preset === 'female'
        ? parsed.preset
        : 'female';
    const customImageDataUrl =
      typeof parsed.customImageDataUrl === 'string' &&
      parsed.customImageDataUrl.startsWith('data:image/')
        ? parsed.customImageDataUrl
        : null;
    if (preset === 'custom' && !customImageDataUrl) {
      return { preset: 'female', customImageDataUrl: null };
    }
    return {
      preset,
      customImageDataUrl,
      customImageName:
        typeof parsed.customImageName === 'string' ? parsed.customImageName : undefined,
      customTraits: parsed.customTraits,
    };
  } catch {
    return { preset: 'female', customImageDataUrl: null };
  }
}

export function saveAvatarPreference(pref: AvatarPreference, syncRemote: boolean = true): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pref));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(VOICE_AVATAR_SYNC_EVENT));
    }
  } catch {
    // Ignore storage quota issues gracefully
  }
  if (syncRemote) {
    const syncSafePref: AvatarPreference =
      pref.customImageDataUrl && pref.customImageDataUrl.length > 220_000
        ? {
            preset: pref.preset === 'custom' ? 'female' : pref.preset,
            customImageDataUrl: null,
            customImageName: pref.customImageName,
            customTraits: pref.customTraits,
          }
        : pref;
    schedulePreferencesPatch({ avatar_pref: syncSafePref });
  }
}

export function resolveAvatarSource(pref: AvatarPreference): {
  src: string;
  isPrestyledHologram: boolean;
  traits?: CustomFaceTraits;
} {
  if (pref.preset === 'custom' && pref.customImageDataUrl) {
    return {
      src: pref.customImageDataUrl,
      isPrestyledHologram: false,
      traits: pref.customTraits,
    };
  }
  const preset = AVATAR_PRESETS.find((p) => p.id === pref.preset) || AVATAR_PRESETS[0];
  return { src: preset.imageSrc, isPrestyledHologram: true };
}

function readImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please select a PNG, JPG, or WebP image file.'));
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      reject(new Error('Image must be smaller than 12 MB.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid or unsupported image format.'));
      img.onload = () => resolve(img);
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Validates that an uploaded image contains a clearly visible human face using
 * client-side TensorFlow.js Face Landmarks Detection first (rejecting non-face or
 * unclear compositions immediately), then enriches skin/hair/eye/lip traits via
 * `/api/avatar/analyze-face` and crops tightly around ONLY the face.
 */
export async function processCustomFaceUpload(file: File): Promise<{
  dataUrl: string;
  traits: CustomFaceTraits;
  faceDetected: boolean;
}> {
  const img = await readImageFromFile(file);

  // Prepare an analysis JPEG at <= 800px for fast client TFJS + server inspection
  const maxSide = 800;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const aw = Math.max(64, Math.round(img.naturalWidth * scale));
  const ah = Math.max(64, Math.round(img.naturalHeight * scale));
  const analysisCanvas = document.createElement('canvas');
  analysisCanvas.width = aw;
  analysisCanvas.height = ah;
  const aCtx = analysisCanvas.getContext('2d');
  if (!aCtx) {
    throw new Error('2D canvas unavailable.');
  }
  aCtx.drawImage(img, 0, 0, aw, ah);
  const analysisDataUrl = analysisCanvas.toDataURL('image/jpeg', 0.9);

  // Step 1: Client-side face & landmark detection (@tensorflow-models/face-landmarks-detection)
  const clientCheck = await detectClientFaceInCanvas(analysisCanvas);
  if (!clientCheck.unavailable && !clientCheck.detected) {
    throw new Error(
      clientCheck.reason ||
        'No human face was clearly detected in this image. Please upload a clear portrait photo showing a human face.'
    );
  }

  let detectedBox: NormalizedFaceBox | null = clientCheck.detected ? clientCheck.box : null;
  let serverChecked = false;
  let serverFaceFound = false;
  let traits: CustomFaceTraits = {
    genderCue: 'male',
    hairStyle: 'short',
    hasGlasses: false,
    faceFound: clientCheck.detected,
  };

  // Step 2: Server-side trait extraction (skin/hair/eye/lip colors, hair length, glasses) + cross-check
  try {
    const res = await fetch('/api/avatar/analyze-face', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageData: analysisDataUrl,
        mimeType: 'image/jpeg',
      }),
    });
    if (res.ok) {
      const json = await res.json();
      if (!json.fallback) {
        serverChecked = true;
        serverFaceFound = Boolean(json.faceFound);
      }

      if (!detectedBox && json.faceFound && json.faceBox && Number(json.faceBox.width) > 0.05) {
        detectedBox = {
          x: Number(json.faceBox.x) || 0,
          y: Number(json.faceBox.y) || 0,
          width: Number(json.faceBox.width) || 0.3,
          height: Number(json.faceBox.height) || 0.3,
        };
      }
      traits = {
        skinHex: typeof json.skinHex === 'string' ? json.skinHex : undefined,
        hairHex: typeof json.hairHex === 'string' ? json.hairHex : undefined,
        eyeHex: typeof json.eyeHex === 'string' ? json.eyeHex : undefined,
        lipHex: typeof json.lipHex === 'string' ? json.lipHex : undefined,
        genderCue: json.genderCue === 'female' ? 'female' : 'male',
        hairStyle:
          json.hairStyle === 'long' || json.hairStyle === 'medium' ? json.hairStyle : 'short',
        hasGlasses: Boolean(json.hasGlasses),
        faceFound: clientCheck.detected || Boolean(json.faceFound),
      };
    }
  } catch {
    // Client detection result stands if network call fails
  }

  // Step 3: Strict validation gate — reject any image where no human face was verified
  if (serverChecked && !serverFaceFound && !clientCheck.detected) {
    throw new Error(
      'No human face was clearly detected in this image. Please upload a photo with a clear, front-facing human face.'
    );
  }

  if (!detectedBox || (!clientCheck.detected && !serverFaceFound)) {
    throw new Error(
      'Unable to confirm a clear human face in this image. Please upload a well-lit portrait with a visible face.'
    );
  }

  // Convert normalized face box -> tight padded square crop focused ONLY on the face
  const boxCx = (detectedBox.x + detectedBox.width * 0.5) * img.naturalWidth;
  const boxCy = (detectedBox.y + detectedBox.height * 0.5) * img.naturalHeight;
  const faceMaxDim = Math.max(
    detectedBox.width * img.naturalWidth,
    detectedBox.height * img.naturalHeight
  );
  // Generous enough for forehead & chin, tight enough to exclude chest/arms/scenery
  const cropSide = Math.max(
    96,
    Math.min(Math.min(img.naturalWidth, img.naturalHeight), faceMaxDim * 1.28)
  );
  const sx = Math.max(0, Math.min(img.naturalWidth - cropSide, boxCx - cropSide * 0.5));
  const sy = Math.max(0, Math.min(img.naturalHeight - cropSide, boxCy - cropSide * 0.5));

  const outSize = 512;
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = outSize;
  cropCanvas.height = outSize;
  const cCtx = cropCanvas.getContext('2d');
  if (!cCtx) {
    return { dataUrl: analysisDataUrl, traits, faceDetected: true };
  }
  cCtx.drawImage(img, sx, sy, cropSide, cropSide, 0, 0, outSize, outSize);

  // Sample natural skin tone from central cheek area if trait extraction omitted skinHex
  if (!traits.skinHex) {
    const sample = cCtx.getImageData(
      Math.round(outSize * 0.38),
      Math.round(outSize * 0.54),
      12,
      12
    ).data;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    const pixels = sample.length / 4;
    for (let i = 0; i < sample.length; i += 4) {
      sr += sample[i];
      sg += sample[i + 1];
      sb += sample[i + 2];
    }
    if (pixels > 0) {
      const toHex = (n: number) =>
        Math.max(0, Math.min(255, Math.round(n)))
          .toString(16)
          .padStart(2, '0');
      traits.skinHex = `#${toHex(sr / pixels)}${toHex(sg / pixels)}${toHex(sb / pixels)}`;
    }
  }

  return {
    dataUrl: cropCanvas.toDataURL('image/jpeg', 0.92),
    traits: { ...traits, faceFound: true },
    faceDetected: true,
  };
}

/**
 * Legacy helper kept for backward compatibility: returns tightly cropped face data URL.
 */
export async function normalizeUploadedAvatarFile(file: File): Promise<string> {
  const result = await processCustomFaceUpload(file);
  return result.dataUrl;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / Math.max(1e-5, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export interface HologramTexturePair {
  colorCanvas: HTMLCanvasElement;
  depthCanvas: HTMLCanvasElement;
}

/**
 * বাংলা মন্তব্য: ইউজারের নিজের ছবি (আগেই মুখ ঘিরে টাইট করে ক্রপ করা) থেকে পরিষ্কার পোর্ট্রেট টেক্সচার।
 * আগে ছবিটা কৃত্রিম 3D মাথার ওপর বসানো হতো, তার ওপরে আলাদা চোখ/ঠোঁট/চুল আঁকা হতো — দুটো
 * মিশে অদ্ভুত দেখাত। এখন ছবির আসল রঙ ও মুখ অক্ষুণ্ণ থাকে; শুধু নরম ডিম্বাকৃতি কিনারা (alpha),
 * হালকা ঠান্ডা টোন আর মসৃণ গম্বুজ-আকৃতির গভীরতা (depth) যোগ হয়। কোনো ফিচার নতুন করে আঁকা হয় না।
 */
export function computePhotoPortraitMaps(
  src: Uint8ClampedArray,
  size: number
): { color: Uint8ClampedArray; depth: Uint8ClampedArray } {
  const color = new Uint8ClampedArray(size * size * 4);
  const depth = new Uint8ClampedArray(size * size * 4);
  const denom = Math.max(1, size - 1);
  for (let y = 0; y < size; y++) {
    const ny = y / denom;
    for (let x = 0; x < size; x++) {
      const nx = x / denom;
      const p = (y * size + x) * 4;
      const r = src[p];
      const g = src[p + 1];
      const b = src[p + 2];

      // Soft oval vignette that fits the tight face crop (forehead → chin)
      const dx = (nx - 0.5) / 0.47;
      const dy = (ny - 0.48) / 0.5;
      const ovalR = Math.sqrt(dx * dx + dy * dy);
      const alpha = 1 - smoothstep(0.8, 1.0, ovalR);

      // Natural colours with a very light cool hologram grade
      color[p] = Math.round(r * 0.95);
      color[p + 1] = Math.min(255, Math.round(g * 0.98 + 4));
      color[p + 2] = Math.min(255, Math.round(b * 1.02 + 10));
      color[p + 3] = Math.round(alpha * 255);

      // Smooth facial dome only (no luminance noise) so the photo never warps
      const dome = Math.exp(
        -(((nx - 0.5) * (nx - 0.5)) / 0.12 + ((ny - 0.47) * (ny - 0.47)) / 0.16)
      );
      const d = Math.round(clamp01(dome * alpha) * 255);
      depth[p] = d;
      depth[p + 1] = d;
      depth[p + 2] = d;
      depth[p + 3] = 255;
    }
  }
  return { color, depth };
}

/**
 * Converts either a pre-styled holographic portrait OR a regular user-uploaded photo
 * into:
 * 1) A transparent-edged RGBA texture (pre-styled: keyed hologram; photo: natural colours)
 * 2) A grayscale 3D relief depth map for real-time WebGL vertex displacement
 */
export function buildHologramTextures(
  imageSrc: string,
  isPrestyledHologram: boolean
): Promise<HologramTexturePair> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => reject(new Error('Unable to load avatar texture source.'));
    img.onload = () => {
      const size = 512;
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = size;
      srcCanvas.height = size;
      const srcCtx = srcCanvas.getContext('2d');
      if (!srcCtx) {
        reject(new Error('2D canvas unavailable.'));
        return;
      }

      // Center-crop square with a gentle upper bias for portraits so head & shoulders align
      const imgAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
      let sx = 0;
      let sy = 0;
      let sw = img.naturalWidth;
      let sh = img.naturalHeight;
      if (imgAspect > 1) {
        sw = img.naturalHeight;
        sx = (img.naturalWidth - sw) * 0.5;
      } else if (imgAspect < 1) {
        sh = img.naturalWidth;
        sy = (img.naturalHeight - sh) * 0.22;
      }
      srcCtx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);

      const srcData = srcCtx.getImageData(0, 0, size, size);
      const pixels = srcData.data;

      const colorCanvas = document.createElement('canvas');
      colorCanvas.width = size;
      colorCanvas.height = size;
      const colorCtx = colorCanvas.getContext('2d')!;
      const colorOut = colorCtx.createImageData(size, size);

      const depthCanvas = document.createElement('canvas');
      depthCanvas.width = size;
      depthCanvas.height = size;
      const depthCtx = depthCanvas.getContext('2d')!;
      const depthOut = depthCtx.createImageData(size, size);

      if (!isPrestyledHologram) {
        // বাংলা মন্তব্য: আপলোড করা ছবি আসল রঙেই থাকে — শুধু নরম ডিম্বাকৃতি কিনারা আর হালকা গভীরতা।
        const maps = computePhotoPortraitMaps(pixels, size);
        colorOut.data.set(maps.color);
        depthOut.data.set(maps.depth);
      } else {
        for (let y = 0; y < size; y++) {
          const ny = y / (size - 1);
          for (let x = 0; x < size; x++) {
            const nx = x / (size - 1);
            const p = (y * size + x) * 4;
            const maxCh = Math.max(pixels[p], pixels[p + 1], pixels[p + 2]) / 255;

            // Portrait silhouette oval prior (narrower at head, wider at shoulders)
            const shoulderFlare = ny > 0.62 ? (ny - 0.62) * 0.65 : 0;
            const rx = 0.34 + shoulderFlare;
            const dx = (nx - 0.5) / rx;
            const dy = (ny - 0.48) / 0.45;
            const ovalR = Math.sqrt(dx * dx + dy * dy);
            const bottomFade = 1 - smoothstep(0.84, 0.99, ny);

            // Key out dark background & outer bokeh while preserving crisp glowing hologram portrait
            const keyStrength = smoothstep(0.055, 0.34, maxCh);
            // Stronger core mask keeps face/shoulders sharp, fades distant corner bokeh
            const outerSilhouette = 1 - smoothstep(0.88, 1.38, ovalR);
            const alpha = clamp01(keyStrength * (0.28 + 0.72 * outerSilhouette) * bottomFade);

            // Slight luminance contrast boost so hologram shines crisply even on light themes
            const boost = 1.08;
            colorOut.data[p] = Math.min(255, Math.round(pixels[p] * boost));
            colorOut.data[p + 1] = Math.min(255, Math.round(pixels[p + 1] * boost));
            colorOut.data[p + 2] = Math.min(255, Math.round(pixels[p + 2] * boost));
            colorOut.data[p + 3] = Math.round(alpha * 255);

            // Volumetric 3D depth relief: smooth facial dome + image brightness
            const faceDome = Math.exp(
              -(((nx - 0.5) * (nx - 0.5)) / 0.085 + ((ny - 0.44) * (ny - 0.44)) / 0.11)
            );
            const depthVal = clamp01((0.55 * faceDome + 0.45 * maxCh) * (0.25 + 0.75 * alpha));
            const dByte = Math.round(depthVal * 255);
            depthOut.data[p] = dByte;
            depthOut.data[p + 1] = dByte;
            depthOut.data[p + 2] = dByte;
            depthOut.data[p + 3] = 255;
          }
        }
      }

      colorCtx.putImageData(colorOut, 0, 0);
      depthCtx.putImageData(depthOut, 0, 0);
      resolve({ colorCanvas, depthCanvas });
    };
    img.src = imageSrc;
  });
}
